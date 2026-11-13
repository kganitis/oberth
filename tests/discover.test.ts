import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTree } from './fixtures/tree.ts';
import { discoverProjects } from '../service/discover.ts';
import { REPO_DIR, resolveNodeBin } from '../service/config.ts';

const dev = (s: string) => JSON.stringify({ scripts: { dev: s } });
const ids = (root: string) => discoverProjects(root, {}).map((p) => p.id);

test('finds a vite app', () => {
  const root = makeTree({ 'vgr/package.json': dev('vite') });
  const [p] = discoverProjects(root, {});
  assert.equal(p.id, 'vgr');
  assert.equal(p.kind, 'app');
  assert.deepEqual(p.starter, { type: 'npm-dev', devScript: 'vite' });
  assert.equal(p.needsInstall, true);
  assert.equal(p.dir, join(root, 'vgr'));
});

test('node_modules present means no install needed', () => {
  const root = makeTree({ 'vgr/package.json': dev('vite'), 'vgr/node_modules/': '' });
  assert.equal(discoverProjects(root, {})[0].needsInstall, false);
});

test('electron dependency makes a window app', () => {
  const root = makeTree({ 'dd/package.json': JSON.stringify({ scripts: { dev: 'electron-vite dev' }, devDependencies: { 'electron-vite': '^5' } }) });
  assert.equal(discoverProjects(root, {})[0].kind, 'window');
});

test('hugo site', () => {
  const root = makeTree({ 'site/config.yaml': 'title: x', 'site/themes/': '' });
  const [p] = discoverProjects(root, {});
  assert.equal(p.kind, 'site');
  assert.deepEqual(p.starter, { type: 'hugo' });
});

test('serve.py site, its inner index.html is not a second project', () => {
  const root = makeTree({ 'ht/serve.py': '', 'ht/site/index.html': '' });
  const ps = discoverProjects(root, {});
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0].starter, { type: 'serve-py' });
});

test('static site', () => {
  const root = makeTree({ 'blog/index.html': '' });
  const [p] = discoverProjects(root, {});
  assert.deepEqual(p.starter, { type: 'static' });
  assert.equal(p.kind, 'site');
});

test('nested projects are found one level down', () => {
  const root = makeTree({ 'games/arcade/package.json': dev('vite'), 'games/blog/index.html': '', 'games/notes.md': '' });
  assert.deepEqual(ids(root), ['games__arcade', 'games__blog']);
  assert.equal(discoverProjects(root, {})[0].relPath, 'games/arcade');
});

test('does not descend into a matched project', () => {
  const root = makeTree({ 'vgr/package.json': dev('vite'), 'vgr/dist/index.html': '', 'vgr/ui/index.html': '' });
  assert.deepEqual(ids(root), ['vgr']);
});

test('excludes: folders left out by name or path, hidden folders and build output', () => {
  const root = makeTree({
    'private-one/x/package.json': dev('vite'),
    'private-two/deploy/index.html': '',
    'group/secret/index.html': '',
    'group/shown/index.html': '',
    '.hidden/index.html': '',
    'node_modules/a/index.html': '',
    'dist/index.html': '',
  });
  assert.deepEqual(discoverProjects(root, {}, ['private-one', 'private-two', join(root, 'group/secret')]).map((p) => p.id), ['group__shown']);
});

test('Oberth never lists itself, wherever it was cloned', () => {
  const root = join(REPO_DIR, '..');
  assert.ok(!discoverProjects(root, {}, []).some((p) => realpathSync(p.dir) === realpathSync(REPO_DIR)));
});

test('several roots: the first keeps bare ids, others prefix their label; a root inside another is listed once', () => {
  const dev = makeTree({ 'app/index.html': '', 'g/site/index.html': '' });
  const work = makeTree({ 'api/index.html': '', 'clients/acme/index.html': '' });
  mkdirSync(join(dev, 'nested'));
  writeFileSync(join(dev, 'nested/index.html'), '');
  const roots = [{ path: dev, label: 'dev' }, { path: work, label: 'work' }, { path: join(dev, 'nested'), label: 'nested' }];
  const ps = discoverProjects(roots, {}, []);
  assert.deepEqual(ps.map((p) => p.id).sort(), ['app', 'g__site', 'work__api', 'work__clients__acme'].sort());
  assert.equal(ps.find((p) => p.id === 'work__api')!.relPath, 'work/api');
  assert.equal(ps.find((p) => p.id === 'work__api')!.name, 'Api', 'names come from the folder, not the label');
});

