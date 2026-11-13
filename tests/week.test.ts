import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityLog, type Activity, dayKey } from '../service/activity.ts';
import { buildWeek, lastWeekStart, mondayOf, parseDay } from '../service/week.ts';

const at = (month: number, day: number, hour = 12): number => new Date(2026, month - 1, day, hour).getTime();
const HOUR = 3_600_000;
const name = (id: string) => ({ name: id.toUpperCase() });
const source = (events: Partial<Activity>[], firstDay?: string) => ({
  onDay: (t: number) => events.filter((e) => dayKey(e.at!) === dayKey(t)) as Activity[],
  firstDay: () => firstDay,
});
const turn = (id: string, when: number, ms: number, sessionId = 's1', text = 'A session'): Partial<Activity> => ({ at: when, id, kind: 'session', text, ms, sessionId });

test('parseDay takes real dates only', () => {
  assert.equal(parseDay('2026-11-02'), new Date(2026, 10, 2).getTime());
  assert.equal(parseDay('2026-02-30'), undefined);
  assert.equal(parseDay('2026-11-2'), undefined);
  assert.equal(parseDay('next week'), undefined);
});

test('mondayOf: weeks start on Monday, Sunday belongs to the week before it', () => {
  assert.equal(dayKey(mondayOf(at(11, 2))), '2026-11-02');
  assert.equal(dayKey(mondayOf(at(11, 5))), '2026-11-02');
  assert.equal(dayKey(mondayOf(at(11, 8, 23))), '2026-11-02');
  assert.equal(dayKey(mondayOf(at(11, 9, 0))), '2026-11-09');
});

test('a week with a clock change still has its seven days', () => {
  const w = buildWeek(source([]), at(10, 21), name, at(11, 5)); // clocks go back on Sunday 25 October
  assert.deepEqual(w.days.map((d) => d.date), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
});

test('time, turns and commits add up per project and per day, busiest project first', () => {
  const w = buildWeek(source([
    turn('small', at(11, 2), HOUR),
    turn('big', at(11, 3), 2 * HOUR),
    turn('big', at(11, 3, 15), HOUR),
    turn('big', at(11, 5), HOUR, 's2', 'Another'),
    { at: at(11, 3), id: 'big', kind: 'commit', text: 'abc fix' },
    { at: at(11, 4), id: 'quiet', kind: 'commit', text: 'def add' },
    { at: at(11, 4), id: 'quiet', kind: 'launch', text: 'launched' },
    { at: at(11, 4), id: 'quiet', kind: 'ready', text: 'ready' },
    turn('outside', at(11, 9), HOUR),
    { at: at(11, 3), id: 'big', kind: 'usage', text: 'claude-opus-5-5', key: 'u:1', usd: 1.5, tokens: { input: 10, output: 20, write5m: 30, write1h: 0, read: 40 } },
    { at: at(11, 3, 15), id: 'big', kind: 'usage', text: 'claude-opus-5-5', key: 'u:2', usd: 0.25, tokens: { input: 0, output: 0, write5m: 0, write1h: 0, read: 100 } },
    { at: at(11, 2), id: 'small', kind: 'usage', text: 'mystery-model', key: 'u:3', tokens: { input: 5, output: 5, write5m: 0, write1h: 0, read: 0 } },
  ]), at(11, 5), name, at(11, 5));

  assert.deepEqual([w.start, w.end, w.ms, w.turns, w.commits], ['2026-11-02', '2026-11-08', 5 * HOUR, 4, 2]);
  assert.deepEqual(w.projects.map((p) => p.id), ['big', 'small', 'quiet']);
  const [big, , quiet] = w.projects;
  assert.deepEqual([big.ms, big.turns, big.commits, big.name], [4 * HOUR, 3, 1, 'BIG']);
  assert.deepEqual(big.days, [0, 3 * HOUR, 0, HOUR, 0, 0, 0]);
  assert.deepEqual(big.sessions, [{ title: 'A session', ms: 3 * HOUR, turns: 2 }, { title: 'Another', ms: HOUR, turns: 1 }]);
  assert.deepEqual([quiet.ms, quiet.commits, quiet.launches], [0, 1, 1]);
  assert.deepEqual(w.days[1], { date: '2026-11-03', ms: 3 * HOUR, turns: 2, commits: 1, usd: 1.75 });
  // usage: cost and tokens per project, a model with no price adds tokens but no dollars, and usage is not a turn
  assert.deepEqual([big.usd, big.tokens, big.turns], [1.75, 200, 3]);
  assert.deepEqual([w.projects[1].usd, w.projects[1].tokens], [0, 10]);
  assert.deepEqual([w.usd, w.tokens], [1.75, 210]);
});

test('sessions without an id are told apart by title', () => {
  const w = buildWeek(source([turn('p', at(11, 2), HOUR, undefined as never, 'One'), { at: at(11, 3), id: 'p', kind: 'session', text: 'Two', ms: HOUR }]), at(11, 2), name, at(11, 2));
  assert.deepEqual(w.projects[0].sessions.map((s) => s.title).sort(), ['One', 'Two']);
});

test('prev stops at the first logged week, next stops at this week', () => {
  const log = source([], '2026-10-28');
  const now = at(11, 5);
  const here = buildWeek(log, now, name, now);
  assert.deepEqual([here.prev, here.next, here.current], ['2026-10-26', null, true]);
  const back = buildWeek(log, at(10, 28), name, now);
  assert.deepEqual([back.prev, back.next, back.current], [null, '2026-11-02', false]);
  assert.equal(buildWeek(source([]), now, name, now).prev, null);
});

test('reads a real log, and firstDay ignores what is not a day file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-'));
  const log = new ActivityLog(dir, () => at(11, 5));
  assert.equal(log.firstDay(), undefined);
  log.addOnce({ at: at(11, 3), id: 'p', kind: 'session', text: 'S', ms: HOUR, key: 'k1' });
  log.addOnce({ at: at(10, 7), id: 'p', kind: 'commit', text: 'a b', key: 'k2' });
  writeFileSync(join(dir, 'activity', '.DS_Store'), 'x');
  assert.equal(log.firstDay(), '2026-10-07');
  assert.equal(buildWeek(log, at(11, 5), name, at(11, 5)).ms, HOUR);
});

test('lastWeekStart: counted in days, so the week after the spring clock change still gets last week', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'Europe/Berlin'; // clocks went forward on 28 March 2027, making that week 167 hours
  try {
    const key = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
    assert.equal(key(lastWeekStart(new Date(2027, 2, 31, 12).getTime())), '2027-3-22');
    assert.equal(key(lastWeekStart(new Date(2027, 10, 3, 12).getTime())), '2027-10-25', 'and after the autumn change');
    assert.equal(key(lastWeekStart(new Date(2026, 10, 9, 0, 0).getTime())), '2026-11-2', 'at Monday midnight itself');
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});
