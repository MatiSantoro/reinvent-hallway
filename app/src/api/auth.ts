// Builder ID sign-in: OAuth 2.0 authorization code flow with PKCE.
// Tokens never leave the phone. The access token lives in memory only,
// the refresh token in the iOS Keychain / Android Keystore (expo-secure-store).
import * as Crypto from 'expo-crypto';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { AUTH } from '../config';
import { waitForRedirectAndroid } from './browserWait';
import { explainNetworkError, fetchRetry, isNetworkError, whenForeground } from './netRetry';
import { LoopbackHit, LoopbackServer, startLoopback } from './loopback';

const REFRESH_KEY = 'hallway.refresh_token';
const EMAIL_KEY = 'hallway.email';

const toBase64Url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomString(bytes: number): string {
  const arr = Crypto.getRandomBytes(bytes);
  let bin = '';
  arr.forEach((b) => (bin += String.fromCharCode(b)));
  return toBase64Url(btoa(bin));
}

async function s256(verifier: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return toBase64Url(b64);
}

const form = (obj: Record<string, string>) =>
  Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(payload + '==='.slice((payload.length + 3) % 4)));
    return typeof json.email === 'string' ? json.email : undefined;
  } catch {
    return undefined;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
}

/**
 * Opens the browser and resolves with the redirect our local listener receives, or null if the user
 * closed the browser first. The two platforms report "closed" very differently, see browserWait.ts.
 */
async function browseUntil(url: string, server: LoopbackServer): Promise<LoopbackHit | null> {
  if (Platform.OS === 'android') {
    return waitForRedirectAndroid({
      open: () => WebBrowser.openBrowserAsync(url),
      waitFor: server.waitFor,
      appState: AppState,
    });
  }
  // iOS: openBrowserAsync finishes when the sign-in sheet is dismissed, so finishing first means "closed".
  const closed = WebBrowser.openBrowserAsync(url).then(() => null);
  const hit = await Promise.race([server.waitFor, closed]);
  // dismissBrowser exists on iOS only; on Android it returns nothing, so don't chain on it directly.
  Promise.resolve(WebBrowser.dismissBrowser()).catch(() => {});
  return hit;
}

class AuthManager {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string> | null = null;
  email: string | null = null;

  private async store(t: TokenResponse) {
    this.accessToken = t.access_token;
    // Refresh one minute early, based on expires_in (not a hardcoded hour).
    this.expiresAt = Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000;
    // If the server rotates the refresh token, the old one may stop working.
    if (t.refresh_token) await SecureStore.setItemAsync(REFRESH_KEY, t.refresh_token);
    const email = emailFromIdToken(t.id_token);
    if (email) {
      this.email = email;
      await SecureStore.setItemAsync(EMAIL_KEY, email);
    }
  }

  /** True if we have a refresh token from an earlier sign-in. */
  async restore(): Promise<boolean> {
    this.email = await SecureStore.getItemAsync(EMAIL_KEY);
    const rt = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!rt) return false;
    try {
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  async signIn(): Promise<void> {
    const verifier = randomString(48); // 64 chars, fresh each attempt
    const state = randomString(16);
    const challenge = await s256(verifier);
    const server = await startLoopback('/callback');
    const redirectUri = `http://${AUTH.host}:${server.port}/callback`;

    try {
      const url =
        `${AUTH.authorizeUrl}?response_type=code` +
        `&client_id=${AUTH.clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(AUTH.scope)}` +
        `&identity_provider=AWSBuilderID` +
        `&code_challenge=${challenge}` +
        `&code_challenge_method=S256` +
        `&state=${state}`;

      const hit = await browseUntil(url, server);
      if (!hit) throw new Error('Sign-in was closed before it finished');

      const { code, error, state: gotState } = hit.params;
      if (error) throw new Error(`Sign-in error: ${error}`);
      if (gotState !== state) throw new Error('Sign-in state mismatch');
      if (!code) throw new Error('No code in the sign-in callback');

      // Android cuts the network for background apps (battery saver), and right now the sign-in tab is
      // still in front. Wait until Hallway is back on screen before talking to the token server.
      await whenForeground(AppState);
      let res: Response;
      try {
        res = await fetchRetry(fetch, AUTH.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({
            grant_type: 'authorization_code',
            client_id: AUTH.clientId,
            redirect_uri: redirectUri, // identical string to the authorize request
            code,
            code_verifier: verifier,
          }),
        });
      } catch (e) {
        throw isNetworkError(e) ? new Error(explainNetworkError('oauth.awsevents.com')) : e;
      }
      const tokens = (await res.json()) as TokenResponse;
      if (!res.ok || !tokens.access_token) {
        throw new Error(`Token exchange failed (${res.status}): ${tokens.error || 'unknown'}`);
      }
      await this.store(tokens);
    } finally {
      server.close();
    }
  }

  /** Exchanges the refresh token for a new access token. Concurrent callers share one request. */
  refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const rt = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!rt) throw new SignInRequired();
        const res = await fetchRetry(fetch, AUTH.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({ grant_type: 'refresh_token', client_id: AUTH.clientId, refresh_token: rt }),
        });
        if (!res.ok) throw new SignInRequired();
        const tokens = (await res.json()) as TokenResponse;
        await this.store(tokens);
        return tokens.access_token;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    return this.refresh();
  }

  /** Signs out of Hallway: revokes the refresh token and drops every local copy. */
  async signOut(): Promise<void> {
    const rt = await SecureStore.getItemAsync(REFRESH_KEY);
    if (rt) {
      await fetch(AUTH.revokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: AUTH.clientId, token: rt }),
      }).catch(() => {});
    }
    this.accessToken = null;
    this.expiresAt = 0;
    this.email = null;
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    await SecureStore.deleteItemAsync(EMAIL_KEY);
  }

  /**
   * Optional second step: also end the Builder ID browser session.
   * Builder ID logout first, which bounces to the broker logout, which comes back to our loopback.
   */
  async signOutOfBuilderId(): Promise<void> {
    const server = await startLoopback('/logout');
    try {
      const inner =
        `${AUTH.logoutUrl}?client_id=${AUTH.clientId}` +
        `&logout_uri=${encodeURIComponent(`http://${AUTH.host}:${server.port}/logout`)}`;
      const url = `${AUTH.builderIdLogoutUrl}?redirect_uri=${encodeURIComponent(inner)}`;
      await browseUntil(url, server);
    } finally {
      server.close();
    }
  }
}

export class SignInRequired extends Error {
  constructor() {
    super('Please sign in again');
  }
}

export const auth = new AuthManager();
