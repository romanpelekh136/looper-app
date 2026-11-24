import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METRONOME_CONFIG,
  type LibraryData,
  type LoopSegment,
  type Song,
} from '../../types';
import {
  addLoopToSong,
  filterSongs,
  removeLoopFromSong,
  removeSong,
  renameSong,
  updateLoopInSong,
  updateSongMetronome,
  upsertSong,
} from '../library';

function makeLoop(id: string, name: string, startSec = 0, endSec = 10): LoopSegment {
  return {
    id,
    name,
    startSec,
    endSec,
    createdAt: '2026-11-24T20:00:00Z',
  };
}

function makeSong(id: string, youtubeId: string, title: string, channel = 'Guitar Hero'): Song {
  return {
    id,
    youtubeId,
    url: `https://www.youtube.com/watch?v=${youtubeId}`,
    title,
    channel,
    durationSec: 240,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    loops: [],
    createdAt: '2026-11-24T20:00:00Z',
    lastPlayedAt: '2026-11-24T20:00:00Z',
  };
}

describe('library helpers', () => {
  it('upserts new and existing songs by id or youtubeId', () => {
    const empty: LibraryData = { schemaVersion: 1, songs: [] };
    const song1 = makeSong('s1', 'vid11111111', 'Master of Puppets');
    const song2 = makeSong('s2', 'vid22222222', 'Hotel California');

    const withOne = upsertSong(empty, song1);
    expect(withOne.songs).toHaveLength(1);

    const withTwo = upsertSong(withOne, song2);
    expect(withTwo.songs.map((s) => s.id)).toEqual(['s2', 's1']);

    const updatedSong1 = { ...song1, title: 'Master of Puppets (Live)' };
    const replaced = upsertSong(withTwo, updatedSong1);
    expect(replaced.songs).toHaveLength(2);
    expect(replaced.songs[1].title).toBe('Master of Puppets (Live)');
  });

  it('renames and removes songs immutably', () => {
    const song1 = makeSong('s1', 'vid11111111', 'Original');
    const lib: LibraryData = { schemaVersion: 1, songs: [song1] };

    expect(renameSong(lib, 's1', '   ').songs[0].title).toBe('Original');
    const renamed = renameSong(lib, 's1', '  Renamed Title  ');
    expect(renamed.songs[0].title).toBe('Renamed Title');
    expect(lib.songs[0].title).toBe('Original');

    const removed = removeSong(renamed, 's1');
    expect(removed.songs).toHaveLength(0);
  });

  it('adds, updates, and removes loops on a song', () => {
    const song1 = makeSong('s1', 'vid11111111', 'Solo Practice');
    let lib: LibraryData = { schemaVersion: 1, songs: [song1] };

    lib = addLoopToSong(lib, 's1', makeLoop('l1', 'Intro', 0, 12.5));
    lib = addLoopToSong(lib, 's1', makeLoop('l2', 'Solo', 60, 82.3));
    expect(lib.songs[0].loops).toHaveLength(2);

    lib = updateLoopInSong(lib, 's1', 'l2', {
      name: '  Fast Solo  ',
      startSec: 61.2,
      endSec: 85.0,
    });
    expect(lib.songs[0].loops[1]).toMatchObject({
      name: 'Fast Solo',
      startSec: 61.2,
      endSec: 85.0,
    });

    lib = removeLoopFromSong(lib, 's1', 'l1');
    expect(lib.songs[0].loops.map((l) => l.id)).toEqual(['l2']);
  });

  it('updates song metronome config and filters songs by title or channel', () => {
    const song1 = makeSong('s1', 'vid11111111', 'Sultans of Swing', 'Dire Straits');
    const song2 = makeSong('s2', 'vid22222222', 'Little Wing', 'Jimi Hendrix');
    let lib: LibraryData = { schemaVersion: 1, songs: [song1, song2] };

    lib = updateSongMetronome(lib, 's2', {
      ...DEFAULT_METRONOME_CONFIG,
      enabled: true,
      bpm: 72,
    });
    expect(lib.songs[1].metronome?.bpm).toBe(72);
    expect(lib.songs[1].metronome?.enabled).toBe(true);

    expect(filterSongs(lib.songs, '')).toHaveLength(2);
    expect(filterSongs(lib.songs, 'sultans').map((s) => s.id)).toEqual(['s1']);
    expect(filterSongs(lib.songs, 'hendrix').map((s) => s.id)).toEqual(['s2']);
    expect(filterSongs(lib.songs, 'nonexistent')).toHaveLength(0);
  });
});
