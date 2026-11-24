import { useEffect, useRef, useState } from 'react';
import { Drum } from 'lucide-react';
import { clampBpm } from '../lib/metronome';

export interface MetronomeControlsProps {
  enabled: boolean;
  bpm: number;
  volume: number;
  onChange: (patch: { enabled?: boolean; bpm?: number; volume?: number }) => void;
}

export function MetronomeControls({
  enabled,
  bpm,
  volume,
  onChange,
}: MetronomeControlsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="popover-anchor">
      <button
        type="button"
        className={`toolbar-btn ${enabled ? 'is-active' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        title="Мінімальний ручний метроном"
      >
        <Drum size={14} />
        <span>{enabled ? `${bpm} BPM` : 'Метроном'}</span>
        {enabled && <span className="status-dot" />}
      </button>

      {open && (
        <div className="metro-popover" role="dialog" aria-label="Метроном">
          <div className="popover-row">
            <span className="popover-label">Метроном</span>
            <button
              type="button"
              className={`studio-btn ${enabled ? 'is-primary' : ''}`}
              onClick={() => onChange({ enabled: !enabled })}
            >
              {enabled ? 'Увімкнено' : 'Вимкнено'}
            </button>
          </div>

          <div className="popover-row">
            <span className="popover-label">BPM</span>
            <div className="bpm-stepper">
              <button
                type="button"
                className="micro-btn"
                onClick={() => onChange({ bpm: clampBpm(bpm - 5) })}
              >
                -5
              </button>
              <button
                type="button"
                className="micro-btn"
                onClick={() => onChange({ bpm: clampBpm(bpm - 1) })}
              >
                -1
              </button>
              <input
                type="number"
                className="studio-input bpm-num"
                min={30}
                max={300}
                value={bpm}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) {
                    onChange({ bpm: clampBpm(val) });
                  }
                }}
                aria-label="BPM"
              />
              <button
                type="button"
                className="micro-btn"
                onClick={() => onChange({ bpm: clampBpm(bpm + 1) })}
              >
                +1
              </button>
              <button
                type="button"
                className="micro-btn"
                onClick={() => onChange({ bpm: clampBpm(bpm + 5) })}
              >
                +5
              </button>
            </div>
          </div>

          <div className="popover-row">
            <span className="popover-label">Гучність</span>
            <input
              type="range"
              className="studio-range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => onChange({ volume: Number(e.target.value) })}
              aria-label="Гучність метронома"
            />
            <span className="mono-num vol-pct">{Math.round(volume * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
