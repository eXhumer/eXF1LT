import { parseUtc } from '@exhumer/f1-live-timing';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { useEffect, useMemo, useState } from 'react';

import type { TokenStatus } from '../auth/resolveToken.js';
import { exportTelemetry } from '../export/telemetry.js';
import { HeaderBar } from '../components/HeaderBar.js';
import { type Hint, KeyHints } from '../components/KeyHints.js';
import { RaceControlFeed } from '../components/RaceControlFeed.js';
import { Scrubber } from '../components/Scrubber.js';
import { colorProp, flagColor } from '../format/colors.js';
import { clockTime, parseGmtOffset } from '../format/time.js';
import { lapStart } from '../state/laps.js';
import { useSession, useTopic } from '../state/SessionContext.js';
import { buildChampionship } from '../state/championship.js';
import { buildPitStops } from '../state/pitStops.js';
import { buildTimingRows } from '../state/timingRows.js';
import { usePlayback } from '../state/usePlayback.js';
import { CHAMPIONSHIP_TABS, ChampionshipView } from './ChampionshipView.js';
import { LEADERBOARD_TABS, LeaderboardView } from './LeaderboardView.js';
import { PIT_TABS, PitsView } from './PitsView.js';
import { TRACKER_TABS, TrackerView } from './TrackerView.js';

/** `1` Leaderboard and `2` Driver Tracker, as on the official site, then `3` pit stops and tyres and `4` the championship. */
export type SessionScreen = 'leaderboard' | 'tracker' | 'pits' | 'championship';

const SCREENS = ['leaderboard', 'tracker', 'pits', 'championship'] as const satisfies readonly SessionScreen[];

/** Where race control messages go: a side panel, a strip above the footer, or nowhere. */
export const RACE_CONTROL_PLACEMENTS = ['side', 'bottom', 'off'] as const;
export type RaceControlPlacement = (typeof RACE_CONTROL_PLACEMENTS)[number];

export const SIDEBAR_DEFAULT = 36;
export const SIDEBAR_MIN = 28;
export const SIDEBAR_STEP = 4;
/** Width the main view keeps; the race control panel never squeezes it below this. */
export const FULL_TOWER_MIN = 84;
/** Messages in the bottom race control strip. */
const BOTTOM_MESSAGES = 4;

/** Widest the side panel can be in a terminal this wide, or 0 when it does not fit at all. */
export function sidebarMax(columns: number): number {
  const max = columns - FULL_TOWER_MIN;
  return max >= SIDEBAR_MIN ? max : 0;
}

interface Props {
  readonly token: TokenStatus | undefined;
  readonly onQuit: () => void;
  /** Back to the session picker, when the session came from it. */
  readonly onBack?: (() => void) | undefined;
  /** Initial race control placement (`--race-control`). */
  readonly raceControl?: RaceControlPlacement;
  /** Where `e` writes the selected driver's telemetry report (`--export-dir`). */
  readonly exportDir?: string;
}

/** How long the result of an export stays in the footer, unless a key is pressed first. */
const NOTICE_MS = 8_000;

