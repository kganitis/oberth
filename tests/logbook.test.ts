import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityLog } from '../service/activity.ts';
import type { ClaudeSession } from '../service/claudesessions.ts';
import { activeMs, Logbook, readTurns, type LogbookOptions } from '../service/logbook.ts';

const T0 = new Date(2026, 10, 2, 10, 0).getTime();
const min = (n: number): number => T0 + n * 60_000;
const iso = (at: number): string => new Date(at).toISOString();
const prompt = (uuid: string, at: number, extra: object = {}) => JSON.stringify({ type: 'user', uuid, timestamp: iso(at), origin: { kind: 'human' }, message: { content: 'do it' }, ...extra }) + '\n';
const reply = (at: number) => JSON.stringify({ type: 'assistant', uuid: `a${at}`, timestamp: iso(at), message: { content: [] } }) + '\n';
const toolResult = (at: number) => JSON.stringify({ type: 'user', uuid: `t${at}`, timestamp: iso(at), message: { content: [{ type: 'tool_result' }] } }) + '\n';

test('activeMs leaves out silences over five minutes, and copes with times out of order', () => {
  assert.equal(activeMs([min(0), min(2), min(3)]), 3 * 60_000);
  assert.equal(activeMs([min(0), min(1), min(60), min(61)]), 2 * 60_000);
  assert.equal(activeMs([min(3), min(0)]), 3 * 60_000);
  assert.equal(activeMs([min(0)]), 0);
});

test('readTurns: a turn runs from a prompt to the next, and the last waits until it is final', () => {
  const first = prompt('p1', min(0)) + reply(min(1)) + toolResult(min(2));
  const second = prompt('p2', min(10)) + reply(min(11));
  const buf = Buffer.from(first + second);
  const live = readTurns(buf, false);
  assert.deepEqual(live.turns, [{ key: 'p1', at: min(0), ms: 2 * 60_000 }]);
  assert.equal(live.consumed, Buffer.byteLength(first));
  const done = readTurns(buf, true);
  assert.deepEqual(done.turns.map((t) => t.key), ['p1', 'p2']);
  assert.equal(done.consumed, buf.length);
});

test('readTurns: a turn carries its responses\u2019 usage, each response once, priced per model', () => {
  const used = (at: number, id: string, model: string, usage: object) => JSON.stringify({ type: 'assistant', uuid: `a${at}`, timestamp: iso(at), message: { id, model, usage, content: [] } }) + '\n';
  const u = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0 };
  const buf = Buffer.from(
    prompt('p1', min(0))
    // one response written over two lines repeats its usage: it counts once
    + used(min(1), 'm1', 'claude-opus-5-5', u) + used(min(1), 'm1', 'claude-opus-5-5', u)
    + used(min(2), 'm2', 'claude-haiku-5-5', u)
    + used(min(3), 'm3', 'claude-new-model', u)
    + used(min(3), 'm4', '<synthetic>', u)
    + prompt('p2', min(10)) + reply(min(11)),
  );
  const [first, second] = readTurns(buf, true).turns;
  assert.deepEqual(first.usage?.tokens, { input: 3000, output: 3000, write5m: 0, write1h: 0, read: 0 });
  assert.ok(Math.abs(first.usage!.usd - (0.004 + 0.02 + 0.0001 + 0.0005)) < 1e-12);
  assert.equal(first.usage?.unpriced, 2000, 'a model with no price is counted, not priced');
  assert.deepEqual(first.usage?.models, ['claude-haiku-5-5', 'claude-new-model', 'claude-opus-5-5']);
  assert.equal(second.usage, undefined, 'no usage, no field');
});

test('readTurns: only the owner starts a turn', () => {
  const notes = [
    prompt('n1', min(1), { origin: { kind: 'task-notification' } }),
    prompt('n2', min(2), { isCompactSummary: true }),
    prompt('n3', min(3), { isMeta: true }),
    prompt('n4', min(4), { isSidechain: true }),
    prompt('n5', min(5), { origin: undefined, message: { content: '<command-name>/compact</command-name>' } }),
  ].join('');
  const { turns } = readTurns(Buffer.from(prompt('p1', min(0)) + notes), true);
  assert.deepEqual(turns.map((t) => t.key), ['p1']);
  assert.equal(turns[0].ms, 5 * 60_000);
});

test('readTurns: a line still being written and a damaged one are passed over', () => {
  const whole = prompt('p1', min(0)) + '{"broken\n' + reply(min(1));
  const { turns, consumed } = readTurns(Buffer.from(whole + '{"type":"assis'), true);
  assert.deepEqual(turns, [{ key: 'p1', at: min(0), ms: 60_000 }]);
  assert.equal(consumed, Buffer.byteLength(whole));
});

