import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { guard, hostOk } from './auth.ts';
import { buildPlan, phoneAvailable } from './commands.ts';
import { launcherOf } from './launchers.ts';
import { cleanAbout, loadAbout, saveAbout, STATUSES, LIMITS as ABOUT_LIMITS, type ProjectStatus } from './about.ts';
import { addIdea, addNote, briefOf, cleanIdea, cleanNote, deleteIdea, dropIdea, editIdea, FOLDER, LIMITS as IDEA_LIMITS, linksOf, loadIdeas, markStarted, restoreIdea, sessionOf, slugOf, viewIdeas, type Idea } from './ideas.ts';
import { addAsk, cleanAsk, closeAsk, openAsks, putOffLater, type Agenda, type AgendaProject } from './agenda.ts';
import type { ActivityLog } from './activity.ts';
import { buildWeek, lastWeekStart, parseDay } from './week.ts';
import { buildReview, markReviewSeen, type Review } from './review.ts';
import { BACKUP_LOG } from './backupstatus.ts';
import { deployOf, depsOf, historyOf, pypiVersion, pyprojectName, stackOf, visibilityOf } from './facts.ts';
import { assistantView, type Assistant, type AssistantState } from './assistant.ts';
import { findHolder, portInUse, type Conflict } from './conflicts.ts';
import type { Effects } from './effects.ts';
import { gitDetail, gitFacts, gitInfo } from './gitinfo.ts';
import { buildRecap, resumeBrief } from './recap.ts';
import { readIcon, resolveIcon } from './icons.ts';
import { liveUrl, repoUrl } from './live.ts';
import { linksOf as projectLinks } from './links.ts';
import type { LiveChecker } from './livecheck.ts';
import { foreignUrl, keepWebListeners, matchForeign } from './ports.ts';
import { addressOf, hostTable, PROXY_PORT, type Target } from './proxy.ts';
import { preflight, readFacts, type Finding } from './preflight.ts';
import { groupRss } from './procinfo.ts';
import { qrSvg } from './qr.ts';
import { RECALL_KINDS, type Recall, type RecallKind } from './recall.ts';
import { lastChange, recency, recencyOf } from './recent.ts';
import type { Runner } from './runner.ts';
import { scriptNames, type ScriptRunner } from './scripts.ts';
import { loadSettings, saveSettings } from './settings.ts';
import { pmOf, type Defaults, type Listener, type Mode, type Project } from './types.ts';
import { excluded, projectId, rootLabel, type Root } from './config.ts';

export interface AppDeps {
  projects: () => Project[];
  runner: Runner;
  scripts: ScriptRunner;
  effects: Effects;
  token: string;
  stateDir: string;
  /** where per-project icons (<id>.svg) are looked for, in order */
  iconsDir: string | string[];
  dashboardDir: string;
  defaults: Defaults;
  listeners: () => Promise<Listener[]>;
  pathEnv: string;
  freePort: () => Promise<number>;
  /** filters leftover listeners down to ones serving pages; tests pass identity */
  keepWeb?: (m: Map<string, Listener[]>) => Promise<Map<string, Listener[]>>;
  /** resident memory of a process group in bytes; tests pass a fake */
  groupRss?: (pgid: number) => Promise<number | undefined>;
  /** the AI assistant (assistant.ts): its session states, last prompts and what it can open; absent or id "none" means none */
  assistant?: Assistant;
  /** today's events for the activity strip; absent in tests that don't care */
  activity?: ActivityLog;
  /** live site checks, only run when the dashboard asks (?live=1) */
  live?: LiveChecker;
  /** what is waiting for the owner; absent in tests that don't care */
  agenda?: Agenda;
  /** search across projects; absent in tests that don't care */
  recall?: Recall;
  /** the backup log an Agenda item reveals */
  backupLog?: string;
  /** the Node version launches run with, for the pre-flight check; absent means it isn't checked */
  node?: string;
  /** the roots projects are found in (a started idea's new folder goes into one), and the folders left out */
  roots?: Root[];
  exclude?: string[];
  /** the port this service listens on (7777) */
  port?: number;
  /** what the pages and the menu bar need to know about the setup, from config.json */
  ui?: { editor: { id: string; label: string }; browser: string; modules: Record<string, boolean>; problems?: string[] };
  /** Oberth itself, which isn't one of its projects but can have ideas filed against it */
  self?: { id: string; name: string; dir: string };
  /** whether the stable-address proxy (proxy.ts) is listening, and on which port; absent means it isn't */
  proxyUp?: () => boolean;
  proxyPort?: number;
  /** released work seen from outside (outside.ts): facts for the About tab, and which stored links may open */
  outside?: { facts(id: string): unknown; openable(url: string): boolean };
}

/** The last bytes of a file (a failed server's log), '' when missing. */
function tail(file: string, bytes = 16_384): string {
  try {
    const size = statSync(file).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    const fd = openSync(file, 'r');
    try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
    return buf.toString('utf8');
  } catch { return ''; }
}

const STATIC: Record<string, string> = { '/app.js': 'text/javascript', '/ideas.js': 'text/javascript', '/logbook.js': 'text/javascript', '/style.css': 'text/css', '/logo.svg': 'image/svg+xml', '/emblem.svg': 'image/svg+xml' };
const portOf = (url?: string): number | undefined => (url ? Number(new URL(url).port) || undefined : undefined);

/** Log bytes sent when the dashboard opens a log without an offset. */
const LOG_TAIL = 200_000;

const starterText = (p: Project): string => (p.starter.type === 'none' ? 'none (no dev server)' : launcherOf(p)?.describe(p) ?? p.starter.type);
const realDir = (dir: string): string => { try { return realpathSync(dir); } catch { return dir; } };
const tilde = (dir: string): string => (dir.startsWith(homedir() + '/') ? `~${dir.slice(homedir().length)}` : dir);

/** For a double-quoted HTML attribute. */
const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'application/json'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res: ServerResponse, value: unknown, status = 200) => send(res, status, JSON.stringify(value));

