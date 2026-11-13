// The AI coding assistant Oberth works with (config.json "assistant"). Everything Oberth knows about an assistant goes
// through this one object, so another assistant is one new implementation and "none" is a whole, working mode.
//
// Every part is optional, and a feature whose part is missing hides rather than showing empty:
//   states                  the chip and button on each row, and "working" in the menu bar
//   open, openSession       the row's button, Agenda items, Recall hits, an idea's session
//   openNew                 Resume in <assistant>, and starting an idea
//   lastPrompt              the "Where was I?" card's last prompt
//   sessions                the Agenda's waiting sessions, the Logbook's time and cost, Recall over transcripts
// CUSTOMIZE.md says which to write first for another assistant: open and openNew give the buttons; sessions is the
// largest and is shaped after Claude Code's own files (claudesessions.ts), so another assistant maps onto it.
import { execFile } from 'node:child_process';
import {
  claudeStates, claudeUrlFor, lastPrompt, liveSessionIds, newSessionUrl, pendingTool, scanSessions, TRANSCRIPTS_DIR,
  type ClaudeSession, type ClaudeState, type PendingTool, type SessionScan,
} from './claudesessions.ts';
import type { AssistantId } from './config.ts';
import type { LastPrompt } from './recap.ts';

/** What a row shows: the project's newest session, and whether the assistant is mid-turn in it. */
export type AssistantState = ClaudeState;

export interface AssistantSessions {
  /** every session the assistant's app knows; archived ones too when asked (the Logbook and Recall want titles) */
  scan(withArchived?: boolean): SessionScan;
  /** ids of sessions whose process is alive */
  live(): Promise<Set<string>>;
  /** an unanswered tool call at the end of a live session's transcript */
  pending(s: ClaudeSession): PendingTool | undefined;
  /** the folder of transcripts, one subfolder per working folder (see transcriptFolder) */
  transcriptsRoot: string;
}

export interface Assistant {
  id: AssistantId | string;
  /** "Claude"; shown on buttons ("Resume in Claude") */
  label: string;
  /** its desktop app's bundle id: the menu bar doesn't notify about the Agenda while that app is in front */
  bundleId?: string;
  states?(dirs: string[]): Promise<Map<string, AssistantState>>;
  /** the project's session, or a new one in its folder */
  open?(dir: string): void;
  openSession?(id: string): void;
  /** a new session in a folder with its first message typed in, for the person to read and send */
  openNew?(dir: string, brief: string): void;
  lastPrompt?(dir: string): LastPrompt | undefined;
  sessions?: AssistantSessions;
}

const open = (url: string, what: string) => execFile('/usr/bin/open', [url], (err) => { if (err) console.error(`${what} failed: ${err.message}`); });

/** Claude Code, through the Claude desktop app: its session files, Claude Code's transcripts and claude:// links. */
export const claudeAssistant: Assistant = {
  id: 'claude',
  label: 'Claude',
  bundleId: 'com.anthropic.claudefordesktop',
  states: async (dirs) => claudeStates(dirs, scanSessions().sessions, await liveSessionIds()),
  open: (dir) => open(claudeUrlFor(dir), 'open Claude session'),
  openSession: (id) => open(`claude://claude.ai/epitaxy/${id}`, 'open Claude session'),
  openNew: (dir, brief) => open(newSessionUrl(dir, brief), 'new Claude session'),
  lastPrompt: (dir) => lastPrompt(dir),
  sessions: {
    scan: (withArchived = false) => scanSessions(undefined, withArchived),
    live: liveSessionIds,
    pending: (s) => pendingTool(s),
    transcriptsRoot: TRANSCRIPTS_DIR,
  },
};

/** No assistant: Oberth as a launcher, About, Logbook of commits, Agenda, Recall over code and notes, and Ideas. */
export const noAssistant: Assistant = { id: 'none', label: '' };

export const ASSISTANT_IMPLS: Record<string, Assistant> = { claude: claudeAssistant, none: noAssistant };

export const assistantOf = (id: string): Assistant => ASSISTANT_IMPLS[id] ?? noAssistant;

/** What the dashboard and the menu bar need to know: whether there is one, its name, and what it can do. */
export function assistantView(a: Assistant) {
  if (a.id === 'none') return null;
  return {
    id: a.id, label: a.label, bundleId: a.bundleId,
    can: { states: !!a.states, open: !!a.open, openSession: !!a.openSession, openNew: !!a.openNew, lastPrompt: !!a.lastPrompt, sessions: !!a.sessions },
  };
}
