#!/usr/bin/env bash
# Developer disk keeper (DISK-KEEPER-01): keeps the build Mac from filling up again. Dev hygiene only; the product's own disk guard
# (docs/design/disk-guard-2026-11-19.md) never touches these folders, and this script never touches /usr/local/maipai-home.
# Dry run is the default: nothing is removed without --apply, and every removal is appended to the log.
#
#   disk-keeper.sh check                       one line, statfs only (fast, for a session-start hook); exit 3 when past the threshold
#   disk-keeper.sh report                      sizes by category: worktrees, scratch experiments, weights, caches, build dirs, run dirs
#   disk-keeper.sh worktrees [--apply] [--keep GLOB]... [--sizes]
#                                              classify every worktree; with --apply remove only SAFE ones (clean, and merged or pushed)
#   disk-keeper.sh weights [--apply] [--min-mb N] [--older-days N]
#                                              list model weights no profile or tier names; with --apply delete those in a finished
#                                              experiment (its folder holds RESULTS.md, or it sits in the scratch root and is old)
#
# Environment: MAIPAI_DISK_WARN_PCT (85), MAIPAI_DISK_WARN_FREE_GB (150), MAIPAI_SCRATCH_WEIGHTS (~/scratch/maipai-weights),
# MAIPAI_SCRATCH_CAP_GB (150), MAIPAI_DISK_LOG (~/.local/share/maipai/disk-keeper/removed.tsv), MAIPAI_DISK_KEEP (space separated
# globs matched against worktree path or branch), MAIPAI_DISK_REPOS (checkouts whose worktrees are scanned), MAIPAI_ASSIGNED_FILES
# (source files that name assigned models), MAIPAI_DISK_ACTIVE_SECS (7200: a worktree touched this recently counts as in use).
set -uo pipefail

ORG="${MAIPAI_DISK_ORG:-$HOME/Developer/github.com/getmaipai}"
WARN_PCT="${MAIPAI_DISK_WARN_PCT:-85}"
WARN_FREE_GB="${MAIPAI_DISK_WARN_FREE_GB:-150}"
SCRATCH="${MAIPAI_SCRATCH_WEIGHTS:-$HOME/scratch/maipai-weights}"
CAP_GB="${MAIPAI_SCRATCH_CAP_GB:-150}"
LOG="${MAIPAI_DISK_LOG:-$HOME/.local/share/maipai/disk-keeper/removed.tsv}"
ACTIVE_SECS="${MAIPAI_DISK_ACTIVE_SECS:-7200}"
LIVE="${MAIPAI_LIVE_INSTALL:-/usr/local/maipai-home}"
REPOS="${MAIPAI_DISK_REPOS:-$ORG/home $ORG/stack $ORG/commons $ORG/bot $ORG/catalog $ORG/stackchan $ORG/.github}"
KEEP_GLOBS="${MAIPAI_DISK_KEEP:-}"
WEIGHT_EXT='safetensors|gguf|ckpt|pth|pt|onnx|npz|bin|mlpackage|mlmodel'

gb() { awk -v k="$1" 'BEGIN { printf "%.1f GB", k / 1048576 }'; }
now() { date +%s; }
log_removal() { # kind bytes path reason
  mkdir -p "$(dirname "$LOG")"; printf '%s\t%s\t%s\t%s\t%s\n' "$(now)" "$2" "$1" "$3" "$4" >> "$LOG"
}

# free space of the data volume: prints "<used_pct> <free_kb> <total_kb>"
volume() { df -k "${MAIPAI_DISK_VOLUME:-/System/Volumes/Data}" 2>/dev/null | awk 'NR==2 { t=$2; f=$4; printf "%d %d %d\n", (t>0 ? (t-f)*100/t : 0), f, t }'; }

