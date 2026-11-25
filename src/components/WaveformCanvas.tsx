import { useEffect, useRef } from 'react';
import type { LoopBounds } from '../lib/loopBounds';
import { resampleWaveformViewport } from '../lib/waveform';
import type { WaveformData } from '../types';

export interface WaveformCanvasProps {
  waveform: WaveformData | null;
  durationSec: number;
  viewStartSec: number;
  viewEndSec: number;
  bounds: LoopBounds;
  loopEnabled: boolean;
  widthPx: number;
  heightPx: number;
}

const PEAK_ACTIVE_COLOR = 'rgba(77, 163, 255, 0.52)';
const RMS_ACTIVE_COLOR = 'rgba(130, 198, 255, 0.92)';
const PEAK_INACTIVE_COLOR = 'rgba(84, 180, 148, 0.46)';
const RMS_INACTIVE_COLOR = 'rgba(118, 218, 184, 0.84)';
const PEAK_OUTSIDE_COLOR = 'rgba(116, 134, 150, 0.24)';
const RMS_OUTSIDE_COLOR = 'rgba(148, 168, 184, 0.42)';

export function WaveformCanvas({
  waveform,
  durationSec,
  viewStartSec,
  viewEndSec,
  bounds,
  loopEnabled,
  widthPx,
  heightPx,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = Math.max(1, Math.round(widthPx));
    const h = Math.max(1, Math.round(heightPx));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const midY = h * 0.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, Math.round(midY) - 0.5, w, 1);

    if (
      !waveform ||
      waveform.peaks.length === 0 ||
      durationSec <= 0 ||
      viewEndSec <= viewStartSec
    ) {
      return;
    }

    const colCount = Math.max(1, Math.min(1600, w));
    const viewStartRatio = viewStartSec / durationSec;
    const viewEndRatio = viewEndSec / durationSec;
    const { peaks, rms } = resampleWaveformViewport(
      waveform.peaks,
      waveform.rms,
      viewStartRatio,
      viewEndRatio,
      colCount,
    );

    const colW = w / colCount;
    const barW = colW > 1.8 ? colW - 0.4 : Math.max(1, colW);
    const maxHalfH = h * 0.44;
    const viewSpan = viewEndSec - viewStartSec;
    const insidePeakColor = loopEnabled ? PEAK_ACTIVE_COLOR : PEAK_INACTIVE_COLOR;
    const insideRmsColor = loopEnabled ? RMS_ACTIVE_COLOR : RMS_INACTIVE_COLOR;

    // Pass 1: Peak outer envelope
    let lastFill = '';
    for (let i = 0; i < colCount; i++) {
      const colTimeSec = viewStartSec + ((i + 0.5) / colCount) * viewSpan;
      const inBounds =
        colTimeSec >= bounds.startSec - 1e-6 &&
        colTimeSec <= bounds.endSec + 1e-6;
      const fill = inBounds ? insidePeakColor : PEAK_OUTSIDE_COLOR;
      if (fill !== lastFill) {
        ctx.fillStyle = fill;
        lastFill = fill;
      }
      const peakH = Math.max(0.75, peaks[i] * maxHalfH);
      ctx.fillRect(i * colW, midY - peakH, barW, peakH * 2);
    }

    // Pass 2: Brighter inner RMS core
    lastFill = '';
    for (let i = 0; i < colCount; i++) {
      const colTimeSec = viewStartSec + ((i + 0.5) / colCount) * viewSpan;
      const inBounds =
        colTimeSec >= bounds.startSec - 1e-6 &&
        colTimeSec <= bounds.endSec + 1e-6;
      const fill = inBounds ? insideRmsColor : RMS_OUTSIDE_COLOR;
      if (fill !== lastFill) {
        ctx.fillStyle = fill;
        lastFill = fill;
      }
      const rmsH = Math.max(0.5, rms[i] * maxHalfH);
      ctx.fillRect(i * colW, midY - rmsH, barW, rmsH * 2);
    }
  }, [
    waveform,
    durationSec,
    viewStartSec,
    viewEndSec,
    bounds.startSec,
    bounds.endSec,
    loopEnabled,
    widthPx,
    heightPx,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-canvas"
      aria-hidden="true"
    />
  );
}
