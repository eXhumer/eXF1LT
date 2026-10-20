/**
 * The derived state on partial and malformed feed data: F1 sends patches,
 * leaves fields out until they are known, and changes shapes between list and
 * index-keyed objects, so every fallback is exercised here.
 */
import { type LiveTimingMessage, Timeline } from '@exhumer/f1-live-timing';
import { describe, expect, it } from 'vitest';

import { buildChampionship, formatPoints, placesGained, pointsGain } from '../src/state/championship.js';
import { lapStarts, sessionStartTime } from '../src/state/laps.js';
import { sessionParts, trackPeriods } from '../src/state/periods.js';
import { buildPitStops, parsePitStopSeries } from '../src/state/pitStops.js';
import { buildTimingRows } from '../src/state/timingRows.js';
import { findLap } from '../src/state/trackOutline.js';
import { T0 } from './helpers.js';

const at = (seconds: number) => T0 + seconds * 1000;
function timeline(messages: LiveTimingMessage[]): Timeline {
  const result = new Timeline();
  result.insert(messages);
  return result;
}

describe('buildChampionship', () => {
  it('needs drivers or teams', () => {
    expect(buildChampionship('nope', undefined)).toBeUndefined();
    expect(buildChampionship({ Drivers: [], Teams: 'x' }, undefined)).toBeUndefined();
  });

  it('falls back to the racing number, sorts the unknown last and ties by name', () => {
    const championship = buildChampionship(
      {
        Drivers: {
          '1': { PredictedPoints: 10 },
          '2': { CurrentPoints: 10 },
          '3': { PredictedPosition: 1, PredictedPoints: 25 },
          '4': 'not a row',
          '5': {},
        },
        Teams: { 'McLaren Mercedes': { PredictedPoints: 40, PredictedPosition: 1 }, Other: { CurrentPoints: 3 } },
      },
      undefined,
    )!;
    // 3 has a position; 1 and 2 have none, so 1 (10 predicted) goes before 2 (none, 0), and 5 has no standing.
    expect(championship.drivers.map((row) => row.name)).toEqual(['3', '1', '2']);
    expect(championship.drivers[0]).toMatchObject({ team: '', colour: undefined });
    // A team without TeamName uses its key, and no driver gives it a colour.
    expect(championship.teams.map((row) => [row.name, row.colour])).toEqual([
      ['McLaren Mercedes', undefined],
      ['Other', undefined],
    ]);
  });

  it('puts a driver without predicted points after one with, whichever comes first', () => {
    for (const drivers of [
      { '1': { CurrentPoints: 3 }, '2': { PredictedPoints: 4 } },
      { '2': { PredictedPoints: 4 }, '1': { CurrentPoints: 3 } },
    ]) {
      expect(buildChampionship({ Drivers: drivers }, undefined)!.drivers.map((row) => row.key)).toEqual(['2', '1']);
    }
  });

  it('ties equal standings by name', () => {
    const championship = buildChampionship(
      { Drivers: { '81': { PredictedPoints: 5 }, '4': { PredictedPoints: 5 } } },
      { '4': { Tla: 'NOR' }, '81': { LastName: 'Piastri', TeamName: 'McLaren' } } as never,
    )!;
    expect(championship.drivers.map((row) => row.name)).toEqual(['NOR', 'PIASTRI']);
  });

  it('formats points and the change in points and places', () => {
    expect(formatPoints(undefined)).toBe('');
    expect(formatPoints(12)).toBe('12');
    expect(formatPoints(0.5)).toBe('0.5');
    const row = { key: '1', name: 'A', team: '', colour: undefined } as const;
    expect(pointsGain({ ...row, currentPoints: 10, predictedPoints: 18 } as never)).toBe(8);
    expect(pointsGain({ ...row, currentPoints: 10 } as never)).toBeUndefined();
    expect(placesGained({ ...row, currentPosition: 5, predictedPosition: 3 } as never)).toBe(2);
    expect(placesGained({ ...row, predictedPosition: 3 } as never)).toBeUndefined();
  });
});

