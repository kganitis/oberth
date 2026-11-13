# Instructions for your agents

Oberth works best when the agents working in your projects keep it up to date: they check a project after changing how it runs, keep its About current, and leave you asks and ideas where you will see them. They only do that if they are told to.

Copy the block below into the instruction file your agents read in every project. For Claude Code that is a `CLAUDE.md` in the folder that holds your projects (`~/Dev/CLAUDE.md` for the default root), which every session started below it loads. Other agents have their own (`AGENTS.md`, rules files): put it wherever yours reads it. Replace `<oberth>` with the folder you cloned Oberth into, and change anything that doesn't match how you work.

```markdown
# Projects and Oberth

Every project in this folder is listed in Oberth, my local project console (`<oberth>`): a dashboard and menu bar app that starts and stops each project's dev server and shows what I wrote about it (description, status, notes). I rely on it to find and run everything, so keep each project's place in Oberth correct. Use Oberth's MCP tools (server `oberth`) where the session has them; otherwise `oberth` means `node <oberth>/scripts/oberth.ts`, with the same operations. How-to and details: `<oberth>/docs/integrating-projects.md`.

- **A new project, or a change to how one runs** (new dev command, port, stack, launch method, deploy target or live URL): run `check` (the tool, or `oberth check` in the project folder) before calling the work done, and fix what it reports. Oberth recognises `dev` scripts in `package.json` (npm, pnpm, yarn or bun), Hugo, `serve.py`, `index.html` and plain repos; anything else needs a `.oberth.json` (see the doc).
- **Keep the About current.** When a project's purpose, status or state changes in a way I'd want to see at a glance (a feature landed, it was paused, finished, renamed, deployed), update it with `set_about` (or `oberth about`): description, status, and notes on where it was left and what is next. Mention the update in your reply. Set Released only when I say it is out.
- **A brand-new project** gets a description and status (usually `idea` or `active`) as soon as its folder exists.
- **Leaving something for me**: use `ask` (or `oberth ask "…"`) when work can't continue without me and the need will outlive this conversation. A question answered in the chat is not an ask. Close it with `close_ask` (or `oberth done <id>`) if it stops applying.
- **Ideas for later**: when I say something is an idea for later, file it with `idea` (or `oberth idea "…"`), with the project it's for, or none for a new project. Only on my words. Starting one is mine, in the dashboard.
- **Looking for earlier work**: `search` (or `oberth search "exact words"`) finds exact words across every project's code, docs and notes, and in past sessions. Try it when something may already have been solved elsewhere.
- **Writing into the project**: a `.oberth.json` is fine when integration needs it, but tell me, and in a repo that is or may become public keep it out of git via `.git/info/exclude`.
- **Oberth's own code** changes only in a session in `<oberth>`. If a stack needs support there, propose such a session with a short brief instead of editing it from here.
- If `oberth` says the service isn't running, say so; don't work around it.
```

If you left folders out of Oberth with `exclude` in `config.json`, say so here too ("`private-thing` is left out of Oberth on purpose; never add it or mention it there"), so an agent working near them doesn't add them back with a `.oberth.json`. The MCP server already tells sessions that use it.
