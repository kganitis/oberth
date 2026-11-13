import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTree } from './fixtures/tree.ts';
import { createApp } from '../service/server.ts';
import { Recall } from '../service/recall.ts';
import { Runner } from '../service/runner.ts';
import { ScriptRunner } from '../service/scripts.ts';
import { ActivityLog } from '../service/activity.ts';
import { loadSettings } from '../service/settings.ts';
import { Agenda, type AgendaSources } from '../service/agenda.ts';
import type { ClaudeSession } from '../service/claudesessions.ts';
import type { Defaults, Listener, Project } from '../service/types.ts';

/**
 * Fake leftovers: SIGTERM to one of these pids makes it exit (drop out of the fake listener list) at once,
 * as a real leftover does. Every other kill goes to the real process.kill.
 */
const realKill = process.kill.bind(process);
function fakeLeftovers(pids: number[]) {
  const alive = new Set(pids);
  const killed: number[] = [];
  const m = mock.method(process, 'kill', (pid: number, sig?: string | number) => {
    if (!alive.has(pid)) return realKill(pid, sig);
    killed.push(pid); alive.delete(pid); return true;
  });
  return { alive, killed, restore: () => m.mock.restore() };
}

const FAKE = new URL('./fixtures/fake-server.ts', import.meta.url).pathname;
const TOKEN = 'a'.repeat(64);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timeout'); await sleep(50); } };

function setup(opts: { listeners?: (dir: string) => Listener[]; projects?: Project[]; sources?: (dir: string) => Partial<AgendaSources>; pathEnv?: string; devRoot?: string; proxy?: boolean; defaults?: Defaults; outside?: { facts(id: string): unknown; openable(url: string): boolean }; dashboardDir?: string; noAssistant?: boolean; modules?: Record<string, boolean> } = {}) {
  const dir = makeTree({ 'a.txt': '' });
  const projects: Project[] = opts.projects ?? [
    { id: 'app', relPath: 'app', dir, name: 'App', kind: 'app', starter: { type: 'override', argv: [process.execPath, FAKE] }, scripts: { test: 'x', typecheck: 'x', slow: 'x', dev: 'x', predev: 'x' }, needsInstall: false },
    { id: 'win', relPath: 'win', dir, name: 'Win', kind: 'window', starter: { type: 'override', argv: [process.execPath, FAKE] }, scripts: {}, needsInstall: false },
  ];
  const opened: string[] = [];
  const claude: string[] = [];
  const editor: string[] = [];
  const stateDir = mkdtempSync(join(tmpdir(), 'state-'));
  // scripts are node one-liners standing in for npm run <name>
  const SCRIPT: Record<string, string> = { test: "console.log('148 passed')", typecheck: "console.log('src/a.ts(1,1): error TS2322'); process.exit(2)", slow: 'setInterval(() => {}, 1000)' };
  const scripts = new ScriptRunner({ logDir: mkdtempSync(join(tmpdir(), 'slogs-')), stateDir, env: process.env as Record<string, string>, command: (n) => [process.execPath, '-e', SCRIPT[n]] });
  let app: ReturnType<typeof createApp>;
  const runner = new Runner({ logDir: mkdtempSync(join(tmpdir(), 'logs-')), onReady: (id, url) => app.onReady(id, url), onStatus: (id, st, from) => app.onStatus(id, st, from), windowGraceMs: 300 });
  const activity = new ActivityLog(stateDir);
  app = createApp({
    projects: () => projects, runner, scripts, token: TOKEN, stateDir, defaults: opts.defaults ?? {},
    iconsDir: makeTree({ 'app.svg': '<svg>app</svg>' }),
    dashboardDir: opts.dashboardDir ?? makeTree({ 'index.html': '<html><head><title>x</title></head><body></body></html>', 'app.js': '', 'logbook.html': '<html><head><title>l</title></head><body>logbook page</body></html>', 'logbook.js': '', 'style.css': '', 'logo.svg': '<svg/>', 'emblem.svg': '<svg/>', 'about.html': '<html>about page</html>' }),
    listeners: async () => opts.listeners?.(dir) ?? [],
    effects: { openUrl: (u) => opened.push(u), openAssistant: (d) => claude.push(d), openSession: (id) => claude.push(`session ${id}`), openNewSession: (d, q) => claude.push(`new ${d} :: ${q}`), openInEditor: (d) => editor.push(`code ${d}`), openFile: (f, l) => editor.push(`file ${f}:${l}`), revealInFinder: (d) => editor.push(`finder ${d}`), revealFile: (f) => editor.push(`reveal ${f}`), lanIp: () => '192.168.1.24' },
    pathEnv: opts.pathEnv ?? process.env.PATH!, freePort: async () => 0, keepWeb: async (m) => m, groupRss: async () => 5_000_000,
    activity,
    proxyUp: () => !!opts.proxy, proxyPort: 7700, outside: opts.outside,
    roots: opts.devRoot ? [{ path: opts.devRoot, label: 'dev' }] : [], exclude: ['private-one', 'private-two'], self: { id: 'oberth', name: 'Oberth', dir: '/oberth' },
    ...(opts.modules ? { ui: { editor: { id: 'vscode', label: 'VS Code' }, browser: 'Safari', modules: opts.modules } } : {}),
    assistant: opts.noAssistant ? { id: 'none', label: '' } : { id: 'claude', label: 'Claude', open: () => {}, openSession: () => {}, openNew: () => {}, states: async (dirs) => new Map([[dirs[0], { sessionId: 'local_1', title: 'work', at: 1, working: true, others: 0 }]]) },
    backupLog: '/logs/backup.log',
    recall: new Recall({ projects: () => [{ id: 'app', name: 'App', dir }], sessions: () => [], about: () => ({ app: { notes: 'Left at the zebra.' } }), transcriptsRoot: stateDir }),
    agenda: new Agenda({
      stateDir, roots: ['/nowhere'], fastMs: 0, gitMs: 0,
      sources: { sessions: () => ({ sessions: [], files: 0, parsed: 0, summaries: 0 }), liveSessions: async () => new Set(), pending: () => undefined, git: async () => null, backup: () => null, notes: () => new Map(), ...opts.sources?.(realpathSync(dir)) },
    }),
  });
  const server = app.server.listen(0, '127.0.0.1');
  after(async () => { await runner.stopAll(); await scripts.stopAll(); server.close(); });
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    new Promise<{ status: number; body: string; headers: Record<string, any> }>(async (resolve, reject) => {
      if (!server.listening) await new Promise((r) => server.once('listening', r));
      const port = (server.address() as { port: number }).port;
      const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: '127.0.0.1:7777', ...headers } }, (res) => {
        let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
      });
      req.on('error', reject);
      if (body !== undefined) { req.setHeader('Content-Type', 'application/json'); req.write(JSON.stringify(body)); }
      req.end();
    });
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) => call('POST', path, { 'X-Oberth-Token': TOKEN, ...headers }, body);
  return { call, post, opened, claude, editor, runner, scripts, stateDir, dir, activity };
}

