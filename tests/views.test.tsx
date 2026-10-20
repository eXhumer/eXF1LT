import type { LiveTimingMessage } from '@exhumer/f1-live-timing';
import { describe, expect, it } from 'vitest';

import type { Span } from '../src/components/Table.js';
import type { PitRow, PitStopTable } from '../src/state/pitStops.js';
import { ChampionshipView, championshipColumns } from '../src/views/ChampionshipView.js';
import { historyLaps, pitStopColumns, tyreHistoryColumns } from '../src/views/PitsView.js';
import { TrackerView } from '../src/views/TrackerView.js';
import { TrackMapView } from '../src/views/TrackMapView.js';
import { DRIVERS, frameOf, positionMessages, raceMessages, sessionOf, T0, timingRow } from './helpers.js';

const text = (spans: Span | readonly Span[]) => [spans].flat().map((item) => item.text).join('');
const at = (seconds: number) => T0 + seconds * 1000;

describe('TrackMapView', () => {
  const position = (seconds: number, entries: Record<string, { X: number; Y: number }>): LiveTimingMessage => ({
    topic: 'Position',
    utc: at(seconds),
    data: { Position: [{ Timestamp: new Date(at(seconds)).toISOString(), Entries: Object.fromEntries(Object.entries(entries).map(([n, p]) => [n, { Status: 'OnTrack', Z: 0, ...p }])) }] },
  });

  it('asks for a token, waits for positions, then for a lap', () => {
    const map = (messages: LiveTimingMessage[], skipped: Session['skippedTopics'] = []) =>
      frameOf(sessionOf(messages, { skippedTopics: skipped }), <TrackMapView width={60} height={10} rows={[]} selected={undefined} />);
    expect(map([], ['Position'])).toContain('Track map needs F1 token');
    expect(map([])).toContain('No position data in this session yet.');
    expect(map([position(0, { '1': { X: 1, Y: 1 } })])).toContain('Waiting for one full lap');
  });

  it('labels cars by row, driver list or number, skips cars at the origin, and shows laps down', () => {
    const frame = frameOf(
      sessionOf([
        ...raceMessages(),
        ...positionMessages(0, 400),
        position(400, { '99': { X: 4000, Y: 0 }, '44': { X: 0, Y: 0 } }),
        { topic: 'RaceControlMessages', utc: at(400), data: { Messages: [{ Utc: '2026-10-11T12:06:40', Message: 'TRACK CLEAR', Category: 'Flag' }] } },
      ]),
      <TrackMapView width={80} height={20} rows={[timingRow({ number: '1', tla: 'NOR', lapsDown: 1 })]} selected="1" />,
    );
    expect(frame).toContain('NOR 1L');
    expect(frame).toContain('PIA');
    expect(frame).toContain('99');
    expect(frame).not.toContain('44');
    expect(frame).toMatch(/│ TRACK CLEAR/);
  });

  it('shows only the track status when race control has its own panel', () => {
    const frame = frameOf(
      sessionOf([...raceMessages(), ...positionMessages(0, 400)]),
      <TrackMapView width={80} height={20} rows={[]} selected={undefined} showLatestMessage={false} />,
    );
    expect(frame).toContain('■ SAFETY CAR');
    expect(frame).not.toContain('SAFETY CAR DEPLOYED');
  });
});

