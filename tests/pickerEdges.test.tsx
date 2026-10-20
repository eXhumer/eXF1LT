import { type ArchiveClient, ArchiveHttpError, ArchiveNotFoundError, type SeasonIndex } from '@exhumer/f1-live-timing';
import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSessionChecks } from '../src/archive/seasonCatalog.js';
import { PickerView, tokenLine } from '../src/views/PickerView.js';
import { eventually } from './helpers.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const NOW = Date.parse('2026-10-15T12:00:00Z');
const KEY = { up: '\u001B[A', down: '\u001B[B', left: '\u001B[D', right: '\u001B[C', escape: '\u001B', enter: '\r' };

const session = (key: number, name: string, date: string, folder: string) => ({
  Key: key,
  Type: name,
  Name: name,
  StartDate: `${date}T10:00:00`,
  EndDate: `${date}T11:00:00`,
  GmtOffset: '00:00:00',
  Path: `2026/${folder}/${date}_${name.replaceAll(' ', '_')}/`,
});

/** A testing week (Day 1, a session with an unusual name) and a race weekend without a round number. */
const SEASON: SeasonIndex = {
  Year: 2026,
  Meetings: [
    {
      Key: 1,
      Code: 'BRN',
      Number: 0,
      Location: 'Sakhir',
      OfficialName: 'Pre-Season Testing 2026',
      Name: 'Pre-Season Testing',
      Country: { Key: 1, Code: 'BRN', Name: 'Bahrain' },
      Circuit: { Key: 1, ShortName: 'Sakhir' },
      Sessions: [session(11, 'Day 1', '2026-02-11', '2026-02-13_Pre-Season_Testing'), session(12, 'Shakedown', '2026-02-12', '2026-02-13_Pre-Season_Testing')],
    },
    {
      Key: 2,
      Code: 'XXX',
      Number: 0,
      Location: 'Nowhere',
      OfficialName: 'Exhibition 2026',
      Name: 'Exhibition Grand Prix',
      Country: { Key: 2, Code: 'XXX', Name: 'Nowhere' },
      Circuit: { Key: 2, ShortName: 'Nowhere' },
      Sessions: [session(21, 'Race', '2026-03-01', '2026-03-01_Exhibition_Grand_Prix')],
    },
  ],
};

function archive(patch: Partial<Record<keyof ArchiveClient, unknown>> = {}) {
  return {
    index: async () => ({ Years: [{ Year: 2026, Path: '2026/' }] }),
    streamingStatus: async () => 'Offline',
    latestSession: async () => ({}),
    season: async () => SEASON,
    sessionFeeds: async () => ({ Feeds: {} }),
    ...patch,
  } as unknown as ArchiveClient;
}

function mount(source: ArchiveClient, props: { onPick?: (pick: unknown) => void; onQuit?: () => void; now?: number } = {}) {
  return render(
    <PickerView
      archive={source}
      token={undefined}
      onPick={props.onPick ?? (() => undefined)}
      onQuit={props.onQuit ?? (() => undefined)}
      {...(props.now === undefined ? {} : { now: props.now })}
    />,
  );
}

beforeEach(() => {
  clearSessionChecks();
});

