import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Api, type Ctx, OberthError, idea, ideaNote, ideas, launch, resolveProject, stop } from '../scripts/client.ts';
import { createMcp } from '../scripts/mcpserver.ts';

const proj = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, kind: 'app', status: 'stopped', foreign: [], ...extra });

/** A service with the given routes; records POSTs. Unknown routes answer like the real one does. */
function fakeApi(routes: Record<string, unknown | (() => unknown)>, posts: [string, unknown][] = []): Api {
  const get = async (path: string) => {
    if (!(path in routes)) throw new OberthError(`${path}: not found`);
    const r = routes[path];
    return typeof r === 'function' ? (r as () => unknown)() : r;
  };
  return {
    get,
    post: async (path, body) => { posts.push([path, body]); return path in routes ? get(path) : { ok: true }; },
    text: async (path) => String(await get(path)),
  };
}

function devTree(): { root: string; ctx: (api: Api, cwd?: string) => Ctx } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev-')));
  for (const d of ['app', 'group/sub', 'app/.claude/worktrees/w', 'private-one']) mkdirSync(join(root, d), { recursive: true });
  return { root, ctx: (api, cwd = root) => ({ api, cwd, roots: [{ path: root, label: 'dev' }], exclude: ['private-one'], selfDir: join(root, 'oberth'), sleep: async () => {} }) };
}

test('a project is found by id, by its folder, from inside it, and in a group', async () => {
  const { root, ctx } = devTree();
  const api = fakeApi({ '/api/projects': [proj('app'), proj('group__sub')] });
  assert.equal((await resolveProject(ctx(api), 'app')).id, 'app');
  assert.equal((await resolveProject(ctx(api, join(root, 'app/.claude/worktrees/w')), undefined)).id, 'app');
  assert.equal((await resolveProject(ctx(api), join(root, 'group/sub'))).id, 'group__sub');
  assert.equal((await resolveProject(ctx(api, join(root, 'group')), 'sub')).id, 'group__sub');
});

test('no project explains why: a root itself, outside every root, left out on purpose, unknown id', async () => {
  const { root, ctx } = devTree();
  const api = fakeApi({ '/api/projects': [proj('app')] });
  await assert.rejects(resolveProject(ctx(api), undefined), /itself, which is no project/);
  await assert.rejects(resolveProject(ctx(api, tmpdir()), undefined), /is not inside/);
  await assert.rejects(resolveProject(ctx(api), join(root, 'private-one')), /left out of Oberth on purpose/);
  await assert.rejects(resolveProject(ctx(api), 'nope'), /No project with the id "nope"/);
});

test('launch waits for the page, leaves a running server alone, and refuses a library', async () => {
  const { ctx } = devTree();
  let polls = 0;
  const posts: [string, unknown][] = [];
  const api = fakeApi({ '/api/projects': () => [proj('app', ++polls > 2 ? { status: 'running', url: 'http://localhost:5173/' } : {})] }, posts);
  assert.equal(await launch(ctx(api), 'app'), 'app is running at http://localhost:5173/.');
  assert.deepEqual(posts, [['/api/projects/app/launch', { mode: 'local', open: false }]]);

  const busy = fakeApi({ '/api/projects': [proj('app', { status: 'running', url: 'http://localhost:1/' })] }, posts);
  assert.equal(await launch(ctx(busy), 'app'), 'app is already running at http://localhost:1/.');
  assert.equal(posts.length, 1);
  await assert.rejects(launch(ctx(fakeApi({ '/api/projects': [proj('lib', { kind: 'library' })] })), 'lib'), /no dev server/);
});

test('a failed launch comes back with its error and the end of its log, colour codes removed', async () => {
  const { ctx } = devTree();
  let started = false;
  const api = fakeApi({
    '/api/projects': () => [proj('app', started ? { status: 'failed', error: 'exited with code 1' } : {})],
    '/api/projects/app/log': '\x1b[31mError: Cannot find module vite\x1b[0m\n',
  });
  const post = api.post;
  api.post = async (p, b) => { started = true; return post(p, b); };
  await assert.rejects(launch(ctx(api), 'app'), (e: OberthError) => {
    assert.equal(e.code, 1);
    assert.match(e.message, /failed to start: exited with code 1/);
    assert.match(e.message, /^Error: Cannot find module vite$/m);
    return true;
  });
});

