import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  Check,
  Maximize2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  SkipBack,
  Star,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatTime } from '../lib/time';
import type { DownloadProgress, VideoMetadata, VideoQuality } from '../types';

export interface VideoPlayerProps {
  videoRef: RefObject<HTMLVideoElement>;
  metadata: VideoMetadata | null;
  streamUrl: string | null;
  quality: VideoQuality;
  cached: boolean;
  isLoading: boolean;
  progress: DownloadProgress | null;
  error: string | null;
  isPlaying: boolean;
  currentTime: number;
  durationSec: number;
  loopEnabled: boolean;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  isTauri: boolean;
  dataDirHint?: string;
  isFavorite: boolean;
  favoriteTitle?: string;
  onSaveFavorite: (customTitle?: string) => void;
  onUpdateYtdlp?: () => void;
  isUpdatingYtdlp?: boolean;
  onTogglePlay: () => void;
  onJumpToA: () => void;
  onToggleLoop: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onCancelDownload: () => void;
  onLoadedMetadata: () => void;
  onPlayStateChange: (playing: boolean) => void;
  onEnded: () => void;
}

const SPEED_PRESETS = [0.5, 0.75, 0.85, 1.0, 1.25];

function stageLabel(stage?: string): string {
  switch (stage) {
    case 'installing_ytdlp':
      return 'Завантаження yt-dlp.exe…';
    case 'merging':
      return "Об'єднання відео та аудіо…";
    case 'ready':
      return 'Готово';
    case 'downloading':
    default:
      return 'Завантаження відео…';
  }
}

