import { type LiveTimingMessage, Timeline } from '@exhumer/f1-live-timing';
import { vi } from 'vitest';

import type { Session } from '../src/sources/session.js';

export const T0 = Date.parse('2026-10-11T12:00:00Z');

/**
 * Retry `assertion` until it passes. Data loads, key presses and throttled
 * frames all land asynchronously, and CI runners (macOS Intel especially) can
 * be several times slower than a laptop, so never assert after a fixed sleep.
 */
export function eventually<T>(assertion: () => T, timeout = 5_000): Promise<T> {
  return vi.waitFor(assertion, { timeout, interval: 10 });
}

/** A JWT with the given `exp` (seconds). The signature is junk; nothing checks it. */
export function fakeJwt(exp: number | undefined): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(exp === undefined ? { sub: 'x' } : { exp, sub: 'x' })}.c2ln`;
}

export const DRIVERS = {
  '1': { RacingNumber: '1', Tla: 'NOR', LastName: 'Norris', TeamColour: 'F47600', Line: 1, TeamName: 'McLaren' },
  '81': { RacingNumber: '81', Tla: 'PIA', LastName: 'Piastri', TeamColour: 'F47600', Line: 2, TeamName: 'McLaren' },
  '3': { RacingNumber: '3', Tla: 'VER', LastName: 'Verstappen', TeamColour: '4781D7', Line: 3, TeamName: 'Red Bull Racing' },
};

function line(number: string, position: number, extra: Record<string, unknown> = {}) {
  return {
    RacingNumber: number,
    Line: position,
    Position: String(position),
    GapToLeader: position === 1 ? 'LAP 34' : `+${(position - 1) * 2.4}`,
    IntervalToPositionAhead: { Value: position === 1 ? '' : '+2.4', Catching: position === 3 },
    NumberOfPitStops: 1,
    Retired: false,
    InPit: false,
    PitOut: false,
    Stopped: false,
    Sectors: [
      { Value: '27.913', OverallFastest: position === 1, PersonalFastest: false, Segments: [{ Status: 2051 }, { Status: 2049 }, { Status: 2048 }] },
      { Value: '38.204', OverallFastest: false, PersonalFastest: true, Segments: [{ Status: 2048 }, { Status: 2064 }, { Status: 0 }] },
      { Value: '29.295', OverallFastest: false, PersonalFastest: false, Segments: [{ Status: 0 }, { Status: 0 }, { Status: 0 }] },
    ],
    Speeds: { I1: { Value: '294' }, I2: { Value: '272' }, FL: { Value: `${250 + position}`, OverallFastest: position === 3 } },
    BestLapTime: { Value: '1:34.981' },
    LastLapTime: { Value: '1:35.412', OverallFastest: false, PersonalFastest: position === 2 },
    ...extra,
  };
}

/** A small race timeline: three cars, a lap change, a safety car. */
export function raceMessages(): LiveTimingMessage[] {
  const at = (seconds: number) => T0 + seconds * 1000;
  return [
    {
      topic: 'SessionInfo',
      utc: at(0),
      data: {
        Meeting: { Name: 'Singapore Grand Prix', Location: 'Marina Bay' },
        Name: 'Race',
        Type: 'Race',
        GmtOffset: '08:00:00',
      },
    },
    { topic: 'DriverList', utc: at(0), data: DRIVERS },
    { topic: 'SessionStatus', utc: at(120), data: { Status: 'Started' } },
    { topic: 'TrackStatus', utc: at(120), data: { Status: '1', Message: 'AllClear' } },
    { topic: 'LapCount', utc: at(120), data: { CurrentLap: 1, TotalLaps: 62 } },
    {
      topic: 'TimingData',
      utc: at(121),
      data: { Lines: { '1': line('1', 1), '81': line('81', 2), '3': line('3', 3, { InPit: true }) } },
    },
    {
      topic: 'TimingAppData',
      utc: at(121),
      data: {
        Lines: {
          '1': { RacingNumber: '1', Line: 1, GridPos: '3', Stints: [{ Compound: 'MEDIUM', New: 'true', TotalLaps: 18, StartLaps: 0 }] },
          '81': {
            RacingNumber: '81',
            Line: 2,
            GridPos: '1',
            Stints: [
              { Compound: 'SOFT', New: 'true', TotalLaps: 12, StartLaps: 0 },
              { Compound: 'HARD', New: 'false', TotalLaps: 21, StartLaps: 3 },
            ],
          },
        },
      },
    },
    {
      topic: 'TimingStats',
      utc: at(121),
      data: {
        Lines: {
          '1': { BestSectors: [{ Position: 1, Value: '27.913' }, { Position: 2, Value: '38.204' }, { Position: 3, Value: '29.295' }] },
          '81': { BestSectors: [{ Position: 2, Value: '27.950' }, { Position: 1, Value: '38.100' }, { Position: 1, Value: '29.100' }] },
        },
      },
    },
    { topic: 'LapCount', utc: at(220), data: { CurrentLap: 2 } },
    { topic: 'TrackStatus', utc: at(300), data: { Status: '4', Message: 'SCDeployed' } },
    {
      topic: 'RaceControlMessages',
      utc: at(300),
      data: {
        Messages: [{ Utc: '2026-10-11T12:05:00', Lap: 2, Category: 'SafetyCar', Message: 'SAFETY CAR DEPLOYED' }],
      },
    },
    { topic: 'LapCount', utc: at(320), data: { CurrentLap: 3 } },
  ];
}

/** Radius of the synthetic circular circuit, in circuit units. */
export const TRACK_RADIUS = 5_000;
/** Lap time of every synthetic car. */
export const LAP_MS = 60_000;

/**
 * `Position` batches (one per second) of the three cars driving round a
 * circle, a third of a lap apart, from `from` to `to` seconds after T0.
 */
export function positionMessages(from = 0, to = 400): LiveTimingMessage[] {
  const phases: Record<string, number> = { '1': 0, '81': 1 / 3, '3': 2 / 3 };
  const messages: LiveTimingMessage[] = [];
  for (let second = from; second <= to; second += 1) {
    const utc = T0 + second * 1000;
    const entries: Record<string, unknown> = {};
    for (const [number, phase] of Object.entries(phases)) {
      const angle = 2 * Math.PI * ((second * 1000) / LAP_MS + phase);
      entries[number] = {
        Status: 'OnTrack',
        X: Math.round(TRACK_RADIUS * Math.cos(angle)),
        Y: Math.round(TRACK_RADIUS * Math.sin(angle)),
        Z: 0,
      };
    }
    messages.push({ topic: 'Position', utc, data: { Position: [{ Timestamp: new Date(utc).toISOString(), Entries: entries }] } });
  }
  return messages;
}

export function raceTimeline(withPositions = false): Timeline {
  const timeline = new Timeline();
  timeline.insert(withPositions ? [...raceMessages(), ...positionMessages()] : raceMessages());
  return timeline;
}

export function replaySession(timeline = raceTimeline()): Session {
  const cursor = timeline.cursor();
  cursor.seek(T0 + 310_000);
  return { kind: 'replay', timeline, cursor, skippedTopics: [], close: async () => cursor.dispose() };
}
