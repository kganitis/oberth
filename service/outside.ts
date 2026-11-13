// The outside world (docs/architecture.md, "The outside world"): released work seen from outside. Issues and pull
// requests from other people, stars and forks, PyPI downloads, and whether live sites are up. Checks run from a tick in
// main.ts and are kept in <state dir>/outside.json; outsideItems() turns them into Agenda items, purely.
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgendaItem } from './agenda.ts';
import { checkLive, type LiveStatus } from './livecheck.ts';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const EVERY = { github: 30 * MIN, pypi: DAY, live: 10 * MIN, login: DAY };
/** Failed live checks in a row before a site counts as down: one blip of under 10 minutes says nothing. */
export const DOWN_AFTER = 2;

/** A Released project as the checks need it. repo: owner/name of a public GitHub repo. */
export interface OutsideProject { id: string; name: string; repo?: string; pypi?: string; liveUrl?: string }

export interface WaitingIssue { number: number; title: string; url: string; author: string; pr: boolean; comments: number; createdAt: number; updatedAt: number; lastOtherAt: number }
export interface RepoFacts { stars: number; forks: number; openFromOthers: number; waiting: WaitingIssue[]; checkedAt: number }
export interface SiteFacts { last: LiveStatus; fails: number; failingSince?: number }
export interface PypiFacts { lastWeek: number; lastMonth: number; checkedAt: number }
export interface OutsideState {
  repos: Record<string, RepoFacts>;
  /** repo → day (YYYY-MM-DD) → [stars, forks], for the week's growth; 30 days kept */
  counts: Record<string, Record<string, [number, number]>>;
  pypi: Record<string, PypiFacts>;
  sites: Record<string, SiteFacts>;
  login?: { name: string; at: number };
  /** the last time GitHub couldn't be asked, cleared by the next success */
  githubError?: { at: number; message: string };
  /** the projects as of the last check, so facts and items show straight after a restart, before the next check */
  projects?: OutsideProject[];
}

const empty = (): OutsideState => ({ repos: {}, counts: {}, pypi: {}, sites: {} });
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const clock = (ms: number): string => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// ---------- the Agenda items, purely ----------

/** Growth over the last seven days, from the daily counts: the oldest count in the window is the base. */
export function weekGrowth(counts: Record<string, [number, number]> | undefined, now: number): { stars: number; forks: number; total: [number, number] } | undefined {
  if (!counts) return undefined;
  const days = Object.keys(counts).sort();
  const today = counts[days.at(-1)!];
  const from = day(now - 7 * DAY);
  const base = days.find((d) => d >= from && d < days.at(-1)!);
  if (!today || !base) return undefined;
  return { stars: today[0] - counts[base][0], forks: today[1] - counts[base][1], total: today };
}

export function outsideItems(projects: OutsideProject[], s: OutsideState, now: number): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const p of projects) {
    const r = p.repo ? s.repos[p.repo] : undefined;
    for (const i of r?.waiting ?? []) {
      items.push({
        key: `outside:${p.repo}#${i.number}`, level: 'needs', source: 'outside', projectId: p.id, where: p.name, title: i.title,
        detail: `${i.pr ? 'Pull request' : 'Issue'} #${i.number} from ${i.author}${i.comments ? ` · ${plural(i.comments, 'comment')}` : ''}`,
        since: i.lastOtherAt, fingerprint: String(i.updatedAt), action: { kind: 'url', url: i.url },
      });
    }
    const site = p.liveUrl ? s.sites[p.liveUrl] : undefined;
    if (site && site.fails >= DOWN_AFTER && site.failingSince) {
      const why = site.last.status ? `answers ${site.last.status}` : site.last.error ?? 'not answering';
      items.push({
        key: `outside:site:${p.id}`, level: 'needs', source: 'outside', projectId: p.id, where: p.name,
        title: `${new URL(p.liveUrl!).host} is down`, detail: `${why} · since ${clock(site.failingSince)}${now - site.failingSince > DAY ? ` on ${shortDate(site.failingSince)}` : ''}`,
        since: site.failingSince, fingerprint: String(site.failingSince), action: { kind: 'url', url: p.liveUrl! },
      });
    }
    const g = p.repo ? weekGrowth(s.counts[p.repo], now) : undefined;
    if (g && (g.stars > 0 || g.forks > 0)) {
      const what = [g.stars > 0 && plural(g.stars, 'new star'), g.forks > 0 && plural(g.forks, 'new fork')].filter(Boolean).join(' and ');
      items.push({
        key: `outside:growth:${p.id}`, level: 'look', source: 'outside', projectId: p.id, where: p.name,
        title: `${what} this week`, detail: `${plural(g.total[0], 'star')} and ${plural(g.total[1], 'fork')} in all`,
        since: r?.checkedAt ?? now, fingerprint: g.total.join(':'), action: { kind: 'url', url: `https://github.com/${p.repo}` },
      });
    }
  }
  return items;
}