test('POST without token → 403 and nothing starts', async () => {
  const s = setup();
  const r = await s.call('POST', '/api/projects/app/launch', {}, { mode: 'local' });
  assert.equal(r.status, 403);
  assert.equal(s.runner.state('app').status, 'stopped');
});

test('POST with a foreign Origin → 403', async () => {
  const s = setup();
  assert.equal((await s.post('/api/projects/app/launch', { mode: 'local' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal(s.runner.state('app').status, 'stopped');
});

test('any request with a foreign Host → 403 (DNS rebinding)', async () => {
  const s = setup();
  assert.equal((await s.post('/api/projects/app/launch', { mode: 'local' }, { Host: 'evil.example:7777' })).status, 403);
  assert.equal((await s.call('GET', '/api/projects', { Host: 'evil.example:7777' })).status, 403);
});

test('token, own Origin → accepted', async () => {
  const s = setup();
  assert.equal((await s.post('/api/projects/app/hide', {}, { Origin: 'http://localhost:7777' })).status, 200);
});

test('launch twice → one run, openUrl once after ready', async () => {
  const s = setup();
  const a = await s.post('/api/projects/app/launch', { mode: 'local' });
  const b = await s.post('/api/projects/app/launch', { mode: 'local' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(JSON.parse(a.body).pid, JSON.parse(b.body).pid);
  await until(() => s.opened.length > 0);
  await sleep(300);
  assert.equal(s.opened.length, 1);
  assert.match(s.opened[0], /^http:\/\/localhost:\d+\/$/);
  // already running: clicking again just reopens the page
  await s.post('/api/projects/app/launch', { mode: 'local' });
  assert.equal(s.opened.length, 2);
});

test('launch with open: false starts the server but never opens Safari', async () => {
  const s = setup();
  await s.post('/api/projects/app/launch', { mode: 'local', open: false });
  await until(() => s.runner.state('app').status === 'running');
  await sleep(300);
  await s.post('/api/projects/app/launch', { mode: 'local', open: false });
  assert.deepEqual(s.opened, []);
});

test('launch with a foreign listener opens its URL and spawns nothing', async () => {
  const s2 = setup({ listeners: (dir) => [{ pid: 4242, pgid: 4242, port: 8765, cwd: dir }] });
  const r = await s2.post('/api/projects/app/launch', { mode: 'local' });
  assert.equal(r.status, 200);
  assert.deepEqual(s2.opened, ['http://localhost:8765/']);
  assert.equal(s2.runner.state('app').status, 'stopped');
});

test('window app launch never calls openUrl', async () => {
  const s = setup();
  await s.post('/api/projects/win/launch', { mode: 'local' });
  await until(() => s.runner.state('win').status === 'running');
  await sleep(200);
  assert.deepEqual(s.opened, []);
});

test('phone mode unavailable → 400', async () => {
  const s = setup();
  assert.equal((await s.post('/api/projects/app/launch', { mode: 'lan' })).status, 400);
});

test('hide marks the project hidden and persists', async () => {
  const s = setup();
  await s.post('/api/projects/app/hide');
  const list = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.equal(list.find((p: any) => p.id === 'app').hidden, true);
  assert.deepEqual(loadSettings(s.stateDir).hidden, ['app']);
  await s.post('/api/projects/app/unhide');
  assert.deepEqual(loadSettings(s.stateDir).hidden, []);
});

test('pin marks the project pinned and persists, apart from hidden', async () => {
  const s = setup();
  assert.equal((await s.call('POST', '/api/projects/app/pin')).status, 403); // token needed
  await s.post('/api/projects/app/pin');
  const list = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.equal(list.find((p: any) => p.id === 'app').pinned, true);
  assert.deepEqual(loadSettings(s.stateDir).pinned, ['app']);
  assert.deepEqual(loadSettings(s.stateDir).hidden, []);
  await s.post('/api/projects/app/unpin');
  assert.deepEqual(loadSettings(s.stateDir).pinned, []);
});

test('foreign stop with a pid not in the current foreign list → 404', async () => {
  const s = setup();
  assert.equal((await s.post('/api/foreign/1/stop')).status, 404);
});

test('claude opens a tab in the project folder', async () => {
  const s = setup();
  assert.equal((await s.post('/api/projects/app/claude')).status, 200);
  assert.deepEqual(s.claude, [s.dir]);
});

test('unknown project → 404', async () => {
  const s = setup();
  assert.equal((await s.post('/api/projects/nope/launch', { mode: 'local' })).status, 404);
});

test('GET / injects the token meta tag', async () => {
  const s = setup();
  const r = await s.call('GET', '/');
  assert.match(r.body, new RegExp(`<meta name="oberth-token" content="${TOKEN}">`));
});

test('the logo is served as SVG without a token', async () => {
  const s = setup();
  const r = await s.call('GET', '/logo.svg');
  assert.equal(r.status, 200);
  assert.match(r.body, /<svg/);
});

test('icon is served with no-store', async () => {
  const s = setup();
  const r = await s.call('GET', '/api/icon/app');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.body, '<svg>app</svg>');
});

test('project listing has the view fields', async () => {
  const s = setup();
  const [p] = JSON.parse((await s.call('GET', '/api/projects')).body);
  for (const k of ['id', 'name', 'kind', 'status', 'mode', 'phone', 'git', 'recency', 'updated', 'hidden', 'pinned', 'needsInstall', 'foreign', 'preflight']) assert.ok(k in p, k);
});

test('the about page and the emblem are served without a token', async () => {
  const s = setup();
  const page = await s.call('GET', '/about');
  assert.equal(page.status, 200);
  assert.match(page.body, /about page/);
  const emblem = await s.call('GET', '/emblem.svg');
  assert.equal(emblem.status, 200);
  assert.match(emblem.body, /<svg/);
});

test('log needs the token', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/api/projects/app/log')).status, 403);
  assert.equal((await s.call('GET', '/api/projects/app/log', { 'X-Oberth-Token': TOKEN })).status, 200);
});

test('project listing includes repoUrl (undefined without a GitHub remote)', async () => {
  const s = setup();
  const [p] = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.ok('repoUrl' in p || p.repoUrl === undefined);
  assert.equal(p.repoUrl, undefined);
});

test('launch during the stop window does nothing: no Safari, no new run', async () => {
  const s = setup();
  await s.post('/api/projects/app/launch', { mode: 'local' });
  await until(() => s.opened.length === 1);
  const stopping = s.runner.stop('app');
  const r = JSON.parse((await s.post('/api/projects/app/launch', { mode: 'local' })).body);
  assert.equal(r.status, 'stopping');
  await stopping;
  await sleep(300);
  assert.equal(s.opened.length, 1);
  assert.equal(s.runner.state('app').status, 'stopped');
});

test('window app with a leftover server: no Safari, nothing spawned', async () => {
  const winDir = makeTree({ 'w.txt': '' });
  const s = setup({
    listeners: () => [{ pid: 4242, pgid: 4242, port: 5173, cwd: winDir }],
    projects: [{ id: 'win', relPath: 'win', dir: winDir, name: 'Win', kind: 'window', starter: { type: 'override', argv: [process.execPath, FAKE] }, scripts: {}, needsInstall: false }],
  });
  const r = await s.post('/api/projects/win/launch', { mode: 'local' });
  assert.equal(r.status, 200);
  assert.deepEqual(s.opened, []);
  assert.equal(s.runner.state('win').status, 'stopped');
});

test('log ?from= returns only what was appended; a bad offset falls back to the tail', async () => {
  const s = setup();
  await s.post('/api/projects/app/launch', { mode: 'local' });
  await until(() => s.runner.state('app').status === 'running');
  const auth = { 'X-Oberth-Token': TOKEN };
  const all = await s.call('GET', '/api/projects/app/log', auth);
  assert.match(all.body, /Local: http/);
  assert.equal(all.headers['x-log-from'], '0');
  const size = all.headers['x-log-size'];
  assert.equal(Number(size), Buffer.byteLength(all.body));
  const none = await s.call('GET', `/api/projects/app/log?from=${size}`, auth);
  assert.equal(none.body, '');
  assert.equal(none.headers['x-log-from'], size);
  const past = await s.call('GET', '/api/projects/app/log?from=99999999', auth);
  assert.equal(past.headers['x-log-from'], '0');
  assert.equal(past.body, all.body);
});

test('info needs the token and describes stopped and running projects', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/api/projects/app/info')).status, 403);
  const auth = { 'X-Oberth-Token': TOKEN };
  const stopped = JSON.parse((await s.call('GET', '/api/projects/app/info', auth)).body);
  assert.equal(stopped.command, `${process.execPath} ${FAKE}`);
  assert.equal(stopped.memory, undefined);
  assert.equal(stopped.pgid, undefined);
  assert.match(stopped.logPath, /app\.log$/);
  await s.post('/api/projects/app/launch', { mode: 'local' });
  await until(() => s.runner.state('app').status === 'running');
  const running = JSON.parse((await s.call('GET', '/api/projects/app/info', auth)).body);
  assert.equal(running.memory, 5_000_000);
  assert.equal(running.pgid, s.runner.state('app').pid);
  assert.ok(running.port > 0);
});

test('scripts: only discovered names run; dev and npm hooks are not offered', async () => {
  const s = setup();
  const auth = { 'X-Oberth-Token': TOKEN };
  assert.equal((await s.call('GET', '/api/projects/app/scripts')).status, 403);
  const list = JSON.parse((await s.call('GET', '/api/projects/app/scripts', auth)).body);
  assert.deepEqual(list.pinned.map((x: any) => x.name), ['test', 'typecheck']);
  assert.deepEqual(list.other.map((x: any) => x.name), ['slow']);
  for (const name of ['dev', 'predev', 'rm -rf', '../x']) assert.equal((await s.post(`/api/projects/app/scripts/${encodeURIComponent(name)}/run`)).status, 404, name);
});

test('scripts: pass, fail with a tail, results in the listing, log served', async () => {
  const s = setup();
  const auth = { 'X-Oberth-Token': TOKEN };
  assert.equal(JSON.parse((await s.post('/api/projects/app/scripts/test/run')).body).status, 'running');
  await s.post('/api/projects/app/scripts/typecheck/run');
  await until(() => s.scripts.resultsFor('app').test?.status === 'passed' && s.scripts.resultsFor('app').typecheck?.status === 'failed');
  const list = JSON.parse((await s.call('GET', '/api/projects/app/scripts', auth)).body);
  const tc = list.pinned.find((x: any) => x.name === 'typecheck').result;
  assert.equal(tc.code, 2);
  assert.deepEqual(tc.tail, ['src/a.ts(1,1): error TS2322']);
  const [p] = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.equal(p.scripts.test.status, 'passed');
  assert.equal(p.scripts.test.tail, undefined); // the listing stays light
  assert.deepEqual(p.checks, ['test', 'typecheck']);
  assert.equal((await s.call('GET', '/api/projects/app/scripts/test/log', auth)).body, '148 passed\n');
});

test('scripts: cancel stops a long run and records it as cancelled', async () => {
  const s = setup();
  await s.post('/api/projects/app/scripts/slow/run');
  await sleep(200);
  await s.post('/api/projects/app/scripts/slow/cancel');
  await until(() => s.scripts.resultsFor('app').slow?.status === 'cancelled' && s.scripts.resultsFor('app').slow?.endedAt !== undefined);
});

test('errors route needs the token and starts empty', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/api/projects/app/errors')).status, 403);
  assert.deepEqual(JSON.parse((await s.call('GET', '/api/projects/app/errors', { 'X-Oberth-Token': TOKEN })).body), { count: 0, groups: [] });
});

test('git route: null outside a repository', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/api/projects/app/git')).body, 'null');
});

test('project listing carries the assistant session state', async () => {
  const s = setup();
  const [p] = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.deepEqual(p.assistant, { sessionId: 'local_1', title: 'work', at: 1, working: true, others: 0 });
});

test('VS Code and Finder open the project folder', async () => {
  const s = setup();
  await s.post('/api/projects/app/vscode');
  await s.post('/api/projects/app/finder');
  assert.deepEqual(s.editor, [`code ${s.dir}`, `finder ${s.dir}`]);
});

test('free-port without a conflict → 409, nothing stopped', async () => {
  const s = setup();
  assert.equal((await s.post('/api/projects/app/free-port')).status, 409);
});

test('a launch that failed on a taken port names the holder; Stop it and retry frees it and launches again', async () => {
  const appDir = makeTree({ 'a.txt': '' });
  const otherDir = makeTree({ 'b.txt': '' });
  const failing = [process.execPath, '-e', "console.error('Error: Port 5999 is already in use'); process.exit(1)"];
  const left = fakeLeftovers([999999]);
  const s = setup({
    listeners: () => (left.alive.has(999999) ? [{ pid: 999999, pgid: 999999, port: 5999, cwd: otherDir }] : []),
    projects: [
      { id: 'app', relPath: 'app', dir: appDir, name: 'App', kind: 'app', starter: { type: 'override', argv: failing }, scripts: {}, needsInstall: false },
      { id: 'other', relPath: 'other', dir: otherDir, name: 'Other', kind: 'app', starter: { type: 'override', argv: failing }, scripts: {}, needsInstall: false },
    ],
  });
  await s.post('/api/projects/app/launch', { mode: 'local' });
  await until(() => s.runner.state('app').status === 'failed');
  const list = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.deepEqual(list.find((p: any) => p.id === 'app').conflict, { port: 5999, holder: { kind: 'leftover', projectId: 'other', name: 'Other', pid: 999999 } });
  const r = await s.post('/api/projects/app/free-port');
  left.restore();
  assert.equal(r.status, 200);
  assert.deepEqual(left.killed, [999999]);
  assert.ok(['starting', 'failed'].includes(JSON.parse(r.body).status));
});

test('a port held by something outside ~/Dev is named but never stopped', async () => {
  const appDir = makeTree({ 'a.txt': '' });
  const failing = [process.execPath, '-e', "console.error('Error: Port 5998 is already in use'); process.exit(1)"];
  const s = setup({
    listeners: () => [{ pid: 999998, pgid: 999998, port: 5998, cwd: '/', command: 'Docker' }],
    projects: [{ id: 'app', relPath: 'app', dir: appDir, name: 'App', kind: 'app', starter: { type: 'override', argv: failing }, scripts: {}, needsInstall: false }],
  });
  await s.post('/api/projects/app/launch', { mode: 'local' });
  await until(() => s.runner.state('app').status === 'failed');
  const r = await s.post('/api/projects/app/free-port');
  assert.equal(r.status, 409);
  assert.match(JSON.parse(r.body).error, /Docker \(pid 999998, running in \/\), which isn't one of Oberth's projects/);
});

test('activity: launch, ready and stop are recorded for today', async () => {
  const s = setup();
  await s.post('/api/projects/app/launch', { mode: 'local' });
  await until(() => s.runner.state('app').status === 'running');
  await s.post('/api/projects/app/stop');
  const events = JSON.parse((await s.call('GET', '/api/activity')).body);
  assert.deepEqual(events.filter((e: any) => e.id === 'app').map((e: any) => e.kind), ['stopped', 'ready', 'launch']);
});

test('activity: session titles stay out of the route, which needs no token; commits show', async () => {
  const s = setup();
  const at = Date.now();
  s.activity.addOnce({ at, id: 'app', kind: 'session', text: 'secret title', key: 'turn' });
  s.activity.addOnce({ at, id: 'app', kind: 'commit', text: 'abc1234 fix', key: 'app:abc' });
  const events = JSON.parse((await s.call('GET', '/api/activity')).body);
  assert.deepEqual(events.map((e: any) => e.kind), ['commit']);
});

test('logbook: the week needs the token, takes real dates only, and names what it finds', async () => {
  const s = setup();
  const now = Date.now();
  s.activity.addOnce({ at: now, id: 'app', kind: 'session', text: 'a title', ms: 60_000, key: 't1' });
  s.activity.addOnce({ at: now, id: 'oberth', kind: 'session', text: 'own work', ms: 120_000, key: 't2' });
  s.activity.addOnce({ at: now, id: 'long-gone', kind: 'commit', text: 'abc old', key: 'c1' });
  assert.equal((await s.call('GET', '/api/logbook/week')).status, 403);
  const headers = { 'X-Oberth-Token': TOKEN };
  assert.equal((await s.call('GET', '/api/logbook/week?start=soon', headers)).status, 400);
  const w = JSON.parse((await s.call('GET', '/api/logbook/week', headers)).body);
  assert.equal(w.ms, 180_000);
  assert.deepEqual(w.projects.map((p: any) => [p.id, p.icon]), [['oberth', '/logo.svg'], ['app', '/api/icon/app'], ['long-gone', undefined]]);
  assert.equal(w.current, true);
  const page = await s.call('GET', '/logbook');
  assert.match(page.body, /logbook page/);
  assert.match(page.body, new RegExp(`oberth-token" content="${TOKEN}`));
  assert.equal((await s.call('GET', '/logbook.js')).status, 200);
});

test('recap: needs the token, carries the Logbook and the last prompt, and works outside a repository', async () => {
  const s = setup();
  s.activity.addOnce({ at: 1000, id: 'app', kind: 'session', text: 'a title', sessionId: 'x', ms: 500, key: 't1' });
  assert.equal((await s.call('GET', '/api/projects/app/recap')).status, 403);
  const r = JSON.parse((await s.call('GET', '/api/projects/app/recap', { 'X-Oberth-Token': TOKEN })).body);
  assert.deepEqual(r.sessions, [{ title: 'a title', at: 1500, ms: 500, turns: 1 }]);
  assert.equal(r.lastWorkAt, 1500);
  assert.deepEqual(r.commits, []);
  assert.equal(r.left, undefined);
});

test('Stop it and retry stops a whole leftover (all its ports) and relaunches in the mode that failed', async () => {
  const appDir = makeTree({ 'package.json': JSON.stringify({ scripts: { dev: `node -e "console.error('Error: Port 5997 is already in use'); process.exit(1)"` } }) });
  // the project's own leftover dev server, holding the port and an HMR port; it shows up after the first launch failed
  let appeared = false;
  const left = fakeLeftovers([999997, 999996]);
  const s = setup({
    listeners: () => (appeared ? [
      { pid: 999997, pgid: 999997, port: 5997, cwd: appDir },
      { pid: 999996, pgid: 999996, port: 24678, cwd: appDir },
    ].filter((l) => left.alive.has(l.pid)) : []),
    projects: [{ id: 'app', relPath: 'app', dir: appDir, name: 'App', kind: 'app', starter: { type: 'npm-dev', devScript: 'vite' }, scripts: { dev: 'vite' }, needsInstall: false }],
  });
  assert.equal((await s.post('/api/projects/app/launch', { mode: 'lan' })).status, 200);
  await until(() => s.runner.state('app').status === 'failed', 15_000);
  assert.equal(s.runner.state('app').mode, 'lan');
  appeared = true;
  const r = await s.post('/api/projects/app/free-port');
  left.restore();
  assert.equal(r.status, 200, r.body); // a surviving HMR listener would make phone mode refuse with 409
  assert.equal(JSON.parse(r.body).mode, 'lan');
  assert.deepEqual(left.killed.sort(), [999996, 999997]);
});

test('about: written with the token, validated, shown in the listing and the About route', async () => {
  const s = setup();
  assert.equal((await s.call('POST', '/api/projects/app/about', {}, { description: 'x' })).status, 403);
  assert.equal((await s.post('/api/projects/app/about', { status: 'dead' })).status, 400);
  const saved = JSON.parse((await s.post('/api/projects/app/about', { description: ' A test app. ', status: 'paused', notes: 'Left off at X.' })).body);
  assert.equal(saved.description, 'A test app.');
  const [p] = JSON.parse((await s.call('GET', '/api/projects')).body).filter((x: any) => x.id === 'app');
  assert.deepEqual({ d: p.about.description, s: p.about.status, n: p.about.notes }, { d: 'A test app.', s: 'paused', n: 'Left off at X.' });
  assert.ok(Array.isArray(p.stack));
  const about = JSON.parse((await s.call('GET', '/api/projects/app/about')).body);
  assert.equal(about.about.notes, 'Left off at X.');
  assert.equal(about.facts.visibility, 'local');
  assert.deepEqual(loadSettings(s.stateDir).hidden, []); // settings untouched
});

test('a library has nothing to launch: 400, and no phone mode', async () => {
  const dir = makeTree({ 'pyproject.toml': '' });
  const s = setup({ projects: [{ id: 'lib', relPath: 'lib', dir, name: 'Lib', kind: 'library', starter: { type: 'none' }, scripts: {}, needsInstall: false }] });
  const r = await s.post('/api/projects/lib/launch', { mode: 'local' });
  assert.equal(r.status, 400);
  assert.match(JSON.parse(r.body).error, /no dev server/);
  const [p] = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.equal(p.phone, false);
  assert.equal(s.runner.state('lib').status, 'stopped');
});

const blocked = (dir: string, over: Partial<ClaudeSession> = {}): ClaudeSession => ({
  id: 'local_abc', title: 'work', folder: dir, lastActivityAt: 1000, latestUserFrameAt: 500, lastTurnEdgeAt: 1000, lastAssistantUuid: 'u1',
  summary: { status: 'blocked', needsAction: '<script>alert(1)</script>', forUuid: 'u1' }, ...over,
});
const sessionSource = (extra: Partial<ClaudeSession> = {}) => (dir: string) => ({ sessions: () => ({ sessions: [blocked(dir, extra)], files: 1, parsed: 1, summaries: 1 }) });
const backupFailing = () => ({ backup: () => ({ exit: 1, line: '2026-11-04 10:00:00 rsync exit 1', at: 1, error: 'mmap failed' }) });

test('GET /api/agenda needs the token and lists the session item with its action', async () => {
  const s = setup({ sources: sessionSource() });
  assert.equal((await s.call('GET', '/api/agenda')).status, 403);
  const a = JSON.parse((await s.call('GET', '/api/agenda', { 'X-Oberth-Token': TOKEN })).body);
  assert.equal(a.count, 1);
  assert.equal(a.needs[0].key, 'session:local_abc');
  assert.ok(['app', 'win'].includes(a.needs[0].projectId)); // the two fake projects share a folder
  assert.deepEqual(a.needs[0].action, { kind: 'session', sessionId: 'local_abc' });
});

test('/api/agenda/open opens the exact session, and refuses a key that is not on the list', async () => {
  const s = setup({ sources: sessionSource() });
  assert.equal((await s.post('/api/agenda/open', { key: 'session:local_abc' })).status, 200);
  assert.deepEqual(s.claude, ['session local_abc']);
  assert.equal((await s.post('/api/agenda/open', { key: 'session:local_other' })).status, 404);
  assert.equal((await s.post('/api/agenda/open', { key: 'backup' })).status, 404);
  assert.equal((await s.call('POST', '/api/agenda/open', {}, { key: 'session:local_abc' })).status, 403);
  assert.equal(s.claude.length, 1);
});

test('/api/agenda/open reveals the backup log for the backup item', async () => {
  const s = setup({ sources: backupFailing });
  assert.equal((await s.post('/api/agenda/open', { key: 'backup' })).status, 200);
  assert.deepEqual(s.editor, ['reveal /logs/backup.log']);
});

test('/api/agenda/later hides an item and refuses one that is not on the list', async () => {
  const s = setup({ sources: sessionSource() });
  assert.equal((await s.post('/api/agenda/later', { key: 'nope' })).status, 404);
  assert.equal((await s.post('/api/agenda/later', { key: 'session:local_abc' })).status, 200);
  const a = JSON.parse((await s.call('GET', '/api/agenda', { 'X-Oberth-Token': TOKEN })).body);
  assert.equal(a.count, 0);
});

test('asks: added, listed, shown on the agenda, closed; bad input refused', async () => {
  const s = setup();
  assert.equal((await s.call('POST', '/api/projects/app/asks', {}, { text: 'x' })).status, 403);
  assert.equal((await s.post('/api/projects/app/asks', { text: ' ' })).status, 400);
  assert.equal((await s.post('/api/projects/app/asks', { text: 'y'.repeat(201) })).status, 400);
  assert.equal((await s.post('/api/projects/nope/asks', { text: 'x' })).status, 404);
  const ask = JSON.parse((await s.post('/api/projects/app/asks', { text: 'Review this', detail: 'd' })).body);
  const open = JSON.parse((await s.call('GET', '/api/projects/app/asks', { 'X-Oberth-Token': TOKEN })).body);
  assert.deepEqual(open.map((a: any) => a.id), [ask.id]);
  const a = JSON.parse((await s.call('GET', '/api/agenda', { 'X-Oberth-Token': TOKEN })).body);
  assert.equal(a.needs[0].title, 'Review this');
  assert.equal((await s.post('/api/agenda/open', { key: `ask:${ask.id}` })).status, 200);
  assert.deepEqual(s.claude, [s.dir]); // no session recorded: the project's own Claude button
  assert.equal((await s.post(`/api/agenda/asks/${ask.id}/done`)).status, 200);
  assert.equal((await s.post(`/api/agenda/asks/${ask.id}/done`)).status, 404);
  assert.equal(JSON.parse((await s.call('GET', '/api/agenda', { 'X-Oberth-Token': TOKEN })).body).count, 0);
});

test('the eleventh open ask in a project is refused', async () => {
  const s = setup();
  for (let i = 0; i < 10; i++) assert.equal((await s.post('/api/projects/app/asks', { text: `ask ${i}` })).status, 200);
  assert.equal((await s.post('/api/projects/app/asks', { text: 'one more' })).status, 409);
  assert.equal((await s.post('/api/projects/win/asks', { text: 'elsewhere' })).status, 200);
});

test('a hidden project makes no agenda items', async () => {
  const s = setup({ sources: sessionSource() });
  await s.post('/api/projects/app/hide');
  await s.post('/api/projects/win/hide'); // both fake projects share a folder
  assert.equal(JSON.parse((await s.call('GET', '/api/agenda', { 'X-Oberth-Token': TOKEN })).body).count, 0);
});

test('/api/recall needs the token and sensible input, and opens only what a search handed out', async () => {
  const s = setup();
  const auth = { 'X-Oberth-Token': TOKEN };
  assert.equal((await s.call('GET', '/api/recall?q=zebra')).status, 403);
  assert.equal((await s.call('GET', '/api/recall?q=z', auth)).status, 400);
  assert.equal((await s.call('GET', `/api/recall?q=${'z'.repeat(201)}`, auth)).status, 400);
  assert.equal((await s.call('GET', '/api/recall?q=zebra&kind=everything', auth)).status, 400);
  writeFileSync(join(s.dir, 'zebra.txt'), 'the zebra\n');
  const { hits } = JSON.parse((await s.call('GET', '/api/recall?q=zebra', auth)).body);
  assert.deepEqual(hits.map((h: any) => h.kind).sort(), ['docs', 'notes']);
  const doc = hits.find((h: any) => h.kind === 'docs');
  assert.equal((await s.call('POST', '/api/recall/open', {}, { key: doc.key })).status, 403);
  assert.equal((await s.post('/api/recall/open', { key: 'docs:app:/etc/hosts:1' })).status, 404);
  assert.equal((await s.post('/api/recall/open', { key: doc.key })).status, 200);
  assert.deepEqual(s.editor, [`file ${join(s.dir, 'zebra.txt')}:1`]);
});

test('pre-flight: dependencies out of date show in the listing, and launch runs npm install first', async () => {
  const dir = makeTree({
    'package.json': JSON.stringify({ dependencies: { vite: '^5' } }),
    'package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/vite': { version: '5.2.0' } } }),
    'node_modules/.package-lock.json': JSON.stringify({ packages: { 'node_modules/vite': { version: '5.1.0' } } }),
    'node_modules/vite/package.json': '{}',
    'bin/npm': '#!/bin/sh\necho "fake npm $*"\n',
  });
  chmodSync(join(dir, 'bin/npm'), 0o755);
  const s = setup({
    pathEnv: `${join(dir, 'bin')}:${process.env.PATH}`,
    projects: [{ id: 'app', relPath: 'app', dir, name: 'App', kind: 'app', starter: { type: 'override', argv: [process.execPath, FAKE] }, scripts: {}, needsInstall: false }],
  });
  const [p] = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.deepEqual(p.preflight.map((f: any) => f.short), ['deps out of date']);
  assert.equal((await s.post('/api/projects/app/launch', { mode: 'local', open: false })).status, 200);
  await until(() => s.runner.state('app').status === 'running', 15_000);
  assert.match(readFileSync(s.runner.logPath('app'), 'utf8'), /fake npm install/);
  const [running] = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.deepEqual(running.preflight, [], 'a running project has passed');
});

