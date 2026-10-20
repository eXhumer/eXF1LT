import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type LiveTimingMessage, Timeline } from '@exhumer/f1-live-timing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectTelemetry,
  driverLaps,
  exportTelemetry,
  parseLapTime,
  reportLaps,
  resolveDriver,
  sessionDrivers,
  TelemetryExportError,
  telemetryFileName,
} from '../src/export/telemetry.js';
import { renderTelemetryHtml } from '../src/export/telemetryHtml.js';
import { positionMessages, raceMessages, T0 } from './helpers.js';
import { readoutText, runPage, valuesTable } from './pageStub.js';

/** `CarData` batches four times a second, from `from` to `to` seconds after T0, with speed from `speed(seconds)`. */
function carMessages(
  driver: string,
  speed: (seconds: number) => number,
  { from = 100, to = 400, drs = false }: { from?: number; to?: number; drs?: boolean } = {},
): LiveTimingMessage[] {
  const messages: LiveTimingMessage[] = [];
  for (let ms = from * 1000; ms <= to * 1000; ms += 250) {
    const utc = T0 + ms;
    const channels: Record<string, number> = { '0': 11_000, '2': speed(ms / 1000), '3': 7, '4': 100, '5': 0 };
    if (drs) channels['45'] = 8;
    messages.push({
      topic: 'CarData',
      utc,
      data: { Entries: [{ Utc: new Date(utc).toISOString(), Cars: { [driver]: { Channels: channels } } }] },
    });
  }
  return messages;
}

const sawtooth = (seconds: number) => 200 + ((seconds * 1000) % 100_000) / 1000;

/** NOR completes laps at 220 s and 320 s; the second lap time arrives a second late. */
function lapMessages(): LiveTimingMessage[] {
  return [
    { topic: 'TimingData', utc: T0 + 220_000, data: { Lines: { '1': { NumberOfLaps: 1, LastLapTime: { Value: '1:40.100' } } } } },
    { topic: 'TimingData', utc: T0 + 320_000, data: { Lines: { '1': { NumberOfLaps: 2 } } } },
    { topic: 'TimingData', utc: T0 + 321_000, data: { Lines: { '1': { LastLapTime: { Value: '1:39.800' } } } } },
    { topic: 'TimingData', utc: T0 + 330_000, data: { Lines: { '81': { NumberOfLaps: 2 } } } },
  ];
}

function timeline(drs = false): Timeline {
  const result = new Timeline();
  result.insert([...raceMessages(), ...positionMessages(), ...carMessages('1', sawtooth, { drs }), ...lapMessages()]);
  return result;
}

describe('resolveDriver', () => {
  it('takes a racing number or a three-letter code in any case', () => {
    const t = timeline();
    expect(resolveDriver(t, '81')).toBe('81');
    expect(resolveDriver(t, 'nor')).toBe('1');
    expect(resolveDriver(t, 'HAM')).toBeUndefined();
  });
});

describe('parseLapTime', () => {
  it('reads minutes and seconds, or seconds alone', () => {
    expect(parseLapTime('1:35.412')).toBe(95_412);
    expect(parseLapTime('59.876')).toBe(59_876);
    expect(parseLapTime('')).toBeUndefined();
    expect(parseLapTime(undefined)).toBeUndefined();
  });
});

describe('collectTelemetry', () => {
  it('stores the channels as columns relative to the first sample', () => {
    const report = collectTelemetry(timeline(), ['1']);
    const [nor] = report.drivers;
    expect(report.origin).toBe(T0);
    expect(nor!.car.t.slice(0, 2)).toEqual([100_000, 100_250]);
    expect(nor!.car.t).toHaveLength(1201);
    expect(nor!.car).toMatchObject({ drs: undefined });
    expect(nor!.car.gear.every((gear) => gear === 7)).toBe(true);
    expect(nor!.position.t[0]).toBe(0);
    expect(nor!.driver).toEqual({ number: '1', tla: 'NOR', name: 'Norris', team: 'McLaren', colour: '#F47600' });
    expect(report.session).toEqual({ meeting: 'Singapore Grand Prix', name: 'Race', offsetMs: 8 * 3_600_000 });
  });

  it('starts each lap at its end minus its time', () => {
    expect(collectTelemetry(timeline(), ['1']).drivers[0]!.laps).toEqual([
      { lap: 1, start: 119_900, end: 220_000, time: '1:40.100' },
      { lap: 2, start: 220_200, end: 320_000, time: '1:39.800' },
    ]);
  });

  it('keeps the DRS channel when the session has one', () => {
    expect(collectTelemetry(timeline(true), ['1']).drivers[0]!.car.drs?.[0]).toBe(8);
  });

  it('collects two drivers on one origin, the first as the reference', () => {
    const t = timeline();
    t.insert(carMessages('81', sawtooth, { from: 50, to: 60 }));
    const report = collectTelemetry(t, ['1', '81']);
    expect(report.origin).toBe(T0);
    expect(report.drivers.map(({ driver }) => driver.tla)).toEqual(['NOR', 'PIA']);
    expect(report.drivers[1]!.car.t[0]).toBe(50_000);
  });

  it('leaves out drivers without car data, and explains when none has any', () => {
    const report = collectTelemetry(timeline(), ['1', '81', '3']);
    expect(report.drivers.map(({ driver }) => driver.tla)).toEqual(['NOR']);
    expect(report.skipped).toEqual(['PIA', 'VER']);
    expect(() => collectTelemetry(timeline(), ['81', '3'])).toThrow(TelemetryExportError);
    expect(() => collectTelemetry(timeline(), ['81', '3'])).toThrow('No car telemetry for PIA, VER');
  });
});

