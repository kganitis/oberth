import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import type { About } from './about.ts';
import type { Idea } from './ideas.ts';
import { TRANSCRIPTS_DIR, transcriptFolder, type ClaudeSession } from './claudesessions.ts';
import { isPrompt } from './logbook.ts';

export const RECALL_KINDS = ['notes', 'ideas', 'sessions', 'code', 'docs'] as const;
export type RecallKind = (typeof RECALL_KINDS)[number];

/** How many of each kind one search returns. */
const LIMIT: Record<RecallKind, number> = { notes: 5, ideas: 5, sessions: 10, code: 10, docs: 10 };
/** Files are found in no useful order, so rg stops here and each project gets a turn from what came back. */
const MAX_FILES = 400;
/**
 * Transcripts are read newest first, this many at a time, until enough of them have the words in what was said.
 * Many only match in tool output or in a CLAUDE.md they loaded, so a fixed number of them could hide a real conversation.
 */
const TRANSCRIPT_BATCH = 40;
const LINES_PER_TRANSCRIPT = 100;
const SEARCH_MS = 5000;
const SNIPPET = 160;
const KEPT_TARGETS = 1000;
const DOCS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);
/** rg already skips hidden files and what git ignores; these are for folders with no .gitignore, and files nobody reads. */
const SKIP = ['node_modules', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__', 'package-lock.json', '*.lock', '*.min.*', '*.map', '*.svg'];
const COMMON = ['--no-config', '--fixed-strings', '--ignore-case', '--no-messages', '--color', 'never', '--no-heading'];

export interface RecallProject { id: string; name: string; dir: string }

export interface RecallHit {
  /** give this back to `open`; only keys from a search are accepted */
  key: string;
  kind: RecallKind;
  projectId: string;
  project: string;
  title: string;
  snippet: string;
  /** when it was said, for sessions */
  at?: number;
  /** the file or transcript */
  path?: string;
  line?: number;
}

export type RecallTarget =
  | { type: 'file'; path: string; line: number }
  | { type: 'session'; id: string }
  | { type: 'claude'; dir: string }
  | { type: 'about' }
  | { type: 'idea'; id: string };

export interface RecallResult {
  hits: RecallHit[];
  /** the search ran out of time, so there may be more */
  cut?: boolean;
  /** why nothing could be searched */
  error?: string;
}

export interface RecallOptions {
  /** every project that may be searched: anything else, its transcripts included, stays out of the results */
  projects: () => RecallProject[];
  /** the assistant's sessions (assistant.ts); absent means there are no transcripts to search */
  sessions?: () => ClaudeSession[];
  about: () => Record<string, About>;
  /** the Ideas notebook; absent in tests that don't care */
  ideas?: () => Idea[];
  transcriptsRoot?: string;
  rg?: string;
}

/** A piece of text around the match, on one line. */
export function snippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = Math.max(0, flat.toLowerCase().indexOf(query.toLowerCase()));
  const from = flat.length <= SNIPPET ? 0 : Math.max(0, Math.min(at - 50, flat.length - SNIPPET));
  return `${from > 0 ? '…' : ''}${flat.slice(from, from + SNIPPET)}${from + SNIPPET < flat.length ? '…' : ''}`;
}

/**
 * What a transcript line says in words, if the query is in them. rg also matches tool calls and their output, which
 * make up most of a transcript, so that is checked here. Claude Code's private format: anything unexpected gives nothing.
 */
export function spokenMatch(line: string, query: string): { who: 'You' | 'Claude'; text: string; at: number } | undefined {
  let e: any;
  try { e = JSON.parse(line); } catch { return undefined; }
  const blocks = (c: unknown): string => (Array.isArray(c) ? c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '');
  let who: 'You' | 'Claude', text: string;
  if (isPrompt(e)) {
    who = 'You';
    text = typeof e.message.content === 'string' ? e.message.content : blocks(e.message.content);
  } else if (e?.type === 'assistant' && !e.isSidechain) {
    who = 'Claude';
    text = blocks(e.message?.content);
  } else return undefined;
  if (!text.toLowerCase().includes(query.toLowerCase())) return undefined;
  const at = Date.parse(e.timestamp);
  return { who, text, at: Number.isNaN(at) ? 0 : at };
}

