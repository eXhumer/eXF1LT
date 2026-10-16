import type { HubConnectionLike } from '@exhumer/f1-live-timing';
import { describe, expect, it } from 'vitest';

import { openLive } from '../src/sources/live.js';

/** A hub that answers `Subscribe` with a snapshot and lets the test push feed updates. */
function fakeHub(snapshot: Record<string, unknown>) {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const connection: HubConnectionLike = {
    start: async () => undefined,
    stop: async () => undefined,
    invoke: (async (method: string) => (method === 'Subscribe' ? snapshot : undefined)) as HubConnectionLike['invoke'],
    on: (name, handler) => void handlers.set(name, handler),
    onclose: () => undefined,
    onreconnecting: () => undefined,
    onreconnected: () => undefined,
  };
  const feed = (topic: string, data: unknown, timestamp: string) =>
    (handlers.get('feed') as (topic: string, data: unknown, timestamp: string) => void)(topic, data, timestamp);
  return { connection, feed };
}

describe('openLive', () => {
  it('keeps the subscription snapshot that LiveClient emits before connect resolves', async () => {
    const hub = fakeHub({
      LapCount: { CurrentLap: 10, TotalLaps: 62 },
      ExtrapolatedClock: { Utc: '2026-10-11T12:00:00Z', Remaining: '01:00:00', Extrapolating: true },
    });
    const session = await openLive({ connectionFactory: () => hub.connection });

    expect(session.cursor.following).toBe(true);
    expect(session.cursor.get('LapCount')).toEqual({ CurrentLap: 10, TotalLaps: 62 });
    expect(session.skippedTopics).toEqual(['Position', 'CarData']);

    hub.feed('LapCount', { CurrentLap: 11 }, '2026-10-11T12:01:00Z');
    expect(session.cursor.get('LapCount')).toEqual({ CurrentLap: 11, TotalLaps: 62 });
    await session.close();
  });
});
