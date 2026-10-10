import * as Linking from 'expo-linking';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import {
  addItem,
  createGroup,
  freeTime,
  getGroup,
  GroupItem,
  GroupMode,
  GroupState,
  joinGroup,
  leaveGroup,
  myGroups,
  removeItem,
  rsvp,
  shareBusy,
  Slot,
  splitSessions,
} from '../api/backend';
import { APP_SCHEME, PT_TAG } from '../config';
import { venueLabel } from '../data/venues';
import { ensurePersonalTime, personalInterval, reserveAll } from '../logic/reconcile';
import { ceil5, dayKey, floor5, fmtDay, fmtRange, sessionInterval, toApiUtc, zonedToUtc } from '../logic/time';
import { useApp } from '../state/AppState';
import { describeReport } from '../state/useActions';
import { Badge, Banner, Btn, C, Card, Chip, Field, H, P, Row, Title } from '../ui/kit';

const inviteLink = (code: string) => `${APP_SCHEME}://join/${code}`;

export function GroupsScreen() {
  const app = useApp();
  const url = Linking.useURL();
  const [list, setList] = useState<{ groupId: string; name: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<GroupMode>('squad');
  const [me, setMe] = useState(app.email?.split('@')[0] || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => setList(await myGroups()), []);
  useEffect(() => {
    reload();
  }, [reload]);

  // hallway://join/ABCD1234 opens here with the code filled in.
  useEffect(() => {
    const m = url?.match(/join\/([A-Za-z0-9]+)/);
    if (m) setCode(m[1].toUpperCase());
  }, [url]);

  const guard = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (open) return <GroupDetail groupId={open} onBack={() => (setOpen(null), reload())} />;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Title sub="A shared calendar for your crew. Everyone keeps their own AWS login.">Groups</Title>
      <View style={{ paddingHorizontal: 16 }}>
        {err ? <Banner kind="bad" text={err} /> : null}

        {list.map((g) => (
          <Card key={g.groupId}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{g.name}</Text>
              <Btn small label="Open" onPress={() => setOpen(g.groupId)} />
            </Row>
          </Card>
        ))}

        <Field label="Your name in groups" value={me} onChangeText={setMe} placeholder="Matias" />

        <H>Join with an invite</H>
        <Row style={{ flexWrap: 'nowrap' }}>
          <View style={{ flex: 1 }}>
            <Field value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="Invite code" autoCapitalize="characters" />
          </View>
          <Btn
            label="Join"
            busy={busy === 'join'}
            disabled={!code || !me}
            style={{ marginBottom: 12 }}
            onPress={() =>
              guard('join', async () => {
                const g = await joinGroup(code, me.trim());
                setCode('');
                await reload();
                setOpen(g.groupId);
              })
            }
          />
        </Row>

        <H>Start a group</H>
        <Field value={name} onChangeText={setName} placeholder="AWS Community Builders LATAM" />
        <Row style={{ marginBottom: 12 }}>
          <Chip label="Squad: go together" on={mode === 'squad'} onPress={() => setMode('squad')} />
          <Chip label="Team: split and cover more" on={mode === 'team'} onPress={() => setMode('team')} />
        </Row>
        <Btn
          label="Create group"
          busy={busy === 'create'}
          disabled={!name.trim() || !me.trim()}
          onPress={() =>
            guard('create', async () => {
              const g = await createGroup(name.trim(), mode, me.trim(), app.eventId);
              setName('');
              await reload();
              setOpen(g.groupId);
            })
          }
        />
      </View>
    </ScrollView>
  );
}

