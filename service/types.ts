/** library: a repository with no dev server (a package, a tool, coursework): everything but launching */
export type Kind = 'app' | 'window' | 'site' | 'library';
/**
 * How a project starts: a launcher's type (launchers.ts: 'npm-dev', 'hugo', 'serve-py', 'static', 'override', or one
 * you add), or 'none' for a library. devScript and argv carry what the built-in launchers need; a launcher of your own
 * may keep its own facts in `data`.
 */
export interface Starter { type: string; devScript?: string; argv?: string[]; data?: Record<string, unknown> }
export interface Project {
  id: string;
  relPath: string;
  dir: string;
  name: string;
  kind: Kind;
  starter: Starter;
  scripts: Record<string, string>;
  needsInstall: boolean;
  /** from package.json's packageManager field, else the lockfile; absent means npm */
  packageManager?: PackageManager;
  /** page URL from .oberth.json (local http only) */
  url?: string;
  /** deployed site from .oberth.json (http/https only) */
  liveUrl?: string;
  /** the stable address's name from .oberth.json (tune-picker → http://tune-picker.localhost:7700) */
  host?: string;
}
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
/** The package manager a project installs and runs scripts with. */
export const pmOf = (p: { packageManager?: PackageManager }): PackageManager => p.packageManager ?? 'npm';
export type Mode = 'local' | 'lan';
export type RunStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'stopping' | 'failed';
export interface RunState {
  id: string;
  status: RunStatus;
  mode: Mode;
  pid?: number;
  url?: string;
  startedAt?: number;
  error?: string;
  lanNote?: string;
  /** the step being run, as a display string */
  command?: string;
}
export interface RunStep { argv: string[]; label?: 'install' | 'build' }
/** window: the server opens its own window, no page URL is expected. */
export interface RunPlan { cwd: string; env: Record<string, string>; steps: RunStep[]; window?: true; lanNote?: string; /** known page URL to probe (servers whose port we chose) */ localUrl?: string }
export interface Listener { pid: number; pgid: number; port: number; cwd: string; command?: string }
export interface GitInfo { branch: string; changed: number; ahead: number }
export interface GitFile { status: string; path: string }
export interface GitCommit { hash: string; subject: string; time: number; unpushed: boolean }
export interface GitDetail { branch: string; upstream?: string; ahead: number; behind: number; files: GitFile[]; commits: GitCommit[] }
/** openPort: open the dev server's own address, not the stable one (a login redirect is pinned to that port) */
export type Defaults = Record<string, { name?: string; liveUrl?: string; openPort?: true }>;
