// The local platform's proxy (docs/architecture.md, "Stable addresses"): one stable address per project,
// http://<name>.localhost:7700, forwarded to whatever port its dev server took. Listens on 127.0.0.1 only.
// Routing is pure (hostOf, hostTable, route); createProxy does the forwarding, WebSocket upgrades included.
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';

export const PROXY_PORT = 7700;
/** A name chosen in .oberth.json: lower-case labels of a-z, 0-9 and -, separated by dots. */
export const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
/** Names the proxy keeps for itself. */
const RESERVED = new Set(['oberth', 'www']);

const label = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '') || 'x';

/** The name a folder path gets: each part a DNS label, the nested part first (games/arcade → arcade.games). */
export const hostOf = (relPath: string): string => relPath.split('/').map(label).reverse().join('.');

export interface HostProject { id: string; relPath: string; host?: string }

/**
 * name → project id for every project. A name chosen in .oberth.json wins; two projects that would share a name both
 * fall back to their whole id as one label, so neither takes the other's address.
 */
export function hostTable(projects: HostProject[]): Map<string, string> {
  const wanted = projects.map((p) => ({ id: p.id, name: p.host && HOST_NAME.test(p.host) && !RESERVED.has(p.host) ? p.host : hostOf(p.relPath) }));
  const count = new Map<string, number>();
  for (const w of wanted) count.set(w.name, (count.get(w.name) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const w of wanted) {
    let name = (count.get(w.name)! > 1 || RESERVED.has(w.name)) ? label(w.id) : w.name;
    while (out.has(name) || RESERVED.has(name)) name = `${name}-${w.id.length}`; // a fallback that collides again, in theory
    out.set(name, w.id);
  }
  return out;
}

/** The stable address of a project, given the table. */
export const addressOf = (table: Map<string, string>, id: string, port = PROXY_PORT): string | undefined => {
  for (const [name, pid] of table) if (pid === id) return `http://${name}.localhost:${port}/`;
  return undefined;
};

export type Route = { kind: 'project'; id: string; name: string } | { kind: 'oberth' } | { kind: 'unknown' };

/**
 * What a request's Host is for. Only exactly <name>.localhost:<port> counts, so a page that points its own domain at
 * this Mac (DNS rebinding) gets nothing: its requests carry its own domain.
 */
export function route(hostHeader: string | undefined, table: Map<string, string>, port = PROXY_PORT): Route {
  const m = /^([a-z0-9.-]+)\.localhost:(\d+)$/.exec((hostHeader ?? '').toLowerCase());
  if (!m || Number(m[2]) !== port) return { kind: 'unknown' };
  if (m[1] === 'oberth') return { kind: 'oberth' };
  const id = table.get(m[1]);
  return id ? { kind: 'project', id, name: m[1] } : { kind: 'unknown' };
}

// ---------- the server ----------

/** Where a project's dev server answers now: from Oberth's own runs and the leftover servers it found. */
export interface Target { host: string; port: number }

export interface ProxyOptions {
  port?: number;
  table: () => Map<string, string>;
  /** the running dev server of a project, or undefined when it isn't running */
  target: (id: string) => Target | undefined | Promise<Target | undefined>;
  /** a project's display name, for the "not running" page */
  nameOf: (id: string) => string | undefined;
  dashboard: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function page(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:48px 24px;color:#1f1f22;background:#f6f6f6}@media(prefers-color-scheme:dark){body{color:#ececee;background:#141415}a{color:#4b93ff}}main{max-width:520px;margin:auto}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 10px;color:#6b6b70}a{color:#0051c3}</style>
<main><h1>${esc(title)}</h1>${body}</main>`);
}

/** Headers for the dev server: the original Host stays (redirects and cookies keep the stable name), plus where it came from. */
function forwardHeaders(req: IncomingMessage): Record<string, string | string[]> {
  const h: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) h[k] = v;
  h['x-forwarded-host'] = req.headers.host ?? '';
  h['x-forwarded-proto'] = 'http';
  return h;
}

export function createProxy(o: ProxyOptions): Server {
  const port = o.port ?? PROXY_PORT;
  const resolve = async (req: IncomingMessage) => {
    const r = route(req.headers.host, o.table(), port);
    return { r, t: r.kind === 'project' ? await o.target(r.id) : undefined };
  };

  const server = createServer(async (req, res) => {
    let found;
    try { found = await resolve(req); } catch { found = { r: { kind: 'unknown' } as Route, t: undefined }; }
    const { r, t } = found;
    if (r.kind === 'oberth') { res.writeHead(302, { Location: o.dashboard }); res.end(); return; }
    if (r.kind === 'unknown') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found\n'); return; }
    if (!t) {
      const name = o.nameOf(r.id) ?? r.name;
      // a link, never a launch: any page could load this address, so a visit must not start anything
      return page(res, 503, `${name} isn't running`, `<p>Start it from Oberth, then reload this page.</p><p><a href="${esc(`${o.dashboard}?p=${encodeURIComponent(r.id)}`)}">Open ${esc(name)} in Oberth</a></p>`);
    }
    const up = request({ host: t.host, port: t.port, method: req.method, path: req.url, headers: forwardHeaders(req) }, (ur) => {
      // the raw list keeps repeated headers such as Set-Cookie, and their spelling
      res.writeHead(ur.statusCode ?? 502, ur.rawHeaders);
      ur.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) page(res, 502, `${o.nameOf(r.id) ?? r.name} didn't answer`, '<p>Its dev server may be starting or stopping. Reload in a moment.</p>');
      else res.destroy();
    });
    req.pipe(up);
  });

  // WebSockets (Vite's hot reload, Hugo's live reload): the upgrade request is passed on as it came, then bytes both ways
  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    let found;
    try { found = await resolve(req); } catch { found = { t: undefined }; }
    const t = found.t;
    if (!t) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const up = connect(t.port, t.host);
    up.on('error', () => socket.destroy());
    socket.on('close', () => up.destroy());
    up.on('close', () => socket.destroy());
    up.on('connect', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      lines.push(`X-Forwarded-Host: ${req.headers.host ?? ''}`, 'X-Forwarded-Proto: http');
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
  });
  return server;
}
