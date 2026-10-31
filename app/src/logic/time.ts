// Time helpers. Session times come as local date + time in the event's timezone.
// Personal time is sent and returned as the EVENT'S LOCAL wall-clock time, "YYYY-MM-DDTHH:MM:00" with no
// offset, start and end on the same local date, and 5-minute lengths. (The OpenAPI spec said UTC; the API and the
// developer guide use the event's local time, so a block sent as UTC landed 8 hours off.)
import type { Session } from '../api/types';

export const DEFAULT_TZ = 'America/Los_Angeles'; // Las Vegas
const FALLBACK_OFFSET_MIN = -8 * 60; // PST, re:Invent is in December

export interface Interval {
  start: number; // epoch ms (UTC)
  end: number;
}

// Building an Intl.DateTimeFormat is slow on Hermes, and the catalog has thousands of sessions that
// each need several date lookups per filter. So the formatter is built once per timezone, and the
// offset is remembered per 15-minute bucket (offsets only change on DST edges).
const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();
const BUCKET_MS = 15 * 60000;

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Offset of `tz` from UTC at instant `utcMs`, in minutes (e.g. -480 for PST). */
export function tzOffsetMinutes(utcMs: number, tz: string): number {
  const key = `${tz}|${Math.floor(utcMs / BUCKET_MS)}`;
  const hit = offsets.get(key);
  if (hit !== undefined) return hit;
  try {
    const parts = formatterFor(tz).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    const minutes = Math.round((asUtc - utcMs) / 60000);
    if (offsets.size > 20000) offsets.clear();
    offsets.set(key, minutes);
    return minutes;
  } catch {
    return FALLBACK_OFFSET_MIN;
  }
}

/** "2026-12-01" + "16:00" in `tz` -> epoch ms. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle DST edges.
  let utc = naive - tzOffsetMinutes(naive, tz) * 60000;
  utc = naive - tzOffsetMinutes(utc, tz) * 60000;
  return utc;
}

// A session never changes after it is loaded, so its interval is worked out once.
const intervals = new WeakMap<Session, { tz: string; iv: Interval | null }>();

export function sessionInterval(s: Session, eventTz: string): Interval | null {
  const cached = intervals.get(s);
  if (cached && cached.tz === eventTz) return cached.iv;
  const t = s.sessionTime;
  let iv: Interval | null = null;
  if (t?.date && t.time) {
    const start = zonedToUtc(t.date, t.time, t.timezone || eventTz);
    const len = Number(t.length || '60');
    iv = { start, end: start + (Number.isFinite(len) && len > 0 ? len : 60) * 60000 };
  }
  intervals.set(s, { tz: eventTz, iv });
  return iv;
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

const pad = (n: number) => String(n).padStart(2, '0');

// The event time zone used for personal time. AppState sets it once the event is loaded.
let apiTz = DEFAULT_TZ;
export function setApiTimezone(tz: string | undefined) {
  apiTz = tz || DEFAULT_TZ;
}

/** epoch ms -> "YYYY-MM-DDTHH:MM:00" on the event's local clock, the format personal time uses. */
export function toApiTime(ms: number): string {
  const d = new Date(ms + tzOffsetMinutes(ms, apiTz) * 60000);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
  );
}

/** "YYYY-MM-DDTHH:MM:SS" on the event's local clock -> epoch ms. */
export function fromApiTime(s: string): number {
  const [date, time = '00:00'] = s.split('T');
  return zonedToUtc(date, time.slice(0, 5), apiTz);
}

/** The API refuses a block whose start and end fall on different local dates. */
export const sameApiDate = (startMs: number, endMs: number) =>
  toApiTime(startMs).slice(0, 10) === toApiTime(endMs - 60000).slice(0, 10);

const FIVE_MIN = 5 * 60000;
export const floor5 = (ms: number) => Math.floor(ms / FIVE_MIN) * FIVE_MIN;
export const ceil5 = (ms: number) => Math.ceil(ms / FIVE_MIN) * FIVE_MIN;

/** Local wall-clock parts of an instant in `tz`. */
function localParts(ms: number, tz: string) {
  const d = new Date(ms + tzOffsetMinutes(ms, tz) * 60000);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

export function dayKey(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Minutes since local midnight. */
export function localMinutes(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return p.h * 60 + p.min;
}

export function fmtTime(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${pad(p.min)} ${p.h < 12 ? 'AM' : 'PM'}`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DOW[dow]} ${MON[m - 1]} ${d}`;
}

export const fmtRange = (i: Interval, tz: string) => `${fmtTime(i.start, tz)} - ${fmtTime(i.end, tz)}`;

/** "09:30" -> 570 */
export const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** "09:30" for an instant, in `tz` (24-hour, the form the time fields use). */
export function hhmm(ms: number, tz: string): string {
  const m = localMinutes(ms, tz);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Minutes since midnight -> "09:30". */
export const clockString = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Reads what a person types into a time field: "9", "9:30", "09:30", "930", "18.15".
 * Returns minutes since midnight, or null if it is not a time.
 */
export function parseClock(text: string): number | null {
  const t = text.trim().replace('.', ':');
  let h: number, m: number;
  const colon = t.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{1,2}$/.test(t)) {
    h = Number(t);
    m = 0;
  } else if (/^\d{3,4}$/.test(t)) {
    h = Number(t.slice(0, t.length - 2));
    m = Number(t.slice(-2));
  } else {
    return null;
  }
  return h <= 24 && m < 60 && !(h === 24 && m > 0) ? h * 60 + m : null;
}
