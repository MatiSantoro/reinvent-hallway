// Waiting for the sign-in redirect on Android.
//
// On iOS, WebBrowser.openBrowserAsync finishes when the user closes the sign-in sheet, so "it finished"
// means "they gave up". On Android it finishes the moment the Chrome tab OPENS, long before the user has
// signed in. Treating that as "closed" shuts the local listener down, and Chrome's redirect to
// 127.0.0.1 then fails with ERR_CONNECTION_REFUSED.
//
// So on Android we ignore when openBrowserAsync finishes and wait for the redirect itself. The only
// signal that the user gave up is the app coming back to the foreground without a redirect.

export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: string) => void): { remove: () => void };
}

export function waitForRedirectAndroid<T>(opts: {
  /** Opens the browser. Its result is ignored; only a failure to open matters. */
  open: () => Promise<unknown>;
  /** Resolves when the loopback listener receives the redirect. */
  waitFor: Promise<T>;
  appState: AppStateLike;
  /** After the app returns to the foreground, how long to wait for a redirect that is still on its way. */
  graceMs?: number;
  /** Give up after this long. */
  timeoutMs?: number;
}): Promise<T | null> {
  const { open, waitFor, appState, graceMs = 2500, timeoutMs = 5 * 60 * 1000 } = opts;
  return new Promise<T | null>((resolve, reject) => {
    let wentAway = false;
    let finished = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const sub = appState.addEventListener('change', (state) => {
      if (state !== 'active') {
        wentAway = true;
        if (grace) clearTimeout(grace); // gone again (e.g. the redirect page opened the browser once more)
        grace = undefined;
      } else if (wentAway && !grace) {
        grace = setTimeout(() => finish(null), graceMs);
      }
    });
    const timer = setTimeout(() => finish(null), timeoutMs);

    function finish(value: T | null) {
      if (finished) return;
      finished = true;
      sub.remove();
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      resolve(value);
    }

    waitFor.then((hit) => finish(hit), () => finish(null));
    open().catch((e) => {
      if (finished) return;
      finished = true;
      sub.remove();
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      reject(e);
    });
  });
}
