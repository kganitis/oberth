// Oberth's configuration: one JSON file in the state dir, read once at start. Everything a person must answer for
// Oberth to work on their Mac lives here; everything else is code, made easy to change (see CUSTOMIZE.md).
// A missing file means the defaults below, so a fresh clone starts as is.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Defaults } from './types.ts';

/** A folder Oberth looks in for projects, two levels deep. The label names it in the dashboard and, for every root but the first, prefixes its project ids. */
export interface Root { path: string; label: string }

export const MODULES = ['agenda', 'logbook', 'recall', 'ideas', 'outside', 'proxy', 'backup'] as const;
export type ModuleName = (typeof MODULES)[number];
export const ASSISTANTS = ['claude', 'none'] as const;
export type AssistantId = (typeof ASSISTANTS)[number];

export interface OberthConfig {
  roots: Root[];
  /** folder names (at a root's top level) or paths left out of Oberth */
  exclude: string[];
  /** per project id: display name, live URL, openPort */
  projects: Defaults;
  port: number;
  proxyPort: number;
  /** the app pages open in ("Safari", "Google Chrome", "Arc", …), or "default" for the system's default browser */
  browser: string;
  /** an editor id from service/editors.ts */
  editor: string;
  assistant: AssistantId;
  modules: Record<ModuleName, boolean>;
  /** the backup module's log (written by a backup script of your own) */
  backup: { log: string };
  /** whether work on Oberth itself counts: its sessions and commits in the Logbook and Recall, and ideas for it */
  self: boolean;
  /** where state, the token and config.json live, and where logs go; not read from the file */
  stateDir: string;
  logDir: string;
  /** where config.json was looked for, and the problems found in it (each one fell back to the default) */
  file: string;
  problems: string[];
}

