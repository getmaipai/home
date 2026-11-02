#!/usr/bin/env bash
# DEPS-SELFHEAL-01 (2026-11-02): the lander and the watcher install dependencies in checkouts of their own (home-lander, home-watcher),
# and a landed pin bump left them without the per-tag commons worktrees the `file:../../commons-tags/<workspace>-<tag>/...` dependencies
# point at; the failed install then left a dangling node_modules/@maipai symlink, so even the retry failed and a person had to repair it.
# Source this file (after gitnet.sh). It defines two functions and changes nothing global.
#
#   ensure_pinned_tags <dir>     reads <dir>/package.json for file:.../commons-tags/<workspace>-<tag>/... dependencies and, for each
#                                folder that is missing, runs the commons repo's scripts/ensure-tag.sh <workspace> <tag> after a bounded
#                                `git fetch --tags` (only when the tag is not already local). Commons is found at MAIPAI_COMMONS_REPO,
#                                else next to the commons-tags folder, else ../commons beside <dir>'s parent. When the tag cannot be made
#                                it sets DEPS_ERROR to one plain line and returns 1.
#   install_deps <dir> [--force] ensure_pinned_tags, then a bounded `bun install --frozen-lockfile [--force]` in <dir>. A failed install,
#                                or one that leaves a dangling node_modules/@maipai/* link, deletes <dir>/node_modules (that one folder)
#                                and tries once more. Knobs: DEPS_INSTALL_SECONDS (600), DEPS_INSTALL_LABEL. On failure DEPS_ERROR holds
#                                the cause; DEPS_LAST_RC is 124 after a timeout.

DEPS_ERROR=""
DEPS_LAST_RC=0

_deps_run() {
  # bounded_run when gitnet.sh provided it, plain command otherwise.
  local secs="$1" label="$2"; shift 2
  if declare -F bounded_run >/dev/null; then bounded_run "$secs" "$label" "$@"; else "$@"; fi
}

ensure_pinned_tags() {
  local dir="$1" pkg ref prefix name workspace tag tagsdir folder commons found=0 fetched=0
  DEPS_ERROR=""
  pkg="$dir/package.json"
  [[ -f "$pkg" ]] || return 0
  while IFS= read -r ref; do
    [[ -n "$ref" ]] || continue
    prefix="${ref%/*}"; name="${ref##*/}"
    tagsdir="$(cd "$dir" 2>/dev/null && cd "$prefix" 2>/dev/null && pwd -P || true)"
    [[ -n "$tagsdir" ]] || tagsdir="$(cd "$dir" && cd "$(dirname "$prefix")" 2>/dev/null && pwd -P)/$(basename "$prefix")"
    folder="$tagsdir/$name"
    [[ -d "$folder" ]] && continue
    workspace="${name%%-*}"; tag="${name#*-}"
    commons="${MAIPAI_COMMONS_REPO:-}"
    [[ -n "$commons" ]] || commons="$(dirname "$tagsdir")/commons"
    [[ -d "$commons/.git" || -f "$commons/.git" ]] || commons="$(cd "$dir/.." 2>/dev/null && pwd -P)/commons"
    if [[ ! -x "$commons/scripts/ensure-tag.sh" && ! -f "$commons/scripts/ensure-tag.sh" ]]; then
      DEPS_ERROR="the commons tag $tag is not checked out and the commons repository was not found; clone getmaipai/commons beside this checkout, then run: bash <commons>/scripts/ensure-tag.sh $workspace $tag"
      return 1
    fi
    if ! git -C "$commons" rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null 2>&1 && (( ! fetched )); then
      fetched=1
      if declare -F gitnet >/dev/null; then GITNET_LABEL="fetch commons tags" gitnet -C "$commons" fetch --tags origin >/dev/null 2>&1 || true
      else git -C "$commons" fetch --tags origin >/dev/null 2>&1 || true; fi
    fi
    if ! git -C "$commons" rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null 2>&1; then
      DEPS_ERROR="the commons tag $tag does not exist in $commons even after a fetch; check the pin, or run: bash $commons/scripts/ensure-tag.sh $workspace $tag"
      return 1
    fi
    if ! _deps_run "${DEPS_INSTALL_SECONDS:-600}" "ensure-tag $workspace $tag" bash "$commons/scripts/ensure-tag.sh" "$workspace" "$tag" >/dev/null 2>&1 || [[ ! -d "$folder" ]]; then
      DEPS_ERROR="could not create the worktree for commons tag $tag; run: bash $commons/scripts/ensure-tag.sh $workspace $tag"
      return 1
    fi
    found=1
  done < <(grep -Eo '"file:[^"]*/commons-tags/[^"/]+' "$pkg" 2>/dev/null | sed -E 's/^"file://' | sort -u)
  return 0
}

_deps_dangling_links() {
  local dir="$1" link
  for link in "$dir"/node_modules/@maipai/*; do
    [[ -L "$link" && ! -e "$link" ]] && { printf '%s\n' "${link#"$dir/"}"; return 0; }
  done
  return 1
}

install_deps() {
  local dir="$1" force="" attempt rc=0 bad label secs
  [[ "${2:-}" == --force ]] && force="--force"
  secs="${DEPS_INSTALL_SECONDS:-600}"; label="${DEPS_INSTALL_LABEL:-bun install $(basename "$dir")}"
  DEPS_ERROR=""; DEPS_LAST_RC=0
  ensure_pinned_tags "$dir" || { DEPS_LAST_RC=1; return 1; }
  for attempt in 1 2; do
    rc=0
    _deps_run "$secs" "$label" bash -c 'cd "$1" && shift && bun install --frozen-lockfile "$@"' _ "$dir" ${force:+"$force"} || rc=$?
    if (( rc == 0 )) && bad="$(_deps_dangling_links "$dir")"; then
      echo "deps.sh: $dir/$bad is a dangling link after install" >&2
      rc=1
    fi
    if (( rc == 0 )); then DEPS_LAST_RC=0; return 0; fi
    DEPS_LAST_RC="$rc"
    if (( attempt == 1 )); then
      echo "deps.sh: install in $dir failed (exit $rc); deleting its node_modules and trying once more" >&2
      case "$dir" in ""|/) ;; *) rm -rf "${dir:?}/node_modules" ;; esac
    fi
  done
  DEPS_ERROR="bun install failed twice in $dir (exit $rc)$([[ -n "${bad:-}" ]] && echo "; $bad stayed a dangling link")"
  return "$rc"
}
