export interface ParsedYouTubeUrl {
  videoId: string;
  startSec?: number;
}

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

/**
 * Parses YouTube timestamp strings like "83", "83s", "1m23s", "1h2m3s", "2m", "1h".
 */
export function parseYouTubeTimestamp(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    return Number.isSafeInteger(secs) && secs >= 0 ? secs : undefined;
  }

  const hmsMatch = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i.exec(trimmed);
  if (!hmsMatch) return undefined;

  const [, hoursStr, minsStr, secsStr] = hmsMatch;
  if (!hoursStr && !minsStr && !secsStr) return undefined;

  const hours = hoursStr ? Number(hoursStr) : 0;
  const mins = minsStr ? Number(minsStr) : 0;
  const secs = secsStr ? Number(secsStr) : 0;

  if (
    !Number.isSafeInteger(hours) ||
    !Number.isSafeInteger(mins) ||
    !Number.isSafeInteger(secs)
  ) {
    return undefined;
  }

  return hours * 3600 + mins * 60 + secs;
}

function maybePrependHttps(raw: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
    return raw;
  }
  const lower = raw.toLowerCase();
  for (const host of ALLOWED_HOSTS) {
    if (
      lower === host ||
      lower.startsWith(`${host}/`) ||
      lower.startsWith(`${host}?`)
    ) {
      return `https://${raw}`;
    }
  }
  return raw;
}

function extractStartSeconds(url: URL): number | undefined {
  const rawParam = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (rawParam !== null) {
    return parseYouTubeTimestamp(rawParam);
  }
  if (url.hash && url.hash.length > 1) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    const hashT = hashParams.get('t');
    if (hashT !== null) {
      return parseYouTubeTimestamp(hashT);
    }
  }
  return undefined;
}

/**
 * Extracts a validated 11-character YouTube videoId and optional startSec from a URL.
 */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(maybePrependHttps(trimmed));
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return null;
  }

  const pathSegments = url.pathname.split('/').filter(Boolean);
  let videoId: string | null = null;

  if (host === 'youtu.be') {
    videoId = pathSegments[0] ?? null;
  } else if (pathSegments[0] === 'watch') {
    videoId = url.searchParams.get('v');
  } else if (
    pathSegments[0] === 'shorts' ||
    pathSegments[0] === 'embed' ||
    pathSegments[0] === 'live'
  ) {
    videoId = pathSegments[1] ?? null;
  } else if (pathSegments.length === 0 && url.searchParams.has('v')) {
    videoId = url.searchParams.get('v');
  }

  if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
    return null;
  }

  const startSec = extractStartSeconds(url);
  return startSec !== undefined ? { videoId, startSec } : { videoId };
}

export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
