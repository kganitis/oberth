import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** pinned: projects kept at the top of their group on the dashboard. */
export interface Settings { hidden: string[]; pinned: string[]; lastLaunched: Record<string, number> }

export function loadSettings(stateDir: string): Settings {
  try {
    const s = JSON.parse(readFileSync(join(stateDir, 'settings.json'), 'utf8'));
    return { hidden: Array.isArray(s.hidden) ? s.hidden : [], pinned: Array.isArray(s.pinned) ? s.pinned : [], lastLaunched: s.lastLaunched ?? {} };
  } catch {
    return { hidden: [], pinned: [], lastLaunched: {} };
  }
}

export function saveSettings(stateDir: string, s: Settings): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'settings.json'), JSON.stringify(s, null, 2) + '\n');
}
