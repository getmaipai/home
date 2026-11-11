#!/usr/bin/env bash
# BOOT-CHECK-01 (2026-11-11): start the real hub entry of THIS checkout's HEAD on a scratch data folder and wait for it to answer.
# Why: on 2026-11-11 a ship (--before-green) put a commit on the live hub whose entry crashed at boot ("Cannot access
# 'manifestCache' before initialization", an import cycle). Unit tests never start src/index.ts, so no gate saw it.
# usage: bash scripts/boot-check.sh [<sha>]   Run it in a worktree whose HEAD is the commit; a <sha> that is not HEAD is refused (the
#   packages resolve through paths beside the checkout, so the commit must be checked out, not exported). About 30 s. Exit 0 = the entry
#   printed "Home server ready." and its server answers HTTP.
# It never touches the live hub: own port, own data folder, own lock, no engines, no mDNS. It kills only the pid it started.
# Dependencies: an incremental `bun install --frozen-lockfile` first, so a node_modules older than the lockfile (a rebase does not
# reinstall) cannot make the check wrong; it is a no-op when nothing changed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
root="$PWD"
head_sha="$(git rev-parse HEAD)"
if [[ -n "${1:-}" ]]; then
  want="$(git rev-parse --verify "$1^{commit}")"
  [[ "$want" == "$head_sha" ]] || { echo "boot-check: ${want:0:9} is not this checkout's HEAD (${head_sha:0:9}); check it out in a worktree first." >&2; exit 2; }
fi
git diff --quiet HEAD -- backend shared 2>/dev/null || { echo "boot-check: backend or shared has uncommitted changes; commit them so the check tests the commit." >&2; exit 2; }
sha="$head_sha"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/maipai-bootcheck.XXXXXX")"
pid=""
cleanup() { [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; rm -rf "$tmp"; }
trap cleanup EXIT

if grep -q workspaces package.json 2>/dev/null; then installdir="$root"; else installdir="$root/backend"; fi
(cd "$installdir" && bun install --frozen-lockfile >"$tmp/install.log" 2>&1) || { echo "boot-check: bun install failed for ${sha:0:9}:" >&2; tail -5 "$tmp/install.log" >&2; exit 1; }

port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
hub="$tmp/hub"; mkdir -p "$hub"
log="$tmp/boot.log"
(
  cd "$root/backend"
  MAIPAI_TEST_ALLOW_MULTIPLE_HUBS=1 MAIPAI_MDNS=off MAIPAI_LAN_EXPOSURE=loopback PORT="$port" \
    MAIPAI_DATA_DIR="$hub" MAIPAI_BACKUP_DIR="$hub/backups" MAIPAI_KEYSTORE_BACKEND=file \
    MAIPAI_TTS_DISABLE_SPAWN=1 MAIPAI_WYOMING_PORT=0 MAIPAI_BACKGROUND_URL=http://127.0.0.1:1 \
    MAIPAI_LLAMA_SERVER_URL= MAIPAI_EMBED_URL= MAIPAI_HUB_LOCK_PATH="$hub.lock" \
    nohup bun run src/index.ts </dev/null >"$log" 2>&1 &
  echo $! > "$tmp/pid"
)
pid="$(cat "$tmp/pid")"
code=""
for ((i = 0; i < 1800; i++)); do
  if grep -q '^Home server ready\.$' "$log" 2>/dev/null; then
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/healthz" || true)"
    if [[ "$code" =~ ^[2-5][0-9][0-9]$ ]]; then echo "boot-check: ${sha:0:9} booted and the server answers (HTTP $code) in $((i / 10)) s"; exit 0; fi
  fi
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 0.1
done
echo "boot-check: ${sha:0:9} did NOT boot (last answer: ${code:-none}). Last log lines:" >&2
tail -15 "$log" | cut -c1-240 >&2
exit 1