/** Whether a stored URL may be opened by an Agenda button: an issue on GitHub, or one of the projects' own sites. */
export const openable = (url: string, projects: OutsideProject[]): boolean =>
  url.startsWith('https://github.com/') || projects.some((p) => p.liveUrl === url);

// ---------- what a project's About tab shows ----------

/** repo, pypi and liveUrl are where each row links: the repo on GitHub, the package's PyPI page, the site */
export interface OutsideFacts { repo?: string; pypi?: string; liveUrl?: string; stars?: number; forks?: number; openFromOthers?: number; waiting?: number; downloads?: { week: number; month: number }; site?: { ok: boolean; status?: number; error?: string; checkedAt: number; downSince?: number }; checkedAt?: number }

export function factsOf(p: OutsideProject, s: OutsideState): OutsideFacts | undefined {
  const r = p.repo ? s.repos[p.repo] : undefined;
  const py = p.pypi ? s.pypi[p.pypi] : undefined;
  const site = p.liveUrl ? s.sites[p.liveUrl] : undefined;
  if (!r && !py && !site) return undefined;
  return {
    ...(r ? { repo: `https://github.com/${p.repo}`, stars: r.stars, forks: r.forks, openFromOthers: r.openFromOthers, waiting: r.waiting.length, checkedAt: r.checkedAt } : {}),
    ...(py ? { pypi: `https://pypi.org/project/${encodeURIComponent(p.pypi!)}/`, downloads: { week: py.lastWeek, month: py.lastMonth } } : {}),
    ...(site ? { liveUrl: p.liveUrl, site: { ok: site.fails === 0, status: site.last.status, error: site.last.error, checkedAt: site.last.checkedAt, ...(site.fails >= DOWN_AFTER && site.failingSince ? { downSince: site.failingSince } : {}) } } : {}),
  };
}

// ---------- the checks ----------

const run = promisify(execFile);
export type Gh = (path: string) => Promise<any>;
/** `gh api <path>` as JSON, through the owner's logged-in gh. */
export const realGh: Gh = async (path) => JSON.parse((await run('gh', ['api', path], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })).stdout);

/** Open issues and pull requests from others, and which of them wait for the owner. */
export async function readRepo(gh: Gh, repo: string, owner: string, now: number): Promise<RepoFacts> {
  const meta = await gh(`repos/${repo}`);
  const open: any[] = await gh(`repos/${repo}/issues?state=open&per_page=100`);
  const others = open.filter((i) => i?.user?.login && i.user.login.toLowerCase() !== owner.toLowerCase() && i.user.type !== 'Bot');
  const waiting: WaitingIssue[] = [];
  for (const i of others) {
    const created = Date.parse(i.created_at), updated = Date.parse(i.updated_at);
    let lastOtherAt = created;
    let answered = false;
    if (i.comments > 0) {
      // only the latest comments matter: who spoke last
      const comments: any[] = await gh(`repos/${repo}/issues/${i.number}/comments?per_page=100`);
      for (const c of comments) {
        const mine = c?.user?.login?.toLowerCase() === owner.toLowerCase();
        if (c?.user?.type === 'Bot') continue;
        if (mine) answered = true; else { answered = false; lastOtherAt = Date.parse(c.created_at); }
      }
    }
    if (!answered) waiting.push({ number: i.number, title: String(i.title).slice(0, 200), url: String(i.html_url), author: i.user.login, pr: !!i.pull_request, comments: i.comments ?? 0, createdAt: created, updatedAt: updated, lastOtherAt });
  }
  return { stars: meta.stargazers_count ?? 0, forks: meta.forks_count ?? 0, openFromOthers: others.length, waiting, checkedAt: now };
}

export async function readPypi(fetchImpl: typeof fetch, name: string, now: number): Promise<PypiFacts | undefined> {
  const r = await fetchImpl(`https://pypistats.org/api/packages/${encodeURIComponent(name.toLowerCase())}/recent`, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'oberth (local dev console)' } });
  if (!r.ok) { await r.body?.cancel(); return undefined; }
  const d = (await r.json())?.data;
  return d ? { lastWeek: Number(d.last_week) || 0, lastMonth: Number(d.last_month) || 0, checkedAt: now } : undefined;
}

export interface OutsideOptions {
  stateDir: string;
  /** the Released projects, with their public repo, package and live site where they have one */
  projects: () => Promise<OutsideProject[]>;
  gh?: Gh;
  fetchImpl?: typeof fetch;
  live?: (url: string) => Promise<LiveStatus>;
  now?: () => number;
}

