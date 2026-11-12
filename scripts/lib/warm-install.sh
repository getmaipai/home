#!/bin/bash
# WARM-INSTALL-01 (2026-11-12): one warm node_modules per lockfile hash; a new worktree gets an APFS clone of it instead of a full
# `bun install`. Sourced by scripts/lib/wt-bun-shim/bun (which `wt.sh start` puts first on PATH so the shared script's
# `bun install --frozen-lockfile` goes through it). Measured on 238k files / 2.6 GB: `cp -c -R` 33 s, clonefile(2) on the directory 2.5 s.
# Fail safe: any problem (no clone, no python, partial copy, a different hash) removes what was half written and the normal install runs.
# The real `bun install --frozen-lockfile` always runs afterwards: on a good clone it only verifies, so a stale clone cannot slip through.
# Hash: bun.lock + the three package.json files + bun version + CPU. Store: $MAIPAI_WARM_DIR or <main checkout>/data-scratch/warm-install/<hash>/{root,backend,frontend}.
WARM_KEEP="${MAIPAI_WARM_KEEP:-3}"
warm_log() { echo "wt: warm-install: $*" >&2; }
warm_hash() { # $1 = worktree root
  local r="$1" f
  { for f in bun.lock package.json backend/package.json frontend/package.json; do printf '%s\n' "== $f"; cat "$r/$f" 2>/dev/null || true; done
    "$WARM_REAL_BUN" --version 2>/dev/null; uname -m; } | shasum -a 256 | cut -c1-24
}
warm_dir() { # $1 = worktree root
  if [[ -n "${MAIPAI_WARM_DIR:-}" ]]; then printf '%s' "$MAIPAI_WARM_DIR"; return; fi
  local c; c="$(git -C "$1" rev-parse --git-common-dir 2>/dev/null)" || return 1
  [[ "$c" = /* ]] || c="$(cd "$1" && cd "$c" && pwd -P)"
  printf '%s/data-scratch/warm-install' "$(cd "$(dirname "$c")" && pwd -P)"
}
warm_clone() { # $1 src dir, $2 dst (must not exist). One clonefile(2) call clones the whole tree in about 2 s.
  [[ -d "$1" && ! -e "$2" ]] || return 1
  [[ "${MAIPAI_WARM_NO_CLONE:-}" != 1 ]] || return 1
  python3 -I -c '
import ctypes, sys
l = ctypes.CDLL("libc.dylib", use_errno=True)
sys.exit(0 if l.clonefile(sys.argv[1].encode(), sys.argv[2].encode(), 0) == 0 else 1)' "$1" "$2" 2>/dev/null
}
warm_slot() { case "$1" in .|"") echo root ;; *) echo "$1" ;; esac; }
warm_restore() { # $1 worktree root, $2 store dir (<warm>/<hash>), $3 rel dir ("." or backend/frontend): clone a stored node_modules into place when missing
  local r="$1" store="$2/$(warm_slot "$3")"
  [[ ! -e "$r/$3/node_modules" && -d "$store/node_modules" ]] || return 0
  if warm_clone "$store/node_modules" "$r/$3/node_modules"; then warm_log "cloned $(warm_slot "$3") node_modules"; else rm -rf "$r/$3/node_modules"; warm_log "clone of $(warm_slot "$3") failed; normal install"; fi
}
warm_save() { # $1 worktree root, $2 store dir, $3 rel dir: keep this worktree's finished node_modules for the next start
  local r="$1" store="$2/$(warm_slot "$3")" tmp
  [[ -d "$r/$3/node_modules" && ! -e "$store/node_modules" ]] || return 0
  mkdir -p "$store" 2>/dev/null || return 0
  tmp="$store/.tmp.$$.node_modules"; rm -rf "$tmp"
  if warm_clone "$r/$3/node_modules" "$tmp"; then mv "$tmp" "$store/node_modules" 2>/dev/null || rm -rf "$tmp"; warm_log "saved $(warm_slot "$3") node_modules for the next start"; else rm -rf "$tmp"; fi
}
warm_prune() { # keep the newest $WARM_KEEP hashes
  local base="$1" n=0 d
  while IFS= read -r d; do n=$((n+1)); (( n > WARM_KEEP )) && rm -rf "$base/$d"; done < <(cd "$base" 2>/dev/null && ls -1t 2>/dev/null)
}
# warm_bun_install <real bun> <args...>: run from the install dir of a new worktree.
warm_bun_install() {
  WARM_REAL_BUN="$1"; shift
  local cwd root rel base store t0 rc
  cwd="$(pwd -P)"; root="$(git rev-parse --show-toplevel 2>/dev/null)" || { "$WARM_REAL_BUN" "$@"; return; }
  root="$(cd "$root" && pwd -P)"; rel="${cwd#"$root"}"; rel="${rel#/}"; [[ -n "$rel" ]] || rel=.
  case "$rel" in .|backend|frontend) ;; *) "$WARM_REAL_BUN" "$@"; return ;; esac
  if [[ "${MAIPAI_WARM_INSTALL:-1}" == 0 ]] || ! base="$(warm_dir "$root")"; then "$WARM_REAL_BUN" "$@"; return; fi
  store="$base/$(warm_hash "$root")"
  t0=$SECONDS
  touch "$store" 2>/dev/null || true # a hit keeps this hash among the newest (warm_prune orders by mtime)
  warm_restore "$root" "$store" .; warm_restore "$root" "$store" "$rel"
  "$WARM_REAL_BUN" "$@"; rc=$?
  if (( rc == 0 )); then warm_save "$root" "$store" .; warm_save "$root" "$store" "$rel"; warm_prune "$base"; fi
  warm_log "$rel done in $((SECONDS - t0)) s"
  return $rc
}
