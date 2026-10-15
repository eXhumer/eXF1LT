import { Box, Text } from 'ink';

export type Hint = readonly [keys: string, label: string];

export function KeyHints({ hints, right }: { hints: readonly Hint[]; right?: string }) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text wrap="truncate">
        {hints.map(([keys, label], index) => (
          <Text key={keys}>
            {index > 0 ? '  ' : ''}
            <Text bold>{keys}</Text>
            <Text dimColor> {label}</Text>
          </Text>
        ))}
      </Text>
      {right ? <Text dimColor>{right}</Text> : null}
    </Box>
  );
}
