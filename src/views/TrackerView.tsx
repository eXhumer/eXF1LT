import { Box, Text } from 'ink';

import { FocusPanel } from '../components/FocusPanel.js';
import { span, Table } from '../components/Table.js';
import { colorProp, compoundStyle } from '../format/colors.js';
import type { TimingRow } from '../state/timingRows.js';
import * as col from './columns.js';
import { TrackMapView } from './TrackMapView.js';

export const TRACKER_TABS = ['Laps', 'Sectors', 'Head to Head', 'Telemetry'] as const;
export type TrackerTab = (typeof TRACKER_TABS)[number];

/** Width of the side panel next to the map, like the official Driver Tracker. */
export const TRACKER_PANEL_WIDTH = 46;
/** Narrow position list beside the head-to-head and telemetry cards. */
const LIST_WIDTH = 10;

interface Props {
  readonly tab: TrackerTab;
  readonly rows: readonly TimingRow[];
  readonly selected: string | undefined;
  readonly pinned: string | undefined;
  readonly width: number;
  readonly height: number;
  readonly showLatestMessage: boolean;
}

/** Screen 2: a compact tower with Laps / Sectors / Head to Head / Telemetry tabs beside the track map. */
export function TrackerView({ tab, rows, selected, pinned, width, height, showLatestMessage }: Props) {
  const panelWidth = Math.min(TRACKER_PANEL_WIDTH, Math.max(LIST_WIDTH, width - 20));
  const mapWidth = Math.max(10, width - panelWidth - 1);
  return (
    <Box width={width} height={height}>
      <Box width={panelWidth} height={height} flexDirection="column" paddingLeft={1}>
        <Panel tab={tab} rows={rows} selected={selected} pinned={pinned} height={height} />
      </Box>
      <Box width={1} height={height} flexDirection="column">
        <Text dimColor>{'│\n'.repeat(height).trimEnd()}</Text>
      </Box>
      <TrackMapView
        width={mapWidth}
        height={height}
        rows={rows}
        selected={selected}
        pinned={pinned}
        showLatestMessage={showLatestMessage}
      />
    </Box>
  );
}

function Panel({ tab, rows, selected, pinned, height }: Omit<Props, 'width' | 'showLatestMessage'>) {
  const lead = [col.position, col.teamBar, col.driver(3)];
  switch (tab) {
    case 'Laps':
      return (
        <Table
          columns={[...lead, col.lapTime, col.gap, col.interval, col.tyreColumn]}
          rows={rows}
          rowKey={(row) => row.number}
          dimRow={(row) => row.dim}
          height={height}
          selected={selected}
        />
      );
    case 'Sectors':
      return (
        <Table
          columns={[...lead, col.lapTime, col.sector(0), col.sector(1), col.sector(2)]}
          rows={rows}
          rowKey={(row) => row.number}
          dimRow={(row) => row.dim}
          height={height}
          selected={selected}
        />
      );
    case 'Head to Head':
    case 'Telemetry':
      return (
        <Box>
          <Box width={LIST_WIDTH} flexDirection="column">
            <Table
              columns={[col.position, col.teamBar, { ...col.driver(3), render: (row) => span(row.tla, { bold: row.number === pinned }) }]}
              rows={rows}
              rowKey={(row) => row.number}
              dimRow={(row) => row.dim}
              height={height}
              selected={selected}
            />
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {tab === 'Head to Head' ? (
              <HeadToHead a={rows.find((row) => row.number === selected)} b={rows.find((row) => row.number === pinned)} />
            ) : (
              <>
                <FocusPanel driver={selected} />
                {pinned && pinned !== selected ? (
                  <>
                    <Text> </Text>
                    <FocusPanel driver={pinned} />
                  </>
                ) : null}
              </>
            )}
          </Box>
        </Box>
      );
  }
}

/** Seconds of a lap or sector time (`1:37.840`, `28.631`), or `undefined`. */
export function seconds(value: string): number | undefined {
  if (!value) return undefined;
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function delta(a: string, b: string): { text: string; color: string | undefined } {
  const x = seconds(a);
  const y = seconds(b);
  if (x === undefined || y === undefined) return { text: '', color: undefined };
  const diff = x - y;
  return { text: `${diff > 0 ? '+' : ''}${diff.toFixed(3)}`, color: diff > 0 ? '#ffd12e' : '#23c552' };
}

/** Two drivers side by side: lap, sectors and tyres, with A's delta to B. */
function HeadToHead({ a, b }: { a: TimingRow | undefined; b: TimingRow | undefined }) {
  if (!a || !b || a === b) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text bold>HEAD TO HEAD</Text>
        <Text dimColor>Select a driver and press h to pin them,</Text>
        <Text dimColor>then select another to compare.</Text>
      </Box>
    );
  }
  const lines: { label: string; a: string; b: string }[] = [
    { label: 'LAP', a: a.last.value, b: b.last.value },
    { label: 'S1', a: a.sectors[0]?.value ?? '', b: b.sectors[0]?.value ?? '' },
    { label: 'S2', a: a.sectors[1]?.value ?? '', b: b.sectors[1]?.value ?? '' },
    { label: 'S3', a: a.sectors[2]?.value ?? '', b: b.sectors[2]?.value ?? '' },
  ];
  const tyre = (row: TimingRow) => {
    const style = compoundStyle(row.stint?.compound);
    return (
      <Text>
        {row.stint?.age ?? ''} <Text {...colorProp(style?.color)}>{style?.letter ?? '–'}</Text>
      </Text>
    );
  };
  const gapA = seconds(a.gap.replace('+', '')) ?? 0;
  const gapB = seconds(b.gap.replace('+', '')) ?? 0;
  const between = a.lapsDown || b.lapsDown ? undefined : gapA - gapB;
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>
        <Text {...colorProp(a.teamColour)}>▌</Text>
        <Text bold inverse>
          {a.tla}
        </Text>
        <Text dimColor> P{a.position}  vs  </Text>
        <Text {...colorProp(b.teamColour)}>▌</Text>
        <Text bold>{b.tla}</Text>
        <Text dimColor> P{b.position}</Text>
      </Text>
      <Text>
        <Text dimColor>INTERVAL </Text>
        <Text bold>{between === undefined ? '–' : `${between > 0 ? '+' : ''}${between.toFixed(3)}s`}</Text>
      </Text>
      <Text> </Text>
      {lines.map((line) => {
        const d = delta(line.a, line.b);
        return (
          <Text key={line.label}>
            {line.a.padStart(8)} <Text dimColor>{line.label.padStart(3)}</Text> {line.b.padEnd(8)}{' '}
            <Text {...(d.color ? { color: d.color } : {})}>{d.text}</Text>
          </Text>
        );
      })}
      <Text>
        {'     '}
        {tyre(a)} <Text dimColor>TYRE</Text> {tyre(b)}
      </Text>
    </Box>
  );
}
