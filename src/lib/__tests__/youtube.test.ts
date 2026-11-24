import { describe, expect, it } from 'vitest';
import {
  canonicalYouTubeUrl,
  parseYouTubeTimestamp,
  parseYouTubeUrl,
} from '../youtube';

describe('parseYouTubeTimestamp', () => {
  it('parses integer seconds and s/m/h combinations', () => {
    expect(parseYouTubeTimestamp('83')).toBe(83);
    expect(parseYouTubeTimestamp('83s')).toBe(83);
    expect(parseYouTubeTimestamp('1m23s')).toBe(83);
    expect(parseYouTubeTimestamp('1h2m3s')).toBe(3723);
    expect(parseYouTubeTimestamp('2m')).toBe(120);
    expect(parseYouTubeTimestamp('1h')).toBe(3600);
    expect(parseYouTubeTimestamp('0')).toBe(0);
  });

  it('rejects invalid timestamps', () => {
    expect(parseYouTubeTimestamp('')).toBeUndefined();
    expect(parseYouTubeTimestamp('-10')).toBeUndefined();
    expect(parseYouTubeTimestamp('abc')).toBeUndefined();
  });
});

describe('parseYouTubeUrl', () => {
  it('parses standard watch URLs and extra query params', () => {
    expect(
      parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).toEqual({ videoId: 'dQw4w9WgXcQ' });

    expect(
      parseYouTubeUrl(
        'https://youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&index=2&t=1m23s',
      ),
    ).toEqual({ videoId: 'dQw4w9WgXcQ', startSec: 83 });
  });

  it('parses youtu.be, shorts, embed, live, m.youtube.com, and music.youtube.com', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=45')).toEqual({
      videoId: 'dQw4w9WgXcQ',
      startSec: 45,
    });
    expect(
      parseYouTubeUrl('https://www.youtube.com/shorts/abcDEF_12-3?feature=share'),
    ).toEqual({ videoId: 'abcDEF_12-3' });
    expect(
      parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?start=120'),
    ).toEqual({ videoId: 'dQw4w9WgXcQ', startSec: 120 });
    expect(
      parseYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ#t=2m5s'),
    ).toEqual({ videoId: 'dQw4w9WgXcQ', startSec: 125 });
    expect(
      parseYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz'),
    ).toEqual({ videoId: 'dQw4w9WgXcQ' });
    expect(
      parseYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ'),
    ).toEqual({ videoId: 'dQw4w9WgXcQ' });
  });

  it('accepts scheme-less URLs with valid YouTube hosts', () => {
    expect(parseYouTubeUrl('youtu.be/dQw4w9WgXcQ?t=10')).toEqual({
      videoId: 'dQw4w9WgXcQ',
      startSec: 10,
    });
    expect(parseYouTubeUrl('  youtube.com/watch?v=dQw4w9WgXcQ  ')).toEqual({
      videoId: 'dQw4w9WgXcQ',
    });
  });

  it('rejects invalid hosts, malformed IDs, and empty inputs', () => {
    expect(parseYouTubeUrl('')).toBeNull();
    expect(parseYouTubeUrl('   ')).toBeNull();
    expect(
      parseYouTubeUrl('https://notyoutube.com/watch?v=dQw4w9WgXcQ'),
    ).toBeNull();
    expect(
      parseYouTubeUrl('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'),
    ).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(
      parseYouTubeUrl('https://www.youtube.com/watch?v=too_long_video_id'),
    ).toBeNull();
    expect(parseYouTubeUrl('ftp://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('builds canonical YouTube watch URL', () => {
    expect(canonicalYouTubeUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });
});
