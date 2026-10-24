import * as Linking from 'expo-linking';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import {
  addItem,
  createGroup,
  deleteGroup,
  freeTime,
  getGroup,
  GroupItem,
  GroupMode,
  GroupState,
  joinGroup,
  leaveGroup,
  myGroups,
  removeItem,
  removeMember,
  rsvp,
  shareBusy,
  Slot,
  splitSessions,
} from '../api/backend';
import { APP_SCHEME, PT_TAG } from '../config';
import { venueLabel } from '../data/venues';
import { describePersonalTime, ensurePersonalTime, personalInterval, reserveAll } from '../logic/reconcile';
import { search } from '../logic/filter';
import { ceil5, clockString, dayKey, floor5, fmtDay, fmtRange, hhmm, parseClock, sessionInterval, toApiUtc, zonedToUtc } from '../logic/time';
import { useApp } from '../state/AppState';
import { describeReport } from '../state/useActions';
import { GroupCalendar } from '../ui/GroupCalendar';
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
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
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
  const [meetup, setMeetup] = useState<{ day: string; from: string; to: string; title: string; location: string } | null>(null);
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  const [calDay, setCalDay] = useState<string | null>(null);
  // proposing a session: search the whole catalog, or just your own favorites and reservations
  const [pq, setPq] = useState('');
  const [pMine, setPMine] = useState(false);
  const [pDay, setPDay] = useState<string | null>(null);
  // finding free time: the window and how long it has to be
  const [freeFrom, setFreeFrom] = useState('08:00');
  const [freeTo, setFreeTo] = useState('22:00');
  const [freeMin, setFreeMin] = useState(30);

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
  const isOwner = st.ownerId === st.me;
  const myAssigned = st.items.filter((i) => i.kind === 'session' && i.assignee === st.me);
  const proposed = new Set(st.items.map((i) => i.sessionId).filter(Boolean));
  const mine = [...new Set([...schedule.reserved, ...schedule.favorites])]
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s && !proposed.has(s.sessionId) && !!sessionInterval(s, tz));

  const startOf = (x: (typeof app.sessions)[number]) => sessionInterval(x, tz)?.start ?? 0;
  const pickList = !picking
    ? []
    : (() => {
        let list = pMine ? mine : app.sessions.filter((x) => !proposed.has(x.sessionId) && !!sessionInterval(x, tz));
        if (pq.trim()) list = search(list, pq);
        if (pDay) list = list.filter((x) => dayKey(startOf(x), tz) === pDay);
        return pq.trim() ? list : [...list].sort((a, b) => startOf(a) - startOf(b));
      })();
  const calDayShown = calDay || itemsByDay[0]?.[0] || days[0] || null;

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
        const o = await ensurePersonalTime(app.eventId, [
          {
            startDateTime: toApiUtc(i.start),
            endDateTime: toApiUtc(i.end),
            title: i.title.slice(0, 128),
            description: `${PT_TAG} ${st.group.name}`.slice(0, 250),
            ...(i.location ? { location: i.location.slice(0, 255) } : {}),
          },
        ]);
        app.setSchedule(o.schedule);
        if (o.failed.length) throw new Error(describePersonalTime(o, 1, tz, 'block').text);
      }
      await load();
    });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
      <Btn small kind="ghost" label="‹ Groups" onPress={onBack} style={{ alignSelf: 'flex-start', marginBottom: 8 }} />
      <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>{st.group.name}</Text>
      <P dim style={{ marginTop: 4 }}>
        {team ? 'Team: split sessions, cover more' : 'Squad: attend together'} · {st.members.length} members
      </P>

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

      {/* ---- members ---- */}
      <H>Members ({st.members.length})</H>
      {st.members.map((m) => (
        <Card key={m.memberId} style={{ paddingVertical: 10 }}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontWeight: '700' }}>
                {m.displayName}
                {m.memberId === st.me ? ' (you)' : ''}
              </Text>
              <Text style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
                {[m.memberId === st.ownerId ? 'Owner' : null, m.busyUpdatedAt ? 'shared busy time' : 'no busy time shared']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {isOwner && m.memberId !== st.me ? (
              <Btn
                small
                kind="danger"
                label="Remove"
                onPress={() =>
                  Alert.alert(`Remove ${m.displayName}?`, 'They lose access to this group. Their seats on re:Invent are not touched.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => guard('rmm' + m.memberId, async () => void (await removeMember(groupId, m.memberId), await load())),
                    },
                  ])
                }
              />
            ) : null}
          </Row>
        </Card>
      ))}

      {/* ---- propose a session ---- */}
      <H>Shared calendar</H>
      <Row style={{ marginBottom: 10 }}>
        <Chip label="Calendar" on={view === 'calendar'} onPress={() => setView('calendar')} />
        <Chip label="List" on={view === 'list'} onPress={() => setView('list')} />
      </Row>
      <Row style={{ marginBottom: 8 }}>
        <Btn small label="+ Propose a session" onPress={() => setPicking(!picking)} />
        <Btn small kind="ghost" label="Find free time" onPress={() => setFreeDay(freeDay ? null : days[0] || null)} />
        <Btn
          small
          kind="ghost"
          label="+ Plan a meetup"
          onPress={() =>
            setMeetup(meetup ? null : { day: calDayShown || days[0] || '', from: '18:00', to: '19:00', title: 'Meetup', location: '' })
          }
        />
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
          <Field
            value={pq}
            onChangeText={setPq}
            placeholder="Search all sessions: bedrock, AIM301, a speaker..."
            autoCorrect={false}
            returnKeyType="search"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} keyboardShouldPersistTaps="handled">
            <Row style={{ flexWrap: 'nowrap' }}>
              <Chip label="★ Mine" on={pMine} onPress={() => setPMine(!pMine)} />
              {days.map((d) => (
                <Chip key={d} label={fmtDay(d)} on={pDay === d} onPress={() => setPDay(pDay === d ? null : d)} />
              ))}
            </Row>
          </ScrollView>
          <P dim style={{ fontSize: 12, marginBottom: 8 }}>
            {pMine
              ? 'Showing your favorites and reservations. Turn off ★ Mine to search the whole catalog.'
              : `Searching all ${app.sessions.length} sessions.`}
          </P>
          {!pickList.length ? <P dim>No sessions match.</P> : null}
          {pickList.slice(0, 30).map((x) => {
            const iv = sessionInterval(x, tz)!;
            return (
              <Row key={x.sessionId} style={{ justifyContent: 'space-between', flexWrap: 'nowrap', marginBottom: 10 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: C.text, fontWeight: '600' }} numberOfLines={2}>{x.title}</Text>
                  <P dim style={{ fontSize: 12 }}>{fmtDay(dayKey(iv.start, tz))} · {fmtRange(iv, tz)}</P>
                </View>
                <Btn
                  small
                  label="Add"
                  busy={busy === x.sessionId}
                  onPress={() =>
                    guard(x.sessionId, async () => {
                      // Only id, title, time and venue go to the group.
                      await addItem(groupId, {
                        kind: 'session',
                        sessionId: x.sessionId,
                        title: x.title.slice(0, 200),
                        start: iv.start,
                        end: iv.end,
                        location: venueLabel(x.venue),
                      });
                      await load();
                    })
                  }
                />
              </Row>
            );
          })}
          {pickList.length > 30 ? <P dim style={{ fontSize: 12 }}>Showing 30 of {pickList.length}. Narrow the search to see others.</P> : null}
        </Card>
      ) : null}

      {/* ---- free time finder ---- */}
      {freeDay ? (
        <Card>
          <P style={{ fontWeight: '700', marginBottom: 8 }}>Find a time when everyone is free</P>
          <Row style={{ marginBottom: 10 }}>
            {days.map((d) => (
              <Chip key={d} label={fmtDay(d)} on={freeDay === d} onPress={() => (setFreeDay(d), setFree(null))} />
            ))}
          </Row>
          <Row style={{ flexWrap: 'nowrap' }}>
            <View style={{ flex: 1 }}>
              <Field label="From" value={freeFrom} keyboardType="numbers-and-punctuation" onChangeText={(v) => (setFreeFrom(v), setFree(null))} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Until" value={freeTo} keyboardType="numbers-and-punctuation" onChangeText={(v) => (setFreeTo(v), setFree(null))} />
            </View>
          </Row>
          <P dim style={{ fontSize: 12, marginBottom: 6 }}>For at least:</P>
          <Row style={{ marginBottom: 10 }}>
            {[30, 60, 90, 120].map((m) => (
              <Chip key={m} label={m < 60 ? `${m} min` : `${m / 60} h`} on={freeMin === m} onPress={() => (setFreeMin(m), setFree(null))} />
            ))}
          </Row>
          <Btn
            small
            label="Find free time"
            busy={busy === 'free'}
            onPress={() =>
              guard('free', async () => {
                const f = parseClock(freeFrom);
                const t = parseClock(freeTo);
                if (f === null || t === null || t <= f) throw new Error('Use times like 08:00 and 22:00, with the end after the start.');
                await shareBusy(groupId, myBusy()); // keep mine fresh
                setFree(await freeTime(groupId, zonedToUtc(freeDay, clockString(f), tz), zonedToUtc(freeDay, clockString(t), tz), freeMin));
              })
            }
          />
          {free ? (
            <View style={{ marginTop: 10 }}>
              <P dim style={{ fontSize: 12, marginBottom: 6 }}>
                Based on {free.reporting} of {free.members} members who shared busy time.
              </P>
              {!free.slots.length ? <P dim>No common free time of that length in that window.</P> : null}
              {free.slots.map((sl) => (
                <Row key={sl.start} style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <P>{fmtRange(sl, tz)}</P>
                  <Btn
                    small
                    kind="ghost"
                    label="Plan meetup"
                    onPress={() =>
                      setMeetup({
                        day: freeDay,
                        from: hhmm(ceil5(sl.start), tz),
                        to: hhmm(Math.min(floor5(sl.end), ceil5(sl.start) + 60 * 60000), tz),
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
          <P style={{ fontWeight: '700', marginBottom: 8 }}>Plan a meetup</P>
          <Row style={{ marginBottom: 10 }}>
            {days.map((d) => (
              <Chip key={d} label={fmtDay(d)} on={meetup.day === d} onPress={() => setMeetup({ ...meetup, day: d })} />
            ))}
          </Row>
          <Row style={{ flexWrap: 'nowrap' }}>
            <View style={{ flex: 1 }}>
              <Field label="Starts" value={meetup.from} keyboardType="numbers-and-punctuation" onChangeText={(from) => setMeetup({ ...meetup, from })} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Ends" value={meetup.to} keyboardType="numbers-and-punctuation" onChangeText={(to) => setMeetup({ ...meetup, to })} />
            </View>
          </Row>
          <Field label="What" value={meetup.title} onChangeText={(title) => setMeetup({ ...meetup, title })} />
          <Field label="Where" value={meetup.location} onChangeText={(location) => setMeetup({ ...meetup, location })} placeholder="Venetian food court" />
          <Row>
            <Btn
              label="Add to group calendar"
              busy={busy === 'meetup'}
              onPress={() =>
                guard('meetup', async () => {
                  const f = parseClock(meetup.from);
                  const t = parseClock(meetup.to);
                  if (!meetup.day) throw new Error('Pick a day.');
                  if (f === null || t === null) throw new Error('Use times like 18:00 and 19:30.');
                  const start = ceil5(zonedToUtc(meetup.day, clockString(f), tz));
                  const end = floor5(zonedToUtc(meetup.day, clockString(t), tz));
                  if (end <= start) throw new Error('The meetup has to end after it starts.');
                  const item = await addItem(groupId, {
                    kind: 'meetup',
                    title: meetup.title.trim() || 'Meetup',
                    start,
                    end,
                    location: meetup.location.trim() || undefined,
                  });
                  setMeetup(null);
                  setFreeDay(null);
                  await load();
                  await joinItem(item);
                })
              }
            />
            <Btn kind="ghost" label="Cancel" onPress={() => setMeetup(null)} />
          </Row>
        </Card>
      ) : null}

      {/* ---- calendar view ---- */}
      {view === 'calendar' ? (
        <View style={{ marginBottom: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} keyboardShouldPersistTaps="handled">
            <Row style={{ flexWrap: 'nowrap' }}>
              {days.map((d) => (
                <Chip key={d} label={fmtDay(d)} on={calDayShown === d} onPress={() => setCalDay(d)} />
              ))}
            </Row>
          </ScrollView>
          {calDayShown ? <GroupCalendar day={calDayShown} items={st.items} busy={myBusy()} tz={tz} me={st.me} /> : null}
          <P dim style={{ fontSize: 12, marginTop: 6 }}>
            Orange: sessions. Blue: meetups. Grey dashed: you are busy (only you can see that).
            {!itemsByDay.length ? ' Nothing has been added yet.' : ''}
          </P>
        </View>
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

      {view === 'list' && !itemsByDay.length ? <P dim>Nothing on the group calendar yet.</P> : null}
      {view === 'list' && itemsByDay.map(([day, items]) => (
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
                  {i.createdBy === st.me || isOwner ? (
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
          Alert.alert(
            'Leave group?',
            st.members.length === 1
              ? 'You are the last member, so leaving deletes the group and its calendar. Your seats and blocks on re:Invent stay as they are.'
              : isOwner
                ? 'The group carries on. The member who has been in it longest becomes the owner. Your seats and blocks on re:Invent stay as they are.'
                : 'Your seats and blocks on re:Invent stay as they are.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Leave', style: 'destructive', onPress: () => leaveGroup(groupId).finally(onBack) },
            ]
          )
        }
      />
      {isOwner && st.members.length > 1 ? (
        <Btn
          kind="danger"
          label="Delete group for everyone"
          style={{ marginTop: 10 }}
          onPress={() =>
            Alert.alert('Delete group for everyone?', 'The calendar and the invite code are removed for all members. This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteGroup(groupId).finally(onBack) },
            ])
          }
        />
      ) : null}
    </ScrollView>
  );
}
