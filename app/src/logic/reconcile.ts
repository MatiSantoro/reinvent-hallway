// Write, then verify. The API has no idempotency key and a 200 can hide per-session
// failures, so every change here follows the same loop:
//   read GetSchedule -> send only what is missing -> read each per-session result
//   -> on an unknown outcome, re-read GetSchedule instead of repeating the request
//   -> confirm the final state with GetSchedule
import {
  ApiError,
  associateFavorites,
  createPersonalTime,
  deletePersonalTime,
  getSchedule,
  OperationClosed,
  reserveSessions,
  UnknownWriteOutcome,
} from '../api/events';
import type { BulkFailure, PersonalTimeInput, Schedule, Session } from '../api/types';
import { PT_TAG } from '../config';
import { dayKey, fmtDay, fmtRange, fromApiUtc, toApiUtc } from './time';
import type { TravelBlock } from './scheduler';

export interface WriteReport {
  done: string[]; // confirmed by GetSchedule
  failed: BulkFailure[];
  skipped: { sessionId: string; why: string }[];
  closed: boolean; // operation returned 409
  schedule: Schedule; // final state
}

const chunk = <T,>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type Bulk = (eventId: string, ids: string[]) => Promise<{ successful: string[]; failed: BulkFailure[] }>;

async function bulkApply(
  eventId: string,
  wanted: string[],
  op: Bulk,
  present: (s: Schedule) => string[],
  onProgress?: (msg: string) => void
): Promise<WriteReport> {
  let schedule = await getSchedule(eventId);
  const failed = new Map<string, BulkFailure>();
  let closed = false;
  let remaining = wanted.filter((id) => !present(schedule).includes(id));

  for (const batch of chunk(remaining, 10)) {
    // Skip anything that landed earlier (e.g. after an unknown outcome).
    const todo = batch.filter((id) => !present(schedule).includes(id));
    if (!todo.length) continue;
    onProgress?.(`Sending ${todo.length}...`);
    try {
      const r = await op(eventId, todo);
      r.failed.forEach((f) => {
        // "already there" is a success for us.
        if (f.code !== 'alreadyScheduled' && f.code !== 'alreadyFavorited') failed.set(f.sessionId, f);
      });
    } catch (e) {
      if (e instanceof OperationClosed) {
        closed = true;
        break;
      }
      if (e instanceof UnknownWriteOutcome) {
        // Don't repeat the request. Look at what actually happened.
        onProgress?.('No answer from the server, checking your schedule...');
        schedule = await getSchedule(eventId);
        const stillMissing = todo.filter((id) => !present(schedule).includes(id));
        if (stillMissing.length) {
          try {
            const r = await op(eventId, stillMissing);
            r.failed.forEach((f) => {
              if (f.code !== 'alreadyScheduled' && f.code !== 'alreadyFavorited') failed.set(f.sessionId, f);
            });
          } catch (e2) {
            if (!(e2 instanceof UnknownWriteOutcome)) throw e2;
          }
        }
        continue;
      }
      throw e;
    }
  }

  // Source of truth.
  schedule = await getSchedule(eventId);
  const have = new Set(present(schedule));
  const done = wanted.filter((id) => have.has(id));
  remaining = wanted.filter((id) => !have.has(id) && !failed.has(id));
  const skipped = closed ? [] : remaining.map((sessionId) => ({ sessionId, why: 'Not confirmed by the schedule' }));
  return { done, failed: [...failed.values()].filter((f) => !have.has(f.sessionId)), skipped, closed, schedule };
}

export function favoriteAll(eventId: string, ids: string[], onProgress?: (m: string) => void) {
  return bulkApply(eventId, ids, associateFavorites, (s) => s.favorites, onProgress);
}

const SCARCITY: Record<string, number> = { veryLimited: 0, limited: 1, available: 2, unavailable: 3 };

/** Reserves the most wanted-and-scarce sessions first. Walk-up sessions are skipped (no seats to book). */
export async function reserveAll(eventId: string, sessions: Session[], onProgress?: (m: string) => void) {
  const walkUp = sessions.filter((s) => s.seatAvailability === 'walkUp' || s.isReservable === false);
  const toBook = sessions
    .filter((s) => !walkUp.includes(s))
    .sort((a, b) => (SCARCITY[a.seatAvailability || 'available'] ?? 2) - (SCARCITY[b.seatAvailability || 'available'] ?? 2))
    .map((s) => s.sessionId);
  const report = await bulkApply(eventId, toBook, reserveSessions, (s) => s.reserved, onProgress);
  report.skipped.push(...walkUp.map((s) => ({ sessionId: s.sessionId, why: 'Walk-up only, no reservation needed' })));
  return report;
}

// ---------- personal time (travel blocks, group meetups) ----------

export const isOurs = (description: string) => description.includes(PT_TAG);

const same = (a: { startDateTime: string; endDateTime: string; title: string }, b: PersonalTimeInput) =>
  a.startDateTime === b.startDateTime && a.endDateTime === b.endDateTime && a.title === b.title;

