import { Box, Text } from 'ink';
import { type ReactNode, useMemo } from 'react';

import { type MapCar, renderTrackMap } from '../canvas/trackMap.js';
import { BrailleCanvas } from '../components/BrailleCanvas.js';
import { colorProp, flagColor, trackStatusStyle } from '../format/colors.js';
import { useSession, useTopic } from '../state/SessionContext.js';
import type { TimingRow } from '../state/timingRows.js';
import { trackOutline } from '../state/trackOutline.js';

const OVERLAY_WIDTH = 34;

interface Props {
  readonly width: number;
  readonly height: number;
  /** Tower rows, for each car's TLA, team colour and retired state. */
  readonly rows: readonly TimingRow[];
  readonly selected: string | undefined;
  /** Head-to-head rival, highlighted like the selected car. */
  readonly pinned?: string | undefined;
  /** Show the latest race control message in the overlay (when the race control panel is off). */
  readonly showLatestMessage?: boolean;
}

/** The circuit with every car on it at the cursor time (Driver Tracker screen). */
export function TrackMapView({ width, height, rows, selected, pinned, showLatestMessage = true }: Props) {
  const session = useSession();
  const { timeline, cursor } = session;
  const drivers = useTopic('DriverList');
  const track = useTopic('TrackStatus');
  const messages = useTopic('RaceControlMessages')?.Messages;
  const outline = trackOutline(timeline);

  const rowByNumber = useMemo(() => new Map(rows.map((row) => [row.number, row])), [rows]);
  const cars: MapCar[] = [];
  for (const number of timeline.telemetry.positionDrivers()) {
    const position = timeline.telemetry.positionAt(number, cursor.time);
    if (!position || (position.x === 0 && position.y === 0)) continue;
    const row = rowByNumber.get(number);
    const driver = drivers?.[number];
    cars.push({
      number,
      tla: row?.tla ?? driver?.Tla ?? number,
      ...(row?.lapsDown ? { label: `${row.tla} ${row.lapsDown}L` } : {}),
      color: row?.teamColour ?? (driver?.TeamColour ? `#${driver.TeamColour}` : undefined),
      x: position.x,
      y: position.y,
      dim: row?.dim === true || position.status !== 'OnTrack',
    });
  }

  if (session.skippedTopics.includes('Position')) {
    return (
      <Notice width={width} height={height}>
        <Text color="#ffd12e">Track map needs F1 token</Text>
        <Text dimColor>Position data is only sent to subscribers. Run once with --token-file &lt;path&gt;.</Text>
      </Notice>
    );
  }
  if (!outline) {
    return (
      <Notice width={width} height={height}>
        <Text dimColor>
          {timeline.telemetry.positionDrivers().length === 0
            ? 'No position data in this session yet.'
            : 'Waiting for one full lap of position data to draw the circuit…'}
        </Text>
      </Notice>
    );
  }

  const cells = renderTrackMap({ outline, cars, columns: width, rows: height, selected, pinned });
  const status = trackStatusStyle(track?.Status);
  const latest = showLatestMessage ? messages?.[messages.length - 1] : undefined;

  return (
    <Box width={width} height={height}>
      <BrailleCanvas cells={cells} />
      <Box
        position="absolute"
        top={0}
        right={0}
        // Just the track status when race control has its own panel; room for the latest message otherwise.
        width={Math.min(latest ? OVERLAY_WIDTH : status.label.length + 6, width)}
        flexDirection="column"
        borderStyle="round"
        borderDimColor
        paddingX={1}
      >
        <Text color={status.color} bold>
          ■ {status.label}
        </Text>
        {latest ? (
          <Text wrap="wrap">
            {latest.Lap === undefined ? '' : <Text dimColor>L{latest.Lap} </Text>}
            <Text {...colorProp(flagColor(latest.Flag))}>{latest.Message}</Text>
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

function Notice({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  return (
    <Box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center">
      {children}
    </Box>
  );
}
