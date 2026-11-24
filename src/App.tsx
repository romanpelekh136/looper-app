import { useCallback, useEffect, useRef, useState } from 'react';
import { Music2, Settings, Youtube } from 'lucide-react';
import { AbControls } from './components/AbControls';
import { MetronomeControls } from './components/MetronomeControls';
import { VideoPlayer } from './components/VideoPlayer';
import { useAbLoop } from './hooks/useAbLoop';
import { useMetronome } from './hooks/useMetronome';
import {
  cancelDownload,
  fetchVideoMetadata,
  getAppInfo,
  isTauriRuntime,
  loadSettings,
  onDownloadProgress,
  prepareVideo,
} from './lib/api';
import { normalizeLoopBounds, type LoopBounds } from './lib/loopBounds';
import { canonicalYouTubeUrl, parseYouTubeUrl } from './lib/youtube';
import {
  DEFAULT_SETTINGS,
  type AppInfo,
  type AppSettings,
  type DownloadProgress,
  type VideoMetadata,
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
  const activeVideoIdRef = useRef<string | null>(null);

  const [inTauri] = useState(() => isTauriRuntime());
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [urlInput, setUrlInput] = useState('');
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolume] = useState(DEFAULT_SETTINGS.volume);
  const [isMuted, setIsMuted] = useState(false);

  const [bounds, setBounds] = useState<LoopBounds>({ startSec: 0, endSec: 0 });
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  const [metroEnabled, setMetroEnabled] = useState(false);
  const [metroBpm, setMetroBpm] = useState(120);
  const [metroVolume, setMetroVolume] = useState(0.7);

  useEffect(() => {
    if (!inTauri) return;
    getAppInfo()
      .then(setAppInfo)
      .catch(() => {});
    loadSettings()
      .then((loaded) => {
        setSettings(loaded);
        setVolume(loaded.volume);
      })
      .catch(() => {});
  }, [inTauri]);

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

  // Only Space (Play/Pause) hotkey in window focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [handleTogglePlay]);

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

    activeVideoIdRef.current = parsed.videoId;
    setIsLoading(true);
    setProgress({
      videoId: parsed.videoId,
      quality: settings.videoQuality,
      percent: 0,
      stage: 'downloading',
    });

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await onDownloadProgress((p) => {
        if (p.videoId === parsed.videoId) {
          setProgress(p);
        }
      });

      const meta = await fetchVideoMetadata(canonicalYouTubeUrl(parsed.videoId));
      setMetadata(meta);

      const prepared = await prepareVideo(meta.youtubeId, settings.videoQuality);
      const initialDur = meta.durationSec > 0 ? meta.durationSec : 0;

      pendingSeekRef.current = parsed.startSec ?? null;
      setStreamUrl(prepared.streamUrl);
      setCached(prepared.cached);
      setDurationSec(initialDur);
      setBounds(normalizeLoopBounds(0, initialDur, initialDur));
      setLoopEnabled(false);
      setCurrentTime(parsed.startSec ?? 0);
      setIsPlaying(false);
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
      setBounds(normalizeLoopBounds(0, realDuration, realDuration));
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
            title="Налаштування (Етап 6)"
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      <div className="studio-body">
        <aside className="library-pane">
          <div className="pane-header">
            <span>Бібліотека</span>
            <span className="mono-num pane-count">0</span>
          </div>
          <div className="pane-empty">
            <p>Список улюблених пісень та лупів буде додано на Етапі 5.</p>
          </div>
        </aside>

        <main className="editor-workspace">
          <VideoPlayer
            videoRef={videoRef}
            metadata={metadata}
            streamUrl={streamUrl}
            quality={settings.videoQuality}
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
            onBoundsChange={setBounds}
            onResetBounds={handleResetBounds}
            onSeek={seekTo}
          />
        </main>
      </div>
    </div>
  );
}

export default App;
