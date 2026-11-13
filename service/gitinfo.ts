import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { GitCommit, GitDetail, GitFile, GitInfo } from './types.ts';

const run = promisify(execFile);

/** `git status --porcelain=v1 --branch` → branch, changed file count, commits ahead. */
export function parseStatus(porcelain: string): GitInfo {
  const lines = porcelain.split('\n').filter(Boolean);
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : '';
  let branch = head.split('...')[0].split(' ')[0];
  const noCommits = /^No commits yet on (\S+)/.exec(head);
  if (noCommits) branch = noCommits[1];
  const ahead = Number(/\[ahead (\d+)/.exec(head)?.[1] ?? 0);
  return { branch, changed: lines.length, ahead };
}

/** True when dir is the root of its own repository (not a folder inside a bigger one). */
async function ownRepo(dir: string): Promise<boolean> {
  try {
    const top = (await run('git', ['--no-optional-locks', '-C', dir, 'rev-parse', '--show-toplevel'])).stdout.trim();
    return realpathSync(top) === realpathSync(dir);
  } catch {
    return false;
  }
}

/** Git info for a project that is its own repository root; null otherwise. No network. */
export async function gitInfo(dir: string): Promise<GitInfo | null> {
  try {
    if (!(await ownRepo(dir))) return null;
    // --no-optional-locks: never refresh/lock the owner's index while they work in the repo
    return parseStatus((await run('git', ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v1', '--branch'])).stdout);
  } catch {
    return null;
  }
}

const MAX_FILES = 200;

/** Changed files from porcelain v1 lines (header excluded). */
export function parseFiles(porcelain: string): GitFile[] {
  return porcelain.split('\n').filter((l) => l && !l.startsWith('## ')).slice(0, MAX_FILES).map((l) => {
    const xy = l.slice(0, 2);
    return { status: xy === '??' ? '?' : xy.trim()[0] ?? '?', path: l.slice(3) };
  });
}

/** `git log --format=%h%x1f%s%x1f%ct` lines; the first `ahead` commits are the unpushed ones. */
export function parseLog(out: string, ahead: number): GitCommit[] {
  return out.split('\n').filter(Boolean).map((l, i) => {
    const [hash, subject, ct] = l.split('\x1f');
    return { hash, subject, time: Number(ct) * 1000, unpushed: i < ahead };
  });
}

/** Branch, upstream, changed files and recent commits, for the drawer's Git tab. No network. */
export async function gitDetail(dir: string): Promise<GitDetail | null> {
  try {
    if (!(await ownRepo(dir))) return null;
    const status = (await run('git', ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v1', '--branch'])).stdout;
    const head = status.split('\n')[0]?.slice(3) ?? '';
    const { branch, ahead } = parseStatus(status);
    const upstream = /^\S+?\.\.\.(\S+)/.exec(head)?.[1];
    const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
    let log = '';
    try { log = (await run('git', ['--no-optional-locks', '-C', dir, 'log', '-n', '10', '--format=%h%x1f%s%x1f%ct'])).stdout; } catch { /* no commits yet */ }
    return { branch, upstream, ahead, behind, files: parseFiles(status), commits: parseLog(log, upstream ? ahead : 0) };
  } catch {
    return null;
  }
}

/** Commits made since a time (ms), newest first; [] outside a repository. */
export async function commitsSince(dir: string, since: number): Promise<GitCommit[]> {
  try {
    if (!(await ownRepo(dir))) return [];
    const out = (await run('git', ['--no-optional-locks', '-C', dir, 'log', `--since=${Math.floor(since / 1000)}`, '-n', '30', '--format=%h%x1f%s%x1f%ct'])).stdout;
    return parseLog(out, 0);
  } catch {
    return [];
  }
}

/** One commit of the Logbook's history. */
export interface BranchCommit { full: string; hash: string; subject: string; time: number }

/** Commits on any local branch since a time (ms), so work on a branch that is later deleted still counts; [] outside a repository. */
export async function branchCommits(dir: string, since: number): Promise<BranchCommit[]> {
  try {
    if (!(await ownRepo(dir))) return [];
    const out = (await run('git', ['--no-optional-locks', '-C', dir, 'log', '--branches', `--since=${Math.floor(since / 1000)}`, '-n', '5000', '--format=%H%x1f%h%x1f%s%x1f%ct'])).stdout;
    return out.split('\n').filter(Boolean).map((l) => {
      const [full, hash, subject, ct] = l.split('\x1f');
      return { full, hash, subject, time: Number(ct) * 1000 };
    });
  } catch {
    return [];
  }
}

/** The repository's git dir, following a worktree's `.git` file; undefined when dir has none of its own. */
function gitDirOf(dir: string): string | undefined {
  const dotGit = join(dir, '.git');
  if (!existsSync(dotGit)) return undefined;
  if (!statSync(dotGit).isFile()) return dotGit;
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
  if (!m) return undefined;
  return isAbsolute(m[1].trim()) ? m[1].trim() : join(dir, m[1].trim());
}

/** Stashes in a repository, from the stash reflog (one line each), with the newest one's time. No git process. */
export function stashes(dir: string): { count: number; at?: number } {
  try {
    const gitDir = gitDirOf(dir);
    if (!gitDir) return { count: 0 };
    const all = readFileSync(join(gitDir, 'logs', 'refs', 'stash'), 'utf8').split('\n').filter(Boolean);
    const at = Number(/ (\d{9,}) [+-]\d{4}\t/.exec(all.at(-1) ?? '')?.[1]) * 1000;
    return { count: all.length, at: at || undefined };
  } catch {
    return { count: 0 }; // no stash reflog: no stashes
  }
}

/** A path from a porcelain v1 line: the new name of a rename, without the quotes git adds around odd names. */
const statusPath = (path: string): string => {
  const p = path.split(' -> ').at(-1)!;
  return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
};

/** What the Agenda asks of a repository. Times are ms. */
export interface GitFacts { ahead: number; unpushedAt?: number; changed: number; changedAt?: number; stashes: number; stashAt?: number }

/** Unpushed and uncommitted work and stashes, with their ages; null when dir isn't its own repository. No network. */
export async function gitFacts(dir: string): Promise<GitFacts | null> {
  try {
    if (!(await ownRepo(dir))) return null;
    const git = async (...args: string[]) => (await run('git', ['--no-optional-locks', '-C', dir, ...args])).stdout;
    // -uall: an untracked folder's own mtime says nothing about the files inside it
    const status = await git('status', '--porcelain=v1', '--branch', '-uall');
    const { ahead, changed } = parseStatus(status);
    const times = changed ? parseFiles(status).flatMap((f) => { try { return [statSync(join(dir, statusPath(f.path))).mtimeMs]; } catch { return []; } }) : [];
    const unpushedAt = ahead ? Number((await git('log', '-1', '--format=%ct')).trim()) * 1000 || undefined : undefined;
    const s = stashes(dir);
    return { ahead, unpushedAt, changed, changedAt: times.length ? Math.max(...times) : undefined, stashes: s.count, stashAt: s.at };
  } catch {
    return null;
  }
}

/**
 * Changes whenever HEAD moves (commit, checkout, reset, pull): the mtimes of HEAD and its reflog plus the
 * reflog's size, which grows on every move even when the mtime doesn't (1-second timestamps on some disks).
 * A worktree's `.git` file is followed to its git dir. 'none' when dir has no `.git` of its own (a plain
 * folder, or one inside a bigger repository): nothing to look up until that changes. undefined when unreadable.
 */
export function reflogStamp(dir: string): string | undefined {
  try {
    if (!existsSync(join(dir, '.git'))) return 'none';
    const gitDir = gitDirOf(dir);
    if (!gitDir) return undefined;
    const head = statSync(join(gitDir, 'HEAD'));
    const log = statSync(join(gitDir, 'logs', 'HEAD'));
    return `${head.mtimeMs}:${log.mtimeMs}:${log.size}`;
  } catch {
    return undefined;
  }
}
