#!/usr/bin/env bash
# Render deck.html to FindYourDent-Pitch-Deck.pdf with headless Chrome (1280x720 pages).
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --user-data-dir="${TMPDIR:-/tmp}/fyd-deck-chrome" \
  --print-to-pdf="$PWD/FindYourDent-Pitch-Deck.pdf" "file://$PWD/deck.html"
ls -lh FindYourDent-Pitch-Deck.pdf
