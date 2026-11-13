import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What the owner writes about a project: kept in Oberth's state dir, never in the project's folder. */
export const STATUSES = ['active', 'paused', 'finished', 'idea'] as const;
export type ProjectStatus = (typeof STATUSES)[number];
/** description: one line, in the About tab, on hovering the name and in the menu tooltip */
/** released: out where anyone can use it (owner's call, separate from status); releasedWhere: e.g. "PyPI, simkit" */
export interface About { description?: string; status?: ProjectStatus; released?: boolean; releasedWhere?: string; notes?: string; updatedAt?: number }

export const LIMITS = { description: 200, releasedWhere: 80, notes: 4000 };

const file = (stateDir: string) => join(stateDir, 'about.json');

export function loadAbout(stateDir: string): Record<string, About> {
  try {
    const all = JSON.parse(readFileSync(file(stateDir), 'utf8'));
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

/** Validates an edit from the dashboard: trimmed strings within limits, a known status. Throws on bad input. */
export function cleanAbout(body: unknown): About {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number, name: string): string | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string') throw new Error(`${name} must be text`);
    const t = v.trim();
    if (t.length > max) throw new Error(`${name} is longer than ${max} characters`);
    return t || undefined;
  };
  const status = b.status === undefined || b.status === null || b.status === '' ? undefined : b.status;
  if (status !== undefined && !STATUSES.includes(status as ProjectStatus)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const released = b.released === true || b.released === 'on' || b.released === 'true' ? true : undefined;
  return {
    description: text(b.description, LIMITS.description, 'description'),
    status: status as ProjectStatus | undefined, released,
    // where only means something for a released project
    releasedWhere: released ? text(b.releasedWhere, LIMITS.releasedWhere, 'where') : undefined,
    notes: text(b.notes, LIMITS.notes, 'notes'),
  };
}

export function saveAbout(stateDir: string, id: string, about: About, now = Date.now()): About {
  const all = loadAbout(stateDir);
  const entry: About = { ...about, updatedAt: now };
  all[id] = entry;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(file(stateDir), JSON.stringify(all, null, 2) + '\n');
  return entry;
}
