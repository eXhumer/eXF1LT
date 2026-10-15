/**
 * Minimal JWT helpers. The signature is never checked: the token is only
 * inspected locally to learn when it expires.
 */

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** Whether a string has the three base64url segments of a JWT. */
export function looksLikeJwt(value: string): boolean {
  return JWT_PATTERN.test(value);
}

/** The decoded payload of a JWT, or `undefined` when it is not one. */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  if (!looksLikeJwt(token)) return undefined;
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Expiry of a JWT in epoch milliseconds, from its `exp` claim. */
export function jwtExpiry(token: string): number | undefined {
  const exp = decodeJwtPayload(token)?.['exp'];
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
}
