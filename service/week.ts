import { dayKey, type Activity } from './activity.ts';
import { totalTokens } from './pricing.ts';

export interface WeekSession { title: string; ms: number; turns: number }
export interface WeekProject {
  id: string; name: string; icon?: string;
  ms: number; turns: number; commits: number; launches: number;
  /** Claude's tokens this week, and what they would cost at API prices */
  tokens: number; usd: number;
  /** the project's active time on each day of the week, Monday first */
  days: number[];
  sessions: WeekSession[];
}
export interface WeekDay { date: string; ms: number; turns: number; commits: number; usd: number }
export interface Week {
  start: string; end: string;
  /** the Mondays either side; null where the log has nothing to go to */
  prev: string | null; next: string | null;
  current: boolean;
  ms: number; turns: number; commits: number; usd: number; tokens: number;
  days: WeekDay[];
  projects: WeekProject[];
}

/** A `YYYY-MM-DD` as local midnight; undefined if it isn't a real date. */
export function parseDay(s: string): number | undefined {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d.getTime()) === s ? d.getTime() : undefined;
}

/** Local midnight of the Monday of the week holding `at`. Days are counted, not hours, so a clock change can't shift it. */
export function mondayOf(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7).getTime();
}

export const plusDays = (at: number, n: number): number => { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };

/** Local midnight of last week's Monday, counted in days: the week with the spring clock change is 167 hours, not 168. */
export const lastWeekStart = (now: number): number => plusDays(mondayOf(now), -7);

export interface WeekSource {
  onDay: (at: number) => Activity[];
  /** the earliest day the log holds */
  firstDay: () => string | undefined;
}

/** Where the time went in the week holding `at`: active Claude time, turns, commits and launches per project, busiest first. */
export function buildWeek(log: WeekSource, at: number, describe: (id: string) => { name: string; icon?: string }, now: number): Week {
  const start = mondayOf(at);
  const byProject = new Map<string, WeekProject & { byTitle: Map<string, WeekSession> }>();
  const project = (id: string) => {
    let p = byProject.get(id);
    if (!p) { p = { id, ...describe(id), ms: 0, turns: 0, commits: 0, launches: 0, tokens: 0, usd: 0, days: [0, 0, 0, 0, 0, 0, 0], sessions: [], byTitle: new Map() }; byProject.set(id, p); }
    return p;
  };
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const dayAt = plusDays(start, i);
    const day: WeekDay = { date: dayKey(dayAt), ms: 0, turns: 0, commits: 0, usd: 0 };
    days.push(day);
    for (const e of log.onDay(dayAt)) {
      if (e.kind === 'session') {
        const ms = e.ms ?? 0, p = project(e.id);
        p.ms += ms; p.turns++; p.days[i] += ms;
        day.ms += ms; day.turns++;
        const key = e.sessionId ?? e.text;
        const s = p.byTitle.get(key) ?? { title: e.text, ms: 0, turns: 0 };
        s.ms += ms; s.turns++;
        p.byTitle.set(key, s);
      } else if (e.kind === 'commit') { project(e.id).commits++; day.commits++; }
      else if (e.kind === 'launch') project(e.id).launches++;
      else if (e.kind === 'usage') {
        const p = project(e.id);
        p.usd += e.usd ?? 0; p.tokens += e.tokens ? totalTokens(e.tokens) : 0;
        day.usd += e.usd ?? 0;
      }
    }
  }
  const projects = [...byProject.values()].map(({ byTitle, ...p }) => ({ ...p, sessions: [...byTitle.values()].sort((a, b) => b.ms - a.ms) }));
  projects.sort((a, b) => b.ms - a.ms || b.commits - a.commits || a.name.localeCompare(b.name));

  const first = log.firstDay();
  const firstAt = first ? parseDay(first) : undefined;
  const thisWeek = mondayOf(now);
  return {
    start: dayKey(start), end: dayKey(plusDays(start, 6)),
    prev: firstAt !== undefined && firstAt < start ? dayKey(plusDays(start, -7)) : null,
    next: start < thisWeek ? dayKey(plusDays(start, 7)) : null,
    current: start === thisWeek,
    ms: days.reduce((n, d) => n + d.ms, 0), turns: days.reduce((n, d) => n + d.turns, 0), commits: days.reduce((n, d) => n + d.commits, 0),
    usd: days.reduce((n, d) => n + d.usd, 0), tokens: projects.reduce((n, p) => n + p.tokens, 0),
    days, projects,
  };
}
