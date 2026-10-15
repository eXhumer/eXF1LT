import type { DriverList, TimingAppData, TimingData, TimingDataLine, TimingStats } from '@exhumer/f1-live-timing';

/** How a time compares: purple, green or plain. */
export type Tone = 'overall' | 'personal' | 'normal';

export type RowStatus = 'running' | 'pit' | 'pitout' | 'retired' | 'stopped';

export interface TimedValue {
  readonly value: string;
  readonly tone: Tone;
}

/** One sector of the current lap: its time and the mini-sector statuses (see {@link segmentKind}). */
export interface SectorCell extends TimedValue {
  readonly segments: readonly number[];
}

export interface Stint {
  readonly compound: string;
  readonly isNew: boolean;
  /** Laps driven in this stint. */
  readonly laps: number;
  /** Age of the tyres, including laps from before the stint. */
  readonly age: number;
}

export interface TimingRow {
  readonly number: string;
  readonly tla: string;
  /** Surname in capitals, as the official leaderboard shows it. */
  readonly lastName: string;
  readonly teamColour: string | undefined;
  readonly position: string;
  readonly gap: string;
  readonly interval: string;
  readonly catching: boolean;
  readonly last: TimedValue;
  readonly best: string;
  readonly sectors: readonly SectorCell[];
  /** Personal best of each sector; `overall` when it is the session best. */
  readonly bestSectors: readonly TimedValue[];
  /** Speed traps: intermediate 1, intermediate 2, finish line. */
  readonly speeds: readonly TimedValue[];
  readonly gridPosition: number | undefined;
  /** Places gained since the start (positive) or lost (negative). */
  readonly positionChange: number | undefined;
  /** Laps behind the leader, from a gap such as `2L`. */
  readonly lapsDown: number | undefined;
  readonly stint: Stint | undefined;
  /** Earlier stints, oldest first. */
  readonly previousStints: readonly Stint[];
  readonly compound: string | undefined;
  readonly tyreAge: number | undefined;
  readonly pits: number | undefined;
  readonly status: RowStatus;
  /** Knocked out of qualifying or retired: drawn dimmed. */
  readonly dim: boolean;
  /** Last row above the qualifying cutoff. */
  readonly cutoff: boolean;
}

export interface TimingInput {
  readonly timingData: TimingData | undefined;
  readonly appData: TimingAppData | undefined;
  readonly drivers: DriverList | undefined;
  readonly stats?: TimingStats | undefined;
}

/** The timing tower's rows in running order. */
export function buildTimingRows({ timingData, appData, drivers, stats }: TimingInput): TimingRow[] {
  if (!timingData?.Lines) return [];
  const part = timingData.SessionPart;
  return Object.entries(timingData.Lines)
    .map(([number, line]) => ({ number, line }))
    .sort((a, b) => (a.line.Line ?? 99) - (b.line.Line ?? 99))
    .map(({ number, line }) => {
      const driver = drivers?.[number];
      const app = appData?.Lines?.[number];
      const stints = (app?.Stints ?? []).map(toStint);
      const stint = app?.Stints?.[app.Stints.length - 1];
      const status = rowStatus(line);
      const best = stats?.Lines?.[number];
      const grid = Number(app?.GridPos);
      const position = Number(line.Position);
      const gap = gapOf(line, part);
      const lapsDown = /^(\d+)L$/.exec(gap.trim())?.[1];
      return {
        number,
        tla: driver?.Tla ?? number,
        lastName: (driver?.LastName ?? driver?.Tla ?? number).toUpperCase(),
        teamColour: driver?.TeamColour ? `#${driver.TeamColour}` : undefined,
        position: line.Position ?? '',
        gap,
        interval: intervalOf(line, part),
        catching: line.IntervalToPositionAhead?.Catching ?? false,
        last: {
          value: line.LastLapTime?.Value ?? '',
          tone: toneOf(line.LastLapTime),
        },
        best: line.BestLapTime?.Value ?? '',
        sectors: [0, 1, 2].map((index) => {
          const sector = line.Sectors?.[index];
          return {
            value: sector?.Value ?? '',
            tone: toneOf(sector),
            segments: sector?.Segments?.map((segment) => segment.Status) ?? [],
          };
        }),
        bestSectors: [0, 1, 2].map((index) => {
          const sector = best?.BestSectors?.[index];
          return { value: sector?.Value ?? '', tone: sector?.Position === 1 ? 'overall' : 'personal' };
        }),
        speeds: (['I1', 'I2', 'FL'] as const).map((trap) => {
          const speed = line.Speeds?.[trap];
          return { value: speed?.Value ?? '', tone: toneOf(speed) };
        }),
        gridPosition: Number.isFinite(grid) && grid > 0 ? grid : undefined,
        positionChange:
          Number.isFinite(grid) && grid > 0 && Number.isFinite(position) && position > 0 ? grid - position : undefined,
        lapsDown: lapsDown === undefined ? undefined : Number(lapsDown),
        stint: stints[stints.length - 1],
        previousStints: stints.slice(0, -1),
        compound: stint?.Compound,
        tyreAge: stint?.TotalLaps,
        pits: line.NumberOfPitStops,
        status,
        dim: status === 'retired' || line.KnockedOut === true,
        cutoff: line.Cutoff === true,
      };
    });
}

