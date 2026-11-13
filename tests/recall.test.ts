import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcriptFolder, type ClaudeSession } from '../service/claudesessions.ts';
import { Recall, snippet, spokenMatch, takeTurns, type RecallProject } from '../service/recall.ts';
import { makeTree } from './fixtures/tree.ts';

const said = (type: 'user' | 'assistant', text: string, at = '2026-11-01T10:00:00Z', extra = {}) => JSON.stringify({
  type, uuid: 'u1', timestamp: at, ...extra,
  message: { content: type === 'user' ? text : [{ type: 'text', text }] },
}) + '\n';
const toolOutput = (text: string) => JSON.stringify({ type: 'user', uuid: 'u2', timestamp: '2026-11-01T10:00:00Z', message: { content: [{ type: 'tool_result', content: text }] } }) + '\n';
const session = (o: Partial<ClaudeSession>): ClaudeSession => ({ id: 'local_1', title: 'A session', folder: '/nowhere', lastActivityAt: 0, latestUserFrameAt: 0, lastTurnEdgeAt: 0, ...o });

function setup(files: Record<string, string> = {}, sessions: (dirs: Record<string, string>) => ClaudeSession[] = () => []) {
  const app = realpathSync(makeTree({ 'src/main.ts': 'const x = 1;\n// the zebra rule\n', 'docs/guide.md': 'About the zebra.\n', 'node_modules/dep/index.js': 'zebra\n', ...files }));
  const other = realpathSync(makeTree({ 'lib.py': 'zebra = 2\n' }));
  const projects: RecallProject[] = [{ id: 'app', name: 'App', dir: app }, { id: 'other', name: 'Other', dir: other }];
  const root = mkdtempSync(join(tmpdir(), 'recall-'));
  const write = (dir: string, name: string, body: string, at = 1000) => {
    const folder = join(root, transcriptFolder(dir));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), body);
    utimesSync(join(folder, name), at, at);
  };
  const recall = new Recall({ projects: () => projects, sessions: () => sessions({ app, other }), about: () => ({ app: { notes: 'Left off at the zebra crossing.' } }), transcriptsRoot: root });
  return { app, other, root, write, recall };
}

test('snippet shows the match on one line, cut around it', () => {
  assert.equal(snippet('a\n  b', 'b'), 'a b');
  const s = snippet(`${'x'.repeat(300)} needle ${'y'.repeat(300)}`, 'NEEDLE');
  assert.ok(s.includes('needle') && s.startsWith('…') && s.endsWith('…'));
});

test('spokenMatch keeps prompts and replies, not tool output, side chains or text without the words', () => {
  assert.equal(spokenMatch(said('user', 'Fix the Zebra'), 'zebra')?.who, 'You');
  assert.equal(spokenMatch(said('assistant', 'Fixed the zebra'), 'zebra')?.who, 'Claude');
  assert.equal(spokenMatch(toolOutput('zebra'), 'zebra'), undefined);
  assert.equal(spokenMatch(said('assistant', 'zebra', undefined, { isSidechain: true }), 'zebra'), undefined);
  assert.equal(spokenMatch(said('user', '<command-name>zebra'), 'zebra'), undefined);
  assert.equal(spokenMatch(JSON.stringify({ type: 'assistant', uuid: 'u', message: { content: [{ type: 'tool_use', input: { a: 'zebra' } }] } }), 'zebra'), undefined);
  assert.equal(spokenMatch('not json zebra', 'zebra'), undefined);
});

test('takeTurns gives each project a turn', () => {
  assert.deepEqual(takeTurns(['a1', 'a2', 'a3', 'b1'], (s) => s[0], 3), ['a1', 'b1', 'a2']);
  assert.deepEqual(takeTurns(['a1'], (s) => s[0], 3), ['a1']);
});

