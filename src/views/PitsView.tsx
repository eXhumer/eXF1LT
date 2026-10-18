import { Box, Text } from 'ink';

import { type Column, span, type Span, Table, tableWidth } from '../components/Table.js';
import { compoundStyle } from '../format/colors.js';
import { bestStop, type PitRow, type PitStopTable, seconds } from '../state/pitStops.js';
import * as col from './columns.js';

export const PIT_TABS = ['Pit Stops', 'Tyre History'] as const;
export type PitTab = (typeof PIT_TABS)[number];

const NAME_WIDTH = 12;
const PURPLE = '#b138dd';
/** `L18  2.5 24.048`: lap, time stationary, time in the pit lane. */
const STOP_WIDTH = 15;

const pitCount: Column<PitRow> = {
  header: 'PIT',
  width: 3,
  align: 'right',
  render: (row) => span(String(row.stops.length)),
};

function best(fastest: number | undefined): Column<PitRow> {
  return {
    header: 'BEST',
    width: 5,
    align: 'right',
    render: (row) => {
      const time = bestStop(row.stops);
      if (time === undefined) return span('');
      return span(time.toFixed(1), fastest === time ? { color: PURPLE, bold: true } : {});
    },
  };
}

function stopColumn(index: number, fastest: number | undefined): Column<PitRow> {
  return {
    header: `STOP ${index + 1}`,
    width: STOP_WIDTH,
    render: (row): Span[] => {
      const stop = row.stops[index];
      if (!stop) return [span('')];
      const time = seconds(stop.stationary);
      const isFastest = fastest !== undefined && time === fastest;
      return [
        span((stop.lap === undefined ? '' : `L${stop.lap}`).padEnd(4), { dim: true }),
        span((stop.stationary ?? '').padStart(4), isFastest ? { color: PURPLE, bold: true } : {}),
        span(' '),
        span((stop.lane ?? '').padStart(6), { dim: true }),
      ];
    },
  };
}

/** The pit stop tab's columns: as many stops as fit in `width`. */
export function pitStopColumns(table: PitStopTable, width: number): Column<PitRow>[] {
  const fastest = table.fastest?.seconds;
  const build = (nameWidth: number): Column<PitRow>[] => {
    const fixed: Column<PitRow>[] = [col.position, col.teamBar, col.driver(nameWidth), pitCount, best(fastest)];
    const stops = Math.max(1, ...table.rows.map((row) => row.stops.length));
    const room = Math.floor((width - tableWidth(fixed as Column<never>[])) / (STOP_WIDTH + 1));
    const shown = Math.max(1, Math.min(stops, room));
    return [...fixed, ...Array.from({ length: shown }, (_, index) => stopColumn(index, fastest))];
  };
  const full = build(NAME_WIDTH);
  return tableWidth(full as Column<never>[]) <= width ? full : build(3);
}

/**
 * One coloured block per stint, as wide as the stint is long. The block holds
 * the compound's letter and the laps driven, e.g. `M18`, and a blank cell
 * separates two stints.
 */
function historyColumn(width: number, totalLaps: number): Column<PitRow> {
  return {
    header: `TYRE HISTORY · ${totalLaps} LAPS`,
    width,
    render: (row) => {
      const stints = [...row.previousStints, ...(row.stint ? [row.stint] : [])].filter((stint) => stint.laps > 0);
      const scale = width / totalLaps;
      const out: Span[] = [];
      let done = 0;
      for (const stint of stints) {
        const start = Math.round(done * scale);
        done += stint.laps;
        const cells = Math.max(2, Math.round(done * scale) - start);
        const style = compoundStyle(stint.compound);
        const label = `${style?.letter ?? '?'}${stint.laps}`;
        const inner = cells - 1;
        const text = (inner >= label.length ? label : label.slice(0, 1)).padStart(
          Math.floor((inner + Math.min(label.length, inner)) / 2),
        );
        out.push(span(text.padEnd(inner), { color: style?.color, inverse: true, bold: true }), span(' '));
      }
      return out;
    },
  };
}

/** Laps the bars are scaled to: the race distance, or the longest run so far. */
export function historyLaps(rows: readonly PitRow[], raceLaps: number | undefined): number {
  const driven = Math.max(
    0,
    ...rows.map((row) => [...row.previousStints, ...(row.stint ? [row.stint] : [])].reduce((sum, s) => sum + s.laps, 0)),
  );
  return Math.max(1, raceLaps ?? 0, driven);
}

export function tyreHistoryColumns(rows: readonly PitRow[], raceLaps: number | undefined, width: number): Column<PitRow>[] {
  const build = (nameWidth: number): Column<PitRow>[] => {
    const fixed: Column<PitRow>[] = [col.position, col.teamBar, col.driver(nameWidth), pitCount];
    const bar = Math.max(8, width - tableWidth(fixed as Column<never>[]) - 1);
    return [...fixed, historyColumn(bar, historyLaps(rows, raceLaps))];
  };
  const full = build(NAME_WIDTH);
  return tableWidth(full as Column<never>[]) <= width ? full : build(3);
}

interface Props {
  readonly tab: PitTab;
  readonly table: PitStopTable;
  readonly raceLaps: number | undefined;
  readonly selected: string | undefined;
  readonly width: number;
  readonly height: number;
}

/** Screen 3: every pit stop of the session, or the tyre stints as bars scaled to the race distance. */
export function PitsView({ tab, table, raceLaps, selected, width, height }: Props) {
  const note = tab === 'Pit Stops' && !table.timed && table.rows.length > 0;
  const columns =
    tab === 'Pit Stops' ? pitStopColumns(table, width - 1) : tyreHistoryColumns(table.rows, raceLaps, width - 1);
  return (
    <Box width={width} height={height} flexDirection="column" paddingLeft={1}>
      <Table
        columns={columns}
        rows={table.rows}
        rowKey={(row) => row.number}
        dimRow={(row) => row.dim}
        height={note ? height - 1 : height}
        selected={selected}
        emptyText="  Waiting for timing data…"
      />
      {note ? (
        <Text dimColor wrap="truncate">
          Stop times come with archived sessions; the laps are rebuilt from the tyre stints.
        </Text>
      ) : null}
    </Box>
  );
}
