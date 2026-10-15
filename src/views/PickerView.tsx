import type { ArchiveClient } from '@exhumer/f1-live-timing';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { useEffect, useMemo, useState } from 'react';

import type { TvSchedule } from '../archive/f1tvSchedule.js';
import {
  type Availability,
  type CatalogMeeting,
  type CatalogSession,
  checkSessions,
  loadSeasonCatalog,
} from '../archive/seasonCatalog.js';
import type { TokenStatus } from '../auth/resolveToken.js';
import { KeyHints } from '../components/KeyHints.js';

export type PickResult =
  | { readonly kind: 'live' }
  | { readonly kind: 'replay'; readonly path: string; readonly title: string };

interface Props {
  readonly archive: Pick<ArchiveClient, 'index' | 'season' | 'sessionFeeds' | 'streamingStatus' | 'latestSession'>;
  /** Fills meetings the archive's index leaves out (see `loadSeasonCatalog`). */
  readonly schedule?: TvSchedule | undefined;
  readonly token: TokenStatus | undefined;
  readonly onPick: (pick: PickResult) => void;
  readonly onQuit: () => void;
  readonly now?: number;
}

interface LiveInfo {
  readonly title: string;
}

/** First season with a live timing archive (`/static/2017/Index.json` and earlier answer 403). */
export const FIRST_ARCHIVE_YEAR = 2018;

/**
 * Seasons to offer. `/static/Index.json` only lists the current season, but
 * every season since {@link FIRST_ARCHIVE_YEAR} is still in the archive, so
 * offer them all up to the newest one the index (or the clock) knows.
 */
export function seasonYears(indexYears: readonly number[], now: number): number[] {
  const newest = indexYears.length > 0 ? Math.max(...indexYears) : new Date(now).getUTCFullYear();
  const years = new Set(indexYears);
  for (let year = FIRST_ARCHIVE_YEAR; year <= newest; year += 1) years.add(year);
  return [...years].sort((a, b) => a - b);
}

