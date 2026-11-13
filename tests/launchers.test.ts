// The launchers (service/launchers.ts), one by one. A launcher you add gets a test like these: detect on a folder
// made with makeTree, and plan on a project built by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTree } from './fixtures/tree.ts';
import { hugo, LAUNCHERS, launcherOf, npmDev, override, servePy, staticSite, type PlanBase } from '../service/launchers.ts';
import type { Project } from '../service/types.ts';

const base = (o: Partial<PlanBase> = {}): PlanBase => ({ mode: 'local', lan: false, base: { cwd: '/p', env: {} }, install: [], port: '4100', localUrl: 'http://localhost:4100/', lanIp: '192.168.1.5', ...o });
const project = (o: Partial<Project>): Project => ({ id: 'p', relPath: 'p', dir: '/p', name: 'P', kind: 'app', starter: { type: 'none' }, scripts: {}, needsInstall: false, ...o });

test('every launcher has a unique type, and override is never detected', () => {
  assert.equal(new Set(LAUNCHERS.map((l) => l.type)).size, LAUNCHERS.length);
  assert.equal(override.detect(makeTree({ 'index.html': '' }), null), null);
});

test('npm-dev: a dev script; Electron makes a window app; phone mode for plain Vite only', () => {
  assert.equal(npmDev.detect('/x', { scripts: { build: 'x' } }), null);
  assert.deepEqual(npmDev.detect('/x', { scripts: { dev: 'vite' } }), { kind: 'app', starter: { type: 'npm-dev', devScript: 'vite' } });
  assert.equal(npmDev.detect('/x', { scripts: { dev: 'electron-vite dev' }, devDependencies: { 'electron-vite': '1' } })!.kind, 'window');
  const p = project({ starter: { type: 'npm-dev', devScript: 'vite' }, packageManager: 'pnpm' });
  assert.deepEqual(npmDev.plan(p, base())!.steps, [{ argv: ['pnpm', 'run', 'dev'] }]);
  assert.deepEqual(npmDev.plan(p, base({ lan: true, mode: 'lan' }))!.steps, [{ argv: ['pnpm', 'run', 'dev', '--host'] }]);
  assert.equal(npmDev.plan(project({ starter: { type: 'npm-dev', devScript: 'next dev' } }), base({ lan: true, mode: 'lan' })), null);
  assert.equal(npmDev.describe(p), 'pnpm run dev');
  assert.equal(npmDev.program(p), 'pnpm');
});

test('hugo: a config plus themes or layouts; the stable address becomes its base URL', () => {
  assert.equal(hugo.detect(makeTree({ 'hugo.toml': '' }), null), null);
  assert.deepEqual(hugo.detect(makeTree({ 'hugo.toml': '', 'layouts/': '' }), null), { kind: 'site', starter: { type: 'hugo' } });
  const plan = hugo.plan(project({ kind: 'site', starter: { type: 'hugo' } }), base({ address: 'http://blog.localhost:7700/' }))!;
  assert.deepEqual(plan.steps[0].argv, ['hugo', 'server', '--port', '4100', '--baseURL', 'http://blog.localhost:7700/', '--appendPort=false', '--liveReloadPort', '7700']);
  assert.equal(plan.localUrl, 'http://localhost:4100/');
});

test('serve.py and static sites take the port Oberth picks', () => {
  assert.deepEqual(servePy.plan(project({ starter: { type: 'serve-py' } }), base())!.steps, [{ argv: ['python3', 'serve.py', '4100'] }]);
  assert.equal(servePy.plan(project({ starter: { type: 'serve-py' } }), base({ lan: true, mode: 'lan' })), null);
  assert.deepEqual(staticSite.plan(project({ starter: { type: 'static' } }), base({ lan: true, mode: 'lan' }))!.steps[0].argv, ['python3', '-m', 'http.server', '4100', '--bind', '0.0.0.0', '--directory', '/p']);
});

test('override runs the command from .oberth.json, after an install when one is due', () => {
  const p = project({ starter: { type: 'override', argv: ['.venv/bin/python', 'app.py', '--port', '8000'] } });
  assert.deepEqual(override.plan(p, base({ install: [{ argv: ['npm', 'install'], label: 'install' }] }))!.steps.map((s) => s.argv[0]), ['npm', '.venv/bin/python']);
  assert.equal(override.program(p), '.venv/bin/python');
  assert.match(override.commandLine!(p), /--port 8000/);
});

test('launcherOf finds a project\'s launcher by its starter type', () => {
  assert.equal(launcherOf(project({ starter: { type: 'hugo' } })), hugo);
  assert.equal(launcherOf(project({ starter: { type: 'none' } })), undefined);
});
