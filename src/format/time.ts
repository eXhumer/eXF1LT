import { parseUtc } from '@exhumer/f1-live-timing';

/** `08:00:00` / `-04:00:00` → milliseconds. */
export function parseGmtOffset(offset: string | undefined): number {
  if (!offset) return 0;
  const negative = offset.startsWith('-');
  const parts = offset.replace(/^[-+]/, '').split(':').map(Number);
  const ms = parts.reduce((total, part, index) => total + (part || 0) * 60 ** (2 - index), 0) * 1000;
  return negative ? -ms : ms;
}

/** `HH:MM:SS` of a UTC instant shifted by an offset (circuit local time). */
export function clockTime(utc: number, offsetMs = 0): string {
  if (!Number.isFinite(utc)) return '--:--:--';
  return new Date(utc + offsetMs).toISOString().slice(11, 19);
}

/** `hh:mm:ss` → milliseconds. */
export function parseHms(value: string): number {
  const parts = value.split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + (part || 0), 0) * 1000;
}

export function formatHms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Session time remaining at `utc`, counting down while the clock is extrapolating. */
export function remainingAt(
  clock: { Utc: string; Remaining: string; Extrapolating: boolean } | undefined,
  utc: number,
): string | undefined {
  if (!clock?.Remaining) return undefined;
  const remaining = parseHms(clock.Remaining);
  if (!clock.Extrapolating || !Number.isFinite(utc)) return formatHms(remaining);
  return formatHms(remaining - Math.max(0, utc - parseUtc(clock.Utc)));
}

/** Pad or cut to exactly `width` characters. */
export function fit(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const cut = value.length > width ? value.slice(0, width) : value;
  return align === 'left' ? cut.padEnd(width) : cut.padStart(width);
}
