#!/bin/sh
# Installs the operator board extension for GitHub Copilot CLI by copying it into the user extensions folder.
# Run it again after pulling to update. Copilot picks it up in new sessions (or after /clear).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dest="${COPILOT_HOME:-$HOME/.copilot}/extensions/operator-board"
mkdir -p "$dest"
cp "$here/extension.mjs" "$here/store.mjs" "$here/statusline.mjs" "$dest/"
chmod +x "$dest/statusline.mjs"
echo "Installed to $dest"
echo
echo "Optional status line (context %, AI credits, to-dos, needs-reply):"
echo "  copilot config statusLine.command \"node $dest/statusline.mjs\""
