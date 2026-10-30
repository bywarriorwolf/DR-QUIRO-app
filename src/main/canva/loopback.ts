/**
 * One-shot loopback HTTP server for the OAuth redirect
 * (http://127.0.0.1:<port>/callback). Binds to 127.0.0.1 only, accepts a
 * single GET with a matching `state`, then closes.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CANVA } from '../../shared/config';

export class LoginCancelledError extends Error {
  constructor(message = 'login cancelled') {
    super(message);
    this.name = 'LoginCancelledError';
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#708572}div{text-align:center}h1{font-size:22px}</style></head>
<body><div><h1>${title}</h1><p>${body}</p></div></body></html>`;

export interface Loopback {
  port: number;
  redirectUrl: string;
  /** Resolves with the authorization code. */
  waitForCode(expectedState: () => string | undefined, timeoutMs?: number): Promise<string>;
  close(): void;
}

export async function startLoopback(port = 0): Promise<Loopback> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const actual = (server.address() as AddressInfo).port;
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      server.close();
      server.closeAllConnections?.();
    }
  };

  return {
    port: actual,
    redirectUrl: `http://127.0.0.1:${actual}${CANVA.callbackPath}`,
    close,
    waitForCode(expectedState, timeoutMs = CANVA.loginTimeoutMs) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          close();
          reject(new LoginCancelledError('login timed out'));
        }, timeoutMs);
        server.on('request', (req, res) => {
          const url = new URL(req.url ?? '/', `http://127.0.0.1:${actual}`);
          if (req.method !== 'GET' || url.pathname !== CANVA.callbackPath) {
            res.writeHead(404).end();
            return;
          }
          const send = (status: number, title: string, body: string) => {
            res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(page(title, body));
          };
          const state = url.searchParams.get('state');
          const expected = expectedState();
          if (!expected || state !== expected) {
            send(400, 'Solicitud no válida', 'Vuelve a la aplicación e inténtalo de nuevo.');
            return; // keep waiting for the genuine redirect
          }
          clearTimeout(timer);
          const code = url.searchParams.get('code');
          if (url.searchParams.get('error') || !code) {
            send(200, 'Inicio de sesión cancelado', 'Puedes cerrar esta ventana.');
            close();
            reject(new LoginCancelledError(url.searchParams.get('error') ?? 'no code'));
            return;
          }
          send(200, 'Listo', 'Ya puedes cerrar esta ventana y volver a DR·QUIRO Reportes.');
          close();
          resolve(code);
        });
      });
    },
  };
}
