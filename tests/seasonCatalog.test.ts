import { type ArchiveClient, ArchiveNotFoundError, type SeasonIndex } from '@exhumer/f1-live-timing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { archiveSessionName, f1tvSchedule, type TvSchedule, utcOffset } from '../src/archive/f1tvSchedule.js';
import { checkSessions, clearSessionChecks, fromSchedule, loadSeasonCatalog } from '../src/archive/seasonCatalog.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const BAHRAIN = { key: '1229', name: 'Bahrain Grand Prix', location: 'Sakhir', round: 1, testing: false, startUtc: Date.parse('2024-02-29T00:00:00Z') };
// Real F1TV values for Bahrain 2024 (sessionStartDate, offset from sessionEndTime "+03:00").
const BAHRAIN_SESSIONS = [
  { name: 'Practice 1', startUtc: 1709206200000, offsetMs: 3 * 3_600_000 },
  { name: 'Qualifying', startUtc: 1709308800000, offsetMs: 3 * 3_600_000 },
  { name: 'Race', startUtc: 1709391600000, offsetMs: 3 * 3_600_000 },
];

/** Shaped like the 2024 index: only from round 10, plus a 2023-style placeholder session. */
const INDEX_2024: SeasonIndex = {
  Year: 2024,
  Meetings: [
    {
      Key: 1238,
      Code: 'ESP',
      Number: 10,
      Location: 'Barcelona',
      OfficialName: 'Spanish Grand Prix 2024',
      Name: 'Spanish Grand Prix',
      Country: { Key: 1, Code: 'ESP', Name: 'Spain' },
      Circuit: { Key: 1, ShortName: 'Catalunya' },
      Sessions: [
        { Key: 9539, Type: 'Race', Name: 'Race', StartDate: '2024-06-23T15:00:00', EndDate: '2024-06-23T17:00:00', GmtOffset: '02:00:00', Path: '2024/2024-06-23_Spanish_Grand_Prix/2024-06-23_Race/' },
        // Placeholder for a moved session: no name, `Key: -1`; the library rebuilds an `undefined` path.
        { Key: -1, Type: 'Race', StartDate: '2024-06-22T15:00:00', EndDate: '2024-06-22T16:00:00', GmtOffset: '02:00:00', Path: '2024/2024-06-23_Spanish_Grand_Prix/2024-06-22_undefined/' } as never,
      ],
    },
  ],
};

function schedule(overrides: Partial<TvSchedule> = {}): TvSchedule {
  return {
    meetings: async () => [BAHRAIN, { ...BAHRAIN, key: '1238', name: 'Spanish Grand Prix', round: 10 }],
    sessions: async (key) => (key === '1229' ? BAHRAIN_SESSIONS : []),
    ...overrides,
  };
}

const archiveWith = (season: (year: number) => Promise<SeasonIndex>) => ({ season }) as unknown as Pick<ArchiveClient, 'season'>;

describe('loadSeasonCatalog', () => {
  it('keeps the index, drops its placeholders and fills missing meetings from F1TV', async () => {
    const meetings = await loadSeasonCatalog(2024, { archive: archiveWith(async () => INDEX_2024), schedule: schedule() }, NOW);
    expect(meetings.map((meeting) => [meeting.round, meeting.name, meeting.source])).toEqual([
      [1, 'Bahrain Grand Prix', 'f1tv'],
      [10, 'Spanish Grand Prix', 'index'],
    ]);
    expect(meetings[1]!.sessions.map((session) => session.name)).toEqual(['Race']);
    // The real archive paths, dated in the circuit's local time.
    expect(meetings[0]!.sessions.map((session) => session.path)).toEqual([
      '2024/2024-03-02_Bahrain_Grand_Prix/2024-02-29_Practice_1/',
      '2024/2024-03-02_Bahrain_Grand_Prix/2024-03-01_Qualifying/',
      '2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/',
    ]);
  });

  it('builds a whole season from F1TV when the index is missing (2022)', async () => {
    const missing = archiveWith(async () => {
      throw new ArchiveNotFoundError('https://livetiming.formula1.com/static/2022/Index.json', 403);
    });
    const meetings = await loadSeasonCatalog(2022, { archive: missing, schedule: schedule() }, NOW);
    expect(meetings).toHaveLength(1);
    expect(meetings[0]!.source).toBe('f1tv');
  });

  it('falls back to the index alone when F1TV is unavailable', async () => {
    const offline = schedule({ meetings: async () => Promise.reject(new Error('offline')) });
    const meetings = await loadSeasonCatalog(2024, { archive: archiveWith(async () => INDEX_2024), schedule: offline }, NOW);
    expect(meetings.map((meeting) => meeting.source)).toEqual(['index']);
  });

  it('skips meetings that have not started and F1TV meetings without timed sessions', async () => {
    const future = { ...BAHRAIN, key: '9999', startUtc: NOW + 86_400_000 };
    const meetings = await loadSeasonCatalog(
      2024,
      { archive: archiveWith(async () => INDEX_2024), schedule: schedule({ meetings: async () => [future, { ...BAHRAIN, key: '1' }] }) },
      NOW,
    );
    expect(meetings.map((meeting) => meeting.key)).toEqual(['1238']);
  });

  it('marks testing meetings', () => {
    const testing = fromSchedule(2025, { ...BAHRAIN, key: '1', name: 'Pre-Season Testing', round: undefined, testing: true }, [
      { name: 'Day 1', startUtc: Date.parse('2025-02-26T07:00:00Z'), offsetMs: 3 * 3_600_000 },
    ]);
    expect(testing).toMatchObject({ testing: true, round: undefined });
    // Up to 2024 testing days are filed as Practice_N, since 2025 as Day_N: both are tried.
    expect(testing.sessions[0]).toMatchObject({
      path: '2025/2025-02-26_Pre-Season_Testing/2025-02-26_Practice_1/',
      alternatives: ['2025/2025-02-26_Pre-Season_Testing/2025-02-26_Day_1/'],
    });
  });
});

