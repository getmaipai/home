#!/usr/bin/env bash
# Build the docs site and publish it to the gh-pages branch (GitHub Pages serves it
# at https://getmaipai.github.io/home/). Run on a Mac from a checkout of main.
# Builds locally on purpose: no GitHub Actions minutes spent per docs change.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/docs/site-fumadocs"
BASE=/home
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$SITE"
bun install >/dev/null
DOCS_BASE_PATH="$BASE" bun run build >/dev/null
cp -R out/. "$WORK/"
rm -rf out .next

# Raw HTML in the pages (images, card links) is written with root paths that Next does
# not prefix. Add the base path to them; paths already under it are left alone.
find "$WORK" -type f \( -name '*.html' -o -name '*.txt' -o -name '*.md' \) -print0 |
  xargs -0 perl -pi -e 's{((?:src|href)=\\?["\x27])/(?!home/)(img|screens|brand|docs|llms)}{$1'"$BASE"'/$2}g'

# Every root-relative reference in the output must now resolve inside the output.
bad=0
while IFS= read -r ref; do
  p="${ref#"$BASE"}"; p="${p#/}"; p="${p%%[?#]*}"
  [ -z "$p" ] && continue
  [ -e "$WORK/$p" ] || [ -e "$WORK/$p.html" ] || [ -e "$WORK/${p%/}/index.html" ] || { echo "dead link: $ref"; bad=1; }
done < <(grep -rhoE "(src|href)=\"/[^\"]+" "$WORK" --include='*.html' | sed -E 's/^(src|href)="//' | grep -vE '^//' | sort -u)
[ "$bad" = 0 ] || { echo "publish-docs: fix the dead links above, then run again." >&2; exit 1; }

touch "$WORK/.nojekyll"
cd "$WORK"
git init -q -b gh-pages
git add --all
git commit -q -m "Publish docs site (built from $(git -C "$ROOT" rev-parse --short HEAD))"
git remote add origin "$(git -C "$ROOT" remote get-url origin)"
git push -f origin gh-pages
gh api -X POST repos/getmaipai/home/pages/builds >/dev/null
echo "Published. Live in about a minute: https://getmaipai.github.io/home/"
