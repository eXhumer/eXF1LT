import { Timeline } from '@exhumer/f1-live-timing';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import type { Session } from '../src/sources/session.js';
import { SessionProvider, useSessionContext } from '../src/state/SessionContext.js';
import { type Playback, SPEEDS, usePlayback } from '../src/state/usePlayback.js';
import { eventually, raceTimeline, T0 } from './helpers.js';

/** Renders the playback state and hands the latest Playback to the test. */
function mount(session: Session) {
  let playback: Playback | undefined;
  function Probe() {
    playback = usePlayback();
    return <Text>{`${playback.playing ? 'playing' : 'paused'} ${playback.speed}x${playback.following ? ' following' : ''}`}</Text>;
  }
  const view = render(
    <SessionProvider session={session}>
      <Probe />
    </SessionProvider>,
  );
  return { ...view, playback: () => playback!, session };
}

function replay(timeline: Timeline, at: number): Session {
  const cursor = timeline.cursor();
  cursor.seek(at);
  return { kind: 'replay', timeline, cursor, skippedTopics: [], close: async () => undefined };
}

function live(timeline: Timeline, subscribeLiveStatus?: Session['subscribeLiveStatus']): Session {
  const cursor = timeline.cursor();
  cursor.follow();
  return {
    kind: 'live',
    timeline,
    cursor,
    skippedTopics: [],
    liveStatus: () => 'connected',
    ...(subscribeLiveStatus ? { subscribeLiveStatus } : {}),
    close: async () => undefined,
  };
}

describe('usePlayback on a replay', () => {
  it('plays from the cursor and stops at the end of the data', async () => {
    const timeline = raceTimeline();
    const { playback, lastFrame, session, unmount } = mount(replay(timeline, timeline.last! - 250));
    expect(lastFrame()).toBe('paused 1x');
    playback().togglePlay();
    await eventually(() => expect(lastFrame()).toBe('playing 1x'));
    await eventually(() => expect(lastFrame()).toBe('paused 1x'));
    expect(session.cursor.time).toBe(timeline.last);
    unmount();
  });

  it('advances while it plays', async () => {
    const timeline = raceTimeline();
    const { playback, session, unmount } = mount(replay(timeline, T0 + 100_000));
    playback().togglePlay();
    await eventually(() => expect(session.cursor.time).toBeGreaterThan(T0 + 100_000));
    playback().togglePlay();
    unmount();
  });

  it('steps through the speeds and stops at either end', async () => {
    const { playback, lastFrame, unmount } = mount(replay(raceTimeline(), T0));
    for (const _ of SPEEDS) playback().faster();
    await eventually(() => expect(lastFrame()).toBe(`paused ${SPEEDS.at(-1)}x`));
    for (const _ of SPEEDS) playback().slower();
    await eventually(() => expect(lastFrame()).toBe(`paused ${SPEEDS[0]}x`));
    unmount();
  });

  it('keeps seeks inside the data, and does not go live', () => {
    const timeline = raceTimeline();
    const { playback, session, unmount } = mount(replay(timeline, T0 + 100_000));
    playback().seekBy(-10 * 60_000);
    expect(session.cursor.time).toBe(timeline.first);
    playback().seekTo(T0 + 10 * 60 * 60_000);
    expect(session.cursor.time).toBe(timeline.last);
    playback().goLive();
    expect(session.cursor.following).toBe(false);
    unmount();
  });

  it('copes with a timeline that has no data yet', async () => {
    const timeline = new Timeline();
    const { playback, lastFrame, unmount } = mount(replay(timeline, T0));
    playback().seekTo(T0);
    playback().togglePlay();
    await eventually(() => expect(lastFrame()).toBe('playing 1x'));
    await eventually(() => expect(lastFrame()).toBe('paused 1x'));
    unmount();
  });
});

describe('usePlayback on a live feed', () => {
  it('follows the feed, freezes on pause, and catches up when played', async () => {
    const timeline = raceTimeline();
    const { playback, lastFrame, session, unmount } = mount(live(timeline));
    expect(lastFrame()).toBe('playing 1x following');

    playback().togglePlay();
    await eventually(() => expect(lastFrame()).toBe('paused 1x'));
    expect(session.cursor.following).toBe(false);

    // Playing again from the newest data reaches the end at once and follows again.
    playback().togglePlay();
    await eventually(() => expect(lastFrame()).toBe('playing 1x following'));
    expect(session.cursor.following).toBe(true);

    playback().seekBy(-60_000);
    await eventually(() => expect(lastFrame()).toBe('playing 1x'));
    playback().goLive();
    await eventually(() => expect(lastFrame()).toBe('playing 1x following'));
    unmount();
  });
});

describe('SessionProvider', () => {
  it('redraws on live status changes and stops listening on unmount', async () => {
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const session = live(raceTimeline(), (next) => {
      listener = () => next('reconnecting');
      return unsubscribe;
    });
    const { unmount } = mount(session);
    await eventually(() => expect(listener).toBeDefined());
    listener!();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('explains a component used outside it', () => {
    function Outside() {
      try {
        useSessionContext();
        return <Text>inside</Text>;
      } catch (error) {
        return <Text>{(error as Error).message}</Text>;
      }
    }
    const { lastFrame, unmount } = render(<Outside />);
    expect(lastFrame()).toBe('useSession must be used inside <SessionProvider>.');
    unmount();
  });
});