/** One from each project in turn, so a project with many matches can't fill the list. */
export function takeTurns<T>(items: T[], projectOf: (item: T) => string, limit: number): T[] {
  const queues = new Map<string, T[]>();
  for (const it of items) queues.set(projectOf(it), [...(queues.get(projectOf(it)) ?? []), it]);
  const out: T[] = [];
  for (let round = 0; out.length < limit && out.length < items.length; round++) {
    for (const q of queues.values()) if (round < q.length && out.length < limit) out.push(q[round]);
  }
  return out;
}

/**
 * Search across every project by running ripgrep when asked: it took well under a second over dozens of projects and
 * more than a gigabyte of transcripts when measured, so there is no index to build, store or keep fresh. The query is always a literal string.
 */
export class Recall {
  private o: RecallOptions;
  private targets = new Map<string, RecallTarget>();

  constructor(o: RecallOptions) { this.o = o; }

  async search(query: string, filter: { project?: string; kind?: RecallKind } = {}): Promise<RecallResult> {
    const projects = this.o.projects().filter((p) => !filter.project || p.id === filter.project);
    const wants = (k: RecallKind) => !filter.kind || filter.kind === k;
    const [files, sessions] = await Promise.all([
      wants('code') || wants('docs') ? this.searchFiles(query, projects) : { hits: [], cut: false, missing: false },
      wants('sessions') && this.o.sessions ? this.searchSessions(query, projects) : { hits: [], cut: false, missing: false },
    ]);
    const hits = [...(wants('notes') ? this.searchNotes(query, projects) : []), ...(wants('ideas') ? this.searchIdeas(query, filter.project) : []), ...sessions.hits, ...files.hits.filter((h) => wants(h.hit.kind))]
      .map(({ hit, target }) => { this.remember(hit.key, target); return hit; });
    return {
      hits,
      ...(files.cut || sessions.cut ? { cut: true } : {}),
      ...(files.missing || sessions.missing ? { error: "ripgrep isn't installed, so only notes were searched: brew install ripgrep" } : {}),
    };
  }

  /** What a key from a search opens. */
  open(key: unknown): RecallTarget | undefined { return typeof key === 'string' ? this.targets.get(key) : undefined; }

  private remember(key: string, target: RecallTarget): void {
    this.targets.delete(key);
    this.targets.set(key, target);
    if (this.targets.size > KEPT_TARGETS) this.targets.delete(this.targets.keys().next().value!);
  }

  private searchNotes(query: string, projects: RecallProject[]): Found[] {
    const about = this.o.about();
    const q = query.toLowerCase();
    const out: Found[] = [];
    for (const p of projects) {
      const a = about[p.id];
      const text = [a?.notes, a?.description].find((t) => t?.toLowerCase().includes(q));
      if (!text) continue;
      out.push({ hit: { key: `notes:${p.id}`, kind: 'notes', projectId: p.id, project: p.name, title: 'About', snippet: snippet(text, query) }, target: { type: 'about' } });
    }
    return out.slice(0, LIMIT.notes);
  }

