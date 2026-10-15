import { Box, Text } from 'ink';

import { compoundStyle } from '../format/colors.js';
import { useSession, useTopic } from '../state/SessionContext.js';

const BAR_WIDTH = 10;

export function FocusPanel({ driver }: { driver: string | undefined }) {
  const session = useSession();
  const drivers = useTopic('DriverList');
  const appData = useTopic('TimingAppData');
  if (!driver) return null;
  const info = drivers?.[driver];
  const line = appData?.Lines?.[driver];
  const stint = line?.Stints?.[line.Stints.length - 1];
  const tyre = compoundStyle(stint?.Compound);
  const car = session.timeline.telemetry.carAt(driver, session.cursor.time);

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>FOCUS </Text>
        <Text color={info?.TeamColour ? `#${info.TeamColour}` : 'gray'}>▌</Text>
        <Text bold> {driver} {info?.Tla ?? ''}</Text>
        {car ? <Text>{`   gear ${car.gear}`}</Text> : null}
      </Text>
      {car ? (
        <>
          <Text>
            {String(Math.round(car.speed)).padStart(3)} km/h <Bar value={car.throttle} color="#23c552" /> THR
          </Text>
          <Text>
            {(car.rpm / 1000).toFixed(1).padStart(4)}k rpm <Bar value={car.brake} color="#e8002d" /> BRK
          </Text>
        </>
      ) : (
        <Text dimColor>{session.skippedTopics.includes('CarData') ? 'no telemetry: needs a token' : 'no telemetry'}</Text>
      )}
      <Text dimColor>
        {tyre ? <Text color={tyre.color}>{tyre.letter}</Text> : '–'} {stint?.TotalLaps ?? ''} laps
        {line?.GridPos ? ` · grid P${line.GridPos}` : ''}
      </Text>
    </Box>
  );
}

/** `brake` is 0/100 or 0/1 depending on the feed; treat anything ≤ 1 as a fraction. */
function Bar({ value, color }: { value: number; color: string }) {
  const fraction = Math.min(1, Math.max(0, value > 1 ? value / 100 : value));
  const filled = Math.round(fraction * BAR_WIDTH);
  return (
    <Text>
      ▕<Text color={color}>{'█'.repeat(filled)}</Text>
      {' '.repeat(BAR_WIDTH - filled)}▏
    </Text>
  );
}
