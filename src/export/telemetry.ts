import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type DriverList, isPlainObject, type SessionInfo, type Timeline } from '@exhumer/f1-live-timing';

import { parseGmtOffset } from '../format/time.js';
import { type SessionPart, sessionParts, type TrackPeriod, trackPeriods } from '../state/periods.js';
import { renderTelemetryHtml } from './telemetryHtml.js';

/** File names list the drivers up to this many, then just count them. */
const NAMED_DRIVERS = 4;

/** A lap the driver completed: when it ended, and its time when F1 sent one. */
export interface TelemetryLap {
  readonly lap: number;
  readonly end: number;
  readonly time: string | undefined;
}

/**
 * A lap in the report, in milliseconds after the report's origin. `start` is
 * the end minus the official lap time, so a lap's window is exactly as long as
 * its time; without a time it is the previous lap's end, and `undefined` when
 * neither is known (such a lap cannot be compared).
 */
export interface ReportLap {
  readonly lap: number;
  readonly start: number | undefined;
  readonly end: number;
  readonly time: string | undefined;
}

/**
 * One driver's series. Sample times are milliseconds after the report's
 * `origin` and the channels are columns, which keeps the embedded JSON small
 * for a two-hour race (~4 samples a second).
 */
export interface DriverSeries {
  readonly driver: { readonly number: string; readonly tla: string; readonly name: string; readonly team: string; readonly colour: string };
  readonly car: {
    readonly t: number[];
    readonly speed: number[];
    readonly rpm: number[];
    readonly gear: number[];
    readonly throttle: number[];
    readonly brake: number[];
    /** Absent from 2026 onwards, when F1 dropped the DRS channel. */
    readonly drs: number[] | undefined;
  };
  readonly position: { readonly t: number[]; readonly x: number[]; readonly y: number[] };
  readonly laps: ReportLap[];
}

/** Everything the report draws: one driver, or several to compare (the first is the reference). */
export interface TelemetryReport {
  readonly session: { readonly meeting: string; readonly name: string; readonly offsetMs: number };
  /** UTC of t = 0: the earliest car or position sample of any driver in the report. */
  readonly origin: number;
  readonly drivers: DriverSeries[];
  /** Yellow, double yellow, VSC, SC and red periods, in milliseconds after `origin`. */
  readonly status: TrackPeriod[];
  /** Qualifying parts (Q1–Q3 or SQ1–SQ3), in milliseconds after `origin`; empty for other sessions. */
  readonly parts: SessionPart[];
}

export class TelemetryExportError extends Error {
  override name = 'TelemetryExportError';
}

/** A racing number from a number or a three-letter code (`4`, `nor`), or `undefined` when nobody matches. */
export function resolveDriver(timeline: Timeline, query: string): string | undefined {
  const wanted = query.trim().toUpperCase();
  const drivers = (timeline.latest()['DriverList'] ?? {}) as Partial<DriverList>;
  for (const [number, driver] of Object.entries(drivers)) {
    if (number === wanted || driver?.Tla?.toUpperCase() === wanted) return number;
  }
  return timeline.telemetry.drivers().includes(wanted) ? wanted : undefined;
}

/** `1:35.412` or `59.876` → milliseconds, or `undefined` for anything else. */
export function parseLapTime(value: string | undefined): number | undefined {
  const match = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  return Math.round((Number(match[1] ?? 0) * 60 + Number(match[2])) * 1000);
}

/** Racing numbers of every driver in the session, in timing order (the leader first). */
export function sessionDrivers(timeline: Timeline): string[] {
  const state = timeline.latest();
  const list = (state['DriverList'] ?? {}) as Partial<DriverList>;
  const lines = (state['TimingData'] as { Lines?: Record<string, { Line?: number }> } | undefined)?.Lines ?? {};
  const numbers = new Set([...Object.keys(list), ...timeline.telemetry.drivers()]);
  const order = (number: string) => lines[number]?.Line ?? list[number]?.Line ?? Infinity;
  return [...numbers].sort((a, b) => order(a) - order(b) || Number(a) - Number(b));
}

/**
 * Collect the car data, positions and laps of the drivers (the first is the
 * reference) and the track status periods from a timeline. Drivers without
 * car data are left out and named in `skipped`; with none left it throws.
 */
