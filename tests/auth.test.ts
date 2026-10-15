import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decodeJwtPayload, jwtExpiry, looksLikeJwt } from '../src/auth/jwt.js';
import { parseTokenFile, TokenFileError } from '../src/auth/parseTokenFile.js';
import { EXPIRY_WARNING_MS, resolveToken, tokenStatus } from '../src/auth/resolveToken.js';
import { AUTH_FILE, clearCachedToken, configDir, readCachedToken, writeCachedToken } from '../src/auth/tokenCache.js';
import { fakeJwt } from './helpers.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const IN_30_DAYS = Math.floor((NOW + 30 * 86_400_000) / 1000);
const YESTERDAY = Math.floor((NOW - 86_400_000) / 1000);

describe('jwt', () => {
  it('reads exp in milliseconds', () => {
    expect(jwtExpiry(fakeJwt(IN_30_DAYS))).toBe(IN_30_DAYS * 1000);
    expect(jwtExpiry(fakeJwt(undefined))).toBeUndefined();
  });

  it('rejects things that are not JWTs', () => {
    expect(looksLikeJwt('hello')).toBe(false);
    expect(decodeJwtPayload('a.b.c')).toBeUndefined();
  });
});

describe('parseTokenFile', () => {
  const token = fakeJwt(IN_30_DAYS);
  const cookie = JSON.stringify({ data: { subscriptionToken: token }, user: {} });

  it('accepts a raw token with whitespace and a BOM', () => {
    expect(parseTokenFile(`\uFEFF  ${token}\n`)).toBe(token);
  });

  it('accepts the login-session cookie as JSON', () => {
    expect(parseTokenFile(cookie)).toBe(token);
  });

  it('accepts the URL-encoded cookie, with or without its name', () => {
    expect(parseTokenFile(encodeURIComponent(cookie))).toBe(token);
    expect(parseTokenFile(`login-session=${encodeURIComponent(cookie)}; Path=/`)).toBe(token);
  });

  it('explains what is wrong', () => {
    expect(() => parseTokenFile('not a token')).toThrow(TokenFileError);
    expect(() => parseTokenFile('{"data":{}}')).toThrow(/No subscriptionToken/);
    expect(() => parseTokenFile('{oops')).toThrow(/cannot be parsed/);
  });
});

describe('token cache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'exf1lt-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes, reads and clears', async () => {
    const token = fakeJwt(IN_30_DAYS);
    const written = await writeCachedToken(join(dir, 'nested'), token, NOW);
    expect(written.expiresAt).toBe(new Date(IN_30_DAYS * 1000).toISOString());
    expect(await readCachedToken(join(dir, 'nested'))).toEqual(written);
    expect(await clearCachedToken(join(dir, 'nested'))).toBe(true);
    expect(await clearCachedToken(join(dir, 'nested'))).toBe(false);
    expect(await readCachedToken(join(dir, 'nested'))).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('keeps the file private', async () => {
    await writeCachedToken(dir, fakeJwt(IN_30_DAYS), NOW);
    expect((await stat(join(dir, AUTH_FILE))).mode & 0o777).toBe(0o600);
  });

  it('ignores a corrupt cache file', async () => {
    await writeFile(join(dir, AUTH_FILE), 'garbage');
    expect(await readCachedToken(dir)).toBeUndefined();
  });

  it('picks a directory per platform', () => {
    expect(configDir({ EXF1LT_CONFIG_DIR: '/x' }, 'linux')).toBe('/x');
    expect(configDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32')).toMatch(/eXF1LT$/);
    expect(configDir({ XDG_CONFIG_HOME: '/cfg' }, 'linux')).toBe(join('/cfg', 'exf1lt'));
  });
});

describe('resolveToken', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'exf1lt-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('caches a token file and reuses it on the next run', async () => {
    const token = fakeJwt(IN_30_DAYS);
    const file = join(dir, 'token.txt');
    await writeFile(file, token);

    const first = await resolveToken({ tokenFile: file, cacheDir: dir, now: NOW });
    expect(first).toMatchObject({ token, source: 'file', state: 'valid' });
    expect(JSON.parse(await readFile(join(dir, AUTH_FILE), 'utf8'))).toMatchObject({ token });

    const second = await resolveToken({ cacheDir: dir, now: NOW });
    expect(second).toMatchObject({ token, source: 'cache', state: 'valid' });
  });

  it('prefers F1_TOKEN over the cache and never caches it', async () => {
    await writeCachedToken(dir, fakeJwt(IN_30_DAYS), NOW);
    const env = fakeJwt(IN_30_DAYS + 1);
    expect(await resolveToken({ envToken: env, cacheDir: dir, now: NOW })).toMatchObject({ token: env, source: 'env' });
    expect((await readCachedToken(dir))?.token).not.toBe(env);
  });

  it('drops an expired cached token instead of failing', async () => {
    await writeCachedToken(dir, fakeJwt(YESTERDAY), NOW);
    expect(await resolveToken({ cacheDir: dir, now: NOW })).toMatchObject({ token: undefined, state: 'expired' });
  });

  it('refuses an expired token file', async () => {
    const file = join(dir, 'token.txt');
    await writeFile(file, fakeJwt(YESTERDAY));
    await expect(resolveToken({ tokenFile: file, cacheDir: dir, now: NOW })).rejects.toThrow(/expired/);
    expect(await readCachedToken(dir)).toBeUndefined();
  });

  it('reports none without any token', async () => {
    expect(await resolveToken({ cacheDir: dir, now: NOW })).toMatchObject({ source: 'none', state: 'none' });
  });

  it('warns when expiry is close', () => {
    const soon = Math.floor((NOW + EXPIRY_WARNING_MS - 60_000) / 1000);
    expect(tokenStatus(fakeJwt(soon), 'cache', NOW).state).toBe('expiring');
  });
});
