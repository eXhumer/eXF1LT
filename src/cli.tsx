import { ArchiveClient } from '@exhumer/f1-live-timing';
import { Command, Option } from 'commander';
import { render } from 'ink';

import { App, type StartSource } from './App.js';
import { f1tvSchedule } from './archive/f1tvSchedule.js';
import { resolveToken, tokenStatus, type TokenStatus } from './auth/resolveToken.js';
import { clearCachedToken, configDir, readCachedToken } from './auth/tokenCache.js';
import { RACE_CONTROL_PLACEMENTS, type RaceControlPlacement } from './views/TimingView.js';

interface MainOptions {
  readonly live?: boolean;
  readonly replay?: string;
  readonly recording?: string;
  readonly record?: string;
  readonly tokenFile?: string;
  readonly raceControl: RaceControlPlacement;
}

const program = new Command()
  .name('exf1lt')
  .description('F1 live timing in your terminal')
  .option('--live', 'follow the live session')
  .option('--replay <path>', 'replay an archived session, e.g. 2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/')
  .option('--recording <dir>', 'play back a local recording or downloaded session')
  .option('--record <dir>', 'with --live: record the session into this directory')
  .option('--token-file <path>', 'read the F1 subscription token (or login-session cookie) from a file and cache it')
  .addOption(
    new Option('--race-control <placement>', 'where race control messages go (r cycles while running)')
      .choices(RACE_CONTROL_PLACEMENTS)
      .default('side'),
  )
  .action(async (options: MainOptions) => {
    const sources = [options.live, options.replay, options.recording].filter(Boolean).length;
    if (sources > 1) program.error('Choose one of --live, --replay and --recording.');
    if (options.record && !options.live) program.error('--record needs --live.');

    const token: TokenStatus = await resolveToken({
      tokenFile: options.tokenFile,
      envToken: process.env['F1_TOKEN'],
      cacheDir: configDir(),
    }).catch((error: unknown) => program.error(error instanceof Error ? error.message : String(error)));

    const start: StartSource = options.live
      ? { kind: 'live', recordDir: options.record }
      : options.replay
        ? { kind: 'replay', path: options.replay }
        : options.recording
          ? { kind: 'recording', dir: options.recording }
          : { kind: 'picker' };

    const instance = render(
      <App
        archive={new ArchiveClient()}
        schedule={f1tvSchedule()}
        start={start}
        token={token}
        raceControl={options.raceControl}
      />,
      { alternateScreen: true, maxFps: 15 },
    );
    await instance.waitUntilExit();
  });

const tokenCommand = program.command('token').description('manage the cached F1 subscription token');

tokenCommand
  .command('status')
  .description('show whether a token is cached and when it expires')
  .action(async () => {
    const dir = configDir();
    const cached = await readCachedToken(dir);
    if (!cached) {
      console.log(`No cached token (${dir}).`);
      return;
    }
    const status = tokenStatus(cached.token, 'cache', Date.now());
    const expires = status.expiresAt ? new Date(status.expiresAt).toISOString() : 'unknown';
    console.log(`Cached token: ${status.state}, expires ${expires}, saved ${cached.savedAt}`);
    console.log(`Location: ${dir}`);
  });

tokenCommand
  .command('clear')
  .description('delete the cached token')
  .action(async () => {
    console.log((await clearCachedToken(configDir())) ? 'Cached token deleted.' : 'No cached token.');
  });

await program.parseAsync();
