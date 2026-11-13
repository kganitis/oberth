import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeTree } from './fixtures/tree.ts';
import { parseStatus, gitInfo, parseFiles, parseLog, gitDetail, reflogStamp, commitsSince, branchCommits } from '../service/gitinfo.ts';

test('parseStatus: branch, changed, ahead', () => {
  assert.deepEqual(parseStatus('## main...origin/main [ahead 2]\n M a.ts\n?? b.ts\n'), { branch: 'main', changed: 2, ahead: 2 });
  assert.deepEqual(parseStatus('## main...origin/main [ahead 1, behind 3]\n'), { branch: 'main', changed: 0, ahead: 1 });
  assert.deepEqual(parseStatus('## main\n'), { branch: 'main', changed: 0, ahead: 0 });
  assert.equal(parseStatus('## HEAD (no branch)\n').branch, 'HEAD');
  assert.equal(parseStatus('## No commits yet on main\n').branch, 'main');
});

test('gitInfo: null outside a repo, real values inside', async () => {
  assert.equal(await gitInfo(makeTree({ 'a.txt': 'x' })), null);
  const dir = makeTree({ 'a.txt': 'x' });
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'one');
  assert.deepEqual(await gitInfo(dir), { branch: 'main', changed: 0, ahead: 0 });
});

test('gitInfo: a folder inside another repo is not its own repo', async () => {
  const dir = makeTree({ 'sub/a.txt': 'x' });
  execFileSync('git', ['-C', dir, 'init', '-q']);
  assert.equal(await gitInfo(dir + '/sub'), null);
});

test('gitInfo never writes the index (no index.lock contention with the owner)', async () => {
  const { statSync, utimesSync } = await import('node:fs');
  const dir = makeTree({ 'a.txt': 'x' });
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'one');
  const later = new Date(Date.now() + 60_000);
  utimesSync(dir + '/a.txt', later, later); // stat-dirty, content unchanged: plain `git status` would rewrite the index
  const before = statSync(dir + '/.git/index').mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await gitInfo(dir);
  assert.equal(statSync(dir + '/.git/index').mtimeMs, before);
});

test('parseFiles and parseLog', () => {
  assert.deepEqual(parseFiles('## main\n M src/a.ts\nA  b.ts\n?? c.ts\nR  old.ts -> new.ts\n'), [
    { status: 'M', path: 'src/a.ts' }, { status: 'A', path: 'b.ts' }, { status: '?', path: 'c.ts' }, { status: 'R', path: 'old.ts -> new.ts' },
  ]);
  const log = parseLog('a1\x1ffeat: two\x1f1700000100\nb2\x1ffeat: one\x1f1700000000\n', 1);
  assert.deepEqual(log, [{ hash: 'a1', subject: 'feat: two', time: 1700000100000, unpushed: true }, { hash: 'b2', subject: 'feat: one', time: 1700000000000, unpushed: false }]);
});

test('gitDetail: files and commits from a real repo, no upstream means nothing unpushed', async () => {
  const dir = makeTree({ 'a.txt': 'x' });
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'first');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dir + '/b.txt', 'y');
  const d = (await gitDetail(dir))!;
  assert.equal(d.branch, 'main');
  assert.equal(d.upstream, undefined);
  assert.deepEqual(d.files, [{ status: '?', path: 'b.txt' }]);
  assert.equal(d.commits[0].subject, 'first');
  assert.equal(d.commits[0].unpushed, false);
});

test('reflogStamp: none without a repo, changes with every commit (size, not only mtime), follows worktrees', async () => {
  const { writeFileSync } = await import('node:fs');
  const dir = makeTree({ 'a.txt': 'x' });
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  assert.equal(reflogStamp(dir), 'none');
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'first');
  const before = reflogStamp(dir)!;
  writeFileSync(dir + '/b.txt', 'y'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'second');
  // no waiting between the commits: the reflog's size moves even when its mtime can't
  assert.notEqual(reflogStamp(dir)!.split(':')[2], before.split(':')[2]);
  assert.deepEqual((await commitsSince(dir, Date.now() - 60_000)).map((c) => c.subject), ['second', 'first']);
  const wt = dir + '-wt';
  git(dir, 'worktree', 'add', '-q', wt);
  assert.match(reflogStamp(wt)!, /^\d/); // a .git file followed to its git dir
});

test('stashes counts the stash reflog and reads the newest one\'s time; none means zero', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { stashes, gitFacts } = await import('../service/gitinfo.ts');
  const dir = mkdtempSync(join(tmpdir(), 'stash-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'one');
  git('add', '.'); git('commit', '-qm', 'first');
  assert.deepEqual(stashes(dir), { count: 0 });
  writeFileSync(join(dir, 'a.txt'), 'two');
  git('stash', '-q');
  const s = stashes(dir);
  assert.equal(s.count, 1);
  assert.ok(Math.abs(Date.now() - s.at!) < 60_000);
  writeFileSync(join(dir, 'new file.txt'), 'x');
  const f = (await gitFacts(dir))!;
  assert.deepEqual([f.ahead, f.changed, f.stashes], [0, 1, 1]);
  assert.ok(f.changedAt! > Date.now() - 60_000);
  assert.equal(await gitFacts(tmpdir()), null);
});

test('a push clears what gitFacts reports as unpushed', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { gitFacts } = await import('../service/gitinfo.ts');
  const bare = mkdtempSync(join(tmpdir(), 'bare-'));
  const dir = mkdtempSync(join(tmpdir(), 'push-'));
  const old = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { env: old, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one');
  git('add', '.'); git('commit', '-qm', 'first');
  git('remote', 'add', 'origin', bare); git('push', '-q', '-u', 'origin', 'main');
  assert.equal((await gitFacts(dir))!.ahead, 0);
  writeFileSync(join(dir, 'a.txt'), 'two');
  git('commit', '-qam', 'second');
  const f = (await gitFacts(dir))!;
  assert.equal(f.ahead, 1);
  assert.equal(f.unpushedAt, Date.parse('2026-01-01T00:00:00Z'));
  git('push', '-q');
  const after = (await gitFacts(dir))!;
  assert.deepEqual([after.ahead, after.unpushedAt], [0, undefined]);
});

test('branchCommits: every local branch, with the full hash; none outside a repository', async () => {
  const dir = makeTree({ 'a.txt': 'a' });
  assert.deepEqual(await branchCommits(dir, 0), []);
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'on main');
  git('checkout', '-q', '-b', 'side');
  git('commit', '-q', '--allow-empty', '-m', 'on a side branch');
  git('checkout', '-q', 'main');
  const commits = await branchCommits(dir, Date.now() - 60_000);
  assert.deepEqual(commits.map((c) => c.subject).sort(), ['on a side branch', 'on main']);
  assert.match(commits[0].full, /^[0-9a-f]{40}$/);
  assert.ok(commits[0].full.startsWith(commits[0].hash));
  assert.deepEqual(await branchCommits(dir, Date.now() + 86_400_000), []);
});
