# Architecture

Oberth is a Node service, a dashboard it serves, a macOS menu bar app, and a command-line client and MCP server that talk to the service. Everything runs on your Mac; nothing listens beyond `127.0.0.1`.

```
                 ┌──────────── service/ (Node 22, TypeScript run directly) ────────────┐
 dashboard/  ───▶│ server.ts: the JSON API, the pages, the token and Host checks        │
 menubar/    ───▶│   ├─ discover.ts + launchers.ts   which folders are projects, how they run
 scripts/    ───▶│   ├─ runner.ts + readiness.ts     process groups, logs, "is it serving yet"
 (CLI, MCP)      │   ├─ proxy.ts                     http://<name>.localhost:7700
                 │   ├─ agenda.ts, logbook.ts, recall.ts, ideas.ts, outside.ts, review.ts
                 │   └─ assistant.ts, editors.ts, effects.ts   what it opens on your behalf
                 └── state: ~/Library/Application Support/oberth (config.json, about.json, …)
```

`service/main.ts` is the only place real dependencies are wired: it reads `config.json` (`config.ts`), picks the assistant and editor, and hands the parts what they need. Everything else takes its dependencies as arguments, which is how the tests build the same `createApp(deps)` with fakes. Shared types are in `service/types.ts`.

There is no build step. Node 22.18 or newer runs the `.ts` files directly through type stripping, so the TypeScript must be erasable: no enums, namespaces or parameter properties, and imports use `.ts` extensions. `npm run typecheck` runs `tsc --noEmit`.

## From a folder to a running server

**Discovery** (`discover.ts`) scans each root two levels deep and returns `Project[]`. It never looks inside a folder that is already a project, and it skips hidden folders, `node_modules`, `dist`, `build`, the excluded folders, Oberth's own folder and any folder that is itself a root. A folder's `.oberth.json` can name it, give it a command, a page URL, a live URL, a stable-address name, or leave it out. Ids are described in `docs/configuration.md`.

**Launchers** (`launchers.ts`) decide what a folder is. Discovery tries `LAUNCHERS` in order (a `dev` script in `package.json`, a Hugo site, `serve.py`, `index.html`), and the first whose `detect()` answers wins. A folder no launcher claims but that is its own git repository or has a `package.json` or `pyproject.toml` becomes a `library`: shown everywhere, never launched. A launcher also gives the run plan for a mode (`local`, or `lan` for phone mode), how the Info tab names its command, which program the pre-flight check looks for, and where a port it asks for can be read.

**Plans** (`commands.ts`) wrap the launcher's plan with what every launch shares: an install step when `node_modules` is missing or out of date, the environment, and the window-app case (Electron runs its own window and never gets a page). The package manager comes from `packageManager` in `package.json` or the lockfile (npm, pnpm, yarn or bun).

**The runner** (`runner.ts`) spawns each plan in its own process group, writes its log to `~/Library/Logs/oberth/<id>.log`, and decides readiness through `readiness.ts`. Spawned processes get `BROWSER=/usr/bin/true` (so Vite and Python don't open their own tabs), `PYTHONUNBUFFERED=1` (without it a banner never arrives through a pipe) and `FORCE_COLOR=1` (colours in the dashboard's output). Logs therefore contain ANSI codes, and anything that parses them strips those first.

### Readiness

The runner watches the last step's output for a page URL. Labelled URLs count first, such as Vite's `Local:` line and Hugo's `available at`. A bare URL waits a moment for a labelled one, since some servers print an API address before the page. Only local hosts count. Plans whose port Oberth chooses (Hugo, `serve.py`, static sites) carry `localUrl` and are probed directly. If nothing usable is printed within 5 seconds, the runner looks up the ports its own process group listens on and takes the one serving HTML. Window apps become `running` after a grace period.

### Process lifecycle

Each run is a detached process group. `terminate()` sends SIGTERM, waits up to 5 seconds, then sends SIGKILL to the group once and marks it swept, so a reused group id is never signalled. `stopping` is a real status, and launches during it are ignored. Opening the page happens once per launch, through `pendingOpen` in `server.ts` and the runner's `onReady`.

### Leftover servers and port conflicts

`ports.ts` maps `lsof` listeners to projects by working directory, leaving out Oberth's own process groups. Only listeners that answer `GET /` below 400 count, so debugger ports and raw TCP are ignored. A dev server you started in a terminal shows as "not started by Oberth", and Open goes to it instead of launching a second copy. When a launch fails on a taken port, `conflicts.ts` names the holder, and the dashboard offers to stop it and retry, but only when the holder is a project, never an unrelated process.

