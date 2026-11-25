use crate::storage::{self, VideoQuality};
use crate::ytdlp::{
    cache_dir, cache_filename, configure_hidden_command, find_binary, is_valid_youtube_id,
    YtdlpError,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

pub const TARGET_BINS: usize = 4000;
const MAX_BLOCKS: usize = TARGET_BINS * 2;
const NOISE_FLOOR: f32 = 512.0;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    pub video_id: String,
    pub bins: usize,
    pub peaks: Vec<f32>,
    pub rms: Vec<f32>,
}

#[derive(Debug, Clone, Copy)]
struct BlockStats {
    peak: f32,
    sum_sq: f64,
    count: u64,
}

#[derive(Debug)]
pub struct WaveformAccumulator {
    blocks: Vec<BlockStats>,
    samples_per_block: usize,
    current_peak: f32,
    current_sum_sq: f64,
    current_count: usize,
    pending_byte: Option<u8>,
}

impl Default for WaveformAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

impl WaveformAccumulator {
    pub fn new() -> Self {
        Self {
            blocks: Vec::with_capacity(MAX_BLOCKS),
            samples_per_block: 1,
            current_peak: 0.0,
            current_sum_sq: 0.0,
            current_count: 0,
            pending_byte: None,
        }
    }

    pub fn push_s16le_bytes(&mut self, bytes: &[u8]) {
        let mut idx = 0;
        if let Some(prev) = self.pending_byte.take() {
            if let Some(&first) = bytes.first() {
                let sample = i16::from_le_bytes([prev, first]);
                self.push_sample(sample);
                idx = 1;
            } else {
                self.pending_byte = Some(prev);
                return;
            }
        }

        while idx + 1 < bytes.len() {
            let sample = i16::from_le_bytes([bytes[idx], bytes[idx + 1]]);
            self.push_sample(sample);
            idx += 2;
        }

        if idx < bytes.len() {
            self.pending_byte = Some(bytes[idx]);
        }
    }

    pub fn push_sample(&mut self, sample: i16) {
        let val = sample as f64;
        self.current_peak = self.current_peak.max((sample as f32).abs());
        self.current_sum_sq += val * val;
        self.current_count += 1;

        if self.current_count >= self.samples_per_block {
            self.blocks.push(BlockStats {
                peak: self.current_peak,
                sum_sq: self.current_sum_sq,
                count: self.current_count as u64,
            });
            self.current_peak = 0.0;
            self.current_sum_sq = 0.0;
            self.current_count = 0;

            if self.blocks.len() >= MAX_BLOCKS {
                self.merge_pairs();
            }
        }
    }

    fn merge_pairs(&mut self) {
        let mut merged = Vec::with_capacity(self.blocks.len().div_ceil(2) + 1);
        let mut i = 0;
        while i < self.blocks.len() {
            if i + 1 < self.blocks.len() {
                let a = self.blocks[i];
                let b = self.blocks[i + 1];
                merged.push(BlockStats {
                    peak: a.peak.max(b.peak),
                    sum_sq: a.sum_sq + b.sum_sq,
                    count: a.count + b.count,
                });
                i += 2;
            } else {
                merged.push(self.blocks[i]);
                i += 1;
            }
        }
        self.blocks = merged;
        self.samples_per_block = self.samples_per_block.saturating_mul(2);
    }

