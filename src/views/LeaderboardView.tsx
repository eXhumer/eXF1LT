import { Box } from 'ink';

import { type Column, Table, tableWidth } from '../components/Table.js';
import type { TimingRow } from '../state/timingRows.js';
import * as col from './columns.js';

export const LEADERBOARD_TABS = ['Laps', 'Sectors', 'Segments', 'Tyres'] as const;
export type LeaderboardTab = (typeof LEADERBOARD_TABS)[number];

const NAME_WIDTH = 12;

/** The columns of a tab, with surnames when they fit in `width` and TLAs otherwise. */
export function leaderboardColumns(tab: LeaderboardTab, rows: readonly TimingRow[], width: number): Column<TimingRow>[] {
  const build = (nameWidth: number): Column<TimingRow>[] => {
    const lead = [col.position, col.teamBar, col.driver(nameWidth)];
    switch (tab) {
      case 'Laps':
        return [...lead, col.lapTime, col.gap, col.interval, col.sector(0), col.sector(1), col.sector(2), col.positionChange, col.tyreColumn, col.pits];
      case 'Sectors':
        return [
          ...lead,
          col.lapTime,
          col.gap,
          ...[0, 1, 2].flatMap((index) => [col.sector(index), col.bestSector(index), col.speed(index)]),
          col.tyreColumn,
        ];
      case 'Segments': {
        const leaders = col.sectorLeaders(rows);
        const bars = col.segmentCount(rows);
        return [
          ...lead,
          col.lapTime,
          col.gap,
          col.interval,
          ...[0, 1, 2].map((index) => col.segments(index, leaders[index], bars)),
          col.tyreColumn,
        ];
      }
      case 'Tyres': {
        const fixed = [...lead, col.lapTime, col.currentTyre, col.stintLaps, col.totalLaps, col.pits];
        return [...fixed, col.previousStints(Math.max(8, width - tableWidth(fixed as Column<never>[]) - 1))];
      }
    }
  };
  const full = build(NAME_WIDTH);
  return tableWidth(full as Column<never>[]) <= width ? full : build(3);
}

interface Props {
  readonly tab: LeaderboardTab;
  readonly rows: readonly TimingRow[];
  readonly selected: string | undefined;
  readonly width: number;
  readonly height: number;
}

/** Screen 1: the full leaderboard, one tab at a time, like the official Leaderboard page. */
export function LeaderboardView({ tab, rows, selected, width, height }: Props) {
  return (
    <Box width={width} height={height} flexDirection="column" paddingLeft={1}>
      <Table
        columns={leaderboardColumns(tab, rows, width - 1)}
        rows={rows}
        rowKey={(row) => row.number}
        dimRow={(row) => row.dim}
        height={height}
        selected={selected}
        emptyText="  Waiting for timing data…"
      />
    </Box>
  );
}