cmd_check() {
  read -r pct free total < <(volume)
  [[ -n "${pct:-}" ]] || { echo "disk-keeper: cannot read the volume" >&2; return 0; }
  local free_gb=$(( free / 1048576 ))
  if (( pct >= WARN_PCT || free_gb < WARN_FREE_GB )); then
    echo "DISK WARNING: ${pct}% used, ${free_gb} GB free. Run: bash scripts/disk-keeper.sh report   (then: worktrees, weights)"
    return 3
  fi
  echo "disk ok: ${pct}% used, ${free_gb} GB free"
}

# ---------------------------------------------------------------- worktrees
# classify <path> <branch> -> prints "<CLASS>\t<reason>"; CLASS is SAFE, DIRTY, UNPUSHED, ACTIVE, PROTECTED or ODD
classify() {
  local path="$1" branch="$2" main="$3" g tip porcelain real lsout
  for g in $KEEP_GLOBS; do
    # shellcheck disable=SC2254
    case "$path" in $g) printf 'PROTECTED\tkeep list %s\n' "$g"; return;; esac
    # shellcheck disable=SC2254
    case "$branch" in $g) printf 'PROTECTED\tkeep list %s\n' "$g"; return;; esac
  done
  [[ -e "$path/.git" ]] || { printf 'ODD\tfolder or .git is gone\n'; return; }
  [[ -n "$branch" ]] || { printf 'ODD\tdetached HEAD\n'; return; }
  tip="$(git -C "$path" rev-parse HEAD 2>/dev/null)" || { printf 'ODD\tgit cannot read it\n'; return; }
  porcelain="$(git -C "$path" status --porcelain=v1 --ignored 2>/dev/null)" || { printf 'ODD\tgit status failed\n'; return; }
  # ignored caches are disposable; anything else (tracked edits, untracked, other ignored files) means a person must look
  porcelain="$(printf '%s\n' "$porcelain" | grep -Ev '^!! (.*/)?(node_modules|__pycache__|\.pytest_cache|\.ruff_cache|\.turbo|\.vite|dist|\.next|\.cache)/$|^!! (.*/)?\.DS_Store$|^$' || true)"
  if [[ -n "$porcelain" ]]; then printf 'DIRTY\t%s changed, untracked or ignored paths\n' "$(printf '%s\n' "$porcelain" | wc -l | tr -d ' ')"; return; fi
  real="$(cd "$path" && pwd -P)"
  lsout="${LSOF_CWD:-}"
  if (( LSOF_OK )); then
    printf '%s\n' "$lsout" | WT_P="$real" awk 'substr($0,1,1)=="n" {d=substr($0,2); p=ENVIRON["WT_P"]; if (d==p || index(d, p "/")==1) f=1} END {exit !f}' \
      && { printf 'ACTIVE\ta process has its working directory inside\n'; return; }
  else
    printf 'ACTIVE\tlsof failed, cannot rule out a running process\n'; return
  fi
  local gd newest
  gd="$(git -C "$path" rev-parse --absolute-git-dir 2>/dev/null)"
  newest="$(stat -f %m "$gd/HEAD" "$gd/index" "$gd/logs/HEAD" 2>/dev/null | sort -n | tail -1)"
  if [[ -n "$newest" ]] && (( $(now) - newest < ACTIVE_SECS )); then printf 'ACTIVE\tgit state touched in the last %ss\n' "$ACTIVE_SECS"; return; fi
  # merged: ancestor of origin/main, or every patch already on origin/main (git cherry: squash and rebase merges)
  if git -C "$main" merge-base --is-ancestor "$tip" origin/main 2>/dev/null; then printf 'SAFE\tmerged (ancestor of origin/main)\n'; return; fi
  if ! git -C "$main" cat-file -e "$tip^{commit}" 2>/dev/null; then printf 'ODD\ttip not in the main repo\n'; return; fi
  if ! git -C "$main" cherry origin/main "$tip" 2>/dev/null | grep -q '^+'; then printf 'SAFE\tmerged (git cherry: every patch is on origin/main)\n'; return; fi
  # pushed: some remote-tracking ref already holds the tip
  local rb
  rb="$(git -C "$main" branch -r --contains "$tip" 2>/dev/null | grep -v 'HEAD ->' | head -1 | tr -d ' ')"
  if [[ -n "$rb" ]]; then printf 'SAFE\tpushed (%s holds the tip)\n' "$rb"; return; fi
  printf 'UNPUSHED\t%s commit(s) not on origin/main or any remote branch\n' "$(git -C "$main" cherry origin/main "$tip" 2>/dev/null | grep -c '^+')"
}

