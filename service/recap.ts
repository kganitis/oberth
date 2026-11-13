import type { Activity } from './activity.ts';
import type { GitFacts } from './gitinfo.ts';
import type { GitDetail } from './types.ts';

const SESSIONS = 3, COMMITS = 5, PROMPT_CHARS = 280;

export interface LastPrompt { text: string; at: number }
export interface Recap {
  /** when the project was last worked on, by commits or Claude turns */
  lastWorkAt?: number;
  /** what the owner last asked Claude here */
  prompt?: LastPrompt;
  /** the latest sessions, newest first */
  sessions: { title: string; at: number; ms: number; turns: number }[];
  commits: { hash: string; subject: string; time: number }[];
  /** what is lying around in the repository; undefined outside one */
  left?: { branch: string; changed: number; ahead: number; stashes: number };
}

/**
 * The "where was I?" card for a project being picked up again. Commits come from git rather than the Logbook,
 * which looks back 90 days: a long-paused project is the one that needs this most.
 */
export function buildRecap(work: Activity[], git: GitDetail | null, facts: GitFacts | null, prompt?: LastPrompt): Recap {
  const byKey = new Map<string, Recap['sessions'][number]>();
  for (const e of work) {
    if (e.kind !== 'session') continue;
    const key = e.sessionId ?? e.text;
    const s = byKey.get(key) ?? { title: e.text, at: 0, ms: 0, turns: 0 };
    s.at = Math.max(s.at, e.at + (e.ms ?? 0));
    s.ms += e.ms ?? 0;
    s.turns++;
    byKey.set(key, s);
  }
  const sessions = [...byKey.values()].sort((a, b) => b.at - a.at).slice(0, SESSIONS);
  const commits = (git?.commits ?? []).slice(0, COMMITS).map(({ hash, subject, time }) => ({ hash, subject, time }));
  const times = [...sessions.map((s) => s.at), ...commits.map((c) => c.time), ...work.map((e) => e.at + (e.ms ?? 0))];
  return {
    lastWorkAt: times.length ? Math.max(...times) : undefined,
    prompt: prompt && { ...prompt, text: prompt.text.length > PROMPT_CHARS ? `${prompt.text.slice(0, PROMPT_CHARS - 1)}…` : prompt.text },
    sessions, commits,
    left: git ? { branch: git.branch, changed: git.files.length, ahead: git.ahead, stashes: facts?.stashes ?? 0 } : undefined,
  };
}

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The first message of a session that picks a paused project up again: the "where was I?" card and the About's
 * notes, as text, then a request to take stock before changing anything. Typed into the new session, not sent.
 */
export function resumeBrief(name: string, notes: string | undefined, r: Recap): string {
  const out = [`I'm picking up ${name} again${r.lastWorkAt ? `, last worked on ${day(r.lastWorkAt)}` : ''}.`];
  if (notes?.trim()) out.push(`My notes on it:\n${notes.trim()}`);
  const where: string[] = [];
  if (r.prompt) where.push(`The last thing I asked Claude here: "${r.prompt.text}"`);
  const l = r.left;
  const left = l && [l.branch !== 'main' && l.branch !== 'master' && `on branch ${l.branch}`, l.changed && `${plural(l.changed, 'file')} not committed`,
    l.ahead && `${plural(l.ahead, 'commit')} not pushed`, l.stashes && plural(l.stashes, 'stash', 'stashes')].filter(Boolean);
  if (left?.length) where.push(`Left behind: ${left.join(', ')}`);
  if (r.sessions.length) where.push(`Recent sessions: ${r.sessions.map((s) => `"${s.title}" (${day(s.at)})`).join('; ')}`);
  if (r.commits.length) where.push(`Recent commits:\n${r.commits.map((c) => `  ${c.hash} ${c.subject} (${day(c.time)})`).join('\n')}`);
  if (where.length) out.push(`Where it was left:\n${where.map((w) => `- ${w}`).join('\n')}`);
  out.push('Look at the notes, the recent history and the working tree, then tell me briefly where things stand and what you would do next. Wait for me before changing anything.');
  return out.join('\n\n');
}
