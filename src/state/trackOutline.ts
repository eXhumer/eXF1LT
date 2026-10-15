import type { PositionSample, Timeline } from '@exhumer/f1-live-timing';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A lap is at least this long; shorter loops are a car sitting still or crawling in the pits. */
const MIN_LAP_MS = 40_000;
/** Give up on a candidate lap after this long without returning to the start. */
const MAX_LAP_MS = 240_000;
/** A gap in samples longer than this breaks a lap (garage, red flag, lost signal). */
const MAX_GAP_MS = 5_000;
/** Try a new lap start this often along each car's samples. */
const START_STEP_MS = 15_000;
/** The lap closes when the car is back within this fraction of the circuit's size. */
const CLOSE_FRACTION = 0.02;
/** Retry a failed search at most this often while a live session grows. */
const RETRY_MS = 5_000;

function onTrack(sample: PositionSample): boolean {
  return sample.status === 'OnTrack' && (sample.x !== 0 || sample.y !== 0);
}

function span(samples: readonly Point[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of samples) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

/**
 * Find one complete lap in a car's position samples: a stretch on track,
 * without gaps, that leaves its start point, goes around and comes back to it.
 * Returns the `[from, to]` UTC range of the lap.
 */
export function findLap(samples: readonly PositionSample[]): [number, number] | undefined {
  const track = samples.filter(onTrack);
  if (track.length < 2) return undefined;
  const size = span(track);
  if (size === 0) return undefined;
  const closeDistance = size * CLOSE_FRACTION;
  const awayDistance = size * 0.25;

  let nextStart = track[0]!.utc;
  for (let start = 0; start < track.length; start += 1) {
    const origin = track[start]!;
    if (origin.utc < nextStart) continue;
    nextStart = origin.utc + START_STEP_MS;

    let wentAway = false;
    for (let index = start + 1; index < track.length; index += 1) {
      const sample = track[index]!;
      if (sample.utc - track[index - 1]!.utc > MAX_GAP_MS) break;
      const elapsed = sample.utc - origin.utc;
      if (elapsed > MAX_LAP_MS) break;
      const distance = Math.hypot(sample.x - origin.x, sample.y - origin.y);
      if (distance > awayDistance) wentAway = true;
      if (wentAway && elapsed >= MIN_LAP_MS && distance <= closeDistance) return [origin.utc, sample.utc];
    }
  }
  return undefined;
}

/**
 * The circuit outline: one complete lap of whichever car has the most
 * position samples and a clean lap, read back with `positionRange`.
 */
export function extractOutline(timeline: Timeline): Point[] | undefined {
  const { telemetry } = timeline;
  const drivers = telemetry
    .positionDrivers()
    .map((driver) => ({ driver, samples: telemetry.position(driver) }))
    .sort((a, b) => b.samples.length - a.samples.length);
  for (const { driver, samples } of drivers) {
    const lap = findLap(samples);
    if (!lap) continue;
    return telemetry
      .positionRange(driver, lap[0], lap[1])
      .filter(onTrack)
      .map(({ x, y }) => ({ x, y }));
  }
  return undefined;
}

interface CacheEntry {
  outline: Point[] | undefined;
  size: number;
  attemptedAt: number;
}

const cache = new WeakMap<Timeline, CacheEntry>();

/**
 * {@link extractOutline}, memoised per timeline. Once found the outline is
 * kept; until then (a live session before a full lap) the search runs again
 * when new messages arrived, at most every few seconds.
 */
export function trackOutline(timeline: Timeline, now = Date.now()): Point[] | undefined {
  const entry = cache.get(timeline);
  if (entry?.outline) return entry.outline;
  if (entry && (entry.size === timeline.size || now - entry.attemptedAt < RETRY_MS)) return undefined;
  const outline = extractOutline(timeline);
  cache.set(timeline, { outline, size: timeline.size, attemptedAt: now });
  return outline;
}
