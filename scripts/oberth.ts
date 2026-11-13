// oberth: Oberth from any Claude session (or a terminal). Talks to the running service on 127.0.0.1:7777.
//   node ~/Dev/oberth/scripts/oberth.ts list
//   node ~/Dev/oberth/scripts/oberth.ts show   [id|path]
//   node ~/Dev/oberth/scripts/oberth.ts check  [id|path]
//   node ~/Dev/oberth/scripts/oberth.ts about  [id|path] [--description D] [--status S|none] [--notes N] [--released WHERE | --not-released]
//   node ~/Dev/oberth/scripts/oberth.ts ask "what the owner must do" [--detail D] [--project id|path]
//   node ~/Dev/oberth/scripts/oberth.ts asks   [id|path]
//   node ~/Dev/oberth/scripts/oberth.ts done   <ask id>
//   node ~/Dev/oberth/scripts/oberth.ts agenda
//   node ~/Dev/oberth/scripts/oberth.ts search "exact words" [--project id|path] [--kind code|docs|notes|ideas|sessions]
//   node ~/Dev/oberth/scripts/oberth.ts idea   "title" [--note N] [--project id|path|oberth | --here]
//   node ~/Dev/oberth/scripts/oberth.ts idea   <idea id> --note N
//   node ~/Dev/oberth/scripts/oberth.ts ideas  [--project id|path | --here]
//   node ~/Dev/oberth/scripts/oberth.ts recap  [id|path]
//   node ~/Dev/oberth/scripts/oberth.ts launch [id|path] [--open]
//   node ~/Dev/oberth/scripts/oberth.ts stop   [id|path]
//   node ~/Dev/oberth/scripts/oberth.ts output [id|path] [--lines N]   (log is an older name for it)
// A path (or no argument: the current folder) is resolved to the project that contains it.
// Claude sessions get the same as tools from the MCP server, scripts/mcp.ts.
import { readFileSync } from 'node:fs';
import * as ops from './client.ts';

const ctx: ops.Ctx = { api: ops.httpApi(), cwd: process.cwd(), sessionId: process.env.CLAUDE_CODE_HOST_SESSION_ID, source: 'cli' };

function fail(msg: string, code = 2): never { console.error(msg); process.exit(code); }

const BOOLEAN = ['not-released', 'open', 'here'];
function flags(args: string[], allowed: string[]): { pos: string[]; opts: Record<string, string | true> } {
  const pos: string[] = [];
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const key = a.slice(2);
    if (!allowed.includes(key)) fail(`Unknown option: --${key}`);
    if (BOOLEAN.includes(key)) { opts[key] = true; continue; }
    if (i + 1 >= args.length) fail(`--${key} needs a value`);
    opts[key] = args[++i];
  }
  return { pos, opts };
}
const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);

async function run(cmd: string | undefined, rest: string[]): Promise<string | undefined> {
  switch (cmd) {
    case 'list': return ops.list(ctx);
    case 'show': return ops.show(ctx, rest[0]);
    case 'check': {
      const r = await ops.check(ctx, rest[0], (line) => console.log(line));
      if (!r.ok) process.exit(1);
      return;
    }
    case 'about': {
      const { pos, opts } = flags(rest, ['description', 'notes', 'status', 'released', 'not-released']);
      if (!Object.keys(opts).length) return ops.show(ctx, pos[0]);
      return ops.setAbout(ctx, pos[0], {
        description: str(opts.description), notes: str(opts.notes), status: str(opts.status),
        released: opts['not-released'] ? false : str(opts.released),
      });
    }
    case 'ask': {
      const { pos, opts } = flags(rest, ['detail', 'project']);
      if (pos.length !== 1) fail('Usage: oberth ask "what the owner must do" [--detail D] [--project id|path]');
      return ops.ask(ctx, pos[0], str(opts.detail), str(opts.project));
    }
    case 'asks': return ops.asks(ctx, rest[0]);
    case 'done':
      if (!rest[0]) fail('Usage: oberth done <ask id>');
      return ops.done(ctx, rest[0]);
    case 'agenda': return ops.agenda(ctx);
    case 'search': {
      const { pos, opts } = flags(rest, ['project', 'kind']);
      if (pos.length !== 1) fail('Usage: oberth search "exact words" [--project id|path] [--kind code|docs|notes|ideas|sessions]');
      return ops.search(ctx, pos[0], { project: str(opts.project), kind: str(opts.kind) });
    }
    case 'idea': {
      const { pos, opts } = flags(rest, ['note', 'project', 'here']);
      if (pos.length !== 1) fail('Usage: oberth idea "title" [--note N] [--project id|path|oberth | --here], or oberth idea <idea id> --note N');
      if (ops.isIdeaId(pos[0]) && str(opts.note) && !opts.project && !opts.here) return ops.ideaNote(ctx, pos[0], str(opts.note)!);
      return ops.idea(ctx, pos[0], { note: str(opts.note), project: opts.here ? 'here' : str(opts.project) });
    }
    case 'ideas': {
      const { opts } = flags(rest, ['project', 'here']);
      return ops.ideas(ctx, opts.here ? 'here' : str(opts.project));
    }
    case 'recap': return ops.recap(ctx, rest[0]);
    case 'launch': {
      const { pos, opts } = flags(rest, ['open']);
      return ops.launch(ctx, pos[0], { open: opts.open === true });
    }
    case 'stop': return ops.stop(ctx, rest[0]);
    case 'output':
    case 'log': { // log: its name until 2026-11-13, kept so old habits and notes still work
      const { pos, opts } = flags(rest, ['lines']);
      return ops.output(ctx, pos[0], opts.lines ? Number(opts.lines) : undefined);
    }
    default: {
      const usage = readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 20).map((l) => l.slice(3)).join('\n');
      console.log(usage);
      process.exit(cmd ? 2 : 0);
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  const text = await run(cmd, rest);
  if (text) console.log(text);
} catch (e) {
  if (e instanceof ops.OberthError) fail(e.message, e.code);
  throw e;
}
