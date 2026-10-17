#!/usr/bin/env bash
# Screenshot gallery: every image the repo keeps, grouped by folder, in a local page.
#
#   bash scripts/gallery.sh             latest origin/main (fetches first)
#   bash scripts/gallery.sh --worktree  this checkout's files instead
#   bash scripts/gallery.sh --no-open   do not run `open` on the URL
#   bash scripts/gallery.sh --stop      stop the gallery server
#
# Output is data-scratch/gallery (git-ignored). The server is python3 -m http.server on
# 127.0.0.1, started from that folder, so it never serves the repo root. Its pid and port
# are recorded in the folder; --stop and a rerun only ever stop that recorded pid, and only
# while it is still a python http.server. The only network use is the git fetch.
set -euo pipefail

SOURCES=(docs/assets docs/design/assets docs/site-fumadocs/public/screens frontend/public/setup-art frontend/public/chat-art)
FETCH_SECONDS=30

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
out="$root/data-scratch/gallery"
mode=origin
want_open=1
stop_only=0

for arg in "$@"; do
  case "$arg" in
    --worktree) mode=worktree ;;
    --no-open) want_open=0 ;;
    --stop) stop_only=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "gallery: unknown option $arg; use --worktree, --no-open or --stop." >&2; exit 2 ;;
  esac
done

# Stop the server recorded in the folder, only if that pid is still our http.server.
stop_server() {
  local pid cmd
  [[ -f "$out/server.pid" ]] || { echo "gallery: no server recorded."; return 0; }
  pid="$(cat "$out/server.pid")"
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ "$cmd" == *"http.server"* && "$cmd" == *"127.0.0.1"* ]]; then
    kill "$pid" 2>/dev/null || true
    echo "gallery: stopped server pid $pid."
  else
    echo "gallery: recorded pid $pid is not a gallery server any more; left alone."
  fi
  rm -f "$out/server.pid" "$out/server.port"
}

if [[ "$stop_only" == 1 ]]; then stop_server; exit 0; fi

# Run a command, give up after N seconds. Returns 124 on timeout.
run_limited() {
  local secs="$1"; shift
  "$@" & local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( i >= secs * 5 )); then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; return 124; fi
    sleep 0.2; i=$((i + 1))
  done
  wait "$pid"
}

mkdir -p "$out"
stop_server >/dev/null
rm -rf "$out/files" "$out/index.html"
mkdir -p "$out/files"

if [[ "$mode" == origin ]]; then
  rc=0
  run_limited "$FETCH_SECONDS" git -C "$root" fetch -q origin main || rc=$?
  if [[ "$rc" == 124 ]]; then
    echo "gallery: fetch timed out; retrying over ssh.github.com port 443." >&2
    rc=0
    GIT_SSH_COMMAND="ssh -o HostName=ssh.github.com -p 443 -o ConnectTimeout=15" \
      run_limited "$FETCH_SECONDS" git -C "$root" fetch -q origin main || rc=$?
  fi
  if [[ "$rc" != 0 ]]; then
    git -C "$root" rev-parse -q --verify origin/main >/dev/null \
      || { echo "gallery: could not fetch origin/main and there is no local copy; check the network and rerun." >&2; exit 1; }
    echo "gallery: fetch failed; using the last known origin/main." >&2
  fi
  sha="$(git -C "$root" rev-parse --short origin/main)"
  label="origin/main $sha"
  present=()
  for d in "${SOURCES[@]}"; do
    [[ -n "$(git -C "$root" ls-tree --name-only origin/main -- "$d")" ]] && present+=("$d")
  done
  [[ ${#present[@]} -gt 0 ]] || { echo "gallery: origin/main has none of the screenshot folders." >&2; exit 1; }
  git -C "$root" archive origin/main -- "${present[@]}" | tar -x -C "$out/files"
else
  label="working copy $(git -C "$root" rev-parse --short HEAD)"
  present=()
  for d in "${SOURCES[@]}"; do [[ -d "$root/$d" ]] && present+=("$d"); done
  [[ ${#present[@]} -gt 0 ]] || { echo "gallery: this checkout has none of the screenshot folders." >&2; exit 1; }
  tar -C "$root" --exclude node_modules -cf - "${present[@]}" | tar -x -C "$out/files"
fi

python3 "$here/gallery.py" "$out" "$label"

port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
cd "$out"
nohup python3 -m http.server "$port" --bind 127.0.0.1 >"$out/server.log" 2>&1 </dev/null &
echo $! > "$out/server.pid"
echo "$port" > "$out/server.port"
url="http://127.0.0.1:$port/"

for _ in $(seq 1 50); do
  curl -s -o /dev/null "$url" && break
  sleep 0.1
done
curl -s -o /dev/null -w '' "$url" || { echo "gallery: the server did not start; see $out/server.log." >&2; exit 1; }

echo "gallery: $label"
echo "$url"
if [[ "$want_open" == 1 && "$(uname)" == Darwin ]]; then open "$url"; fi
