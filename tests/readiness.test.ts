import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { findPageUrl, probe } from '../service/readiness.ts';

test('prefers the Vite Local: line over an earlier API url (concurrently)', () => {
  const out = '[server] listening on http://127.0.0.1:3101\n[ui]  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5273\x1b[22m/\x1b[39m\n';
  assert.equal(findPageUrl(out), 'http://localhost:5273/');
});
test('hugo banner', () => {
  assert.equal(findPageUrl('Web Server is available at http://localhost:1313/ (bind address 127.0.0.1)'), 'http://localhost:1313/');
});
test('python http.server banner', () => {
  assert.equal(findPageUrl('Serving HTTP on 127.0.0.1 port 4400 (http://127.0.0.1:4400/) ...'), 'http://127.0.0.1:4400/');
});
test('serve.py banner', () => {
  assert.equal(findPageUrl('Newsreader (mine) at http://127.0.0.1:8765/  (Ctrl+C to stop)'), 'http://127.0.0.1:8765/');
});
test('0.0.0.0 becomes localhost', () => {
  assert.equal(findPageUrl('Serving HTTP on 0.0.0.0 port 4400 (http://0.0.0.0:4400/) ...'), 'http://localhost:4400/');
});
test('no url', () => assert.equal(findPageUrl('compiling...'), undefined));

test('probe: true when something answers, false when nothing listens', async () => {
  const s = createServer((_q, r) => { r.statusCode = 404; r.end(); }).listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as { port: number }).port;
  assert.equal(await probe(`http://127.0.0.1:${port}/`, 1000), true);
  s.close();
  assert.equal(await probe('http://127.0.0.1:1/', 500), false);
});

test('ignores non-local URLs such as links in warnings', () => {
  const out = 'WARN  Dart Sass: DEPRECATED\nMore info and automated migrator: https://sass-lang.com/d/import\nWeb Server is available at http://localhost:1313/ (bind address 127.0.0.1)';
  assert.equal(findPageUrl(out), 'http://localhost:1313/');
  assert.equal(findPageUrl('More info: https://sass-lang.com/d/import'), undefined);
});

test('findPageUrlDetail marks labelled URLs strong and bare ones weak', async () => {
  const { findPageUrlDetail } = await import('../service/readiness.ts');
  assert.deepEqual(findPageUrlDetail('api on http://127.0.0.1:8790'), { url: 'http://127.0.0.1:8790', strong: false });
  assert.deepEqual(findPageUrlDetail('api on http://127.0.0.1:8790\n  ➜  Local:   http://localhost:5180/'), { url: 'http://localhost:5180/', strong: true });
});

test('probe never throws, https or not', async () => {
  assert.equal(await probe('https://127.0.0.1:1/', 500), false);
  assert.equal(await probe('not a url', 500), false);
});
