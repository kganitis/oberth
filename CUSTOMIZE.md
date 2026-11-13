# Making Oberth yours

This guide is written for a coding agent working with a person who wants Oberth on their Mac. If you are the person, hand it to your agent: "Read CUSTOMIZE.md in this repository and set Oberth up for me, step by step."

**Agent, read this first.** Oberth is not a product with settings screens. It is a starting point that you adapt in code with your person's answers. Follow the steps in order. Until the install step, everything you write stays in this repository (tests also use the system's temporary folder): the setup is built and tried in a trial state folder, `.trial/` (ignored by git), on ports of its own, so nothing touches an Oberth that may already run. Ask before writing anywhere else, and before running `scripts/install.sh`. Never guess what your person wants where a step says to ask; when they have no opinion, take the default and say which. `AGENTS.md` maps the code; `docs/architecture.md` explains it. Everything below names the exact files to touch.

## 1. Decide whether it fits

Oberth suits someone with many side projects in one or a few folders who wants one place to start, stop and pick them back up. Check these with your person before going further:

- **macOS only.** It uses launchd, a native menu bar app, `lsof`, `ps` and `open`. Linux is possible but means real porting (see "Deep changes" at the end).
- **Node.js 22.18 or newer** (it runs TypeScript directly). `node --version` tells. With nvm, Oberth launches projects with nvm's default version.
- **Xcode Command Line Tools** for the menu bar app (`xcode-select --install`). Without them, everything but the menu bar app works.
- **Optional:** `rg` (ripgrep, `brew install ripgrep`) for search across projects; `gh` (logged in) for GitHub stars and issues on released projects; Claude Code and the Claude desktop app for the assistant features.
- **Projects live in folders it can scan**, at most two levels deep: `~/code/app` or `~/code/group/app`, not deeper.

If any of these rules it out, say so plainly and stop.

## 2. See it running unchanged

Before changing anything, prove the clone works on this Mac:

```bash
npm install
npm test
npm run typecheck
npm run demo
```

`npm run demo` creates made-up projects in a temporary folder (or the empty folder `--dir` names; it refuses one that has anything else in it) and runs Oberth on <http://127.0.0.1:7790/> with its own state folder, so nothing it does touches the person's files or a later install. Options: `--port <n>` if 7790 is taken (its stable addresses then use n+10), `--assistant claude` to show the Claude buttons (without it the demo runs with no assistant), `--no-start` to only create the projects. Run it in the background and stop it by its process id, or in a terminal the person controls (Ctrl+C stops it). Have your person open it and click around: launch Trail Journal, open the drawer, look at the Agenda, Ideas and the Logbook. This is also the moment to decide whether they want Oberth at all.

## 3. Interview your person

Ask these one or two at a time, in plain words, and write the answers down. Each answer maps to a config field or a recipe below.

| Ask | Becomes |
|---|---|
| Where are your projects? One folder or several? Anything in there to leave out? | `roots`, `exclude` (step 4). A name in `exclude` leaves out a folder of that name at the top of any root; a path leaves out exactly that folder. |
| How do you start your projects? (look in the folders together: `package.json` scripts, `go.mod`, `Gemfile`, `manage.py`, `docker-compose.yml`, `Cargo.toml`…) | Recipe A for each stack Oberth doesn't know |
| Which editor do you use? | `editor`, or Recipe B |
| Which browser should pages open in? | `browser` |
| Do you use an AI coding assistant? Which one? | `assistant`, or Recipe C |
| Where do your projects live online? (GitHub, GitLab, Codeberg, a company forge, npm, a docs site) | Recipe D for anything beyond GitHub, GitLab, Codeberg, Bitbucket, SourceHut, PyPI and live sites |
| Which parts do you want? Explain each in a sentence: the Agenda (what waits for you), the Logbook (where the time went), search across projects, Ideas, outside checks for released projects (GitHub and PyPI), stable `.localhost` addresses. Anything they don't mention stays at its default: all on. The backup module is off unless they have a backup script whose log it can read (`docs/configuration.md`). | `modules`, `backup` |
| Are ports 7777 and 7700 free? (`lsof -nP -iTCP:7777 -sTCP:LISTEN`, same for 7700.) If not, pick a free pair. | `port`, `proxyPort` |
| Any project whose login redirect is pinned to its own port (OAuth)? | `projects.<id>.openPort` |
| For each project, a one-line description and a status (active, paused, finished, idea). Offer to draft them from each README and commit history for the person to correct. | About (step 6) |

