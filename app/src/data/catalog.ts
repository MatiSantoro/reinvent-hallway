// Local catalog cache. The API has no search, so we pull every page once
// and keep it on the phone. Seat bands change, so we refresh when the cache is old.
import { File, Paths } from 'expo-file-system';
import { listAllSessions } from '../api/events';
import type { Session } from '../api/types';

const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface CacheFile {
  eventId: string;
  fetchedAt: number;
  sessions: Session[];
}

const fileFor = (eventId: string) => new File(Paths.document, `catalog-${eventId.replace(/[^a-z0-9_-]/gi, '_')}.json`);

export async function readCachedCatalog(eventId: string): Promise<CacheFile | null> {
  const f = fileFor(eventId);
  if (!f.exists) return null;
  try {
    return JSON.parse(await f.text()) as CacheFile;
  } catch {
    return null;
  }
}

export async function fetchCatalog(
  eventId: string,
  onProgress?: (n: number, total: number) => void
): Promise<CacheFile> {
  const sessions = await listAllSessions(eventId, { onProgress });
  const data: CacheFile = { eventId, fetchedAt: Date.now(), sessions };
  fileFor(eventId).write(JSON.stringify(data));
  return data;
}

export async function loadCatalog(
  eventId: string,
  opts: { force?: boolean; onProgress?: (n: number, total: number) => void } = {}
): Promise<CacheFile> {
  if (!opts.force) {
    const cached = await readCachedCatalog(eventId);
    if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) return cached;
    if (cached) {
      // Serve the old copy if the network is down.
      try {
        return await fetchCatalog(eventId, opts.onProgress);
      } catch {
        return cached;
      }
    }
  }
  return fetchCatalog(eventId, opts.onProgress);
}

export const indexById = (sessions: Session[]) => {
  const m = new Map<string, Session>();
  sessions.forEach((s) => m.set(s.sessionId, s));
  return m;
};
