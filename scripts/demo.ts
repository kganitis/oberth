// A demo of Oberth with made-up projects, beside (never instead of) an installed Oberth.
//
//   npm run demo                       creates the demo and runs Oberth on http://127.0.0.1:7790/
//   npm run demo -- --assistant claude  the same with the Claude buttons (it reads no session outside the demo)
//   npm run demo -- --dir ~/oberth-demo --no-start
//
// It makes a folder of projects (a Node app, a static site, a Hugo site, a Python library, a group folder, a second
// root with a .oberth.json project), each its own git repository with a few weeks of commits, plus About notes, an
// ask and some ideas, and a config.json pointing at them under the demo's own state folder (OBERTH_STATE_DIR).
// Nothing outside that folder is written. Delete the folder to remove the demo.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i === -1 ? undefined : args[i + 1]; };
const dir = resolve(opt('dir') ?? join(tmpdir(), 'oberth-demo'));
const assistant = opt('assistant') === 'claude' ? 'claude' : 'none';
const port = Number(opt('port') ?? 7790);
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const now = Date.now();

// only ever replaces a folder this script made: a typo in --dir must never empty a real folder
const MARK = '.oberth-demo';
if (existsSync(dir)) {
  if (readdirSync(dir).length && !existsSync(join(dir, MARK))) {
    console.error(`${dir} exists and isn't a demo folder made by this script; choose another --dir`);
    process.exit(1);
  }
  rmSync(dir, { recursive: true, force: true });
}
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, MARK), 'made by scripts/demo.ts; delete the folder to remove the demo\n');
const write = (path: string, text: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
const svg = (fill: string, letter: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${fill}"/><text x="16" y="22" text-anchor="middle" font-family="Helvetica,sans-serif" font-weight="700" font-size="17" fill="#fff">${letter}</text></svg>`;
// a dev server that prints its address the way Vite does, on a free port
const nodeServer = (title: string) => `import { createServer } from 'node:http';
const page = '<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;padding:3rem"><h1>${title}</h1><p>A demo project served by its own dev server.</p>';
const s = createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end(page); });
s.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => console.log(\`\\n  ➜  Local:   http://localhost:\${s.address().port}/\\n\`));
`;

// ---------- the projects ----------
write('code/trail-journal/package.json', JSON.stringify({ name: 'trail-journal', private: true, type: 'module', scripts: { dev: 'node server.mjs', test: 'node -e "console.log(\'12 passed\')"' } }, null, 2));
write('code/trail-journal/server.mjs', nodeServer('Trail Journal'));
write('code/trail-journal/node_modules/.keep', '');
write('code/trail-journal/public/favicon.svg', svg('#127a57', 'T'));
write('code/recipe-box/index.html', '<!doctype html><link rel="icon" href="icon.svg"><title>Recipe Box</title><h1>Recipe Box</h1>');
write('code/recipe-box/icon.svg', svg('#d23a6e', 'R'));
write('code/field-notes/hugo.toml', 'title = "Field Notes"\n');
write('code/field-notes/layouts/index.html', '<h1>{{ .Site.Title }}</h1>');
write('code/tiny-stats/pyproject.toml', '[project]\nname = "tiny-stats"\nversion = "0.3.0"\n');
write('code/tiny-stats/tiny_stats/__init__.py', 'def mean(xs):\n    return sum(xs) / len(xs)\n');
write('code/games/space-dodge/index.html', '<!doctype html><title>Space Dodge</title><canvas id="c"></canvas>');
write('code/games/word-ladder/index.html', '<!doctype html><title>Word Ladder</title><h1>Word Ladder</h1>');
write('work/acme-portal/package.json', JSON.stringify({ name: 'acme-portal', private: true, type: 'module', scripts: { dev: 'node server.mjs' } }, null, 2));
write('work/acme-portal/server.mjs', nodeServer('Acme Portal'));
write('work/acme-portal/node_modules/.keep', '');
write('work/acme-portal/.oberth.json', JSON.stringify({ name: 'Acme Portal' }, null, 2));
write('work/api-sandbox/.oberth.json', JSON.stringify({ command: ['python3', '-m', 'http.server', '8123', '--bind', '127.0.0.1'], url: 'http://localhost:8123/' }, null, 2));
write('work/api-sandbox/README.md', '# API sandbox\nA scratch HTTP server.\n');

// each its own repository, with commits spread over the last weeks
const history: Record<string, [number, string][]> = {
  'code/trail-journal': [[20, 'first sketch of the trail list'], [9, 'add elevation chart'], [2, 'photos on each entry'], [0.2, 'fix the map on narrow screens']],
  'code/recipe-box': [[40, 'start the recipe box'], [18, 'shopping list from a recipe'], [6, 'print layout']],
  'code/field-notes': [[30, 'hugo site with a notes section'], [4, 'tags page']],
  'code/tiny-stats': [[60, 'mean and median'], [25, 'percentiles'], [12, 'release 0.3.0']],
  'code/games/space-dodge': [[15, 'ship moves, rocks fall'], [1, 'high score']],
  'code/games/word-ladder': [[50, 'word ladder prototype']],
  'work/acme-portal': [[10, 'login page'], [3, 'dashboard cards'], [0.5, 'wire up the reports API']],
  'work/api-sandbox': [[7, 'sandbox server']],
};
for (const [path, commits] of Object.entries(history)) {
  const cwd = join(dir, path);
  const git = (...a: string[]) => execFileSync('git', a, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'Demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'Demo', GIT_COMMITTER_EMAIL: 'demo@example.com' } });
  git('init', '-q', '-b', 'main');
  for (const [daysAgo, msg] of commits) {
    const when = new Date(now - daysAgo * DAY).toISOString();
    writeFileSync(join(cwd, '.demo-log'), `${msg}\n`, { flag: 'a' });
    git('add', '-A');
    execFileSync('git', ['commit', '-q', '-m', msg], { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'Demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'Demo', GIT_COMMITTER_EMAIL: 'demo@example.com', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  }
}
writeFileSync(join(dir, 'code/trail-journal/notes.txt'), 'route ideas for the coast\n'); // one uncommitted change

// ---------- the state: config, About, an ask, ideas ----------
const state = join(dir, '.state');
const json = (name: string, v: unknown) => { mkdirSync(state, { recursive: true }); writeFileSync(join(state, name), JSON.stringify(v, null, 2) + '\n'); };
json('config.json', {
  roots: [{ path: join(dir, 'code'), label: 'code' }, { path: join(dir, 'work'), label: 'work' }],
  port, proxyPort: port + 10, assistant, self: false,
  modules: { outside: false, backup: false },
  projects: { 'games__space-dodge': { name: 'Space Dodge' } },
});
const ago = (d: number) => now - d * DAY;
json('about.json', {
  'trail-journal': { description: 'A hiking journal: trails, photos and elevation.', status: 'active', notes: 'Map fixed on phones. Next: offline mode for photos.', updatedAt: ago(1) },
  'recipe-box': { description: 'Recipes and the shopping lists they make.', status: 'finished', released: true, releasedWhere: 'live at recipes.example.com', updatedAt: ago(6) },
  'field-notes': { description: 'Notes from reading, as a small Hugo site.', status: 'paused', notes: 'Tags page done. Was about to add search.', updatedAt: ago(4) },
  'tiny-stats': { description: 'Small statistics helpers for Python.', status: 'finished', released: true, releasedWhere: 'PyPI, tiny-stats 0.3.0', updatedAt: ago(12) },
  'games__space-dodge': { description: 'A one-button arcade game in a canvas.', status: 'active', updatedAt: ago(1) },
  'games__word-ladder': { description: 'Change one letter at a time.', status: 'idea', updatedAt: ago(50) },
  'work__acme-portal': { description: 'Client portal for Acme: login, dashboard, reports.', status: 'active', notes: 'Reports API wired up; charts next.', updatedAt: ago(0.4) },
});
json('agenda.json', { asks: [{ id: 'a1', projectId: 'work__acme-portal', text: 'Pick the brand colour for the login page', detail: 'Two options are in the Figma file.', createdAt: ago(1), updatedAt: ago(1) }], later: {} });
json('ideas.json', [
  { id: 'i001', title: 'A packing-list generator from the weather', notes: [{ at: ago(3), text: 'Use the forecast for the trail dates.', source: 'dashboard' }], state: 'open', createdAt: ago(3), updatedAt: ago(3) },
  { id: 'i002', title: 'Offline mode for photos', projectId: 'trail-journal', notes: [], state: 'open', createdAt: ago(2), updatedAt: ago(2) },
  { id: 'i003', title: 'Two-player mode', projectId: 'games__space-dodge', notes: [{ at: ago(1), text: 'Split screen, same keyboard.', source: 'menu' }], state: 'open', createdAt: ago(1), updatedAt: ago(1) },
]);

console.log(`demo projects in ${dir}\nstate folder ${state} (assistant: ${assistant})`);
if (args.includes('--no-start')) {
  console.log(`run it with: OBERTH_STATE_DIR="${state}" node service/main.ts`);
} else {
  console.log(`Oberth on http://127.0.0.1:${port}/ (Ctrl+C to stop)`);
  const child = spawn(process.execPath, [join(repo, 'service/main.ts')], { stdio: 'inherit', env: { ...process.env, OBERTH_STATE_DIR: state } });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
}
