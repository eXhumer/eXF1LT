import type { Point } from '../state/trackOutline.js';
import { BrailleGrid } from './braille.js';

export interface MapCar {
  readonly number: string;
  readonly tla: string;
  /** Text beside the dot; defaults to the TLA. The official map adds laps down: `ALO 1L`. */
  readonly label?: string;
  readonly color: string | undefined;
  readonly x: number;
  readonly y: number;
  /** Retired or in the garage: drawn dimmed. */
  readonly dim: boolean;
}

export interface MapCell {
  readonly char: string;
  readonly color?: string;
  readonly bold?: boolean;
  readonly inverse?: boolean;
  readonly dim?: boolean;
}

export interface Projection {
  /** World coordinates → dot coordinates on the grid. */
  toDot(point: Point): Point;
}

/**
 * Fit `points` into a dot grid, keeping the aspect ratio (braille dots are
 * close to square) and leaving `margin` dots free on every side. World Y
 * points up, so it is flipped.
 */
export function fitProjection(points: readonly Point[], width: number, height: number, margin = 2): Projection {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const usableX = Math.max(1, width - 1 - 2 * margin);
  const usableY = Math.max(1, height - 1 - 2 * margin);
  const scale = Math.min(usableX / spanX, usableY / spanY);
  const offsetX = margin + (usableX - spanX * scale) / 2;
  const offsetY = margin + (usableY - spanY * scale) / 2;
  return {
    toDot: ({ x, y }) => ({ x: offsetX + (x - minX) * scale, y: offsetY + (maxY - y) * scale }),
  };
}

/**
 * Lay out the map as rows of styled cells: the outline in braille, each car
 * as a team-coloured dot with its TLA beside it. The selected car is drawn
 * last so it is never covered, with its label highlighted.
 */
export function renderTrackMap(options: {
  readonly outline: readonly Point[];
  readonly cars: readonly MapCar[];
  readonly columns: number;
  readonly rows: number;
  readonly selected?: string | undefined;
  /** A second highlighted car (head to head). */
  readonly pinned?: string | undefined;
}): MapCell[][] {
  const { outline, cars, columns, rows, selected, pinned } = options;
  const grid = new BrailleGrid(columns, rows);
  const projection = fitProjection(outline, grid.width, grid.height);
  grid.path(outline.map((point) => projection.toDot(point)), true);

  const cells: MapCell[][] = Array.from({ length: grid.rows }, (_, row) =>
    Array.from({ length: grid.columns }, (_, column) => {
      const char = grid.char(column, row);
      return char === ' ' ? { char } : { char, color: 'gray' };
    }),
  );
  const taken = new Set<string>();
  const placed = cars.map((car) => {
    const isSelected = car.number === selected || (pinned !== undefined && car.number === pinned);
    const dot = projection.toDot(car);
    return {
      car,
      isSelected,
      column: clamp(Math.floor(dot.x / 2), 0, grid.columns - 1),
      row: clamp(Math.floor(dot.y / 4), 0, grid.rows - 1),
      style: {
        ...(car.color ? { color: car.color } : {}),
        ...(car.dim && !isSelected ? { dim: true } : {}),
      },
    };
  });

  // Every dot first (the selected one last, so it is on top), then labels in the
  // gaps: a label never covers a dot, and the selected car's label is placed first.
  for (const { isSelected, column, row, style } of [...placed].sort(bySelected(false))) {
    cells[row]![column] = { char: '●', ...style, ...(isSelected ? { bold: true } : {}) };
    taken.add(`${row}:${column}`);
  }
  for (const { car, isSelected, column, row, style } of [...placed].sort(bySelected(true))) {
    const label = car.label ?? car.tla.slice(0, 3);
    const fits = (start: number) =>
      start >= 0 &&
      start + label.length <= grid.columns &&
      Array.from(label, (_, i) => `${row}:${start + i}`).every((key) => !taken.has(key));
    const start = fits(column + 1) ? column + 1 : fits(column - label.length) ? column - label.length : undefined;
    if (start === undefined) continue;
    for (let i = 0; i < label.length; i += 1) {
      cells[row]![start + i] = { char: label[i]!, ...style, ...(isSelected ? { bold: true, inverse: true } : {}) };
      taken.add(`${row}:${start + i}`);
    }
  }
  return cells;
}

/** Sort the selected car first (`selectedFirst`) or last. */
function bySelected(selectedFirst: boolean) {
  return (a: { isSelected: boolean }, b: { isSelected: boolean }) =>
    (Number(a.isSelected) - Number(b.isSelected)) * (selectedFirst ? -1 : 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
