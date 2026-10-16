import { ArchiveAuthError } from '@exhumer/f1-live-timing';

/** A message for the user: the archive's 401 says what to do about the token. */
export function describeError(error: unknown): string {
  if (error instanceof ArchiveAuthError) {
    return error.hadToken
      ? 'F1 rejected your token; it has probably expired. Run `exf1lt login` to get a new one.'
      : 'The F1 archive needs a token. Run `exf1lt login`, or pass --auth-token-file <path>.';
  }
  return error instanceof Error ? error.message : String(error);
}
