import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearCache,
  deleteCachedVideo,
  exportLibraryToPath,
  getCacheStats,
  importLibraryFromPath,
  loadLibrary,
  pickExportLibraryPath,
  pickImportLibraryPath,
  saveLibrary,
} from '../lib/api';
import {
  addLoopToSong,
  createLoopSegment,
  createSongFromMetadata,
  findSongByYoutubeId,
  removeLoopFromSong,
  removeSong,
  renameSong,
  touchSongLastPlayed,
  updateLoopInSong,
  upsertSong,
} from '../lib/library';
import type {
  CacheClearMode,
  CacheStats,
  ImportLibraryResult,
  ImportMode,
  LibraryData,
  LoopSegment,
  Song,
  VideoMetadata,
} from '../types';

export interface ExportBackupOutcome {
  cancelled: boolean;
  count?: number;
  error?: string;
}

export interface ImportBackupOutcome {
  cancelled: boolean;
  result?: ImportLibraryResult;
  error?: string;
}

const EMPTY_LIBRARY: LibraryData = {
  schemaVersion: 1,
  songs: [],
};

/**
 * Manages persisted favorite songs, named loops, cache statistics, and JSON backups.
 */
export function useLibrary(inTauri: boolean) {
  const [library, setLibrary] = useState<LibraryData>(EMPTY_LIBRARY);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const libraryRef = useRef<LibraryData>(library);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;

    Promise.all([loadLibrary(), getCacheStats()])
      .then(([loadedLib, stats]) => {
        if (cancelled) return;
        libraryRef.current = loadedLib;
        setLibrary(loadedLib);
        setCacheStats(stats);
      })
      .catch((err) => {
        if (cancelled) return;
        setLibraryError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [inTauri]);

  const flushPendingSaves = useCallback(async () => {
    await saveQueueRef.current;
  }, []);

  const commitLibrary = useCallback(
    (updater: (prev: LibraryData) => LibraryData): LibraryData => {
      const next = updater(libraryRef.current);
      libraryRef.current = next;
      setLibrary(next);

      if (inTauri) {
        saveQueueRef.current = saveQueueRef.current
          .then(() => saveLibrary(next))
          .catch((err) => {
            setLibraryError(err instanceof Error ? err.message : String(err));
          });
      }

      return next;
    },
    [inTauri],
  );

  const refreshCacheStats = useCallback(async (): Promise<CacheStats | null> => {
    if (!inTauri) return null;
    await flushPendingSaves();
    try {
      const stats = await getCacheStats();
      setCacheStats(stats);
      return stats;
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [inTauri, flushPendingSaves]);

  const saveFavorite = useCallback(
    (meta: VideoMetadata, customTitle?: string): Song => {
      const existing = findSongByYoutubeId(libraryRef.current, meta.youtubeId);
      if (existing) {
        const trimmed = customTitle?.trim();
        if (trimmed && trimmed !== existing.title) {
          const updated = commitLibrary((prev) =>
            renameSong(prev, existing.id, trimmed),
          );
          return findSongByYoutubeId(updated, meta.youtubeId) ?? existing;
        }
        return existing;
      }

      const song = createSongFromMetadata(meta, customTitle);
      commitLibrary((prev) => upsertSong(prev, song));
      void refreshCacheStats();
      return song;
    },
    [commitLibrary, refreshCacheStats],
  );

  const renameFavorite = useCallback(
    (songId: string, title: string) => {
      commitLibrary((prev) => renameSong(prev, songId, title));
    },
    [commitLibrary],
  );

  const deleteFavorite = useCallback(
    async (songId: string, deleteCacheFile: boolean) => {
      const target = libraryRef.current.songs.find((s) => s.id === songId);
      const youtubeId = target?.youtubeId;

      commitLibrary((prev) => removeSong(prev, songId));
      await flushPendingSaves();

      if (deleteCacheFile && inTauri && youtubeId) {
        try {
          await deleteCachedVideo(youtubeId);
        } catch (err) {
          setLibraryError(err instanceof Error ? err.message : String(err));
        }
      }

      await refreshCacheStats();
    },
    [commitLibrary, flushPendingSaves, inTauri, refreshCacheStats],
  );

  const markSongPlayed = useCallback(
    (songId: string, durationSec?: number) => {
      commitLibrary((prev) =>
        touchSongLastPlayed(prev, songId, new Date().toISOString(), durationSec),
      );
    },
    [commitLibrary],
  );

  const addLoop = useCallback(
    (
      songId: string,
      name: string,
      startSec: number,
      endSec: number,
      durationSec: number,
    ): LoopSegment => {
      const existingLoops =
        libraryRef.current.songs.find((s) => s.id === songId)?.loops ?? [];
      const loop = createLoopSegment(
        name,
        startSec,
        endSec,
        durationSec,
        existingLoops.length + 1,
      );
      commitLibrary((prev) => addLoopToSong(prev, songId, loop));
      return loop;
    },
    [commitLibrary],
  );

  const updateLoop = useCallback(
    (
      songId: string,
      loopId: string,
      patch: Partial<Pick<LoopSegment, 'name' | 'startSec' | 'endSec'>>,
    ) => {
      commitLibrary((prev) => updateLoopInSong(prev, songId, loopId, patch));
    },
    [commitLibrary],
  );

  const deleteLoop = useCallback(
    (songId: string, loopId: string) => {
      commitLibrary((prev) => removeLoopFromSong(prev, songId, loopId));
    },
    [commitLibrary],
  );

  const exportBackup = useCallback(async (): Promise<ExportBackupOutcome> => {
    if (!inTauri) {
      return {
        cancelled: false,
        error: 'Експорт JSON доступний у десктопному вікні Tauri.',
      };
    }

    try {
      await flushPendingSaves();
      const targetPath = await pickExportLibraryPath();
      if (!targetPath) {
        return { cancelled: true };
      }
      const count = await exportLibraryToPath(targetPath);
      return { cancelled: false, count };
    } catch (err) {
      return {
        cancelled: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [inTauri, flushPendingSaves]);

  const importBackup = useCallback(
    async (mode: ImportMode): Promise<ImportBackupOutcome> => {
      if (!inTauri) {
        return {
          cancelled: false,
          error: 'Імпорт JSON доступний у десктопному вікні Tauri.',
        };
      }

      try {
        await flushPendingSaves();
        const sourcePath = await pickImportLibraryPath();
        if (!sourcePath) {
          return { cancelled: true };
        }
        const result = await importLibraryFromPath(sourcePath, mode);
        libraryRef.current = result.library;
        setLibrary(result.library);
        await refreshCacheStats();
        return { cancelled: false, result };
      } catch (err) {
        return {
          cancelled: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [inTauri, flushPendingSaves, refreshCacheStats],
  );

  const runClearCache = useCallback(
    async (mode: CacheClearMode): Promise<CacheStats | null> => {
      if (!inTauri) return null;
      await flushPendingSaves();
      const stats = await clearCache(mode);
      setCacheStats(stats);
      return stats;
    },
    [inTauri, flushPendingSaves],
  );

  return {
    library,
    cacheStats,
    libraryError,
    clearLibraryError: () => setLibraryError(null),
    refreshCacheStats,
    saveFavorite,
    renameFavorite,
    deleteFavorite,
    markSongPlayed,
    addLoop,
    updateLoop,
    deleteLoop,
    exportBackup,
    importBackup,
    runClearCache,
  };
}