test('finds code, docs and notes across projects, leaving out node_modules', async () => {
  const { recall, app } = setup();
  const { hits, error } = await recall.search('ZEBRA');
  assert.equal(error, undefined);
  const titles = hits.map((h) => `${h.kind} ${h.project} ${h.title}`).sort();
  assert.deepEqual(titles, ['code App src/main.ts:2', 'code Other lib.py:1', 'docs App docs/guide.md:1', 'notes App About']);
  const code = hits.find((h) => h.title === 'src/main.ts:2')!;
  assert.deepEqual(recall.open(code.key), { type: 'file', path: join(app, 'src/main.ts'), line: 2 });
  assert.deepEqual(recall.open(hits.find((h) => h.kind === 'notes')!.key), { type: 'about' });
});

test('the query is a literal, even when it looks like a flag or a pattern', async () => {
  const { recall } = setup({ 'a.txt': 'cost (a+b)* here\n--files\n' });
  assert.deepEqual((await recall.search('(a+b)*')).hits.map((h) => h.title), ['a.txt:1']);
  assert.deepEqual((await recall.search('--files')).hits.map((h) => h.title), ['a.txt:2']);
  assert.deepEqual((await recall.search('nothing like this')).hits, []);
});

test('project and kind narrow a search', async () => {
  const { recall } = setup();
  assert.deepEqual((await recall.search('zebra', { project: 'other' })).hits.map((h) => h.title), ['lib.py:1']);
  assert.deepEqual((await recall.search('zebra', { kind: 'docs' })).hits.map((h) => h.title), ['docs/guide.md:1']);
  assert.deepEqual((await recall.search('zebra', { kind: 'notes' })).hits.map((h) => h.kind), ['notes']);
  assert.deepEqual((await recall.search('zebra', { project: 'gone' })).hits, []);
});

test('sessions: one row each, newest first, the owner\'s words before Claude\'s, opening the app\'s session if it has one', async () => {
  const { recall, write, app } = setup({}, ({ app }) => [session({ id: 'local_a', title: 'Zebra work', folder: app, cliSessionId: 'cli-a' })]);
  write(app, 'cli-a.jsonl', said('assistant', 'the zebra is done', '2026-11-02T10:00:00Z') + said('user', 'now the zebra', '2026-11-02T11:00:00Z'));
  write(app, 'cli-b.jsonl', said('assistant', 'a zebra, in a terminal', '2026-11-01T10:00:00Z'));
  write(app, 'cli-c.jsonl', toolOutput('only a tool saw the zebra'));
  const { hits } = await recall.search('zebra', { kind: 'sessions' });
  assert.deepEqual(hits.map((h) => [h.title, h.snippet]), [['Zebra work', 'You: now the zebra'], ['Claude session', 'Claude: a zebra, in a terminal']]);
  assert.deepEqual(recall.open(hits[0].key), { type: 'session', id: 'local_a' });
  assert.deepEqual(recall.open(hits[1].key), { type: 'claude', dir: app });
});

test('a real conversation is found behind newer transcripts that only match in tool output', async () => {
  const { recall, write, app } = setup();
  for (let i = 0; i < 45; i++) write(app, `noise-${i}.jsonl`, toolOutput('zebra in a CLAUDE.md'), 5000 + i);
  write(app, 'old.jsonl', said('user', 'how did the zebra work'), 1000);
  assert.deepEqual((await recall.search('zebra', { kind: 'sessions' })).hits.map((h) => h.snippet), ['You: how did the zebra work']);
});

test('a session with no session file takes its title from the transcript; one resumed under a new id still finds its session', async () => {
  const { recall, write, app } = setup({}, ({ app }) => [session({ id: 'local_first', title: 'From the app', folder: app, cliSessionId: 'second' })]);
  const title = (type: string, field: string, v: string) => JSON.stringify({ type, [field]: v }) + '\n';
  write(app, 'named.jsonl', title('ai-title', 'aiTitle', 'Generated') + title('custom-title', 'customTitle', 'Old name') + title('custom-title', 'customTitle', 'Chosen name') + title('ai-title', 'aiTitle', 'Generated later') + said('user', 'zebra one', '2026-11-03T10:00:00Z'));
  write(app, 'generated.jsonl', title('ai-title', 'aiTitle', 'Generated') + said('user', 'zebra two', '2026-11-02T10:00:00Z'));
  write(app, 'first.jsonl', said('user', 'zebra three', '2026-11-01T10:00:00Z'));
  const { hits } = await recall.search('zebra', { kind: 'sessions' });
  assert.deepEqual(hits.map((h) => h.title), ['Chosen name', 'Generated', 'From the app']);
  assert.deepEqual(recall.open(hits[2].key), { type: 'session', id: 'local_first' });
});

