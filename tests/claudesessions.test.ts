import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTree } from './fixtures/tree.ts';
import { effectiveSummary, parsePendingTool, pendingTool, scanSessions, type ClaudeSession } from '../service/claudesessions.ts';

const asked = (id: string, name: string, input: unknown = {}, extra: object = {}) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-05T08:43:28.962Z', message: { content: [{ type: 'tool_use', id, name, input }] }, ...extra });
const result = (id: string) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
const said = (text: string) => JSON.stringify({ type: 'user', message: { content: text } });
const jsonl = (...l: string[]) => l.join('\n') + '\n';

test('an unanswered question is pending, with its text and time', () => {
  const t = parsePendingTool(jsonl(said('hi'), asked('t1', 'AskUserQuestion', { questions: [{ question: 'Which one?' }] })))!;
  assert.deepEqual(t, { id: 't1', name: 'AskUserQuestion', at: Date.parse('2026-11-05T08:43:28.962Z'), question: 'Which one?' });
});

test('an answered call is not pending', () => {
  assert.equal(parsePendingTool(jsonl(asked('t1', 'AskUserQuestion'), result('t1'))), undefined);
});

test('a new message from the person abandons what was left open', () => {
  assert.equal(parsePendingTool(jsonl(asked('t1', 'Bash'), said('stop, do this instead'))), undefined);
});

test('a question wins over a call made alongside it; a subagent\'s own calls do not count', () => {
  assert.equal(parsePendingTool(jsonl(asked('t1', 'Bash'), asked('t2', 'AskUserQuestion')))!.id, 't2');
  assert.equal(parsePendingTool(jsonl(asked('t1', 'AskUserQuestion', {}, { isSidechain: true }))), undefined);
});

test('a tail that starts mid-line, or isn\'t the expected format, gives nothing and no crash', () => {
  assert.equal(parsePendingTool('half a line"}\n{"not":"ours"}\n'), undefined);
  assert.equal(parsePendingTool(jsonl('{"type":"assistant","message":{"content":"text"}}', '{"type":"user"}')), undefined);
  assert.equal(parsePendingTool(''), undefined);
});

test('pendingTool finds the transcript from the session\'s cwd and id, and sees it change', () => {
  const root = makeTree({ 'a.txt': '' });
  const s = { cwd: '/Users/me/Dev/my.app', cliSessionId: 'abc' } as ClaudeSession;
  assert.equal(pendingTool(s, root), undefined);
  mkdirSync(join(root, '-Users-me-Dev-my-app'));
  const file = join(root, '-Users-me-Dev-my-app', 'abc.jsonl');
  writeFileSync(file, jsonl(asked('t1', 'AskUserQuestion')));
  assert.equal(pendingTool(s, root)?.id, 't1');
  writeFileSync(file, jsonl(asked('t1', 'AskUserQuestion'), result('t1')));
  assert.equal(pendingTool(s, root), undefined);
  assert.equal(pendingTool({ ...s, cwd: undefined }, root), undefined);
});

test('a wrap-up overrides the summary the way the app shows it', () => {
  const blocked = { status_category: 'blocked', needs_action: 'old ask', status_detail: 'd', summarizes_uuid: 'u' };
  assert.equal(effectiveSummary(blocked, undefined)?.needsAction, 'old ask');
  assert.equal(effectiveSummary(blocked, undefined)?.forUuid, 'u');
  const cleared = effectiveSummary(blocked, { description: 'done' })!;
  assert.deepEqual([cleared.status, cleared.needsAction], ['review_ready', undefined]);
  const needed = effectiveSummary({ status_category: 'completed' }, { description: 'x', needsUser: 'pick one' })!;
  assert.deepEqual([needed.status, needed.needsAction], ['blocked', 'pick one']);
  const failed = effectiveSummary({ status_category: 'failed', needs_action: 'look' }, { description: 'x' })!;
  assert.deepEqual([failed.status, failed.needsAction], ['failed', 'look']);
  assert.equal(effectiveSummary(undefined, undefined), undefined);
  assert.equal(effectiveSummary('nonsense', undefined)?.status, undefined);
});

test('scanSessions reads the new fields and counts what it could not read', () => {
  const root = makeTree({ 'a.txt': '' });
  const org = join(root, 'acct', 'org');
  mkdirSync(org, { recursive: true });
  const cwd = realpathSync(root);
  const id = (n: number) => `local_${String(n).repeat(8)}-0000`;
  writeFileSync(join(org, `${id(1)}.json`), JSON.stringify({ sessionId: id(1), cwd, cliSessionId: 'c', lastAssistantUuid: 'u', postTurnSummary: { status_category: 'blocked', needs_action: 'do', summarizes_uuid: 'u' }, interruptedAwaitingPerson: true }));
  writeFileSync(join(org, `${id(2)}.json`), JSON.stringify({ sessionId: id(2), cwd, isArchived: true }));
  writeFileSync(join(org, `${id(3)}.json`), 'not json');
  writeFileSync(join(org, `${id(4)}.json`), JSON.stringify({ somethingElse: true }));
  const scan = scanSessions(root);
  assert.deepEqual([scan.files, scan.parsed, scan.summaries, scan.sessions.length], [4, 2, 1, 1]);
  const s = scan.sessions[0];
  assert.deepEqual([s.summary?.needsAction, s.cwd, s.cliSessionId, s.lastAssistantUuid, s.interruptedAwaitingPerson], ['do', cwd, 'c', 'u', true]);
});
