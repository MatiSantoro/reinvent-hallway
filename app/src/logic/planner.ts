// Planner pipeline:
//  1. local hard filters + scoring over the cached catalog (the API has no search)
//  2. the agent (Bedrock, via our backend) ranks the short list against the user's goals
//  3. a deterministic scheduler enforces clashes, daily caps and walking time
// The agent only ever returns session ids. Our code decides what fits.
import { plan as agentPlan, PlanCandidate } from '../api/backend';
import type { Schedule, Session } from '../api/types';
import { certById } from '../data/certs';
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

/**
 * How many picks to ask the agent for. The wait is almost all output tokens, so asking for 40 picks
 * when the week only has room for ~20 doubles the time for nothing. A day's cap, a few spare for
 * clashes, and never more than 30.
 */
function askFor(pool: Session[], goals: Goals, tz: string): number {
  const days = new Set<string>();
  for (const s of pool) {
    const iv = sessionInterval(s, tz);
    if (iv) days.add(dayKey(iv.start, tz));
  }
  const wanted = Math.ceil(Math.max(1, days.size) * goals.maxPerDay * 1.4);
  return Math.max(8, Math.min(30, wanted));
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
        // Send exam codes ("MLA-C02"), not our internal ids.
        certs: goals.certs.map((id) => certById(id)?.code || id),
        candidates: pool.slice(0, 120).map((s) => toCandidate(s, tz)),
        maxPicks: askFor(pool, goals, tz),
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
