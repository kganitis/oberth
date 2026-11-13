import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { makeTree } from './fixtures/tree.ts';
import { declaredDeps, distInfos, lockDrift, matchesPrefix, namedPort, parseRequirement, pnpmDrift, preflight, pyDrift, pyprojectDeps, readFacts, satisfies, yarnDrift, yarnEntries, type Facts } from '../service/preflight.ts';
import { buildPlan } from '../service/commands.ts';
import { discoverProjects } from '../service/discover.ts';
import type { Project, Starter } from '../service/types.ts';

const proj = (starter: Starter = { type: 'npm-dev', devScript: 'vite' }, extra: Partial<Project> = {}): Project =>
  ({ id: 'p', relPath: 'p', dir: '/Dev/p', name: 'P', kind: 'app', starter, scripts: {}, needsInstall: false, ...extra });
const facts = (extra: Partial<Facts> = {}): Facts => ({ drift: [], undeclared: [], ...extra });
const checks = (p: Project, f: Facts) => preflight(p, f).map((x) => x.check);

test('satisfies: the ranges package.json engines use', () => {
  const yes: [string, string][] = [
    ['22.20.0', '>=22.18'], ['22.20.0', '>= 22.18.0'], ['22.20.0', '^22.0.0'], ['22.20.0', '^22'], ['22.20.0', '22.x'], ['22.20.0', '22'],
    ['22.20.0', '*'], ['22.20.0', ''], ['22.20.0', '>=18 <23'], ['22.20.0', '^18 || ^20 || ^22'], ['22.20.0', '~22.20.0'], ['22.20.0', '20 - 22'],
    ['22.20.0', '<=22'], ['22.20.0', '>21'], ['0.3.5', '^0.3.1'],
  ];
  const no: [string, string][] = [
    ['22.20.0', '>=22.21'], ['22.20.0', '^20'], ['22.20.0', '<22'], ['22.20.0', '~22.19.0'], ['22.20.0', '>=18 <22'], ['22.20.0', '18 - 21'],
    ['22.20.0', '>22'], ['22.20.0', '<=21'], ['0.4.0', '^0.3.1'], ['22.20.0', '=22.19.0'],
  ];
  for (const [v, r] of yes) assert.equal(satisfies(v, r), true, `${v} in ${r}`);
  for (const [v, r] of no) assert.equal(satisfies(v, r), false, `${v} not in ${r}`);
});

test('satisfies: a range it cannot read is no answer, not a no', () => {
  assert.equal(satisfies('22.20.0', 'lts'), undefined);
  assert.equal(satisfies('22.20.0', '>=22 || node'), undefined);
});

test('matchesPrefix: .nvmrc matches by its leading parts, aliases are no answer', () => {
  assert.equal(matchesPrefix('22.20.0', '22'), true);
  assert.equal(matchesPrefix('22.20.0', 'v22.20'), true);
  assert.equal(matchesPrefix('22.20.0', '20'), false);
  assert.equal(matchesPrefix('22.20.0', '22.20.1'), false);
  assert.equal(matchesPrefix('22.20.0', 'lts/*'), undefined);
});

test('lockDrift: missing and moved packages, not optional platform builds', () => {
  const lock = { packages: {
    '': { name: 'p' },
    'node_modules/vite': { version: '5.2.0' },
    'node_modules/react': { version: '18.3.1' },
    'node_modules/a/node_modules/b': { version: '1.0.0' },
    'node_modules/@esbuild/linux-x64': { version: '0.20.0', optional: true },
  } };
  const installed = { packages: { 'node_modules/vite': { version: '5.1.0' }, 'node_modules/react': { version: '18.3.1' } } };
  assert.deepEqual(lockDrift(lock, installed), ['vite 5.1.0 → 5.2.0', 'b missing → 1.0.0']);
  assert.deepEqual(lockDrift(lock, lock), []);
  assert.deepEqual(lockDrift({ lockfileVersion: 1, dependencies: {} }, installed), [], 'an old lockfile is not judged');
});

