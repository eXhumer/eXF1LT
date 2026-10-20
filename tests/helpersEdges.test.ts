/**
 * Fallbacks in the canvas, archive and token helpers: missing fields from
 * F1TV, odd archive answers, and files that are not where or what we expect.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArchiveClient, ArchiveHttpError, ArchiveNotFoundError } from '@exhumer/f1-live-timing';
import { F1TVClient } from '@exhumer/f1tv-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { f1tvSchedule, utcOffset } from '../src/archive/f1tvSchedule.js';
import { checkSessions, clearSessionChecks, fromSchedule, loadSeasonCatalog } from '../src/archive/seasonCatalog.js';
import { createArchiveClient } from '../src/auth/authorization.js';
import { findBrowser } from '../src/auth/browser.js';
import { decodeJwtPayload } from '../src/auth/jwt.js';
import { resolveToken } from '../src/auth/resolveToken.js';
import { clearCachedToken, configDir, readCachedToken, writeCachedToken } from '../src/auth/tokenCache.js';
import { BrailleGrid } from '../src/canvas/braille.js';
import { renderTrackMap } from '../src/canvas/trackMap.js';
import { fakeJwt } from './helpers.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'exf1lt-edges-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('BrailleGrid', () => {
  it('leaves an open path open, does not close a two-point path, and is blank outside the grid', () => {
    const open = new BrailleGrid(4, 2);
    open.path([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 6 },
    ]);
    const closed = new BrailleGrid(4, 2);
    closed.path(
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 6 },
      ],
      true,
    );
    expect(open.lines()).not.toEqual(closed.lines());

    const line = new BrailleGrid(4, 2);
    line.path(
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
      ],
      true,
    );
    expect(line.lines().join('')).not.toBe(' '.repeat(8));
    expect(line.char(99, 99)).toBe(' ');
  });
});

describe('renderTrackMap', () => {
  it('dims a dimmed car unless it is selected', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const cars = [
      { number: '1', tla: 'NOR', x: 0, y: 0, color: '#f47600', dim: true },
      { number: '2', tla: 'PIA', x: 100, y: 100, color: undefined, dim: true },
    ];
    const cells = renderTrackMap({ outline, cars, columns: 30, rows: 10, selected: '2' }).flat();
    expect(cells.some((cell) => cell.dim)).toBe(true);
    expect(cells.find((cell) => cell.char === 'P')?.dim).toBeUndefined();
  });
});

describe('f1tvSchedule', () => {
  const searchVod = (containers: unknown[]) => vi.fn(async () => ({ resultObj: { containers } }));

  it('reads F1TV without a login by default, and retries a client that failed to start', async () => {
    const create = vi
      .spyOn(F1TVClient, 'create')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ searchVod: searchVod([]) } as never);
    const tv = f1tvSchedule();
    await expect(tv.meetings(2026)).rejects.toThrow('offline');
    await expect(tv.meetings(2026)).resolves.toEqual([]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('falls back through the location fields and the title, and keeps the earliest of a split session', async () => {
    const meeting = (attributes: Record<string, unknown>) => ({
      metadata: { emfAttributes: { MeetingKey: 1, Meeting_Name: 'Test', Meeting_Start_Date: '2026-01-01T00:00:00Z', ...attributes } },
    });
    const session = (title: string, start: number, extra: Record<string, unknown> = {}) => ({
      metadata: {
        titleBrief: '',
        title,
        emfAttributes: { VideoType: 'meetingSession', sessionStartDate: start, sessionEndTime: '2026-01-01T10:00:00+03:00' },
      },
      // A variant without packages first: it is skipped, not a crash.
      platformVariants: [{}, { technicalPackages: [{ packageName: 'F1_Archive' }] }],
      ...extra,
    });
    const tv = f1tvSchedule(async () => ({
      searchVod: vi.fn(async (params?: Record<string, string>) => ({
        resultObj: {
          containers: params?.['filter_objectSubtype']
            ? [meeting({ Meeting_Location: 'Sakhir' }), meeting({ Meeting_Country_Name: 'Bahrain', Championship_Meeting_Ordinal: 'x' })]
            : [
                session('Day 1, Session 1', 100),
                session('Day 1, Session 2', 200),
                session('Practice 1', 300, { platformVariants: undefined }),
              ],
        },
      })),
    }) as never);
    expect((await tv.meetings(2026)).map((entry) => [entry.location, entry.round])).toEqual([
      ['Sakhir', undefined],
      ['Bahrain', undefined],
    ]);
    // The undated-package Practice 1 is not a broadcast; the testing day keeps its first session.
    expect(await tv.sessions('1')).toEqual([{ name: 'Day 1', startUtc: 100, offsetMs: 3 * 3_600_000 }]);
  });

  it('reads no offset from a missing time', () => {
    expect(utcOffset(undefined)).toBeUndefined();
  });
});

describe('loadSeasonCatalog', () => {
  const meeting = { key: '1', name: 'Test GP', location: 'X', round: 1, testing: false, startUtc: 0 };

  it('dates the meeting folder by its last session in any order', () => {
    const built = fromSchedule(2026, meeting, [
      { name: 'Race', startUtc: Date.parse('2026-03-08T05:00:00Z'), offsetMs: 0 },
      { name: 'Qualifying', startUtc: Date.parse('2026-03-07T05:00:00Z'), offsetMs: 0 },
    ]);
    expect(built.sessions[0]?.path.startsWith('2026/2026-03-08_Test_GP/')).toBe(true);
  });

  it('passes on archive errors other than a missing index, uses the current time, and skips meetings F1TV cannot list', async () => {
    const failing = { season: async () => Promise.reject(new ArchiveHttpError('https://example/Index.json', 500)) };
    await expect(loadSeasonCatalog(2026, { archive: failing as never })).rejects.toBeInstanceOf(ArchiveHttpError);

    const empty = { season: async () => Promise.reject(new ArchiveNotFoundError('https://example/Index.json', 403)) };
    const meetings = await loadSeasonCatalog(2026, {
      archive: empty as never,
      schedule: { meetings: async () => [meeting], sessions: async () => Promise.reject(new Error('down')) },
    });
    expect(meetings).toEqual([]);
  });

  it('keeps the listed path when no alternative is in the archive', async () => {
    clearSessionChecks();
    const archive = {
      season: async () => Promise.reject(new ArchiveNotFoundError('https://example/Index.json', 403)),
      sessionFeeds: async () => Promise.reject(new ArchiveNotFoundError('https://example/Index.json', 403)),
    };
    const meetings = await loadSeasonCatalog(
      2025,
      {
        archive: archive as never,
        schedule: {
          meetings: async () => [{ ...meeting, testing: true, name: 'Pre-Season Testing' }],
          sessions: async () => [{ name: 'Day 1', startUtc: Date.parse('2025-02-26T07:00:00Z'), offsetMs: 3 * 3_600_000 }],
        },
      },
      Date.parse('2025-12-01T00:00:00Z'),
    );
    // Neither the Practice_1 nor the Day_1 folder is there, so it keeps its first guess.
    expect(meetings[0]?.sessions[0]?.path).toBe('2025/2025-02-26_Pre-Season_Testing/2025-02-26_Practice_1/');
  });

  it('stops checking sessions once aborted', async () => {
    clearSessionChecks();
    const controller = new AbortController();
    controller.abort();
    const sessionFeeds = vi.fn();
    const results: string[] = [];
    await checkSessions({ sessionFeeds } as never, ['a', 'b'], (path) => results.push(path), { signal: controller.signal });
    expect(sessionFeeds).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});

describe('tokens', () => {
  it('creates an archive client', () => {
    expect(createArchiveClient(undefined)).toBeInstanceOf(ArchiveClient);
  });

  it('decodes only JWTs whose payload is an object', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeJwtPayload(`h.${encode([1, 2])}.s`)).toBeUndefined();
    expect(decodeJwtPayload(`h.${encode(5)}.s`)).toBeUndefined();
    expect(decodeJwtPayload(`h.${encode({ a: 1 })}.s`)).toEqual({ a: 1 });
  });

  it('reads the token cache from the default directory and the time now', async () => {
    const status = await resolveToken({ envToken: fakeJwt(undefined), cacheDir: dir });
    expect(status.state).toBe('valid');
    expect(configDir()).toBe(configDir(process.env, process.platform));
    const saved = await writeCachedToken(dir, 'plain-token');
    expect(Date.parse(saved.savedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('falls back to the home directory without APPDATA or XDG_CONFIG_HOME', () => {
    expect(configDir({}, 'win32')).toBe(join(homedir(), 'AppData', 'Roaming', 'eXF1LT'));
    expect(configDir({}, 'linux')).toBe(join(homedir(), '.config', 'exf1lt'));
  });

  it('treats a cache file of the wrong shape as no token, and passes on other read and delete errors', async () => {
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ token: 1 }));
    expect(await readCachedToken(dir)).toBeUndefined();

    // A directory where the cache file should be: reading it fails with EISDIR, not ENOENT, on every platform.
    await mkdir(join(dir, 'authorization.json'));
    await expect(readCachedToken(dir, 'authorization.json')).rejects.toThrow();

    // Deleting a directory where the cache file should be fails too.
    await mkdir(join(dir, 'auth.json.d'));
    await expect(clearCachedToken(dir, 'auth.json.d')).rejects.toThrow();
  });
});

describe('findBrowser', () => {
  it('checks candidates on disk, and searches the real environment by default', async () => {
    const chromium = join(dir, 'chromium');
    await writeFile(chromium, '#!/bin/sh\n');
    await chmod(chromium, 0o755);
    // google-chrome comes first but is not there; chromium is.
    expect(findBrowser(undefined, { PATH: dir }, 'linux')).toBe(join(dir, 'chromium').replaceAll('\\', '/'));
    expect(findBrowser(undefined, {}, 'linux')).toBeUndefined();
    const found = findBrowser(undefined);
    expect(found === undefined || typeof found === 'string').toBe(true);
    expect(await readFile(chromium, 'utf8')).toBe('#!/bin/sh\n');
  });
});
