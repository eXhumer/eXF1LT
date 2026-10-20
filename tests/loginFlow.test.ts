import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BRAVE_ORIGIN_PROFILE, login, LOGIN_URL, TOKEN_ENDPOINT } from '../src/auth/login.js';
import { AUTHORIZATION_FILE, readCachedToken } from '../src/auth/tokenCache.js';
import { fakeChrome, type FakeChromeOptions, request } from './fakeChrome.js';
import { fakeJwt } from './helpers.js';
import { startWsServer, type WsServer } from './wsServer.js';

/** Switches for the mocked modules below; each falls through to the real thing when off. */
const control = vi.hoisted(() => ({
  spawn: undefined as undefined | ((command: string, args: string[]) => unknown),
  noBrowser: false,
  rmFails: false,
  /**
   * What successive reads of DevToolsActivePort see (undefined: not written
   * yet); the last one stays. Off: the real file is read.
   */
  endpoint: undefined as undefined | (string | undefined)[],
}));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  return {
    ...real,
    spawn: (command: string, args: string[], options: object) => (control.spawn ? control.spawn(command, args) : real.spawn(command, args, options)),
  };
});
vi.mock('../src/auth/browser.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/auth/browser.js')>();
  return { ...real, findBrowser: (explicit: string | undefined) => (control.noBrowser ? undefined : real.findBrowser(explicit)) };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    rm: (path: string, options?: { recursive?: boolean }) =>
      control.rmFails && options?.recursive ? Promise.reject(new Error('busy')) : real.rm(path, options as never),
    readFile: (path: string, options: never) => {
      if (!control.endpoint || !String(path).endsWith('DevToolsActivePort')) return real.readFile(path, options);
      const content = control.endpoint.length > 1 ? control.endpoint.shift() : control.endpoint[0];
      return content === undefined ? Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) : Promise.resolve(content);
    },
  };
});

const SUBSCRIPTION = fakeJwt(1_900_000_000);
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN_BODY = JSON.stringify({ access_token: `${encode({ alg: 'RS256' })}.${encode({ subscriptionToken: SUBSCRIPTION })}.c2ln` });

class FakeChild extends EventEmitter {
  readonly kill = vi.fn(() => true);
}

let cacheDir: string;
let server: WsServer | undefined;
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'exf1lt-login-flow-'));
});
afterEach(async () => {
  control.spawn = undefined;
  control.noBrowser = false;
  control.rmFails = false;
  control.endpoint = undefined;
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await server?.stop();
  server = undefined;
  await rm(cacheDir, { recursive: true, force: true });
});

/**
 * A browser started by `spawn` that serves DevTools from the fake Chrome. Its
 * DevToolsActivePort reads the way Chrome writes it, one state per read: not
 * there, empty, just the port, then both lines. Per read rather than on a
 * timer, so every state is seen on any machine.
 */
async function fakeBrowser(options: FakeChromeOptions) {
  const chrome = fakeChrome(options);
  server = await startWsServer((peer, text) => chrome.handle(text, (reply) => peer.send(reply)));
  const port = server.port;
  const launches: { command: string; args: string[]; child: FakeChild }[] = [];
  control.spawn = (command, args) => {
    const child = new FakeChild();
    launches.push({ command, args, child });
    control.endpoint = [undefined, '', `${port}\n`, `${port}\n/devtools/browser/fake`];
    return child;
  };
  return { chrome, launches };
}

const tokenEvents = (session: string) => request(session, 'r1', TOKEN_ENDPOINT, 'POST', 200);

