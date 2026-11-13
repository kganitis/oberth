// The pre-flight check (docs/architecture.md, "Pre-flight"): what would make a launch fail, said before it does.
// preflight() is pure and works on Facts; readFacts() gathers them from the project folder and the machine.
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { findHolder } from './conflicts.ts';
import { launcherOf } from './launchers.ts';
import { pmOf, type Listener, type PackageManager, type Project } from './types.ts';

export type Check = 'deps' | 'pydeps' | 'node' | 'tool' | 'port';
/** short: a few words for the row; text: a sentence with the fix. */
export interface Finding { check: Check; short: string; text: string }

export interface Facts {
  /** packages installed other than package-lock.json says (missing, or at another version), as "name have → want" */
  drift: string[];
  /** dependencies in package.json with no folder in node_modules */
  undeclared: string[];
  /** the Node version Oberth launches with, e.g. 22.20.0 */
  node?: string;
  /** what the project asks for, from the first of .nvmrc, .node-version, engines.node */
  nodeWant?: { source: '.nvmrc' | '.node-version' | 'engines'; value: string };
  /** the program the launch's last step runs, when it can't be found */
  missing?: { program: string; relative: boolean };
  /** a launch from the project's own virtual environment: what its requirements ask for that isn't installed there */
  py?: { venv: string; file: 'requirements.txt' | 'pyproject.toml'; missing: string[] };
  /** the port the project names for itself, and who else listens there */
  port?: { port: number; holder: string };
}

// ---- semver, just enough for engines.node ----

type V = [number, number, number];
const parseV = (s: string): V | undefined => {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : undefined;
};
const cmp = (a: V, b: V): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const pad = (n: number[]): V => [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0];
/** the smallest version above every version starting with n[0..i] */
const bump = (n: number[], i: number): V => pad([...n.slice(0, i), n[i] + 1]);

const COMPARATOR = /^(>=|<=|>|<|=|\^|~)?v?(\*|x|X|\d+)(?:\.(\*|x|X|\d+))?(?:\.(\*|x|X|\d+))?(?:-[\w.]+)?$/;

/** One comparator: true or false, undefined when it can't be read. */
function testComparator(v: V, c: string): boolean | undefined {
  const m = COMPARATOR.exec(c);
  if (!m) return undefined;
  const op = m[1] ?? '=';
  const n: number[] = [];
  for (const part of [m[2], m[3], m[4]]) { if (part === undefined || /[*xX]/.test(part)) break; n.push(Number(part)); }
  if (n.length === 0) return op === '<' || op === '>' ? false : true;
  const lo = pad(n);
  switch (op) {
    case '=': return n.every((x, i) => v[i] === x);
    case '>=': return cmp(v, lo) >= 0;
    case '<': return cmp(v, lo) < 0;
    case '>': return n.length < 3 ? cmp(v, bump(n, n.length - 1)) >= 0 : cmp(v, lo) > 0;
    case '<=': return n.length < 3 ? cmp(v, bump(n, n.length - 1)) < 0 : cmp(v, lo) <= 0;
    case '~': return cmp(v, lo) >= 0 && cmp(v, bump(n, Math.min(n.length - 1, 1))) < 0;
    case '^': {
      const first = n.findIndex((x) => x !== 0);
      return cmp(v, lo) >= 0 && cmp(v, bump(n, first === -1 ? n.length - 1 : first)) < 0;
    }
  }
  return undefined;
}

/** Does version meet range (npm's syntax, the common part)? undefined when the range can't be read. */
export function satisfies(version: string, range: string): boolean | undefined {
  const v = parseV(version);
  if (!v) return undefined;
  let any = false;
  for (const alt of range.split('||')) {
    const a = alt.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    let parts: string[];
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(a);
    if (hyphen) {
      // a partial upper bound (1 - 2.3) means everything starting with it, which <= on a partial already does
      parts = [`>=${hyphen[1]}`, `<=${hyphen[2]}`];
    } else parts = a === '' ? ['*'] : a.split(/\s+/);
    let all = true;
    for (const c of parts) {
      const r = testComparator(v, c);
      if (r === undefined) return undefined;
      if (!r) all = false;
    }
    if (all) any = true;
  }
  return any;
}

