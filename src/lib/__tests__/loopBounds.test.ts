import { describe, expect, it } from 'vitest';
import {
  MIN_LOOP_DURATION,
  normalizeLoopBounds,
  nudgeLoopEnd,
  nudgeLoopStart,
  validateLoopBounds,
} from '../loopBounds';

describe('validateLoopBounds', () => {
  it('accepts valid bounds respecting 0 <= A < B <= duration and min length 0.5s', () => {
    expect(validateLoopBounds(0, 0.5, 100)).toBe(true);
    expect(validateLoopBounds(10.2, 25.8, 120)).toBe(true);
    expect(validateLoopBounds(99.5, 100, 100)).toBe(true);
  });

  it('rejects bounds violating ordering, duration, or min length', () => {
    expect(validateLoopBounds(-0.1, 10, 100)).toBe(false);
    expect(validateLoopBounds(10, 100.1, 100)).toBe(false);
    expect(validateLoopBounds(20, 20, 100)).toBe(false);
    expect(validateLoopBounds(25, 20, 100)).toBe(false);
    expect(validateLoopBounds(10, 10 + MIN_LOOP_DURATION - 0.1, 100)).toBe(
      false,
    );
    expect(validateLoopBounds(0, 10, 0)).toBe(false);
  });
});

describe('normalizeLoopBounds', () => {
  it('clamps, rounds, and enforces minimum loop gap', () => {
    expect(normalizeLoopBounds(-5, 200, 120)).toEqual({
      startSec: 0,
      endSec: 120,
    });
    expect(normalizeLoopBounds(40, 20, 120)).toEqual({
      startSec: 20,
      endSec: 40,
    });
    expect(normalizeLoopBounds(50, 50.2, 120)).toEqual({
      startSec: 50,
      endSec: 50.5,
    });
    expect(normalizeLoopBounds(119.8, 120, 120)).toEqual({
      startSec: 119.5,
      endSec: 120,
    });
  });

  it('handles zero or very short durations safely', () => {
    expect(normalizeLoopBounds(0, 10, 0)).toEqual({
      startSec: 0,
      endSec: 0,
    });
    expect(normalizeLoopBounds(0, 0.3, 0.3)).toEqual({
      startSec: 0,
      endSec: 0.3,
    });
  });
});

describe('nudgeLoopStart and nudgeLoopEnd', () => {
  it('nudges by ±0.1s and ±0.5s with 0.1s precision', () => {
    let bounds = { startSec: 10, endSec: 20 };
    bounds = nudgeLoopStart(bounds, 0.1, 60);
    expect(bounds).toEqual({ startSec: 10.1, endSec: 20 });

    bounds = nudgeLoopStart(bounds, -0.5, 60);
    expect(bounds).toEqual({ startSec: 9.6, endSec: 20 });

    bounds = nudgeLoopEnd(bounds, 0.5, 60);
    expect(bounds).toEqual({ startSec: 9.6, endSec: 20.5 });

    bounds = nudgeLoopEnd(bounds, -0.1, 60);
    expect(bounds).toEqual({ startSec: 9.6, endSec: 20.4 });
  });

  it('clamps at 0, duration, and opposite marker minus 0.5s', () => {
    expect(nudgeLoopStart({ startSec: 0.2, endSec: 10 }, -0.5, 60)).toEqual({
      startSec: 0,
      endSec: 10,
    });
    expect(nudgeLoopStart({ startSec: 9.3, endSec: 10 }, 0.5, 60)).toEqual({
      startSec: 9.5,
      endSec: 10,
    });
    expect(nudgeLoopEnd({ startSec: 10, endSec: 59.8 }, 0.5, 60)).toEqual({
      startSec: 10,
      endSec: 60,
    });
    expect(nudgeLoopEnd({ startSec: 10, endSec: 10.7 }, -0.5, 60)).toEqual({
      startSec: 10,
      endSec: 10.5,
    });
  });
});
