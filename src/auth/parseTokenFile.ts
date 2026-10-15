import { looksLikeJwt } from './jwt.js';

/**
 * Extract the F1 subscription token from the text of a token file.
 *
 * Accepted contents:
 * - the raw `subscriptionToken`;
 * - the `login-session` cookie value, URL-encoded or plain JSON
 *   (`{"data":{"subscriptionToken":"..."}}`), optionally prefixed with
 *   `login-session=`.
 */
export function parseTokenFile(text: string): string {
  let value = text.replace(/^﻿/, '').trim();
  if (value.startsWith('login-session=')) value = value.slice('login-session='.length);
  value = value.replace(/;.*$/s, '').trim();
  if (/^%7B/i.test(value)) value = decodeURIComponent(value);

  if (value.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new TokenFileError('The token file looks like JSON but cannot be parsed.');
    }
    const token = findSubscriptionToken(parsed);
    if (!token) throw new TokenFileError('No subscriptionToken found in the login-session JSON.');
    return token;
  }

  if (!looksLikeJwt(value)) {
    throw new TokenFileError('The token file holds neither a subscription token nor a login-session cookie.');
  }
  return value;
}

export class TokenFileError extends Error {
  override readonly name = 'TokenFileError';
}

function findSubscriptionToken(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['subscriptionToken'] === 'string') return record['subscriptionToken'];
  return findSubscriptionToken(record['data']);
}
