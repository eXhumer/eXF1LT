import { ArchiveClient } from '@exhumer/f1-live-timing';

import { resolveToken, type ResolveTokenOptions, type TokenStatus } from './resolveToken.js';
import { TokenFileError } from './parseTokenFile.js';
import { AUTHORIZATION_FILE } from './tokenCache.js';

/**
 * F1 uses two tokens:
 *
 * - the *ascendon* (subscription) token, passed to the live SignalR hub as
 *   `authToken` to unlock `CarData` and `Position` (see `resolveToken`);
 * - the *authorization* token, which the static archive
 *   (`livetiming.formula1.com/static/...`) wants as
 *   `Authorization: Bearer <token>`. The website's CORS preflight asks for
 *   exactly that header, and the archive answers 401 without it.
 *
 * Today both are the same kind of JWT, the `subscriptionToken` the F1 login
 * hands out, so one login yields both (`exf1lt login`) and a missing
 * authorization token falls back to the ascendon token (`archiveCredential`).
 * They stay separate values with separate files, env variables and caches in
 * case F1 splits them. */

/**
 * Extract the authorization token from the text of a token file. Accepts the
 * bare token, `Bearer <token>`, or a pasted `Authorization: Bearer <token>`
 * header line.
 */
export function parseAuthorizationFile(text: string): string {
  const value = text
    .replace(/^﻿/, '')
    .trim()
    .replace(/^authorization\s*:\s*/i, '')
    .replace(/^bearer\s+/i, '')
    .trim();
  if (value === '' || /\s/.test(value)) {
    throw new TokenFileError('The authorization token file must hold a single token, optionally prefixed with "Bearer ".');
  }
  return value;
}

export interface ResolveAuthorizationOptions extends Omit<ResolveTokenOptions, 'cacheFile' | 'parse'> {}

/** `--auth-token-file`, then `F1_AUTH_TOKEN`, then the cache. Same rules as the ascendon token. */
export function resolveAuthorization(options: ResolveAuthorizationOptions): Promise<TokenStatus> {
  return resolveToken({ ...options, cacheFile: AUTHORIZATION_FILE, parse: parseAuthorizationFile });
}

/** The header sent with every archive request; empty without a usable token. */
export function authorizationHeaders(authorization: TokenStatus | undefined): Record<string, string> {
  return authorization?.token ? { Authorization: `Bearer ${authorization.token}` } : {};
}

/**
 * The token for the archive: the authorization token, else the ascendon token
 * (the same JWT today), so a user who only ever gave `--token-file` still works.
 */
export function archiveCredential(authorization: TokenStatus | undefined, ascendon: TokenStatus | undefined): TokenStatus | undefined {
  return authorization?.token ? authorization : ascendon?.token ? ascendon : authorization;
}

/** An `ArchiveClient` that sends the authorization token with every request. */
export function createArchiveClient(authorization: TokenStatus | undefined): ArchiveClient {
  return new ArchiveClient({ headers: authorizationHeaders(authorization) });
}
