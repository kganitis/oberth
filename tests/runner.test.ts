import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runner } from '../service/runner.ts';
import type { RunPlan } from '../service/types.ts';

const FAKE = new URL('./fixtures/fake-server.ts', import.meta.url).pathname;
const node = process.execPath;
const plan = (env: Record<string, string> = {}, extra: Partial<RunPlan> = {}): RunPlan => ({
  cwd: tmpdir(), env: { ...process.env, ...env } as Record<string, string>, steps: [{ argv: [node, FAKE] }], ...extra,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timeout'); await sleep(50); } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const mk = (o: Partial<ConstructorParameters<typeof Runner>[0]> = {}) => {
  const ready: [string, string][] = [];
  const r = new Runner({ logDir: mkdtempSync(join(tmpdir(), 'logs-')), onReady: (id, url) => ready.push([id, url]), ...o });
  return { r, ready };
};

test('becomes running and calls onReady once with the URL', async () => {
  const { r, ready } = mk();
  r.start('a', plan({ DELAY: '300' }), 'local');
  assert.equal(r.state('a').status, 'starting');
  await until(() => r.state('a').status === 'running');
  assert.equal(ready.length, 1);
  assert.match(ready[0][1], /^http:\/\/localhost:\d+\/$/);
  assert.equal(r.state('a').url, ready[0][1]);
  await r.stop('a');
});

test('second start while starting returns the same run and spawns nothing new', async () => {
  const { r, ready } = mk();
  const s1 = r.start('a', plan({ DELAY: '300' }), 'local');
  const s2 = r.start('a', plan({ DELAY: '300' }), 'local');
  assert.equal(s1.pid, s2.pid);
  await until(() => r.state('a').status === 'running');
  r.start('a', plan(), 'local');
  assert.equal(r.state('a').pid, s1.pid);
  assert.equal(ready.length, 1);
  await r.stop('a');
});

test('exits immediately → failed, onReady never called', async () => {
  const { r, ready } = mk();
  r.start('a', plan({ EXIT: '1' }), 'local');
  await until(() => r.state('a').status === 'failed');
  assert.match(r.state('a').error ?? '', /code 1/);
  assert.equal(ready.length, 0);
});

test('never listens → failed after readyTimeoutMs', async () => {
  const { r, ready } = mk({ readyTimeoutMs: 1500 });
  const { pid } = r.start('a', plan({ NOLISTEN: '1' }), 'local');
  await sleep(1000);
  assert.equal(r.state('a').status, 'starting');
  await until(() => r.state('a').status === 'failed', 3000);
  assert.match(r.state('a').error ?? '', /not ready/);
  assert.equal(ready.length, 0);
  await until(() => !alive(pid!));
});

test('multi-step plan: steps in order, installing status during npm install', async () => {
  const { r } = mk();
  const p = plan({}, { steps: [{ argv: [node, '-e', 'setTimeout(()=>{},400)'], label: 'install' }, { argv: [node, FAKE] }] });
  r.start('a', p, 'local');
  assert.equal(r.state('a').status, 'installing');
  await until(() => r.state('a').status === 'running');
  await r.stop('a');
});

test('a failing first step fails the run', async () => {
  const { r } = mk();
  r.start('a', plan({}, { steps: [{ argv: [node, '-e', 'process.exit(3)'] }, { argv: [node, FAKE] }] }), 'local');
  await until(() => r.state('a').status === 'failed');
  assert.match(r.state('a').error ?? '', /code 3/);
});

test('stop kills the whole process group', async () => {
  const { r } = mk();
  const { pid } = r.start('a', plan({ CHILD: '1' }), 'local');
  await until(() => r.state('a').status === 'running');
  const child = Number(/child (\d+)/.exec(readFileSync(r.logPath('a'), 'utf8'))![1]);
  assert.ok(alive(child));
  assert.ok(r.managedPgids().has(pid!));
  await r.stop('a');
  await until(() => !alive(pid!) && !alive(child));
  assert.equal(r.state('a').status, 'stopped');
  assert.equal(r.managedPgids().size, 0);
});

test('log holds stdout+stderr and is truncated on restart', async () => {
  const { r } = mk();
  r.start('a', plan({ EXIT: '2' }), 'local');
  await until(() => r.state('a').status === 'failed');
  assert.match(readFileSync(r.logPath('a'), 'utf8'), /boom/);
  r.start('a', plan({ BANNER: 'Local: http://localhost:{port}/ second' }), 'local');
  await until(() => r.state('a').status === 'running');
  const log = readFileSync(r.logPath('a'), 'utf8');
  assert.doesNotMatch(log, /boom/);
  assert.match(log, /second/);
  await r.stop('a');
});

test('window plan: running after grace if alive, no onReady', async () => {
  const { r, ready } = mk({ windowGraceMs: 500 });
  r.start('w', plan({ NOLISTEN: '1' }, { window: true }), 'local');
  assert.equal(r.state('w').status, 'starting');
  await until(() => r.state('w').status === 'running');
  assert.equal(ready.length, 0);
  await r.stop('w');
});

test('a bare URL printed first loses to a Local: line that follows', async () => {
  const { r, ready } = mk({ weakGraceMs: 1500 });
  r.start('a', plan({ PRE_SERVER: '1', DELAY: '500' }), 'local');
  await until(() => r.state('a').status === 'running');
  assert.match(r.state('a').url!, /^http:\/\/localhost:\d+\/$/);
  assert.equal(ready.length, 1);
  await r.stop('a');
});

test('a bare URL alone is accepted after the grace period', async () => {
  const { r } = mk({ weakGraceMs: 500 });
  r.start('a', plan({ BANNER: 'serving at http://127.0.0.1:{port}' }), 'local');
  await until(() => r.state('a').status === 'running');
  assert.match(r.state('a').url!, /^http:\/\/127\.0\.0\.1:\d+$/);
  await r.stop('a');
});

const freePort = async () => {
  const { createServer } = await import('node:net');
  return new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => r(p)); }); });
};

