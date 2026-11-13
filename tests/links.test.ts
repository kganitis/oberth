import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linksOf, type LinkSource } from '../service/links.ts';
import type { Project } from '../service/types.ts';

const p: Project = { id: 'p', relPath: 'p', dir: '/nowhere', name: 'P', kind: 'app', starter: { type: 'none' }, scripts: {}, needsInstall: false };

test('links: every source that finds one, in order; a failing source is skipped', async () => {
  const sources: LinkSource[] = [
    { id: 'npm', find: async (x) => ({ label: 'npm', url: `https://www.npmjs.com/package/${x.id}` }) },
    { id: 'broken', find: async () => { throw new Error('offline'); } },
    { id: 'none', find: async () => undefined },
  ];
  assert.deepEqual(await linksOf(p, {}, sources), [{ id: 'npm', label: 'npm', url: 'https://www.npmjs.com/package/p' }]);
});

test('the built-in sources: a live URL from config.json', async () => {
  const links = await linksOf(p, { p: { liveUrl: 'https://p.example.com/' } });
  assert.deepEqual(links, [{ id: 'live', label: 'Live site', url: 'https://p.example.com/' }]);
});
