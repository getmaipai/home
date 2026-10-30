#!/usr/bin/env bash
# Promote a landed commit to the live hub. --adopt-empty-live allows replacing an install
# when the running Home uses other data; migrate that data first whenever possible.
# --tag labels a shipped commit afterwards;
# the live .installed-tag remains sha-<first 7> so update checks do not treat it as a release.
set -euo pipefail
usage() { echo "usage: bash scripts/ship.sh status | bash scripts/ship.sh [<sha>|main] [--before-green] [--tag] [--dry-run] [--adopt-empty-live] [--reinstall] [--retry]" >&2; }
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
# The Stack's launchd service installs into this login's GUI domain; from a session without one the install stops with "Bootstrap failed: 5" (2026-10-28).
if [[ -n "${MAIPAI_SHIP_GUI_CHECK+x}" ]]; then gui_check="$MAIPAI_SHIP_GUI_CHECK"; elif [[ "$(uname)" == Darwin ]]; then gui_check='launchctl print "gui/$(id -u)" >/dev/null 2>&1'; else gui_check=""; fi
web_url="${MAIPAI_SHIP_WEB_URL:-http://localhost:3000/}"
# The installer records the port it gave the Stack; 8770 only when nothing was recorded.
stack_port="$({ tr -dc '0-9' < "$live/stack/.port"; } 2>/dev/null || true)"; stack_port="${stack_port:-8770}"
stack_url="${MAIPAI_SHIP_STACK_URL:-http://127.0.0.1:${stack_port}/healthz}"
migrations_cmd="${MAIPAI_SHIP_MIGRATIONS_CMD:-sqlite3 -readonly $live/data/hub.db 'select count(*) from __drizzle_migrations'}"
publish_cmd="${MAIPAI_PUBLISH_CMD:-bash scripts/publish-release.sh TAG --latest NOTES}"
health_timeout="${MAIPAI_SHIP_HEALTH_TIMEOUT:-90}"
# `ship.sh status` answers "is a release deploying right now?" in one line, for people and sessions to run before they say the hub is up or down
# (2026-10-30: a session reported the hub down without knowing a ship was installing; the lock below was there, nothing read it).
if [[ "${1:-}" == status ]]; then
  status_lock="${MAIPAI_SHIP_LOCK:-$data/ship.lock.d}"
  status_tag="$(cat "$live/.installed-tag" 2>/dev/null || echo unknown)"
  if [[ -n "$health_cmd" ]]; then if eval "$health_cmd" >/dev/null 2>&1; then status_hub=yes; else status_hub=no; fi
  elif curl -fsS -m 5 -o /dev/null "${web_url%/}/healthz" 2>/dev/null; then status_hub=yes; else status_hub=no; fi
  status_pid="$(cat "$status_lock/pid" 2>/dev/null || true)"
  if [[ "$status_pid" =~ ^[0-9]+$ ]] && kill -0 "$status_pid" 2>/dev/null; then
    echo "deploy: IN PROGRESS ($(cat "$status_lock/what" 2>/dev/null || echo unknown), running $(ps -o etime= -p "$status_pid" 2>/dev/null | tr -d ' ')); live tag $status_tag; hub answering: $status_hub. The hub can be down for a few minutes while it installs: wait for it, do not restart or ship anything."
  elif pgrep -f "$promote" >/dev/null 2>&1; then
    echo "deploy: IN PROGRESS (an install is running outside ship.sh); live tag $status_tag; hub answering: $status_hub. Wait for it to finish."
  else
    echo "deploy: none running; live tag $status_tag; hub answering: $status_hub."
  fi
  exit 0
