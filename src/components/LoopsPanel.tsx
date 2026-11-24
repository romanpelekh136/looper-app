import { useState } from 'react';
import { Pencil, Plus, RefreshCw, Repeat, Trash2 } from 'lucide-react';
import type { LoopBounds } from '../lib/loopBounds';
import { formatTime } from '../lib/time';
import type { LoopSegment } from '../types';

export interface LoopsPanelProps {
  loops: LoopSegment[];
  activeLoopId: string | null;
  bounds: LoopBounds;
  durationSec: number;
  hasVideo: boolean;
  onCreateLoop: (name: string) => void;
  onApplyLoop: (loop: LoopSegment) => void;
  onUpdateLoopBounds: (loopId: string) => void;
  onRenameLoop: (loopId: string, name: string) => void;
  onDeleteLoop: (loopId: string) => void;
}

export function LoopsPanel({
  loops,
  activeLoopId,
  bounds,
  durationSec,
  hasVideo,
  onCreateLoop,
  onApplyLoop,
  onUpdateLoopBounds,
  onRenameLoop,
  onDeleteLoop,
}: LoopsPanelProps) {
  const [newLoopName, setNewLoopName] = useState('');
  const [editingLoopId, setEditingLoopId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const canCreate = hasVideo && durationSec > 0;

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    onCreateLoop(newLoopName);
    setNewLoopName('');
  };

  const startRename = (loop: LoopSegment) => {
    setEditingLoopId(loop.id);
    setDraftName(loop.name);
  };

  const commitRename = (loopId: string) => {
    const trimmed = draftName.trim();
    if (trimmed) {
      onRenameLoop(loopId, trimmed);
    }
    setEditingLoopId(null);
  };

  const cancelRename = () => {
    setEditingLoopId(null);
    setDraftName('');
  };

  return (
    <section className="loops-dock" aria-label="Saved A–B loops">
      <div className="loops-dock-header">
        <div className="loops-dock-title">
          <Repeat size={13} />
          <span>Saved Loops</span>
          <span className="mono-num pane-count">{loops.length}</span>
        </div>

        <form className="loop-create-form" onSubmit={handleCreateSubmit}>
          <input
            type="text"
            className="studio-input loop-name-input"
            value={newLoopName}
            disabled={!canCreate}
            onChange={(e) => setNewLoopName(e.target.value)}
            placeholder="Loop name (e.g. Solo 1)"
            aria-label="New loop name"
          />
          <button
            type="submit"
            className="studio-btn is-primary"
            disabled={!canCreate}
            onClick={(e) => e.currentTarget.blur()}
            title="Save current A–B range as a named loop"
          >
            <Plus size={13} />
            <span>Save A–B</span>
          </button>
        </form>
      </div>

      <div className="loops-dock-body">
        {!hasVideo ? (
          <p className="loops-empty-hint">
            Open a video to create named A–B loops.
          </p>
        ) : loops.length === 0 ? (
          <p className="loops-empty-hint">
            Set In (A) / Out (B) bounds on the timeline and save your first
            loop.
          </p>
        ) : (
          <div className="loops-chip-list">
            {loops.map((loop) => {
              const isActive = loop.id === activeLoopId;
              const isEditing = editingLoopId === loop.id;
              const boundsModified =
                isActive &&
                (Math.abs(bounds.startSec - loop.startSec) >= 0.05 ||
                  Math.abs(bounds.endSec - loop.endSec) >= 0.05);

              return (
                <div
                  key={loop.id}
                  className={`loop-chip ${isActive ? 'is-active' : ''}`}
                >
                  {isEditing ? (
                    <input
                      type="text"
                      className="studio-input loop-rename-input"
                      value={draftName}
                      autoFocus
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(loop.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename(loop.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      aria-label="New loop name"
                    />
                  ) : (
                    <button
                      type="button"
                      className="loop-chip-apply"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onApplyLoop(loop);
                      }}
                      title={`Apply "${loop.name}" (${formatTime(loop.startSec)} – ${formatTime(loop.endSec)})`}
                    >
                      <span className="loop-chip-name">{loop.name}</span>
                      <span className="loop-chip-range mono-num">
                        {formatTime(loop.startSec)}–{formatTime(loop.endSec)}
                      </span>
                    </button>
                  )}

                  <div className="loop-chip-actions">
                    <button
                      type="button"
                      className={`icon-ghost-btn ${boundsModified ? 'is-highlight' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.currentTarget.blur();
                        onUpdateLoopBounds(loop.id);
                      }}
                      title="Update A–B bounds for this loop"
                      aria-label="Update loop bounds"
                    >
                      <RefreshCw size={11} />
                    </button>
                    <button
                      type="button"
                      className="icon-ghost-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.currentTarget.blur();
                        startRename(loop);
                      }}
                      title="Rename loop"
                      aria-label="Rename loop"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      className="icon-ghost-btn is-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.currentTarget.blur();
                        onDeleteLoop(loop.id);
                      }}
                      title="Delete loop"
                      aria-label="Delete loop"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
