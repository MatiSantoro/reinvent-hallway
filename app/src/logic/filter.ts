// Local filtering and scoring. The API returns the whole catalog and leaves search to us.
import type { Session } from '../api/types';
import { certById } from '../data/certs';
import { dayKey, hhmmToMinutes, localMinutes, sessionInterval } from './time';

export interface Goals {
  /** Free text, also sent to the planner agent. "agents, MCP, Python, one fun session" */
  text: string;
  levels: number[]; // [300, 400]; empty = any
  types: string[]; // "Workshop", "Chalk talk"...; empty = any
  certs: string[]; // cert ids from data/certs.ts
  days: string[]; // "2026-12-01"...; empty = all days
  earliest: string; // "09:00"
  latest: string; // "18:00"
  maxPerDay: number;
}

export const DEFAULT_GOALS: Goals = {
  text: '',
  levels: [],
  types: [],
  certs: [],
  days: [],
  earliest: '08:00',
  latest: '19:00',
  maxPerDay: 5,
};

/** "300 - Advanced" -> 300 */
export const levelNumber = (level?: string) => {
  const m = level?.match(/\d{3}/);
  return m ? Number(m[0]) : null;
};

const STOP = new Set(['and', 'or', 'the', 'a', 'an', 'for', 'of', 'to', 'in', 'on', 'with', 'about', 'i', 'want', 'like', 'some', 'sessions', 'session']);

export function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.\-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP.has(w));
}

const tagText = (s: Session) =>
  [...(s.services || []), ...(s.topics || []), ...(s.areasOfInterest || []), ...(s.tracks || []), ...(s.roles || [])]
    .join(' | ')
    .toLowerCase();

/** Hard filters: things the user said they don't want at all. */
export function passesHardFilters(s: Session, g: Goals, tz: string): boolean {
  const lvl = levelNumber(s.level);
  if (g.levels.length && (lvl === null || !g.levels.includes(lvl))) return false;
  if (g.types.length && !g.types.some((t) => s.type?.toLowerCase() === t.toLowerCase())) return false;
  const iv = sessionInterval(s, tz);
  if (!iv) return false; // no time yet, can't schedule it
  if (g.days.length && !g.days.includes(dayKey(iv.start, tz))) return false;
  if (localMinutes(iv.start, tz) < hhmmToMinutes(g.earliest)) return false;
  const endMin = localMinutes(iv.end, tz) || 24 * 60;
  if (endMin > hhmmToMinutes(g.latest)) return false;
  if (s.isAllDaySession) return false;
  return true;
}

/** Soft score: how well a session matches the goals. */
export function score(s: Session, g: Goals): number {
  const title = s.title.toLowerCase();
  const tags = tagText(s);
  const abs = (s.abstract || '').toLowerCase();
  let total = 0;
  for (const k of keywords(g.text)) {
    if (title.includes(k)) total += 3;
    if (tags.includes(k)) total += 2;
    if (abs.includes(k)) total += 1;
  }
  for (const id of g.certs) {
    const cert = certById(id);
    if (!cert) continue;
    for (const [term, w] of Object.entries(cert.terms)) {
      if (title.includes(term) || tags.includes(term)) total += w;
      else if (abs.includes(term)) total += w / 2;
    }
  }
  // Prefer sessions you can still get into.
  if (s.seatAvailability === 'unavailable') total *= 0.3;
  return total;
}

/** Top N candidates for the planner agent. */
export function candidates(all: Session[], g: Goals, tz: string, limit = 150): Session[] {
  const hasSignal = keywords(g.text).length > 0 || g.certs.length > 0;
  return all
    .filter((s) => passesHardFilters(s, g, tz))
    .map((s) => ({ s, sc: score(s, g) }))
    .filter((x) => !hasSignal || x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .slice(0, limit)
    .map((x) => x.s);
}

/** Simple text search for the Explore screen. */
export function search(all: Session[], query: string): Session[] {
  const ks = keywords(query);
  if (!ks.length) return all;
  return all
    .map((s) => {
      const hay = `${s.abbreviation || ''} ${s.title} ${tagText(s)} ${(s.speakers || []).map((p) => p.name).join(' ')}`.toLowerCase();
      const abs = (s.abstract || '').toLowerCase();
      let sc = 0;
      for (const k of ks) {
        if (hay.includes(k)) sc += 2;
        else if (abs.includes(k)) sc += 1;
        else return { s, sc: -1 }; // every word must match somewhere
      }
      return { s, sc };
    })
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .map((x) => x.s);
}

/** Distinct values for filter chips. */
export function distinctTypes(all: Session[]): string[] {
  return [...new Set(all.map((s) => s.type).filter(Boolean) as string[])].sort();
}