test('launch says the pre-flight findings first, whether it then works or fails', async () => {
  const { ctx } = devTree();
  const pre = [{ check: 'node', short: 'needs Node >=24', text: 'engines.node in package.json asks for Node >=24.' }];
  let started = false;
  const api = fakeApi({
    '/api/projects': () => [proj('app', started ? { status: 'failed', error: 'exited with code 1', preflight: [] } : { preflight: pre })],
    '/api/projects/app/log': 'SyntaxError\n',
  });
  const post = api.post;
  api.post = async (p, b) => { started = true; return post(p, b); };
  await assert.rejects(launch(ctx(api), 'app'), (e: OberthError) => {
    assert.match(e.message, /^Before launching:\n- engines\.node in package\.json asks for Node >=24\.\n\napp: It failed to start/);
    return true;
  });
  let polls = 0;
  const ok = fakeApi({ '/api/projects': () => [proj('app', ++polls > 1 ? { status: 'running', url: 'http://localhost:5173/' } : { preflight: pre })] });
  assert.match(await launch(ctx(ok), 'app'), /^Before launching:[\s\S]*app is running at http:\/\/localhost:5173\/\.$/);
});

test('stop leaves servers started outside Oberth alone', async () => {
  const { ctx } = devTree();
  const posts: [string, unknown][] = [];
  const api = fakeApi({ '/api/projects': [proj('a', { status: 'running' }), proj('b', { foreign: [{ pid: 1 }] }), proj('c')] }, posts);
  assert.equal(await stop(ctx(api), 'a'), 'Stopped a.');
  assert.match(await stop(ctx(api), 'b'), /leaves it alone/);
  assert.equal(await stop(ctx(api), 'c'), "c wasn't running.");
  assert.deepEqual(posts.map(([p]) => p), ['/api/projects/a/stop']);
});

const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, params });

test('initialize agrees on a protocol version and says how to use Oberth', async () => {
  const handle = createMcp(devTree().ctx(fakeApi({})), '1', () => {});
  const r: any = await handle(rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }));
  assert.equal(r.result.protocolVersion, '2025-03-26');
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.match(r.result.instructions, /left out of Oberth on purpose: never add them or mention them there: private-one\./);
  const future: any = await handle(rpc(2, 'initialize', { protocolVersion: '2099-01-01' }));
  assert.equal(future.result.protocolVersion, '2025-06-18');
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.deepEqual(await handle(rpc(3, 'ping')), { jsonrpc: '2.0', id: 3, result: {} });
  assert.equal(((await handle(rpc(4, 'resources/list'))) as any).error.code, -32601);
});

test('every tool has a name, a description and an object schema whose required fields exist', async () => {
  const handle = createMcp(devTree().ctx(fakeApi({})), '1', () => {});
  const { result }: any = await handle(rpc(1, 'tools/list'));
  const names = result.tools.map((t: any) => t.name);
  assert.deepEqual(names.sort(), ['agenda', 'ask', 'asks', 'check', 'close_ask', 'idea', 'ideas', 'launch', 'output', 'project', 'projects', 'recap', 'search', 'set_about', 'stop']);
  for (const t of result.tools) {
    assert.ok(t.description.length > 20, t.name);
    assert.equal(t.inputSchema.type, 'object');
    for (const r of t.inputSchema.required ?? []) assert.ok(r in t.inputSchema.properties, `${t.name}.${r}`);
    assert.equal('run' in t, false);
  }
});

test('a tool answers as text; failures come back as the tool result with isError, not as protocol errors', async () => {
  const { ctx } = devTree();
  const posts: [string, unknown][] = [];
  const api = fakeApi({ '/api/projects': [proj('app', { about: { status: 'active' } })], '/api/projects/app/asks': { id: 'k1', text: 'Review it' } }, posts);
  const handle = createMcp({ ...ctx(api), sessionId: 's-1' }, '1', () => {});
  const list: any = await handle(rpc(1, 'tools/call', { name: 'projects', arguments: {} }));
  assert.match(list.result.content[0].text, /^app\s+app\s+stopped\s+active$/);
  assert.equal(list.result.isError, undefined);

  const asked: any = await handle(rpc(2, 'tools/call', { name: 'ask', arguments: { text: 'Review it', project: 'app' } }));
  assert.equal(asked.result.content[0].text, 'Asked on app: Review it (k1)');
  assert.deepEqual(posts.at(-1), ['/api/projects/app/asks', { text: 'Review it', detail: undefined, sessionId: 's-1' }]);

  const missing: any = await handle(rpc(3, 'tools/call', { name: 'project', arguments: { project: 'nope' } }));
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /No project with the id "nope"/);

  const down = createMcp(ctx({ get: async () => { throw new OberthError("Oberth service isn't running"); }, post: async () => ({}), text: async () => '' }), '1', () => {});
  const r: any = await down(rpc(4, 'tools/call', { name: 'agenda', arguments: {} }));
  assert.deepEqual(r.result, { content: [{ type: 'text', text: "Oberth service isn't running" }], isError: true });

  assert.equal(((await handle(rpc(5, 'tools/call', { name: 'rm', arguments: {} }))) as any).error.code, -32602);
  const bad: any = await handle(rpc(6, 'tools/call', { name: 'set_about', arguments: { project: 'app', released: true } }));
  assert.equal(bad.result.isError, true);
});

