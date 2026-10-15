import { Timeline } from '@exhumer/f1-live-timing';
import { describe, expect, it, vi } from 'vitest';

import { remainingAt } from '../src/format/time.js';
import { FrameStore } from '../src/state/frame.js';
import { lapStart, lapStarts, sessionStartTime, statusMarkers } from '../src/state/laps.js';
import { buildTimingRows, segmentKind } from '../src/state/timingRows.js';
import { raceTimeline, T0 } from './helpers.js';

describe('buildTimingRows', () => {
  const timeline = raceTimeline();
  const state = timeline.latest();
  const rows = buildTimingRows({
    timingData: state['TimingData'] as never,
    appData: state['TimingAppData'] as never,
    drivers: state['DriverList'] as never,
  });

  it('orders rows and joins driver and tyre data', () => {
    expect(rows.map((row) => row.tla)).toEqual(['NOR', 'PIA', 'VER']);
    expect(rows[0]).toMatchObject({ teamColour: '#F47600', compound: 'MEDIUM', tyreAge: 18, gap: 'LAP 34', pits: 1 });
  });

  it('maps fastest flags to tones and pit state to status', () => {
    expect(rows[0]!.sectors.map((sector) => sector.tone)).toEqual(['overall', 'personal', 'normal']);
    expect(rows[1]!.last.tone).toBe('personal');
    expect(rows[2]).toMatchObject({ status: 'pit', catching: true, compound: undefined });
  });

  it('uses the qualifying part stats when present', () => {
    const [row] = buildTimingRows({
      timingData: {
        SessionPart: 2,
        Lines: {
          '1': {
            Line: 1,
            Position: '1',
            Stats: [
              { TimeDiffToFastest: '+0.1', TimeDifftoPositionAhead: '+0.1' },
              { TimeDiffToFastest: '+0.2', TimeDifftoPositionAhead: '+0.05' },
            ],
            KnockedOut: true,
          },
        },
      } as never,
      appData: undefined,
      drivers: undefined,
    });
    expect(row).toMatchObject({ tla: '1', gap: '+0.2', interval: '+0.05', dim: true });
  });

  it('reads stints, grid changes, best sectors and speed traps', () => {
    const full = buildTimingRows({
      timingData: state['TimingData'] as never,
      appData: state['TimingAppData'] as never,
      drivers: state['DriverList'] as never,
      stats: state['TimingStats'] as never,
    });
    const pia = full[1]!;
    expect(pia).toMatchObject({ lastName: 'PIASTRI', gridPosition: 1, positionChange: -1 });
    expect(pia.stint).toEqual({ compound: 'HARD', isNew: false, laps: 18, age: 21 });
    expect(pia.previousStints).toEqual([{ compound: 'SOFT', isNew: true, laps: 12, age: 12 }]);
    expect(pia.bestSectors.map((sector) => sector.tone)).toEqual(['personal', 'overall', 'overall']);
    expect(full[2]!.speeds[2]).toEqual({ value: '253', tone: 'overall' });
    expect(full[0]!.sectors[0]!.segments).toEqual([2051, 2049, 2048]);
  });

  it('reads laps down from lapped gaps', () => {
    const [row] = buildTimingRows({
      timingData: { Lines: { '1': { Line: 1, Position: '18', GapToLeader: '3L' } } } as never,
      appData: undefined,
      drivers: undefined,
    });
    expect(row?.lapsDown).toBe(3);
  });

  it('decodes mini-sector status codes', () => {
    expect([0, 2048, 2049, 2051, 2052, 2064, 2068].map(segmentKind)).toEqual([
      'none',
      'normal',
      'personal',
      'overall',
      'stopped',
      'pit',
      'pit',
    ]);
  });

  it('is empty without timing data', () => {
    expect(buildTimingRows({ timingData: undefined, appData: undefined, drivers: undefined })).toEqual([]);
  });
});

describe('laps', () => {
  const timeline = raceTimeline();

  it('parks a minute before the start', () => {
    expect(sessionStartTime(timeline)).toBe(T0 + 60_000);
    expect(sessionStartTime(new Timeline())).toBe(0);
  });

  it('finds lap starts', () => {
    expect(lapStarts(timeline).map((entry) => entry.lap)).toEqual([1, 2, 3]);
    expect(lapStart(timeline, 2)).toBe(T0 + 220_000);
    expect(lapStart(timeline, 9)).toBeUndefined();
  });

  it('marks the safety car', () => {
    expect(statusMarkers(timeline)).toEqual([{ utc: T0 + 300_000, kind: 'sc' }]);
  });
});

describe('remainingAt', () => {
  it('counts down while extrapolating', () => {
    const clock = { Utc: '2026-10-11T12:00:00Z', Remaining: '01:00:00', Extrapolating: true };
    expect(remainingAt(clock, T0 + 61_000)).toBe('00:58:59');
    expect(remainingAt({ ...clock, Extrapolating: false }, T0 + 61_000)).toBe('01:00:00');
    expect(remainingAt(undefined, T0)).toBeUndefined();
  });
});

describe('FrameStore', () => {
  it('coalesces bursts into one frame per interval', () => {
    vi.useFakeTimers();
    const store = new FrameStore(100);
    const listener = vi.fn();
    store.subscribe(listener);
    store.bump();
    store.bump();
    store.bump();
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getVersion()).toBe(2);
    store.dispose();
    vi.useRealTimers();
  });
});
