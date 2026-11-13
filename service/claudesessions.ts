import { execFile } from 'node:child_process';
import { closeSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where the Claude desktop app keeps one JSON file per Claude Code session: <account>/<org>/local_<id>.json */
export const SESSIONS_DIR = join(homedir(), 'Library/Application Support/Claude/claude-code-sessions');
/** Where Claude Code keeps each session's transcript: <cwd with every non-alphanumeric as ->/<cliSessionId>.jsonl */
export const TRANSCRIPTS_DIR = join(homedir(), '.claude/projects');

/** The app's summary of a session's last turn, as the app itself would show it (see effectiveSummary). */
export interface TurnSummary { status?: string; detail?: string; needsAction?: string; forUuid?: string }

export interface ClaudeSession {
  id: string;
  title: string;
  /** realpath of the folder the session was started in (worktree sessions: their origin) */
  folder: string;
  lastActivityAt: number;
  latestUserFrameAt: number;
  lastTurnEdgeAt: number;
  /** where the session really runs (a worktree's own folder); names the transcript's folder */
  cwd?: string;
  cliSessionId?: string;
  lastAssistantUuid?: string;
  summary?: TurnSummary;
  /** the app quit mid-turn and won't resume this turn by itself */
  interruptedAwaitingPerson?: boolean;
  archived?: boolean;
}

/** One pass over the session files: the sessions, plus how much of the app's private format could be read. */
export interface SessionScan { sessions: ClaudeSession[]; files: number; parsed: number; summaries: number }

/** What Oberth shows for a project: its newest session, and whether Claude is mid-turn in it. */
export interface ClaudeState { sessionId: string; title: string; at: number; working: boolean; others: number }

/** The folder under TRANSCRIPTS_DIR that holds the transcripts of sessions run in cwd. */
export const transcriptFolder = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-');

const real = (p: string): string | undefined => { try { return realpathSync(p); } catch { return undefined; } };
const dirs = (p: string): string[] => {
  try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('deleted_')).map((d) => join(p, d.name)); } catch { return []; }
};

// Parsed session files keyed by path; a file is re-read only when its mtime changes (they total ~10 MB).
const cache = new Map<string, Parsed & { mtimeMs: number }>();
interface Parsed { session: ClaudeSession | null; ok: boolean; hasSummary: boolean }

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * The summary as the app shows it: a turn's wrap-up overrides it. A wrap-up without a question for the person
 * means a "blocked" summary is out of date, and one with a question makes the turn blocked on that question.
 * The same rules as the app's own code when this was written; a turn that failed stays failed.
 */
export function effectiveSummary(raw: unknown, wrapUp: unknown, summaryFor?: unknown): TurnSummary | undefined {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const w = wrapUp && typeof wrapUp === 'object' ? wrapUp as Record<string, unknown> : undefined;
  if (!raw && !w) return undefined;
  const status = str(r.status_category);
  const out: TurnSummary = { status, detail: str(r.status_detail), needsAction: str(r.needs_action), forUuid: str(summaryFor) ?? str(r.summarizes_uuid) };
  if (!w) return out;
  const asked = str(w.needsUser);
  if (status === 'failed') return asked ? { ...out, needsAction: asked } : out;
  if (asked) return { ...out, status: 'blocked', needsAction: asked };
  return { ...out, status: status === 'blocked' || status === 'need_input' ? 'review_ready' : status, needsAction: undefined };
}

function parse(file: string): Parsed {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    const ok = /^local_[0-9a-f-]+$/.test(s.sessionId);
    const hasSummary = !!s.postTurnSummary;
    const folder = typeof (s.originCwd ?? s.cwd) === 'string' ? real(s.originCwd ?? s.cwd) : undefined;
    if (!folder || !ok) return { session: null, ok, hasSummary };
    return {
      ok, hasSummary,
      session: {
        id: s.sessionId,
        title: typeof s.title === 'string' && s.title ? s.title : 'Untitled session', folder,
        lastActivityAt: Number(s.lastActivityAt) || 0, latestUserFrameAt: Number(s.latestUserFrameAt) || 0, lastTurnEdgeAt: Number(s.lastTurnEdgeAt) || 0,
        cwd: str(s.cwd), cliSessionId: str(s.cliSessionId), lastAssistantUuid: str(s.lastAssistantUuid),
        summary: effectiveSummary(s.postTurnSummary, s.turnWrapUp, s.postTurnSummaryFor),
        interruptedAwaitingPerson: s.interruptedAwaitingPerson === true,
        archived: s.isArchived === true,
      },
    };
  } catch {
    return { session: null, ok: false, hasSummary: false }; // unreadable or half-written: skip
  }
}

