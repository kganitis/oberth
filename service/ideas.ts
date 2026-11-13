// Ideas (docs/architecture.md, "Ideas"): the owner's notebook of new projects before a folder exists, and of
// things to do later in projects that do. Kept in <state dir>/ideas.json; never written into a project.
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCES = ['cli', 'mcp', 'menu', 'dashboard'] as const;
export type IdeaSource = (typeof SOURCES)[number];
export type IdeaState = 'open' | 'started' | 'dropped';
export interface IdeaNote { at: number; text: string; source: IdeaSource; sessionId?: string }
export interface Idea {
  id: string; title: string;
  /** absent: an idea for a new project; present: for that project (or 'oberth') */
  projectId?: string;
  notes: IdeaNote[]; state: IdeaState; createdAt: number; updatedAt: number;
  /** the Claude session it was captured in, when it came from one */
  sessionId?: string;
  /** when it was started: the project it became or was done in, and whether a Claude session was opened */
  started?: { at: number; projectId: string; claude: boolean };
  droppedAt?: number;
}

export const LIMITS = { title: 120, note: 4000, notes: 200, brief: 8000, folder: 41 };
/** Started ideas stay listed under Done this long, then only in the file. */
export const DONE_SHOWN = 30 * 24 * 3600 * 1000;
export const FOLDER = /^[a-z0-9][a-z0-9-]{0,40}$/;

const file = (stateDir: string) => join(stateDir, 'ideas.json');

export function loadIdeas(stateDir: string): Idea[] {
  try {
    const all = JSON.parse(readFileSync(file(stateDir), 'utf8'))?.ideas;
    return Array.isArray(all) ? all.filter((i) => i && typeof i.id === 'string' && typeof i.title === 'string' && Array.isArray(i.notes)) : [];
  } catch { return []; }
}

function saveIdeas(stateDir: string, ideas: Idea[]): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(file(stateDir), JSON.stringify({ ideas }, null, 2) + '\n');
}

// ---------- validation ----------

const text = (v: unknown, max: number, name: string, required = false): string | undefined => {
  if (v === undefined || v === null || v === '') { if (required) throw new Error(`${name} is missing`); return undefined; }
  if (typeof v !== 'string') throw new Error(`${name} must be text`);
  const t = v.trim();
  if (!t && required) throw new Error(`${name} is missing`);
  if (t.length > max) throw new Error(`${name} is longer than ${max} characters`);
  return t || undefined;
};
const source = (v: unknown): IdeaSource => (SOURCES.includes(v as IdeaSource) ? (v as IdeaSource) : 'dashboard');
const session = (v: unknown): string | undefined => (typeof v === 'string' && /^[\w-]{1,80}$/.test(v) ? v : undefined);

export interface NewIdea { title: string; note?: string; projectId?: string; source: IdeaSource; sessionId?: string }
/** A new idea from a request. projectId is checked by the caller against the known projects. Throws on bad input. */
export function cleanIdea(body: unknown): NewIdea {
  const b = (body ?? {}) as Record<string, unknown>;
  const projectId = b.projectId === undefined || b.projectId === null || b.projectId === '' ? undefined : text(b.projectId, 200, 'project');
  return { title: text(b.title, LIMITS.title, 'title', true)!, note: text(b.note, LIMITS.note, 'note'), projectId, source: source(b.source), sessionId: session(b.sessionId) };
}
export function cleanNote(body: unknown): { text: string; source: IdeaSource; sessionId?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  return { text: text(b.text, LIMITS.note, 'note', true)!, source: source(b.source), sessionId: session(b.sessionId) };
}

// ---------- changes ----------

/** Short, readable, unique among the ideas kept: i + three of 0-9a-z, like i7k2. */
function newId(taken: Set<string>): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  for (;;) {
    const id = 'i' + Array.from({ length: 3 }, () => chars[randomInt(chars.length)]).join('');
    if (!taken.has(id)) return id;
  }
}

function change(stateDir: string, id: string, f: (i: Idea, all: Idea[]) => void): Idea | undefined {
  const all = loadIdeas(stateDir);
  const i = all.find((x) => x.id === id);
  if (!i) return undefined;
  f(i, all);
  saveIdeas(stateDir, all);
  return i;
}

/** Adds an idea. The same title, open, for the same project gets the note instead of a twin. */
export function addIdea(stateDir: string, n: NewIdea, now = Date.now()): Idea {
  const all = loadIdeas(stateDir);
  const same = all.find((i) => i.state === 'open' && i.projectId === n.projectId && i.title.toLowerCase() === n.title.toLowerCase());
  const note = (t: string): IdeaNote => ({ at: now, text: t, source: n.source, ...(n.sessionId ? { sessionId: n.sessionId } : {}) });
  if (same) {
    if (n.note && same.notes.length < LIMITS.notes) same.notes.push(note(n.note));
    same.updatedAt = now;
    saveIdeas(stateDir, all);
    return same;
  }
  const idea: Idea = {
    id: newId(new Set(all.map((i) => i.id))), title: n.title, ...(n.projectId ? { projectId: n.projectId } : {}),
    notes: n.note ? [note(n.note)] : [], state: 'open', createdAt: now, updatedAt: now, ...(n.sessionId ? { sessionId: n.sessionId } : {}),
  };
  all.push(idea);
  saveIdeas(stateDir, all);
  return idea;
}

