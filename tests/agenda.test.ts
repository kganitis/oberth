import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addAsk, Agenda, buildAgenda, cleanAsk, closeAsk, loadAgendaState, notesItem, openAsks, putOffLater, THRESHOLDS, type AgendaInputs, type AgendaState } from '../service/agenda.ts';
import type { ClaudeSession } from '../service/claudesessions.ts';
import type { GitFacts } from '../service/gitinfo.ts';

const NOW = Date.parse('2026-11-05T12:00:00');
const HOUR = 3_600_000, DAY = 24 * HOUR;
const state = (): AgendaState => ({ asks: [], later: {} });
const session = (over: Partial<ClaudeSession> = {}): ClaudeSession => ({
  id: 'local_1', title: 'A session', folder: '/dev/app', lastActivityAt: NOW - HOUR, latestUserFrameAt: NOW - 2 * HOUR, lastTurnEdgeAt: NOW - HOUR, lastAssistantUuid: 'u1', ...over,
});
const blocked = { status: 'blocked', needsAction: 'Answer me', detail: 'stuck', forUuid: 'u1' };
const inputs = (over: Partial<AgendaInputs> = {}): AgendaInputs => ({
  notes: new Map(), roots: ['/dev'], projects: [{ id: 'app', name: 'App', dir: '/dev/app' }, { id: 'g__one', name: 'One', dir: '/dev/group/one' }, { id: 'quiet', name: 'Quiet', dir: '/dev/quiet', hidden: true }],
  sessions: [], live: new Set(), pending: new Map(), git: new Map(), backup: null, ...over,
});
const build = (over: Partial<AgendaInputs> = {}, s = state(), now = NOW) => buildAgenda(inputs(over), s, now);
const facts = (over: Partial<GitFacts> = {}): GitFacts => ({ ahead: 0, changed: 0, stashes: 0, ...over });

test('a blocked summary of the last turn is a Needs you item', () => {
  const a = build({ sessions: [session({ summary: blocked })] });
  assert.equal(a.count, 1);
  assert.deepEqual([a.needs[0].key, a.needs[0].title, a.needs[0].detail, a.needs[0].where], ['session:local_1', 'Answer me', 'stuck', 'App']);
});

test('need_input counts as blocked, and blocked needs no action text', () => {
  const a = build({ sessions: [session({ summary: { status: 'need_input', forUuid: 'u1' } })] });
  assert.equal(a.needs[0].title, 'Claude is waiting for you');
});

test('completed makes no item; failed is only worth a look', () => {
  assert.equal(build({ sessions: [session({ summary: { status: 'completed', forUuid: 'u1' } })] }).count, 0);
  const a = build({ sessions: [session({ summary: { status: 'failed', forUuid: 'u1' } })] });
  assert.equal(a.count, 0);
  assert.equal(a.look[0].title, 'The last turn failed');
});

test('a summary of an older turn, or with its fields gone, makes no item', () => {
  assert.equal(build({ sessions: [session({ summary: { ...blocked, forUuid: 'older' } })] }).count, 0);
  assert.equal(build({ sessions: [session({ summary: { status: 'blocked' } })] }).count, 0);
  assert.equal(build({ sessions: [session({ summary: undefined, lastAssistantUuid: undefined })] }).count, 0);
});

test('a new message clears the item while the turn runs, even with the process closed', () => {
  assert.equal(build({ sessions: [session({ summary: blocked, latestUserFrameAt: NOW })] }).count, 0);
});

test('a blocked session counts whether its process is alive or not', () => {
  assert.equal(build({ sessions: [session({ summary: blocked })], live: new Set() }).count, 1);
});

test('an unanswered question in a live session is a Needs you item at once, with the question as its title', () => {
  const t = { id: 't1', name: 'AskUserQuestion', at: NOW - 1000, question: 'Which one?' };
  const a = build({ sessions: [session()], live: new Set(['local_1']), pending: new Map([['local_1', t]]) });
  assert.equal(a.needs[0].title, 'Which one?');
  assert.equal(a.needs[0].fingerprint, 'tool:t1');
});