cmd_worktrees() {
  local apply=0 sizes=0
  while (( $# )); do case "$1" in
    --apply) apply=1;; --sizes) sizes=1;; --keep) KEEP_GLOBS="$KEEP_GLOBS ${2:-}"; shift;;
    *) echo "worktrees: unknown option $1" >&2; return 2;; esac; shift; done
  LSOF_CWD="$(lsof -d cwd -Fn 2>/dev/null)" && LSOF_OK=1 || LSOF_OK=0   # computed here: classify runs in subshells and cannot cache
  local repo line path branch cls reason n_safe=0 n_other=0 safe_kb=0 kb
  local out_other=""
  for repo in $REPOS; do
    [[ -d "$repo/.git" ]] || continue
    path=""; branch=""
    while IFS= read -r line; do
      case "$line" in
        "worktree "*) path="${line#worktree }"; branch="";;
        "branch "*) branch="${line#branch refs/heads/}";;
        "")
          if [[ -n "$path" && "$path" != "$repo" ]]; then
            IFS=$'\t' read -r cls reason < <(classify "$path" "$branch" "$repo")
            kb=0; if (( sizes || apply )); then kb="$(du -sk "$path" 2>/dev/null | awk '{print $1}')"; kb="${kb:-0}"; fi
            if [[ "$cls" == SAFE ]]; then
              n_safe=$((n_safe + 1)); safe_kb=$((safe_kb + kb))
              if (( apply )); then
                if git -C "$repo" worktree remove "$path" >/dev/null 2>&1; then
                  log_removal worktree $((kb * 1024)) "$path" "$reason; branch ${branch:-none}"
                  case "$reason" in merged*) git -C "$repo" branch -d "$branch" >/dev/null 2>&1 || git -C "$repo" branch -D "$branch" >/dev/null 2>&1 && true;; esac
                  printf 'REMOVED  %-10s %s  (%s)\n' "$(gb "$kb")" "$path" "$reason"
                else
                  printf 'KEPT     git refused to remove %s (it holds files git will not discard)\n' "$path"
                fi
              else
                printf 'would remove  %-10s %s  (%s)\n' "$(gb "$kb")" "$path" "$reason"
              fi
            else
              n_other=$((n_other + 1))
              out_other+="$(printf '%-9s %-10s %s [%s] %s\n' "$cls" "$(gb "$kb")" "$path" "${branch:-no branch}" "$reason")"$'\n'
            fi
          fi
          path=""; branch="";;
      esac
    done < <(git -C "$repo" worktree list --porcelain; echo)
  done
  echo
  echo "Needs a person (never touched by this command):"
  printf '%s' "${out_other:-  none\n}" | sort
  echo
  if (( apply )); then echo "Removed or kept: $n_safe safe worktrees ($(gb "$safe_kb")); $n_other left for a person. Log: $LOG"
  else echo "Dry run: $n_safe worktrees are safe to remove ($( ((sizes)) && gb "$safe_kb" || echo 'add --sizes for GB')); $n_other need a person. Add --apply to remove the safe ones."; fi
}

