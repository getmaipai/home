#!/usr/bin/env bash
# Developer disk report (DISK-GUARD-06): what takes space on this Mac and what points into it. Read only: it never deletes, moves or
# writes anything. The product's own cleanup (Settings, Models and storage) never touches the folders listed here.
# Usage: bash scripts/disk-report.sh [--links <folder>]   (--links lists symlinks that point into <folder>, to read before removing it)
set -uo pipefail

human() { awk -v k="$1" 'BEGIN { g = k / 1048576; if (g >= 1) printf "%.1f GB", g; else printf "%.0f MB", k / 1024 }'; }

if [[ "${1:-}" == "--links" ]]; then
  target="${2:-}"; [[ -d "$target" ]] || { echo "disk-report: give an existing folder after --links." >&2; exit 2; }
  target="$(cd "$target" && pwd -P)"
  echo "Symlinks pointing into $target (searched in the usual work folders):"
  found=0
  for root in "$HOME/Developer" "$HOME/video-bench" "$HOME/.cache" "$HOME/Library/Application Support/maipai"; do
    [[ -d "$root" ]] || continue
    while IFS= read -r link; do
      dest="$(readlink "$link")"; [[ "$dest" == /* ]] || dest="$(dirname "$link")/$dest"
      case "$dest" in "$target"|"$target"/*) echo "  $link -> $dest"; found=1;; esac
    done < <(find "$root" -maxdepth 6 -type l -not -path '*/node_modules/*' 2>/dev/null)
  done
  (( found )) || echo "  none found"
  exit 0
fi

echo "Free space (what a download can use, from statfs):"
df -k /System/Volumes/Data 2>/dev/null | awk 'NR==2 { printf "  %.1f GB free of %.0f GB\n", $4 / 1048576, $2 / 1048576 }'
echo
echo "Biggest folders (largest first; nothing here is deleted):"
{
  for dir in "$HOME/video-bench" "$HOME/.cache/huggingface" "$HOME/Library/Caches" "$HOME/Library/Developer/Xcode/DerivedData" \
             "$HOME/Developer/github.com/getmaipai/home/data" "/usr/local/maipai-home/data" ; do
    [[ -e "$dir" ]] && du -sk "$dir" 2>/dev/null
  done
  for scratch in "$HOME"/Developer/github.com/getmaipai/*/data-scratch "$HOME"/Developer/github.com/getmaipai/wt/*/data-scratch; do
    [[ -d "$scratch" ]] && du -sk "$scratch" 2>/dev/null
  done
} | sort -rn | head -15 | while read -r kb path; do printf '  %10s  %s\n' "$(human "$kb")" "$path"; done
echo
echo "Before removing a folder, run: bash scripts/disk-report.sh --links <folder>"
