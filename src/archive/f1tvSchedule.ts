import { F1TVClient } from '@exhumer/f1tv-api';

/** A meeting as F1TV's schedule lists it. */
export interface TvMeeting {
  /** Same key as `SessionInfo.Meeting.Key` in the live timing archive. */
  readonly key: string;
  readonly name: string;
  readonly location: string;
  readonly round: number | undefined;
  readonly testing: boolean;
  readonly startUtc: number;
}

/** A timed F1 session of a meeting, named as the archive folders name it. */
export interface TvSession {
  readonly name: string;
  readonly startUtc: number;
  /** The circuit's UTC offset in milliseconds; archive folders use local dates. */
  readonly offsetMs: number;
}

/** Where missing meetings come from. Injected so tests run without F1TV. */
export interface TvSchedule {
  meetings(year: number): Promise<TvMeeting[]>;
  sessions(meetingKey: string): Promise<TvSession[]>;
}

const SESSION_NAME = /^(Practice( [1-3])?|Qualifying|Sprint( Qualifying| Shootout)?|Race|Day \d+)$/i;

/**
 * The archive's name for an F1TV title, or `undefined` for shows and extras.
 * F1TV adds " Replay" after the event ("Race Replay") and splits testing days
 * into sessions ("Day 1, Session 2"), which the archive keeps as one "Day 1".
 */
export function archiveSessionName(title: string): string | undefined {
  const name = title.trim().replace(/ Replay$/i, '').replace(/^(Day \d+), Session \d+$/i, '$1');
  // Title case, as the folders use it: 2022 testing comes as "DAY 1, SESSION 1".
  return SESSION_NAME.test(name) ? name.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : undefined;
}

/** `+03:00` / `-04:00` at the end of an ISO time → milliseconds. */
export function utcOffset(time: string | undefined): number | undefined {
  const match = /([+-])(\d\d):(\d\d)$/.exec(time ?? '');
  if (!match) return undefined;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

type SearchResult = Awaited<ReturnType<F1TVClient['searchVod']>>;
type Container = SearchResult['resultObj']['containers'][number];

const SEARCH = { orderBy: 'meeting_End_Date', sortOrder: 'asc', filter_orderByFom: 'Y', maxResults: '100' } as const;

/** A broadcast of the session itself, not a show around it (F1_Live, F1_Archive packages). */
function isBroadcast(container: Container): boolean {
  return (container.platformVariants ?? []).some((variant) =>
    (variant.technicalPackages ?? []).some((pack) => /_(Live|Archive)$/.test(pack.packageName)),
  );
}

/**
 * F1TV's schedule, read the way eXViewer reads it: `searchVod` for a season's
 * meetings, then for a meeting's sessions. It needs no login. Sessions F1TV
 * keeps without dates (2018–2020) are left out.
 */
export function f1tvSchedule(create: () => Promise<Pick<F1TVClient, 'searchVod'>> = () => F1TVClient.create()): TvSchedule {
  let client: Promise<Pick<F1TVClient, 'searchVod'>> | undefined;
  const get = () => {
    client ??= create().catch((error: unknown) => {
      client = undefined;
      throw error;
    });
    return client;
  };
  return {
    async meetings(year) {
      const result = await (await get()).searchVod({ ...SEARCH, filter_objectSubtype: 'Meeting', filter_season: String(year) });
      return result.resultObj.containers
        .filter((container) => container.metadata.emfAttributes.Diplay_In_Schedule !== false)
        .map((container) => {
          const attributes = container.metadata.emfAttributes;
          const round = Number(attributes.Championship_Meeting_Ordinal);
          // The 2021 test is not flagged as one (IsTestEvent "false").
          const testing = attributes.IsTestEvent === 'true' || /\btest/i.test(attributes.Meeting_Name);
          return {
            key: String(attributes.MeetingKey),
            name: attributes.Meeting_Name,
            location: attributes.Circuit_Short_Name || attributes.Meeting_Location || attributes.Meeting_Country_Name,
            round: !testing && round > 0 ? round : undefined,
            testing,
            startUtc: Date.parse(attributes.Meeting_Start_Date),
          };
        });
    },
    async sessions(meetingKey) {
      const result = await (await get()).searchVod({ ...SEARCH, filter_MeetingKey: meetingKey });
      const sessions = new Map<string, TvSession>();
      for (const container of result.resultObj.containers) {
        const attributes = container.metadata.emfAttributes;
        if (attributes.VideoType !== 'meetingSession' || !isBroadcast(container)) continue;
        if (attributes.Series && attributes.Series.toUpperCase() !== 'FORMULA 1') continue;
        const name = archiveSessionName(container.metadata.titleBrief || container.metadata.title);
        const offsetMs = utcOffset(attributes.sessionEndTime);
        const startUtc = attributes.sessionStartDate;
        if (!name || offsetMs === undefined || !(startUtc > 0)) continue;
        // A testing day comes as two sessions; the archive has one folder from the first.
        const known = sessions.get(name.toLowerCase());
        if (!known || startUtc < known.startUtc) sessions.set(name.toLowerCase(), { name, startUtc, offsetMs });
      }
      return [...sessions.values()].sort((a, b) => a.startUtc - b.startUtc);
    },
  };
}
