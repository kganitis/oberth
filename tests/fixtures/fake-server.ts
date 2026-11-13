// Test stand-in for a dev server. Env:
//   BANNER   text printed once listening ('{port}' replaced); default 'Local: http://localhost:{port}/'
//   DELAY    ms before listening (default 0)
//   EXIT     exit immediately with this code
//   NOLISTEN print the banner with a dead port and never listen
//   PRE_SERVER  first start a second live server and print a bare 'api on http://127.0.0.1:<port>'
//   SILENT   listen but print nothing at all
//   PORT     listen on this port instead of a random one
//   HTML     answer with Content-Type text/html (default text/plain)
//   IGNORE_TERM  ignore SIGTERM
//   CHILD    spawn a long-lived child in the same group and print 'child <pid>'
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

if (process.env.IGNORE_TERM) process.on('SIGTERM', () => {});
if (process.env.EXIT) { console.error('boom'); process.exit(Number(process.env.EXIT)); }
const banner = process.env.BANNER ?? 'Local: http://localhost:{port}/';
if (process.env.CHILD) {
  const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  console.log(`child ${c.pid}`);
}
if (process.env.PRE_SERVER) {
  const pre = createServer((_q, r) => r.end('api')).listen(0, '127.0.0.1', () => {
    console.log(`api on http://127.0.0.1:${(pre.address() as { port: number }).port}`);
  });
}
if (process.env.NOLISTEN) { console.log(banner.replace('{port}', '1')); setInterval(() => {}, 1000); }
else setTimeout(() => {
  const s = createServer((_q, r) => { r.setHeader('Content-Type', process.env.HTML ? 'text/html' : 'text/plain'); r.end('ok'); }).listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
    const port = (s.address() as { port: number }).port;
    if (!process.env.SILENT) console.log(banner.replace('{port}', String(port)));
  });
}, Number(process.env.DELAY ?? 0));