    pub fn finalize(mut self, video_id: &str) -> WaveformData {
        if self.current_count > 0 {
            self.blocks.push(BlockStats {
                peak: self.current_peak,
                sum_sq: self.current_sum_sq,
                count: self.current_count as u64,
            });
        }

        let n = self.blocks.len();
        if n == 0 {
            return WaveformData {
                video_id: video_id.to_string(),
                bins: 0,
                peaks: Vec::new(),
                rms: Vec::new(),
            };
        }

        let out_bins = n.min(TARGET_BINS);
        let mut raw_peaks = Vec::with_capacity(out_bins);
        let mut raw_rms = Vec::with_capacity(out_bins);
        let mut max_peak = 0.0_f32;

        for i in 0..out_bins {
            let start = i * n / out_bins;
            let end = ((i + 1) * n / out_bins).max(start + 1).min(n);

            let mut bin_peak = 0.0_f32;
            let mut bin_sum_sq = 0.0_f64;
            let mut bin_count = 0_u64;

            for blk in &self.blocks[start..end] {
                bin_peak = bin_peak.max(blk.peak);
                bin_sum_sq += blk.sum_sq;
                bin_count += blk.count;
            }

            let rms_val = if bin_count > 0 {
                (bin_sum_sq / (bin_count as f64)).sqrt() as f32
            } else {
                0.0
            };

            max_peak = max_peak.max(bin_peak);
            raw_peaks.push(bin_peak);
            raw_rms.push(rms_val);
        }

        let denom = max_peak.max(NOISE_FLOOR);
        let peaks = raw_peaks
            .into_iter()
            .map(|p| round_to_thousandth((p / denom).clamp(0.0, 1.0)))
            .collect();
        let rms = raw_rms
            .into_iter()
            .map(|r| round_to_thousandth((r / denom).clamp(0.0, 1.0)))
            .collect();

        WaveformData {
            video_id: video_id.to_string(),
            bins: out_bins,
            peaks,
            rms,
        }
    }
}

fn round_to_thousandth(v: f32) -> f32 {
    if !v.is_finite() {
        return 0.0;
    }
    (v * 1000.0).round() / 1000.0
}

pub fn waveform_cache_path(cache_dir: &Path, video_id: &str) -> Result<PathBuf, YtdlpError> {
    if !is_valid_youtube_id(video_id) {
        return Err(YtdlpError::InvalidVideoId);
    }
    Ok(cache_dir.join(format!("{video_id}_waveform.json")))
}

fn find_cached_video_for_waveform(
    cache_dir: &Path,
    video_id: &str,
    preferred: VideoQuality,
) -> Option<PathBuf> {
    let candidates = [
        preferred,
        VideoQuality::Q720p,
        VideoQuality::Q480p,
        VideoQuality::Q1080p,
    ];

    for quality in candidates {
        if let Ok(filename) = cache_filename(video_id, quality) {
            let path = cache_dir.join(filename);
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.is_file() && meta.len() > 0 {
                    return Some(path);
                }
            }
        }
    }

    None
}

