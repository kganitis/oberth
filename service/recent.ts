import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Project } from './types.ts';

const run = promisify(execFile);
const mtime = (p: string): number => { try { return statSync(p).mtimeMs; } catch { return 0; } };

/** When the project itself last changed: its last commit, or the mtime of its folder or its src/. */
export async function lastChange(p: Project): Promise<number> {
  let commit = 0;
  try { commit = Number((await run('git', ['--no-optional-locks', '-C', p.dir, 'log', '-1', '--format=%ct'])).stdout.trim()) * 1000 || 0; } catch { /* no git */ }
  return Math.max(commit, mtime(p.dir), mtime(join(p.dir, 'src')));
}

/** Most recent of: last launch and the project's last change (the one definition of recency). */
export const recencyOf = (lastLaunched: number | undefined, changed: number): number => Math.max(lastLaunched ?? 0, changed);

export async function recency(p: Project, lastLaunched = 0): Promise<number> {
  return recencyOf(lastLaunched, await lastChange(p));
}
