import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { ErrorTracker } from './errors.ts';
import { foreignUrl, listListeners } from './ports.ts';
import { findPageUrlDetail, probe } from './readiness.ts';
import type { Listener, Mode, RunPlan, RunState, RunStatus } from './types.ts';

export interface RunnerOptions {
  logDir: string;
  onReady: (id: string, url: string) => void;
  /** every settled change: running, failed (with the status it failed from), stopped */
  onStatus?: (id: string, state: RunState, from: RunStatus) => void;
  readyTimeoutMs?: number;
  windowGraceMs?: number;
  /** How long a bare (unlabelled) URL waits for a labelled one before it is used. */
  weakGraceMs?: number;
  /** after this long without a URL in the output, look for ports the run's process group listens on */
  portFallbackMs?: number;
  listeners?: () => Promise<Listener[]>;
}

interface Run {
  state: RunState;
  child?: ChildProcess;
  log?: WriteStream;
  stopping: boolean;
  exited?: Promise<void>;
  timers: NodeJS.Timeout[];
  /** the process group was killed and swept; never signal it again (its pgid may be reused) */
  swept?: boolean;
  /** errors in the server's own output (the last step), since this launch */
  errors: ErrorTracker;
}

const ACTIVE = new Set(['installing', 'starting', 'running']);

export class Runner {
  private runs = new Map<string, Run>();
  private opts: Required<RunnerOptions>;

  constructor(opts: RunnerOptions) {
    this.opts = { onStatus: () => {}, readyTimeoutMs: 60_000, windowGraceMs: 3000, weakGraceMs: 3000, portFallbackMs: 5000, listeners: listListeners, ...opts };
    mkdirSync(opts.logDir, { recursive: true });
  }

  logPath(id: string): string { return join(this.opts.logDir, `${id}.log`); }

  state(id: string): RunState { return this.runs.get(id)?.state ?? { id, status: 'stopped', mode: 'local' }; }

  /** Errors seen in the current (or last) run's server output. */
  errors(id: string): ErrorTracker | undefined { return this.runs.get(id)?.errors; }

  /** Process group → project id, for the runs that are alive. */
  managedByPgid(): Map<number, string> {
    const m = new Map<number, string>();
    for (const [id, r] of this.runs) if (r.child?.pid && r.child.exitCode === null && r.child.signalCode === null) m.set(r.child.pid, id);
    return m;
  }

  managedPgids(): Set<number> { return new Set(this.managedByPgid().keys()); }

  /** Starts a run; while one is active for this id, returns its state unchanged. */
  start(id: string, plan: RunPlan, mode: Mode): RunState {
    const existing = this.runs.get(id);
    // active, or being stopped: a click now must not start a second copy
    if (existing && (ACTIVE.has(existing.state.status) || existing.state.status === 'stopping')) return existing.state;
    const run: Run = { state: { id, status: 'starting', mode, startedAt: Date.now(), lanNote: plan.lanNote }, stopping: false, timers: [], errors: new ErrorTracker() };
    this.runs.set(id, run);
    const log = createWriteStream(this.logPath(id), { flags: 'w' });
    run.log = log;
    this.step(run, plan, 0, log);
    return run.state;
  }

  private fail(run: Run, error: string): void {
    if (run.stopping) return;
    const from = run.state.status;
    run.state = { ...run.state, status: 'failed', error, pid: undefined };
    this.opts.onStatus(run.state.id, run.state, from);
    run.timers.forEach(clearTimeout);
    void this.terminate(run);
  }

  /** SIGTERM the group, wait up to 5 s for the leader, then SIGKILL whatever is left, once. */
  private async terminate(run: Run): Promise<void> {
    const child = run.child;
    if (!child?.pid || run.swept) return;
    run.swept = true;
    const leaderAlive = child.exitCode === null && child.signalCode === null;
    this.killGroup(child.pid, 'SIGTERM');
    if (leaderAlive) {
      const killer = setTimeout(() => this.killGroup(child.pid!, 'SIGKILL'), 5000);
      await run.exited;
      clearTimeout(killer);
    }
    this.killGroup(child.pid, 'SIGKILL');
  }