### Pre-flight

`preflight.ts` says, before a launch, what would make it fail: dependencies that don't match the lockfile (by content, not timestamps), a Node version that `.nvmrc`, `.node-version` or `engines.node` rules out, a program the launch needs that isn't on its PATH, Python packages missing from the project's own virtual environment, and a port the project names that something else holds. Findings show grey on the row and in full on the Info tab. Launches are never blocked by them; an out-of-date dependency only makes Launch install first.

### Stable addresses

`proxy.ts` gives every project with a page `http://<name>.localhost:7700/`, forwarded to whatever port its dev server took. macOS resolves every `.localhost` name to this Mac, so nothing needs installing. The name comes from the folder (`games/arcade` → `arcade.games`) or `.oberth.json`'s `host`, and colliding names get the whole id instead. The proxy accepts only exactly `<known name>.localhost:<port>` (a DNS-rebinding guard), targets only the run Oberth launched or the project's leftover server, never a port from a request, and passes WebSocket upgrades through, so hot reload works. A stopped project gets a page linking to the dashboard, never a launch, since any web page can load the address.

## What Oberth keeps about your projects

**About** (`about.ts`): your description, status (`active`, `paused`, `finished`, `idea`), Released mark and notes per project, in `about.json`. `facts.ts` reads what the project itself says (stack, deploy target, history) and, once a day, whether its GitHub repo is public and its PyPI version, as hints for the Released mark, which only you set. `links.ts` lists where the project lives outside your Mac.

**The Agenda** (`agenda.ts`) lists what is waiting for you, on two levels: Needs you (counted, can notify) and Worth a look. `Agenda.view` reads its sources and the pure `buildAgenda` builds the list on each request, so items are never stored; only asks and Later are, in `agenda.json`. Sources are the assistant's sessions (a session blocked on a question, an unanswered tool call), asks left by agents, git (unpushed or long-uncommitted work), notes older than the latest work, the outside world, the weekly review, and the optional backup log. `health` says when a source couldn't be read, so a changed format never just looks like a clean list. Buttons send back only an item's key; what they do comes from the list, never from the request.

**The Logbook** (`activity.ts`, `logbook.ts`, `week.ts`) is the permanent history, one `activity/<day>.jsonl` per local day. Launches and script results go in as they happen. Every minute, `logbook.ts` adds commits on any local branch from the last 90 days (git runs only when the reflog changed) and, with an assistant, one event per prompt with its active time (gaps over 5 minutes left out) and its token usage at API prices (`pricing.ts`). `/logbook` shows a week. A paused project's About tab opens with a "Where was I?" card (`recap.ts`): the last prompt, what is uncommitted, unpushed or stashed, recent sessions and commits.

**Weekly review** (`review.ts`): last week read back on the Logbook page: where the time went, active projects untouched for 21 days (with a one-click Pause), Released projects that changed, and outside numbers. The Agenda points to it until the page has shown it.

**Recall** (`recall.ts`) searches code, docs, About notes, ideas and what was said in assistant sessions by running ripgrep when asked, with no index; it took well under a second over many gigabytes when measured. The query is always a literal. Only listed projects are searched, so an excluded folder never shows. Transcripts are searched in two passes (which files match, then the newest matches read in batches) because most hits are tool output, which `spokenMatch` drops. It needs `rg` from Homebrew.

**Ideas** (`ideas.ts`) is your notebook, in `ideas.json`. An idea is for a new project (no project id) or for an existing one, with dated notes and where each came from (CLI, MCP, menu bar, dashboard). Starting one happens only in the dashboard: for an existing project it opens a new assistant session with the brief typed in; for a new project it creates `<root>[/group]/<folder>` from two checked names, runs `git init` there and nothing else, writes the About, and opens a session (or your editor, without an assistant). Ideas never reach the Agenda.

**The outside world** (`outside.ts`) looks at projects you marked Released: GitHub stars, forks and issues or pull requests from others that wait for you (through your logged-in `gh`, every 30 minutes), PyPI downloads (daily) and whether the live site answers (every 10 minutes, down after two failures). Results are kept in `outside.json`, so a restart doesn't forget a site that was down.

## The assistant, the editor and the browser