export function TimingView({ token, onQuit, onBack, raceControl = 'side', exportDir = '.' }: Props) {
  const session = useSession();
  const playback = usePlayback();
  const { columns, rows: height } = useWindowSize();
  const timingData = useTopic('TimingData');
  const appData = useTopic('TimingAppData');
  const drivers = useTopic('DriverList');
  const stats = useTopic('TimingStats');
  // Drivers marked with m for the next export, in the order they were marked.
  const [marked, setMarked] = useState<readonly string[]>([]);
  const timingRows = useMemo(
    () =>
      buildTimingRows({ timingData, appData, drivers, stats }).map((row) =>
        marked.includes(row.number) ? { ...row, marked: true } : row,
      ),
    [timingData, appData, drivers, stats, marked],
  );
  const pitSeries = useTopic('PitStopSeries');
  const pitTable = useMemo(() => buildPitStops(timingRows, pitSeries), [timingRows, pitSeries]);
  const prediction = useTopic('ChampionshipPrediction');
  const championship = useMemo(() => buildChampionship(prediction, drivers), [prediction, drivers]);
  const raceLaps = useTopic('LapCount')?.TotalLaps;

  const [screen, setScreen] = useState<SessionScreen>('leaderboard');
  const [leaderboardTab, setLeaderboardTab] = useState(0);
  const [trackerTab, setTrackerTab] = useState(0);
  const [pitTab, setPitTab] = useState(0);
  const [championshipTab, setChampionshipTab] = useState(0);
  const [selected, setSelected] = useState<string | undefined>();
  const [pinned, setPinned] = useState<string | undefined>();
  const [placement, setPlacement] = useState<RaceControlPlacement>(raceControl);
  const [sidebarRequested, setSidebarRequested] = useState(SIDEBAR_DEFAULT);
  const [lapInput, setLapInput] = useState<string | undefined>();
  const [notice, setNotice] = useState<{ text: string; error: boolean } | undefined>();
  const focus = selected ?? timingRows[0]?.number;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const tlaOf = (number: string) => timingRows.find((row) => row.number === number)?.tla ?? number;
  const toggleMark = (number: string) =>
    setMarked((value) => (value.includes(number) ? value.filter((item) => item !== number) : [...value, number]));

  // The marked drivers (the first marked is the reference), or the selected one.
  const exportMarked = () => {
    const numbers = marked.length > 0 ? marked : focus ? [focus] : [];
    if (numbers.length === 0) return;
    const label = numbers.length > 3 ? `${numbers.length} drivers'` : numbers.map(tlaOf).join(', ');
    setNotice({ text: `Exporting ${label} telemetry…`, error: false });
    exportTelemetry(session.timeline, numbers, exportDir).then(
      ({ file, skipped }) =>
        setNotice({
          text: `${label} telemetry saved to ${file}${skipped.length ? ` (no car data for ${skipped.join(', ')})` : ''}`,
          error: false,
        }),
      (error: unknown) => setNotice({ text: error instanceof Error ? error.message : String(error), error: true }),
    );
  };

  const maxSidebar = sidebarMax(columns);
  const showSide = placement === 'side' && maxSidebar > 0;
  // The requested width survives terminal resizes; it is only capped while the terminal is too narrow.
  const sidebarWidth = Math.min(sidebarRequested, maxSidebar);
  const showBottom = placement === 'bottom' || (placement === 'side' && !showSide);
  const showTransport = session.kind !== 'live' || !playback.following;
  const bottomHeight = showBottom ? BOTTOM_MESSAGES + 1 : 0;
  // Header (2) + divider, tab bar, footer divider, transport (1) or nothing, hints.
  const bodyHeight = Math.max(4, height - 2 - 1 - 1 - 1 - (showTransport ? 1 : 0) - 1 - bottomHeight);
  const mainWidth = columns - (showSide ? sidebarWidth : 0);

  const tabs: readonly string[] = {
    leaderboard: LEADERBOARD_TABS,
    tracker: TRACKER_TABS,
    pits: PIT_TABS,
    championship: CHAMPIONSHIP_TABS,
  }[screen];
  const tabIndex = { leaderboard: leaderboardTab, tracker: trackerTab, pits: pitTab, championship: championshipTab }[screen];
  const setTab = { leaderboard: setLeaderboardTab, tracker: setTrackerTab, pits: setPitTab, championship: setChampionshipTab }[
    screen
  ];

  const seekLap = (target: number) => {
    const utc = lapStart(session.timeline, target);
    if (utc !== undefined) playback.seekTo(utc);
  };
  // Read the lap from the cursor, not the last render: frames are throttled,
  // so quick repeated presses would otherwise reuse a stale lap.
  const seekLapBy = (delta: number) => seekLap((session.cursor.get('LapCount')?.CurrentLap ?? 1) + delta);

  useInput((input, key) => {
    if (lapInput !== undefined) {
      if (key.escape) setLapInput(undefined);
      else if (key.return) {
        if (lapInput) seekLap(Number(lapInput));
        setLapInput(undefined);
      } else if (key.backspace || key.delete) setLapInput(lapInput.slice(0, -1));
      else if (/^\d$/.test(input)) setLapInput(lapInput + input);
      return;
    }

    // Any key puts the hints back in place of an export notice.
    setNotice(undefined);
    if (input === 'q') onQuit();
    else if (key.escape && onBack) onBack();
    else if (input === '1') setScreen('leaderboard');
    else if (input === '2') setScreen('tracker');
    else if (input === '3') setScreen('pits');
    else if (input === '4') setScreen('championship');
    else if (key.tab) setTab((index) => (index + (key.shift ? tabs.length - 1 : 1)) % tabs.length);
    else if (key.upArrow || key.downArrow) {
      const index = timingRows.findIndex((row) => row.number === focus);
      const next = timingRows[Math.min(timingRows.length - 1, Math.max(0, index + (key.upArrow ? -1 : 1)))];
      if (next) setSelected(next.number);
    } else if (input === 'h') setPinned((value) => (value === focus ? undefined : focus));
    else if (input === 'r') {
      setPlacement((value) => RACE_CONTROL_PLACEMENTS[(RACE_CONTROL_PLACEMENTS.indexOf(value) + 1) % RACE_CONTROL_PLACEMENTS.length]!);
    } else if ((input === '<' || input === '>') && showSide) {
      // Step from the width on screen, so a capped request does not need extra presses to shrink.
      const next = sidebarWidth + (input === '>' ? SIDEBAR_STEP : -SIDEBAR_STEP);
      setSidebarRequested(Math.min(Math.max(next, SIDEBAR_MIN), maxSidebar));
    } else if (input === ' ') playback.togglePlay();
    else if ((key.leftArrow || key.rightArrow) && key.shift) seekLapBy(key.leftArrow ? -1 : 1);
    else if (input === 'p' || input === 'n') seekLapBy(input === 'p' ? -1 : 1);
    else if (key.leftArrow) playback.seekBy(-5_000);
    else if (key.rightArrow) playback.seekBy(5_000);
    else if (input === ']') playback.faster();
    else if (input === '[') playback.slower();
    else if (input === 'j') setLapInput('');
    else if (input === 'L') playback.goLive();
    else if (input === 'e') exportMarked();
    else if (input === 'm' && focus) toggleMark(focus);
    else if (input === 'M') setMarked([]);
  });

  const hints: Hint[] = [
    ['1-4', 'screen'],
    ['tab', 'view'],
    ['↑↓', 'select'],
  ];
  if (screen === 'tracker') hints.push(['h', pinned ? 'unpin' : 'pin H2H']);
  if (showTransport) {
    hints.push(['space', playback.playing ? 'pause' : 'play'], ['←→', '±5s'], ['p n', '±lap'], ['[ ]', 'speed'], ['j', 'lap']);
  } else {
    hints.push(['space', 'pause'], ['←', 'rewind']);
  }
  if (session.kind === 'live' && !playback.following) hints.push(['L', 'go live']);
  hints.push(['r', `race control: ${placement}`]);
  if (showSide) hints.push(['< >', `width ${sidebarWidth}`]);
  hints.push(['m', 'mark'], ['e', marked.length > 0 ? `export ${marked.length} marked` : 'export']);
  if (marked.length > 0) hints.push(['M', 'clear marks']);
  if (onBack) hints.push(['esc', 'sessions']);
  hints.push(['q', 'quit']);

  return (
    <Box flexDirection="column" height={height}>
      <HeaderBar playback={playback} token={token} />
      <TabBar screen={screen} tabs={tabs} active={tabIndex} width={columns} />
      <Box height={bodyHeight}>
        {screen === 'leaderboard' ? (
          <LeaderboardView
            tab={LEADERBOARD_TABS[leaderboardTab]!}
            rows={timingRows}
            selected={focus}
            width={mainWidth}
            height={bodyHeight}
          />
        ) : screen === 'tracker' ? (
          <TrackerView
            tab={TRACKER_TABS[trackerTab]!}
            rows={timingRows}
            selected={focus}
            pinned={pinned}
            width={mainWidth}
            height={bodyHeight}
            showLatestMessage={placement === 'off'}
          />
        ) : screen === 'pits' ? (
          <PitsView
            tab={PIT_TABS[pitTab]!}
            table={pitTable}
            raceLaps={raceLaps}
            selected={focus}
            width={mainWidth}
            height={bodyHeight}
          />
        ) : (
          <ChampionshipView
            tab={CHAMPIONSHIP_TABS[championshipTab]!}
            championship={championship}
            selected={focus}
            width={mainWidth}
            height={bodyHeight}
          />
        )}
        {showSide ? (
          <Box
            width={sidebarWidth}
            flexDirection="column"
            borderStyle="single"
            borderTop={false}
            borderBottom={false}
            borderRight={false}
            borderDimColor
            paddingLeft={1}
          >
            <RaceControlFeed height={bodyHeight} width={sidebarWidth - 2} />
          </Box>
        ) : null}
      </Box>
      {showBottom ? <RaceControlStrip width={columns} /> : null}
      <Text dimColor>{'─'.repeat(columns)}</Text>
      {showTransport ? <Scrubber playback={playback} width={columns} /> : null}
      {lapInput !== undefined ? (
        <Box paddingX={1}>
          <Text>
            Jump to lap: <Text bold>{lapInput}</Text>
            <Text dimColor>▏ enter go · esc cancel</Text>
          </Text>
        </Box>
      ) : notice ? (
        <Box paddingX={1}>
          <Text wrap="truncate" {...colorProp(notice.error ? '#e8002d' : undefined)}>
            {notice.text}
          </Text>
        </Box>
      ) : (
        <KeyHints hints={hints} />
      )}
    </Box>
  );
}

