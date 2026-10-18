import type { DriverList } from '@exhumer/f1-live-timing';
import { describe, expect, it } from 'vitest';

import { buildChampionship, formatPoints, placesGained, pointsGain } from '../src/state/championship.js';

const DRIVERS = {
  '1': { RacingNumber: '1', Tla: 'NOR', LastName: 'Norris', TeamName: 'McLaren', TeamColour: 'F47600', Line: 1 },
  '81': { RacingNumber: '81', Tla: 'PIA', LastName: 'Piastri', TeamName: 'McLaren', TeamColour: 'F47600', Line: 2 },
} as unknown as DriverList;

const prediction = {
  Drivers: {
    '81': { RacingNumber: '81', CurrentPosition: 2, PredictedPosition: 1, CurrentPoints: 100, PredictedPoints: 125 },
    '1': { RacingNumber: '1', CurrentPosition: 1, PredictedPosition: 2, CurrentPoints: 110, PredictedPoints: 118.5 },
    '99': { RacingNumber: '99' },
  },
  Teams: {
    'McLaren Mercedes': {
      TeamName: 'McLaren',
      CurrentPosition: 1,
      PredictedPosition: 1,
      CurrentPoints: 210,
      PredictedPoints: 243.5,
    },
    'Mystery Team': { TeamName: 'Mystery', CurrentPosition: 2, PredictedPosition: 2, CurrentPoints: 0, PredictedPoints: 0 },
  },
};

describe('buildChampionship', () => {
  it('orders drivers by predicted position and names them from the driver list', () => {
    const { drivers } = buildChampionship(prediction, DRIVERS)!;
    expect(drivers.map((d) => [d.predictedPosition, d.name, d.team, d.colour])).toEqual([
      [1, 'PIASTRI', 'McLaren', '#F47600'],
      [2, 'NORRIS', 'McLaren', '#F47600'],
    ]);
  });

  it('drops entries with no standing yet and keeps unknown drivers by number', () => {
    const { drivers } = buildChampionship(
      { Drivers: { '99': { RacingNumber: '99', CurrentPosition: 22, PredictedPosition: 22, CurrentPoints: 0, PredictedPoints: 0 }, '98': {} } },
      DRIVERS,
    )!;
    expect(drivers.map((d) => d.name)).toEqual(['99']);
  });

  it('colours a constructor from the drivers of the team its short name matches', () => {
    const { teams } = buildChampionship(prediction, DRIVERS)!;
    expect(teams.map((t) => [t.name, t.colour])).toEqual([['McLaren', '#F47600'], ['Mystery', undefined]]);
  });

  it('is undefined while the feed is empty or malformed', () => {
    expect(buildChampionship(undefined, DRIVERS)).toBeUndefined();
    expect(buildChampionship({ Drivers: {}, Teams: {} }, DRIVERS)).toBeUndefined();
    expect(buildChampionship([], DRIVERS)).toBeUndefined();
  });
});

describe('standing helpers', () => {
  const [first, second] = buildChampionship(prediction, DRIVERS)!.drivers;

  it('measures places gained and points added', () => {
    expect(placesGained(first!)).toBe(1);
    expect(placesGained(second!)).toBe(-1);
    expect(pointsGain(first!)).toBe(25);
    expect(pointsGain(second!)).toBe(8.5);
  });

  it('prints whole points plainly and half points with a decimal', () => {
    expect(formatPoints(337)).toBe('337');
    expect(formatPoints(8.5)).toBe('8.5');
    expect(formatPoints(undefined)).toBe('');
  });
});