`effects.ts` is everything Oberth does outside itself: open a page, a folder in the editor, Finder, an assistant session. The server only calls these, so tests pass fakes. `main.ts` builds the real ones from `config.json`: the browser by app name, an editor from `editors.ts`, and an assistant from `assistant.ts`.

An assistant is one object whose parts are all optional: `states` (the chip and button on each row), `open` and `openSession`, `openNew` (Resume, starting an idea), `lastPrompt`, and `sessions` (the Agenda's waiting sessions, the Logbook's time and cost, Recall over transcripts). A feature whose part is missing hides instead of showing empty, and `none` has no parts at all. The pages and the menu bar learn what exists from `GET /api/config`.

The Claude implementation reads private formats: the Claude desktop app's session files under `~/Library/Application Support/Claude/claude-code-sessions/`, its turn summaries, and Claude Code's transcripts under `~/.claude/projects/`. Any app update can change them. Everything that reads them treats the unexpected as "nothing there", so a format change costs items, never a crash, and the Agenda's health note says so. Whether a session is working comes from two `ps` calls: processes whose executable is Claude Code's binary, then `CLAUDE_CODE_HOST_SESSION_ID` from only those processes' environments.

## The pages

The dashboard (`dashboard/app.js`, no build step) shows project rows grouped by kind or status and sorted six ways, with a detail drawer (About, Output, Git, Scripts, Info). The Output tab polls the log from a byte offset and renders ANSI colours. Launch and Stop show their new state at once until the request returns. `/#agenda` and `/#ideas` (`ideas.js`) are views of the same page; `/logbook` and `/about` are their own pages. Every page's sidebar comes from `dashboard/sidebar.html`, which the service puts in place with the current link marked and the counts filled in.

Colours have one meaning each: orange is Needs you only, green is live (running, up, passed, Released), blue is actions, selection and Oberth at work, red is failed. Facts that need nothing (Paused, Finished, unpushed) are grey, and uncommitted changes a muted yellow. Text pairs meet 4.5:1 contrast.

## The menu bar app

`menubar/Oberth.swift` is a single-file AppKit app built with the Command Line Tools' `swiftc` (`menubar/build.sh`). It never blocks on the network: it draws from the last fetched data and refreshes every 5 seconds, redrawing an open menu only when something changed. Its title is the logo mark as a template image; when the status lamp is lit (orange for Needs you, else green for running) it draws the dot itself, since a template image can't hold colour. It notifies about crashes, failed launches while you're elsewhere, long scripts finishing and new Needs you items, but not about the Agenda while the assistant's app is in front.

## The command line and the MCP server

`scripts/client.ts` holds every operation once, returning text. `scripts/oberth.ts` is the CLI on top of it and `scripts/mcp.ts` (protocol in `scripts/mcpserver.ts`, written by hand with no SDK) the MCP server. Both go through the HTTP API with the token, so the API's rules hold for them too. `check` and `launch` launch without opening a browser and wait up to 3 minutes. The MCP server runs in the agent session's folder, which is how a tool with no project argument finds its project, and its instructions are written from your config.

## Security

Oberth assumes one trusted person on one Mac, and defends against web pages and other local processes.

- The service and the proxy listen on `127.0.0.1` only.
- Every request must carry Host `127.0.0.1:<port>` or `localhost:<port>`, which stops DNS rebinding.
- Every POST, and every route that returns code, logs, prompts or session titles, needs the `X-Oberth-Token` header, plus an own or absent Origin. The token is a random 32-byte secret in the state folder with owner-only permissions. The dashboard gets it from a meta tag in the page the service serves; the CLI, MCP server and menu bar read the file.
- The API never accepts a command, a path or a process id it didn't hand out. Scripts run by name from the project's own `package.json`; stopping a leftover takes a pid from the current list; Agenda, Recall and idea buttons send back a key from a recent answer.
- Oberth never writes inside a project folder, with three exceptions: the side effects of the install step and the project's own tools, and a started idea's new, empty folder. Git calls use `--no-optional-locks`, so Oberth never takes your `index.lock`.

## Tests

`npm test` runs every test with Node's built-in runner; `node --test --test-name-pattern="<name>" tests/<file>.test.ts` runs one. Most tests are pure functions over hand-built inputs; `tests/server.test.ts` drives the whole API against fakes and a small real server (`tests/fixtures/fake-server.ts`). If a runner test fails mid-way, leftover fake servers can keep `node --test` alive: `pkill -9 -f fake-server.ts`.