pub async fn generate_or_load_waveform(
    data_dir: &Path,
    video_id: &str,
    quality: VideoQuality,
) -> Result<Option<WaveformData>, YtdlpError> {
    let cdir = cache_dir(data_dir);
    let cache_path = waveform_cache_path(&cdir, video_id)?;

    if let Ok(bytes) = tokio::fs::read(&cache_path).await {
        if let Ok(cached) = serde_json::from_slice::<WaveformData>(&bytes) {
            if cached.bins > 0
                && cached.peaks.len() == cached.bins
                && cached.rms.len() == cached.bins
            {
                return Ok(Some(cached));
            }
        }
    }

    let Some(mp4_path) = find_cached_video_for_waveform(&cdir, video_id, quality) else {
        return Ok(None);
    };
    let Some(ffmpeg_path) = find_binary(data_dir, "ffmpeg.exe") else {
        return Ok(None);
    };

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(["-v", "error", "-nostdin", "-i"])
        .arg(&mp4_path)
        .args(["-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_hidden_command(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill().await;
        return Ok(None);
    };

    let mut acc = WaveformAccumulator::new();
    let mut buf = [0u8; 32 * 1024];
    loop {
        match stdout.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => acc.push_s16le_bytes(&buf[..n]),
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Ok(None);
            }
        }
    }

    let Ok(status) = child.wait().await else {
        return Ok(None);
    };
    if !status.success() {
        return Ok(None);
    }

    let data = acc.finalize(video_id);
    if data.bins == 0 {
        return Ok(None);
    }

    let _ = storage::atomic_write_json(&cache_path, &data);
    Ok(Some(data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn silence_produces_zero_bins_above_noise_floor() {
        let mut acc = WaveformAccumulator::new();
        for _ in 0..8000 {
            acc.push_sample(0);
        }
        let wf = acc.finalize("dQw4w9WgXcQ");
        assert_eq!(wf.bins, TARGET_BINS);
        assert!(wf.peaks.iter().all(|&v| v == 0.0));
        assert!(wf.rms.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn localized_burst_appears_at_expected_bin_and_normalizes_to_one() {
        let mut acc = WaveformAccumulator::new();
        let total_samples = 4000usize;
        for i in 0..total_samples {
            let sample = if (1990..2010).contains(&i) {
                20_000
            } else {
                200
            };
            acc.push_sample(sample);
        }
        let wf = acc.finalize("dQw4w9WgXcQ");
        assert_eq!(wf.bins, TARGET_BINS);
        assert_eq!(wf.peaks[2000], 1.0);
        assert!(wf.peaks[100] < 0.05);
        assert!(wf.peaks.iter().zip(wf.rms.iter()).all(|(p, r)| r <= p));
    }

    #[test]
    fn handles_odd_chunk_splits_identically_to_single_buffer() {
        let samples: Vec<i16> = (0..5000)
            .map(|i| {
                if i == 123 {
                    i16::MIN
                } else {
                    (((i * 97) % 40_000) as i32 - 20_000) as i16
                }
            })
            .collect();

        let mut raw = Vec::with_capacity(samples.len() * 2);
        for s in samples {
            raw.extend_from_slice(&s.to_le_bytes());
        }

        let mut whole = WaveformAccumulator::new();
        whole.push_s16le_bytes(&raw);
        let wf_whole = whole.finalize("dQw4w9WgXcQ");

        let mut chunked = WaveformAccumulator::new();
        let pattern = [1usize, 3, 7, 2, 5];
        let mut pos = 0;
        let mut p_idx = 0;
        while pos < raw.len() {
            let size = pattern[p_idx % pattern.len()].min(raw.len() - pos);
            chunked.push_s16le_bytes(&raw[pos..pos + size]);
            pos += size;
            p_idx += 1;
        }
        let wf_chunked = chunked.finalize("dQw4w9WgXcQ");

        assert_eq!(wf_whole, wf_chunked);
    }

    #[test]
    fn compacts_long_streams_with_bounded_memory() {
        let mut acc = WaveformAccumulator::new();
        let total_samples = 200_000usize;
        for i in 0..total_samples {
            if i == 100_000 {
                acc.push_sample(30_000);
            } else {
                acc.push_sample(600);
            }
        }
        assert!(acc.blocks.len() < MAX_BLOCKS);
        assert!(acc.samples_per_block > 1);

        let wf = acc.finalize("dQw4w9WgXcQ");
        assert_eq!(wf.bins, TARGET_BINS);
        assert_eq!(wf.peaks.len(), TARGET_BINS);
        assert_eq!(wf.rms.len(), TARGET_BINS);

        let max_bin = wf
            .peaks
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(idx, val)| (idx, *val))
            .unwrap();
        assert_eq!(max_bin.1, 1.0);
        assert!((max_bin.0 as i32 - (TARGET_BINS as i32 / 2)).abs() <= 2);
    }

    #[test]
    fn validates_waveform_cache_path_and_roundtrips_json() {
        let dir = tempdir().unwrap();
        assert!(matches!(
            waveform_cache_path(dir.path(), "../bad"),
            Err(YtdlpError::InvalidVideoId)
        ));

        let path = waveform_cache_path(dir.path(), "dQw4w9WgXcQ").unwrap();
        assert_eq!(
            path.file_name().and_then(|s| s.to_str()),
            Some("dQw4w9WgXcQ_waveform.json")
        );

        let data = WaveformData {
            video_id: "dQw4w9WgXcQ".to_string(),
            bins: 3,
            peaks: vec![0.1, 0.9, 0.4],
            rms: vec![0.05, 0.6, 0.2],
        };
        storage::atomic_write_json(&path, &data).unwrap();
        let loaded: WaveformData = storage::read_json_or_default(&path).unwrap();
        assert_eq!(loaded, data);
    }
}
