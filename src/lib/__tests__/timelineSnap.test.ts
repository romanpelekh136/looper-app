import { describe, expect, it } from 'vitest';
import {
  computeRulerTicks,
  pixelThresholdToSeconds,
  snapToTargets,
  type SnapTarget,
} from '../timelineSnap';

describe('pixelThresholdToSeconds', () => {
  it('converts pixel distance to seconds proportionally and guards invalid inputs', () => {
    expect(pixelThresholdToSeconds(10, 1000, 100)).toBeCloseTo(1.0, 6);
    expect(pixelThresholdToSeconds(8, 800, 200)).toBeCloseTo(2.0, 6);
    expect(pixelThresholdToSeconds(10, 0, 100)).toBe(0);
    expect(pixelThresholdToSeconds(10, 800, 0)).toBe(0);
    expect(pixelThresholdToSeconds(0, 800, 100)).toBe(0);
  });
});

describe('snapToTargets', () => {
  const targets: SnapTarget[] = [
    { timeSec: 0, kind: 'edge' },
    { timeSec: 12.4, kind: 'playhead' },
    { timeSec: 15.0, kind: 'loopEdge' },
    { timeSec: 60.0, kind: 'edge' },
  ];

  it('snaps to the closest target within threshold', () => {
    const hit = snapToTargets(12.9, targets, 0.8);
    expect(hit).toEqual({
      timeSec: 12.4,
      snapped: true,
      target: { timeSec: 12.4, kind: 'playhead' },
    });

    const closer = snapToTargets(14.1, [
      { timeSec: 12.4, kind: 'playhead' },
      { timeSec: 15.0, kind: 'loopEdge' },
    ], 2.0);
    expect(closer.target?.kind).toBe('loopEdge');
    expect(closer.timeSec).toBe(15.0);
  });

  it('returns rawSec unsnapped when outside threshold or disabled', () => {
    expect(snapToTargets(25.0, targets, 1.0)).toEqual({
      timeSec: 25.0,
      snapped: false,
      target: null,
    });
    expect(snapToTargets(12.45, targets, 0)).toEqual({
      timeSec: 12.45,
      snapped: false,
      target: null,
    });
  });
});

describe('computeRulerTicks', () => {
  it('builds monotonic ticks with major formatted labels adapted to duration and width', () => {
    const shortTicks = computeRulerTicks(30, 900);
    expect(shortTicks.length).toBeGreaterThan(5);
    expect(shortTicks[0]).toEqual({ timeSec: 0, major: true, label: '00:00' });
    expect(shortTicks.some((t) => t.major && t.label === '00:15')).toBe(true);

    const longTicks = computeRulerTicks(600, 600);
    const majors = longTicks.filter((t) => t.major);
    expect(majors.length).toBeGreaterThanOrEqual(4);
    expect(majors.length).toBeLessThanOrEqual(12);

    expect(computeRulerTicks(0, 600)).toEqual([]);
    expect(computeRulerTicks(100, 0)).toEqual([]);
  });
});
