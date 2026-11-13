// Oberth's MCP server: the CLI's operations as tools for agent sessions (Claude Code or any MCP client). Only the part of the protocol a tools-only
// server needs (initialize, ping, tools/list, tools/call, progress), as JSON-RPC 2.0 messages; scripts/mcp.ts carries
// them over stdio. Every tool goes through the service's HTTP API with the token, like the CLI, so the API's own rules hold.
import * as ops from './client.ts';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

import { config, rootLabel } from '../service/config.ts';

/** What a session is told about Oberth: written from the setup, so its folders and exclusions are the person's own. */
export function instructions(ctx: Pick<ops.Ctx, 'roots' | 'exclude'> = {}): string {
  const roots = (ctx.roots ?? config.roots).map(rootLabel).join(', ');
  const exclude = ctx.exclude ?? config.exclude;
  return `Oberth is the Dev Project Console on the owner's Mac: it lists every project in ${roots}, starts and stops their dev servers, and keeps what the owner wrote about each one (its About), what is waiting for them (the Agenda), their notebook of ideas (Ideas), and a searchable history of code, docs, notes, ideas and past assistant sessions.

A project argument is an id from the projects tool or a folder path; left out, it is the project this session runs in.

- Before solving something that may have been solved in another project, try search.
- Picking up a paused project: recap says where it was left.
- To test against a running dev server, use launch (it waits until the page serves), output to read its log, and stop when done if you started it.
- A new project, or a change to how one runs (dev command, port, stack, deploy target): run check and fix what it reports.
- Keep the About current when a project's purpose, status or state changes in a way the owner would want to see at a glance, with set_about, and mention it in your reply. Set released only when the owner says it is out.
- Use ask only when work can't continue without the owner and the need will outlive this conversation; a question for the chat stays in the chat. Close it with close_ask once it stops applying.
- When the owner says something is an idea for later ("that's one for later", "put it in Ideas", "idea for my-app: …"), file it with idea: with project for this or another existing project, without one for something that would be a project of its own. Only on the owner's words, never on your own initiative. Before filing, ideas or search can tell whether it is there already. Starting an idea is the owner's, in the dashboard.${exclude.length ? `
- These folders are left out of Oberth on purpose: never add them or mention them there: ${exclude.join(', ')}.` : ''}`;
}

const project = { type: 'string', description: 'Project id or folder path. Defaults to the project this session runs in.' };
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  annotations: Record<string, boolean>;
  run(args: any, say: (line: string) => void): Promise<string>;
}

