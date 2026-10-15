/**
 * A dot canvas drawn with Unicode braille: each terminal cell holds 2×4 dots,
 * so a W×H cell area gives a 2W×4H grid of roughly square dots.
 */

const BRAILLE_BASE = 0x2800;

/** Bit of each dot in a braille cell, indexed `[row][column]`. */
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

export class BrailleGrid {
  readonly columns: number;
  readonly rows: number;
  readonly #cells: Uint8Array;

  constructor(columns: number, rows: number) {
    this.columns = Math.max(0, Math.floor(columns));
    this.rows = Math.max(0, Math.floor(rows));
    this.#cells = new Uint8Array(this.columns * this.rows);
  }

  /** Width in dots. */
  get width(): number {
    return this.columns * 2;
  }

  /** Height in dots. */
  get height(): number {
    return this.rows * 4;
  }

  /** Set the dot at (x, y); points outside the grid are ignored. */
  set(x: number, y: number): void {
    const dx = Math.round(x);
    const dy = Math.round(y);
    if (dx < 0 || dy < 0 || dx >= this.width || dy >= this.height) return;
    const index = Math.floor(dy / 4) * this.columns + Math.floor(dx / 2);
    this.#cells[index]! |= DOT_BITS[dy % 4]![dx % 2]!;
  }

  /** Draw a straight line of dots (Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xEnd = Math.round(x1);
    const yEnd = Math.round(y1);
    const dx = Math.abs(xEnd - x);
    const dy = -Math.abs(yEnd - y);
    const sx = x < xEnd ? 1 : -1;
    const sy = y < yEnd ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.set(x, y);
      if (x === xEnd && y === yEnd) return;
      const doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x += sx;
      }
      if (doubled <= dx) {
        error += dx;
        y += sy;
      }
    }
  }

  /** Draw a polyline through `points`, optionally closing it. */
  path(points: readonly { readonly x: number; readonly y: number }[], closed = false): void {
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!;
      const b = points[index]!;
      this.line(a.x, a.y, b.x, b.y);
    }
    if (closed && points.length > 2) {
      const first = points[0]!;
      const last = points[points.length - 1]!;
      this.line(last.x, last.y, first.x, first.y);
    }
  }

  /** The character of a cell: a braille pattern, or a space when it has no dots. */
  char(column: number, row: number): string {
    const bits = this.#cells[row * this.columns + column] ?? 0;
    return bits === 0 ? ' ' : String.fromCodePoint(BRAILLE_BASE + bits);
  }

  /** Every row as a string. */
  lines(): string[] {
    return Array.from({ length: this.rows }, (_, row) =>
      Array.from({ length: this.columns }, (_, column) => this.char(column, row)).join(''),
    );
  }
}
