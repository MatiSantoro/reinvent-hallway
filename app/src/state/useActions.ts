// Single-session actions shared by screens. Each one ends with the schedule from GetSchedule.
import { Alert } from 'react-native';
import { cancelReservation, disassociateFavorite, getSession, OperationClosed, UnknownWriteOutcome } from '../api/events';
import type { Session } from '../api/types';
import { failureText, favoriteAll, reserveAll, WriteReport } from '../logic/reconcile';
import { useApp } from './AppState';

export function describeReport(r: WriteReport, byId: Map<string, Session>, verb: string): string {
  const name = (id: string) => byId.get(id)?.abbreviation || byId.get(id)?.title || id;
  const lines: string[] = [];
  if (r.closed) lines.push(`${verb} is closed right now on the API. Nothing changed.`);
  if (r.done.length) lines.push(`✓ ${r.done.length} confirmed on your schedule`);
  for (const f of r.failed) {
    const clash = f.conflictsWith?.length ? ` (with ${f.conflictsWith.map(name).join(', ')})` : '';
    lines.push(`✗ ${name(f.sessionId)}: ${failureText(f.code)}${clash}`);
  }
  for (const s of r.skipped) lines.push(`– ${name(s.sessionId)}: ${s.why}`);
  return lines.join('\n') || 'Nothing to do.';
}

export function useActions() {
  const app = useApp();
  const { eventId, byId } = app;

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof UnknownWriteOutcome) {
        await app.refreshSchedule().catch(() => {});
        Alert.alert('Not sure it worked', 'The server did not answer. Your schedule was reloaded, check it before trying again.');
      } else if (e instanceof OperationClosed) {
        Alert.alert('Closed for now', e.message);
      } else {
        Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
      }
    }
  };

  return {
    favorite: (id: string) =>
      run(async () => {
        const r = await favoriteAll(eventId, [id]);
        app.setSchedule(r.schedule);
        if (r.failed.length || r.closed) Alert.alert('Favorite', describeReport(r, byId, 'Favoriting'));
      }),
    unfavorite: (id: string) =>
      run(async () => {
        await disassociateFavorite(eventId, id);
        await app.refreshSchedule();
      }),
    reserve: (id: string) =>
      run(async () => {
        // Check the live seat band first (GetSession), the cached one may be hours old.
        const fresh = await getSession(eventId, id);
        if (fresh.seatAvailability === 'unavailable') {
          Alert.alert('Full', 'This session has no seats right now. Favorite it to keep an eye on it.');
          return;
        }
        const r = await reserveAll(eventId, [fresh]);
        app.setSchedule(r.schedule);
        if (!r.done.includes(id)) Alert.alert('Reservation', describeReport(r, byId, 'Reserving'));
      }),
    cancel: (id: string) =>
      run(async () => {
        await cancelReservation(eventId, id); // 404 = already cancelled, fine
        await app.refreshSchedule();
      }),
  };
}
