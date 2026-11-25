use crate::media_server::MediaServer;
use crate::storage::VideoQuality;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

pub const YTDLP_RELEASE_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

#[derive(Debug, Error)]
pub enum YtdlpError {
    #[error("Invalid YouTube video ID")]
    InvalidVideoId,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Network request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Failed to parse yt-dlp metadata: {0}")]
    Json(#[from] serde_json::Error),
    #[error("yt-dlp failed: {0}")]
    ProcessFailed(String),
    #[error("Download cancelled")]
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinariesStatus {
    pub ytdlp_path: Option<String>,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub youtube_id: String,
    pub url: String,
    pub title: String,
    pub channel: String,
    pub duration_sec: f64,
    pub thumbnail_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub video_id: String,
    pub quality: VideoQuality,
    pub percent: f64,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareVideoResult {
    pub video_id: String,
    pub quality: VideoQuality,
    pub stream_url: String,
    pub cached: bool,
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub total_bytes: u64,
    pub file_count: usize,
    pub favorite_bytes: u64,
    pub temp_bytes: u64,
    pub cached_video_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CacheClearMode {
    TempOnly,
    All,
}

#[derive(Debug, Default, Clone)]
pub struct DownloadManager {
    active: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl DownloadManager {
    pub async fn register(&self, video_id: &str) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        let mut guard = self.active.lock().await;
        if let Some(prev) = guard.insert(video_id.to_string(), tx) {
            let _ = prev.send(());
        }
        rx
    }

    pub async fn remove(&self, video_id: &str) {
        let mut guard = self.active.lock().await;
        guard.remove(video_id);
    }

    pub async fn cancel(&self, video_id: &str) -> bool {
        let mut guard = self.active.lock().await;
        if let Some(tx) = guard.remove(video_id) {
            let _ = tx.send(());
            true
        } else {
            false
        }
    }
}

pub fn is_valid_youtube_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn quality_label(q: VideoQuality) -> &'static str {
    match q {
        VideoQuality::Q480p => "480p",
        VideoQuality::Q720p => "720p",
        VideoQuality::Q1080p => "1080p",
    }
}

pub fn quality_max_height(q: VideoQuality) -> u32 {
    match q {
        VideoQuality::Q480p => 480,
        VideoQuality::Q720p => 720,
        VideoQuality::Q1080p => 1080,
    }
}

pub fn cache_filename(video_id: &str, quality: VideoQuality) -> Result<String, YtdlpError> {
    if !is_valid_youtube_id(video_id) {
        return Err(YtdlpError::InvalidVideoId);
    }
    Ok(format!("{video_id}_{}.mp4", quality_label(quality)))
}

pub fn extract_video_id_from_cache_filename(name: &str) -> Option<String> {
    let stem = name
        .strip_suffix("_480p.mp4")
        .or_else(|| name.strip_suffix("_720p.mp4"))
        .or_else(|| name.strip_suffix("_1080p.mp4"))?;
    if is_valid_youtube_id(stem) {
        Some(stem.to_string())
    } else {
        None
    }
}

pub fn extract_video_id_from_cache_artifact(name: &str) -> Option<String> {
    if let Some(vid) = extract_video_id_from_cache_filename(name) {
        return Some(vid);
    }
    let stem = name.strip_suffix("_waveform.json")?;
    if is_valid_youtube_id(stem) {
        Some(stem.to_string())
    } else {
        None
    }
}

pub fn ytdlp_format_selector(quality: VideoQuality) -> String {
    let h = quality_max_height(quality);
    format!(
        "bv*[height<={h}][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<={h}][ext=mp4]/bv*[height<={h}]+ba/b"
    )
}

pub fn parse_ytdlp_progress_line(line: &str) -> Option<f64> {
    let trimmed = line.trim();
    if !trimmed.starts_with("[download]") {
        return None;
    }
    let pct_pos = trimmed.find('%')?;
    let before = trimmed[..pct_pos].trim_end();
    let num_token = before.split_whitespace().last()?;
    let val = num_token.parse::<f64>().ok()?;
    if val.is_finite() {
        Some(val.clamp(0.0, 100.0))
    } else {
        None
    }
}

pub fn bin_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("bin")
}

pub fn cache_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("cache")
}

pub(crate) fn configure_hidden_command(cmd: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

pub fn find_binary(data_dir: &Path, exe_name: &str) -> Option<PathBuf> {
    let local = bin_dir(data_dir).join(exe_name);
    if local.is_file() {
        return Some(local);
    }

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(exe_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

pub async fn download_ytdlp_binary(data_dir: &Path) -> Result<PathBuf, YtdlpError> {
    let dir = bin_dir(data_dir);
    tokio::fs::create_dir_all(&dir).await?;

    let target_path = dir.join("yt-dlp.exe");
    let tmp_path = dir.join(format!("yt-dlp.exe.{}.tmp", std::process::id()));

    let client = reqwest::Client::builder().build()?;
    let response = client.get(YTDLP_RELEASE_URL).send().await?.error_for_status()?;

    let write_res = async {
        let mut file = tokio::fs::File::create(&tmp_path).await?;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk?;
            file.write_all(&bytes).await?;
        }
        file.flush().await?;
        Ok::<(), YtdlpError>(())
    }
    .await;

    if let Err(err) = write_res {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(err);
    }

    if let Err(err) = tokio::fs::rename(&tmp_path, &target_path).await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(err.into());
    }

    Ok(target_path)
}

pub async fn ensure_ytdlp(data_dir: &Path) -> Result<PathBuf, YtdlpError> {
    if let Some(existing) = find_binary(data_dir, "yt-dlp.exe") {
        return Ok(existing);
    }
    download_ytdlp_binary(data_dir).await
}

pub async fn get_ytdlp_version(ytdlp_path: &Path) -> Option<String> {
    let mut cmd = Command::new(ytdlp_path);
    cmd.arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_hidden_command(&mut cmd);

    let output = cmd.output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

pub async fn check_binaries(data_dir: &Path) -> BinariesStatus {
    let ytdlp = find_binary(data_dir, "yt-dlp.exe");
    let ytdlp_version = match ytdlp.as_deref() {
        Some(p) => get_ytdlp_version(p).await,
        None => None,
    };
    let ffmpeg = find_binary(data_dir, "ffmpeg.exe");

    BinariesStatus {
        ytdlp_path: ytdlp.map(|p| p.to_string_lossy().into_owned()),
        ytdlp_version,
        ffmpeg_path: ffmpeg.map(|p| p.to_string_lossy().into_owned()),
    }
}

#[derive(Debug, Deserialize)]
struct RawYtdlpMetadata {
    id: String,
    title: Option<String>,
    channel: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    webpage_url: Option<String>,
}

pub async fn fetch_video_metadata(
    data_dir: &Path,
    url: &str,
) -> Result<VideoMetadata, YtdlpError> {
    let ytdlp_path = ensure_ytdlp(data_dir).await?;
    let mut cmd = Command::new(ytdlp_path);
    cmd.args(["--dump-json", "--no-playlist", "--no-warnings", "--", url])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_hidden_command(&mut cmd);

    let output = cmd.output().await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(YtdlpError::ProcessFailed(if stderr.is_empty() {
            format!("exit code {:?}", output.status.code())
        } else {
            stderr
        }));
    }

    let raw: RawYtdlpMetadata = serde_json::from_slice(&output.stdout)?;
    if !is_valid_youtube_id(&raw.id) {
        return Err(YtdlpError::InvalidVideoId);
    }

    let canonical_url = raw
        .webpage_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", raw.id));

    Ok(VideoMetadata {
        youtube_id: raw.id,
        url: canonical_url,
        title: raw.title.unwrap_or_else(|| "Untitled Video".to_string()),
        channel: raw
            .channel
            .or(raw.uploader)
            .unwrap_or_else(|| "Unknown Channel".to_string()),
        duration_sec: raw.duration.unwrap_or(0.0).max(0.0),
        thumbnail_url: raw.thumbnail.unwrap_or_default(),
    })
}

async fn cleanup_temp_files(cache_dir: &Path, prefix: &str) {
    if let Ok(mut entries) = tokio::fs::read_dir(cache_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(prefix) {
                    let _ = tokio::fs::remove_file(entry.path()).await;
                }
            }
        }
    }
}

