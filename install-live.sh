#!/bin/sh
# Linux / Steam Deck launcher
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed - get it from https://nodejs.org or your package manager."; exit 1; }
exec node live-install.js install "$@"