test('declaredDeps: leaves out local specs', () => {
  assert.deepEqual(declaredDeps({ dependencies: { a: '^1', b: 'workspace:*' }, devDependencies: { c: 'file:../c', d: 'github:x/d' } }), ['a', 'd']);
});

test('namedPort: from the dev script or .oberth.json url', () => {
  assert.equal(namedPort(proj({ type: 'npm-dev', devScript: 'vite --port 5180' })), 5180);
  assert.equal(namedPort(proj({ type: 'npm-dev', devScript: 'vite --port=5181 --strictPort' })), 5181);
  assert.equal(namedPort(proj({ type: 'npm-dev', devScript: 'PORT=3001 node server.js' })), 3001);
  assert.equal(namedPort(proj({ type: 'npm-dev', devScript: 'next dev -p 3002' })), 3002);
  assert.equal(namedPort(proj({ type: 'npm-dev', devScript: 'vite' }, { url: 'http://localhost:4000/' })), 4000);
  assert.equal(namedPort(proj({ type: 'npm-dev', devScript: 'vite' })), undefined);
  assert.equal(namedPort(proj({ type: 'npm-dev', devScript: 'tsc -p tsconfig.json' })), undefined);
});

test('preflight: nothing to say about a healthy project, or a library', () => {
  assert.deepEqual(preflight(proj(), facts({ node: '22.20.0', nodeWant: { source: 'engines', value: '>=22.18' } })), []);
  assert.deepEqual(preflight(proj({ type: 'none' }, { kind: 'library' }), facts({ missing: { program: 'npm', relative: false } })), []);
});

test('preflight: a Node version the project does not accept', () => {
  const [f] = preflight(proj(), facts({ node: '20.11.0', nodeWant: { source: 'engines', value: '>=22.18' } }));
  assert.equal(f.check, 'node');
  assert.equal(f.short, 'needs Node >=22.18');
  assert.match(f.text, /launches with 20\.11\.0/);
  assert.deepEqual(checks(proj(), facts({ node: '22.20.0', nodeWant: { source: '.nvmrc', value: 'lts/*' } })), [], 'an alias is not judged');
  assert.deepEqual(checks(proj(), facts({ node: '22.20.0', nodeWant: { source: '.nvmrc', value: '20' } })), ['node']);
});

test('preflight: deps out of date, but not when needsInstall already covers it', () => {
  const f = facts({ drift: ['vite 5.1.0 → 5.2.0'], undeclared: ['zod'] });
  const [d] = preflight(proj(), f);
  assert.equal(d.short, 'deps out of date');
  assert.match(d.text, /vite 5\.1\.0 → 5\.2\.0/);
  assert.match(d.text, /lists zod/);
  assert.deepEqual(checks(proj(undefined, { needsInstall: true }), f), []);
});

test('preflight: a missing tool, a missing venv, a taken port', () => {
  assert.equal(preflight(proj({ type: 'hugo' }), facts({ missing: { program: 'hugo', relative: false } }))[0].short, 'hugo not found');
  const [venv] = preflight(proj({ type: 'override', argv: ['.venv/bin/python', 'app.py'] }), facts({ missing: { program: '.venv/bin/python', relative: true } }));
  assert.match(venv.text, /virtual environment/);
  const [port] = preflight(proj(), facts({ port: { port: 5180, holder: 'node (pid 42)' } }));
  assert.equal(port.short, 'port 5180 taken');
  assert.match(port.text, /node \(pid 42\)/);
});

