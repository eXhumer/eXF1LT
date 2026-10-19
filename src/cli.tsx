import { loadRecording, loadReplay, type Timeline, type Topic } from '@exhumer/f1-live-timing';
import { Command, Option } from 'commander';
import { render } from 'ink';

import { App, type StartSource } from './App.js';
import { f1tvSchedule } from './archive/f1tvSchedule.js';
import { describeError } from './archive/describeError.js';
import { exportTelemetry, resolveDriver, sessionDrivers } from './export/telemetry.js';
import { archiveCredential, createArchiveClient, resolveAuthorization } from './auth/authorization.js';
import { login } from './auth/login.js';
import { resolveToken, tokenStatus, type TokenStatus } from './auth/resolveToken.js';
import { AUTHORIZATION_FILE, clearCachedToken, configDir, readCachedToken } from './auth/tokenCache.js';
import { RACE_CONTROL_PLACEMENTS, type RaceControlPlacement } from './views/TimingView.js';

interface MainOptions {
  readonly live?: boolean;
  readonly replay?: string;
  readonly recording?: string;
  readonly record?: string;
  readonly tokenFile?: string;
  readonly authTokenFile?: string;
  readonly raceControl: RaceControlPlacement;
  readonly exportDir: string;
}

interface TokenOptions {
  readonly tokenFile?: string;
  readonly authTokenFile?: string;
}

/** Both F1 tokens, from the files given, the environment or the cache. Exits with the error otherwise. */
async function resolveTokens(options: TokenOptions): Promise<{ token: TokenStatus; authorization: TokenStatus }> {
  const fail = (error: unknown) => program.error(error instanceof Error ? error.message : String(error));
  const token = await resolveToken({
    tokenFile: options.tokenFile,
    envToken: process.env['F1_TOKEN'],
    cacheDir: configDir(),
  }).catch(fail);
  const authorization = await resolveAuthorization({
    tokenFile: options.authTokenFile,
    envToken: process.env['F1_AUTH_TOKEN'],
    cacheDir: configDir(),
  }).catch(fail);
  return { token, authorization };
}

/** What a telemetry report reads; the rest of a session is left in the archive. */
const TELEMETRY_TOPICS: readonly Topic[] = ['SessionInfo', 'DriverList', 'TimingData', 'TrackStatus', 'CarData', 'Position'];

const program = new Command()
  .name('exf1lt')
  .description('F1 live timing in your terminal')
  // Options after a subcommand are its own: `telemetry --replay` must not reach the TUI's --replay.
  .enablePositionalOptions()
  .option('--live', 'follow the live session')
  .option('--replay <path>', 'replay an archived session, e.g. 2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/')
  .option('--recording <dir>', 'play back a local recording or downloaded session')
  .option('--record <dir>', 'with --live: record the session into this directory')
  .option('--token-file <path>', 'read the F1 subscription (ascendon) token or login-session cookie from a file and cache it')
  .option('--auth-token-file <path>', 'read the archive Authorization token from a file and cache it')
  .addOption(
    new Option('--race-control <placement>', 'where race control messages go (r cycles while running)')
      .choices(RACE_CONTROL_PLACEMENTS)
      .default('side'),
  )
  .option('--export-dir <dir>', 'where e saves the selected driver\'s telemetry report', '.')
  .action(async (options: MainOptions) => {
    const sources = [options.live, options.replay, options.recording].filter(Boolean).length;
    if (sources > 1) program.error('Choose one of --live, --replay and --recording.');
    if (options.record && !options.live) program.error('--record needs --live.');

    const { token, authorization } = await resolveTokens(options);

    const start: StartSource = options.live
      ? { kind: 'live', recordDir: options.record }
      : options.replay
        ? { kind: 'replay', path: options.replay }
        : options.recording
          ? { kind: 'recording', dir: options.recording }
          : { kind: 'picker' };

    const instance = render(
      <App
        archive={createArchiveClient(archiveCredential(authorization, token))}
        schedule={f1tvSchedule()}
        start={start}
        token={token}
        raceControl={options.raceControl}
        exportDir={options.exportDir}
      />,
      { alternateScreen: true, maxFps: 15 },
    );
    await instance.waitUntilExit();
  });

