/**
 * Rounds a number of seconds to 0.1s precision and normalizes -0 to 0.
 */
export function roundToTenth(seconds: number): number {
  const rounded = Math.round(seconds * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Parses user-entered time in formats:
 * - raw seconds: "83.5", "83", "83,5"
 * - mm:ss or mm:ss.d: "01:23.5", "1:23"
 * - h:mm:ss or h:mm:ss.d: "1:02:03.5"
 * Returns seconds rounded to 0.1s, or null if invalid.
 */
export function parseTimeInput(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;

  const parts = normalized.split(':');
  if (parts.length === 1) {
    if (!/^\d+(?:\.\d+)?$/.test(parts[0])) return null;
    const secs = Number(parts[0]);
    return Number.isFinite(secs) ? roundToTenth(secs) : null;
  }

  if (parts.length === 2) {
    const [mmStr, ssStr] = parts;
    if (!/^\d+$/.test(mmStr) || !/^\d+(?:\.\d+)?$/.test(ssStr)) return null;
    const mins = Number(mmStr);
    const secs = Number(ssStr);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) {
      return null;
    }
    return roundToTenth(mins * 60 + secs);
  }

  if (parts.length === 3) {
    const [hStr, mmStr, ssStr] = parts;
    if (
      !/^\d+$/.test(hStr) ||
      !/^\d+$/.test(mmStr) ||
      !/^\d+(?:\.\d+)?$/.test(ssStr)
    ) {
      return null;
    }
    const hours = Number(hStr);
    const mins = Number(mmStr);
    const secs = Number(ssStr);
    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(mins) ||
      !Number.isFinite(secs) ||
      mins >= 60 ||
      secs >= 60
    ) {
      return null;
    }
    return roundToTenth(hours * 3600 + mins * 60 + secs);
  }

  return null;
}

/**
 * Formats seconds as MM:SS.d (or H:MM:SS.d when >= 1 hour),
 * or MM:SS / H:MM:SS when showTenths is false.
 */
export function formatTime(
  seconds: number,
  options?: { showTenths?: boolean },
): string {
  const showTenths = options?.showTenths ?? true;
  const clamped = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;

  if (showTenths) {
    const totalTenths = Math.round(clamped * 10);
    const tenths = totalTenths % 10;
    const totalSeconds = Math.floor(totalTenths / 10);
    const secs = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const mins = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    const secPart = `${String(secs).padStart(2, '0')}.${tenths}`;
    if (hours > 0) {
      return `${hours}:${String(mins).padStart(2, '0')}:${secPart}`;
    }
    return `${String(mins).padStart(2, '0')}:${secPart}`;
  }

  const totalSeconds = Math.round(clamped);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const secPart = String(secs).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${secPart}`;
  }
  return `${String(mins).padStart(2, '0')}:${secPart}`;
}
