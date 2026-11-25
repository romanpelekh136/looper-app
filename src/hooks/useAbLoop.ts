import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { LoopBounds } from '../lib/loopBounds';

export type VideoSlot = 'a' | 'b';

interface PitchPreservingVideoElement extends HTMLVideoElement {
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
}

export interface UseAbLoopOptions {
  videoRefA: RefObject<HTMLVideoElement>;
  videoRefB: RefObject<HTMLVideoElement>;
  activeSlot: VideoSlot;
  activeSlotRef: MutableRefObject<VideoSlot>;
  onActiveSlotChange: (slot: VideoSlot) => void;
  streamUrl: string | null;
  bounds: LoopBounds;
  durationSec: number;
  loopEnabled: boolean;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  onTimeUpdate: (timeSec: number) => void;
  onLoopWrap?: () => void;
}

const STANDBY_CUE_DEBOUNCE_MS = 120;
const WRAP_LOOKAHEAD_MS = 35;
const WRAP_COOLDOWN_MS = 60;
const STANDBY_POS_TOLERANCE_SEC = 0.08;

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

function syncLayerDom(
  activeEl: HTMLVideoElement,
  standbyEl: HTMLVideoElement,
) {
  activeEl.style.opacity = '1';
  activeEl.style.zIndex = '2';
  activeEl.style.pointerEvents = 'auto';

  standbyEl.style.opacity = '0';
  standbyEl.style.zIndex = '1';
  standbyEl.style.pointerEvents = 'none';
}

