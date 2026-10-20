import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findBrowser, isBraveOrigin } from './browser.js';
import { CdpClient, connectWebSocket, type CdpEvent } from './cdp.js';
import { decodeJwtPayload } from './jwt.js';
import { AUTHORIZATION_FILE, writeCachedToken } from './tokenCache.js';

/** Where the browser starts: F1's account site, which begins the OpenID Connect login. */
export const LOGIN_URL = 'https://account.formula1.com/';

/** Origins whose cookies and storage hold the F1 login session. */
const SESSION_ORIGINS = ['https://account.formula1.com', 'https://id.formula1.com'];

/** Folder, inside the token cache directory, of the profile kept for Brave Origin. */
export const BRAVE_ORIGIN_PROFILE = 'brave-origin-profile';

/** The OpenID Connect token endpoint the account site calls once you have logged in. */
export const TOKEN_ENDPOINT = 'https://id.formula1.com/as/token';

export class LoginError extends Error {
  override readonly name = 'LoginError';
}

export interface LoginTokens {
  /** `Authorization: Bearer <token>` for the static archive. */
  readonly authorization: string;
  /** The ascendon token for the live feed and F1 TV. */
  readonly ascendon: string;
}

/** Whether a request URL is the OpenID Connect token endpoint (query string ignored). */
export function isTokenEndpoint(url: string): boolean {
  return url.split(/[?#]/, 1)[0] === TOKEN_ENDPOINT;
}

/**
 * Pull the tokens out of the body of the token endpoint's response.
 *
 * Both are the `subscriptionToken` claim inside the OpenID Connect
 * `access_token`: a captured request to the live timing archive carried a JWT
 * signed with the same key and holding the same claims as the ascendon token,
 * not the (differently signed) `access_token` itself. F1 treats them as two
 * inputs, so they are kept as two values that merely start out equal.
 */
export function tokensFromTokenResponse(body: string): LoginTokens {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new LoginError('The login response was not JSON.');
  }
  const accessToken = (parsed as { access_token?: unknown } | null)?.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new LoginError('The login response holds no access_token.');
  }
  const subscription = decodeJwtPayload(accessToken)?.['subscriptionToken'];
  if (typeof subscription !== 'string' || subscription === '') {
    throw new LoginError('This login holds no subscription token. Does the account have an F1 subscription?');
  }
  return { authorization: subscription, ascendon: subscription };
}

export interface CaptureOptions {
  /** Give up after this long. */
  readonly timeoutMs: number;
}

/**
 * Watch every page of the browser until one completes a successful POST to the
 * token endpoint, and return that response body.
 */
export async function captureTokenResponse(client: CdpClient, options: CaptureOptions): Promise<string> {
  const attached = new Set<string>();
  /** `sessionId/requestId` of token requests in flight, with their HTTP status once known. */
  const tracked = new Map<string, number | undefined>();

  const attach = async (targetId: string): Promise<void> => {
    if (attached.has(targetId)) return;
    attached.add(targetId);
    const { sessionId } = await client.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    await client.send('Network.enable', {}, sessionId);
  };

  return new Promise<string>((resolve, reject) => {
    let done = false;
    const finish = (settle: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      settle();
    };
    const fail = (error: Error): void => finish(() => reject(error));

    const timer = setTimeout(
      () => fail(new LoginError('Timed out waiting for you to log in.')),
      options.timeoutMs,
    );
    client.onClose(() => fail(new LoginError('The browser was closed before the login finished.')));

    const handle = async (event: CdpEvent): Promise<void> => {
      const { method, params, sessionId } = event;
      if (method === 'Target.targetCreated') {
        const info = params['targetInfo'] as { targetId?: string; type?: string } | undefined;
        if (info?.type === 'page' && info.targetId) await attach(info.targetId);
        return;
      }
      if (!sessionId) return;
      const request = params['requestId'];
      if (typeof request !== 'string') return;
      const key = `${sessionId}/${request}`;

      if (method === 'Network.requestWillBeSent') {
        const req = params['request'] as { url?: string; method?: string } | undefined;
        if (req?.method === 'POST' && req.url && isTokenEndpoint(req.url)) tracked.set(key, undefined);
      } else if (method === 'Network.responseReceived') {
        const response = params['response'] as { status?: number } | undefined;
        if (tracked.has(key)) tracked.set(key, response?.status);
      } else if (method === 'Network.loadingFinished') {
        const status = tracked.get(key);
        if (!tracked.has(key)) return;
        tracked.delete(key);
        if (status === undefined || status < 200 || status >= 300) return;
        const { body, base64Encoded } = await client.send<{ body: string; base64Encoded: boolean }>(
          'Network.getResponseBody',
          { requestId: request },
          sessionId,
        );
        finish(() => resolve(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body));
      }
    };

    // Everything that can fail here is a DevTools command, which rejects with a CdpError.
    const unsubscribe = client.onEvent((event) => {
      handle(event).catch((error: unknown) => fail(error as Error));
    });

    // Pages that exist already, then every page opened later (popups, new tabs).
    void (async () => {
      await client.send('Target.setDiscoverTargets', { discover: true });
      const { targetInfos } = await client.send<{ targetInfos: Array<{ targetId: string; type: string }> }>(
        'Target.getTargets',
      );
      for (const info of targetInfos) if (info.type === 'page') await attach(info.targetId);
    })().catch((error: unknown) => fail(error as Error));
  });
}

