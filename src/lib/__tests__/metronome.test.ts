import { describe, expect, it } from 'vitest';
import { DEFAULT_METRONOME_CONFIG, type MetronomeConfig } from '../../types';
import {
  buildTickInfo,
  calculateTapTempo,
  clampBpm,
  effectiveBpm,
  getTicksInTrackWindow,
  snapBoundsToGrid,
  stepIntervalSec,
  trackDeltaToAudioDelaySec,
} from '../metronome';

function makeConfig(patch: Partial<MetronomeConfig> = {}): MetronomeConfig {
  return { ...DEFAULT_METRONOME_CONFIG, ...patch };
}

describe('metronome basic tempo calculations', () => {
  it('clamps BPM to [30, 300] and computes step interval and effective BPM', () => {
    expect(clampBpm(10)).toBe(30);
    expect(clampBpm(450)).toBe(300);
    expect(clampBpm(123.6)).toBe(124);
    expect(clampBpm(Number.NaN)).toBe(120);

    expect(stepIntervalSec(120, 1)).toBeCloseTo(0.5, 6);
    expect(stepIntervalSec(120, 2)).toBeCloseTo(0.25, 6);
    expect(stepIntervalSec(120, 3)).toBeCloseTo(1 / 6, 6);
    expect(stepIntervalSec(120, 4)).toBeCloseTo(0.125, 6);

    expect(effectiveBpm(120, 0.75)).toBe(90);
    expect(effectiveBpm(100, 0.85)).toBe(85);
    expect(effectiveBpm(120, 1.25)).toBe(150);
  });

  it('scales track delta to real-time audio delay using playbackRate', () => {
    expect(trackDeltaToAudioDelaySec(10.5, 10.0, 1.0)).toBeCloseTo(0.5, 6);
    expect(trackDeltaToAudioDelaySec(10.5, 10.0, 0.5)).toBeCloseTo(1.0, 6);
    expect(trackDeltaToAudioDelaySec(10.5, 10.0, 0.75)).toBeCloseTo(2 / 3, 6);
    expect(trackDeltaToAudioDelaySec(10.5, 10.0, 1.25)).toBeCloseTo(0.4, 6);
  });
});

describe('getTicksInTrackWindow & Euclidean beat indexing', () => {
  it('computes beat indices cleanly in trackGrid mode before and after offsetSec', () => {
    const cfg = makeConfig({
      bpm: 120,
      beatsPerBar: 4,
      subdivision: 1,
      syncMode: 'trackGrid',
      offsetSec: 2.0,
    });

    // Window spanning before and across offsetSec (0.0 .. 2.6 -> beats at 0.0, 0.5, 1.0, 1.5, 2.0, 2.5)
    const ticks = getTicksInTrackWindow(0.0, 2.6, cfg, 0);
    expect(ticks.map((t) => t.trackTimeSec)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(ticks[0]).toMatchObject({ beatInBar: 0, isDownbeat: true, isMainBeat: true });
    expect(ticks[3]).toMatchObject({ beatInBar: 3, isDownbeat: false, isMainBeat: true });
    expect(ticks[4]).toMatchObject({ beatInBar: 0, isDownbeat: true, isMainBeat: true });
    expect(ticks[5]).toMatchObject({ beatInBar: 1, isDownbeat: false, isMainBeat: true });
  });

  it('handles subdivisions and negative step indices accurately', () => {
    const tick = buildTickInfo(-1, 1.75, 4, 2);
    expect(tick).toMatchObject({
      beatInBar: 3,
      subIndex: 1,
      isMainBeat: false,
      isDownbeat: false,
    });

    const cfg = makeConfig({
      bpm: 120,
      beatsPerBar: 3,
      subdivision: 2,
      syncMode: 'trackGrid',
      offsetSec: 10.0,
    });
    const ticks = getTicksInTrackWindow(10.0, 10.9, cfg, 10.0);
    // step = 0.25s => 10.0, 10.25, 10.5, 10.75
    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toMatchObject({ isDownbeat: true, isMainBeat: true, beatInBar: 0 });
    expect(ticks[1]).toMatchObject({ isDownbeat: false, isMainBeat: false, beatInBar: 0 });
    expect(ticks[2]).toMatchObject({ isDownbeat: false, isMainBeat: true, beatInBar: 1 });
  });

  it('anchors beat 1 to pointA in loopStart mode and skips ticks before pointA', () => {
    const cfg = makeConfig({
      bpm: 120,
      beatsPerBar: 4,
      subdivision: 1,
      syncMode: 'loopStart',
      offsetSec: 1.2,
    });

    const ticks = getTicksInTrackWindow(10.0, 11.6, cfg, 10.5);
    expect(ticks.map((t) => t.trackTimeSec)).toEqual([10.5, 11.0, 11.5]);
    expect(ticks[0]).toMatchObject({ beatInBar: 0, isDownbeat: true });
    expect(ticks[1]).toMatchObject({ beatInBar: 1, isDownbeat: false });
  });
});

describe('calculateTapTempo & snapBoundsToGrid', () => {
  it('calculates tap tempo and resets after gaps exceeding maxGapMs', () => {
    expect(calculateTapTempo([])).toBeNull();
    expect(calculateTapTempo([1000])).toBeNull();
    expect(calculateTapTempo([1000, 1500, 2000])).toBe(120);
    // 60000 / 667 ~= 90 BPM
    expect(calculateTapTempo([1000, 1667, 2333, 3000])).toBe(90);
    // Gap > 2500ms resets prior taps; only trailing cluster [5000, 5500, 6000] counts
    expect(calculateTapTempo([1000, 2000, 5000, 5500, 6000])).toBe(120);
    // Very slow gap -> ignored -> single trailing tap -> null
    expect(calculateTapTempo([1000, 5000])).toBeNull();
    // Extreme fast taps clamp to 300 BPM
    expect(calculateTapTempo([1000, 1050, 1100])).toBe(300);
  });

  it('snaps A-B bounds to beats or full bars respecting offsetSec and duration', () => {
    const cfg = makeConfig({
      bpm: 120,
      beatsPerBar: 4,
      syncMode: 'trackGrid',
      offsetSec: 0.5,
    });
    // Beat step = 0.5s, Bar step = 2.0s; grid bars at 0.5, 2.5, 4.5, 6.5...
    expect(
      snapBoundsToGrid({ startSec: 2.3, endSec: 6.7 }, 30, cfg, 'bar'),
    ).toEqual({ startSec: 2.5, endSec: 6.5 });

    // Narrow bounds snapping to same bar expand by 1 bar
    expect(
      snapBoundsToGrid({ startSec: 2.4, endSec: 2.6 }, 30, cfg, 'bar'),
    ).toEqual({ startSec: 2.5, endSec: 4.5 });

    // Beat snap with clamping to [0, duration]
    expect(
      snapBoundsToGrid({ startSec: 0.1, endSec: 10.2 }, 10, cfg, 'beat'),
    ).toEqual({ startSec: 0, endSec: 10 });
  });
});
