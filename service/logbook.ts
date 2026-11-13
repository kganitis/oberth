import { open, readdir, stat } from 'node:fs/promises';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityLog } from './activity.ts';
import { inBatches } from './batches.ts';
import { TRANSCRIPTS_DIR, transcriptFolder, type ClaudeSession } from './claudesessions.ts';
import type { BranchCommit } from './gitinfo.ts';
import { addTokens, costOf, noTokens, tokensOf, totalTokens, type Tokens } from './pricing.ts';

/** How far back commits are looked for. Nothing is forgotten after this: it only bounds each look, and the first one. */
const COMMIT_WINDOW_MS = 90 * 86_400_000;
/** A longer silence inside a turn is time away (a question waiting, a laptop asleep), not work. */
const AWAY_MS = 5 * 60_000;
/** Bumped when turns start carrying something new, so older offsets are dropped and transcripts read again (2: usage). */
const USAGE_VERSION = 2;
/** A transcript this quiet has finished its last turn, even with no next prompt to show it. */
const QUIET_MS = 10 * 60_000;

/** One prompt from the owner and all that followed it, with the tokens its responses used (subagents' included). */
export interface Turn { key: string; at: number; ms: number; usage?: TurnUsage }
/** usd: at API prices, for the models with a known price; unpriced: tokens of models without one */
export interface TurnUsage { tokens: Tokens; usd: number; unpriced: number; models: string[] }

/** A turn's responses, each counted once: a response written over several lines repeats its usage on each. */
function usageOf(byMessage: Map<string, { model: string; tokens: Tokens }>): TurnUsage | undefined {
  if (!byMessage.size) return undefined;
  let tokens = noTokens(), usd = 0, unpriced = 0;
  const models = new Set<string>();
  for (const { model, tokens: t } of byMessage.values()) {
    tokens = addTokens(tokens, t);
    models.add(model);
    const c = costOf(model, t);
    if (c === undefined) unpriced += totalTokens(t); else usd += c;
  }
  return totalTokens(tokens) ? { tokens, usd, unpriced, models: [...models].sort() } : undefined;
}

/** Time spent across some moments, leaving out each silence longer than AWAY_MS. Compaction rewrites order, so they are sorted first. */
export function activeMs(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap <= AWAY_MS) total += gap;
  }
  return total;
}

/** Whether a transcript line is the owner writing, rather than a tool result, a notification or a compaction summary. */
export function isPrompt(e: any): boolean {
  if (e.type !== 'user' || e.isSidechain || e.isMeta || e.isCompactSummary || typeof e.uuid !== 'string') return false;
  if (e.origin && e.origin.kind !== 'human') return false;
  const c = e.message?.content;
  if (typeof c === 'string') return !c.startsWith('<');
  return Array.isArray(c) && c.some((b) => b?.type === 'text') && !c.some((b) => b?.type === 'tool_result');
}

/**
 * The finished turns in part of a transcript, which must start at a line's start. `consumed` is how many bytes
 * were dealt with: an unfinished turn is left unconsumed, to be read again whole. `final` says the last turn has
 * finished. This is Claude Code's private format: anything unexpected is skipped, so it costs turns, never a crash.
 */
export function readTurns(buf: Buffer, final: boolean): { turns: Turn[]; consumed: number; title?: string } {
  const turns: Turn[] = [];
  let key = '', times: number[] = [], from = -1, title: string | undefined;
  let usage = new Map<string, { model: string; tokens: Tokens }>();
  const close = () => {
    if (from >= 0) { const u = usageOf(usage); turns.push({ key, at: times[0], ms: activeMs(times), ...(u ? { usage: u } : {}) }); }
    from = -1;
  };
  let pos = 0;
  for (let nl = buf.indexOf(10, pos); nl !== -1; pos = nl + 1, nl = buf.indexOf(10, pos)) {
    let e: any;
    try { e = JSON.parse(buf.toString('utf8', pos, nl)); } catch { continue; }
    if (e?.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle) title = e.customTitle;
    const at = typeof e?.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
    if (Number.isNaN(at)) continue;
    if (isPrompt(e)) { close(); key = e.uuid; times = [at]; from = pos; usage = new Map(); } else if (from >= 0) {
      times.push(at);
      const m = e?.type === 'assistant' ? e.message : undefined;
      if (m?.usage && typeof m.model === 'string' && m.model !== '<synthetic>') usage.set(String(m.id ?? `${pos}`), { model: m.model, tokens: tokensOf(m.usage) });
    }
  }
  if (final) { close(); return { turns, consumed: pos, title }; }
  return { turns, consumed: from >= 0 ? from : pos, title };
}

export interface LogbookOptions {
  stateDir: string;
  log: ActivityLog;
  projects: () => { id: string; dir: string }[];
  /** every session the assistant's app knows, archived ones too: titles, and worktree sessions' projects. Absent: no assistant, so commits only */
  sessions?: () => ClaudeSession[];
  commits: (dir: string, since: number) => Promise<BranchCommit[]>;
  /** changes when a repository's history may have: see reflogStamp */
  stamp: (dir: string) => string | undefined;
  transcriptsRoot?: string;
  now?: () => number;
}

