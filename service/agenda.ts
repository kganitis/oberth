import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BackupStatus, BackupStep } from './backupstatus.ts';
import { inBatches } from './batches.ts';
import type { ClaudeSession, PendingTool, SessionScan } from './claudesessions.ts';
import type { WorkSince } from './activity.ts';
import type { GitFacts } from './gitinfo.ts';

/**
 * What is waiting for the owner, across every project. Derived items are never stored, so nothing can go out
 * of date; only asks and Later are kept. Design: docs/architecture.md, "The Agenda".
 */
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const THRESHOLDS = { quiet: 15 * MIN, unpushed: DAY, uncommitted: 7 * DAY, askOpen: 14 * DAY, backup: DAY, snapshots: 2 * DAY, later: 7 * DAY, doneKept: 30 * DAY, notesAfter: HOUR, notesSettled: DAY, notesOld: 7 * DAY };
export const ASK_LIMITS = { text: 200, detail: 1000, open: 10 };

export type AgendaAction =
  | { kind: 'session'; sessionId: string }
  /** the project's newest assistant session, or a new one */
  | { kind: 'assistant' }
  | { kind: 'tab'; tab: 'git' | 'about' }
  | { kind: 'backup-log' }
  /** an issue on GitHub or the project's own live site, stored by the outside-world checks (outside.ts) */
  | { kind: 'url'; url: string }
  /** the Logbook's review of the week starting on that Monday (review.ts) */
  | { kind: 'review'; start: string };

export interface AgendaItem {
  /** `session:<id>`, `ask:<id>`, `git:<project>:unpushed`, `notes:<project>`, `backup`, `backup:snapshots`, `backup:restore` */
  key: string;
  level: 'needs' | 'look';
  source: 'session' | 'ask' | 'git' | 'backup' | 'notes' | 'outside' | 'review';
  projectId?: string;
  /** the project's name, or what stands in for one */
  where: string;
  title: string;
  detail?: string;
  since: number;
  /** Later holds until this changes */
  fingerprint: string;
  action: AgendaAction;
}

export interface Ask { id: string; projectId: string; text: string; detail?: string; sessionId?: string; createdAt: number; updatedAt: number; doneAt?: number }
export interface AgendaState { asks: Ask[]; later: Record<string, { until: number; fingerprint: string }> }

/** A project's About notes: when they were last saved, and the work done after that. */
export interface NotesFacts { updatedAt: number; work?: WorkSince }

