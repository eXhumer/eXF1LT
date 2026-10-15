import { readFile } from 'node:fs/promises';

import { jwtExpiry } from './jwt.js';
import { parseTokenFile, TokenFileError } from './parseTokenFile.js';
import { readCachedToken, writeCachedToken } from './tokenCache.js';

/** Warn about a token this close to expiring. */
export const EXPIRY_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

export type TokenSource = 'file' | 'env' | 'cache' | 'none';
export type TokenState = 'valid' | 'expiring' | 'expired' | 'none';

export interface TokenStatus {
  /** The token to connect with. `undefined` when there is none or it expired. */
  readonly token: string | undefined;
  readonly source: TokenSource;
  readonly state: TokenState;
  readonly expiresAt: number | undefined;
}

export interface ResolveTokenOptions {
  /** `--token-file`: read, check and cache this token. */
  readonly tokenFile?: string | undefined;
  /** `F1_TOKEN`: used as is, never cached. */
  readonly envToken?: string | undefined;
  /** Directory of the token cache. */
  readonly cacheDir: string;
  readonly now?: number;
}

/**
 * Find the token to use: `--token-file` (which refreshes the cache), then
 * `F1_TOKEN`, then the cache. An expired cached or env token yields
 * `state: 'expired'` and no token, so the caller can connect without auth.
 * An expired token file is an error, since the user just asked for it.
 */
export async function resolveToken(options: ResolveTokenOptions): Promise<TokenStatus> {
  const now = options.now ?? Date.now();

  if (options.tokenFile) {
    const token = parseTokenFile(await readFile(options.tokenFile, 'utf8'));
    const status = tokenStatus(token, 'file', now);
    if (status.state === 'expired') {
      throw new TokenFileError(`The token in ${options.tokenFile} expired on ${formatDate(status.expiresAt!)}.`);
    }
    await writeCachedToken(options.cacheDir, token, now);
    return status;
  }

  if (options.envToken) return tokenStatus(options.envToken.trim(), 'env', now);

  const cached = await readCachedToken(options.cacheDir);
  if (cached) return tokenStatus(cached.token, 'cache', now);

  return { token: undefined, source: 'none', state: 'none', expiresAt: undefined };
}

export function tokenStatus(token: string, source: TokenSource, now: number): TokenStatus {
  const expiresAt = jwtExpiry(token);
  if (expiresAt === undefined) return { token, source, state: 'valid', expiresAt };
  if (expiresAt <= now) return { token: undefined, source, state: 'expired', expiresAt };
  const state = expiresAt - now <= EXPIRY_WARNING_MS ? 'expiring' : 'valid';
  return { token, source, state, expiresAt };
}

function formatDate(utc: number): string {
  return new Date(utc).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