export function tools(ctx: ops.Ctx): Tool[] {
  return [
    {
      name: 'projects', title: 'List projects', annotations: READ,
      description: 'Every project Oberth knows: id, kind (app, site, window, library), dev-server state, About status, and whether it is hidden.',
      inputSchema: { type: 'object', properties: {} },
      run: () => ops.list(ctx),
    },
    {
      name: 'project', title: 'Show a project', annotations: READ,
      description: "What Oberth knows about one project: folder, kind, the command that starts it, state and URL, live site, stack, deploy target, its About (description, status, released, notes), how released work is doing outside (GitHub stars, forks and issues from others, PyPI downloads, whether the live site is up), open asks, and anything that would make a launch fail (out-of-date dependencies, Python packages missing from its venv, the wrong Node version, a missing tool, a taken port).",
      inputSchema: { type: 'object', properties: { project } },
      run: (a) => ops.show(ctx, a.project),
    },
    {
      name: 'search', title: 'Search everything', annotations: READ,
      description: "Finds an exact phrase in every project's code, docs and About notes, in the owner's ideas, and in what was said in past assistant sessions (with the transcript's path). For \"where did we solve this before?\". One literal phrase: words in another order don't match.",
      inputSchema: {
        type: 'object', required: ['query'],
        properties: {
          query: { type: 'string', description: 'The exact words, 2 to 200 characters.' },
          project: { type: 'string', description: 'Only this project (id or folder path).' },
          kind: { type: 'string', enum: ['code', 'docs', 'notes', 'ideas', 'sessions'], description: 'Only this kind of hit.' },
        },
      },
      run: (a) => ops.search(ctx, a.query, { project: a.project, kind: a.kind }),
    },
    {
      name: 'recap', title: 'Where was I?', annotations: READ,
      description: "Where a project was left: its About notes, the owner's last prompt there, what is uncommitted, unpushed or stashed, recent assistant sessions and commits.",
      inputSchema: { type: 'object', properties: { project } },
      run: (a) => ops.recap(ctx, a.project),
    },
    {
      name: 'agenda', title: 'The Agenda', annotations: READ,
      description: 'Everything waiting for the owner across all projects: Needs you (asks, unanswered questions in live sessions, failed backups) and Worth a look.',
      inputSchema: { type: 'object', properties: {} },
      run: () => ops.agenda(ctx),
    },
    {
      name: 'launch', title: 'Launch a dev server', annotations: { ...WRITE, idempotentHint: true },
      description: "Starts the project's dev server the way the owner's console does (dependencies installed first if missing or out of date, with npm, pnpm, yarn or bun as the project uses) and waits until it serves a page, up to 3 minutes. Returns its URL, or why it failed with the end of its log; anything Oberth sees beforehand that would make it fail (the wrong Node version, a missing tool, Python packages missing from its venv, a taken port) comes first. Doesn't open the browser unless open is true. Already running: returns its URL.",
      inputSchema: { type: 'object', properties: { project, open: { type: 'boolean', description: "Open the page in the owner's browser too. Default false." } } },
      run: (a) => ops.launch(ctx, a.project, { open: a.open === true }),
    },
    {
      name: 'stop', title: 'Stop a dev server', annotations: { ...WRITE, idempotentHint: true },
      description: "Stops the project's dev server if Oberth started it. A server started outside Oberth is left alone.",
      inputSchema: { type: 'object', properties: { project } },
      run: (a) => ops.stop(ctx, a.project),
    },
    {
      name: 'output', title: 'Dev server output', annotations: READ,
      description: "The dev server's state, the error groups Oberth counted since launch, and the last lines of its output (colour codes removed). The output starts over on each launch.",
      inputSchema: { type: 'object', properties: { project, lines: { type: 'integer', minimum: 1, maximum: 400, description: 'How many lines from the end. Default 60.' } } },
      run: (a) => ops.output(ctx, a.project, a.lines),
    },
    {
      name: 'check', title: 'Check the integration', annotations: WRITE,
      description: "Checks that Oberth runs the project correctly: launches it without opening the browser, waits for a page (up to 3 minutes), checks the page answers, stops it again, and reports missing About fields. Run it on a new project or after changing how one runs.",
      inputSchema: { type: 'object', properties: { project } },
      async run(a, say) {
        const lines: string[] = [];
        const r = await ops.check(ctx, a.project, (l) => { lines.push(l); say(l); });
        const text = lines.join('\n');
        if (!r.ok) throw new ops.OberthError(text, 1);
        return text;
      },
    },
    {
      name: 'set_about', title: 'Update the About', annotations: { ...WRITE, idempotentHint: true },
      description: "Changes the project's About in Oberth (never written into the project); only the fields given change. Write like the existing entries: plain, short, no marketing. Limits: description 200 characters, notes 4000, released 80.",
      inputSchema: {
        type: 'object',
        properties: {
          project,
          description: { type: 'string', description: 'One line on what it is.' },
          status: { type: 'string', enum: ['active', 'paused', 'finished', 'idea', 'none'], description: 'active: worked on now. paused: not for now. finished: does what it was built for. idea: not started. none clears it.' },
          notes: { type: 'string', description: 'Where it was left and what is next, in plain sentences. Replaces the notes.' },
          released: { type: ['string', 'boolean'], description: 'Where it is out, such as "PyPI, name 1.2.0" or "live at example.com". false takes the mark away. Only when the owner says it is released.' },
        },
      },
      run: (a) => {
        if (a.released === true) throw new ops.OberthError('released takes where it is out (a string), or false to take the mark away.', 1);
        return ops.setAbout(ctx, a.project, { description: a.description, notes: a.notes, status: a.status, released: a.released });
      },
    },
    {
      name: 'ask', title: 'Ask the owner', annotations: WRITE,
      description: "Leaves something for the owner on the Agenda, under Needs you, which can notify them; their button opens this session. Only when work can't continue without them and the need will outlive this conversation. The same text in the same project updates the open ask. Limits: text 200 characters, detail 1000.",
      inputSchema: {
        type: 'object', required: ['text'],
        properties: {
          text: { type: 'string', description: 'What the owner should do, in one line.' },
          detail: { type: 'string', description: 'Where to look, or what they need to know.' },
          project: { type: 'string', description: 'Project id or folder path. Needed when this session runs in a project root itself or a group folder.' },
        },
      },
      run: (a) => ops.ask(ctx, a.text, a.detail, a.project),
    },
    {
      name: 'asks', title: 'Open asks', annotations: READ,
      description: "The project's open asks, with their ids.",
      inputSchema: { type: 'object', properties: { project } },
      run: (a) => ops.asks(ctx, a.project),
    },
    {
      name: 'idea', title: 'File an idea', annotations: WRITE,
      description: "Files an idea in the owner's Ideas notebook, or adds a note to one (give id and note). Only when the owner says it is an idea for later. With project, it is for that existing project (\"here\" for this session's project, \"oberth\" for Oberth itself); without, it is an idea for a new project. The same title already open for the same project gets the note instead of a twin. Limits: title 120 characters, note 4000. This session is recorded as where it came from.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The idea in a few words. Needed for a new idea.' },
          note: { type: 'string', description: 'The pitch, details or links. Needed when adding to an existing idea.' },
          project: { type: 'string', description: 'The existing project it is for: an id, a folder path, "here" or "oberth". Leave out for a new project.' },
          id: { type: 'string', description: 'An existing idea\'s id (like i7k2), to add the note to it.' },
        },
      },
      run: async (a) => {
        if (a.id) {
          if (!a.note) throw new ops.OberthError('Give the note to add to that idea.', 1);
          return ops.ideaNote(ctx, a.id, a.note);
        }
        if (!a.title) throw new ops.OberthError('Give the idea a title (or an id and a note to add to an existing one).', 1);
        return ops.idea(ctx, a.title, { note: a.note, project: a.project });
      },
    },
    {
      name: 'ideas', title: 'List ideas', annotations: READ,
      description: "The owner's open ideas with their ids: for new projects, for existing projects, and the projects started from ideas. With project, only that project's ideas.",
      inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Only the ideas for this project: an id, a folder path, "here" or "oberth".' } } },
      run: (a) => ops.ideas(ctx, a.project),
    },
    {
      name: 'close_ask', title: 'Close an ask', annotations: { ...WRITE, idempotentHint: true },
      description: 'Closes an ask once it no longer applies.',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'The ask id, from asks or project.' } } },
      run: (a) => ops.done(ctx, a.id),
    },
  ];
}