  private step(run: Run, plan: RunPlan, i: number, log: WriteStream): void {
    const step = plan.steps[i];
    const last = i === plan.steps.length - 1;
    run.state.status = step.label === 'install' ? 'installing' : 'starting';
    run.state.command = step.argv.join(' ');
    const [cmd, ...args] = step.argv;
    const child = spawn(cmd, args, { cwd: plan.cwd, env: plan.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    run.child = child;
    run.state.pid = child.pid;
    run.exited = new Promise((r) => child.once('close', () => r()));
    let output = '';
    let chosen = false;
    let weakTimer: NodeJS.Timeout | undefined;
    const choose = (url: string) => { chosen = true; clearTimeout(weakTimer); void this.awaitReady(run, url); };
    if (last && plan.localUrl && !plan.window) choose(plan.localUrl);
    else if (last && !plan.window) {
      // Fallback for servers that never print a URL: the ports their own process group listens on.
      const look = async () => {
        if (chosen || run.state.status !== 'starting' || run.stopping || run.child !== child) return;
        const mine = (await this.opts.listeners()).filter((l) => l.pgid === child.pid);
        if (chosen) return;
        if (mine.length) { choose((await foreignUrl(mine))!); return; }
        run.timers.push(setTimeout(look, 1000));
      };
      run.timers.push(setTimeout(look, this.opts.portFallbackMs));
    }
    const onData = (b: Buffer) => {
      log.write(b);
      if (last) run.errors.feed(b.toString());
      if (!last || plan.window || chosen) return;
      output = (output + b.toString()).slice(-65536);
      const found = findPageUrlDetail(output);
      if (!found) return;
      if (found.strong) choose(found.url);
      else if (!weakTimer) {
        weakTimer = setTimeout(() => { if (!chosen) choose(findPageUrlDetail(output)!.url); }, this.opts.weakGraceMs);
        run.timers.push(weakTimer);
      }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.once('error', (e) => this.fail(run, `could not start ${cmd}: ${e.message}`));
    child.once('close', (code, signal) => {
      if (!run.stopping && !last && code === 0) { this.step(run, plan, i + 1, log); return; }
      log.end();
      if (run.stopping || run.state.status === 'failed') return;
      this.fail(run, `${step.argv.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
    });
    if (!last) return;
    if (plan.window) {
      run.timers.push(setTimeout(() => {
        if (run.state.status !== 'starting') return;
        run.state.status = 'running';
        this.opts.onStatus(run.state.id, run.state, 'starting');
      }, this.opts.windowGraceMs));
    } else {
      run.timers.push(setTimeout(() => {
        if (run.state.status === 'starting') this.fail(run, `not ready after ${Math.round(this.opts.readyTimeoutMs / 1000)}s`);
      }, this.opts.readyTimeoutMs));
    }
  }

  private async awaitReady(run: Run, url: string): Promise<void> {
    while (run.state.status === 'starting' && !run.stopping) {
      if (await probe(url, 1000)) {
        if (run.state.status !== 'starting' || run.stopping) return;
        run.state = { ...run.state, status: 'running', url };
        this.opts.onStatus(run.state.id, run.state, 'starting');
        this.opts.onReady(run.state.id, url);
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  private killGroup(pgid: number, signal: NodeJS.Signals): void {
    try { process.kill(-pgid, signal); } catch { /* already gone */ }
  }

  async stop(id: string): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return;
    if (run.stopping) { await run.exited; return; }
    const from = run.state.status;
    run.stopping = true;
    run.timers.forEach(clearTimeout);
    if (ACTIVE.has(run.state.status)) run.state = { ...run.state, status: 'stopping' };
    await this.terminate(run);
    run.log?.end();
    run.state = { id, status: 'stopped', mode: run.state.mode };
    run.child = undefined;
    if (from !== 'stopped' && from !== 'failed') this.opts.onStatus(id, run.state, from);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }
}