async fn find_downloaded_temp_file(cache_dir: &Path, prefix: &str) -> Option<PathBuf> {
    let mp4_path = cache_dir.join(format!("{prefix}.mp4"));
    if mp4_path.is_file() {
        return Some(mp4_path);
    }
    if let Ok(mut entries) = tokio::fs::read_dir(cache_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(prefix) && !name.ends_with(".part") && path.is_file() {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn emit_progress(
    app: &AppHandle,
    video_id: &str,
    quality: VideoQuality,
    percent: f64,
    stage: &str,
) {
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            video_id: video_id.to_string(),
            quality,
            percent,
            stage: stage.to_string(),
        },
    );
}

pub async fn prepare_video(
    app: &AppHandle,
    data_dir: &Path,
    media_server: &MediaServer,
    downloads: &DownloadManager,
    video_id: &str,
    quality: VideoQuality,
) -> Result<PrepareVideoResult, YtdlpError> {
    let filename = cache_filename(video_id, quality)?;
    let cdir = cache_dir(data_dir);
    tokio::fs::create_dir_all(&cdir).await?;

    let final_path = cdir.join(&filename);
    if let Ok(meta) = tokio::fs::metadata(&final_path).await {
        if meta.is_file() && meta.len() > 0 {
            emit_progress(app, video_id, quality, 100.0, "ready");
            return Ok(PrepareVideoResult {
                video_id: video_id.to_string(),
                quality,
                stream_url: media_server.stream_url(&filename),
                cached: true,
                file_size_bytes: meta.len(),
            });
        }
    }

    let ytdlp_path = match find_binary(data_dir, "yt-dlp.exe") {
        Some(p) => p,
        None => {
            emit_progress(app, video_id, quality, 0.0, "installing_ytdlp");
            download_ytdlp_binary(data_dir).await?
        }
    };

    let tmp_prefix = format!("{video_id}_{}.tmp", quality_label(quality));
    cleanup_temp_files(&cdir, &tmp_prefix).await;

    let output_template = cdir.join(format!("{tmp_prefix}.%(ext)s"));
    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");
    let format_selector = ytdlp_format_selector(quality);

    let mut cmd = Command::new(&ytdlp_path);
    cmd.args([
        "--format",
        &format_selector,
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "--newline",
        "--progress",
        "--no-warnings",
        "-o",
        &output_template.to_string_lossy(),
    ]);

    let local_ffmpeg = bin_dir(data_dir).join("ffmpeg.exe");
    if local_ffmpeg.is_file() {
        cmd.arg("--ffmpeg-location");
        cmd.arg(local_ffmpeg);
    }

    cmd.args(["--", &watch_url])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_hidden_command(&mut cmd);

    let mut cancel_rx = downloads.register(video_id).await;
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            downloads.remove(video_id).await;
            return Err(err.into());
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_clone = app.clone();
    let vid_clone = video_id.to_string();
    let stdout_task = tokio::spawn(async move {
        if let Some(out) = stdout {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(pct) = parse_ytdlp_progress_line(&line) {
                    emit_progress(&app_clone, &vid_clone, quality, pct, "downloading");
                } else if line.contains("[Merger]") || line.contains("Merging formats") {
                    emit_progress(&app_clone, &vid_clone, quality, 99.0, "merging");
                }
            }
        }
    });

    let stderr_task = tokio::spawn(async move {
        let mut collected = Vec::new();
        if let Some(err) = stderr {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    collected.push(line);
                    if collected.len() > 20 {
                        collected.remove(0);
                    }
                }
            }
        }
        collected.join("\n")
    });

    emit_progress(app, video_id, quality, 0.0, "downloading");

    let status = tokio::select! {
        res = child.wait() => {
            downloads.remove(video_id).await;
            res?
        }
        _ = &mut cancel_rx => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            downloads.remove(video_id).await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            cleanup_temp_files(&cdir, &tmp_prefix).await;
            return Err(YtdlpError::Cancelled);
        }
    };

    let _ = stdout_task.await;
    let stderr_msg = stderr_task.await.unwrap_or_default();

    if !status.success() {
        cleanup_temp_files(&cdir, &tmp_prefix).await;
        return Err(YtdlpError::ProcessFailed(if stderr_msg.is_empty() {
            format!("exit code {:?}", status.code())
        } else {
            stderr_msg
        }));
    }

    let Some(downloaded_path) = find_downloaded_temp_file(&cdir, &tmp_prefix).await else {
        cleanup_temp_files(&cdir, &tmp_prefix).await;
        return Err(YtdlpError::ProcessFailed(
            "yt-dlp completed but output video file was not found".to_string(),
        ));
    };

    if final_path.exists() {
        let _ = tokio::fs::remove_file(&final_path).await;
    }
    tokio::fs::rename(&downloaded_path, &final_path).await?;
    cleanup_temp_files(&cdir, &tmp_prefix).await;

    let file_size_bytes = tokio::fs::metadata(&final_path).await?.len();
    emit_progress(app, video_id, quality, 100.0, "ready");

    Ok(PrepareVideoResult {
        video_id: video_id.to_string(),
        quality,
        stream_url: media_server.stream_url(&filename),
        cached: false,
        file_size_bytes,
    })
}

