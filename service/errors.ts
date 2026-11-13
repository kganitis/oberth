import { stripAnsi } from './ansi.ts';

// A line that starts an error. False positives are accepted; the count resets on every launch.
const STARTS = [
  /Internal server error|error when starting|\[vite\] error\b/i,
  /^\s*(?:Uncaught |Unhandled \w+ )?(?:[A-Z][A-Za-z]*)?Error(?: \[[A-Z_0-9]+\])?:/,
  /\bnpm ERR!|^npm error\b|\bERR!/,
];
// Lines that belong to the error above them: stack frames, code frames, carets.
const CONTINUES = [/^\s+at\s/, /^\s*\d+\s*\|/, /^\s*\|/, /^\s*>\s*\d+\s*\|/, /^\s*\^+\s*$/, /^\s+\S/];

export interface ErrorGroup { at: number; lines: string[] }

const MAX_GROUPS = 100;
const MAX_LINES = 14;
/** A match this many lines after the previous error's end is the same error (Vite prints "error when starting" then "Error: …"). */
const SAME_ERROR_GAP = 2;

/**
 * Counts errors in a server's output, fed in arbitrary chunks. Keeps the last MAX_GROUPS errors as
 * raw lines (ANSI kept, for colour), each with one line of context before it.
 */
export class ErrorTracker {
  count = 0;
  groups: ErrorGroup[] = [];
  private partial = '';
  private lineNo = 0;
  private prev = '';
  private open?: ErrorGroup;
  private lastErrorLine = -100;

  feed(chunk: string, now = Date.now()): void {
    const text = this.partial + chunk;
    const lines = text.split('\n');
    this.partial = lines.pop() ?? '';
    for (const raw of lines) this.line(raw, now);
  }

  private line(raw: string, now: number): void {
    const n = this.lineNo++;
    const plain = stripAnsi(raw).replace(/.*\r(?=.)/, '');
    const starts = STARTS.some((r) => r.test(plain));
    const continues = !starts && this.open && plain.trim() !== '' && CONTINUES.some((r) => r.test(plain));
    if (starts && n - this.lastErrorLine <= SAME_ERROR_GAP && this.open) {
      this.push(raw); this.lastErrorLine = n;
    } else if (starts) {
      this.count++;
      this.open = { at: now, lines: this.prev.trim() ? [this.prev] : [] };
      this.groups.push(this.open);
      if (this.groups.length > MAX_GROUPS) this.groups.shift();
      this.push(raw); this.lastErrorLine = n;
    } else if (continues) {
      this.push(raw); this.lastErrorLine = n;
    } else if (this.open && n - this.lastErrorLine > SAME_ERROR_GAP) {
      this.open = undefined;
    }
    this.prev = raw;
  }

  private push(raw: string): void {
    if (this.open && this.open.lines.length < MAX_LINES) this.open.lines.push(raw);
  }
}
