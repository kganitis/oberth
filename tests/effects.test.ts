import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTree } from './fixtures/tree.ts';
import { claudeStates, claudePids, claudeUrlFor, findClaudeSession, readSessions, sessionIdsFromEnv } from '../service/claudesessions.ts';

const session = (o: Record<string, unknown>) => JSON.stringify({ isArchived: false, lastActivityAt: 1, ...o });

test('no session for the folder → a new session on it, folder encoded', () => {
  const root = makeTree({ 'acct/org/local_aaaa.json': session({ sessionId: 'local_aaaa', cwd: '/elsewhere' }) });
  const dir = makeTree({ 'x.txt': '' });
  assert.equal(findClaudeSession(dir, root), undefined);
  assert.equal(claudeUrlFor(dir, root), `claude://code/new?folder=${encodeURIComponent(dir)}`);
  assert.equal(claudeUrlFor(`/no/such/it's "odd" & co`, root), 'claude://code/new?folder=%2Fno%2Fsuch%2Fit\'s%20%22odd%22%20%26%20co');
});

test('reopens the newest non-archived session of the folder; worktrees count by origin', () => {
  const dir = makeTree({ 'x.txt': '' });
  const root = makeTree({
    'acct/org/local_0001.json': session({ sessionId: 'local_0001', cwd: dir, lastActivityAt: 10 }),
    'acct/org/local_0002.json': session({ sessionId: 'local_0002', cwd: dir + '/.claude/worktrees/w', originCwd: dir, lastActivityAt: 30 }),
    'acct/org/local_0003.json': session({ sessionId: 'local_0003', cwd: dir, lastActivityAt: 99, isArchived: true }),
    'acct/org/local_0004.json': '{ half-written',
    'acct/deleted_org/local_0005.json': session({ sessionId: 'local_0005', cwd: dir, lastActivityAt: 500 }),
  });
  assert.equal(claudeUrlFor(dir, root), 'claude://claude.ai/epitaxy/local_0002');
});

test('a session in a parent folder is not the project\'s session', () => {
  const parent = makeTree({ 'proj/x.txt': '' });
  const root = makeTree({ 'acct/org/local_0001.json': session({ sessionId: 'local_0001', cwd: parent }) });
  mkdirSync(join(parent, 'proj'), { recursive: true });
  assert.equal(findClaudeSession(join(parent, 'proj'), root), undefined);
});

test('claude state: newest session wins, others counted, working only with a live process mid-turn', () => {
  const dir = makeTree({ 'x.txt': '' });
  const other = makeTree({ 'y.txt': '' });
  const root = makeTree({
    'acct/org/local_0001.json': session({ sessionId: 'local_0001', cwd: dir, title: 'old', lastActivityAt: 10 }),
    'acct/org/local_0002.json': session({ sessionId: 'local_0002', cwd: dir, title: 'arcade work', lastActivityAt: 30, latestUserFrameAt: 29, lastTurnEdgeAt: 20 }),
    'acct/org/local_0003.json': session({ sessionId: 'local_0003', cwd: other, title: 'done', lastActivityAt: 5, latestUserFrameAt: 4, lastTurnEdgeAt: 5 }),
  });
  const sessions = readSessions(root);
  const live = claudeStates([dir, other], sessions, new Set(['local_0002', 'local_0003']));
  assert.deepEqual(live.get(dir), { sessionId: 'local_0002', title: 'arcade work', at: 30, working: true, others: 1 });
  assert.equal(live.get(other)!.working, false); // turn already ended
  assert.equal(claudeStates([dir], sessions, new Set()).get(dir)!.working, false); // process gone (app quit mid-turn)
  assert.equal(claudeStates([makeTree({ 'z.txt': '' })], sessions, new Set()).size, 0);
});

test('live sessions: only processes whose executable is the claude binary are asked', () => {
  const comm = [
    '  101 /Users/x/Library/Application Support/Claude/claude-code/2.1/abc/claude.app/Contents/MacOS/claude',
    '  102 /Users/x/.nvm/versions/node/v22/bin/node',
    '  103 /bin/zsh',
    '  104 /Applications/Claude.app/Contents/MacOS/Claude',
  ].join('\n');
  assert.deepEqual(claudePids(comm), [101]);
  const env = '/Users/x/Library/Application Support/Claude/claude-code/2.1/abc/claude.app/Contents/MacOS/claude --verbose PATH=/bin CLAUDE_CODE_HOST_SESSION_ID=local_aaaa-1 HOME=/Users/x\n';
  assert.deepEqual([...sessionIdsFromEnv(env)], ['local_aaaa-1']);
  assert.equal(sessionIdsFromEnv('X_CLAUDE_CODE_HOST_SESSION_ID=local_bbbb').size, 0);
});