describe('F1TV schedule', () => {
  it('maps F1TV titles to archive folder names and drops shows', () => {
    expect(archiveSessionName('Race Replay')).toBe('Race');
    expect(archiveSessionName('Sprint Qualifying Replay')).toBe('Sprint Qualifying');
    expect(archiveSessionName('DAY 1, SESSION 2')).toBe('Day 1');
    expect(archiveSessionName('Practice 1')).toBe('Practice 1');
    expect(archiveSessionName('Post-Race Show')).toBeUndefined();
    expect(archiveSessionName('F1 Kids')).toBeUndefined();
    expect(archiveSessionName('Weekend Warm-Up')).toBeUndefined();
  });

  it('reads the UTC offset of a local time', () => {
    expect(utcOffset('2024-03-02T21:00:00+03:00')).toBe(3 * 3_600_000);
    expect(utcOffset('2024-05-05T18:00:00-04:00')).toBe(-4 * 3_600_000);
    expect(utcOffset('')).toBeUndefined();
  });

  it('reads meetings and the timed F1 sessions of a meeting', async () => {
    const container = (titleBrief: string, extra: Record<string, unknown> = {}, packageName = 'F1_Live') => ({
      metadata: {
        titleBrief,
        title: titleBrief,
        emfAttributes: {
          VideoType: 'meetingSession',
          Series: 'FORMULA 1',
          sessionStartDate: 1709391600000,
          sessionEndTime: '2024-03-02T20:00:00+03:00',
          ...extra,
        },
      },
      platformVariants: [{ technicalPackages: [{ packageName }] }],
    });
    const searchVod = vi.fn(async (params: Record<string, string>) => ({
      resultObj: {
        containers: params['filter_objectSubtype']
          ? [
              {
                metadata: {
                  emfAttributes: {
                    MeetingKey: '1229',
                    Meeting_Name: 'Bahrain Grand Prix',
                    Circuit_Short_Name: 'Sakhir',
                    Championship_Meeting_Ordinal: '1',
                    IsTestEvent: 'false',
                    Meeting_Start_Date: '2024-02-29T00:00:00+00:00',
                  },
                },
              },
            ]
          : [
              container('Race Replay'),
              container('Pre-Race Show', {}, 'VOD'),
              container('Feature Race', { Series: 'FORMULA 2' }),
              container('Practice 1', { sessionStartDate: 0 }), // undated (2018–2020)
              container('DAY 1, SESSION 2', { sessionStartDate: 1709200000000 }),
              container('Day 1, Session 1', { sessionStartDate: 1709100000000 }),
            ],
      },
    }));
    const tv = f1tvSchedule(async () => ({ searchVod }) as never);
    expect(await tv.meetings(2024)).toEqual([{ ...BAHRAIN, startUtc: Date.parse('2024-02-29T00:00:00Z') }]);
    expect(await tv.sessions('1229')).toEqual([
      { name: 'Day 1', startUtc: 1709100000000, offsetMs: 3 * 3_600_000 },
      { name: 'Race', startUtc: 1709391600000, offsetMs: 3 * 3_600_000 },
    ]);
    expect(searchVod).toHaveBeenCalledWith(expect.objectContaining({ filter_season: '2024', filter_objectSubtype: 'Meeting' }));
  });
});

describe('checkSessions', () => {
  beforeEach(() => clearSessionChecks());

  it('reports which sessions are in the archive and caches the answers', async () => {
    const sessionFeeds = vi.fn(async (path: string) => {
      if (path.includes('Race')) return { Feeds: {} };
      throw new ArchiveNotFoundError(path, 403);
    });
    const results: [string, boolean][] = [];
    await checkSessions({ sessionFeeds }, ['a/Race/', 'a/Practice_1/', 'a/Race/'], (path, ok) => results.push([path, ok]));
    expect(results.sort()).toEqual([
      ['a/Practice_1/', false],
      ['a/Race/', true],
    ]);
    await checkSessions({ sessionFeeds }, ['a/Race/'], () => undefined);
    expect(sessionFeeds).toHaveBeenCalledTimes(2);
  });

  it('does not treat a network error as missing, and asks again next time', async () => {
    const sessionFeeds = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ Feeds: {} });
    const results: boolean[] = [];
    await checkSessions({ sessionFeeds }, ['a/Race/'], (_path, ok) => results.push(ok));
    expect(results).toEqual([]);
    await checkSessions({ sessionFeeds }, ['a/Race/'], (_path, ok) => results.push(ok));
    expect(results).toEqual([true]);
  });
});

