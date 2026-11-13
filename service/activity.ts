import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Tokens } from './pricing.ts';

export type ActivityKind = 'launch' | 'ready' | 'failed' | 'crashed' | 'stopped' | 'script' | 'commit' | 'session' | 'idea' | 'usage';
/** What was done on a project after some moment. */
export interface WorkSince { lastAt: number; commits: number; turns: number }
const isWork = (e: Activity): boolean => e.kind === 'commit' || e.kind === 'session';

export interface Activity {
  at: number; id: string; kind: ActivityKind; text: string; ok?: boolean;
  /** what makes a recorded event unique (see addOnce) */
  key?: string;
  /** session: the Claude session, and the turn's active time */
  sessionId?: string; ms?: number;
  /** usage: a turn's tokens, and what they would cost at API prices (absent when a model has no known price) */
  tokens?: Tokens; usd?: number;
}

const MAX = 300;
const DAY_FILE = /^\d{4}-\d\d-\d\d\.jsonl$/;
const pad = (n: number): string => String(n).padStart(2, '0');
/** The local calendar day of a moment, which names its file. */
export const dayKey = (at: number): string => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * Oberth's events (launches, readiness, failures, script results), kept for good: one file of JSON lines
 * per local day in `<state dir>/activity/`. Nothing is held in memory, so a restart loses nothing.
 */
export class ActivityLog {
  private dir: string;
  private now: () => number;
  /** keys already in each day's file, read the first time that day is written to through addOnce */
  private keys = new Map<string, Set<string>>();
  /** when each project's commits and Claude turns happened, read from the files once and kept up by append */
  private work?: Map<string, Activity[]>;

  constructor(stateDir: string, now: () => number = Date.now) {
    this.now = now;
    this.dir = join(stateDir, 'activity');
    mkdirSync(this.dir, { recursive: true });
    this.importOldFile(stateDir);
  }

  add(e: Omit<Activity, 'at'> & { at?: number }): void {
    this.append({ at: this.now(), ...e });
  }

  /** Records an event found by looking (a commit, a Claude turn), which may be found again. False if it was already there. */
  addOnce(e: Activity & { key: string }): boolean {
    const day = dayKey(e.at);
    let keys = this.keys.get(day);
    if (!keys) { keys = new Set(this.onDay(e.at).flatMap((x) => x.key ? [x.key] : [])); this.keys.set(day, keys); }
    if (keys.has(e.key)) return false;
    keys.add(e.key);
    this.append(e);
    return true;
  }

  /** Today's events, oldest first. */
  today(): Activity[] { return this.onDay(this.now()).slice(-MAX); }

  /** Every event of the local day that holds `at`, oldest first. A damaged line is skipped, not fatal. */
  onDay(at: number): Activity[] {
    let text: string;
    try { text = readFileSync(this.fileFor(at), 'utf8'); } catch { return []; }
    const events: Activity[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { events.push(JSON.parse(line)); } catch { /* a write cut short */ }
    }
    return events.sort((a, b) => a.at - b.at);
  }

  /** The earliest day the log holds, as `YYYY-MM-DD`. */
  firstDay(): string | undefined {
    try { return readdirSync(this.dir).filter((f) => DAY_FILE.test(f)).sort()[0]?.slice(0, 10); } catch { return undefined; }
  }

  /** Commits and Claude turns of a project after a moment; undefined when there were none. A turn counts from when it ended. */
  workSince(id: string, since: number): WorkSince | undefined {
    const out: WorkSince = { lastAt: 0, commits: 0, turns: 0 };
    for (const e of this.loadWork().get(id) ?? []) {
      const end = e.at + (e.ms ?? 0);
      if (end <= since) continue;
      out.lastAt = Math.max(out.lastAt, end);
      if (e.kind === 'commit') out.commits++; else out.turns++;
    }
    return out.lastAt ? out : undefined;
  }

  /** A project's commits and Claude turns, oldest first. */
  workOf(id: string): Activity[] { return [...(this.loadWork().get(id) ?? [])].sort((a, b) => a.at - b.at); }

  private loadWork(): Map<string, Activity[]> {
    if (this.work) return this.work;
    this.work = new Map();
    let files: string[] = [];
    try { files = readdirSync(this.dir).filter((f) => DAY_FILE.test(f)); } catch { /* nothing yet */ }
    for (const f of files) for (const e of this.onDay(new Date(`${f.slice(0, 10)}T12:00:00`).getTime())) this.noteWork(e);
    return this.work;
  }

  private noteWork(e: Activity): void {
    if (!this.work || !isWork(e)) return;
    const list = this.work.get(e.id);
    if (list) list.push(e); else this.work.set(e.id, [e]);
  }

  private fileFor(at: number): string { return join(this.dir, `${dayKey(at)}.jsonl`); }

  private append(e: Activity): void {
    this.noteWork(e);
    try { appendFileSync(this.fileFor(e.at), JSON.stringify(e) + '\n'); } catch (err) { console.error('could not save activity:', err); }
  }

  /** `activity.json` held the last day or two before the log was kept by day. Moved aside once read, so it imports only once. */
  private importOldFile(stateDir: string): void {
    const old = join(stateDir, 'activity.json');
    let events: unknown;
    try { events = JSON.parse(readFileSync(old, 'utf8')); } catch { return; }
    if (!Array.isArray(events)) return;
    for (const e of events) if (typeof e?.at === 'number') this.append(e);
    try { renameSync(old, join(stateDir, 'activity.imported.json')); } catch (err) { console.error('could not move activity.json aside:', err); }
  }
}
