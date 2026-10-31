#!/usr/bin/env bash
# DISK-MAP-01: one small state map instead of walking worktrees.
#   bash scripts/worktree-map.sh build        write data-scratch/state/worktrees.json atomically
#   bash scripts/worktree-map.sh read <branch> print one entry
# Env seams: MAIPAI_SESSIONS_DIR, MAIPAI_MAP_FILE, MAIPAI_LAND_DATA. bash 3.2 compatible.
set -euo pipefail
umask 077

error() { echo "worktree-map.sh: $1" >&2; }
common="$(git rev-parse --git-common-dir 2>/dev/null)" || { error "not inside a git checkout; run this from the repo."; exit 1; }
[[ "$common" = /* ]] || common="$(cd "$(dirname "$common")" && pwd -P)/$(basename "$common")"
main="$(cd "$(dirname "$common")" && pwd -P)"
sessions="${MAIPAI_SESSIONS_DIR:-$main/data-scratch/sessions}"
map="${MAIPAI_MAP_FILE:-$main/data-scratch/state/worktrees.json}"
land_data="${MAIPAI_LAND_DATA:-$main/data-scratch/land}"

build() {
  mkdir -p "$(dirname "$map")"
  local tmp wt
  tmp="$(mktemp "$(dirname "$map")/.worktrees.XXXXXX")"
  wt="$(git -C "$main" worktree list --porcelain 2>/dev/null || true)"
  if printf '%s\n' "$wt" | python3 -c '
import json, os, sys, time, datetime
sessions, land_data = sys.argv[1], sys.argv[2]
now = time.time()
trees = {}
cur = None
for line in sys.stdin.read().splitlines():
    if line.startswith("worktree "):
        cur = {"path": line[9:], "branch": ""}
        trees[cur["path"]] = cur
    elif line.startswith("branch ") and cur is not None:
        b = line[7:]
        cur["branch"] = b[11:] if b.startswith("refs/heads/") else b
queued = set()
try:
    for n in os.listdir(os.path.join(land_data, "queue")):
        if n.endswith(".json"):
            try: queued.add(json.load(open(os.path.join(land_data, "queue", n))).get("branch", ""))
            except Exception: pass
except OSError: pass
def age_of(p):
    try: return max(0, int(now - os.stat(p).st_mtime))
    except OSError: return None
entries = {}
try: names = sorted(os.listdir(sessions))
except OSError: names = []
for n in names:
    if not n.endswith(".json"): continue
    try: s = json.load(open(os.path.join(sessions, n)))
    except Exception: continue
    name = n[:-5]
    branch = s.get("branch") or ""
    path = s.get("path") or ""
    rs = str(s.get("runState", "")).upper()
    beat = age_of(os.path.join(sessions, name + ".beat"))
    if beat is None: beat = age_of(os.path.join(sessions, n))
    if branch in queued: state = "queued"
    elif rs in ("LANDED",): state = "landed"
    elif rs in ("DONE", "KEPT"): state = "kept"
    else: state = "working"
    entries[branch or path] = {"path": path, "branch": branch, "session": name, "state": state, "heartbeatAgeSeconds": beat}
for p, t in trees.items():
    if t["branch"] and t["branch"] not in entries and p != "" and "/wt/" in p + "/":
        entries[t["branch"]] = {"path": p, "branch": t["branch"], "session": "", "state": "queued" if t["branch"] in queued else "kept", "heartbeatAgeSeconds": None}
out = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "entries": list(entries.values())}
json.dump(out, sys.stdout, indent=1)
' "$sessions" "$land_data" > "$tmp"; then
    mv -f "$tmp" "$map"
  else
    rm -f "$tmp"; error "could not build the map; check python3 and git, then retry."; return 1
  fi
}

read_one() {
  local branch="${1:-}"
  [[ -n "$branch" ]] || { error "usage: bash scripts/worktree-map.sh read <branch>"; return 2; }
  [[ -f "$map" ]] || build
  python3 -c '
import json, sys
for e in json.load(open(sys.argv[1])).get("entries", []):
    if e.get("branch") == sys.argv[2] or e.get("session") == sys.argv[2]:
        print(json.dumps(e)); sys.exit(0)
sys.exit(1)' "$map" "$branch" || { error "no entry for $branch; run build and check the branch name."; return 1; }
}

counts() {
  local age=999999
  if [[ -f "$map" ]]; then age=$(( $(date +%s) - $(python3 -c 'import os,sys;print(int(os.stat(sys.argv[1]).st_mtime))' "$map") )); fi
  (( age > 120 )) && build
  python3 -c '
import json, sys
c = {"working": 0, "queued": 0, "landed": 0, "kept": 0}
for e in json.load(open(sys.argv[1])).get("entries", []): c[e["state"]] = c.get(e["state"], 0) + 1
print("worktrees: " + ", ".join("%d %s" % (v, k) for k, v in c.items()))' "$map"
}

case "${1:-}" in
  build) build ;;
  read) read_one "${2:-}" ;;
  counts) counts ;;
  *) error "usage: bash scripts/worktree-map.sh build | read <branch> | counts"; exit 2 ;;
esac
