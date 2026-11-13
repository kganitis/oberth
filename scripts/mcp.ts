// Oberth's MCP server over stdio, one JSON-RPC message per line. Claude Code starts it per session:
//   claude mcp add --scope user oberth -- node ~/Dev/oberth/scripts/mcp.ts   (scripts/install.sh does this)
// It runs in the session's folder, which is how a tool without a project argument knows the project.
// stdout carries only protocol messages; anything else goes to stderr.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { httpApi } from './client.ts';
import { createMcp } from './mcpserver.ts';

const version = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '0'; } catch { return '0'; } })();
const send = (msg: unknown) => { process.stdout.write(`${JSON.stringify(msg)}\n`); };
const handle = createMcp({ api: httpApi(), cwd: process.cwd(), sessionId: process.env.CLAUDE_CODE_HOST_SESSION_ID, source: 'mcp' }, version, send);

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  if (!line.trim()) return;
  let msg: any;
  try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  // requests run side by side, so a 3-minute launch doesn't hold up a ping
  const batch = Array.isArray(msg);
  Promise.all((batch ? msg : [msg]).map((m: any) => handle(m))).then((outs) => {
    const answers = outs.filter(Boolean);
    if (answers.length) send(batch ? answers : answers[0]);
  }, (e) => process.stderr.write(`oberth mcp: ${e?.stack ?? e}\n`));
}).on('close', () => process.exit(0));