function toStint(stint: { Compound: string; New: string; TotalLaps: number; StartLaps: number }): Stint {
  return {
    compound: stint.Compound,
    isNew: stint.New === 'true',
    laps: Math.max(0, (stint.TotalLaps ?? 0) - (stint.StartLaps ?? 0)),
    age: stint.TotalLaps ?? 0,
  };
}

export type SegmentKind = 'none' | 'normal' | 'personal' | 'overall' | 'pit' | 'stopped';

/**
 * Mini-sector status codes seen in `TimingData` (Singapore 2026): 0 not yet
 * driven, 2048 yellow, 2049 green, 2051 purple, 2064 pit lane; 2052 shows red
 * on the official site for cars that stopped.
 */
export function segmentKind(status: number): SegmentKind {
  if (status === 0) return 'none';
  if (status & 16) return 'pit';
  if ((status & 3) === 3) return 'overall';
  if (status & 1) return 'personal';
  if (status & 4) return 'stopped';
  return 'normal';
}

function rowStatus(line: Partial<TimingDataLine>): RowStatus {
  if (line.Retired) return 'retired';
  if (line.Stopped) return 'stopped';
  if (line.InPit) return 'pit';
  if (line.PitOut) return 'pitout';
  return 'running';
}

/** Qualifying parts keep gaps in `Stats[part - 1]`; practice uses `TimeDiffToFastest`. */
function gapOf(line: Partial<TimingDataLine>, part: number | undefined): string {
  if (part && line.Stats?.[part - 1]) return line.Stats[part - 1]!.TimeDiffToFastest ?? '';
  const loose = line as Record<string, unknown>;
  if (typeof line.GapToLeader === 'string') return line.GapToLeader;
  return typeof loose['TimeDiffToFastest'] === 'string' ? loose['TimeDiffToFastest'] : '';
}

function intervalOf(line: Partial<TimingDataLine>, part: number | undefined): string {
  if (part && line.Stats?.[part - 1]) return line.Stats[part - 1]!.TimeDifftoPositionAhead ?? '';
  const loose = line as Record<string, unknown>;
  if (line.IntervalToPositionAhead) return line.IntervalToPositionAhead.Value ?? '';
  return typeof loose['TimeDiffToPositionAhead'] === 'string' ? loose['TimeDiffToPositionAhead'] : '';
}

function toneOf(value: { OverallFastest?: boolean; PersonalFastest?: boolean } | undefined): Tone {
  if (value?.OverallFastest) return 'overall';
  if (value?.PersonalFastest) return 'personal';
  return 'normal';
}
