import type { ArchiveClient } from '@exhumer/f1-live-timing';
import { Box, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError } from './archive/describeError.js';
import type { TokenStatus } from './auth/resolveToken.js';
import { openLive } from './sources/live.js';
import { type LoadProgress, openRecording, openReplay } from './sources/replay.js';
import type { Session } from './sources/session.js';
import { SessionProvider } from './state/SessionContext.js';
import type { TvSchedule } from './archive/f1tvSchedule.js';
import { type PickResult, PickerView } from './views/PickerView.js';
import { type RaceControlPlacement, TimingView } from './views/TimingView.js';

export type StartSource =
  | { readonly kind: 'picker' }
  | { readonly kind: 'live'; readonly recordDir?: string | undefined }
  | { readonly kind: 'replay'; readonly path: string }
  | { readonly kind: 'recording'; readonly dir: string };

type Screen =
  | { readonly name: 'picker' }
  | { readonly name: 'loading'; readonly label: string; readonly progress?: LoadProgress }
  | { readonly name: 'session'; readonly session: Session }
  | { readonly name: 'error'; readonly message: string };

interface Props {
  readonly archive: ArchiveClient;
  /** F1TV's schedule, for seasons whose archive index is incomplete. */
  readonly schedule?: TvSchedule | undefined;
  readonly start: StartSource;
  readonly token: TokenStatus | undefined;
  /** Where race control messages start out (`--race-control`). */
  readonly raceControl?: RaceControlPlacement;
  /** For tests: open a session without the network. */
  readonly openSession?: (source: StartSource, onProgress: (progress: LoadProgress) => void) => Promise<Session>;
}

export function App({ archive, schedule, start, token, openSession, raceControl = 'side' }: Props) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(
    start.kind === 'picker' ? { name: 'picker' } : { name: 'loading', label: labelOf(start) },
  );
  const sessionRef = useRef<Session | undefined>(undefined);
  const fromPicker = useRef(start.kind === 'picker');

  const open = useCallback(
    (source: StartSource) => {
      setScreen({ name: 'loading', label: labelOf(source) });
      const onProgress = (progress: LoadProgress) =>
        setScreen({ name: 'loading', label: labelOf(source), progress });
      const opener = openSession ?? ((s: StartSource, p: (progress: LoadProgress) => void) => defaultOpen(archive, token, s, p));
      opener(source, onProgress)
        .then((session) => {
          sessionRef.current = session;
          setScreen({ name: 'session', session });
        })
        .catch((error: unknown) => setScreen({ name: 'error', message: describeError(error) }));
    },
    [archive, token, openSession],
  );

  useEffect(() => {
    if (start.kind !== 'picker') open(start);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closeSession = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = undefined;
    await session?.close();
  }, []);

  const quit = useCallback(() => {
    void closeSession().finally(() => exit());
  }, [closeSession, exit]);

  const back = useCallback(() => {
    void closeSession();
    setScreen({ name: 'picker' });
  }, [closeSession]);

  const pick = useCallback(
    (result: PickResult) => open(result.kind === 'live' ? { kind: 'live' } : { kind: 'replay', path: result.path }),
    [open],
  );

  switch (screen.name) {
    case 'picker':
      return <PickerView archive={archive} schedule={schedule} token={token} onPick={pick} onQuit={quit} />;
    case 'loading':
      return <Loading label={screen.label} progress={screen.progress} onQuit={quit} />;
    case 'error':
      return <ErrorScreen message={screen.message} onBack={fromPicker.current ? back : undefined} onQuit={quit} />;
    case 'session':
      return (
        <SessionProvider session={screen.session}>
          <TimingView
            token={token}
            onQuit={quit}
            onBack={fromPicker.current ? back : undefined}
            raceControl={raceControl}
          />
        </SessionProvider>
      );
  }
}

function defaultOpen(
  archive: ArchiveClient,
  token: TokenStatus | undefined,
  source: StartSource,
  onProgress: (progress: LoadProgress) => void,
): Promise<Session> {
  switch (source.kind) {
    case 'live':
      return openLive({ authToken: token?.token, recordDir: source.recordDir });
    case 'replay':
      return openReplay(archive, source.path, onProgress);
    case 'recording':
      return openRecording(source.dir);
    case 'picker':
      throw new Error('The picker is not a session.');
  }
}

function labelOf(source: StartSource): string {
  switch (source.kind) {
    case 'live':
      return 'Connecting to the live feed';
    case 'replay':
      return `Loading ${source.path}`;
    case 'recording':
      return `Loading recording ${source.dir}`;
    case 'picker':
      return '';
  }
}

function Loading({ label, progress, onQuit }: { label: string; progress: LoadProgress | undefined; onQuit: () => void }) {
  useInput((input) => {
    if (input === 'q') onQuit();
  });
  const width = 30;
  const filled = progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * width) : 0;
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text>
        <Text bold color="#e10600">eXF1LT</Text> {label}…
      </Text>
      {progress ? (
        <Text>
          topics {progress.loaded}/{progress.total} <Text color="#e10600">{'▓'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(width - filled)}</Text>
          {progress.topic ? <Text dimColor> {progress.topic}</Text> : null}
        </Text>
      ) : null}
    </Box>
  );
}

function ErrorScreen({ message, onBack, onQuit }: { message: string; onBack: (() => void) | undefined; onQuit: () => void }) {
  useInput((input, key) => {
    if (input === 'q') onQuit();
    else if (key.escape && onBack) onBack();
  });
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="#e8002d">✖ {message}</Text>
      <Text dimColor>{onBack ? 'esc back to sessions · ' : ''}q quit</Text>
    </Box>
  );
}