describe('sessionDrivers', () => {
  it('lists every driver in timing order', () => {
    expect(sessionDrivers(timeline())).toEqual(['1', '81', '3']);
  });
});

describe('reportLaps', () => {
  it('falls back to the previous end without a time, and to nothing without either', () => {
    const laps = reportLaps(
      [
        { lap: 5, end: T0 + 100, time: undefined },
        { lap: 6, end: T0 + 200, time: undefined },
        { lap: 8, end: T0 + 400, time: undefined },
      ],
      T0,
    );
    expect(laps.map((lap) => lap.start)).toEqual([undefined, 100, undefined]);
  });
});

describe('driverLaps', () => {
  it('ends a lap when NumberOfLaps goes up and attaches a late lap time', () => {
    expect(driverLaps(timeline(), '1')).toEqual([
      { lap: 1, end: T0 + 220_000, time: '1:40.100' },
      { lap: 2, end: T0 + 320_000, time: '1:39.800' },
    ]);
  });

  it('starts counting from a live snapshot instead of marking the laps before it', () => {
    const t = new Timeline();
    t.insert([
      { topic: 'TimingData', utc: T0, data: { Lines: { '1': { NumberOfLaps: 20, LastLapTime: { Value: '1:41.000' } } } } },
      { topic: 'TimingData', utc: T0 + 95_000, data: { Lines: { '1': { NumberOfLaps: 21, LastLapTime: { Value: '1:40.500' } } } } },
    ]);
    expect(driverLaps(t, '1')).toEqual([{ lap: 21, end: T0 + 95_000, time: '1:40.500' }]);
  });
});

describe('report periods', () => {
  it('carries track conditions and qualifying parts relative to the origin', () => {
    const t = timeline();
    t.insert([
      { topic: 'TimingData', utc: T0 + 100_000, data: { SessionPart: 1 } },
      { topic: 'SessionStatus', utc: T0 + 390_000, data: { Status: 'Finished' } },
    ]);
    const report = collectTelemetry(t, ['1']);
    // The origin is T0 (the first position sample). Green at 120 s, SC from 300 s to the end of the data (400 s).
    expect(report.status).toEqual([{ kind: 'sc', from: 300_000, to: 400_000 }]);
    expect(report.parts).toEqual([{ part: 1, label: 'Q1', from: 120_000, to: 390_000 }]);
  });
});

describe('renderTelemetryHtml', () => {
  it('embeds the data so a closing script tag in it cannot end the script', () => {
    const report = collectTelemetry(timeline(), ['1']);
    const html = renderTelemetryHtml({ ...report, session: { ...report.session, meeting: '</script><b>x' } });
    const json = /<script id="data" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1];
    expect(JSON.parse(json!).session.meeting).toBe('</script><b>x');
    expect(html).toContain('<title>NOR telemetry · &#60;/script&#62;&#60;b&#62;x Race</title>');
  });

  it('draws the timeline and lists each driver under the pointer', () => {
    const page = runPage(renderTelemetryHtml(collectTelemetry(timeline(), ['1'])));
    expect(page.calls['stroke']).toBeGreaterThan(0);
    expect(valuesTable(page)).toEqual([
      ['Driver', 'Samples', 'Laps', 'Best'],
      ['NOR', '1,201', '2', '1:39.800'],
    ]);
    page.fire('charts', 'pointermove', { clientX: 400 });
    page.flush();
    expect(readoutText(page)).toMatch(/^\d\d:\d\d:\d\d\.\d{3} · NOR lap \d$/);
    expect(valuesTable(page)[0]).toEqual(['Driver', 'Lap', 'km/h', 'Thr', 'Brk', 'G', 'RPM']);
    expect(valuesTable(page)[1]).toEqual(['NOR', '1', expect.stringMatching(/^[\d.]+$/), '100', '0', '7', '11000']);
  });
});

