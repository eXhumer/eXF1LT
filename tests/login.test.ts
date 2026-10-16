import { describe, expect, it } from 'vitest';

import { browserCandidates, findBrowser, isBraveOrigin } from '../src/auth/browser.js';
import { CdpClient, type CdpTransport } from '../src/auth/cdp.js';
import { captureTokenResponse, isTokenEndpoint, LoginError, tokensFromTokenResponse } from '../src/auth/login.js';
import { fakeJwt } from './helpers.js';

function accessToken(claims: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.c2ln`;
}

const SUBSCRIPTION = fakeJwt(1_792_514_393);
const ACCESS = accessToken({ exp: 1_792_514_396, subscriptionToken: SUBSCRIPTION });
const TOKEN_BODY = JSON.stringify({ access_token: ACCESS, token_type: 'Bearer', expires_in: 345_600, id_token: 'x.y.z' });

describe('tokensFromTokenResponse', () => {
  it('uses the subscriptionToken inside the access token for both tokens', () => {
    expect(tokensFromTokenResponse(TOKEN_BODY)).toEqual({ authorization: SUBSCRIPTION, ascendon: SUBSCRIPTION });
  });

  it('rejects a login without a subscription token or access token', () => {
    expect(() => tokensFromTokenResponse(JSON.stringify({ access_token: accessToken({ exp: 1 }) }))).toThrow(/subscription/);
    expect(() => tokensFromTokenResponse('{}')).toThrow(LoginError);
    expect(() => tokensFromTokenResponse('<html>')).toThrow(LoginError);
  });
});

describe('isTokenEndpoint', () => {
  it('matches the token endpoint only', () => {
    expect(isTokenEndpoint('https://id.formula1.com/as/token')).toBe(true);
    expect(isTokenEndpoint('https://id.formula1.com/as/token?x=1')).toBe(true);
    expect(isTokenEndpoint('https://id.formula1.com/as/authorize')).toBe(false);
    expect(isTokenEndpoint('https://id.formula1.com/as/token/revoke')).toBe(false);
  });
});

describe('isBraveOrigin', () => {
  it('recognises Brave Origin builds only', () => {
    expect(isBraveOrigin('/Applications/Brave Origin.app/Contents/MacOS/Brave Origin')).toBe(true);
    expect(isBraveOrigin('C:\\Program Files\\BraveSoftware\\Brave-Origin\\Application\\brave.exe')).toBe(true);
    expect(isBraveOrigin('/usr/bin/brave-origin-nightly')).toBe(true);
    expect(isBraveOrigin('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')).toBe(false);
    expect(isBraveOrigin('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe(false);
  });
});

describe('findBrowser', () => {
  it('prefers an explicit path', () => {
    expect(findBrowser('/opt/b', {}, 'darwin', () => false)).toBe('/opt/b');
  });

  it('finds Chrome on macOS and Edge on Windows', () => {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(findBrowser(undefined, { HOME: '/Users/a' }, 'darwin', (p) => p === chrome)).toBe(chrome);

    const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    expect(findBrowser(undefined, env, 'win32', (p) => p === edge)).toBe(edge);
    expect(browserCandidates(env, 'win32')).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  });

  it('finds Brave Origin on macOS and Windows', () => {
    const origin = '/Applications/Brave Origin.app/Contents/MacOS/Brave Origin';
    expect(findBrowser(undefined, {}, 'darwin', (p) => p === origin)).toBe(origin);

    const env = { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
    const installed = 'C:\\Program Files\\BraveSoftware\\Brave-Origin\\Application\\brave.exe';
    expect(findBrowser(undefined, env, 'win32', (p) => p === installed)).toBe(installed);

    // An edition folder we have no name for is still found.
    const list = (dir: string) => (dir === 'C:\\Program Files\\BraveSoftware' ? ['Brave-Whatever-Next', 'Other'] : []);
    expect(browserCandidates(env, 'win32', list)).toContain(
      'C:\\Program Files\\BraveSoftware\\Brave-Whatever-Next\\Application\\brave.exe',
    );
    expect(browserCandidates(env, 'win32', list).some((p) => p.includes('Other'))).toBe(false);
  });

  it('returns undefined when nothing is installed', () => {
    expect(findBrowser(undefined, { PATH: '/usr/bin' }, 'linux', () => false)).toBeUndefined();
  });
});

/** A browser that answers the DevTools commands the capture uses and replays a scripted login. */
function fakeBrowser(options: { tokenStatus?: number; closeBeforeToken?: boolean } = {}) {
  const sent: Array<{ id: number; method: string; sessionId?: string }> = [];
  let onMessage: (data: string) => void = () => undefined;
  let onClose: () => void = () => undefined;
  const emit = (message: object) => onMessage(JSON.stringify(message));
  const SESSION = 's1';

  const transport: CdpTransport = {
    onMessage: (listener) => void (onMessage = listener),
    onClose: (listener) => void (onClose = listener),
    close: () => onClose(),
    send: (data) => {
      const message = JSON.parse(data) as { id: number; method: string; sessionId?: string };
      sent.push(message);
      const reply = (result: object) => queueMicrotask(() => emit({ id: message.id, result }));
      switch (message.method) {
        case 'Target.getTargets':
          reply({ targetInfos: [{ targetId: 't1', type: 'page' }, { targetId: 'w1', type: 'service_worker' }] });
          break;
        case 'Target.attachToTarget':
          reply({ sessionId: SESSION });
          break;
        case 'Network.enable':
          reply({});
          setTimeout(script, 5);
          break;
        case 'Network.getResponseBody':
          reply({ body: Buffer.from(TOKEN_BODY).toString('base64'), base64Encoded: true });
          break;
        default:
          reply({});
      }
    },
  };

  function script() {
    if (options.closeBeforeToken) return onClose();
    // An unrelated request, then the token request and its response.
    emit({ method: 'Network.requestWillBeSent', sessionId: SESSION, params: { requestId: 'r0', request: { url: 'https://id.formula1.com/as/authorize', method: 'GET' } } });
    emit({ method: 'Network.loadingFinished', sessionId: SESSION, params: { requestId: 'r0' } });
    emit({ method: 'Network.requestWillBeSent', sessionId: SESSION, params: { requestId: 'r1', request: { url: 'https://id.formula1.com/as/token', method: 'POST' } } });
    emit({ method: 'Network.responseReceived', sessionId: SESSION, params: { requestId: 'r1', response: { status: options.tokenStatus ?? 200 } } });
    emit({ method: 'Network.loadingFinished', sessionId: SESSION, params: { requestId: 'r1' } });
  }

  return { client: new CdpClient(transport), sent };
}

describe('captureTokenResponse', () => {
  it('returns the body of the token response and attaches to pages only', async () => {
    const { client, sent } = fakeBrowser();
    const body = await captureTokenResponse(client, { timeoutMs: 2_000 });
    expect(body).toBe(TOKEN_BODY);
    expect(sent.filter((m) => m.method === 'Target.attachToTarget')).toHaveLength(1);
    expect(sent.some((m) => m.method === 'Network.getResponseBody' && m.sessionId === 's1')).toBe(true);
  });

  it('ignores a failed token request and times out', async () => {
    const { client, sent } = fakeBrowser({ tokenStatus: 400 });
    await expect(captureTokenResponse(client, { timeoutMs: 100 })).rejects.toThrow(/Timed out/);
    expect(sent.some((m) => m.method === 'Network.getResponseBody')).toBe(false);
  });

  it('fails when the browser is closed before the login', async () => {
    const { client } = fakeBrowser({ closeBeforeToken: true });
    await expect(captureTokenResponse(client, { timeoutMs: 2_000 })).rejects.toThrow(/closed/);
  });
});