# ---------------------------------------------------------------- weights
assigned_text() {
  local f files="${MAIPAI_ASSIGNED_FILES:-}" out=""
  if [[ -z "$files" ]]; then
    files="$ORG/home/backend/src/lib/tiers.ts $ORG/home/backend/src/lib/modelCatalog.ts $ORG/stack/backend/src/lib/tiers.ts $ORG/stack/backend/src/lib/partDefs.ts $ORG/stack/backend/src/rows/partDefs.json"
    for f in "$LIVE"/backend/src/lib/tiers.ts "$LIVE"/backend/src/lib/modelCatalog.ts "$LIVE"/stack/backend/src/lib/tiers.ts "$LIVE"/stack/backend/src/lib/partDefs.ts "$LIVE"/stack/backend/src/rows/partDefs.json; do files="$files $f"; done
  fi
  for f in $files; do [[ -r "$f" ]] && out+="$(tr 'A-Z' 'a-z' < "$f")"$'\n'; done
  printf '%s' "$out"
}

weight_roots() {
  local d
  for d in "$ORG"/*/data-scratch "$ORG"/wt/*/data-scratch "$HOME/video-bench" "$SCRATCH"; do [[ -d "$d" && ! -L "$d" ]] && echo "$d"; done
}

# experiment dir of a weight file: first folder under a data-scratch or scratch root
experiment_of() {
  local f="$1" root rest
  for root in "$ORG"/*/data-scratch "$ORG"/wt/*/data-scratch "$SCRATCH" "$HOME/video-bench"; do
    case "$f" in "$root"/*) rest="${f#"$root"/}"; echo "$root/${rest%%/*}"; return;; esac
  done
  dirname "$f"
}

cmd_weights() {
  local apply=0 min_mb=500 older=3
  while (( $# )); do case "$1" in
    --apply) apply=1;; --min-mb) min_mb="${2:-500}"; shift;; --older-days) older="${2:-3}"; shift;;
    *) echo "weights: unknown option $1" >&2; return 2;; esac; shift; done
  local text roots root f kb stem base exp why n=0 total=0 removed=0 mtime age
  text="$(assigned_text)"
  [[ -n "$text" ]] || { echo "weights: cannot read any source naming the assigned models (tiers.ts, partDefs.ts, modelCatalog.ts); refusing to propose deletions." >&2; return 4; }
  echo "Model weights >= ${min_mb} MB that no tier, part definition or catalog entry names:"
  while IFS= read -r root; do
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      case "$f" in "$LIVE"/*) continue;; esac
      base="$(basename "$f")"; stem="${base%.*}"
      # assigned if the file name, its stem, or its folder name appears in an assigned source
      if printf '%s' "$text" | grep -qiF -- "$(printf '%s' "$stem" | tr 'A-Z' 'a-z')" || printf '%s' "$text" | grep -qiF -- "$(basename "$(dirname "$f")" | tr 'A-Z' 'a-z')"; then
        printf '  assigned  (kept)  %s\n' "$f"; continue
      fi
      kb=$(( $(stat -f %z "$f" 2>/dev/null || echo 0) / 1024 ))
      exp="$(experiment_of "$f")"; mtime="$(stat -f %m "$f")"; age=$(( ($(now) - mtime) / 86400 ))
      why=""
      if [[ -f "$exp/RESULTS.md" ]]; then why="experiment finished (RESULTS.md present)"
      elif [[ "$f" == "$SCRATCH"/* ]] && (( age >= older )); then why="scratch root, untouched ${age} days"; fi
      n=$((n + 1)); total=$((total + kb))
      if [[ -n "$why" ]] && (( age >= older )); then
        if (( apply )); then
          if lsof -- "$f" >/dev/null 2>&1; then printf '  KEPT      %-10s %s (open by a process)\n' "$(gb "$kb")" "$f"
          else rm -f -- "$f" && { removed=$((removed + kb)); log_removal weight $((kb * 1024)) "$f" "$why"; printf '  REMOVED   %-10s %s (%s)\n' "$(gb "$kb")" "$f" "$why"; }
          fi
        else printf '  would remove %-10s %s (%s)\n' "$(gb "$kb")" "$f" "$why"; fi
      else
        printf '  keep for now %-10s %s (%s)\n' "$(gb "$kb")" "$f" "${why:+younger than $older days}${why:-experiment not marked finished: add RESULTS.md when done}"
      fi
    done < <(find "$root" -type f -size +"${min_mb}"M 2>/dev/null | grep -E "\.(${WEIGHT_EXT})$" | head -500)
  done < <(weight_roots)
  echo
  echo "$n unassigned weight files, $(gb "$total") in all$( ((apply)) && echo "; removed $(gb "$removed"). Log: $LOG" )."
}

# ---------------------------------------------------------------- report
sizeline() { local kb; kb="$(du -sk "$1" 2>/dev/null | awk '{print $1}')"; [[ -n "$kb" ]] && printf '  %12s  %s\n' "$(gb "$kb")" "$1"; }

cmd_report() {
  read -r pct free total < <(volume)
  echo "Volume: ${pct}% used, $(gb "$free") free of $(gb "$total") (warn at ${WARN_PCT}% or under ${WARN_FREE_GB} GB free)"
  cmd_check >/dev/null; local rc=$?
  echo
  echo "1. Worktrees (dry run classification, GB per class; clone-shared node_modules make du overcount):"
  cmd_worktrees --sizes 2>&1 | grep -E '^(would remove|Dry run|Needs|[A-Z]{3,9} +[0-9.]+ GB)' | awk '
    /^would remove/ { c["SAFE"]++; next } /^Dry run/ { print "  " $0; next }
    /^(DIRTY|UNPUSHED|ACTIVE|PROTECTED|ODD)/ { c[$1]++; s[$1]+=$2 }
    END { for (k in c) printf "  %-10s %d worktrees\n", k, c[k] }'
  echo
  echo "2. Experiment folders in data-scratch (largest first; RESULTS.md means finished):"
  for d in "$ORG"/*/data-scratch; do [[ -d "$d" ]] && for e in "$d"/*/; do [[ -d "$e" ]] && { kb="$(du -sk "$e" 2>/dev/null | awk '{print $1}')"; printf '%s\t%s\t%s\n' "$kb" "$e" "$([[ -f "${e}RESULTS.md" ]] && echo finished || echo open)"; }; done; done \
    | sort -rn | head -8 | awk -F'\t' '{ printf "  %12.1f GB  %s [%s]\n", $1/1048576, $2, $3 }'
  echo
  echo "3. Model weights outside the product (see: disk-keeper.sh weights) and the scratch root $SCRATCH (cap ${CAP_GB} GB):"
  sizeline "$SCRATCH"
  [[ -d "$SCRATCH" ]] && { local skb; skb="$(du -sk "$SCRATCH" | awk '{print $1}')"; (( skb / 1048576 > CAP_GB )) && echo "  OVER CAP: delete finished experiments' weights."; }
  echo
  echo "4. Caches:"; for d in "$HOME/.cache/huggingface" "$HOME/.bun/install/cache" "$HOME/Library/Caches" "$HOME/.cache"; do [[ -e "$d" ]] && sizeline "$d"; done
  echo
  echo "5. Build dirs:"; for d in "$HOME/Library/Developer/Xcode/DerivedData" "$HOME/Library/Developer/CoreSimulator"; do [[ -e "$d" ]] && sizeline "$d"; done
  echo
  echo "6. Run dirs and session state:"; for d in "$ORG/home/data" "$ORG/home/backups" "$HOME/.claude/projects" "$HOME/Library/Application Support/Claude" /private/tmp/claude-501 "$ORG/home/data-scratch/jobs"; do [[ -e "$d" ]] && sizeline "$d"; done
  echo
  if (( rc == 3 )); then echo "WARNING: past the threshold. Next: worktrees --apply (safe ones), weights --apply (finished experiments)."; else echo "Below the threshold."; fi
  return $rc
}

case "${1:-}" in
  check) cmd_check;;
  report) cmd_report;;
  worktrees) shift; cmd_worktrees "$@";;
  weights) shift; cmd_weights "$@";;
  *) sed -n 2,16p "$0" | sed 's/^# \{0,1\}//'; exit 2;;
esac