async function readBody(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) throw new HttpError(413, 'body too large'); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'bad json'); }
}

export function createApp(deps: AppDeps) {
  const { runner, effects, scripts } = deps;
  const pendingOpen = new Set<string>();
  const port = deps.port ?? 7777;
  const assistant = deps.assistant?.id === 'none' ? undefined : deps.assistant;
  const roots = deps.roots ?? [];
  const noAssistant = () => new HttpError(404, 'no assistant is set up (config.json "assistant")');
  /** Whether a module is on (config.json "modules"); everything is on when the setup doesn't say. */
  const on = (m: string): boolean => deps.ui?.modules[m] !== false;
  const offError = (m: string) => new HttpError(404, `the ${m} module is turned off (config.json "modules")`);

  const find = (id: string): Project => {
    const p = deps.projects().find((p) => p.id === id);
    if (!p) throw new HttpError(404, 'unknown project');
    return p;
  };
  const keepWeb = deps.keepWeb ?? keepWebListeners;
  const foreignMap = async (projects: Project[], listeners?: Listener[]) => keepWeb(matchForeign(listeners ?? await deps.listeners(), projects, runner.managedPgids()));

  /** The setup as the pages and the menu bar see it (GET /api/config, and a meta tag in each page). */
  const setup = () => ({
    port, proxyPort: deps.proxyPort ?? PROXY_PORT,
    assistant: assistant ? assistantView(assistant) : null,
    editor: deps.ui?.editor ?? { id: 'vscode', label: 'VS Code' },
    browser: deps.ui?.browser ?? 'Safari',
    modules: deps.ui?.modules ?? {},
    roots: roots.map((r) => ({ label: r.label, path: rootLabel(r) })),
    ...(deps.ui?.problems?.length ? { problems: deps.ui.problems } : {}),
  });

  // ---------- stable addresses (proxy.ts, docs/architecture.md, "Stable addresses") ----------

  const proxyOn = () => deps.proxyUp?.() ?? false;
  const proxyTable = () => hostTable(deps.projects());
  /** A project's stable address, while the proxy is up; window apps and libraries serve no page, so they have none. */
  const addressFor = (p: Project, table = proxyTable()): string | undefined =>
    proxyOn() && p.kind !== 'window' && p.starter.type !== 'none' ? addressOf(table, p.id, deps.proxyPort ?? PROXY_PORT) : undefined;
  // leftover servers, from the last listing or looked up again when that is older than 5 s (lsof is slow)
  let foreignCache: { at: number; map: Promise<Map<string, Listener[]>> } | undefined;
  const foreignNow = () => {
    if (!foreignCache || Date.now() - foreignCache.at > 5000) foreignCache = { at: Date.now(), map: foreignMap(deps.projects()) };
    return foreignCache.map;
  };
  const targetAt = (url: string): Target => { const u = new URL(url); return { host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || 80 }; };
  /** Where the proxy sends a project's requests: the run Oberth launched, else the project's leftover server. */
  async function proxyTarget(id: string): Promise<Target | undefined> {
    const st = runner.state(id);
    if (st.status === 'running' && st.url) return targetAt(st.url);
    const fl = (await foreignNow()).get(id) ?? [];
    const url = fl.length ? await foreignUrl(fl) : undefined;
    return url ? targetAt(url) : undefined;
  }
  /** The page to open in the browser: the stable address when there is one, unless the project's logins are pinned to its own port. */
  const pageFor = (p: Project, url: string) => (deps.defaults[p.id]?.openPort ? url : addressFor(p) ?? url);

  /** For a failed launch: the port its output said was taken, and who holds it now. */
  function conflictFor(p: Project, listeners: Listener[], projects: Project[]): Conflict | undefined {
    if (runner.state(p.id).status !== 'failed') return undefined;
    const port = portInUse(tail(runner.logPath(p.id)));
    const c = port ? findHolder(port, listeners, projects, runner.managedByPgid()) : undefined;
    if (c?.holder.kind === 'other' && c.holder.cwd) c.holder.cwd = tilde(c.holder.cwd);
    return c;
  }

  /** What would make a launch fail (preflight.ts). Only for a project that is stopped or failed: a running one has passed. */
  function preflightFor(p: Project, listeners: Listener[], projects: Project[], foreign: Listener[] = []): Finding[] {
    const st = runner.state(p.id).status;
    if ((st !== 'stopped' && st !== 'failed') || foreign.length) return [];
    try {
      return preflight(p, readFacts(p, { pathEnv: deps.pathEnv, node: deps.node, listeners, projects, managed: runner.managedByPgid() }));
    } catch { return []; } // a check must never break the listing
  }

  async function views(withLive = false) {
    const projects = deps.projects();
    const settings = loadSettings(deps.stateDir);
    const listeners = await deps.listeners();
    const foreign = await foreignMap(projects, listeners);
    foreignCache = { at: Date.now(), map: Promise.resolve(foreign) };
    const table = proxyTable();
    const sessions = (await deps.assistant?.states?.(projects.map((p) => p.dir)).catch(() => undefined)) ?? new Map<string, AssistantState>();
    const about = loadAbout(deps.stateDir);
    const list = await Promise.all(projects.map(async (p) => {
      const st = runner.state(p.id);
      const fl = foreign.get(p.id) ?? [];
      const launched = settings.lastLaunched[p.id];
      const [git, live, repo, updated, history, fUrl] = await Promise.all([gitInfo(p.dir), liveUrl(p, deps.defaults), repoUrl(p.dir), lastChange(p), historyOf(p.dir), fl.length ? foreignUrl(fl) : undefined]);
      return {
        id: p.id, name: p.name, kind: p.kind, status: st.status, mode: st.mode, url: st.url, port: portOf(st.url),
        startedAt: st.startedAt, error: st.error, lanNote: st.lanNote, phone: phoneAvailable(p), liveUrl: live, repoUrl: repo, git,
        recency: recencyOf(launched, updated), updated, lastLaunched: launched, started: history.startedAt,
        hidden: settings.hidden.includes(p.id), pinned: settings.pinned.includes(p.id), needsInstall: p.needsInstall, packageManager: pmOf(p),
        foreign: fl.map((l) => ({ pid: l.pid, port: l.port })), foreignUrl: fUrl,
        errors: runner.errors(p.id)?.count ?? 0, checks: scriptNames(p).pinned, assistant: sessions.get(p.dir),
        conflict: conflictFor(p, listeners, projects),
        preflight: preflightFor(p, listeners, projects, fl),
        address: addressFor(p, table), openPort: deps.defaults[p.id]?.openPort,
        about: about[p.id] ?? {}, stack: stackOf(p, depsOf(p.dir)),
        liveStatus: live && withLive ? (deps.live?.refresh(live), deps.live?.get(live)) : undefined,
        // last result per script, without output: enough for badges and the menu's notifications
        scripts: Object.fromEntries(Object.entries(scripts.resultsFor(p.id)).map(([n, r]) => [n, { status: r.status, startedAt: r.startedAt, endedAt: r.endedAt }])),
      };
    }));
    const running = (v: (typeof list)[number]) => (v.status === 'stopped' || v.status === 'failed' ? 0 : 1);
    return list.sort((a, b) => running(b) - running(a) || b.recency - a.recency);
  }

  /** open: false launches without opening the browser (oberth check, from agent sessions in other projects). */
  async function launch(p: Project, mode: Mode, open = true) {
    if (runner.state(p.id).status === 'stopping') return runner.state(p.id); // ignore clicks while it shuts down
    const projects = deps.projects();
    const listeners = await deps.listeners();
    const foreign = (await foreignMap(projects, listeners)).get(p.id) ?? [];
    if (foreign.length) {
      if (mode === 'lan') throw new HttpError(409, 'a server not started by Oberth is running; stop it first');
      if (p.kind === 'window') return { id: p.id, status: 'running', foreign: true }; // its window is already open; no page
      const url = (await foreignUrl(foreign))!;
      if (open) effects.openUrl(pageFor(p, url));
      return { id: p.id, status: 'running', url, foreign: true };
    }
    const st = runner.state(p.id);
    const active = st.status === 'installing' || st.status === 'starting' || st.status === 'running';
    if (active && st.mode === mode) {
      if (open && st.status === 'running' && st.url && mode === 'local' && p.kind !== 'window') effects.openUrl(pageFor(p, st.url));
      return st;
    }
    const lanIp = effects.lanIp();
    if (mode === 'lan' && !lanIp) throw new HttpError(409, 'no network address (Wi-Fi off?)');
    // dependencies out of date get the same install first as missing ones
    const stale = preflightFor(p, listeners, projects).some((f) => f.check === 'deps');
    const plan = buildPlan(stale ? { ...p, needsInstall: true } : p, mode, { port: await deps.freePort(), lanIp: lanIp ?? '127.0.0.1', pathEnv: deps.pathEnv, address: mode === 'local' ? addressFor(p) : undefined });
    if (!plan) throw new HttpError(400, p.starter.type === 'none' ? 'nothing to launch: this project has no dev server' : 'phone mode is not available for this project');
    if (active) await runner.stop(p.id);
    const s = loadSettings(deps.stateDir);
    s.lastLaunched[p.id] = Date.now();
    saveSettings(deps.stateDir, s);
    if (open && mode === 'local' && !plan.window) pendingOpen.add(p.id); else pendingOpen.delete(p.id);
    deps.activity?.add({ id: p.id, kind: 'launch', text: mode === 'lan' ? 'launched for phone' : 'launched' });
    return runner.start(p.id, plan, mode);
  }

  /** Stops whatever holds the port a failed launch needed (only a launched project or a leftover inside a project), then launches again in the mode that failed. */
  async function freePortAndRetry(p: Project) {
    const mode = runner.state(p.id).mode;
    const projects = deps.projects();
    const c = conflictFor(p, await deps.listeners(), projects);
    if (!c) throw new HttpError(409, 'no port conflict found (it may have cleared: try Retry)');
    const h = c.holder;
    if (h.kind === 'other') {
      const where = h.cwd ? `, running in ${h.cwd}` : '';
      throw new HttpError(409, `port ${c.port} is held by ${h.command ?? 'a process'} (pid ${h.pid}${where}), which isn't one of Oberth's projects; Oberth won't stop it`);
    }
    // A leftover is stopped as a whole: every listener it has in its project's folder (a dev server often holds
    // an HMR or API port too). One that survived would make launch() open it, or refuse phone mode.
    const pids = h.kind === 'leftover'
      ? [...new Set([h.pid, ...((matchForeign(await deps.listeners(), projects, runner.managedPgids()).get(h.projectId) ?? []).map((l) => l.pid))])]
      : [];
    if (h.kind === 'launched') await runner.stop(h.projectId);
    for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    // wait for the port and the leftover's other ports to be released before retrying, at most 6 s
    const busy = (ls: Listener[]) => ls.some((l) => l.port === c.port || pids.includes(l.pid));
    for (let i = 0; i < 30 && busy(await deps.listeners()); i++) await new Promise((r) => setTimeout(r, 200));
    return launch(p, mode);
  }

  async function info(p: Project) {
    const st = runner.state(p.id);
    const active = st.status !== 'stopped' && st.status !== 'failed';
    const node = /\/node\/(v[\d.]+)\//.exec(deps.pathEnv)?.[1];
    return {
      id: p.id, folder: tilde(p.dir), command: active && st.command ? st.command : starterText(p),
      url: st.url, port: portOf(st.url), pgid: active ? st.pid : undefined, startedAt: active ? st.startedAt : undefined,
      memory: active && st.pid ? await (deps.groupRss ?? groupRss)(st.pid) : undefined,
      node: p.starter.type === 'npm-dev' || p.kind === 'window' ? node : undefined,
      liveUrl: await liveUrl(p, deps.defaults), logPath: tilde(runner.logPath(p.id)), address: addressFor(p),
    };
  }

  function setFlag(list: 'hidden' | 'pinned', id: string, on: boolean) {
    const s = loadSettings(deps.stateDir);
    s[list] = s[list].filter((h) => h !== id);
    if (on) s[list].push(id);
    saveSettings(deps.stateDir, s);
  }

  const agendaProjects = (): AgendaProject[] => {
    const { hidden } = loadSettings(deps.stateDir);
    return deps.projects().map((p) => ({ id: p.id, name: p.name, dir: realDir(p.dir), hidden: hidden.includes(p.id) }));
  };
  const agenda = (): Agenda => {
    if (!deps.agenda) throw new HttpError(404, 'not found');
    return deps.agenda;
  };

  /** Does what an Agenda item's button says. The action comes from the list, never from the request. */
  async function openItem(key: unknown) {
    const it = await agenda().item(agendaProjects(), key);
    if (!it) throw new HttpError(404, 'not on the agenda');
    switch (it.action.kind) {
      case 'session': effects.openSession(it.action.sessionId); break;
      case 'assistant': effects.openAssistant(find(it.projectId!).dir); break;
      case 'backup-log': effects.revealFile(deps.backupLog ?? BACKUP_LOG); break;
      // a URL the outside-world checks stored, never one from the request; checked again before the browser gets it
      case 'url': if (deps.outside?.openable(it.action.url)) effects.openUrl(it.action.url); else throw new HttpError(400, 'not a link Oberth stored'); break;
      // the menu bar opens the review in the browser; the dashboard goes there itself
      case 'review': if (parseDay(it.action.start) !== undefined) effects.openUrl(`http://127.0.0.1:${port}/logbook?week=${it.action.start}`); break;
      case 'tab': break; // the dashboard selects the project's tab itself
    }
    return { ok: true, action: it.action, projectId: it.projectId };
  }

  // ---------- Ideas (ideas.ts, docs/architecture.md, "Ideas") ----------

  /** Projects an idea can be filed against: the discovered ones, plus Oberth itself. */
  const ideaTargets = (): { id: string; name: string; dir: string }[] => [...deps.projects(), ...(deps.self ? [deps.self] : [])];
  const ideaOf = (id: string): Idea => {
    const i = loadIdeas(deps.stateDir).find((x) => x.id === id);
    if (!i) throw new HttpError(404, 'no idea with that id');
    return i;
  };
  const targetOf = (projectId: unknown) => {
    if (projectId === undefined || projectId === null || projectId === '') return undefined;
    const t = ideaTargets().find((p) => p.id === projectId);
    if (!t) throw new HttpError(400, 'unknown project');
    return t;
  };
  /** An idea as the dashboard and the tools see it: with its links, its session, its project's name, and the brief a start sheet offers. */
  function ideaView(i: Idea, names: Map<string, string>) {
    const name = i.projectId ? names.get(i.projectId) : undefined;
    return { ...i, links: linksOf(i), sessionId: sessionOf(i), projectName: name, projectGone: !!i.projectId && !name, brief: briefOf(i, name ?? i.projectId), folder: slugOf(i.title) };
  }
  /**
   * The places a new project may go: each root itself, or a top-level folder in one that isn't a project (and isn't
   * left out). The first root's keys are bare folder names ('' for the root, 'games'), as before roots were a list;
   * other roots' are '<label>:' and '<label>:<folder>'. A key is only ever matched against this list.
   */
  function ideaGroups(): { name: string; label: string; path: string; idPrefix: string }[] {
    const out: { name: string; label: string; path: string; idPrefix: string }[] = [];
    for (const root of roots) {
      const first = root === roots[0];
      const prefix = first ? '' : `${root.label}:`;
      const projectTops = new Set(deps.projects().map((p) => p.dir).filter((d) => d.startsWith(root.path + '/') && !d.slice(root.path.length + 1).includes('/')).map((d) => d.slice(root.path.length + 1)));
      let names: string[] = [];
      try {
        names = readdirSync(root.path, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && !projectTops.has(d.name) && !excluded(deps.exclude ?? [], root, d.name, join(root.path, d.name)) && !(deps.self && realDir(join(root.path, d.name)) === realDir(deps.self.dir)))
          .map((d) => d.name).sort((a, b) => a.localeCompare(b));
      } catch { continue; } // a root that doesn't exist yet
      // path: where the new folder goes, for the start sheet; idPrefix: what the new project's id starts with
      const at = (group: string) => ({ path: group ? `${rootLabel(root)}/${group}` : rootLabel(root), idPrefix: projectId(roots, root, group ? `${group}/x` : 'x').slice(0, -1) });
      out.push({ name: prefix, label: rootLabel(root), ...at('') }, ...names.map((n) => ({ name: prefix + n, label: first ? n : `${rootLabel(root)}/${n}`, ...at(n) })));
    }
    return out;
  }
  /** A group key from ideaGroups() → its root and the folder inside it ('' for the root itself). */
  function groupDir(key: string): { root: Root; group: string } | undefined {
    if (!ideaGroups().some((g) => g.name === key)) return undefined;
    const colon = key.indexOf(':');
    if (colon === -1) return roots[0] && { root: roots[0], group: key };
    const root = roots.find((r) => r.label === key.slice(0, colon));
    return root && { root, group: key.slice(colon + 1) };
  }
  function ideasList(project?: string) {
    const targets = ideaTargets();
    const names = new Map(targets.map((p) => [p.id, p.name]));
    const all = loadIdeas(deps.stateDir).filter((i) => !project || i.projectId === project);
    const v = viewIdeas(all);
    const about = loadAbout(deps.stateDir);
    const fromIdea = new Map(loadIdeas(deps.stateDir).filter((i) => i.started).map((i) => [i.started!.projectId, i]));
    const started = project ? [] : deps.projects().filter((p) => about[p.id]?.status === 'idea').map((p) => {
      const i = fromIdea.get(p.id);
      return { id: p.id, name: p.name, startedAt: i?.started?.at, fromIdea: i?.title };
    });
    const view = (xs: Idea[]) => xs.map((i) => ideaView(i, names));
    return { newProjects: view(v.newProjects), forProjects: view(v.forProjects), started, done: view(v.done), dropped: view(v.dropped), open: v.newProjects.length + v.forProjects.length };
  }
  /** Starting an idea: a new project (folder, git init, About, an assistant session with the brief) or a session in its project. */
  function startIdea(i: Idea, body: any) {
    if (i.state !== 'open') throw new HttpError(409, 'this idea was already started or dropped');
    const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
    if (!brief || brief.length > IDEA_LIMITS.brief) throw new HttpError(400, `the brief must be 1 to ${IDEA_LIMITS.brief} characters`);
    if (i.projectId) {
      if (!assistant?.openNew) throw new HttpError(409, 'there is no assistant to start it in: mark it done instead');
      const t = targetOf(i.projectId);
      if (!t) throw new HttpError(400, 'unknown project');
      effects.openNewSession(t.dir, brief);
      markStarted(deps.stateDir, i.id, t.id, true);
      deps.activity?.add({ id: t.id, kind: 'idea', text: `idea started in ${assistant.label}: ${i.title}` });
      return { ok: true, projectId: t.id };
    }
    if (!roots.length) throw new HttpError(404, 'not found');
    const folder = typeof body.folder === 'string' ? body.folder : '';
    if (!FOLDER.test(folder)) throw new HttpError(400, 'the folder name may only have lower case letters, digits and dashes');
    const where = groupDir(typeof body.group === 'string' ? body.group : '');
    if (!where) throw new HttpError(400, 'not a place a new project can go');
    const { root, group } = where;
    const status = body.status === 'active' ? 'active' : 'idea';
    // joined from two checked names, never a path from the request
    const dir = group ? join(root.path, group, folder) : join(root.path, folder);
    const id = projectId(roots, root, group ? `${group}/${folder}` : folder);
    if (existsSync(dir) || deps.projects().some((p) => p.id === id)) throw new HttpError(409, `${group ? `${group}/` : ''}${folder} already exists`);
    mkdirSync(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir, env: { PATH: deps.pathEnv } });
    saveAbout(deps.stateDir, id, { description: i.title.slice(0, ABOUT_LIMITS.description), status, notes: brief.slice(0, ABOUT_LIMITS.notes) });
    markStarted(deps.stateDir, i.id, id, !!assistant?.openNew);
    deps.activity?.add({ id, kind: 'idea', text: `started from an idea: ${i.title}` });
    // with an assistant, a session with the brief typed in; without one, the new folder in the editor
    if (assistant?.openNew) effects.openNewSession(dir, brief); else effects.openInEditor(dir);
    return { ok: true, projectId: id, folder: tilde(dir) };
  }

  /** A week of the Logbook read back (review.ts): the week, plus what each project was last touched and how it does outside. */
  async function reviewFor(at: number): Promise<Review> {
    if (!deps.activity) throw new HttpError(404, 'not found');
    const describe = (id: string) => ({ name: deps.projects().find((p) => p.id === id)?.name ?? (id === 'oberth' ? 'Oberth' : id) });
    const week = buildWeek(deps.activity, at, describe, Date.now());
    const settings = loadSettings(deps.stateDir);
    const about = loadAbout(deps.stateDir);
    const projects = await Promise.all(deps.projects().map(async (p) => {
      const work = deps.activity?.workOf(p.id).at(-1);
      const lastAt = Math.max(recencyOf(settings.lastLaunched[p.id], await lastChange(p)), work ? work.at + (work.ms ?? 0) : 0);
      return {
        id: p.id, name: p.name, hidden: settings.hidden.includes(p.id), library: p.kind === 'library',
        status: about[p.id]?.status, released: about[p.id]?.released, lastAt, outside: deps.outside?.facts(p.id) as never,
      };
    }));
    return buildReview(week, projects, Date.now());
  }

  /**
   * Every page's sidebar comes from one file, dashboard/sidebar.html, read on each request like the pages themselves,
   * with the current page's link marked and the Needs you and Ideas counts filled in, so a page without the dashboard's
   * scripts (the Logbook, the script-free About page) shows them too. A page shows it where it says <!--sidebar-->.
   */
  async function withSidebar(html: string, current: string): Promise<string> {
    let nav = '';
    try { nav = readFileSync(join(deps.dashboardDir, 'sidebar.html'), 'utf8'); } catch { /* a dashboard without one */ }
    const need = deps.agenda ? await deps.agenda.view(agendaProjects()).then((v) => v.count, () => 0) : 0;
    const ideas = viewIdeas(loadIdeas(deps.stateDir));
    const open = ideas.newProjects.length + ideas.forProjects.length;
    nav = nav.replace(/^<!--[\s\S]*?-->\n/, '')
      .replace(new RegExp(`<a class="nav"([^>]*) data-page="${current}"`), `<a class="nav on"$1 data-page="${current}" aria-current="page"`)
      .replace('<span class="n" id="nav-need"></span>', `<span class="n" id="nav-need">${need || ''}</span>`)
      .replace('<span class="n grey" id="nav-ideas-n"></span>', `<span class="n grey" id="nav-ideas-n">${open || ''}</span>`);
    // a module that is off has no link (config.json "modules")
    for (const m of ['agenda', 'ideas', 'logbook']) if (deps.ui?.modules[m] === false) nav = nav.replace(new RegExp(`\\s*<a class="nav[^"]*"[^>]* data-page="${m}"[\\s\\S]*?</a>`), '');
    return html.replace('<!--sidebar-->', nav);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostOk(req, port)) throw new HttpError(403, 'forbidden');
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname;
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'GET') {
      if (path === '/logbook' && !on('logbook')) throw offError('logbook');
      if (path === '/' || path === '/logbook') {
        const html = (await withSidebar(readFileSync(join(deps.dashboardDir, path === '/' ? 'index.html' : 'logbook.html'), 'utf8'), path === '/' ? 'projects' : 'logbook'))
          .replace('<head>', `<head>\n<meta name="oberth-token" content="${deps.token}">\n<meta name="oberth-config" content="${attr(JSON.stringify(setup()))}">`);
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      // what the pages and the menu bar adapt to: the assistant (or none), the editor, the browser, the modules
      if (path === '/api/config') return json(res, setup());
      // still no script and no token: only the sidebar is put in
      if (path === '/about') return send(res, 200, await withSidebar(readFileSync(join(deps.dashboardDir, 'about.html'), 'utf8'), 'about'), 'text/html; charset=utf-8');
      if (STATIC[path]) return send(res, 200, readFileSync(join(deps.dashboardDir, path.slice(1))), STATIC[path]);
      if (path === '/api/projects') return json(res, await views(url.searchParams.get('live') === '1'));
      if (path === '/api/activity') {
        // this route needs no token, so session titles stay out of it
        const all = (deps.activity?.today() ?? []).filter((e) => e.kind !== 'session' && e.kind !== 'idea' && e.kind !== 'usage').sort((a, b) => b.at - a.at).slice(0, 60);
        return json(res, all);
      }
      if ((path === '/api/logbook/week' || path === '/api/review') && !on('logbook')) throw offError('logbook');
      if (path === '/api/logbook/week') {
        if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden'); // session titles
        if (!deps.activity) throw new HttpError(404, 'not found');
        const start = url.searchParams.get('start');
        const at = start === null ? Date.now() : parseDay(start);
        if (at === undefined) throw new HttpError(400, 'not a date');
        const projects = new Map(deps.projects().map((p) => [p.id, p]));
        // Oberth isn't one of its projects, and a project since gone keeps its history under its id
        const describe = (id: string) => {
          const p = projects.get(id);
          if (p) return { name: p.name, icon: `/api/icon/${encodeURIComponent(id)}` };
          return id === 'oberth' ? { name: 'Oberth', icon: '/logo.svg' } : { name: id };
        };
        return json(res, buildWeek(deps.activity, at, describe, Date.now()));
      }
      if (path === '/api/ideas' || path === '/api/ideas/groups') {
        if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden'); // the owner's own text
        if (!on('ideas')) throw offError('ideas');
        if (path === '/api/ideas/groups') return json(res, ideaGroups());
        const project = url.searchParams.get('project') ?? undefined;
        return json(res, ideasList(project));
      }
      if (path === '/api/review') {
        if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden'); // session and project names
        const start = url.searchParams.get('start');
        const at = start === null ? lastWeekStart(Date.now()) : parseDay(start);
        if (at === undefined) throw new HttpError(400, 'not a date');
        return json(res, await reviewFor(at));
      }
      if (path === '/api/agenda') {
        if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden');
        return json(res, await agenda().view(agendaProjects()));
      }
      if (path === '/api/recall') {
        if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden'); // code and session text
        if (!deps.recall) throw new HttpError(404, 'not found');
        const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim();
        if (q.length < 2 || q.length > 200) throw new HttpError(400, 'search for 2 to 200 characters');
        const kind = url.searchParams.get('kind') ?? undefined;
        if (kind !== undefined && !RECALL_KINDS.includes(kind as RecallKind)) throw new HttpError(400, 'unknown kind');
        return json(res, await deps.recall.search(q, { project: url.searchParams.get('project') ?? undefined, kind: kind as RecallKind | undefined }));
      }
      if (parts[0] === 'api' && parts[1] === 'icon' && parts.length === 3) {
        const icon = readIcon(resolveIcon(find(parts[2]), deps.iconsDir));
        return send(res, 200, icon.body, icon.mime);
      }
      if (parts[0] === 'api' && parts[1] === 'projects' && parts.length === 4) {
        const p = find(parts[2]);
        if (parts[3] === 'qr') {
          const st = runner.state(p.id);
          const ip = effects.lanIp();
          if (st.status !== 'running' || st.mode !== 'lan' || !st.url || !ip) throw new HttpError(404, 'not in phone mode');
          const phoneUrl = `http://${ip}:${portOf(st.url)}/`;
          res.setHeader('X-Phone-Url', phoneUrl);
          return send(res, 200, await qrSvg(phoneUrl), 'image/svg+xml');
        }
        if (parts[3] === 'log') {
          if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden');
          // ?from=<byte offset> returns only what was appended since; the log restarts (from 0) on each launch
          const file = runner.logPath(p.id);
          const all = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
          const asked = Number(url.searchParams.get('from'));
          const from = url.searchParams.has('from') && Number.isInteger(asked) && asked >= 0 && asked <= all.length
            ? asked : Math.max(0, all.length - LOG_TAIL);
          res.setHeader('X-Log-From', String(from));
          res.setHeader('X-Log-Size', String(all.length));
          return send(res, 200, all.subarray(from), 'text/plain; charset=utf-8');
        }
        if (parts[3] === 'errors') {
          if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden');
          const t = runner.errors(p.id);
          return json(res, { count: t?.count ?? 0, groups: t?.groups ?? [] });
        }
        if (parts[3] === 'git') {
          const g = await gitDetail(p.dir);
          const live = await liveUrl(p, deps.defaults);
          // GitHub Pages and CNAME sites go live on push, so unpushed commits are also not live yet
          const onPush = !!live && (/\.github\.io$/.test(new URL(live).hostname) || existsSync(join(p.dir, 'CNAME')));
          return json(res, g && { ...g, repoUrl: await repoUrl(p.dir), liveOnPush: onPush });
        }
        if (parts[3] === 'scripts') {
          if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden');
          const { pinned, other } = scriptNames(p);
          const results = scripts.resultsFor(p.id);
          return json(res, { needsInstall: p.needsInstall, packageManager: pmOf(p), pinned: pinned.map((name) => ({ name, result: results[name] })), other: other.map((name) => ({ name, result: results[name] })) });
        }
        if (parts[3] === 'about') {
          // the drawer's About tab: what the owner wrote, plus facts read from the project (and GitHub, once a day)
          const [live, repo, history, rec] = await Promise.all([liveUrl(p, deps.defaults), repoUrl(p.dir), historyOf(p.dir), recency(p, loadSettings(deps.stateDir).lastLaunched[p.id])]);
          const d = depsOf(p.dir);
          const [visibility, pypi, links] = await Promise.all([visibilityOf(repo), pypiVersion(p.dir), projectLinks(p, deps.defaults)]);
          return json(res, {
            about: loadAbout(deps.stateDir)[p.id] ?? {},
            outside: deps.outside?.facts(p.id),
            facts: {
              stack: stackOf(p, d), deploy: deployOf(p, live, d) ?? (pypi ? 'PyPI' : undefined), ...history, lastWorkedOn: rec, repoUrl: repo, visibility, links,
              // what Oberth can see that suggests a release; the Released mark itself is the owner's call
              hints: { publicRepo: visibility === 'public', pypi: pypi && { name: pyprojectName(p.dir), version: pypi }, liveUrl: live },
            },
          });
        }
        if (parts[3] === 'recap') {
          if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden'); // session titles and prompts
          const [git, facts] = await Promise.all([gitDetail(p.dir), gitFacts(p.dir)]);
          return json(res, buildRecap(deps.activity?.workOf(p.id) ?? [], git, facts, assistant?.lastPrompt?.(p.dir)));
        }
        if (parts[3] === 'info') {
          if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden');
          return json(res, await info(p));
        }
        if (parts[3] === 'asks') {
          if (!on('agenda')) throw offError('agenda');
          if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden');
          return json(res, openAsks(deps.stateDir, p.id));
        }
      }
      if (parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'scripts' && parts[5] === 'log' && parts.length === 6) {
        if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden');
        const p = find(parts[2]);
        if (!scriptNames(p).pinned.concat(scriptNames(p).other).includes(parts[4])) throw new HttpError(404, 'unknown script');
        const file = scripts.logPath(p.id, parts[4]);
        return send(res, 200, existsSync(file) ? readFileSync(file) : '', 'text/plain; charset=utf-8');
      }
      throw new HttpError(404, 'not found');
    }

    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (!guard(req, deps.token, port)) throw new HttpError(403, 'forbidden');
    const body = await readBody(req);
    if (parts[0] === 'api' && parts[1] === 'ideas' && !on('ideas')) throw offError('ideas');
    if (path === '/api/stop-all') { pendingOpen.clear(); await runner.stopAll(); return json(res, { ok: true }); }
    if (path === '/api/agenda/open') return json(res, await openItem(body.key));
    if (path === '/api/recall/open') {
      // only what a search handed out, so this never takes a path from the request
      const t = deps.recall?.open(body.key);
      if (!t) throw new HttpError(404, 'not in a recent search');
      if (t.type === 'file') effects.openFile(t.path, t.line);
      else if (t.type === 'session') effects.openSession(t.id);
      else if (t.type === 'claude') effects.openAssistant(t.dir);
      return json(res, { ok: true });
    }
    if (path === '/api/ideas') {
      let n;
      try { n = cleanIdea(body); } catch (e: any) { throw new HttpError(400, e.message); }
      const t = targetOf(n.projectId);
      const i = addIdea(deps.stateDir, n);
      if (t && i.createdAt === i.updatedAt) deps.activity?.add({ id: t.id, kind: 'idea', text: `idea: ${i.title}` });
      return json(res, i);
    }
    if (parts[0] === 'api' && parts[1] === 'ideas' && parts.length >= 3 && parts.length <= 4) {
      const i = ideaOf(parts[2]);
      switch (parts[3]) {
        case undefined: {
          const title = body.title === undefined ? undefined : (() => { try { return cleanIdea({ title: body.title }).title; } catch (e: any) { throw new HttpError(400, e.message); } })();
          const projectId = body.projectId === null ? null : body.projectId === undefined ? undefined : targetOf(body.projectId)!.id;
          return json(res, editIdea(deps.stateDir, i.id, { title, projectId }));
        }
        case 'notes': {
          let n;
          try { n = cleanNote(body); } catch (e: any) { throw new HttpError(400, e.message); }
          try { return json(res, addNote(deps.stateDir, i.id, n)); } catch (e: any) { throw new HttpError(409, e.message); }
        }
        case 'drop': return json(res, dropIdea(deps.stateDir, i.id));
        case 'restore': return json(res, restoreIdea(deps.stateDir, i.id));
        case 'delete': return json(res, { ok: deleteIdea(deps.stateDir, i.id) });
        case 'done': {
          if (!i.projectId) throw new HttpError(400, 'an idea for a new project is started, not marked done');
          return json(res, markStarted(deps.stateDir, i.id, i.projectId, false));
        }
        case 'start': return json(res, startIdea(i, body));
        case 'session': {
          const sid = sessionOf(i);
          if (!sid) throw new HttpError(404, 'this idea came from no assistant session');
          if (!assistant?.openSession) throw noAssistant();
          effects.openSession(sid);
          return json(res, { ok: true });
        }
      }
    }
    if (path === '/api/review/seen') {
      // the Logbook showed this week's review: its Agenda pointer has done its job
      if (typeof body.start !== 'string' || parseDay(body.start) === undefined) throw new HttpError(400, 'not a date');
      markReviewSeen(deps.stateDir, body.start);
      deps.agenda?.forget();
      return json(res, { ok: true });
    }
    // asks only reach someone through the Agenda: with it off, refuse them rather than drop them silently
    if (((parts[0] === 'api' && parts[1] === 'agenda') || (parts[1] === 'projects' && parts[3] === 'asks')) && !on('agenda')) throw offError('agenda');
    if (path === '/api/agenda/later') {
      const it = await agenda().item(agendaProjects(), body.key);
      if (!it) throw new HttpError(404, 'not on the agenda');
      putOffLater(deps.stateDir, it);
      return json(res, { ok: true });
    }
    if (parts[0] === 'api' && parts[1] === 'agenda' && parts[2] === 'asks' && parts[4] === 'done' && parts.length === 5) {
      if (!closeAsk(deps.stateDir, parts[3])) throw new HttpError(404, 'no open ask with that id');
      return json(res, { ok: true });
    }
    if (parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'scripts' && parts.length === 6) {
      const p = find(parts[2]);
      const { pinned, other } = scriptNames(p);
      // only names read from the project's own package.json ever run
      if (!pinned.includes(parts[4]) && !other.includes(parts[4])) throw new HttpError(404, 'unknown script');
      if (parts[5] === 'run') {
        if (p.needsInstall) throw new HttpError(409, `dependencies not installed yet (Launch runs ${pmOf(p)} install)`);
        return json(res, scripts.run(p, parts[4]));
      }
      if (parts[5] === 'cancel') { scripts.cancel(p.id, parts[4]); return json(res, { ok: true }); }
    }
    if (parts[0] === 'api' && parts[1] === 'foreign' && parts[3] === 'stop' && parts.length === 4) {
      const pid = Number(parts[2]);
      const all = [...(await foreignMap(deps.projects())).values()].flat();
      if (!Number.isInteger(pid) || !all.some((l) => l.pid === pid)) throw new HttpError(404, 'not a leftover server');
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      return json(res, { ok: true });
    }
    if (parts[0] === 'api' && parts[1] === 'projects' && parts.length === 4) {
      const p = find(parts[2]);
      switch (parts[3]) {
        case 'launch': {
          const mode: Mode = body.mode === 'lan' ? 'lan' : 'local';
          return json(res, await launch(p, mode, body.open !== false));
        }
        case 'stop': pendingOpen.delete(p.id); await runner.stop(p.id); return json(res, { ok: true });
        case 'assistant': case 'claude':
          if (!assistant?.open) throw noAssistant();
          effects.openAssistant(p.dir); return json(res, { ok: true });
        case 'resume': {
          if (!assistant?.openNew) throw noAssistant();
          // a new session with the "where was I?" card typed in: the same recap the About tab shows, plus the notes
          const [git, facts] = await Promise.all([gitDetail(p.dir), gitFacts(p.dir)]);
          const recap = buildRecap(deps.activity?.workOf(p.id) ?? [], git, facts, assistant.lastPrompt?.(p.dir));
          effects.openNewSession(p.dir, resumeBrief(p.name, loadAbout(deps.stateDir)[p.id]?.notes, recap));
          return json(res, { ok: true });
        }
        case 'editor': case 'vscode': effects.openInEditor(p.dir); return json(res, { ok: true });
        case 'finder': effects.revealInFinder(p.dir); return json(res, { ok: true });
        case 'free-port': return json(res, await freePortAndRetry(p));
        case 'status': {
          // only the status, keeping the rest of the About (the review's "Pause it")
          const status = body.status;
          if (!STATUSES.includes(status)) throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}`);
          return json(res, saveAbout(deps.stateDir, p.id, { ...(loadAbout(deps.stateDir)[p.id] ?? {}), status: status as ProjectStatus }));
        }
        case 'about': {
          let about;
          try { about = cleanAbout(body); } catch (e: any) { throw new HttpError(400, e.message); }
          return json(res, saveAbout(deps.stateDir, p.id, about));
        }
        case 'asks': {
          let ask;
          try { ask = cleanAsk(body); } catch (e: any) { throw new HttpError(400, e.message); }
          try { return json(res, addAsk(deps.stateDir, p.id, ask)); } catch (e: any) { throw new HttpError(409, e.message); }
        }
        case 'hide': setFlag('hidden', p.id, true); return json(res, { ok: true });
        case 'unhide': setFlag('hidden', p.id, false); return json(res, { ok: true });
        case 'pin': setFlag('pinned', p.id, true); return json(res, { ok: true });
        case 'unpin': setFlag('pinned', p.id, false); return json(res, { ok: true });
      }
    }
    throw new HttpError(404, 'not found');
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (!res.headersSent) json(res, { error: e.message ?? String(e) }, status);
    });
  });

  return {
    server,
    onReady(id: string, url: string): void {
      if (!pendingOpen.delete(id)) return;
      const p = deps.projects().find((x) => x.id === id);
      effects.openUrl(p ? pageFor(p, url) : url);
    },
    /** for the proxy: names to projects, where each one answers now, and display names */
    proxyTable,
    proxyTarget,
    /** for the Agenda's weekly pointer, from main.ts */
    reviewFor,
    nameOf: (id: string) => deps.projects().find((p) => p.id === id)?.name,
    /** Runner status changes become activity: ready, failed to start, crashed, stopped. */
    onStatus(id: string, st: { status: string; url?: string; error?: string }, from: string): void {
      const a = deps.activity;
      if (!a) return;
      if (st.status === 'running') a.add({ id, kind: 'ready', text: st.url ? `ready on :${portOf(st.url)}` : 'window open', ok: true });
      else if (st.status === 'failed') a.add({ id, kind: from === 'running' ? 'crashed' : 'failed', text: st.error ?? 'failed', ok: false });
      else if (st.status === 'stopped') a.add({ id, kind: 'stopped', text: 'stopped' });
    },
    onScript(id: string, name: string, r: { status: string; startedAt: number; endedAt?: number }): void {
      if (r.status === 'cancelled') return;
      const secs = r.endedAt ? Math.round((r.endedAt - r.startedAt) / 1000) : 0;
      deps.activity?.add({ id, kind: 'script', text: `${name} ${r.status} (${secs} s)`, ok: r.status === 'passed' });
    },
  };
}