test('ideas: the token guards them; captured, noted, moved, dropped and restored; listed in sections', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/api/ideas')).status, 403);
  const a = JSON.parse((await s.post('/api/ideas', { title: 'Recipe scaler', source: 'cli' })).body);
  const b = JSON.parse((await s.post('/api/ideas', { title: 'Share as image', note: 'PNG card https://x.org/a', projectId: 'app', source: 'mcp', sessionId: 'local_9' })).body);
  assert.equal((await s.post('/api/ideas', { title: 'x', projectId: 'nope' })).status, 400);
  assert.equal((await s.post('/api/ideas', { title: 'Logbook retrospective', projectId: 'oberth' })).status, 200, 'Oberth itself takes ideas');
  assert.equal((await s.post(`/api/ideas/${a.id}/notes`, { text: 'by servings', source: 'dashboard' })).status, 200);
  const get = async (q = '') => JSON.parse((await s.call('GET', `/api/ideas${q}`, { 'X-Oberth-Token': TOKEN })).body);
  let v = await get();
  assert.deepEqual(v.newProjects.map((i: any) => i.title), ['Recipe scaler']);
  assert.deepEqual(v.forProjects.map((i: any) => [i.title, i.projectName]), [['Logbook retrospective', 'Oberth'], ['Share as image', 'App']]);
  const shown = v.forProjects.find((i: any) => i.id === b.id);
  assert.deepEqual(shown.links, ['https://x.org/a']);
  assert.match(shown.brief, /^Idea for App: Share as image/);
  assert.equal(v.open, 3);
  assert.deepEqual((await get('?project=app')).forProjects.map((i: any) => i.id), [b.id]);

  // the session it came from opens; moving to a new-project idea and back; drop, restore
  assert.equal((await s.post(`/api/ideas/${b.id}/session`)).status, 200);
  assert.deepEqual(s.claude.slice(-1), ['session local_9']);
  assert.equal((await s.post(`/api/ideas/${a.id}/session`)).status, 404);
  assert.equal(JSON.parse((await s.post(`/api/ideas/${b.id}`, { projectId: null })).body).projectId, undefined);
  assert.equal(JSON.parse((await s.post(`/api/ideas/${b.id}`, { projectId: 'app', title: 'Share a ranking as an image' })).body).title, 'Share a ranking as an image');
  await s.post(`/api/ideas/${a.id}/drop`);
  v = await get();
  assert.deepEqual(v.dropped.map((i: any) => i.id), [a.id]);
  await s.post(`/api/ideas/${a.id}/restore`);
  assert.equal((await get()).newProjects.length, 1);
  assert.equal((await s.post('/api/ideas/izzz/drop')).status, 404);

  // a project with About status idea is listed as Started
  await s.post('/api/projects/app/about', { status: 'idea' });
  assert.deepEqual((await get()).started.map((p: any) => p.id), ['app']);
});

