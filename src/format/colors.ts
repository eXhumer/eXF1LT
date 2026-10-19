import { TrackStatusCode } from '@exhumer/f1-live-timing';

import type { TrackPeriodKind } from '../state/periods.js';
import type { Tone } from '../state/timingRows.js';

export const TONE_COLORS: Record<Tone, string | undefined> = {
  overall: '#b138dd',
  personal: '#23c552',
  normal: undefined,
};

export interface CompoundStyle {
  readonly letter: string;
  readonly color: string;
}

const COMPOUNDS: Record<string, CompoundStyle> = {
  SOFT: { letter: 'S', color: '#e8002d' },
  MEDIUM: { letter: 'M', color: '#ffd12e' },
  HARD: { letter: 'H', color: '#f0f0ec' },
  INTERMEDIATE: { letter: 'I', color: '#43b02a' },
  WET: { letter: 'W', color: '#0067ad' },
};

export function compoundStyle(compound: string | undefined): CompoundStyle | undefined {
  if (!compound) return undefined;
  return COMPOUNDS[compound] ?? { letter: '?', color: 'gray' };
}

export interface TrackStatusStyle {
  readonly label: string;
  readonly color: string;
  /** Tint the whole header bar. */
  readonly alarm: boolean;
}

export function trackStatusStyle(code: string | undefined): TrackStatusStyle {
  switch (code) {
    case TrackStatusCode.AllClear:
    case TrackStatusCode.Green:
      return { label: 'GREEN', color: '#23c552', alarm: false };
    case TrackStatusCode.Yellow:
      return { label: 'YELLOW', color: '#ffd12e', alarm: false };
    case TrackStatusCode.SCDeployed:
      return { label: 'SAFETY CAR', color: '#ffd12e', alarm: true };
    case TrackStatusCode.VSCDeployed:
      return { label: 'VSC', color: '#ffd12e', alarm: true };
    case TrackStatusCode.VSCEnding:
      return { label: 'VSC ENDING', color: '#ffd12e', alarm: false };
    case TrackStatusCode.Red:
      return { label: 'RED FLAG', color: '#e8002d', alarm: true };
    default:
      return { label: '—', color: 'gray', alarm: false };
  }
}

export function flagColor(flag: string | undefined): string | undefined {
  switch (flag) {
    case 'GREEN':
    case 'CLEAR':
      return '#23c552';
    case 'YELLOW':
    case 'DOUBLE YELLOW':
      return '#ffd12e';
    case 'RED':
      return '#e8002d';
    case 'BLUE':
      return '#3d9be9';
    case 'CHEQUERED':
      return 'white';
    case 'BLACK AND WHITE':
    case 'BLACK AND ORANGE':
    case 'BLACK':
      return '#ff8700';
    default:
      return undefined;
  }
}

/**
 * Track conditions drawn into the scrubber's bar: a single line for the milder
 * condition and a double one for the stronger (yellow / double yellow, VSC /
 * safety car), and a solid block for a red flag, which a red line would hide
 * in the played part of the bar.
 */
export const PERIOD_STYLES: Record<TrackPeriodKind, { char: string; color: string }> = {
  yellow: { char: '━', color: '#ffd12e' },
  'double-yellow': { char: '═', color: '#ffd12e' },
  vsc: { char: '━', color: '#ff9f0a' },
  sc: { char: '═', color: '#ff9f0a' },
  red: { char: '█', color: '#e8002d' },
};

/** `{ color }` for Ink's `<Text>`, or nothing when there is no color (keeps exactOptionalPropertyTypes happy). */
export function colorProp(color: string | undefined): { color?: string } {
  return color ? { color } : {};
}