test('a quote in the query still finds a transcript, where quotes are escaped', async () => {
  const { recall, write, app } = setup();
  write(app, 's.jsonl', said('user', 'why does "zebra" break'));
  assert.equal((await recall.search('"zebra"', { kind: 'sessions' })).hits.length, 1);
});

test('a worktree session counts for its project; a project left out of Oberth never shows, by any route', async () => {
  const hiddenDir = '/Users/me/Dev/Secret', worktree = '/Users/me/wt/app-branch', hiddenTree = '/Users/me/wt/secret-branch';
  const { recall, write, app } = setup({}, ({ app }) => [
    session({ id: 'local_w', folder: app, cwd: worktree, cliSessionId: 'cli-w' }),
    session({ id: 'local_h', folder: hiddenDir, cwd: hiddenTree, cliSessionId: 'cli-h' }),
  ]);
  write(worktree, 'cli-w.jsonl', said('user', 'zebra in the worktree'));
  write(worktree, 'cli-other.jsonl', said('user', 'zebra in a session the app has no file for'));
  write(hiddenDir, 'x.jsonl', said('user', 'zebra in the hidden project'));
  write(hiddenTree, 'cli-h.jsonl', said('user', 'zebra in the hidden worktree'));
  write(`${app}-copy`, 'y.jsonl', said('user', 'zebra in a folder whose name starts the same'));
  const { hits } = await recall.search('zebra', { kind: 'sessions' });
  assert.deepEqual(hits.map((h) => h.snippet), ['You: zebra in the worktree']);
});

test('a key that no search handed out opens nothing, and a missing rg is said, with notes still found', async () => {
  const { recall } = setup();
  assert.equal(recall.open('code:app:/etc/passwd:1'), undefined);
  assert.equal(recall.open({ key: 1 }), undefined);
  const noRg = new Recall({ projects: () => [{ id: 'app', name: 'App', dir: '/tmp' }], sessions: () => [], about: () => ({ app: { notes: 'zebra' } }), rg: '/nowhere/rg' });
  const r = await noRg.search('zebra');
  assert.match(r.error!, /brew install ripgrep/);
  assert.deepEqual(r.hits.map((h) => h.kind), ['notes']);
});

test('ideas: titles and notes are searched, open or not, and can be scoped to a project', async () => {
  const idea = (id: string, title: string, extra: object = {}) => ({ id, title, notes: [], state: 'open' as const, createdAt: 0, updatedAt: 1, ...extra });
  const recall = new Recall({
    projects: () => [{ id: 'app', name: 'App', dir: '/tmp' }], sessions: () => [], about: () => ({}), rg: '/nowhere/rg',
    ideas: () => [
      idea('i001', 'Zebra crossing game'),
      idea('i002', 'Share card', { projectId: 'app', notes: [{ at: 0, text: 'with a zebra pattern', source: 'cli' }], updatedAt: 5 }),
      idea('i003', 'Old zebra thing', { state: 'dropped' }),
    ],
  });
  const r = await recall.search('zebra', { kind: 'ideas' });
  assert.deepEqual(r.hits.map((h) => [h.title, h.project]), [['Idea: Share card', 'App'], ['Idea: Zebra crossing game', 'New project'], ['Idea: Old zebra thing (dropped)', 'New project']]);
  assert.deepEqual(recall.open(r.hits[0].key), { type: 'idea', id: 'i002' });
  assert.deepEqual((await recall.search('zebra', { kind: 'ideas', project: 'app' })).hits.map((h) => h.key), ['ideas:i002']);
});
