export interface ResampledWaveform {
  peaks: number[];
  rms: number[];
}

function sanitizeUnit(val: number | undefined): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
  return Math.min(1, Math.max(0, val));
}

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(1, Math.max(0, val));
}

/**
 * Slices and resamples full-track waveform arrays into `columnCount` visual bars
 * for `[viewStartRatio, viewEndRatio]`. Uses max(peak) when downsampling so
 * sharp guitar transients are never dropped between pixels, and linear
 * interpolation when zoomed deeper than the raw bin resolution.
 */
export function resampleWaveformViewport(
  peaks: number[],
  rms: number[],
  viewStartRatio: number,
  viewEndRatio: number,
  columnCount: number,
): ResampledWaveform {
  const n = peaks.length;
  const cols = Math.floor(columnCount);
  if (n === 0 || cols <= 0 || !Number.isFinite(cols)) {
    return { peaks: [], rms: [] };
  }

  const startR = clamp01(viewStartRatio);
  const endR = clamp01(viewEndRatio);
  const spanR = endR - startR;
  if (spanR <= 1e-9) {
    return { peaks: [], rms: [] };
  }

  const outPeaks = new Array<number>(cols);
  const outRms = new Array<number>(cols);

  for (let i = 0; i < cols; i++) {
    const fStart = (startR + (i / cols) * spanR) * n;
    const fEnd = (startR + ((i + 1) / cols) * spanR) * n;

    if (fEnd - fStart >= 1) {
      const bStart = Math.max(0, Math.min(n - 1, Math.floor(fStart)));
      const bEnd = Math.max(bStart, Math.min(n - 1, Math.ceil(fEnd) - 1));

      let maxPeak = 0;
      let rmsSum = 0;
      let count = 0;

      for (let b = bStart; b <= bEnd; b++) {
        const p = sanitizeUnit(peaks[b]);
        const r = Math.min(p, sanitizeUnit(rms[b]));
        if (p > maxPeak) maxPeak = p;
        rmsSum += r;
        count += 1;
      }

      const avgRms = count > 0 ? rmsSum / count : 0;
      outPeaks[i] = maxPeak;
      outRms[i] = Math.min(maxPeak, avgRms);
    } else {
      const centerIdx = Math.max(0, Math.min(n - 1, (fStart + fEnd) * 0.5 - 0.5));
      const idx0 = Math.floor(centerIdx);
      const idx1 = Math.min(n - 1, idx0 + 1);
      const frac = centerIdx - idx0;

      const p0 = sanitizeUnit(peaks[idx0]);
      const p1 = sanitizeUnit(peaks[idx1]);
      const r0 = Math.min(p0, sanitizeUnit(rms[idx0]));
      const r1 = Math.min(p1, sanitizeUnit(rms[idx1]));

      const p = p0 + (p1 - p0) * frac;
      const r = Math.min(p, r0 + (r1 - r0) * frac);
      outPeaks[i] = p;
      outRms[i] = r;
    }
  }

  return { peaks: outPeaks, rms: outRms };
}
