import { type ArchiveClient, fromWireTopic, loadRecording, loadReplay, type Topic } from '@exhumer/f1-live-timing';

import { sessionStartTime } from '../state/laps.js';
import type { Session } from './session.js';

export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
  readonly topic?: Topic;
}

/** Load an archived session and park the cursor just before the session starts. */
export async function openReplay(
  archive: ArchiveClient,
  path: string,
  onProgress?: (progress: LoadProgress) => void,
): Promise<Session> {
  const feeds = await archive.sessionFeeds(path);
  const total = Object.keys(feeds.Feeds).map(fromWireTopic).length;
  let loaded = 0;
  onProgress?.({ loaded, total });
  const { timeline, missing } = await loadReplay(archive, path, {
    onTopicLoaded: (topic) => onProgress?.({ loaded: ++loaded, total, topic }),
  });
  const cursor = timeline.cursor();
  cursor.seek(sessionStartTime(timeline));
  return {
    kind: 'replay',
    timeline,
    cursor,
    skippedTopics: missing,
    async close() {
      cursor.dispose();
    },
  };
}

/** Load a local recording (or downloaded archive session). */
export async function openRecording(dir: string): Promise<Session> {
  const timeline = await loadRecording(dir);
  const cursor = timeline.cursor();
  cursor.seek(sessionStartTime(timeline));
  return {
    kind: 'recording',
    timeline,
    cursor,
    skippedTopics: [],
    async close() {
      cursor.dispose();
    },
  };
}
