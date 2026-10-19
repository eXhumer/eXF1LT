import { Flag, isPlainObject, parseUtc, SessionStatusValue, type Timeline, TrackStatusCode } from '@exhumer/f1-live-timing';

/** Track conditions, least to most severe. */
export const TRACK_PERIOD_KINDS = ['yellow', 'double-yellow', 'vsc', 'sc', 'red'] as const;
export type TrackPeriodKind = (typeof TRACK_PERIOD_KINDS)[number];

/** A stretch of the session under one condition: the most severe one at the time. */
export interface TrackPeriod {
  readonly kind: TrackPeriodKind;
  readonly from: number;
  readonly to: number;
}

const severity = (kind: TrackPeriodKind | undefined) => (kind ? TRACK_PERIOD_KINDS.indexOf(kind) : -1);
const worst = (a: TrackPeriodKind | undefined, b: TrackPeriodKind | undefined) => (severity(a) >= severity(b) ? a : b);

const TRACK_STATUS_KINDS: Partial<Record<string, TrackPeriodKind>> = {
  [TrackStatusCode.Yellow]: 'yellow',
  [TrackStatusCode.SCDeployed]: 'sc',
  [TrackStatusCode.VSCDeployed]: 'vsc',
  [TrackStatusCode.VSCEnding]: 'vsc',
  [TrackStatusCode.Red]: 'red',
};

/** The messages in a `RaceControlMessages` update, which F1 sends as an array or as an index-keyed patch. */
function raceControlMessages(data: unknown): Record<string, unknown>[] {
  const messages = isPlainObject(data) ? data['Messages'] : undefined;
  const list = Array.isArray(messages) ? messages : isPlainObject(messages) ? Object.values(messages) : [];
  return list.filter(isPlainObject);
}

/**
 * Yellow, double yellow, VSC, SC and red periods, closing an open one at
 * `end`. `TrackStatus` has one code for any yellow, so single and double
 * yellows come from race control's sector flags (`DOUBLE YELLOW IN TRACK
 * SECTOR 14` until `CLEAR IN TRACK SECTOR 14`); `TrackStatus` gives SC, VSC
 * and red, and a yellow when race control said nothing. "All clear" and a
 * track-wide clear, green or chequered flag lift every sector flag, so a
 * missed sector clear cannot leave a yellow behind.
 */
export function trackPeriods(timeline: Timeline, end: number): TrackPeriod[] {
  const periods: TrackPeriod[] = [];
  const sectors = new Map<number, TrackPeriodKind>();
  let track: TrackPeriodKind | undefined;
  let open: { kind: TrackPeriodKind; from: number } | undefined;

  const update = (utc: number) => {
    let kind = track;
    for (const flag of sectors.values()) kind = worst(kind, flag);
    if (open?.kind === kind) return;
    if (open && utc > open.from) {
      const last = periods.at(-1);
      // A condition that only flickered off for an instant is one period.
      if (last && last.kind === open.kind && last.to === open.from) periods[periods.length - 1] = { ...last, to: utc };
      else periods.push({ ...open, to: utc });
    }
    open = kind ? { kind, from: utc } : undefined;
  };

  for (const message of timeline.messages()) {
    if (message.topic === 'TrackStatus' && isPlainObject(message.data)) {
      const status = message.data['Status'];
      if (typeof status !== 'string') continue;
      track = TRACK_STATUS_KINDS[status];
      if (status === TrackStatusCode.AllClear) sectors.clear();
      update(message.utc);
    } else if (message.topic === 'RaceControlMessages') {
      for (const rcm of raceControlMessages(message.data)) {
        const flag = rcm['Flag'];
        const sector = rcm['Sector'];
        if (rcm['Scope'] === 'Sector' && typeof sector === 'number') {
          if (flag === Flag.DoubleYellow) sectors.set(sector, 'double-yellow');
          else if (flag === Flag.Yellow) sectors.set(sector, 'yellow');
          else if (flag === Flag.Clear || flag === Flag.Green) sectors.delete(sector);
        } else if (rcm['Scope'] === 'Track' && (flag === Flag.Clear || flag === Flag.Green || flag === Flag.Chequered)) {
          sectors.clear();
        }
      }
      update(message.utc);
    }
  }
  if (open) periods.push({ ...open, to: Math.max(end, open.from) });
  return periods;
}

/** A part of qualifying: Q1–Q3, or SQ1–SQ3 in sprint qualifying. */
export interface SessionPart {
  readonly part: number;
  readonly label: string;
  readonly from: number;
  readonly to: number;
}

/** How long before its counter a part's "Started" may come and still belong to it. */
const PART_LEAD_MS = 60_000;

/**
 * The parts of a qualifying session, or none for other sessions. F1 numbers
 * the parts in `SessionData` (`QualifyingPart`) and `TimingData`
 * (`SessionPart`), but not always exactly when they start, so a part starts at
 * the first `SessionStatus` "Started" from shortly before its number appears
 * (a red flag restart later in the part is not a new part), and ends at the
 * next "Finished", or where the next part starts.
 */
export function sessionParts(timeline: Timeline, end: number): SessionPart[] {
  const counters = new Map<number, number>();
  const starts: number[] = [];
  const finishes: number[] = [];
  const note = (part: unknown, utc: number) => {
    if (typeof part !== 'number' || part <= 0) return;
    const seen = counters.get(part);
    if (seen === undefined || utc < seen) counters.set(part, utc);
  };
  for (const message of timeline.messages()) {
    const data = message.data;
    if (!isPlainObject(data)) continue;
    if (message.topic === 'SessionData') {
      const series = data['Series'];
      const entries = Array.isArray(series) ? series : isPlainObject(series) ? Object.values(series) : [];
      for (const entry of entries) {
        if (isPlainObject(entry)) note(entry['QualifyingPart'], typeof entry['Utc'] === 'string' ? parseUtc(entry['Utc']) : message.utc);
      }
    } else if (message.topic === 'TimingData') {
      note(data['SessionPart'], message.utc);
    } else if (message.topic === 'SessionStatus') {
      const status = data['Status'];
      if (status === SessionStatusValue.Started) starts.push(message.utc);
      else if (status === SessionStatusValue.Finished || status === SessionStatusValue.Finalised || status === SessionStatusValue.Ends) {
        finishes.push(message.utc);
      }
    }
  }
  if (counters.size === 0) return [];

  const name = (timeline.latest()['SessionInfo'] as { Name?: string } | undefined)?.Name ?? '';
  const prefix = /sprint/i.test(name) ? 'SQ' : 'Q';
  const ordered = [...counters.entries()].sort((a, b) => a[0] - b[0]);
  const froms: number[] = [];
  for (const [index, [, counted]] of ordered.entries()) {
    const after = froms[index - 1] ?? -Infinity;
    const next = ordered[index + 1]?.[1] ?? Infinity;
    const started = starts.find((utc) => utc > after && utc >= counted - PART_LEAD_MS && utc < next);
    froms.push(Math.max(started ?? counted, after));
  }
  return ordered.map(([part], index) => {
    const from = froms[index]!;
    const next = froms[index + 1] ?? Infinity;
    const finished = finishes.find((utc) => utc > from && utc <= next);
    return { part, label: `${prefix}${part}`, from, to: finished ?? Math.min(next, Math.max(end, from)) };
  });
}
