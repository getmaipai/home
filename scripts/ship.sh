#!/usr/bin/env bash
# Promote a landed commit to the live hub. --tag labels a shipped commit afterwards;
# the live .installed-tag remains sha-<first 7> so update checks do not treat it as a release.
set -euo pipefail
usage() { echo "usage: bash scripts/ship.sh [<sha>|main] [--before-green] [--tag] [--dry-run]" >&2; }
die() { echo "ship.sh: $1" >&2; exit "${2:-1}"; }
common="$(git rev-parse --git-common-dir 2>/dev/null)" || die "run this inside a Home checkout."
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
cd "$(git rev-parse --show-toplevel)"
git_env="${MAIPAI_LAND_GIT_ENV-$main/data-scratch/bin/https-git.env}"
[[ -z "$git_env" || ! -f "$git_env" ]] || source "$git_env"
data="${MAIPAI_SHIP_DATA:-$main/data-scratch/ship}"
watch="${MAIPAI_WATCH_DATA:-$main/data-scratch/watch}"
live="${MAIPAI_SHIP_LIVE:-/usr/local/maipai-home}"
promote="${MAIPAI_PROMOTE_BIN:-/usr/local/libexec/maipai-promote}"
sudo_cmd="${MAIPAI_SHIP_SUDO-sudo -n}"
stop_cmd="${MAIPAI_SHIP_STOP_DEV_CMD:-bash scripts/stop-dev-home.sh --live $live}"
health_cmd="${MAIPAI_SHIP_HEALTH_CMD:-}"
web_url="${MAIPAI_SHIP_WEB_URL:-http://localhost:3000/}"
stack_url="${MAIPAI_SHIP_STACK_URL:-http://127.0.0.1:8770/healthz}"
migrations_cmd="${MAIPAI_SHIP_MIGRATIONS_CMD:-sqlite3 -readonly $live/data/hub.db 'select count(*) from __drizzle_migrations'}"
publish_cmd="${MAIPAI_PUBLISH_CMD:-bash scripts/publish-release.sh TAG --latest NOTES}"
health_timeout="${MAIPAI_SHIP_HEALTH_TIMEOUT:-90}"
before_green=0; tag_after=0; dry=0; target=main
while (($#)); do case "$1" in --before-green) before_green=1;; --tag) tag_after=1;; --dry-run) dry=1;; main) target=main;; --*) usage; exit 2;; *) target="$1";; esac; shift; done
[[ "$target" == main || "$target" =~ ^[0-9a-f]{7,40}$ ]] || { usage; exit 2; }
git fetch origin || die "could not fetch origin; check network access and retry."
if [[ "$target" == main ]]; then sha="$(git rev-parse --verify 'origin/main^{commit}')" || die "could not resolve origin/main; fetch and retry."
else sha="$(git rev-parse --verify "$target^{commit}" 2>/dev/null)" || die "could not resolve $target to a commit; fetch or check the SHA and retry."; fi
git merge-base --is-ancestor "$sha" origin/main || die "${sha:0:7} is not on origin/main; land it first with bash scripts/land.sh"
label="sha-${sha:0:7}"
if (( ! before_green )) && [[ ! -f "$watch/green/$sha" ]]; then die "watcher has no green run for $sha; pass --before-green to ship anyway and record it."; fi
before_tag="$(cat "$live/.installed-tag" 2>/dev/null || echo none)"
if (( dry )); then printf 'plan: sha=%s label=%s live=%s current=%s before-green=%s tag=%s\n' "$sha" "$label" "$live" "$before_tag" "$([[ $before_green == 1 ]] && echo yes || echo no)" "$([[ $tag_after == 1 ]] && echo yes || echo no)"; exit 0; fi
if [[ ! -x "$promote" ]] || [[ "$(eval "$sudo_cmd \"$promote\" --check" 2>/dev/null || true)" != ok ]]; then die "promotion helper is not ready; run: sudo bash $main/scripts/install-promote.sh" 2; fi
if (( tag_after == 0 )) || [[ "$before_tag" != "$label" ]]; then
  mkdir -p "$data" || die "could not create ship log directory $data."
  eval "$stop_cmd" || die "could not stop the development Home; stop it and retry."
  before_migrations="$(eval "$migrations_cmd" 2>/dev/null || echo 0)"; [[ "$before_migrations" =~ ^[0-9]+$ ]] || before_migrations=0
  refused_file="$live/data/logs/launchd.err.log"; before_refused=0
  [[ -f "$refused_file" ]] && before_refused="$(grep -c 'app refused' "$refused_file" 2>/dev/null || true)" || true
  start="$(date +%s)"; log="$data/$start-${sha:0:7}.log"
  if ! eval "$sudo_cmd \"$promote\" \"$sha\"" >"$log" 2>&1; then promote_status=1; else promote_status=0; fi
  expected_live_tag="$label"
  health_ok() {
    if [[ -n "$health_cmd" ]]; then eval "$health_cmd"; return $?; fi
    [[ "$(curl -sS -o /dev/null -w '%{http_code}' "$web_url" 2>/dev/null || true)" == 200 ]] || return 1
    curl -sS "$stack_url" 2>/dev/null | grep -q '"ok":true' || return 1
    after_migrations="$(eval "$migrations_cmd" 2>/dev/null || echo 0)"; [[ "$after_migrations" =~ ^[0-9]+$ ]] && (( after_migrations >= before_migrations )) || return 1
    after_refused=0; [[ -f "$refused_file" ]] && after_refused="$(grep -c 'app refused' "$refused_file" 2>/dev/null || true)" || true
    (( after_refused <= before_refused )) && [[ "$(cat "$live/.installed-tag" 2>/dev/null || true)" == "$expected_live_tag" ]]
  }
  wait_health() { local deadline=$(( $(date +%s) + health_timeout )); while (( $(date +%s) <= deadline )); do health_ok && return 0; sleep 2; done; return 1; }
  result=shipped
  if (( promote_status != 0 )) || ! wait_health; then
    expected_live_tag="$before_tag"
    if eval "$sudo_cmd \"$promote\" --rollback" >>"$log" 2>&1 && wait_health; then result=rolled_back; outcome="rolled back to $(cat "$live/.installed-tag" 2>/dev/null || echo unknown)"; else result=rollback_failed; outcome="rollback failed: check $log and repair the live hub"; fi
    finish="$(date +%s)"; seconds=$((finish-start)); printf '{"ts":%s,"sha":"%s","label":"%s","before_tag":"%s","result":"%s","before_green":%s,"seconds":%s}\n' "$finish" "$sha" "$label" "$before_tag" "$result" "$([[ $before_green == 1 ]] && echo true || echo false)" "$seconds" >> "$data/shipped.jsonl"
    echo "$outcome"; exit 1
  fi
  finish="$(date +%s)"; seconds=$((finish-start)); printf '{"ts":%s,"sha":"%s","label":"%s","before_tag":"%s","result":"shipped","before_green":%s,"seconds":%s}\n' "$finish" "$sha" "$label" "$before_tag" "$([[ $before_green == 1 ]] && echo true || echo false)" "$seconds" >> "$data/shipped.jsonl"
  echo "shipped: $label live ($seconds s)"
fi
if (( tag_after )); then
  latest="$(git ls-remote --tags origin 'refs/tags/v[0-9]*' | awk -F/ '{print $NF}' | sed 's/\^{}//' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
  [[ -n "$latest" ]] || die "origin has no vX.Y.Z tag to increment; publish the first release tag manually."
  IFS=. read -r major minor patch <<< "${latest#v}"; next="v$major.$minor.$((patch + 1))"
  if git ls-remote --exit-code --tags origin "refs/tags/$next" >/dev/null 2>&1; then die "$next already exists on origin; fetch tags and retry with the next patch version."; fi
  if git show-ref --verify --quiet "refs/tags/$next"; then
    local_sha="$(git rev-parse "$next^{commit}")"
    local_subject="$(git show -s --format=%s "$local_sha")"
    local_date="$(git for-each-ref --format='%(taggerdate:short)' "refs/tags/$next")"
    [[ -n "$local_date" ]] || local_date="$(git show -s --format=%cs "$local_sha")"
    printf 'local tag %s points at %s "%s", tagged %s, not on origin\n' "$next" "${local_sha:0:7}" "$local_subject" "$local_date" >&2
    printf 'git tag -d %s\n' "$next" >&2
    exit 1
  fi
  changelog_section=0
  changelog_version="${next#v}"; changelog_version="${changelog_version//./\\.}"
  if [[ -f CHANGELOG.md ]] && grep -Eq "^## \\[${changelog_version}\\]([[:space:]]|$)" CHANGELOG.md; then changelog_section=1; fi
  notes_file=
  notes_args=
  if (( changelog_section )); then
    echo "notes: changelog section"
  else
    notes_file="$(mktemp "${TMPDIR:-/tmp}/maipai-release-notes.XXXXXX")"
    trap '[[ -z "${notes_file:-}" ]] || rm -f "$notes_file"' EXIT
    release_date="$(date +%F)"
    printf 'Release %s, cut from commit %s live on the hub on %s.\n' "$next" "${sha:0:7}" "$release_date" > "$notes_file"
    git log --format='- %s' --first-parent --reverse "$latest..$sha" >> "$notes_file"
    commit_count="$(git rev-list --first-parent --count "$latest..$sha")"
    printf 'notes: %s landed commits\n' "$commit_count"
    printf -v quoted_notes_file '%q' "$notes_file"
    notes_args="--notes-file $quoted_notes_file"
  fi
  git tag -a "$next" -m "$next" "$sha" || die "could not create $next; check local Git tag state."
  git push origin "$next" || die "could not push $next; check Git access and retry."
  publish="${publish_cmd//TAG/$next}"; publish="${publish//NOTES/$notes_args}"; eval "$publish" || die "published tag $next on GitHub, but the latest-release update failed; run the publish command again."
  echo "tagged $next at ${sha:0:7}"
fi
