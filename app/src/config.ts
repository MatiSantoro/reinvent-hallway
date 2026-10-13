// Values from the AWS Events API Developer Guide.
// The client ID is public and shared by every caller (PKCE, no secret).
export const AUTH = {
  clientId: '7vmom55m1qstvq8i71ph127bfq',
  authorizeUrl: 'https://oauth.awsevents.com/oauth2/authorize',
  tokenUrl: 'https://oauth.awsevents.com/oauth2/token',
  revokeUrl: 'https://oauth.awsevents.com/oauth2/revoke',
  logoutUrl: 'https://oauth.awsevents.com/logout',
  builderIdLogoutUrl: 'https://idp.awsevents.com/oidc/logout',
  scope: 'openid email events/access',
  // Reserved loopback ports for apps. We try them in order if one is busy.
  ports: [8484, 8485, 8486, 8487, 8488, 8489],
  // 127.0.0.1 instead of localhost so the browser never tries ::1
  host: '127.0.0.1',
};

export const EVENTS_API = 'https://api.awsevents.com/v1';

// Fallback if ListEvents does not return a re:Invent 2026 entry.
export const DEFAULT_EVENT_ID = 'reinvent2026';

// Our own backend (groups + planner). Set it after `cdk deploy`.
// You can also set EXPO_PUBLIC_BACKEND_URL in app/.env
export const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');

// Shared app key, sent as x-api-key. It ships inside the app, so it only keeps casual callers out (see DECISIONS.md).
export const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';

// Deep link scheme for group invites: hallway://join/<code>
export const APP_SCHEME = 'hallway';

// Tag we put in personal-time descriptions, so we can recognize blocks we created.
export const PT_TAG = '[hallway]';