export interface AgendaProject { id: string; name: string; dir: string; hidden?: boolean }
export interface AgendaInputs {
  /** the folders projects are found in: a session there counts though it is in no project */
  roots: string[];
  /** whether there is an assistant to open an ask's project in; without one an ask opens the About tab */
  assistant?: boolean;
  projects: AgendaProject[];
  sessions: ClaudeSession[];
  /** sessions whose process is alive */
  live: Set<string>;
  /** unanswered tool calls of live sessions, by session id */
  pending: Map<string, PendingTool>;
  git: Map<string, GitFacts | null>;
  backup: BackupStatus | null;
  /** by project id; only projects with notes */
  notes: Map<string, NotesFacts>;
  /** released work seen from outside, already as items (outside.ts) */
  outside?: AgendaItem[];
  /** the pointer to last week's review (review.ts) */
  review?: AgendaItem;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const shortDate = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Tools that stop until the person answers. */
const ASKS_PERSON: Record<string, string> = { AskUserQuestion: 'Claude asked you a question', ExitPlanMode: 'A plan is waiting for your approval' };
/** Long by nature, so their silence says nothing. */
const SLOW_TOOLS = new Set(['Agent', 'Task']);

type SessionPart = Pick<AgendaItem, 'level' | 'title' | 'detail' | 'since' | 'fingerprint'>;

/** The one thing a session is waiting on, the most certain signal first; undefined when it needs nothing. */
function sessionNeed(s: ClaudeSession, live: boolean, tool: PendingTool | undefined, now: number): SessionPart | undefined {
  if (live && tool) {
    const asks = ASKS_PERSON[tool.name];
    if (asks) return { level: 'needs', title: clip(tool.question ?? asks, 200), detail: s.title, since: tool.at, fingerprint: `tool:${tool.id}` };
  }
  if (s.interruptedAwaitingPerson) return { level: 'needs', title: 'The app quit during a turn; it is waiting for you', detail: s.title, since: s.lastActivityAt, fingerprint: `quit:${s.lastAssistantUuid}` };
  // a summary describes one finished turn: not a newer one, and not the turn running now
  const sum = s.summary;
  if (sum && sum.forUuid && sum.forUuid === s.lastAssistantUuid && s.latestUserFrameAt <= s.lastTurnEdgeAt) {
    const since = s.lastTurnEdgeAt || s.lastActivityAt;
    const fingerprint = `summary:${sum.forUuid}`;
    if (sum.needsAction) return { level: 'needs', title: clip(sum.needsAction, 200), detail: sum.detail && clip(sum.detail, 300), since, fingerprint };
    if (sum.status === 'blocked' || sum.status === 'need_input') return { level: 'needs', title: 'Claude is waiting for you', detail: sum.detail && clip(sum.detail, 300), since, fingerprint };
    if (sum.status === 'failed') return { level: 'look', title: 'The last turn failed', detail: sum.detail && clip(sum.detail, 300), since, fingerprint };
  }
  // a permission prompt leaves no mark of its own: it looks like a tool call that never returns
  if (live && tool && !SLOW_TOOLS.has(tool.name) && now - tool.at > THRESHOLDS.quiet) {
    return { level: 'look', title: 'Quiet for 15 minutes; it may be waiting for you', detail: s.title, since: tool.at, fingerprint: `tool:${tool.id}` };
  }
  return undefined;
}

function gitItems(p: AgendaProject, g: GitFacts, now: number): AgendaItem[] {
  const item = (kind: string, title: string, since: number, count: number): AgendaItem => ({
    key: `git:${p.id}:${kind}`, level: 'look', source: 'git', projectId: p.id, where: p.name, title, since, fingerprint: String(count), action: { kind: 'tab', tab: 'git' },
  });
  const out: AgendaItem[] = [];
  // ahead is only ever set against an upstream, so a repo with no remote makes no item here
  if (g.ahead && g.unpushedAt && now - g.unpushedAt > THRESHOLDS.unpushed) out.push(item('unpushed', `${plural(g.ahead, 'commit')} not pushed`, g.unpushedAt, g.ahead));
  if (g.changed && g.changedAt && now - g.changedAt > THRESHOLDS.uncommitted) out.push(item('uncommitted', `${plural(g.changed, 'file')} not committed`, g.changedAt, g.changed));
  if (g.stashes) out.push(item('stash', `${plural(g.stashes, 'stash', 'stashes')} left behind`, g.stashAt ?? now, g.stashes));
  return out;
}

/**
 * Notes older than the project's latest work. A session often saves the About and then commits, so work needs to be
 * clearly later. It waits for the work to settle rather than nag during it, unless the notes are old by then.
 * The fingerprint is the notes' date, so Later isn't undone by the next commit.
 */
export function notesItem(p: AgendaProject, n: NotesFacts, now: number): AgendaItem | undefined {
  const w = n.work;
  if (!w || w.lastAt - n.updatedAt <= THRESHOLDS.notesAfter) return undefined;
  if (now - w.lastAt <= THRESHOLDS.notesSettled && now - n.updatedAt <= THRESHOLDS.notesOld) return undefined;
  const done = [w.commits && plural(w.commits, 'commit'), w.turns && plural(w.turns, 'Claude turn')].filter(Boolean).join(' and ');
  return {
    key: `notes:${p.id}`, level: 'look', source: 'notes', projectId: p.id, where: p.name,
    title: 'About notes are older than the latest work',
    detail: `Saved ${shortDate(n.updatedAt)}, then ${done}, the latest on ${shortDate(w.lastAt)}`,
    since: w.lastAt, fingerprint: String(n.updatedAt), action: { kind: 'tab', tab: 'about' },
  };
}

function backupItem(b: BackupStatus, now: number): AgendaItem | undefined {
  const clean = b.lastCleanAt;
  if (b.exit === 0 && clean !== undefined && now - clean <= THRESHOLDS.backup) return undefined;
  return {
    key: 'backup', level: 'needs', source: 'backup', where: 'Dev backup',
    title: clean ? `Backup hasn't finished cleanly since ${shortDate(clean)}` : 'The backup log shows no clean run',
    detail: b.error, since: clean ?? b.at, fingerprint: b.line, action: { kind: 'backup-log' },
  };
}

/**
 * The daily snapshots or their restore check: failed, overdue, or missing from the log. Counts only, never repo names,
 * since hidden projects are snapshotted too. The fingerprint leaves out the line, which a failing step rewrites every hour.
 */
function stepItem(key: string, name: string, s: BackupStep | undefined, b: BackupStatus, now: number): AgendaItem | undefined {
  const clean = s?.lastCleanAt;
  if (s && s.exit === 0 && clean !== undefined && now - clean <= THRESHOLDS.snapshots) return undefined;
  const repos = s?.failed === 1 ? '1 repo' : `${s?.failed} repos`;
  const title = !s ? `The backup log shows no ${name.toLowerCase()}`
    : s.exit !== 0 && s.failed > 0 ? `${name} failed for ${repos}`
    : clean ? `${name} hasn't finished cleanly since ${shortDate(clean)}` : `The backup log shows no clean ${name.toLowerCase()}`;
  return {
    key, level: 'needs', source: 'backup', where: 'Dev backup', title,
    detail: s && s.exit !== 0 ? 'The log names them.' : undefined,
    since: clean ?? s?.at ?? b.at, fingerprint: `${clean ?? 'never'}:${s?.exit ?? 'none'}:${s?.failed ?? 0}`, action: { kind: 'backup-log' },
  };
}

/** Every item, Later or not. Hidden projects make none, and a session counts only in a project or a folder that groups them. */
export function allItems(i: AgendaInputs, state: AgendaState, now: number): AgendaItem[] {
  const visible = i.projects.filter((p) => !p.hidden);
  const hiddenDirs = new Set(i.projects.filter((p) => p.hidden).map((p) => p.dir));
  const byDir = new Map(visible.map((p) => [p.dir, p]));
  const parents = new Set([...i.roots, ...i.projects.map((p) => dirname(p.dir))]);
  const items: AgendaItem[] = [];
  for (const s of i.sessions) {
    const p = byDir.get(s.folder);
    if (!p && (hiddenDirs.has(s.folder) || !parents.has(s.folder))) continue;
    const need = sessionNeed(s, i.live.has(s.id), i.pending.get(s.id), now);
    if (need) items.push({ ...need, key: `session:${s.id}`, source: 'session', projectId: p?.id, where: p?.name ?? s.title, action: { kind: 'session', sessionId: s.id } });
  }
  const known = new Set(i.sessions.map((s) => s.id));
  for (const a of state.asks) {
    const p = visible.find((x) => x.id === a.projectId);
    if (!p || a.doneAt) continue;
    items.push({
      key: `ask:${a.id}`, level: now - a.createdAt > THRESHOLDS.askOpen ? 'look' : 'needs', source: 'ask', projectId: p.id, where: p.name, title: a.text, detail: a.detail,
      since: a.createdAt, fingerprint: String(a.updatedAt), action: a.sessionId && known.has(a.sessionId) ? { kind: 'session', sessionId: a.sessionId } : i.assistant === false ? { kind: 'tab', tab: 'about' } : { kind: 'assistant' },
    });
  }
  for (const p of visible) {
    const g = i.git.get(p.id);
    if (g) items.push(...gitItems(p, g, now));
    const n = i.notes.get(p.id);
    const stale = n && notesItem(p, n, now);
    if (stale) items.push(stale);
  }
  const shown = new Set(visible.map((p) => p.id));
  for (const it of i.outside ?? []) if (it.projectId && shown.has(it.projectId)) items.push(it);
  if (i.review) items.push(i.review);
  if (i.backup) {
    const steps = [backupItem(i.backup, now), stepItem('backup:snapshots', 'Snapshots', i.backup.snapshots, i.backup, now), stepItem('backup:restore', 'Restore check', i.backup.restore, i.backup, now)];
    items.push(...steps.filter((s) => s !== undefined));
  }
  return items;
}

const isLater = (it: AgendaItem, state: AgendaState, now: number): boolean => {
  const l = state.later[it.key];
  return !!l && l.until > now && l.fingerprint === it.fingerprint;
};

/** The list as shown: without items put off for Later, newest first within each level. */
export function buildAgenda(i: AgendaInputs, state: AgendaState, now: number): { needs: AgendaItem[]; look: AgendaItem[]; count: number } {
  const shown = allItems(i, state, now).filter((it) => !isLater(it, state, now)).sort((a, b) => b.since - a.since);
  const needs = shown.filter((it) => it.level === 'needs');
  return { needs, look: shown.filter((it) => it.level === 'look'), count: needs.length };
}

// ---------- asks and Later, in <state dir>/agenda.json ----------

const file = (stateDir: string) => join(stateDir, 'agenda.json');

export function loadAgendaState(stateDir: string): AgendaState {
  try {
    const s = JSON.parse(readFileSync(file(stateDir), 'utf8'));
    return { asks: Array.isArray(s?.asks) ? s.asks : [], later: s?.later && typeof s.later === 'object' && !Array.isArray(s.later) ? s.later : {} };
  } catch {
    return { asks: [], later: {} };
  }
}

function saveAgendaState(stateDir: string, s: AgendaState, now: number): void {
  const later = Object.fromEntries(Object.entries(s.later).filter(([, l]) => l.until > now));
  const asks = s.asks.filter((a) => !a.doneAt || now - a.doneAt < THRESHOLDS.doneKept);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(file(stateDir), JSON.stringify({ asks, later }, null, 2) + '\n');
}

/** Validates a new ask. Throws on bad input. */
export function cleanAsk(body: unknown): { text: string; detail?: string; sessionId?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.text !== 'string' || !b.text.trim()) throw new Error('text is required');
  const text = b.text.trim();
  if (text.length > ASK_LIMITS.text) throw new Error(`text is longer than ${ASK_LIMITS.text} characters`);
  if (b.detail !== undefined && b.detail !== null && typeof b.detail !== 'string') throw new Error('detail must be text');
  const detail = typeof b.detail === 'string' ? b.detail.trim() || undefined : undefined;
  if (detail && detail.length > ASK_LIMITS.detail) throw new Error(`detail is longer than ${ASK_LIMITS.detail} characters`);
  const sessionId = typeof b.sessionId === 'string' && /^local_[0-9a-f-]+$/.test(b.sessionId) ? b.sessionId : undefined;
  return { text, detail, sessionId };
}

