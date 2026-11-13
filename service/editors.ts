// Editors a project can be opened in (config.json "editor"). One entry per editor: how it opens a folder, and how it
// opens a file at a line (Recall's code and docs hits). To add one, copy an entry; CUSTOMIZE.md has the recipe.
import { execFile } from 'node:child_process';

export interface Editor {
  id: string;
  /** shown on buttons and menu items: "Open in <label>" */
  label: string;
  openFolder(dir: string): void;
  openFile(path: string, line: number): void;
}

const open = (args: string[], what: string) =>
  execFile('/usr/bin/open', args, (err) => { if (err) console.error(`${what} failed: ${err.message}`); });
const fileUrl = (scheme: string, path: string, line: number) => `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}:${line}`;

/** An editor with a macOS app and a `<scheme>://file/<path>:<line>` URL handler, as VS Code and its forks have. */
const appWithScheme = (id: string, label: string, app: string, scheme: string): Editor => ({
  id, label,
  openFolder: (dir) => open(['-a', app, dir], `open in ${label}`),
  openFile: (path, line) => open([fileUrl(scheme, path, line)], `open file in ${label}`),
});

export const EDITORS: Editor[] = [
  appWithScheme('vscode', 'VS Code', 'Visual Studio Code', 'vscode'),
  appWithScheme('cursor', 'Cursor', 'Cursor', 'cursor'),
  appWithScheme('windsurf', 'Windsurf', 'Windsurf', 'windsurf'),
  {
    id: 'zed', label: 'Zed',
    openFolder: (dir) => open(['-a', 'Zed', dir], 'open in Zed'),
    // zed://file/<path>:<line> opens at the line
    openFile: (path, line) => open([fileUrl('zed', path, line)], 'open file in Zed'),
  },
  {
    id: 'sublime', label: 'Sublime Text',
    openFolder: (dir) => open(['-a', 'Sublime Text', dir], 'open in Sublime Text'),
    openFile: (path, line) => open([`subl://open?url=file://${encodeURI(path)}&line=${line}`], 'open file in Sublime Text'),
  },
  {
    // no editor: folders open in Finder, files in whatever app opens them
    id: 'finder', label: 'Finder',
    openFolder: (dir) => open([dir], 'open in Finder'),
    openFile: (path) => open([path], 'open file'),
  },
];

/** The configured editor, or VS Code when the id is unknown (reported once at start). */
export function editorOf(id: string): Editor {
  return EDITORS.find((e) => e.id === id) ?? EDITORS[0];
}