  /** Idea titles and notes, so "did I already have this idea?" has an answer. Dropped ones too, marked so. */
  private searchIdeas(query: string, project?: string): Found[] {
    const q = query.toLowerCase();
    const names = new Map(this.o.projects().map((p) => [p.id, p.name]));
    const out: Found[] = [];
    for (const i of this.o.ideas?.() ?? []) {
      if (project && i.projectId !== project) continue;
      const text = [i.title, ...i.notes.map((n) => n.text)].find((t) => t.toLowerCase().includes(q));
      if (!text) continue;
      const where = i.projectId ? names.get(i.projectId) ?? i.projectId : 'New project';
      const state = i.state === 'open' ? '' : i.state === 'dropped' ? ' (dropped)' : ' (started)';
      out.push({ hit: { key: `ideas:${i.id}`, kind: 'ideas', projectId: i.projectId ?? '', project: where, title: `Idea: ${i.title}${state}`, snippet: snippet(text, query), at: i.updatedAt }, target: { type: 'idea', id: i.id } });
    }
    return out.sort((a, b) => (b.hit.at ?? 0) - (a.hit.at ?? 0)).slice(0, LIMIT.ideas);
  }

  private async searchFiles(query: string, projects: RecallProject[]): Promise<Search> {
    if (!projects.length) return { hits: [], cut: false, missing: false };
    const found: Found[] = [];
    const args = [...COMMON, '--with-filename', '--null', '--line-number', '--max-count', '1', '--max-filesize', '1M',
      ...SKIP.flatMap((g) => ['--glob', `!${g}`]), '-e', query, '--', ...projects.map((p) => p.dir)];
    const run = await this.rg(args, (l) => {
      const nul = l.indexOf('\0');
      const m = /^(\d+):(.*)$/.exec(l.slice(nul + 1));
      if (nul < 0 || !m) return true; // rg's note about a binary file
      const path = l.slice(0, nul), line = Number(m[1]);
      const p = projects.find((x) => path.startsWith(`${x.dir}/`));
      if (!p) return true;
      const kind: RecallKind = DOCS.has(extname(path).toLowerCase()) ? 'docs' : 'code';
      const title = `${relative(p.dir, path)}:${line}`;
      found.push({ hit: { key: `${kind}:${p.id}:${title}`, kind, projectId: p.id, project: p.name, title, snippet: snippet(m[2], query), path, line }, target: { type: 'file', path, line } });
      return found.length < MAX_FILES;
    });
    const some = (kind: RecallKind) => takeTurns(found.filter((f) => f.hit.kind === kind), (f) => f.hit.projectId, LIMIT[kind]);
    return { hits: [...some('code'), ...some('docs')], cut: run.cut, missing: run.missing };
  }

