import { type LiveTimingMessage, Timeline } from '@exhumer/f1-live-timing';
import { describe, expect, it } from 'vitest';

import { sessionParts, trackPeriods } from '../src/state/periods.js';
import { T0 } from './helpers.js';

const at = (seconds: number) => T0 + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString().replace('Z', '');

function timeline(messages: LiveTimingMessage[]): Timeline {
  const result = new Timeline();
  result.insert(messages);
  return result;
}

const status = (seconds: number, code: string): LiveTimingMessage => ({ topic: 'TrackStatus', utc: at(seconds), data: { Status: code } });
const sectorFlag = (seconds: number, flag: string, sector: number): LiveTimingMessage => ({
  topic: 'RaceControlMessages',
  utc: at(seconds),
  // F1 patches the message list by index after the first message.
  data: { Messages: { [String(seconds)]: { Utc: iso(seconds), Category: 'Flag', Flag: flag, Scope: 'Sector', Sector: sector } } },
});
const trackFlag = (seconds: number, flag: string): LiveTimingMessage => ({
  topic: 'RaceControlMessages',
  utc: at(seconds),
  data: { Messages: [{ Utc: iso(seconds), Category: 'Flag', Flag: flag, Scope: 'Track' }] },
});

describe('trackPeriods', () => {
  it('tells single from double yellows by race control sector flags', () => {
    const periods = trackPeriods(
      timeline([
        status(10, '2'),
        sectorFlag(10, 'YELLOW', 6),
        sectorFlag(15, 'DOUBLE YELLOW', 7),
        sectorFlag(20, 'CLEAR', 7),
        sectorFlag(25, 'CLEAR', 6),
        status(25, '1'),
      ]),
      at(100),
    );
    expect(periods).toEqual([
      { kind: 'yellow', from: at(10), to: at(15) },
      { kind: 'double-yellow', from: at(15), to: at(20) },
      { kind: 'yellow', from: at(20), to: at(25) },
    ]);
  });

  it('puts SC, VSC and red over the sector flags, and lifts the flags on all clear', () => {
    const periods = trackPeriods(
      timeline([
        status(10, '2'),
        sectorFlag(10, 'DOUBLE YELLOW', 3),
        status(20, '6'),
        status(30, '7'),
        status(40, '4'),
        status(60, '5'),
        status(80, '1'),
      ]),
      at(100),
    );
    expect(periods).toEqual([
      { kind: 'double-yellow', from: at(10), to: at(20) },
      { kind: 'vsc', from: at(20), to: at(40) },
      { kind: 'sc', from: at(40), to: at(60) },
      { kind: 'red', from: at(60), to: at(80) },
    ]);
  });

  it('lifts every sector flag on a track-wide clear', () => {
    const periods = trackPeriods(
      timeline([sectorFlag(10, 'YELLOW', 1), sectorFlag(12, 'DOUBLE YELLOW', 2), trackFlag(30, 'CLEAR')]),
      at(100),
    );
    expect(periods.at(-1)).toEqual({ kind: 'double-yellow', from: at(12), to: at(30) });
  });

  it('falls back to TrackStatus for a yellow race control did not describe, and closes an open period at the end', () => {
    expect(trackPeriods(timeline([status(10, '2'), status(20, '1'), status(50, '4')]), at(100))).toEqual([
      { kind: 'yellow', from: at(10), to: at(20) },
      { kind: 'sc', from: at(50), to: at(100) },
    ]);
  });

  it('keeps a condition that flickers off for an instant as one period', () => {
    const periods = trackPeriods(
      timeline([status(10, '2'), sectorFlag(10, 'YELLOW', 4), sectorFlag(20, 'CLEAR', 4), sectorFlag(20, 'YELLOW', 5), status(30, '1')]),
      at(100),
    );
    expect(periods).toEqual([{ kind: 'yellow', from: at(10), to: at(30) }]);
  });
});

describe('sessionParts', () => {
  const info = (name: string): LiveTimingMessage => ({ topic: 'SessionInfo', utc: at(0), data: { Name: name, Type: 'Qualifying' } });
  const sessionStatus = (seconds: number, value: string): LiveTimingMessage => ({ topic: 'SessionStatus', utc: at(seconds), data: { Status: value } });
  const qualifyingPart = (seconds: number, part: number): LiveTimingMessage => ({
    topic: 'SessionData',
    utc: at(seconds),
    data: { Series: { [String(part)]: { Utc: `${iso(seconds)}Z`, QualifyingPart: part } } },
  });
  const timingPart = (seconds: number, part: number): LiveTimingMessage => ({ topic: 'TimingData', utc: at(seconds), data: { SessionPart: part } });

  /**
   * Q1 is numbered before it starts; Q2's number comes after Q1 finishes and
   * Q2 is red-flagged and restarted; Q3's number comes two seconds after it starts.
   */
  function qualifying(name: string): Timeline {
    return timeline([
      info(name),
      qualifyingPart(5, 1),
      sessionStatus(60, 'Started'),
      sessionStatus(1140, 'Finished'),
      timingPart(1150, 2),
      sessionStatus(1560, 'Started'),
      sessionStatus(1800, 'Aborted'),
      sessionStatus(2100, 'Started'),
      sessionStatus(2400, 'Finished'),
      sessionStatus(2900, 'Started'),
      timingPart(2902, 3),
      sessionStatus(3600, 'Finished'),
      sessionStatus(3700, 'Finalised'),
    ]);
  }

  it('starts each part when it goes green and ends it at the flag', () => {
    expect(sessionParts(qualifying('Qualifying'), at(3800))).toEqual([
      { part: 1, label: 'Q1', from: at(60), to: at(1140) },
      { part: 2, label: 'Q2', from: at(1560), to: at(2400) },
      { part: 3, label: 'Q3', from: at(2900), to: at(3600) },
    ]);
  });

  it('labels sprint qualifying SQ1 to SQ3', () => {
    expect(sessionParts(qualifying('Sprint Qualifying'), at(3800)).map((part) => part.label)).toEqual(['SQ1', 'SQ2', 'SQ3']);
  });

  it('runs a part still in progress to the end of the data', () => {
    const parts = sessionParts(timeline([info('Qualifying'), timingPart(0, 1), sessionStatus(60, 'Started')]), at(500));
    expect(parts).toEqual([{ part: 1, label: 'Q1', from: at(60), to: at(500) }]);
  });

  it('finds no parts outside qualifying', () => {
    expect(sessionParts(timeline([sessionStatus(60, 'Started'), sessionStatus(600, 'Finished')]), at(700))).toEqual([]);
  });
});