test('ideas: a project idea starts as a new Claude session in the project; done marks it without one', async () => {
  const s = setup();
  const b = JSON.parse((await s.post('/api/ideas', { title: 'Share as image', projectId: 'app' })).body);
  const c = JSON.parse((await s.post('/api/ideas', { title: 'Keyboard shortcuts', projectId: 'app' })).body);
  assert.equal((await s.post(`/api/ideas/${b.id}/start`, { brief: '' })).status, 400);
  assert.equal((await s.post(`/api/ideas/${b.id}/start`, { brief: 'Do the PNG card.' })).status, 200);
  assert.deepEqual(s.claude.slice(-1), [`new ${s.dir} :: Do the PNG card.`]);
  assert.equal((await s.post(`/api/ideas/${b.id}/start`, { brief: 'again' })).status, 409);
  assert.equal(JSON.parse((await s.post(`/api/ideas/${c.id}/done`)).body).started.claude, false);
  const v = JSON.parse((await s.call('GET', '/api/ideas', { 'X-Oberth-Token': TOKEN })).body);
  assert.deepEqual(v.done.map((i: any) => i.id).sort(), [b.id, c.id].sort());
  assert.ok(s.activity.today().some((e) => e.kind === 'idea' && e.id === 'app'));
  assert.ok(!JSON.parse((await s.call('GET', '/api/activity')).body).some((e: any) => e.kind === 'idea'), 'idea titles stay out of the tokenless route');
});