test('readFacts: reads lockfiles, version files, the program and the port from a real folder', () => {
  const root = makeTree({
    'app/package.json': JSON.stringify({ scripts: { dev: 'vite --port 5180' }, dependencies: { vite: '^5', zod: '^3' }, engines: { node: '>=22.18' } }),
    'app/package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/vite': { version: '5.2.0' } } }),
    'app/node_modules/.package-lock.json': JSON.stringify({ packages: { 'node_modules/vite': { version: '5.1.0' } } }),
    'app/node_modules/vite/package.json': '{}',
    'app/.nvmrc': '22\n',
    'bin/npm': '#!/bin/sh\n',
  });
  chmodSync(join(root, 'bin/npm'), 0o755);
  const dir = join(root, 'app');
  const p = proj({ type: 'npm-dev', devScript: 'vite --port 5180' }, { dir });
  const other = proj({ type: 'npm-dev', devScript: 'vite' }, { id: 'o', name: 'Other', dir: join(root, 'other') });
  const env = { pathEnv: join(root, 'bin'), node: '22.20.0', listeners: [{ pid: 42, pgid: 42, port: 5180, cwd: '/elsewhere', command: 'node' }], projects: [p, other], managed: new Map<number, string>() };
  const f = readFacts(p, env);
  assert.deepEqual(f.drift, ['vite 5.1.0 → 5.2.0']);
  assert.deepEqual(f.undeclared, ['zod']);
  assert.deepEqual(f.nodeWant, { source: '.nvmrc', value: '22' }, '.nvmrc wins over engines');
  assert.equal(f.missing, undefined);
  assert.deepEqual(f.port, { port: 5180, holder: 'node (pid 42)' });

  // its own leftover on the port is no finding (the row shows it as a leftover); a missing npm is
  const own = readFacts(p, { ...env, pathEnv: '/nonexistent', listeners: [{ pid: 7, pgid: 7, port: 5180, cwd: dir }] });
  assert.equal(own.port, undefined);
  assert.deepEqual(own.missing, { program: 'npm', relative: false });
});

test('readFacts: a relative command must exist in the project', () => {
  const root = makeTree({ 'py/app.py': '' });
  const p = proj({ type: 'override', argv: ['.venv/bin/python', 'app.py'] }, { dir: join(root, 'py') });
  assert.deepEqual(readFacts(p, { pathEnv: '/usr/bin', listeners: [], projects: [p], managed: new Map() }).missing, { program: '.venv/bin/python', relative: true });
});

test('pnpm: the lockfile against the copy pnpm installed from', () => {
  assert.deepEqual(pnpmDrift('a: 1\n', 'a: 1\n'), []);
  assert.deepEqual(pnpmDrift('a: 2\n', 'a: 1\n'), ['pnpm-lock.yaml changed since the last install']);
  assert.deepEqual(pnpmDrift('a: 2\n', undefined), [], 'no record, no judgement');
});

const YARN = `# yarn lockfile v1

"@scope/x@^1.0.0", "@scope/x@^1.1.0":
  version "1.2.0"
  resolved "https://r/x-1.2.0.tgz#a"

react@^18.0.0:
  version "18.3.1"
  resolved "https://r/react-18.3.1.tgz#b"
`;

test('yarn 1: yarn.lock entries against .yarn-integrity; yarn 2+ is not judged', () => {
  assert.deepEqual([...yarnEntries(YARN)!.keys()], ['@scope/x@^1.0.0', '@scope/x@^1.1.0', 'react@^18.0.0']);
  const same = { lockfileEntries: Object.fromEntries(yarnEntries(YARN)!) };
  assert.deepEqual(yarnDrift(YARN, same), []);
  const old = { lockfileEntries: { '@scope/x@^1.0.0': 'https://r/x-1.1.0.tgz#c', 'react@^18.0.0': 'https://r/react-18.3.1.tgz#b' } };
  assert.deepEqual(yarnDrift(YARN, old), ['@scope/x not as yarn.lock says']);
  assert.equal(yarnEntries('__metadata:\n  version: 6\n'), undefined);
  assert.deepEqual(yarnDrift('__metadata:\n  version: 6\n', old), []);
});

