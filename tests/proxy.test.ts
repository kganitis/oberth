import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { addressOf, createProxy, hostOf, hostTable, route } from '../service/proxy.ts';

test('hostOf: DNS labels from the folder path, nested part first', () => {
  assert.equal(hostOf('tune-picker'), 'tune-picker');
  assert.equal(hostOf('games/arcade'), 'arcade.games');
  assert.equal(hostOf('school/CampusGuide'), 'campusguide.school');
  assert.equal(hostOf('mysite.org'), 'mysite-org');
  assert.equal(hostOf('My Project_2'), 'my-project-2');
});

test('hostTable: chosen names win; names that collide both fall back to their id; reserved names are never given', () => {
  const t = hostTable([
    { id: 'tune-picker', relPath: 'tune-picker' },
    { id: 'games__arcade', relPath: 'games/arcade' },
    { id: 'a_b', relPath: 'a_b' }, { id: 'a-b', relPath: 'a-b' },
    { id: 'blog', relPath: 'blog', host: 'notes' },
    { id: 'bad', relPath: 'bad', host: 'Not A Name!' },
    { id: 'oberth', relPath: 'oberth' },
  ]);
  assert.equal(t.get('tune-picker'), 'tune-picker');
  assert.equal(t.get('arcade.games'), 'games__arcade');
  assert.equal(t.get('notes'), 'blog');
  assert.equal(t.get('bad'), 'bad', 'an invalid chosen name is ignored');
  assert.equal(t.has('oberth'), false, 'oberth.localhost belongs to the dashboard');
  const ab = [...t].filter(([, id]) => id === 'a_b' || id === 'a-b').map(([n]) => n).sort();
  assert.equal(ab.length, 2);
  assert.equal(new Set(ab).size, 2, 'two projects never share an address');
  assert.equal(addressOf(t, 'games__arcade'), 'http://arcade.games.localhost:7700/');
});

test('route: only exactly <known name>.localhost on the proxy port', () => {
  const t = new Map([['tune-picker', 'tune-picker']]);
  assert.deepEqual(route('tune-picker.localhost:7700', t), { kind: 'project', id: 'tune-picker', name: 'tune-picker' });
  assert.deepEqual(route('Tune-Picker.LOCALHOST:7700', t), { kind: 'project', id: 'tune-picker', name: 'tune-picker' });
  assert.deepEqual(route('oberth.localhost:7700', t), { kind: 'oberth' });
  for (const h of ['evil.example:7700', 'tune-picker.localhost:7777', 'tune-picker.localhost', 'localhost:7700', 'other.localhost:7700', 'tune-picker.localhost.evil.example:7700', undefined]) {
    assert.deepEqual(route(h, t), { kind: 'unknown' }, String(h));
  }
});

// ---------- forwarding, against a real dev server stand-in ----------

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

async function rig() {
  const seen: Record<string, string | undefined>[] = [];
  const dev = createServer((req, res) => {
    seen.push({ host: req.headers.host, fwd: String(req.headers['x-forwarded-host']), url: req.url });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Set-Cookie', ['a=1', 'b=2']);
      res.writeHead(201, { 'Content-Type': 'text/plain' });
      res.end(`${req.method} ${req.url} ${body}`);
    });
  });
  // a WebSocket stand-in: answers the upgrade, then echoes bytes back in capitals
  const sockets = new Set<import('node:stream').Duplex>();
  dev.on('upgrade', (req, socket) => {
    sockets.add(socket);
    seen.push({ host: req.headers.host, upgrade: req.headers.upgrade });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(d.toString().toUpperCase()));
  });
  const devPort = await listen(dev);
  let running = true;
  // the proxy checks the port in Host against its own, so it needs its port before listening
  const free = createServer();
  const proxyPort = await listen(free);
  await new Promise((r) => free.close(r));
  const real = createProxy({
    port: proxyPort,
    table: () => new Map([['app', 'app'], ['idle', 'idle']]),
    target: (id) => (id === 'app' && running ? { host: '127.0.0.1', port: devPort } : undefined),
    nameOf: (id) => ({ app: 'App', idle: 'Idle Project' } as Record<string, string>)[id],
    dashboard: 'http://127.0.0.1:7777/',
  });
  await new Promise<void>((r) => real.listen(proxyPort, '127.0.0.1', () => r()));
  // keep-alive and WebSocket connections would hold the servers open past the test
  after(() => { for (const s of sockets) s.destroy(); real.closeAllConnections(); dev.closeAllConnections(); real.close(); dev.close(); });
  const call = (host: string, method = 'GET', path = '/', body?: string) => new Promise<{ status: number; body: string; headers: any }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: proxyPort, method, path, headers: { Host: host } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
  return { call, seen, proxyPort, stop: () => { running = false; } };
}

test('proxy: forwards requests with their body and Host, and passes every response header back', async () => {
  const r = await rig();
  const host = `app.localhost:${r.proxyPort}`;
  const res = await r.call(host, 'POST', '/api/x?y=1', 'hello');
  assert.equal(res.status, 201);
  assert.equal(res.body, 'POST /api/x?y=1 hello');
  assert.deepEqual(res.headers['set-cookie'], ['a=1', 'b=2'], 'repeated headers survive');
  assert.deepEqual(r.seen.at(-1), { host, fwd: host, url: '/api/x?y=1' });
});

test('proxy: unknown names and other hosts get a bare 404; oberth goes to the dashboard; a stopped project gets a page, not a launch', async () => {
  const r = await rig();
  assert.equal((await r.call(`nope.localhost:${r.proxyPort}`)).status, 404);
  assert.equal((await r.call(`evil.example:${r.proxyPort}`)).body, 'Not found\n', 'says nothing about which projects exist');
  const o = await r.call(`oberth.localhost:${r.proxyPort}`);
  assert.equal(o.status, 302);
  assert.equal(o.headers.location, 'http://127.0.0.1:7777/');
  const idle = await r.call(`idle.localhost:${r.proxyPort}`);
  assert.equal(idle.status, 503);
  assert.match(idle.body, /Idle Project isn&#39;t running/);
  assert.match(idle.body, /href="http:\/\/127\.0\.0\.1:7777\/\?p=idle"/);
  assert.equal(r.seen.length, 0, 'nothing reached the dev server');
});

test('proxy: a WebSocket upgrade is passed through and bytes flow both ways; a stopped project refuses it', async () => {
  const r = await rig();
  const talk = (host: string) => new Promise<string>((resolve, reject) => {
    const s = connect(r.proxyPort, '127.0.0.1', () => {
      s.write(`GET /hmr HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let got = '';
    s.on('data', (d) => {
      got += d.toString();
      if (got.includes('\r\n\r\n') && !got.includes('PING') && got.startsWith('HTTP/1.1 101')) s.write('ping');
      if (got.includes('PING') || got.startsWith('HTTP/1.1 404')) { s.destroy(); resolve(got); }
    });
    s.on('error', reject);
  });
  const ok = await talk(`app.localhost:${r.proxyPort}`);
  assert.match(ok, /^HTTP\/1\.1 101/);
  assert.match(ok, /PING$/);
  assert.equal(r.seen.at(-1)!.upgrade, 'websocket');
  r.stop();
  assert.match(await talk(`app.localhost:${r.proxyPort}`), /^HTTP\/1\.1 404/);
  assert.match(await talk(`evil.example:${r.proxyPort}`), /^HTTP\/1\.1 404/);
});
