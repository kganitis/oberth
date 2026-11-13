import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeTree } from './fixtures/tree.ts';
import { lastChange, recency } from '../service/recent.ts';
import type { Project } from '../service/types.ts';

const old = new Date('2020-01-01T00:00:00Z');
const aged = (spec: Record<string, string>) => { const d = makeTree(spec); utimesSync(d, old, old); return d; };

test('lastLaunched wins when newest', async () => {
  const dir = aged({ 'a.txt': '' });
  assert.equal(await recency({ dir } as Project, Date.parse('2030-01-01')), Date.parse('2030-01-01'));
});
test('src mtime counts', async () => {
  const dir = aged({ 'src/a.ts': '' });
  const t = new Date('2025-06-01T00:00:00Z');
  utimesSync(join(dir, 'src'), t, t);
  assert.equal(await recency({ dir } as Project), t.getTime());
});
test('last commit time counts', async () => {
  const dir = makeTree({ 'a.txt': '' });
  execFileSync('git', ['-C', dir, 'init', '-q']); execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], { env: { ...process.env, GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z' } });
  utimesSync(dir, old, old);
  assert.equal(await recency({ dir } as Project), Date.parse('2029-01-01T00:00:00Z'));
});
test('lastChange leaves launches out: a launch is not a change', async () => {
  const dir = aged({ 'a.txt': '' });
  const p = { dir } as Project;
  assert.equal(await lastChange(p), old.getTime());
  assert.equal(await recency(p, Date.parse('2030-01-01')), Date.parse('2030-01-01'));
});
