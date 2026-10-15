import { Box, Text } from 'ink';
import { useMemo } from 'react';

import { MARKER_STYLES } from '../format/colors.js';
import { clockTime, parseGmtOffset } from '../format/time.js';
import { lapStarts, sessionStartTime, statusMarkers } from '../state/laps.js';
import { useSession, useTopic } from '../state/SessionContext.js';
import type { Playback } from '../state/usePlayback.js';

/** Width of `▶ 1×   HH:MM:SS L34 │` before the bar starts. */
const MARKER_INDENT = 21;

/** Replay transport: position bar with SC / VSC / red flag markers. */
export function Scrubber({ playback, width }: { playback: Playback; width: number }) {
  const session = useSession();
  const { timeline, cursor } = session;
  const info = useTopic('SessionInfo');
  const lap = useTopic('LapCount');
  const size = timeline.size;
  // Recomputed only when messages arrive, not on every frame.
  const { from, markers, laps } = useMemo(
    () => ({ from: sessionStartTime(timeline), markers: statusMarkers(timeline), laps: lapStarts(timeline) }),
    [timeline, size],
  );
  const to = timeline.last ?? from;
  const barWidth = Math.max(10, width - 32);
  const at = (utc: number) => Math.round(((utc - from) / Math.max(1, to - from)) * (barWidth - 1));
  const knob = Math.min(barWidth - 1, Math.max(0, at(cursor.time)));

  const markerLine = Array.from({ length: barWidth }, () => ' ');
  const markerColors: (string | undefined)[] = Array.from({ length: barWidth }, () => undefined);
  for (const marker of markers) {
    const index = at(marker.utc);
    if (index < 0 || index >= barWidth) continue;
    markerLine[index] = MARKER_STYLES[marker.kind].char;
    markerColors[index] = MARKER_STYLES[marker.kind].color;
  }
  const lastLap = laps[laps.length - 1]?.lap ?? lap?.TotalLaps;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate">
        <Text color="#3d9be9">{playback.playing ? '▶' : '❚❚'} </Text>
        <Text>{`${playback.speed}×`.padEnd(4)} </Text>
        <Text>{clockTime(cursor.time, parseGmtOffset(info?.GmtOffset))} </Text>
        <Text bold>{`L${lap?.CurrentLap ?? '–'}`.padEnd(4)}</Text>
        <Text>│</Text>
        <Text color="#e10600">{'━'.repeat(knob)}</Text>
        <Text bold>●</Text>
        <Text dimColor>{'─'.repeat(barWidth - knob - 1)}</Text>
        <Text>│ L{lastLap ?? '–'}</Text>
      </Text>
      <Text wrap="truncate">
        {' '.repeat(MARKER_INDENT)}
        {markerLine.map((char, index) => (
          <Text key={index} {...(markerColors[index] ? { color: markerColors[index] } : {})}>
            {char}
          </Text>
        ))}
      </Text>
    </Box>
  );
}
