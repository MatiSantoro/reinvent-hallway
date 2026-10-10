// REST client for the AWS Events API. Covers all 12 operations.
// Error rules from the developer guide:
//  401 -> refresh once, retry once
//  403 with JSON -> not registered (don't retry), 403 without body -> edge refusal (slow down, retry)
//  409 -> operation closed for now (e.g. reservations before Oct 8)
//  429 -> wait Retry-After seconds
//  500/503 -> back off on reads; on writes the outcome is unknown, reconcile with GetSchedule
import { EVENTS_API } from '../config';
import { auth } from './auth';
import type {
  BulkResult,
  EventInfo,
  PersonalTimeInput,
  Schedule,
  Session,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export class NotRegistered extends ApiError {
  constructor(msg: string) {
    super(403, msg || 'You are signed in but not registered for this event');
  }
}
export class OperationClosed extends ApiError {
  constructor(msg: string) {
    super(409, msg || 'This operation is closed right now');
  }
}
/** A write that may or may not have happened. Never repeat it blindly: read GetSchedule first. */
export class UnknownWriteOutcome extends Error {
  constructor(public cause?: unknown) {
    super('The server did not confirm this change. Checking your schedule...');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  authed?: boolean;
  write?: boolean;
}

async function call(path: string, opts: CallOpts = {}): Promise<Response> {
  const { method = 'GET', body, authed = true, write = method !== 'GET' } = opts;
  let refreshed = false;
  let attempt = 0;

  for (;;) {
    attempt++;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // The token goes only to api.awsevents.com, nowhere else.
    if (authed) headers.Authorization = `Bearer ${await auth.getAccessToken()}`;

    let res: Response;
    try {
      res = await fetch(`${EVENTS_API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if (write) throw new UnknownWriteOutcome(e);
      if (attempt >= 4) throw e;
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (res.ok) return res;

    const text = await res.text();
    let message = '';
    try {
      message = JSON.parse(text).message || '';
    } catch {}

    switch (res.status) {
      case 401:
        if (authed && !refreshed) {
          refreshed = true;
          await auth.refresh();
          continue;
        }
        throw new ApiError(401, 'Please sign in again');
      case 403:
        if (text.trim()) throw new NotRegistered(message);
        // Edge refusal without a body: slow down and retry.
        if (attempt >= 3) throw new ApiError(403, 'Request refused, try again in a moment');
        await sleep(2000 * attempt);
        continue;
      case 409:
        throw new OperationClosed(message);
      case 429: {
        // A refused request spends no quota and changes nothing, so retrying is safe.
        const wait = Number(res.headers.get('Retry-After') || '5');
        if (attempt >= 4) throw new ApiError(429, 'Too many requests, try again in a minute');
        await sleep(Math.min(Math.max(wait, 1), 60) * 1000);
        continue;
      }
      case 500:
      case 503:
        if (write) throw new UnknownWriteOutcome(new ApiError(res.status, message));
        if (attempt >= 4) throw new ApiError(res.status, message || 'Service unavailable');
        await sleep(1000 * 2 ** attempt);
        continue;
      default:
        throw new ApiError(res.status, message || `Request failed (${res.status})`);
    }
  }
}

const json = async <T>(p: Promise<Response>) => (await (await p).json()) as T;
const e = encodeURIComponent;

// ---------- catalog ----------

export async function listEvents(includePast = false): Promise<EventInfo[]> {
  const r = await json<{ items: EventInfo[] }>(
    call(`/events${includePast ? '?includePast=true' : ''}`, { authed: false })
  );
  return r.items;
}

export async function getEvent(eventId: string): Promise<EventInfo> {
  return (await json<{ event: EventInfo }>(call(`/events/${e(eventId)}`, { authed: false }))).event;
}

/**
 * Walks every page. A short page does NOT mean the end: we stop only when nextToken is absent.
 */
export async function listAllSessions(
  eventId: string,
  opts: { includeAbstracts?: boolean; locale?: string; onProgress?: (n: number, total: number) => void } = {}
): Promise<Session[]> {
  const all: Session[] = [];
  let nextToken: string | undefined;
  do {
    // Built by hand: React Native's URLSearchParams is only partly implemented.
    const q: string[] = [];
    if (opts.includeAbstracts === false) q.push('includeAbstracts=false');
    if (opts.locale) q.push(`locale=${e(opts.locale)}`);
    if (nextToken) q.push(`nextToken=${e(nextToken)}`);
    const qs = q.join('&');
    const page = await json<{ items: Session[]; totalCount: number; nextToken?: string }>(
      call(`/events/${e(eventId)}/sessions${qs ? `?${qs}` : ''}`)
    );
    all.push(...page.items);
    opts.onProgress?.(all.length, page.totalCount);
    nextToken = page.nextToken;
  } while (nextToken);
  return all;
}

export async function getSession(eventId: string, sessionId: string): Promise<Session> {
  return (await json<{ session: Session }>(call(`/events/${e(eventId)}/sessions/${e(sessionId)}`))).session;
}

// ---------- schedule (source of truth) ----------

export async function getSchedule(eventId: string): Promise<Schedule> {
  return (await json<{ schedule: Schedule }>(call(`/events/${e(eventId)}/schedule`))).schedule;
}

// ---------- reservations ----------

export async function reserveSessions(eventId: string, sessionIds: string[]): Promise<BulkResult> {
  return (
    await json<{ result: BulkResult }>(
      call(`/events/${e(eventId)}/reservations`, { method: 'POST', body: { sessionIds } })
    )
  ).result;
}

/** Returns 'absent' if it was not reserved (404), which counts as done. */
export async function cancelReservation(eventId: string, sessionId: string): Promise<'cancelled' | 'absent'> {
  try {
    await call(`/events/${e(eventId)}/reservations/${e(sessionId)}`, { method: 'DELETE' });
    return 'cancelled';
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return 'absent';
    throw err;
  }
}

// ---------- favorites ----------

export async function associateFavorites(eventId: string, sessionIds: string[]): Promise<BulkResult> {
  return (
    await json<{ result: BulkResult }>(
      call(`/events/${e(eventId)}/favorites`, { method: 'POST', body: { sessionIds } })
    )
  ).result;
}

export async function disassociateFavorite(eventId: string, sessionId: string): Promise<'removed' | 'absent'> {
  try {
    await call(`/events/${e(eventId)}/favorites/${e(sessionId)}`, { method: 'DELETE' });
    return 'removed';
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return 'absent';
    throw err;
  }
}

// ---------- personal time ----------

/** Create returns no body. Read GetSchedule to get the new personalTimeId. */
export async function createPersonalTime(eventId: string, input: PersonalTimeInput): Promise<void> {
  await call(`/events/${e(eventId)}/personal-time`, { method: 'POST', body: input });
}

/** Full replacement: every field is sent, a missing location clears it. */
export async function updatePersonalTime(eventId: string, id: string, input: PersonalTimeInput): Promise<void> {
  await call(`/events/${e(eventId)}/personal-time/${e(id)}`, { method: 'PUT', body: input });
}

export async function deletePersonalTime(eventId: string, id: string): Promise<void> {
  try {
    await call(`/events/${e(eventId)}/personal-time/${e(id)}`, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return; // already gone
    throw err;
  }
}
