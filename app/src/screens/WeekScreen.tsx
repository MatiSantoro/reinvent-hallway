import React, { useMemo, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { deletePersonalTime, updatePersonalTime } from '../api/events';
import type { PersonalTime } from '../api/types';
import { PT_TAG } from '../config';
import { describePersonalTime, ensurePersonalTime, isOurs, personalInterval, syncTravelBlocks } from '../logic/reconcile';
import { analyze, sessionSlot, Slot } from '../logic/scheduler';
import { dayKey, fmtDay, fmtRange, overlaps, sessionInterval, toApiUtc, zonedToUtc } from '../logic/time';
import { useApp } from '../state/AppState';
import { SessionCard } from '../ui/SessionCard';
import { Banner, Btn, C, Card, Chip, Field, H, P, Row, Title } from '../ui/kit';

type Entry =
  | { kind: 'session'; id: string; start: number; reserved: boolean }
  | { kind: 'personal'; id: string; start: number; p: PersonalTime };

type Msg = { text: string; kind: 'bad' | 'good' | 'warn' };

export function WeekScreen() {
  const app = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  // Two lists, never mixed: what you hold seats for, and what you only starred.
  const [view, setView] = useState<'schedule' | 'favorites'>('schedule');
  const [blockDay, setBlockDay] = useState<string | null>(null);
  const [block, setBlock] = useState({ title: 'Lunch', from: '12:00', to: '13:00' });

  const { schedule, byId, tz } = app;
  const favSet = useMemo(() => new Set(schedule.favorites), [schedule.favorites]);

  // Reserved sessions + personal time are the real commitments.
  const committed: Slot[] = useMemo(() => {
    const out: Slot[] = [];
    schedule.reserved.forEach((id) => {
      const s = byId.get(id);
      const slot = s && sessionSlot(s, tz);
      if (slot) out.push(slot);
    });
    schedule.personalTime
      .filter((p) => !p.description.includes('travel:'))
      .forEach((p) => out.push({ id: p.personalTimeId, kind: 'personal', interval: personalInterval(p), title: p.title }));
    return out;
  }, [schedule, byId, tz]);

  const { issues, travel } = useMemo(() => analyze(committed, tz), [committed, tz]);

  const groupByDay = <T extends { start: number }>(entries: T[]) => {
    const m = new Map<string, T[]>();
    [...entries].sort((x, y) => x.start - y.start).forEach((e) => {
      const k = dayKey(e.start, tz);
      m.set(k, [...(m.get(k) || []), e]);
    });
    return [...m.entries()].sort(([x], [y]) => x.localeCompare(y));
  };

  // Schedule = reserved sessions + your own blocks.
  const days = useMemo(() => {
    const entries: Entry[] = [];
    schedule.reserved.forEach((id) => {
      const iv = byId.get(id) && sessionInterval(byId.get(id)!, tz);
      if (iv) entries.push({ kind: 'session', id, start: iv.start, reserved: true });
    });
    schedule.personalTime.forEach((p) =>
      entries.push({ kind: 'personal', id: p.personalTimeId, start: personalInterval(p).start, p })
    );
    return groupByDay(entries);
  }, [schedule, byId, tz]);

  // Favorites = starred sessions you do not hold a seat for.
  const favDays = useMemo(() => {
    const reserved = new Set(schedule.reserved);
    const entries: { id: string; start: number; clash?: string }[] = [];
    for (const id of schedule.favorites) {
      if (reserved.has(id)) continue;
      const sess = byId.get(id);
      const iv = sess && sessionInterval(sess, tz);
      if (!sess || !iv) continue;
      const hit = committed.find((c) => overlaps(iv, c.interval));
      entries.push({ id, start: iv.start, clash: hit?.title });
    }
    return groupByDay(entries);
  }, [schedule, byId, tz, committed]);
  const favCount = useMemo(() => favDays.reduce((n, [, e]) => n + e.length, 0), [favDays]);

  const eventDays = useMemo(() => {
    const set = new Set<string>();
    app.sessions.forEach((s) => {
      const iv = sessionInterval(s, tz);
      if (iv) set.add(dayKey(iv.start, tz));
    });
    return [...set].sort();
  }, [app.sessions, tz]);

  const guard = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: 'bad' });
    } finally {
      setBusy(null);
    }
  };

  const renamePersonal = (p: PersonalTime) => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt('Rename', undefined, (title) => {
      if (!title?.trim()) return;
      guard(p.personalTimeId, async () => {
        // PUT replaces the whole entry, so send every field (location too, or it gets cleared).
        await updatePersonalTime(app.eventId, p.personalTimeId, {
          startDateTime: p.startDateTime,
          endDateTime: p.endDateTime,
          title: title.trim().slice(0, 128),
          description: p.description,
          ...(p.location ? { location: p.location } : {}),
        });
        await app.refreshSchedule();
      });
    }, 'plain-text', p.title);
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      refreshControl={<RefreshControl refreshing={busy === 'refresh'} onRefresh={() => guard('refresh', async () => void (await app.refreshSchedule()))} tintColor={C.accent} />}
    >
      <Title sub={`${schedule.reserved.length} reserved · ${favCount} favorites · ${schedule.personalTime.length} blocks`}>
        My week
      </Title>
      <View style={{ paddingHorizontal: 16 }}>
        <Row style={{ marginBottom: 12 }}>
          <Chip label={`Schedule (${schedule.reserved.length} reserved)`} on={view === 'schedule'} onPress={() => setView('schedule')} />
          <Chip label={`Favorites (${favCount})`} on={view === 'favorites'} onPress={() => setView('favorites')} />
        </Row>
        {msg ? <Banner kind={msg.kind} text={msg.text} /> : null}
        {issues.length ? (
          <Banner kind="warn" text={issues.map((i) => `⚠ ${i.message}`).join('\n')} />
        ) : schedule.reserved.length ? (
          <Banner kind="good" text="No clashes, and every walk between venues fits." />
        ) : null}

        <Row style={{ marginBottom: 8 }}>
          <Btn
            small
            kind="ghost"
            label={`Sync walking time (${travel.length})`}
            busy={busy === 'walk'}
            onPress={() =>
              guard('walk', async () => {
                const o = await syncTravelBlocks(app.eventId, travel);
                app.setSchedule(o.schedule);
                const d = describePersonalTime(o, travel.length, tz);
                setMsg({ text: d.text, kind: d.ok ? 'good' : 'bad' });
              })
            }
          />
          <Btn small kind="ghost" label="Block time" onPress={() => setBlockDay(blockDay ? null : eventDays[0] || null)} />
        </Row>

        {blockDay ? (
          <Card>
            <Row style={{ marginBottom: 10 }}>
              {eventDays.map((d) => (
                <Chip key={d} label={fmtDay(d)} on={blockDay === d} onPress={() => setBlockDay(d)} />
              ))}
            </Row>
            <Field label="Title" value={block.title} onChangeText={(title) => setBlock({ ...block, title })} />
            <Row style={{ flexWrap: 'nowrap' }}>
              <View style={{ flex: 1 }}>
                <Field label="From" value={block.from} onChangeText={(from) => setBlock({ ...block, from })} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="To" value={block.to} onChangeText={(to) => setBlock({ ...block, to })} />
              </View>
            </Row>
            <Btn
              label="Add to my calendar"
              busy={busy === 'block'}
              onPress={() =>
                guard('block', async () => {
                  const start = zonedToUtc(blockDay, block.from, tz);
                  const end = zonedToUtc(blockDay, block.to, tz);
                  if (!(end > start) || (end - start) % 300000 !== 0) {
                    throw new Error('Use times on 5-minute steps, with the end after the start.');
                  }
                  const o = await ensurePersonalTime(app.eventId, [
                    {
                      startDateTime: toApiUtc(start),
                      endDateTime: toApiUtc(end),
                      title: block.title.trim().slice(0, 128) || 'Busy',
                      description: `${PT_TAG} blocked from Hallway`,
                    },
                  ]);
                  app.setSchedule(o.schedule);
                  if (o.failed.length) throw new Error(describePersonalTime(o, 1, tz, 'block').text);
                  setBlockDay(null);
                })
              }
            />
          </Card>
        ) : null}

        {view === 'schedule' ? (
          <>
            {!days.length ? <P dim>Nothing reserved yet. Reserve sessions from Plan or Explore and they show up here.</P> : null}
            {days.map(([day, entries]) => (
              <View key={day}>
                <H>{fmtDay(day)}</H>
                {entries.map((e) => {
                  if (e.kind === 'personal') {
                    const iv = personalInterval(e.p);
                    const walk = e.p.description.includes('travel:');
                    return (
                      <Card key={e.id} style={{ borderStyle: 'dashed' }}>
                        <Text style={{ color: walk ? C.dim : C.blue, fontWeight: '700' }}>
                          {walk ? '\u{1F6B6} ' : '\u25FC '}
                          {e.p.title}
                        </Text>
                        <P dim style={{ fontSize: 13, marginTop: 4 }}>
                          {fmtRange(iv, tz)}
                          {e.p.location ? ` \u00B7 ${e.p.location}` : ''}
                          {isOurs(e.p.description) ? ' \u00B7 from Hallway' : ''}
                        </P>
                        <Row style={{ marginTop: 8 }}>
                          {Platform.OS === 'ios' ? <Btn small kind="ghost" label="Rename" onPress={() => renamePersonal(e.p)} /> : null}
                          <Btn
                            small
                            kind="danger"
                            label="Remove"
                            busy={busy === e.id}
                            onPress={() =>
                              guard(e.id, async () => {
                                await deletePersonalTime(app.eventId, e.id);
                                await app.refreshSchedule();
                              })
                            }
                          />
                        </Row>
                      </Card>
                    );
                  }
                  const sess = byId.get(e.id)!;
                  return <SessionCard key={e.id} s={sess} tz={tz} reserved favorite={favSet.has(e.id)} actions hideFavorite />;
                })}
              </View>
            ))}
          </>
        ) : (
          <>
            <P dim style={{ marginBottom: 4 }}>
              Sessions you starred but do not have a seat for. Tap Reserve to book one.
            </P>
            {!favDays.length ? <P dim style={{ marginTop: 8 }}>No favorites waiting. Star sessions in Explore.</P> : null}
            {favDays.map(([day, entries]) => (
              <View key={day}>
                <H>{fmtDay(day)}</H>
                {entries.map((e) => (
                  <SessionCard
                    key={e.id}
                    s={byId.get(e.id)!}
                    tz={tz}
                    favorite
                    actions
                    note={e.clash ? { text: `Clashes with "${e.clash}"`, ok: false } : undefined}
                  />
                ))}
              </View>
            ))}
          </>
        )}

        <H>Account</H>
        <P dim>{app.email ? `Signed in as ${app.email}` : 'Signed in'} · event {app.eventId}</P>
        <Row style={{ marginTop: 10 }}>
          <Btn small kind="ghost" label="Reload catalog" onPress={() => app.refreshCatalog()} />
          <Btn
            small
            kind="danger"
            label="Sign out"
            onPress={() =>
              Alert.alert('Sign out', 'Also end your Builder ID session in the browser?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Only Hallway', onPress: () => app.signOut(false) },
                { text: 'Hallway + Builder ID', onPress: () => app.signOut(true) },
              ])
            }
          />
        </Row>
      </View>
    </ScrollView>
  );
}