/** Adds an ask; the same text in the same project updates the one already open. Throws when the project has too many. */
export function addAsk(stateDir: string, projectId: string, ask: { text: string; detail?: string; sessionId?: string }, now = Date.now()): Ask {
  const s = loadAgendaState(stateDir);
  const open = s.asks.filter((a) => a.projectId === projectId && !a.doneAt);
  const same = open.find((a) => a.text === ask.text);
  if (same) {
    same.detail = ask.detail ?? same.detail;
    same.sessionId = ask.sessionId ?? same.sessionId;
    same.updatedAt = now;
    saveAgendaState(stateDir, s, now);
    return same;
  }
  if (open.length >= ASK_LIMITS.open) throw new Error(`this project already has ${ASK_LIMITS.open} open asks`);
  const entry: Ask = { id: randomBytes(4).toString('hex'), projectId, ...ask, createdAt: now, updatedAt: now };
  s.asks.push(entry);
  saveAgendaState(stateDir, s, now);
  return entry;
}

export const openAsks = (stateDir: string, projectId: string): Ask[] => loadAgendaState(stateDir).asks.filter((a) => a.projectId === projectId && !a.doneAt);

/** Closes an ask; false when no open ask has that id. */
export function closeAsk(stateDir: string, id: string, now = Date.now()): boolean {
  const s = loadAgendaState(stateDir);
  const a = s.asks.find((x) => x.id === id && !x.doneAt);
  if (!a) return false;
  a.doneAt = now;
  saveAgendaState(stateDir, s, now);
  return true;
}