test('ideas: a new-project idea starts as a folder with git init, its About and a Claude session; names are checked', async () => {
  const devRoot = realpathSync(makeTree({ 'games/': '', 'app/': '', 'private-one/': '', '.hidden/': '' }));
  const s = setup({ devRoot, projects: [{ id: 'app', relPath: 'app', dir: join(devRoot, 'app'), name: 'App', kind: 'app', starter: { type: 'none' }, scripts: {}, needsInstall: false }] });
  const groups = JSON.parse((await s.call('GET', '/api/ideas/groups', { 'X-Oberth-Token': TOKEN })).body);
  assert.deepEqual(groups.map((g: any) => g.name), ['', 'games'], 'not a project, not left out, not hidden');
  const i = JSON.parse((await s.post('/api/ideas', { title: 'Board game rules', note: 'Paste a rulebook.' })).body);
  const start = (body: object) => s.post(`/api/ideas/${i.id}/start`, { brief: 'Build it.', ...body });
  assert.equal((await start({ folder: 'Bad Name', group: '' })).status, 400);
  assert.equal((await start({ folder: 'ok', group: '../etc' })).status, 400);
  assert.equal((await start({ folder: 'ok', group: 'private-one' })).status, 400);
  assert.equal((await start({ folder: 'games', group: '' })).status, 409, 'an existing folder is never reused');
  const r = await start({ folder: 'board-game-rules', group: 'games', status: 'active' });
  assert.equal(r.status, 200, r.body);
  assert.equal(JSON.parse(r.body).projectId, 'games__board-game-rules');
  const dir = join(devRoot, 'games/board-game-rules');
  assert.ok(existsSync(join(dir, '.git/HEAD')));
  assert.deepEqual(readdirSync(dir), ['.git'], 'nothing else is written in it');
  const saved = JSON.parse(readFileSync(join(s.stateDir, 'about.json'), 'utf8'))['games__board-game-rules'];
  assert.deepEqual({ d: saved.description, s: saved.status, n: saved.notes }, { d: 'Board game rules', s: 'active', n: 'Build it.' });
  assert.deepEqual(s.claude.slice(-1), [`new ${dir} :: Build it.`]);
  assert.equal((await start({ folder: 'other', group: '' })).status, 409, 'started once');
});

