#!/bin/bash
# Installs Oberth on this Mac: a launchd agent that runs the service at login, the menu bar app in ~/Applications
# as a login item, and (when Claude Code is installed) the MCP server for every Claude Code session.
# Safe to run again after changes. Undo with scripts/uninstall.sh. Settings live in config.json in the state folder.
#   OBERTH_LABEL   the launchd label (default local.oberth), if you'd rather use your own reverse-DNS name
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${OBERTH_LABEL:-local.oberth}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/oberth"

[ "$(uname)" = "Darwin" ] || { echo "Oberth runs on macOS only." >&2; exit 1; }
NODE_BIN="$(cd "$REPO" && node --input-type=module -e "import('./service/config.ts').then(m => console.log(m.resolveNodeBin()))" 2>/dev/null)" || {
  echo "Node.js 22.18 or newer is needed (it runs the TypeScript directly). Install it with nvm or Homebrew, then run this again." >&2; exit 1; }
"$NODE_BIN/node" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' || {
  echo "Node.js 22.18 or newer is needed; $("$NODE_BIN/node" --version) was found in $NODE_BIN." >&2; exit 1; }
PATH_ENV="$(cd "$REPO" && "$NODE_BIN/node" --input-type=module -e "import('./service/config.ts').then(m => console.log(m.basePath(m.resolveNodeBin())))")"
PORT="$(cd "$REPO" && "$NODE_BIN/node" --input-type=module -e "import('./service/config.ts').then(m => { for (const p of m.config.problems) console.error('config: ' + p); console.log(m.config.port) })")"
[ -d "$REPO/node_modules" ] || (cd "$REPO" && PATH="$NODE_BIN:$PATH" npm install --omit=dev --no-audit --no-fund >/dev/null)

mkdir -p "$LOGS" "$HOME/Library/LaunchAgents" "$HOME/Applications"
sed -e "s#__LABEL__#$LABEL#" -e "s#__NODE__#$NODE_BIN/node#" -e "s#__REPO__#$REPO#g" -e "s#__PATH__#$PATH_ENV#" -e "s#__LOGS__#$LOGS#g" \
  "$REPO/launchd/oberth.plist.template" > "$PLIST"

# an agent installed earlier under another label that runs this same service would fight it for the port
for old in "$HOME"/Library/LaunchAgents/*.plist; do
  [ "$old" = "$PLIST" ] && continue
  if grep -q "$REPO/service/main.ts" "$old" 2>/dev/null; then
    launchctl bootout "gui/$UID/$(basename "$old" .plist)" 2>/dev/null || true
    rm -f "$old"
    echo "removed an older agent: $(basename "$old")"
  fi
done

# stop any hand-started copy, then (re)load the agent
pkill -f "node .*$REPO/service/main.ts" 2>/dev/null || true
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
# bootout returns before the job is fully gone; bootstrapping too early fails with an I/O error
for _ in $(seq 1 50); do launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1 || break; sleep 0.1; done
launchctl bootstrap "gui/$UID" "$PLIST"

bash "$REPO/menubar/build.sh"
pkill -x Oberth 2>/dev/null || true
rm -rf "$HOME/Applications/Oberth.app"
cp -R "$REPO/menubar/build/Oberth.app" "$HOME/Applications/"
osascript -e 'tell application "System Events" to delete (every login item whose name is "Oberth")' >/dev/null 2>&1 || true
osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$HOME/Applications/Oberth.app\", hidden:true}" >/dev/null
open "$HOME/Applications/Oberth.app"

# the MCP server for every Claude Code session (user scope), with node's full path, since the Claude app's
# environment may not have nvm's node on its PATH. Other MCP clients: see CUSTOMIZE.md.
CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"
if [ -x "$CLAUDE_BIN" ]; then
  "$CLAUDE_BIN" mcp remove --scope user oberth >/dev/null 2>&1 || true
  "$CLAUDE_BIN" mcp add --scope user oberth -- "$NODE_BIN/node" "$REPO/scripts/mcp.ts" >/dev/null
  MCP_NOTE=", MCP server 'oberth' for Claude Code"
else
  MCP_NOTE=" (Claude Code not found, so the MCP server isn't registered: see CUSTOMIZE.md for other clients)"
fi
echo "installed: Oberth on http://127.0.0.1:$PORT/ (launchd agent $LABEL), menu bar app ~/Applications/Oberth.app (login item)$MCP_NOTE"
