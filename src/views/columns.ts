import { compoundStyle, TONE_COLORS } from '../format/colors.js';
import { type Column, span, type Span } from '../components/Table.js';
import { segmentKind, type SegmentKind, type Stint, type TimedValue, type TimingRow, type Tone } from '../state/timingRows.js';

/** Colours of the official leaderboard: sector times are yellow unless personal or overall bests. */
const SECTOR_TONES: Record<Tone, string> = { overall: '#b138dd', personal: '#23c552', normal: '#ffd12e' };
const RED = '#e8002d';

const SEGMENT_COLORS: Record<SegmentKind, string> = {
  none: '#4a4a5a',
  normal: '#ffd12e',
  personal: '#23c552',
  overall: '#b138dd',
  pit: '#3d9be9',
  stopped: RED,
};

type RowColumn = Column<TimingRow>;

function timed(value: TimedValue, tones: Record<Tone, string | undefined> = TONE_COLORS): Span {
  return span(value.value, { color: tones[value.tone] });
}

function tyre(stint: Stint | undefined, age = true): Span[] {
  const style = compoundStyle(stint?.compound);
  if (!stint || !style) return [span('–', { dim: true })];
  return [
    ...(age ? [span(`${stint.laps}`.padStart(2) + ' ')] : []),
    span(style.letter, { color: style.color, bold: true }),
    span(stint.isNew ? ' ' : '·', { dim: true }),
  ];
}

const STATUS_LABEL: Partial<Record<TimingRow['status'], string>> = { retired: 'RETIRED', stopped: 'STOP' };

// ─── Shared columns ──────────────────────────────────────────────────────────

export const position: RowColumn = {
  header: 'POS',
  width: 3,
  align: 'right',
  render: (row) => span(row.status === 'stopped' || row.status === 'retired' ? '' : row.position, { bold: true }),
};

export const teamBar: RowColumn = {
  header: '',
  width: 1,
  render: (row) =>
    row.marked
      ? span('●', { color: row.teamColour, bold: true })
      : span(row.status === 'retired' ? '✕' : '▌', { color: row.status === 'retired' ? RED : row.teamColour }),
};

export function driver(width: number): RowColumn {
  return {
    header: width > 3 ? 'DRIVER' : 'DRV',
    width,
    marksSelection: true,
    render: (row) => span(width > 3 ? row.lastName : row.tla, { bold: true }),
  };
}

/** Last lap time, or RETIRED / STOP in red. */
export const lapTime: RowColumn = {
  header: 'LAP TIME',
  width: 9,
  render: (row) => {
    const label = STATUS_LABEL[row.status];
    return label ? span(label, { color: RED, bold: true }) : timed(row.last);
  },
};

export const gap: RowColumn = { header: 'GAP', width: 8, align: 'right', render: (row) => span(row.gap) };

export const interval: RowColumn = {
  header: 'INTERVAL',
  width: 8,
  align: 'right',
  render: (row) => {
    if (row.status === 'pit') return span('IN PIT', { color: '#3d9be9' });
    if (row.status === 'pitout') return span('PIT OUT', { color: '#3d9be9' });
    return span(row.interval, { color: row.catching ? '#23c552' : undefined });
  },
};

export function sector(index: number): RowColumn {
  return {
    header: `S${index + 1}`,
    width: 6,
    render: (row) => (row.sectors[index]?.value ? timed(row.sectors[index]!, SECTOR_TONES) : span('')),
  };
}

export function bestSector(index: number): RowColumn {
  return {
    header: `BS${index + 1}`,
    width: 6,
    render: (row) => (row.bestSectors[index]?.value ? timed(row.bestSectors[index]!, SECTOR_TONES) : span('')),
  };
}

export function speed(index: number): RowColumn {
  return {
    header: `SPD${index + 1}`,
    width: 4,
    align: 'right',
    render: (row) => (row.speeds[index]?.value ? timed(row.speeds[index]!) : span('')),
  };
}

export const positionChange: RowColumn = {
  header: '+/-',
  width: 3,
  align: 'right',
  render: (row) => {
    const change = row.positionChange;
    if (change === undefined) return span('');
    if (change > 0) return span(`▲${change}`, { color: '#23c552' });
    if (change < 0) return span(`▼${-change}`, { color: '#ffd12e' });
    return span('-0', { dim: true });
  },
};

export const tyreColumn: RowColumn = { header: 'TYRE', width: 5, align: 'right', render: (row) => tyre(row.stint) };

export const pits: RowColumn = {
  header: 'PIT',
  width: 3,
  align: 'right',
  render: (row) => span(row.pits === undefined ? '' : String(row.pits)),
};

/** Mini-sector bars plus the sector time, with the overall fastest driver in the header. */
export function segments(index: number, fastest: string | undefined, bars: number): RowColumn {
  return {
    header: `SECTOR ${index + 1}`,
    headerNote: fastest ? span(fastest, { color: '#b138dd', bold: true }) : undefined,
    width: Math.max(bars + 7, 12),
    render: (row) => {
      const cell = row.sectors[index];
      const statuses = cell?.segments ?? [];
      const marks = statuses.slice(0, bars).map((status) => span('▮', { color: SEGMENT_COLORS[segmentKind(status)] }));
      const pad = span(' '.repeat(Math.max(0, bars - marks.length)));
      return [...marks, pad, span(' '), cell?.value ? timed(cell, SECTOR_TONES) : span('')];
    },
  };
}

export const currentTyre: RowColumn = { header: 'CURRENT', width: 7, render: (row) => tyre(row.stint, false) };
export const stintLaps: RowColumn = {
  header: 'STINT',
  width: 5,
  align: 'right',
  render: (row) => span(row.stint ? String(row.stint.laps) : ''),
};
export const totalLaps: RowColumn = {
  header: 'TOTAL',
  width: 5,
  align: 'right',
  render: (row) => span(row.stint ? String(row.stint.age) : ''),
};

export function previousStints(width: number): RowColumn {
  return {
    header: 'PREVIOUS',
    width,
    render: (row) =>
      [...row.previousStints].reverse().flatMap((stint) => {
        const style = compoundStyle(stint.compound);
        return [span(`${stint.laps}`.padStart(3) + ' '), span(style?.letter ?? '?', { color: style?.color, bold: true }), span(' ')];
      }),
  };
}

/** The overall fastest driver of each sector, from the rows' best sectors. */
export function sectorLeaders(rows: readonly TimingRow[]): (string | undefined)[] {
  return [0, 1, 2].map((index) => rows.find((row) => row.bestSectors[index]?.tone === 'overall' && row.bestSectors[index]?.value)?.tla);
}

/** Most mini-sectors in any sector, so every bar column lines up. */
export function segmentCount(rows: readonly TimingRow[]): number {
  return Math.max(1, ...rows.flatMap((row) => row.sectors.map((cell) => cell.segments.length)));
}
