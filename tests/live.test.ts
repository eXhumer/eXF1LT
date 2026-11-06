import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type HubConnectionLike, loadRecording } from '@exhumer/f1-live-timing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openLive } from '../src/sources/live.js';

/** A hub that answers `Subscribe` with `snapshot` and lets the test push feed updates. */
function fakeHub(snapshot: Record<string, unknown>) {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const hub = {
    snapshot,
    factory: (): HubConnectionLike => ({
      start: async () => {},
      stop: async () => {},
      invoke: (async (method: string) => (method === 'Subscribe' ? hub.snapshot : undefined)) as HubConnectionLike['invoke'],
      on: (name, handler) => void handlers.set(name, handler),
      onclose: (handler) => void handlers.set('close', handler),
      onreconnecting: (handler) => void handlers.set('reconnecting', handler),
      onreconnected: (handler) => void handlers.set('reconnected', handler),
    }),
    feed: (topic: string, data: unknown, timestamp: string) =>
      (handlers.get('feed') as (topic: string, data: unknown, timestamp: string) => void)(topic, data, timestamp),
    reconnecting: () => (handlers.get('reconnecting') as () => void)(),
    reconnected: () => (handlers.get('reconnected') as (id: string | null) => void)(null),
  };
  return hub;
}

const STARTED = {
  Heartbeat: { Utc: '2026-10-11T12:00:02Z' },
  SessionInfo: { Key: 1, Name: 'Qualifying' },
  SessionStatus: { Status: 'Started' },
  LapCount: { CurrentLap: 3 },
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'exf1lt-live-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('openLive', () => {
  it('keeps the subscription snapshot that LiveClient emits before connect resolves', async () => {
    const hub = fakeHub({
      LapCount: { CurrentLap: 10, TotalLaps: 62 },
      ExtrapolatedClock: { Utc: '2026-10-11T12:00:00Z', Remaining: '01:00:00', Extrapolating: true },
    });
    const session = await openLive({ connectionFactory: hub.factory });

    expect(session.cursor.following).toBe(true);
    expect(session.cursor.get('LapCount')).toEqual({ CurrentLap: 10, TotalLaps: 62 });
    expect(session.skippedTopics).toEqual(['Position', 'CarData']);
    expect(session.recordingTo).toBeUndefined();

    hub.feed('LapCount', { CurrentLap: 11 }, '2026-10-11T12:01:00Z');
    expect(session.cursor.get('LapCount')).toEqual({ CurrentLap: 11, TotalLaps: 62 });
    await session.close();
    expect(session.liveStatus!()).toBe('closed');
  });

  it('starts afresh when the feed moves on to a new session', async () => {
    const hub = fakeHub(STARTED);
    const session = await openLive({ connectionFactory: hub.factory });
    const clear = vi.spyOn(session.timeline.telemetry, 'clear');

    hub.feed('SessionInfo', { Key: 1 }, '2026-10-11T12:01:00Z');
    expect(session.cursor.get('LapCount')).toEqual({ CurrentLap: 3 });
    expect(clear).not.toHaveBeenCalled();

    hub.feed('SessionInfo', { Key: 2, Name: 'Race' }, '2026-10-11T13:00:00Z');
    expect(clear).toHaveBeenCalledOnce();
    expect(session.timeline.first).toBe(Date.parse('2026-10-11T13:00:00Z'));
    expect(session.cursor.get('LapCount')).toBeUndefined();
    expect(session.cursor.get('SessionInfo')).toEqual({ Key: 2, Name: 'Race' });
    await session.close();
  });

  it("passes SignalR's reconnects through, with the fresh snapshot winning over older updates", async () => {
    const hub = fakeHub({ LapCount: { CurrentLap: 1, TotalLaps: 50 }, ExtrapolatedClock: { Utc: '2026-10-11T12:00:00Z' } });
    const session = await openLive({ connectionFactory: hub.factory });
    const statuses: string[] = [];
    session.subscribeLiveStatus!((status) => statuses.push(status));
    hub.feed('LapCount', { CurrentLap: 2 }, '2026-10-11T12:05:00Z');

    hub.reconnecting();
    expect(session.liveStatus!()).toBe('reconnecting');
    // Stamped with the clock's 12:00 change, the snapshot must still win over the 12:05 update.
    hub.snapshot = { LapCount: { CurrentLap: 3, TotalLaps: 50 }, ExtrapolatedClock: { Utc: '2026-10-11T12:00:00Z' } };
    hub.reconnected();
    await vi.waitFor(() => expect(session.liveStatus!()).toBe('connected'));
    expect(session.cursor.get('LapCount')).toEqual({ CurrentLap: 3, TotalLaps: 50 });
    expect(statuses).toEqual(['reconnecting', 'connected']);
    await session.close();
  });

  it('records the session, and the next one into its own directory', async () => {
    const hub = fakeHub(STARTED);
    const recordDir = join(dir, 'q');
    const session = await openLive({ connectionFactory: hub.factory, recordDir });
    expect(session.recordingTo).toBe(recordDir);
    hub.feed('LapCount', { CurrentLap: 4 }, '2026-10-11T12:01:00Z');
    hub.feed('SessionInfo', { Key: 2, Name: 'Race' }, '2026-10-11T13:00:00Z');
    hub.feed('LapCount', { CurrentLap: 1 }, '2026-10-11T13:01:00Z');
    await session.close();

    expect((await readdir(dir)).sort()).toEqual(['q', 'q-2']);
    expect((await loadRecording(recordDir)).latest()['LapCount']).toEqual({ CurrentLap: 4 });
    const next = await loadRecording(`${recordDir}-2`);
    expect(next.latest()['SessionInfo']).toEqual({ Key: 2, Name: 'Race' });
    expect(next.latest()['LapCount']).toEqual({ CurrentLap: 1 });
  });

  it('skips a session that had already ended when it connected', async () => {
    const hub = fakeHub({ ...STARTED, SessionStatus: { Status: 'Ends' } });
    const recordDir = join(dir, 'race');
    const session = await openLive({ connectionFactory: hub.factory, recordDir });
    hub.feed('Heartbeat', { Utc: '2026-10-11T12:01:00Z' }, '2026-10-11T12:01:00Z');
    expect(await readdir(dir)).toEqual([]);

    hub.feed('SessionInfo', { Key: 2, Name: 'Race' }, '2026-10-11T13:00:00Z');
    hub.feed('SessionStatus', { Status: 'Started' }, '2026-10-11T14:00:00Z');
    await session.close();

    expect(await readdir(dir)).toEqual(['race']);
    const recording = await loadRecording(recordDir);
    expect(recording.latest()['SessionStatus']).toEqual({ Status: 'Started' });
    expect(recording.latest()['Heartbeat']).toBeUndefined();
  });
});
