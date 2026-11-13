# Contributing

Oberth is meant to be forked and changed: most changes belong in your own copy, and [CUSTOMIZE.md](CUSTOMIZE.md) is the way to make them. Upstream takes changes that are useful to most people who adapt it:

- **New launchers, editors, forges and link sources** that are common enough to ship (a Rails or Go launcher, another editor), each with a test.
- **Fixes**, especially to readiness, process handling and the private-format readers, with a test that fails without the fix.
- **Better guidance** in `CUSTOMIZE.md`: if your agent got stuck or had to guess while following it, say where.

Before opening a pull request:

1. `npm test` and `npm run typecheck` pass.
2. The change follows the rules in [AGENTS.md](AGENTS.md): nothing written into project folders, no commands or paths accepted from requests, erasable TypeScript, optional parts that hide when missing.
3. Docs that describe what you changed are updated with it (the list is in AGENTS.md).
4. Nothing personal in it: your paths, user name, project names. `bash scripts/scrub-check.sh` helps if you keep a word list.

There is no roadmap and no promise of a quick review. Small, focused pull requests with a clear reason get looked at first.
