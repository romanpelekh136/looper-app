import { useEffect, useMemo, useRef, useState } from 'react';
import { Magnet, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
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
import {
  createFullViewport,
  ensureRangeVisible,
  getMaxZoom,
  panViewport,
  secToViewportPct,
  viewportRatioToSec,
  zoomAroundAnchor,
  type TimelineViewport,
} from '../lib/timelineZoom';
import type { WaveformData } from '../types';
import { WaveformCanvas } from './WaveformCanvas';

export interface AbControlsProps {
  bounds: LoopBounds;
  durationSec: number;
  currentTime: number;
  loopEnabled: boolean;
  disabled: boolean;
  savedLoopEdges?: number[];
  waveform?: WaveformData | null;
  isWaveformLoading?: boolean;
  videoKey?: string | null;
  focusRangeSeq?: number;
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
        title="Set to current playhead position"
      >
        Here
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
  waveform = null,
  isWaveformLoading = false,
  videoKey = null,
  focusRangeSeq = 0,
  onBoundsChange,
  onResetBounds,
  onSeek,
}: AbControlsProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const clipBarRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const dragTargetRef = useRef<DragTarget>(null);
  const overviewDragRef = useRef<{
    startClientX: number;
    initialStartSec: number;
  } | null>(null);
  const prevVideoKeyRef = useRef<string | null>(videoKey);
  const prevFocusSeqRef = useRef<number>(focusRangeSeq);

  const [railWidthPx, setRailWidthPx] = useState(800);
  const [trackHeightPx, setTrackHeightPx] = useState(54);
  const [magnetEnabled, setMagnetEnabled] = useState(true);
  const [snapGuideSec, setSnapGuideSec] = useState<number | null>(null);
  const [viewport, setViewport] = useState<TimelineViewport>(() =>
    createFullViewport(durationSec),
  );

  const wheelStateRef = useRef({
    viewport,
    durationSec,
    disabled,
    railWidthPx,
  });
  wheelStateRef.current = { viewport, durationSec, disabled, railWidthPx };

  // Reset zoom on song switch, and keep 1x viewport synchronized with real duration
  useEffect(() => {
    const keyChanged = prevVideoKeyRef.current !== videoKey;
    prevVideoKeyRef.current = videoKey;

    setViewport((prev) => {
      if (keyChanged || durationSec <= 0) {
        return createFullViewport(durationSec);
      }
      if (prev.zoom <= 1.001) {
        return createFullViewport(durationSec);
      }
      if (prev.viewEndSec > durationSec) {
        const span = Math.min(durationSec, prev.viewEndSec - prev.viewStartSec);
        const start = Math.max(0, durationSec - span);
        return {
          zoom: Math.min(getMaxZoom(durationSec), durationSec / Math.max(0.001, span)),
          viewStartSec: start,
          viewEndSec: durationSec,
        };
      }
      return prev;
    });
  }, [videoKey, durationSec]);

  // Frame newly applied saved loops if zoomed away from them
  useEffect(() => {
    if (focusRangeSeq === prevFocusSeqRef.current) return;
    prevFocusSeqRef.current = focusRangeSeq;
    if (durationSec <= 0) return;
    setViewport((prev) =>
      ensureRangeVisible(prev, durationSec, bounds.startSec, bounds.endSec),
    );
  }, [focusRangeSeq, durationSec, bounds.startSec, bounds.endSec]);

  // Measure rail width and waveform clip bar height cleanly
  useEffect(() => {
    const rail = railRef.current;
    const clip = clipBarRef.current;
    if (!rail && !clip) return;

    if (rail && rail.clientWidth > 0) {
      setRailWidthPx(rail.clientWidth);
    }
    if (clip && clip.clientHeight > 0) {
      setTrackHeightPx(clip.clientHeight);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === rail && entry.contentRect.width > 0) {
          setRailWidthPx(entry.contentRect.width);
        } else if (entry.target === clip && entry.contentRect.height > 0) {
          setTrackHeightPx(entry.contentRect.height);
        }
      }
    });

    if (rail) observer.observe(rail);
    if (clip) observer.observe(clip);
    return () => observer.disconnect();
  }, []);

  // Native non-passive wheel listener: Ctrl+Wheel zooms around cursor without zooming WebView2
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const handleWheel = (e: WheelEvent) => {
      const state = wheelStateRef.current;
      if (state.disabled || state.durationSec <= 0) return;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = rail.getBoundingClientRect();
        const ratio = Math.min(
          Math.max((e.clientX - rect.left) / Math.max(1, rect.width), 0),
          1,
        );
        const clampedDelta = Math.max(-150, Math.min(150, e.deltaY));
        const factor = Math.exp(-clampedDelta * 0.0022);
        setViewport((prev) =>
          zoomAroundAnchor(prev, state.durationSec, ratio, factor),
        );
        return;
      }

      if (state.viewport.zoom > 1.001) {
        e.preventDefault();
        const rawDelta =
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const span = state.viewport.viewEndSec - state.viewport.viewStartSec;
        const deltaSec =
          (rawDelta / Math.max(200, state.railWidthPx)) * span * 0.85;
        setViewport((prev) => panViewport(prev, state.durationSec, deltaSec));
      }
    };

    rail.addEventListener('wheel', handleWheel, { passive: false });
    return () => rail.removeEventListener('wheel', handleWheel);
  }, []);

  const rulerTicks = useMemo(
    () =>
      computeRulerTicks(
        durationSec,
        railWidthPx,
        viewport.viewStartSec,
        viewport.viewEndSec,
      ),
    [durationSec, railWidthPx, viewport.viewStartSec, viewport.viewEndSec],
  );

  const clientXToSeconds = (clientX: number): number => {
    const rail = railRef.current;
    if (!rail || durationSec <= 0) return 0;
    const rect = rail.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return viewportRatioToSec(ratio, viewport);
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

    const viewSpan = Math.max(0.001, viewport.viewEndSec - viewport.viewStartSec);
    const thresholdSec = pixelThresholdToSeconds(
      SNAP_THRESHOLD_PX,
      railWidthPx,
      viewSpan,
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

  const startOverviewDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || durationSec <= 0 || viewport.zoom <= 1.001) return;
    const bar = overviewRef.current;
    if (!bar) return;

    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const rect = bar.getBoundingClientRect();
    const clickRatio = Math.min(
      Math.max((e.clientX - rect.left) / Math.max(1, rect.width), 0),
      1,
    );
    const clickSec = clickRatio * durationSec;
    const span = viewport.viewEndSec - viewport.viewStartSec;

    let initialStart = viewport.viewStartSec;
    if (clickSec < viewport.viewStartSec || clickSec > viewport.viewEndSec) {
      const centered = panViewport(
        viewport,
        durationSec,
        clickSec - span * 0.5 - viewport.viewStartSec,
      );
      setViewport(centered);
      initialStart = centered.viewStartSec;
    }

    overviewDragRef.current = {
      startClientX: e.clientX,
      initialStartSec: initialStart,
    };
  };

  const moveOverviewDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = overviewDragRef.current;
    const bar = overviewRef.current;
    if (!drag || !bar || durationSec <= 0) return;

    const rect = bar.getBoundingClientRect();
    const dx = e.clientX - drag.startClientX;
    const targetStartSec =
      drag.initialStartSec + (dx / Math.max(1, rect.width)) * durationSec;

    setViewport((prev) =>
      panViewport(prev, durationSec, targetStartSec - prev.viewStartSec),
    );
  };

  const endOverviewDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (overviewDragRef.current) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      overviewDragRef.current = null;
    }
  };

  const safeDur = durationSec > 0 ? durationSec : 1;
  const maxZoom = getMaxZoom(durationSec);
  const isZoomed = viewport.zoom > 1.001 && durationSec > 0;
  const startPct = secToViewportPct(bounds.startSec, viewport);
  const endPct = secToViewportPct(bounds.endSec, viewport);
  const visRegionLeft = Math.min(100, Math.max(0, startPct));
  const visRegionRight = Math.min(100, Math.max(visRegionLeft, endPct));
  const playheadPct = secToViewportPct(currentTime, viewport);
  const snapPct =
    snapGuideSec !== null ? secToViewportPct(snapGuideSec, viewport) : null;
  const loopLen = roundToTenth(Math.max(0, bounds.endSec - bounds.startSec));

  const overviewThumbLeftPct = (viewport.viewStartSec / safeDur) * 100;
  const overviewThumbWidthPct = Math.min(
    100,
    Math.max(2, ((viewport.viewEndSec - viewport.viewStartSec) / safeDur) * 100),
  );
  const overviewLoopLeftPct = (bounds.startSec / safeDur) * 100;
  const overviewLoopWidthPct = Math.max(
    0,
    ((bounds.endSec - bounds.startSec) / safeDur) * 100,
  );
  const overviewPlayheadPct = Math.min(100, Math.max(0, (currentTime / safeDur) * 100));

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
            title="Magnetic snapping (hold Alt while dragging to bypass)"
          >
            <Magnet size={13} />
            <span>Magnet</span>
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
          <div className="timeline-zoom-group">
            <button
              type="button"
              className="micro-btn"
              disabled={disabled || !isZoomed}
              onClick={(e) => {
                e.currentTarget.blur();
                setViewport((prev) =>
                  zoomAroundAnchor(prev, durationSec, 0.5, 1 / 1.35),
                );
              }}
              title="Zoom out"
              aria-label="Zoom out timeline"
            >
              <ZoomOut size={12} />
            </button>

            <button
              type="button"
              className={`micro-btn mono-num zoom-readout-btn ${isZoomed ? 'is-active' : ''}`}
              disabled={disabled}
              onClick={(e) => {
                e.currentTarget.blur();
                setViewport(createFullViewport(durationSec));
              }}
              title="Reset zoom (Ctrl + Scroll on timeline to zoom)"
            >
              {viewport.zoom.toFixed(1)}x
            </button>

            <button
              type="button"
              className="micro-btn"
              disabled={disabled || viewport.zoom >= maxZoom - 0.01}
              onClick={(e) => {
                e.currentTarget.blur();
                setViewport((prev) =>
                  zoomAroundAnchor(prev, durationSec, 0.5, 1.35),
                );
              }}
              title="Zoom in"
              aria-label="Zoom in timeline"
            >
              <ZoomIn size={12} />
            </button>
          </div>

          <span className="mono-num loop-duration-label">
            Length: {loopLen.toFixed(1)} s
          </span>
          <button
            type="button"
            className="studio-btn"
            disabled={disabled}
            onClick={(e) => {
              e.currentTarget.blur();
              onResetBounds();
            }}
            title="Reset In / Out to full track"
          >
            <RotateCcw size={13} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Premiere-style Ruler + Audio Waveform Track Surface */}
      <div
        ref={railRef}
        className={`premiere-timeline ${disabled ? 'is-disabled' : ''}`}
        onPointerDown={(e) => startDrag('seek', e)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="group"
        aria-label="A–B loop timeline"
        title={disabled ? undefined : 'Click to seek · Ctrl + Scroll to zoom'}
      >
        {/* Time Ruler */}
        <div className="timeline-ruler">
          {rulerTicks.map((tick, idx) => {
            const leftPct = secToViewportPct(tick.timeSec, viewport);
            if (leftPct < -2 || leftPct > 102) return null;
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
          <div ref={clipBarRef} className="track-clip-bar">
            <WaveformCanvas
              waveform={waveform}
              durationSec={durationSec}
              viewStartSec={viewport.viewStartSec}
              viewEndSec={viewport.viewEndSec}
              bounds={bounds}
              loopEnabled={loopEnabled}
              widthPx={railWidthPx}
              heightPx={trackHeightPx}
            />
            {isWaveformLoading && !waveform && !disabled && (
              <span className="waveform-loading-tag mono-num">
                Analyzing audio...
              </span>
            )}
          </div>

          {savedLoopEdges.map((edgeSec, idx) => {
            const edgePct = secToViewportPct(edgeSec, viewport);
            if (edgePct < -1 || edgePct > 101) return null;
            return (
              <div
                key={`${idx}-${edgeSec}`}
                className="saved-edge-marker"
                style={{ left: `${edgePct}%` }}
              />
            );
          })}

          {visRegionRight > visRegionLeft && (
            <div
              className={`loop-region ${loopEnabled ? 'is-active' : ''}`}
              style={{
                left: `${visRegionLeft}%`,
                width: `${visRegionRight - visRegionLeft}%`,
              }}
            />
          )}

          {startPct >= -1 && startPct <= 101 && (
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
              aria-label="Marker A (In)"
            >
              <span className="bracket-glyph">[</span>
            </button>
          )}

          {endPct >= -1 && endPct <= 101 && (
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
              aria-label="Marker B (Out)"
            >
              <span className="bracket-glyph">]</span>
            </button>
          )}
        </div>

        {/* Snap Vertical Guide */}
        {snapPct !== null && snapPct >= 0 && snapPct <= 100 && durationSec > 0 && (
          <div className="snap-guide-line" style={{ left: `${snapPct}%` }} />
        )}

        {/* Premiere Playhead */}
        {playheadPct >= -0.5 && playheadPct <= 100.5 && (
          <div
            className="premiere-playhead"
            style={{ left: `${playheadPct}%` }}
          >
            <div className="playhead-head" />
            <div className="playhead-stem" />
          </div>
        )}
      </div>

      {/* Slim Overview Pan Bar (always reserved to prevent layout shift when zooming) */}
      <div
        ref={overviewRef}
        className={`timeline-overview-bar ${!isZoomed ? 'is-idle' : ''} ${disabled ? 'is-disabled' : ''}`}
        onPointerDown={startOverviewDrag}
        onPointerMove={moveOverviewDrag}
        onPointerUp={endOverviewDrag}
        onPointerCancel={endOverviewDrag}
        title={
          isZoomed
            ? 'Drag or click to pan zoomed timeline'
            : 'Full track visible (Ctrl + Scroll on timeline to zoom)'
        }
        role="scrollbar"
        aria-label="Zoomed timeline pan bar"
        aria-valuenow={Math.round(overviewThumbLeftPct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {!disabled && durationSec > 0 && (
          <>
            <div
              className={`timeline-overview-loop ${loopEnabled ? 'is-active' : ''}`}
              style={{
                left: `${overviewLoopLeftPct}%`,
                width: `${overviewLoopWidthPct}%`,
              }}
            />
            <div
              className="timeline-overview-playhead"
              style={{ left: `${overviewPlayheadPct}%` }}
            />
            <div
              className="timeline-overview-thumb"
              style={{
                left: `${overviewThumbLeftPct}%`,
                width: `${overviewThumbWidthPct}%`,
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}
