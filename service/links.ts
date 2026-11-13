// Where a project lives outside this Mac: its repository, its live site, its package. The About tab lists every link
// a source finds. To add one (npm, crates.io, a docs site, a status page) add a LinkSource here; CUSTOMIZE.md has the
// recipe. Sources run when the About tab opens, so one that asks the network should cache, as pypiVersion does.
import { forgeName, liveUrl, repoUrl } from './live.ts';
import { pypiVersion, pyprojectName } from './facts.ts';
import type { Defaults, Project } from './types.ts';

export interface Link { id: string; label: string; url: string }
export interface LinkSource {
  id: string;
  find(p: Project, defaults: Defaults): Promise<{ label: string; url: string } | undefined>;
}

export const LINK_SOURCES: LinkSource[] = [
  { id: 'repo', find: async (p) => { const url = await repoUrl(p.dir); return url ? { label: forgeName(url), url } : undefined; } },
  { id: 'live', find: async (p, d) => { const url = await liveUrl(p, d); return url ? { label: 'Live site', url } : undefined; } },
  {
    id: 'pypi',
    find: async (p) => {
      const name = pyprojectName(p.dir);
      return name && (await pypiVersion(p.dir)) ? { label: 'PyPI', url: `https://pypi.org/project/${encodeURIComponent(name)}/` } : undefined;
    },
  },
];

/** Every link the sources find for a project, in their order; a source that fails is skipped. */
export async function linksOf(p: Project, defaults: Defaults, sources: LinkSource[] = LINK_SOURCES): Promise<Link[]> {
  const found = await Promise.all(sources.map(async (s) => { try { const l = await s.find(p, defaults); return l && { id: s.id, ...l }; } catch { return undefined; } }));
  return found.filter((l): l is Link => !!l);
}