  /**
   * Transcripts are found by their folder, which names the project, as in the Logbook. Only folders of the given
   * projects are searched, so a project left out of Oberth stays out of the results. A worktree session has a folder
   * of its own, so those are added one file at a time from the session files.
   */
  private async searchSessions(query: string, projects: RecallProject[]): Promise<Search> {
    const root = this.o.transcriptsRoot ?? TRANSCRIPTS_DIR;
    const owner = new Map<string, RecallProject>(), dirs = new Map<string, RecallProject>();
    for (const p of projects) {
      owner.set(join(root, transcriptFolder(p.dir)), p);
      try { dirs.set(realpathSync(p.dir), p); } catch { /* folder gone */ }
    }
    const known = new Map<string, ClaudeSession>();
    for (const s of this.o.sessions?.() ?? []) {
      if (!s.cliSessionId) continue;
      known.set(s.cliSessionId, s);
      known.set(s.id.replace(/^local_/, ''), s); // a resumed session's first transcript is named after the session
      const p = dirs.get(s.folder);
      if (p && s.cwd) owner.set(join(root, transcriptFolder(s.cwd), `${s.cliSessionId}.jsonl`), p);
    }
    const paths = [...owner.keys()];
    if (!paths.length) return { hits: [], cut: false, missing: false };
    // quotes and backslashes are escaped in the file
    const inFile = JSON.stringify(query).slice(1, -1);
    const matched: { file: string; mtimeMs: number }[] = [];
    const first = await this.rg([...COMMON, '--no-ignore', '--files-with-matches', '--max-depth', '1', '--glob', '*.jsonl', '-e', inFile, '--', ...paths], (file) => {
      try { matched.push({ file, mtimeMs: statSync(file).mtimeMs }); } catch { /* gone since */ }
      return true;
    });
    const files = matched.sort((a, b) => b.mtimeMs - a.mtimeMs).map((m) => m.file);

    const best = new Map<string, NonNullable<ReturnType<typeof spokenMatch>>>();
    const read = (l: string) => {
      const nul = l.indexOf('\0');
      const file = l.slice(0, nul);
      if (best.get(file)?.who === 'You') return true;
      const said = spokenMatch(l.slice(nul + 1), query);
      if (said && (!best.has(file) || said.who === 'You')) best.set(file, said);
      return true;
    };
    let { cut, missing } = first, next = 0;
    const deadline = Date.now() + SEARCH_MS;
    while (next < files.length && best.size < LIMIT.sessions) {
      if (Date.now() >= deadline) { cut = true; break; }
      const batch = files.slice(next, next + TRANSCRIPT_BATCH);
      next += batch.length;
      const run = await this.rg([...COMMON, '--no-ignore', '--with-filename', '--null', '--max-count', String(LINES_PER_TRANSCRIPT), '-e', inFile, '--', ...batch], read);
      cut ||= run.cut;
      missing ||= run.missing;
    }

    const chosen = [...best].sort(([, a], [, b]) => b.at - a.at).slice(0, LIMIT.sessions);
    const sessionOf = (file: string) => known.get(file.slice(file.lastIndexOf('/') + 1, -'.jsonl'.length));
    const titles = await this.titles(chosen.map(([file]) => file).filter((f) => !sessionOf(f)));
    const hits: Found[] = chosen.flatMap(([file, said]) => {
      const p = owner.get(file) ?? owner.get(dirname(file));
      if (!p) return [];
      const s = sessionOf(file);
      const target: RecallTarget = s ? { type: 'session', id: s.id } : { type: 'claude', dir: p.dir };
      return [{ hit: { key: `sessions:${file}`, kind: 'sessions' as const, projectId: p.id, project: p.name, title: s?.title ?? titles.get(file) ?? 'Claude session', snippet: `${said.who}: ${snippet(said.text, query)}`, at: said.at, path: file }, target }];
    });
    return { hits, cut, missing };
  }

  /** Titles from the transcripts themselves, for the many with no session file. The last one given wins, and a name the owner chose beats a generated one. */
  private async titles(files: string[]): Promise<Map<string, string>> {
    const custom = new Map<string, string>(), generated = new Map<string, string>();
    if (!files.length) return custom;
    await this.rg([...COMMON, '--no-ignore', '--with-filename', '--null', '-e', '"type":"custom-title"', '-e', '"type":"ai-title"', '--', ...files], (l) => {
      const nul = l.indexOf('\0');
      try {
        const e = JSON.parse(l.slice(nul + 1));
        if (typeof e.customTitle === 'string' && e.customTitle) custom.set(l.slice(0, nul), e.customTitle);
        if (typeof e.aiTitle === 'string' && e.aiTitle) generated.set(l.slice(0, nul), e.aiTitle);
      } catch { /* not a title line after all */ }
      return true;
    });
    return new Map([...generated, ...custom]);
  }

  /** Runs rg, giving each line of its output to `each` until that returns false or time runs out. */
  private rg(args: string[], each: (line: string) => boolean): Promise<{ cut: boolean; missing: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(this.o.rg ?? 'rg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let cut = false, done = false;
      const finish = (missing: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ cut, missing });
      };
      const timer = setTimeout(() => { cut = true; child.kill(); }, SEARCH_MS);
      child.on('error', () => finish(true));
      child.on('close', () => finish(false));
      let open = true;
      createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (l) => {
        if (open && !each(l)) { open = false; child.kill(); }
      });
    });
  }
}

interface Found { hit: RecallHit; target: RecallTarget }
interface Search { hits: Found[]; cut: boolean; missing: boolean }
