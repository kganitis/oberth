import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import type { Project } from './types.ts';

export type IconSource =
  | { type: 'file'; path: string; mime: string }
  | { type: 'bundled'; path: string }
  | { type: 'letter'; svg: string };

const CANDIDATES = [
  'public/favicon.svg', 'public/favicon.ico', 'public/favicon.png', 'public/icons/icon.svg',
  'static/images/favicon.svg', 'static/images/favicon.ico', 'assets/favicon.svg', 'assets/favicon.ico',
];
const MIME: Record<string, string> = { '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const COLORS = ['#5b3cc4', '#127a57', '#d23a6e', '#2563eb', '#b45309', '#0f766e', '#7c2d12', '#4b5563'];

const fileIcon = (path: string): IconSource => ({ type: 'file', path, mime: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' });

/** True if file (after resolving symlinks) is inside dir: a page's icon link must not reach outside its project. */
function inside(dir: string, file: string): boolean {
  try { return realpathSync(file).startsWith(realpathSync(dir) + sep); } catch { return false; }
}

function linkedIcon(dir: string): string | undefined {
  let html: string;
  try { html = readFileSync(join(dir, 'index.html'), 'utf8'); } catch { return undefined; }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?[^"'>]*\bicon\b/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || /^(https?:|data:)/.test(href)) continue;
    const rel = href.replace(/^\.?\//, '').split(/[?#]/)[0];
    for (const base of [dir, join(dir, 'public')]) {
      const file = join(base, rel);
      if (existsSync(file) && inside(dir, file)) return file;
    }
  }
  return undefined;
}

/** Which icon to show for a project; computed fresh on every call so favicon edits show up. */
export function resolveIcon(p: Project, iconsDirs: string | string[]): IconSource {
  for (const c of CANDIDATES) if (existsSync(join(p.dir, c))) return fileIcon(join(p.dir, c));
  const linked = linkedIcon(p.dir);
  if (linked) return fileIcon(linked);
  // your own icons, by project id: <state dir>/icons/<id>.svg (see CUSTOMIZE.md)
  for (const dir of typeof iconsDirs === 'string' ? [iconsDirs] : iconsDirs) {
    const bundled = join(dir, `${p.id}.svg`);
    if (existsSync(bundled)) return { type: 'bundled', path: bundled };
  }
  const hash = [...p.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const letter = (p.name.trim()[0] ?? '?').toUpperCase().replace(/[<&>]/g, '?');
  return {
    type: 'letter',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${COLORS[hash % COLORS.length]}"/><text x="16" y="22" text-anchor="middle" font-family="-apple-system,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#fff">${letter}</text></svg>`,
  };
}

export function readIcon(icon: IconSource): { mime: string; body: Buffer } {
  if (icon.type === 'letter') return { mime: 'image/svg+xml', body: Buffer.from(icon.svg) };
  if (icon.type === 'bundled') return { mime: 'image/svg+xml', body: readFileSync(icon.path) };
  return { mime: icon.mime, body: readFileSync(icon.path) };
}
