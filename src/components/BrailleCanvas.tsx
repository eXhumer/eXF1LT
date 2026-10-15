import { Box, Text } from 'ink';

import type { MapCell } from '../canvas/trackMap.js';

/** Draw rows of styled cells, merging neighbouring cells of the same style into one `<Text>`. */
export function BrailleCanvas({ cells }: { cells: readonly (readonly MapCell[])[] }) {
  return (
    <Box flexDirection="column">
      {cells.map((row, index) => (
        <Text key={index} wrap="truncate">
          {runs(row).map((run, runIndex) => (
            <Text
              key={runIndex}
              {...(run.color ? { color: run.color } : {})}
              bold={run.bold ?? false}
              inverse={run.inverse ?? false}
              dimColor={run.dim ?? false}
            >
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

interface Run extends Omit<MapCell, 'char'> {
  text: string;
}

function sameStyle(a: Omit<MapCell, 'char'>, b: Omit<MapCell, 'char'>): boolean {
  return a.color === b.color && !!a.bold === !!b.bold && !!a.inverse === !!b.inverse && !!a.dim === !!b.dim;
}

export function runs(row: readonly MapCell[]): Run[] {
  const result: Run[] = [];
  for (const { char, ...style } of row) {
    const last = result[result.length - 1];
    if (last && sameStyle(last, style)) last.text += char;
    else result.push({ ...style, text: char });
  }
  return result;
}