/**
 * Every non-archived desktop-app session. These are the app's own files, not a public format: anything
 * unexpected is skipped, so a changed layout means "no sessions", never a wrong one.
 */
export function readSessions(root = SESSIONS_DIR): ClaudeSession[] { return scanSessions(root).sessions; }

export function scanSessions(root = SESSIONS_DIR, withArchived = false): SessionScan {
  const out: ClaudeSession[] = [];
  const seen = new Set<string>();
  let parsed = 0, summaries = 0;
  for (const org of dirs(root).flatMap(dirs)) {
    let files: string[] = [];
    try { files = readdirSync(org).filter((f) => /^local_[\w-]+\.json$/.test(f)); } catch { continue; }
    for (const f of files) {
      const file = join(org, f);
      seen.add(file);
      let mtimeMs: number;
      try { mtimeMs = statSync(file).mtimeMs; } catch { continue; }
      let hit = cache.get(file);
      if (!hit || hit.mtimeMs !== mtimeMs) { hit = { mtimeMs, ...parse(file) }; cache.set(file, hit); }
      if (hit.session && (withArchived || !hit.session.archived)) out.push(hit.session);
      if (hit.ok) parsed++;
      if (hit.hasSummary) summaries++;
    }
  }
  for (const k of cache.keys()) if (!seen.has(k) && k.startsWith(root)) cache.delete(k);
  return { sessions: out, files: seen.size, parsed, summaries };
}

/** A tool call the transcript shows as sent but not yet answered. */
export interface PendingTool { id: string; name: string; at: number; question?: string }

const lines = (tail: string): any[] => tail.split('\n').flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } });

/**
 * The unanswered tool call at the end of a transcript's tail. The session file is written only now and then, so
 * this is the one place a pause shows up at once: a question can sit unanswered for many minutes while the
 * session file stays as it was. A question wins over other calls made alongside it.
 */
