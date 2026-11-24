import { roundToTenth } from './time';

export const MIN_LOOP_DURATION = 0.5;
export const TIME_STEP = 0.1;

export interface LoopBounds {
  startSec: number;
  endSec: number;
}

function effectiveMinGap(safeDuration: number): number {
  return Math.min(MIN_LOOP_DURATION, safeDuration);
}

/**
 * Validates the invariant 0 <= startSec < endSec <= durationSec
 * and minimum loop length (0.5s, or full duration if duration < 0.5s).
 */
export function validateLoopBounds(
  startSec: number,
  endSec: number,
  durationSec: number,
): boolean {
  if (
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return false;
  }

  const safeDuration = roundToTenth(durationSec);
  if (safeDuration <= 0) {
    return false;
  }

  const a = roundToTenth(startSec);
  const b = roundToTenth(endSec);
  if (a < 0 || b > safeDuration || a >= b) {
    return false;
  }

  const minGap = effectiveMinGap(safeDuration);
  return roundToTenth(b - a) >= minGap;
}

/**
 * Clamps and normalizes arbitrary A/B bounds to [0, durationSec] with 0.1s precision
 * while guaranteeing the minimum loop duration invariant.
 */
export function normalizeLoopBounds(
  startSec: number,
  endSec: number,
  durationSec: number,
): LoopBounds {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { startSec: 0, endSec: 0 };
  }

  const safeDuration = roundToTenth(durationSec);
  if (safeDuration <= 0) {
    return { startSec: 0, endSec: 0 };
  }

  const minGap = effectiveMinGap(safeDuration);
  const rawStart = Number.isFinite(startSec) ? startSec : 0;
  const rawEnd = Number.isFinite(endSec) ? endSec : safeDuration;

  let a = roundToTenth(Math.min(Math.max(rawStart, 0), safeDuration));
  let b = roundToTenth(Math.min(Math.max(rawEnd, 0), safeDuration));

  if (a > b) {
    [a, b] = [b, a];
  }

  if (roundToTenth(b - a) < minGap) {
    const shiftedEnd = roundToTenth(a + minGap);
    if (shiftedEnd <= safeDuration) {
      b = shiftedEnd;
    } else {
      b = safeDuration;
      a = roundToTenth(Math.max(0, safeDuration - minGap));
    }
  }

  return { startSec: a, endSec: b };
}

/**
 * Nudges loop start (A) by deltaSec, clamped so B - A >= minGap and A >= 0.
 */
export function nudgeLoopStart(
  bounds: LoopBounds,
  deltaSec: number,
  durationSec: number,
): LoopBounds {
  const normalized = normalizeLoopBounds(
    bounds.startSec,
    bounds.endSec,
    durationSec,
  );
  const safeDuration = roundToTenth(Math.max(0, durationSec));
  if (safeDuration <= 0) {
    return { startSec: 0, endSec: 0 };
  }

  const minGap = effectiveMinGap(safeDuration);
  const maxStart = Math.max(0, roundToTenth(normalized.endSec - minGap));
  const nextStart = roundToTenth(
    Math.min(Math.max(normalized.startSec + deltaSec, 0), maxStart),
  );

  return { startSec: nextStart, endSec: normalized.endSec };
}

/**
 * Nudges loop end (B) by deltaSec, clamped so B - A >= minGap and B <= durationSec.
 */
export function nudgeLoopEnd(
  bounds: LoopBounds,
  deltaSec: number,
  durationSec: number,
): LoopBounds {
  const normalized = normalizeLoopBounds(
    bounds.startSec,
    bounds.endSec,
    durationSec,
  );
  const safeDuration = roundToTenth(Math.max(0, durationSec));
  if (safeDuration <= 0) {
    return { startSec: 0, endSec: 0 };
  }

  const minGap = effectiveMinGap(safeDuration);
  const minEnd = Math.min(safeDuration, roundToTenth(normalized.startSec + minGap));
  const nextEnd = roundToTenth(
    Math.min(Math.max(normalized.endSec + deltaSec, minEnd), safeDuration),
  );

  return { startSec: normalized.startSec, endSec: nextEnd };
}