Leave `self` at its default unless the person will work on Oberth's own code and doesn't want that in their Logbook.

Then, with what you learned, go through the person's project folders with them once: anything Oberth won't detect gets a launcher (Recipe A) if the stack repeats, or a `.oberth.json` if it is a one-off (`docs/integrating-projects.md`).

## 4. Write config.json

Write the config into the trial state folder first, `.trial/config.json` in this repository, with the trial ports 7795 and 7805 (any free pair works). It moves to its real place at install. `docs/configuration.md` describes every field; `config.example.json` is a filled-in example. In paths, `~` means the person's home folder; absolute paths work too. A minimal one:

```json
{
  "roots": ["~/code", { "path": "~/work/clients", "label": "clients" }],
  "exclude": ["scratch"],
  "editor": "cursor",
  "browser": "Arc",
  "assistant": "none",
  "modules": { "outside": false },
  "port": 7795,
  "proxyPort": 7805
}
```

Check it before going on. This prints the roots, the projects found and any problem with the file:

```bash
export OBERTH_STATE_DIR="$PWD/.trial"
node --input-type=module -e "
const { config } = await import('./service/config.ts');
const { discoverProjects } = await import('./service/discover.ts');
console.log(config.problems.length ? config.problems : 'config.json: no problems');
for (const p of discoverProjects(config.roots, config.projects, config.exclude)) console.log(p.id.padEnd(30), p.kind.padEnd(8), p.starter.type);
"
```

Show the list to your person. Projects missing from it need a launcher or a `.oberth.json`; folders that shouldn't be there go in `exclude`. `library` means Oberth found a repository or a manifest but nothing to start: it is listed with its About, Git, editor and Finder, without a Launch button. Python packages, CLIs and coursework usually land here, which is right unless the project has a server to run.

Keep `OBERTH_STATE_DIR` set in the shell you use for the rest of the setup: the service, the CLI and the check snippet all read the trial folder through it.

## 5. Recipes

Each recipe says which files to change, what to copy, and what done looks like. After each one, run `npm test` and `npm run typecheck`.

### A. A stack Oberth doesn't know (a launcher)

Files: `service/launchers.ts`, `tests/launchers.test.ts`.

A launcher answers two questions: is this folder mine (`detect`), and how do I start it (`plan`). Copy the shape of `servePy` or `npmDev`. A Go server that reads its port from `PORT`:

```ts
/** A Go module with a main package at the top; listens on $PORT. */
export const goRun: Launcher = {
  type: 'go-run',
  looksFor: 'go.mod with a main.go',
  stack: 'Go',
  detect: (dir) => (existsSync(join(dir, 'go.mod')) && existsSync(join(dir, 'main.go')) ? { kind: 'app', starter: { type: 'go-run' } } : null),
  // the port Oberth picked goes in PORT; localUrl makes the runner probe that page instead of waiting for output
  plan: (_p, b) => (b.lan ? null : { ...b.base, env: { ...b.base.env, PORT: b.port }, localUrl: b.localUrl, steps: [{ argv: ['go', 'run', '.'] }] }),
  describe: () => 'go run .',
  program: () => 'go',
};
```

Add it to `LAUNCHERS`. Order matters, because the first match wins: put it before `staticSite`, or a Go project with an `index.html` becomes a static site. Then add a test next to the others:

```ts
test('go-run: go.mod and main.go; serves on the port Oberth picks', () => {
  assert.deepEqual(goRun.detect(makeTree({ 'go.mod': 'module x', 'main.go': '' }), null), { kind: 'app', starter: { type: 'go-run' } });
  assert.equal(goRun.detect(makeTree({ 'go.mod': 'module x' }), null), null);
  const plan = goRun.plan(project({ starter: { type: 'go-run' } }), base())!;
  assert.equal(plan.env.PORT, '4100');
  assert.deepEqual(plan.steps, [{ argv: ['go', 'run', '.'] }]);
});
```

Things to know while writing one:

