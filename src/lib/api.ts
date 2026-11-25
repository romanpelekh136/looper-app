import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import type {
  AppInfo,
  AppSettings,
  BinariesStatus,
  CacheClearMode,
  CacheStats,
  DownloadProgress,
  ImportLibraryResult,
  ImportMode,
  LibraryData,
  PrepareVideoResult,
  VideoMetadata,
  VideoQuality,
  WaveformData,
} from '../types';

export function isTauriRuntime(): boolean {
  return isTauri() || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('get_app_info');
}

export async function loadLibrary(): Promise<LibraryData> {
  return invoke<LibraryData>('load_library');
}

export async function saveLibrary(library: LibraryData): Promise<void> {
  return invoke<void>('save_library', { library });
}

export async function loadSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('load_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('save_settings', { settings });
}

export async function exportLibraryToPath(targetPath: string): Promise<number> {
  return invoke<number>('export_library', { targetPath });
}

export async function importLibraryFromPath(
  sourcePath: string,
  mode: ImportMode,
): Promise<ImportLibraryResult> {
  return invoke<ImportLibraryResult>('import_library_file', {
    sourcePath,
    mode,
  });
}

export async function pickExportLibraryPath(): Promise<string | null> {
  const selected = await save({
    title: 'Export Library (JSON)',
    defaultPath: 'guitar-looper-library.json',
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
  });
  return selected ?? null;
}

export async function pickImportLibraryPath(): Promise<string | null> {
  const selected = await open({
    title: 'Import Library (JSON)',
    multiple: false,
    directory: false,
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
  });
  if (Array.isArray(selected)) {
    return selected[0] ?? null;
  }
  return selected ?? null;
}

export async function checkBinaries(): Promise<BinariesStatus> {
  return invoke<BinariesStatus>('check_binaries');
}

export async function updateYtdlp(): Promise<BinariesStatus> {
  return invoke<BinariesStatus>('update_ytdlp');
}

export async function fetchVideoMetadata(url: string): Promise<VideoMetadata> {
  return invoke<VideoMetadata>('fetch_video_metadata', { url });
}

export async function prepareVideo(
  videoId: string,
  quality: VideoQuality,
): Promise<PrepareVideoResult> {
  return invoke<PrepareVideoResult>('prepare_video', { videoId, quality });
}

export async function cancelDownload(videoId: string): Promise<boolean> {
  return invoke<boolean>('cancel_download', { videoId });
}

export async function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>('get_cache_stats');
}

export async function clearCache(mode: CacheClearMode): Promise<CacheStats> {
  return invoke<CacheStats>('clear_cache', { mode });
}

export async function deleteCachedVideo(videoId: string): Promise<number> {
  return invoke<number>('delete_cached_video', { videoId });
}

export async function getVideoWaveform(
  videoId: string,
  quality: VideoQuality,
): Promise<WaveformData | null> {
  return invoke<WaveformData | null>('get_video_waveform', { videoId, quality });
}

export async function onDownloadProgress(
  handler: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>('download-progress', (event) => {
    handler(event.payload);
  });
}
