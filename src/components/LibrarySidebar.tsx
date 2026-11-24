import { useMemo, useState } from 'react';
import {
  Download,
  HardDrive,
  Music2,
  Pencil,
  Repeat,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { filterSongs } from '../lib/library';
import { formatTime } from '../lib/time';
import type { Song } from '../types';

export interface LibrarySidebarProps {
  songs: Song[];
  activeYoutubeId: string | null;
  cachedVideoIds: Set<string>;
  onSelectSong: (song: Song) => void;
  onRenameSong: (songId: string, nextTitle: string) => void;
  onRequestDeleteSong: (song: Song) => void;
  onExport: () => void;
  onOpenImport: () => void;
}

function SongThumb({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div className="song-thumb song-thumb-fallback" aria-hidden="true">
        <Music2 size={15} />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={title}
      className="song-thumb"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function LibrarySidebar({
  songs,
  activeYoutubeId,
  cachedVideoIds,
  onSelectSong,
  onRenameSong,
  onRequestDeleteSong,
  onExport,
  onOpenImport,
}: LibrarySidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const filteredSongs = useMemo(
    () => filterSongs(songs, searchQuery),
    [songs, searchQuery],
  );

  const startEditing = (song: Song) => {
    setEditingSongId(song.id);
    setDraftTitle(song.title);
  };

  const commitEditing = (songId: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) {
      onRenameSong(songId, trimmed);
    }
    setEditingSongId(null);
  };

  const cancelEditing = () => {
    setEditingSongId(null);
    setDraftTitle('');
  };

  const countLabel =
    searchQuery.trim().length > 0
      ? `${filteredSongs.length}/${songs.length}`
      : `${songs.length}`;

  return (
    <aside className="library-pane">
      <div className="pane-header">
        <span>Library</span>
        <span className="mono-num pane-count">{countLabel}</span>
      </div>

      <div className="library-search-box">
        <Search size={13} className="library-search-icon" />
        <input
          type="search"
          className="library-search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search song or channel…"
          aria-label="Search library"
        />
        {searchQuery && (
          <button
            type="button"
            className="icon-ghost-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              setSearchQuery('');
            }}
            title="Clear search"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="library-list">
        {songs.length === 0 ? (
          <div className="pane-empty">
            <p>
              No favorite songs yet. Open a video and click &ldquo;Save to
              Favorites&rdquo;.
            </p>
          </div>
        ) : filteredSongs.length === 0 ? (
          <div className="pane-empty library-empty-search">
            <p>No matches found for &ldquo;{searchQuery.trim()}&rdquo;.</p>
            <button
              type="button"
              className="micro-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                setSearchQuery('');
              }}
            >
              Reset search
            </button>
          </div>
        ) : (
          filteredSongs.map((song) => {
            const isActive = song.youtubeId === activeYoutubeId;
            const isCached = cachedVideoIds.has(song.youtubeId);
            const isEditing = editingSongId === song.id;

            return (
              <div
                key={song.id}
                role="button"
                tabIndex={0}
                className={`song-item ${isActive ? 'is-active' : ''}`}
                onClick={() => {
                  if (!isEditing) {
                    onSelectSong(song);
                  }
                }}
                onKeyDown={(e) => {
                  if (isEditing) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSong(song);
                  }
                }}
                title={`${song.title} — ${song.channel}`}
              >
                <SongThumb url={song.thumbnailUrl} title={song.title} />

                <div className="song-item-body">
                  {isEditing ? (
                    <input
                      type="text"
                      className="studio-input song-rename-input"
                      value={draftTitle}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onBlur={() => commitEditing(song.id)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitEditing(song.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEditing();
                        }
                      }}
                      aria-label="New song title"
                    />
                  ) : (
                    <div className="song-item-title">{song.title}</div>
                  )}

                  <div className="song-item-channel">{song.channel}</div>

                  <div className="song-item-meta mono-num">
                    <span className="song-meta-chip" title="Number of loops">
                      <Repeat size={10} />
                      {song.loops.length}
                    </span>
                    {song.durationSec > 0 && (
                      <span className="song-meta-chip">
                        {formatTime(song.durationSec, { showTenths: false })}
                      </span>
                    )}
                    {isCached && (
                      <span
                        className="song-meta-chip is-offline"
                        title="Video is cached locally — available offline"
                      >
                        <HardDrive size={10} />
                        Offline
                      </span>
                    )}
                  </div>
                </div>

                <div className="song-item-actions">
                  <button
                    type="button"
                    className="icon-ghost-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.currentTarget.blur();
                      startEditing(song);
                    }}
                    title="Rename song"
                    aria-label="Rename song"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-ghost-btn is-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.currentTarget.blur();
                      onRequestDeleteSong(song);
                    }}
                    title="Delete song"
                    aria-label="Delete song"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="library-footer">
        <button
          type="button"
          className="micro-btn library-footer-btn"
          onClick={(e) => {
            e.currentTarget.blur();
            onExport();
          }}
          title="Export library to JSON"
        >
          <Download size={12} />
          <span>Export</span>
        </button>
        <button
          type="button"
          className="micro-btn library-footer-btn"
          onClick={(e) => {
            e.currentTarget.blur();
            onOpenImport();
          }}
          title="Import library from JSON"
        >
          <Upload size={12} />
          <span>Import</span>
        </button>
      </div>
    </aside>
  );
}