export function useAbLoop({
  videoRefA,
  videoRefB,
  activeSlot,
  activeSlotRef,
  onActiveSlotChange,
  streamUrl,
  bounds,
  durationSec,
  loopEnabled,
  playbackRate,
  volume,
  isMuted,
  onTimeUpdate,
  onLoopWrap,
}: UseAbLoopOptions) {
  const boundsRef = useRef(bounds);
  const durationRef = useRef(durationSec);
  const loopEnabledRef = useRef(loopEnabled);
  const playbackRateRef = useRef(playbackRate);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const streamUrlRef = useRef(streamUrl);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onLoopWrapRef = useRef(onLoopWrap);
  const onActiveSlotChangeRef = useRef(onActiveSlotChange);

  const wrapTimerRef = useRef<number | null>(null);
  const recueTimerRef = useRef<number | null>(null);
  const lastWrapPerfMsRef = useRef<number>(0);

  boundsRef.current = bounds;
  durationRef.current = durationSec;
  loopEnabledRef.current = loopEnabled;
  playbackRateRef.current = playbackRate;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  streamUrlRef.current = streamUrl;
  onTimeUpdateRef.current = onTimeUpdate;
  onLoopWrapRef.current = onLoopWrap;
  onActiveSlotChangeRef.current = onActiveSlotChange;

  const clearWrapTimer = useCallback(() => {
    if (wrapTimerRef.current !== null) {
      window.clearTimeout(wrapTimerRef.current);
      wrapTimerRef.current = null;
    }
  }, []);

  const clearRecueTimer = useCallback(() => {
    if (recueTimerRef.current !== null) {
      window.clearTimeout(recueTimerRef.current);
      recueTimerRef.current = null;
    }
  }, []);

  const getVideos = useCallback(() => {
    const slot = activeSlotRef.current;
    const standbySlot: VideoSlot = slot === 'a' ? 'b' : 'a';
    const active = slot === 'a' ? videoRefA.current : videoRefB.current;
    const standby = slot === 'a' ? videoRefB.current : videoRefA.current;
    return { active, standby, activeSlot: slot, standbySlot };
  }, [activeSlotRef, videoRefA, videoRefB]);

  const cueStandbyTo = useCallback(
    (targetSec: number) => {
      if (!streamUrlRef.current) return;
      const { standby } = getVideos();
      if (!standby) return;

      if (!standby.paused) {
        standby.pause();
      }
      standby.muted = true;
      standby.volume = 0;
      applyPlaybackRateAndPitch(standby, playbackRateRef.current);

      if (standby.readyState >= 1) {
        const maxDur =
          Number.isFinite(standby.duration) && standby.duration > 0
            ? standby.duration
            : durationRef.current;
        const clamped =
          maxDur > 0
            ? Math.min(Math.max(targetSec, 0), maxDur)
            : Math.max(targetSec, 0);
        if (Math.abs(standby.currentTime - clamped) > 0.015) {
          standby.currentTime = clamped;
        }
      }
    },
    [getVideos],
  );

  const cueStandbyNow = useCallback(() => {
    if (!loopEnabledRef.current || durationRef.current <= 0) return;
    cueStandbyTo(boundsRef.current.startSec);
  }, [cueStandbyTo]);

  // Apply playbackRate and preservesPitch to both layers whenever speed or media changes
  useEffect(() => {
    if (videoRefA.current) {
      applyPlaybackRateAndPitch(videoRefA.current, playbackRate);
    }
    if (videoRefB.current) {
      applyPlaybackRateAndPitch(videoRefB.current, playbackRate);
    }
  }, [videoRefA, videoRefB, playbackRate, durationSec, streamUrl]);

  // Keep audio unmuted on active layer only; standby always stays muted
  useEffect(() => {
    const { active, standby } = getVideos();
    if (active) {
      active.volume = isMuted ? 0 : volume;
      active.muted = isMuted;
    }
    if (standby) {
      standby.muted = true;
      standby.volume = 0;
    }
  }, [getVideos, activeSlot, volume, isMuted, streamUrl]);

  // Reset layer styles when streamUrl changes
  useEffect(() => {
    clearWrapTimer();
    clearRecueTimer();
    lastWrapPerfMsRef.current = 0;
    const { active, standby } = getVideos();
    if (active && standby) {
      syncLayerDom(active, standby);
    }
  }, [streamUrl, getVideos, clearWrapTimer, clearRecueTimer]);

  // Debounced pre-cue of standby player whenever loop start A moves
  useEffect(() => {
    clearWrapTimer();
    if (!loopEnabled || !streamUrl || durationSec <= 0) return;

    const timer = window.setTimeout(() => {
      cueStandbyTo(bounds.startSec);
    }, STANDBY_CUE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [loopEnabled, bounds.startSec, bounds.endSec, durationSec, streamUrl, cueStandbyTo, clearWrapTimer]);

  useEffect(() => {
    return () => {
      clearWrapTimer();
      clearRecueTimer();
    };
  }, [clearWrapTimer, clearRecueTimer]);

  const performLoopWrap = useCallback(() => {
    const nowPerf = performance.now();
    if (nowPerf - lastWrapPerfMsRef.current < WRAP_COOLDOWN_MS) {
      return;
    }

    const { startSec, endSec } = boundsRef.current;
    const dur = durationRef.current;
    if (!loopEnabledRef.current || dur <= 0 || endSec <= startSec) {
      return;
    }

    const { active, standby, standbySlot } = getVideos();
    if (!active) return;

    lastWrapPerfMsRef.current = nowPerf;
    clearWrapTimer();

    const standbyReady =
      Boolean(standby) &&
      standby!.readyState >= 2 &&
      !standby!.seeking &&
      Math.abs(standby!.currentTime - startSec) <= STANDBY_POS_TOLERANCE_SEC;

    if (standbyReady && standby) {
      // Update ref before pause/play so activeSlot-guarded event handlers don't flicker isPlaying
      activeSlotRef.current = standbySlot;
      applyPlaybackRateAndPitch(standby, playbackRateRef.current);
      standby.volume = isMutedRef.current ? 0 : volumeRef.current;
      standby.muted = isMutedRef.current;
      syncLayerDom(standby, active);

      void standby.play().catch(() => {});
      active.pause();
      active.muted = true;
      active.volume = 0;

      onActiveSlotChangeRef.current(standbySlot);
      onLoopWrapRef.current?.();
      onTimeUpdateRef.current(standby.currentTime);

      clearRecueTimer();
      const expectedActiveAfterSwap = standbySlot;
      const targetAtCue = startSec;
      recueTimerRef.current = window.setTimeout(() => {
        recueTimerRef.current = null;
        if (activeSlotRef.current !== expectedActiveAfterSwap) return;
        cueStandbyTo(targetAtCue);
      }, 40);
      return;
    }

    // Fallback when standby is not cued yet (e.g. bound A adjusted moments before B)
    active.currentTime = startSec;
    if (active.ended) {
      void active.play().catch(() => {});
    }
    onLoopWrapRef.current?.();
    onTimeUpdateRef.current(startSec);
    cueStandbyTo(startSec);
  }, [activeSlotRef, clearRecueTimer, clearWrapTimer, cueStandbyTo, getVideos]);

  // Precision rAF monitor + sub-frame setTimeout wrap trigger
  useEffect(() => {
    let rafId = 0;
    let lastEmitMs = 0;
    let lastReportedTime = -1;

    const tick = (nowMs: number) => {
      const { active } = getVideos();
      if (active) {
        const cur = active.currentTime;
        const { startSec, endSec } = boundsRef.current;
        const dur = durationRef.current;

        if (loopEnabledRef.current && dur > 0 && endSec > startSec) {
          if (cur >= endSec || active.ended) {
            performLoopWrap();
            lastReportedTime = boundsRef.current.startSec;
            lastEmitMs = nowMs;
            rafId = requestAnimationFrame(tick);
            return;
          }

          if (!active.paused && cur < startSec - 0.05) {
            clearWrapTimer();
            active.currentTime = startSec;
            onLoopWrapRef.current?.();
            onTimeUpdateRef.current(startSec);
            lastReportedTime = startSec;
            lastEmitMs = nowMs;
            rafId = requestAnimationFrame(tick);
            return;
          }

          if (!active.paused) {
            const rate = Math.max(0.25, playbackRateRef.current);
            const remainingRealMs = ((endSec - cur) / rate) * 1000;
            if (remainingRealMs > 0 && remainingRealMs <= WRAP_LOOKAHEAD_MS) {
              if (wrapTimerRef.current === null) {
                const delayMs = Math.max(0, remainingRealMs - 4);
                wrapTimerRef.current = window.setTimeout(() => {
                  wrapTimerRef.current = null;
                  const { active: currentActive } = getVideos();
                  if (!currentActive || currentActive.paused) return;
                  if (
                    loopEnabledRef.current &&
                    (currentActive.currentTime >= boundsRef.current.endSec - 0.015 ||
                      currentActive.ended)
                  ) {
                    performLoopWrap();
                  }
                }, delayMs);
              }
            } else {
              clearWrapTimer();
            }
          } else {
            clearWrapTimer();
          }
        } else {
          clearWrapTimer();
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
    return () => {
      cancelAnimationFrame(rafId);
      clearWrapTimer();
    };
  }, [clearWrapTimer, getVideos, performLoopWrap]);

  const pauseAll = useCallback(() => {
    clearWrapTimer();
    if (videoRefA.current && !videoRefA.current.paused) {
      videoRefA.current.pause();
    }
    if (videoRefB.current && !videoRefB.current.paused) {
      videoRefB.current.pause();
    }
    const { standby } = getVideos();
    if (standby) {
      standby.muted = true;
      standby.volume = 0;
    }
  }, [clearWrapTimer, getVideos, videoRefA, videoRefB]);

  const togglePlay = useCallback(() => {
    const { active, standby } = getVideos();
    if (!active || !streamUrlRef.current) return;

    if (active.paused) {
      if (standby) {
        if (!standby.paused) standby.pause();
        standby.muted = true;
        standby.volume = 0;
      }

      applyPlaybackRateAndPitch(active, playbackRateRef.current);
      active.volume = isMutedRef.current ? 0 : volumeRef.current;
      active.muted = isMutedRef.current;

      const { startSec, endSec } = boundsRef.current;
      const dur = durationRef.current;
      if (
        loopEnabledRef.current &&
        dur > 0 &&
        (active.currentTime >= endSec || active.currentTime < startSec)
      ) {
        active.currentTime = startSec;
        onTimeUpdateRef.current(startSec);
      }

      void active.play().catch(() => {});
    } else {
      pauseAll();
    }
  }, [getVideos, pauseAll]);

  const seekTo = useCallback(
    (sec: number) => {
      clearWrapTimer();
      const { active } = getVideos();
      if (!active) return;
      const maxDur =
        Number.isFinite(active.duration) && active.duration > 0
          ? active.duration
          : durationRef.current;
      const clamped = Math.min(Math.max(sec, 0), Math.max(0, maxDur));
      active.currentTime = clamped;
      onTimeUpdateRef.current(clamped);
    },
    [clearWrapTimer, getVideos],
  );

  const jumpToA = useCallback(() => {
    clearWrapTimer();
    const { active } = getVideos();
    if (active && !active.paused && loopEnabledRef.current) {
      performLoopWrap();
      return;
    }
    seekTo(boundsRef.current.startSec);
    onLoopWrapRef.current?.();
  }, [clearWrapTimer, getVideos, performLoopWrap, seekTo]);

  const seekBy = useCallback(
    (deltaSec: number) => {
      const { active } = getVideos();
      if (!active) return;
      seekTo(active.currentTime + deltaSec);
    },
    [getVideos, seekTo],
  );

  return { jumpToA, seekTo, seekBy, togglePlay, pauseAll, cueStandbyNow };
}