/** .nvmrc and .node-version: "22" matches any 22.x.y; aliases such as lts/* can't be judged (undefined). */
export function matchesPrefix(version: string, want: string): boolean | undefined {
  const w = want.trim().replace(/^v/, '');
  if (!/^\d+(\.\d+){0,2}$/.test(w)) return undefined;
  const v = parseV(version);
  return v ? w.split('.').map(Number).every((x, i) => v[i] === x) : undefined;
}

// ---- dependencies ----

/** Lockfile entries for real packages: install path → version, without platform-only optional ones. */
function lockedPackages(lock: any): Map<string, string> | undefined {
  const pk = lock?.packages;
  if (!pk || typeof pk !== 'object') return undefined; // lockfileVersion 1, or not a lockfile
  const out = new Map<string, string>();
  for (const [path, e] of Object.entries<any>(pk)) {
    if (!path.startsWith('node_modules/') || e?.optional || e?.extraneous) continue;
    out.set(path, typeof e?.version === 'string' ? e.version : '');
  }
  return out;
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);

/** What package-lock.json asks for that node_modules/.package-lock.json (npm's record of the install) doesn't have. */
export function lockDrift(lock: any, installed: any): string[] {
  const want = lockedPackages(lock);
  const have = lockedPackages(installed);
  if (!want || !have) return [];
  const out: string[] = [];
  for (const [path, version] of want) {
    const got = have.get(path);
    if (got === undefined) out.push(`${nameOf(path)} missing → ${version || 'linked'}`);
    else if (version && got && got !== version) out.push(`${nameOf(path)} ${got} → ${version}`);
  }
  return out;
}

/** pnpm keeps a copy of the lockfile it installed from in node_modules/.pnpm/lock.yaml: any difference is drift. */
export function pnpmDrift(lock: string | undefined, installed: string | undefined): string[] {
  if (lock === undefined || installed === undefined || lock.trim() === installed.trim()) return [];
  return ['pnpm-lock.yaml changed since the last install'];
}

/** yarn.lock (v1) entries: each pattern ("react@^18.0.0") → its resolved URL. Yarn 2+ lockfiles give undefined. */
export function yarnEntries(lock: string): Map<string, string> | undefined {
  if (/^__metadata:/m.test(lock)) return undefined;
  const out = new Map<string, string>();
  let patterns: string[] = [];
  for (const line of lock.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!line.startsWith(' ') && line.trimEnd().endsWith(':')) {
      patterns = line.trimEnd().slice(0, -1).split(/,\s*/).map((x) => x.replace(/^"|"$/g, ''));
      for (const pt of patterns) out.set(pt, '');
    } else {
      const m = /^\s+resolved\s+"?([^"\s]+)"?/.exec(line);
      if (m) for (const pt of patterns) out.set(pt, m[1]);
    }
  }
  return out;
}

/** Yarn 1 records what it installed in node_modules/.yarn-integrity (lockfileEntries: pattern → resolved). */
export function yarnDrift(lock: string | undefined, integrity: any): string[] {
  const want = lock === undefined ? undefined : yarnEntries(lock);
  const have = integrity?.lockfileEntries;
  if (!want || !have || typeof have !== 'object') return [];
  const names = new Set<string>();
  for (const [pattern, resolved] of want) {
    if (have[pattern] === undefined || (resolved && have[pattern] !== resolved)) names.add(pattern.slice(0, pattern.lastIndexOf('@') > 0 ? pattern.lastIndexOf('@') : undefined));
  }
  return [...names].map((n) => `${n} not as yarn.lock says`);
}

const LOCAL_SPEC = /^(workspace|file|link|portal):/;
/** Dependencies of package.json whose spec names a registry or git package (not a local one). */
export const declaredDeps = (pkg: any): string[] =>
  Object.entries<any>({ ...pkg?.dependencies, ...pkg?.devDependencies }).filter(([, spec]) => !LOCAL_SPEC.test(String(spec))).map(([n]) => n);