pub fn compute_cache_stats(
    cache_dir: &Path,
    favorite_ids: &HashSet<String>,
) -> Result<CacheStats, YtdlpError> {
    if !cache_dir.exists() {
        return Ok(CacheStats {
            total_bytes: 0,
            file_count: 0,
            favorite_bytes: 0,
            temp_bytes: 0,
            cached_video_ids: Vec::new(),
        });
    }

    let mut total_bytes = 0u64;
    let mut file_count = 0usize;
    let mut favorite_bytes = 0u64;
    let mut temp_bytes = 0u64;
    let mut id_set = HashSet::new();

    for entry in std::fs::read_dir(cache_dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        let len = meta.len();
        total_bytes = total_bytes.saturating_add(len);
        file_count += 1;

        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(vid) = extract_video_id_from_cache_filename(&name) {
            id_set.insert(vid);
        }
        if let Some(vid) = extract_video_id_from_cache_artifact(&name) {
            if favorite_ids.contains(&vid) {
                favorite_bytes = favorite_bytes.saturating_add(len);
            } else {
                temp_bytes = temp_bytes.saturating_add(len);
            }
        } else {
            temp_bytes = temp_bytes.saturating_add(len);
        }
    }

    let mut cached_video_ids: Vec<String> = id_set.into_iter().collect();
    cached_video_ids.sort();

    Ok(CacheStats {
        total_bytes,
        file_count,
        favorite_bytes,
        temp_bytes,
        cached_video_ids,
    })
}