function world(now: { at: number }) {
  const stateDir = mkdtempSync(join(tmpdir(), 'lb-state-'));
  const root = mkdtempSync(join(tmpdir(), 'lb-tr-'));
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lb-proj-')));
  const session: ClaudeSession = { id: 'local_1', title: 'Fix the thing', folder: dir, cwd: dir, cliSessionId: 'cli1', lastActivityAt: 0, latestUserFrameAt: 0, lastTurnEdgeAt: 0, archived: true };
  const folder = join(root, dir.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(folder);
  const transcript = join(folder, 'cli1.jsonl');
  const log = new ActivityLog(stateDir, () => now.at);
  const options: LogbookOptions = {
    stateDir, log, transcriptsRoot: root, now: () => now.at,
    projects: () => [{ id: 'app', dir }], sessions: () => [session],
    commits: async () => [], stamp: () => 'none',
  };
  return { stateDir, root, dir, session, transcript, log, options };
}

const quiet = (file: string, at: number) => { const t = new Date(at); utimesSync(file, t, t); };

test('sessions: finished turns are recorded under the project, with title and active time', async () => {
  const now = { at: min(60) };
  const w = world(now);
  writeFileSync(w.transcript, prompt('p1', min(0)) + reply(min(3)));
  quiet(w.transcript, min(3));
  await new Logbook(w.options).tick();
  const [e] = w.log.onDay(T0);
  assert.deepEqual({ id: e.id, kind: e.kind, text: e.text, sessionId: e.sessionId, ms: e.ms, at: e.at }, { id: 'app', kind: 'session', text: 'Fix the thing', sessionId: 'local_1', ms: 3 * 60_000, at: min(0) });
});

test('sessions: a live turn waits, then is recorded once, and a restart reads only what is new', async () => {
  const now = { at: min(5) };
  const w = world(now);
  writeFileSync(w.transcript, prompt('p1', min(0)) + reply(min(4)));
  quiet(w.transcript, min(4));
  const book = new Logbook(w.options);
  await book.tick();
  assert.equal(w.log.onDay(T0).length, 0);

  appendFileSync(w.transcript, prompt('p2', min(5)) + reply(min(6)));
  quiet(w.transcript, min(6));
  now.at = min(7);
  await book.tick();
  assert.deepEqual(w.log.onDay(T0).map((e) => e.ms), [4 * 60_000]);

  now.at = min(30); // gone quiet
  await book.tick();
  await book.tick();
  await new Logbook(w.options).tick();
  assert.deepEqual(w.log.onDay(T0).map((e) => e.key), ['p1', 'p2']);
});

test('sessions: a transcript with no session file still counts, by its folder, and titles itself', async () => {
  const now = { at: min(60) };
  const w = world(now);
  writeFileSync(w.transcript, JSON.stringify({ type: 'custom-title', customTitle: 'From the transcript' }) + '\n' + prompt('p1', min(0)) + reply(min(1)));
  quiet(w.transcript, min(1));
  await new Logbook({ ...w.options, sessions: () => [] }).tick();
  const [e] = w.log.onDay(T0);
  assert.equal(e.text, 'From the transcript');
  assert.equal(e.sessionId, undefined);
});

test('sessions: a worktree session takes its project from the session file; other folders are passed over', async () => {
  const now = { at: min(60) };
  const w = world(now);
  const write = (folder: string, name: string, key: string) => {
    mkdirSync(join(w.root, folder));
    const file = join(w.root, folder, `${name}.jsonl`);
    writeFileSync(file, prompt(key, min(0)) + reply(min(1)));
    quiet(file, min(1));
  };
  write('-some-worktree', 'cli2', 'in-worktree');
  write('-elsewhere', 'cli3', 'not-a-project');
  await new Logbook({ ...w.options, sessions: () => [{ ...w.session, cliSessionId: 'cli2' }] }).tick();
  assert.deepEqual(w.log.onDay(T0).map((e) => [e.key, e.id]), [['in-worktree', 'app']]);
});

test('commits: recorded once under their own day, and git runs only when the reflog changed', async () => {
  const now = { at: min(60) };
  const w = world(now);
  let stamp = 'a', calls = 0;
  const book = new Logbook({
    ...w.options, stamp: () => stamp,
    commits: async () => { calls++; return [{ full: 'abc123', hash: 'abc', subject: 'fix', time: min(-1440) }, { full: 'def456', hash: 'def', subject: 'add', time: min(0) }]; },
  });
  await book.tick();
  await book.tick();
  assert.equal(calls, 1);
  stamp = 'b';
  await book.tick();
  assert.equal(calls, 2);
  assert.deepEqual(w.log.onDay(min(0)).map((e) => e.text), ['def add']);
  assert.deepEqual(w.log.onDay(min(-1440)).map((e) => e.kind), ['commit']);
});

test('commits: a folder with no repository is never asked', async () => {
  const w = world({ at: min(60) });
  let calls = 0;
  await new Logbook({ ...w.options, commits: async () => { calls++; return []; } }).tick();
  assert.equal(calls, 0);
});

test('usage: recorded as its own event per turn; offsets from before usage was counted are read again without doubling turns', async () => {
  const now = { at: min(60) };
  const w = world(now);
  const used = JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: iso(min(2)), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1e6, output_tokens: 0 }, content: [] } }) + '\n';
  writeFileSync(w.transcript, prompt('p1', min(0)) + used);
  quiet(w.transcript, min(2));
  // as an older Oberth left it: the turn recorded, the transcript read to its end, no usage
  w.log.addOnce({ at: min(0), id: 'app', kind: 'session', text: 'Fix the thing', sessionId: 'local_1', ms: 2 * 60_000, key: 'p1' });
  writeFileSync(join(w.stateDir, 'logbook.json'), JSON.stringify({ offsets: { cli1: 1e9 } }));
  await new Logbook(w.options).tick();
  const events = w.log.onDay(T0);
  assert.deepEqual(events.map((e) => e.kind).sort(), ['session', 'usage'], 'the turn is not recorded twice');
  const u = events.find((e) => e.kind === 'usage')!;
  assert.deepEqual([u.key, u.usd, u.text, u.id], ['u:p1', 4, 'claude-opus-5-5', 'app']);
  // the new offsets carry the version, so the next start reads only what is new
  assert.equal(JSON.parse(readFileSync(join(w.stateDir, 'logbook.json'), 'utf8')).version, 2);
});