describe('qualifying parts and track conditions on the page', () => {
  /** The race fixture renumbered as qualifying: Q1 120–250 s, Q2 260–395 s, a double yellow at 150–170 s, SC from 300 s. */
  function qualifying(): Timeline {
    const t = timeline();
    const flag = (seconds: number, value: string) => ({
      topic: 'RaceControlMessages',
      utc: T0 + seconds * 1000,
      data: { Messages: { [String(seconds)]: { Utc: new Date(T0 + seconds * 1000).toISOString(), Category: 'Flag', Flag: value, Scope: 'Sector', Sector: 9 } } },
    });
    t.insert([
      { topic: 'TimingData', utc: T0 + 100_000, data: { SessionPart: 1 } },
      { topic: 'TrackStatus', utc: T0 + 150_000, data: { Status: '2' } },
      flag(150, 'DOUBLE YELLOW'),
      flag(170, 'CLEAR'),
      { topic: 'TrackStatus', utc: T0 + 170_000, data: { Status: '1' } },
      { topic: 'SessionStatus', utc: T0 + 250_000, data: { Status: 'Finished' } },
      { topic: 'TimingData', utc: T0 + 255_000, data: { SessionPart: 2 } },
      { topic: 'SessionStatus', utc: T0 + 260_000, data: { Status: 'Started' } },
      { topic: 'SessionStatus', utc: T0 + 395_000, data: { Status: 'Finished' } },
    ]);
    return t;
  }

  it('lists the parts in the zoom picker and the conditions in the key', () => {
    const page = runPage(renderTelemetryHtml(collectTelemetry(qualifying(), ['1'])));
    const options = page.created('option').map((option) => option.textContent);
    expect(options.slice(0, 2)).toEqual(['Q1', 'Q2']);
    const key = page.el('key').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    expect(key).toBe('Double yellow Safety car Q1 / Q2 start (dashed: end)');
    expect(page.el('key').hidden).toBe(false);
  });

  it('zooms to a part and says which part and condition is under the pointer', () => {
    const page = runPage(renderTelemetryHtml(collectTelemetry(qualifying(), ['1'])));
    page.el('lap').value = 'part:2';
    page.fire('lap', 'change');
    page.flush();
    // 260–395 s with a 2% margin, local time (+8 h).
    expect(readoutText(page)).toBe('20:04:17 – 20:06:37');
    page.fire('charts', 'pointermove', { clientX: 900 - 12 - 100 });
    page.flush();
    expect(readoutText(page)).toMatch(/^20:06:\d\d\.\d{3} · NOR lap 3 · Q2 · Safety car$/);
  });
});

