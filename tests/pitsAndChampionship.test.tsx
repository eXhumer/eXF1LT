import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { SessionProvider } from '../src/state/SessionContext.js';
import { TimingView } from '../src/views/TimingView.js';
import { eventually, raceTimeline, replaySession, T0 } from './helpers.js';

const at = (seconds: number) => T0 + seconds * 1000;

function open(extra: Parameters<ReturnType<typeof raceTimeline>['insert']>[0] = []) {
  const timeline = raceTimeline();
  timeline.insert(extra);
  return render(
    <SessionProvider session={replaySession(timeline)}>
      <TimingView token={undefined} onQuit={() => undefined} />
    </SessionProvider>,
  );
}

const PIT_SERIES = {
  topic: 'PitStopSeries',
  utc: at(250),
  data: {
    PitTimes: {
      '81': [
        { Timestamp: '2026-10-11T12:04:00Z', PitStop: { RacingNumber: '81', PitStopTime: '2.4', PitLaneTime: '23.100', Lap: '12' } },
      ],
    },
  },
};

const PREDICTION = {
  topic: 'ChampionshipPrediction',
  utc: at(250),
  data: {
    Drivers: {
      '1': { RacingNumber: '1', CurrentPosition: 2, PredictedPosition: 1, CurrentPoints: 100, PredictedPoints: 125 },
      '81': { RacingNumber: '81', CurrentPosition: 1, PredictedPosition: 2, CurrentPoints: 110, PredictedPoints: 118 },
    },
    Teams: {
      'McLaren Mercedes': { TeamName: 'McLaren', CurrentPosition: 1, PredictedPosition: 1, CurrentPoints: 210, PredictedPoints: 243 },
    },
  },
};

describe('Pit & Tyres screen (3)', () => {
  it('shows the stop times from an archived session', async () => {
    const { stdin, lastFrame, unmount } = open([PIT_SERIES]);
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('3');
    const frame = await eventually(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('3 PIT & TYRES');
      expect(frame).toMatch(/Pit Stops\s+Tyre History/);
      return frame;
    });
    expect(frame.split('\n').find((line) => line.includes('PIASTRI'))).toMatch(/PIASTRI\s+1\s+2\.4\s+L12\s+2\.4\s+23\.100/);
    expect(frame.split('\n').find((line) => line.includes('NORRIS'))).toMatch(/NORRIS\s+0/);
    expect(frame).not.toContain('Stop times come with archived sessions');
    unmount();
  });

  it('rebuilds the laps from the tyre stints and says why the times are missing', async () => {
    const { stdin, lastFrame, unmount } = open();
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('3');
    const frame = await eventually(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Stop times come with archived sessions');
      return frame;
    });
    // Piastri ran 12 laps on softs before the hards.
    expect(frame.split('\n').find((line) => line.includes('PIASTRI'))).toMatch(/PIASTRI\s+1\s+L12/);
    unmount();
  });

  it('draws the stints as bars with the compound and laps in each', async () => {
    const { stdin, lastFrame, unmount } = open();
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('3');
    await eventually(() => expect(lastFrame()).toMatch(/Pit Stops\s+Tyre History/));
    stdin.write('\t');
    const frame = await eventually(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toContain('TYRE HISTORY');
      return frame;
    });
    const lines = frame.split('\n');
    expect(lines.find((line) => line.includes('PIASTRI'))).toMatch(/S12\s+H18/);
    expect(lines.find((line) => line.includes('NORRIS'))).toMatch(/M18/);
    unmount();
  });
});

describe('Championship screen (4)', () => {
  it('lists the drivers in predicted order with places and points', async () => {
    const { stdin, lastFrame, unmount } = open([PREDICTION]);
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('4');
    const frame = await eventually(() => {
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/Drivers\s+Constructors/);
      expect(frame).toContain('AFTER');
      return frame;
    });
    const lines = frame.split('\n');
    expect(lines.find((line) => line.includes('NORRIS'))).toMatch(/1\s+▲1\s+▌\s+NORRIS\s+McLaren\s+100\s+125\s+\+25/);
    expect(lines.find((line) => line.includes('PIASTRI'))).toMatch(/2\s+▼1\s+▌\s+PIASTRI\s+McLaren\s+110\s+118\s+\+8/);
    unmount();
  });

  it('switches to the constructors with tab', async () => {
    const { stdin, lastFrame, unmount } = open([PREDICTION]);
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('4');
    await eventually(() => expect(lastFrame()).toMatch(/Drivers\s+Constructors/));
    stdin.write('\t');
    await eventually(() => expect(lastFrame()).toMatch(/1\s+-\s+▌\s+McLaren\s+210\s+243\s+\+33/));
    unmount();
  });

  it('waits for the prediction when the feed has none', async () => {
    const { stdin, lastFrame, unmount } = open();
    await eventually(() => expect(lastFrame()).toContain('NORRIS'));
    stdin.write('4');
    await eventually(() => expect(lastFrame()).toContain('Waiting for the championship prediction'));
    unmount();
  });
});
