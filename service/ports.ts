import { execFile } from 'node:child_process';
import { get } from 'node:http';
import { sep } from 'node:path';
import { promisify } from 'node:util';
import type { Listener, Project } from './types.ts';

const run = promisify(execFile);

/** `lsof -nP -iTCP -sTCP:LISTEN -F pcn` → unique pid+port pairs (with the process name), in output order. */
export function parseLsofListen(out: string): { pid: number; port: number; command?: string }[] {
  const seen = new Set<string>();
  const res: { pid: number; port: number; command?: string }[] = [];
  let pid = 0;
  let command: string | undefined;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) { pid = Number(line.slice(1)); command = undefined; }
    else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n')) {
      const port = Number(line.slice(line.lastIndexOf(':') + 1));
      const key = `${pid}:${port}`;
      if (pid && port && !seen.has(key)) { seen.add(key); res.push(command ? { pid, port, command } : { pid, port }); }
    }
  }
  return res;
}

/** `lsof -a -d cwd -Fn -p …` → pid → cwd. */
export function parseLsofCwd(out: string): Map<number, string> {
  const m = new Map<number, string>();
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) m.set(pid, line.slice(1));
  }
  return m;
}

/** `ps -o pid=,pgid= -p …` → pid → pgid. */
export function parsePs(out: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const line of out.trim().split('\n')) {
    const [pid, pgid] = line.trim().split(/\s+/).map(Number);
    if (pid) m.set(pid, pgid);
  }
  return m;
}

const tryRun = async (cmd: string, args: string[]): Promise<string> => {
  try { return (await run(cmd, args)).stdout; } catch (e: any) { return e?.stdout ?? ''; }
};

export async function listListeners(): Promise<Listener[]> {
  const pairs = parseLsofListen(await tryRun('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']));
  if (pairs.length === 0) return [];
  const pids = [...new Set(pairs.map((p) => p.pid))].join(',');
  const cwds = parseLsofCwd(await tryRun('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids]));
  const pgids = parsePs(await tryRun('/bin/ps', ['-o', 'pid=,pgid=', '-p', pids]));
  return pairs.map(({ pid, port, command }) => ({ pid, port, cwd: cwds.get(pid) ?? '', pgid: pgids.get(pid) ?? pid, ...(command ? { command } : {}) }));
}

/** Listeners whose cwd is inside a project and that Oberth didn't start, keyed by project id. */
export function matchForeign(listeners: Listener[], projects: Project[], managed: Set<number>): Map<string, Listener[]> {
  const m = new Map<string, Listener[]>();
  for (const l of listeners) {
    if (managed.has(l.pgid) || !l.cwd) continue;
    const p = projects.find((p) => l.cwd === p.dir || l.cwd.startsWith(p.dir + sep));
    if (p) m.set(p.id, [...(m.get(p.id) ?? []), l]);
  }
  return m;
}

export function existingUrl(foreign: Listener[]): string | undefined {
  if (foreign.length === 0) return undefined;
  return `http://localhost:${Math.min(...foreign.map((l) => l.port))}/`;
}

const servesHtml = (url: string): Promise<boolean> => new Promise((resolve) => {
  try {
    const req = get(url, (res) => { res.resume(); resolve(/text\/html/i.test(String(res.headers['content-type'] ?? ''))); });
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  } catch { resolve(false); }
});

/** True if the port answers GET / with a non-error status: a page, not a debugger port or raw TCP. */
const servesPage = (port: number): Promise<boolean> => new Promise((resolve) => {
  try {
    const req = get(`http://127.0.0.1:${port}/`, (res) => { res.resume(); resolve((res.statusCode ?? 500) < 400); });
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  } catch { resolve(false); }
});

/** Keeps only leftover listeners that serve pages; projects left with none are dropped. */
export async function keepWebListeners(m: Map<string, Listener[]>): Promise<Map<string, Listener[]>> {
  const out = new Map<string, Listener[]>();
  for (const [id, ls] of m) {
    const ok = await Promise.all(ls.map((l) => servesPage(l.port)));
    const kept = ls.filter((_, i) => ok[i]);
    if (kept.length) out.set(id, kept);
  }
  return out;
}

/** The page of a leftover server: the lowest port that serves HTML (skips API ports), else the lowest port. */
export async function foreignUrl(foreign: Listener[]): Promise<string | undefined> {
  const ports = [...new Set(foreign.map((l) => l.port))].sort((a, b) => a - b);
  const html = await Promise.all(ports.map((p) => servesHtml(`http://127.0.0.1:${p}/`)));
  const page = ports.find((_, i) => html[i]);
  return page ? `http://localhost:${page}/` : existingUrl(foreign);
}
