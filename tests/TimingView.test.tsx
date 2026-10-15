import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../src/state/SessionContext.js';
import { FULL_TOWER_MIN, SIDEBAR_DEFAULT, SIDEBAR_MIN, sidebarMax, TimingView } from '../src/views/TimingView.js';
import { replaySession } from './helpers.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
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
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Singapore Grand Prix · Race');
    expect(frame).toContain('LAP 2/62');
    expect(frame).toContain('SAFETY CAR');
    expect(frame).toContain('REPLAY');
    expect(frame).toMatch(/1 LEADERBOARD {2}2 DRIVER TRACKER/);
    expect(frame).toMatch(/NORRIS[\s\S]*PIASTRI[\s\S]*VERSTAPPEN/);
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
    await tick();

    stdin.write(TAB);
    await tick();
    expect(lastFrame()).toMatch(/BS1[\s\S]*SPD1/);
    expect(lastFrame()).toContain('38.100'); // PIA's best S2

    stdin.write(TAB);
    await tick();
    expect(lastFrame()).toMatch(/SECTOR 1 NOR/); // fastest first sector
    expect(lastFrame()).toContain('▮▮▮');

    stdin.write(TAB);
    await tick();
    const tyres = lastFrame() ?? '';
    expect(tyres).toMatch(/CURRENT[\s\S]*STINT[\s\S]*TOTAL[\s\S]*PREVIOUS/);
    // PIA: hard tyres, 18 laps in this stint, 21 old; a 12-lap soft stint before.
    expect(tyres.split('\n').find((line) => line.includes('PIASTRI'))).toMatch(/H·\s+18\s+21\s+\d+\s+12 S/);

    stdin.write('\u001B[Z'); // shift+tab back to Segments
    await tick();
    expect(lastFrame()).toContain('SECTOR 1');
    unmount();
  });

  it('moves race control between the side, the bottom and nowhere with r', async () => {
    const columns = widen(130);
    const { stdin, lastFrame, unmount } = view();
    await tick();
    expect(lastFrame()).toContain('race control: side');
    expect(lastFrame()).toMatch(/│ RACE CONTROL/);

    stdin.write('r');
    await tick();
    expect(lastFrame()).toContain('race control: bottom');
    expect(lastFrame()).toMatch(/^ RACE CONTROL/m);
    expect(lastFrame()).toContain('SAFETY CAR DEPLOYED');

    stdin.write('r');
    await tick();
    expect(lastFrame()).toContain('race control: off');
    expect(lastFrame()).not.toContain('SAFETY CAR DEPLOYED');
    unmount();
    columns.mockRestore();
  });

  it('starts from --race-control and falls back to the bottom when the side does not fit', async () => {
    const { lastFrame, unmount } = view('side'); // 100 columns: no room beside the leaderboard
    await tick();
    expect(lastFrame()).toContain('SAFETY CAR DEPLOYED');
    expect(lastFrame()).not.toContain('│ RACE CONTROL');
    unmount();
  });

  it('resizes the race control side panel with < and >', async () => {
    const columns = widen(130);
    const { stdin, lastFrame, unmount } = view();
    await tick();
    expect(lastFrame()).toContain(`width ${SIDEBAR_DEFAULT}`);

    for (let press = 0; press < 5; press += 1) {
      stdin.write('>');
      await tick();
    }
    expect(lastFrame()).toContain(`width ${sidebarMax(130)}`);

    for (let press = 0; press < 10; press += 1) {
      stdin.write('<');
      await tick();
    }
    expect(lastFrame()).toContain(`width ${SIDEBAR_MIN}`);
    unmount();
    columns.mockRestore();
  });

  it('caps the side panel to the terminal and hides it when it cannot fit', () => {
    expect(sidebarMax(FULL_TOWER_MIN + SIDEBAR_MIN - 1)).toBe(0);
    expect(sidebarMax(FULL_TOWER_MIN + SIDEBAR_MIN)).toBe(SIDEBAR_MIN);
    expect(sidebarMax(200)).toBe(200 - FULL_TOWER_MIN);
  });

  it('seeks by lap with p and n', async () => {
    const { session, stdin, lastFrame, unmount } = view();
    await tick();
    stdin.write('n');
    await tick();
    expect(session.cursor.get('LapCount')?.CurrentLap).toBe(3);
    stdin.write('p');
    await tick();
    stdin.write('p');
    await tick();
    expect(session.cursor.get('LapCount')?.CurrentLap).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lastFrame()).toContain('LAP 1/62');
    unmount();
  });
});
