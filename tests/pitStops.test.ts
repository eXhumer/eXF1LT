import { describe, expect, it } from 'vitest';

import { bestStop, buildPitStops, parsePitStopSeries, seconds } from '../src/state/pitStops.js';
import type { Stint, TimingRow } from '../src/state/timingRows.js';

function stint(laps: number): Stint {
  return { compound: 'SOFT', isNew: true, laps, age: laps };
}

function row(number: string, tla: string, previous: number[] = [], current = 10): TimingRow {
  return {
    number,
    tla,
    lastName: tla,
    teamColour: undefined,
    position: '1',
    gap: '',
    interval: '',
    catching: false,
    last: { value: '', tone: 'normal' },
    best: '',
    sectors: [],
    bestSectors: [],
    speeds: [],
    gridPosition: undefined,
    positionChange: undefined,
    lapsDown: undefined,
    stint: stint(current),
    previousStints: previous.map(stint),
    compound: 'SOFT',
    tyreAge: current,
    pits: previous.length,
    status: 'running',
    dim: false,
    cutoff: false,
  };
}

const stop = (number: string, lap: string | undefined, stationary: string, lane: string, timestamp: string) => ({
  Timestamp: timestamp,
  PitStop: { RacingNumber: number, PitStopTime: stationary, PitLaneTime: lane, ...(lap ? { Lap: lap } : {}) },
});

describe('parsePitStopSeries', () => {
  it('reads a driver whose stops are a list', () => {
    const parsed = parsePitStopSeries({ PitTimes: { '44': [stop('44', '18', '2.5', '24.048', '2026-10-11T12:34:00Z')] } });
    expect(parsed?.get('44')).toEqual([{ lap: 18, stationary: '2.5', lane: '24.048' }]);
  });

  it('reads stops keyed by index, in order, and sorts them by time', () => {
    const parsed = parsePitStopSeries({
      PitTimes: {
        '81': {
          '1': stop('81', '41', '2.7', '24.076', '2026-10-11T13:12:41Z'),
          '0': stop('81', '33', '4.2', '25.713', '2026-10-11T12:58:00Z'),
        },
      },
    });
    expect(parsed?.get('81')?.map((s) => s.lap)).toEqual([33, 41]);
  });

  it('keeps a stop with no lap and skips junk', () => {
    const parsed = parsePitStopSeries({
      PitTimes: { '18': [stop('18', undefined, '2.1', '23.601', '2026-10-11T12:40:49Z'), 'junk', { Timestamp: 'x' }], '5': 'nope' },
    });
    expect(parsed?.get('18')).toEqual([{ lap: undefined, stationary: '2.1', lane: '23.601' }]);
    expect(parsed?.get('5')).toEqual([]);
  });

  it('is undefined without a PitTimes object', () => {
    expect(parsePitStopSeries(undefined)).toBeUndefined();
    expect(parsePitStopSeries({})).toBeUndefined();
    expect(parsePitStopSeries({ PitTimes: [] })).toBeUndefined();
  });
});

describe('buildPitStops', () => {
  const series = {
    PitTimes: {
      '1': [stop('1', '12', '2.4', '23.1', '2026-10-11T12:12:00Z')],
      '81': [
        stop('81', '14', '3.1', '24.0', '2026-10-11T12:14:00Z'),
        stop('81', '40', '2.2', '23.5', '2026-10-11T12:40:00Z'),
      ],
    },
  };

  it('attaches each driver\'s stops in running order and finds the fastest stationary time', () => {
    const table = buildPitStops([row('81', 'PIA'), row('1', 'NOR'), row('3', 'VER')], series);
    expect(table.timed).toBe(true);
    expect(table.rows.map((r) => [r.tla, r.stops.length])).toEqual([['PIA', 2], ['NOR', 1], ['VER', 0]]);
    expect(table.fastest).toEqual({ seconds: 2.2, tla: 'PIA' });
  });

  it('rebuilds the laps from the tyre stints when there is no series (live feed)', () => {
    const table = buildPitStops([row('1', 'NOR', [12, 26], 8)], undefined);
    expect(table.timed).toBe(false);
    expect(table.rows[0]?.stops).toEqual([
      { lap: 12, stationary: undefined, lane: undefined },
      { lap: 38, stationary: undefined, lane: undefined },
    ]);
    expect(table.fastest).toBeUndefined();
  });
});

describe('bestStop and seconds', () => {
  it('picks the quickest time and ignores missing ones', () => {
    expect(bestStop([{ lap: 1, stationary: '3.1', lane: undefined }, { lap: 2, stationary: '2.4', lane: undefined }])).toBe(2.4);
    expect(bestStop([{ lap: 1, stationary: undefined, lane: undefined }])).toBeUndefined();
  });

  it('parses only numbers', () => {
    expect(seconds('24.048')).toBe(24.048);
    expect(seconds('')).toBeUndefined();
    expect(seconds('n/a')).toBeUndefined();
    expect(seconds(undefined)).toBeUndefined();
  });
});
