import type { Cursor, Topic } from '@exhumer/f1-live-timing';

/** Topics the UI reads. A change to any of them schedules a redraw. */
export const UI_TOPICS: readonly Topic[] = [
  'SessionInfo',
  'SessionStatus',
  'TrackStatus',
  'LapCount',
  'ExtrapolatedClock',
  'WeatherData',
  'DriverList',
  'TimingData',
  'TimingAppData',
  'TimingStats',
  'RaceControlMessages',
  'CarData',
  'Position',
];

/**
 * A version number that changes at most once per `interval` ms. Cursor moves
 * can arrive dozens of times a second on a live feed (and a seek touches every
 * topic at once), so components re-render from this instead of from each
 * cursor notification.
 */
export class FrameStore {
  #version = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastEmit = 0;
  readonly #listeners = new Set<() => void>();
  readonly #interval: number;

  constructor(interval = 100) {
    this.#interval = interval;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getVersion = (): number => this.#version;

  /** Request a redraw: immediately if the last one was long enough ago, else at the end of the interval. */
  bump(): void {
    if (this.#timer) return;
    const wait = this.#interval - (Date.now() - this.#lastEmit);
    if (wait <= 0) {
      this.#emit();
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#emit();
    }, wait);
  }

  /** Follow a cursor's UI topics. Returns an unsubscribe function. */
  watch(cursor: Cursor, topics: readonly Topic[] = UI_TOPICS): () => void {
    return cursor.subscribe(topics, () => this.bump());
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#listeners.clear();
  }

  #emit(): void {
    this.#lastEmit = Date.now();
    this.#version += 1;
    for (const listener of [...this.#listeners]) listener();
  }
}