type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
type Out = Record<string, unknown>;

/** Answers one JSON-RPC message (undefined for a notification); notify sends progress while a long tool runs. */
export function createMcp(ctx: ops.Ctx, version: string, notify: (msg: Out) => void) {
  const all = tools(ctx);
  const byName = new Map(all.map((t) => [t.name, t]));
  const reply = (id: Msg['id'], result: unknown): Out => ({ jsonrpc: '2.0', id, result });
  const error = (id: Msg['id'], code: number, message: string): Out => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  async function call(id: Msg['id'], params: any): Promise<Out> {
    const tool = byName.get(params?.name);
    if (!tool) return error(id, -32602, `Unknown tool: ${params?.name}`);
    const token = params?._meta?.progressToken;
    let n = 0;
    const say = (line: string) => {
      if (token !== undefined) notify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: ++n, message: line.trim().split('\n')[0] } });
    };
    try {
      const text = await tool.run(params.arguments ?? {}, say);
      return reply(id, { content: [{ type: 'text', text: text || 'Done.' }] });
    } catch (e) {
      // failures a session can act on go back as the tool's answer, not as a protocol error
      const text = e instanceof ops.OberthError ? e.message : `Oberth's MCP server hit an error: ${(e as Error)?.message ?? e}`;
      return reply(id, { content: [{ type: 'text', text }], isError: true });
    }
  }

  return async function handle(msg: Msg): Promise<Out | undefined> {
    if (!msg || typeof msg !== 'object') return error(null, -32600, 'Invalid request');
    if (typeof msg.method !== 'string') {
      // a response to a request of ours (this server sends none) needs no answer; anything else is malformed
      return 'result' in msg || 'error' in msg ? undefined : error(msg.id, -32600, 'Invalid request');
    }
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (!isRequest) return undefined; // notifications: initialized, cancelled, roots changed
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        return reply(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'oberth', title: 'Oberth', version },
          instructions: instructions(ctx),
        });
      }
      case 'ping': return reply(msg.id, {});
      case 'tools/list': return reply(msg.id, { tools: all.map(({ run, ...t }) => t) });
      case 'tools/call': return call(msg.id, msg.params);
      default: return error(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  };
}
