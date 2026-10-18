import type { TimingRow } from './timingRows.js';

/** One pit stop. Archived sessions carry the times; the live feed only tells us how many laps came before. */
export interface PitStop {
  /** Lap the car came in on. */
  readonly lap: number | undefined;
  /** Time stationary, as F1 prints it (`2.5`). */
  readonly stationary: string | undefined;
  /** Pit entry to pit exit (`24.048`). */
  readonly lane: string | undefined;
}

export interface PitRow extends TimingRow {
  readonly stops: readonly PitStop[];
}

export interface PitStopTable {
  readonly rows: readonly PitRow[];
  /** Fastest stationary time of the session, in seconds, with the driver who set it. */
  readonly fastest: { readonly seconds: number; readonly tla: string } | undefined;
  /** Whether the times come from `PitStopSeries` (archive) rather than being rebuilt from the tyre stints. */
  readonly timed: boolean;
}

/** Seconds in a stationary or lane time such as `2.5` or `24.048`; `undefined` when it is not a number. */
export function seconds(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

/**
 * The stops of every driver in a `PitStopSeries` state, oldest first.
 * F1 sends each driver's stops as a list, or as an object keyed by index once
 * a later stop has been patched in; both are accepted. Anything else is skipped.
 */
export function parsePitStopSeries(value: unknown): Map<string, PitStop[]> | undefined {
  if (!isObject(value) || !isObject(value['PitTimes'])) return undefined;
  const result = new Map<string, PitStop[]>();
  for (const [number, entries] of Object.entries(value['PitTimes'])) {
    const list = Array.isArray(entries)
      ? entries
      : isObject(entries)
        ? Object.entries(entries)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([, entry]) => entry)
        : [];
    const stops = list
      .filter(isObject)
      .map((entry) => ({ timestamp: text(entry['Timestamp']) ?? '', stop: entry['PitStop'] }))
      .filter((entry): entry is { timestamp: string; stop: Record<string, unknown> } => isObject(entry.stop))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(({ stop }): PitStop => {
        const lap = Number(text(stop['Lap']));
        return {
          lap: Number.isFinite(lap) && lap > 0 ? lap : undefined,
          stationary: text(stop['PitStopTime']),
          lane: text(stop['PitLaneTime']),
        };
      });
    result.set(number, stops);
  }
  return result;
}

/** Stops rebuilt from the tyre stints: one per stint change, on the lap the earlier stint ended. */
function stopsFromStints(row: TimingRow): PitStop[] {
  let lap = 0;
  return row.previousStints.map((stint) => {
    lap += stint.laps;
    return { lap: lap > 0 ? lap : undefined, stationary: undefined, lane: undefined };
  });
}

/** Every driver's stops, in running order, and the fastest stationary time. */
export function buildPitStops(rows: readonly TimingRow[], series: unknown): PitStopTable {
  const parsed = parsePitStopSeries(series);
  const pitRows = rows.map(
    (row): PitRow => ({ ...row, stops: parsed ? (parsed.get(row.number) ?? []) : stopsFromStints(row) }),
  );
  let fastest: PitStopTable['fastest'];
  for (const row of pitRows) {
    for (const stop of row.stops) {
      const time = seconds(stop.stationary);
      if (time !== undefined && (!fastest || time < fastest.seconds)) fastest = { seconds: time, tla: row.tla };
    }
  }
  return { rows: pitRows, fastest, timed: parsed !== undefined };
}

/** A driver's quickest stationary time in seconds. */
export function bestStop(stops: readonly PitStop[]): number | undefined {
  const times = stops.map((stop) => seconds(stop.stationary)).filter((time): time is number => time !== undefined);
  return times.length > 0 ? Math.min(...times) : undefined;
}