export function putOffLater(stateDir: string, it: AgendaItem, now = Date.now()): void {
  const s = loadAgendaState(stateDir);
  s.later[it.key] = { until: now + THRESHOLDS.later, fingerprint: it.fingerprint };
  saveAgendaState(stateDir, s, now);
}

// ---------- reading the sources, at most as often as they are worth reading ----------

/** Where the Agenda reads from. The session parts come from the assistant (assistant.ts) and backup from its module: absent means no such items. */
export interface AgendaSources {
  sessions?(): SessionScan;
  liveSessions?(): Promise<Set<string>>;
  pending?(s: ClaudeSession): PendingTool | undefined;
  git(dir: string): Promise<GitFacts | null>;
  backup?(): BackupStatus | null;
  notes(): Map<string, NotesFacts>;
  /** outside-world items, and why GitHub couldn't be asked (outside.ts); absent where it isn't wired */
  outside?(): AgendaItem[];
  outsideError?(): string | undefined;
  review?(): AgendaItem | undefined;
}

/** Whether each source could be read: if the app changes its format the list would otherwise just look clean. */
export interface AgendaHealth {
  /** absent without an assistant, or without the backup module */
  sessions?: { ok: boolean; files: number; parsed: number; summaries: number };
  backup?: { ok: boolean };
  outside?: { ok: boolean; error?: string };
}
export interface AgendaView { needs: AgendaItem[]; look: AgendaItem[]; count: number; health: AgendaHealth }

