import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Session } from '../api/types';
import { venueLabel } from '../data/venues';
import { levelNumber } from '../logic/filter';
import { dayKey, fmtDay, fmtRange, sessionInterval } from '../logic/time';
import { Badge, C, Row } from './kit';

const SEATS: Record<string, { text: string; color: string }> = {
  available: { text: 'Seats', color: C.good },
  limited: { text: 'Limited', color: C.warn },
  veryLimited: { text: 'Very limited', color: C.bad },
  unavailable: { text: 'Full', color: C.bad },
  walkUp: { text: 'Walk-up', color: C.blue },
};

export function SessionCard({
  s,
  tz,
  reserved,
  favorite,
  reason,
  right,
}: {
  s: Session;
  tz: string;
  reserved?: boolean;
  favorite?: boolean;
  reason?: string;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const iv = sessionInterval(s, tz);
  const seats = s.seatAvailability ? SEATS[s.seatAvailability] : null;
  const lvl = levelNumber(s.level);
  return (
    <Pressable
      onPress={() => setOpen(!open)}
      style={{
        backgroundColor: C.card,
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: reserved ? C.accent : C.line,
      }}
    >
      <Row style={{ marginBottom: 6 }}>
        {s.abbreviation ? <Text style={{ color: C.dim, fontSize: 12, fontWeight: '700' }}>{s.abbreviation}</Text> : null}
        {lvl ? <Badge text={String(lvl)} /> : null}
        {s.type ? <Badge text={s.type} /> : null}
        {seats ? <Badge text={seats.text} color={seats.color} /> : null}
        {reserved ? <Badge text="Reserved" color={C.accent} /> : null}
        {favorite && !reserved ? <Badge text="★ Favorite" color={C.warn} /> : null}
      </Row>
      <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', lineHeight: 21 }}>{s.title}</Text>
      <Text style={{ color: C.dim, fontSize: 13, marginTop: 6 }}>
        {iv ? `${fmtDay(dayKey(iv.start, tz))} · ${fmtRange(iv, tz)}` : 'Time TBA'} · {venueLabel(s.venue)}
        {s.room ? ` · ${s.room}` : ''}
      </Text>
      {reason ? <Text style={{ color: C.accent, fontSize: 13, marginTop: 8 }}>✦ {reason}</Text> : null}
      {open ? (
        <View style={{ marginTop: 10 }}>
          {s.speakers?.length ? (
            <Text style={{ color: C.dim, fontSize: 13, marginBottom: 6 }}>
              {s.speakers.map((p) => p.name).filter(Boolean).join(', ')}
            </Text>
          ) : null}
          {s.abstract ? <Text style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>{s.abstract}</Text> : null}
          {s.services?.length ? (
            <Text style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>{s.services.join(' · ')}</Text>
          ) : null}
        </View>
      ) : null}
      {right ? <View style={{ marginTop: 10 }}>{right}</View> : null}
    </Pressable>
  );
}
