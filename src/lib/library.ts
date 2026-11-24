import type {
  LibraryData,
  LoopSegment,
  MetronomeConfig,
  Song,
  VideoMetadata,
} from '../types';
import { normalizeLoopBounds } from './loopBounds';
import { roundToTenth } from './time';

/** Generates a unique identifier with the given prefix. */
export function generateId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${prefix}-${uuid}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Finds a favorite song by its YouTube video ID. */
export function findSongByYoutubeId(
  library: LibraryData,
  youtubeId: string,
): Song | undefined {
  return library.songs.find((s) => s.youtubeId === youtubeId);
}

/** Creates a new Song record from fetched YouTube metadata. */
export function createSongFromMetadata(
  meta: VideoMetadata,
  customTitle?: string,
  nowIso: string = new Date().toISOString(),
): Song {
  const trimmedTitle = customTitle?.trim();
  return {
    id: generateId('song'),
    youtubeId: meta.youtubeId,
    url: meta.url,
    title: trimmedTitle || meta.title,
    channel: meta.channel,
    durationSec: meta.durationSec,
    thumbnailUrl: meta.thumbnailUrl,
    loops: [],
    createdAt: nowIso,
    lastPlayedAt: nowIso,
  };
}

/** Creates a validated LoopSegment rounded to 0.1s precision. */
export function createLoopSegment(
  name: string,
  startSec: number,
  endSec: number,
  durationSec: number,
  fallbackIndex = 1,
  nowIso: string = new Date().toISOString(),
): LoopSegment {
  const trimmedName = name.trim();
  let normalizedStart = roundToTenth(Math.max(0, startSec));
  let normalizedEnd = roundToTenth(Math.max(normalizedStart, endSec));

  if (durationSec > 0) {
    const normalized = normalizeLoopBounds(startSec, endSec, durationSec);
    normalizedStart = normalized.startSec;
    normalizedEnd = normalized.endSec;
  }

  return {
    id: generateId('loop'),
    name: trimmedName || `Loop ${fallbackIndex}`,
    startSec: normalizedStart,
    endSec: normalizedEnd,
    createdAt: nowIso,
  };
}

/** Updates lastPlayedAt and optionally backfills durationSec when missing. */
export function touchSongLastPlayed(
  library: LibraryData,
  songId: string,
  nowIso: string = new Date().toISOString(),
  durationSec?: number,
): LibraryData {
  return {
    ...library,
    songs: library.songs.map((s) => {
      if (s.id !== songId) return s;
      const nextDuration =
        durationSec && durationSec > 0 && s.durationSec <= 0
          ? durationSec
          : s.durationSec;
      return {
        ...s,
        durationSec: nextDuration,
        lastPlayedAt: nowIso,
      };
    }),
  };
}

/** Returns sorted, deduplicated loop boundary timestamps for timeline snapping. */
export function getSongLoopEdges(song: Song | null | undefined): number[] {
  if (!song || song.loops.length === 0) return [];
  const edges = new Set<number>();
  for (const loop of song.loops) {
    edges.add(roundToTenth(loop.startSec));
    edges.add(roundToTenth(loop.endSec));
  }
  return Array.from(edges).sort((a, b) => a - b);
}

/** Formats a byte count into a human-readable size label. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx += 1;
  }
  if (unitIdx === 0) {
    return `${Math.round(val)} B`;
  }
  const decimals = val >= 100 ? 0 : val >= 10 ? 1 : 2;
  return `${val.toFixed(decimals)} ${units[unitIdx]}`;
}

export function upsertSong(library: LibraryData, song: Song): LibraryData {
  const existingIndex = library.songs.findIndex(
    (s) => s.id === song.id || s.youtubeId === song.youtubeId,
  );
  if (existingIndex === -1) {
    return {
      ...library,
      songs: [song, ...library.songs],
    };
  }
  const songs = library.songs.map((s, idx) => (idx === existingIndex ? song : s));
  return { ...library, songs };
}

export function renameSong(
  library: LibraryData,
  songId: string,
  title: string,
): LibraryData {
  const trimmed = title.trim();
  if (!trimmed) return library;
  return {
    ...library,
    songs: library.songs.map((s) =>
      s.id === songId ? { ...s, title: trimmed } : s,
    ),
  };
}

export function removeSong(library: LibraryData, songId: string): LibraryData {
  return {
    ...library,
    songs: library.songs.filter((s) => s.id !== songId),
  };
}

export function addLoopToSong(
  library: LibraryData,
  songId: string,
  loop: LoopSegment,
): LibraryData {
  return {
    ...library,
    songs: library.songs.map((s) =>
      s.id === songId ? { ...s, loops: [...s.loops, loop] } : s,
    ),
  };
}

export function updateLoopInSong(
  library: LibraryData,
  songId: string,
  loopId: string,
  patch: Partial<Pick<LoopSegment, 'name' | 'startSec' | 'endSec'>>,
): LibraryData {
  return {
    ...library,
    songs: library.songs.map((s) => {
      if (s.id !== songId) return s;
      return {
        ...s,
        loops: s.loops.map((lp) => {
          if (lp.id !== loopId) return lp;
          const nextName =
            patch.name !== undefined ? patch.name.trim() || lp.name : lp.name;
          return {
            ...lp,
            ...patch,
            name: nextName,
          };
        }),
      };
    }),
  };
}

export function removeLoopFromSong(
  library: LibraryData,
  songId: string,
  loopId: string,
): LibraryData {
  return {
    ...library,
    songs: library.songs.map((s) =>
      s.id === songId
        ? { ...s, loops: s.loops.filter((lp) => lp.id !== loopId) }
        : s,
    ),
  };
}

export function updateSongMetronome(
  library: LibraryData,
  songId: string,
  metronome: MetronomeConfig,
): LibraryData {
  return {
    ...library,
    songs: library.songs.map((s) =>
      s.id === songId ? { ...s, metronome } : s,
    ),
  };
}

export function filterSongs(songs: Song[], query: string): Song[] {
  const q = query.trim().toLowerCase();
  if (!q) return songs;
  return songs.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.channel.toLowerCase().includes(q),
  );
}