- **Readiness.** The runner waits for a local URL in the output, preferring labelled lines like Vite's `Local:`. If the server prints none, set `localUrl` (as above) when Oberth chooses the port, or rely on the fallback, which after 5 seconds takes a port the project's processes listen on that serves HTML. A server that prints its URL needs neither.
- **Ports.** Pass `b.port` when the server takes a port (flag or environment). A server that always uses the same port works too, but two projects then can't run at once.
- **Phone mode** (`b.lan`) needs the server to listen on `0.0.0.0`. Return `null` for `lan` when it can't.
- **Rails**: detect a `Gemfile` together with `bin/rails` (or `config/application.rb`); plan `['bin/rails', 'server', '-p', b.port]`, adding `'-b', '0.0.0.0'` for phone mode, and set `localUrl` (Puma prints its address too, so either way works). `program()` returns `'bin/rails'`, a relative path the pre-flight check looks for in the project.
- **Django**: kind `app`, stack `'Django'`, placed before `staticSite`. Detect `manage.py`; plan `['.venv/bin/python', 'manage.py', 'runserver', b.port]` when `.venv/pyvenv.cfg` exists (that is what the pre-flight check recognises as the project's own environment, and it then checks `requirements.txt` against it), else `python3`. Set `localUrl`, since `runserver` prints a bare address. Phone mode passes `0.0.0.0:<port>` as the address, and the project's `ALLOWED_HOSTS` must include the Mac's LAN address, or Django refuses the phone. **Phoenix**: `mix.exs` with a `lib/*_web` folder; `['mix', 'phx.server']` with `PORT` in `env`.
- **Docker Compose**: `docker compose up` in the folder, with `localUrl` set to the published port read from the compose file, and no phone mode.
- **Installing dependencies.** Oberth installs npm-family dependencies itself because it can tell cheaply when they are missing or stale (`needsInstall`, the pre-flight check). For other stacks, leave installing to the person (`bundle install`, `pip install`) unless they ask; if they do, add the step first with `label: 'install'` and only when a cheap file check says it is needed (no `vendor/bundle`, no `.venv`).
- **Update what describes detection.** `looksFor` feeds the CLI's "no project here" message. Also add the stack to the table in `docs/integrating-projects.md` ("What Oberth finds by itself"), to the recognised stacks in `docs/agent-instructions.md` (or the person's agents will be told to write a `.oberth.json` for a stack Oberth now knows), and to the lists in `docs/architecture.md` and `README.md` if the person keeps those for themselves.

Done when the person's projects of that stack show with the right kind, Launch starts them, and the page opens. If the stack's tools aren't installed on this Mac, the pre-flight check says so on the row, and the plan and tests are as far as you can verify. When a launch fails, the end of its log (`oberth output <id>`) tells a launcher problem (a wrong command or argument, a page never found) from a project problem (the server exits with an error of its own).

### B. Another editor

File: `service/editors.ts`. An editor is an id, a label, how to open a folder and how to open a file at a line (search hits). Editors with a macOS app and a `<scheme>://file/<path>:<line>` handler, as VS Code's forks have, are one line with `appWithScheme`. JetBrains IDEs open a folder with `open -a "IntelliJ IDEA" <dir>` and a file at a line with their `idea` command-line launcher, if the person has installed it. Set `editor` in `config.json` to the new id. Built in: `vscode`, `cursor`, `windsurf`, `zed`, `sublime`, and `finder` for none.

Done when "Open in <editor>" opens the project and a search hit opens at its line.

### C. Assistants

**None.** Set `"assistant": "none"`. The assistant's buttons, chips, session time and session search disappear; the Logbook measures weeks in commits; starting an idea for a new project opens its folder in the editor instead of a session, and an idea for an existing project is marked done rather than started. Nothing else to do.

**Claude Code** is built in (`"assistant": "claude"`). It needs the Claude desktop app, since the buttons open sessions through `claude://` links and the session state comes from the app's files. Claude Code in a terminal alone gives the Logbook and search over transcripts, but no buttons.

**Another assistant.** Files: `service/assistant.ts`, `service/config.ts` (`ASSISTANTS`). Every part of an assistant is optional; write them in this order and stop when the person has what they want:

