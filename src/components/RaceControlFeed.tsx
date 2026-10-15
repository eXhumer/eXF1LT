import { parseUtc } from '@exhumer/f1-live-timing';
import { Box, Text } from 'ink';

import { colorProp, flagColor } from '../format/colors.js';
import { clockTime, parseGmtOffset } from '../format/time.js';
import { useTopic } from '../state/SessionContext.js';

export function RaceControlFeed({ height, width }: { height: number; width: number }) {
  const messages = useTopic('RaceControlMessages')?.Messages ?? [];
  const info = useTopic('SessionInfo');
  const offset = parseGmtOffset(info?.GmtOffset);
  // Two lines per message on average once long ones wrap.
  const recent = messages.slice(-Math.max(1, Math.floor(height / 2))).reverse();
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      <Text bold>RACE CONTROL</Text>
      {recent.length === 0 ? <Text dimColor>No messages yet.</Text> : null}
      {recent.map((message, index) => (
        <Box key={`${message.Utc}-${index}`} width={width}>
          <Text wrap="wrap">
            <Text dimColor>
              {message.Lap === undefined ? '' : `L${message.Lap} `}
              {clockTime(parseUtc(message.Utc), offset).slice(0, 5)}{' '}
            </Text>
            <Text {...colorProp(flagColor(message.Flag))}>{message.Message}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}