export interface LoginOptions {
  /** Browser executable. Default: the first Chrome, Edge, Brave or Chromium found. */
  readonly browser?: string | undefined;
  /** Directory of the token caches. */
  readonly cacheDir: string;
  readonly timeoutMs?: number;
  readonly now?: number;
  /** Called once the browser is open and waiting for the user. */
  readonly onBrowserOpen?: (browser: string) => void;
}

export interface LoginResult extends LoginTokens {
  readonly browser: string;
}

/**
 * Open a browser on F1's login page, wait for the user to log in, and save
 * both tokens.
 *
 * The browser gets a throwaway profile, so it always runs the full login (an
 * old session would skip the token request) and nothing of it outlives the
 * command. Brave Origin is the exception: it asks for its purchase ID in every
 * new profile, so it keeps one profile of its own and the F1 session is wiped
 * from it before and after each login instead. F1 only accepts its own redirect URI for this login, so a local
 * callback server is not an option; the DevTools Protocol lets us read the
 * response the page itself receives.
 */
export async function login(options: LoginOptions): Promise<LoginResult> {
  const browser = findBrowser(options.browser ?? process.env['F1_BROWSER']);
  if (!browser) {
    throw new LoginError(
      'No Chrome, Edge, Brave (or Brave Origin) or Chromium found. Install one, or point to it with --browser <path> or F1_BROWSER.',
    );
  }

  const persistent = isBraveOrigin(browser);
  const profile = persistent ? join(options.cacheDir, BRAVE_ORIGIN_PROFILE) : await mkdtemp(join(tmpdir(), 'exf1lt-login-'));
  if (persistent) await mkdir(profile, { recursive: true });
  // A kept profile may hold a finished F1 session, which would skip the token
  // request, so it opens on a blank page and goes to F1 after being wiped.
  await rm(join(profile, 'DevToolsActivePort'), { force: true });
  const child = spawn(
    browser,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      persistent ? 'about:blank' : LOGIN_URL,
    ],
    { stdio: 'ignore' },
  );
  const spawnFailed = new Promise<never>((_, reject) => {
    child.once('error', (error) => reject(new LoginError(`Could not start ${browser}: ${error.message}`)));
    child.once('exit', (code) => reject(new LoginError(`${browser} exited early (code ${code ?? 'unknown'}).`)));
  });
  spawnFailed.catch(() => undefined);

  let client: CdpClient | undefined;
  try {
    const endpoint = await Promise.race([waitForEndpoint(profile), spawnFailed]);
    client = new CdpClient(await connectWebSocket(endpoint));
    options.onBrowserOpen?.(browser);
    if (persistent) {
      await clearFormulaSession(client);
      await openLoginPage(client);
    }

    const body = await captureTokenResponse(client, { timeoutMs: options.timeoutMs ?? 5 * 60_000 });
    const tokens = tokensFromTokenResponse(body);

    const now = options.now ?? Date.now();
    await writeCachedToken(options.cacheDir, tokens.authorization, now, AUTHORIZATION_FILE);
    await writeCachedToken(options.cacheDir, tokens.ascendon, now);
    return { ...tokens, browser };
  } finally {
    if (persistent && client) await clearFormulaSession(client).catch(() => undefined);
    await client?.send('Browser.close').catch(() => undefined);
    client?.close();
    child.removeAllListeners('exit');
    child.kill();
    if (!persistent) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
}

/** The browser's DevTools WebSocket URL, from the `DevToolsActivePort` file it writes into its profile. */
async function waitForEndpoint(profile: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    } catch {
      // not written yet
    }
    if (Date.now() > deadline) throw new LoginError('The browser did not open its DevTools port.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A DevTools session on the browser's first page, opening one if there is none. */
async function firstPageSession(client: CdpClient): Promise<string> {
  const { targetInfos } = await client.send<{ targetInfos: Array<{ targetId: string; type: string }> }>('Target.getTargets');
  let targetId = targetInfos.find((info) => info.type === 'page')?.targetId;
  if (!targetId) targetId = (await client.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })).targetId;
  return (await client.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })).sessionId;
}

/**
 * Forget any F1 login in a kept profile, so the next login runs in full.
 * Chrome only clears per-origin storage through a page's session.
 */
async function clearFormulaSession(client: CdpClient): Promise<void> {
  await client.send('Storage.clearCookies');
  const sessionId = await firstPageSession(client);
  for (const origin of SESSION_ORIGINS) {
    await client.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }, sessionId);
  }
}

/** Point the browser's first page at the F1 login. */
async function openLoginPage(client: CdpClient): Promise<void> {
  await client.send('Page.navigate', { url: LOGIN_URL }, await firstPageSession(client));
}
