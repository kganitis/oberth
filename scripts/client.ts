// What the oberth CLI and the MCP server share: talking to the running service, finding a project from an id or a path,
// and each operation, which returns text instead of printing it, so both can present the same answers.
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { stripAnsi } from '../service/ansi.ts';
import { LAUNCHERS } from '../service/launchers.ts';
import { config, excluded, projectId, REPO_DIR, rootLabel, rootOf, type Root } from '../service/config.ts';

/** A failure to report as it is; code 2 means the project couldn't be found or the service is down, as in the CLI. */
export class OberthError extends Error {
  code: number;
  constructor(message: string, code = 2) { super(message); this.code = code; }
}

export interface Api {
  get(path: string): Promise<any>;
  post(path: string, body: unknown): Promise<any>;
  /** a plain-text route, such as a project's log */
  text(path: string): Promise<string>;
}

export const BASE = `http://127.0.0.1:${config.port}`;
/** The launchd label install.sh gives the service (OBERTH_LABEL when it was installed under another). */
export const LABEL = process.env.OBERTH_LABEL ?? 'local.oberth';
export const readToken = (): string => { try { return readFileSync(`${config.stateDir}/token`, 'utf8').trim(); } catch { return ''; } };

export function httpApi(base = BASE, token = readToken()): Api {
  const headers = { 'X-Oberth-Token': token, 'Content-Type': 'application/json' };
  async function call(path: string, init: RequestInit): Promise<string> {
    let r: Response;
    try { r = await fetch(base + path, { ...init, headers }); } catch {
      throw new OberthError(`Oberth service isn't running on ${base}. Start it with: launchctl kickstart -k gui/$UID/${LABEL}`);
    }
    const text = await r.text();
    if (!r.ok) throw new OberthError(`${path}: ${(() => { try { return JSON.parse(text).error; } catch { return text || `HTTP ${r.status}`; } })()}`);
    return text;
  }
  const parse = (t: string) => (t ? JSON.parse(t) : undefined);
  return {
    get: async (path) => parse(await call(path, {})),
    post: async (path, body) => parse(await call(path, { method: 'POST', body: JSON.stringify(body) })),
    text: (path) => call(path, {}),
  };
}

