import { Box, Text } from 'ink';
import { useMemo } from 'react';

import { PERIOD_STYLES } from '../format/colors.js';
import { clockTime, parseGmtOffset } from '../format/time.js';
import { lapStarts, sessionStartTime } from '../state/laps.js';
import { sessionParts, TRACK_PERIOD_KINDS, type TrackPeriodKind, trackPeriods } from '../state/periods.js';
import { useSession, useTopic } from '../state/SessionContext.js';
import type { Playback } from '../state/usePlayback.js';

/** One character of the bar and how it is drawn. */
interface Cell {
  readonly char: string;
  readonly color?: string;
  readonly dim?: boolean;
  readonly bold?: boolean;
}

const sameStyle = (a: Cell, b: Cell) => a.color === b.color && a.dim === b.dim && a.bold === b.bold;

/**
 * Replay transport: one position bar that also shows the track conditions
 * (yellow, double yellow, VSC, SC, red) along it and labels the qualifying
 * parts (Q1–Q3, SQ1–SQ3) where they start. Ahead of the playhead everything
 * is dimmed, so the bar still reads as played and unplayed.
 */
export function Scrubber({ playback, width }: { playback: Playback; width: number }) {
  const session = useSession();
  const { timeline, cursor } = session;
  const info = useTopic('SessionInfo');
  const lap = useTopic('LapCount');
  const size = timeline.size;
  // Recomputed only when messages arrive, not on every frame.
  const { from, periods, parts, laps } = useMemo(() => {
    const end = timeline.last ?? 0;
    return { from: sessionStartTime(timeline), periods: trackPeriods(timeline, end), parts: sessionParts(timeline, end), laps: lapStarts(timeline) };
  }, [timeline, size]);
  const to = timeline.last ?? from;
  const barWidth = Math.max(10, width - 32);
  const at = (utc: number) => Math.round(((utc - from) / Math.max(1, to - from)) * (barWidth - 1));
  const knob = Math.min(barWidth - 1, Math.max(0, at(cursor.time)));

  // Each cell shows the worst condition in its stretch of time.
  const kinds: (TrackPeriodKind | undefined)[] = Array.from({ length: barWidth }, () => undefined);
  const rank = (kind: TrackPeriodKind | undefined) => (kind ? TRACK_PERIOD_KINDS.indexOf(kind) : -1);
  for (const period of periods) {
    for (let index = Math.max(0, at(period.from)); index <= Math.min(barWidth - 1, at(period.to)); index++) {
      if (rank(period.kind) > rank(kinds[index])) kinds[index] = period.kind;
    }
  }
  const cells: Cell[] = kinds.map((kind, index) => {
    const played = index < knob;
    if (kind) return { char: PERIOD_STYLES[kind].char, color: PERIOD_STYLES[kind].color, dim: !played };
    return played ? { char: '━', color: '#e10600' } : { char: '─', dim: true };
  });
  for (const part of parts) {
    const start = Math.min(Math.max(0, at(part.from)), barWidth - part.label.length);
    for (const [offset, char] of [...part.label].entries()) cells[start + offset] = { char, bold: true };
  }
  cells[knob] = { char: '●', bold: true };

  // Runs of equally styled cells, so the line is a handful of <Text>s rather than one per cell.
  const runs: Cell[] = [];
  for (const cell of cells) {
    const last = runs.at(-1);
    if (last && sameStyle(last, cell)) runs[runs.length - 1] = { ...last, char: last.char + cell.char };
    else runs.push(cell);
  }
  const lastLap = laps[laps.length - 1]?.lap ?? lap?.TotalLaps;

  return (
    <Box paddingX={1}>
      <Text wrap="truncate">
        <Text color="#3d9be9">{playback.playing ? '▶' : '❚❚'} </Text>
        <Text>{`${playback.speed}×`.padEnd(4)} </Text>
        <Text>{clockTime(cursor.time, parseGmtOffset(info?.GmtOffset))} </Text>
        <Text bold>{`L${lap?.CurrentLap ?? '–'}`.padEnd(4)}</Text>
        <Text>│</Text>
        {runs.map((run, index) => (
          <Text key={index} {...(run.color ? { color: run.color } : {})} dimColor={run.dim ?? false} bold={run.bold ?? false}>
            {run.char}
          </Text>
        ))}
        <Text>│ L{lastLap ?? '–'}</Text>
      </Text>
    </Box>
  );
}
