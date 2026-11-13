import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLsofListen, parseLsofCwd, parsePs, matchForeign } from '../service/ports.ts';
import type { Listener, Project } from '../service/types.ts';

test('parseLsofListen: one entry per pid+port, IPv4/IPv6 duplicates merged', () => {
  const out = 'p498\nf10\nn*:64270\nf11\nn*:64270\np1954\nf34\nn127.0.0.1:49214\np37226\nf3\nn127.0.0.1:8765\nf4\nn[::1]:8765\nf5\nn[::1]:9000\n';
  assert.deepEqual(parseLsofListen(out), [
    { pid: 498, port: 64270 }, { pid: 1954, port: 49214 }, { pid: 37226, port: 8765 }, { pid: 37226, port: 9000 },
  ]);
});

test('parseLsofCwd', () => {
  const out = 'p37226\nfcwd\nn/Users/x/Dev/newsreader\np1\nfcwd\nn/\n';
  assert.deepEqual([...parseLsofCwd(out)], [[37226, '/Users/x/Dev/newsreader'], [1, '/']]);
});

test('parsePs', () => {
  assert.deepEqual([...parsePs(' 37226 37225\n   498   498\n')], [[37226, 37225], [498, 498]]);
});

const P = (id: string, dir: string) => ({ id, dir }) as Project;
const L = (pid: number, cwd: string, pgid = pid, port = 8000 + pid): Listener => ({ pid, pgid, port, cwd });

test('matchForeign maps cwd to project, drops unrelated and managed', () => {
  const projects = [P('newsreader', '/Users/x/Dev/newsreader'), P('games__arcade', '/Users/x/Dev/games/arcade'), P('music', '/Users/x/Dev/music')];
  const m = matchForeign([
    L(1, '/Users/x/Dev/newsreader'),
    L(2, '/Applications/Music.app'),
    L(3, '/Users/x/Dev/music', 99),
    L(4, '/Users/x/Dev/games/arcade/worker'),
    L(5, '/Users/x/Dev/newsreader-old'),
  ], projects, new Set([99]));
  assert.deepEqual([...m.keys()].sort(), ['games__arcade', 'newsreader']);
  assert.equal(m.get('newsreader')![0].pid, 1);
});

test('existingUrl uses the lowest port', async () => {
  const { existingUrl } = await import('../service/ports.ts');
  assert.equal(existingUrl([L(1, '/a', 1, 5180), L(1, '/a', 1, 8790)]), 'http://localhost:5180/');
  assert.equal(existingUrl([]), undefined);
});

test('foreignUrl prefers the port that serves HTML over a lower API port', async () => {
  const { foreignUrl } = await import('../service/ports.ts');
  const { createServer } = await import('node:http');
  const servers: import('node:http').Server[] = [];
  const listen = (type: string) => new Promise<number>((r) => { const s = createServer((_q, res) => { res.setHeader('Content-Type', type); res.end('x'); }).listen(0, '127.0.0.1', () => r((s.address() as any).port)); servers.push(s); });
  const api = await listen('application/json');
  const page = await listen('text/html; charset=utf-8');
  const [lo, hi] = api < page ? [api, page] : [page, api];
  const url = await foreignUrl([L(1, '/a', 1, lo), L(1, '/a', 1, hi)]);
  assert.equal(url, `http://localhost:${page}/`);
  assert.equal(await foreignUrl([L(1, '/a', 1, 1)]), 'http://localhost:1/'); // nothing answers: lowest port
  servers.forEach((s) => s.closeAllConnections?.());
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
});

test('keepWebListeners drops listeners that do not serve pages (debugger, raw TCP)', async () => {
  const { keepWebListeners } = await import('../service/ports.ts');
  const http = await import('node:http');
  const net = await import('node:net');
  const closers: (() => void)[] = [];
  const httpServer = (status: number) => new Promise<number>((r) => {
    const s = http.createServer((_q, res) => { res.statusCode = status; res.end('x'); }).listen(0, '127.0.0.1', () => r((s.address() as any).port));
    closers.push(() => { s.closeAllConnections(); s.close(); });
  });
  const page = await httpServer(200);
  const inspector = await httpServer(400); // node --inspect answers GET / with 400
  const raw = await new Promise<number>((r) => { const s = net.createServer((c) => c.end()).listen(0, '127.0.0.1', () => r((s.address() as any).port)); closers.push(() => s.close()); });
  const m = new Map([['p', [L(1, '/a', 1, page), L(1, '/a', 1, inspector), L(1, '/a', 1, raw)]], ['q', [L(2, '/b', 2, inspector)]]]);
  const kept = await keepWebListeners(m);
  assert.deepEqual(kept.get('p')!.map((l) => l.port), [page]);
  assert.equal(kept.has('q'), false);
  closers.forEach((c) => c());
});
