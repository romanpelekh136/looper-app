import { formatTime } from './time';

export interface SnapTarget {
  timeSec: number;
  kind: 'playhead' | 'boundA' | 'boundB' | 'loopEdge' | 'edge';
}

export interface SnapResult {
  timeSec: number;
  snapped: boolean;
  target: SnapTarget | null;
}

export interface RulerTick {
  timeSec: number;
  major: boolean;
  label?: string;
}

const MAJOR_INTERVALS_SEC = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function pixelThresholdToSeconds(
  thresholdPx: number,
  railWidthPx: number,
  durationSec: number,
): number {
  if (
    !Number.isFinite(thresholdPx) ||
    !Number.isFinite(railWidthPx) ||
    !Number.isFinite(durationSec) ||
    thresholdPx <= 0 ||
    railWidthPx <= 0 ||
    durationSec <= 0
  ) {
    return 0;
  }
  return (thresholdPx / railWidthPx) * durationSec;
}

export function snapToTargets(
  rawSec: number,
  targets: SnapTarget[],
  thresholdSec: number,
): SnapResult {
  if (!Number.isFinite(rawSec) || !Number.isFinite(thresholdSec) || thresholdSec <= 0) {
    return { timeSec: rawSec, snapped: false, target: null };
  }

  let bestTarget: SnapTarget | null = null;
  let bestDist = Infinity;

  for (const target of targets) {
    if (!Number.isFinite(target.timeSec)) continue;
    const dist = Math.abs(target.timeSec - rawSec);
    if (dist <= thresholdSec + 1e-9 && dist < bestDist) {
      bestDist = dist;
      bestTarget = target;
    }
  }

  if (!bestTarget) {
    return { timeSec: rawSec, snapped: false, target: null };
  }

  return {
    timeSec: bestTarget.timeSec,
    snapped: true,
    target: bestTarget,
  };
}

export function computeRulerTicks(
  durationSec: number,
  railWidthPx: number,
): RulerTick[] {
  if (
    !Number.isFinite(durationSec) ||
    !Number.isFinite(railWidthPx) ||
    durationSec <= 0 ||
    railWidthPx <= 0
  ) {
    return [];
  }

  const targetMajorCount = Math.max(2, railWidthPx / 90);
  const idealInterval = durationSec / targetMajorCount;
  const majorInterval =
    MAJOR_INTERVALS_SEC.find((iv) => iv >= idealInterval) ??
    MAJOR_INTERVALS_SEC[MAJOR_INTERVALS_SEC.length - 1];

  const subdivisions = majorInterval >= 10 || majorInterval === 5 ? 5 : 4;
  const minorStep = majorInterval / subdivisions;
  const ticks: RulerTick[] = [];
  const totalSteps = Math.floor((durationSec + 1e-9) / minorStep);

  for (let i = 0; i <= totalSteps; i++) {
    const t = Number((i * minorStep).toFixed(4));
    if (t > durationSec + 1e-6) break;
    const isMajor = i % subdivisions === 0;
    ticks.push({
      timeSec: Math.min(t, durationSec),
      major: isMajor,
      label: isMajor ? formatTime(t, { showTenths: false }) : undefined,
    });
  }

  return ticks;
}
