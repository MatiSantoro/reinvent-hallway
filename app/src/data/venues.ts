// Travel time between re:Invent venues, in minutes, door to door.
// The API gives each session a `venue` name but no coordinates, so this table is ours.
// These are estimates (walking + shuttle + crowds). Edit them if you know better.

export type VenueKey = 'venetian' | 'wynn' | 'caesars' | 'mgm' | 'mandalay';

const NAMES: Record<VenueKey, string> = {
  venetian: 'Venetian',
  wynn: 'Wynn',
  caesars: 'Caesars Forum',
  mgm: 'MGM Grand',
  mandalay: 'Mandalay Bay',
};

// Matched against the lower-cased venue string from the API.
const ALIASES: [RegExp, VenueKey][] = [
  [/venetian|palazzo/, 'venetian'],
  [/wynn|encore/, 'wynn'],
  [/caesars|forum/, 'caesars'],
  [/mgm/, 'mgm'],
  [/mandalay/, 'mandalay'],
];

// Symmetric table, north to south on the Strip.
const MINUTES: Record<VenueKey, Partial<Record<VenueKey, number>>> = {
  wynn: { venetian: 15, caesars: 25, mgm: 40, mandalay: 45 },
  venetian: { caesars: 15, mgm: 35, mandalay: 40 },
  caesars: { mgm: 30, mandalay: 35 },
  mgm: { mandalay: 20 },
  mandalay: {},
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