const home = homedir();
/** This repository: Oberth never lists itself, wherever it was cloned. */
export const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const expand = (p: string, h = home): string => (p === '~' ? h : p.startsWith('~/') ? join(h, p.slice(2)) : p);
const tilde = (p: string, h = home): string => (p === h ? '~' : p.startsWith(h + '/') ? `~${p.slice(h.length)}` : p);
const LABEL = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** The defaults for everything; modules all on except backup, which needs a backup script of your own. */
export function defaultConfig(stateDir: string, logDir: string, h = home): Omit<OberthConfig, 'file' | 'problems'> {
  return {
    roots: [{ path: join(h, 'Dev'), label: 'dev' }],
    exclude: [],
    projects: {},
    port: 7777,
    proxyPort: 7700,
    browser: 'Safari',
    editor: 'vscode',
    assistant: 'claude',
    modules: { agenda: true, logbook: true, recall: true, ideas: true, outside: true, proxy: true, backup: false },
    backup: { log: join(h, 'Library/Logs/backup.log') },
    self: true,
    stateDir, logDir,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const port = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1024 && (v as number) <= 65535;

/**
 * config.json's contents, checked field by field: a field that is wrong is reported and left at its default, so a
 * typo never stops Oberth from starting. Pure, for tests: `h` stands for the home folder.
 */
export function parseConfig(raw: unknown, stateDir: string, logDir: string, h = home): Omit<OberthConfig, 'file'> {
  const c = defaultConfig(stateDir, logDir, h);
  const problems: string[] = [];
  if (raw === undefined) return { ...c, problems };
  if (!isObj(raw)) return { ...c, problems: ['config.json is not a JSON object; using the defaults'] };
  const known = new Set(['$schema', 'roots', 'exclude', 'projects', 'port', 'proxyPort', 'browser', 'editor', 'assistant', 'modules', 'backup', 'self']);
  for (const k of Object.keys(raw)) if (!known.has(k)) problems.push(`unknown field "${k}" (ignored)`);

  if (raw.roots !== undefined) {
    const list = Array.isArray(raw.roots) ? raw.roots : [];
    const roots: Root[] = [];
    for (const r of list) {
      const path = typeof r === 'string' ? r : isObj(r) && typeof r.path === 'string' ? r.path : undefined;
      if (!path) { problems.push(`roots: ${JSON.stringify(r)} is not a folder path`); continue; }
      const abs = resolve(expand(path, h));
      const label = isObj(r) && typeof r.label === 'string' ? r.label : basename(abs).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!LABEL.test(label)) { problems.push(`roots: the label "${label}" for ${path} must be lower case letters, digits and dashes`); continue; }
      if (roots.some((x) => x.label === label)) { problems.push(`roots: two roots are labelled "${label}"; give one a label of its own`); continue; }
      if (roots.some((x) => x.path === abs)) { problems.push(`roots: ${path} is listed twice`); continue; }
      roots.push({ path: abs, label });
    }
    if (roots.length) c.roots = roots; else problems.push('roots: no usable folder; using ~/Dev');
  }
  if (raw.exclude !== undefined) {
    if (Array.isArray(raw.exclude) && raw.exclude.every((x) => typeof x === 'string' && x)) c.exclude = raw.exclude as string[];
    else problems.push('exclude: must be a list of folder names or paths');
  }
  if (raw.projects !== undefined) {
    if (!isObj(raw.projects)) problems.push('projects: must be an object keyed by project id');
    else {
      for (const [id, v] of Object.entries(raw.projects)) {
        if (!isObj(v)) { problems.push(`projects.${id}: must be an object`); continue; }
        const d: Defaults[string] = {};
        if (typeof v.name === 'string' && v.name) d.name = v.name;
        if (typeof v.liveUrl === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(v.liveUrl)) d.liveUrl = v.liveUrl;
        else if (v.liveUrl !== undefined) problems.push(`projects.${id}.liveUrl: must be an http(s) URL`);
        if (v.openPort === true) d.openPort = true;
        c.projects[id] = d;
      }
    }
  }
  for (const k of ['port', 'proxyPort'] as const) {
    if (raw[k] === undefined) continue;
    if (port(raw[k])) c[k] = raw[k] as number; else problems.push(`${k}: must be a port number from 1024 to 65535`);
  }
  if (c.port === c.proxyPort) { problems.push('port and proxyPort are the same; using the defaults'); c.port = 7777; c.proxyPort = 7700; }
  if (raw.browser !== undefined) {
    if (typeof raw.browser === 'string' && /^[\w .()-]{1,60}$/.test(raw.browser)) c.browser = raw.browser;
    else problems.push('browser: must be an application name, such as "Safari", or "default"');
  }
  if (raw.editor !== undefined) {
    if (typeof raw.editor === 'string' && /^[a-z0-9-]{1,30}$/.test(raw.editor)) c.editor = raw.editor;
    else problems.push('editor: must be an editor id, such as "vscode"');
  }
  if (raw.assistant !== undefined) {
    if (ASSISTANTS.includes(raw.assistant as AssistantId)) c.assistant = raw.assistant as AssistantId;
    else problems.push(`assistant: must be one of ${ASSISTANTS.join(', ')}`);
  }
  if (raw.modules !== undefined) {
    if (!isObj(raw.modules)) problems.push('modules: must be an object of module names to true or false');
    else for (const [k, v] of Object.entries(raw.modules)) {
      if (!MODULES.includes(k as ModuleName)) problems.push(`modules: unknown module "${k}" (known: ${MODULES.join(', ')})`);
      else if (typeof v !== 'boolean') problems.push(`modules.${k}: must be true or false`);
      else c.modules[k as ModuleName] = v;
    }
  }
  if (raw.backup !== undefined) {
    if (isObj(raw.backup) && typeof raw.backup.log === 'string') c.backup = { log: resolve(expand(raw.backup.log, h)) };
    else problems.push('backup: must be { "log": "<path of your backup script\'s log>" }');
  }
  if (raw.self !== undefined) {
    if (typeof raw.self === 'boolean') c.self = raw.self; else problems.push('self: must be true or false');
  }
  return { ...c, problems };
}

/** The state dir: OBERTH_STATE_DIR when set (a second Oberth beside the installed one), else the macOS default. */
export function stateDirOf(env: NodeJS.ProcessEnv = process.env, h = home): string {
  return env.OBERTH_STATE_DIR ? resolve(expand(env.OBERTH_STATE_DIR, h)) : join(h, 'Library/Application Support/oberth');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, h = home): OberthConfig {
  const stateDir = stateDirOf(env, h);
  const logDir = env.OBERTH_STATE_DIR ? join(stateDir, 'logs') : join(h, 'Library/Logs/oberth');
  const file = join(stateDir, 'config.json');
  let raw: unknown;
  const pre: string[] = [];
  if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e: any) { pre.push(`config.json can't be read (${e.message}); using the defaults`); }
  }
  const c = parseConfig(raw, stateDir, logDir, h);
  return { ...c, file, problems: [...pre, ...c.problems] };
}

