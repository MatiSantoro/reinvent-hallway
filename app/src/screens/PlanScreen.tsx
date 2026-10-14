import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { BackendNotConfigured } from '../api/backend';
import { CERTS, certLabel } from '../data/certs';
import { DEFAULT_GOALS, distinctTypes, Goals } from '../logic/filter';
import { makePlan, PlanOutput } from '../logic/planner';
import { describePersonalTime, failureText, favoriteAll, reserveAll, syncTravelBlocks } from '../logic/reconcile';
import { dayKey, fmtDay, fmtRange, sessionInterval } from '../logic/time';
import { useApp } from '../state/AppState';
import { describeReport } from '../state/useActions';
import { SessionCard } from '../ui/SessionCard';
import { Banner, Btn, C, Card, Chip, Field, H, P, Row, Title } from '../ui/kit';

const EXAMPLES = [
  'Agents and MCP, Python, nothing before 9am, one fun session outside my job',
  'Serverless and event-driven, hands-on workshops if possible',
  'Cost optimization and FinOps for a platform team',
];

type Report = { text: string; kind: 'info' | 'good' | 'bad' };
type Note = { text: string; ok: boolean };

export function PlanScreen() {
  const app = useApp();
  const [g, setG] = useState<Goals>(DEFAULT_GOALS);
  const [maxText, setMaxText] = useState(String(DEFAULT_GOALS.maxPerDay));
  const [plan, setPlan] = useState<PlanOutput | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [fullIds, setFullIds] = useState<string[]>([]);
  // What happened to each session on the last "Reserve all", shown on its own card.
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [status, setStatus] = useState<string | null>(null);

  const types = useMemo(() => distinctTypes(app.sessions).slice(0, 8), [app.sessions]);
  const days = useMemo(() => {
    const set = new Set<string>();
    app.sessions.forEach((s) => {
      const iv = sessionInterval(s, app.tz);
      if (iv) set.add(dayKey(iv.start, app.tz));
    });
    return [...set].sort();
  }, [app.sessions, app.tz]);

  const toggle = <K extends 'levels' | 'types' | 'certs' | 'days'>(k: K, v: Goals[K][number]) =>
    setG((old) => {
      const list = old[k] as (typeof v)[];
      return { ...old, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] };
    });

  const say = (text: string, kind: Report['kind'] = 'info') => setReport({ text, kind });

  const build = async (exclude: string[] = []) => {
    setBusy('plan');
    setReport(null);
    setNotes({});
    try {
      setStatus('Checking your schedule...');
      const schedule = await app.refreshSchedule();
      setStatus(
        g.text.trim() || g.certs.length
          ? 'Asking the agent to pick sessions. This usually takes 10 to 25 seconds...'
          : 'Ranking sessions...'
      );
      setPlan(await makePlan(app.sessions, app.byId, schedule, g, app.tz, new Set(exclude)));
    } catch (e) {
      Alert.alert('Could not plan', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setStatus(null);
    }
  };

  const byDay = useMemo(() => {
    const m = new Map<string, PlanOutput['items']>();
    plan?.items.forEach((i) => {
      const k = dayKey(i.interval.start, app.tz);
      m.set(k, [...(m.get(k) || []), i]);
    });
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [plan, app.tz]);

  const ids = plan?.items.map((i) => i.session.sessionId) || [];
  const reservedSet = useMemo(() => new Set(app.schedule.reserved), [app.schedule.reserved]);
  const favSet = useMemo(() => new Set(app.schedule.favorites), [app.schedule.favorites]);
  const reservedCount = ids.filter((id) => reservedSet.has(id)).length;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <Title sub="Tell the agent what you want. It picks, Hallway checks clashes and walking time.">Plan my week</Title>
      <View style={{ paddingHorizontal: 16 }}>
        <Field
          label="What do you want from re:Invent?"
          value={g.text}
          onChangeText={(text) => setG({ ...g, text })}
          placeholder={EXAMPLES[0]}
          multiline
          style={{ minHeight: 80, textAlignVertical: 'top' }}
        />
        <Row style={{ marginBottom: 8 }}>
          {EXAMPLES.slice(1).map((ex) => (
            <Chip key={ex} label={ex.split(',')[0]} onPress={() => setG({ ...g, text: ex })} />
          ))}
        </Row>

        <H>Studying for a certification?</H>
        <Row>
          {CERTS.map((c) => (
            <Chip key={c.id} label={certLabel(c)} on={g.certs.includes(c.id)} onPress={() => toggle('certs', c.id)} />
          ))}
        </Row>

        <H>Level</H>
        <Row>
          {[100, 200, 300, 400].map((l) => (
            <Chip key={l} label={String(l)} on={g.levels.includes(l)} onPress={() => toggle('levels', l)} />
          ))}
        </Row>

        {types.length ? (
          <>
            <H>Format</H>
            <Row>
              {types.map((t) => (
                <Chip key={t} label={t} on={g.types.includes(t)} onPress={() => toggle('types', t)} />
              ))}
            </Row>
          </>
        ) : null}

        {days.length ? (
          <>
            <H>Days (none = all)</H>
            <Row>
              {days.map((d) => (
                <Chip key={d} label={fmtDay(d)} on={g.days.includes(d)} onPress={() => toggle('days', d)} />
              ))}
            </Row>
          </>
        ) : null}

        <H>Hours and pace</H>
        <Row style={{ flexWrap: 'nowrap' }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Earliest"
              value={g.earliest}
              keyboardType="numbers-and-punctuation"
              onChangeText={(earliest) => setG({ ...g, earliest })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Latest"
              value={g.latest}
              keyboardType="numbers-and-punctuation"
              onChangeText={(latest) => setG({ ...g, latest })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Max / day"
              keyboardType="number-pad"
              value={maxText}
              selectTextOnFocus
              onChangeText={(v) => {
                // Let the box be empty while typing. The 1-10 limit is applied when you leave it.
                const digits = v.replace(/\D/g, '').slice(0, 2);
                setMaxText(digits);
                if (digits) setG({ ...g, maxPerDay: Math.max(1, Math.min(10, Number(digits))) });
              }}
              onBlur={() => setMaxText(String(g.maxPerDay))}
            />
          </View>
        </Row>

        <Btn label="Build my week" busy={busy === 'plan'} onPress={() => build()} style={{ marginTop: 8 }} />
        {status ? (
          <Row style={{ marginTop: 12, flexWrap: 'nowrap' }}>
            <ActivityIndicator color={C.accent} />
            <Text style={{ color: C.dim, fontSize: 13, flex: 1 }}>{status}</Text>
          </Row>
        ) : null}
      </View>

      {plan ? (
        <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
          {plan.agentError ? (
            <Banner
              kind="warn"
              text={
                plan.agentError === new BackendNotConfigured().message
                  ? 'Agent not connected (no backend URL). Ranked on your phone instead.'
                  : `Agent unavailable (${plan.agentError}). Ranked on your phone instead.`
              }
            />
          ) : null}
          <Card>
            <Text style={{ color: C.accent, fontWeight: '800', fontSize: 12, letterSpacing: 1 }}>
              {plan.usedAgent ? 'AGENT PLAN' : 'LOCAL PLAN'}
            </Text>
            <P style={{ marginTop: 6 }}>{plan.summary}</P>
            <P dim style={{ marginTop: 8 }}>
              {plan.items.length} sessions · {plan.travel.length} walking blocks · {plan.skipped.length} left out
              (clash, full day or no time to get there)
            </P>
            <P style={{ marginTop: 8, color: reservedCount === ids.length && ids.length ? C.good : C.text, fontWeight: '700' }}>
              {reservedCount} of {ids.length} reserved
            </P>
          </Card>

          {report ? <Banner kind={report.kind} text={report.text} /> : null}

          <Row style={{ marginBottom: 8 }}>
            <Btn
              small
              label="☆ Favorite all"
              kind="ghost"
              busy={busy === 'fav'}
              disabled={!ids.length}
              onPress={async () => {
                setBusy('fav');
                try {
                  const r = await favoriteAll(app.eventId, ids, (m) => say(m));
                  app.setSchedule(r.schedule);
                  say(describeReport(r, app.byId, 'Favoriting'), r.failed.length ? 'bad' : 'good');
                } catch (e) {
                  say(e instanceof Error ? e.message : String(e), 'bad');
                } finally {
                  setBusy(null);
                }
              }}
            />
            <Btn
              small
              label="Reserve all"
              busy={busy === 'res'}
              disabled={!ids.length}
              onPress={async () => {
                setBusy('res');
                try {
                  const r = await reserveAll(app.eventId, plan.items.map((i) => i.session), (m) => say(m));
                  app.setSchedule(r.schedule);
                  say(describeReport(r, app.byId, 'Reserving'), r.failed.length ? 'bad' : 'good');
                  setFullIds(r.failed.filter((f) => f.code === 'sessionFull').map((f) => f.sessionId));
                  // Put each outcome on the card it belongs to.
                  const next: Record<string, Note> = {};
                  for (const f of r.failed) {
                    const clash = f.conflictsWith?.length
                      ? ` (with ${f.conflictsWith.map((id) => app.byId.get(id)?.abbreviation || id).join(', ')})`
                      : '';
                    next[f.sessionId] = { text: `Not reserved: ${failureText(f.code)}${clash}`, ok: false };
                  }
                  for (const sk of r.skipped) next[sk.sessionId] = { text: sk.why, ok: false };
                  setNotes(next);
                } catch (e) {
                  say(e instanceof Error ? e.message : String(e), 'bad');
                } finally {
                  setBusy(null);
                }
              }}
            />
            <Btn
              small
              kind="ghost"
              label="+ Walking time"
              busy={busy === 'walk'}
              disabled={!plan.travel.length}
              onPress={async () => {
                setBusy('walk');
                try {
                  const o = await syncTravelBlocks(app.eventId, plan.travel);
                  app.setSchedule(o.schedule);
                  const d = describePersonalTime(o, plan.travel.length, app.tz);
                  say(d.text, d.ok ? 'good' : 'bad');
                } catch (e) {
                  say(e instanceof Error ? e.message : String(e), 'bad');
                } finally {
                  setBusy(null);
                }
              }}
            />
          </Row>
          <P dim style={{ fontSize: 12, marginBottom: 8 }}>
            Or reserve one at a time with the button on each session. A green border means you have a seat.
          </P>
          {fullIds.length ? (
            <Btn
              kind="ghost"
              label={`Replace ${fullIds.length} full session${fullIds.length > 1 ? 's' : ''}`}
              busy={busy === 'plan'}
              onPress={() => build(fullIds)}
              style={{ marginBottom: 12 }}
            />
          ) : null}

          {byDay.map(([day, items]) => (
            <View key={day}>
              <H>{fmtDay(day)}</H>
              {items.map((i) => {
                const walk = plan.travel.find((t) => t.beforeSessionId === i.session.sessionId);
                return (
                  <View key={i.session.sessionId}>
                    {walk ? (
                      <P dim style={{ marginBottom: 8, color: walk.tight ? C.warn : C.dim }}>
                        🚶 {walk.title} · {fmtRange({ start: walk.start, end: walk.end }, app.tz)}
                        {walk.tight ? ' · tight!' : ''}
                      </P>
                    ) : null}
                    <SessionCard
                      s={i.session}
                      tz={app.tz}
                      reason={i.reason}
                      reserved={reservedSet.has(i.session.sessionId)}
                      favorite={favSet.has(i.session.sessionId)}
                      note={notes[i.session.sessionId]}
                      actions
                    />
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
