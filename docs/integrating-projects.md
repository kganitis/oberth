# Integrating a project with Oberth

For agent sessions (Claude Code or any other) working in a project under one of Oberth's roots. The instructions you give your agents (see `docs/agent-instructions.md` for a template) say when to do this; this file says how.

## The tools

Every Claude Code session has Oberth's MCP server (`oberth`, registered by `scripts/install.sh`; other MCP clients can add it too, see `CUSTOMIZE.md`), whose tools match the commands below: `projects`, `project`, `check`, `set_about`, `ask`, `asks`, `close_ask`, `idea`, `ideas`, `agenda`, `search`, `recap`, plus `launch`, `stop` and `output` to start a project's dev server, read its log and stop it. Use the tools when they are there; the command line does the same from any shell.

`oberth` below means `node <oberth>/scripts/oberth.ts`, where `<oberth>` is the folder you cloned Oberth into (an alias in your shell profile saves typing). Both talk to the running service, take a project id or a path, and default to the current folder (for the tools, the session's folder).

- `oberth list`: every project with its kind, run state, and About status.
- `oberth show`: what Oberth knows about this project: kind, the command it starts, live site, stack, About.
- `oberth check`: launches the project without opening a browser, waits for a page (up to 3 minutes, an install included), checks that the page answers, stops it again, and reports missing About fields. Before launching it prints Oberth's pre-flight findings, if any: dependencies out of date with the lockfile (Launch installs those first), Python packages a `.venv` launch needs that aren't in that venv, a Node version that `.nvmrc`, `.node-version` or `engines.node` rules out, a program the launch needs that isn't there (`hugo`, `python3`, a `.venv/bin/…` named in `.oberth.json`), or a port the project names (`--port`, `-p`, `PORT=`, `url`) already held by something else. `oberth show` lists them too. Exit code 0 means integrated correctly, 1 means problems were listed, 2 means the project couldn't be found or the service is down.
- `oberth about --description … --status … --notes … [--released WHERE | --not-released]`: changes only the fields given.
- `oberth ask "…" [--detail …] [--project id|path]`: leaves something for the owner on the Agenda (see below).
- `oberth asks`: this project's open asks, with their ids.
- `oberth done <id>`: closes an ask.
- `oberth idea "…" [--note …] [--project id|path|oberth | --here]`, `oberth idea <id> --note …`, `oberth ideas [--project … | --here]`: the owner's Ideas notebook (see below).
- `oberth agenda`: everything waiting for the owner, across all projects.
- `oberth search "exact words" [--project id|path] [--kind code|docs|notes|sessions]`: finds them in every project's code, docs and About notes, and in what was said in assistant sessions. Sessions come with their transcript's path. Use it for "where did we solve this before?".
- `oberth recap`: where the project was left: its notes, the owner's last prompt there, what is uncommitted, unpushed or stashed, recent sessions and commits.
- `oberth launch [--open]`: starts the dev server the way the dashboard does and waits until it serves a page (up to 3 minutes), then gives its URL, or why it failed with the end of its log. The browser opens only with `--open`.
- `oberth output [--lines N]` (`oberth log` still works): the dev server's state, the errors Oberth counted since launch, and the end of its output.
- `oberth stop`: stops a dev server Oberth started. One started outside Oberth is left alone.

## What Oberth finds by itself

It scans each root in `config.json` two levels deep (so `<root>/x` and `<root>/group/x`, never deeper) and skips hidden folders, the folders `exclude` names, and Oberth's own folder. A folder becomes, in this order (the order of `LAUNCHERS` in `service/launchers.ts`):

| Found | Kind | Started with |
|---|---|---|
| `package.json` with a `dev` script (Electron in its dependencies makes it a window app) | app or window | `npm run dev`, after `npm install` if `node_modules` is missing or out of date; pnpm, yarn or bun instead when `packageManager` in `package.json` or the lockfile says so |
| a Hugo config | site | `hugo server` on a port it picks |
| `serve.py` | site | `python3 serve.py <port>` on a port it picks |
| `index.html` | site | a static file server on a port it picks |
| a git repo, `package.json` or `pyproject.toml` with none of the above | library | nothing: shown with About, Git, the editor and Finder, never launched |

It decides a server is ready when the output prints a local URL (Vite's `Local:` line and Hugo's `available at` win over a bare URL). If nothing usable is printed within 5 seconds, it takes the port that the project's own processes listen on and that serves HTML. Window apps count as running after a short grace period.

## When detection doesn't fit: `.oberth.json`

A file in the project root, read on every scan. Any field may be left out.

```json
{
  "name": "Display name",
  "kind": "app",
  "command": ["cargo", "run", "--", "--port", "4000"],
  "url": "http://localhost:4000/",
  "liveUrl": "https://example.com/",
  "host": "my-name"
}
```

- `command`: the argv that starts the dev server, run in the project folder. It is spawned directly, not through a shell, so a pipeline or `cd` needs `["bash", "-c", "…"]`. Several steps (build, then serve) also go through `bash -c`.
- `kind`: `app` (a dev server with a page), `site` (a static or generated site), or `window` (a desktop app with no page). With a `command` and no `kind`, it is an `app`.
- `url`: the local page to wait for and open, when the output doesn't print one (local `http` only).
- `liveUrl`: where it is deployed; wins over Oberth's own guesses.
- `host`: the name in the project's stable address, `http://<host>.localhost:7700/` (lower-case letters, digits and dashes, labels separated by dots). Without it the name comes from the folder: `my-app`, `arcade.games` for `games/arcade`.
- `"ignore": true`: leave this folder out of Oberth.
- Phone mode isn't available for a custom `command`.

Before creating it, tell the owner. In a repo that is or may become public, keep it out of git history by adding `.oberth.json` to `.git/info/exclude` (the repo's local ignore list) rather than committing it or touching `.gitignore`, unless the owner says otherwise.

## Stable addresses

While Oberth runs, every project with a page answers at `http://<name>.localhost:7700/` as well as on its dev server's own port, through a proxy in the Oberth service (on this Mac only; the port is `proxyPort` in `config.json`). `launch` and `show` give both. Oberth opens the stable address in the browser, and Hugo's links and live reload use it. Vite's hot reload works through it too.

What can break behind a different address, and what to do:
- **A login redirect pinned to a port** (an OAuth `redirect_uri` such as `http://127.0.0.1:5173/callback`): the login starts on one address and returns to another, so it fails. Set `"openPort": true` for that project under `projects` in `config.json`, and Oberth opens it on its own port instead.
- **A server that rejects the `Host` header**: add the stable name to its allowed hosts (Vite allows `.localhost` names by default).
- **Absolute links built from a fixed `localhost:<port>`** still work, they just leave the stable address.

## When Oberth itself should change

`.oberth.json` covers one project. If the new stack is likely to come back (a second Go server, a new site generator), the better fix is a launcher in Oberth (`service/launchers.ts`, with a test; `CUSTOMIZE.md` has the recipe). If your setup keeps Oberth's code to sessions in Oberth's own folder, propose such a session with a short brief (the stack, how it starts, what it prints when ready, which project needs it), and use `.oberth.json` in the meantime.

## About: what each project says about itself

Kept in Oberth's state, never in the project. Limits: description 200 characters, notes 4000, Released "where" 80.

- `description`: one line on what it is.
- `status`: `active` (being built or worked on now), `paused` (not worked on for now), `finished` (does what it was built for and works fully; polish and extras may still come and go in the notes), `idea` (not started yet).
- `notes`: where it was left and what is next, in plain sentences.
- Released (`--released "PyPI, name 1.2.0"` or `"live at example.com"`): out where anyone can use it. Separate from the status; set it only when the owner says it is released.

Write them like the existing entries (`oberth list`, `oberth show <id>`): plain, short, no marketing.

## Asks: leaving something for the owner

Use `oberth ask` when work can't continue without the owner and the need will outlive this conversation: a review, a decision, something only they can do. It shows under Needs you on the dashboard and in the menu bar, and can notify them. A question you can ask in the chat stays in the chat, and so does anything you can finish yourself.

- Say what to do, in one line: `oberth ask "Review the imported matches game by game" --detail "The comparison is in data/compare.html"`. Limits: text 200 characters, detail 1000, 10 open asks per project.
- The same text in the same project updates the open ask instead of adding another.
- The session asking is recorded, so the owner's button opens it. Without one, it opens the project's newest session.
- Close your ask with `oberth done <id>` once it no longer applies. The owner can also press Done. An ask left open for 14 days drops to Worth a look.
- A session started in a root itself or a group folder has no project of its own: pass `--project`.

## Ideas: the owner's notebook

When the owner says something is an idea for later ("that's one for later", "put it in Ideas", "idea for my-app: …"), file it with `oberth idea` (or the `idea` tool). Only on their words: an idea you have yourself goes in your reply, not in Ideas.

- For an existing project, pass `--project <id>` (or `--here` for the project you're in; `oberth` for Oberth itself). Without one, it's an idea for a new project, before any folder exists.
- The first `--note` is the pitch; links in notes show as links. Limits: title 120 characters, note 4000. The same open title for the same project gets the note instead of a twin, and `oberth idea <id> --note …` adds to one by id.
- `oberth ideas` lists them with their ids; `oberth search "…" --kind ideas` finds old ones, dropped included, so check before filing.
- Starting an idea (a new folder with `git init`, its About and an assistant session with the brief, or a new session in the project) is the owner's, in the dashboard. Neither the command line nor the tools can do it.
- Ideas never reach the Agenda: nothing in them is waiting for the owner.
