/**
 * The command line, run the way a user runs it: `process.argv` is set and
 * the entry module is imported fresh, which parses it. The TUI, the browser
 * login and the archive client are stood in for.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Recorder } from '@exhumer/f1-live-timing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTHORIZATION_FILE, writeCachedToken } from '../src/auth/tokenCache.js';
import { fakeJwt, raceMessages, T0 } from './helpers.js';

const mocks = vi.hoisted(() => ({
  render: vi.fn(() => ({ waitUntilExit: async () => undefined })),
  login: vi.fn(),
  archiveCredentials: [] as unknown[],
  archive: undefined as unknown,
}));

vi.mock('ink', async (importOriginal) => ({ ...(await importOriginal<typeof import('ink')>()), render: mocks.render }));
vi.mock('../src/auth/login.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/auth/login.js')>()), login: mocks.login }));
vi.mock('../src/auth/authorization.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/auth/authorization.js')>();
  return {
    ...real,
    createArchiveClient: (credential: unknown) => {
      mocks.archiveCredentials.push(credential);
      return mocks.archive ?? real.createArchiveClient(credential as never);
    },
  };
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'exf1lt-cli-'));
  vi.stubEnv('EXF1LT_CONFIG_DIR', join(dir, 'config'));
  vi.stubEnv('F1_TOKEN', '');
  vi.stubEnv('F1_AUTH_TOKEN', '');
  mocks.render.mockClear();
  mocks.login.mockReset();
  mocks.archiveCredentials.length = 0;
  mocks.archive = undefined;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** Runs `exf1lt <args>`; what it printed, and the exit code if it exited. */
async function run(...args: string[]) {
  vi.resetModules();
  process.argv = ['node', 'exf1lt', ...args];
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => void out.push(parts.join(' ')));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
  let exit: string | undefined;
  try {
    await import('../src/cli.js');
  } catch (error) {
    exit = (error as Error).message;
  }
  vi.mocked(console.log).mockRestore();
  vi.mocked(process.stderr.write).mockRestore();
  vi.mocked(process.exit).mockRestore();
  return { out: out.join('\n'), err: err.join(''), exit };
}

/** The props the TUI was started with. */
const appProps = () => (mocks.render.mock.calls.at(-1) as unknown as [{ props: Record<string, unknown> }])[0].props;

describe('exf1lt', () => {
  it('opens the session picker by default', async () => {
    const { exit } = await run();
    expect(exit).toBeUndefined();
    expect(appProps()).toMatchObject({ start: { kind: 'picker' }, raceControl: 'side', exportDir: '.' });
    expect(mocks.archiveCredentials).toEqual([{ token: undefined, source: 'none', state: 'none', expiresAt: undefined }]);
  });

  it('starts live, a replay or a recording with the options given', async () => {
    await run('--live', '--record', 'rec', '--race-control', 'bottom', '--export-dir', 'reports');
    expect(appProps()).toMatchObject({ start: { kind: 'live', recordDir: 'rec' }, raceControl: 'bottom', exportDir: 'reports' });
    await run('--replay', '2026/x/');
    expect(appProps()).toMatchObject({ start: { kind: 'replay', path: '2026/x/' } });
    await run('--recording', 'rec');
    expect(appProps()).toMatchObject({ start: { kind: 'recording', dir: 'rec' } });
  });

  it('refuses conflicting sources and a recording without --live', async () => {
    expect(await run('--live', '--replay', 'x')).toMatchObject({ exit: 'exit 1', err: expect.stringContaining('Choose one of --live, --replay and --recording.') });
    expect(await run('--record', 'rec')).toMatchObject({ exit: 'exit 1', err: expect.stringContaining('--record needs --live.') });
  });

  it('exits with the reason when a token file cannot be read', async () => {
    const missing = join(dir, 'missing.txt');
    expect((await run('--token-file', missing)).err).toContain('ENOENT');
    expect((await run('--auth-token-file', missing)).err).toContain('ENOENT');
  });

  it('uses tokens from the environment', async () => {
    vi.stubEnv('F1_TOKEN', fakeJwt(undefined));
    vi.stubEnv('F1_AUTH_TOKEN', 'auth-token');
    await run();
    expect(mocks.archiveCredentials[0]).toMatchObject({ token: 'auth-token', source: 'env' });
  });
});

describe('exf1lt token', () => {
  it('shows what is cached, and clears it', async () => {
    expect((await run('token', 'status')).out).toBe(
      ['Subscription (ascendon) token: not cached', 'Authorization token: not cached', `Location: ${join(dir, 'config')}`].join('\n'),
    );
    expect((await run('token', 'clear')).out).toBe('No cached tokens.');

    await writeCachedToken(join(dir, 'config'), fakeJwt(1_900_000_000), Date.parse('2026-10-19T00:00:00Z'));
    await writeCachedToken(join(dir, 'config'), 'not-a-jwt', Date.parse('2026-10-19T00:00:00Z'), AUTHORIZATION_FILE);
    const status = (await run('token', 'status')).out;
    expect(status).toContain('Subscription (ascendon) token: valid, expires 2030-03-17T17:46:40.000Z, saved 2026-10-19T00:00:00.000Z');
    expect(status).toContain('Authorization token: valid, expires unknown');
    expect((await run('token', 'clear')).out).toBe('Cached tokens deleted.');

    await writeCachedToken(join(dir, 'config'), 'x', 0, AUTHORIZATION_FILE);
    expect((await run('token', 'clear')).out).toBe('Cached tokens deleted.');
  });
});

