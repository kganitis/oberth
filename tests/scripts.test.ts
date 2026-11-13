import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptNames } from '../service/scripts.ts';
import type { Project } from '../service/types.ts';

const proj = (scripts: Record<string, string>): Project => ({ id: 'p', relPath: 'p', dir: '/tmp', name: 'P', kind: 'app', starter: { type: 'npm-dev', devScript: 'vite' }, scripts, needsInstall: false });

test('pinned checks first in fixed order, then the rest; dev, preview and npm hooks left out', () => {
  const n = scriptNames(proj({ dev: 'vite', predev: 'x', build: 'vite build', test: 'vitest', typecheck: 'tsc', preview: 'vite preview', extract: 'x', 'test:watch': 'vitest', prettier: 'x', postbuild: 'x' }));
  assert.deepEqual(n.pinned, ['test', 'typecheck', 'build']);
  assert.deepEqual(n.other, ['extract', 'test:watch', 'prettier']);
});