const SCREEN_LABELS: Record<SessionScreen, string> = {
  leaderboard: 'LEADERBOARD',
  tracker: 'DRIVER TRACKER',
  pits: 'PIT & TYRES',
  championship: 'CHAMPIONSHIP',
};

/**
 * `1 LEADERBOARD  2 DRIVER TRACKER … │ Laps  Sectors  …`, with the active screen and tab highlighted.
 * When the full line does not fit, the other screens shrink to their key.
 */
function TabBar({
  screen,
  tabs,
  active,
  width,
}: {
  screen: SessionScreen;
  tabs: readonly string[];
  active: number;
  width: number;
}) {
  const full = SCREENS.map((name, index) => `${index + 1} ${SCREEN_LABELS[name]}`).join('  ').length + 4 + tabs.join('  ').length;
  const compact = full > width - 2;
  return (
    <Box width={width} paddingX={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderDimColor>
      <Text wrap="truncate">
        {SCREENS.map((name, index) => (
          <Text key={name}>
            {index > 0 ? '  ' : ''}
            <Text dimColor>{index + 1}</Text>
            {name === screen || !compact ? (
              <Text bold {...(name === screen ? { color: '#e10600' } : { dimColor: true })}>
                {' '}
                {SCREEN_LABELS[name]}
              </Text>
            ) : null}
          </Text>
        ))}
        <Text dimColor>  │ </Text>
        {tabs.map((tab, index) => (
          <Text key={tab}>
            {index > 0 ? '  ' : ''}
            <Text {...(index === active ? { bold: true, underline: true } : { dimColor: true })}>{tab}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}

/** The latest race control messages, one per line, above the footer. */
function RaceControlStrip({ width }: { width: number }) {
  const messages = useTopic('RaceControlMessages')?.Messages ?? [];
  const info = useTopic('SessionInfo');
  const offset = parseGmtOffset(info?.GmtOffset);
  const recent = messages.slice(-BOTTOM_MESSAGES).reverse();
  return (
    <Box flexDirection="column" height={BOTTOM_MESSAGES + 1} width={width} paddingX={1}>
      <Text bold dimColor>
        RACE CONTROL
      </Text>
      {recent.length === 0 ? <Text dimColor>No messages yet.</Text> : null}
      {recent.map((message, index) => (
        <Text key={`${message.Utc}-${index}`} wrap="truncate">
          <Text dimColor>
            {message.Lap === undefined ? '    ' : `L${message.Lap}`.padEnd(4)} {clockTime(parseUtc(message.Utc), offset).slice(0, 5)}{' '}
          </Text>
          <Text {...colorProp(flagColor(message.Flag))}>{message.Message}</Text>
        </Text>
      ))}
    </Box>
  );
}
