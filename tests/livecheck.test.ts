import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveChecker } from '../service/livecheck.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fake = (answer: (method: string) => number | Error) => {
  const calls: string[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    calls.push(init.method!);
    const a = answer(init.method!);
    if (a instanceof Error) throw a;
    return new Response(null, { status: a });
  }) as typeof fetch;
  return { f, calls };
};

test('HEAD answer is used; a refusal of HEAD falls back to GET', async () => {
  const ok = fake(() => 200);
  const c = new LiveChecker(ok.f);
  c.refresh('https://a.example/');
  await sleep(20);
  assert.equal(c.get('https://a.example/')!.ok, true);
  assert.deepEqual(ok.calls, ['HEAD']);
  const noHead = fake((m) => (m === 'HEAD' ? 405 : 200));
  const c2 = new LiveChecker(noHead.f);
  c2.refresh('https://b.example/');
  await sleep(20);
  assert.deepEqual(noHead.calls, ['HEAD', 'GET']);
  assert.equal(c2.get('https://b.example/')!.status, 200);
});

test('errors and 5xx read as down; checks are not repeated within the TTL', async () => {
  const down = fake(() => Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
  const c = new LiveChecker(down.f, 60_000);
  c.refresh('https://gone.example/');
  c.refresh('https://gone.example/'); // in flight: not doubled
  await sleep(20);
  assert.deepEqual(c.get('https://gone.example/'), { ok: false, error: 'ENOTFOUND', checkedAt: c.get('https://gone.example/')!.checkedAt });
  c.refresh('https://gone.example/');
  await sleep(20);
  assert.equal(down.calls.length, 1);
  const err = fake(() => 503);
  const c2 = new LiveChecker(err.f);
  c2.refresh('https://x.example/');
  await sleep(20);
  assert.equal(c2.get('https://x.example/')!.ok, false);
});

test('response bodies are cancelled, so sockets are not held until GC', async () => {
  let cancelled = 0;
  const body = () => ({ cancel: async () => { cancelled++; } });
  const f = (async (_u: string, init: RequestInit) => ({ status: init.method === 'HEAD' ? 405 : 200, body: body() })) as unknown as typeof fetch;
  const c = new LiveChecker(f);
  c.refresh('https://c.example/');
  await sleep(20);
  assert.equal(c.get('https://c.example/')!.ok, true);
  assert.equal(cancelled, 2); // the refused HEAD and the GET
});