describe('laps', () => {
  it('starts an empty timeline at zero, and one that never went green at its first message', () => {
    expect(sessionStartTime(new Timeline())).toBe(0);
    expect(sessionStartTime(timeline([{ topic: 'LapCount', utc: at(5), data: { CurrentLap: 1 } }]))).toBe(at(5));
  });

  it('ignores a lap count that does not move forward', () => {
    const laps = lapStarts(
      timeline([
        { topic: 'LapCount', utc: at(1), data: { CurrentLap: 1 } },
        { topic: 'LapCount', utc: at(2), data: { CurrentLap: 1 } },
        { topic: 'LapCount', utc: at(3), data: { TotalLaps: 50 } },
        { topic: 'LapCount', utc: at(4), data: { CurrentLap: 2 } },
      ]),
    );
    expect(laps).toEqual([
      { lap: 1, utc: at(1) },
      { lap: 2, utc: at(4) },
    ]);
  });
});

describe('pit stops', () => {
  it('orders stops without a timestamp first and has no lap for a stop before any laps', () => {
    const series = parsePitStopSeries({
      PitTimes: { '1': [{ PitStop: { Lap: '12', PitStopTime: '2.4' }, Timestamp: '2026-10-11T12:30:00' }, { PitStop: { Lap: '0' } }] },
    })!;
    expect(series.get('1')).toEqual([
      { lap: undefined, stationary: undefined, lane: undefined },
      { lap: 12, stationary: '2.4', lane: undefined },
    ]);
  });

  it('rebuilds a stop after a stint of no laps without a lap', () => {
    const row = { number: '1', tla: 'NOR', previousStints: [{ compound: 'SOFT', isNew: true, laps: 0, age: 0 }], stint: undefined };
    expect(buildPitStops([row as never], undefined).rows[0]?.stops).toEqual([{ lap: undefined, stationary: undefined, lane: undefined }]);
  });
});

describe('buildTimingRows', () => {
  const rows = (lines: Record<string, object>, extra: object = {}) =>
    buildTimingRows({ timingData: { Lines: lines, ...extra } as never, appData: undefined, drivers: undefined });

  it('puts rows without a line last and fills a bare row with blanks', () => {
    const [first, second] = rows({ '9': {}, '4': { Line: 1 } });
    expect([first?.number, second?.number]).toEqual(['4', '9']);
    expect(second).toMatchObject({
      tla: '9',
      lastName: '9',
      position: '',
      gap: '',
      interval: '',
      catching: false,
      best: '',
      gridPosition: undefined,
      stint: undefined,
      status: 'running',
    });
  });

  it('reads retired, stopped, in pit and out lap states', () => {
    const states = rows({
      '1': { Line: 1, Stopped: true },
      '2': { Line: 2, InPit: true },
      '3': { Line: 3, PitOut: true },
      '4': { Line: 4, Retired: true },
    });
    expect(states.map((row) => [row.status, row.dim])).toEqual([
      ['stopped', false],
      ['pit', false],
      ['pitout', false],
      ['retired', true],
    ]);
  });

  it('sorts a row without a line after one with, whichever comes first', () => {
    // Object.entries lists numeric keys in ascending order, so the keys pick which row the sort compares against.
    expect(rows({ '4': { Line: 1 }, '9': {} }).map((row) => row.number)).toEqual(['4', '9']);
    expect(rows({ '1': {}, '4': { Line: 1 } }).map((row) => row.number)).toEqual(['4', '1']);
  });

  it('takes practice gaps from the loose fields, and blanks for a qualifying part without them', () => {
    const [practice] = rows({ '1': { Line: 1, TimeDiffToFastest: '+0.2', TimeDiffToPositionAhead: '+0.1' } });
    expect([practice?.gap, practice?.interval]).toEqual(['+0.2', '+0.1']);
    const [qualifying] = rows({ '1': { Line: 1, Stats: [{}] } }, { SessionPart: 1 });
    expect([qualifying?.gap, qualifying?.interval]).toEqual(['', '']);
    const [interval] = rows({ '1': { Line: 1, IntervalToPositionAhead: {} } });
    expect(interval?.interval).toBe('');
  });

  it('counts a stint without lap fields as no laps', () => {
    const [row] = buildTimingRows({
      timingData: { Lines: { '1': { Line: 1 } } } as never,
      appData: { Lines: { '1': { Stints: [{ Compound: 'SOFT', New: 'false' }] } } } as never,
      drivers: undefined,
    });
    expect(row?.stint).toEqual({ compound: 'SOFT', isNew: false, laps: 0, age: 0 });
  });
});