// ---- Python ----

/** PEP 503: names compare lower-case, with runs of -, _ and . as one -. */
export const pyName = (n: string): string => n.toLowerCase().replace(/[-_.]+/g, '-');

/** A requirement line → its name and an exact pin (==1.2.3), or undefined for what can't be judged
 *  (options, URLs, editable installs, environment markers, which may rule the line out on this machine). */
export function parseRequirement(line: string): { name: string; pin?: string } | undefined {
  const l = line.replace(/\s+#.*$/, '').trim();
  if (!l || l.startsWith('#') || l.startsWith('-') || l.includes(';') || l.includes('://') || l.includes(' @ ')) return undefined;
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(l);
  if (!m) return undefined;
  const pin = /^==\s*([^\s,*]+)$/.exec(m[2].trim())?.[1];
  return { name: pyName(m[1]), ...(pin ? { pin } : {}) };
}

/** The dependencies listed in pyproject.toml's [project] table (the strings of its dependencies array). */
export function pyprojectDeps(toml: string): string[] {
  const table = /^\[project\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)?.[1] ?? '';
  const arr = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(table)?.[1] ?? '';
  return [...arr.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
}

/** Installed distributions in a venv's site-packages, from the *.dist-info folder names: name → version. */
export function distInfos(names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of names) {
    const m = /^(.+?)-([^-]+)\.dist-info$/.exec(n);
    if (m) out.set(pyName(m[1]), m[2]);
  }
  return out;
}

/** Requirements missing from what is installed, or installed at another version than pinned. */
export function pyDrift(requirements: string[], installed: Map<string, string>): string[] {
  const out: string[] = [];
  for (const line of requirements) {
    const r = parseRequirement(line);
    if (!r) continue;
    const have = installed.get(r.name);
    if (have === undefined) out.push(r.name);
    else if (r.pin && have !== r.pin) out.push(`${r.name} ${have} → ${r.pin}`);
  }
  return out;
}

// ---- the check ----

const list = (xs: string[], n = 3) => xs.slice(0, n).join(', ') + (xs.length > n ? ` and ${xs.length - n} more` : '');

/** What would make this project's launch fail. Nothing for libraries, or while needsInstall covers it. */
export function preflight(p: Project, f: Facts): Finding[] {
  if (p.starter.type === 'none') return [];
  const out: Finding[] = [];
  if (f.missing) {
    const { program, relative } = f.missing;
    out.push(relative
      ? { check: 'tool', short: `${program} missing`, text: `${program} doesn't exist in the project folder, and the launch runs it. Create it first (a virtual environment not set up yet?).` }
      : { check: 'tool', short: `${program} not found`, text: `${program} isn't on the PATH Oberth launches with (nvm's default Node, then /opt/homebrew/bin and the system folders). Install it, for example with Homebrew.` });
  }
  if (f.node && f.nodeWant) {
    const { source, value } = f.nodeWant;
    const ok = source === 'engines' ? satisfies(f.node, value) : matchesPrefix(f.node, value);
    if (ok === false) {
      out.push({ check: 'node', short: `needs Node ${value}`, text: `${source === 'engines' ? 'engines.node in package.json' : source} asks for Node ${value}, and Oberth launches with ${f.node} (nvm's default). Install a matching version with nvm and make it the default (nvm alias default <version>), then restart Oberth.` });
    }
  }
  if (!p.needsInstall && (f.drift.length || f.undeclared.length)) {
    const parts: string[] = [];
    if (f.drift.length) parts.push(`what is installed isn't what the lockfile says (${list(f.drift)})`);
    if (f.undeclared.length) parts.push(`package.json lists ${list(f.undeclared)}, not installed`);
    out.push({ check: 'deps', short: 'deps out of date', text: `${parts.join('; ')}. Launch runs ${pmOf(p)} install first.` });
  }
  if (f.py?.missing.length) {
    const { venv, file, missing } = f.py;
    const how = file === 'requirements.txt' ? `${venv}/bin/pip install -r requirements.txt` : `${venv}/bin/pip install -e .`;
    out.push({ check: 'pydeps', short: 'Python deps missing', text: `${file} asks for ${list(missing)}, not installed in ${venv}. Install them: ${how}` });
  }
  if (f.port) out.push({ check: 'port', short: `port ${f.port.port} taken`, text: `Port ${f.port.port}, which the project asks for, is held by ${f.port.holder}. The server will fail to start, or move to another port.` });
  return out;
}

// ---- reading the facts ----

/** The Node version in a PATH: from nvm's folder name, else by asking node once. */
export function nodeVersionOf(pathEnv: string): string | undefined {
  const m = /\/node\/v(\d+\.\d+\.\d+)\/bin/.exec(pathEnv);
  if (m) return m[1];
  try { return execFileSync('node', ['--version'], { env: { PATH: pathEnv }, encoding: 'utf8', timeout: 5000 }).trim().replace(/^v/, ''); } catch { return undefined; }
}

const readJson = (file: string): any => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; } };
const readText = (file: string): string | undefined => { try { return readFileSync(file, 'utf8').trim().split('\n')[0]?.trim() || undefined; } catch { return undefined; } };
const mtime = (file: string): number => { try { return statSync(file).mtimeMs; } catch { return 0; } };
const executable = (file: string): boolean => { try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; } };

