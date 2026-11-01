import React, { useMemo, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { deletePersonalTime, updatePersonalTime } from '../api/events';
import type { PersonalTime } from '../api/types';
import { isOurs, personalInterval } from '../logic/reconcile';
import { analyze, sessionSlot, Slot } from '../logic/scheduler';
import { dayKey, fmtDay, fmtRange, overlaps, sessionInterval } from '../logic/time';
import { useApp } from '../state/AppState';
import { SessionCard } from '../ui/SessionCard';
import { Banner, Btn, C, Card, Chip, H, P, Row, Title } from '../ui/kit';

type Entry =
  | { kind: 'session'; id: string; start: number; reserved: boolean }
  | { kind: 'personal'; id: string; start: number; p: PersonalTime }
  | { kind: 'walk'; id: string; start: number; end: number; title: string };

type Msg = { text: string; kind: 'bad' | 'good' | 'warn' };

export function WeekScreen() {
  const app = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  // Two lists, never mixed: what you hold seats for, and what you only starred.
  const [view, setView] = useState<'schedule' | 'favorites'>('schedule');

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
    // Walks between venues are worked out by Hallway and shown between your sessions.
    travel.forEach((t) => entries.push({ kind: 'walk', id: `walk-${t.beforeSessionId}`, start: t.start, end: t.end, title: t.title }));
    return groupByDay(entries);
  }, [schedule, byId, tz, travel]);

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

        {view === 'schedule' ? (
          <>
            {!days.length ? <P dim>Nothing reserved yet. Reserve sessions from Plan or Explore and they show up here.</P> : null}
            {days.map(([day, entries]) => (
              <View key={day}>
                <H>{fmtDay(day)}</H>
                {entries.map((e) => {
                  if (e.kind === 'walk') {
                    return (
                      <P key={e.id} dim style={{ fontSize: 13, marginVertical: 2, marginLeft: 6 }}>
                        {'\u{1F6B6} '}
                        {e.title} {'\u00B7'} {fmtRange({ start: e.start, end: e.end }, tz)}
                      </P>
                    );
                  }
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
