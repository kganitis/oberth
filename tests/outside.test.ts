import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOWN_AFTER, EVERY, factsOf, openable, Outside, outsideItems, readRepo, weekGrowth, type Gh, type OutsideState } from '../service/outside.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-13T12:00:00Z');
const state = (extra: Partial<OutsideState> = {}): OutsideState => ({ repos: {}, counts: {}, pypi: {}, sites: {}, ...extra });
const bam = { id: 'simkit', name: 'Simkit', repo: 'someone/simkit', pypi: 'simkit', liveUrl: 'https://mysite.org/' };

test('readRepo: issues and pull requests from others wait until the owner speaks last; the owner\u2019s own and bots\u2019 are left out', async () => {
  const at = (d: string) => `2026-11-${d}T10:00:00Z`;
  const gh: Gh = async (path) => {
    if (path === 'repos/someone/simkit') return { stargazers_count: 4, forks_count: 3 };
    if (path.startsWith('repos/someone/simkit/issues?')) return [
      { number: 1, title: 'Crash on import', html_url: 'https://github.com/someone/simkit/issues/1', user: { login: 'alice', type: 'User' }, comments: 0, created_at: at('10'), updated_at: at('10') },
      { number: 2, title: 'Docs typo', html_url: 'https://github.com/someone/simkit/pull/2', pull_request: {}, user: { login: 'bob', type: 'User' }, comments: 2, created_at: at('08'), updated_at: at('11') },
      { number: 3, title: 'Answered', html_url: 'u3', user: { login: 'carol', type: 'User' }, comments: 1, created_at: at('05'), updated_at: at('06') },
      { number: 4, title: 'My own todo', html_url: 'u4', user: { login: 'SomeOne', type: 'User' }, comments: 0, created_at: at('01'), updated_at: at('01') },
      { number: 5, title: 'Bump numpy', html_url: 'u5', user: { login: 'dependabot[bot]', type: 'Bot' }, comments: 0, created_at: at('01'), updated_at: at('01') },
    ];
    if (path.includes('/issues/2/comments')) return [{ user: { login: 'someone' }, created_at: at('09') }, { user: { login: 'bob' }, created_at: at('11') }];
    if (path.includes('/issues/3/comments')) return [{ user: { login: 'someone' }, created_at: at('06') }];
    throw new Error(`unexpected ${path}`);
  };
  const r = await readRepo(gh, 'someone/simkit', 'someone', NOW);
  assert.deepEqual({ stars: r.stars, forks: r.forks, others: r.openFromOthers }, { stars: 4, forks: 3, others: 3 });
  assert.deepEqual(r.waiting.map((i) => [i.number, i.author, i.pr, i.lastOtherAt === Date.parse(at(i.number === 2 ? '11' : '10'))]), [[1, 'alice', false, true], [2, 'bob', true, true]]);
});

test('weekGrowth: against the oldest count of the last seven days; nothing until there are two days', () => {
  assert.equal(weekGrowth({ '2026-11-13': [4, 3] }, NOW), undefined);
  assert.deepEqual(weekGrowth({ '2026-11-01': [0, 0], '2026-11-07': [2, 3], '2026-11-10': [3, 3], '2026-11-13': [4, 3] }, NOW), { stars: 2, forks: 0, total: [4, 3] });
});

test('outsideItems: a waiting issue and a site down are Needs you; growth is Worth a look; one failed check says nothing', () => {
  const s = state({
    repos: { 'someone/simkit': { stars: 4, forks: 3, openFromOthers: 1, checkedAt: NOW, waiting: [{ number: 1, title: 'Crash on import', url: 'https://github.com/someone/simkit/issues/1', author: 'alice', pr: false, comments: 2, createdAt: NOW - DAY, updatedAt: NOW - 3600_000, lastOtherAt: NOW - 3600_000 }] } },
    counts: { 'someone/simkit': { '2026-11-08': [2, 3], '2026-11-13': [4, 3] } },
    sites: { 'https://mysite.org/': { last: { ok: false, status: 503, checkedAt: NOW }, fails: DOWN_AFTER, failingSince: NOW - 20 * 60_000 } },
  });
  const items = outsideItems([bam], s, NOW);
  assert.deepEqual(items.map((i) => [i.level, i.title]), [['needs', 'Crash on import'], ['needs', 'mysite.org is down'], ['look', '2 new stars this week']]);
  assert.equal(items[0].detail, 'Issue #1 from alice · 2 comments');
  assert.deepEqual(items[0].action, { kind: 'url', url: 'https://github.com/someone/simkit/issues/1' });
  assert.match(items[1].detail!, /^answers 503 · since \d\d:\d\d$/);
  assert.equal(items[2].detail, '4 stars and 3 forks in all');
  const blip = state({ sites: { 'https://mysite.org/': { last: { ok: false, error: 'timed out', checkedAt: NOW }, fails: 1, failingSince: NOW } } });
  assert.deepEqual(outsideItems([bam], blip, NOW), []);
});