1. `open(dir)` and `openNew(dir, brief)`: the row's button, Resume, and starting an idea. For a terminal agent, open a terminal in the folder running the agent with the brief; for an editor-based one, open the editor with its chat. These are a few lines each.
2. `states(dirs)`: whether the assistant is working in each project, for the chip. Only if the assistant leaves something readable, such as session files or a lock file.
3. `lastPrompt(dir)`: the last thing the person asked there, for the "Where was I?" card.
4. `sessions`: the Agenda's waiting sessions, the Logbook's time and cost, search over transcripts. This is shaped after Claude Code's files (`claudesessions.ts`, `logbook.ts`'s `readTurns`); another assistant needs its own transcripts mapped onto that shape, which is real work. Skip it unless the person asks.

Add the id to `ASSISTANTS` in `config.ts` and the object to `ASSISTANT_IMPLS`. A sketch for a terminal agent:

```ts
const inTerminal = (dir: string, command: string) => {
  // AppleScript string: escape backslashes and quotes
  const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('/usr/bin/osascript', ['-e', `tell application "Terminal" to do script "cd ${q(JSON.stringify(dir))} && ${q(command)}"`]);
};
export const myAgent: Assistant = {
  id: 'my-agent', label: 'My Agent',
  open: (dir) => inTerminal(dir, 'my-agent'),
  openNew: (dir, brief) => inTerminal(dir, `my-agent ${JSON.stringify(brief)}`),
};
```

The menu bar shows the assistant's own logo only for Claude; others get a generic one. Set `bundleId` to the assistant's app, if it has one, so the menu bar holds back Agenda notifications while that app is in front.

**The MCP server for other agents.** `scripts/install.sh` registers Oberth's MCP server with Claude Code. Any other MCP client can use it as a stdio server: the command is the full path of `node` (`which node`), and the one argument is the full path of `scripts/mcp.ts` in this repository. Add it to the client's MCP configuration as its documentation describes.

### D. Links and forges

Files: `service/live.ts` (`FORGES`), `service/links.ts` (`LINK_SOURCES`), and the dashboard's copy of the forge names (`FORGE_NAMES` in `dashboard/app.js`).

- **A forge** where a repository's page is `https://<host>/<owner>/<repo>` (a company GitLab, Gitea, Forgejo): add the host to `FORGES` and to `FORGE_NAMES`. The repository button, its link in the menu bar and the About tab follow.
- **Another kind of link** (npm, crates.io, a docs site, a status page): add a `LinkSource` to `LINK_SOURCES`. `find(project, defaults)` gets the project and `config.json`'s `projects` map (its `defaults[project.id]` entry is that project's name, live URL and so on) and returns `{ label, url }` or nothing. Decide from files when you can (a `package.json` without `"private": true` is a reasonable sign of an npm package); a source that asks the network must cache its answer, as `pypiVersion` in `facts.ts` does once a day. Sources run when the About tab opens. Add a test in `tests/links.test.ts`.

To check: `GET /api/projects` gives each project's `repoUrl` (a forge in `FORGES` decides it, through `forgeUrl`), and `GET /api/projects/<id>/about` lists every link under `facts.links`.

Live sites need no code: a `CNAME` file, a GitHub Pages remote, `liveUrl` in `.oberth.json` or `projects.<id>.liveUrl` in `config.json` all work.

### E. The outside checks

