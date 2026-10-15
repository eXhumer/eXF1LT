import { type ArchiveClient, ArchiveNotFoundError, type SeasonMeeting, sessionStartUtc } from '@exhumer/f1-live-timing';

import type { TvMeeting, TvSchedule, TvSession } from './f1tvSchedule.js';

export interface CatalogSession {
  readonly name: string;
  readonly startUtc: number;
  /** Archive path, e.g. `2024/2024-03-02_Bahrain_Grand_Prix/2024-03-02_Race/`. */
  readonly path: string;
  /** Other folders the session may be filed under, tried in order when `path` is not in the archive. */
  readonly alternatives?: readonly string[];
}

export interface CatalogMeeting {
  readonly key: string;
  readonly round: number | undefined;
  readonly testing: boolean;
  readonly name: string;
  readonly location: string;
  readonly startUtc: number;
  readonly sessions: readonly CatalogSession[];
  /** `index`: the season's `Index.json`; `f1tv`: rebuilt from F1TV's schedule; `archive`: {@link ARCHIVE_EXTRAS}. */
  readonly source: 'index' | 'f1tv' | 'archive';
}

export interface CatalogDeps {
  /** `sessionFeeds` resolves sessions with {@link CatalogSession.alternatives}; without it `path` is kept. */
  readonly archive: Pick<ArchiveClient, 'season'> & Partial<Pick<ArchiveClient, 'sessionFeeds'>>;
  /** Fills meetings the index leaves out. Optional: without it only the index is used. */
  readonly schedule?: TvSchedule | undefined;
}

const TESTING = /test/i;

function fromIndex(meeting: SeasonMeeting): CatalogMeeting {
  // Indexes keep placeholders for moved sessions: `Key: -1`, no name, no path.
  const sessions = meeting.Sessions.filter((session) => session.Name && session.Key >= 0).map((session) => ({
    name: session.Name,
    startUtc: sessionStartUtc(session),
    path: session.Path,
  }));
  const testing = TESTING.test(meeting.Name) || sessions.some((session) => /^Day \d/.test(session.name));
  return {
    key: String(meeting.Key),
    round: !testing && meeting.Number > 0 ? meeting.Number : undefined,
    testing,
    name: meeting.Name,
    location: meeting.Location,
    startUtc: Math.min(...sessions.map((session) => session.startUtc)),
    sessions,
    source: 'index',
  };
}

const localDate = (utc: number, offsetMs: number) => new Date(utc + offsetMs).toISOString().slice(0, 10);
const folder = (text: string) => text.replaceAll(' ', '_');

/**
 * Archive paths for an F1TV meeting. The meeting folder is dated by its last
 * session (the race) and each session folder by its own start, both in the
 * circuit's local time, as `buildSessionPath` does for the index.
 */
export function fromSchedule(year: number, meeting: TvMeeting, sessions: readonly TvSession[]): CatalogMeeting {
  const last = sessions.reduce<TvSession | undefined>((latest, session) => (!latest || session.startUtc > latest.startUtc ? session : latest), undefined);
  const meetingFolder = last ? `${year}/${localDate(last.startUtc, last.offsetMs)}_${folder(meeting.name)}/` : '';
  return {
    key: meeting.key,
    round: meeting.round,
    testing: meeting.testing,
    name: meeting.name,
    location: meeting.location,
    startUtc: sessions[0]?.startUtc ?? meeting.startUtc,
    sessions: sessions.map((session) => {
      const dayFolder = `${meetingFolder}${localDate(session.startUtc, session.offsetMs)}_`;
      const day = /^Day (\d+)$/.exec(session.name)?.[1];
      // Testing days are filed as `Practice_N` up to 2024 and `Day_N` since 2025 (2020-21 have both).
      return day
        ? { name: session.name, startUtc: session.startUtc, path: `${dayFolder}Practice_${day}/`, alternatives: [`${dayFolder}Day_${day}/`] }
        : { name: session.name, startUtc: session.startUtc, path: `${dayFolder}${folder(session.name)}/` };
    }),
    source: 'f1tv',
  };
}

/**
 * Meetings that are in the archive but in neither its season index nor F1TV's
 * schedule, found by probing the archive (2026-10-15). Each day is still
 * checked like any other session.
 */
export const ARCHIVE_EXTRAS: readonly { readonly year: number; readonly name: string; readonly location: string; readonly days: readonly string[] }[] = [
  { year: 2020, name: 'Pre-Season Test 1', location: 'Barcelona', days: ['2020-02-19', '2020-02-20', '2020-02-21'] },
  { year: 2020, name: 'Pre-Season Test 2', location: 'Barcelona', days: ['2020-02-26', '2020-02-27', '2020-02-28'] },
];