test('a long tool reports progress when the client asked for it', async () => {
  const { ctx } = devTree();
  const sent: any[] = [];
  const api = fakeApi({ '/api/projects': [proj('lib', { kind: 'library', about: { description: 'd', status: 'idea' } })], '/api/projects/lib/info': { command: '' } });
  const handle = createMcp(ctx(api), '1', (m) => sent.push(m));
  const r: any = await handle(rpc(1, 'tools/call', { name: 'check', arguments: { project: 'lib' }, _meta: { progressToken: 'p' } }));
  assert.match(r.result.content[0].text, /Integrated correctly\.$/);
  assert.deepEqual(sent.map((m) => [m.method, m.params.progressToken, m.params.progress]), [['notifications/progress', 'p', 1], ['notifications/progress', 'p', 2]]);
});

test('idea files a new-project idea, one for a project, or a note; Oberth itself takes ideas', async () => {
  const { root, ctx } = devTree();
  mkdirSync(join(root, 'oberth/service'), { recursive: true });
  const posts: [string, unknown][] = [];
  const made = (title: string, extra = {}) => ({ id: 'i7k2', title, notes: [], createdAt: 1, updatedAt: 1, ...extra });
  const api = fakeApi({ '/api/projects': [proj('app')] }, posts);
  api.post = async (path, body: any) => { posts.push([path, body]); return path.endsWith('/notes') ? made('X', { notes: [{}, {}] }) : made(body.title); };
  const c = { ...ctx(api, join(root, 'app')), source: 'mcp' as const, sessionId: 'local_5' };
  assert.equal(await idea(c, 'Recipe scaler'), 'Added to Ideas as a new project: Recipe scaler (i7k2)');
  assert.deepEqual(posts.at(-1), ['/api/ideas', { title: 'Recipe scaler', note: undefined, projectId: undefined, source: 'mcp', sessionId: 'local_5' }]);
  assert.equal(await idea(c, 'Share card', { project: 'here', note: 'PNG' }), 'Added to Ideas for app: Share card (i7k2)');
  assert.equal((posts.at(-1)![1] as any).projectId, 'app');
  await idea({ ...c, cwd: join(root, 'oberth/service') }, 'Retrospective', { project: 'here' });
  assert.equal((posts.at(-1)![1] as any).projectId, 'oberth', 'from inside Oberth, here is Oberth');
  assert.equal(await ideaNote(c, 'i7k2', 'more'), 'Note added to X (i7k2); it has 2 now.');
  await assert.rejects(idea(c, 'x', { project: 'nope' }), /No project with the id "nope"/);
});

test('ideas lists the sections, or one project’s ideas', async () => {
  const { ctx } = devTree();
  const i = (id: string, title: string, extra = {}) => ({ id, title, notes: [], createdAt: 0, updatedAt: Date.now(), ...extra });
  const api = fakeApi({
    '/api/projects': [proj('app')],
    '/api/ideas': { newProjects: [i('i001', 'Recipe scaler')], forProjects: [i('i002', 'Share card', { projectId: 'app', projectName: 'App', notes: [{}] })], started: [{ id: 'travel', fromIdea: 'Workouts' }] },
    '/api/ideas?project=app': { newProjects: [], forProjects: [], started: [] },
  });
  assert.equal(await ideas(ctx(api)), 'New projects:\n  i001  Recipe scaler  (today)\n\nFor existing projects:\n  i002  App: Share card  (1 note, today)\n\nStarted (projects with status idea):\n  travel  from "Workouts"');
  assert.equal(await ideas(ctx(api), 'app'), 'No open ideas for app.');
});
