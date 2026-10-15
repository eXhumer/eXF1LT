import { useCallback, useEffect, useRef, useState } from 'react';

import { useSessionContext } from './SessionContext.js';

export const SPEEDS = [0.5, 1, 2, 4, 8, 16] as const;
const TICK_MS = 100;

export interface Playback {
  readonly playing: boolean;
  readonly speed: number;
  /** `true` while a live cursor sits on the newest data. */
  readonly following: boolean;
  togglePlay(): void;
  faster(): void;
  slower(): void;
  seekBy(ms: number): void;
  seekTo(utc: number): void;
  /** Live only: jump back to the newest data and stay there. */
  goLive(): void;
}

/**
 * Drives the shared cursor. Replays advance on a clock at `speed`; a live
 * session follows the feed until the user pauses or seeks, and `goLive`
 * resumes following.
 */
export function usePlayback(): Playback {
  const { session, frames } = useSessionContext();
  const { cursor, timeline } = session;
  const live = session.kind === 'live';
  const [playing, setPlaying] = useState(live ? true : false);
  const [speed, setSpeed] = useState(1);
  const [following, setFollowing] = useState(cursor.following);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!playing || following) return;
    const timer = setInterval(() => {
      const last = timeline.last ?? cursor.time;
      const next = cursor.time + TICK_MS * speedRef.current;
      if (live && next >= last) {
        cursor.follow();
        setFollowing(true);
      } else if (next >= last) {
        cursor.advanceTo(last);
        setPlaying(false);
      } else {
        cursor.advanceTo(next);
      }
      frames.bump();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, following, live, cursor, timeline, frames]);

  const clamp = useCallback(
    (utc: number) => Math.min(Math.max(utc, timeline.first ?? utc), timeline.last ?? utc),
    [timeline],
  );

  const seekTo = useCallback(
    (utc: number) => {
      cursor.seek(clamp(utc));
      setFollowing(false);
      frames.bump();
    },
    [cursor, clamp, frames],
  );

  return {
    playing,
    speed,
    following,
    togglePlay() {
      if (following) {
        // Pausing a followed live feed freezes it where it is.
        cursor.advanceTo(cursor.time);
        setFollowing(false);
        setPlaying(false);
      } else {
        setPlaying((value) => !value);
      }
      frames.bump();
    },
    faster: () => setSpeed((value) => SPEEDS.find((s) => s > value) ?? value),
    slower: () => setSpeed((value) => [...SPEEDS].reverse().find((s) => s < value) ?? value),
    seekBy: (ms) => seekTo(cursor.time + ms),
    seekTo,
    goLive() {
      if (!live) return;
      cursor.follow();
      setFollowing(true);
      setPlaying(true);
      frames.bump();
    },
  };
}
