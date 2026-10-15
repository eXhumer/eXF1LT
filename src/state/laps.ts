import { isPlainObject, type Timeline, TrackStatusCode } from '@exhumer/f1-live-timing';

/** Start a replay this long before the session goes green. */
const PRE_START_MS = 60_000;

/** Where to park a replay: a minute before `SessionStatus` first says `Started`. */
export function sessionStartTime(timeline: Timeline): number {
  for (const message of timeline.messages()) {
    if (message.topic === 'SessionStatus' && isPlainObject(message.data) && message.data['Status'] === 'Started') {
      return Math.max(message.utc - PRE_START_MS, timeline.first ?? message.utc);
    }
  }
  return timeline.first ?? 0;
}

/** UTC instant each lap began, from `LapCount` updates. Index 0 is lap 1. */
export function lapStarts(timeline: Timeline): { lap: number; utc: number }[] {
  const laps: { lap: number; utc: number }[] = [];
  let current = 0;
  for (const message of timeline.messages()) {
    if (message.topic !== 'LapCount' || !isPlainObject(message.data)) continue;
    const lap = message.data['CurrentLap'];
    if (typeof lap === 'number' && lap > current) {
      laps.push({ lap, utc: message.utc });
      current = lap;
    }
  }
  return laps;
}

/** Time to seek to for `lap`, or `undefined` if the lap has not started. */
export function lapStart(timeline: Timeline, lap: number): number | undefined {
  return lapStarts(timeline).find((entry) => entry.lap === lap)?.utc;
}

export type MarkerKind = 'yellow' | 'sc' | 'vsc' | 'red';

export interface StatusMarker {
  readonly utc: number;
  readonly kind: MarkerKind;
}

const MARKER_KINDS: Partial<Record<string, MarkerKind>> = {
  [TrackStatusCode.SCDeployed]: 'sc',
  [TrackStatusCode.VSCDeployed]: 'vsc',
  [TrackStatusCode.Red]: 'red',
};

/** Safety car, VSC and red flag periods from `TrackStatus` updates. */
export function statusMarkers(timeline: Timeline): StatusMarker[] {
  const markers: StatusMarker[] = [];
  let previous: string | undefined;
  for (const message of timeline.messages()) {
    if (message.topic !== 'TrackStatus' || !isPlainObject(message.data)) continue;
    const status = message.data['Status'];
    if (typeof status !== 'string' || status === previous) continue;
    previous = status;
    const kind = MARKER_KINDS[status];
    if (kind) markers.push({ utc: message.utc, kind });
  }
  return markers;
}
