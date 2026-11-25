pub mod media_server;
pub mod storage;
pub mod waveform;
pub mod ytdlp;

use media_server::MediaServer;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use storage::{AppSettings, ImportLibraryResult, ImportMode, LibraryData, VideoQuality};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use waveform::WaveformData;
use ytdlp::{
    BinariesStatus, CacheClearMode, CacheStats, DownloadManager, PrepareVideoResult,
    VideoMetadata,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
}

pub struct AppState {
    pub media_server: Arc<MediaServer>,
    pub downloads: DownloadManager,
    pub storage_lock: Mutex<()>,
}

fn load_favorite_ids(data_dir: &Path) -> Result<HashSet<String>, String> {
    let lib = storage::load_library(data_dir).map_err(|e| e.to_string())?;
    Ok(lib.songs.into_iter().map(|s| s.youtube_id).collect())
}

#[tauri::command]
fn get_app_info() -> Result<AppInfo, String> {
    let data_dir = storage::app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())?;

    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir,
    })
}

#[tauri::command]
async fn load_library(state: State<'_, AppState>) -> Result<LibraryData, String> {
    let _guard = state.storage_lock.lock().await;
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    storage::load_library(&data_dir).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_library(state: State<'_, AppState>, library: LibraryData) -> Result<(), String> {
    let _guard = state.storage_lock.lock().await;
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    storage::save_library(&data_dir, &library).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let _guard = state.storage_lock.lock().await;
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    storage::load_settings(&data_dir).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    let _guard = state.storage_lock.lock().await;
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    storage::save_settings(&data_dir, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_library(state: State<'_, AppState>, target_path: String) -> Result<usize, String> {
    let _guard = state.storage_lock.lock().await;
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    storage::export_library_to_file(&data_dir, Path::new(&target_path)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_library_file(
    state: State<'_, AppState>,
    source_path: String,
    mode: ImportMode,
) -> Result<ImportLibraryResult, String> {
    let _guard = state.storage_lock.lock().await;
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    storage::import_library_from_file(&data_dir, PathBuf::from(source_path).as_path(), mode)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_binaries() -> Result<BinariesStatus, String> {
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    Ok(ytdlp::check_binaries(&data_dir).await)
}

#[tauri::command]
async fn update_ytdlp() -> Result<BinariesStatus, String> {
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    ytdlp::download_ytdlp_binary(&data_dir)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ytdlp::check_binaries(&data_dir).await)
}

#[tauri::command]
async fn fetch_video_metadata(url: String) -> Result<VideoMetadata, String> {
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    ytdlp::fetch_video_metadata(&data_dir, &url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn prepare_video(
    app: AppHandle,
    state: State<'_, AppState>,
    video_id: String,
    quality: VideoQuality,
) -> Result<PrepareVideoResult, String> {
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    ytdlp::prepare_video(
        &app,
        &data_dir,
        &state.media_server,
        &state.downloads,
        &video_id,
        quality,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_download(state: State<'_, AppState>, video_id: String) -> Result<bool, String> {
    Ok(state.downloads.cancel(&video_id).await)
}

#[tauri::command]
async fn get_cache_stats() -> Result<CacheStats, String> {
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    let favorites = load_favorite_ids(&data_dir)?;
    let cdir = ytdlp::cache_dir(&data_dir);
    ytdlp::compute_cache_stats(&cdir, &favorites).map_err(|e| e.to_string())
}

#[tauri::command]
async fn clear_cache(mode: CacheClearMode) -> Result<CacheStats, String> {
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    let favorites = load_favorite_ids(&data_dir)?;
    let cdir = ytdlp::cache_dir(&data_dir);
    ytdlp::clear_cache_dir(&cdir, &favorites, mode).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_cached_video(video_id: String) -> Result<u64, String> {
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    let cdir = ytdlp::cache_dir(&data_dir);
    ytdlp::delete_cached_video_files(&cdir, &video_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_video_waveform(
    video_id: String,
    quality: VideoQuality,
) -> Result<Option<WaveformData>, String> {
    let data_dir = storage::app_data_dir().map_err(|e| e.to_string())?;
    waveform::generate_or_load_waveform(&data_dir, &video_id, quality)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .setup(|app| {
            let data_dir = storage::app_data_dir()?;
            let cdir = ytdlp::cache_dir(&data_dir);
            let media_server = tauri::async_runtime::block_on(MediaServer::start(cdir))?;
            app.manage(AppState {
                media_server: Arc::new(media_server),
                downloads: DownloadManager::default(),
                storage_lock: Mutex::new(()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            load_library,
            save_library,
            load_settings,
            save_settings,
            export_library,
            import_library_file,
            check_binaries,
            update_ytdlp,
            fetch_video_metadata,
            prepare_video,
            cancel_download,
            get_cache_stats,
            clear_cache,
            delete_cached_video,
            get_video_waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
