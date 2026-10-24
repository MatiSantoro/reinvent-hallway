// Network helpers for sign-in on Android.
//
// Android cuts the network for apps in the background when battery saver, data saver or app standby is on.
// During sign-in Hallway IS in the background (the Chrome tab is in front) at the moment the redirect
// arrives, so a token request sent right then fails with "Unable to resolve host". Two defenses:
//   1. whenForeground: hold the request until the app is back on screen.
//   2. fetchRetry: a few short retries, because the network can take a moment to wake up.

export interface AppStateLike {
  currentState: string;
  addEventListener(type: 'change', listener: (state: string) => void): { remove: () => void };
}

/** Resolves once the app is in the foreground (or after `timeoutMs`, so sign-in can never hang). */
export function whenForeground(appState: AppStateLike, timeoutMs = 60_000): Promise<void> {
  if (appState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = appState.addEventListener('change', (state) => {
      if (state === 'active') done();
    });
    function done() {
      sub.remove();
      if (timer) clearTimeout(timer);
      resolve();
    }
    timer = setTimeout(done, timeoutMs);
  });
}

/**
 * Like fetch, but retries when the request could not be sent at all (DNS failure, no network).
 * An HTTP error status is a real answer from the server and is returned as is, never retried.
 */
export async function fetchRetry(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  opts: { tries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<Response> {
  const { tries = 4, delayMs = 800, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await doFetch(url, init);
    } catch (e) {
      last = e;
      if (attempt < tries) await sleep(delayMs * attempt);
    }
  }
  throw last;
}

/** True for the errors Android and iOS raise when a request never reached the server. */
export const isNetworkError = (e: unknown) =>
  /UnknownHost|Unable to resolve host|Network request failed|fetch failed|timed out|offline|Failed to connect/i.test(
    e instanceof Error ? e.message : String(e)
  );

/** What to tell a person whose phone could not reach a host. */
export function explainNetworkError(host: string): string {
  return (
    `Your phone could not reach ${host}. Check your connection, then try again. ` +
    `If it keeps failing: turn off battery saver for Hallway, try mobile data instead of Wi-Fi, ` +
    `or set Private DNS to dns.google in your phone's network settings.`
  );
}
