export type VideoQuality = '480p' | '720p' | '1080p';

export type MetronomeSyncMode = 'trackGrid' | 'loopStart' | 'standalone';

export type MetronomeSubdivision = 1 | 2 | 3 | 4;

export interface MetronomeConfig {
  enabled: boolean;
  bpm: number;
  beatsPerBar: number;
  beatUnit: number;
  subdivision: MetronomeSubdivision;
  accentFirstBeat: boolean;
  syncMode: MetronomeSyncMode;
  offsetSec: number;
  volume: number;
}

export interface LoopSegment {
  id: string;
  name: string;
  startSec: number;
  endSec: number;
  createdAt: string;
}

export interface Song {
  id: string;
  youtubeId: string;
  url: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
  loops: LoopSegment[];
  metronome?: MetronomeConfig;
  createdAt: string;
  lastPlayedAt: string;
}

export type HotkeyAction =
  | 'togglePlay'
  | 'toggleLoop'
  | 'jumpToA'
  | 'seekBack'
  | 'seekForward'
  | 'speedDown'
  | 'speedUp'
  | 'speedReset'
  | 'prevLoop'
  | 'nextLoop'
  | 'toggleMetronome';

export interface AppSettings {
  schemaVersion: 1;
  videoQuality: VideoQuality;
  globalHotkeysEnabled: boolean;
  localHotkeys: Record<HotkeyAction, string>;
  globalHotkeys: Record<HotkeyAction, string>;
  volume: number;
}

export interface LibraryData {
  schemaVersion: 1;
  songs: Song[];
}

export type ImportMode = 'merge' | 'replace';

export interface AppInfo {
  version: string;
  dataDir: string;
}

export const DEFAULT_METRONOME_CONFIG: MetronomeConfig = {
  enabled: false,
  bpm: 120,
  beatsPerBar: 4,
  beatUnit: 4,
  subdivision: 1,
  accentFirstBeat: true,
  syncMode: 'trackGrid',
  offsetSec: 0,
  volume: 0.7,
};

export const DEFAULT_LOCAL_HOTKEYS: Record<HotkeyAction, string> = {
  togglePlay: 'Space',
  toggleLoop: 'L',
  jumpToA: 'R',
  seekBack: 'ArrowLeft',
  seekForward: 'ArrowRight',
  speedDown: '-',
  speedUp: '=',
  speedReset: '0',
  prevLoop: '[',
  nextLoop: ']',
  toggleMetronome: 'M',
};

export const DEFAULT_GLOBAL_HOTKEYS: Record<HotkeyAction, string> = {
  togglePlay: 'Ctrl+Alt+Space',
  toggleLoop: 'Ctrl+Alt+L',
  jumpToA: 'Ctrl+Alt+R',
  seekBack: 'Ctrl+Alt+Left',
  seekForward: 'Ctrl+Alt+Right',
  speedDown: 'Ctrl+Alt+-',
  speedUp: 'Ctrl+Alt+=',
  speedReset: 'Ctrl+Alt+0',
  prevLoop: 'Ctrl+Alt+[',
  nextLoop: 'Ctrl+Alt+]',
  toggleMetronome: 'Ctrl+Alt+M',
};

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  videoQuality: '720p',
  globalHotkeysEnabled: false,
  localHotkeys: { ...DEFAULT_LOCAL_HOTKEYS },
  globalHotkeys: { ...DEFAULT_GLOBAL_HOTKEYS },
  volume: 1,
};