test('an unanswered question in a closed session makes no item', () => {
  const t = { id: 't1', name: 'AskUserQuestion', at: NOW - 1000 };
  assert.equal(build({ sessions: [session()], pending: new Map([['local_1', t]]) }).count, 0);
});

test('a plan waiting for approval is a Needs you item', () => {
  const t = { id: 't1', name: 'ExitPlanMode', at: NOW - 1000 };
  const a = build({ sessions: [session()], live: new Set(['local_1']), pending: new Map([['local_1', t]]) });
  assert.equal(a.needs[0].title, 'A plan is waiting for your approval');
});

test('a tool call silent for over 15 minutes is worth a look; a subagent is not', () => {
  const old = NOW - THRESHOLDS.quiet - 1000;
  const live = new Set(['local_1']);
  const a = build({ sessions: [session()], live, pending: new Map([['local_1', { id: 't', name: 'Bash', at: old }]]) });
  assert.equal(a.count, 0);
  assert.match(a.look[0].title, /^Quiet for 15 minutes/);
  assert.equal(build({ sessions: [session()], live, pending: new Map([['local_1', { id: 't', name: 'Bash', at: NOW - 1000 }]]) }).look.length, 0);
  assert.equal(build({ sessions: [session()], live, pending: new Map([['local_1', { id: 't', name: 'Agent', at: old }]]) }).look.length, 0);
});

test('a turn cut short by quitting the app is a Needs you item', () => {
  assert.equal(build({ sessions: [session({ interruptedAwaitingPerson: true })] }).count, 1);
});

test('sessions: a group folder or ~/Dev itself shows under its title; other folders and hidden projects make nothing', () => {
  const at = (folder: string, id = 'local_1') => session({ id, folder, summary: blocked });
  assert.equal(build({ sessions: [at('/dev')] }).needs[0].where, 'A session');
  assert.equal(build({ sessions: [at('/dev/group')] }).needs[0].projectId, undefined);
  assert.equal(build({ sessions: [at('/dev/left-out')] }).count, 0);
  assert.equal(build({ sessions: [at('/tmp/scratch')] }).count, 0);
  assert.equal(build({ sessions: [at('/dev/quiet')] }).count, 0);
});

test('two sessions in a project each get their own item and action', () => {
  const a = build({ sessions: [session({ id: 'local_1', summary: blocked }), session({ id: 'local_2', summary: blocked })] });
  assert.deepEqual(a.needs.map((i) => i.action).sort((x: any, y: any) => x.sessionId.localeCompare(y.sessionId)), [{ kind: 'session', sessionId: 'local_1' }, { kind: 'session', sessionId: 'local_2' }]);
});

test('git: unpushed over a day, uncommitted over 7 days, any stash; all only worth a look', () => {
  const git = new Map([['app', facts({ ahead: 38, unpushedAt: NOW - 2 * DAY, changed: 5, changedAt: NOW - 8 * DAY, stashes: 1, stashAt: NOW - 90 * DAY })]]);
  const a = build({ git });
  assert.equal(a.count, 0);
  assert.deepEqual(a.look.map((i) => i.title), ['38 commits not pushed', '5 files not committed', '1 stash left behind']);
  assert.equal(a.look[0].key, 'git:app:unpushed');
  assert.deepEqual(a.look[0].action, { kind: 'tab', tab: 'git' });
});

test('git: work in progress makes no item', () => {
  const git = new Map([['app', facts({ ahead: 2, unpushedAt: NOW - HOUR, changed: 3, changedAt: NOW - DAY })]]);
  assert.equal(build({ git }).look.length, 0);
});

test('git: hidden projects are skipped, and singular text reads right', () => {
  assert.equal(build({ git: new Map([['quiet', facts({ stashes: 2 })]]) }).look.length, 0);
  const a = build({ git: new Map([['app', facts({ ahead: 1, unpushedAt: NOW - 2 * DAY, changed: 1, changedAt: NOW - 8 * DAY, stashes: 2, stashAt: NOW - DAY })]]) });
  assert.deepEqual(a.look.map((i) => i.title).sort(), ['1 commit not pushed', '1 file not committed', '2 stashes left behind']);
});

