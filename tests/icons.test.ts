import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTree } from './fixtures/tree.ts';
import { resolveIcon, readIcon } from '../service/icons.ts';
import type { Project } from '../service/types.ts';

const P = (dir: string, id = 'p', name = 'Tune Picker') => ({ id, dir, name }) as Project;
const bundled = makeTree({ 'p.svg': '<svg>bundled</svg>' });

test('favicon candidates in order', () => {
  const cases: [Record<string, string>, string][] = [
    [{ 'public/favicon.svg': '', 'public/favicon.ico': '' }, 'public/favicon.svg'],
    [{ 'public/favicon.ico': '', 'public/favicon.png': '' }, 'public/favicon.ico'],
    [{ 'public/favicon.png': '' }, 'public/favicon.png'],
    [{ 'public/icons/icon.svg': '', 'static/images/favicon.svg': '' }, 'public/icons/icon.svg'],
    [{ 'static/images/favicon.svg': '' }, 'static/images/favicon.svg'],
    [{ 'static/images/favicon.ico': '' }, 'static/images/favicon.ico'],
    [{ 'assets/favicon.svg': '' }, 'assets/favicon.svg'],
    [{ 'assets/favicon.ico': '' }, 'assets/favicon.ico'],
  ];
  for (const [spec, expected] of cases) {
    const dir = makeTree(spec);
    const icon = resolveIcon(P(dir), bundled);
    assert.equal(icon.type, 'file');
    assert.equal(icon.type === 'file' && icon.path, join(dir, expected), expected);
  }
});

test('link rel=icon href, resolved against dir then dir/public', () => {
  const a = makeTree({ 'index.html': '<link rel="icon" href="img/i.png" type="image/png">', 'img/i.png': '' });
  const ia = resolveIcon(P(a), bundled);
  assert.equal(ia.type === 'file' && ia.path, join(a, 'img/i.png'));
  assert.equal(ia.type === 'file' && ia.mime, 'image/png');
  const b = makeTree({ 'index.html': "<link href='/logo.svg' rel='icon'>", 'public/logo.svg': '' });
  const ib = resolveIcon(P(b), bundled);
  assert.equal(ib.type === 'file' && ib.path, join(b, 'public/logo.svg'));
});

test('project favicon beats the bundled icon', () => {
  const dir = makeTree({ 'assets/favicon.svg': '<svg/>' });
  assert.equal(resolveIcon(P(dir), bundled).type, 'file');
});

test('bundled icon when no favicon', () => {
  const icon = resolveIcon(P(makeTree({ 'a.txt': '' })), bundled);
  assert.deepEqual(icon, { type: 'bundled', path: join(bundled, 'p.svg') });
});

test('letter badge as last resort, deterministic colour', () => {
  const a = resolveIcon(P(makeTree({ 'a.txt': '' }), 'zzz', 'Tune Picker'), bundled);
  const b = resolveIcon(P(makeTree({ 'a.txt': '' }), 'zzz', 'Tune Picker'), bundled);
  assert.equal(a.type, 'letter');
  assert.match(a.type === 'letter' ? a.svg : '', />T</);
  assert.deepEqual(a, b);
});

test('changing the favicon file changes the served bytes', () => {
  const dir = makeTree({ 'assets/favicon.svg': '<svg>one</svg>' });
  const first = readIcon(resolveIcon(P(dir), bundled)).body.toString();
  writeFileSync(join(dir, 'assets/favicon.svg'), '<svg>two</svg>');
  const second = readIcon(resolveIcon(P(dir), bundled)).body.toString();
  assert.equal(first, '<svg>one</svg>');
  assert.equal(second, '<svg>two</svg>');
});

test('readIcon types', () => {
  assert.equal(readIcon({ type: 'bundled', path: join(bundled, 'p.svg') }).mime, 'image/svg+xml');
  assert.equal(readIcon({ type: 'letter', svg: '<svg/>' }).mime, 'image/svg+xml');
});

test('icons from several folders: the first that has <id>.svg wins', () => {
  const mine = makeTree({ 'p.svg': '<svg>mine</svg>' });
  const shipped = makeTree({ 'p.svg': '<svg>shipped</svg>', 'q.svg': '<svg>q</svg>' });
  assert.equal(readIcon(resolveIcon(P(makeTree({ 'a.txt': '' })), [mine, shipped])).body.toString(), '<svg>mine</svg>');
  assert.equal(readIcon(resolveIcon(P(makeTree({ 'a.txt': '' }), 'q'), [mine, shipped])).body.toString(), '<svg>q</svg>');
});

test('an index.html icon link pointing outside the project folder is ignored', () => {
  const root = makeTree({ 'outside.svg': '<svg>secret</svg>', 'proj/index.html': '<link rel="icon" href="../outside.svg">' });
  const icon = resolveIcon(P(join(root, 'proj'), 'zzz'), bundled);
  assert.equal(icon.type, 'letter');
});

test('an icon link through a symlink that leaves the folder is ignored', async () => {
  const { symlinkSync } = await import('node:fs');
  const root = makeTree({ 'outside/x.svg': '<svg/>', 'proj/index.html': '<link rel="icon" href="link/x.svg">' });
  symlinkSync(join(root, 'outside'), join(root, 'proj/link'));
  assert.equal(resolveIcon(P(join(root, 'proj'), 'zzz'), bundled).type, 'letter');
});
