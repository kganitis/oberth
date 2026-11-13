// The only place real dependencies are wired: config.json decides the roots, the assistant, the editor, the browser
// and which modules run; everything below hands those to the parts that need them. Tests build the same createApp()
// with fakes (tests/server.test.ts).
import { realpathSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { join } from 'node:path';
import { loadAbout } from './about.ts';
import { ActivityLog } from './activity.ts';
import { Agenda, type AgendaSources } from './agenda.ts';
import { assistantOf } from './assistant.ts';
import { ensureToken } from './auth.ts';
import { readBackupStatus } from './backupstatus.ts';
import { baseEnv } from './commands.ts';
import { basePath, config, REPO_DIR, resolveNodeBin } from './config.ts';
import { discoverProjects } from './discover.ts';
import { EDITORS, editorOf } from './editors.ts';
import { makeEffects } from './effects.ts';
import { branchCommits, gitFacts, reflogStamp } from './gitinfo.ts';
import { LiveChecker } from './livecheck.ts';
import { Logbook } from './logbook.ts';
import { nodeVersionOf } from './preflight.ts';
import { loadIdeas } from './ideas.ts';
import { openable, Outside, type OutsideProject } from './outside.ts';
import { reviewItem, reviewSeen } from './review.ts';
import { lastWeekStart } from './week.ts';
import type { AgendaItem } from './agenda.ts';
import { liveUrl as liveUrlOf, repoUrl } from './live.ts';
import { pypiVersion, pyprojectName, visibilityOf } from './facts.ts';
import { listListeners } from './ports.ts';
import { Recall } from './recall.ts';
import { Runner } from './runner.ts';
import { ScriptRunner } from './scripts.ts';
import { createApp } from './server.ts';
import { createProxy } from './proxy.ts';

const root = REPO_DIR;
const on = config.modules;
const defaults = config.projects;
const assistant = assistantOf(config.assistant);
const editor = editorOf(config.editor);
const problems = [...config.problems];
if (!EDITORS.some((e) => e.id === config.editor)) problems.push(`editor: "${config.editor}" isn't one of ${EDITORS.map((e) => e.id).join(', ')}; using ${editor.label}`);
for (const p of problems) console.error(`config: ${p}`);

const projects = () => discoverProjects(config.roots, defaults, config.exclude);
// Oberth is left out of its own project list, but what was done on it is worth finding and keeping (config.json "self")
const self = { id: 'oberth', name: 'Oberth', dir: root };
const withSelf = <T,>(list: T[], me: T): T[] => (config.self ? [...list, me] : list);
const realOr = (p: string) => { try { return realpathSync(p); } catch { return p; } };

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = netServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address() as { port: number };
    s.close(() => resolve(port));
  });
  s.on('error', reject);
});

const pathEnv = basePath(resolveNodeBin());
let app: ReturnType<typeof createApp>;
const activity = new ActivityLog(config.stateDir);
const notesFacts = () => new Map(Object.entries(loadAbout(config.stateDir)).flatMap(([id, a]) =>
  a.notes && a.updatedAt ? [[id, { updatedAt: a.updatedAt, work: activity.workSince(id, a.updatedAt) }] as const] : []));