fi
before_green=0; tag_after=0; dry=0; adopt_empty_live=0; reinstall=0; retry=0; target=main
while (($#)); do case "$1" in --before-green) before_green=1;; --tag) tag_after=1;; --dry-run) dry=1;; --adopt-empty-live) adopt_empty_live=1;; --reinstall) reinstall=1;; --retry) retry=1;; main) target=main;; --*) usage; exit 2;; *) target="$1";; esac; shift; done
[[ "$target" == main || "$target" =~ ^[0-9a-f]{7,40}$ ]] || { usage; exit 2; }
git fetch origin || die "could not fetch origin; check network access and retry."
if [[ "$target" == main ]]; then sha="$(git rev-parse --verify 'origin/main^{commit}')" || die "could not resolve origin/main; fetch and retry."
else sha="$(git rev-parse --verify "$target^{commit}" 2>/dev/null)" || die "could not resolve $target to a commit; fetch or check the SHA and retry."; fi
git merge-base --is-ancestor "$sha" origin/main || die "${sha:0:7} is not on origin/main; land it first with bash scripts/land.sh"
label="sha-${sha:0:7}"
if (( ! before_green )) && [[ ! -f "$watch/green/$sha" ]]; then die "watcher has no green run for $sha; pass --before-green to ship anyway and record it."; fi
# The live hub is the install on the Mac Studio. Keep its marker beside the
# install, not inside it: promotion replaces the install directory. Accept the
# old in-directory marker during migration from earlier ship.sh versions.
marker="${MAIPAI_SHIP_MARKER:-${live}.live-hub}"
legacy_marker="$live/.live-hub"
if [[ -z "${MAIPAI_SHIP_LIVE:-}" && ! -f "$marker" && ! -f "$legacy_marker" ]]; then
  die "this Mac is not marked as the live hub ($marker is missing). Run ship.sh on the Mac Studio, or release from here with localrelease. On the Studio, create the marker once: sudo touch $marker"
fi
lock_path="${MAIPAI_HUB_LOCK_PATH:-$HOME/.maipai/home/hub.lock}"
live_data="$live/data"
lock_pid= lock_data= lock_port=
if [[ -f "$lock_path" ]]; then
  lock_pid="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("pid", ""))' "$lock_path" 2>/dev/null || true)"
  lock_data="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("dataDir", ""))' "$lock_path" 2>/dev/null || true)"
  lock_port="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("port", ""))' "$lock_path" 2>/dev/null || true)"
fi
pid_alive=0; [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null && pid_alive=1 || true
web_listening=0
if [[ -n "${MAIPAI_SHIP_TEST_WEB_LISTENER:-}" ]]; then web_listening=1
elif command -v lsof >/dev/null && lsof -nP -iTCP:"${MAIPAI_SHIP_WEB_PORT:-3000}" -sTCP:LISTEN >/dev/null 2>&1; then web_listening=1; fi
if [[ -n "${MAIPAI_SHIP_TEST_PID_ALIVE:-}" ]]; then pid_alive=1; fi
other_data=0
if (( pid_alive || web_listening )); then
  if [[ -n "$lock_data" && -d "$lock_data" && -d "$live_data" ]]; then [[ "$(cd "$lock_data" && pwd -P)" != "$(cd "$live_data" && pwd -P)" ]] && other_data=1 || true; elif [[ -n "$lock_data" && "$lock_data" != "$live_data" ]]; then other_data=1; fi
fi
live_people=0; other_people=0; live_migrations=0; other_migrations=0
if command -v sqlite3 >/dev/null; then
  [[ -f "$live_data/hub.db" ]] && live_people="$(sqlite3 -readonly "$live_data/hub.db" 'select count(*) from people' 2>/dev/null || echo 0)" || true
  [[ -f "$live_data/hub.db" ]] && live_migrations="$(sqlite3 -readonly "$live_data/hub.db" 'select count(*) from __drizzle_migrations' 2>/dev/null || echo 0)" || true
  if [[ -n "$lock_data" && -f "$lock_data/hub.db" ]]; then
    other_people="$(sqlite3 -readonly "$lock_data/hub.db" 'select count(*) from people' 2>/dev/null || echo 0)"
    other_migrations="$(sqlite3 -readonly "$lock_data/hub.db" 'select count(*) from __drizzle_migrations' 2>/dev/null || echo 0)"
  fi
fi
guard_finding=0
if (( other_data )); then
  if [[ ! -f "$live_data/hub.db" ]]; then guard_finding=1
  elif (( live_people < other_people || live_migrations < other_migrations )); then guard_finding=1
  fi
fi
if (( guard_finding )); then
  finding="A Home is running on port ${lock_port:-${MAIPAI_SHIP_WEB_PORT:-3000}} using data directory $lock_data. Shipping would start an empty Home from $live_data. Migrate the data into the live install first, or ship to a machine whose live install already holds the data."
  if (( dry )); then echo "ship.sh: $finding" >&2; exit 1; fi
  (( adopt_empty_live )) || die "$finding Pass --adopt-empty-live only to override this guard."
fi
before_tag="$(cat "$live/.installed-tag" 2>/dev/null || echo none)"
# One ship at a time (2026-10-29: two sessions shipped at once, both installs and both rollbacks collided and the hub was down for minutes).
# The lock is a directory in the shared ship data folder, so every worktree and session sees it. A second ship waits for the first, then
# looks again at what is live: a hub that already runs this commit, or a newer one that includes it, needs no install.
lock_dir="${MAIPAI_SHIP_LOCK:-$data/ship.lock.d}"; lock_wait="${MAIPAI_SHIP_LOCK_WAIT:-900}"; held_lock=0
release_lock() { if (( held_lock )); then rm -rf "$lock_dir"; held_lock=0; fi; }
if (( ! dry )); then
  mkdir -p "$(dirname "$lock_dir")" || die "could not create the ship data folder $(dirname "$lock_dir")."
  waited=0; wait_started="$(date +%s)"
  until mkdir "$lock_dir" 2>/dev/null; do
    owner_pid="$(cat "$lock_dir/pid" 2>/dev/null || true)"
    if [[ "$owner_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$owner_pid" 2>/dev/null; then echo "ship.sh: the ship that held the lock (pid $owner_pid) is gone; clearing its lock." >&2; rm -rf "$lock_dir"; continue; fi
    (( waited < lock_wait )) || die "another ship ($(cat "$lock_dir/what" 2>/dev/null || echo unknown)) is still running after ${lock_wait}s; wait for it, then run ship.sh again."
    (( waited % 30 )) || echo "ship.sh: waiting for another ship to finish ($(cat "$lock_dir/what" 2>/dev/null || echo starting)); ${waited}s so far." >&2
    sleep 2; waited=$((waited + 2))
  done
  held_lock=1; echo "$$" > "$lock_dir/pid"; echo "$label from $(hostname -s) pid $$" > "$lock_dir/what"
  trap release_lock EXIT
  before_tag="$(cat "$live/.installed-tag" 2>/dev/null || echo none)"
  # A ship of this very commit that failed while this one waited has just shown that the install does not work: repeating it only
  # stops the service again (2026-10-30: three ships of one commit in a row each failed, each stopped the hub and each rollback failed).
  if (( waited > 0 && ! retry && ! reinstall )) && [[ -f "$data/shipped.jsonl" ]]; then
    failed_line="$(python3 - "$data/shipped.jsonl" "$sha" "$wait_started" <<'PY'
import json, sys
path, sha, since = sys.argv[1], sys.argv[2], int(sys.argv[3])
last = None
for line in open(path):
    try:
        row = json.loads(line)
    except ValueError:
        continue
    try:
        at = int(row.get("ts", 0))
    except (TypeError, ValueError):
        continue
    if row.get("sha") == sha and at >= since:
        last = row
if last and last.get("result") != "shipped":
    print(last.get("result"))
PY
)"
    if [[ -n "$failed_line" ]]; then die "another ship of $label failed while this one waited (${failed_line}), so installing it again would only stop the hub again. Read the log in $data, fix the cause, then run ship.sh --retry."; fi
  fi
  # A ship that finished while this one waited may already include this commit.
  live_ref="${before_tag#sha-}"; live_sha="$(git rev-parse --verify -q "${live_ref}^{commit}" 2>/dev/null || true)"
  if (( ! reinstall )) && [[ -n "$live_sha" && "$live_sha" != "$sha" ]] && git merge-base --is-ancestor "$sha" "$live_sha" 2>/dev/null; then
    echo "ship.sh: the live hub already runs $before_tag, which includes $label; nothing to do. Pass --reinstall to install it again anyway."; exit 0
  fi
fi
# Re-promoting the commit that is already live gains nothing and can break a working hub: on 2026-10-27 a second ship of an
# installed commit failed part way, left the install without its dependencies and took the family's hub down. When the live tag
# is this commit and the hub answers, stop. A hub that is not answering still gets the install (that is a repair), and
# --reinstall forces it.
if (( ! reinstall )) && (( tag_after == 0 )) && [[ "$before_tag" == "$label" ]]; then
  if [[ -n "$health_cmd" ]]; then eval "$health_cmd" >/dev/null 2>&1 && live_answers=1 || live_answers=0
  elif [[ "$(curl -sS -o /dev/null -w '%{http_code}' "$web_url" 2>/dev/null || true)" == 200 ]] && curl -sS "$stack_url" 2>/dev/null | grep -q '"ok":true'; then live_answers=1; else live_answers=0; fi
  if (( live_answers )); then echo "ship.sh: $label is already live and the hub answers; nothing to do. Pass --reinstall to install it again anyway."; exit 0; fi
fi
if (( dry )); then printf 'plan: sha=%s label=%s live=%s current=%s before-green=%s tag=%s\n' "$sha" "$label" "$live" "$before_tag" "$([[ $before_green == 1 ]] && echo yes || echo no)" "$([[ $tag_after == 1 ]] && echo yes || echo no)"; exit 0; fi
if [[ ! -x "$promote" ]] || [[ "$(eval "$sudo_cmd \"$promote\" --check" 2>/dev/null || true)" != ok ]]; then die "promotion helper is not ready; run: sudo bash $main/scripts/install-promote.sh" 2; fi
if (( tag_after == 0 )) || [[ "$before_tag" != "$label" ]]; then
  if [[ -n "$gui_check" ]] && ! eval "$gui_check"; then die "this session has no desktop login (launchd gui domain), so the Stack's service cannot install. Nothing was stopped or changed. Run ship.sh from Terminal on the Mac's own screen, logged in as the console user."; fi
  mkdir -p "$data" || die "could not create ship log directory $data."
  # Do not cut off a picture, clip or chat someone is waiting on: wait for the engine to go quiet, then go on and say what was running.
  busy_cmd="${MAIPAI_SHIP_BUSY_CMD:-curl -fsS -m 5 http://127.0.0.1:${stack_port}/stack/v1/jobs | python3 -c 'import json,sys; print(sum(1 for j in json.load(sys.stdin).get(\"jobs\", []) if j.get(\"state\") in (\"queued\", \"running\")))'}"
  quiet_wait="${MAIPAI_SHIP_QUIET_WAIT:-180}"; quiet_for=0
  while :; do
    busy="$(eval "$busy_cmd" 2>/dev/null || echo 0)"; [[ "$busy" =~ ^[0-9]+$ ]] || busy=0
    (( busy > 0 )) || break
    if (( quiet_for >= quiet_wait )); then echo "ship.sh: $busy engine job(s) are still running after ${quiet_wait}s; installing anyway, they will be interrupted." >&2; break; fi
    (( quiet_for % 30 )) || echo "ship.sh: waiting for $busy running engine job(s) to finish before the install; ${quiet_for}s so far." >&2
    sleep 5; quiet_for=$((quiet_for + 5))
  done
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
    if eval "$sudo_cmd \"$promote\" --rollback" >>"$log" 2>&1 && wait_health; then result=rolled_back; outcome="rolled back to $(cat "$live/.installed-tag" 2>/dev/null || echo unknown)"; else
      result=rollback_failed
      if curl -fsS "$web_url" >/dev/null 2>&1; then answering="answering"; else answering="not answering"; fi
      active_data="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("dataDir", "unknown"))' "$lock_path" 2>/dev/null || echo unknown)"
      outcome="Rollback failed. The live hub is $answering at $web_url and uses data directory $active_data. Check the install log at $log."
    fi
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
    trap '[[ -z "${notes_file:-}" ]] || rm -f "$notes_file"; release_lock' EXIT
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