describe('testing sessions', () => {
  beforeEach(() => clearSessionChecks());

  const noIndex = async (): Promise<SeasonIndex> => {
    throw new ArchiveNotFoundError('https://livetiming.formula1.com/static/x/Index.json', 403);
  };
  const testingSchedule = (name: string, testing: boolean): TvSchedule => ({
    meetings: async () => [{ key: '1132', name, location: 'Sakhir', round: undefined, testing, startUtc: Date.parse('2022-03-10T00:00:00Z') }],
    sessions: async () => [
      { name: 'Day 1', startUtc: Date.parse('2022-03-10T07:00:00Z'), offsetMs: 3 * 3_600_000 },
      { name: 'Day 2', startUtc: Date.parse('2022-03-11T07:00:00Z'), offsetMs: 3 * 3_600_000 },
    ],
  });

  it('files testing days under whichever folder the archive has', async () => {
    // 2022 keeps Practice_N, so Day 2's Practice folder is "missing" here to force the Day_N fallback.
    const served = new Set([
      '2022/2022-03-11_Pre-Season_Test/2022-03-10_Practice_1/',
      '2022/2022-03-11_Pre-Season_Test/2022-03-11_Day_2/',
    ]);
    const archive = {
      season: noIndex,
      sessionFeeds: async (path: string) => {
        if (served.has(path)) return { Feeds: {} };
        throw new ArchiveNotFoundError(path, 403);
      },
    } as unknown as ArchiveClient;
    const [meeting] = await loadSeasonCatalog(2022, { archive, schedule: testingSchedule('Pre-Season Test', true) }, NOW);
    expect(meeting!.sessions.map((session) => session.path)).toEqual([...served]);
    expect(meeting!.sessions.every((session) => session.alternatives === undefined)).toBe(true);
  });

  it('adds the 2020 tests that neither the index nor F1TV lists', async () => {
    const archive = { season: noIndex, sessionFeeds: async () => ({ Feeds: {} }) } as unknown as ArchiveClient;
    const meetings = await loadSeasonCatalog(2020, { archive, schedule: { meetings: async () => [], sessions: async () => [] } }, NOW);
    expect(meetings.map((meeting) => [meeting.name, meeting.testing, meeting.source])).toEqual([
      ['Pre-Season Test 1', true, 'archive'],
      ['Pre-Season Test 2', true, 'archive'],
    ]);
    expect(meetings[0]!.sessions.map((session) => session.path)).toEqual([
      '2020/2020-02-21_Pre-Season_Test_1/2020-02-19_Practice_1/',
      '2020/2020-02-21_Pre-Season_Test_1/2020-02-20_Practice_2/',
      '2020/2020-02-21_Pre-Season_Test_1/2020-02-21_Practice_3/',
    ]);
  });

  it('does not add an extra meeting the index already lists', async () => {
    const index: SeasonIndex = {
      Year: 2020,
      Meetings: [
        {
          ...INDEX_2024.Meetings[0]!,
          Key: 1,
          Name: 'Pre-Season Test 1',
          Sessions: [
            { Key: 1, Type: 'Practice', Name: 'Practice 1', StartDate: '2020-02-19T09:00:00', EndDate: '2020-02-19T18:00:00', GmtOffset: '01:00:00', Path: '2020/2020-02-21_Pre-Season_Test_1/2020-02-19_Practice_1/' },
          ],
        },
      ],
    };
    const archive = { season: async () => index, sessionFeeds: async () => ({ Feeds: {} }) } as unknown as ArchiveClient;
    const meetings = await loadSeasonCatalog(2020, { archive }, NOW);
    expect(meetings.map((meeting) => [meeting.name, meeting.source])).toEqual([
      ['Pre-Season Test 1', 'index'],
      ['Pre-Season Test 2', 'archive'],
    ]);
  });

  it('recognises the 2021 test, which F1TV does not flag as one', async () => {
    const searchVod = async () => ({
      resultObj: {
        containers: [
          {
            metadata: {
              emfAttributes: {
                MeetingKey: '1087',
                Meeting_Name: 'Pre-Season Test',
                Meeting_Location: 'Bahrain',
                Championship_Meeting_Ordinal: '0',
                IsTestEvent: 'false',
                Meeting_Start_Date: '2021-03-12T00:00:00+00:00',
              },
            },
          },
        ],
      },
    });
    const [meeting] = await f1tvSchedule(async () => ({ searchVod }) as never).meetings(2021);
    expect(meeting).toMatchObject({ testing: true, round: undefined });
  });
});
