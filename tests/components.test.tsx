import type { LiveTimingMessage } from '@exhumer/f1-live-timing';
import { describe, expect, it } from 'vitest';

import type { TokenStatus } from '../src/auth/resolveToken.js';
import { FocusPanel } from '../src/components/FocusPanel.js';
import { HeaderBar } from '../src/components/HeaderBar.js';
import { RaceControlFeed } from '../src/components/RaceControlFeed.js';
import { Scrubber } from '../src/components/Scrubber.js';
import type { Session } from '../src/sources/session.js';
import { frameOf, idlePlayback, sessionOf, T0 } from './helpers.js';

const at = (seconds: number) => T0 + seconds * 1000;
const token = (state: TokenStatus['state'], expiresAt?: number): TokenStatus => ({ token: 'x', source: 'cache', state, expiresAt });

describe('HeaderBar', () => {
  it('waits for a session and shows its status and the weather', () => {
    expect(frameOf(sessionOf([]), <HeaderBar playback={idlePlayback({ playing: true, speed: 2 })} token={undefined} />)).toMatch(
      /Waiting for session…[\s\S]*▶ REPLAY 2×/,
    );
    const frame = frameOf(
      sessionOf([
        { topic: 'SessionStatus', utc: at(0), data: { Status: 'Finished' } },
        { topic: 'ExtrapolatedClock', utc: at(0), data: { Utc: new Date(at(0)).toISOString(), Remaining: '00:10:00', Extrapolating: false } },
        { topic: 'WeatherData', utc: at(0), data: { AirTemp: '30', TrackTemp: '45', Humidity: '70.4', WindSpeed: '1.2', Rainfall: '1' } },
      ]),
      <HeaderBar playback={idlePlayback()} token={undefined} />,
    );
    expect(frame).toContain('[Finished]');
    expect(frame).toContain('⏱ 00:10:00');
    expect(frame).toContain('HUM 70%');
    expect(frame).toContain('RAIN YES');
    const dry = frameOf(
      sessionOf([{ topic: 'WeatherData', utc: at(0), data: { AirTemp: '30', TrackTemp: '45', Humidity: '70', WindSpeed: '1', Rainfall: '0' } }]),
      <HeaderBar playback={idlePlayback()} token={undefined} />,
    );
    expect(dry).toContain('RAIN –');
  });

  it('marks a recording', () => {
    const frame = frameOf(sessionOf([], { kind: 'recording', recordingTo: './rec' }), <HeaderBar playback={idlePlayback()} token={undefined} />);
    expect(frame).toMatch(/❚❚ RECORDING 1× ● REC/);
  });

  it('shows the live connection, how far behind it is, and the token', () => {
    const live = (patch: Partial<Session> = {}) => sessionOf([], { kind: 'live', ...patch });
    const header = (session: Session, playback = idlePlayback(), status: TokenStatus | undefined = undefined) =>
      frameOf(session, <HeaderBar playback={playback} token={status} />);

    expect(header(live({ liveStatus: () => 'reconnecting' }))).toContain('◌ RECONNECTING');
    expect(header(live(), idlePlayback({ following: true }))).toContain('● LIVE');
    expect(header(live(), idlePlayback({ playing: true }))).toMatch(/◀ DELAYED {2}🔑/);
    expect(header(live(), idlePlayback())).toContain('◀ DELAYED (paused)');
    expect(header(live(), idlePlayback(), token('expired'))).toContain('⚠ token expired · no telemetry');
    expect(header(live({ skippedTopics: ['CarData'] }))).toContain('no token · no telemetry');
    expect(header(live(), idlePlayback(), token('expiring', Date.now() + 2 * 86_400_000))).toContain('🔑 expires in 2d');
    expect(header(live(), idlePlayback(), token('expiring'))).toMatch(/🔑\s/);
  });
});

describe('FocusPanel', () => {
  const car = (seconds: number, channels: Record<string, number>): LiveTimingMessage => ({
    topic: 'CarData',
    utc: at(seconds),
    data: { Entries: [{ Utc: new Date(at(seconds)).toISOString(), Cars: { '4': { Channels: channels } } }] },
  });

  it('shows nothing without a driver', () => {
    expect(frameOf(sessionOf([]), <FocusPanel driver={undefined} />)).toBe('');
  });

  it('shows speed, throttle and a 0/1 brake, the tyre and the grid slot', () => {
    const frame = frameOf(
      sessionOf([
        car(0, { '0': 11_000, '2': 290, '3': 7, '4': 100, '5': 1 }),
        { topic: 'TimingAppData', utc: at(0), data: { Lines: { '4': { GridPos: '3', Stints: [{ Compound: 'SOFT', TotalLaps: 4 }] } } } },
      ]),
      <FocusPanel driver="4" />,
    );
    expect(frame).toContain('▌ 4');
    expect(frame).toContain('gear 7');
    expect(frame).toContain('290 km/h ▕██████████▏ THR');
    expect(frame).toContain('11.0k rpm ▕██████████▏ BRK');
    expect(frame).toContain('S 4 laps · grid P3');
  });

  it('says why there is no telemetry', () => {
    expect(frameOf(sessionOf([], { skippedTopics: ['CarData'] }), <FocusPanel driver="4" />)).toContain('no telemetry: needs a token');
    expect(frameOf(sessionOf([]), <FocusPanel driver="4" />)).toMatch(/no telemetry\n– {2}laps/);
  });
});

describe('RaceControlFeed', () => {
  it('says when there are no messages, and leaves out a missing lap', () => {
    expect(frameOf(sessionOf([]), <RaceControlFeed height={6} width={40} />)).toContain('No messages yet.');
    const frame = frameOf(
      sessionOf([{ topic: 'RaceControlMessages', utc: at(0), data: { Messages: [{ Utc: '2026-10-11T12:00:00', Message: 'TRACK CLEAR', Category: 'Flag' }] } }]),
      <RaceControlFeed height={6} width={40} />,
    );
    expect(frame).toContain('12:00 TRACK CLEAR');
  });
});

describe('Scrubber', () => {
  it('draws an empty timeline', () => {
    expect(frameOf(sessionOf([]), <Scrubber playback={idlePlayback({ playing: true })} width={60} />)).toMatch(/▶ 1× {3}12:00:00 L– {2}│━+●│ L–$/);
  });

  it('keeps the worse condition where two share a cell, and ends at the race distance', () => {
    const frame = frameOf(
      sessionOf([
        { topic: 'LapCount', utc: at(0), data: { TotalLaps: 50 } },
        { topic: 'TrackStatus', utc: at(100), data: { Status: '5' } },
        { topic: 'TrackStatus', utc: at(101), data: { Status: '2' } },
        { topic: 'TrackStatus', utc: at(102), data: { Status: '1' } },
        { topic: 'TrackStatus', utc: at(1000), data: { Status: '1' } },
      ]),
      <Scrubber playback={idlePlayback()} width={60} />,
    );
    // The red flag and the yellow after it fall in one cell, which shows the red flag.
    expect(frame).toMatch(/│━+█━+●│ L50$/);
    expect(frame.match(/█/g)).toHaveLength(1);
  });
});
