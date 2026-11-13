// The weekly review (docs/architecture.md, "Weekly review"): a week of the Logbook read back. Where the time went, projects left
// untouched long enough to pause, Released projects that changed, and how released work did outside. Pure: the
// server gathers the week and the projects.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgendaItem } from './agenda.ts';
import type { ProjectStatus } from './about.ts';
import type { OutsideFacts } from './outside.ts';
import type { Week } from './week.ts';

const DAY = 86_400_000;
/** A project untouched this long, and still called active, is offered a pause. */
export const UNTOUCHED_DAYS = 21;
const TOP = 5;

export interface ReviewProject {
  id: string; name: string; hidden?: boolean; library?: boolean;
  status?: ProjectStatus; released?: boolean;
  /** the last launch, change, commit or Claude turn */
  lastAt: number;
  outside?: OutsideFacts;
}

export interface Review {
  start: string; end: string;
  ms: number; turns: number; commits: number; usd: number;
  /** how many projects had Claude time this week (top holds only the busiest) */
  worked: number;
  /** where the time went: the busiest projects */
  top: { id: string; name: string; ms: number; usd: number; commits: number }[];
  /** still active by their About, but not touched in UNTOUCHED_DAYS: offered a pause */
  untouched: { id: string; name: string; lastAt: number; days: number }[];
  /** Released projects with commits this week: maybe time for a release */
  releasedWork: { id: string; name: string; commits: number }[];
  /** released work seen from outside, as the latest checks found it */
  outside: { id: string; name: string; stars?: number; forks?: number; downloads?: number; waiting?: number; siteDown?: boolean }[];
}

export function buildReview(week: Week, projects: ReviewProject[], now: number): Review {
  const byId = new Map(week.projects.map((p) => [p.id, p]));
  const shown = projects.filter((p) => !p.hidden);
  return {
    start: week.start, end: week.end, ms: week.ms, turns: week.turns, commits: week.commits, usd: week.usd,
    worked: week.projects.filter((p) => p.ms > 0).length,
    top: week.projects.filter((p) => p.ms || p.commits).slice(0, TOP).map((p) => ({ id: p.id, name: p.name, ms: p.ms, usd: p.usd, commits: p.commits })),
    untouched: shown
      // no status counts as active, as the dashboard's filter does; a library with no status was never "being built"
      .filter((p) => (p.status ?? (p.library ? undefined : 'active')) === 'active' && p.lastAt && now - p.lastAt > UNTOUCHED_DAYS * DAY)
      .sort((a, b) => a.lastAt - b.lastAt)
      .map((p) => ({ id: p.id, name: p.name, lastAt: p.lastAt, days: Math.floor((now - p.lastAt) / DAY) })),
    releasedWork: shown.filter((p) => p.released && (byId.get(p.id)?.commits ?? 0) > 0).map((p) => ({ id: p.id, name: p.name, commits: byId.get(p.id)!.commits })),
    outside: shown.filter((p) => p.released && p.outside).map((p) => {
      const o = p.outside!;
      return { id: p.id, name: p.name, stars: o.stars, forks: o.forks, downloads: o.downloads?.week, waiting: o.waiting, siteDown: !!o.site?.downSince };
    }),
  };
}

// ---------- which weeks' reviews the owner has seen, in <state dir>/review.json ----------

const SEEN_KEPT = 12;
const seenFile = (stateDir: string) => join(stateDir, 'review.json');
function loadSeen(stateDir: string): string[] {
  try { const s = JSON.parse(readFileSync(seenFile(stateDir), 'utf8'))?.seen; return Array.isArray(s) ? s.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
/** The Logbook showed the review of the week starting `start` (YYYY-MM-DD): its Agenda pointer goes. The last 12 are kept. */
export function markReviewSeen(stateDir: string, start: string): void {
  const seen = loadSeen(stateDir).filter((s) => s !== start);
  seen.push(start);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(seenFile(stateDir), JSON.stringify({ seen: seen.slice(-SEEN_KEPT) }, null, 2) + '\n');
}
export const reviewSeen = (stateDir: string, start: string): boolean => loadSeen(stateDir).includes(start);

/** A span as people say it: 8 h 20 m, 45 m. */
const span = (ms: number) => { const m = Math.round(ms / 60_000); return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`; };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The Agenda's pointer to last week's review: Worth a look until the Logbook has shown that review (or it is put off for
 * Later). Nothing for a week with nothing recorded. The fingerprint is the week's start, which reviewSeen checks.
 */
export function reviewItem(r: Review): AgendaItem | undefined {
  if (!r.ms && !r.commits) return undefined;
  const people = r.worked;
  const extra = [r.untouched.length && `${plural(r.untouched.length, 'project')} untouched for ${UNTOUCHED_DAYS}+ days`, r.releasedWork.length && `${plural(r.releasedWork.length, 'Released project')} changed`].filter(Boolean);
  return {
    key: `review:${r.start}`, level: 'look', source: 'review', where: 'Logbook', title: 'Last week in review',
    detail: [`${span(r.ms)} with Claude across ${plural(people, 'project')}, ${plural(r.commits, 'commit')}`, ...extra].join(' · '),
    since: Date.parse(`${r.end}T23:59:59`), fingerprint: r.start, action: { kind: 'review', start: r.start },
  };
}