/** The program the launch's last step runs (the one that would be missing). */
export function programOf(p: Project): string | undefined {
  if (p.starter.type === 'none') return undefined;
  if (p.kind === 'window' && p.starter.type !== 'override') return pmOf(p);
  return launcherOf(p)?.program(p);
}

/** The port a project names for itself: --port, -p or PORT= in its command, or the port of url in .oberth.json. */
export function namedPort(p: Project): number | undefined {
  if (p.url) { const n = Number(new URL(p.url).port); if (n) return n; }
  const cmd = launcherOf(p)?.commandLine?.(p) ?? '';
  const m = /(?:--port[=\s]+|(?:^|\s)-p\s+|(?:^|\s)PORT=)(\d{2,5})\b/.exec(cmd);
  return m ? Number(m[1]) : undefined;
}

/** The project's own virtual environment the launch runs from (.venv/bin/python → .venv), if any. */
export function venvOf(p: Project, prog = programOf(p)): string | undefined {
  if (!prog || isAbsolute(prog) || !prog.includes('/')) return undefined;
  const venv = prog.split('/')[0];
  return existsSync(join(p.dir, venv, 'pyvenv.cfg')) ? venv : undefined;
}

const pyCache = new Map<string, { key: string; value: Facts['py'] }>();

function pyFacts(dir: string, venv: string): Facts['py'] {
  const req = join(dir, 'requirements.txt');
  const toml = join(dir, 'pyproject.toml');
  const lib = join(dir, venv, 'lib');
  let sites: string[] = [];
  try { sites = readdirSync(lib).filter((d) => d.startsWith('python')).map((d) => join(lib, d, 'site-packages')); } catch { /* no lib */ }
  const key = [req, toml, ...sites].map(mtime).join(':');
  const hit = pyCache.get(dir + venv);
  if (hit?.key === key) return hit.value;
  const file = existsSync(req) ? 'requirements.txt' as const : existsSync(toml) ? 'pyproject.toml' as const : undefined;
  let value: Facts['py'];
  if (file) {
    const lines = file === 'requirements.txt' ? (readRaw(req) ?? '').split('\n') : pyprojectDeps(readRaw(toml) ?? '');
    const installed = distInfos(sites.flatMap((s) => { try { return readdirSync(s); } catch { return []; } }));
    value = { venv, file, missing: pyDrift(lines, installed) };
  }
  pyCache.set(dir + venv, { key, value });
  return value;
}

export interface FactsEnv {
  pathEnv: string;
  node?: string;
  listeners: Listener[];
  projects: Project[];
  /** pgid → id of the projects Oberth launched */
  managed: Map<number, string>;
}

