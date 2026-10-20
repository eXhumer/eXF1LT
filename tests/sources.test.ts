import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type HubConnectionLike, LiveClient, type LiveTimingMessage, Recorder } from '@exhumer/f1-live-timing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openLive } from '../src/sources/live.js';
import { openRecording, openReplay } from '../src/sources/replay.js';
import { raceMessages, T0 } from './helpers.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'exf1lt-sources-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** Pushes a feed update through the last fake hub created. */
let feed: (topic: string, data: unknown, timestamp: string) => void = () => undefined;

/** A hub that answers `Subscribe` with a snapshot. */
function hub(snapshot: Record<string, unknown>): HubConnectionLike {
  return {
    start: async () => undefined,
    stop: async () => undefined,
    invoke: (async (method: string) => (method === 'Subscribe' ? snapshot : undefined)) as HubConnectionLike['invoke'],
    on: (name, handler) => {
      if (name === 'feed') feed = handler as typeof feed;
    },
    onclose: () => undefined,
    onreconnecting: () => undefined,
    onreconnected: () => undefined,
  };
}

/** LiveClient.connect as the app calls it, but over the fake hub instead of F1's. */
function connectToFakeHub(snapshot: Record<string, unknown>) {
  const connect = LiveClient.connect.bind(LiveClient);
  return vi.spyOn(LiveClient, 'connect').mockImplementation((options) => connect({ ...options, connectionFactory: () => hub(snapshot) }));
}

describe('openLive', () => {
  it('connects with the token, records the session and reports the connection status', async () => {
    const spy = connectToFakeHub({ LapCount: { CurrentLap: 3, TotalLaps: 62 } });
    const recordDir = join(dir, 'recording');
    const session = await openLive({ authToken: 'token', recordDir });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ authToken: 'token', raw: true });
    expect(session.recordingTo).toBe(recordDir);
    expect(session.liveStatus?.()).toBe('connected');
    feed('LapCount', { CurrentLap: 4 }, '2026-10-11T12:01:00Z');
    const statuses: string[] = [];
    session.subscribeLiveStatus?.((status) => statuses.push(status));
    await session.close();
    expect(statuses).toContain('closed');
    expect(await readdir(recordDir)).toContain('LapCount.jsonStream');
    expect(await readFile(join(recordDir, 'LapCount.jsonStream'), 'utf8')).toContain('"CurrentLap":4');
  });

  it('connects without a token or recording by default', async () => {
    const spy = connectToFakeHub({});
    const session = await openLive();
    expect(spy.mock.calls[0]?.[0]).toEqual({ raw: false });
    expect(session.recordingTo).toBeUndefined();
    await session.close();
  });
});

describe('openReplay', () => {
  function archive(messages: LiveTimingMessage[]) {
    return {
      sessionFeeds: async () => ({ Feeds: { SessionStatus: {}, LapCount: {} } }),
      streamStart: async () => T0,
      stream: async function* (_path: string, topic: string) {
        yield* messages.filter((message) => message.topic === topic);
      },
    };
  }

  it('loads the session, reports progress and parks before the start', async () => {
    const progress: unknown[] = [];
    const session = await openReplay(archive(raceMessages()) as never, '2026/x/', (update) => progress.push(update));
    expect(session.kind).toBe('replay');
    // A minute before the green light, but not before the first message (the green light itself here).
    expect(session.cursor.time).toBe(T0 + 120_000);
    expect(progress[0]).toEqual({ loaded: 0, total: 2 });
    expect(progress).toContainEqual(expect.objectContaining({ loaded: 2, total: 2 }));
    await session.close();
  });

  it('loads without a progress callback', async () => {
    const session = await openReplay(archive(raceMessages()) as never, '2026/x/');
    expect(session.timeline.size).toBeGreaterThan(0);
    await session.close();
  });
});

describe('openRecording', () => {
  it('reads a recording back and parks before the start', async () => {
    const recorder = await Recorder.create(dir);
    for (const message of raceMessages()) recorder.write(message);
    await recorder.close();
    const session = await openRecording(dir);
    expect(session.kind).toBe('recording');
    expect(session.cursor.time).toBe(T0 + 60_000);
    await session.close();
  });
});