test('openable: GitHub links and the projects\u2019 own sites only', () => {
  assert.equal(openable('https://github.com/someone/simkit/issues/1', [bam]), true);
  assert.equal(openable('https://mysite.org/', [bam]), true);
  assert.equal(openable('https://evil.example/', [bam]), false);
  assert.equal(openable('file:///etc/passwd', [bam]), false);
});

test('Outside: checks what is due, keeps it, marks a site down only after two failures, and says when GitHub fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outside-'));
  let now = NOW;
  let siteUp = true;
  let ghWorks = true;
  let ghCalls = 0;
  const gh: Gh = async (path) => {
    ghCalls++;
    if (!ghWorks) throw Object.assign(new Error('fail'), { stderr: 'error connecting to api.github.com' });
    if (path === 'user') return { login: 'someone' };
    if (path === 'repos/someone/simkit') return { stargazers_count: 2, forks_count: 3 };
    return [];
  };
  const fetchImpl = (async () => new Response(JSON.stringify({ data: { last_week: 9, last_month: 126 } }))) as typeof fetch;
  const o = new Outside({ stateDir: dir, projects: async () => [bam], gh, fetchImpl, now: () => now, live: async () => (siteUp ? { ok: true, status: 200, checkedAt: now } : { ok: false, status: 502, checkedAt: now }) });
  await o.tick();
  assert.deepEqual(o.facts('simkit'), { repo: 'https://github.com/someone/simkit', stars: 2, forks: 3, openFromOthers: 0, waiting: 0, checkedAt: NOW, pypi: 'https://pypi.org/project/simkit/', downloads: { week: 9, month: 126 }, liveUrl: 'https://mysite.org/', site: { ok: true, status: 200, error: undefined, checkedAt: NOW } });
  assert.equal(o.state().counts['someone/simkit']['2026-11-13'][1], 3);

  // nothing is due five minutes later; the site goes down: one failure is nothing, two is an item
  const calls = ghCalls;
  siteUp = false;
  now += 5 * 60_000; await o.tick();
  assert.equal(ghCalls, calls, 'GitHub waits its 30 minutes');
  assert.equal(o.state().sites['https://mysite.org/'].last.checkedAt, NOW, 'the site waits its 10 minutes');
  now += EVERY.live; await o.tick();
  assert.equal(o.items().length, 0);
  now += EVERY.live; await o.tick();
  assert.deepEqual(o.items().map((i) => i.title), ['mysite.org is down']);

  // a fresh Outside (a restart) reads what was kept, and GitHub failing is reported until it works again
  ghWorks = false;
  const again = new Outside({ stateDir: dir, projects: async () => [bam], gh, fetchImpl, now: () => now, live: async () => ({ ok: true, status: 200, checkedAt: now }) });
  assert.equal(again.facts('simkit')?.stars, 2, 'facts show straight after a restart, before any check');
  assert.deepEqual(again.items().map((i) => i.title), ['mysite.org is down'], 'and so does a site that was down');
  now += EVERY.github; await again.tick();
  assert.equal(again.githubError(), "GitHub couldn't be reached");
  assert.deepEqual(again.items(), [], 'the site came back');
  assert.equal(again.facts('simkit')?.stars, 2, 'the last counts are kept');
  ghWorks = true;
  now += EVERY.github; await again.tick();
  assert.equal(again.githubError(), undefined);
});

test('factsOf: nothing for a project with nothing outside', () => {
  assert.equal(factsOf({ id: 'x', name: 'X' }, state()), undefined);
});
