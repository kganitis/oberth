#!/bin/bash
# Removes what install.sh added: the launchd agent, the menu bar app and its login item, and the MCP server
# registration. Leaves the state folder (config.json, About, Logbook, Ideas) and the logs, so a reinstall picks up
# where it was. Delete ~/Library/Application\ Support/oberth and ~/Library/Logs/oberth too to remove everything.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${OBERTH_LABEL:-local.oberth}"
for plist in "$HOME/Library/LaunchAgents/$LABEL.plist" "$HOME"/Library/LaunchAgents/*.plist; do
  [ -f "$plist" ] || continue
  if [ "$plist" = "$HOME/Library/LaunchAgents/$LABEL.plist" ] || grep -q "$REPO/service/main.ts" "$plist" 2>/dev/null; then
    launchctl bootout "gui/$UID/$(basename "$plist" .plist)" 2>/dev/null
    rm -f "$plist"
  fi
done
pkill -x Oberth 2>/dev/null
osascript -e 'tell application "System Events" to delete (every login item whose name is "Oberth")' >/dev/null 2>&1
rm -rf "$HOME/Applications/Oberth.app"
CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"
[ -x "$CLAUDE_BIN" ] && "$CLAUDE_BIN" mcp remove --scope user oberth >/dev/null 2>&1
echo "uninstalled (your state folder and logs are kept)"