export function parsePendingTool(tail: string): PendingTool | undefined {
  const open = new Map<string, PendingTool>();
  for (const e of lines(tail)) {
    if (e?.isSidechain || e?.isMeta) continue;
    const content = e?.message?.content;
    if (e?.type === 'assistant' && Array.isArray(content)) {
      for (const c of content) {
        if (c?.type !== 'tool_use' || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
        open.set(c.id, { id: c.id, name: c.name, at: Date.parse(e.timestamp) || 0, question: str(c.input?.questions?.[0]?.question) });
      }
    } else if (e?.type === 'user') {
      const results = Array.isArray(content) ? content.filter((c) => c?.type === 'tool_result') : [];
      for (const r of results) open.delete(r.tool_use_id);
      // the person wrote something new, so whatever was left open was abandoned
      if (!results.length) open.clear();
    }
  }
  const all = [...open.values()];
  return all.find((t) => t.name === 'AskUserQuestion') ?? all[0];
}

const tailOf = (file: string, size: number, bytes: number): string => {
  const len = Math.min(bytes, size);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  return buf.toString('utf8');
};

/**
 * What the owner last asked in a project's folder, from the newest transcript that says. Claude Code repeats it as
 * `last-prompt` lines through a transcript, so the end of the file is enough. Private format: anything unexpected gives nothing.
 */
export function lastPrompt(dir: string, root = TRANSCRIPTS_DIR): { text: string; at: number } | undefined {
  const folder = join(root, transcriptFolder(dir));
  let files: { file: string; mtimeMs: number; size: number }[];
  try {
    files = readdirSync(folder).filter((f) => f.endsWith('.jsonl')).map((f) => {
      const { mtimeMs, size } = statSync(join(folder, f));
      return { file: join(folder, f), mtimeMs, size };
    }).sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return undefined;
  }
  for (const f of files.slice(0, 5)) {
    try {
      const found = lines(tailOf(f.file, f.size, 1024 * 1024)).filter((e) => e?.type === 'last-prompt' && typeof e.lastPrompt === 'string' && e.lastPrompt).at(-1);
      if (found) return { text: found.lastPrompt, at: f.mtimeMs };
    } catch { /* the next one may do */ }
  }
  return undefined;
}

const pendingCache = new Map<string, { mtimeMs: number; size: number; pending?: PendingTool }>();

/** The session's unanswered tool call, reading only the end of its transcript, and only when that changed. */
export function pendingTool(s: ClaudeSession, root = TRANSCRIPTS_DIR): PendingTool | undefined {
  if (!s.cwd || !s.cliSessionId) return undefined;
  const file = join(root, transcriptFolder(s.cwd), `${s.cliSessionId}.jsonl`);
  try {
    const { mtimeMs, size } = statSync(file);
    const hit = pendingCache.get(file);
    if (hit?.mtimeMs === mtimeMs && hit.size === size) return hit.pending;
    const pending = parsePendingTool(tailOf(file, size, 256 * 1024));
    pendingCache.set(file, { mtimeMs, size, pending });
    return pending;
  } catch {
    return undefined; // no transcript, or the format changed
  }
}

const run = (args: string[]): Promise<string> => new Promise((resolve) => {
  execFile('ps', args, { maxBuffer: 16 * 1024 * 1024, timeout: 3000 }, (err, out) => resolve(err ? '' : out));
});

/** pids whose executable (not merely an argument) is the claude binary, from `ps -axo pid=,comm=`. */
export function claudePids(commOutput: string): number[] {
  return commOutput.split('\n').map((l) => /^\s*(\d+)\s+(\/.*\/claude\.app\/Contents\/MacOS\/claude)\s*$/.exec(l)).filter((m) => m).map((m) => Number(m![1]));
}

/** Session ids from the environments printed by `ps eww -o command= -p <pids>`. */
export function sessionIdsFromEnv(envOutput: string): Set<string> {
  return new Set([...envOutput.matchAll(/(?:^|\s)CLAUDE_CODE_HOST_SESSION_ID=(local_[0-9a-f-]+)/g)].map((m) => m[1]));
}

/**
 * Sessions whose `claude` process is alive. The app starts each session's process with
 * CLAUDE_CODE_HOST_SESSION_ID=<session id> in its environment, also for sessions started fresh (which carry
 * no id in their arguments). Children inherit it, so only the claude binary itself is asked: a dev server a
 * session started must not keep a closed session looking open.
 */
export async function liveSessionIds(): Promise<Set<string>> {
  const pids = claudePids(await run(['-axo', 'pid=,comm=']));
  if (!pids.length) return new Set();
  return sessionIdsFromEnv(await run(['eww', '-o', 'command=', '-p', pids.join(',')]));
}

/**
 * Claude state per project folder (keyed by the dir as given). Working: the session's process is alive and its
 * last user message is newer than its last turn end. The app may not have saved a pause yet, so a turn paused
 * on a question can read either way; the Agenda asks the transcript instead (pendingTool).
 */
export function claudeStates(projectDirs: string[], sessions: ClaudeSession[], live: Set<string>): Map<string, ClaudeState> {
  const out = new Map<string, ClaudeState>();
  for (const dir of projectDirs) {
    const want = real(dir);
    const mine = want ? sessions.filter((s) => s.folder === want).sort((a, b) => b.lastActivityAt - a.lastActivityAt) : [];
    if (!mine.length) continue;
    const s = mine[0];
    const working = live.has(s.id) && s.latestUserFrameAt > s.lastTurnEdgeAt;
    out.set(dir, { sessionId: s.id, title: s.title, at: s.lastActivityAt, working, others: mine.length - 1 });
  }
  return out;
}

/** The most recently active, non-archived desktop-app session started in dir. */
export function findClaudeSession(dir: string, root = SESSIONS_DIR): string | undefined {
  return claudeStates([dir], readSessions(root), new Set()).get(dir)?.sessionId;
}

/** Link that reopens the project's session in the Claude app, or starts a new one on its folder. */
/** A new Claude Code session in a folder with its first message typed in (the app reads q; it caps it at 14,336 characters). */
export const newSessionUrl = (dir: string, prompt?: string): string =>
  `claude://code/new?folder=${encodeURIComponent(dir)}${prompt ? `&q=${encodeURIComponent(prompt.slice(0, 8000))}` : ''}`;

export function claudeUrlFor(dir: string, root = SESSIONS_DIR): string {
  const id = findClaudeSession(dir, root);
  return id ? `claude://claude.ai/epitaxy/${id}` : `claude://code/new?folder=${encodeURIComponent(dir)}`;
}
