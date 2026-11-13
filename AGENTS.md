# AGENTS.md

Guidance for coding agents working in this repository. People start with `README.md`; to set Oberth up for someone, follow `CUSTOMIZE.md`.

**Oberth** is a local console for every project on one Mac: a Node service with a dashboard on `127.0.0.1:7777`, a menu bar app, a command-line client and an MCP server. It finds projects in the folders `config.json` names, starts and stops their dev servers, and keeps what the person wrote about each one, what is waiting for them, their ideas and a history of their work. `docs/architecture.md` explains how; `docs/configuration.md` lists the settings.

## Commands

- `npm test` runs every test (`node --test 'tests/**/*.test.ts'`). One file or test: `node --test --test-name-pattern="<name>" tests/<file>.test.ts`.
- `npm run typecheck` runs `tsc --noEmit`. There is no build step: Node 22.18+ runs the `.ts` files through type stripping.
- `npm start` runs the service in the foreground. An installed copy holds the port; stop it first (`launchctl bootout gui/$UID/local.oberth`) or use `OBERTH_STATE_DIR` with other ports.
- `npm run demo` runs a separate Oberth on port 7790 over made-up projects, with its own state folder. Use it to try changes and take screenshots without touching anyone's real projects.
- `bash scripts/install.sh` installs or reinstalls the launchd agent (`local.oberth`), the menu bar app (`~/Applications/Oberth.app`, bundle id `local.oberth.menu`) and the MCP registration for Claude Code. `bash scripts/uninstall.sh` removes them and keeps the state.
- After changes: under `service/`, restart with `launchctl kickstart -k gui/$UID/local.oberth`; in `dashboard/`, reload the page (files are served from disk); in `menubar/`, run `install.sh` (or `bash menubar/build.sh` to build only).
- `node scripts/oberth.ts <command>` is the CLI (`list`, `show`, `check`, `about`, `ask`, `asks`, `done`, `idea`, `ideas`, `agenda`, `search`, `recap`, `launch`, `stop`, `output`); `scripts/mcp.ts` is the same as MCP tools.
- `bash scripts/scrub-check.sh [folder]` looks for personal details (a private word list in the state folder, the home path, git's name and email, email addresses) before anything is published.
- Logs: `~/Library/Logs/oberth/service.log` and `<project id>.log`. State: `~/Library/Application Support/oberth/`.

## Map

| Area | Files |
|---|---|
| Wiring and config | `service/main.ts` (the only place real dependencies are built), `service/config.ts` |
| Projects | `service/discover.ts` (roots, two levels deep), `service/launchers.ts` (one module per stack), `service/commands.ts` (run plans) |
| Running | `service/runner.ts`, `service/readiness.ts`, `service/ports.ts`, `service/conflicts.ts`, `service/preflight.ts`, `service/scripts.ts` |
| HTTP | `service/server.ts` (API and pages), `service/auth.ts` (Host, Origin, token), `service/proxy.ts` (stable addresses) |
| What it remembers | `service/about.ts`, `service/agenda.ts`, `service/activity.ts`, `service/logbook.ts`, `service/week.ts`, `service/review.ts`, `service/recall.ts`, `service/ideas.ts`, `service/outside.ts`, `service/recap.ts` |
| Outside itself | `service/effects.ts`, `service/editors.ts`, `service/assistant.ts`, `service/claudesessions.ts`, `service/pricing.ts` |
| Facts and links | `service/facts.ts`, `service/live.ts`, `service/links.ts`, `service/gitinfo.ts`, `service/icons.ts` |
| Pages | `dashboard/app.js` (projects, drawer, Agenda), `dashboard/ideas.js`, `dashboard/logbook.js`, `dashboard/sidebar.html` (every page's sidebar), `dashboard/style.css` |
| Menu bar | `menubar/Oberth.swift` (single file, AppKit), `menubar/build.sh` |
| Clients | `scripts/client.ts` (every operation once), `scripts/oberth.ts` (CLI), `scripts/mcp.ts` + `scripts/mcpserver.ts` (MCP, no SDK) |
| Tests | `tests/*.test.ts`; `createApp(deps)` with fakes in `tests/server.test.ts` |

## Rules

- **Never write inside a project folder.** The only exceptions are the install step and a project's own tools when it is launched, and a started idea's new folder (created empty, then `git init`, after the person confirms). Git calls use `--no-optional-locks`.
- **The API never accepts a command, a path or a pid it didn't hand out.** Buttons send back keys from the current list; scripts run by name from the project's own `package.json`. Keep it that way in any new route.
- **Security**: every request must carry an own Host header; every POST and every route returning code, logs, prompts or session titles needs the token and an own or absent Origin. Routes without the token (`/api/projects`, `/api/activity`) leave session text out.
- **TypeScript is erasable only**: no enums, namespaces or parameter properties; imports use `.ts` extensions.
- **Spawned processes** get `BROWSER=/usr/bin/true`, `PYTHONUNBUFFERED=1` and `FORCE_COLOR=1` (`commands.ts`). Logs therefore have ANSI codes: strip them (`ansi.ts`) before parsing.
- **Private formats.** `claudesessions.ts`, `logbook.ts` and `agenda.ts` read the Claude desktop app's session files and Claude Code's transcripts. Anything unexpected must give nothing, never a crash or a wrong item; the Agenda's `health` reports what couldn't be read.
- **Optional parts stay optional.** The assistant's parts and the modules can each be absent. A feature whose part is missing hides; it never shows empty or errors. New features that read the assistant go through `Assistant` (`assistant.ts`), not `claudesessions.ts` directly.
- **Dashboard colours have one meaning each**: orange is Needs you only; green is live (running, up, passed, Released); blue is actions, selection and Oberth at work; red is failed; grey for facts that need nothing; muted yellow for uncommitted changes. Text pairs meet 4.5:1 contrast.
- **Menu bar**: it never blocks on the network (draws from the last data, refreshes in the background). An ⌥ or ⇧ alternate item must directly follow the item it replaces.
- **Docs move with the code.** When discovery rules, `.oberth.json` fields, `config.json` fields, About fields or the CLI and MCP tools change, update `docs/integrating-projects.md`, `docs/configuration.md`, `CUSTOMIZE.md`, the MCP server's instructions (`scripts/mcpserver.ts`) and `docs/agent-instructions.md` with it.
- **Tests**: add one next to each change. If a runner test fails mid-way, leftover fake servers can keep `node --test` alive: `pkill -9 -f fake-server.ts`. Compare `lsof` paths with `realpathSync`, since temp folders live under `/private/var`.