function GroupDetail({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const app = useApp();
  const { tz, byId, schedule } = app;
  const [st, setSt] = useState<GroupState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'bad' | 'good' | 'info'; text: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [freeDay, setFreeDay] = useState<string | null>(null);
  const [free, setFree] = useState<{ slots: Slot[]; reporting: number; members: number } | null>(null);
  const [meetup, setMeetup] = useState<{ start: number; end: number; title: string; location: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setSt(await getGroup(groupId));
    } catch (e) {
      setMsg({ kind: 'bad', text: e instanceof Error ? e.message : String(e) });
    }
  }, [groupId]);
  useEffect(() => {
    load();
  }, [load]);

  const guard = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const days = useMemo(() => {
    const set = new Set<string>();
    app.sessions.forEach((s) => {
      const iv = sessionInterval(s, tz);
      if (iv) set.add(dayKey(iv.start, tz));
    });
    return [...set].sort();
  }, [app.sessions, tz]);

  const itemsByDay = useMemo(() => {
    const m = new Map<string, GroupItem[]>();
    (st?.items || [])
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach((i) => {
        const k = dayKey(i.start, tz);
        m.set(k, [...(m.get(k) || []), i]);
      });
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [st, tz]);

  if (!st) {
    return (
      <View style={{ padding: 16 }}>
        <Btn small kind="ghost" label="‹ Groups" onPress={onBack} style={{ alignSelf: 'flex-start' }} />
        {msg ? <Banner kind={msg.kind} text={msg.text} /> : <P dim style={{ marginTop: 16 }}>Loading...</P>}
      </View>
    );
  }

  const nameOf = (id: string) => st.members.find((m) => m.memberId === id)?.displayName || 'someone';
  const team = st.group.mode === 'team';
  const myAssigned = st.items.filter((i) => i.kind === 'session' && i.assignee === st.me);
  const proposed = new Set(st.items.map((i) => i.sessionId).filter(Boolean));
  const mine = [...new Set([...schedule.reserved, ...schedule.favorites])]
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s && !proposed.has(s.sessionId) && !!sessionInterval(s, tz));

  /** Busy = my reserved sessions + my personal time. Only times leave the phone. */
  const myBusy = (): Slot[] => [
    ...schedule.reserved
      .map((id) => byId.get(id))
      .map((s) => (s ? sessionInterval(s, tz) : null))
      .filter((x): x is Slot => !!x),
    ...schedule.personalTime.map(personalInterval),
  ];

  const joinItem = (i: GroupItem) =>
    guard(i.itemId, async () => {
      await rsvp(groupId, i.itemId, true);
      if (i.kind === 'session' && i.sessionId) {
        const s = byId.get(i.sessionId);
        if (s) {
          const r = await reserveAll(app.eventId, [s]);
          app.setSchedule(r.schedule);
          if (!r.done.includes(s.sessionId)) setMsg({ kind: 'info', text: describeReport(r, byId, 'Reserving') });
        }
      } else {
        // A meetup becomes personal time on your own re:Invent calendar.
        app.setSchedule(
          await ensurePersonalTime(app.eventId, [
            {
              startDateTime: toApiUtc(i.start),
              endDateTime: toApiUtc(i.end),
              title: i.title.slice(0, 128),
              description: `${PT_TAG} ${st.group.name}`.slice(0, 250),
              ...(i.location ? { location: i.location.slice(0, 255) } : {}),
            },
          ])
        );
      }
      await load();
    });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Btn small kind="ghost" label="‹ Groups" onPress={onBack} style={{ alignSelf: 'flex-start', marginBottom: 8 }} />
      <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>{st.group.name}</Text>
      <P dim style={{ marginTop: 4 }}>
        {team ? 'Team: split sessions, cover more' : 'Squad: attend together'} · {st.members.length} members
      </P>
      <P dim style={{ marginTop: 4 }}>{st.members.map((m) => m.displayName + (m.busyUpdatedAt ? ' ✓' : '')).join(', ')}</P>

      <Row style={{ marginTop: 12 }}>
        <Btn
          small
          label={`Invite · ${st.group.inviteCode}`}
          onPress={() =>
            Share.share({
              message: `Join "${st.group.name}" on Hallway to plan re:Invent together.\nCode: ${st.group.inviteCode}\n${inviteLink(st.group.inviteCode)}`,
            })
          }
        />
        <Btn
          small
          kind="ghost"
          label="Share my busy time"
          busy={busy === 'busy'}
          onPress={() =>
            guard('busy', async () => {
              await shareBusy(groupId, myBusy());
              setMsg({ kind: 'good', text: 'Shared your busy times (just times, not what they are).' });
              await load();
            })
          }
        />
        <Btn small kind="ghost" label="Refresh" onPress={load} />
      </Row>

      {msg ? <View style={{ marginTop: 12 }}><Banner kind={msg.kind} text={msg.text} /></View> : null}

      {/* ---- propose a session ---- */}
      <H>Shared calendar</H>
      <Row style={{ marginBottom: 8 }}>
        <Btn small label="+ Propose a session" onPress={() => setPicking(!picking)} />
        <Btn small kind="ghost" label="Find free time" onPress={() => setFreeDay(freeDay ? null : days[0] || null)} />
        {team ? (
          <Btn
            small
            kind="ghost"
            label="Split sessions"
            busy={busy === 'split'}
            onPress={() =>
              guard('split', async () => {
                const r = await splitSessions(groupId);
                await load();
                setMsg({
                  kind: 'info',
                  text: `Assigned ${Object.keys(r.assignments).length} sessions.${r.unassigned.length ? ` ${r.unassigned.length} had nobody free.` : ''}`,
                });
              })
            }
          />
        ) : null}
      </Row>

      {picking ? (
        <Card>
          <P dim style={{ marginBottom: 8 }}>From your favorites and reservations:</P>
          {!mine.length ? <P dim>Nothing left to propose. Favorite sessions in Explore first.</P> : null}
          {mine.slice(0, 30).map((s) => {
            const iv = sessionInterval(s, tz)!;
            return (
              <Row key={s.sessionId} style={{ justifyContent: 'space-between', flexWrap: 'nowrap', marginBottom: 10 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: C.text, fontWeight: '600' }} numberOfLines={2}>{s.title}</Text>
                  <P dim style={{ fontSize: 12 }}>{fmtDay(dayKey(iv.start, tz))} · {fmtRange(iv, tz)}</P>
                </View>
                <Btn
                  small
                  label="Add"
                  busy={busy === s.sessionId}
                  onPress={() =>
                    guard(s.sessionId, async () => {
                      // Only id, title, time and venue go to the group.
                      await addItem(groupId, {
                        kind: 'session',
                        sessionId: s.sessionId,
                        title: s.title.slice(0, 200),
                        start: iv.start,
                        end: iv.end,
                        location: venueLabel(s.venue),
                      });
                      await load();
                    })
                  }
                />
              </Row>
            );
          })}
        </Card>
      ) : null}

      {/* ---- free time finder ---- */}
      {freeDay ? (
        <Card>
          <Row style={{ marginBottom: 10 }}>
            {days.map((d) => (
              <Chip key={d} label={fmtDay(d)} on={freeDay === d} onPress={() => (setFreeDay(d), setFree(null))} />
            ))}
          </Row>
          <Btn
            small
            label="When is everyone free?"
            busy={busy === 'free'}
            onPress={() =>
              guard('free', async () => {
                await shareBusy(groupId, myBusy()); // keep mine fresh
                const from = zonedToUtc(freeDay, '08:00', tz);
                const to = zonedToUtc(freeDay, '22:00', tz);
                setFree(await freeTime(groupId, from, to, 30));
              })
            }
          />
          {free ? (
            <View style={{ marginTop: 10 }}>
              <P dim style={{ fontSize: 12, marginBottom: 6 }}>
                Based on {free.reporting} of {free.members} members who shared busy time.
              </P>
              {!free.slots.length ? <P dim>No common free time that day.</P> : null}
              {free.slots.map((s) => (
                <Row key={s.start} style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <P>{fmtRange(s, tz)}</P>
                  <Btn
                    small
                    kind="ghost"
                    label="Plan meetup"
                    onPress={() =>
                      setMeetup({
                        start: ceil5(s.start),
                        end: Math.min(floor5(s.end), ceil5(s.start) + 60 * 60000),
                        title: 'Meetup',
                        location: '',
                      })
                    }
                  />
                </Row>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      {meetup ? (
        <Card>
          <P style={{ marginBottom: 8 }}>{fmtDay(dayKey(meetup.start, tz))} · {fmtRange(meetup, tz)}</P>
          <Field label="What" value={meetup.title} onChangeText={(title) => setMeetup({ ...meetup, title })} />
          <Field label="Where" value={meetup.location} onChangeText={(location) => setMeetup({ ...meetup, location })} placeholder="Venetian food court" />
          <Btn
            label="Add to group calendar"
            busy={busy === 'meetup'}
            onPress={() =>
              guard('meetup', async () => {
                const item = await addItem(groupId, {
                  kind: 'meetup',
                  title: meetup.title.trim() || 'Meetup',
                  start: meetup.start,
                  end: meetup.end,
                  location: meetup.location.trim() || undefined,
                });
                setMeetup(null);
                setFreeDay(null);
                await load();
                await joinItem(item);
              })
            }
          />
        </Card>
      ) : null}

      {team && myAssigned.length ? (
        <Btn
          label={`Reserve my ${myAssigned.length} assigned sessions`}
          busy={busy === 'take'}
          style={{ marginBottom: 12 }}
          onPress={() =>
            guard('take', async () => {
              const sessions = myAssigned.map((i) => byId.get(i.sessionId || '')).filter((s): s is NonNullable<typeof s> => !!s);
              const r = await reserveAll(app.eventId, sessions);
              app.setSchedule(r.schedule);
              setMsg({ kind: 'info', text: describeReport(r, byId, 'Reserving') });
            })
          }
        />
      ) : null}

      {!itemsByDay.length ? <P dim>Nothing on the group calendar yet.</P> : null}
      {itemsByDay.map(([day, items]) => (
        <View key={day}>
          <H>{fmtDay(day)}</H>
          {items.map((i) => {
            const going = i.going.includes(st.me);
            const onMine =
              i.kind === 'session' ? !!i.sessionId && schedule.reserved.includes(i.sessionId) : false;
            return (
              <Card key={i.itemId} style={i.kind === 'meetup' ? { borderColor: C.blue } : undefined}>
                <Row style={{ marginBottom: 4 }}>
                  <Badge text={i.kind === 'meetup' ? 'Meetup' : 'Session'} color={i.kind === 'meetup' ? C.blue : C.dim} />
                  {i.assignee ? <Badge text={`→ ${i.assignee === st.me ? 'you' : nameOf(i.assignee)}`} color={C.accent} /> : null}
                  {onMine ? <Badge text="Reserved" color={C.accent} /> : null}
                </Row>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{i.title}</Text>
                <P dim style={{ fontSize: 13, marginTop: 4 }}>
                  {fmtRange(i, tz)}{i.location ? ` · ${i.location}` : ''} · by {nameOf(i.createdBy)}
                </P>
                <P style={{ fontSize: 13, marginTop: 6 }}>
                  {i.going.length ? `Going: ${i.going.map(nameOf).join(', ')}` : 'Nobody yet'}
                </P>
                <Row style={{ marginTop: 8 }}>
                  {!going ? (
                    <Btn small label="I'm in" busy={busy === i.itemId} onPress={() => joinItem(i)} />
                  ) : (
                    <Btn
                      small
                      kind="ghost"
                      label="I'm out"
                      busy={busy === i.itemId}
                      onPress={() => guard(i.itemId, async () => void (await rsvp(groupId, i.itemId, false), await load()))}
                    />
                  )}
                  {i.createdBy === st.me ? (
                    <Btn
                      small
                      kind="danger"
                      label="Remove"
                      onPress={() => guard('rm' + i.itemId, async () => void (await removeItem(groupId, i.itemId), await load()))}
                    />
                  ) : null}
                </Row>
              </Card>
            );
          })}
        </View>
      ))}

      <Btn
        kind="danger"
        label="Leave group"
        style={{ marginTop: 24 }}
        onPress={() =>
          Alert.alert('Leave group?', 'Your seats and blocks on re:Invent stay as they are.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: () => leaveGroup(groupId).finally(onBack) },
          ])
        }
      />
    </ScrollView>
  );
}
