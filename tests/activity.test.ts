import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityLog } from '../service/activity.ts';

const nov = (day: number, hour: number, minute = 0): number => new Date(2026, 10, day, hour, minute).getTime();

test("today shows only today's events, and earlier days stay on disk across restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-'));
  let now = nov(2, 23);
  const a = new ActivityLog(dir, () => now);
  a.add({ id: 'p', kind: 'launch', text: 'launched' });
  now = nov(3, 9);
  a.add({ id: 'p', kind: 'ready', text: 'ready on :5173', ok: true });
  const b = new ActivityLog(dir, () => now);
  assert.deepEqual(b.today().map((e) => e.kind), ['ready']);
  assert.deepEqual(b.onDay(nov(2, 12)).map((e) => e.kind), ['launch']);
});

test('days split at local midnight', () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-'));
  let now = nov(2, 23, 59);
  const a = new ActivityLog(dir, () => now);
  a.add({ id: 'p', kind: 'launch', text: 'before' });
  now = nov(3, 0, 0);
  a.add({ id: 'p', kind: 'launch', text: 'after' });
  assert.deepEqual(a.onDay(nov(2, 0)).map((e) => e.text), ['before']);
  assert.deepEqual(a.onDay(nov(3, 23, 59)).map((e) => e.text), ['after']);
  assert.deepEqual(readdirSync(join(dir, 'activity')).sort(), ['2026-11-02.jsonl', '2026-11-03.jsonl']);
});

test('a day with no file is empty', () => {
  const a = new ActivityLog(mkdtempSync(join(tmpdir(), 'act-')), () => nov(2, 9));
  assert.deepEqual(a.today(), []);
});

test('a damaged line loses that line only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-'));
  const a = new ActivityLog(dir, () => nov(2, 9));
  a.add({ id: 'p', kind: 'launch', text: 'one' });
  appendFileSync(join(dir, 'activity', '2026-11-02.jsonl'), '{"at":17\n');
  a.add({ id: 'p', kind: 'stopped', text: 'two' });
  assert.deepEqual(a.today().map((e) => e.text), ['one', 'two']);
});

test('the old activity.json is imported by day, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-'));
  writeFileSync(join(dir, 'activity.json'), JSON.stringify([
    { at: nov(2, 10), id: 'p', kind: 'launch', text: 'launched' },
    { at: nov(3, 10), id: 'p', kind: 'stopped', text: 'stopped' },
    { id: 'p', kind: 'launch', text: 'no time' },
  ]));
  const a = new ActivityLog(dir, () => nov(3, 12));
  assert.deepEqual(a.onDay(nov(2, 0)).map((e) => e.kind), ['launch']);
  assert.deepEqual(a.today().map((e) => e.kind), ['stopped']);
  assert.equal(existsSync(join(dir, 'activity.json')), false);
  assert.equal(existsSync(join(dir, 'activity.imported.json')), true);
  const again = new ActivityLog(dir, () => nov(3, 12));
  assert.equal(again.today().length, 1);
});

test('an unreadable activity.json is left where it is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-'));
  writeFileSync(join(dir, 'activity.json'), 'not json');
  const a = new ActivityLog(dir, () => nov(3, 12));
  assert.deepEqual(a.today(), []);
  assert.equal(existsSync(join(dir, 'activity.json')), true);
});

test('addOnce records an event once, across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-'));
  const e = { at: nov(2, 10), id: 'p', kind: 'commit' as const, text: 'abc fix', key: 'p:abc' };
  const a = new ActivityLog(dir, () => nov(3, 9));
  assert.equal(a.addOnce(e), true);
  assert.equal(a.addOnce(e), false);
  assert.equal(new ActivityLog(dir, () => nov(3, 9)).addOnce(e), false);
  assert.equal(a.onDay(nov(2, 0)).length, 1);
});

test('workSince counts commits and turns after a moment, from disk and as they arrive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'act-'));
  const a = new ActivityLog(dir, () => nov(5, 9));
  a.addOnce({ at: nov(2, 10), id: 'p', kind: 'commit', text: 'old', key: 'c1' });
  a.addOnce({ at: nov(3, 10), id: 'p', kind: 'session', text: 'S', ms: 3_600_000, key: 't1' });
  a.add({ id: 'p', kind: 'launch', text: 'launched' });
  const b = new ActivityLog(dir, () => nov(5, 9));
  assert.deepEqual(b.workSince('p', nov(3, 0)), { lastAt: nov(3, 11), commits: 0, turns: 1 });
  assert.equal(b.workSince('p', nov(3, 11)), undefined, 'a turn counts from when it ended; a launch is not work');
  assert.equal(b.workSince('other', 0), undefined);
  b.addOnce({ at: nov(4, 10), id: 'p', kind: 'commit', text: 'new', key: 'c2' });
  assert.deepEqual(b.workSince('p', nov(3, 0)), { lastAt: nov(4, 10), commits: 1, turns: 1 });
});