test('a root that does not exist lists nothing and breaks nothing', () => {
  const dev = makeTree({ 'app/index.html': '' });
  assert.deepEqual(discoverProjects([{ path: dev, label: 'dev' }, { path: join(dev, 'missing'), label: 'missing' }], {}, []).map((p) => p.id), ['app']);
});

test('a repository or manifest without a dev server is a library: shown, never launched', () => {
  const root = makeTree({
    'lib/package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
    'pkg/pyproject.toml': '[project]\nname = "pkg"\n',
    'repo/.git/HEAD': 'ref: refs/heads/main\n',
    'group/inner/.git/HEAD': 'ref: refs/heads/main\n', // a folder of repositories is not one itself
    'notes/CLAUDE.md': '# notes', // a CLAUDE.md alone is not a project
  });
  const ps = discoverProjects(root, {});
  assert.deepEqual(ps.map((p) => [p.id, p.kind, p.starter.type]), [
    ['group__inner', 'library', 'none'], ['lib', 'library', 'none'], ['pkg', 'library', 'none'], ['repo', 'library', 'none'],
  ]);
});

test('override file wins', () => {
  const root = makeTree({ 'p/.oberth.json': JSON.stringify({ name: 'P', kind: 'site', command: ['python3', '-m', 'http.server'] }), 'p/package.json': dev('vite') });
  const [p] = discoverProjects(root, {});
  assert.equal(p.name, 'P');
  assert.equal(p.kind, 'site');
  assert.deepEqual(p.starter, { type: 'override', argv: ['python3', '-m', 'http.server'] });
});

test('override ignore hides the project', () => {
  const root = makeTree({ 'p/.oberth.json': '{"ignore":true}', 'p/index.html': '' });
  assert.deepEqual(ids(root), []);
});

test('names', () => {
  const root = makeTree({
    'movie-ranker/package.json': dev('vite'),
    'games/arcade/package.json': dev('vite'),
    'mysite.org/index.html': '',
    'project-x/index.html': '',
  });
  const names = Object.fromEntries(discoverProjects(root, { 'project-x': { name: 'project-x' } }).map((p) => [p.id, p.name]));
  assert.equal(names['movie-ranker'], 'Movie Ranker');
  assert.equal(names['games__arcade'], 'Games Arcade');
  assert.equal(names['mysite.org'], 'mysite.org');
  assert.equal(names['project-x'], 'project-x');
});

test('resolveNodeBin picks newest matching the nvm alias', () => {
  const home = makeTree({
    '.nvm/alias/default': '22\n',
    '.nvm/versions/node/v22.9.0/bin/': '',
    '.nvm/versions/node/v22.20.0/bin/': '',
    '.nvm/versions/node/v20.1.0/bin/': '',
    '.nvm/versions/node/v23.0.0/bin/': '',
  });
  assert.equal(resolveNodeBin(home), join(home, '.nvm/versions/node/v22.20.0/bin'));
});

test('resolveNodeBin falls back to newest installed', () => {
  const home = makeTree({ '.nvm/alias/default': 'lts/*', '.nvm/versions/node/v20.1.0/bin/': '', '.nvm/versions/node/v22.3.0/bin/': '' });
  assert.equal(resolveNodeBin(home), join(home, '.nvm/versions/node/v22.3.0/bin'));
  const home2 = makeTree({ '.nvm/versions/node/v18.0.0/bin/': '' });
  assert.equal(resolveNodeBin(home2), join(home2, '.nvm/versions/node/v18.0.0/bin'));
});

test('override url and liveUrl are read; only local http urls and http(s) live urls are accepted', () => {
  const root = makeTree({
    'a/.oberth.json': JSON.stringify({ url: 'http://localhost:4000/app/', liveUrl: 'https://a.example/' }), 'a/index.html': '',
    'b/.oberth.json': JSON.stringify({ url: 'https://evil.example/', liveUrl: 'javascript:alert(1)' }), 'b/index.html': '',
  });
  const [a, b] = discoverProjects(root, {});
  assert.equal(a.url, 'http://localhost:4000/app/');
  assert.equal(a.liveUrl, 'https://a.example/');
  assert.equal(b.url, undefined);
  assert.equal(b.liveUrl, undefined);
});

test('a .oberth.json command in a plain repository makes an app, not a library', () => {
  const root = makeTree({ 'api/.git/HEAD': 'ref: refs/heads/main', 'api/.oberth.json': JSON.stringify({ command: ['python3', '-m', 'http.server'] }) });
  const [p] = discoverProjects(root, {}, []);
  assert.equal(p.kind, 'app');
  assert.deepEqual(p.starter, { type: 'override', argv: ['python3', '-m', 'http.server'] });
});
