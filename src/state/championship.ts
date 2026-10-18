import type { DriverList } from '@exhumer/f1-live-timing';

/** One line of the championship table, with F1's prediction for the end of this session. */
export interface StandingRow {
  /** Racing number for a driver, or F1's long team name for a constructor. */
  readonly key: string;
  readonly name: string;
  /** Team name for a driver; empty for a constructor. */
  readonly team: string;
  readonly colour: string | undefined;
  readonly currentPosition: number | undefined;
  readonly predictedPosition: number | undefined;
  readonly currentPoints: number | undefined;
  readonly predictedPoints: number | undefined;
}

export interface Championship {
  readonly drivers: readonly StandingRow[];
  readonly teams: readonly StandingRow[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Order by predicted position, then by predicted points, then by name. */
function byPrediction(a: StandingRow, b: StandingRow): number {
  return (
    (a.predictedPosition ?? 99) - (b.predictedPosition ?? 99) ||
    (b.predictedPoints ?? 0) - (a.predictedPoints ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * The championship the way F1 predicts it will stand after this session.
 * Constructor keys are long (`McLaren Mercedes`), while `DriverList` has the
 * short team name (`McLaren`), so a constructor takes its colour from the
 * drivers whose team name matches its own `TeamName`.
 */
export function buildChampionship(value: unknown, drivers: DriverList | undefined): Championship | undefined {
  if (!isObject(value)) return undefined;
  const driverEntries = isObject(value['Drivers']) ? Object.entries(value['Drivers']) : [];
  const teamEntries = isObject(value['Teams']) ? Object.entries(value['Teams']) : [];
  if (driverEntries.length === 0 && teamEntries.length === 0) return undefined;

  const teamColours = new Map<string, string>();
  for (const entry of Object.values(drivers ?? {})) {
    if (entry?.TeamName && entry['TeamColour']) teamColours.set(entry['TeamName'], `#${entry['TeamColour']}`);
  }

  const driverRows = driverEntries
    .filter(([, entry]) => isObject(entry))
    .map(([number, entry]): StandingRow => {
      const fields = entry as Record<string, unknown>;
      const driver = drivers?.[number];
      return {
        key: number,
        name: (driver?.LastName ?? driver?.Tla ?? number).toUpperCase(),
        team: driver?.TeamName ?? '',
        colour: driver?.TeamColour ? `#${driver.TeamColour}` : undefined,
        currentPosition: num(fields['CurrentPosition']),
        predictedPosition: num(fields['PredictedPosition']),
        currentPoints: num(fields['CurrentPoints']),
        predictedPoints: num(fields['PredictedPoints']),
      };
    })
    // Entries that arrive before the first full table carry no standing yet.
    .filter((row) => row.currentPoints !== undefined || row.predictedPoints !== undefined);

  const teamRows = teamEntries
    .filter(([, entry]) => isObject(entry))
    .map(([key, entry]): StandingRow => {
      const fields = entry as Record<string, unknown>;
      const short = typeof fields['TeamName'] === 'string' ? fields['TeamName'] : key;
      return {
        key,
        name: short,
        team: '',
        colour: teamColours.get(short),
        currentPosition: num(fields['CurrentPosition']),
        predictedPosition: num(fields['PredictedPosition']),
        currentPoints: num(fields['CurrentPoints']),
        predictedPoints: num(fields['PredictedPoints']),
      };
    })
    .filter((row) => row.currentPoints !== undefined || row.predictedPoints !== undefined);

  return { drivers: driverRows.sort(byPrediction), teams: teamRows.sort(byPrediction) };
}

/** `337` for whole points, `0.5` otherwise. */
export function formatPoints(points: number | undefined): string {
  if (points === undefined) return '';
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/** Predicted minus current points: how many this session is expected to add. */
export function pointsGain(row: StandingRow): number | undefined {
  return row.predictedPoints === undefined || row.currentPoints === undefined
    ? undefined
    : row.predictedPoints - row.currentPoints;
}

/** Places gained (positive) or lost (negative) against the standings before the session. */
export function placesGained(row: StandingRow): number | undefined {
  return row.currentPosition === undefined || row.predictedPosition === undefined
    ? undefined
    : row.currentPosition - row.predictedPosition;
}
