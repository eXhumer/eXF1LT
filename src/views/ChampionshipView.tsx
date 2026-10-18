import { Box, Text } from 'ink';

import { type Column, span, Table, tableWidth } from '../components/Table.js';
import {
  type Championship,
  formatPoints,
  placesGained,
  pointsGain,
  type StandingRow,
} from '../state/championship.js';

export const CHAMPIONSHIP_TABS = ['Drivers', 'Constructors'] as const;
export type ChampionshipTab = (typeof CHAMPIONSHIP_TABS)[number];

const GREEN = '#23c552';
const YELLOW = '#ffd12e';

const predicted: Column<StandingRow> = {
  header: 'POS',
  width: 3,
  align: 'right',
  render: (row) => span(row.predictedPosition === undefined ? '' : String(row.predictedPosition), { bold: true }),
};

/** Places gained or lost against the standings before the session. */
const change: Column<StandingRow> = {
  header: '+/-',
  width: 3,
  align: 'right',
  render: (row) => {
    const places = placesGained(row);
    if (places === undefined) return span('');
    if (places > 0) return span(`▲${places}`, { color: GREEN });
    if (places < 0) return span(`▼${-places}`, { color: YELLOW });
    return span('-', { dim: true });
  },
};

const teamBar: Column<StandingRow> = {
  header: '',
  width: 1,
  render: (row) => span('▌', { color: row.colour }),
};

function name(header: string, width: number): Column<StandingRow> {
  return { header, width, marksSelection: true, render: (row) => span(row.name, { bold: true }) };
}

const team: Column<StandingRow> = { header: 'TEAM', width: 16, render: (row) => span(row.team, { dim: true }) };

const current: Column<StandingRow> = {
  header: 'PTS',
  width: 5,
  align: 'right',
  render: (row) => span(formatPoints(row.currentPoints)),
};

const predictedPoints: Column<StandingRow> = {
  header: 'AFTER',
  width: 5,
  align: 'right',
  render: (row) => span(formatPoints(row.predictedPoints), { bold: true }),
};

const gain: Column<StandingRow> = {
  header: 'GAIN',
  width: 5,
  align: 'right',
  render: (row) => {
    const points = pointsGain(row);
    if (points === undefined) return span('');
    return points > 0 ? span(`+${formatPoints(points)}`, { color: GREEN }) : span('0', { dim: true });
  },
};

export function championshipColumns(tab: ChampionshipTab, width: number): Column<StandingRow>[] {
  const lead = [predicted, change, teamBar];
  if (tab === 'Constructors') return [...lead, name('TEAM', 18), current, predictedPoints, gain];
  const full = [...lead, name('DRIVER', 14), team, current, predictedPoints, gain];
  return tableWidth(full as Column<never>[]) <= width ? full : [...lead, name('DRIVER', 14), current, predictedPoints, gain];
}

interface Props {
  readonly tab: ChampionshipTab;
  readonly championship: Championship | undefined;
  readonly selected: string | undefined;
  readonly width: number;
  readonly height: number;
}

/** Screen 4: F1's prediction of the championship after the session, with the points each driver or team would add. */
export function ChampionshipView({ tab, championship, selected, width, height }: Props) {
  const rows = tab === 'Drivers' ? (championship?.drivers ?? []) : (championship?.teams ?? []);
  return (
    <Box width={width} height={height} flexDirection="column" paddingLeft={1}>
      <Text dimColor wrap="truncate">
        PTS before the session · AFTER: F1's prediction if it ended now
      </Text>
      <Table
        columns={championshipColumns(tab, width - 1)}
        rows={rows}
        rowKey={(row) => row.key}
        height={height - 1}
        selected={tab === 'Drivers' ? selected : undefined}
        emptyText="  Waiting for the championship prediction…"
      />
    </Box>
  );
}
