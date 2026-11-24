import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { LoopBounds } from '../lib/loopBounds';

interface PitchPreservingVideoElement extends HTMLVideoElement {
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
}

export interface UseAbLoopOptions {
  videoRef: RefObject<HTMLVideoElement>;
  bounds: LoopBounds;
  durationSec: number;
  loopEnabled: boolean;
  playbackRate: number;
  onTimeUpdate: (timeSec: number) => void;
  onLoopWrap?: () => void;
}

function applyPlaybackRateAndPitch(
  video: HTMLVideoElement,
  playbackRate: number,
) {
  const el = video as PitchPreservingVideoElement;
  el.playbackRate = playbackRate;
  el.preservesPitch = true;
  el.mozPreservesPitch = true;
  el.webkitPreservesPitch = true;
}

export function useAbLoop({
  videoRef,
  bounds,
  durationSec,
  loopEnabled,
  playbackRate,
  onTimeUpdate,
  onLoopWrap,
}: UseAbLoopOptions) {
  const boundsRef = useRef(bounds);
  const durationRef = useRef(durationSec);
  const loopEnabledRef = useRef(loopEnabled);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onLoopWrapRef = useRef(onLoopWrap);

  boundsRef.current = bounds;
  durationRef.current = durationSec;
  loopEnabledRef.current = loopEnabled;
  onTimeUpdateRef.current = onTimeUpdate;
  onLoopWrapRef.current = onLoopWrap;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    applyPlaybackRateAndPitch(video, playbackRate);
  }, [videoRef, playbackRate, durationSec]);

  useEffect(() => {
    let rafId = 0;
    let lastEmitMs = 0;
    let lastReportedTime = -1;

    const tick = (nowMs: number) => {
      const video = videoRef.current;
      if (video) {
        const cur = video.currentTime;
        const { startSec, endSec } = boundsRef.current;
        const dur = durationRef.current;

        if (loopEnabledRef.current && dur > 0 && endSec > startSec) {
          if (cur >= endSec || video.ended) {
            video.currentTime = startSec;
            onLoopWrapRef.current?.();
            onTimeUpdateRef.current(startSec);
            lastReportedTime = startSec;
            lastEmitMs = nowMs;
            if (video.ended) {
              void video.play().catch(() => {});
            }
            rafId = requestAnimationFrame(tick);
            return;
          }

          if (!video.paused && cur < startSec - 0.05) {
            video.currentTime = startSec;
            onLoopWrapRef.current?.();
            onTimeUpdateRef.current(startSec);
            lastReportedTime = startSec;
            lastEmitMs = nowMs;
            rafId = requestAnimationFrame(tick);
            return;
          }
        }

        if (
          nowMs - lastEmitMs >= 30 &&
          Math.abs(cur - lastReportedTime) >= 0.015
        ) {
          onTimeUpdateRef.current(cur);
          lastReportedTime = cur;
          lastEmitMs = nowMs;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [videoRef]);

  const seekTo = useCallback(
    (sec: number) => {
      const video = videoRef.current;
      if (!video) return;
      const maxDur =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : durationRef.current;
      const clamped = Math.min(Math.max(sec, 0), Math.max(0, maxDur));
      video.currentTime = clamped;
      onTimeUpdateRef.current(clamped);
    },
    [videoRef],
  );

  const jumpToA = useCallback(() => {
    seekTo(boundsRef.current.startSec);
    onLoopWrapRef.current?.();
  }, [seekTo]);

  const seekBy = useCallback(
    (deltaSec: number) => {
      const video = videoRef.current;
      if (!video) return;
      seekTo(video.currentTime + deltaSec);
    },
    [videoRef, seekTo],
  );

  return { jumpToA, seekTo, seekBy };
}
