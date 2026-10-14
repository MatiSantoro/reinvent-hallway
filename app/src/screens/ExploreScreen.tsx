import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Keyboard, ScrollView, View } from 'react-native';
import type { Session } from '../api/types';
import { levelNumber, search } from '../logic/filter';
import { dayKey, fmtDay, sessionInterval } from '../logic/time';
import { useApp } from '../state/AppState';
import { SessionCard } from '../ui/SessionCard';
import { Chip, Field, P, Row, Title } from '../ui/kit';

const PAGE = 200;

export function ExploreScreen() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [onlyFav, setOnlyFav] = useState(false);
  // Typing stays snappy: the list catches up when the keyboard lets it.
  const deferredQ = useDeferredValue(q);

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

  // Day and start time are worked out once per catalog, not on every filter tap.
  const dayOf = useMemo(() => {
    const m = new Map<string, string>();
    app.sessions.forEach((s) => {
      const iv = sessionInterval(s, app.tz);
      if (iv) m.set(s.sessionId, dayKey(iv.start, app.tz));
    });
    return m;
  }, [app.sessions, app.tz]);

  const results = useMemo(() => {
    let list = search(app.sessions, deferredQ);
    if (day) list = list.filter((s) => dayOf.get(s.sessionId) === day);
    if (level) list = list.filter((s) => levelNumber(s.level) === level);
    if (onlyFav) list = list.filter((s) => favs.has(s.sessionId) || reserved.has(s.sessionId));
    if (!deferredQ.trim()) {
      list = [...list].sort((a, b) => (sessionInterval(a, app.tz)?.start ?? 0) - (sessionInterval(b, app.tz)?.start ?? 0));
    }
    return list;
  }, [app.sessions, app.tz, deferredQ, day, level, onlyFav, favs, reserved, dayOf]);

  const shown = useMemo(() => results.slice(0, PAGE), [results]);

  const renderItem = useCallback(
    ({ item: s }: { item: Session }) => (
      <SessionCard
        s={s}
        tz={app.tz}
        reserved={reserved.has(s.sessionId)}
        favorite={favs.has(s.sessionId)}
        actions
      />
    ),
    [app.tz, reserved, favs]
  );

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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} keyboardShouldPersistTaps="handled">
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
        data={shown}
        keyExtractor={(s) => s.sessionId}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={<P dim>No sessions match.</P>}
        ListFooterComponent={
          results.length > PAGE ? <P dim>Showing {PAGE} of {results.length}. Narrow the search to see more.</P> : null
        }
      />
    </View>
  );
}