describe('login', () => {
  it('logs in with a throwaway profile, saves both tokens and cleans up', async () => {
    const { chrome, launches } = await fakeBrowser({ events: tokenEvents, body: { body: Buffer.from(TOKEN_BODY).toString('base64'), base64Encoded: true } });
    const onBrowserOpen = vi.fn();
    const result = await login({ browser: '/opt/chrome/chrome', cacheDir, onBrowserOpen });

    expect(result).toEqual({ authorization: SUBSCRIPTION, ascendon: SUBSCRIPTION, browser: '/opt/chrome/chrome' });
    expect(onBrowserOpen).toHaveBeenCalledWith('/opt/chrome/chrome');
    expect((await readCachedToken(cacheDir))?.token).toBe(SUBSCRIPTION);
    expect((await readCachedToken(cacheDir, AUTHORIZATION_FILE))?.token).toBe(SUBSCRIPTION);

    const [launch] = launches;
    expect(launch?.args.at(-1)).toBe(LOGIN_URL);
    const profile = launch!.args.find((arg) => arg.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
    expect(existsSync(profile)).toBe(false);
    expect(launch?.child.kill).toHaveBeenCalled();
    expect(chrome.methods()).toContain('Browser.close');
    expect(chrome.methods()).not.toContain('Storage.clearCookies');
  });

  it('keeps one Brave Origin profile, wiping the F1 session before and after', async () => {
    const profile = join(cacheDir, BRAVE_ORIGIN_PROFILE);
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, 'DevToolsActivePort'), '1\n/stale');
    const { chrome, launches } = await fakeBrowser({ pages: [], events: tokenEvents, body: { body: TOKEN_BODY, base64Encoded: false } });
    vi.stubEnv('F1_BROWSER', '/Applications/Brave Origin.app/Contents/MacOS/Brave Origin');

    await login({ cacheDir, now: Date.parse('2026-10-19T00:00:00Z'), timeoutMs: 5_000 });

    expect(launches[0]?.args.at(-1)).toBe('about:blank');
    expect(existsSync(profile)).toBe(true);
    // The stale port file from the last run was removed before the browser started.
    expect(existsSync(join(profile, 'DevToolsActivePort'))).toBe(false);
    const methods = chrome.methods();
    // Wiped, opened on F1 (no page to begin with, so one is created), then wiped again.
    expect(methods.filter((method) => method === 'Storage.clearCookies')).toHaveLength(2);
    expect(methods.filter((method) => method === 'Storage.clearDataForOrigin')).toHaveLength(4);
    expect(methods).toContain('Target.createTarget');
    expect(chrome.sent.find((command) => command.method === 'Page.navigate')?.params).toEqual({ url: LOGIN_URL });
    expect((await readCachedToken(cacheDir))?.savedAt).toBe('2026-10-19T00:00:00.000Z');
  });

  it('still closes the browser when wiping the session fails', async () => {
    const { chrome } = await fakeBrowser({ failing: { 'Storage.clearDataForOrigin': 'denied', 'Browser.close': 'gone' } });
    await expect(login({ browser: '/opt/Brave Origin', cacheDir })).rejects.toThrow('denied');
    expect(chrome.methods().filter((method) => method === 'Browser.close')).toHaveLength(1);
  });

  it('says when no browser is installed', async () => {
    control.noBrowser = true;
    await expect(login({ cacheDir })).rejects.toThrow('No Chrome, Edge, Brave (or Brave Origin) or Chromium found.');
  });

  it('reports a browser that cannot start or exits at once', async () => {
    await expect(login({ browser: join(cacheDir, 'Brave Origin missing'), cacheDir })).rejects.toThrow(/^Could not start .*Brave Origin missing: /);
    // Node is not a browser: it rejects the DevTools flags and exits.
    await expect(login({ browser: process.execPath, cacheDir })).rejects.toThrow(/exited early \(code \d+\)\./);
  });

  it('reports an exit without a code, and survives a profile that cannot be removed', async () => {
    control.rmFails = true;
    control.spawn = () => {
      const child = new FakeChild();
      setTimeout(() => child.emit('exit', null), 10);
      return child;
    };
    await expect(login({ browser: '/opt/chrome', cacheDir })).rejects.toThrow('/opt/chrome exited early (code unknown).');
  });

  it('gives up when the browser never opens its DevTools port', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    control.spawn = () => new FakeChild();
    const attempt = login({ browser: '/opt/chrome', cacheDir });
    let error: unknown;
    attempt.catch((cause: unknown) => (error = cause));
    for (let step = 0; step < 400 && error === undefined; step++) {
      await vi.advanceTimersByTimeAsync(100);
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(String(error)).toContain('The browser did not open its DevTools port.');
  });
});
