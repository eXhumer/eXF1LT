import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '../src/sources/session.js';
import { SessionProvider } from '../src/state/SessionContext.js';
import { TimingView } from '../src/views/TimingView.js';
import { eventually, raceTimeline, replaySession, sessionOf, T0 } from './helpers.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  shiftRight: '\u001B[1;2C',
  shiftLeft: '\u001B[1;2D',
  escape: '\u001B',
  enter: '\r',
  backspace: '\u007F',
};

/** Wide enough for every hint. */
function wide() {
  const probe = render(<></>);
  vi.spyOn(Object.getPrototypeOf(probe.stdout), 'columns', 'get').mockReturnValue(240);
  probe.unmount();
}

function mount(session: Session, props: { onQuit?: () => void; onBack?: () => void; raceControl?: 'side' | 'bottom' | 'off' } = {}) {
  wide();
  return render(
    <SessionProvider session={session}>
      <TimingView token={undefined} onQuit={props.onQuit ?? (() => undefined)} onBack={props.onBack} raceControl={props.raceControl ?? 'side'} />
    </SessionProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TimingView keys on a replay', () => {
  it('jumps to a lap typed after j, and leaves the prompt with enter or escape', async () => {
    const session = replaySession();
    const { stdin, lastFrame, unmount } = mount(session);
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));

    stdin.write('j');
    await eventually(() => expect(lastFrame()).toContain('Jump to lap:'));
    for (const key of ['x', '9', '7', KEY.backspace]) {
      stdin.write(key);
      await settle();
    }
    await eventually(() => expect(lastFrame()).toMatch(/Jump to lap: 9▏/));
    stdin.write(KEY.backspace);
    await settle();
    stdin.write('2');
    await eventually(() => expect(lastFrame()).toMatch(/Jump to lap: 2▏/));
    stdin.write(KEY.enter);
    await eventually(() => expect(session.cursor.time).toBe(T0 + 220_000));

    // A lap that has not started, an empty prompt and escape change nothing.
    for (const keys of [['j', '9', KEY.enter], ['j', KEY.enter], ['j', KEY.escape]]) {
      for (const key of keys) {
        stdin.write(key);
        await settle();
      }
      expect(lastFrame()).not.toContain('Jump to lap:');
      expect(session.cursor.time).toBe(T0 + 220_000);
    }
    unmount();
  });

  it('plays, seeks by five seconds and by lap, and changes speed', async () => {
    const session = replaySession();
    const { stdin, lastFrame, unmount } = mount(session);
    await eventually(() => expect(lastFrame()).toContain('space play'));
    const start = session.cursor.time;

    stdin.write(KEY.right);
    await eventually(() => expect(session.cursor.time).toBe(start + 5_000));
    stdin.write(KEY.left);
    await eventually(() => expect(session.cursor.time).toBe(start));
    // On lap 2: shift+← goes to lap 1, shift+→ back to lap 2.
    stdin.write(KEY.shiftLeft);
    await eventually(() => expect(session.cursor.time).toBe(T0 + 120_000));
    stdin.write(KEY.shiftRight);
    await eventually(() => expect(session.cursor.time).toBe(T0 + 220_000));

    stdin.write(']');
    await eventually(() => expect(lastFrame()).toContain('REPLAY 2×'));
    stdin.write('[');
    await eventually(() => expect(lastFrame()).toContain('REPLAY 1×'));
    stdin.write('L'); // not live: nothing to go back to
    stdin.write(' ');
    await eventually(() => expect(lastFrame()).toContain('space pause'));
    stdin.write(' ');
    await eventually(() => expect(lastFrame()).toContain('space play'));
    unmount();
  });

  it('moves the selection within the rows, pins a driver and unpins it', async () => {
    const { stdin, lastFrame, unmount } = mount(replaySession());
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('2');
    await eventually(() => expect(lastFrame()).toContain('pin H2H'));
    stdin.write(KEY.up); // already at the top
    await settle();
    stdin.write('h');
    await eventually(() => expect(lastFrame()).toContain('h unpin'));
    stdin.write('h');
    await eventually(() => expect(lastFrame()).toContain('h pin H2H'));
    // m marks the selected driver, and m again unmarks it.
    stdin.write('m');
    await eventually(() => expect(lastFrame()).toContain('export 1 marked'));
    stdin.write('m');
    await eventually(() => expect(lastFrame()).toContain('m mark  e export '));
    unmount();
  });

  it('quits with q and goes back with escape', async () => {
    const onQuit = vi.fn();
    const onBack = vi.fn();
    const { stdin, lastFrame, unmount } = mount(replaySession(), { onQuit, onBack });
    await eventually(() => expect(lastFrame()).toContain('esc sessions'));
    stdin.write(KEY.escape);
    await eventually(() => expect(onBack).toHaveBeenCalled());
    stdin.write('q');
    await eventually(() => expect(onQuit).toHaveBeenCalled());
    unmount();
  });
});

describe('TimingView on a live feed', () => {
  it('hides the scrubber while following, and offers to go live once paused', async () => {
    const timeline = raceTimeline();
    const cursor = timeline.cursor();
    cursor.follow();
    const session: Session = { kind: 'live', timeline, cursor, skippedTopics: [], liveStatus: () => 'connected', close: async () => undefined };
    const { stdin, lastFrame, unmount } = mount(session);
    await eventually(() => expect(lastFrame()).toContain('space pause  ← rewind'));
    expect(lastFrame()).not.toMatch(/│━/);

    stdin.write(' ');
    await eventually(() => expect(lastFrame()).toContain('L go live'));
    expect(lastFrame()).toMatch(/│[━═]+●/); // the safety car runs to the playhead
    stdin.write('L');
    await eventually(() => expect(lastFrame()).toContain('● LIVE'));
    unmount();
  });
});

describe('TimingView without timing data', () => {
  it('ignores selection, marks, exports and lap steps when there are no rows or laps', async () => {
    const session = sessionOf([]);
    const { stdin, lastFrame, unmount } = mount(session);
    await eventually(() => expect(lastFrame()).toContain('Waiting for session…'));
    const before = session.cursor.time;
    for (const key of [KEY.up, 'm', 'e', 'p', 'n']) {
      stdin.write(key);
      await settle();
    }
    expect(lastFrame()).not.toContain('Exporting');
    expect(lastFrame()).not.toContain('marked');
    expect(session.cursor.time).toBe(before);
    unmount();
  });
});

describe('TimingView race control strip', () => {
  it('lists a message without a lap with blank space for it', async () => {
    const session = sessionOf([
      { topic: 'RaceControlMessages', utc: T0, data: { Messages: [{ Utc: '2026-10-11T12:00:00', Message: 'GREEN LIGHT - PIT EXIT OPEN', Category: 'Flag' }] } },
    ]);
    const { lastFrame, unmount } = mount(session, { raceControl: 'bottom' });
    // Padding, four blanks where the lap goes, a space, then the time.
    await eventually(() => expect(lastFrame()).toMatch(/^ {6}12:00 GREEN LIGHT - PIT EXIT OPEN$/m));
    unmount();
  });
});
