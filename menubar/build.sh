#!/bin/bash
# Builds menubar/build/Oberth.app with the Command Line Tools swiftc.
set -euo pipefail
cd "$(dirname "$0")"
APP=build/Oberth.app
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS"
swiftc -O -o "$APP/Contents/MacOS/Oberth" Oberth.swift -framework AppKit -framework UserNotifications
cp Info.plist "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "built $APP"
