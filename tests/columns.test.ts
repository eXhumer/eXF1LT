import { describe, expect, it } from 'vitest';

import { fitSpans, type Span, windowAround } from '../src/components/Table.js';
import type { TimingRow } from '../src/state/timingRows.js';
import * as col from '../src/views/columns.js';

const ROW: TimingRow = {
  number: '4',
  tla: 'NOR',
  lastName: 'NORRIS',
  teamColour: '#F47600',
  position: '1',
  gap: '',
  interval: '+0.4',
  catching: false,
  last: { value: '1:35.0', tone: 'normal' },
  best: '',
  sectors: [],
  bestSectors: [],
  speeds: [],
  gridPosition: undefined,
  positionChange: undefined,
  lapsDown: undefined,
  stint: undefined,
  previousStints: [],
  compound: undefined,
  tyreAge: undefined,
  pits: undefined,
  status: 'running',
  dim: false,
  cutoff: false,
};

const row = (patch: Partial<TimingRow>): TimingRow => ({ ...ROW, ...patch });
const text = (spans: Span | readonly Span[]) => [spans].flat().map((item) => item.text).join('');

describe('columns', () => {
  it('blanks the position of stopped and retired cars and marks them in the team bar and lap time', () => {
    expect(text(col.position.render(row({ status: 'stopped' })))).toBe('');
    expect(text(col.position.render(row({ status: 'retired' })))).toBe('');
    expect(text(col.position.render(ROW))).toBe('1');
    expect(col.teamBar.render(row({ status: 'retired' }))).toEqual({ text: '✕', color: '#e8002d' });
    expect(col.teamBar.render(row({ marked: true }))).toEqual({ text: '●', color: '#F47600', bold: true });
    expect(text(col.lapTime.render(row({ status: 'stopped' })))).toBe('STOP');
    expect(text(col.lapTime.render(ROW))).toBe('1:35.0');
  });

  it('shows the pit lane in place of the interval, and green while catching', () => {
    expect(text(col.interval.render(row({ status: 'pit' })))).toBe('IN PIT');
    expect(text(col.interval.render(row({ status: 'pitout' })))).toBe('PIT OUT');
    expect(col.interval.render(row({ catching: true }))).toEqual({ text: '+0.4', color: '#23c552' });
    expect(col.interval.render(ROW)).toEqual({ text: '+0.4', color: undefined });
  });

  it('leaves out sectors, best sectors and speeds a row does not have', () => {
    for (const column of [col.sector(0), col.bestSector(1), col.speed(2), col.segments(0, undefined, 3)]) {
      expect(text(column.render(ROW)).trim()).toBe('');
    }
    expect(col.segments(0, undefined, 3).headerNote).toBeUndefined();
    expect(col.segments(0, 'NOR', 3).headerNote).toEqual({ text: 'NOR', color: '#b138dd', bold: true });
    const filled = row({
      sectors: [{ value: '28.1', tone: 'overall', segments: [2049, 2051] }],
      speeds: [{ value: '301', tone: 'personal' }],
    });
    expect(text(col.sector(0).render(filled))).toBe('28.1');
    expect(text(col.speed(0).render(filled))).toBe('301');
    expect(text(col.segments(0, undefined, 3).render(filled))).toBe('▮▮  28.1');
  });

  it('shows places gained, lost and held, and the pit count', () => {
    expect(text(col.positionChange.render(row({ positionChange: 2 })))).toBe('▲2');
    expect(text(col.positionChange.render(row({ positionChange: -3 })))).toBe('▼3');
    expect(text(col.positionChange.render(row({ positionChange: 0 })))).toBe('-0');
    expect(text(col.positionChange.render(ROW))).toBe('');
    expect(text(col.pits.render(row({ pits: 2 })))).toBe('2');
    expect(text(col.pits.render(ROW))).toBe('');
  });

  it('marks earlier stints of an unknown or missing compound with a question mark', () => {
    const previous = col.previousStints(10).render(
      row({
        previousStints: [
          { compound: 'TEST', isNew: true, laps: 5, age: 5 },
          { compound: '', isNew: true, laps: 2, age: 2 },
        ],
      }),
    );
    expect(text(previous)).toBe('  2 ?   5 ? ');
  });
});

describe('table helpers', () => {
  it('cuts spans that do not fit and pads to the width', () => {
    expect(fitSpans([{ text: 'abc' }, { text: 'def' }, { text: 'ghi' }], 3)).toEqual([{ text: 'abc' }, { text: '' }]);
    expect(fitSpans([{ text: 'ab' }], 4, 'right')).toEqual([{ text: '  ' }, { text: 'ab' }]);
  });

  it('keeps the selected item in view, near the middle when it can', () => {
    const items = Array.from({ length: 10 }, (_, index) => index);
    expect(windowAround(items, 0, 20)).toEqual(items);
    expect(windowAround(items, 5, 3)).toEqual([4, 5, 6]);
    expect(windowAround(items, -1, 3)).toEqual([0, 1, 2]);
    expect(windowAround(items, 9, 3)).toEqual([7, 8, 9]);
  });
});
