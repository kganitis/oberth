import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeTree } from './fixtures/tree.ts';
import { liveUrl } from '../service/live.ts';
import type { Project, Kind } from '../service/types.ts';

const proj = (dir: string, kind: Kind, id = 'p') => ({ id, dir, kind }) as Project;
const withRemote = (spec: Record<string, string>, url: string) => {
  const dir = makeTree(spec);
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', url]);
  return dir;
};

test('defaults win', async () => {
  assert.equal(await liveUrl(proj(makeTree({ CNAME: 'x.org' }), 'app', 'games__arcade'), { games__arcade: { liveUrl: 'https://arcade.someone.workers.dev' } }), 'https://arcade.someone.workers.dev');
});
test('CNAME', async () => {
  assert.equal(await liveUrl(proj(makeTree({ CNAME: 'mysite.org\n' }), 'site'), {}), 'https://mysite.org/');
});
test('GitHub Pages project site', async () => {
  assert.equal(await liveUrl(proj(withRemote({ 'index.html': '' }, 'https://github.com/someone/blog.git'), 'site'), {}), 'https://someone.github.io/blog/');
});
test('GitHub Pages user site over ssh', async () => {
  assert.equal(await liveUrl(proj(withRemote({ 'index.html': '' }, 'git@github.com:user/user.github.io.git'), 'site'), {}), 'https://user.github.io/');
});
test('app with a GitHub remote and no CNAME has no live link', async () => {
  assert.equal(await liveUrl(proj(withRemote({ 'package.json': '{}' }, 'https://github.com/someone/arcade.git'), 'app'), {}), undefined);
});

test('repoUrl: known forges over https and ssh, nothing otherwise', async () => {
  const { repoUrl } = await import('../service/live.ts');
  assert.equal(await repoUrl(withRemote({ 'a': '' }, 'https://github.com/someone/blog.git')), 'https://github.com/someone/blog');
  assert.equal(await repoUrl(withRemote({ 'a': '' }, 'git@github.com:someone/example.org.git')), 'https://github.com/someone/example.org');
  assert.equal(await repoUrl(withRemote({ 'a': '' }, 'https://gitlab.com/x/y.git')), 'https://gitlab.com/x/y');
  assert.equal(await repoUrl(withRemote({ 'a': '' }, 'https://git.example.com/x/y.git')), undefined);
  assert.equal(await repoUrl(makeTree({ 'a': '' })), undefined);
});

test('project override liveUrl comes before Oberth defaults and CNAME', async () => {
  const p = { ...proj(makeTree({ CNAME: 'x.org' }), 'site', 'p'), liveUrl: 'https://mine.example/' } as Project;
  assert.equal(await liveUrl(p, { p: { liveUrl: 'https://defaults.example/' } }), 'https://mine.example/');
});

test('forgeUrl: a repository page on any known forge, from https, ssh or scp-style remotes', async () => {
  const { forgeUrl } = await import('../service/live.ts');
  assert.equal(forgeUrl('git@github.com:someone/app.git'), 'https://github.com/someone/app');
  assert.equal(forgeUrl('https://gitlab.com/group/sub/app.git'), 'https://gitlab.com/group/sub/app');
  assert.equal(forgeUrl('ssh://git@codeberg.org/someone/app.git'), 'https://codeberg.org/someone/app');
  assert.equal(forgeUrl('https://example.com/someone/app.git'), undefined, 'an unknown host is no link');
  assert.equal(forgeUrl('/Users/someone/repos/app.git'), undefined);
});
