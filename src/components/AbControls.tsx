import { useEffect, useMemo, useRef, useState } from 'react';
import { Magnet, RotateCcw } from 'lucide-react';
import {
  nudgeLoopEnd,
  nudgeLoopStart,
  type LoopBounds,
} from '../lib/loopBounds';
import { formatTime, parseTimeInput, roundToTenth } from '../lib/time';
import {
  computeRulerTicks,
  pixelThresholdToSeconds,
  snapToTargets,
  type SnapTarget,
} from '../lib/timelineSnap';

export interface AbControlsProps {
  bounds: LoopBounds;
  durationSec: number;
  currentTime: number;
  loopEnabled: boolean;
  disabled: boolean;
  savedLoopEdges?: number[];
  onBoundsChange: (next: LoopBounds) => void;
  onResetBounds: () => void;
  onSeek: (sec: number) => void;
}

const NUDGE_STEPS = [-0.5, -0.1, 0.1, 0.5];
const SNAP_THRESHOLD_PX = 10;

interface BoundInlineEditorProps {
  tag: 'In (A)' | 'Out (B)';
  valueSec: number;
  currentTime: number;
  disabled: boolean;
  onCommit: (sec: number) => void;
  onNudge: (deltaSec: number) => void;
}

function BoundInlineEditor({
  tag,
  valueSec,
  currentTime,
  disabled,
  onCommit,
  onNudge,
}: BoundInlineEditorProps) {
  const [text, setText] = useState(formatTime(valueSec));
  const [isEditing, setIsEditing] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setText(formatTime(valueSec));
      setIsInvalid(false);
    }
  }, [valueSec, isEditing]);

  const commitText = () => {
    const parsed = parseTimeInput(text);
    if (parsed === null) {
      setIsInvalid(true);
      return;
    }
    setIsInvalid(false);
    setIsEditing(false);
    onCommit(parsed);
  };

  return (
    <div className="bound-inline-group">
      <span className="bound-tag mono-num">{tag}</span>
      <input
        type="text"
        className={`studio-input time-code-input mono-num ${isInvalid ? 'is-invalid' : ''}`}
        value={text}
        disabled={disabled}
        onFocus={() => setIsEditing(true)}
        onChange={(e) => {
          setText(e.target.value);
          setIsInvalid(false);
        }}
        onBlur={() => {
          if (isEditing) {
            const parsed = parseTimeInput(text);
            if (parsed !== null) {
              onCommit(parsed);
            } else {
              setText(formatTime(valueSec));
            }
            setIsEditing(false);
            setIsInvalid(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitText();
          } else if (e.key === 'Escape') {
            setText(formatTime(valueSec));
            setIsEditing(false);
            setIsInvalid(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="01:23.5"
        aria-label={tag}
      />

      <button
        type="button"
        className="micro-btn"
        disabled={disabled}
        onClick={(e) => {
          e.currentTarget.blur();
          onCommit(roundToTenth(currentTime));
        }}
        title="Встановити поточну позицію playhead"
      >
        Тут
      </button>

      <div className="nudge-strip">
        {NUDGE_STEPS.map((delta) => (
          <button
            key={delta}
            type="button"
            className="micro-btn mono-num"
            disabled={disabled}
            onClick={(e) => {
              e.currentTarget.blur();
              onNudge(delta);
            }}
          >
            {delta > 0 ? `+${delta}` : `${delta}`}
          </button>
        ))}
      </div>
    </div>
  );
}

type DragTarget = 'a' | 'b' | 'seek' | null;

export function AbControls({
  bounds,
  durationSec,
  currentTime,
  loopEnabled,
  disabled,
  savedLoopEdges = [],
  onBoundsChange,
  onResetBounds,
  onSeek,
}: AbControlsProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const dragTargetRef = useRef<DragTarget>(null);
  const [railWidthPx, setRailWidthPx] = useState(800);
  const [magnetEnabled, setMagnetEnabled] = useState(true);
  const [snapGuideSec, setSnapGuideSec] = useState<number | null>(null);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    setRailWidthPx(el.clientWidth || 800);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setRailWidthPx(entry.contentRect.width);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rulerTicks = useMemo(
    () => computeRulerTicks(durationSec, railWidthPx),
    [durationSec, railWidthPx],
  );

  const clientXToSeconds = (clientX: number): number => {
    const rail = railRef.current;
    if (!rail || durationSec <= 0) return 0;
    const rect = rail.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return ratio * durationSec;
  };

  const resolveSnappedSec = (
    rawSec: number,
    targetKind: Exclude<DragTarget, null>,
    altBypass: boolean,
  ): number => {
    if (!magnetEnabled || altBypass || durationSec <= 0) {
      setSnapGuideSec(null);
      return roundToTenth(rawSec);
    }

    const targets: SnapTarget[] = [
      { timeSec: 0, kind: 'edge' },
      { timeSec: durationSec, kind: 'edge' },
      ...savedLoopEdges.map((t) => ({ timeSec: t, kind: 'loopEdge' as const })),
    ];

    if (targetKind === 'seek') {
      targets.push({ timeSec: bounds.startSec, kind: 'boundA' });
      targets.push({ timeSec: bounds.endSec, kind: 'boundB' });
    } else {
      targets.push({ timeSec: currentTime, kind: 'playhead' });
    }

    const thresholdSec = pixelThresholdToSeconds(
      SNAP_THRESHOLD_PX,
      railWidthPx,
      durationSec,
    );
    const result = snapToTargets(rawSec, targets, thresholdSec);

    if (result.snapped) {
      setSnapGuideSec(result.timeSec);
      return roundToTenth(result.timeSec);
    }

    setSnapGuideSec(null);
    return roundToTenth(rawSec);
  };

  const applyDrag = (
    target: DragTarget,
    clientX: number,
    altBypass: boolean,
  ) => {
    if (!target || disabled || durationSec <= 0) return;
    const rawSec = clientXToSeconds(clientX);
    const sec = resolveSnappedSec(rawSec, target, altBypass);

    if (target === 'a') {
      onBoundsChange(nudgeLoopStart(bounds, sec - bounds.startSec, durationSec));
    } else if (target === 'b') {
      onBoundsChange(nudgeLoopEnd(bounds, sec - bounds.endSec, durationSec));
    } else if (target === 'seek') {
      onSeek(sec);
    }
  };

  const startDrag = (target: DragTarget, e: React.PointerEvent<HTMLElement>) => {
    if (disabled || durationSec <= 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragTargetRef.current = target;
    applyDrag(target, e.clientX, e.altKey);
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragTargetRef.current) return;
    applyDrag(dragTargetRef.current, e.clientX, e.altKey);
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (dragTargetRef.current) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      dragTargetRef.current = null;
      setSnapGuideSec(null);
    }
  };

  const safeDur = durationSec > 0 ? durationSec : 1;
  const startPct = Math.min(100, Math.max(0, (bounds.startSec / safeDur) * 100));
  const endPct = Math.min(100, Math.max(startPct, (bounds.endSec / safeDur) * 100));
  const playheadPct = Math.min(100, Math.max(0, (currentTime / safeDur) * 100));
  const loopLen = roundToTenth(Math.max(0, bounds.endSec - bounds.startSec));

  return (
    <section className="timeline-dock">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <button
            type="button"
            className={`studio-btn ${magnetEnabled ? 'is-active' : ''}`}
            onClick={(e) => {
              e.currentTarget.blur();
              setMagnetEnabled((prev) => !prev);
            }}
            title="Магнітне прилипання (утримуйте Alt при перетягуванні щоб тимчасово вимкнути)"
          >
            <Magnet size={13} />
            <span>Магніт</span>
          </button>

          <BoundInlineEditor
            tag="In (A)"
            valueSec={bounds.startSec}
            currentTime={currentTime}
            disabled={disabled}
            onCommit={(sec) =>
              onBoundsChange(
                nudgeLoopStart(bounds, sec - bounds.startSec, durationSec),
              )
            }
            onNudge={(delta) =>
              onBoundsChange(nudgeLoopStart(bounds, delta, durationSec))
            }
          />

          <BoundInlineEditor
            tag="Out (B)"
            valueSec={bounds.endSec}
            currentTime={currentTime}
            disabled={disabled}
            onCommit={(sec) =>
              onBoundsChange(
                nudgeLoopEnd(bounds, sec - bounds.endSec, durationSec),
              )
            }
            onNudge={(delta) =>
              onBoundsChange(nudgeLoopEnd(bounds, delta, durationSec))
            }
          />
        </div>

        <div className="timeline-toolbar-right">
          <span className="mono-num loop-duration-label">
            Довжина: {loopLen.toFixed(1)} с
          </span>
          <button
            type="button"
            className="studio-btn"
            disabled={disabled}
            onClick={(e) => {
              e.currentTarget.blur();
              onResetBounds();
            }}
            title="Скинути In / Out на весь трек"
          >
            <RotateCcw size={13} />
            <span>Скинути</span>
          </button>
        </div>
      </div>

      {/* Premiere-style Ruler + Track Surface */}
      <div
        ref={railRef}
        className={`premiere-timeline ${disabled ? 'is-disabled' : ''}`}
        onPointerDown={(e) => startDrag('seek', e)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="group"
        aria-label="Таймлайн A–B лупу"
      >
        {/* Time Ruler */}
        <div className="timeline-ruler">
          {rulerTicks.map((tick, idx) => {
            const leftPct = (tick.timeSec / safeDur) * 100;
            return (
              <div
                key={`${idx}-${tick.timeSec}`}
                className={`ruler-tick ${tick.major ? 'is-major' : ''}`}
                style={{ left: `${leftPct}%` }}
              >
                <span className="ruler-mark" />
                {tick.label && (
                  <span className="ruler-label mono-num">{tick.label}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Track Lane */}
        <div className="timeline-track">
          <div className="track-clip-bar" />

          {savedLoopEdges.map((edgeSec, idx) => (
            <div
              key={`${idx}-${edgeSec}`}
              className="saved-edge-marker"
              style={{ left: `${(edgeSec / safeDur) * 100}%` }}
            />
          ))}

          <div
            className={`loop-region ${loopEnabled ? 'is-active' : ''}`}
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          />

          <button
            type="button"
            className="bracket-handle handle-in"
            style={{ left: `${startPct}%` }}
            disabled={disabled}
            onPointerDown={(e) => startDrag('a', e)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title={`In (A): ${formatTime(bounds.startSec)}`}
            aria-label="Маркер A (In)"
          >
            <span className="bracket-glyph">[</span>
          </button>

          <button
            type="button"
            className="bracket-handle handle-out"
            style={{ left: `${endPct}%` }}
            disabled={disabled}
            onPointerDown={(e) => startDrag('b', e)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title={`Out (B): ${formatTime(bounds.endSec)}`}
            aria-label="Маркер B (Out)"
          >
            <span className="bracket-glyph">]</span>
          </button>
        </div>

        {/* Snap Vertical Guide */}
        {snapGuideSec !== null && durationSec > 0 && (
          <div
            className="snap-guide-line"
            style={{ left: `${(snapGuideSec / safeDur) * 100}%` }}
          />
        )}

        {/* Premiere Playhead */}
        <div
          className="premiere-playhead"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="playhead-head" />
          <div className="playhead-stem" />
        </div>
      </div>
    </section>
  );
}