export class Outside {
  private o: OutsideOptions;
  private due: Record<string, number> = {}; // what → when it last ran, this run of the service
  private running = false;
  private list: OutsideProject[];

  constructor(o: OutsideOptions) { this.o = o; this.list = this.state().projects ?? []; }

  private file() { return join(this.o.stateDir, 'outside.json'); }
  state(): OutsideState {
    try { return { ...empty(), ...JSON.parse(readFileSync(this.file(), 'utf8')) }; } catch { return empty(); }
  }
  private save(s: OutsideState) { mkdirSync(this.o.stateDir, { recursive: true }); writeFileSync(this.file(), JSON.stringify(s, null, 2) + '\n'); }
  private now() { return (this.o.now ?? Date.now)(); }
  private isDue(key: string, every: number, stored?: number) {
    const last = this.due[key] ?? stored ?? 0;
    return this.now() - last >= every;
  }

  /** The projects as of the last tick (for items and facts between ticks). */
  projects(): OutsideProject[] { return this.list; }
  items(): AgendaItem[] { return outsideItems(this.list, this.state(), this.now()); }
  facts(id: string): OutsideFacts | undefined { const p = this.list.find((x) => x.id === id); return p && factsOf(p, this.state()); }
  /** For the Agenda's health note: GitHub couldn't be asked since the last success. */
  githubError(): string | undefined { return this.state().githubError?.message; }

  /** Runs whatever is due. Never throws; one tick at a time. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.checkAll(); } catch (e) { console.error('outside:', e); } finally { this.running = false; }
  }

  private async checkAll() {
    const gh = this.o.gh ?? realGh;
    const now = this.now();
    this.list = await this.o.projects();
    const s = this.state();
    const repos = [...new Set(this.list.map((p) => p.repo).filter((r): r is string => !!r))];

    // GitHub: who the owner is (daily), then each public repo
    if (repos.length && repos.some((r) => this.isDue(`gh:${r}`, EVERY.github, s.repos[r]?.checkedAt))) {
      try {
        if (!s.login || now - s.login.at > EVERY.login) s.login = { name: String((await gh('user')).login), at: now };
        for (const r of repos) {
          if (!this.isDue(`gh:${r}`, EVERY.github, s.repos[r]?.checkedAt)) continue;
          s.repos[r] = await readRepo(gh, r, s.login.name, now);
          this.due[`gh:${r}`] = now;
          const c = (s.counts[r] ??= {});
          c[day(now)] = [s.repos[r].stars, s.repos[r].forks];
          for (const d of Object.keys(c)) if (d < day(now - 30 * DAY)) delete c[d];
        }
        delete s.githubError;
      } catch (e: any) {
        s.githubError = { at: now, message: /auth|login|401/i.test(String(e?.stderr ?? e?.message)) ? "gh isn't logged in" : "GitHub couldn't be reached" };
        for (const r of repos) this.due[`gh:${r}`] = now - EVERY.github + 10 * MIN; // try again in 10 minutes
      }
    }
    for (const r of Object.keys(s.repos)) if (!repos.includes(r)) { delete s.repos[r]; delete s.counts[r]; }

    // PyPI downloads, daily
    for (const name of new Set(this.list.map((p) => p.pypi).filter((n): n is string => !!n))) {
      if (!this.isDue(`pypi:${name}`, EVERY.pypi, s.pypi[name]?.checkedAt)) continue;
      this.due[`pypi:${name}`] = now;
      try { const f = await readPypi(this.o.fetchImpl ?? fetch, name, now); if (f) s.pypi[name] = f; } catch { /* next day */ }
    }

    // live sites: two failures in a row make it down
    const urls = new Set(this.list.map((p) => p.liveUrl).filter((u): u is string => !!u));
    for (const url of urls) {
      const prev = s.sites[url];
      if (!this.isDue(`live:${url}`, EVERY.live, prev?.last.checkedAt)) continue;
      this.due[`live:${url}`] = now;
      const last = await (this.o.live ?? ((u: string) => checkLive(u, this.o.fetchImpl ?? fetch)))(url);
      const fails = last.ok ? 0 : (prev?.fails ?? 0) + 1;
      s.sites[url] = { last, fails, ...(fails ? { failingSince: prev?.failingSince ?? last.checkedAt } : {}) };
    }
    for (const u of Object.keys(s.sites)) if (!urls.has(u)) delete s.sites[u];
    for (const n of Object.keys(s.pypi)) if (!this.list.some((p) => p.pypi === n)) delete s.pypi[n];
    s.projects = this.list;
    this.save(s);
  }
}