export interface Ctx {
  api: Api;
  /** the folder a missing project argument stands for */
  cwd: string;
  /** the assistant session asking, recorded on asks so the owner's button opens it */
  sessionId?: string;
  /** the roots and the folders left out, as in config.json; tests pass their own */
  roots?: Root[];
  exclude?: string[];
  /** Oberth's own folder (this repository) */
  selfDir?: string;
  sleep?: (ms: number) => Promise<void>;
  /** where an idea or a note came from, as Ideas shows it */
  source?: 'cli' | 'mcp';
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** id or path → the discovered project, or an explanation of why there is none. */
export async function resolveProject(ctx: Ctx, arg: string | undefined): Promise<any> {
  const list: any[] = await ctx.api.get('/api/projects');
  if (arg && !/[/~.]/.test(arg[0]) && list.some((p) => p.id === arg)) return list.find((p) => p.id === arg);
  const roots = ctx.roots ?? config.roots;
  const where = roots.map(rootLabel).join(' or ');
  const abs = resolve(ctx.cwd, (arg ?? ctx.cwd).replace(/^~(?=\/|$)/, homedir()));
  let real: string;
  try { real = realpathSync(abs); } catch {
    throw new OberthError(arg && !/[/~.]/.test(arg[0]) ? `No project with the id "${arg}", and no folder by that name either.` : `No such folder: ${abs}`);
  }
  const found = rootOf(roots, real);
  if (!found) throw new OberthError(`${abs} is not inside ${where}, so Oberth doesn't look at it. Name a project (an id from the project list, or its folder).`);
  const { root, rel } = found;
  if (rel === '') throw new OberthError(`${abs} is ${rootLabel(root)} itself, which is no project: name one (an id from the project list, or its folder).`);
  const parts = rel.split('/');
  const exclude = ctx.exclude ?? config.exclude;
  for (const r of [parts[0], parts.slice(0, 2).join('/')]) {
    if (excluded(exclude, root, r, resolve(root.path, r))) throw new OberthError(`${rootLabel(root)}/${r} is left out of Oberth on purpose.`);
  }
  for (const r of [parts.slice(0, 2).join('/'), parts[0]]) {
    const p = list.find((x) => x.id === projectId(roots, root, r));
    if (p) return p;
  }
  throw new OberthError([
    `Oberth has no project at ${rootLabel(root)}/${parts.slice(0, 2).join('/')}.`,
    // the launchers say what they look for, so a launcher added in service/launchers.ts shows here too
    `It looks two levels deep for: ${LAUNCHERS.filter((l) => l.type !== 'override').map((l) => l.looksFor).join(', ')}, or a git repo, package.json or pyproject.toml (a library).`,
    `For anything else, add a .oberth.json in the project root (see ${rootLabel({ path: REPO_DIR, label: '' })}/docs/integrating-projects.md).`,
  ].join('\n'));
}

/** The pre-flight findings (what would make a launch fail), as lines under a heading; [] when there are none. */
export const preflightLines = (p: any): string[] =>
  p.preflight?.length ? ['Before launching:', ...p.preflight.map((f: any) => `- ${f.text}`)] : [];

// ---------- Ideas ----------

const IDEA_ID = /^i[0-9a-z]{3}$/;
export const isIdeaId = (s: string | undefined): boolean => !!s && IDEA_ID.test(s);

/** What an idea is for: a project (an id or a path, or "here" for this folder), or Oberth itself, which isn't a listed project. */
async function ideaTarget(ctx: Ctx, arg: string): Promise<{ id: string; name: string }> {
  if (arg === 'oberth') return { id: 'oberth', name: 'Oberth' };
  const where = arg === 'here' ? undefined : arg;
  try {
    const abs = realpathSync(resolve(ctx.cwd, (where ?? ctx.cwd).replace(/^~(?=\/|$)/, homedir())));
    const self = realpathSync(ctx.selfDir ?? REPO_DIR);
    if (abs === self || abs.startsWith(self + '/')) return { id: 'oberth', name: 'Oberth' };
  } catch { /* not a folder: resolveProject says why */ }
  return resolveProject(ctx, where);
}

const ago = (ms: number): string => {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};
const ideaLine = (i: any, withProject: boolean) =>
  `${i.id}  ${withProject ? `${i.projectName ?? i.projectId}: ` : ''}${i.title}  (${i.notes.length ? `${i.notes.length} note${i.notes.length === 1 ? '' : 's'}, ` : ''}${ago(i.updatedAt)})`;

/** A new idea, for a new project (no project) or for one that exists. */
export async function idea(ctx: Ctx, title: string, opts: { note?: string; project?: string } = {}): Promise<string> {
  const t = opts.project ? await ideaTarget(ctx, opts.project) : undefined;
  const i = await ctx.api.post('/api/ideas', { title, note: opts.note, projectId: t?.id, source: ctx.source ?? 'cli', sessionId: ctx.sessionId });
  const again = i.createdAt !== i.updatedAt;
  return `${again ? 'Already in Ideas, note added' : 'Added to Ideas'}${t ? ` for ${t.name}` : ' as a new project'}: ${i.title} (${i.id})`;
}
export async function ideaNote(ctx: Ctx, id: string, text: string): Promise<string> {
  const i = await ctx.api.post(`/api/ideas/${enc(id)}/notes`, { text, source: ctx.source ?? 'cli', sessionId: ctx.sessionId });
  return `Note added to ${i.title} (${i.id}); it has ${i.notes.length} now.`;
}
export async function ideas(ctx: Ctx, project?: string): Promise<string> {
  const t = project ? await ideaTarget(ctx, project) : undefined;
  const v = await ctx.api.get(`/api/ideas${t ? `?project=${enc(t.id)}` : ''}`);
  const out: string[] = [];
  if (!t && v.newProjects.length) out.push('New projects:', ...v.newProjects.map((i: any) => `  ${ideaLine(i, false)}`));
  if (v.forProjects.length) out.push(...(out.length ? [''] : []), t ? `Ideas for ${t.name}:` : 'For existing projects:', ...v.forProjects.map((i: any) => `  ${ideaLine(i, !t)}`));
  if (!t && v.started.length) out.push('', 'Started (projects with status idea):', ...v.started.map((p: any) => `  ${p.id}${p.fromIdea ? `  from "${p.fromIdea}"` : ''}`));
  return out.length ? out.join('\n') : t ? `No open ideas for ${t.name}.` : 'No ideas yet.';
}

/** Where a running project answers: its stable address with the real port in brackets, or just the port URL. */
export const whereAt = (p: any, url?: string): string => (url ? (p.address ? `${p.address} (${url})` : url) : p.address ?? '');

export const missingAbout = (a: any): string[] => ['description', 'status'].filter((k) => !a?.[k]);
const formatAsks = (asks: any[]) => asks.map((a) => `${a.id}  ${a.text}${a.detail ? `\n          ${a.detail}` : ''}`).join('\n');

export async function list(ctx: Ctx): Promise<string> {
  const all: any[] = await ctx.api.get('/api/projects');
  return all.map((p) => [p.id.padEnd(30), p.kind.padEnd(8), p.status.padEnd(9), (p.about?.status ?? '-').padEnd(9), p.hidden ? 'hidden' : ''].join(' ').trimEnd()).join('\n');
}

export async function show(ctx: Ctx, arg?: string): Promise<string> {
  const p = await resolveProject(ctx, arg);
  const [info, about, asks] = await Promise.all([
    ctx.api.get(`/api/projects/${enc(p.id)}/info`), ctx.api.get(`/api/projects/${enc(p.id)}/about`), ctx.api.get(`/api/projects/${enc(p.id)}/asks`),
  ]);
  const a = about.about ?? {};
  const f = about.facts ?? {};
  const rows: [string, unknown][] = [
    ['id', p.id], ['name', p.name], ['folder', info.folder], ['kind', p.kind], ['starts with', p.kind === 'library' ? '(nothing: no dev server)' : info.command],
    ['status', p.status + (p.url ? ` · ${whereAt(p, p.url)}` : '')], ['address', p.address], ['live site', info.liveUrl], ['stack', (f.stack ?? []).join(', ')], ['ships to', f.deploy],
    ['hidden', p.hidden || undefined], ['pinned', p.pinned || undefined],
    ['description', a.description], ['about status', a.status], ['released', a.released ? a.releasedWhere ?? 'yes' : undefined], ['notes', a.notes],
  ];
  const o = about.outside;
  if (o) rows.push(['outside', [
    o.stars !== undefined && `${o.stars} stars, ${o.forks} forks${o.openFromOthers ? `, ${o.openFromOthers} open issues/PRs from others (${o.waiting} waiting)` : ''}`,
    o.downloads && `PyPI ${o.downloads.week}/week, ${o.downloads.month}/month${o.pypi ? ` (${o.pypi})` : ''}`,
    o.site && (o.site.downSince ? `site DOWN since ${new Date(o.site.downSince).toLocaleString()}` : o.site.ok ? 'site up' : 'site: one failed check'),
  ].filter(Boolean).join('; ')]);
  const out = rows.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k.padEnd(13)} ${v}`);
  const pre = preflightLines(p);
  if (pre.length) out.push('', ...pre);
  if (asks.length) out.push('', 'Open asks:', formatAsks(asks));
  const miss = missingAbout(a);
  if (miss.length) out.push('', `About is missing: ${miss.join(', ')}. Set them with: oberth about ${p.id} --description … --status …`);
  return out.join('\n');
}

export interface AboutChange { description?: string; notes?: string; status?: string; released?: string | false }

/** Changes only the fields given; status "none" clears it, released false takes the mark away. */
export async function setAbout(ctx: Ctx, arg: string | undefined, change: AboutChange): Promise<string> {
  const p = await resolveProject(ctx, arg);
  const cur = (await ctx.api.get(`/api/projects/${enc(p.id)}/about`)).about ?? {};
  const { updatedAt, ...next } = cur;
  if (change.description !== undefined) next.description = change.description;
  if (change.notes !== undefined) next.notes = change.notes;
  if (change.status !== undefined) next.status = change.status === 'none' ? undefined : change.status;
  if (typeof change.released === 'string') { next.released = true; next.releasedWhere = change.released || undefined; }
  if (change.released === false) { next.released = undefined; next.releasedWhere = undefined; }
  await ctx.api.post(`/api/projects/${enc(p.id)}/about`, next);
  return `Saved the About of ${p.name}.\n\n${await show(ctx, p.id)}`;
}

/** Leaves something for the owner that outlives this session; the session asking is recorded, so the Agenda can open it. */
export async function ask(ctx: Ctx, text: string, detail?: string, project?: string): Promise<string> {
  const p = await resolveProject(ctx, project);
  const a = await ctx.api.post(`/api/projects/${enc(p.id)}/asks`, { text, detail, sessionId: ctx.sessionId });
  return `Asked on ${p.name}: ${a.text} (${a.id})`;
}

export async function asks(ctx: Ctx, arg?: string): Promise<string> {
  const p = await resolveProject(ctx, arg);
  const open: any[] = await ctx.api.get(`/api/projects/${enc(p.id)}/asks`);
  return open.length ? formatAsks(open) : `${p.name} has no open asks.`;
}

export async function done(ctx: Ctx, id: string): Promise<string> {
  await ctx.api.post(`/api/agenda/asks/${enc(id)}/done`, {});
  return `Closed ${id}.`;
}

export async function agenda(ctx: Ctx): Promise<string> {
  const a = await ctx.api.get('/api/agenda');
  const out: string[] = [];
  const section = (title: string, items: any[]) => {
    if (!items.length) return;
    out.push(`${title} (${items.length})`);
    for (const it of items) out.push(`  ${it.where}: ${it.title}${it.detail ? `\n      ${it.detail}` : ''}`);
  };
  section('Needs you', a.needs);
  section('Worth a look', a.look);
  if (a.health.sessions && !a.health.sessions.ok) out.push("Can't read the assistant's sessions, so this list may be missing items.");
  if (a.health.backup && !a.health.backup.ok) out.push("Can't read the backup log.");
  if (!a.needs.length && !a.look.length) out.push('Nothing is waiting for you.');
  return out.join('\n');
}

/** Code, docs, About notes and what was said in Claude sessions, across every project. */
export async function search(ctx: Ctx, query: string, opts: { project?: string; kind?: string } = {}): Promise<string> {
  const q = new URLSearchParams({ q: query });
  if (opts.project) q.set('project', (await resolveProject(ctx, opts.project)).id);
  if (opts.kind) q.set('kind', opts.kind);
  const r = await ctx.api.get(`/api/recall?${q}`);
  const out: string[] = [];
  if (r.error) out.push(r.error);
  for (const h of r.hits) {
    const when = h.at ? ` ${day(h.at)}` : '';
    out.push(`${h.kind}  ${h.project}: ${h.title}${when}\n    ${h.snippet}${h.kind === 'sessions' ? `\n    ${h.path}` : ''}`);
  }
  if (r.cut) out.push('Ran out of time, so there may be more.');
  if (!r.hits.length && !r.error) out.push('Nothing found.');
  return out.join('\n');
}

/** "Where was I?": the last prompt, what is left lying around, recent sessions and commits. */
export async function recap(ctx: Ctx, arg?: string): Promise<string> {
  const p = await resolveProject(ctx, arg);
  const r = await ctx.api.get(`/api/projects/${enc(p.id)}/recap`);
  const out = [`${p.name}${r.lastWorkAt ? `, last worked on ${day(r.lastWorkAt)}` : ', no recorded work'}${p.about?.status ? ` (${p.about.status})` : ''}`];
  if (p.about?.notes) out.push('', `Notes: ${p.about.notes}`);
  if (r.prompt) out.push('', `Last prompt (${day(r.prompt.at)}): ${r.prompt.text}`);
  if (r.left) {
    const bits = [r.left.changed && `${r.left.changed} uncommitted file${r.left.changed === 1 ? '' : 's'}`, r.left.ahead && `${r.left.ahead} unpushed commit${r.left.ahead === 1 ? '' : 's'}`, r.left.stashes && `${r.left.stashes} stash${r.left.stashes === 1 ? '' : 'es'}`].filter(Boolean);
    out.push('', `On ${r.left.branch}: ${bits.length ? bits.join(', ') : 'nothing left uncommitted, unpushed or stashed'}`);
  }
  if (r.sessions.length) out.push('', 'Recent sessions:', ...r.sessions.map((s: any) => `  ${day(s.at)}  ${s.title} (${s.turns} prompt${s.turns === 1 ? '' : 's'}, ${Math.round(s.ms / 60000)} min)`));
  if (r.commits.length) out.push('', 'Recent commits:', ...r.commits.map((c: any) => `  ${day(c.time)}  ${c.hash.slice(0, 7)} ${c.subject}`));
  return out.join('\n');
}

const settledNow = (p: any) => p.status === 'running' || p.status === 'failed' || p.foreign.length > 0;

/** Polls until the launch is running or failed, up to 3 minutes (an npm install included). */
async function waitSettled(ctx: Ctx, id: string, start: any): Promise<any> {
  let now = start;
  for (let waited = 0; waited < 180_000; waited += 1000) {
    now = (await ctx.api.get('/api/projects')).find((x: any) => x.id === id) ?? now;
    if (settledNow(now)) break;
    await (ctx.sleep ?? sleepMs)(1000);
  }
  return now;
}

async function logTail(ctx: Ctx, id: string, lines: number): Promise<string> {
  return stripAnsi(await ctx.api.text(`/api/projects/${enc(id)}/log`)).trimEnd().split('\n').slice(-lines).join('\n');
}

const holderOf = (c: any): string => c.holder.name ?? c.holder.command ?? 'another process';

/** Why a launch failed, with the end of its log. */
async function failureReport(ctx: Ctx, now: any): Promise<string[]> {
  const out = [`It failed to start: ${now.error ?? 'see the log'}`];
  if (now.conflict) out.push(`Port ${now.conflict.port} is held by ${holderOf(now.conflict)}.`);
  const tail = await logTail(ctx, now.id, 25);
  if (tail) out.push('', 'Last lines of its log:', tail);
  return out;
}

/** Is it discovered as the right thing, does it start, does it serve a page? Launches without opening the browser and stops it again. */
export async function check(ctx: Ctx, arg: string | undefined, say: (line: string) => void): Promise<{ ok: boolean }> {
  const p = await resolveProject(ctx, arg);
  const id = enc(p.id);
  const info = await ctx.api.get(`/api/projects/${id}/info`);
  const problems: string[] = [];
  say(`${p.name} (${p.id}): ${p.kind}, ${p.kind === 'library' ? 'no dev server' : `starts with: ${info.command}`}`);
  if (p.kind !== 'library') {
    const wasRunning = !['stopped', 'failed'].includes(p.status) || p.foreign.length > 0;
    if (wasRunning) say(`Already running${p.url ? ` at ${p.url}` : ''}; checking it as it is.`);
    else if (p.preflight?.length) say(preflightLines(p).join('\n'));
    if (!wasRunning) await ctx.api.post(`/api/projects/${id}/launch`, { mode: 'local', open: false });
    const now = await waitSettled(ctx, p.id, p);
    const url = now.url ?? now.foreignUrl;
    if (now.status === 'failed') {
      problems.push(`it failed to start: ${now.error ?? 'see the log'}`);
      if (now.conflict) problems.push(`port ${now.conflict.port} is held by ${holderOf(now.conflict)}`);
      const tail = await logTail(ctx, now.id, 25);
      if (tail) say(`\nLast lines of its log:\n${tail}\n`);
    } else if (now.status !== 'running' && !now.foreign.length) {
      problems.push(`still "${now.status}" after 3 minutes: Oberth never saw a page URL or a listening port`);
    } else if (p.kind === 'window') {
      say('Running as a window app (no page expected).');
    } else if (!url) {
      problems.push('running, but no page URL was found: print the local URL, or set "url" in .oberth.json');
    } else {
      const page = await fetch(url).then((r) => r.status, () => 0);
      if (page >= 200 && page < 400) say(`Serves ${url} (HTTP ${page}).`);
      else problems.push(`${url} answered ${page || 'nothing'}`);
    }
    if (!wasRunning) { await ctx.api.post(`/api/projects/${id}/stop`, {}); say('Stopped it again.'); }
  }
  const miss = missingAbout(p.about);
  if (miss.length) problems.push(`About is missing: ${miss.join(', ')}`);
  if (problems.length) { say(`\nProblems:\n- ${problems.join('\n- ')}`); return { ok: false }; }
  say('Integrated correctly.');
  return { ok: true };
}

/** Starts the dev server (no browser unless asked) and waits until it serves, or says why it didn't. */
export async function launch(ctx: Ctx, arg: string | undefined, opts: { open?: boolean } = {}): Promise<string> {
  const p = await resolveProject(ctx, arg);
  if (p.kind === 'library') throw new OberthError(`${p.name} has no dev server, so there is nothing to launch.`, 1);
  if (p.foreign.length) return `${p.name} is already running, started outside Oberth${p.foreignUrl ? `, at ${whereAt(p, p.foreignUrl)}` : ''}.`;
  if (p.status === 'running') return `${p.name} is already running${p.url ? ` at ${whereAt(p, p.url)}` : ''}.`;
  // said first either way: they are the likely reason a launch fails, and still worth knowing when it doesn't
  const pre = preflightLines(p);
  const first = pre.length ? `${pre.join('\n')}\n\n` : '';
  await ctx.api.post(`/api/projects/${enc(p.id)}/launch`, { mode: 'local', open: opts.open === true });
  const now = await waitSettled(ctx, p.id, p);
  if (now.status === 'failed') throw new OberthError(`${first}${p.name}: ${(await failureReport(ctx, now)).join('\n')}`, 1);
  if (now.foreign.length) return `${first}${p.name} is running, started outside Oberth${now.foreignUrl ? `, at ${whereAt(now, now.foreignUrl)}` : ''}.`;
  if (now.status !== 'running') throw new OberthError(`${first}${p.name} is still "${now.status}" after 3 minutes. Read its output for why.`, 1);
  return first + (p.kind === 'window' ? `${p.name} is running as a window app.` : `${p.name} is running${now.url ? ` at ${whereAt(now, now.url)}` : ''}.`);
}

export async function stop(ctx: Ctx, arg?: string): Promise<string> {
  const p = await resolveProject(ctx, arg);
  if (p.foreign.length) return `${p.name} is running outside Oberth${p.foreignUrl ? ` at ${p.foreignUrl}` : ''}, so Oberth leaves it alone. The owner can stop it from the dashboard.`;
  if (p.status === 'stopped' || p.status === 'failed') return `${p.name} wasn't running.`;
  await ctx.api.post(`/api/projects/${enc(p.id)}/stop`, {});
  return `Stopped ${p.name}.`;
}

/** The dev server's latest output, without colour codes, after the error groups Oberth counted in it. */
export async function output(ctx: Ctx, arg: string | undefined, lines = 60): Promise<string> {
  const p = await resolveProject(ctx, arg);
  if (p.kind === 'library') throw new OberthError(`${p.name} has no dev server, so there is no output.`, 1);
  const n = Math.min(Math.max(Math.round(lines) || 60, 1), 400);
  const [tail, errs] = await Promise.all([logTail(ctx, p.id, n), ctx.api.get(`/api/projects/${enc(p.id)}/errors`)]);
  const out = [`${p.name} is ${p.status}${p.url ? ` at ${p.url}` : ''}${p.error ? `: ${p.error}` : ''}.`];
  if (errs.count) {
    out.push('', `${errs.count} error${errs.count === 1 ? '' : 's'} since launch; the latest:`);
    for (const g of errs.groups.slice(-3)) out.push(g.lines.slice(0, 12).join('\n'), '');
  }
  out.push('', tail ? `Last ${n} lines of its output:\n${tail}` : 'Its output is empty (it starts over on each launch).');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