pub fn clear_cache_dir(
    cache_dir: &Path,
    favorite_ids: &HashSet<String>,
    mode: CacheClearMode,
) -> Result<CacheStats, YtdlpError> {
    if cache_dir.exists() {
        for entry in std::fs::read_dir(cache_dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let should_delete = match mode {
                CacheClearMode::All => true,
                CacheClearMode::TempOnly => match extract_video_id_from_cache_artifact(&name) {
                    Some(vid) => !favorite_ids.contains(&vid),
                    None => true,
                },
            };
            if should_delete {
                std::fs::remove_file(path)?;
            }
        }
    }

    compute_cache_stats(cache_dir, favorite_ids)
}

pub fn delete_cached_video_files(cache_dir: &Path, video_id: &str) -> Result<u64, YtdlpError> {
    if !is_valid_youtube_id(video_id) {
        return Err(YtdlpError::InvalidVideoId);
    }
    if !cache_dir.exists() {
        return Ok(0);
    }

    let mut deleted_bytes = 0u64;
    let prefix = format!("{video_id}_");
    for entry in std::fs::read_dir(cache_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) {
            let len = entry.metadata()?.len();
            std::fs::remove_file(path)?;
            deleted_bytes = deleted_bytes.saturating_add(len);
        }
    }

    Ok(deleted_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validates_youtube_ids_and_cache_filenames() {
        assert!(is_valid_youtube_id("dQw4w9WgXcQ"));
        assert!(is_valid_youtube_id("abcDEF_12-3"));
        assert!(!is_valid_youtube_id("short"));
        assert!(!is_valid_youtube_id("too_long_video_id"));
        assert!(!is_valid_youtube_id("invalid!char"));

        assert_eq!(
            cache_filename("dQw4w9WgXcQ", VideoQuality::Q720p).unwrap(),
            "dQw4w9WgXcQ_720p.mp4"
        );
        assert!(matches!(
            cache_filename("../evil", VideoQuality::Q720p),
            Err(YtdlpError::InvalidVideoId)
        ));

        assert_eq!(
            extract_video_id_from_cache_filename("dQw4w9WgXcQ_1080p.mp4"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_video_id_from_cache_filename("dQw4w9WgXcQ_720p.tmp.mp4"),
            None
        );
        assert_eq!(
            extract_video_id_from_cache_filename("dQw4w9WgXcQ_waveform.json"),
            None
        );
        assert_eq!(
            extract_video_id_from_cache_artifact("dQw4w9WgXcQ_waveform.json"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_video_id_from_cache_artifact("short_waveform.json"),
            None
        );
    }

    #[test]
    fn parses_ytdlp_progress_lines() {
        assert_eq!(
            parse_ytdlp_progress_line("[download]  42.3% of ~15.20MiB at 2.10MiB/s ETA 00:04"),
            Some(42.3)
        );
        assert_eq!(
            parse_ytdlp_progress_line("[download] 100% of 10.00MiB in 00:03"),
            Some(100.0)
        );
        assert_eq!(
            parse_ytdlp_progress_line("[download]   0.0% of 5.00MiB at Unknown B/s"),
            Some(0.0)
        );
        assert_eq!(
            parse_ytdlp_progress_line("[Merger] Merging formats into \"video.mp4\""),
            None
        );
        assert_eq!(parse_ytdlp_progress_line(""), None);
    }

    #[test]
    fn computes_and_clears_cache_preserving_favorites_in_temp_only_mode() {
        let dir = tempdir().unwrap();
        let cdir = dir.path();

        let fav_id = "favVideo123";
        let temp_id = "tmpVideo456";

        std::fs::write(cdir.join(format!("{fav_id}_720p.mp4")), vec![1u8; 100]).unwrap();
        std::fs::write(cdir.join(format!("{fav_id}_waveform.json")), vec![5u8; 40]).unwrap();
        std::fs::write(cdir.join(format!("{temp_id}_480p.mp4")), vec![2u8; 250]).unwrap();
        std::fs::write(cdir.join(format!("{temp_id}_waveform.json")), vec![6u8; 30]).unwrap();
        std::fs::write(cdir.join(format!("{temp_id}_720p.tmp.mp4.part")), vec![3u8; 50]).unwrap();

        let favorites = HashSet::from([fav_id.to_string()]);
        let stats = compute_cache_stats(cdir, &favorites).unwrap();
        assert_eq!(stats.total_bytes, 470);
        assert_eq!(stats.file_count, 5);
        assert_eq!(stats.favorite_bytes, 140);
        assert_eq!(stats.temp_bytes, 330);
        assert_eq!(
            stats.cached_video_ids,
            vec![fav_id.to_string(), temp_id.to_string()]
        );

        let after_temp = clear_cache_dir(cdir, &favorites, CacheClearMode::TempOnly).unwrap();
        assert_eq!(after_temp.total_bytes, 140);
        assert_eq!(after_temp.file_count, 2);
        assert_eq!(after_temp.favorite_bytes, 140);
        assert_eq!(after_temp.temp_bytes, 0);
        assert_eq!(after_temp.cached_video_ids, vec![fav_id.to_string()]);
        assert!(cdir.join(format!("{fav_id}_waveform.json")).is_file());
        assert!(!cdir.join(format!("{temp_id}_waveform.json")).exists());

        // Add another quality for fav_id and delete only fav_id
        std::fs::write(cdir.join(format!("{fav_id}_1080p.mp4")), vec![4u8; 80]).unwrap();
        let removed = delete_cached_video_files(cdir, fav_id).unwrap();
        assert_eq!(removed, 220);

        std::fs::write(cdir.join(format!("{fav_id}_720p.mp4")), vec![1u8; 100]).unwrap();
        let after_all = clear_cache_dir(cdir, &favorites, CacheClearMode::All).unwrap();
        assert_eq!(after_all.total_bytes, 0);
        assert_eq!(after_all.file_count, 0);
        assert!(after_all.cached_video_ids.is_empty());
    }
}