const step = (over = {}) => ({ exit: 0, failed: 0, at: NOW - HOUR, lastCleanAt: NOW - HOUR, ...over });
const daily = { snapshots: step(), restore: step() };

test('snapshots and the restore check: a failure, a day missed or no line at all is an item, with counts and no repo names', () => {
  const backup = (over = {}) => ({ exit: 0, line: 'x', at: NOW - HOUR, lastCleanAt: NOW - HOUR, ...daily, ...over });
  assert.equal(build({ backup: backup() }).count, 0);
  assert.equal(build({ backup: backup({ snapshots: step({ at: NOW - 47 * HOUR, lastCleanAt: NOW - 47 * HOUR }) }) }).count, 0);

  const failed = build({ backup: backup({ snapshots: step({ exit: 1, failed: 2, lastCleanAt: NOW - 2 * DAY }) }) }).needs[0];
  assert.deepEqual([failed.key, failed.title, failed.detail, failed.projectId, failed.action], ['backup:snapshots', 'Snapshots failed for 2 repos', 'The log names them.', undefined, { kind: 'backup-log' }]);
  assert.equal(build({ backup: backup({ restore: step({ exit: 1, failed: 1 }) }) }).needs[0].title, 'Restore check failed for 1 repo');

  const late = build({ backup: backup({ restore: step({ at: NOW - 3 * DAY, lastCleanAt: NOW - 3 * DAY }) }) }).needs[0];
  assert.deepEqual([late.key, late.title], ['backup:restore', "Restore check hasn't finished cleanly since 2 Nov"]);

  const none = build({ backup: backup({ snapshots: undefined, restore: undefined }) });
  assert.deepEqual(none.needs.map((i) => i.title), ['The backup log shows no snapshots', 'The backup log shows no restore check']);
});

test('a failing step keeps its fingerprint from one hourly retry to the next, so Later holds until something changes', () => {
  const fp = (at: number, failed: number) => build({ backup: { exit: 0, line: 'x', at: NOW, lastCleanAt: NOW, restore: step(), snapshots: step({ exit: 1, failed, at, lastCleanAt: NOW - 2 * DAY }) } }).needs[0].fingerprint;
  assert.equal(fp(NOW, 1), fp(NOW - HOUR, 1));
  assert.notEqual(fp(NOW, 1), fp(NOW, 2));
});

test('backup: a failed last run or no clean run for 24 hours is an item; a recent clean run is not', () => {
  const line = '2026-11-05 11:00:00 rsync exit 0';
  assert.equal(build({ backup: { exit: 0, line, at: NOW - HOUR, lastCleanAt: NOW - HOUR, ...daily } }).count, 0);
  const failed = build({ backup: { exit: 1, line: 'x', at: NOW - HOUR, lastCleanAt: NOW - 2 * DAY, error: 'mmap', ...daily } });
  assert.deepEqual([failed.count, failed.needs[0].title, failed.needs[0].detail, failed.needs[0].projectId], [1, "Backup hasn't finished cleanly since 3 Nov", 'mmap', undefined]);
  assert.equal(build({ backup: { exit: 0, line, at: NOW - 25 * HOUR, lastCleanAt: NOW - 25 * HOUR, ...daily } }).count, 1);
  assert.equal(build({ backup: { exit: 1, line: 'x', at: NOW } }).needs[0].title, 'The backup log shows no clean run');
});

test('later hides an item until its fingerprint changes or 7 days pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-'));
  const git = (ahead: number) => new Map([['app', facts({ ahead, unpushedAt: NOW - 2 * DAY })]]);
  const item = build({ git: git(38) }).look[0];
  putOffLater(dir, item, NOW);
  const s = loadAgendaState(dir);
  assert.equal(build({ git: git(38) }, s).look.length, 0);
  assert.equal(build({ git: git(39) }, s).look.length, 1);
  assert.equal(build({ git: git(38) }, s, NOW + THRESHOLDS.later + 1).look.length, 1);
});

