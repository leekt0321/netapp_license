#!/usr/bin/env sh
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DIR/index.html" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "$DIR/index.html"
else
  printf 'Open this file in your browser: %s\n' "$DIR/index.html"
fi
