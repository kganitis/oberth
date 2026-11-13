import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, phoneAvailable } from '../service/commands.ts';
import type { Project, Starter, Kind } from '../service/types.ts';

const proj = (starter: Starter, extra: Partial<Project> = {}): Project => ({
  id: 'p', relPath: 'p', dir: '/Dev/p', name: 'P', kind: 'app' as Kind, starter, scripts: {}, needsInstall: false, ...extra,
});
const opts = { port: 4321, lanIp: '192.168.1.24', pathEnv: '/nvm/bin:/usr/bin' };
const argv = (p: Project, mode: 'local' | 'lan', o = opts) => buildPlan(p, mode, o)?.steps.map((s) => s.argv) ?? null;
const vite = { type: 'npm-dev', devScript: 'vite' } as const;

test('vite app needing install: install then dev', () => {
  assert.deepEqual(argv(proj(vite, { needsInstall: true }), 'local'), [['npm', 'install'], ['npm', 'run', 'dev']]);
});

test('vite app lan adds --host', () => {
  assert.deepEqual(argv(proj(vite), 'lan'), [['npm', 'run', 'dev', '--', '--host']]);
});

test('concurrently app with start:lan builds then serves', () => {
  const p = proj({ type: 'npm-dev', devScript: 'concurrently "node server" "vite"' }, { scripts: { 'start:lan': 'HOST=0.0.0.0 node server' } });
  assert.deepEqual(argv(p, 'lan'), [['npm', 'run', 'build'], ['npm', 'run', 'start:lan']]);
  assert.equal(buildPlan(p, 'lan', opts)?.lanNote, 'Phone mode serves a fresh build, not live reload');
  assert.equal(phoneAvailable(p), true);
});

test('concurrently app without start:lan has no phone mode', () => {
  const p = proj({ type: 'npm-dev', devScript: 'concurrently -k "tsx a.ts" "vite --port 5180"' });
  assert.equal(buildPlan(p, 'lan', opts), null);
  assert.equal(phoneAvailable(p), false);
});

test('window app: no lan, local plan is flagged window', () => {
  const p = proj({ type: 'npm-dev', devScript: 'electron-vite dev' }, { kind: 'window' });
  assert.equal(buildPlan(p, 'lan', opts), null);
  assert.equal(phoneAvailable(p), false);
  const plan = buildPlan(p, 'local', opts);
  assert.deepEqual(plan?.steps.map((s) => s.argv), [['npm', 'run', 'dev']]);
  assert.equal(plan?.window, true);
});

test('hugo with a stable address: links and live reload go through the proxy, locally only', () => {
  const p = proj({ type: 'hugo' }, { kind: 'site' });
  const o = { ...opts, address: 'http://p.localhost:7700/' };
  assert.deepEqual(argv(p, 'local', o), [['hugo', 'server', '--port', '4321', '--baseURL', 'http://p.localhost:7700/', '--appendPort=false', '--liveReloadPort', '7700']]);
  assert.deepEqual(argv(p, 'lan', o), [['hugo', 'server', '--port', '4321', '--bind', '0.0.0.0', '--baseURL', 'http://192.168.1.24:4321/']]);
  assert.equal(buildPlan(p, 'local', o)!.localUrl, 'http://localhost:4321/', 'readiness still probes the real port');
});

test('hugo local and lan', () => {
  const p = proj({ type: 'hugo' }, { kind: 'site' });
  assert.deepEqual(argv(p, 'local'), [['hugo', 'server', '--port', '4321']]);
  assert.deepEqual(argv(p, 'lan'), [['hugo', 'server', '--port', '4321', '--bind', '0.0.0.0', '--baseURL', 'http://192.168.1.24:4321/']]);
});

test('serve.py local passes the port; no lan', () => {
  const p = proj({ type: 'serve-py' }, { kind: 'site' });
  assert.deepEqual(argv(p, 'local', { ...opts, port: 8765 }), [['python3', 'serve.py', '8765']]);
  assert.equal(buildPlan(p, 'lan', opts), null);
});

test('static local and lan', () => {
  const p = proj({ type: 'static' }, { kind: 'site' });
  const o = { ...opts, port: 4400 };
  assert.deepEqual(argv(p, 'local', o), [['python3', '-m', 'http.server', '4400', '--bind', '127.0.0.1', '--directory', '/Dev/p']]);
  assert.deepEqual(argv(p, 'lan', o), [['python3', '-m', 'http.server', '4400', '--bind', '0.0.0.0', '--directory', '/Dev/p']]);
});

test('override argv is used as is; no lan', () => {
  const p = proj({ type: 'override', argv: ['x', 'y'] });
  assert.deepEqual(argv(p, 'local'), [['x', 'y']]);
  assert.equal(buildPlan(p, 'lan', opts), null);
});

test('env and cwd', () => {
  const plan = buildPlan(proj(vite), 'local', opts)!;
  assert.equal(plan.env.BROWSER, '/usr/bin/true');
  assert.equal(plan.env.FORCE_COLOR, '1');
  assert.equal(plan.env.PATH, '/nvm/bin:/usr/bin');
  assert.equal(plan.cwd, '/Dev/p');
});

test('override starter with kind window is flagged window, no lan', () => {
  const p = proj({ type: 'override', argv: ['x'] }, { kind: 'window' });
  assert.equal(buildPlan(p, 'local', opts)?.window, true);
  assert.equal(buildPlan(p, 'lan', opts), null);
});

test('python output is unbuffered so the banner is seen', () => {
  assert.equal(buildPlan(proj({ type: 'static' }, { kind: 'site' }), 'local', opts)!.env.PYTHONUNBUFFERED, '1');
});

test('known-port plans carry a localUrl to probe (hugo lan prints only the LAN address)', () => {
  assert.equal(buildPlan(proj({ type: 'hugo' }, { kind: 'site' }), 'lan', opts)!.localUrl, 'http://localhost:4321/');
  assert.equal(buildPlan(proj({ type: 'static' }, { kind: 'site' }), 'local', opts)!.localUrl, 'http://localhost:4321/');
  assert.equal(buildPlan(proj({ type: 'serve-py' }, { kind: 'site' }), 'local', opts)!.localUrl, 'http://localhost:4321/');
  assert.equal(buildPlan(proj(vite), 'local', opts)!.localUrl, undefined);
});

test('a project url becomes the plan localUrl, for any starter', () => {
  assert.equal(buildPlan(proj(vite, { url: 'http://localhost:4000/app/' }), 'local', opts)!.localUrl, 'http://localhost:4000/app/');
  assert.equal(buildPlan(proj({ type: 'static' }, { kind: 'site', url: 'http://localhost:9/' }), 'local', opts)!.localUrl, 'http://localhost:9/');
});
