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
      {/* The status on the right stays whole; the hints are cut short instead. */}
      {right ? (
        <Box flexShrink={0} marginLeft={2}>
          <Text dimColor>{right}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
