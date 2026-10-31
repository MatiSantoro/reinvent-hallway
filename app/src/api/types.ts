// Shapes from https://api.awsevents.com/v1/openapi.json
// Every session field except sessionId and title is optional.

export type SeatAvailability = 'available' | 'limited' | 'veryLimited' | 'unavailable' | 'walkUp';

export interface EventInfo {
  eventId: string;
  name: string;
  eventType: string;
  startDate: string;
  endDate: string;
  isOnline: boolean;
  timezone?: string;
  timezoneAbbreviation?: string;
  timeFormat?: string;
  address?: { city?: string };
  supportedLanguageCodes?: string[];
  authenticationRequired: boolean;
}

export interface SessionTime {
  date?: string; // "2026-12-01"
  time?: string; // "16:00" local
  length?: string; // minutes, "60"
  timezone?: string;
}

export interface Session {
  sessionId: string;
  title: string;
  abbreviation?: string;
  abstract?: string;
  type?: string;
  level?: string;
  venue?: string;
  room?: string;
  isAllDaySession?: boolean;
  isReservable?: boolean;
  seatAvailability?: SeatAvailability;
  sessionTime?: SessionTime;
  speakers?: { name?: string }[];
  tracks?: string[];
  topics?: string[];
  industries?: string[];
  areasOfInterest?: string[];
  roles?: string[];
  services?: string[];
  segments?: string[];
  features?: string[];
  customerPersonas?: string[];
  experiences?: string[];
  additionalActivities?: string[];
  focusAreas?: string[];
}

export interface PersonalTime {
  personalTimeId: string;
  startDateTime: string; // event's local clock, YYYY-MM-DDTHH:MM:SS
  endDateTime: string;
  title: string;
  description: string;
  location?: string;
}

export interface PersonalTimeInput {
  startDateTime: string;
  endDateTime: string;
  title: string;
  description: string;
  location?: string;
}

export interface Schedule {
  reserved: string[];
  favorites: string[];
  personalTime: PersonalTime[];
}

export type BulkFailureCode =
  | 'sessionNotReservable'
  | 'scheduleConflict'
  | 'alreadyScheduled'
  | 'sessionFull'
  | 'insufficientAccess'
  | 'timePassed'
  | 'alreadyFavorited'
  | 'notFavorited'
  | 'other'
  | (string & {}); // new codes can appear, treat unknown as generic

export interface BulkFailure {
  sessionId: string;
  code: BulkFailureCode;
  conflictsWith?: string[];
}

export interface BulkResult {
  successful: string[];
  failed: BulkFailure[];
}
