import type { Topic, TopicState } from '@exhumer/f1-live-timing';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { Session } from '../sources/session.js';
import { FrameStore } from './frame.js';

interface SessionContextValue {
  readonly session: Session;
  readonly frames: FrameStore;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  const frames = useMemo(() => new FrameStore(), [session]);
  useEffect(() => {
    const unwatch = frames.watch(session.cursor);
    const unstatus = session.subscribeLiveStatus?.(() => frames.bump());
    return () => {
      unwatch();
      unstatus?.();
      frames.dispose();
    };
  }, [session, frames]);
  const value = useMemo(() => ({ session, frames }), [session, frames]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.');
  return value;
}

/** The session, re-rendering the caller on every (throttled) cursor frame. */
export function useSession(): Session {
  const { session, frames } = useSessionContext();
  useSyncExternalStore(frames.subscribe, frames.getVersion);
  return session;
}

/** A topic's merged state at the cursor. */
export function useTopic<T extends Topic>(topic: T): TopicState<T> | undefined {
  return useSession().cursor.get(topic);
}
