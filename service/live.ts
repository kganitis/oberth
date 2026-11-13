import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Defaults, Project } from './types.ts';

const run = promisify(execFile);

async function originUrl(dir: string): Promise<string | undefined> {
  try { return (await run('git', ['--no-optional-locks', '-C', dir, 'remote', 'get-url', 'origin'])).stdout.trim() || undefined; } catch { return undefined; }
}

const GITHUB = /github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/;
/** Hosts whose repositories have a web page at https://<host>/<owner>/<repo>. Add your own forge here. */
export const FORGES: Record<string, string> = {
  'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'codeberg.org': 'Codeberg', 'bitbucket.org': 'Bitbucket', 'git.sr.ht': 'SourceHut',
};

/** An origin URL (https, ssh or scp-style) → the repository's web page on a known forge, or undefined. */
export function forgeUrl(origin: string): string | undefined {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](?:\d+\/)?(.+?)(?:\.git)?\/?$/.exec(origin.trim());
  if (!m || !FORGES[m[1].toLowerCase()]) return undefined;
  const path = m[2].replace(/^\/+/, '');
  return path.split('/').length >= 2 ? `https://${m[1].toLowerCase()}/${path}` : undefined;
}

/** The repository's web page when origin is on a known forge (https://github.com/<user>/<repo>, GitLab, Codeberg…). */
export async function repoUrl(dir: string): Promise<string | undefined> {
  return forgeUrl((await originUrl(dir)) ?? '');
}

/** "GitHub" for a github.com URL; the forge's name, or the host, otherwise. */
export const forgeName = (url: string): string => { const h = new URL(url).hostname; return FORGES[h] ?? h; };

/** Live site URL: Oberth defaults, then CNAME, then GitHub Pages for sites. */
export async function liveUrl(p: Project, defaults: Defaults): Promise<string | undefined> {
  if (p.liveUrl) return p.liveUrl;
  const configured = defaults[p.id]?.liveUrl;
  if (configured) return configured;
  try {
    const cname = readFileSync(join(p.dir, 'CNAME'), 'utf8').trim();
    if (cname) return `https://${cname}/`;
  } catch { /* no CNAME */ }
  if (p.kind !== 'site') return undefined;
  const origin = await originUrl(p.dir);
  const m = origin && GITHUB.exec(origin);
  if (!m) return undefined;
  const [, user, repo] = m;
  return repo.toLowerCase() === `${user.toLowerCase()}.github.io` ? `https://${repo.toLowerCase()}/` : `https://${user.toLowerCase()}.github.io/${repo}/`;
}
