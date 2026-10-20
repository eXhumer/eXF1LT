import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportTelemetry } from '../src/export/telemetry.js';
import { SessionProvider } from '../src/state/SessionContext.js';
import { TimingView } from '../src/views/TimingView.js';
import { eventually, raceTimeline, replaySession, T0 } from './helpers.js';

vi.mock('../src/export/telemetry.js', () => ({ exportTelemetry: vi.fn() }));
const exportMock = vi.mocked(exportTelemetry);

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const DOWN = '\u001B[B';

function mount() {
  const probe = render(<></>);
  vi.spyOn(Object.getPrototypeOf(probe.stdout), 'columns', 'get').mockReturnValue(240);
  probe.unmount();
  // The race fixture's three drivers and a fourth.
  const timeline = raceTimeline();
  timeline.insert([
    { topic: 'DriverList', utc: T0, data: { '44': { RacingNumber: '44', Tla: 'HAM', LastName: 'Hamilton', Line: 4 } } },
    { topic: 'TimingData', utc: T0 + 121_000, data: { Lines: { '44': { RacingNumber: '44', Line: 4, Position: '4' } } } },
  ]);
  return render(
    <SessionProvider session={replaySession(timeline)}>
      <TimingView token={undefined} onQuit={() => undefined} />
    </SessionProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  exportMock.mockReset();
});

describe('TimingView export notices', () => {
  it('counts more than three marked drivers, and clears the notice after a while', async () => {
    exportMock.mockResolvedValue({ file: 'report.html', skipped: [] });
    const { stdin, lastFrame, unmount } = mount();
    await eventually(() => expect(lastFrame()).toContain('HAMILTON'));
    for (const key of ['m', DOWN, 'm', DOWN, 'm', DOWN, 'm']) {
      stdin.write(key);
      await settle();
    }
    await eventually(() => expect(lastFrame()).toContain('export 4 marked'));
    stdin.write('e');
    await eventually(() => expect(lastFrame()).toContain("4 drivers' telemetry saved to report.html"));
    expect(exportMock.mock.calls[0]?.[1]).toEqual(['1', '81', '3', '44']);
    await eventually(() => expect(lastFrame()).toContain('export 4 marked'), 10_000);
    unmount();
  }, 20_000);

  it('shows a failure that is not an Error as text', async () => {
    exportMock.mockRejectedValue('disk full');
    const { stdin, lastFrame, unmount } = mount();
    await eventually(() => expect(lastFrame()).toContain('HAMILTON'));
    stdin.write('e');
    await eventually(() => expect(lastFrame()).toContain('disk full'));
    unmount();
  });
});
