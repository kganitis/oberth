import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorTracker } from '../service/errors.ts';

const feed = (text: string) => { const t = new ErrorTracker(); t.feed(text); return t; };

test('normal Vite output has no errors', () => {
  const t = feed('\n  VITE v6.0.7  ready in 312 ms\n\n  ➜  Local:   http://localhost:5173/\n13:24:02 [vite] hmr update /src/ui/Board.tsx\n');
  assert.equal(t.count, 0);
});

test('a TypeError with its stack counts once and keeps the stack', () => {
  const t = feed("hmr update\nTypeError: Cannot read properties of undefined (reading 'hp')\n    at resolveFight (src/engine/combat.ts:91:16)\n    at main (src/main.ts:3:1)\nnext line\n");
  assert.equal(t.count, 1);
  assert.deepEqual(t.groups[0].lines, ['hmr update', "TypeError: Cannot read properties of undefined (reading 'hp')", '    at resolveFight (src/engine/combat.ts:91:16)', '    at main (src/main.ts:3:1)']);
});

test("Vite's error when starting + Error: on the next line is one error", () => {
  const t = feed('error when starting dev server:\nError: Port 5173 is already in use\n    at Server.onError (x.js:1:1)\n');
  assert.equal(t.count, 1);
});

test('two errors apart from each other count twice', () => {
  const t = feed('13:31:41 [vite] Internal server error: /src/a.ts: Unexpected token (88:14)\n  86 | const a\n  88 |   if (x {\n\nok\nok\nok\n13:52:09 [vite] error while updating dependencies\n');
  assert.equal(t.count, 2);
});

test('ANSI codes and chunk boundaries do not matter', () => {
  const t = new ErrorTracker();
  t.feed('\x1b[31mType');
  t.feed('Error\x1b[39m: boom\n');
  assert.equal(t.count, 1);
  assert.match(t.groups[0].lines[0], /\x1b\[31m/); // raw line kept for colour
});

test('npm ERR! counts', () => {
  assert.equal(feed('npm ERR! code ELIFECYCLE\nnpm ERR! errno 1\n').count, 1);
});

test('words like "errors" in normal output are ignored', () => {
  assert.equal(feed('checked 12 files, 0 errors\nno error handlers registered\n').count, 0);
});