describe('exf1lt login', () => {
  it('logs in and says how long each token lasts', async () => {
    mocks.login.mockImplementation(async (options: { onBrowserOpen: (browser: string) => void; timeoutMs: number; browser: string }) => {
      options.onBrowserOpen('Chrome');
      expect(options.timeoutMs).toBe(2 * 60_000);
      expect(options.browser).toBe('/opt/chrome');
      return { authorization: fakeJwt(1_900_000_000), ascendon: 'plain', browser: 'Chrome' };
    });
    const { out } = await run('login', '--browser', '/opt/chrome', '--timeout', '2');
    expect(out).toBe(
      [
        'Opened Chrome. Log in to your F1 account there; this window closes by itself.',
        'Authorization token: valid until 2030-03-17 17:46 UTC',
        'Subscription (ascendon) token: saved',
      ].join('\n'),
    );
  });

  it('refuses a bad timeout and reports a failed login', async () => {
    expect((await run('login', '--timeout', '0')).err).toContain('--timeout must be a positive number of minutes.');
    expect((await run('login', '--timeout', 'soon')).err).toContain('--timeout must be a positive number of minutes.');
    mocks.login.mockRejectedValue(new Error('browser closed'));
    expect(await run('login')).toMatchObject({ exit: 'exit 1', err: expect.stringContaining('browser closed') });
  });
});

describe('exf1lt telemetry', () => {
  async function recording(): Promise<string> {
    const recordingDir = join(dir, 'recording');
    const recorder = await Recorder.create(recordingDir);
    for (const message of raceMessages()) recorder.write(message);
    recorder.write({
      topic: 'CarData',
      utc: T0 + 130_000,
      data: { Entries: [{ Utc: new Date(T0 + 130_000).toISOString(), Cars: { '1': { Channels: { '2': 250 } } } }] },
    });
    await recorder.close();
    return recordingDir;
  }

  it('exports from a recording, naming drivers left out', async () => {
    const source = await recording();
    const out = join(dir, 'nor.html');
    const result = await run('telemetry', 'NOR', 'PIA', '--recording', source, '-o', out);
    expect(result.out).toBe(out);
    expect(result.err).toBe('No car data for PIA; left out.\n');
    expect((await run('telemetry', '--all', '--recording', source, '-o', out)).out).toBe(out);
  });

  it('exports from the archive', async () => {
    const source = await recording();
    const { loadRecording } = await import('@exhumer/f1-live-timing');
    const timeline = await loadRecording(source);
    mocks.archive = {
      sessionFeeds: async () => ({ Feeds: { SessionInfo: {}, DriverList: {}, TimingData: {}, CarData: {} } }),
      streamStart: async () => T0,
      stream: async function* (_path: string, topic: string) {
        yield* timeline.messages().filter((message) => message.topic === topic);
      },
    };
    const out = join(dir, 'archive.html');
    const result = await run('telemetry', '1', '--replay', '2026/x/', '-o', out);
    expect(result.err).toBe('Loading 2026/x/…\n');
    expect(result.out).toBe(out);
  });

  it('needs one source, drivers or --all but not both, and drivers that exist', async () => {
    const source = await recording();
    for (const [args, message] of [
      [['NOR'], 'Choose one of --replay and --recording.'],
      [['NOR', '--replay', 'x', '--recording', 'y'], 'Choose one of --replay and --recording.'],
      [['--recording', source], 'Name the drivers to export, or pass --all.'],
      [['NOR', '--all', '--recording', source], 'Name the drivers to export, or pass --all.'],
      [['HAM', '--recording', source], 'No driver HAM in this session.'],
    ] as const) {
      expect(await run('telemetry', ...args)).toMatchObject({ exit: 'exit 1', err: expect.stringContaining(message) });
    }
  });

  it('reads a token file for the archive', async () => {
    const tokenFile = join(dir, 'auth.txt');
    await writeFile(tokenFile, 'Bearer file-token');
    mocks.archive = { sessionFeeds: async () => Promise.reject(new Error('stop here')) };
    const result = await run('telemetry', '1', '--replay', '2026/x/', '--auth-token-file', tokenFile);
    expect(mocks.archiveCredentials[0]).toMatchObject({ token: 'file-token', source: 'file' });
    expect(result).toMatchObject({ exit: 'exit 1', err: expect.stringContaining('stop here') });
  });
});
