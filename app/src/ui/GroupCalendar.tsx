import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import type { GroupItem, Slot } from '../api/backend';
import { dayKey, fmtRange, localMinutes } from '../logic/time';
import { C } from './kit';

const HOUR_H = 58; // pixels per hour
const FIRST_H = 7;
const LAST_H = 23;
const LABEL_W = 44;

export interface Block {
  id: string;
  start: number;
  end: number;
  title: string;
  sub: string;
  kind: 'session' | 'meetup' | 'busy';
}
export type Placed = Block & { col: number; cols: number };

/** Puts overlapping blocks side by side instead of on top of each other. */
export function place(blocks: Block[]): Placed[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    cluster.forEach((b) => (b.cols = Math.max(1, colEnds.length)));
    out.push(...cluster);
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };
  for (const b of sorted) {
    if (b.start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= b.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(b.end);
    } else {
      colEnds[col] = b.end;
    }
    clusterEnd = Math.max(clusterEnd, b.end);
    cluster.push({ ...b, col, cols: 1 });
  }
  flush();
  return out;
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

const STYLE = {
  session: { bg: '#FF9F1C30', edge: C.accent },
  meetup: { bg: '#6CA8FF30', edge: C.blue },
  busy: { bg: '#8B95A51F', edge: C.dim },
};

/** One day of the group's shared calendar, as an hour-by-hour timeline. */
export function GroupCalendar({
  day,
  items,
  busy,
  tz,
  me,
}: {
  day: string;
  items: GroupItem[];
  /** The viewer's own commitments. Only shown to them, never sent to the group. */
  busy: Slot[];
  tz: string;
  me: string;
}) {
  const blocks = useMemo(() => {
    const mine = (ms: number) => dayKey(ms, tz) === day;
    const list: Block[] = items
      .filter((i) => mine(i.start))
      .map((i) => ({
        id: i.itemId,
        start: i.start,
        end: i.end,
        title: i.title,
        sub: `${fmtRange(i, tz)} · ${i.going.length} going${i.going.includes(me) ? ' (you)' : ''}`,
        kind: i.kind,
      }));
    busy.filter((b) => mine(b.start)).forEach((b, n) => list.push({ id: `busy${n}`, start: b.start, end: b.end, title: 'You are busy', sub: fmtRange(b, tz), kind: 'busy' }));
    return place(list);
  }, [day, items, busy, tz, me]);

  const total = (LAST_H - FIRST_H) * HOUR_H;
  const minutesOf = (ms: number, isEnd: boolean) => {
    const m = localMinutes(ms, tz);
    return isEnd && m === 0 ? 24 * 60 : m;
  };
  const yOf = (min: number) => ((Math.min(Math.max(min, FIRST_H * 60), LAST_H * 60) - FIRST_H * 60) / 60) * HOUR_H;

  return (
    <View style={{ height: total + 8, marginTop: 4 }}>
      {Array.from({ length: LAST_H - FIRST_H + 1 }, (_, i) => FIRST_H + i).map((h) => (
        <View key={h} style={{ position: 'absolute', top: (h - FIRST_H) * HOUR_H, left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-start' }}>
          <Text style={{ width: LABEL_W, color: C.dim, fontSize: 10, marginTop: -6 }}>{hourLabel(h)}</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
        </View>
      ))}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: LABEL_W + 4, right: 0 }}>
        {blocks.map((b) => {
          const top = yOf(minutesOf(b.start, false));
          const height = Math.max(26, yOf(minutesOf(b.end, true)) - top - 2);
          const st = STYLE[b.kind];
          return (
            <View
              key={b.id}
              style={{
                position: 'absolute',
                top,
                height,
                left: `${(b.col / b.cols) * 100}%`,
                width: `${100 / b.cols}%`,
                paddingRight: 3,
              }}
            >
              <View
                style={{
                  flex: 1,
                  backgroundColor: st.bg,
                  borderLeftWidth: 3,
                  borderLeftColor: st.edge,
                  borderRadius: 6,
                  paddingHorizontal: 6,
                  paddingVertical: 3,
                  overflow: 'hidden',
                  opacity: b.kind === 'busy' ? 0.85 : 1,
                }}
              >
                <Text style={{ color: b.kind === 'busy' ? C.dim : C.text, fontSize: 11, fontWeight: '700' }} numberOfLines={height > 52 ? 3 : 1}>
                  {b.title}
                </Text>
                {height > 40 ? (
                  <Text style={{ color: C.dim, fontSize: 10, marginTop: 1 }} numberOfLines={1}>
                    {b.sub}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