const depsCache = new Map<string, { key: string; drift: string[]; undeclared: string[] }>();

/** Each package manager's lockfile, and where it records what it installed. Bun keeps no such record. */
const LOCKS: Record<PackageManager, [string, string] | undefined> = {
  npm: ['package-lock.json', 'node_modules/.package-lock.json'],
  pnpm: ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml'],
  yarn: ['yarn.lock', 'node_modules/.yarn-integrity'],
  bun: undefined,
};
const readRaw = (file: string): string | undefined => { try { return readFileSync(file, 'utf8'); } catch { return undefined; } };

function depsFacts(dir: string, pm: PackageManager): { drift: string[]; undeclared: string[] } {
  const locks = (LOCKS[pm] ?? []).map((f) => join(dir, f));
  const files = [join(dir, 'package.json'), join(dir, 'node_modules'), ...locks];
  const key = pm + files.map(mtime).join(':');
  const hit = depsCache.get(dir);
  if (hit?.key === key) return hit;
  const pkg = readJson(files[0]);
  const [lockFile, installedFile] = locks;
  const drift = !lockFile ? []
    : pm === 'npm' ? (() => { const a = readJson(lockFile); const b = readJson(installedFile); return a && b ? lockDrift(a, b) : []; })()
    : pm === 'pnpm' ? pnpmDrift(readRaw(lockFile), readRaw(installedFile))
    : yarnDrift(readRaw(lockFile), readJson(installedFile));
  const undeclared = existsSync(files[1]) ? declaredDeps(pkg).filter((n) => !existsSync(join(dir, 'node_modules', n, 'package.json'))) : [];
  const value = { key, drift, undeclared };
  depsCache.set(dir, value);
  return value;
}

function holderText(p: Project, port: number, env: FactsEnv): string | undefined {
  const c = findHolder(port, env.listeners, env.projects, env.managed);
  if (!c) return undefined;
  const h = c.holder;
  if (h.kind !== 'other' && h.projectId === p.id) return undefined; // its own leftover: shown as one already
  if (h.kind === 'launched') return `${h.name}, launched by Oberth`;
  if (h.kind === 'leftover') return `a server left running in ${h.name} (pid ${h.pid})`;
  return `${h.command ?? 'a process'} (pid ${h.pid})`;
}

/** Everything preflight() needs, read now. Lockfiles are parsed again only when they change. */
export function readFacts(p: Project, env: FactsEnv): Facts {
  const f: Facts = { drift: [], undeclared: [] };
  if (p.starter.type === 'none') return f;
  const hasPkg = existsSync(join(p.dir, 'package.json'));
  if (hasPkg && !p.needsInstall) Object.assign(f, depsFacts(p.dir, pmOf(p)));
  if (hasPkg) {
    f.node = env.node;
    const nvmrc = readText(join(p.dir, '.nvmrc'));
    const nodeVersion = readText(join(p.dir, '.node-version'));
    const engines = readJson(join(p.dir, 'package.json'))?.engines?.node;
    if (nvmrc) f.nodeWant = { source: '.nvmrc', value: nvmrc };
    else if (nodeVersion) f.nodeWant = { source: '.node-version', value: nodeVersion };
    else if (typeof engines === 'string') f.nodeWant = { source: 'engines', value: engines };
  }
  const prog = programOf(p);
  if (prog) {
    if (prog.includes('/')) {
      const full = isAbsolute(prog) ? prog : join(p.dir, prog);
      if (!executable(full)) f.missing = { program: prog, relative: !isAbsolute(prog) };
    } else if (!env.pathEnv.split(':').some((d) => d && executable(join(d, prog)))) f.missing = { program: prog, relative: false };
  }
  const venv = venvOf(p, prog);
  if (venv && !f.missing) f.py = pyFacts(p.dir, venv);
  const port = namedPort(p);
  const holder = port ? holderText(p, port, env) : undefined;
  if (port && holder) f.port = { port, holder };
  return f;
}
