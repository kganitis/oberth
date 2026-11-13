import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { excluded, loadConfig, parseConfig, projectId, rootOf, stateDirOf } from '../service/config.ts';
import { makeTree } from './fixtures/tree.ts';

const H = '/Users/someone';
const parse = (raw: unknown) => parseConfig(raw, '/state', '/logs', H);

test('no config.json: the defaults, with no problems', () => {
  const c = parse(undefined);
  assert.deepEqual(c.roots, [{ path: `${H}/Dev`, label: 'dev' }]);
  assert.deepEqual(c.exclude, []);
  assert.equal(c.port, 7777);
  assert.equal(c.proxyPort, 7700);
  assert.equal(c.browser, 'Safari');
  assert.equal(c.editor, 'vscode');
  assert.equal(c.assistant, 'claude');
  assert.equal(c.modules.backup, false, 'backup needs a script of your own');
  assert.equal(c.modules.agenda, true);
  assert.deepEqual(c.problems, []);
});

test('roots: ~ is expanded, labels default to the folder name, and must be unique', () => {
  const c = parse({ roots: ['~/code', { path: '~/work/clients', label: 'clients' }, '/opt/Side Projects'] });
  assert.deepEqual(c.roots, [{ path: `${H}/code`, label: 'code' }, { path: `${H}/work/clients`, label: 'clients' }, { path: '/opt/Side Projects', label: 'side-projects' }]);
  const dup = parse({ roots: ['~/a/code', '~/b/code'] });
  assert.equal(dup.roots.length, 1);
  assert.match(dup.problems[0], /two roots are labelled "code"/);
  const none = parse({ roots: [42] });
  assert.deepEqual(none.roots, [{ path: `${H}/Dev`, label: 'dev' }]);
  assert.equal(none.problems.length, 2);
});

test('a wrong field is reported and left at its default; the rest still applies', () => {
  const c = parse({ port: 80, browser: 'Arc', editor: 'Cursor!', assistant: 'gpt', modules: { agenda: false, nope: true, recall: 'yes' }, extra: 1 });
  assert.equal(c.port, 7777);
  assert.equal(c.browser, 'Arc');
  assert.equal(c.editor, 'vscode');
  assert.equal(c.assistant, 'claude');
  assert.equal(c.modules.agenda, false);
  assert.equal(c.modules.recall, true);
  assert.equal(c.problems.length, 6);
  assert.ok(c.problems.some((p) => /unknown field "extra"/.test(p)));
});

test('projects: names, live URLs and openPort by id; a bad URL is dropped', () => {
  const c = parse({ projects: { app: { name: 'My App', liveUrl: 'https://app.example.com/', openPort: true }, site: { liveUrl: 'javascript:alert(1)' } } });
  assert.deepEqual(c.projects.app, { name: 'My App', liveUrl: 'https://app.example.com/', openPort: true });
  assert.deepEqual(c.projects.site, {});
  assert.equal(c.problems.length, 1);
});

test('the same port twice falls back to the defaults', () => {
  const c = parse({ port: 8000, proxyPort: 8000 });
  assert.deepEqual([c.port, c.proxyPort], [7777, 7700]);
});

test('OBERTH_STATE_DIR moves the state dir, its config.json and the logs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oberth-state-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ port: 8777, assistant: 'none' }));
  const c = loadConfig({ OBERTH_STATE_DIR: dir }, H);
  assert.equal(c.stateDir, dir);
  assert.equal(c.logDir, join(dir, 'logs'));
  assert.equal(c.port, 8777);
  assert.equal(c.assistant, 'none');
  assert.equal(stateDirOf({}, H), `${H}/Library/Application Support/oberth`);
  writeFileSync(join(dir, 'config.json'), '{ not json');
  assert.match(loadConfig({ OBERTH_STATE_DIR: dir }, H).problems[0], /can't be read/);
});

test('ids: the first root keeps bare paths, other roots prefix their label', () => {
  const roots = [{ path: '/a', label: 'dev' }, { path: '/b', label: 'work' }];
  assert.equal(projectId(roots, roots[0], 'games/arcade'), 'games__arcade');
  assert.equal(projectId(roots, roots[1], 'api'), 'work__api');
});

test('rootOf finds the deepest root holding a folder', () => {
  const dev = makeTree({ 'app/x': '', 'inner/proj/x': '' });
  const roots = [{ path: dev, label: 'dev' }, { path: join(dev, 'inner'), label: 'inner' }];
  assert.equal(rootOf(roots, join(dev, 'app'))!.rel, 'app');
  assert.equal(rootOf(roots, join(dev, 'inner/proj'))!.root.label, 'inner');
  assert.equal(rootOf(roots, tmpdir()), undefined);
});

test('excluded: by name only at the top level, by path anywhere', () => {
  const r = { path: '/dev', label: 'dev' };
  assert.equal(excluded(['secret'], r, 'secret', '/dev/secret'), true);
  assert.equal(excluded(['secret'], r, 'group/secret', '/dev/group/secret'), false);
  assert.equal(excluded(['/dev/group/secret'], r, 'group/secret', '/dev/group/secret'), true);
});
