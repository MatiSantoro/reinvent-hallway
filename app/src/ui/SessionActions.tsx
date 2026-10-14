import React, { useState } from 'react';
import { Text } from 'react-native';
import type { Session } from '../api/types';
import { useActions } from '../state/useActions';
import { Btn, C, Row } from './kit';

/** Reserve / cancel and favorite buttons for one session. Used in Plan, Explore and My week. */
export function SessionActions({
  s,
  reserved,
  favorite,
  hideFavorite,
}: {
  s: Session;
  reserved: boolean;
  favorite: boolean;
  hideFavorite?: boolean;
}) {
  const act = useActions();
  const [busy, setBusy] = useState<'fav' | 'res' | null>(null);
  const run = (k: 'fav' | 'res', fn: () => Promise<void>) => async () => {
    setBusy(k);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const id = s.sessionId;
  const canReserve = s.seatAvailability !== 'walkUp' && s.isReservable !== false;

  return (
    <Row>
      {hideFavorite ? null : (
        <Btn
          small
          kind="ghost"
          label={favorite ? '★ Unfavorite' : '☆ Favorite'}
          busy={busy === 'fav'}
          disabled={busy !== null}
          onPress={run('fav', () => (favorite ? act.unfavorite(id) : act.favorite(id)))}
        />
      )}
      {canReserve ? (
        <Btn
          small
          kind={reserved ? 'danger' : 'primary'}
          label={reserved ? 'Cancel seat' : 'Reserve'}
          busy={busy === 'res'}
          disabled={busy !== null}
          onPress={run('res', () => (reserved ? act.cancel(id) : act.reserve(id)))}
        />
      ) : (
        <Text style={{ color: C.dim, fontSize: 12 }}>Walk-up: no reservation needed</Text>
      )}
    </Row>
  );
}