export interface PersonalTimeFailure {
  entry: PersonalTimeInput;
  status: number;
  message: string;
}

export interface PersonalTimeOutcome {
  schedule: Schedule;
  failed: PersonalTimeFailure[];
  /** Entries that only went through after dropping the optional location and long description. */
  trimmed: number;
}

/** Same block, with only what the API requires: no location, and a short description that keeps our tags. */
const minimal = (w: PersonalTimeInput): PersonalTimeInput => ({
  startDateTime: w.startDateTime,
  endDateTime: w.endDateTime,
  title: w.title,
  description: `${PT_TAG}${w.description.includes('travel:') ? ' travel:' : ''}`,
});

/**
 * Creates personal-time entries that are not already there. Create returns no body,
 * so we read GetSchedule afterwards. After an unknown outcome we re-read before trying again.
 * One refused entry does not stop the others: it is reported in `failed` with the API's own message.
 */
export async function ensurePersonalTime(eventId: string, wanted: PersonalTimeInput[]): Promise<PersonalTimeOutcome> {
  let schedule = await getSchedule(eventId);
  const failed: PersonalTimeFailure[] = [];
  let trimmed = 0;

  const create = async (w: PersonalTimeInput) => {
    try {
      await createPersonalTime(eventId, w);
    } catch (e) {
      if (!(e instanceof UnknownWriteOutcome)) throw e;
      schedule = await getSchedule(eventId);
      if (!schedule.personalTime.some((p) => same(p, w))) await createPersonalTime(eventId, w).catch(() => {});
    }
  };

  for (const w of wanted) {
    if (schedule.personalTime.some((p) => same(p, w))) continue;
    try {
      await create(w);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 400) throw e;
      // Refused as sent. Try once with only the required fields, so we can tell a bad optional field
      // from a real conflict (e.g. it overlaps something already on the schedule).
      try {
        await create(minimal(w));
        trimmed++;
      } catch (e2) {
        if (!(e2 instanceof ApiError) || e2.status !== 400) throw e2;
        failed.push({ entry: w, status: e2.status, message: e2.message });
      }
    }
  }
  schedule = await getSchedule(eventId);
  return { schedule, failed, trimmed };
}

/** Plain-language summary of a personal-time write, for a banner. */
export function describePersonalTime(o: PersonalTimeOutcome, total: number, tz: string): { ok: boolean; text: string } {
  const lines: string[] = [];
  const added = total - o.failed.length;
  lines.push(
    o.failed.length
      ? `${added} of ${total} walking blocks are on your calendar. ${o.failed.length} refused by the AWS Events API:`
      : `✓ ${total} walking block${total === 1 ? '' : 's'} on your calendar.`
  );
  for (const f of o.failed) {
    const start = fromApiUtc(f.entry.startDateTime);
    const end = fromApiUtc(f.entry.endDateTime);
    lines.push(`✗ "${f.entry.title}" ${fmtDay(dayKey(start, tz))} ${fmtRange({ start, end }, tz)}: ${f.message || `error ${f.status}`}`);
  }
  if (o.trimmed) lines.push(`(${o.trimmed} only worked without the location and details, so those were left off.)`);
  return { ok: o.failed.length === 0, text: lines.join('\n') };
}

export function travelToInput(t: TravelBlock): PersonalTimeInput {
  return {
    startDateTime: toApiUtc(t.start),
    endDateTime: toApiUtc(t.end),
    title: t.title.slice(0, 128),
    description: `${PT_TAG} travel: ${t.fromVenue} to ${t.toVenue}`.slice(0, 250),
    location: t.toVenue.slice(0, 255),
  };
}

/** Makes the travel blocks on the schedule match `blocks`: adds missing ones, removes stale ones we created. */
export async function syncTravelBlocks(eventId: string, blocks: TravelBlock[]): Promise<PersonalTimeOutcome> {
  const wanted = blocks.map(travelToInput);
  const schedule = await getSchedule(eventId);
  const stale = schedule.personalTime.filter(
    (p) => isOurs(p.description) && p.description.includes('travel:') && !wanted.some((w) => same(p, w))
  );
  for (const p of stale) {
    try {
      await deletePersonalTime(eventId, p.personalTimeId);
    } catch (e) {
      if (!(e instanceof UnknownWriteOutcome)) throw e; // reconciled by the next read
    }
  }
  return ensurePersonalTime(eventId, wanted);
}

export const personalInterval = (p: { startDateTime: string; endDateTime: string }) => ({
  start: fromApiUtc(p.startDateTime),
  end: fromApiUtc(p.endDateTime),
});

export const FAILURE_TEXT: Record<string, string> = {
  sessionNotReservable: 'Not reservable',
  scheduleConflict: 'Clashes with your schedule',
  alreadyScheduled: 'Already on your schedule',
  sessionFull: 'Full',
  insufficientAccess: 'Your pass does not include it',
  timePassed: 'Already started',
  alreadyFavorited: 'Already a favorite',
  notFavorited: 'Not a favorite',
  other: 'Refused',
};

export const failureText = (code: string) => FAILURE_TEXT[code] || 'Refused';
