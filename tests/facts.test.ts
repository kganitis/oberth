import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeTree } from './fixtures/tree.ts';
import { deployOf, depsOf, historyOf, pypiVersion, pyprojectName, stackOf, visibilityOf } from '../service/facts.ts';
import type { Project, Starter } from '../service/types.ts';

const proj = (dir: string, starter: Starter = { type: 'npm-dev', devScript: 'vite' }): Project =>
  ({ id: 'p', relPath: 'p', dir, name: 'P', kind: 'app', starter, scripts: {}, needsInstall: false });

test('stack names the notable dependencies in a fixed order, plus Hugo/static/Python from the project itself', () => {
  const dir = makeTree({ 'package.json': JSON.stringify({ dependencies: { zustand: '1', react: '1', lodash: '1' }, devDependencies: { vite: '1', typescript: '1', tailwindcss: '1' } }) });
  assert.deepEqual(stackOf(proj(dir), depsOf(dir)), ['React', 'Zustand', 'Tailwind', 'TypeScript', 'Vite']);
  const py = makeTree({ 'build.py': '', 'serve.py': '' });
  assert.deepEqual(stackOf(proj(py, { type: 'serve-py' }), []), ['Python']);
  assert.deepEqual(stackOf(proj(makeTree({ 'config.yaml': '' }), { type: 'hugo' }), []), ['Hugo']);
  assert.deepEqual(stackOf(proj(makeTree({ 'Assets/a.cs': '', 'ProjectSettings/p.asset': '' }), { type: 'none' }), []), ['Unity']);
  assert.deepEqual(stackOf(proj(makeTree({ 'App.csproj': '', 'Forms/Main.cs': '' }), { type: 'none' }), []), ['.NET · Windows Forms']);
  assert.deepEqual(stackOf(proj(makeTree({ 'Api/Api.csproj': '' }), { type: 'none' }), []), ['.NET']);
});

test('deploy target from files the project already has', () => {
  assert.equal(deployOf(proj(makeTree({ 'wrangler.jsonc': '{}' })), undefined, []), 'Cloudflare Workers');
  assert.equal(deployOf(proj(makeTree({ 'a': '' })), 'https://someone.github.io/blog/', []), 'GitHub Pages');
  assert.equal(deployOf(proj(makeTree({ CNAME: 'mysite.org' })), 'https://mysite.org/', []), 'GitHub Pages');
  assert.equal(deployOf(proj(makeTree({ 'a': '' })), undefined, ['electron-builder']), 'Desktop builds (electron-builder)');
  assert.equal(deployOf(proj(makeTree({ 'a': '' })), undefined, []), undefined);
});

test('history: first commit and count; nothing without a repo; no network without a GitHub remote', async () => {
  const dir = makeTree({ 'a.txt': 'x' });
  assert.deepEqual(await historyOf(dir), {});
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'one'); git('commit', '-q', '--allow-empty', '-m', 'two');
  const h = await historyOf(dir);
  assert.equal(h.commits, 2);
  assert.ok(h.startedAt! > Date.now() - 60_000);
  assert.equal(await visibilityOf(undefined), 'local');
});

test('PyPI hint: the package name from pyproject.toml, its latest version, nothing when unpublished', async () => {
  const dir = makeTree({ 'pyproject.toml': '[build-system]\nrequires = ["x"]\n\n[project]\nname = "simkit"\ndescription = "d"\n' });
  assert.equal(pyprojectName(dir), 'simkit');
  const asked: string[] = [];
  const ok = (async (url: string) => { asked.push(url); return new Response(JSON.stringify({ info: { version: '0.10.2' } })); }) as unknown as typeof fetch;
  assert.equal(await pypiVersion(dir, ok), '0.10.2');
  assert.deepEqual(asked, ['https://pypi.org/pypi/simkit/json']);
  const other = makeTree({ 'pyproject.toml': '[project]\nname = "unpublished-thing"\n' });
  const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
  assert.equal(await pypiVersion(other, missing), undefined);
  assert.equal(await pypiVersion(makeTree({ 'a': '' }), ok), undefined); // no pyproject: never asks
  assert.equal(asked.length, 1);
});