test('asks: Needs you, then worth a look after 14 days; an unknown session falls back to the project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-'));
  const ask = addAsk(dir, 'app', { text: 'Review it', sessionId: 'local_gone' }, NOW);
  const s = loadAgendaState(dir);
  const a = build({}, s);
  assert.equal(a.needs[0].key, `ask:${ask.id}`);
  assert.deepEqual(a.needs[0].action, { kind: 'assistant' });
  assert.deepEqual(build({ sessions: [session({ id: 'local_gone' })] }, s).needs[0].action, { kind: 'session', sessionId: 'local_gone' });
  const later = build({}, s, NOW + THRESHOLDS.askOpen + 1);
  assert.deepEqual([later.count, later.look.length], [0, 1]);
});

test('asks: the same text updates the open ask, a hidden project shows none, done ones go after 30 days', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-'));
  const first = addAsk(dir, 'app', { text: 'Same', detail: 'one' }, NOW);
  const again = addAsk(dir, 'app', { text: 'Same', detail: 'two' }, NOW + 1000);
  assert.equal(again.id, first.id);
  assert.deepEqual(openAsks(dir, 'app').map((a) => a.detail), ['two']);
  addAsk(dir, 'quiet', { text: 'Hidden' }, NOW);
  assert.equal(build({}, loadAgendaState(dir)).count, 1);
  assert.equal(closeAsk(dir, first.id, NOW), true);
  assert.equal(closeAsk(dir, first.id, NOW), false);
  assert.equal(loadAgendaState(dir).asks.length, 2);
  addAsk(dir, 'app', { text: 'New' }, NOW + THRESHOLDS.doneKept + 1);
  assert.equal(loadAgendaState(dir).asks.some((a) => a.id === first.id), false);
});

test('cleanAsk checks limits and drops a session id it does not recognise', () => {
  assert.throws(() => cleanAsk({}), /required/);
  assert.throws(() => cleanAsk({ text: 'x', detail: 'y'.repeat(1001) }), /longer/);
  assert.throws(() => cleanAsk({ text: 'x', detail: 3 }), /text/);
  assert.equal(cleanAsk({ text: ' x ', sessionId: '../../etc' }).sessionId, undefined);
  assert.equal(cleanAsk({ text: 'x', sessionId: 'local_ab-12' }).sessionId, 'local_ab-12');
  assert.equal(cleanAsk({ text: ' x ' }).text, 'x');
});

test('loadAgendaState survives a missing or broken file', () => {
  assert.deepEqual(loadAgendaState(join(tmpdir(), 'no-such-dir-agenda')), { asks: [], later: {} });
});

const sources = (o: { files: number; parsed: number; summaries: number; backup?: any }) => ({
  sessions: () => ({ sessions: [], files: o.files, parsed: o.parsed, summaries: o.summaries }), liveSessions: async () => new Set<string>(), pending: () => undefined, git: async () => null, backup: () => o.backup ?? null, notes: () => new Map(),
});

test('health says when session files exist but cannot be read, and when the backup log is unavailable', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'agenda-'));
  const view = (o: Parameters<typeof sources>[0]) => new Agenda({ stateDir, roots: ['/dev'], sources: sources(o) }).view([]);
  assert.equal((await view({ files: 0, parsed: 0, summaries: 0 })).health.sessions!.ok, true);
  assert.equal((await view({ files: 9, parsed: 0, summaries: 0 })).health.sessions!.ok, false);
  assert.equal((await view({ files: 9, parsed: 9, summaries: 0 })).health.sessions!.ok, false);
  assert.equal((await view({ files: 3, parsed: 3, summaries: 0 })).health.sessions!.ok, true);
  assert.equal((await view({ files: 9, parsed: 9, summaries: 2 })).health.sessions!.ok, true);
  assert.equal((await view({ files: 0, parsed: 0, summaries: 0 })).health.backup!.ok, false);
});

