#!/bin/bash
# Regenerates the mockup HTML from build.py and renders each page to PNG with headless Chrome.
# Usage: bash render.sh   (run inside this folder; needs python3 and Google Chrome)
set -e
cd "$(dirname "$0")"
mkdir -p html png
python3 build.py
mv -f *.html html/ 2>/dev/null || true
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for f in html/phone-*.html; do
  n=$(basename "$f" .html)
  "$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=480,960 --screenshot="png/$n.png" "file://$PWD/$f" >/dev/null 2>&1
done
for f in html/desktop-*.html html/making-now*.html html/downloads-card.html html/status-cards.html html/activity-indicator.html; do
  n=$(basename "$f" .html)
  "$C" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 --screenshot="png/$n.png" "file://$PWD/$f" >/dev/null 2>&1
done
echo "done: png/"
