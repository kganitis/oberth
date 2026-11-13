import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config, excluded, projectId, REPO_DIR, type Root } from './config.ts';
import type { Defaults, Kind, PackageManager, Project, Starter } from './types.ts';
import { HOST_NAME } from './proxy.ts';
import { LAUNCHERS } from './launchers.ts';

const SKIP = new Set(['node_modules', 'dist', 'build', '.git']);

const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };
const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function deriveName(relPath: string): string {
  return relPath.split('/').map((part) =>
    part.includes('.') ? part : part.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
  ).join(' ');
}

type Classified = { kind: Kind; starter: Starter; name?: string; url?: string; liveUrl?: string; host?: string } | { ignore: true } | null;

const LOCAL_PAGE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;
const okUrl = (v: unknown, re: RegExp): string | undefined => (typeof v === 'string' && re.test(v) ? v : undefined);

function classify(dir: string, pkg: any): Classified {
  const override = readJson(join(dir, '.oberth.json'));
  if (override?.ignore) return { ignore: true };
  const base = classifyByFiles(dir, pkg);
  const urls = { url: okUrl(override?.url, LOCAL_PAGE), liveUrl: okUrl(override?.liveUrl, /^https?:\/\/[^\s"'<>]+$/), host: okUrl(override?.host, HOST_NAME) };
  if (override && (override.command || override.kind || override.name)) {
    const starter: Starter | undefined = Array.isArray(override.command) ? { type: 'override', argv: override.command.map(String) } : base?.starter;
    if (!starter) return null;
    // a command of its own makes it launchable: an app, unless the files already say site or window
    const kind = override.kind ?? (Array.isArray(override.command) && (!base || base.kind === 'library') ? 'app' : base?.kind ?? 'app');
    return { kind, starter, name: override.name, ...urls };
  }
  return base && { ...base, ...urls };
}

function classifyByFiles(dir: string, pkg: any): { kind: Kind; starter: Starter } | null {
  for (const l of LAUNCHERS) {
    const hit = l.detect(dir, pkg);
    if (hit) return hit;
  }
  // no dev server: still a project when it is its own repository or has a manifest
  if (existsSync(join(dir, '.git')) || pkg || existsSync(join(dir, 'pyproject.toml'))) return { kind: 'library', starter: { type: 'none' } };
  return null;
}

/** packageManager in package.json (pnpm@9.1.0) wins; else the lockfile says; else npm. */
export function packageManagerOf(dir: string, pkg: any): PackageManager {
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(String(pkg?.packageManager ?? ''))?.[1];
  if (declared) return declared as PackageManager;
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

const visible = (name: string): boolean => !name.startsWith('.') && !SKIP.has(name);

const realOr = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
const warned = new Set<string>();
const warnOnce = (msg: string) => { if (!warned.has(msg)) { warned.add(msg); console.error(`discover: ${msg}`); } };

/**
 * Every project in the roots, two levels deep: a folder that matches a rule is a project and isn't looked into;
 * one that doesn't is a group, whose folders are tried in turn. Left out: hidden folders, the excluded ones, this
 * repository wherever it was cloned, and a folder that is itself another root (it is listed under that root).
 * A bare string is one root, as in tests.
 */
export function discoverProjects(roots: string | Root[], defaults: Defaults, exclude: string[] = config.exclude): Project[] {
  const list: Root[] = typeof roots === 'string' ? [{ path: roots, label: 'dev' }] : roots;
  const otherRoots = new Set(list.map((r) => realOr(r.path)));
  const self = realOr(REPO_DIR);
  const found: Project[] = [];
  for (const root of list) {
    const consider = (relPath: string): boolean => {
      const dir = join(root.path, relPath);
      const pkg = readJson(join(dir, 'package.json'));
      const c = classify(dir, pkg);
      if (c === null) return false;
      if ('ignore' in c) return true;
      const id = projectId(list, root, relPath);
      // two folders with one id (a group folder named like another root's label): the first wins, the other is reported
      if (found.some((p) => p.id === id)) { warnOnce(`${join(root.path, relPath)} has the same id as another project (${id}); give its root another label`); return true; }
      const shown = root === list[0] ? relPath : `${root.label}/${relPath}`;
      found.push({
        id, relPath: shown, dir,
        name: defaults[id]?.name ?? c.name ?? deriveName(relPath),
        kind: c.kind,
        starter: c.starter,
        scripts: pkg?.scripts ?? {},
        // Yarn Plug'n'Play installs without a node_modules
        needsInstall: pkg !== null && !isDir(join(dir, 'node_modules')) && !existsSync(join(dir, '.pnp.cjs')),
        ...(pkg !== null && packageManagerOf(dir, pkg) !== 'npm' ? { packageManager: packageManagerOf(dir, pkg) } : {}),
        ...(c.url ? { url: c.url } : {}),
        ...(c.liveUrl ? { liveUrl: c.liveUrl } : {}),
        ...(c.host ? { host: c.host } : {}),
      });
      return true;
    };
    const skip = (rel: string): boolean => {
      const dir = join(root.path, rel);
      if (excluded(exclude, root, rel, dir)) return true;
      const real = realOr(dir);
      return real === self || otherRoots.has(real);
    };
    let tops: string[];
    try { tops = readdirSync(root.path); } catch { continue; } // a root that doesn't exist (yet) lists nothing
    for (const top of tops) {
      if (!visible(top) || !isDir(join(root.path, top)) || skip(top)) continue;
      if (consider(top)) continue;
      for (const child of readdirSync(join(root.path, top))) {
        if (visible(child) && isDir(join(root.path, top, child)) && !skip(`${top}/${child}`)) consider(`${top}/${child}`);
      }
    }
  }
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