describe('PickerView', () => {
  it('offers the live session first and opens it', async () => {
    const onPick = vi.fn();
    const live = archive({
      streamingStatus: async () => 'Available',
      latestSession: async () => ({ Meeting: { Name: 'Singapore Grand Prix' }, Name: 'Race' }),
    });
    const { stdin, lastFrame, unmount } = mount(live, { onPick, now: NOW });
    await eventually(() => expect(lastFrame()).toContain('● LIVE NOW   Singapore Grand Prix · Race'));
    stdin.write(KEY.enter);
    await eventually(() => expect(onPick).toHaveBeenCalledWith({ kind: 'live' }));
    // Below the live row, the meetings: the first is the Exhibition race.
    await eventually(() => expect(lastFrame()).toContain('Exhibition Grand Prix'));
    stdin.write('x'); // not a picker key
    stdin.write(KEY.down);
    await settle();
    stdin.write(KEY.enter);
    await eventually(() => expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Exhibition Grand Prix · Race' })));
    unmount();
  });

  it('labels testing and unnumbered meetings, shortens session names, and steps between sessions', async () => {
    const onPick = vi.fn();
    const { stdin, lastFrame, unmount } = mount(archive(), { onPick, now: NOW });
    await eventually(() => expect(lastFrame()).toMatch(/ {4} Exhibition Grand Prix[\s\S]*T {4}Pre-Season Testing/));
    expect(lastFrame()).toContain(' D1 ');
    expect(lastFrame()).toMatch(/ D1 {2}Shakedown/); // a name with no short form stays as it is

    stdin.write(KEY.down);
    await settle();
    stdin.write(KEY.down); // already at the last meeting
    await settle();
    stdin.write(KEY.right);
    await settle();
    stdin.write(KEY.left);
    await settle();
    stdin.write(KEY.left); // already at the first session
    await settle();
    stdin.write(KEY.up);
    await settle();
    stdin.write(KEY.down);
    await eventually(() => expect(lastFrame()).toContain('[D1]'));
    stdin.write(KEY.enter);
    await eventually(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pre-Season Testing · Day 1' })));
    unmount();
  });

  it('shows the archive check in progress, and does nothing for a meeting with no session to open', async () => {
    const onPick = vi.fn();
    let answer: () => void = () => undefined;
    const slow = archive({
      sessionFeeds: (path: string) =>
        path.includes('Race') ? Promise.reject(new ArchiveNotFoundError(path, 403)) : new Promise((resolve) => (answer = () => resolve({ Feeds: {} }))),
    });
    const { stdin, lastFrame, unmount } = mount(slow, { onPick, now: NOW });
    await eventually(() => expect(lastFrame()).toMatch(/checking the archive 1\/3/));
    // The Exhibition race is missing, so its meeting has nothing to open.
    await eventually(() => expect(lastFrame()).toContain("not in F1's archive"));
    stdin.write(KEY.enter);
    await settle();
    expect(onPick).not.toHaveBeenCalled();
    answer();
    unmount();
  });

  it('quits with q or escape, and opens nothing in an empty season', async () => {
    const onQuit = vi.fn();
    const onPick = vi.fn();
    const empty = archive({ season: async () => ({ Year: 2026, Meetings: [] }) });
    const { stdin, lastFrame, unmount } = mount(empty, { onPick, onQuit, now: NOW });
    await eventually(() => expect(lastFrame()).toContain('No timing archive for 2026.'));
    stdin.write(KEY.enter);
    stdin.write('q');
    stdin.write(KEY.escape);
    await eventually(() => expect(onQuit).toHaveBeenCalledTimes(2));
    expect(onPick).not.toHaveBeenCalled();
    unmount();
  });

  it('copes with no index, no live info and a season that fails to load', async () => {
    const broken = archive({
      index: async () => Promise.reject(new Error('offline')),
      streamingStatus: async () => Promise.reject(new Error('offline')),
      season: async () => Promise.reject(new ArchiveHttpError('https://example/2026/Index.json', 500)),
    });
    const { lastFrame, unmount } = mount(broken);
    await eventually(() => expect(lastFrame()).toMatch(/Could not load \d{4}:/));
    expect(lastFrame()).not.toContain('LIVE NOW');
    unmount();
  });

  it('ignores a season that answers after the user moved on', async () => {
    let finish2025: (index: SeasonIndex) => void = () => undefined;
    let fail2024: (error: Error) => void = () => undefined;
    const seasons = archive({
      index: async () => ({ Years: [{ Year: 2026, Path: '2026/' }] }),
      season: (year: number) =>
        year === 2025
          ? new Promise((resolve) => (finish2025 = resolve))
          : year === 2024
            ? new Promise((_, reject) => (fail2024 = reject))
            : Promise.resolve(SEASON),
    });
    const { stdin, lastFrame, unmount } = mount(seasons, { now: NOW });
    await eventually(() => expect(lastFrame()).toContain('Exhibition Grand Prix'));
    stdin.write('[');
    await eventually(() => expect(lastFrame()).toContain('◀ 2025 ▶'));
    stdin.write('[');
    await eventually(() => expect(lastFrame()).toContain('◀ 2024 ▶'));
    stdin.write(']');
    await eventually(() => expect(lastFrame()).toContain('◀ 2025 ▶'));
    stdin.write(']');
    await eventually(() => expect(lastFrame()).toContain('Exhibition Grand Prix'));
    // Both stale answers arrive now and change nothing.
    finish2025({ Year: 2025, Meetings: [] });
    fail2024(new Error('late'));
    await settle();
    expect(lastFrame()).toContain('Exhibition Grand Prix');
    expect(lastFrame()).not.toContain('Could not load');
    unmount();
  });
});

describe('tokenLine', () => {
  it('describes each token state', () => {
    expect(tokenLine(undefined)).toContain('no token');
    expect(tokenLine({ token: undefined, source: 'none', state: 'none', expiresAt: undefined })).toContain('no token');
    expect(tokenLine({ token: undefined, source: 'cache', state: 'expired', expiresAt: 1 })).toBe('⚠ token expired: run exf1lt login');
    expect(tokenLine({ token: 'x', source: 'env', state: 'valid', expiresAt: undefined })).toBe('🔑 token from env');
    expect(tokenLine({ token: 'x', source: 'cache', state: 'valid', expiresAt: Date.parse('2026-10-20T00:00:00Z') })).toBe(
      '🔑 token valid until 2026-10-20',
    );
  });
});