export function addNote(stateDir: string, id: string, n: { text: string; source: IdeaSource; sessionId?: string }, now = Date.now()): Idea | undefined {
  return change(stateDir, id, (i) => {
    if (i.notes.length >= LIMITS.notes) throw new Error(`this idea already has ${LIMITS.notes} notes`);
    i.notes.push({ at: now, text: n.text, source: n.source, ...(n.sessionId ? { sessionId: n.sessionId } : {}) });
    i.updatedAt = now;
  });
}

/** Rename, or move between a project and "new project" (projectId null). */
export function editIdea(stateDir: string, id: string, e: { title?: string; projectId?: string | null }, now = Date.now()): Idea | undefined {
  return change(stateDir, id, (i) => {
    if (e.title !== undefined) i.title = e.title;
    if (e.projectId === null) delete i.projectId;
    else if (e.projectId !== undefined) i.projectId = e.projectId;
    i.updatedAt = now;
  });
}

export const dropIdea = (stateDir: string, id: string, now = Date.now()) =>
  change(stateDir, id, (i) => { i.state = 'dropped'; i.droppedAt = now; i.updatedAt = now; });
export const restoreIdea = (stateDir: string, id: string, now = Date.now()) =>
  change(stateDir, id, (i) => { i.state = 'open'; delete i.droppedAt; delete i.started; i.updatedAt = now; });
export const markStarted = (stateDir: string, id: string, projectId: string, claude: boolean, now = Date.now()) =>
  change(stateDir, id, (i) => { i.state = 'started'; i.started = { at: now, projectId, claude }; i.updatedAt = now; });

export function deleteIdea(stateDir: string, id: string): boolean {
  const all = loadIdeas(stateDir);
  const rest = all.filter((i) => i.id !== id);
  if (rest.length === all.length) return false;
  saveIdeas(stateDir, rest);
  return true;
}

// ---------- reading ----------

/** The http(s) links in an idea's notes, in order, without repeats. */
export function linksOf(i: Idea): string[] {
  const out = new Set<string>();
  for (const n of i.notes) for (const m of n.text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) out.add(m[0].replace(/[.,;:!?]+$/, ''));
  return [...out];
}

/** The Claude session an idea came from. */
export const sessionOf = (i: Idea): string | undefined => i.sessionId ?? i.notes.find((n) => n.sessionId)?.sessionId;

/** The brief a start sheet offers, from the title and notes, cut to fit. */
export function briefOf(i: Idea, projectName?: string): string {
  const [first, ...rest] = i.notes.map((n) => n.text);
  const parts = [projectName ? `Idea for ${projectName}: ${i.title}` : i.title];
  if (first) parts.push(first);
  if (rest.length) parts.push(['Notes so far:', ...rest.map((t) => `- ${t.replace(/\n+/g, ' ')}`)].join('\n'));
  parts.push(projectName ? 'Propose how to do it in this codebase before writing code.' : 'Start by proposing a stack and a first version small enough to try this week.');
  return parts.join('\n\n').slice(0, LIMITS.brief);
}

/** A folder name from a title: lower case, digits and dashes. */
export function slugOf(title: string): string {
  const s = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s.slice(0, LIMITS.folder).replace(/-+$/, '') || 'new-project');
}

/** What the Ideas view shows: open ideas newest activity first, Done for 30 days, Dropped. */
export function viewIdeas(all: Idea[], now = Date.now()) {
  // a tie (two saved in one millisecond) goes to the one saved later, which comes later in the file
  const at = new Map(all.map((i, n) => [i, n]));
  const byActivity = (a: Idea, b: Idea) => b.updatedAt - a.updatedAt || at.get(b)! - at.get(a)!;
  const open = all.filter((i) => i.state === 'open').sort(byActivity);
  return {
    newProjects: open.filter((i) => !i.projectId),
    forProjects: open.filter((i) => i.projectId),
    done: all.filter((i) => i.state === 'started' && now - (i.started?.at ?? 0) < DONE_SHOWN).sort((a, b) => (b.started?.at ?? 0) - (a.started?.at ?? 0)),
    dropped: all.filter((i) => i.state === 'dropped').sort((a, b) => (b.droppedAt ?? 0) - (a.droppedAt ?? 0)),
  };
}