describe('lap comparison', () => {
  /**
   * Lap 1 runs from 100 s to 200 s: 6 km at 60 m/s for NOR. PIA does 54 m/s
   * for the first half of the time and 66 m/s for the second, so PIA reaches
   * 2.7 km five seconds after NOR and both finish together. VER drives 59 m/s
   * from 99 s and finishes a second down.
   */
  function trio(): Timeline {
    const t = new Timeline();
    const lap = (time: string) => ({ NumberOfLaps: 1, LastLapTime: { Value: time } });
    t.insert([
      ...raceMessages(),
      ...carMessages('1', () => 216, { from: 90, to: 210 }),
      ...carMessages('81', (s) => (s < 150 ? 194.4 : 237.6), { from: 90, to: 210 }),
      ...carMessages('3', () => 212.4, { from: 90, to: 210 }),
      { topic: 'TimingData', utc: T0 + 200_000, data: { Lines: { '1': lap('1:40.000'), '81': lap('1:40.000'), '3': lap('1:41.000') } } },
    ]);
    return t;
  }

  /** Pointer x over `metres` into a 6 km lap (see the page's chart margins). */
  const at = (metres: number) => 56 + (metres / 6000) * (900 - 56 - 12);
  const seconds = (cell: string) => Number(cell.replace('−', '-').replace('±', ''));
  const open = (t: Timeline, numbers: string[]) => {
    const page = runPage(renderTelemetryHtml(collectTelemetry(t, numbers)));
    page.fire('tab-compare', 'click');
    page.flush();
    return page;
  };

  it('compares every driver with the reference by distance', () => {
    const page = open(trio(), ['1', '81', '3']);
    expect(readoutText(page)).toBe('NOR L1 1:40.000 reference · 6 km lap');
    expect(valuesTable(page)).toEqual([
      ['Lap', 'Time', 'Gap'],
      ['NOR L1', '1:40.000', '—'],
      ['PIA L1', '1:40.000', '±0.000'],
      ['VER L1', '1:41.000', '+1.000'],
    ]);

    page.fire('charts', 'pointermove', { clientX: at(2700) });
    page.flush();
    expect(readoutText(page)).toBe('2.70 km');
    const [, nor, pia, ver] = valuesTable(page);
    expect(nor!.slice(0, 3)).toEqual(['NOR L1', '—', '216']);
    expect(seconds(pia![1]!)).toBeCloseTo(5, 1);
    expect(seconds(ver![1]!)).toBeCloseTo(0.45, 1);

    page.fire('charts', 'pointermove', { clientX: at(6000) });
    page.flush();
    expect(seconds(valuesTable(page)[2]![1]!)).toBeCloseTo(0, 2);
    expect(seconds(valuesTable(page)[3]![1]!)).toBeCloseTo(1, 2);
  });

  it('draws a team-mate dashed in a different shade', () => {
    const page = open(trio(), ['1', '81', '3']);
    const rows = page.created('div').slice(-3).map((row) => row.innerHTML);
    expect(rows[0]).toContain('border-top-color:#F47600;border-top-style:solid');
    expect(rows[1]).toMatch(/border-top-color:#(?!F47600)[0-9a-f]{6};border-top-style:dashed/);
    expect(rows[2]).toContain('border-top-color:#4781D7;border-top-style:solid');
  });

  it('promotes, removes and adds laps', () => {
    const page = open(trio(), ['1', '81', '3']);
    page.fire('charts', 'pointerleave');
    page.fire(page.byText('Make this the reference').id, 'click');
    page.flush();
    expect(valuesTable(page).slice(1).map((row) => [row[0], row[2]])).toEqual([
      ['VER L1', '—'],
      ['PIA L1', '−1.000'],
      ['NOR L1', '−1.000'],
    ]);

    page.fire(page.byText('Remove this lap').id, 'click');
    page.flush();
    expect(valuesTable(page).slice(1).map((row) => row[0])).toEqual(['VER L1', 'PIA L1']);
    expect(page.byText('Remove this lap').disabled).toBe(true);

    page.fire('add', 'click');
    page.flush();
    expect(valuesTable(page).slice(1).map((row) => row[0])).toEqual(['VER L1', 'PIA L1', 'NOR L1']);
    expect(page.el('add').disabled).toBe(true);
  });

  it('compares two laps of one driver, ending on the official gap', () => {
    const page = open(timeline(), ['1']);
    expect(valuesTable(page).slice(1)).toEqual([
      ['NOR L2', '1:39.800', '—'],
      ['NOR L1', '1:40.100', '+0.300'],
    ]);
    page.fire('charts', 'pointermove', { clientX: 900 });
    page.flush();
    expect(seconds(valuesTable(page)[2]![1]!)).toBeCloseTo(0.3, 3);
  });

  it('turns the comparison off without two usable laps', () => {
    const t = timeline();
    t.insert(carMessages('81', sawtooth, { from: 50, to: 60 }));
    const page = runPage(renderTelemetryHtml(collectTelemetry(t, ['81'])));
    expect(page.el('tab-compare').disabled).toBe(true);
  });

  it('hides and solos drivers on the timeline', () => {
    const page = runPage(renderTelemetryHtml(collectTelemetry(trio(), ['1', '81', '3'])));
    const drivers = () => valuesTable(page).slice(1).map((row) => row[0]);
    expect(drivers()).toEqual(['NOR', 'PIA', 'VER']);
    page.fire(page.byText('Show or hide PIA (double-click: only PIA)').id, 'click');
    page.flush();
    expect(drivers()).toEqual(['NOR', 'VER']);
    page.fire(page.byText('Show or hide VER (double-click: only VER)').id, 'dblclick');
    page.flush();
    expect(drivers()).toEqual(['VER']);
    page.fire(page.byText('All').id, 'click');
    page.flush();
    expect(drivers()).toEqual(['NOR', 'PIA', 'VER']);
  });
});

describe('exportTelemetry', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'exf1lt-telemetry-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('names the file after the session and drivers inside a directory', async () => {
    const t = timeline();
    t.insert(carMessages('81', sawtooth, { from: 50, to: 60 }));
    const { file, skipped } = await exportTelemetry(t, ['1', '81', '3'], join(dir, 'reports'));
    expect(file).toBe(join(dir, 'reports', 'singapore-grand-prix-race-NOR-PIA-telemetry.html'));
    expect(skipped).toEqual(['VER']);
    expect(await readFile(file, 'utf8')).toContain('<span class="tla">PIA</span>');
  });

  it('writes to an .html path as given', async () => {
    const file = join(dir, 'nor.html');
    expect((await exportTelemetry(timeline(), ['1'], file)).file).toBe(file);
  });

  it('falls back to a generic name without session info', () => {
    const report = collectTelemetry(timeline(), ['1']);
    expect(telemetryFileName({ ...report, session: { meeting: '', name: '', offsetMs: 0 } })).toBe('session-NOR-telemetry.html');
    const many = { ...report, drivers: Array.from({ length: 5 }, () => report.drivers[0]!) };
    expect(telemetryFileName(many)).toBe('singapore-grand-prix-race-5-drivers-telemetry.html');
  });
});

