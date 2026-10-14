import React, { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Session } from '../api/types';
import { venueLabel } from '../data/venues';
import { levelNumber } from '../logic/filter';
import { dayKey, fmtDay, fmtRange, sessionInterval } from '../logic/time';
import { SessionActions } from './SessionActions';
import { Badge, C, Row } from './kit';

// What the band says about seats left. This is NOT whether you hold a seat: that is the status line.
const SEATS: Record<string, { text: string; color: string }> = {
  available: { text: 'Seats open', color: C.good },
  limited: { text: 'Limited seats', color: C.warn },
  veryLimited: { text: 'Few seats left', color: C.bad },
  unavailable: { text: 'Full', color: C.bad },
  walkUp: { text: 'Walk-up', color: C.blue },
};

function SessionCardBase({
  s,
  tz,
  reserved,
  favorite,
  reason,
  note,
  actions,
  hideFavorite,
}: {
  s: Session;
  tz: string;
  reserved?: boolean;
  favorite?: boolean;
  reason?: string;
  /** Result of the last reservation attempt, e.g. "Full" or "Clashes with your schedule". */
  note?: { text: string; ok: boolean };
  /** Show the Reserve / Favorite buttons. */
  actions?: boolean;
  hideFavorite?: boolean;
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
        borderWidth: reserved ? 2 : 1,
        borderColor: reserved ? C.good : C.line,
      }}
    >
      {reserved ? (
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          <View style={{ backgroundColor: C.good, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#06260F', fontSize: 12, fontWeight: '800' }}>✓ RESERVED · you have a seat</Text>
          </View>
        </View>
      ) : favorite ? (
        <Text style={{ color: C.warn, fontSize: 12, fontWeight: '800', marginBottom: 8 }}>★ FAVORITE · not reserved</Text>
      ) : null}
      <Row style={{ marginBottom: 6 }}>
        {s.abbreviation ? <Text style={{ color: C.dim, fontSize: 12, fontWeight: '700' }}>{s.abbreviation}</Text> : null}
        {lvl ? <Badge text={String(lvl)} /> : null}
        {s.type ? <Badge text={s.type} /> : null}
        {seats && !reserved ? <Badge text={seats.text} color={seats.color} /> : null}
      </Row>
      <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', lineHeight: 21 }}>{s.title}</Text>
      <Text style={{ color: C.dim, fontSize: 13, marginTop: 6 }}>
        {iv ? `${fmtDay(dayKey(iv.start, tz))} · ${fmtRange(iv, tz)}` : 'Time TBA'} · {venueLabel(s.venue)}
        {s.room ? ` · ${s.room}` : ''}
      </Text>
      {reason ? <Text style={{ color: C.accent, fontSize: 13, marginTop: 8 }}>✦ {reason}</Text> : null}
      {note ? (
        <Text style={{ color: note.ok ? C.good : C.bad, fontSize: 13, fontWeight: '700', marginTop: 8 }}>
          {note.ok ? '✓ ' : '✗ '}
          {note.text}
        </Text>
      ) : null}
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
      {actions ? (
        <View style={{ marginTop: 10 }}>
          <SessionActions s={s} reserved={!!reserved} favorite={!!favorite} hideFavorite={hideFavorite} />
        </View>
      ) : null}
    </Pressable>
  );
}

// Props are plain values, so a card only re-renders when something about it changed.
export const SessionCard = memo(SessionCardBase);
