// Travel time between re:Invent venues, in minutes, door to door.
// The API gives each session a `venue` name but no coordinates, so this table is ours.
// These are estimates (walking + shuttle + crowds). Edit them if you know better.

export type VenueKey = 'wynn' | 'encore' | 'venetian' | 'palace' | 'forum' | 'mgm';

const NAMES: Record<VenueKey, string> = {
  wynn: 'Wynn',
  encore: 'Encore',
  venetian: 'Venetian',
  palace: 'Caesars Palace',
  forum: 'Caesars Forum',
  mgm: 'MGM Grand',
};

// Matched against the lower-cased venue string from the API, in this order (forum before the plain "caesars").
const ALIASES: [RegExp, VenueKey][] = [
  [/forum/, 'forum'],
  [/caesars/, 'palace'],
  [/encore/, 'encore'],
  [/wynn/, 'wynn'],
  [/venetian|palazzo/, 'venetian'],
  [/mgm/, 'mgm'],
];

// Symmetric table, roughly north to south on the Strip. Each pair is listed once.
const MINUTES: Record<VenueKey, Partial<Record<VenueKey, number>>> = {
  wynn: { encore: 10, venetian: 15, palace: 25, forum: 30, mgm: 40 },
  encore: { venetian: 15, palace: 30, forum: 35, mgm: 45 },
  venetian: { palace: 15, forum: 20, mgm: 35 },
  palace: { forum: 15, mgm: 30 },
  forum: { mgm: 30 },
  mgm: {},
};

export const SAME_VENUE_MINUTES = 10; // big venues: changing rooms still takes time
export const UNKNOWN_VENUE_MINUTES = 30;

export function venueKey(venue?: string): VenueKey | null {
  if (!venue) return null;
  const v = venue.toLowerCase();
  for (const [re, key] of ALIASES) if (re.test(v)) return key;
  return null;
}

export function venueLabel(venue?: string): string {
  const k = venueKey(venue);
  return k ? NAMES[k] : venue || 'Unknown venue';
}

/** Minutes needed to get from one venue to another. `known` is false when we had to guess. */
export function travelMinutes(from?: string, to?: string): { minutes: number; known: boolean } {
  const a = venueKey(from);
  const b = venueKey(to);
  if (!a || !b) {
    // Same raw string but not in our table: still the same building.
    if (from && to && from === to) return { minutes: SAME_VENUE_MINUTES, known: true };
    return { minutes: UNKNOWN_VENUE_MINUTES, known: false };
  }
  if (a === b) return { minutes: SAME_VENUE_MINUTES, known: true };
  const m = MINUTES[a][b] ?? MINUTES[b][a];
  return m === undefined ? { minutes: UNKNOWN_VENUE_MINUTES, known: false } : { minutes: m, known: true };
}