describe('telemetry on sparse sessions', () => {
  /** Car data only: no DriverList, SessionInfo or TimingData. */
  function bare(...drivers: string[]): Timeline {
    const t = new Timeline();
    t.insert(drivers.flatMap((driver) => carMessages(driver, sawtooth, { from: 0, to: 2 })));
    return t;
  }

  it('finds drivers by their car data alone, in racing number order', () => {
    const t = bare('44', '12');
    expect(resolveDriver(t, '44')).toBe('44');
    expect(resolveDriver(t, 'HAM')).toBeUndefined();
    expect(sessionDrivers(t)).toEqual(['12', '44']);
  });

  it('names a driver and session it knows nothing about', () => {
    const report = collectTelemetry(bare('44'), ['44']);
    expect(report.session).toEqual({ meeting: 'F1 session', name: '', offsetMs: 0 });
    expect(report.drivers[0]?.driver).toEqual({ number: '44', tla: '44', name: '44', team: '', colour: '#e10600' });
    expect(report.skipped).toEqual([]);
  });

  it('builds a name from first and last name, and fills DRS gaps with zero', () => {
    const t = bare('44');
    t.insert([
      { topic: 'DriverList', utc: T0, data: { '44': { Tla: 'HAM', FirstName: 'Lewis', LastName: 'Hamilton' } } },
      {
        topic: 'CarData',
        utc: T0 + 5_000,
        data: { Entries: [{ Utc: new Date(T0 + 5_000).toISOString(), Cars: { '44': { Channels: { '2': 300, '45': 12 } } } }] },
      },
    ]);
    const [ham] = collectTelemetry(t, ['44']).drivers;
    expect(ham?.driver.name).toBe('Lewis Hamilton');
    expect(ham?.car.drs?.slice(0, 2)).toEqual([0, 0]);
    expect(ham?.car.drs?.at(-1)).toBe(12);
  });

  it('needs at least one driver', () => {
    expect(() => collectTelemetry(bare('44'), [])).toThrow('No drivers to export.');
  });

  it('writes to the current directory by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exf1lt-cwd-'));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const { file } = await exportTelemetry(bare('44'), ['44']);
      expect(file).toBe('f1-session-44-telemetry.html');
      expect(await readFile(join(dir, file), 'utf8')).toContain('<span class="tla">44</span>');
    } finally {
      process.chdir(cwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('titles big reports by count, escapes line separators and leaves out empty names', () => {
    const report = collectTelemetry(bare('1', '2', '3', '4'), ['1', '2', '3', '4']);
    const html = renderTelemetryHtml({ ...report, session: { ...report.session, meeting: 'A B' } });
    expect(html).toContain('<title>4 drivers telemetry · A B</title>');
    expect(html).toContain('A\\u2028B');
    expect(html).not.toContain('class="session">A B ·');

    const two = renderTelemetryHtml(collectTelemetry(bare('1', '2'), ['1', '2']));
    expect(two).toContain('<span class="name">1</span>');
    // A report built by hand with no drivers still has a page colour.
    expect(renderTelemetryHtml({ ...report, drivers: [] })).toContain('--team:#e10600');
  });
});
