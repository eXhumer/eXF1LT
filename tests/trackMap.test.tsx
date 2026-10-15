import { type PositionSample, Timeline } from '@exhumer/f1-live-timing';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { BrailleGrid } from '../src/canvas/braille.js';
import { fitProjection, renderTrackMap } from '../src/canvas/trackMap.js';
import { runs } from '../src/components/BrailleCanvas.js';
import { SessionProvider } from '../src/state/SessionContext.js';
import { extractOutline, findLap, trackOutline } from '../src/state/trackOutline.js';
import { TimingView } from '../src/views/TimingView.js';
import { eventually, LAP_MS, positionMessages, raceTimeline, replaySession, T0, TRACK_RADIUS } from './helpers.js';

/** Lets a key press land before the next one when there is nothing on screen to wait for. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe('BrailleGrid', () => {
  it('maps each of the 2×4 dots to its braille bit', () => {
    const grid = new BrailleGrid(2, 1);
    grid.set(0, 0);
    grid.set(3, 3);
    expect(grid.lines()).toEqual(['⠁⢀']);
  });

  it('fills a whole cell and ignores dots outside the grid', () => {
    const grid = new BrailleGrid(1, 1);
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 2; x += 1) grid.set(x, y);
    grid.set(-1, 0);
    grid.set(2, 0);
    grid.set(0, 4);
    expect(grid.lines()).toEqual(['⣿']);
  });

  it('draws lines and closed paths', () => {
    const line = new BrailleGrid(2, 1);
    line.line(0, 0, 3, 0);
    expect(line.lines()).toEqual(['⠉⠉']);

    const box = new BrailleGrid(2, 1);
    box.path(
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ],
      true,
    );
    // Left column and the top and bottom rows of both cells: ⣏ + ⣹.
    expect(box.lines()).toEqual(['⣏⣹']);
    expect(new BrailleGrid(1, 1).char(0, 0)).toBe(' ');
  });
});

describe('fitProjection', () => {
  it('keeps the aspect ratio, centres and flips Y', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const projection = fitProjection(square, 80, 40, 0);
    const bottomLeft = projection.toDot({ x: 0, y: 0 });
    const topRight = projection.toDot({ x: 100, y: 100 });
    expect(topRight.x - bottomLeft.x).toBeCloseTo(bottomLeft.y - topRight.y);
    expect(bottomLeft.y).toBeCloseTo(39);
    expect(topRight.y).toBeCloseTo(0);
    expect((bottomLeft.x + topRight.x) / 2).toBeCloseTo(39.5);
  });
});

function circleSamples(seconds: number, status = 'OnTrack'): PositionSample[] {
  return Array.from({ length: seconds + 1 }, (_, second) => {
    const angle = (2 * Math.PI * second * 1000) / LAP_MS;
    return { utc: T0 + second * 1000, status, x: TRACK_RADIUS * Math.cos(angle), y: TRACK_RADIUS * Math.sin(angle), z: 0 };
  });
}

describe('findLap', () => {
  it('finds one full lap', () => {
    const lap = findLap(circleSamples(150));
    expect(lap).toBeDefined();
    expect(lap![1] - lap![0]).toBe(LAP_MS);
  });

  it('needs the car to go round, on track and without gaps', () => {
    expect(findLap(circleSamples(45))).toBeUndefined();
    expect(findLap(circleSamples(150, 'OffTrack'))).toBeUndefined();
    const parked = Array.from({ length: 200 }, (_, i) => ({ utc: T0 + i * 1000, status: 'OnTrack', x: 10, y: 10, z: 0 }));
    expect(findLap(parked)).toBeUndefined();
    const gappy = circleSamples(150).filter((_, index) => index % 10 !== 0 || index === 0);
    expect(findLap(gappy.map((sample, i) => ({ ...sample, utc: sample.utc + i * 6_000 })))).toBeUndefined();
  });
});

describe('trackOutline', () => {
  it('reads one lap of the busiest car back as the outline', () => {
    const timeline = new Timeline();
    timeline.insert(positionMessages(0, 150));
    const outline = extractOutline(timeline)!;
    expect(outline.length).toBe(LAP_MS / 1000 + 1);
    for (const point of outline) expect(Math.hypot(point.x, point.y)).toBeCloseTo(TRACK_RADIUS, -1);
  });

  it('memoises per timeline and retries a live timeline only after new data and a pause', () => {
    const timeline = new Timeline();
    timeline.insert(positionMessages(0, 30));
    expect(trackOutline(timeline, 0)).toBeUndefined();

    timeline.insert(positionMessages(31, 150));
    expect(trackOutline(timeline, 1_000)).toBeUndefined(); // too soon to search again
    const outline = trackOutline(timeline, 10_000);
    expect(outline).toBeDefined();
    expect(trackOutline(timeline, 10_001)).toBe(outline);
  });
});

describe('renderTrackMap', () => {
  const outline = circleSamples(60).map(({ x, y }) => ({ x, y }));
  const cars = [
    { number: '1', tla: 'NOR', color: '#F47600', x: TRACK_RADIUS, y: 0, dim: false },
    { number: '3', tla: 'VER', color: '#4781D7', x: -TRACK_RADIUS, y: 0, dim: true },
  ];

  it('draws the outline and labels each car, highlighting the selected one', () => {
    const cells = renderTrackMap({ outline, cars, columns: 40, rows: 12, selected: '3' });
    const text = cells.map((row) => row.map((cell) => cell.char).join(''));
    expect(text.join('\n')).toMatch(/[⠁-⣿]/u);
    expect(text.join('\n')).toContain('●NOR');
    expect(text.join('\n')).toContain('●VER');

    const flat = cells.flat();
    const ver = flat.filter((cell) => 'VER'.includes(cell.char) && cell.inverse);
    expect(ver).toHaveLength(3);
    expect(ver[0]).toMatchObject({ color: '#4781D7', bold: true });
    const nor = flat.find((cell) => cell.char === 'N');
    expect(nor).toMatchObject({ color: '#F47600' });
    expect(nor?.inverse).toBeUndefined();
  });

  it('puts the label on the left when the right edge is too close', () => {
    // A wide, flat circuit fills the whole width, so a car at its right end has no room on the right.
    const wide = [
      { x: -100, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: -100, y: 10 },
    ];
    const cells = renderTrackMap({ outline: wide, cars: [{ ...cars[0]!, x: 100, y: 0 }], columns: 20, rows: 6 });
    const text = cells.map((row) => row.map((cell) => cell.char).join('')).join('\n');
    expect(text).toContain('NOR●');
  });

  it('never lets a label cover another car, and labels the selected car first', () => {
    // PIA sits at the right edge (column 38 of 40) and NOR four columns before it,
    // so the three-cell gap between them fits exactly one label.
    const pair = [
      { number: '1', tla: 'NOR', color: undefined, x: 773, y: 0, dim: false },
      { number: '81', tla: 'PIA', color: undefined, x: 1_000, y: 0, dim: false },
    ];
    const line = [
      { x: -1_000, y: -10 },
      { x: 1_000, y: -10 },
      { x: 1_000, y: 10 },
      { x: -1_000, y: 10 },
    ];
    const draw = (selected?: string) =>
      renderTrackMap({ outline: line, cars: pair, columns: 40, rows: 3, selected })
        .map((r) => r.map((cell) => cell.char).join(''))
        .join('\n');

    expect(draw()).toContain('●NOR●');
    expect(draw()).not.toContain('PIA');
    expect(draw('81')).toContain('NOR●PIA●');
    expect(draw('81').match(/●/g)).toHaveLength(2);
  });

  it('merges same-styled neighbours into runs', () => {
    expect(runs([{ char: 'a' }, { char: 'b' }, { char: 'c', color: 'red' }])).toEqual([
      { text: 'ab' },
      { text: 'c', color: 'red' },
    ]);
  });
});

describe('TrackMapView', () => {
  it('switches to the driver tracker with 2 and back to the leaderboard with 1', async () => {
    const session = replaySession(raceTimeline(true));
    const { stdin, lastFrame, unmount } = render(
      <SessionProvider session={session}>
        <TimingView token={undefined} onQuit={() => undefined} raceControl="off" />
      </SessionProvider>,
    );
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));

    stdin.write('2');
    const map = await eventually(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/Laps {2}Sectors {2}Head to Head {2}Telemetry/);
      expect(frame).toMatch(/●(NOR|PIA|VER)/);
      return frame;
    });
    expect(map).toMatch(/[⠁-⣿]/u);
    expect(map).not.toContain('NORRIS'); // the side panel uses TLAs
    expect(map).toContain('■ SAFETY CAR');
    // With race control off, the latest message shows in the map overlay.
    expect(map).toContain('SAFETY CAR DEPLOYED');
    // Playback keys still work on the tracker.
    expect(map).toContain('LAP 2/62');
    stdin.write('n');
    await eventually(() => expect(lastFrame()).toContain('LAP 3/62'));

    stdin.write('1');
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    unmount();
  });

  it('compares two pinned drivers head to head and shows their telemetry', async () => {
    const session = replaySession(raceTimeline(true));
    const { stdin, lastFrame, unmount } = render(
      <SessionProvider session={session}>
        <TimingView token={undefined} onQuit={() => undefined} raceControl="off" />
      </SessionProvider>,
    );
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('2');
    await eventually(() => expect(lastFrame()).toMatch(/Laps {2}Sectors {2}Head to Head {2}Telemetry/));
    stdin.write('\t');
    await settle();
    stdin.write('\t');
    await eventually(() => expect(lastFrame()).toContain('press h to pin'));

    stdin.write('h'); // pin NOR (the first row)
    await settle();
    stdin.write('\u001B[B'); // select PIA
    const h2h = await eventually(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/PIA P2 {2}vs {2}▌NOR P1/);
      return frame;
    });
    expect(h2h).toContain('INTERVAL +2.400s');
    expect(h2h).toMatch(/27\.913\s+S1 27\.913\s+0\.000/);

    stdin.write('\t');
    await eventually(() => expect(lastFrame()).toMatch(/FOCUS[\s\S]*PIA[\s\S]*FOCUS[\s\S]*NOR/));
    unmount();
  });

  it('asks for a token when the live feed has no positions', async () => {
    const session = { ...replaySession(), skippedTopics: ['Position', 'CarData'] };
    const { stdin, lastFrame, unmount } = render(
      <SessionProvider session={session}>
        <TimingView token={undefined} onQuit={() => undefined} />
      </SessionProvider>,
    );
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('3');
    await eventually(() => expect(lastFrame()).toContain('Track map needs F1 token'));
    unmount();
  });

  it('waits for a full lap before drawing', async () => {
    const timeline = raceTimeline();
    timeline.insert(positionMessages(290, 310));
    const { stdin, lastFrame, unmount } = render(
      <SessionProvider session={replaySession(timeline)}>
        <TimingView token={undefined} onQuit={() => undefined} />
      </SessionProvider>,
    );
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('3');
    await eventually(() => expect(lastFrame()).toContain('Waiting for one full lap'));
    unmount();
  });
});
