import type { Cursor, LiveStatus, Timeline, Topic } from '@exhumer/f1-live-timing';

export type SessionKind = 'live' | 'replay' | 'recording';

/** A loaded session: every source ends up as a timeline with one shared cursor. */
export interface Session {
  readonly kind: SessionKind;
  readonly timeline: Timeline;
  readonly cursor: Cursor;
  /** Topics the source could not provide (live without a token). */
  readonly skippedTopics: readonly Topic[];
  /** Live connection status; `undefined` for replays and recordings. */
  readonly liveStatus?: () => LiveStatus;
  readonly subscribeLiveStatus?: (listener: (status: LiveStatus) => void) => () => void;
  /** Where the session is being recorded, if it is. */
  readonly recordingTo?: string;
  close(): Promise<void>;
}