test('stable addresses: the listing and Info carry them while the proxy is up; Safari opens them; window apps get none', async () => {
  const off = setup();
  assert.equal(JSON.parse((await off.call('GET', '/api/projects')).body).find((p: any) => p.id === 'app').address, undefined, 'no proxy, no address');
  const s = setup({ proxy: true });
  const list = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.equal(list.find((p: any) => p.id === 'app').address, 'http://app.localhost:7700/');
  assert.equal(list.find((p: any) => p.id === 'win').address, undefined, 'a window app serves no page');
  assert.equal(JSON.parse((await s.call('GET', '/api/projects/app/info', { 'X-Oberth-Token': TOKEN })).body).address, 'http://app.localhost:7700/');
  await s.post('/api/projects/app/launch', { mode: 'local' });
  await until(() => s.opened.length > 0);
  assert.deepEqual(s.opened, ['http://app.localhost:7700/']);
});

test('stable addresses: a project whose logins are pinned to its port (openPort) still opens on its own address', async () => {
  const s = setup({ proxy: true, defaults: { app: { openPort: true } } });
  const p = JSON.parse((await s.call('GET', '/api/projects')).body).find((x: any) => x.id === 'app');
  assert.equal(p.address, 'http://app.localhost:7700/', 'it keeps its address');
  assert.equal(p.openPort, true);
  await s.post('/api/projects/app/launch', { mode: 'local' });
  await until(() => s.opened.length > 0);
  assert.match(s.opened[0], /^http:\/\/localhost:\d+\/$/);
});