test('package manager: from packageManager, else the lockfile; plans and the deps note use it', () => {
  const root = makeTree({
    'a/package.json': JSON.stringify({ scripts: { dev: 'vite' } }), 'a/pnpm-lock.yaml': '',
    'b/package.json': JSON.stringify({ scripts: { dev: 'vite' }, packageManager: 'yarn@4.1.0' }), 'b/package-lock.json': '{}', 'b/.pnp.cjs': '',
    'c/package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
  });
  const [a, b, c] = discoverProjects(root, {});
  assert.deepEqual([a.packageManager, b.packageManager, c.packageManager], ['pnpm', 'yarn', undefined]);
  assert.equal(b.needsInstall, false, "Plug'n'Play has no node_modules");
  const opts = { port: 1, lanIp: '10.0.0.2', pathEnv: '' };
  assert.deepEqual(buildPlan(a, 'local', opts)!.steps.map((x) => x.argv), [['pnpm', 'install'], ['pnpm', 'run', 'dev']]);
  assert.deepEqual(buildPlan(a, 'lan', opts)!.steps.at(-1)!.argv, ['pnpm', 'run', 'dev', '--host']);
  assert.deepEqual(buildPlan(c, 'lan', opts)!.steps.at(-1)!.argv, ['npm', 'run', 'dev', '--', '--host']);
  assert.match(preflight({ ...a, needsInstall: false }, facts({ drift: ['pnpm-lock.yaml changed since the last install'] }))[0].text, /Launch runs pnpm install first/);
  assert.deepEqual(preflight(a, facts({ missing: { program: 'pnpm', relative: false } })).map((f) => f.short), ['pnpm not found']);
});

test('python: requirement lines, pyproject dependencies, dist-info names', () => {
  assert.deepEqual(parseRequirement('Flask==3.0.2  # web'), { name: 'flask', pin: '3.0.2' });
  assert.deepEqual(parseRequirement('requests[socks]>=2.31'), { name: 'requests' });
  assert.deepEqual(parseRequirement('zope.interface'), { name: 'zope-interface' });
  for (const skip of ['-r base.txt', '-e .', '# note', '', 'tomli; python_version < "3.11"', 'pkg @ https://x/pkg.whl']) assert.equal(parseRequirement(skip), undefined, skip);
  assert.deepEqual(pyprojectDeps('[build-system]\nrequires = ["hatchling"]\n\n[project]\nname = "x"\ndependencies = [\n  "numpy>=1.26",\n  \'pandas\',\n]\n\n[tool.x]\ndependencies = ["no"]\n'), ['numpy>=1.26', 'pandas']);
  const installed = distInfos(['Flask-3.0.1.dist-info', 'zope.interface-6.2.dist-info', 'requests-2.31.0.dist-info', 'pip', '__pycache__']);
  assert.deepEqual([...installed], [['flask', '3.0.1'], ['zope-interface', '6.2'], ['requests', '2.31.0']]);
  assert.deepEqual(pyDrift(['Flask==3.0.2', 'requests>=2', 'zope.interface', 'rich'], installed), ['flask 3.0.1 → 3.0.2', 'rich']);
});

test('python: a launch from the project venv is checked against its requirements', () => {
  const root = makeTree({
    'py/requirements.txt': 'flask==3.0.2\nrich\n',
    'py/.venv/pyvenv.cfg': '',
    'py/.venv/bin/python': '#!/bin/sh\n',
    'py/.venv/lib/python3.12/site-packages/flask-3.0.2.dist-info/': '',
  });
  chmodSync(join(root, 'py/.venv/bin/python'), 0o755);
  const p = proj({ type: 'override', argv: ['.venv/bin/python', 'app.py'] }, { dir: join(root, 'py') });
  const env = { pathEnv: '/usr/bin', listeners: [], projects: [p], managed: new Map<number, string>() };
  const f = readFacts(p, env);
  assert.deepEqual(f.py, { venv: '.venv', file: 'requirements.txt', missing: ['rich'] });
  const [finding] = preflight(p, f);
  assert.equal(finding.check, 'pydeps');
  assert.match(finding.text, /rich, not installed in \.venv\. Install them: \.venv\/bin\/pip install -r requirements\.txt/);
  // a launch with the system python is not a venv launch
  assert.equal(readFacts(proj({ type: 'serve-py' }, { dir: join(root, 'py') }), env).py, undefined);
});
