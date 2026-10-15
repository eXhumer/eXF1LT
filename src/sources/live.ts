import {
  decodeTopicData,
  fromWireTopic,
  type HubConnectionLike,
  isCompressedTopic,
  isPlainObject,
  LiveClient,
  type LiveTimingMessage,
  Recorder,
  snapshotTime,
  Timeline,
} from '@exhumer/f1-live-timing';
import { HubConnectionBuilder, NullLogger } from '@exhumer/signalr-client';

import type { Session } from './session.js';

export interface LiveSourceOptions {
  readonly authToken?: string | undefined;
  /** Record the session into this directory while following it. */
  readonly recordDir?: string | undefined;
  /** For tests: replaces the SignalR connection. */
  readonly connectionFactory?: (url: string) => HubConnectionLike;
}

/**
 * Connect to the live feed and follow it.
 *
 * `LiveClient.connect()` emits the subscription snapshot before it resolves,
 * so a listener attached afterwards never sees it. The connection is wrapped
 * to capture the first `Subscribe` result, and the snapshot is inserted into
 * the timeline (and recording) by hand.
 */
export async function openLive(options: LiveSourceOptions = {}): Promise<Session> {
  const raw = options.recordDir !== undefined;
  let snapshot: unknown;
  const baseFactory = options.connectionFactory ?? defaultConnection;
  const connectionFactory = (url: string): HubConnectionLike => {
    const connection = baseFactory(url);
    const invoke = connection.invoke.bind(connection);
    connection.invoke = (async (method: string, ...args: unknown[]) => {
      const result = await invoke<unknown>(method, ...args);
      if (method === 'Subscribe' && snapshot === undefined) snapshot = result ?? null;
      return result;
    }) as HubConnectionLike['invoke'];
    return connection;
  };

  const live = await LiveClient.connect({
    ...(options.authToken ? { authToken: options.authToken } : {}),
    raw,
    connectionFactory,
  });

  const timeline = Timeline.fromLive(live);
  const recorder = options.recordDir ? await Recorder.create(options.recordDir) : undefined;
  const initial = snapshotMessages(snapshot, raw);
  timeline.insert(initial);
  if (recorder) {
    for (const message of initial) recorder.write(message);
    live.subscribeMessages((message) => recorder.write(message));
  }

  const cursor = timeline.cursor();
  cursor.follow();

  return {
    kind: 'live',
    timeline,
    cursor,
    skippedTopics: live.skippedTopics,
    liveStatus: () => live.status,
    subscribeLiveStatus: (listener) => live.subscribeStatus((status) => listener(status)),
    ...(options.recordDir ? { recordingTo: options.recordDir } : {}),
    async close() {
      cursor.dispose();
      timeline[Symbol.dispose]();
      await live.close();
      await recorder?.close();
    },
  };
}

/** The messages `LiveClient` builds from a `Subscribe` snapshot, rebuilt here. */
export function snapshotMessages(snapshot: unknown, raw: boolean): LiveTimingMessage[] {
  if (!isPlainObject(snapshot)) return [];
  const decoded = Object.entries(snapshot).map(([wire, value]) => [wire, value, decodeTopicData(wire, value)] as const);
  const utc = snapshotTime(new Map(decoded.map(([wire, , data]) => [fromWireTopic(wire), data])));
  const messages: LiveTimingMessage[] = [];
  for (const [wire, value, data] of decoded) {
    if (!isPlainObject(data)) continue;
    const message: LiveTimingMessage = { topic: fromWireTopic(wire), utc, data: { ...data, _kf: true } };
    messages.push(raw && isCompressedTopic(wire) && typeof value === 'string' ? { ...message, raw: value } : message);
  }
  return messages;
}

function defaultConnection(url: string): HubConnectionLike {
  return new HubConnectionBuilder()
    .withUrl(url)
    .withAutomaticReconnect()
    .configureLogging(new NullLogger())
    .withCookies()
    .build();
}
