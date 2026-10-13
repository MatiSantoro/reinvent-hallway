// Client for our own backend (API Gateway + Lambda + DynamoDB + Bedrock).
// It never sees the AWS Events token. It only gets what the user chooses to share:
// session ids, times, busy slots and a display name.
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { API_KEY, BACKEND_URL } from '../config';

export type GroupMode = 'squad' | 'team';

export interface Group {
  groupId: string;
  name: string;
  mode: GroupMode;
  inviteCode: string;
  eventId: string;
}

export interface Member {
  memberId: string;
  displayName: string;
  busyUpdatedAt?: number;
}

export interface GroupItem {
  itemId: string;
  kind: 'session' | 'meetup';
  sessionId?: string;
  title: string;
  start: number; // epoch ms
  end: number;
  location?: string;
  note?: string;
  createdBy: string;
  going: string[]; // member ids
  assignee?: string; // team mode
}

export interface GroupState {
  group: Group;
  members: Member[];
  items: GroupItem[];
  me: string;
}

export interface Slot {
  start: number;
  end: number;
}

export interface PlanPick {
  sessionId: string;
  reason: string;
}

// ---------- local membership store ----------

interface Membership {
  groupId: string;
  name: string;
  memberId: string;
}

const listFile = () => new File(Paths.document, 'groups.json');
const secretKey = (groupId: string) => `hallway.group.${groupId}`;

export async function myGroups(): Promise<Membership[]> {
  const f = listFile();
  if (!f.exists) return [];
  try {
    return JSON.parse(await f.text());
  } catch {
    return [];
  }
}

async function remember(m: Membership, secret: string) {
  const list = (await myGroups()).filter((g) => g.groupId !== m.groupId);
  list.push(m);
  listFile().write(JSON.stringify(list));
  await SecureStore.setItemAsync(secretKey(m.groupId), secret);
}

async function forget(groupId: string) {
  const list = (await myGroups()).filter((g) => g.groupId !== groupId);
  listFile().write(JSON.stringify(list));
  await SecureStore.deleteItemAsync(secretKey(groupId));
}

// ---------- http ----------

export class BackendNotConfigured extends Error {
  constructor() {
    super('Backend URL is not set. Deploy the backend and set EXPO_PUBLIC_BACKEND_URL.');
  }
}

async function req<T>(path: string, init: { method?: string; body?: unknown; groupId?: string } = {}): Promise<T> {
  if (!BACKEND_URL) throw new BackendNotConfigured();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY };
  if (init.groupId) {
    const m = (await myGroups()).find((g) => g.groupId === init.groupId);
    const secret = await SecureStore.getItemAsync(secretKey(init.groupId));
    if (!m || !secret) throw new Error('You are not a member of this group on this phone');
    headers['X-Member-Id'] = m.memberId;
    headers['X-Member-Secret'] = secret;
  }
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.message || `Backend error ${res.status}`);
  return data as T;
}

// ---------- planner ----------

export interface PlanCandidate {
  id: string;
  code?: string;
  title: string;
  type?: string;
  level?: string;
  day: string;
  time: string;
  venue?: string;
  seats?: string;
  tags: string[];
  abstract?: string;
}

export function plan(body: { goals: string; certs: string[]; candidates: PlanCandidate[]; maxPicks: number }) {
  return req<{ picks: PlanPick[]; summary: string }>('/plan', { method: 'POST', body });
}

// ---------- groups ----------

export async function createGroup(name: string, mode: GroupMode, displayName: string, eventId: string) {
  const r = await req<{ group: Group; memberId: string; secret: string }>('/groups', {
    method: 'POST',
    body: { name, mode, displayName, eventId },
  });
  await remember({ groupId: r.group.groupId, name: r.group.name, memberId: r.memberId }, r.secret);
  return r.group;
}

export async function joinGroup(inviteCode: string, displayName: string) {
  const r = await req<{ group: Group; memberId: string; secret: string }>('/groups/join', {
    method: 'POST',
    body: { inviteCode: inviteCode.trim().toUpperCase(), displayName },
  });
  await remember({ groupId: r.group.groupId, name: r.group.name, memberId: r.memberId }, r.secret);
  return r.group;
}

export async function leaveGroup(groupId: string) {
  try {
    await req(`/groups/${groupId}/members/me`, { method: 'DELETE', groupId });
  } finally {
    await forget(groupId);
  }
}

export const getGroup = (groupId: string) => req<GroupState>(`/groups/${groupId}`, { groupId });

export const addItem = (groupId: string, item: Omit<GroupItem, 'itemId' | 'createdBy' | 'going' | 'assignee'>) =>
  req<GroupItem>(`/groups/${groupId}/items`, { method: 'POST', body: item, groupId });

export const removeItem = (groupId: string, itemId: string) =>
  req(`/groups/${groupId}/items/${itemId}`, { method: 'DELETE', groupId });

export const rsvp = (groupId: string, itemId: string, going: boolean) =>
  req<GroupItem>(`/groups/${groupId}/items/${itemId}/rsvp`, { method: 'PUT', body: { going }, groupId });

/** Shares only busy time ranges, never what the sessions are. */
export const shareBusy = (groupId: string, slots: Slot[]) =>
  req(`/groups/${groupId}/busy`, { method: 'PUT', body: { slots }, groupId });

export const freeTime = (groupId: string, from: number, to: number, minMinutes: number) =>
  req<{ slots: Slot[]; reporting: number; members: number }>(
    `/groups/${groupId}/free?from=${from}&to=${to}&minMinutes=${minMinutes}`,
    { groupId }
  );

/** Team mode: assign each proposed session to one member, so the team covers more. */
export const splitSessions = (groupId: string) =>
  req<{ assignments: Record<string, string>; unassigned: string[] }>(`/groups/${groupId}/split`, {
    method: 'POST',
    body: {},
    groupId,
  });
