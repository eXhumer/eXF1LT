import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ArchiveClient, type HubConnectionLike, LiveClient, Recorder, type SeasonIndex } from '@exhumer/f1-live-timing';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { clearSessionChecks } from '../src/archive/seasonCatalog.js';
import type { LoadProgress } from '../src/sources/replay.js';
import type { Session } from '../src/sources/session.js';
import { eventually, raceMessages, replaySession, T0 } from './helpers.js';

const exit = vi.fn();
vi.mock('ink', async (importOriginal) => ({ ...(await importOriginal<typeof import('ink')>()), useApp: () => ({ exit }) }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const ENTER = '\r';
const ESCAPE = '\u001B';

/**
 * Press escape. Ink holds a lone escape until more input shows it is not the
 * start of an escape sequence; a second one releases the first (and is held
 * itself, harmlessly).
 */
const pressEscape = async (stdin: { write: (data: string) => void }) => {
  stdin.write(ESCAPE);
  await settle();
  stdin.write(ESCAPE);
};

const SEASON: SeasonIndex = {
  Year: 2026,
  Meetings: [
    {
      Key: 1,
      Code: 'SGP',
      Number: 18,
      Location: 'Marina Bay',
      OfficialName: 'Singapore Grand Prix 2026',
      Name: 'Singapore Grand Prix',
      Country: { Key: 1, Code: 'SGP', Name: 'Singapore' },
      Circuit: { Key: 1, ShortName: 'Marina Bay' },
      Sessions: [
        {
          Key: 10,
          Type: 'Race',
          Name: 'Race',
          StartDate: '2026-10-11T20:00:00',
          EndDate: '2026-10-11T22:00:00',
          GmtOffset: '08:00:00',
          Path: '2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/',
        },
      ],
    },
  ],
};

/** An archive with one season, one race and the race fixture's messages. */
const archive = {
  index: async () => ({ Years: [{ Year: 2026, Path: '2026/' }] }),
  streamingStatus: async () => 'Offline',
  latestSession: async () => ({}),
  season: async () => SEASON,
  sessionFeeds: async () => ({ Feeds: { SessionInfo: {}, DriverList: {}, TimingData: {}, LapCount: {} } }),
  streamStart: async () => T0,
  stream: async function* (_path: string, topic: string) {
    yield* raceMessages().filter((message) => message.topic === topic);
  },
} as unknown as ArchiveClient;

let dir: string;
beforeEach(async () => {
  clearSessionChecks();
  exit.mockReset();
  dir = await mkdtemp(join(tmpdir(), 'exf1lt-app-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** Wide enough for every hint. */
function wide() {
  const probe = render(<></>);
  vi.spyOn(Object.getPrototypeOf(probe.stdout), 'columns', 'get').mockReturnValue(240);
  probe.unmount();
}

const app = (props: Partial<Parameters<typeof App>[0]> = {}) => {
  wide();
  return render(<App archive={archive} start={{ kind: 'picker' }} token={undefined} {...props} />);
};

describe('App', () => {
  it('opens a session from the picker, goes back to it, and quits from it', async () => {
    const { stdin, lastFrame, unmount } = app();
    await eventually(() => expect(lastFrame()).toContain('Singapore Grand Prix'));
    stdin.write(ENTER);
    await eventually(() => expect(lastFrame()).toContain('esc sessions'));
    await pressEscape(stdin);
    await eventually(() => expect(lastFrame()).toContain('choose a session'));
    stdin.write('q');
    await eventually(() => expect(exit).toHaveBeenCalled());
    unmount();
  });

  it('follows the live session with the token and closes it on quit', async () => {
    const connect = LiveClient.connect.bind(LiveClient);
    const hub: HubConnectionLike = {
      start: async () => undefined,
      stop: async () => undefined,
      invoke: (async () => ({ LapCount: { CurrentLap: 5, TotalLaps: 62 } })) as HubConnectionLike['invoke'],
      on: () => undefined,
      onclose: () => undefined,
      onreconnecting: () => undefined,
      onreconnected: () => undefined,
    };
    const spy = vi.spyOn(LiveClient, 'connect').mockImplementation((options) => connect({ ...options, connectionFactory: () => hub }));
    const token = { token: 'abc', source: 'cache', state: 'valid', expiresAt: undefined } as const;
    const { stdin, lastFrame, unmount } = app({ start: { kind: 'live' }, token, raceControl: 'off', exportDir: dir });
    await eventually(() => expect(lastFrame()).toContain('● LIVE'));
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ authToken: 'abc' });
    expect(lastFrame()).not.toContain('esc sessions');
    stdin.write('q');
    await eventually(() => expect(exit).toHaveBeenCalled());
    unmount();
  });

  it('plays back a recording', async () => {
    const recorder = await Recorder.create(dir);
    for (const message of raceMessages()) recorder.write(message);
    await recorder.close();
    const { lastFrame, unmount } = app({ start: { kind: 'recording', dir } });
    await eventually(() => expect(lastFrame()).toContain('RECORDING'));
    unmount();
  });

  it('opens a replay given on the command line', async () => {
    const { lastFrame, unmount } = app({ start: { kind: 'replay', path: '2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/' } });
    await eventually(() => expect(lastFrame()).toContain('Singapore Grand Prix · Race'));
    unmount();
  });

  it('shows loading progress, and quits while loading', async () => {
    let report: (progress: LoadProgress) => void = () => undefined;
    const openSession = (_source: unknown, onProgress: (progress: LoadProgress) => void) => {
      report = onProgress;
      return new Promise<Session>(() => undefined);
    };
    const { stdin, lastFrame, unmount } = app({ start: { kind: 'replay', path: 'a/b/' }, openSession });
    await eventually(() => expect(lastFrame()).toContain('Loading a/b/…'));
    report({ loaded: 0, total: 0 });
    await eventually(() => expect(lastFrame()).toMatch(/topics 0\/0 ░{30}$/m));
    report({ loaded: 1, total: 2, topic: 'LapCount' });
    await eventually(() => expect(lastFrame()).toMatch(/topics 1\/2 ▓{15}░{15} LapCount/));
    stdin.write('x');
    stdin.write('q');
    await eventually(() => expect(exit).toHaveBeenCalled());
    unmount();
  });

  it('shows a failure, with a way back only when the session came from the picker', async () => {
    const openSession = async () => Promise.reject(new Error('archive down'));
    const direct = app({ start: { kind: 'live' }, openSession });
    await eventually(() => expect(direct.lastFrame()).toContain('✖ archive down'));
    expect(direct.lastFrame()).toContain('q quit');
    expect(direct.lastFrame()).not.toContain('esc back');
    await pressEscape(direct.stdin); // nowhere to go back to
    await settle();
    direct.stdin.write('q');
    await eventually(() => expect(exit).toHaveBeenCalled());
    direct.unmount();

    const picked = app({ openSession });
    await eventually(() => expect(picked.lastFrame()).toContain('Singapore Grand Prix'));
    picked.stdin.write(ENTER);
    await eventually(() => expect(picked.lastFrame()).toContain('esc back to sessions · q quit'));
    await pressEscape(picked.stdin);
    await eventually(() => expect(picked.lastFrame()).toContain('choose a session'));
    picked.unmount();
  });

  it('opens the live session picked from the picker', async () => {
    const openSession = vi.fn(async () => replaySession());
    const streaming = {
      ...archive,
      streamingStatus: async () => 'Available',
      latestSession: async () => ({ Meeting: { Name: 'Singapore Grand Prix' }, Name: 'Race' }),
    } as unknown as ArchiveClient;
    const { stdin, lastFrame, unmount } = app({ archive: streaming, openSession });
    await eventually(() => expect(lastFrame()).toContain('LIVE NOW'));
    stdin.write(ENTER);
    await eventually(() => expect(openSession).toHaveBeenCalledWith({ kind: 'live' }, expect.any(Function)));
    unmount();
  });

  it('closes the session when quitting from it', async () => {
    const session = replaySession();
    const close = vi.spyOn(session, 'close');
    const { stdin, lastFrame, unmount } = app({ start: { kind: 'replay', path: 'x/' }, openSession: async () => session });
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('q');
    await eventually(() => expect(exit).toHaveBeenCalled());
    expect(close).toHaveBeenCalled();
    unmount();
  });
});