/** Below this many sessions, having no summary at all is normal. */
const FEW_SESSIONS = 5;
const sessionsReadable = (s: SessionScan): boolean => s.files === 0 || (s.parsed > 0 && (s.parsed < FEW_SESSIONS || s.summaries > 0));

export class Agenda {
  private o: { stateDir: string; roots: string[]; sources: AgendaSources; now?: () => number; fastMs?: number; gitMs?: number };
  private fast?: { at: number; value: Promise<Pick<AgendaInputs, 'sessions' | 'live' | 'pending' | 'backup' | 'notes' | 'outside' | 'review'> & { scan: SessionScan }> };
  private slow?: { at: number; value: Promise<Map<string, GitFacts | null>> };

  constructor(o: Agenda['o']) { this.o = o; }

  private time(): number { return (this.o.now ?? Date.now)(); }

  private readFast() {
    const { sources } = this.o;
    return (async () => {
      const scan = sources.sessions?.() ?? { sessions: [], files: 0, parsed: 0, summaries: 0 };
      const live = (await sources.liveSessions?.()) ?? new Set<string>();
      const pending = new Map<string, PendingTool>();
      for (const s of scan.sessions) {
        const t = live.has(s.id) ? sources.pending?.(s) : undefined;
        if (t) pending.set(s.id, t);
      }
      return { scan, sessions: scan.sessions, live, pending, backup: sources.backup?.() ?? null, notes: sources.notes(), outside: sources.outside?.() ?? [], review: sources.review?.() };
    })();
  }

  private readGit(projects: AgendaProject[]) {
    const shown = projects.filter((p) => !p.hidden);
    return inBatches(shown.map((p) => async () => [p.id, await this.o.sources.git(p.dir)] as const), 4).then((all) => new Map(all));
  }

  private async inputs(projects: AgendaProject[]): Promise<{ inputs: AgendaInputs; scan: SessionScan }> {
    const now = this.time();
    if (!this.fast || now - this.fast.at >= (this.o.fastMs ?? 5000)) this.fast = { at: now, value: this.readFast() };
    if (!this.slow || now - this.slow.at >= (this.o.gitMs ?? 30_000)) this.slow = { at: now, value: this.readGit(projects) };
    const [{ scan, ...fast }, git] = await Promise.all([this.fast.value, this.slow.value]);
    return { scan, inputs: { ...fast, git, projects, roots: this.o.roots, assistant: !!this.o.sources.sessions } };
  }

  async view(projects: AgendaProject[]): Promise<AgendaView> {
    const { inputs, scan } = await this.inputs(projects);
    const list = buildAgenda(inputs, loadAgendaState(this.o.stateDir), this.time());
    const outsideError = this.o.sources.outsideError?.();
    const { sources } = this.o;
    return { ...list, health: { ...(sources.sessions ? { sessions: { ok: sessionsReadable(scan), files: scan.files, parsed: scan.parsed, summaries: scan.summaries } } : {}), ...(sources.backup ? { backup: { ok: inputs.backup !== null } } : {}), ...(this.o.sources.outside ? { outside: { ok: !outsideError, ...(outsideError ? { error: outsideError } : {}) } } : {}) } };
  }

  /** The item as currently shown, so nothing can be acted on that the list didn't hand out. */
  async item(projects: AgendaProject[], key: unknown): Promise<AgendaItem | undefined> {
    const v = await this.view(projects);
    return [...v.needs, ...v.look].find((it) => it.key === key);
  }

  /** Forgets what was read, for after something changed on purpose. */
  forget(): void { this.fast = undefined; this.slow = undefined; }
}