// CI=1 keeps test runners (vitest, jest) in run-once mode and tools from prompting
const scripts = new ScriptRunner({ logDir: config.logDir, stateDir: config.stateDir, env: { ...baseEnv(pathEnv), CI: '1' }, onFinish: (id, name, r) => app.onScript(id, name, r) });
// released work seen from outside (outside.ts): only projects marked Released, and of those the public GitHub repo,
// the published PyPI package and the live site
const outside = on.outside ? new Outside({
  stateDir: config.stateDir,
  projects: async (): Promise<OutsideProject[]> => {
    const about = loadAbout(config.stateDir);
    const released = projects().filter((p) => about[p.id]?.released);
    return Promise.all(released.map(async (p) => {
      const repo = await repoUrl(p.dir);
      const github = repo?.startsWith('https://github.com/') ? repo : undefined;
      const pub = github && (await visibilityOf(github)) === 'public';
      const pkg = pyprojectName(p.dir);
      const published = pkg && (await pypiVersion(p.dir));
      const site = await liveUrlOf(p, defaults);
      return { id: p.id, name: p.name, ...(pub ? { repo: github!.replace('https://github.com/', '') } : {}), ...(published ? { pypi: pkg } : {}), ...(site ? { liveUrl: site } : {}) };
    }));
  },
}) : undefined;
const sessions = assistant.sessions;
let reviewNow: AgendaItem | undefined;
const sources: AgendaSources = {
  git: gitFacts,
  notes: notesFacts,
  ...(sessions ? { sessions: () => sessions.scan(), liveSessions: sessions.live, pending: (s) => sessions.pending(s) } : {}),
  ...(on.backup ? { backup: () => readBackupStatus(config.backup.log) } : {}),
  ...(outside ? { outside: () => outside.items(), outsideError: () => outside.githubError() } : {}),
  ...(on.logbook ? { review: () => (reviewNow && !reviewSeen(config.stateDir, reviewNow.fingerprint) ? reviewNow : undefined) } : {}),
};
const runner = new Runner({ logDir: config.logDir, onReady: (id, url) => app.onReady(id, url), onStatus: (id, st, from) => app.onStatus(id, st, from) });
let proxyUp = false;
app = createApp({
  projects,
  runner,
  scripts,
  effects: makeEffects({ browser: config.browser, editor, assistant }),
  assistant,
  token: ensureToken(config.stateDir),
  stateDir: config.stateDir,
  // icons for projects without a favicon of their own, by project id: <state dir>/icons/<id>.svg
  iconsDir: join(config.stateDir, 'icons'),
  dashboardDir: join(root, 'dashboard'),
  defaults,
  listeners: listListeners,
  pathEnv,
  node: nodeVersionOf(pathEnv),
  roots: config.roots, exclude: config.exclude, ...(config.self ? { self } : {}),
  port: config.port,
  ui: { editor: { id: editor.id, label: editor.label }, browser: config.browser, modules: { ...on }, problems },
  proxyUp: () => proxyUp, proxyPort: config.proxyPort,
  ...(outside ? { outside: { facts: (id: string) => outside.facts(id), openable: (url: string) => openable(url, outside.projects()) } } : {}),
  freePort,
  activity,
  backupLog: config.backup.log,
  live: new LiveChecker(),
  ...(on.recall ? {
    recall: new Recall({
      projects: () => withSelf<{ id: string; name: string; dir: string }>(projects(), self),
      ...(sessions ? { sessions: () => sessions.scan(true).sessions, transcriptsRoot: sessions.transcriptsRoot } : {}),
      about: () => loadAbout(config.stateDir),
      ideas: () => (on.ideas ? loadIdeas(config.stateDir) : []),
    }),
  } : {}),
  ...(on.agenda ? { agenda: new Agenda({ stateDir: config.stateDir, roots: config.roots.map((r) => realOr(r.path)), sources }) } : {}),
});

app.server.listen(config.port, '127.0.0.1', () => console.log(`oberth on http://127.0.0.1:${config.port}/`));

// stable addresses: http://<name>.localhost:<proxyPort> for every project, on 127.0.0.1 only (proxy.ts)
if (on.proxy) {
  const proxy = createProxy({
    port: config.proxyPort, table: () => app.proxyTable(), target: (id) => app.proxyTarget(id), nameOf: (id) => app.nameOf(id),
    dashboard: `http://127.0.0.1:${config.port}/`,
  });
  proxy.on('error', (err: NodeJS.ErrnoException) => {
    proxyUp = false;
    console.error(`stable addresses are off: port ${config.proxyPort} ${err.code === 'EADDRINUSE' ? 'is taken' : `failed (${err.message})`}`);
  });
  proxy.listen(config.proxyPort, '127.0.0.1', () => { proxyUp = true; console.log(`stable addresses on http://<name>.localhost:${config.proxyPort}/`); });
}

if (on.logbook) {
  const logbook = new Logbook({
    stateDir: config.stateDir, log: activity,
    projects: () => withSelf<{ id: string; dir: string }>(projects(), self),
    ...(sessions ? { sessions: () => sessions.scan(true).sessions, transcriptsRoot: sessions.transcriptsRoot } : {}),
    commits: branchCommits, stamp: reflogStamp,
  });
  const record = () => logbook.tick().catch((err) => console.error('logbook:', err));
  setTimeout(record, 10_000);
  setInterval(record, 60_000);
  // last week's review for the Agenda, worked out again every 10 minutes (it reads a week of the Logbook and runs git)
  const refreshReview = () => app.reviewFor(lastWeekStart(Date.now())).then((r) => { reviewNow = reviewItem(r); }, (err) => console.error('review:', err));
  setTimeout(refreshReview, 15_000);
  setInterval(refreshReview, 10 * 60_000);
}
if (outside) {
  // the outside-world checks decide for themselves what is due (GitHub every 30 min, sites every 10, PyPI daily)
  setTimeout(() => void outside.tick(), 20_000);
  setInterval(() => void outside.tick(), 5 * 60_000);
}

const shutdown = async () => { await Promise.all([runner.stopAll(), scripts.stopAll()]); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// A bug in one project's handling must not take the service (and every tracked server) down.
process.on('uncaughtException', (e) => console.error('uncaught:', e));
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
