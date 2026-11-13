import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pmOf, type Project } from './types.ts';

/** Checks shown first, in this order, when the project defines them. */
export const PINNED = ['test', 'typecheck', 'build', 'lint'];
/** Covered by Launch. */
const SKIP = new Set(['dev', 'preview']);

export type ScriptStatus = 'running' | 'passed' | 'failed' | 'cancelled';
export interface ScriptResult { status: ScriptStatus; startedAt: number; endedAt?: number; code?: number | null; tail?: string[] }

/** The package.json scripts Oberth offers to run: pinned checks, then the rest. npm's pre/post hooks are left out. */
export function scriptNames(p: Project): { pinned: string[]; other: string[] } {
  const all = Object.keys(p.scripts);
  const hook = (n: string) => /^(pre|post)./.test(n) && all.includes(n.replace(/^(pre|post)/, ''));
  const usable = all.filter((n) => !SKIP.has(n) && !hook(n));
  return { pinned: PINNED.filter((n) => usable.includes(n)), other: usable.filter((n) => !PINNED.includes(n)) };
}

const TAIL_LINES = 12;
const safe = (s: string) => s.replace(/[^\w.-]/g, '_');

export interface ScriptRunnerOptions {
  logDir: string;
  stateDir: string;
  env: Record<string, string>;
  /** argv for a script; tests replace npm */
  command?: (name: string) => string[];
  onFinish?: (id: string, name: string, result: ScriptResult) => void;
}

/** Runs one-off package.json scripts (one at a time per script), each in its own process group, and remembers the last result. */
export class ScriptRunner {
  private results: Record<string, Record<string, ScriptResult>>;
  private children = new Map<string, ChildProcess>();
  private file: string;
  private opts: ScriptRunnerOptions;

  constructor(opts: ScriptRunnerOptions) {
    this.opts = opts;
    mkdirSync(opts.logDir, { recursive: true });
    mkdirSync(opts.stateDir, { recursive: true });
    this.file = join(opts.stateDir, 'scripts.json');
    try { this.results = JSON.parse(readFileSync(this.file, 'utf8')); } catch { this.results = {}; }
  }

  logPath(id: string, name: string): string { return join(this.opts.logDir, `${id}.script.${safe(name)}.log`); }

  resultsFor(id: string): Record<string, ScriptResult> { return this.results[id] ?? {}; }

  run(p: Project, name: string): ScriptResult {
    const key = `${p.id}\0${name}`;
    const current = this.results[p.id]?.[name];
    if (current?.status === 'running' && this.children.has(key)) return current;
    const result: ScriptResult = { status: 'running', startedAt: Date.now() };
    (this.results[p.id] ??= {})[name] = result;
    const log = createWriteStream(this.logPath(p.id, name), { flags: 'w' });
    const [cmd, ...args] = this.opts.command?.(name) ?? [pmOf(p), 'run', name];
    const child = spawn(cmd, args, { cwd: p.dir, env: this.opts.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.set(key, child);
    let tail = '';
    const onData = (b: Buffer) => { log.write(b); tail = (tail + b.toString()).slice(-8000); };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    const finish = (status: ScriptStatus, code?: number | null) => {
      if (this.children.get(key) !== child) return;
      this.children.delete(key);
      log.end();
      Object.assign(result, { status: result.status === 'cancelled' ? 'cancelled' : status, endedAt: Date.now(), code, tail: tail.split('\n').filter((l) => l.trim()).slice(-TAIL_LINES) });
      this.save();
      this.opts.onFinish?.(p.id, name, result);
    };
    child.once('error', (e) => { tail += `\ncould not start ${cmd}: ${e.message}`; finish('failed'); });
    child.once('close', (code) => finish(code === 0 ? 'passed' : 'failed', code));
    return result;
  }

  cancel(id: string, name: string): void {
    const child = this.children.get(`${id}\0${name}`);
    const result = this.results[id]?.[name];
    if (!child?.pid || !result) return;
    result.status = 'cancelled';
    const kill = (sig: NodeJS.Signals) => { try { process.kill(-child.pid!, sig); } catch { /* gone */ } };
    kill('SIGTERM');
    const t = setTimeout(() => kill('SIGKILL'), 3000);
    child.once('close', () => clearTimeout(t));
  }

  /** Cancels every running script and waits until they have exited. */
  async stopAll(): Promise<void> {
    const waits = [...this.children.entries()].map(([key, child]) => {
      const [id, name] = key.split('\0');
      const done = new Promise<void>((r) => child.once('close', () => r()));
      this.cancel(id, name);
      return done;
    });
    await Promise.all(waits);
  }

  private save(): void {
    // only finished results are worth keeping across restarts
    const done: Record<string, Record<string, ScriptResult>> = {};
    for (const [id, byName] of Object.entries(this.results)) {
      for (const [name, r] of Object.entries(byName)) if (r.status !== 'running') (done[id] ??= {})[name] = r;
    }
    try { writeFileSync(this.file, JSON.stringify(done) + '\n'); } catch (e) { console.error('could not save script results:', e); }
  }
}