export const config: OberthConfig = loadConfig();

// ---------- roots and project ids ----------

const realOr = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

/**
 * A project's id from its root and its path inside it: the first root's projects keep their bare path
 * (`games/arcade` → `games__arcade`), so ids never change when a root is added; other roots prefix their label.
 */
export const projectId = (roots: Root[], root: Root, rel: string): string =>
  (root === roots[0] ? rel : `${root.label}/${rel}`).replaceAll('/', '__');

/** Whether a folder is left out: by name at a root's top level, or by path (absolute or ~/). */
export function excluded(exclude: string[], root: Root, rel: string, dir: string): boolean {
  const top = rel.split('/')[0];
  return exclude.some((e) => (e.includes('/') ? realOr(resolve(expand(e))) === realOr(dir) : !rel.includes('/') && e === top));
}

/** The root a folder is in (the deepest one, when roots nest) and its path inside it, or undefined. */
export function rootOf(roots: Root[], dir: string): { root: Root; rel: string } | undefined {
  const real = realOr(dir);
  let best: { root: Root; rel: string } | undefined;
  for (const r of roots) {
    const base = realOr(r.path);
    if (real === base || real.startsWith(base + '/')) {
      if (!best || base.length > realOr(best.root.path).length) best = { root: r, rel: real === base ? '' : real.slice(base.length + 1) };
    }
  }
  return best;
}

/** How a root reads in the dashboard and in messages: its path with ~ for the home folder. */
export const rootLabel = (r: Root): string => tilde(r.path);
export { tilde, expand };

// ---------- Node and PATH for launches ----------

const parseVersion = (v: string): number[] => v.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
const newer = (a: number[], b: number[]): number => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};

/** Node bin dir from nvm: newest installed version matching the default alias, else newest installed. */
export function resolveNodeBin(homeDir: string = home): string {
  const versionsDir = join(homeDir, '.nvm/versions/node');
  const installed = existsSync(versionsDir) ? readdirSync(versionsDir).filter((v) => /^v\d/.test(v)) : [];
  if (installed.length === 0) return '/opt/homebrew/bin';
  const aliasFile = join(homeDir, '.nvm/alias/default');
  const alias = existsSync(aliasFile) ? readFileSync(aliasFile, 'utf8').trim().replace(/^v/, '') : '';
  const prefix = /^\d+(\.\d+)*$/.test(alias) ? alias.split('.').map(Number) : null;
  const matching = prefix ? installed.filter((v) => prefix.every((n, i) => parseVersion(v)[i] === n)) : [];
  const pool = matching.length ? matching : installed;
  const best = pool.sort((a, b) => newer(parseVersion(b), parseVersion(a)))[0];
  return join(versionsDir, best, 'bin');
}

export const basePath = (nodeBin: string): string => `${nodeBin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

