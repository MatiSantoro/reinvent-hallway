import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth } from '../api/auth';
import { getEvent, getSchedule, listEvents, NotRegistered } from '../api/events';
import type { EventInfo, Schedule, Session } from '../api/types';
import { DEFAULT_EVENT_ID } from '../config';
import { indexById, loadCatalog } from '../data/catalog';
import { DEFAULT_TZ, setApiTimezone } from '../logic/time';

type Status = 'starting' | 'signedOut' | 'loading' | 'ready' | 'notRegistered' | 'error';

interface AppState {
  status: Status;
  error?: string;
  progress?: string;
  email: string | null;
  event: EventInfo | null;
  eventId: string;
  tz: string;
  sessions: Session[];
  byId: Map<string, Session>;
  catalogAt: number;
  schedule: Schedule;
  signIn: () => Promise<void>;
  signOut: (alsoBuilderId: boolean) => Promise<void>;
  refreshSchedule: () => Promise<Schedule>;
  setSchedule: (s: Schedule) => void;
  refreshCatalog: () => Promise<void>;
}

const EMPTY: Schedule = { reserved: [], favorites: [], personalTime: [] };
const Ctx = createContext<AppState | null>(null);

async function findEvent(): Promise<EventInfo | null> {
  try {
    const events = await listEvents();
    const found = events.find((e) => /re:?invent/i.test(e.name) && e.startDate.startsWith('2026'));
    if (found) return found;
  } catch {}
  // Not in the "upcoming" list (or the list failed): ask for it by id.
  try {
    return await getEvent(DEFAULT_EVENT_ID);
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('starting');
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [catalogAt, setCatalogAt] = useState(0);
  const [schedule, setSchedule] = useState<Schedule>(EMPTY);
  const [email, setEmail] = useState<string | null>(null);

  const eventId = event?.eventId || DEFAULT_EVENT_ID;
  const tz = event?.timezone || DEFAULT_TZ;
  // Personal time is read and written on the event's local clock.
  setApiTimezone(tz);
  const byId = useMemo(() => indexById(sessions), [sessions]);

  const boot = useCallback(async (force = false) => {
    setStatus('loading');
    setError(undefined);
    try {
      const ev = await findEvent();
      setEvent(ev);
      const id = ev?.eventId || DEFAULT_EVENT_ID;
      setProgress('Loading your schedule...');
      setSchedule(await getSchedule(id));
      setProgress('Loading the catalog...');
      const cat = await loadCatalog(id, {
        force,
        onProgress: (n, total) => setProgress(`Loading the catalog... ${n} / ${total}`),
      });
      setSessions(cat.sessions);
      setCatalogAt(cat.fetchedAt);
      setEmail(auth.email);
      setStatus('ready');
    } catch (e) {
      if (e instanceof NotRegistered) setStatus('notRegistered');
      else {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    } finally {
      setProgress(undefined);
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (await auth.restore()) await boot();
      else setStatus('signedOut');
    })();
  }, [boot]);

  const value: AppState = {
    status,
    error,
    progress,
    email,
    event,
    eventId,
    tz,
    sessions,
    byId,
    catalogAt,
    schedule,
    signIn: async () => {
      await auth.signIn();
      await boot();
    },
    signOut: async (alsoBuilderId) => {
      await auth.signOut();
      if (alsoBuilderId) await auth.signOutOfBuilderId().catch(() => {});
      setSchedule(EMPTY);
      setStatus('signedOut');
    },
    refreshSchedule: async () => {
      const s = await getSchedule(eventId);
      setSchedule(s);
      return s;
    },
    setSchedule,
    refreshCatalog: () => boot(true),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
