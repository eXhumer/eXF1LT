import { Box, Text } from 'ink';

import { trackStatusStyle } from '../format/colors.js';
import { clockTime, parseGmtOffset, remainingAt } from '../format/time.js';
import type { TokenStatus } from '../auth/resolveToken.js';
import { useSession, useTopic } from '../state/SessionContext.js';
import type { Playback } from '../state/usePlayback.js';

export function HeaderBar({ playback, token }: { playback: Playback; token: TokenStatus | undefined }) {
  const session = useSession();
  const info = useTopic('SessionInfo');
  const lap = useTopic('LapCount');
  const track = useTopic('TrackStatus');
  const clock = useTopic('ExtrapolatedClock');
  const weather = useTopic('WeatherData');
  const status = useTopic('SessionStatus');
  const time = session.cursor.time;
  const style = trackStatusStyle(track?.Status);
  const remaining = remainingAt(clock, time);
  const title = info ? `${info.Meeting.Name} · ${info.Name}` : 'Waiting for session…';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          <Text bold color="#e10600">eXF1LT</Text>
          <Text>  {title}</Text>
          {status?.Status && status.Status !== 'Started' ? <Text dimColor>  [{status.Status}]</Text> : null}
        </Text>
        <Text>
          <ModeBadge playback={playback} />
          {session.recordingTo ? <Text color="#e8002d"> ● REC</Text> : null}
          <AuthBadge token={token} />
          <Text>  {clockTime(time, parseGmtOffset(info?.GmtOffset))}</Text>
          <Text dimColor> local</Text>
        </Text>
      </Box>
      <Text>
        {lap ? <Text bold>LAP {lap.CurrentLap}/{lap.TotalLaps}</Text> : null}
        {remaining ? <Text>   ⏱ {remaining}</Text> : null}
        <Text>   </Text>
        <Text color={style.alarm ? 'black' : style.color} {...(style.alarm ? { backgroundColor: style.color } : {})}>
          {style.alarm ? ` ${style.label} ` : `■ ${style.label}`}
        </Text>
        {weather ? (
          <Text dimColor>
            {'   '}AIR {weather.AirTemp}°  TRK {weather.TrackTemp}°  HUM {Math.round(Number(weather.Humidity))}%  WIND{' '}
            {weather.WindSpeed}m/s  RAIN {weather.Rainfall === '0' ? '–' : 'YES'}
          </Text>
        ) : null}
      </Text>
    </Box>
  );
}

function ModeBadge({ playback }: { playback: Playback }) {
  const session = useSession();
  if (session.kind === 'live') {
    const status = session.liveStatus?.() ?? 'connected';
    if (status !== 'connected') return <Text color="#ffd12e">◌ {status.toUpperCase()}</Text>;
    if (playback.following) return <Text color="#e8002d">● LIVE</Text>;
    return <Text color="#ffd12e">◀ DELAYED{playback.playing ? '' : ' (paused)'}</Text>;
  }
  const label = session.kind === 'replay' ? 'REPLAY' : 'RECORDING';
  return (
    <Text color="#3d9be9">
      {playback.playing ? '▶' : '❚❚'} {label} {playback.speed}×
    </Text>
  );
}

function AuthBadge({ token }: { token: TokenStatus | undefined }) {
  const session = useSession();
  if (session.kind !== 'live') return null;
  if (token?.state === 'expired') return <Text color="#ffd12e">  ⚠ token expired · no telemetry</Text>;
  if (session.skippedTopics.length > 0) return <Text dimColor>  no token · no telemetry</Text>;
  if (token?.state === 'expiring' && token.expiresAt) {
    const days = Math.max(0, Math.round((token.expiresAt - Date.now()) / 86_400_000));
    return <Text dimColor>  🔑 expires in {days}d</Text>;
  }
  return <Text>  🔑</Text>;
}
