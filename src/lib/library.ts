import type {
  LibraryData,
  LoopSegment,
  MetronomeConfig,
  Song,
} from '../types';

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