test('sessions are read at most every 5 seconds and git every 30', async () => {
  let now = NOW, s = 0, g = 0;
  const a = new Agenda({ stateDir: mkdtempSync(join(tmpdir(), 'agenda-')), roots: ['/dev'], now: () => now, sources: {
    sessions: () => { s++; return { sessions: [], files: 0, parsed: 0, summaries: 0 }; }, liveSessions: async () => new Set(), pending: () => undefined, git: async () => { g++; return null; }, backup: () => null, notes: () => new Map(),
  } });
  const projects = [{ id: 'app', name: 'App', dir: '/dev/app' }];
  await a.view(projects); await a.view(projects);
  now += 6000; await a.view(projects);
  assert.deepEqual([s, g], [2, 1]);
  now += 30_000; await a.view(projects);
  assert.deepEqual([s, g], [3, 2]);
});

test('notes: flagged once work clearly follows them and has settled', () => {
  const day = 86_400_000, hour = 3_600_000, now = 100 * day;
  const p = { id: 'app', name: 'App', dir: '/dev/app' };
  const facts = (savedAgo: number, workedAgo?: number) => ({ updatedAt: now - savedAgo, work: workedAgo === undefined ? undefined : { lastAt: now - workedAgo, commits: 3, turns: 1 } });
  assert.equal(notesItem(p, facts(5 * day), now), undefined, 'no work since');
  assert.equal(notesItem(p, facts(3 * day, 3 * day - hour / 2), now), undefined, 'the commit right after saving');
  assert.equal(notesItem(p, facts(3 * day, hour), now), undefined, 'still being worked on');
  const it = notesItem(p, facts(5 * day, 2 * day), now)!;
  assert.deepEqual([it.key, it.level, it.source, it.projectId, it.action], ['notes:app', 'look', 'notes', 'app', { kind: 'tab', tab: 'about' }]);
  assert.equal(it.since, now - 2 * day);
  assert.match(it.detail!, /then 3 commits and 1 Claude turn, the latest on/);
  assert.ok(notesItem(p, facts(8 * day, hour), now), 'worked on daily, but the notes are over a week old');
});

test('notes: the detail names only what happened, Later survives new work, a hidden project makes no item', () => {
  const day = 86_400_000, now = 100 * day, updatedAt = now - 5 * day;
  const it = notesItem({ id: 'app', name: 'App', dir: '/dev/app' }, { updatedAt, work: { lastAt: now - 2 * day, commits: 0, turns: 2 } }, now)!;
  assert.match(it.detail!, /then 2 Claude turns, the/);
  const notes = (lastAt: number) => new Map([['app', { updatedAt, work: { lastAt, commits: 1, turns: 0 } }], ['quiet', { updatedAt, work: { lastAt, commits: 1, turns: 0 } }]]);
  const keys = (l: { look: { key: string }[] }) => l.look.map((x) => x.key);
  const none = { asks: [], later: {} };
  const shown = buildAgenda(inputs({ notes: notes(now - 2 * day) }), none, now);
  assert.deepEqual(keys(shown), ['notes:app']);
  const held = { asks: [], later: { 'notes:app': { until: now + day, fingerprint: String(updatedAt) } } };
  assert.deepEqual(keys(buildAgenda(inputs({ notes: notes(now - 1.5 * day) }), held, now)), []);
});

test('outside-world items join the list, except for hidden projects', () => {
  const item = (projectId: string) => ({ key: `outside:site:${projectId}`, level: 'needs' as const, source: 'outside' as const, projectId, where: projectId, title: 'site is down', since: NOW, fingerprint: '1', action: { kind: 'url' as const, url: 'https://example.org/' } });
  const a = build({ outside: [item('app'), item('quiet')] });
  assert.deepEqual(a.needs.map((i) => i.key), ['outside:site:app']);
});
