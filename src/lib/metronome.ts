import { normalizeLoopBounds, type LoopBounds } from './loopBounds';
import { roundToTenth } from './time';
import type { MetronomeConfig, MetronomeSubdivision } from '../types';

export const MIN_BPM = 30;
export const MAX_BPM = 300;

export const TIME_SIGNATURES = [
  { label: '4/4', beatsPerBar: 4, beatUnit: 4 },
  { label: '3/4', beatsPerBar: 3, beatUnit: 4 },
  { label: '2/4', beatsPerBar: 2, beatUnit: 4 },
  { label: '6/8', beatsPerBar: 6, beatUnit: 8 },
  { label: '5/4', beatsPerBar: 5, beatUnit: 4 },
  { label: '7/8', beatsPerBar: 7, beatUnit: 8 },
] as const;

export interface ScheduledTick {
  stepIndex: number;
  trackTimeSec: number;
  beatInBar: number;
  subIndex: number;
  isDownbeat: boolean;
  isMainBeat: boolean;
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export function stepIntervalSec(
  bpm: number,
  subdivision: MetronomeSubdivision,
): number {
  return 60 / (clampBpm(bpm) * subdivision);
}

export function effectiveBpm(bpm: number, playbackRate: number): number {
  const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return roundToTenth(clampBpm(bpm) * safeRate);
}

export function resolveGridOriginSec(
  config: MetronomeConfig,
  loopStartSec: number,
): number {
  switch (config.syncMode) {
    case 'trackGrid':
      return Number.isFinite(config.offsetSec) ? config.offsetSec : 0;
    case 'loopStart':
      return Number.isFinite(loopStartSec) ? loopStartSec : 0;
    case 'standalone':
      return 0;
  }
}

export function buildTickInfo(
  stepIndex: number,
  trackTimeSec: number,
  beatsPerBar: number,
  subdivision: MetronomeSubdivision,
): ScheduledTick {
  const safeBeats = Math.max(1, Math.round(beatsPerBar));
  const stepsPerBar = safeBeats * subdivision;
  const posInBar = ((stepIndex % stepsPerBar) + stepsPerBar) % stepsPerBar;
  const beatInBar = Math.floor(posInBar / subdivision);
  const subIndex = posInBar % subdivision;
  const isMainBeat = subIndex === 0;
  const isDownbeat = beatInBar === 0 && isMainBeat;

  return {
    stepIndex,
    trackTimeSec,
    beatInBar,
    subIndex,
    isDownbeat,
    isMainBeat,
  };
}

export function getTicksInTrackWindow(
  windowStartSec: number,
  windowEndSec: number,
  config: MetronomeConfig,
  loopStartSec: number,
): ScheduledTick[] {
  if (
    !Number.isFinite(windowStartSec) ||
    !Number.isFinite(windowEndSec) ||
    windowEndSec <= windowStartSec
  ) {
    return [];
  }

  const origin = resolveGridOriginSec(config, loopStartSec);
  const step = stepIntervalSec(config.bpm, config.subdivision);
  const eps = 1e-9;
  const startK = Math.ceil((windowStartSec - origin - eps) / step);
  const ticks: ScheduledTick[] = [];

  for (let k = startK; ; k++) {
    const t = origin + k * step;
    if (t >= windowEndSec - eps) break;
    if (config.syncMode === 'loopStart' && k < 0) continue;
    ticks.push(buildTickInfo(k, t, config.beatsPerBar, config.subdivision));
  }

  return ticks;
}

export function trackDeltaToAudioDelaySec(
  targetTrackTimeSec: number,
  currentTrackTimeSec: number,
  playbackRate: number,
): number {
  const safeRate = Math.max(0.1, Number.isFinite(playbackRate) ? playbackRate : 1);
  return (targetTrackTimeSec - currentTrackTimeSec) / safeRate;
}

export function calculateTapTempo(
  timestampsMs: number[],
  maxGapMs = 2500,
): number | null {
  const finite = timestampsMs.filter((t) => Number.isFinite(t));
  if (finite.length < 2) return null;

  const cluster: number[] = [finite[finite.length - 1]];
  for (let i = finite.length - 2; i >= 0 && cluster.length < 8; i--) {
    const gap = cluster[0] - finite[i];
    if (gap <= 0 || gap > maxGapMs) {
      break;
    }
    cluster.unshift(finite[i]);
  }

  if (cluster.length < 2) return null;

  const totalSpan = cluster[cluster.length - 1] - cluster[0];
  const avgIntervalMs = totalSpan / (cluster.length - 1);
  if (avgIntervalMs <= 0) return null;

  return clampBpm(60000 / avgIntervalMs);
}

export function snapBoundsToGrid(
  bounds: LoopBounds,
  durationSec: number,
  config: MetronomeConfig,
  unit: 'beat' | 'bar',
): LoopBounds {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { startSec: 0, endSec: 0 };
  }

  const beatSec = 60 / clampBpm(config.bpm);
  const beats = Math.max(1, Math.round(config.beatsPerBar));
  const gridStep = beatSec * (unit === 'bar' ? beats : 1);
  const origin = config.syncMode === 'loopStart' ? bounds.startSec : config.offsetSec;

  const snap = (t: number) => origin + Math.round((t - origin) / gridStep) * gridStep;

  let snappedStart = Math.min(Math.max(snap(bounds.startSec), 0), durationSec);
  let snappedEnd = Math.min(Math.max(snap(bounds.endSec), 0), durationSec);

  if (snappedEnd <= snappedStart + 1e-6) {
    if (snappedStart + gridStep <= durationSec) {
      snappedEnd = snappedStart + gridStep;
    } else {
      snappedEnd = durationSec;
      snappedStart = Math.max(0, durationSec - gridStep);
    }
  }

  return normalizeLoopBounds(snappedStart, snappedEnd, durationSec);
}
