import React, { useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { levelNumber, search } from '../logic/filter';
import { dayKey, fmtDay, sessionInterval } from '../logic/time';
import { useApp } from '../state/AppState';
import { useActions } from '../state/useActions';
import { SessionCard } from '../ui/SessionCard';
import { Btn, Chip, Field, P, Row, Title } from '../ui/kit';

export function ExploreScreen() {
  const app = useApp();
  const act = useActions();
  const [q, setQ] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [onlyFav, setOnlyFav] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reserved = useMemo(() => new Set(app.schedule.reserved), [app.schedule]);
  const favs = useMemo(() => new Set(app.schedule.favorites), [app.schedule]);

  const days = useMemo(() => {
    const set = new Set<string>();
    app.sessions.forEach((s) => {
      const iv = sessionInterval(s, app.tz);
      if (iv) set.add(dayKey(iv.start, app.tz));
    });
    return [...set].sort();
  }, [app.sessions, app.tz]);

  const results = useMemo(() => {
    let list = search(app.sessions, q);
    if (day) list = list.filter((s) => {
      const iv = sessionInterval(s, app.tz);
      return iv && dayKey(iv.start, app.tz) === day;
    });
    if (level) list = list.filter((s) => levelNumber(s.level) === level);
    if (onlyFav) list = list.filter((s) => favs.has(s.sessionId) || reserved.has(s.sessionId));
    if (!q.trim()) {
      list = [...list].sort((a, b) => (sessionInterval(a, app.tz)?.start ?? 0) - (sessionInterval(b, app.tz)?.start ?? 0));
    }
    return list;
  }, [app.sessions, app.tz, q, day, level, onlyFav, favs, reserved]);

  const wrap = (id: string, fn: () => Promise<void>) => async () => {
    setBusyId(id);
    await fn();
    setBusyId(null);
  };

  return (
    <View style={{ flex: 1 }}>
      <Title sub={`${app.sessions.length} sessions in the catalog`}>Explore</Title>
      <View style={{ paddingHorizontal: 16 }}>
        <Field
          value={q}
          onChangeText={setQ}
          placeholder="Search: bedrock agents, AIM301, a speaker..."
          autoCorrect={false}
          returnKeyType="search"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
          <Row style={{ flexWrap: 'nowrap' }}>
            <Chip label="★ Mine" on={onlyFav} onPress={() => setOnlyFav(!onlyFav)} />
            {days.map((d) => (
              <Chip key={d} label={fmtDay(d)} on={day === d} onPress={() => setDay(day === d ? null : d)} />
            ))}
            {[100, 200, 300, 400].map((l) => (
              <Chip key={l} label={String(l)} on={level === l} onPress={() => setLevel(level === l ? null : l)} />
            ))}
          </Row>
        </ScrollView>
      </View>
      <FlatList
        data={results.slice(0, 200)}
        keyExtractor={(s) => s.sessionId}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListEmptyComponent={<P dim>No sessions match.</P>}
        ListFooterComponent={
          results.length > 200 ? <P dim>Showing 200 of {results.length}. Narrow the search to see more.</P> : null
        }
        renderItem={({ item: s }) => {
          const isRes = reserved.has(s.sessionId);
          const isFav = favs.has(s.sessionId);
          const busy = busyId === s.sessionId;
          return (
            <SessionCard
              s={s}
              tz={app.tz}
              reserved={isRes}
              favorite={isFav}
              right={
                <Row>
                  <Btn
                    small
                    kind="ghost"
                    label={isFav ? '★ Unfavorite' : '☆ Favorite'}
                    disabled={busy}
                    onPress={wrap(s.sessionId, () => (isFav ? act.unfavorite(s.sessionId) : act.favorite(s.sessionId)))}
                  />
                  {s.seatAvailability !== 'walkUp' && s.isReservable !== false ? (
                    <Btn
                      small
                      kind={isRes ? 'danger' : 'primary'}
                      label={isRes ? 'Cancel seat' : 'Reserve'}
                      busy={busy}
                      onPress={wrap(s.sessionId, () => (isRes ? act.cancel(s.sessionId) : act.reserve(s.sessionId)))}
                    />
                  ) : null}
                </Row>
              }
            />
          );
        }}
      />
    </View>
  );
}