export function VideoPlayer({
  videoRef,
  metadata,
  streamUrl,
  quality,
  cached,
  isLoading,
  progress,
  error,
  isPlaying,
  currentTime,
  durationSec,
  loopEnabled,
  playbackRate,
  volume,
  isMuted,
  isTauri,
  dataDirHint,
  isFavorite,
  favoriteTitle,
  onSaveFavorite,
  onUpdateYtdlp,
  isUpdatingYtdlp = false,
  onTogglePlay,
  onJumpToA,
  onToggleLoop,
  onPlaybackRateChange,
  onVolumeChange,
  onToggleMute,
  onCancelDownload,
  onLoadedMetadata,
  onPlayStateChange,
  onEnded,
}: VideoPlayerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [editingFavTitle, setEditingFavTitle] = useState(false);
  const [draftFavTitle, setDraftFavTitle] = useState('');

  useEffect(() => {
    setEditingFavTitle(false);
    setDraftFavTitle(metadata?.title ?? '');
  }, [metadata?.youtubeId, metadata?.title, isFavorite]);

  const handleToggleFullscreen = () => {
    const container = stageRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void container.requestFullscreen().catch(() => {});
    }
  };

  const clampRate = (rate: number) =>
    Math.min(2.0, Math.max(0.25, Math.round(rate * 20) / 20));

  const pct = progress ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const displayTitle = favoriteTitle || metadata?.title || '';
  const showYtdlpUpdateBtn =
    Boolean(isTauri && onUpdateYtdlp && error && error.toLowerCase().includes('yt-dlp'));

  return (
    <section className="monitor-panel">
      {metadata && (
        <div className="monitor-meta-bar">
          <div className="monitor-meta-left">
            <span className="monitor-title" title={displayTitle}>
              {displayTitle}
            </span>
            <span className="monitor-channel">{metadata.channel}</span>
          </div>
          <div className="monitor-meta-right">
            {isFavorite ? (
              <span className="fav-badge" title="Пісня збережена в улюблених">
                <Star size={11} fill="currentColor" />
                <span>В улюблених</span>
              </span>
            ) : editingFavTitle ? (
              <form
                className="fav-inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  onSaveFavorite(draftFavTitle);
                  setEditingFavTitle(false);
                }}
              >
                <input
                  type="text"
                  className="studio-input fav-title-input"
                  value={draftFavTitle}
                  autoFocus
                  onChange={(e) => setDraftFavTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingFavTitle(false);
                      setDraftFavTitle(metadata.title);
                    }
                  }}
                  placeholder="Назва в бібліотеці"
                  aria-label="Назва пісні в улюблених"
                />
                <button
                  type="submit"
                  className="micro-btn is-active"
                  title="Підтвердити збереження"
                >
                  <Check size={11} />
                  <span>Зберегти</span>
                </button>
                <button
                  type="button"
                  className="micro-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setEditingFavTitle(false);
                    setDraftFavTitle(metadata.title);
                  }}
                  title="Скасувати"
                >
                  <X size={11} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="micro-btn"
                onClick={(e) => {
                  e.currentTarget.blur();
                  setDraftFavTitle(metadata.title);
                  setEditingFavTitle(true);
                }}
                title="Зберегти пісню в улюблені з можливістю редагування назви"
              >
                <Star size={11} />
                <span>Зберегти в улюблені</span>
              </button>
            )}

            <span className="mono-num">
              {quality}
              {streamUrl && (cached ? ' · Кеш (офлайн)' : ' · Закешовано')}
            </span>
          </div>
        </div>
      )}

      <div ref={stageRef} className="monitor-stage">
        {streamUrl ? (
          <video
            ref={videoRef}
            src={streamUrl}
            className="video-element"
            playsInline
            preload="auto"
            onClick={onTogglePlay}
            onLoadedMetadata={onLoadedMetadata}
            onPlay={() => onPlayStateChange(true)}
            onPause={() => onPlayStateChange(false)}
            onEnded={onEnded}
          />
        ) : (
          <div className="monitor-empty">
            <Music2 size={28} className="monitor-empty-icon" />
            <p className="monitor-empty-title">Вставте посилання на YouTube у верхній рядок</p>
            <p className="monitor-empty-sub">
              Локальний MP4-кеш для миттєвих A–B лупів та роботи без інтернету.
              {!isTauri && ' (Завантажувач працює у вікні Tauri.)'}
              {isTauri && dataDirHint ? ` Папка: ${dataDirHint}` : ''}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="monitor-overlay">
            <div className="download-box">
              <div className="download-box-top">
                <span>{stageLabel(progress?.stage)}</span>
                <span className="mono-num">{pct.toFixed(1)}%</span>
              </div>
              <div className="download-track">
                <div className="download-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="download-box-actions">
                <button
                  type="button"
                  className="studio-btn"
                  onClick={onCancelDownload}
                >
                  <X size={13} />
                  <span>Скасувати</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {error && !isLoading && (
          <div className="monitor-error" role="alert">
            <span>{error}</span>
            {showYtdlpUpdateBtn && (
              <button
                type="button"
                className="micro-btn"
                disabled={isUpdatingYtdlp}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onUpdateYtdlp?.();
                }}
              >
                <RefreshCw size={11} className={isUpdatingYtdlp ? 'spin-icon' : ''} />
                <span>{isUpdatingYtdlp ? 'Оновлення…' : 'Оновити yt-dlp'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="transport-strip">
        <div className="transport-group">
          <button
            type="button"
            className={`studio-btn ${isPlaying ? 'is-primary' : ''}`}
            onClick={(e) => {
              e.currentTarget.blur();
              onTogglePlay();
            }}
            disabled={!streamUrl}
            title="Play / Pause (Space)"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>

          <button
            type="button"
            className="studio-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              onJumpToA();
            }}
            disabled={!streamUrl}
            title="На початок A"
          >
            <SkipBack size={14} />
          </button>

          <div className="timecode-readout mono-num">
            <span className="timecode-current">{formatTime(currentTime)}</span>
            <span className="timecode-sep">/</span>
            <span className="timecode-total">{formatTime(durationSec)}</span>
          </div>
        </div>

        <div className="transport-group">
          <button
            type="button"
            className={`studio-btn ${loopEnabled ? 'is-active' : ''}`}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleLoop();
            }}
            disabled={!streamUrl || durationSec <= 0}
            title="Увімкнути або вимкнути A–B луп"
          >
            <Repeat size={13} />
            <span>Луп</span>
          </button>

          <div className="speed-presets">
            {SPEED_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`micro-btn ${Math.abs(playbackRate - preset) < 0.01 ? 'is-active' : ''}`}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPlaybackRateChange(preset);
                }}
              >
                {preset}x
              </button>
            ))}
          </div>

          <input
            type="range"
            className="studio-range speed-range"
            min={0.25}
            max={2.0}
            step={0.05}
            value={playbackRate}
            onChange={(e) => onPlaybackRateChange(clampRate(Number(e.target.value)))}
            aria-label="Швидкість відтворення"
          />
          <span className="mono-num speed-val">{playbackRate.toFixed(2)}x</span>
        </div>

        <div className="transport-group">
          <button
            type="button"
            className="studio-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            title={isMuted ? 'Увімкнути звук' : 'Вимкнути звук'}
          >
            {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>

          <input
            type="range"
            className="studio-range vol-range"
            min={0}
            max={1}
            step={0.02}
            value={isMuted ? 0 : volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            aria-label="Гучність відео"
          />

          <button
            type="button"
            className="studio-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              handleToggleFullscreen();
            }}
            disabled={!streamUrl}
            title="Повноекранний режим"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