export function collectTelemetry(timeline: Timeline, numbers: readonly string[]): TelemetryReport & { readonly skipped: string[] } {
  const unique = [...new Set(numbers)];
  if (unique.length === 0) throw new TelemetryExportError('No drivers to export.');
  const state = timeline.latest();
  const list = state['DriverList'] as Partial<DriverList> | undefined;
  const skipped: string[] = [];
  const raw = unique.flatMap((number) => {
    const entry = list?.[number];
    const tla = entry?.Tla ?? number;
    const car = timeline.telemetry.car(number);
    if (car.length === 0) {
      skipped.push(tla);
      return [];
    }
    const position = timeline.telemetry.position(number).filter((sample) => sample.x !== 0 || sample.y !== 0);
    return [{ number, entry, tla, car, position }];
  });
  if (raw.length === 0) {
    throw new TelemetryExportError(
      `No car telemetry for ${skipped.join(', ')}. Live CarData needs the subscription token (exf1lt login).`,
    );
  }

  const origin = Math.min(...raw.map(({ car, position }) => Math.min(car[0]!.utc, position[0]?.utc ?? Infinity)));
  const end = Math.max(...raw.map(({ car, position }) => Math.max(car.at(-1)!.utc, position.at(-1)?.utc ?? -Infinity)));
  const info = state['SessionInfo'] as Partial<SessionInfo> | undefined;

  return {
    skipped,
    session: {
      meeting: info?.Meeting?.Name ?? 'F1 session',
      name: info?.Name ?? '',
      offsetMs: parseGmtOffset(info?.GmtOffset),
    },
    origin,
    drivers: raw.map(({ number, entry, tla, car, position }) => ({
      driver: {
        number,
        tla,
        name: entry?.FullName || [entry?.FirstName, entry?.LastName].filter(Boolean).join(' ') || tla,
        team: entry?.TeamName ?? '',
        colour: entry?.TeamColour ? `#${entry.TeamColour}` : '#e10600',
      },
      car: {
        t: car.map((sample) => sample.utc - origin),
        speed: car.map((sample) => sample.speed),
        rpm: car.map((sample) => sample.rpm),
        gear: car.map((sample) => sample.gear),
        throttle: car.map((sample) => sample.throttle),
        brake: car.map((sample) => sample.brake),
        drs: car.some((sample) => sample.drs !== undefined) ? car.map((sample) => sample.drs ?? 0) : undefined,
      },
      position: {
        t: position.map((sample) => sample.utc - origin),
        x: position.map((sample) => Math.round(sample.x)),
        y: position.map((sample) => Math.round(sample.y)),
      },
      laps: reportLaps(driverLaps(timeline, number), origin),
    })),
    status: trackPeriods(timeline, end).map((period) => ({ ...period, from: period.from - origin, to: period.to - origin })),
    parts: sessionParts(timeline, end).map((part) => ({ ...part, from: part.from - origin, to: part.to - origin })),
  };
}

/** Laps relative to `origin`, each with the start its time gives it (see {@link ReportLap}). */
export function reportLaps(laps: readonly TelemetryLap[], origin: number): ReportLap[] {
  return laps.map((lap, index) => {
    const end = lap.end - origin;
    const time = parseLapTime(lap.time);
    const previous = laps[index - 1];
    const start =
      time !== undefined ? end - time : previous && previous.lap === lap.lap - 1 ? previous.end - origin : undefined;
    return { lap: lap.lap, start, end, time: lap.time };
  });
}

/**
 * The driver's completed laps, from `TimingData`: a lap ends when
 * `NumberOfLaps` goes up. Its `LastLapTime` comes in the same update or a
 * later one, so it is attached to the newest lap that has no time yet.
 * A jump of more than one lap is where the data starts (the live snapshot
 * says the driver is already on lap 20), not a lap that just ended.
 */
export function driverLaps(timeline: Timeline, number: string): TelemetryLap[] {
  const laps: { lap: number; end: number; time: string | undefined }[] = [];
  let completed = 0;
  for (const message of timeline.messages()) {
    if (message.topic !== 'TimingData' || !isPlainObject(message.data)) continue;
    const lines = message.data['Lines'];
    const line = isPlainObject(lines) ? lines[number] : undefined;
    if (!isPlainObject(line)) continue;
    const count = line['NumberOfLaps'];
    if (typeof count === 'number' && count > completed) {
      if (count === completed + 1) laps.push({ lap: count, end: message.utc, time: undefined });
      completed = count;
    }
    const last = line['LastLapTime'];
    const value = isPlainObject(last) ? last['Value'] : undefined;
    const newest = laps.at(-1);
    if (typeof value === 'string' && value !== '' && newest && newest.time === undefined) newest.time = value;
  }
  return laps;
}

/** `singapore-grand-prix-race-NOR-PIA-telemetry.html`, or `…-20-drivers-telemetry.html` for many. */
export function telemetryFileName(report: TelemetryReport): string {
  const slug = `${report.session.meeting} ${report.session.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const drivers =
    report.drivers.length > NAMED_DRIVERS
      ? `${report.drivers.length}-drivers`
      : report.drivers.map(({ driver }) => driver.tla.replace(/[^A-Za-z0-9]/g, '')).join('-');
  return `${slug || 'session'}-${drivers}-telemetry.html`;
}

export interface ExportResult {
  readonly file: string;
  /** Drivers left out for having no car data. */
  readonly skipped: string[];
}

/**
 * Write the telemetry report of one driver, or several to compare. `out` is a
 * file path, or a directory (anything without `.html`) to put the default
 * file name in.
 */
export async function exportTelemetry(timeline: Timeline, numbers: readonly string[], out = '.'): Promise<ExportResult> {
  const { skipped, ...report } = collectTelemetry(timeline, numbers);
  const file = out.toLowerCase().endsWith('.html') ? out : join(out, telemetryFileName(report));
  if (file !== out) await mkdir(out, { recursive: true });
  await writeFile(file, renderTelemetryHtml(report));
  return { file, skipped };
}
