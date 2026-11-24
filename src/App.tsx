import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Music2, Settings, Trash2, X, Youtube } from 'lucide-react';
import { AbControls } from './components/AbControls';
import { LibrarySidebar } from './components/LibrarySidebar';
import { LoopsPanel } from './components/LoopsPanel';
import { MetronomeControls } from './components/MetronomeControls';
import { SettingsModal } from './components/SettingsModal';
import { VideoPlayer } from './components/VideoPlayer';
import { useAbLoop } from './hooks/useAbLoop';
import { useLibrary } from './hooks/useLibrary';
import { useMetronome } from './hooks/useMetronome';
import {
  cancelDownload,
  fetchVideoMetadata,
  getAppInfo,
  isTauriRuntime,
  loadSettings,
  onDownloadProgress,
  prepareVideo,
  saveSettings,
  updateYtdlp,
} from './lib/api';
import { findSongByYoutubeId, getSongLoopEdges } from './lib/library';
import { normalizeLoopBounds, type LoopBounds } from './lib/loopBounds';
import { canonicalYouTubeUrl, parseYouTubeUrl } from './lib/youtube';
import {
  DEFAULT_SETTINGS,
  type AppInfo,
  type AppSettings,
  type CacheClearMode,
  type DownloadProgress,
  type ImportMode,
  type LoopSegment,
  type Song,
  type VideoMetadata,
  type VideoQuality,
} from './types';

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'email',
  'password',
  'number',
  'tel',
]);

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has((target.type || 'text').toLowerCase());
  }
  return false;
}

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingBoundsRef = useRef<LoopBounds | null>(null);
  const activeVideoIdRef = useRef<string | null>(null);
  const settingsLoadedRef = useRef(false);

  const [inTauri] = useState(() => isTauriRuntime());
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [urlInput, setUrlInput] = useState('');
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loadedQuality, setLoadedQuality] = useState<VideoQuality>(
    DEFAULT_SETTINGS.videoQuality,
  );
  const [cached, setCached] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUpdatingYtdlp, setIsUpdatingYtdlp] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolume] = useState(DEFAULT_SETTINGS.volume);
  const [isMuted, setIsMuted] = useState(false);

  const [bounds, setBounds] = useState<LoopBounds>({ startSec: 0, endSec: 0 });
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [activeLoopId, setActiveLoopId] = useState<string | null>(null);

  const [metroEnabled, setMetroEnabled] = useState(false);
  const [metroBpm, setMetroBpm] = useState(120);
  const [metroVolume, setMetroVolume] = useState(0.7);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocusSection, setSettingsFocusSection] = useState<'backup' | null>(null);
  const [backupNotice, setBackupNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Song | null>(null);
  const [deleteWithCache, setDeleteWithCache] = useState(false);

  const {
    library,
    cacheStats,
    libraryError,
    clearLibraryError,
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
  } = useLibrary(inTauri);

  const activeSong = useMemo(
    () =>
      metadata
        ? (findSongByYoutubeId(library, metadata.youtubeId) ?? null)
        : null,
    [library, metadata],
  );

  const savedLoopEdges = useMemo(
    () => getSongLoopEdges(activeSong),
    [activeSong],
  );

  const cachedVideoIdSet = useMemo(
    () => new Set(cacheStats?.cachedVideoIds ?? []),
    [cacheStats],
  );

  useEffect(() => {
    if (!inTauri) return;
    getAppInfo()
      .then(setAppInfo)
      .catch(() => {});
    loadSettings()
      .then((loaded) => {
        settingsLoadedRef.current = true;
        setSettings(loaded);
        setVolume(loaded.volume);
        setLoadedQuality(loaded.videoQuality);
      })
      .catch(() => {
        settingsLoadedRef.current = true;
      });
  }, [inTauri]);

  useEffect(() => {
    if (!inTauri || !settingsLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      setSettings((prev) => {
        if (Math.abs(prev.volume - volume) < 0.005) return prev;
        const next = { ...prev, volume };
        void saveSettings(next).catch(() => {});
        return next;
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [volume, inTauri]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = isMuted ? 0 : volume;
    video.muted = isMuted;
  }, [volume, isMuted, streamUrl]);

  const { jumpToA, seekTo } = useAbLoop({
    videoRef,
    bounds,
    durationSec,
    loopEnabled,
    playbackRate,
    onTimeUpdate: setCurrentTime,
  });

  useMetronome({
    enabled: metroEnabled,
    bpm: metroBpm,
    volume: metroVolume,
  });

  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;
    if (video.paused) {
      if (
        loopEnabled &&
        durationSec > 0 &&
        (video.currentTime >= bounds.endSec || video.currentTime < bounds.startSec)
      ) {
        video.currentTime = bounds.startSec;
      }
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [streamUrl, loopEnabled, durationSec, bounds]);

  // Only Space (Play/Pause) hotkey in window focus, disabled while modals are open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (settingsOpen || deleteTarget !== null) return;
      if (e.code !== 'Space') return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (isEditableElement(e.target) || isEditableElement(document.activeElement)) {
        return;
      }
      e.preventDefault();
      handleTogglePlay();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlay, settingsOpen, deleteTarget]);

  // Close delete modal on Escape
  useEffect(() => {
    if (!deleteTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDeleteTarget(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget]);

  const loadPreparedVideo = async (
    meta: VideoMetadata,
    startSec?: number,
    favoriteSongId?: string,
  ) => {
    if (activeVideoIdRef.current && isLoading) {
      void cancelDownload(activeVideoIdRef.current).catch(() => {});
    }

    activeVideoIdRef.current = meta.youtubeId;
    setIsLoading(true);
    setLoadError(null);
    setProgress({
      videoId: meta.youtubeId,
      quality: settings.videoQuality,
      percent: 0,
      stage: 'downloading',
    });

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await onDownloadProgress((p) => {
        if (p.videoId === meta.youtubeId) {
          setProgress(p);
        }
      });

      const prepared = await prepareVideo(meta.youtubeId, settings.videoQuality);
      const initialDur = meta.durationSec > 0 ? meta.durationSec : 0;
      const clampedStart =
        startSec !== undefined && initialDur > 0
          ? Math.min(Math.max(startSec, 0), initialDur)
          : (startSec ?? 0);

      pendingBoundsRef.current = null;
      pendingSeekRef.current = startSec ?? null;
      setMetadata(meta);
      setLoadedQuality(settings.videoQuality);
      setCached(prepared.cached);
      setDurationSec(initialDur);
      const resetBounds = normalizeLoopBounds(0, initialDur, initialDur);
      setBounds(resetBounds);
      setLoopEnabled(false);
      setActiveLoopId(null);
      setIsPlaying(false);

      if (prepared.streamUrl === streamUrl) {
        seekTo(clampedStart);
        pendingSeekRef.current = null;
      } else {
        setStreamUrl(prepared.streamUrl);
        setCurrentTime(clampedStart);
      }

      const favId =
        favoriteSongId ?? findSongByYoutubeId(library, meta.youtubeId)?.id;
      if (favId) {
        markSongPlayed(favId);
      }
      void refreshCacheStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes('cancelled')) {
        setLoadError(`Помилка завантаження: ${message}`);
      }
    } finally {
      if (unlisten) unlisten();
      setIsLoading(false);
      setProgress(null);
    }
  };

  const handleLoadUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadError(null);

    const parsed = parseYouTubeUrl(urlInput);
    if (!parsed) {
      setLoadError(
        'Невалідне посилання YouTube. Підтримуються youtube.com/watch?v=..., youtu.be/... та shorts/.',
      );
      return;
    }

    if (!inTauri) {
      setLoadError(
        `Розпізнано ID "${parsed.videoId}". Завантаження працює у десктопному вікні Tauri (npm.cmd run tauri dev).`,
      );
      return;
    }

    if (activeVideoIdRef.current && isLoading) {
      void cancelDownload(activeVideoIdRef.current).catch(() => {});
    }

    activeVideoIdRef.current = parsed.videoId;
    setIsLoading(true);
    setProgress({
      videoId: parsed.videoId,
      quality: settings.videoQuality,
      percent: 0,
      stage: 'downloading',
    });

    let meta: VideoMetadata | null = null;
    try {
      meta = await fetchVideoMetadata(canonicalYouTubeUrl(parsed.videoId));
    } catch (err) {
      const savedFallback = findSongByYoutubeId(library, parsed.videoId);
      if (savedFallback) {
        meta = {
          youtubeId: savedFallback.youtubeId,
          url: savedFallback.url,
          title: savedFallback.title,
          channel: savedFallback.channel,
          durationSec: savedFallback.durationSec,
          thumbnailUrl: savedFallback.thumbnailUrl,
        };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.toLowerCase().includes('cancelled')) {
          setLoadError(`Помилка завантаження: ${message}`);
        }
        setIsLoading(false);
        setProgress(null);
        return;
      }
    }

    await loadPreparedVideo(meta, parsed.startSec);
  };

  const handleSelectSong = (song: Song) => {
    setUrlInput(song.url);
    const songMeta: VideoMetadata = {
      youtubeId: song.youtubeId,
      url: song.url,
      title: song.title,
      channel: song.channel,
      durationSec: song.durationSec,
      thumbnailUrl: song.thumbnailUrl,
    };
    setMetadata(songMeta);
    setLoadError(null);

    if (!inTauri) {
      setLoadError(
        `Обрано «${song.title}». Відтворення кешованого MP4 працює у десктопному вікні Tauri.`,
      );
      return;
    }

    void loadPreparedVideo(songMeta, undefined, song.id);
  };

  const handleCancelDownload = () => {
    const vid = activeVideoIdRef.current;
    if (!vid || !inTauri) return;
    void cancelDownload(vid).catch(() => {});
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const realDuration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : durationSec;
    if (realDuration > 0) {
      setDurationSec(realDuration);
      if (pendingBoundsRef.current) {
        setBounds(
          normalizeLoopBounds(
            pendingBoundsRef.current.startSec,
            pendingBoundsRef.current.endSec,
            realDuration,
          ),
        );
        pendingBoundsRef.current = null;
      } else {
        setBounds(normalizeLoopBounds(0, realDuration, realDuration));
      }
      if (activeSong && activeSong.durationSec <= 0) {
        markSongPlayed(activeSong.id, realDuration);
      }
    }
    video.volume = isMuted ? 0 : volume;
    video.muted = isMuted;
    if (pendingSeekRef.current !== null && realDuration > 0) {
      const target = Math.min(pendingSeekRef.current, realDuration);
      video.currentTime = target;
      setCurrentTime(target);
      pendingSeekRef.current = null;
    }
  };

  const handleResetBounds = () => {
    if (durationSec <= 0) return;
    setBounds(normalizeLoopBounds(0, durationSec, durationSec));
  };

  const handleSaveFavorite = (customTitle?: string) => {
    if (!metadata) return;
    const metaWithDuration =
      durationSec > 0 && metadata.durationSec <= 0
        ? { ...metadata, durationSec }
        : metadata;
    saveFavorite(metaWithDuration, customTitle);
  };

  const handleCreateLoop = (name: string) => {
    if (!metadata || durationSec <= 0) return;
    const metaWithDuration =
      metadata.durationSec <= 0 ? { ...metadata, durationSec } : metadata;
    const song = activeSong ?? saveFavorite(metaWithDuration);
    const created = addLoop(
      song.id,
      name,
      bounds.startSec,
      bounds.endSec,
      durationSec,
    );
    setActiveLoopId(created.id);
  };

  const handleApplyLoop = (loop: LoopSegment) => {
    if (durationSec <= 0) return;
    const normalized = normalizeLoopBounds(loop.startSec, loop.endSec, durationSec);
    setBounds(normalized);
    setActiveLoopId(loop.id);
    setLoopEnabled(true);
    seekTo(normalized.startSec);
  };

  const handleUpdateLoopBounds = (loopId: string) => {
    if (!activeSong) return;
    updateLoop(activeSong.id, loopId, {
      startSec: bounds.startSec,
      endSec: bounds.endSec,
    });
  };

  const handleRenameLoop = (loopId: string, name: string) => {
    if (!activeSong) return;
    updateLoop(activeSong.id, loopId, { name });
  };

  const handleDeleteLoop = (loopId: string) => {
    if (!activeSong) return;
    deleteLoop(activeSong.id, loopId);
    if (activeLoopId === loopId) {
      setActiveLoopId(null);
    }
  };

  const handleQualityChange = (quality: VideoQuality) => {
    const next: AppSettings = { ...settings, videoQuality: quality };
    setSettings(next);
    if (inTauri) {
      void saveSettings(next).catch(() => {});
    }
  };

  const handleClearCache = async (mode: CacheClearMode) => {
    const stats = await runClearCache(mode);
    if (stats && metadata && !stats.cachedVideoIds.includes(metadata.youtubeId)) {
      setCached(false);
    }
  };

  const handleExportBackup = async () => {
    setBackupNotice(null);
    const outcome = await exportBackup();
    if (outcome.cancelled) return;
    if (outcome.error) {
      setBackupNotice({ kind: 'error', text: `Помилка експорту: ${outcome.error}` });
      return;
    }
    setBackupNotice({
      kind: 'ok',
      text: `Експортовано пісень: ${outcome.count ?? 0}.`,
    });
  };

  const handleImportBackup = async (mode: ImportMode) => {
    setBackupNotice(null);
    const outcome = await importBackup(mode);
    if (outcome.cancelled) return;
    if (outcome.error) {
      setBackupNotice({ kind: 'error', text: `Помилка імпорту: ${outcome.error}` });
      return;
    }
    if (outcome.result) {
      setBackupNotice({
        kind: 'ok',
        text: `Імпортовано пісень: ${outcome.result.importedSongCount}. Усього в бібліотеці: ${outcome.result.totalSongCount}.`,
      });
    }
  };

  const handleExportFromSidebar = () => {
    void handleExportBackup().then(() => {
      // Surface notice inside Settings if export failed or succeeded
    });
  };

  const handleUpdateYtdlpFromError = async () => {
    if (!inTauri || isUpdatingYtdlp) return;
    setIsUpdatingYtdlp(true);
    try {
      await updateYtdlp();
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(`Не вдалося оновити yt-dlp: ${msg}`);
    } finally {
      setIsUpdatingYtdlp(false);
    }
  };

  const confirmDeleteSong = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const removeCache = deleteWithCache;
    setDeleteTarget(null);
    await deleteFavorite(target.id, removeCache);
    if (metadata?.youtubeId === target.youtubeId && removeCache) {
      setCached(false);
    }
    if (activeSong?.id === target.id) {
      setActiveLoopId(null);
    }
  };

  const openSettings = (focus: 'backup' | null = null) => {
    setSettingsFocusSection(focus);
    setBackupNotice(null);
    setSettingsOpen(true);
    if (inTauri) {
      void refreshCacheStats();
    }
  };

  return (
    <div className="studio-shell">
      <header className="top-bar">
        <div className="top-bar-brand">
          <Music2 size={16} className="brand-mark" />
          <span>Guitar Looper</span>
          {appInfo && <span className="version-tag mono-num">v{appInfo.version}</span>}
        </div>

        <form className="top-url-form" onSubmit={handleLoadUrl}>
          <Youtube size={15} className="url-yt-icon" />
          <input
            type="text"
            className="top-url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="YouTube URL (watch?v=... або youtu.be/...)"
            aria-label="YouTube URL"
          />
          <button
            type="submit"
            className="studio-btn is-primary"
            disabled={isLoading}
          >
            {isLoading ? 'Завантаження…' : 'Відкрити'}
          </button>
        </form>

        <div className="top-bar-actions">
          <MetronomeControls
            enabled={metroEnabled}
            bpm={metroBpm}
            volume={metroVolume}
            onChange={(patch) => {
              if (patch.enabled !== undefined) setMetroEnabled(patch.enabled);
              if (patch.bpm !== undefined) setMetroBpm(patch.bpm);
              if (patch.volume !== undefined) setMetroVolume(patch.volume);
            }}
          />

          <button
            type="button"
            className="toolbar-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              openSettings(null);
            }}
            title="Налаштування, якість відео, кеш та бекап"
            aria-label="Налаштування"
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      {libraryError && (
        <div className="app-banner-error" role="alert">
          <span>Помилка бібліотеки: {libraryError}</span>
          <button
            type="button"
            className="icon-ghost-btn"
            onClick={clearLibraryError}
            aria-label="Приховати помилку"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {backupNotice && !settingsOpen && (
        <div
          className={
            backupNotice.kind === 'error' ? 'app-banner-error' : 'app-banner-ok'
          }
          role="status"
        >
          <span>{backupNotice.text}</span>
          <button
            type="button"
            className="icon-ghost-btn"
            onClick={() => setBackupNotice(null)}
            aria-label="Приховати сповіщення"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="studio-body">
        <LibrarySidebar
          songs={library.songs}
          activeYoutubeId={metadata?.youtubeId ?? null}
          cachedVideoIds={cachedVideoIdSet}
          onSelectSong={handleSelectSong}
          onRenameSong={renameFavorite}
          onRequestDeleteSong={(song) => {
            setDeleteWithCache(false);
            setDeleteTarget(song);
          }}
          onExport={handleExportFromSidebar}
          onOpenImport={() => openSettings('backup')}
        />

        <main className="editor-workspace">
          <VideoPlayer
            videoRef={videoRef}
            metadata={metadata}
            streamUrl={streamUrl}
            quality={loadedQuality}
            cached={cached}
            isLoading={isLoading}
            progress={progress}
            error={loadError}
            isPlaying={isPlaying}
            currentTime={currentTime}
            durationSec={durationSec}
            loopEnabled={loopEnabled}
            playbackRate={playbackRate}
            volume={volume}
            isMuted={isMuted}
            isTauri={inTauri}
            dataDirHint={appInfo?.dataDir}
            isFavorite={Boolean(activeSong)}
            favoriteTitle={activeSong?.title}
            onSaveFavorite={handleSaveFavorite}
            onUpdateYtdlp={handleUpdateYtdlpFromError}
            isUpdatingYtdlp={isUpdatingYtdlp}
            onTogglePlay={handleTogglePlay}
            onJumpToA={jumpToA}
            onToggleLoop={() => setLoopEnabled((v) => !v)}
            onPlaybackRateChange={setPlaybackRate}
            onVolumeChange={(v) => {
              setVolume(v);
              if (v > 0 && isMuted) setIsMuted(false);
            }}
            onToggleMute={() => setIsMuted((m) => !m)}
            onCancelDownload={handleCancelDownload}
            onLoadedMetadata={handleLoadedMetadata}
            onPlayStateChange={setIsPlaying}
            onEnded={() => setIsPlaying(false)}
          />

          <AbControls
            bounds={bounds}
            durationSec={durationSec}
            currentTime={currentTime}
            loopEnabled={loopEnabled}
            disabled={!streamUrl || durationSec <= 0}
            savedLoopEdges={savedLoopEdges}
            onBoundsChange={setBounds}
            onResetBounds={handleResetBounds}
            onSeek={seekTo}
          />

          <LoopsPanel
            loops={activeSong?.loops ?? []}
            activeLoopId={activeLoopId}
            bounds={bounds}
            durationSec={durationSec}
            hasVideo={Boolean(streamUrl && metadata)}
            onCreateLoop={handleCreateLoop}
            onApplyLoop={handleApplyLoop}
            onUpdateLoopBounds={handleUpdateLoopBounds}
            onRenameLoop={handleRenameLoop}
            onDeleteLoop={handleDeleteLoop}
          />
        </main>
      </div>

      <SettingsModal
        open={settingsOpen}
        inTauri={inTauri}
        settings={settings}
        cacheStats={cacheStats}
        dataDir={appInfo?.dataDir}
        backupNotice={backupNotice}
        focusSection={settingsFocusSection}
        onClose={() => setSettingsOpen(false)}
        onQualityChange={handleQualityChange}
        onClearCache={handleClearCache}
        onExportBackup={handleExportBackup}
        onImportBackup={handleImportBackup}
        onYtdlpUpdated={() => setLoadError(null)}
      />

      {deleteTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <div
            className="modal-card confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-song-title"
          >
            <div className="modal-header">
              <h2 id="delete-song-title" className="modal-title">
                Видалити пісню з улюблених?
              </h2>
              <button
                type="button"
                className="icon-ghost-btn"
                onClick={() => setDeleteTarget(null)}
                aria-label="Закрити"
              >
                <X size={15} />
              </button>
            </div>

            <div className="modal-body">
              <p className="confirm-text">
                Пісня <strong>«{deleteTarget.title}»</strong> та її збережені лупи (
                {deleteTarget.loops.length}) будуть видалені з бібліотеки.
              </p>

              {cachedVideoIdSet.has(deleteTarget.youtubeId) && (
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={deleteWithCache}
                    onChange={(e) => setDeleteWithCache(e.target.checked)}
                  />
                  <span>Також видалити кешований відеофайл із диска</span>
                </label>
              )}

              <div className="confirm-actions">
                <button
                  type="button"
                  className="studio-btn"
                  onClick={() => setDeleteTarget(null)}
                >
                  Скасувати
                </button>
                <button
                  type="button"
                  className="studio-btn is-danger-btn"
                  onClick={() => void confirmDeleteSong()}
                >
                  <Trash2 size={13} />
                  <span>Видалити</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
