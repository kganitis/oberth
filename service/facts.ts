import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { reflogStamp } from './gitinfo.ts';
import { launcherOf } from './launchers.ts';
import type { Project } from './types.ts';

const run = promisify(execFile);

// Dependencies worth naming, in the order they are shown; the rest of package.json stays out of the way.
const STACK: [RegExp, string][] = [
  [/^electron$/, 'Electron'], [/^react$/, 'React'], [/^svelte$/, 'Svelte'], [/^vue$/, 'Vue'], [/^hono$/, 'Hono'],
  [/^fastify$/, 'Fastify'], [/^express$/, 'Express'], [/^zustand$/, 'Zustand'], [/^tailwindcss$/, 'Tailwind'],
  [/^(three|phaser|pixi\.js)$/, '$&'], [/^better-sqlite3$/, 'SQLite'], [/^drizzle-orm$/, 'Drizzle'],
  [/^wrangler$/, 'Cloudflare Workers'], [/^typescript$/, 'TypeScript'], [/^vite$/, 'Vite'], [/^vitest$/, 'Vitest'],
];

const isDirIn = (dir: string, name: string): boolean => { try { return statSync(join(dir, name)).isDirectory(); } catch { return false; } };
/** A matching file in dir or one folder down (a .sln at the top, a .csproj in a project folder). */
function hasFile(dir: string, re: RegExp): boolean {
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && re.test(e.name)) return true;
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        try { if (readdirSync(join(dir, e.name)).some((f) => re.test(f))) return true; } catch { /* unreadable */ }
      }
    }
  } catch { /* unreadable */ }
  return false;
}

/** Named technologies from the project's manifest and starter; no network, no writes. */
export function stackOf(p: Project, deps: string[]): string[] {
  const out: string[] = [];
  for (const [re, label] of STACK) {
    const hit = deps.find((d) => re.test(d));
    if (hit && !out.includes(label)) out.push(label === '$&' ? hit : label);
  }
  if (isDirIn(p.dir, 'Assets') && isDirIn(p.dir, 'ProjectSettings')) out.push('Unity');
  if (hasFile(p.dir, /\.(csproj|sln)$/)) out.push(isDirIn(p.dir, 'Forms') ? '.NET · Windows Forms' : '.NET');
  const named = launcherOf(p)?.stack;
  if (named && named !== 'Python' && !out.includes(named)) out.push(named);
  let py = named === 'Python';
  try { py ||= readdirSync(p.dir).some((f) => f.endsWith('.py')); } catch { /* unreadable */ }
  if (py && !out.includes('Python')) out.push('Python');
  return out;
}

/** Where the project goes when it ships: read from files it already has. */
export function deployOf(p: Project, liveUrl: string | undefined, deps: string[]): string | undefined {
  if (['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].some((f) => existsSync(join(p.dir, f)))) return 'Cloudflare Workers';
  if (liveUrl && (/\.github\.io$/.test(new URL(liveUrl).hostname) || existsSync(join(p.dir, 'CNAME')))) return 'GitHub Pages';
  if (deps.includes('electron-builder')) return 'Desktop builds (electron-builder)';
  return undefined;
}

export interface History { startedAt?: number; commits?: number }
const historyCache = new Map<string, { key: string; value: History }>();

/** First commit and commit count, re-read only when HEAD moves. */
export async function historyOf(dir: string): Promise<History> {
  const key = reflogStamp(dir) ?? `t${Math.floor(Date.now() / 60_000)}`;
  const hit = historyCache.get(dir);
  if (hit?.key === key) return hit.value;
  let value: History = {};
  if (key !== 'none') {
    try {
      const git = (...a: string[]) => run('git', ['--no-optional-locks', '-C', dir, ...a]);
      const count = Number((await git('rev-list', '--count', 'HEAD')).stdout.trim());
      const roots = (await git('log', '--max-parents=0', '--format=%ct', 'HEAD')).stdout.trim().split('\n').map(Number).filter(Boolean);
      value = { commits: count || undefined, startedAt: roots.length ? Math.min(...roots) * 1000 : undefined };
    } catch { /* not a repo, or no commits */ }
  }
  historyCache.set(dir, { key, value });
  return value;
}

export type Visibility = 'public' | 'private' | 'local';
const visCache = new Map<string, { at: number; value: Visibility | undefined }>();
const DAY = 24 * 3600_000;

/**
 * Public or private on GitHub, via the owner's logged-in `gh` (network), at most once a day per repo.
 * 'local' when the project has no GitHub remote; undefined when gh can't tell (offline, not logged in).
 */
export async function visibilityOf(repoUrl: string | undefined): Promise<Visibility | undefined> {
  if (!repoUrl) return 'local';
  if (!repoUrl.startsWith('https://github.com/')) return undefined; // gh only knows GitHub
  const hit = visCache.get(repoUrl);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  let value: Visibility | undefined;
  try {
    const out = (await run('gh', ['repo', 'view', repoUrl, '--json', 'visibility', '-q', '.visibility'], { timeout: 8000 })).stdout.trim().toLowerCase();
    value = out === 'public' ? 'public' : out === 'private' || out === 'internal' ? 'private' : undefined;
  } catch { value = undefined; }
  visCache.set(repoUrl, { at: value ? Date.now() : Date.now() - DAY + 10 * 60_000, value }); // a failure is retried in 10 minutes
  return value;
}

export const mtimeOf = (f: string): number => { try { return statSync(f).mtimeMs; } catch { return 0; } };

const depsCache = new Map<string, { mtime: number; deps: string[] }>();

/** Dependency names (runtime and dev) from the project's package.json, re-read when it changes. */
export function depsOf(dir: string): string[] {
  const f = join(dir, 'package.json');
  const mtime = mtimeOf(f);
  const hit = depsCache.get(dir);
  if (hit && hit.mtime === mtime) return hit.deps;
  let deps: string[] = [];
  try { const pkg = JSON.parse(readFileSync(f, 'utf8')); deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }); } catch { /* no manifest */ }
  depsCache.set(dir, { mtime, deps });
  return deps;
}

const pypiCache = new Map<string, { at: number; value: string | undefined }>();

/** The project's name in pyproject.toml ([project] name), if any. */
export function pyprojectName(dir: string): string | undefined {
  try { return /^\[project\][^[]*?^name\s*=\s*["']([^"']+)["']/ms.exec(readFileSync(join(dir, 'pyproject.toml'), 'utf8'))?.[1]; } catch { return undefined; }
}

/**
 * The latest version on PyPI of the project's Python package, or undefined when it isn't published (or PyPI
 * can't be reached). A hint for the Released mark; asked at most once a day per package, only from the About tab.
 */
export async function pypiVersion(dir: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const name = pyprojectName(dir);
  if (!name) return undefined;
  const hit = pypiCache.get(name);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  let value: string | undefined;
  try {
    const r = await fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, { signal: AbortSignal.timeout(8000) });
    value = r.ok ? String((await r.json())?.info?.version ?? '') || undefined : (await r.body?.cancel(), undefined);
  } catch { value = undefined; }
  pypiCache.set(name, { at: Date.now(), value });
  return value;
}
