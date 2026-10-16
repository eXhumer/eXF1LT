import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { archiveCredential, archiveOptions, parseAuthorizationFile, resolveAuthorization } from '../src/auth/authorization.js';
import { TokenFileError } from '../src/auth/parseTokenFile.js';
import { resolveToken } from '../src/auth/resolveToken.js';
import { AUTH_FILE, AUTHORIZATION_FILE, clearCachedToken, readCachedToken } from '../src/auth/tokenCache.js';
import { fakeJwt } from './helpers.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const IN_30_DAYS = Math.floor((NOW + 30 * 86_400_000) / 1000);
const YESTERDAY = Math.floor((NOW - 86_400_000) / 1000);

describe('parseAuthorizationFile', () => {
  it('accepts a bare token, a Bearer token and a pasted header line', () => {
    expect(parseAuthorizationFile('﻿ abc.def \n')).toBe('abc.def');
    expect(parseAuthorizationFile('Bearer abc.def')).toBe('abc.def');
    expect(parseAuthorizationFile('Authorization: Bearer abc.def\n')).toBe('abc.def');
  });

  it('rejects empty or multi-word contents', () => {
    expect(() => parseAuthorizationFile('  ')).toThrow(TokenFileError);
    expect(() => parseAuthorizationFile('two words')).toThrow(TokenFileError);
  });
});

describe('archiveOptions', () => {
  it('passes the token as authToken', () => {
    expect(archiveOptions({ token: 'abc', source: 'env', state: 'valid', expiresAt: undefined })).toEqual({ authToken: 'abc' });
  });

  it('passes nothing without a usable token', () => {
    expect(archiveOptions(undefined)).toEqual({});
    expect(archiveOptions({ token: undefined, source: 'cache', state: 'expired', expiresAt: 1 })).toEqual({});
  });
});

describe('archiveCredential', () => {
  const status = (token: string | undefined) => ({ token, source: 'file' as const, state: token ? ('valid' as const) : ('none' as const), expiresAt: undefined });

  it('prefers the authorization token and falls back to the ascendon token', () => {
    expect(archiveCredential(status('authz'), status('asc'))?.token).toBe('authz');
    expect(archiveCredential(status(undefined), status('asc'))?.token).toBe('asc');
    expect(archiveCredential(status(undefined), status(undefined))?.token).toBeUndefined();
  });
});

describe('two tokens side by side', () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'exf1lt-authz-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('caches each token in its own file without mixing them', async () => {
    const ascendon = fakeJwt(IN_30_DAYS);
    const bearer = 'authorization-token';
    const ascendonFile = join(dir, 'ascendon.txt');
    const authFile = join(dir, 'authz.txt');
    await writeFile(ascendonFile, ascendon);
    await writeFile(authFile, `Bearer ${bearer}`);

    await resolveToken({ tokenFile: ascendonFile, cacheDir: dir, now: NOW });
    await resolveAuthorization({ tokenFile: authFile, cacheDir: dir, now: NOW });

    expect(JSON.parse(await readFile(join(dir, AUTH_FILE), 'utf8'))).toMatchObject({ token: ascendon });
    expect(JSON.parse(await readFile(join(dir, AUTHORIZATION_FILE), 'utf8'))).toMatchObject({ token: bearer });

    expect(await resolveAuthorization({ cacheDir: dir, now: NOW })).toMatchObject({ token: bearer, source: 'cache' });
    expect(await resolveToken({ cacheDir: dir, now: NOW })).toMatchObject({ token: ascendon, source: 'cache' });
  });

  it('keeps the env token out of the cache', async () => {
    expect(await resolveAuthorization({ envToken: ' env-token ', cacheDir: dir, now: NOW })).toMatchObject({
      token: 'env-token',
      source: 'env',
    });
    expect(await readCachedToken(dir, AUTHORIZATION_FILE)).toBeUndefined();
  });

  it('drops an expired JWT authorization token and clears independently', async () => {
    await writeFile(join(dir, 'a.txt'), fakeJwt(YESTERDAY));
    await expect(resolveAuthorization({ tokenFile: join(dir, 'a.txt'), cacheDir: dir, now: NOW })).rejects.toThrow(/expired/);

    await writeFile(join(dir, AUTHORIZATION_FILE), JSON.stringify({ token: fakeJwt(YESTERDAY), savedAt: 'x' }));
    expect(await resolveAuthorization({ cacheDir: dir, now: NOW })).toMatchObject({ token: undefined, state: 'expired' });

    await writeFile(join(dir, AUTH_FILE), JSON.stringify({ token: 'keep', savedAt: 'x' }));
    expect(await clearCachedToken(dir, AUTHORIZATION_FILE)).toBe(true);
    expect((await readCachedToken(dir))?.token).toBe('keep');
  });
});