describe('TrackerView', () => {
  const session = () => sessionOf([...raceMessages(), { topic: 'DriverList', utc: T0, data: DRIVERS }]);
  const tracker = (tab: 'Head to Head' | 'Telemetry', rows: ReturnType<typeof timingRow>[], selected: string, pinned?: string) =>
    frameOf(session(), <TrackerView tab={tab} rows={rows} selected={selected} pinned={pinned} width={100} height={14} showLatestMessage={false} />);

  it('asks for a second driver when both are the same', () => {
    expect(tracker('Head to Head', [timingRow({ number: '1' })], '1', '1')).toContain('press h to pin');
  });

  it('compares drivers with missing times, tyres and a lapped car', () => {
    const a = timingRow({ number: '1', tla: 'NOR', last: { value: '1:35.000', tone: 'normal' }, gap: '+1.000' });
    const b = timingRow({ number: '81', tla: 'PIA', last: { value: 'x', tone: 'normal' }, gap: '+3.000', lapsDown: 1 });
    const frame = tracker('Head to Head', [a, b], '1', '81');
    expect(frame).toContain('INTERVAL –');
    // No delta against a time that is not one.
    expect(frame).toMatch(/1:35\.000 LAP x +│/);
    expect(frame).toMatch(/– TYRE {2}–/);
  });

  it('shows a car gaining in green and a car behind as positive', () => {
    const a = timingRow({ number: '1', tla: 'NOR', gap: '+1.000', sectors: [{ value: '28.000', tone: 'normal', segments: [] }] });
    const b = timingRow({ number: '81', tla: 'PIA', gap: '+3.500', sectors: [{ value: '28.500', tone: 'normal', segments: [] }] });
    const frame = tracker('Head to Head', [a, b], '1', '81');
    expect(frame).toContain('INTERVAL -2.500s');
    expect(frame).toContain('28.000  S1 28.500   -0.500');
    expect(tracker('Head to Head', [a, b], '81', '1')).toContain('INTERVAL +2.500s');
  });

  it('counts the leader, who has no gap, as zero', () => {
    const leader = timingRow({ number: '1', tla: 'NOR', gap: '' });
    const second = timingRow({ number: '81', tla: 'PIA', gap: '+2.000' });
    expect(tracker('Head to Head', [leader, second], '1', '81')).toContain('INTERVAL -2.000s');
  });

  it('shows one focus panel when the pinned driver is the selected one', () => {
    const frame = tracker('Telemetry', [timingRow({ number: '1' })], '1', '1');
    expect(frame.match(/FOCUS/g)).toHaveLength(1);
  });
});

describe('pit and tyre columns', () => {
  const pitRow = (patch: Partial<PitRow>): PitRow => ({ ...timingRow(), stops: [], ...patch });

  it('marks the fastest stop and leaves out unknown laps and times', () => {
    const rows = [pitRow({ stops: [{ lap: undefined, stationary: '2.1', lane: undefined }] }), pitRow({ number: '2', stops: [{ lap: 5, stationary: '2.5', lane: '20.1' }] })];
    const table: PitStopTable = { rows, fastest: { seconds: 2.1, tla: 'NOR' }, timed: true };
    const columns = pitStopColumns(table, 200);
    const best = columns.find((column) => column.header === 'BEST')!;
    const stop = columns.find((column) => column.header === 'STOP 1')!;
    expect(best.render(rows[0]!)).toMatchObject({ text: '2.1', bold: true });
    expect(best.render(rows[1]!)).toEqual({ text: '2.5' });
    expect(text(stop.render(rows[0]!))).toBe('     2.1       ');
    expect(text(stop.render(rows[1]!))).toBe('L5   2.5   20.1');
    // Too narrow for full names: three-letter codes.
    expect(pitStopColumns(table, 30).find((column) => column.header === 'DRV')).toBeDefined();
  });

  it('scales tyre history to the longest run without a race distance, and shortens labels that do not fit', () => {
    const rows = [pitRow({ previousStints: [{ compound: '', isNew: true, laps: 1, age: 1 }], stint: { compound: 'SOFT', isNew: true, laps: 30, age: 30 } })];
    expect(historyLaps(rows, undefined)).toBe(31);
    const history = tyreHistoryColumns(rows, undefined, 60).at(-1)!;
    // The one-lap stint has room for its letter only.
    expect(text(history.render(rows[0]!))).toMatch(/^\? +S30/);
    expect(tyreHistoryColumns(rows, undefined, 20).find((column) => column.header === 'DRV')).toBeDefined();
  });
});

describe('championship columns', () => {
  const row = { key: '1', name: 'NOR', team: 'McLaren', colour: undefined } as const;

  it('leaves out unknown positions and gains, and shows no gain as 0', () => {
    const columns = championshipColumns('Drivers', 200);
    const cell = (header: string, patch: object) => text(columns.find((column) => column.header === header)!.render({ ...row, ...patch } as never));
    expect(cell('POS', {})).toBe('');
    expect(cell('+/-', { currentPosition: 2 })).toBe('');
    expect(cell('GAIN', { currentPoints: 10 })).toBe('');
    expect(cell('GAIN', { currentPoints: 10, predictedPoints: 10 })).toBe('0');
    expect(championshipColumns('Drivers', 40).some((column) => column.header === 'TEAM')).toBe(false);
  });

  it('waits for the prediction', () => {
    const frame = frameOf(sessionOf([]), <ChampionshipView tab="Constructors" championship={undefined} selected={undefined} width={80} height={6} />);
    expect(frame).toContain('Waiting for the championship prediction…');
  });
});

type Session = import('../src/sources/session.js').Session;
