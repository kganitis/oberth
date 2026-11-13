# Configuration

Oberth reads one file, `config.json`, from its state folder when the service starts:

```
~/Library/Application Support/oberth/config.json
```

Every field is optional, and a missing file means every default, so a fresh clone runs as is. After changing the file, restart the service (`launchctl kickstart -k gui/$UID/local.oberth`, or stop and start `npm start`). A field with a wrong value is reported where the service writes its messages (`~/Library/Logs/oberth/service.log` for the installed service, the terminal for `npm start`) and in a banner on the dashboard, and left at its default; the rest of the file still applies.

`config.example.json` in the repository is a filled-in example to copy from.

## Fields

| Field | Default | What it does |
|---|---|---|
| `roots` | `["~/Dev"]` | The folders Oberth looks in for projects, each two levels deep. A string, or `{ "path": "...", "label": "..." }`. |
| `exclude` | `[]` | Folders left out: a name matches a folder at the top of any root; a path (`~/...` or absolute) matches that folder anywhere. |
| `projects` | `{}` | Per project id: `name` (shown instead of the folder's), `liveUrl` (where it is deployed), `openPort` (open its dev server's own port, not the stable address). |
| `browser` | `"Safari"` | The app pages open in, by name as `open -a` takes it (`"Google Chrome"`, `"Arc"`, `"Firefox"`), or `"default"` for the system's default browser. |
| `editor` | `"vscode"` | The editor for "Open in …" and for search hits: `vscode`, `cursor`, `windsurf`, `zed`, `sublime`, or `finder` for none. Add others in `service/editors.ts`. |
| `assistant` | `"claude"` | `"claude"` for Claude Code through the Claude desktop app, or `"none"`. Add others in `service/assistant.ts`. |
| `modules` | all on but `backup` | Turn parts of Oberth off: `agenda`, `logbook`, `recall`, `ideas`, `outside`, `proxy`, `backup`. |
| `backup` | `{ "log": "~/Library/Logs/backup.log" }` | The log the `backup` module reads (see below). |
| `self` | `true` | Whether work on Oberth itself counts in the Logbook, search and Ideas. |
| `port` | `7777` | The dashboard and API, on `127.0.0.1` only. |
| `proxyPort` | `7700` | The stable addresses, `http://<name>.localhost:<proxyPort>/`. |

## Roots and project ids

A project's id is its path inside its root with `/` turned into `__`: `games/arcade` becomes `games__arcade`. Ids key everything Oberth stores (About, settings, the Logbook, ideas, asks), so they must stay put.

The first root's projects keep their bare path. Every other root puts its label in front: a folder `api` in a root labelled `clients` is `clients__api`. That way adding a second root never renames the projects of the first. A label defaults to the folder's name, lower case; give one yourself when two roots share a name. A root inside another root is listed under its own label only.

Two levels deep means `<root>/x` and `<root>/group/x`. A top-level folder that isn't a project itself is a group, and its folders are tried in turn. Anything deeper isn't looked at.

## Modules

| Module | What turning it off removes |
|---|---|
| `agenda` | The Agenda view, the sidebar count, the menu bar's Needs you rows and notifications. |
| `logbook` | The Logbook page, the weekly review, and the recording of commits and sessions (launches still show in today's strip). |
| `recall` | Search across code, docs, notes and sessions (⌘K still finds projects and actions). |
| `ideas` | The Ideas view and every way to file one. |
| `outside` | The background checks of released projects on GitHub, PyPI and their live sites. |
| `proxy` | The stable addresses: pages open on their dev server's own port. |
| `backup` | An Agenda item when a backup script's log shows a failed run. Off by default: it needs a script of your own that writes the log in the expected format (`service/backupstatus.ts` describes it). |

## Other files in the state folder

Oberth keeps everything it knows in the same folder. You don't edit these by hand, but they are plain JSON and safe to back up or move to another Mac.

| File | What |
|---|---|
| `token` | The secret the dashboard, CLI and menu bar send with each request. Created on first start; owner-only permissions. |
| `about.json` | Each project's description, status, Released mark and notes. |
| `settings.json` | Hidden and pinned projects, last launches. |
| `agenda.json` | Asks and what was put off with Later. |
| `ideas.json` | The Ideas notebook. |
| `activity/<day>.jsonl` | The Logbook: one file per day of launches, commits and sessions. |
| `logbook.json`, `outside.json`, `review.json`, `scripts.json` | Bookkeeping for the Logbook, the outside checks, the weekly review and script results. |
| `icons/<id>.svg` | Your own icons for projects that have no favicon. |

## A second Oberth beside the installed one

`OBERTH_STATE_DIR` moves the state folder, and with it `config.json`, the token and the projects' logs (into `logs/` inside it); the service's own messages go to wherever you started it. Give that config other ports and you can run a second Oberth next to the installed one without either noticing:

```bash
mkdir -p ~/oberth-test && echo '{ "roots": ["~/code"], "port": 7795, "proxyPort": 7805 }' > ~/oberth-test/config.json
OBERTH_STATE_DIR=~/oberth-test npm start
```

`npm run demo` does the same with a folder of made-up projects, on 7790 and 7800. The installed service and the menu bar app always use the default state folder.
