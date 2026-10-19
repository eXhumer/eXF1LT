import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../src/state/SessionContext.js';
import {
  FULL_TOWER_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  SIDEBAR_STEP,
  sidebarMax,
  TimingView,
} from '../src/views/TimingView.js';
import { eventually, raceTimeline, replaySession, T0 } from './helpers.js';

/** For asserting that something did *not* change: give it a chance to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const TAB = '\t';

/** ink-testing-library's stdout is always 100 columns wide; pretend it is `width`. */
function widen(width: number) {
  const probe = render(<Text />);
  const spy = vi.spyOn(Object.getPrototypeOf(probe.stdout), 'columns', 'get').mockReturnValue(width);
  probe.unmount();
  return spy;
}

function view(raceControl?: 'side' | 'bottom' | 'off') {
  const session = replaySession();
  return {
    session,
    ...render(
      <SessionProvider session={session}>
        <TimingView token={undefined} onQuit={() => undefined} {...(raceControl ? { raceControl } : {})} />
      </SessionProvider>,
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TimingView', () => {
  it('opens on the leaderboard Laps tab, like the official site', async () => {
    const { lastFrame, unmount } = view();
    const frame = await eventually(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Singapore Grand Prix · Race');
      expect(frame).toMatch(/NORRIS[\s\S]*PIASTRI[\s\S]*VERSTAPPEN/);
      return frame;
    });
    expect(frame).toContain('LAP 2/62');
    expect(frame).toContain('SAFETY CAR');
    expect(frame).toContain('REPLAY');
    expect(frame).toMatch(/1 LEADERBOARD {2}2 DRIVER TRACKER/);
    expect(frame).toContain('IN PIT');

    // Grid P1 → P2 is one place lost; grid P3 → P1 two gained.
    const lines = frame.split('\n');
    const header = lines.find((line) => line.includes('LAP TIME'))!;
    const pia = lines.find((line) => line.includes('PIASTRI'))!;
    expect(pia).toContain('▼1');
    expect(lines.find((line) => line.includes('NORRIS'))).toContain('▲2');

    // Columns line up with their headers.
    expect(header.indexOf('GAP') + 3).toBe(pia.indexOf('+2.4') + 4);
    expect(header.indexOf('LAP TIME')).toBe(pia.indexOf('1:35.412'));
    expect(header.indexOf('S1')).toBe(pia.indexOf('27.913'));
    unmount();
  });

  it('cycles the leaderboard tabs with tab: sectors, segments, tyres', async () => {
    const { stdin, lastFrame, unmount } = view('off');
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));

    stdin.write(TAB);
    await eventually(() => {
      expect(lastFrame()).toMatch(/BS1[\s\S]*SPD1/);
      expect(lastFrame()).toContain('38.100'); // PIA's best S2
    });

    stdin.write(TAB);
    await eventually(() => {
      expect(lastFrame()).toMatch(/SECTOR 1 NOR/); // fastest first sector
      expect(lastFrame()).toContain('▮▮▮');
    });

    stdin.write(TAB);
    const tyres = await eventually(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/CURRENT[\s\S]*STINT[\s\S]*TOTAL[\s\S]*PREVIOUS/);
      return frame;
    });
    // PIA: hard tyres, 18 laps in this stint, 21 old; a 12-lap soft stint before.
    expect(tyres.split('\n').find((line) => line.includes('PIASTRI'))).toMatch(/H·\s+18\s+21\s+\d+\s+12 S/);

    stdin.write('\u001B[Z'); // shift+tab back to Segments
    await eventually(() => expect(lastFrame()).toContain('SECTOR 1'));
    unmount();
  });

  it('moves race control between the side, the bottom and nowhere with r', async () => {
    widen(130);
    const { stdin, lastFrame, unmount } = view();
    await eventually(() => {
      expect(lastFrame()).toContain('race control: side');
      expect(lastFrame()).toMatch(/│ RACE CONTROL/);
    });

    stdin.write('r');
    await eventually(() => {
      expect(lastFrame()).toContain('race control: bottom');
      expect(lastFrame()).toMatch(/^ RACE CONTROL/m);
      expect(lastFrame()).toContain('SAFETY CAR DEPLOYED');
    });

    stdin.write('r');
    await eventually(() => {
      expect(lastFrame()).toContain('race control: off');
      expect(lastFrame()).not.toContain('SAFETY CAR DEPLOYED');
    });
    unmount();
  });

  it('starts from --race-control and falls back to the bottom when the side does not fit', async () => {
    const { lastFrame, unmount } = view('side'); // 100 columns: no room beside the leaderboard
    await eventually(() => expect(lastFrame()).toContain('SAFETY CAR DEPLOYED'));
    expect(lastFrame()).not.toContain('│ RACE CONTROL');
    unmount();
  });

  it('resizes the race control side panel with < and >', async () => {
    widen(130);
    const max = sidebarMax(130);
    const { stdin, lastFrame, unmount } = view();
    await eventually(() => expect(lastFrame()).toContain(`width ${SIDEBAR_DEFAULT}`));

    // One press at a time, each confirmed on screen before the next.
    let width = SIDEBAR_DEFAULT;
    while (width < max) {
      width = Math.min(width + SIDEBAR_STEP, max);
      stdin.write('>');
      await eventually(() => expect(lastFrame()).toContain(`width ${width}`));
    }
    stdin.write('>'); // already as wide as the leaderboard allows
    await settle();
    expect(lastFrame()).toContain(`width ${max}`);

    while (width > SIDEBAR_MIN) {
      width = Math.max(width - SIDEBAR_STEP, SIDEBAR_MIN);
      stdin.write('<');
      await eventually(() => expect(lastFrame()).toContain(`width ${width}`));
    }
    stdin.write('<');
    await settle();
    expect(lastFrame()).toContain(`width ${SIDEBAR_MIN}`);
    unmount();
  });

  it('caps the side panel to the terminal and hides it when it cannot fit', () => {
    expect(sidebarMax(FULL_TOWER_MIN + SIDEBAR_MIN - 1)).toBe(0);
    expect(sidebarMax(FULL_TOWER_MIN + SIDEBAR_MIN)).toBe(SIDEBAR_MIN);
    expect(sidebarMax(200)).toBe(200 - FULL_TOWER_MIN);
  });

  it('seeks by lap with p and n', async () => {
    const { session, stdin, lastFrame, unmount } = view();
    await eventually(() => expect(lastFrame()).toContain('LAP 2/62'));
    stdin.write('n');
    await eventually(() => expect(session.cursor.get('LapCount')?.CurrentLap).toBe(3));
    stdin.write('p');
    await eventually(() => expect(session.cursor.get('LapCount')?.CurrentLap).toBe(2));
    stdin.write('p');
    await eventually(() => expect(session.cursor.get('LapCount')?.CurrentLap).toBe(1));
    // The header catches up on the next throttled frame.
    await eventually(() => expect(lastFrame()).toContain('LAP 1/62'));
    unmount();
  });
});

