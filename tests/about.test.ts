import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanAbout, loadAbout, saveAbout } from '../service/about.ts';

test('cleanAbout trims, drops empties, and refuses bad input', () => {
  assert.deepEqual(cleanAbout({ description: '  A ranker.  ', status: 'paused', notes: '' }),
    { description: 'A ranker.', status: 'paused', released: undefined, releasedWhere: undefined, notes: undefined });
  assert.deepEqual(cleanAbout({}), { description: undefined, status: undefined, released: undefined, releasedWhere: undefined, notes: undefined });
  // released comes from a checkbox; where is kept only for a released project
  assert.equal(cleanAbout({ released: 'on', releasedWhere: ' PyPI ' }).releasedWhere, 'PyPI');
  assert.equal(cleanAbout({ released: true }).released, true);
  assert.equal(cleanAbout({ releasedWhere: 'PyPI' }).releasedWhere, undefined);
  assert.throws(() => cleanAbout({ status: 'dead' }), /status must be one of/);
  assert.throws(() => cleanAbout({ description: 'x'.repeat(201) }), /longer than 200/);
  assert.throws(() => cleanAbout({ notes: 42 }), /notes must be text/);
});

test('saved entries survive a reload, per project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'about-'));
  saveAbout(dir, 'a', { description: 'A', status: 'active' }, 5);
  saveAbout(dir, 'b', { notes: 'B' }, 6);
  assert.deepEqual(loadAbout(dir), { a: { description: 'A', status: 'active', updatedAt: 5 }, b: { notes: 'B', updatedAt: 6 } });
});
