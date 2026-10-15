import { type ArchiveClient, ArchiveNotFoundError, type SeasonIndex } from '@exhumer/f1-live-timing';
import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TvSchedule } from '../src/archive/f1tvSchedule.js';
import { clearSessionChecks } from '../src/archive/seasonCatalog.js';
import { FIRST_ARCHIVE_YEAR, type PickResult, PickerView, seasonYears } from '../src/views/PickerView.js';
import { eventually } from './helpers.js';

/** For asserting that something did *not* change: give it a chance to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const NOW = Date.parse('2026-10-15T12:00:00Z');

function season(year: number, name: string): SeasonIndex {
  return {
    Year: year,
    Meetings: [
      {
        Key: year,
        Code: name.slice(0, 3).toUpperCase(),
        Number: 1,
        Location: name,
        OfficialName: `${name} Grand Prix ${year}`,
        Name: `${name} Grand Prix`,
        Country: { Key: 1, Code: 'XXX', Name: name },
        Circuit: { Key: 1, ShortName: name },
        Sessions: [
          {
            Key: year * 10 + 1,
            Type: 'Qualifying',
            Name: 'Qualifying',
            StartDate: `${year}-02-28T15:00:00`,
            EndDate: `${year}-02-28T16:00:00`,
            GmtOffset: '00:00:00',
            Path: `${year}/${year}-03-01_${name}_Grand_Prix/${year}-02-28_Qualifying/`,
          },
          {
            Key: year * 10,
            Type: 'Race',
            Name: 'Race',
            StartDate: `${year}-03-01T15:00:00`,
            EndDate: `${year}-03-01T17:00:00`,
            GmtOffset: '00:00:00',
            Path: `${year}/${year}-03-01_${name}_Grand_Prix/${year}-03-01_Race/`,
          },
        ],
      },
    ],
  };
}

/** Like the real archive: the index lists only the current season, older ones still load. */
const archive = {
  index: async () => ({ Years: [{ Year: 2026, Path: '2026/' }] }),
  streamingStatus: async () => 'Offline',
  latestSession: async () => ({}),
  season: async (year: number) => {
    if (year === 2024) throw new ArchiveNotFoundError(`https://example/${year}/Index.json`, 403);
    return season(year, year === 2026 ? 'Singapore' : 'Bahrain');
  },
  // Like 2018: the index lists sessions the archive no longer has.
  sessionFeeds: async (path: string) => {
    if (path.startsWith('2023/') && path.includes('Race')) throw new ArchiveNotFoundError(path, 403);
    return { Feeds: {} };
  },
} as unknown as ArchiveClient;

/** F1TV fills in a 2024 meeting that the (missing) 2024 index leaves out. */
const schedule: TvSchedule = {
  meetings: async (year) =>
    year === 2024
      ? [{ key: '1229', name: 'Bahrain Grand Prix', location: 'Sakhir', round: 1, testing: false, startUtc: Date.parse('2024-02-29T00:00:00Z') }]
      : [],
  sessions: async () => [{ name: 'Race', startUtc: 1709391600000, offsetMs: 3 * 3_600_000 }],
};

beforeEach(() => clearSessionChecks());

describe('seasonYears', () => {
  it('offers every archived season up to the newest one', () => {
    const years = seasonYears([2026], NOW);
    expect(years[0]).toBe(FIRST_ARCHIVE_YEAR);
    expect(years.at(-1)).toBe(2026);
    expect(years).toHaveLength(2026 - FIRST_ARCHIVE_YEAR + 1);
  });

  it('falls back to the current year without an index', () => {
    expect(seasonYears([], NOW).at(-1)).toBe(2026);
  });
});

describe('PickerView', () => {
  it('steps back to older seasons with [ and forward with ]', async () => {
    const { stdin, lastFrame, unmount } = render(
      <PickerView archive={archive} token={undefined} onPick={() => undefined} onQuit={() => undefined} now={NOW} />,
    );
    await eventually(() => {
      expect(lastFrame()).toMatch(/◀ 2026 ▶/);
      expect(lastFrame()).toContain('Singapore Grand Prix');
    });

    stdin.write('[');
    await eventually(() => {
      expect(lastFrame()).toMatch(/◀ 2025 ▶/);
      expect(lastFrame()).toContain('Bahrain Grand Prix');
    });

    stdin.write('[');
    await eventually(() => expect(lastFrame()).toContain('No timing archive for 2024.'));

    // A missing season does not get stuck: moving on clears the error.
    stdin.write('[');
    await eventually(() => {
      expect(lastFrame()).toMatch(/◀ 2023 ▶/);
      expect(lastFrame()).not.toContain('No timing archive');
      expect(lastFrame()).toContain('Bahrain Grand Prix');
    });

    for (const year of [2024, 2025, 2026]) {
      stdin.write(']');
      await eventually(() => expect(lastFrame()).toMatch(new RegExp(`◀ ${year} ▶`)));
    }
    stdin.write(']'); // no season after the newest
    await settle();
    expect(lastFrame()).toMatch(/◀ 2026 ▶/);
    unmount();
  });
});

describe('PickerView archive checks', () => {
  it('strikes out sessions missing from the archive and opens the next one instead', async () => {
    const picks: PickResult[] = [];
    const { stdin, lastFrame, unmount } = render(
      <PickerView archive={archive} token={undefined} onPick={(pick) => picks.push(pick)} onQuit={() => undefined} now={NOW} />,
    );
    await eventually(() => expect(lastFrame()).toContain('Singapore Grand Prix'));
    for (const year of [2025, 2024, 2023]) {
      stdin.write('[');
      await eventually(() => expect(lastFrame()).toMatch(new RegExp(`◀ ${year} ▶`)));
    }
    // Wait for the archive check, or the missing race would still count as playable.
    await eventually(() => {
      expect(lastFrame()).toContain('Bahrain Grand Prix');
      expect(lastFrame()).not.toContain('checking the archive');
    });
    // Race is missing; the only playable session is qualifying.
    stdin.write('\u001B[C'); // → past the end still lands on the last playable session
    await settle();
    stdin.write('\r');
    await eventually(() =>
      expect(picks).toEqual([
        { kind: 'replay', path: '2023/2023-03-01_Bahrain_Grand_Prix/2023-02-28_Qualifying/', title: 'Bahrain Grand Prix · Qualifying' },
      ]),
    );
    unmount();
  });

  it('lists meetings the index leaves out, from F1TV', async () => {
    const picks: PickResult[] = [];
    const { stdin, lastFrame, unmount } = render(
      <PickerView archive={archive} schedule={schedule} token={undefined} onPick={(pick) => picks.push(pick)} onQuit={() => undefined} now={NOW} />,
    );
    await eventually(() => expect(lastFrame()).toContain('Singapore Grand Prix'));
    for (const year of [2025, 2024]) {
      stdin.write('[');
      await eventually(() => expect(lastFrame()).toMatch(new RegExp(`◀ ${year} ▶`)));
    }
    await eventually(() => {
      expect(lastFrame()).toMatch(/R1 +Bahrain Grand Prix +Sakhir/);
      expect(lastFrame()).not.toContain('checking the archive');
    });
    stdin.write('\r');
    await eventually(() =>
      expect(picks[0]).toEqual({ kind: 'replay', path: '2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/', title: 'Bahrain Grand Prix · Race' }),
    );
    unmount();
  });
});