describe('TimingView telemetry export', () => {
  it('e saves the selected driver telemetry and says where', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exf1lt-export-'));
    try {
      const timeline = raceTimeline();
      timeline.insert(
        [0, 250, 500].map((ms) => ({
          topic: 'CarData',
          utc: T0 + 200_000 + ms,
          data: { Entries: [{ Utc: new Date(T0 + 200_000 + ms).toISOString(), Cars: { '1': { Channels: { '2': 250, '3': 7 } } } }] },
        })),
      );
      widen(220);
      const session = replaySession(timeline);
      const { stdin, lastFrame, unmount } = render(
        <SessionProvider session={session}>
          <TimingView token={undefined} onQuit={() => undefined} exportDir={dir} />
        </SessionProvider>,
      );
      await eventually(() => expect(lastFrame()).toContain('e export'));
      stdin.write('e');
      const file = join(dir, 'singapore-grand-prix-race-NOR-telemetry.html');
      await eventually(() => expect(lastFrame()).toContain(`NOR telemetry saved to ${file}`));
      expect(await readFile(file, 'utf8')).toContain('<span class="tla">NOR</span>');

      // Mark NOR and PIA: e exports the marked drivers and names the one without car data.
      stdin.write('m');
      await eventually(() => expect(lastFrame()).toMatch(/●\s*NOR/));
      stdin.write('\u001B[B');
      await settle();
      stdin.write('m');
      await eventually(() => expect(lastFrame()).toContain('export 2 marked'));
      expect(lastFrame()).toContain('M clear marks');
      stdin.write('e');
      await eventually(() => expect(lastFrame()).toContain(`NOR, PIA telemetry saved to ${file} (no car data for PIA)`));
      stdin.write('M');
      await eventually(() => expect(lastFrame()).not.toMatch(/●\s*(NOR|PIA)/));

      // With no marks, e exports the selected PIA, who has no car data: the footer says why.
      stdin.write('e');
      await eventually(() => expect(lastFrame()).toContain('No car telemetry for PIA'));
      unmount();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('TimingView scrubber', () => {
  it('draws qualifying parts and track conditions into the bar', async () => {
    const timeline = raceTimeline();
    timeline.insert([
      { topic: 'TimingData', utc: T0 + 100_000, data: { SessionPart: 1 } },
      {
        topic: 'RaceControlMessages',
        utc: T0 + 150_000,
        data: { Messages: { '1': { Utc: '2026-10-11T12:02:30', Category: 'Flag', Flag: 'DOUBLE YELLOW', Scope: 'Sector', Sector: 4 } } },
      },
      { topic: 'TrackStatus', utc: T0 + 150_000, data: { Status: '2' } },
      { topic: 'TrackStatus', utc: T0 + 180_000, data: { Status: '1' } },
      { topic: 'SessionStatus', utc: T0 + 200_000, data: { Status: 'Finished' } },
      { topic: 'TimingData', utc: T0 + 205_000, data: { SessionPart: 2 } },
      { topic: 'SessionStatus', utc: T0 + 210_000, data: { Status: 'Started' } },
    ]);
    const { lastFrame, unmount } = render(
      <SessionProvider session={replaySession(timeline)}>
        <TimingView token={undefined} onQuit={() => undefined} />
      </SessionProvider>,
    );
    const frame = await eventually(() => {
      const frame = lastFrame() ?? '';
      // The double yellow (═) sits between Q1 and Q2; the safety car (═) runs from after Q2 through the playhead.
      expect(frame).toMatch(/│━+Q1━+═+━+Q2━+═+●═+│ L3/);
      return frame;
    });
    // The bar is one line: nothing is drawn under it any more.
    const lines = frame.split('\n');
    const bar = lines.findIndex((line) => line.includes('Q1'));
    expect(lines[bar + 1]).toMatch(/^ 1-4 screen/);
    unmount();
  });
});
