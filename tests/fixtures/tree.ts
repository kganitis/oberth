import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Writes path -> contents under a fresh temp dir. A path ending in '/' creates a directory. */
export function makeTree(spec: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'oberth-'));
  for (const [rel, contents] of Object.entries(spec)) {
    const full = join(root, rel);
    if (rel.endsWith('/')) { mkdirSync(full, { recursive: true }); continue; }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}