describe('findLap', () => {
  it('gives up on a drive that never comes back within the longest lap', () => {
    const straight = Array.from({ length: 300 }, (_, second) => ({ utc: at(second), status: 'OnTrack', x: second * 100, y: 1, z: 0 }));
    expect(findLap(straight)).toBeUndefined();
  });
});

describe('trackPeriods on malformed race control', () => {
  it('skips updates it cannot read and flags it does not track', () => {
    const periods = trackPeriods(
      timeline([
        { topic: 'TrackStatus', utc: at(1), data: { Status: 2 } },
        { topic: 'RaceControlMessages', utc: at(2), data: { Messages: 'x' } },
        { topic: 'RaceControlMessages', utc: at(3), data: 'x' },
        { topic: 'RaceControlMessages', utc: at(4), data: { Messages: [{ Flag: 'BLUE', Scope: 'Sector', Sector: 3 }, 'x'] } },
        { topic: 'RaceControlMessages', utc: at(5), data: { Messages: [{ Flag: 'YELLOW', Scope: 'Sector', Sector: 3 }] } },
        { topic: 'RaceControlMessages', utc: at(6), data: { Messages: [{ Flag: 'GREEN', Scope: 'Sector', Sector: 3 }] } },
        { topic: 'RaceControlMessages', utc: at(7), data: { Messages: [{ Flag: 'YELLOW', Scope: 'Sector', Sector: 3 }] } },
        { topic: 'RaceControlMessages', utc: at(8), data: { Messages: [{ Flag: 'GREEN', Scope: 'Track' }] } },
        { topic: 'RaceControlMessages', utc: at(9), data: { Messages: [{ Flag: 'YELLOW', Scope: 'Sector', Sector: 3 }] } },
        { topic: 'RaceControlMessages', utc: at(10), data: { Messages: [{ Flag: 'CHEQUERED', Scope: 'Track' }] } },
        { topic: 'RaceControlMessages', utc: at(11), data: { Messages: [{ Flag: 'BLUE', Scope: 'Track' }] } },
      ]),
      at(20),
    );
    expect(periods).toEqual([
      { kind: 'yellow', from: at(5), to: at(6) },
      { kind: 'yellow', from: at(7), to: at(8) },
      { kind: 'yellow', from: at(9), to: at(10) },
    ]);
  });

  it('joins a yellow that clears and returns in the same instant', () => {
    const flag = (seconds: number, value: string, sector: number): LiveTimingMessage => ({
      topic: 'RaceControlMessages',
      utc: at(seconds),
      data: { Messages: [{ Flag: value, Scope: 'Sector', Sector: sector }] },
    });
    const periods = trackPeriods(timeline([flag(10, 'YELLOW', 4), flag(20, 'CLEAR', 4), flag(20, 'YELLOW', 5), flag(30, 'CLEAR', 5)]), at(40));
    expect(periods).toEqual([{ kind: 'yellow', from: at(10), to: at(30) }]);
  });
});

describe('sessionParts on partial data', () => {
  it('reads SessionData lists and patches, and falls back to the message time', () => {
    const parts = sessionParts(
      timeline([
        { topic: 'SessionData', utc: at(1), data: { Series: [{ QualifyingPart: 1 }, 'x'] } },
        { topic: 'SessionData', utc: at(2), data: { Series: 'x' } },
        { topic: 'SessionData', utc: at(3), data: 'x' },
        { topic: 'SessionStatus', utc: at(4), data: { Status: 'Inactive' } },
        { topic: 'SessionStatus', utc: at(50), data: { Status: 'Ends' } },
      ]),
      at(100),
    );
    // No SessionInfo: plain Q. No "Started": the part starts at its number.
    expect(parts).toEqual([{ part: 1, label: 'Q1', from: at(1), to: at(50) }]);
  });

  it('keeps the earliest time a part number was seen', () => {
    const parts = sessionParts(
      timeline([
        { topic: 'TimingData', utc: at(10), data: { SessionPart: 1 } },
        { topic: 'SessionData', utc: at(20), data: { Series: { '0': { QualifyingPart: 1, Utc: new Date(at(5)).toISOString() } } } },
        { topic: 'TimingData', utc: at(30), data: { SessionPart: 0 } },
        { topic: 'TimingData', utc: at(40), data: { SessionPart: 1 } },
      ]),
      at(100),
    );
    expect(parts[0]?.from).toBe(at(5));
  });
});
