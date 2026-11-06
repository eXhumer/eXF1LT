import {
  type HubConnectionLike,
  isPlainObject,
  LiveClient,
  type LiveTimingMessage,
  Recorder,
  Timeline,
} from '@exhumer/f1-live-timing';

import type { Session } from './session.js';

export interface LiveSourceOptions {
  readonly authToken?: string | undefined;
  /** Record the session into this directory while following it. */
  readonly recordDir?: string | undefined;
  /** For tests: replaces the SignalR connection. */
  readonly connectionFactory?: (url: string) => HubConnectionLike;
}

/** Statuses of a session that is over: the feed keeps serving it until the next one. */
const ENDED = new Set(['Finalised', 'Ends']);

/**
 * Connect to the live feed and follow it.
 *
 * `LiveClient` keeps reconnecting until the connection comes back, and the
 * timeline clears itself when the feed moves on to the next session, so the
 * scrubber, laps and telemetry only ever cover the session showing.
 *
 * When recording, a session that had already ended when the feed connected is
 * skipped; the next session goes into `recordDir`, and any after it into
 * `recordDir-<session key>`.
 */
export async function openLive(options: LiveSourceOptions = {}): Promise<Session> {
  const live = await LiveClient.connect({
    ...(options.authToken ? { authToken: options.authToken } : {}),
    raw: options.recordDir !== undefined,
    ...(options.connectionFactory ? { connectionFactory: options.connectionFactory } : {}),
  });
  const timeline = Timeline.fromLive(live);
  timeline.insert(live.snapshot);

  let recorder: Recorder | undefined;
  const closing: Promise<void>[] = [];
  let unrecord = () => {};
  if (options.recordDir) {
    const recordDir = options.recordDir;
    const record = (dir: string, messages: readonly LiveTimingMessage[] = []) => {
      if (recorder) closing.push(recorder.close());
      recorder = Recorder.createSync(dir);
      for (const message of messages) recorder.write(message);
    };
    const status = live.snapshot.find((message) => message.topic === 'SessionStatus')?.data;
    if (!(isPlainObject(status) && ENDED.has(status['Status'] as string))) record(recordDir, live.snapshot);
    const unsession = live.subscribeSession((session) => record(recorder ? `${recordDir}-${session.key}` : recordDir));
    const unmessages = live.subscribeMessages((message) => recorder?.write(message));
    unrecord = () => {
      unsession();
      unmessages();
    };
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
      unrecord();
      cursor.dispose();
      timeline[Symbol.dispose]();
      await live.close();
      await Promise.all([...closing, recorder?.close()]);
    },
  };
}
