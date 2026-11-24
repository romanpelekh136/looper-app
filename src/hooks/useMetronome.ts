import { useEffect, useRef, useState } from 'react';
import { clampBpm } from '../lib/metronome';

const LOOKAHEAD_SEC = 0.1;
const SCHEDULER_INTERVAL_MS = 25;

export interface UseMetronomeOptions {
  enabled: boolean;
  bpm: number;
  volume: number;
}

function playClickAt(ctx: AudioContext, when: number, volume: number) {
  const clampedVol = Math.min(Math.max(volume, 0), 1);
  if (clampedVol <= 0.001) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(980, when);

  const peakGain = Math.max(0.001, clampedVol * 0.55);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.032);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(when);
  osc.stop(when + 0.036);
}

export function useMetronome({
  enabled,
  bpm,
  volume,
}: UseMetronomeOptions): { isTicking: boolean } {
  const [isTicking, setIsTicking] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextNoteTimeRef = useRef<number | null>(null);
  const volumeRef = useRef(volume);
  const bpmRef = useRef(bpm);

  volumeRef.current = volume;
  bpmRef.current = bpm;

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      nextNoteTimeRef.current = null;
      setIsTicking(false);
      return;
    }

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    setIsTicking(true);
    nextNoteTimeRef.current = ctx.currentTime + 0.02;

    const schedule = () => {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      const stepSec = 60 / clampBpm(bpmRef.current);
      const now = ctx.currentTime;
      if (
        nextNoteTimeRef.current === null ||
        nextNoteTimeRef.current < now - 0.15
      ) {
        nextNoteTimeRef.current = now + 0.02;
      }

      while (nextNoteTimeRef.current < now + LOOKAHEAD_SEC) {
        playClickAt(ctx, nextNoteTimeRef.current, volumeRef.current);
        nextNoteTimeRef.current += stepSec;
      }
    };

    schedule();
    const id = window.setInterval(schedule, SCHEDULER_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [enabled]);

  return { isTicking };
}
