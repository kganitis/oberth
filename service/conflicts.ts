import { sep } from 'node:path';
import type { Listener, Project } from './types.ts';

import { stripAnsi } from './ansi.ts';
// How dev servers report a taken port: Vite, Node's EADDRINUSE, Hugo/Go, Python.
// Vite's "Port 5173 is in use, trying another one..." is not one: Vite moves on to the next port by itself.
const PATTERNS = [
  /Port (\d+) is (?:already )?in use(?!,? trying another)/i,
  /EADDRINUSE[^\n]*?:(\d+)\b/,
  /:(\d+): bind: address already in use/i,
  /address already in use[^\n]*?:(\d+)\b/i,
];

/** The port a failed server said was taken, from the end of its output (the last mention wins). */
export function portInUse(output: string): number | undefined {
  const text = stripAnsi(output);
  let best: { at: number; port: number } | undefined;
  for (const re of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const port = Number(m[1]);
      if (port > 0 && port < 65536 && (!best || m.index! > best.at)) best = { at: m.index!, port };
    }
  }
  return best?.port;
}

/**
 * Who holds the port: another project Oberth started, a leftover server inside a project (both can be
 * stopped and the launch retried), or a process that belongs to no discovered project, which is only named.
 * That last kind can still live inside a project root (a folder left out of Oberth), so it carries its folder.
 */
export type Holder =
  | { kind: 'launched'; projectId: string; name: string; pid: number }
  | { kind: 'leftover'; projectId: string; name: string; pid: number }
  | { kind: 'other'; pid: number; command?: string; cwd?: string };
export interface Conflict { port: number; holder: Holder }

export function findHolder(port: number, listeners: Listener[], projects: Project[], managed: Map<number, string>): Conflict | undefined {
  const l = listeners.find((x) => x.port === port);
  if (!l) return undefined;
  const launchedId = managed.get(l.pgid);
  const launched = launchedId ? projects.find((p) => p.id === launchedId) : undefined;
  if (launched) return { port, holder: { kind: 'launched', projectId: launched.id, name: launched.name, pid: l.pid } };
  const inside = l.cwd ? projects.find((p) => l.cwd === p.dir || l.cwd.startsWith(p.dir + sep)) : undefined;
  if (inside) return { port, holder: { kind: 'leftover', projectId: inside.id, name: inside.name, pid: l.pid } };
  return { port, holder: { kind: 'other', pid: l.pid, command: l.command, ...(l.cwd ? { cwd: l.cwd } : {}) } };
}
