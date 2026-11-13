import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Activity } from '../service/activity.ts';
import { lastPrompt, transcriptFolder } from '../service/claudesessions.ts';
import { buildRecap, resumeBrief } from '../service/recap.ts';
import type { GitDetail } from '../service/types.ts';

const turn = (at: number, ms: number, sessionId: string | undefined, text: string): Activity => ({ at, id: 'p', kind: 'session', text, ms, sessionId });
const git = (n: number): GitDetail => ({ branch: 'main', ahead: 2, behind: 0, files: [{ path: 'a', status: 'M' } as never], commits: Array.from({ length: n }, (_, i) => ({ hash: `h${i}`, subject: `s${i}`, time: 1000 - i, unpushed: false })) });

test('sessions add up, newest first, at most three', () => {
  const r = buildRecap([turn(10, 5, 'a', 'A'), turn(20, 5, 'a', 'A'), turn(30, 1, 'b', 'B'), turn(40, 1, 'c', 'C'), turn(50, 1, undefined, 'D')], null, null);
  assert.deepEqual(r.sessions.map((s) => s.title), ['D', 'C', 'B']);
  const older = buildRecap([turn(10, 5, 'a', 'A'), turn(20, 5, 'a', 'A')], null, null);
  assert.deepEqual(older.sessions, [{ title: 'A', at: 25, ms: 10, turns: 2 }]);
});

test('commits come from git, however old, and the last work is the latest of everything', () => {
  const r = buildRecap([turn(10, 5, 'a', 'A')], git(8), { ahead: 2, changed: 1, stashes: 3 });
  assert.deepEqual(r.commits.map((c) => c.hash), ['h0', 'h1', 'h2', 'h3', 'h4']);
  assert.equal(r.lastWorkAt, 1000);
  assert.deepEqual(r.left, { branch: 'main', changed: 1, ahead: 2, stashes: 3 });
  assert.equal(buildRecap([turn(5000, 5, 'a', 'A')], git(1), null).lastWorkAt, 5005);
});

test('a long prompt is clipped; a folder with no repository and no history makes an empty recap', () => {
  const r = buildRecap([], null, null, { text: 'x'.repeat(400), at: 1 });
  assert.equal(r.prompt!.text.length, 280);
  assert.deepEqual(buildRecap([], null, null), { lastWorkAt: undefined, prompt: undefined, sessions: [], commits: [], left: undefined });
});

test('lastPrompt reads the newest transcript that has one', () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-'));
  const dir = '/Users/me/Dev/app';
  assert.equal(lastPrompt(dir, root), undefined);
  const folder = join(root, transcriptFolder(dir));
  mkdirSync(folder);
  const line = (text: string) => JSON.stringify({ type: 'last-prompt', lastPrompt: text }) + '\n';
  const write = (name: string, body: string, at: number) => { writeFileSync(join(folder, name), body); utimesSync(join(folder, name), at, at); };
  write('old.jsonl', line('old ask'), 1000);
  write('mid.jsonl', line('first') + '{"type":"user"}\nnot json\n' + line('the last ask') + '{"type":"assistant"}\n', 2000);
  write('new.jsonl', '{"type":"user"}\n', 3000);
  write('notes.txt', line('ignored'), 4000);
  assert.deepEqual(lastPrompt(dir, root), { text: 'the last ask', at: 2_000_000 });
});

test('resumeBrief: the card and the notes as a first message, ending with a request to take stock first', () => {
  const at = Date.parse('2026-10-01T12:00:00Z');
  const brief = resumeBrief('Tune Picker', 'Left at the album filter.', {
    lastWorkAt: at, prompt: { text: 'add tie-breaks', at },
    sessions: [{ title: 'Album filter', at, ms: 60_000, turns: 3 }],
    commits: [{ hash: 'abc1234', subject: 'Filter albums', time: at }],
    left: { branch: 'filters', changed: 2, ahead: 1, stashes: 0 },
  });
  assert.match(brief, /^I'm picking up Tune Picker again, last worked on 1 Oct 2026\./);
  assert.match(brief, /My notes on it:\nLeft at the album filter\./);
  assert.match(brief, /- The last thing I asked Claude here: "add tie-breaks"/);
  assert.match(brief, /- Left behind: on branch filters, 2 files not committed, 1 commit not pushed/);
  assert.match(brief, /- Recent sessions: "Album filter" \(1 Oct 2026\)/);
  assert.match(brief, / {2}abc1234 Filter albums \(1 Oct 2026\)/);
  assert.match(brief, /Wait for me before changing anything\.$/);
  // with nothing known, still a usable first message
  assert.match(resumeBrief('X', undefined, { sessions: [], commits: [] }), /^I'm picking up X again\.\n\nLook at the notes/);
});
