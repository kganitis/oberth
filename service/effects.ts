// What Oberth does outside itself on the person's behalf: opening pages, editors, Finder and assistant sessions.
// The server only ever calls these, so tests pass fakes, and main.ts builds the real ones from config.json.
import { execFile, execFileSync } from 'node:child_process';
import type { Assistant } from './assistant.ts';
import type { Editor } from './editors.ts';

export interface Effects {
  openUrl(url: string): void;
  /** the project's assistant session, or a new one (no-op without an assistant) */
  openAssistant(dir: string): void;
  /** that exact session, where openAssistant picks the project's newest */
  openSession(id: string): void;
  /** a new session in that folder, with its first message typed in (starting an idea, Resume) */
  openNewSession(dir: string, prompt: string): void;
  openInEditor(dir: string): void;
  /** a file in the editor, at that line */
  openFile(path: string, line: number): void;
  revealInFinder(dir: string): void;
  /** shows a file selected in Finder */
  revealFile(path: string): void;
  lanIp(): string | undefined;
}

const run = (args: string[], what: string) => execFile('/usr/bin/open', args, (err) => { if (err) console.error(`${what} failed: ${err.message}`); });

/** Pages open in the configured browser: an app name for `open -a`, or "default" for the system's choice. */
export const browserArgs = (browser: string, url: string): string[] => (browser === 'default' ? [url] : ['-a', browser, url]);

export function makeEffects(o: { browser: string; editor: Editor; assistant: Assistant }): Effects {
  const a = o.assistant;
  return {
    openUrl: (url) => run(browserArgs(o.browser, url), 'open page'),
    openAssistant: (dir) => a.open?.(dir),
    openSession: (id) => a.openSession?.(id),
    openNewSession: (dir, prompt) => a.openNew?.(dir, prompt),
    openInEditor: (dir) => o.editor.openFolder(dir),
    openFile: (path, line) => o.editor.openFile(path, line),
    revealInFinder: (dir) => run([dir], 'show in Finder'),
    revealFile: (path) => run(['-R', path], 'show file in Finder'),
    lanIp() {
      for (const iface of ['en0', 'en1']) {
        try {
          const ip = execFileSync('/usr/sbin/ipconfig', ['getifaddr', iface], { encoding: 'utf8' }).trim();
          if (ip) return ip;
        } catch { /* interface down */ }
      }
      return undefined;
    },
  };
}