function extraMeeting(extra: (typeof ARCHIVE_EXTRAS)[number]): CatalogMeeting {
  const meetingFolder = `${extra.year}/${extra.days.at(-1)}_${folder(extra.name)}/`;
  return {
    key: `archive:${meetingFolder}`,
    round: undefined,
    testing: true,
    name: extra.name,
    location: extra.location,
    startUtc: Date.parse(`${extra.days[0]}T00:00:00Z`),
    sessions: extra.days.map((date, index) => ({
      name: `Day ${index + 1}`,
      // Barcelona is UTC+1 in February; the time only orders the sessions.
      startUtc: Date.parse(`${date}T08:00:00Z`),
      path: `${meetingFolder}${date}_Practice_${index + 1}/`,
      alternatives: [`${meetingFolder}${date}_Day_${index + 1}/`],
    })),
    source: 'archive',
  };
}

/** Swap each session with alternatives for the first of its folders that is in the archive. */
async function resolveAlternatives(
  archive: Pick<ArchiveClient, 'sessionFeeds'>,
  meetings: readonly CatalogMeeting[],
): Promise<CatalogMeeting[]> {
  const candidates = meetings.flatMap((meeting) => meeting.sessions.flatMap((session) => (session.alternatives ? [session.path, ...session.alternatives] : [])));
  if (candidates.length === 0) return [...meetings];
  const available = new Set<string>();
  await checkSessions(archive, candidates, (path, ok) => {
    if (ok) available.add(path);
  });
  return meetings.map((meeting) => ({
    ...meeting,
    sessions: meeting.sessions.map((session) => {
      if (!session.alternatives) return session;
      const path = [session.path, ...session.alternatives].find((candidate) => available.has(candidate)) ?? session.path;
      return { name: session.name, startUtc: session.startUtc, path };
    }),
  }));
}

/**
 * Every meeting of a season, oldest first. The archive's own `Index.json` is
 * the source of truth, but it is incomplete: 2022 has none, 2024 lists only
 * rounds 10–24 and 2018 leaves out Australia. Meetings it leaves out are rebuilt
 * from F1TV's schedule, which shares the archive's meeting keys.
 *
 * Paths are not checked here: the archive also lacks sessions its index lists
 * (most of 2018), so callers check them with {@link checkSessions}.
 */
export async function loadSeasonCatalog(year: number, deps: CatalogDeps, now = Date.now()): Promise<CatalogMeeting[]> {
  const indexMeetings = await deps.archive.season(year).then(
    (season) => season.Meetings.map(fromIndex).filter((meeting) => meeting.sessions.length > 0),
    (error: unknown) => {
      if (error instanceof ArchiveNotFoundError) return [];
      throw error;
    },
  );
  const known = new Set(indexMeetings.map((meeting) => meeting.key));

  let extra: CatalogMeeting[] = [];
  if (deps.schedule) {
    const schedule = deps.schedule;
    const missing = await schedule.meetings(year).then(
      (meetings) => meetings.filter((meeting) => !known.has(meeting.key) && meeting.startUtc <= now),
      // F1TV is a fallback: without it the index alone still works.
      () => [],
    );
    extra = (
      await Promise.all(
        missing.map((meeting) =>
          schedule.sessions(meeting.key).then(
            (sessions) => fromSchedule(year, meeting, sessions),
            () => undefined,
          ),
        ),
      )
    ).filter((meeting): meeting is CatalogMeeting => meeting !== undefined && meeting.sessions.length > 0);
  }

  const listed = new Set([...indexMeetings, ...extra].flatMap((meeting) => meeting.sessions.map((session) => session.path.split('/').slice(0, 2).join('/'))));
  const extras = ARCHIVE_EXTRAS.filter((meeting) => meeting.year === year)
    .map(extraMeeting)
    .filter((meeting) => !listed.has(meeting.sessions[0]!.path.split('/').slice(0, 2).join('/')));

  const meetings = [...indexMeetings, ...extra, ...extras].sort((a, b) => a.startUtc - b.startUtc);
  return deps.archive.sessionFeeds ? resolveAlternatives(deps.archive as Pick<ArchiveClient, 'sessionFeeds'>, meetings) : meetings;
}

export type Availability = 'checking' | 'available' | 'missing';

const checked = new Map<string, Promise<boolean>>();

/**
 * Whether each session is in the archive (its `Index.json` loads), reported
 * one by one as answers arrive. Answers are cached for the process, and at
 * most `concurrency` requests run at once.
 */
export async function checkSessions(
  archive: Pick<ArchiveClient, 'sessionFeeds'>,
  paths: readonly string[],
  onResult: (path: string, available: boolean) => void,
  { concurrency = 8, signal }: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const queue = [...new Set(paths)];
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      if (signal?.aborted) return;
      let answer = checked.get(path);
      if (!answer) {
        answer = archive.sessionFeeds(path).then(
          () => true,
          (error: unknown) => {
            if (error instanceof ArchiveNotFoundError) return false;
            checked.delete(path!); // a network error is not an answer; ask again next time
            throw error;
          },
        );
        checked.set(path, answer);
      }
      const available = await answer.catch(() => undefined);
      if (available !== undefined && !signal?.aborted) onResult(path, available);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

/** For tests: forget cached answers. */
export function clearSessionChecks(): void {
  checked.clear();
}
