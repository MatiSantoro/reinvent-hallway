// Planner pipeline:
//  1. local hard filters + scoring over the cached catalog (the API has no search)
//  2. the agent (Bedrock, via our backend) ranks the short list against the user's goals
//  3. a deterministic scheduler enforces clashes, daily caps and walking time
// The agent only ever returns session ids. Our code decides what fits.
import { plan as agentPlan, PlanCandidate } from '../api/backend';
import type { Schedule, Session } from '../api/types';
import { candidates, Goals, score } from './filter';
import { personalInterval } from './reconcile';
import { analyze, buildPlan, PlanResult, sessionSlot, Slot, TravelBlock } from './scheduler';
import { dayKey, fmtTime, sessionInterval } from './time';

export interface PlanOutput extends PlanResult {
  summary: string;
  usedAgent: boolean;
  travel: TravelBlock[];
  agentError?: string;
}

function toCandidate(s: Session, tz: string): PlanCandidate {
  const iv = sessionInterval(s, tz)!;
  return {
    id: s.sessionId,
    code: s.abbreviation,
    title: s.title,
    type: s.type,
    level: s.level,
    day: dayKey(iv.start, tz),
    time: fmtTime(iv.start, tz),
    venue: s.venue,
    seats: s.seatAvailability,
    tags: [...(s.services || []), ...(s.topics || [])].slice(0, 8),
    abstract: s.abstract?.slice(0, 280),
  };
}

export function fixedSlots(schedule: Schedule, byId: Map<string, Session>, tz: string): Slot[] {
  const out: Slot[] = [];
  for (const id of schedule.reserved) {
    const s = byId.get(id);
    const slot = s && sessionSlot(s, tz);
    if (slot) out.push(slot);
  }
  for (const p of schedule.personalTime) {
    // Our own travel blocks get rebuilt, so they don't block the plan.
    if (p.description.includes('travel:')) continue;
    out.push({ id: p.personalTimeId, kind: 'personal', interval: personalInterval(p), title: p.title, venue: p.location });
  }
  return out;
}

export async function makePlan(
  all: Session[],
  byId: Map<string, Session>,
  schedule: Schedule,
  goals: Goals,
  tz: string,
  exclude: Set<string> = new Set()
): Promise<PlanOutput> {
  const pool = candidates(all, goals, tz).filter((s) => !exclude.has(s.sessionId));
  let ranked: { session: Session; reason?: string }[] = [];
  let summary = '';
  let usedAgent = false;
  let agentError: string | undefined;

  if (goals.text.trim() || goals.certs.length) {
    try {
      const r = await agentPlan({
        goals: goals.text,
        certs: goals.certs,
        candidates: pool.slice(0, 120).map((s) => toCandidate(s, tz)),
        maxPicks: Math.min(40, goals.maxPerDay * 5 * 2),
      });
      const seen = new Set<string>();
      for (const p of r.picks) {
        const s = byId.get(p.sessionId);
        // Ignore anything the agent made up or repeated.
        if (s && !seen.has(s.sessionId) && pool.includes(s)) {
          seen.add(s.sessionId);
          ranked.push({ session: s, reason: p.reason });
        }
      }
      summary = r.summary;
      usedAgent = ranked.length > 0;
    } catch (e) {
      agentError = e instanceof Error ? e.message : String(e);
    }
  }

  // Fallback (or top-up): local score order.
  if (!usedAgent) {
    ranked = pool
      .map((s) => ({ session: s, sc: score(s, goals) }))
      .sort((a, b) => b.sc - a.sc)
      .map(({ session }) => ({ session }));
    summary = summary || 'Ranked on your phone by keyword and certification match.';
  }

  const fixed = fixedSlots(schedule, byId, tz);
  const result = buildPlan(ranked, fixed, tz, goals.maxPerDay);
  const plannedSlots: Slot[] = result.items.map((i) => ({
    id: i.session.sessionId,
    kind: 'session',
    interval: i.interval,
    venue: i.session.venue,
    title: i.session.title,
  }));
  const { travel } = analyze([...fixed, ...plannedSlots], tz);
  return { ...result, summary, usedAgent, travel, agentError };
}