test('an outside-world item opens its stored link in Safari, and only a link Oberth may open', async () => {
  let url = 'https://github.com/someone/app/issues/1';
  const item = () => ({ key: 'outside:app#1', level: 'needs' as const, source: 'outside' as const, projectId: 'app', where: 'App', title: 'Crash', since: 1, fingerprint: url, action: { kind: 'url' as const, url } });
  const s = setup({ sources: () => ({ outside: () => [item()] }), outside: { facts: () => undefined, openable: (u) => u.startsWith('https://github.com/') } });
  assert.equal((await s.post('/api/agenda/open', { key: 'outside:app#1' })).status, 200);
  assert.deepEqual(s.opened, ['https://github.com/someone/app/issues/1']);
  url = 'https://evil.example/';
  const r = await s.post('/api/agenda/open', { key: 'outside:app#1' });
  assert.equal(r.status, 400);
  assert.equal(s.opened.length, 1, 'a link that fails the check is never opened');
});

test('resume: opens a new Claude session in the project with the recap and notes typed in', async () => {
  const s = setup();
  await s.post('/api/projects/app/about', { status: 'paused', notes: 'Left at the zebra.' });
  assert.equal((await s.post('/api/projects/app/resume')).status, 200);
  const last = s.claude.at(-1)!;
  assert.ok(last.startsWith(`new ${s.dir} :: I'm picking up App again`), last);
  assert.match(last, /My notes on it:\nLeft at the zebra\./);
  assert.equal((await s.call('POST', '/api/projects/app/resume')).status, 403, 'needs the token');
});

