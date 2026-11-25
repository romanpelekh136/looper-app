import { describe, expect, it } from 'vitest';
import { resampleWaveformViewport } from '../waveform';

describe('resampleWaveformViewport', () => {
  it('returns empty arrays for empty input or invalid ranges/column counts', () => {
    expect(resampleWaveformViewport([], [], 0, 1, 100)).toEqual({ peaks: [], rms: [] });
    expect(resampleWaveformViewport([0.5, 0.8], [0.2, 0.4], 0, 1, 0)).toEqual({
      peaks: [],
      rms: [],
    });
    expect(resampleWaveformViewport([0.5, 0.8], [0.2, 0.4], 0.6, 0.6, 50)).toEqual({
      peaks: [],
      rms: [],
    });
  });

  it('preserves sharp transients using max(peak) when downsampling', () => {
    const peaks = new Array(100).fill(0.1);
    const rms = new Array(100).fill(0.05);
    peaks[42] = 1.0;
    rms[42] = 0.6;

    const resampled = resampleWaveformViewport(peaks, rms, 0, 1, 10);
    expect(resampled.peaks).toHaveLength(10);
    expect(resampled.rms).toHaveLength(10);
    expect(resampled.peaks[4]).toBe(1.0);
    expect(resampled.rms[4]).toBeLessThanOrEqual(resampled.peaks[4]);
    expect(resampled.peaks[0]).toBeCloseTo(0.1, 6);
  });

  it('slices only the visible zoomed viewport sub-range', () => {
    const peaks = [0.1, 0.1, 0.9, 0.8, 0.2, 0.2, 0.3, 0.3];
    const rms = [0.05, 0.05, 0.5, 0.4, 0.1, 0.1, 0.15, 0.15];

    // Second quarter [0.25, 0.5] corresponds to indices 2..3 (0.9 and 0.8)
    const slice = resampleWaveformViewport(peaks, rms, 0.25, 0.5, 2);
    expect(slice.peaks[0]).toBeCloseTo(0.9, 6);
    expect(slice.peaks[1]).toBeCloseTo(0.8, 6);
    expect(slice.rms[0]).toBeCloseTo(0.5, 6);
    expect(slice.rms[1]).toBeCloseTo(0.4, 6);
  });

  it('upsamples cleanly when zoomed beyond bin density and sanitizes invalid values', () => {
    const peaks = [0.2, Number.NaN, 1.5];
    const rms = [0.1, 0.5, 2.0];

    const up = resampleWaveformViewport(peaks, rms, 0, 1, 12);
    expect(up.peaks).toHaveLength(12);
    expect(up.rms).toHaveLength(12);
    for (let i = 0; i < up.peaks.length; i++) {
      expect(Number.isFinite(up.peaks[i])).toBe(true);
      expect(up.peaks[i]).toBeGreaterThanOrEqual(0);
      expect(up.peaks[i]).toBeLessThanOrEqual(1);
      expect(up.rms[i]).toBeLessThanOrEqual(up.peaks[i] + 1e-9);
    }
    expect(up.peaks[11]).toBeCloseTo(1.0, 6);
  });
});
