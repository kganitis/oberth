import { launcherOf } from './launchers.ts';
import { pmOf, type Mode, type Project, type RunPlan, type RunStep } from './types.ts';

/** address: the project's stable address when the proxy is up (Hugo builds its links and live reload from it) */
export interface PlanOptions { port: number; lanIp: string; pathEnv: string; address?: string }

/** Environment for everything Oberth spawns in a project (see CLAUDE.md for why each one). */
export const baseEnv = (pathEnv: string): Record<string, string> =>
  ({ ...process.env, PATH: pathEnv, BROWSER: '/usr/bin/true', PYTHONUNBUFFERED: '1', FORCE_COLOR: '1' }) as Record<string, string>;

export function phoneAvailable(p: Project): boolean {
  return buildPlan(p, 'lan', { port: 0, lanIp: '0.0.0.0', pathEnv: '' }) !== null;
}

/** Steps to run a project in the given mode; null when that mode isn't available. */
export function buildPlan(p: Project, mode: Mode, opts: PlanOptions): RunPlan | null {
  const plan = basePlan(p, mode, opts);
  // a page URL from .oberth.json wins: it is what gets probed and opened
  return plan && p.url && !plan.window ? { ...plan, localUrl: p.url } : plan;
}

function basePlan(p: Project, mode: Mode, opts: PlanOptions): RunPlan | null {
  const lan = mode === 'lan';
  const pm = pmOf(p);
  if (p.starter.type === 'none') return null; // nothing to launch
  const install: RunStep[] = p.needsInstall ? [{ argv: [pm, 'install'], label: 'install' }] : [];
  const base = { cwd: p.dir, env: baseEnv(opts.pathEnv) };
  // a window app (Electron) runs its own window: no page, no phone mode
  if (p.kind === 'window') {
    if (lan) return null;
    const argv = p.starter.type === 'override' ? p.starter.argv ?? [] : [pm, 'run', 'dev'];
    return { ...base, steps: [...install, { argv }], window: true };
  }
  const launcher = launcherOf(p);
  if (!launcher) return null; // a starter type no launcher knows (one removed from launchers.ts)
  const port = String(opts.port);
  return launcher.plan(p, { mode, lan, base, install, port, localUrl: `http://localhost:${port}/`, lanIp: opts.lanIp, address: opts.address });
}