test('review: a past week read back, token needed; status changes only the status', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/api/review?start=2026-11-02')).status, 403);
  assert.equal((await s.call('GET', '/api/review?start=nope', { 'X-Oberth-Token': TOKEN })).status, 400);
  const r = JSON.parse((await s.call('GET', '/api/review', { 'X-Oberth-Token': TOKEN })).body);
  assert.ok(Array.isArray(r.untouched) && Array.isArray(r.top), 'last week by default');
  await s.post('/api/projects/app/about', { description: 'Kept.', notes: 'Also kept.', status: 'active' });
  assert.equal((await s.post('/api/projects/app/status', { status: 'nonsense' })).status, 400);
  const saved = JSON.parse((await s.post('/api/projects/app/status', { status: 'paused' })).body);
  assert.deepEqual([saved.status, saved.description, saved.notes], ['paused', 'Kept.', 'Also kept.']);
});

test('review seen: the Logbook reports a shown review; a bad date is refused; the token is needed', async () => {
  const s = setup();
  assert.equal((await s.call('POST', '/api/review/seen', {}, { start: '2026-11-02' })).status, 403);
  assert.equal((await s.post('/api/review/seen', { start: '../x' })).status, 400);
  assert.equal((await s.post('/api/review/seen', { start: '2026-11-02' })).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(s.stateDir, 'review.json'), 'utf8')).seen, ['2026-11-02']);
});

test('sidebar: every page gets the one shared sidebar, the same links, with its own link marked current', async () => {
  const s = setup({ dashboardDir: new URL('../dashboard/', import.meta.url).pathname });
  const navOf = async (path: string) => {
    const html = (await s.call('GET', path)).body;
    assert.ok(!html.includes('<!--sidebar-->'), `${path}: the marker is replaced`);
    const navs = html.match(/<nav class="side"[\s\S]*?<\/nav>/g) ?? [];
    assert.equal(navs.length, 1, `${path}: exactly one sidebar`);
    const links = [...navs[0].matchAll(/<a class="(nav[^"]*)" href="([^"]*)"[^>]*>[\s\S]*?<span class="lbl">([^<]*)<\/span>/g)];
    return { links: links.map((m) => [m[2], m[3]]), current: links.filter((m) => m[1] === 'nav on' && m[0].includes('aria-current="page"')).map((m) => m[3]) };
  };
  const [home, logbook, about] = await Promise.all(['/', '/logbook', '/about'].map(navOf));
  assert.deepEqual(home.links, [['/', 'Projects'], ['/#agenda', 'Agenda'], ['/#ideas', 'Ideas'], ['/logbook', 'Logbook'], ['/about', 'About']]);
  assert.deepEqual(logbook.links, home.links);
  assert.deepEqual(about.links, home.links);
  assert.deepEqual([home.current, logbook.current, about.current], [['Projects'], ['Logbook'], ['About']]);
  assert.ok(!(await s.call('GET', '/about')).body.includes('oberth-token'), 'the About page still carries no token');
});

test('sidebar counts: every page is served with the Needs you and Ideas counts, the script-free About page included', async () => {
  const s = setup({ dashboardDir: new URL('../dashboard/', import.meta.url).pathname });
  const counts = async (path: string) => {
    const html = (await s.call('GET', path)).body;
    return [/<span class="n" id="nav-need">([^<]*)<\/span>/.exec(html)?.[1], /<span class="n grey" id="nav-ideas-n">([^<]*)<\/span>/.exec(html)?.[1]];
  };
  assert.deepEqual(await counts('/about'), ['', ''], 'nothing waiting: empty, so the badges hide');
  assert.equal((await s.post('/api/projects/app/asks', { text: 'Review the matches' })).status, 200);
  assert.equal((await s.post('/api/ideas', { title: 'Recipe scaler' })).status, 200);
  for (const path of ['/', '/logbook', '/about']) assert.deepEqual(await counts(path), ['1', '1'], path);
});

test('no assistant: no session state, its routes refuse, and a new idea opens in the editor instead', async () => {
  const devRoot = realpathSync(makeTree({ 'app/': '' }));
  const s = setup({ noAssistant: true, devRoot });
  const [p] = JSON.parse((await s.call('GET', '/api/projects')).body);
  assert.equal(p.assistant, undefined);
  assert.equal(JSON.parse((await s.call('GET', '/api/config')).body).assistant, null);
  assert.equal((await s.post('/api/projects/app/assistant')).status, 404);
  assert.equal((await s.post('/api/projects/app/resume')).status, 404);
  const i = JSON.parse((await s.post('/api/ideas', { title: 'Plant tracker' })).body);
  const r = await s.post(`/api/ideas/${i.id}/start`, { brief: 'Track watering.', folder: 'plant-tracker', group: '' });
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(s.editor.slice(-1), [`code ${join(devRoot, 'plant-tracker')}`]);
  assert.equal(s.claude.length, 0, 'no session opened');
  const forProject = JSON.parse((await s.post('/api/ideas', { title: 'Dark mode', projectId: 'app' })).body);
  assert.equal((await s.post(`/api/ideas/${forProject.id}/start`, { brief: 'x' })).status, 409, 'nothing to start it in: mark it done');
});

test('modules that are off: their routes and sidebar links go, asks are refused rather than lost', async () => {
  const s = setup({ modules: { agenda: false, ideas: false, logbook: false }, dashboardDir: makeTree({ 'index.html': '<html><head></head><body><!--sidebar--></body></html>', 'sidebar.html': '<nav><a class="nav" href="/#agenda" id="nav-agenda" data-page="agenda">Agenda</a><a class="nav" href="/#ideas" data-page="ideas">Ideas</a><a class="nav" href="/logbook" data-page="logbook">Logbook</a><a class="nav" href="/about" data-page="about">About</a></nav>', 'logbook.html': '' }) });
  const page = (await s.call('GET', '/')).body;
  assert.ok(!/data-page="(agenda|ideas|logbook)"/.test(page) && /data-page="about"/.test(page), page);
  assert.equal((await s.call('GET', '/logbook')).status, 404);
  assert.equal((await s.call('GET', '/api/ideas', { 'X-Oberth-Token': TOKEN })).status, 404);
  assert.equal((await s.post('/api/ideas', { title: 'x' })).status, 404);
  assert.equal((await s.post('/api/projects/app/asks', { text: 'Review this' })).status, 404);
  assert.equal((await s.call('GET', '/api/logbook/week', { 'X-Oberth-Token': TOKEN })).status, 404);
});
