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
          ? `yt-dlp updated to ${updated.ytdlpVersion}.`
          : 'yt-dlp updated successfully.',
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
            Settings &amp; Data Management
          </h2>
          <button
            type="button"
            className="icon-ghost-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {/* Section 1: Video Quality */}
          <section className="settings-section">
            <h3 className="settings-section-title">Default Video Quality</h3>
            <div className="quality-segment" role="group" aria-label="Video quality">
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`studio-btn ${settings.videoQuality === q ? 'is-primary' : ''}`}
                  onClick={() => onQualityChange(q)}
                >
                  {q}
                  {q === '720p' ? ' (rec.)' : ''}
                </button>
              ))}
            </div>
            <p className="settings-hint">
              Applies to the next downloaded MP4 (H.264 / AAC) video.
            </p>
          </section>

          {/* Section 2: Cache */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <HardDrive size={13} />
              <span>Local Video Cache</span>
            </h3>

            <div className="cache-stats-grid">
              <div className="cache-stat-cell">
                <span className="cache-stat-label">Total on disk</span>
                <span className="cache-stat-val mono-num">
                  {cacheStats ? formatBytes(cacheStats.totalBytes) : '—'}
                </span>
              </div>
              <div className="cache-stat-cell">
                <span className="cache-stat-label">Files</span>
                <span className="cache-stat-val mono-num">
                  {cacheStats ? cacheStats.fileCount : '—'}
                </span>
              </div>
              <div className="cache-stat-cell">
                <span className="cache-stat-label">Favorites</span>
                <span className="cache-stat-val mono-num">
                  {cacheStats ? formatBytes(cacheStats.favoriteBytes) : '—'}
                </span>
              </div>
              <div className="cache-stat-cell">
                <span className="cache-stat-label">Temporary</span>
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
                <span>Clear Temporary (Non-Favorites)</span>
              </button>
              <button
                type="button"
                className="studio-btn is-danger-btn"
                disabled={!inTauri || isClearing || (cacheStats?.totalBytes ?? 0) === 0}
                onClick={() => void handleClear('all')}
              >
                <Trash2 size={13} />
                <span>Clear All Cache</span>
              </button>
            </div>
            <p className="settings-hint">
              Favorite songs and their loops are never deleted — cached videos
              will re-download when opened again.
            </p>
          </section>

          {/* Section 3: Backup Export / Import */}
          <section ref={backupSectionRef} className="settings-section">
            <h3 className="settings-section-title">Library Backup (JSON)</h3>

            <div className="import-mode-group">
              <label className="radio-option">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />
                <span>
                  <strong>Merge with current</strong> — adds new songs and loops
                  without duplicating by ID
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
                  <strong>Replace completely</strong> — overwrites the current
                  library with the backup file
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
                <span>Export JSON…</span>
              </button>
              <button
                type="button"
                className="studio-btn is-primary"
                disabled={!inTauri || isBackingUp}
                onClick={() => void handleImport()}
              >
                <Upload size={13} />
                <span>Import JSON…</span>
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
              <span>Tools &amp; Storage</span>
            </h3>

            <div className="tools-status-list">
              <div className="tools-status-row">
                <span className="tools-key">yt-dlp</span>
                <span className="tools-val mono-num">
                  {binaries?.ytdlpPath
                    ? `${binaries.ytdlpVersion ?? 'found'} (${binaries.ytdlpPath})`
                    : inTauri
                      ? 'will download automatically when opening a video'
                      : 'available in Tauri window'}
                </span>
              </div>
              <div className="tools-status-row">
                <span className="tools-key">ffmpeg</span>
                <span className="tools-val mono-num">
                  {binaries?.ffmpegPath ?? (inTauri ? 'not found in PATH/bin' : '—')}
                </span>
              </div>
              {dataDir && (
                <div className="tools-status-row">
                  <span className="tools-key">Data folder</span>
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
                <span>{isUpdatingYtdlp ? 'Updating yt-dlp…' : 'Update yt-dlp'}</span>
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
