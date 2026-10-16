import { type HubConnectionLike, LiveClient, Recorder, Timeline } from '@exhumer/f1-live-timing';

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
 * `LiveClient.connect()` delivers the subscription snapshot before it
 * resolves, so the timeline and recording start from `live.snapshot`.
 */
export async function openLive(options: LiveSourceOptions = {}): Promise<Session> {
  const raw = options.recordDir !== undefined;
  const live = await LiveClient.connect({
    ...(options.authToken ? { authToken: options.authToken } : {}),
    raw,
    ...(options.connectionFactory ? { connectionFactory: options.connectionFactory } : {}),
  });

  const timeline = Timeline.fromLive(live);
  const recorder = options.recordDir ? await Recorder.create(options.recordDir) : undefined;
  timeline.insert(live.snapshot);
  if (recorder) {
    for (const message of live.snapshot) recorder.write(message);
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