/**
 * Adds to the activity log what happens outside Oberth: commits, and turns of Claude sessions. It looks by itself
 * rather than when a page asks, because the session files keep only their latest moment and transcripts can be
 * cleaned up. The offset of each transcript is kept in `logbook.json`; addOnce makes reading anything twice harmless.
 */
export class Logbook {
  private o: LogbookOptions;
  private file: string;
  private offsets: Record<string, number> = {};
  private sizes = new Map<string, number>();
  private stamps = new Map<string, string>();
  private running = false;
  private now: () => number;

  constructor(o: LogbookOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
    this.file = join(o.stateDir, 'logbook.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      // offsets from before tokens were counted are dropped once: every transcript is read again, and addOnce keeps
      // the turns already recorded from doubling while their usage is added
      if (saved?.offsets && typeof saved.offsets === 'object' && saved.version === USAGE_VERSION) this.offsets = saved.offsets;
    } catch { /* first run: everything is read from the start */ }
  }

  /** One look at commits and sessions. A look still going when the next is due makes that one a no-op. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const projects = this.o.projects();
      await this.recordCommits(projects);
      if (this.o.sessions) await this.recordSessions(projects, this.o.sessions);
    } finally {
      this.running = false;
    }
  }

  private async recordCommits(projects: { id: string; dir: string }[]): Promise<void> {
    const since = this.now() - COMMIT_WINDOW_MS;
    await inBatches(projects.map((p) => async () => {
      const stamp = this.o.stamp(p.dir);
      if (stamp === 'none' || (stamp && this.stamps.get(p.dir) === stamp)) return;
      for (const c of await this.o.commits(p.dir, since)) {
        this.o.log.addOnce({ at: c.time, id: p.id, kind: 'commit', text: `${c.hash} ${c.subject}`, key: `${p.id}:${c.full}` });
      }
      if (stamp) this.stamps.set(p.dir, stamp);
    }), 4);
  }

  /**
   * A transcript's folder names the project it ran in. The transcripts are walked, not the app's session files,
   * because many have none (sessions run in a terminal, and folders since renamed). A session in
   * a worktree has a folder of its own, so that one takes its project from the session file.
   */
  private async recordSessions(projects: { id: string; dir: string }[], sessions: () => ClaudeSession[]): Promise<void> {
    const root = this.o.transcriptsRoot ?? TRANSCRIPTS_DIR;
    const folders = new Map<string, string>(), dirs = new Map<string, string>();
    for (const p of projects) {
      folders.set(transcriptFolder(p.dir), p.id);
      try { dirs.set(realpathSync(p.dir), p.id); } catch { /* folder gone */ }
    }
    const known = new Map(sessions().flatMap((s) => s.cliSessionId ? [[s.cliSessionId, s] as const] : []));
    let all: string[];
    try { all = await readdir(root); } catch { return; }
    for (const folder of all) {
      let names: string[];
      try { names = (await readdir(join(root, folder))).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of names) {
        const name = f.slice(0, -'.jsonl'.length);
        const s = known.get(name);
        const id = folders.get(folder) ?? (s && dirs.get(s.folder));
        if (id) await this.readTranscript(name, join(root, folder, f), id, s);
      }
    }
  }

  private async readTranscript(name: string, file: string, id: string, s?: ClaudeSession): Promise<void> {
    let size: number, mtimeMs: number;
    try { ({ size, mtimeMs } = await stat(file)); } catch { return; }
    let offset = this.offsets[name] ?? 0;
    if (size < offset) offset = 0; // not the file it was
    const final = this.now() - mtimeMs > QUIET_MS;
    if (size === offset || (!final && this.sizes.get(name) === size)) return;
    this.sizes.set(name, size);

    let buf: Buffer;
    try {
      const fd = await open(file, 'r');
      try {
        buf = Buffer.alloc(size - offset);
        await fd.read(buf, 0, buf.length, offset);
      } finally { await fd.close(); }
    } catch { return; }

    const { turns, consumed, title } = readTurns(buf, final);
    const text = s?.title ?? title ?? 'Untitled session';
    for (const t of turns) {
      this.o.log.addOnce({ at: t.at, id, kind: 'session', text, sessionId: s?.id, ms: t.ms, key: t.key });
      // a separate event, so turns recorded before tokens were counted get theirs by reading again (see USAGE_VERSION)
      const u = t.usage;
      if (u) this.o.log.addOnce({ at: t.at, id, kind: 'usage', text: u.models.join(', '), sessionId: s?.id, key: `u:${t.key}`, tokens: u.tokens, ...(u.unpriced === 0 || u.usd ? { usd: Math.round(u.usd * 1e6) / 1e6 } : {}) });
    }
    if (consumed) {
      this.offsets[name] = offset + consumed;
      try { writeFileSync(this.file, JSON.stringify({ version: USAGE_VERSION, offsets: this.offsets }) + '\n'); } catch (err) { console.error('could not save logbook offsets:', err); }
    }
    await new Promise((r) => setImmediate(r)); // a long first read mustn't starve the API
  }
}
