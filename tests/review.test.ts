import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReview, markReviewSeen, reviewItem, reviewSeen, UNTOUCHED_DAYS, type ReviewProject } from '../service/review.ts';
import type { Week } from '../service/week.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-13T12:00:00');
const wp = (id: string, ms: number, commits: number, usd = 0) => ({ id, name: id.toUpperCase(), ms, turns: 1, commits, launches: 0, tokens: 0, usd, days: [0, 0, 0, 0, 0, 0, 0], sessions: [] });
const week = (projects = [wp('a', 3 * 3_600_000, 4, 2.5), wp('b', 600_000, 0), wp('c', 0, 2)]): Week => ({
  start: '2026-11-02', end: '2026-11-08', prev: null, next: '2026-11-09', current: false,
  ms: projects.reduce((n, p) => n + p.ms, 0), turns: 3, commits: projects.reduce((n, p) => n + p.commits, 0), usd: 2.5, tokens: 0, days: [], projects,
});
const proj = (id: string, extra: Partial<ReviewProject> = {}): ReviewProject => ({ id, name: id.toUpperCase(), lastAt: NOW - DAY, ...extra });

test('buildReview: the busiest projects, active ones untouched three weeks, Released ones that changed, and outside numbers', () => {
  const r = buildReview(week(), [
    proj('a', { released: true, outside: { stars: 4, forks: 1, downloads: { week: 9, month: 30 }, waiting: 1, site: { ok: false, checkedAt: NOW, downSince: NOW - 3_600_000 } } }),
    proj('old', { lastAt: NOW - 40 * DAY }),
    proj('older', { lastAt: NOW - 90 * DAY, status: 'active' }),
    proj('paused', { lastAt: NOW - 90 * DAY, status: 'paused' }),
    proj('lib', { lastAt: NOW - 90 * DAY, library: true }),
    proj('hid', { lastAt: NOW - 90 * DAY, hidden: true }),
    proj('fresh', { lastAt: NOW - (UNTOUCHED_DAYS - 1) * DAY }),
    proj('c', { released: true }),
  ], NOW);
  assert.deepEqual(r.top.map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(r.untouched.map((p) => [p.id, p.days]), [['older', 90], ['old', 40]], 'oldest first; not paused, hidden, fresh or a library with no status');
  assert.deepEqual(r.releasedWork, [{ id: 'a', name: 'A', commits: 4 }, { id: 'c', name: 'C', commits: 2 }]);
  assert.deepEqual(r.outside, [{ id: 'a', name: 'A', stars: 4, forks: 1, downloads: 9, waiting: 1, siteDown: true }]);
  assert.equal(r.usd, 2.5);
  assert.equal(r.worked, 2, 'projects with Claude time, not the length of top');
});

test('reviewItem: Worth a look, opening the review; nothing for an empty week', () => {
  const r = buildReview(week(), [proj('old', { lastAt: NOW - 40 * DAY }), proj('a', { released: true })], NOW);
  const it = reviewItem(r)!;
  assert.deepEqual([it.key, it.level, it.title, it.fingerprint, it.action], ['review:2026-11-02', 'look', 'Last week in review', '2026-11-02', { kind: 'review', start: '2026-11-02' }]);
  assert.equal(it.detail, '3 h 10 m with Claude across 2 projects, 6 commits · 1 project untouched for 21+ days · 1 Released project changed');
  assert.equal(reviewItem(buildReview(week([]), [], NOW)), undefined);
});

test('seen reviews: recorded per week, checked by the Agenda pointer’s fingerprint, the last 12 kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-'));
  assert.equal(reviewSeen(dir, '2026-11-02'), false);
  markReviewSeen(dir, '2026-11-02');
  markReviewSeen(dir, '2026-11-02');
  assert.equal(reviewSeen(dir, '2026-11-02'), true);
  const it = reviewItem(buildReview(week(), [], NOW))!;
  assert.equal(reviewSeen(dir, it.fingerprint), true, 'the item for that week counts as seen');
  for (let i = 1; i <= 12; i++) markReviewSeen(dir, `2027-01-${String(i).padStart(2, '0')}`);
  assert.equal(reviewSeen(dir, '2026-11-02'), false, 'the oldest drops out after 12');
  assert.equal(reviewSeen(dir, '2027-01-12'), true);
});
