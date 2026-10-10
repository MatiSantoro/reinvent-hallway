// Turns a ranked list of sessions into a week that actually works:
// no overlaps, a daily cap, and enough time to get between venues.
import type { Session } from '../api/types';
import { travelMinutes, venueLabel, venueKey } from '../data/venues';
import { ceil5, dayKey, floor5, Interval, overlaps, sessionInterval } from './time';

export interface Slot {
  id: string;
  kind: 'session' | 'personal';
  interval: Interval;
  venue?: string;
  title: string;
}

export interface PlannedItem {
  session: Session;
  interval: Interval;
  reason?: string;
}

export interface TravelBlock {
  start: number;
  end: number;
  title: string; // "Walk to MGM Grand"
  fromVenue: string;
  toVenue: string;
  tight: boolean; // less time than the trip needs
  beforeSessionId: string;
}

export interface Issue {
  kind: 'overlap' | 'tight';
  a: string; // slot ids
  b: string;
  message: string;
}

export const sessionSlot = (s: Session, tz: string): Slot | null => {
  const iv = sessionInterval(s, tz);
  return iv ? { id: s.sessionId, kind: 'session', interval: iv, venue: s.venue, title: s.title } : null;
};

/** Can `cand` sit next to everything already on that day, including travel time? */
function fits(cand: Slot, day: Slot[]): boolean {
  for (const other of day) {
    if (overlaps(cand.interval, other.interval)) return false;
    // Travel only matters between two sessions with known places.
    if (other.kind !== 'session' || cand.kind !== 'session') continue;
    const [first, second] = other.interval.end <= cand.interval.start ? [other, cand] : [cand, other];
    const gapMin = (second.interval.start - first.interval.end) / 60000;
    if (gapMin < 0) return false;
    // Only check direct neighbors: anything further away has an even bigger gap.
    const between = day.some(
      (x) => x !== other && x.interval.start >= first.interval.end && x.interval.end <= second.interval.start
    );
    if (between) continue;
    if (gapMin < travelMinutes(first.venue, second.venue).minutes) return false;
  }
  return true;
}

export interface PlanResult {
  items: PlannedItem[];
  skipped: { session: Session; why: string }[];
}

/**
 * Greedy: walk the ranked list, keep a session if it fits. `fixed` are things already on the
 * schedule (reserved sessions, personal time) that the plan must respect.
 */
export function buildPlan(
  ranked: { session: Session; reason?: string }[],
  fixed: Slot[],
  tz: string,
  maxPerDay: number
): PlanResult {
  const byDay = new Map<string, Slot[]>();
  const add = (s: Slot) => {
    const k = dayKey(s.interval.start, tz);
    byDay.set(k, [...(byDay.get(k) || []), s]);
  };
  fixed.forEach(add);
  const fixedIds = new Set(fixed.map((f) => f.id));

  const items: PlannedItem[] = [];
  const skipped: PlanResult['skipped'] = [];
  for (const { session, reason } of ranked) {
    if (fixedIds.has(session.sessionId)) continue;
    const slot = sessionSlot(session, tz);
    if (!slot) {
      skipped.push({ session, why: 'No time yet' });
      continue;
    }
    const k = dayKey(slot.interval.start, tz);
    const day = byDay.get(k) || [];
    if (day.filter((d) => d.kind === 'session').length >= maxPerDay) {
      skipped.push({ session, why: 'Day is full' });
      continue;
    }
    if (!fits(slot, day)) {
      skipped.push({ session, why: 'Clashes or no time to get there' });
      continue;
    }
    add(slot);
    items.push({ session, interval: slot.interval, reason });
  }
  items.sort((a, b) => a.interval.start - b.interval.start);
  return { items, skipped };
}

/** Finds overlaps and transitions that are too short, for a set of slots. */
export function analyze(slots: Slot[], tz: string): { issues: Issue[]; travel: TravelBlock[] } {
  const issues: Issue[] = [];
  const travel: TravelBlock[] = [];
  const byDay = new Map<string, Slot[]>();
  slots.forEach((s) => {
    const k = dayKey(s.interval.start, tz);
    byDay.set(k, [...(byDay.get(k) || []), s]);
  });

  for (const day of byDay.values()) {
    day.sort((a, b) => a.interval.start - b.interval.start);
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length && day[j].interval.start < day[i].interval.end; j++) {
        issues.push({
          kind: 'overlap',
          a: day[i].id,
          b: day[j].id,
          message: `"${day[i].title}" overlaps "${day[j].title}"`,
        });
      }
    }
    const sessions = day.filter((s) => s.kind === 'session');
    for (let i = 0; i + 1 < sessions.length; i++) {
      const a = sessions[i];
      const b = sessions[i + 1];
      if (a.interval.end > b.interval.start) continue; // already an overlap
      const ka = venueKey(a.venue);
      const kb = venueKey(b.venue);
      if (a.venue && b.venue && (ka ? ka === kb : a.venue === b.venue)) continue; // same building
      const need = travelMinutes(a.venue, b.venue).minutes;
      const gap = (b.interval.start - a.interval.end) / 60000;
      const tight = gap < need;
      if (tight) {
        issues.push({
          kind: 'tight',
          a: a.id,
          b: b.id,
          message: `${Math.round(gap)} min to get from ${venueLabel(a.venue)} to ${venueLabel(b.venue)}, needs about ${need}`,
        });
      }
      // Block: end when the next session starts, start `need` minutes before (not before a ends).
      const end = floor5(b.interval.start);
      const start = Math.max(ceil5(a.interval.end), end - ceil5(need * 60000));
      if (end - start >= 5 * 60000) {
        travel.push({
          start,
          end,
          title: `Walk to ${venueLabel(b.venue)}`,
          fromVenue: venueLabel(a.venue),
          toVenue: venueLabel(b.venue),
          tight,
          beforeSessionId: b.id,
        });
      }
    }
  }
  return { issues, travel };
}