File: `service/outside.ts`. This module watches released projects: GitHub (through `gh`), PyPI downloads and live sites. To add one (npm downloads, a GitLab project's issues), follow PyPI's path through the file: a fetch function like `readPypi`, a due time in `EVERY`, a step in `Outside.checkAll` that stores the result in `OutsideState`, a row in `factsOf` for the About tab, and, if it should reach the Agenda, an item in `outsideItems`. URLs the Agenda may open must pass `openable`. Tests are in `tests/outside.test.ts`, with fake fetchers.

### F. Names, ports and labels

- **Ports**: `port` and `proxyPort` in `config.json`. The menu bar app reads `port` from the same file.
- **The launchd label** defaults to `local.oberth`. To use your own (`com.yourname.oberth`), run `OBERTH_LABEL=com.yourname.oberth bash scripts/install.sh`, and put the same variable in your shell profile so the CLI's hints match.
- **The menu bar app's bundle id** is `local.oberth.menu`, in `menubar/Info.plist`.
- **Project icons**: a project's own favicon is found by itself (`public/favicon.svg`, `assets/favicon.ico`, an icon link in `index.html`…). For others, put `<project id>.svg` in the state folder's `icons/`. Otherwise a coloured letter is drawn.

### G. Turning parts off

`modules` in `config.json` turns off the Agenda, the Logbook, search, Ideas, the outside checks or the stable addresses; `docs/configuration.md` says what each removes. Turned-off parts start no timers and show no links. To remove one from the code entirely, start from where `main.ts` wires it and follow its imports; the tests for it go too.

## 6. Verify

Run all of this, and fix what fails before installing:

1. `npm test` and `npm run typecheck` pass.
2. Start the trial Oberth in the background, with the trial folder (its config has the trial ports), and keep its process id to stop it later:
   ```bash
   OBERTH_STATE_DIR="$PWD/.trial" node service/main.ts > .trial/service.out 2>&1 &
   echo $! > .trial/service.pid
   ```
   Its messages, config problems included, go to `.trial/service.out`. With an assistant configured, the trial reads that assistant's real session files (read only), so the person's sessions in these projects show up as they will after install. The dashboard is on the trial port; have the person open it if they like (launching from the dashboard opens the browser; the CLI below doesn't).
3. Write the About for each project from the interview: `node scripts/oberth.ts about <id> --description "…" --status active`.
4. `node scripts/oberth.ts check <id>` on two projects of different stacks: it launches without a browser, waits for the page, checks it answers and stops it. Exit code 0 means it works; 1 lists problems (a project with no About yet gets exit 1 even when the page served, which step 3 avoids; "exited with code …" before a page means the server quit, see its log with `oberth output <id>`); 2 means the project or the service wasn't found. `node scripts/oberth.ts launch <id>` and `stop <id>` leave a server running in between, if the person wants to see it.
5. With an assistant: its button opens a session in the project.
6. Stop the trial: `kill $(cat .trial/service.pid)`.

## 7. Install

With your person's go-ahead, move the trial's config and About notes to the real state folder, set the real ports (or remove both fields for the defaults), and install:

```bash
mkdir -p ~/Library/Application\ Support/oberth
cp .trial/config.json .trial/about.json ~/Library/Application\ Support/oberth/
# edit ~/Library/Application Support/oberth/config.json: port and proxyPort back to the real ones, or remove them
unset OBERTH_STATE_DIR
bash scripts/install.sh
```

The rest of `.trial/` (its token, settings, logs and the trial's history) stays behind; delete the folder once the installed Oberth works.

It installs a launchd agent that runs the service at login, builds the menu bar app into `~/Applications/Oberth.app` with a login item, and registers the MCP server with Claude Code if it is installed. macOS asks once whether the app may send notifications. Run it again after any change to the service or the menu bar app; dashboard changes only need a browser reload. `bash scripts/uninstall.sh` removes it all and keeps the state folder.

After a change under `service/`, restart only the service: `launchctl kickstart -k gui/$UID/local.oberth`.

## 8. Teach the person's agents

Oberth stays accurate when the agents working in the projects keep it so. `docs/agent-instructions.md` is a block to put in the instruction file those agents read (for Claude Code, a `CLAUDE.md` in the folder above the projects). Fill in the paths, adjust it with your person, and tell them what it does. It is for any coding agent, not only the assistant Oberth integrates with; a person who uses none can skip this step.

## 9. Later: keeping up with upstream

The person's copy is theirs, and upstream promises no compatibility. To bring in later changes, add this repository as a remote (`git remote add upstream <url>`), fetch, and merge or cherry-pick what they want, resolving conflicts in the files your recipes touched. Run the tests after.

## Deep changes

Not tested upstream, but here is where to start:

- **Linux.** The service mostly runs: replace launchd with a systemd user unit (`scripts/install.sh`), `open` with `xdg-open` (`effects.ts`, `editors.ts`, `assistant.ts`), `lsof` with `ss -ltnp` in `ports.ts` and `procinfo.ts`, and the `ps` calls in `claudesessions.ts`. The menu bar app is AppKit; replace it with a tray app or go without one. `.localhost` names resolve to the machine on most modern Linux setups; check yours.
- **More than two levels deep.** `discoverProjects` in `discover.ts` tries a folder, then its children. A deeper walk is a loop there, plus ids, which already use the whole relative path.
- **Another state store.** Every file in the state folder is read and written by one module (`about.ts`, `ideas.ts`, `agenda.ts`, `activity.ts`, `settings.ts`…). Each is small; replace them one at a time.