program
  .command('telemetry')
  .description('export telemetry (speed, RPM, gear, throttle, brake, DRS, track position) as an HTML graph, with a lap delta comparison')
  .argument('[drivers...]', 'drivers to export, the first as the reference: racing number or three-letter code, e.g. NOR 81 LEC')
  .option('--all', 'every driver in the session, in timing order')
  .option('--replay <path>', 'archived session, e.g. 2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/')
  .option('--recording <dir>', 'local recording or downloaded session')
  .option('-o, --out <path>', 'file to write (.html), or a directory for the default name', '.')
  .option('--auth-token-file <path>', 'read the archive Authorization token from a file and cache it')
  .action(async (driverArgs: string[], options: { replay?: string; recording?: string; out: string; authTokenFile?: string; all?: boolean }) => {
    if (Boolean(options.replay) === Boolean(options.recording)) program.error('Choose one of --replay and --recording.');
    if (options.all ? driverArgs.length > 0 : driverArgs.length === 0) program.error('Name the drivers to export, or pass --all.');
    let timeline: Timeline;
    try {
      if (options.replay) {
        const { token, authorization } = await resolveTokens(options);
        const archive = createArchiveClient(archiveCredential(authorization, token));
        process.stderr.write(`Loading ${options.replay}…\n`);
        ({ timeline } = await loadReplay(archive, options.replay, { topics: TELEMETRY_TOPICS }));
      } else {
        timeline = await loadRecording(options.recording!, { topics: TELEMETRY_TOPICS });
      }
      const numbers = options.all
        ? sessionDrivers(timeline)
        : driverArgs.map((driver) => {
            const number = resolveDriver(timeline, driver);
            if (!number) throw new Error(`No driver ${driver} in this session.`);
            return number;
          });
      const { file, skipped } = await exportTelemetry(timeline, numbers, options.out);
      if (skipped.length > 0) process.stderr.write(`No car data for ${skipped.join(', ')}; left out.\n`);
      console.log(file);
    } catch (error) {
      program.error(describeError(error));
    }
  });

program
  .command('login')
  .description('log in to F1 in a browser window and save both tokens (no token files needed)')
  .option('--browser <path>', 'Chrome, Edge, Brave or Chromium executable (default: the first one found; F1_BROWSER also works)')
  .option('--timeout <minutes>', 'how long to wait for the login', '5')
  .action(async (options: { browser?: string; timeout: string }) => {
    const minutes = Number(options.timeout);
    if (!Number.isFinite(minutes) || minutes <= 0) program.error('--timeout must be a positive number of minutes.');
    const result = await login({
      browser: options.browser,
      cacheDir: configDir(),
      timeoutMs: minutes * 60_000,
      onBrowserOpen: (browser) => console.log(`Opened ${browser}. Log in to your F1 account there; this window closes by itself.`),
    }).catch((error: unknown) => program.error(error instanceof Error ? error.message : String(error)));
    const statusOf = (token: string) => tokenStatus(token, 'file', Date.now());
    const until = (token: string) => {
      const { expiresAt } = statusOf(token);
      return expiresAt ? `valid until ${new Date(expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'saved';
    };
    console.log(`Authorization token: ${until(result.authorization)}`);
    console.log(`Subscription (ascendon) token: ${until(result.ascendon)}`);
  });

const tokenCommand = program.command('token').description('manage the cached F1 tokens (subscription/ascendon and archive authorization)');

tokenCommand
  .command('status')
  .description('show whether each token is cached and when it expires')
  .action(async () => {
    const dir = configDir();
    for (const [label, file] of [
      ['Subscription (ascendon) token', undefined],
      ['Authorization token', AUTHORIZATION_FILE],
    ] as const) {
      const cached = await readCachedToken(dir, file);
      if (!cached) {
        console.log(`${label}: not cached`);
        continue;
      }
      const status = tokenStatus(cached.token, 'cache', Date.now());
      const expires = status.expiresAt ? new Date(status.expiresAt).toISOString() : 'unknown';
      console.log(`${label}: ${status.state}, expires ${expires}, saved ${cached.savedAt}`);
    }
    console.log(`Location: ${dir}`);
  });

tokenCommand
  .command('clear')
  .description('delete the cached tokens')
  .action(async () => {
    const dir = configDir();
    const subscription = await clearCachedToken(dir);
    const authorization = await clearCachedToken(dir, AUTHORIZATION_FILE);
    console.log(subscription || authorization ? 'Cached tokens deleted.' : 'No cached tokens.');
  });

await program.parseAsync();
