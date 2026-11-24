import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AppInfo,
  BinariesStatus,
  CacheClearMode,
  CacheStats,
  DownloadProgress,
  PrepareVideoResult,
  VideoMetadata,
  VideoQuality,
} from '../types';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('get_app_info');
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

export async function onDownloadProgress(
  handler: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>('download-progress', (event) => {
    handler(event.payload);
  });
}
