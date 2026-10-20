import { describe, expect, it } from 'vitest';

import { colorProp, compoundStyle, flagColor, trackStatusStyle } from '../src/format/colors.js';
import { clockTime, fit, formatHms, parseGmtOffset, parseHms } from '../src/format/time.js';

describe('compoundStyle', () => {
  it('knows the compounds and marks others with a question mark', () => {
    expect(compoundStyle('SOFT')).toEqual({ letter: 'S', color: '#e8002d' });
    expect(compoundStyle('TEST_UNKNOWN')).toEqual({ letter: '?', color: 'gray' });
    expect(compoundStyle(undefined)).toBeUndefined();
    expect(compoundStyle('')).toBeUndefined();
  });
});

describe('trackStatusStyle', () => {
  it('labels every track status and tints the bar for SC, VSC and red', () => {
    const styles = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '9', undefined].map((code) => [String(code), trackStatusStyle(code)]));
    expect(Object.values(styles).map((style) => style.label)).toEqual([
      'GREEN',
      'YELLOW',
      'GREEN',
      'SAFETY CAR',
      'RED FLAG',
      'VSC',
      'VSC ENDING',
      '—',
      '—',
    ]);
    expect(Object.entries(styles).filter(([, style]) => style.alarm).map(([code]) => code)).toEqual(['4', '5', '6']);
  });
});

describe('flagColor', () => {
  it('colours every race control flag', () => {
    const flags = ['GREEN', 'CLEAR', 'YELLOW', 'DOUBLE YELLOW', 'RED', 'BLUE', 'CHEQUERED', 'BLACK AND WHITE', 'BLACK AND ORANGE', 'BLACK'];
    expect(flags.map(flagColor)).toEqual([
      '#23c552',
      '#23c552',
      '#ffd12e',
      '#ffd12e',
      '#e8002d',
      '#3d9be9',
      'white',
      '#ff8700',
      '#ff8700',
      '#ff8700',
    ]);
    expect(flagColor('PURPLE')).toBeUndefined();
    expect(flagColor(undefined)).toBeUndefined();
  });
});

describe('colorProp', () => {
  it('gives Ink a colour only when there is one', () => {
    expect(colorProp('#fff')).toEqual({ color: '#fff' });
    expect(colorProp(undefined)).toEqual({});
  });
});

describe('time helpers', () => {
  it('parses GMT offsets either side of UTC', () => {
    expect(parseGmtOffset('08:00:00')).toBe(8 * 3_600_000);
    expect(parseGmtOffset('-04:30:00')).toBe(-4.5 * 3_600_000);
    expect(parseGmtOffset('+01:00:00')).toBe(3_600_000);
    expect(parseGmtOffset('xx:00')).toBe(0);
    expect(parseGmtOffset(undefined)).toBe(0);
  });

  it('prints clock times, with dashes for a time not yet known', () => {
    expect(clockTime(Date.parse('2026-10-11T12:34:56Z'))).toBe('12:34:56');
    expect(clockTime(Date.parse('2026-10-11T12:34:56Z'), 8 * 3_600_000)).toBe('20:34:56');
    expect(clockTime(-Infinity)).toBe('--:--:--');
  });

  it('converts between hh:mm:ss and milliseconds', () => {
    expect(parseHms('01:02:03')).toBe(3_723_000);
    expect(parseHms('5')).toBe(5_000);
    expect(parseHms('aa:01')).toBe(1_000);
    expect(formatHms(3_723_999)).toBe('01:02:03');
    expect(formatHms(-5)).toBe('00:00:00');
  });

  it('fits text to a width, padded either side or cut', () => {
    expect(fit('abc', 5)).toBe('abc  ');
    expect(fit('abc', 5, 'right')).toBe('  abc');
    expect(fit('abcdef', 3)).toBe('abc');
    expect(fit('abcdef', 3, 'right')).toBe('abc');
  });
});
