import { describe, expect, it } from 'vitest';
import { formatTime, parseTimeInput, roundToTenth } from '../time';

describe('roundToTenth', () => {
  it('rounds to 0.1s precision and avoids -0', () => {
    expect(roundToTenth(83.54)).toBe(83.5);
    expect(roundToTenth(83.55)).toBe(83.6);
    expect(Object.is(roundToTenth(-0.01), 0)).toBe(true);
  });
});

describe('parseTimeInput', () => {
  it('parses mm:ss.d, mm:ss, h:mm:ss.d, and raw seconds', () => {
    expect(parseTimeInput('01:23.5')).toBe(83.5);
    expect(parseTimeInput('1:23')).toBe(83);
    expect(parseTimeInput('00:45.2')).toBe(45.2);
    expect(parseTimeInput('1:02:03.4')).toBe(3723.4);
    expect(parseTimeInput('83.5')).toBe(83.5);
    expect(parseTimeInput('83')).toBe(83);
    expect(parseTimeInput(' 83,54 ')).toBe(83.5);
  });

  it('rounds sub-tenth input to 0.1s', () => {
    expect(parseTimeInput('00:59.96')).toBe(60);
    expect(parseTimeInput('12.34')).toBe(12.3);
  });

  it('rejects invalid inputs', () => {
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput('   ')).toBeNull();
    expect(parseTimeInput('-5')).toBeNull();
    expect(parseTimeInput('01:65')).toBeNull();
    expect(parseTimeInput('1:60:00')).toBeNull();
    expect(parseTimeInput('abc')).toBeNull();
    expect(parseTimeInput('1:2:3:4')).toBeNull();
    expect(parseTimeInput('01:')).toBeNull();
  });
});

describe('formatTime', () => {
  it('formats with tenths by default and handles 59.96 rollover cleanly', () => {
    expect(formatTime(0)).toBe('00:00.0');
    expect(formatTime(83.5)).toBe('01:23.5');
    expect(formatTime(59.96)).toBe('01:00.0');
    expect(formatTime(3723.4)).toBe('1:02:03.4');
    expect(formatTime(-10)).toBe('00:00.0');
  });

  it('formats without tenths when showTenths is false', () => {
    expect(formatTime(83.4, { showTenths: false })).toBe('01:23');
    expect(formatTime(59.6, { showTenths: false })).toBe('01:00');
    expect(formatTime(3723, { showTenths: false })).toBe('1:02:03');
  });
});
