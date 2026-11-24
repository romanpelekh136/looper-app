import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { checkBinaries, updateYtdlp } from '../lib/api';
import { formatBytes } from '../lib/library';
import type {
  AppSettings,
  BinariesStatus,
  CacheClearMode,
  CacheStats,
  ImportMode,
  VideoQuality,
} from '../types';

export interface SettingsModalProps {
  open: boolean;
  inTauri: boolean;
  settings: AppSettings;
  cacheStats: CacheStats | null;
  dataDir?: string;
  backupNotice: { kind: 'ok' | 'error'; text: string } | null;
  focusSection?: 'backup' | null;
  onClose: () => void;
  onQualityChange: (quality: VideoQuality) => void;
  onClearCache: (mode: CacheClearMode) => Promise<void>;
  onExportBackup: () => Promise<void>;
  onImportBackup: (mode: ImportMode) => Promise<void>;
  onYtdlpUpdated?: () => void;
}

const QUALITY_OPTIONS: VideoQuality[] = ['480p', '720p', '1080p'];

export function SettingsModal({
  open,
  inTauri,
  settings,
  cacheStats,
  dataDir,
  backupNotice,
  focusSection,
  onClose,
  onQualityChange,
  onClearCache,
  onExportBackup,
  onImportBackup,
  onYtdlpUpdated,
}: SettingsModalProps) {
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [isClearing, setIsClearing] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [binaries, setBinaries] = useState<BinariesStatus | null>(null);
  const [isUpdatingYtdlp, setIsUpdatingYtdlp] = useState(false);
  const [toolsNotice, setToolsNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);
  const backupSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !inTauri) return;
    let cancelled = false;
    checkBinaries()
      .then((status) => {
        if (!cancelled) setBinaries(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, inTauri]);

  useEffect(() => {
    if (open && focusSection === 'backup') {
      backupSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [open, focusSection]);

  if (!open) return null;

  const handleClear = async (mode: CacheClearMode) => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      await onClearCache(mode);
    } finally {
      setIsClearing(false);
    }
  };

  const handleExport = async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);
    try {
      await onExportBackup();
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleImport = async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);
    try {
      await onImportBackup(importMode);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleUpdateYtdlp = async () => {
    if (!inTauri || isUpdatingYtdlp) return;
    setIsUpdatingYtdlp(true);
    setToolsNotice(null);
    try {
      const updated = await updateYtdlp();
      setBinaries(updated);
      setToolsNotice({
        kind: 'ok',
        text: updated.ytdlpVersion
          ? `yt-dlp оновлено до версії ${updated.ytdlpVersion}.`
          : 'yt-dlp успішно оновлено.',
      });
      onYtdlpUpdated?.();
    } catch (err) {
      setToolsNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsUpdatingYtdlp(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="modal-header">
          <h2 id="settings-modal-title" className="modal-title">
            Налаштування та керування даними
          </h2>
          <button
            type="button"
            className="icon-ghost-btn"
            onClick={onClose}
            aria-label="Закрити"
          >
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {/* Section 1: Video Quality */}
          <section className="settings-section">
            <h3 className="settings-section-title">Якість відео за замовчуванням</h3>
            <div className="quality-segment" role="group" aria-label="Якість відео">
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`studio-btn ${settings.videoQuality === q ? 'is-primary' : ''}`}
                  onClick={() => onQualityChange(q)}
                >
                  {q}
                  {q === '720p' ? ' (рек.)' : ''}
                </button>
              ))}
            </div>
            <p className="settings-hint">
              Застосовується під час наступного завантаження відео у форматі MP4
              (H.264 / AAC).
            </p>
          </section>

          {/* Section 2: Cache */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <HardDrive size={13} />
              <span>Локальний кеш відео</span>
            </h3>

            <div className="cache-stats-grid">
              <div className="cache-stat-cell">
                <span className="cache-stat-label">Усього на диску</span>
                <span className="cache-stat-val mono-num">
                  {cacheStats ? formatBytes(cacheStats.totalBytes) : '—'}
                </span>
              </div>
              <div className="cache-stat-cell">
                <span className="cache-stat-label">Файлів</span>
                <span className="cache-stat-val mono-num">
                  {cacheStats ? cacheStats.fileCount : '—'}
                </span>
              </div>
              <div className="cache-stat-cell">
                <span className="cache-stat-label">Улюблені</span>
                <span className="cache-stat-val mono-num">
                  {cacheStats ? formatBytes(cacheStats.favoriteBytes) : '—'}
                </span>
              </div>
              <div className="cache-stat-cell">
                <span className="cache-stat-label">Тимчасові</span>
                <span className="cache-stat-val mono-num">
                  {cacheStats ? formatBytes(cacheStats.tempBytes) : '—'}
                </span>
              </div>
            </div>

            <div className="settings-btn-row">
              <button
                type="button"
                className="studio-btn"
                disabled={!inTauri || isClearing || (cacheStats?.tempBytes ?? 0) === 0}
                onClick={() => void handleClear('tempOnly')}
              >
                <Trash2 size={13} />
                <span>Очистити тимчасові (неулюблені)</span>
              </button>
              <button
                type="button"
                className="studio-btn is-danger-btn"
                disabled={!inTauri || isClearing || (cacheStats?.totalBytes ?? 0) === 0}
                onClick={() => void handleClear('all')}
              >
                <Trash2 size={13} />
                <span>Очистити весь кеш</span>
              </button>
            </div>
            <p className="settings-hint">
              Улюблені пісні та їхні лупи при очищенні кешу не видаляються — відео
              перекачається при повторному відкритті.
            </p>
          </section>

          {/* Section 3: Backup Export / Import */}
          <section ref={backupSectionRef} className="settings-section">
            <h3 className="settings-section-title">Бекап бібліотеки (JSON)</h3>

            <div className="import-mode-group">
              <label className="radio-option">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />
                <span>
                  <strong>Об&apos;єднати з поточною</strong> — додає нові пісні та
                  лупи без дублювання за ID
                </span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />
                <span>
                  <strong>Замінити повністю</strong> — перезаписує поточну
                  бібліотеку файлом бекапу
                </span>
              </label>
            </div>

            <div className="settings-btn-row">
              <button
                type="button"
                className="studio-btn"
                disabled={!inTauri || isBackingUp}
                onClick={() => void handleExport()}
              >
                <Download size={13} />
                <span>Експортувати JSON…</span>
              </button>
              <button
                type="button"
                className="studio-btn is-primary"
                disabled={!inTauri || isBackingUp}
                onClick={() => void handleImport()}
              >
                <Upload size={13} />
                <span>Імпортувати JSON…</span>
              </button>
            </div>

            {backupNotice && (
              <div
                className={`settings-notice ${
                  backupNotice.kind === 'error' ? 'is-error' : 'is-ok'
                }`}
              >
                {backupNotice.text}
              </div>
            )}
          </section>

          {/* Section 4: Tools & Data Dir */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <FolderOpen size={13} />
              <span>Інструменти та сховище</span>
            </h3>

            <div className="tools-status-list">
              <div className="tools-status-row">
                <span className="tools-key">yt-dlp</span>
                <span className="tools-val mono-num">
                  {binaries?.ytdlpPath
                    ? `${binaries.ytdlpVersion ?? 'знайдено'} (${binaries.ytdlpPath})`
                    : inTauri
                      ? 'завантажиться автоматично при відкритті відео'
                      : 'доступно у вікні Tauri'}
                </span>
              </div>
              <div className="tools-status-row">
                <span className="tools-key">ffmpeg</span>
                <span className="tools-val mono-num">
                  {binaries?.ffmpegPath ?? (inTauri ? 'не знайдено в PATH/bin' : '—')}
                </span>
              </div>
              {dataDir && (
                <div className="tools-status-row">
                  <span className="tools-key">Папка даних</span>
                  <span className="tools-val mono-num">{dataDir}</span>
                </div>
              )}
            </div>

            <div className="settings-btn-row">
              <button
                type="button"
                className="studio-btn"
                disabled={!inTauri || isUpdatingYtdlp}
                onClick={() => void handleUpdateYtdlp()}
              >
                <RefreshCw size={13} className={isUpdatingYtdlp ? 'spin-icon' : ''} />
                <span>{isUpdatingYtdlp ? 'Оновлення yt-dlp…' : 'Оновити yt-dlp'}</span>
              </button>
            </div>

            {toolsNotice && (
              <div
                className={`settings-notice ${
                  toolsNotice.kind === 'error' ? 'is-error' : 'is-ok'
                }`}
              >
                {toolsNotice.text}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
