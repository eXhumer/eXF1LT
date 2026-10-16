import { ArchiveAuthError, ArchiveHttpError } from '@exhumer/f1-live-timing';
import { describe, expect, it } from 'vitest';

import { describeError } from '../src/archive/describeError.js';

const URL = 'https://livetiming.formula1.com/static/Index.json';

describe('describeError', () => {
  it('tells an expired token from a missing one', () => {
    expect(describeError(new ArchiveAuthError(URL, 401, true))).toMatch(/rejected your token.*exf1lt login/);
    expect(describeError(new ArchiveAuthError(URL, 401, false))).toMatch(/needs a token.*exf1lt login/);
  });

  it('passes other errors through', () => {
    expect(describeError(new ArchiveHttpError(URL, 500))).toBe(`Archive request failed (HTTP 500): ${URL}`);
    expect(describeError('boom')).toBe('boom');
  });
});
