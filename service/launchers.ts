// Launchers: how a folder is recognised as a project that has a dev server, and how that server is started.
// Discovery tries LAUNCHERS in order and the first whose detect() answers wins; a folder no launcher claims but that
// is a repository or has a manifest is a library (nothing to launch). To support another stack (Rails, Go, Django,
// Docker Compose…) add a launcher here and a test in tests/launchers.test.ts: CUSTOMIZE.md has the recipe.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pmOf, type Kind, type Mode, type Project, type RunPlan, type RunStep, type Starter } from './types.ts';

/** What every plan starts from: the project folder, the environment, and the install step when one is needed. */
export interface PlanBase {
  mode: Mode;
  lan: boolean;
  /** cwd and env for every step */
  base: Pick<RunPlan, 'cwd' | 'env'>;
  /** `<pm> install` when node_modules is missing or out of date, else none */
  install: RunStep[];
  /** the port Oberth picked for servers that take one, and its local URL */
  port: string;
  localUrl: string;
  /** this Mac's LAN address, for phone mode */
  lanIp: string;
  /** the project's stable address while the proxy is up (Hugo builds its links and live reload from it) */
  address?: string;
}

export interface Launcher {
  /** the starter's type, stored on the project (Project.starter.type) */
  type: string;
  /** what it looks for, for messages: "a package.json with a dev script" */
  looksFor: string;
  /** Whether this folder is this launcher's: its kind and starter, or null. pkg is package.json, parsed, or null. */
  detect(dir: string, pkg: any): { kind: Kind; starter: Starter } | null;
  /** The steps to run in a mode; null when that mode isn't available (most servers have no phone mode). */
  plan(p: Project, b: PlanBase): RunPlan | null;
  /** How the Info tab names the command when it isn't running. */
  describe(p: Project): string;
  /** The program the last step runs, which the pre-flight check looks for on the PATH. */
  program(p: Project): string | undefined;
  /** The command line the port it asks for may be read from (--port 3000, PORT=3000). */
  commandLine?(p: Project): string;
  /** A technology to show in the About tab's stack, beyond what the manifest names. */
  stack?: string;
}

const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isPlainVite = (s: string): boolean => /^vite(\s|$)/.test(s.trim());
const usesConcurrently = (s: string): boolean => /^concurrently(\s|$)/.test(s.trim());
const LAN_NOTE = 'Phone mode serves a fresh build, not live reload';
const HUGO_CONFIGS = ['config.yaml', 'config.toml', 'hugo.yaml', 'hugo.toml'];

/** A package.json with a dev script, run with the project's package manager (npm, pnpm, yarn or bun). */
export const npmDev: Launcher = {
  type: 'npm-dev',
  looksFor: 'a package.json with a dev script',
  detect(_dir, pkg) {
    const devScript = pkg?.scripts?.dev;
    if (typeof devScript !== 'string') return null;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const kind: Kind = 'electron' in deps || 'electron-vite' in deps ? 'window' : 'app';
    return { kind, starter: { type: 'npm-dev', devScript } };
  },
  plan(p, b) {
    const pm = pmOf(p);
    // npm needs -- before arguments meant for the script; pnpm, yarn and bun pass them on as they are
    const passOn = (...args: string[]) => (pm === 'npm' ? ['--', ...args] : args);
    const dev = p.starter.devScript ?? '';
    if (!b.lan) return { ...b.base, steps: [...b.install, { argv: [pm, 'run', 'dev'] }] };
    if (isPlainVite(dev)) return { ...b.base, steps: [...b.install, { argv: [pm, 'run', 'dev', ...passOn('--host')] }] };
    if (usesConcurrently(dev) && p.scripts['start:lan']) {
      return { ...b.base, steps: [...b.install, { argv: [pm, 'run', 'build'], label: 'build' }, { argv: [pm, 'run', 'start:lan'] }], lanNote: LAN_NOTE };
    }
    return null;
  },
  describe: (p) => `${pmOf(p)} run dev`,
  program: (p) => pmOf(p),
  commandLine: (p) => p.starter.devScript ?? '',
};

/** A Hugo site: a Hugo config plus themes/ or layouts/. */
export const hugo: Launcher = {
  type: 'hugo',
  looksFor: 'a Hugo config with themes/ or layouts/',
  stack: 'Hugo',
  detect: (dir) => (HUGO_CONFIGS.some((f) => existsSync(join(dir, f))) && (isDir(join(dir, 'themes')) || isDir(join(dir, 'layouts')))
    ? { kind: 'site', starter: { type: 'hugo' } } : null),
  // locally, links and live reload use the stable address, so they go through the proxy, not this launch's port
  plan: (_p, b) => ({
    ...b.base, localUrl: b.localUrl,
    steps: [{ argv: ['hugo', 'server', '--port', b.port, ...(b.lan ? ['--bind', '0.0.0.0', '--baseURL', `http://${b.lanIp}:${b.port}/`]
      : b.address ? ['--baseURL', b.address, '--appendPort=false', '--liveReloadPort', new URL(b.address).port] : [])] }],
  }),
  describe: () => 'hugo server',
  program: () => 'hugo',
};

/** A serve.py that takes the port as its first argument. */
export const servePy: Launcher = {
  type: 'serve-py',
  looksFor: 'serve.py',
  stack: 'Python',
  detect: (dir) => (existsSync(join(dir, 'serve.py')) ? { kind: 'site', starter: { type: 'serve-py' } } : null),
  plan: (_p, b) => (b.lan ? null : { ...b.base, localUrl: b.localUrl, steps: [{ argv: ['python3', 'serve.py', b.port] }] }),
  describe: () => 'python3 serve.py',
  program: () => 'python3',
};

/** An index.html at the top: served as static files. */
export const staticSite: Launcher = {
  type: 'static',
  looksFor: 'index.html',
  stack: 'Static HTML',
  detect: (dir) => (existsSync(join(dir, 'index.html')) ? { kind: 'site', starter: { type: 'static' } } : null),
  plan: (p, b) => ({ ...b.base, localUrl: b.localUrl, steps: [{ argv: ['python3', '-m', 'http.server', b.port, '--bind', b.lan ? '0.0.0.0' : '127.0.0.1', '--directory', p.dir] }] }),
  describe: () => 'static file server (python3 -m http.server)',
  program: () => 'python3',
};

/** A command from the project's .oberth.json ("command": [...]). Never detected: .oberth.json chooses it. */
export const override: Launcher = {
  type: 'override',
  looksFor: 'a command in .oberth.json',
  detect: () => null,
  plan: (p, b) => (b.lan ? null : { ...b.base, steps: [...b.install, { argv: p.starter.argv ?? [] }] }),
  describe: (p) => (p.starter.argv ?? []).join(' '),
  program: (p) => p.starter.argv?.[0],
  commandLine: (p) => (p.starter.argv ?? []).join(' '),
};

/** Tried in this order: a dev script beats a Hugo config, which beats serve.py, which beats a bare index.html. */
export const LAUNCHERS: Launcher[] = [npmDev, hugo, servePy, staticSite, override];

export const launcherOf = (p: { starter: Starter }): Launcher | undefined => LAUNCHERS.find((l) => l.type === p.starter.type);