test('plan.localUrl is probed even when the output only shows a LAN address', async () => {
  const { r, ready } = mk();
  const port = await freePort();
  r.start('h', plan({ PORT: String(port), BANNER: 'Web Server is available at http://192.168.1.24:{port}/' }, { localUrl: `http://localhost:${port}/` }), 'lan');
  await until(() => r.state('h').status === 'running');
  assert.equal(r.state('h').url, `http://localhost:${port}/`);
  assert.equal(ready.length, 1);
  await r.stop('h');
});

test('a failed run escalates to SIGKILL when SIGTERM is ignored, and frees the slot', async () => {
  const { r } = mk({ readyTimeoutMs: 800 });
  const { pid } = r.start('a', plan({ NOLISTEN: '1', IGNORE_TERM: '1' }), 'local');
  await until(() => r.state('a').status === 'failed', 3000);
  await until(() => !alive(pid!), 8000);
  assert.equal(r.managedPgids().size, 0);
  await r.stop('a'); // must not signal a group that is already gone
  assert.equal(r.state('a').status, 'stopped');
});

const logOpen = (path: string) => {
  const out = (() => { try { return require('node:child_process').execFileSync('/usr/sbin/lsof', ['-Fn', '-p', String(process.pid)], { encoding: 'utf8' }); } catch (e: any) { return e.stdout ?? ''; } })();
  const real = require('node:fs').realpathSync(path);
  return out.split('\n').some((l: string) => l === `n${real}`);
};
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('the log file is closed after stop', async () => {
  const { r } = mk();
  r.start('a', plan(), 'local');
  await until(() => r.state('a').status === 'running');
  assert.equal(logOpen(r.logPath('a')), true);
  await r.stop('a');
  await until(() => !logOpen(r.logPath('a')), 2000);
});

test('the log file is closed when the command cannot be spawned', async () => {
  const { r } = mk();
  r.start('a', plan({}, { steps: [{ argv: ['/nonexistent/binary'] }] }), 'local');
  await until(() => r.state('a').status === 'failed');
  await until(() => !logOpen(r.logPath('a')), 2000);
});

test('a start during the stop window is ignored', async () => {
  const { r } = mk();
  const { pid } = r.start('a', plan({ IGNORE_TERM: '1' }), 'local');
  await until(() => r.state('a').status === 'running');
  const stopping = r.stop('a');
  assert.equal(r.state('a').status, 'stopping');
  const again = r.start('a', plan(), 'local');
  assert.equal(again.status, 'stopping');
  assert.equal(again.pid, pid);
  await stopping;
  assert.equal(r.state('a').status, 'stopped');
  assert.equal(r.managedPgids().size, 0);
});

test('a server that prints no URL is found by the port its process group listens on', async () => {
  const { r, ready } = mk({ portFallbackMs: 300 });
  r.start('s', plan({ SILENT: '1' }), 'local');
  await until(() => r.state('s').status === 'running', 8000);
  assert.match(r.state('s').url!, /^http:\/\/localhost:\d+\/$/);
  assert.equal(ready.length, 1);
  await r.stop('s');
});

test("errors in the server's output are counted for the run, and reset on the next launch", async () => {
  const { r } = mk();
  r.start('a', plan({ BANNER: "TypeError: boom\n    at x (y.js:1:1)\nLocal: http://localhost:{port}/" }), 'local');
  await until(() => r.state('a').status === 'running');
  assert.equal(r.errors('a')!.count, 1);
  assert.equal(r.errors('a')!.groups[0].lines[0], 'TypeError: boom');
  await r.stop('a');
  r.start('a', plan(), 'local');
  await until(() => r.state('a').status === 'running');
  assert.equal(r.errors('a')!.count, 0);
  await r.stop('a');
});
