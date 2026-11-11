#!/usr/bin/env bash
# BOOT-CHECK-01 (2026-11-11): start the real hub entry of a commit on a scratch data folder and wait for it to answer.
# Why: on 2026-11-11 a ship (--before-green) put a commit on the live hub whose entry crashed at boot ("Cannot access
# 'manifestCache' before initialization", an import cycle). Unit tests never start src/index.ts, so no gate saw it.
# usage: bash scripts/boot-check.sh [<sha>|HEAD]   (default HEAD; about 10 to 20 s warm). Exit 0 = booted and answered /healthz.
# It never touches the live hub: own port, own data folder, own lock, no engines, no mDNS. It kills only the pid it started.
# Dependencies: the commit's tree is exported with git archive; node_modules is a copy-on-write clone (cp -c, no extra disk writes)
# of this checkout's when the lockfiles match, and a real `bun install` only when they differ (so the check is never wrong, only slower).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
root="$PWD"
ref="${1:-HEAD}"
sha="$(git rev-parse --verify "$ref^{commit}")"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/maipai-bootcheck.XXXXXX")"
pid=""
cleanup() { [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; rm -rf "$tmp"; }
trap cleanup EXIT

paths=(backend shared)
for f in package.json bun.lock bun.lockb tsconfig.json; do git cat-file -e "$sha:$f" 2>/dev/null && paths+=("$f"); done
git archive "$sha" "${paths[@]}" | tar -x -C "$tmp"
# the commit's own lockfiles decide whether the donor node_modules is valid
same_lock=1
for f in bun.lock backend/bun.lock; do
  if git cat-file -e "$sha:$f" 2>/dev/null; then want="$(git show "$sha:$f" | shasum | cut -d' ' -f1)"; else want=none; fi
  if [[ -f "$root/$f" ]]; then have="$(shasum < "$root/$f" | cut -d' ' -f1)"; else have=none; fi
  [[ "$want" == "$have" ]] || same_lock=0
done
if [[ -d "$root/backend/node_modules" && $same_lock == 1 ]]; then
  [[ -d "$root/node_modules" ]] && cp -cR "$root/node_modules" "$tmp/node_modules" 2>/dev/null || true
  cp -cR "$root/backend/node_modules" "$tmp/backend/node_modules"
else
  (cd "$tmp/backend" && bun install --frozen-lockfile >/dev/null 2>&1) || { echo "boot-check: bun install failed for $sha" >&2; exit 1; }
fi
# repo-relative pieces the entry reads (the spec and core packages resolve through node_modules; the rest is in backend/)
port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
hub="$tmp/hub"; mkdir -p "$hub"
log="$tmp/boot.log"
(
  cd "$tmp/backend"
  MAIPAI_TEST_ALLOW_MULTIPLE_HUBS=1 MAIPAI_MDNS=off MAIPAI_LAN_EXPOSURE=loopback PORT="$port" \
    MAIPAI_DATA_DIR="$hub" MAIPAI_BACKUP_DIR="$hub/backups" MAIPAI_KEYSTORE_BACKEND=file \
    MAIPAI_TTS_DISABLE_SPAWN=1 MAIPAI_WYOMING_PORT=0 MAIPAI_BACKGROUND_URL=http://127.0.0.1:1 \
    MAIPAI_LLAMA_SERVER_URL= MAIPAI_EMBED_URL= MAIPAI_HUB_LOCK_PATH="$hub.lock" \
    nohup bun run src/index.ts </dev/null >"$log" 2>&1 &
  echo $! > "$tmp/pid"
)
pid="$(cat "$tmp/pid")"
for ((i = 0; i < 600; i++)); do
  if grep -q '^Home server ready\.$' "$log" 2>/dev/null; then
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/healthz" || true)"
    if [[ "$code" == 200 ]]; then echo "boot-check: ${sha:0:9} booted and answered /healthz in $((i / 10)) s"; exit 0; fi
  fi
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 0.1
done
echo "boot-check: ${sha:0:9} did NOT boot. Last log lines:" >&2
tail -15 "$log" | cut -c1-240 >&2
exit 1
