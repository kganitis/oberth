import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

const hosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];

/** Reads the token, creating it (owner-only file) on first run. */
export function ensureToken(stateDir: string): string {
  const file = join(stateDir, 'token');
  if (!existsSync(file)) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  return readFileSync(file, 'utf8').trim();
}

/** Rejects DNS-rebinding requests: the Host header must be Oberth's own. */
export const hostOk = (req: IncomingMessage, port = 7777): boolean => hosts(port).includes(req.headers.host ?? '');

/** Full guard for anything with side effects: own Host, own (or no) Origin, matching token. */
export function guard(req: IncomingMessage, token: string, port = 7777): boolean {
  if (!hostOk(req, port)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts(port).map((h) => `http://${h}`).includes(origin)) return false;
  const given = Buffer.from(String(req.headers['x-oberth-token'] ?? ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}
