// A tiny HTTP listener on the phone's own loopback address.
// The AWS Events API only accepts redirects to 127.0.0.1/localhost on ports
// 8484-8489, so the app itself has to receive the browser redirect.
import TcpSocket from 'react-native-tcp-socket';
import { AUTH } from '../config';

export interface LoopbackHit {
  path: string; // "/callback" or "/logout"
  params: Record<string, string>;
}

export interface LoopbackServer {
  port: number;
  /** Resolves with the first request whose path matches `expectPath`. */
  waitFor: Promise<LoopbackHit>;
  close: () => void;
}

export function parseQuery(qs: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (qs || '').split('&').forEach((pair) => {
    if (!pair) return;
    const i = pair.indexOf('=');
    const k = i === -1 ? pair : pair.slice(0, i);
    const v = i === -1 ? '' : pair.slice(i + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  });
  return out;
}

const PAGE = (msg: string) =>
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
  '<body style="font-family:-apple-system,system-ui;padding:32px;color:#111">' +
  `<h2>${msg}</h2><p>You can go back to Hallway.</p></body></html>`;

function listenOn(port: number, expectPath: string): Promise<LoopbackServer> {
  return new Promise((resolveListening, rejectListening) => {
    let resolveHit!: (h: LoopbackHit) => void;
    const waitFor = new Promise<LoopbackHit>((res) => (resolveHit = res));
    let settled = false;

    const server = TcpSocket.createServer((socket) => {
      socket.on('data', (data) => {
        const firstLine = data.toString().split('\r\n')[0] || ''; // GET /callback?... HTTP/1.1
        const target = firstLine.split(' ')[1] || '';
        const [path, qs] = target.split('?');

        if (path !== expectPath) {
          // Browsers also ask for /favicon.ico, ignore anything else.
          socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        const body = PAGE(expectPath === '/logout' ? 'Signed out' : 'Signed in');
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n` +
            `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`
        );
        socket.destroy();
        resolveHit({ path, params: parseQuery(qs) });
      });
      socket.on('error', () => {});
    });

    server.on('error', (e: unknown) => {
      if (!settled) {
        settled = true;
        rejectListening(e);
      }
    });
    server.listen({ port, host: AUTH.host }, () => {
      settled = true;
      resolveListening({ port, waitFor, close: () => server.close() });
    });
  });
}

/** Starts the listener on the first free reserved port. */
export async function startLoopback(expectPath: '/callback' | '/logout'): Promise<LoopbackServer> {
  let lastErr: unknown;
  for (const port of AUTH.ports) {
    try {
      return await listenOn(port, expectPath);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`No free loopback port in 8484-8489 (${String(lastErr)})`);
}