/** Session picker: the live session (if streaming) and every archived session of a season. */
export function PickerView({ archive, schedule, token, onPick, onQuit, now = Date.now() }: Props) {
  const { columns, rows: height } = useWindowSize();
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | undefined>();
  const [season, setSeason] = useState<CatalogMeeting[] | undefined>();
  const [availability, setAvailability] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [live, setLive] = useState<LiveInfo | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [row, setRow] = useState(0);
  const [column, setColumn] = useState(0);

  useEffect(() => {
    const start = (indexYears: readonly number[]) => {
      const list = seasonYears(indexYears, now);
      setYears(list);
      setYear(list[list.length - 1]);
    };
    archive
      .index()
      .then((index) => start(index.Years.map((entry) => entry.Year)))
      // Without the index, still offer every season up to this year.
      .catch(() => start([]));
    Promise.all([archive.streamingStatus(), archive.latestSession()])
      .then(([status, info]) => {
        if (status === 'Available') setLive({ title: `${info.Meeting.Name} · ${info.Name}` });
      })
      .catch(() => undefined);
  }, [archive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (year === undefined) return;
    // Ignore a slow answer for a season the user has already moved past.
    const controller = new AbortController();
    setSeason(undefined);
    setError(undefined);
    loadSeasonCatalog(year, { archive, schedule }, now)
      .then((meetings) => {
        if (controller.signal.aborted) return;
        setSeason(meetings);
        if (meetings.length === 0) setError(`No timing archive for ${year}.`);
        const paths = meetings.flatMap((meeting) => meeting.sessions.filter((session) => session.startUtc <= now).map((session) => session.path));
        void checkSessions(
          archive,
          paths,
          (path, available) => setAvailability((current) => new Map(current).set(path, available)),
          { signal: controller.signal },
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(`Could not load ${year}: ${String(cause)}`);
      });
    return () => controller.abort();
  }, [archive, schedule, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusOf = (session: CatalogSession): Availability => {
    const answer = availability.get(session.path);
    return answer === undefined ? 'checking' : answer ? 'available' : 'missing';
  };
  // Started sessions that are not known to be missing from the archive.
  const playable = (meeting: CatalogMeeting) =>
    meeting.sessions.filter((session) => session.startUtc <= now && statusOf(session) !== 'missing');

  // Newest meeting first, keeping only meetings with at least one session started.
  const meetings = useMemo(
    () => [...(season ?? [])].filter((meeting) => meeting.sessions.some((session) => session.startUtc <= now)).reverse(),
    [season, now],
  );
  const rowCount = (live ? 1 : 0) + meetings.length;
  const meetingAt = (index: number): CatalogMeeting | undefined => meetings[index - (live ? 1 : 0)];

  const checkedCount = meetings.reduce((total, meeting) => total + meeting.sessions.filter((session) => availability.has(session.path)).length, 0);
  const sessionCount = meetings.reduce((total, meeting) => total + meeting.sessions.filter((session) => session.startUtc <= now).length, 0);

  useInput((input, key) => {
    if (input === 'q' || key.escape) onQuit();
    else if (key.upArrow) setRow((value) => Math.max(0, value - 1));
    else if (key.downArrow) setRow((value) => Math.min(rowCount - 1, value + 1));
    else if (key.leftArrow) setColumn((value) => Math.max(0, value - 1));
    else if (key.rightArrow) setColumn((value) => value + 1);
    else if ((input === '[' || input === ']') && year !== undefined) {
      const next = years[years.indexOf(year) + (input === '[' ? -1 : 1)];
      if (next !== undefined) {
        setYear(next);
        setRow(0);
        setColumn(0);
      }
    } else if (key.return) {
      if (live && row === 0) return onPick({ kind: 'live' });
      const meeting = meetingAt(row);
      if (!meeting) return;
      const sessions = playable(meeting);
      const session = sessions[Math.min(column, sessions.length - 1)];
      if (session) onPick({ kind: 'replay', path: session.path, title: `${meeting.name} · ${session.name}` });
    }
  });

  const listHeight = Math.max(3, height - 6);
  const start = Math.min(Math.max(0, row - Math.floor(listHeight / 2)), Math.max(0, rowCount - listHeight));

  return (
    <Box flexDirection="column" height={height}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text>
          <Text bold color="#e10600">eXF1LT</Text>
          <Text> ─ choose a session</Text>
        </Text>
        <Text>
          season <Text dimColor>◀</Text> <Text bold>{year ?? '…'}</Text> <Text dimColor>▶</Text>
        </Text>
      </Box>
      <Text dimColor>{'─'.repeat(columns)}</Text>
      <Box flexDirection="column" height={listHeight} paddingX={1}>
        {error ? <Text color="#e8002d">{error}</Text> : null}
        {!season && !error ? <Text dimColor>Loading season…</Text> : null}
        {Array.from({ length: Math.min(listHeight, rowCount) }, (_, offset) => {
          const index = start + offset;
          const selected = index === row;
          if (live && index === 0) {
            return (
              <Text key="live" inverse={selected}>
                <Text color="#e8002d">● LIVE NOW</Text>   {live.title}
              </Text>
            );
          }
          const meeting = meetingAt(index)!;
          const sessions = playable(meeting);
          const active = sessions[Math.min(column, sessions.length - 1)];
          const nothing = sessions.length === 0 && meeting.sessions.every((session) => statusOf(session) === 'missing');
          return (
            <Text key={meeting.key} wrap="truncate" dimColor={nothing}>
              <Text dimColor>{(meeting.testing ? 'T' : meeting.round ? `R${meeting.round}` : '').padEnd(4)}</Text>
              <Text bold={selected}> {meeting.name.padEnd(28).slice(0, 28)}</Text>
              <Text dimColor>{meeting.location.padEnd(16).slice(0, 16)}</Text>
              <Text>{selected ? '▸ ' : '  '}</Text>
              {meeting.sessions
                .filter((session) => session.startUtc <= now)
                .map((session) => {
                  const status = statusOf(session);
                  const isActive = selected && session === active;
                  const label = shortName(session.name);
                  return (
                    <Text key={session.path}>
                      <Text dimColor={status !== 'available'} strikethrough={status === 'missing'} inverse={isActive}>
                        {isActive ? `[${label}]` : ` ${label} `}
                      </Text>
                    </Text>
                  );
                })}
              {nothing ? <Text dimColor>  not in F1's archive</Text> : null}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>{'─'.repeat(columns)}</Text>
      <KeyHints
        hints={[
          ['↑↓', 'meeting'],
          ['←→', 'session'],
          ['[ ]', 'season'],
          ['⏎', 'open'],
          ['q', 'quit'],
        ]}
        right={
          season && checkedCount < sessionCount
            ? `checking the archive ${checkedCount}/${sessionCount}`
            : tokenLine(token)
        }
      />
    </Box>
  );
}

const SHORT_NAMES: Record<string, string> = {
  Practice: 'FP',
  'Practice 1': 'FP1',
  'Practice 2': 'FP2',
  'Practice 3': 'FP3',
  Qualifying: 'Q',
  'Sprint Qualifying': 'SQ',
  'Sprint Shootout': 'SQ',
  Sprint: 'S',
  Race: 'Race',
};

function shortName(name: string): string {
  return SHORT_NAMES[name] ?? name.replace(/^Day (\d+)$/, 'D$1');
}

export function tokenLine(token: TokenStatus | undefined): string {
  if (!token || token.state === 'none') return '🔑 no token: live timing only, no car data/positions';
  if (token.state === 'expired') return '⚠ token expired: refresh with --token-file <path>';
  if (!token.expiresAt) return `🔑 token from ${token.source}`;
  return `🔑 token valid until ${new Date(token.expiresAt).toISOString().slice(0, 10)}`;
}
