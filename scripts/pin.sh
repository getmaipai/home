#!/usr/bin/env bash
set -euo pipefail

die() { echo "pin.sh: $1" >&2; exit "${2:-1}"; }
usage() { die "usage: bash scripts/pin.sh commons <core|spec|ui>-vX.Y.Z | stack <sha> | bot <version> [--no-land] [--dry-run]"; }
kind="${1:-}"; value="${2:-}"
[[ -n "$kind" && -n "$value" ]] || usage
shift 2
no_land=0; dry_run=0
for arg in "$@"; do case "$arg" in --no-land) no_land=1 ;; --dry-run) dry_run=1 ;; *) usage ;; esac; done
root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run this inside the Home worktree."
cd "$root"
branch="$(git branch --show-current)"
[[ "$branch" == wt/* ]] || die "branch '$branch' is not wt/*; switch to a wt/* worktree and run pin.sh again."
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "tracked changes are uncommitted; commit or discard them, then run pin.sh again."
sha_cmd="${MAIPAI_PIN_SHA256_CMD:-curl -fsSL \$1 | shasum -a 256 | cut -d' ' -f1}"
ensure_cmd="${MAIPAI_PIN_ENSURE_TAG_CMD:-bash ../commons/scripts/ensure-tag.sh}"
install_cmd="${MAIPAI_PIN_INSTALL_CMD:-bun install --force}"
stack_dir="${MAIPAI_PIN_STACK_DIR:-../stack}"
gh_cmd="${MAIPAI_PIN_GH_CMD:-gh}"
land_cmd="${MAIPAI_PIN_LAND_CMD:-bash scripts/land.sh}"
run_cmd() { local command="$1"; shift; bash -c "$command" -- "$@"; }
print_cmd() { printf '  %s\n' "$*"; }
changed=()
add_changed() { local item="$1" current; for current in "${changed[@]:-}"; do [[ "$current" == "$item" ]] && return; done; changed+=("$item"); }
case "$kind" in
  commons)
    [[ "$value" =~ ^(core|spec|ui)-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "malformed Commons pin '$value'; use <core|spec|ui>-vX.Y.Z."
    pkg="${value%%-*}"; tag="$value"; package_files=()
    for file in backend/package.json frontend/package.json; do
      if rg -q '"@maipai/'"$pkg"'"[[:space:]]*:[[:space:]]*"file:' "$file"; then
        rg -q '"@maipai/'"$pkg"'"[[:space:]]*:[[:space:]]*"file:[^"]*/'"$pkg-$tag"'/' "$file" && die "$tag is already pinned in $file; choose a new tag."
        package_files+=("$file")
      fi
    done
    ((${#package_files[@]} > 0)) || die "no package.json pin found for @maipai/$pkg; add the dependency first."
    for file in scripts/install.sh scripts/engine-computer/maipai-engine; do rg -q '^[[:space:]]*\*\)' "$file" || die "could not find commons_archive_sha256 default in $file; inspect it before retrying."; done
    digest_url="https://github.com/getmaipai/commons/archive/refs/tags/${tag}.tar.gz"
    add_changed scripts/install.sh; add_changed scripts/engine-computer/maipai-engine
    for file in "${package_files[@]}"; do add_changed "$file"; done
    if ((dry_run)); then
      printf 'Would change:\n'; printf '  %s\n' "${changed[@]}"
      print_cmd "$ensure_cmd $pkg $tag"; print_cmd "$sha_cmd $digest_url"
      for file in "${package_files[@]}"; do print_cmd "replace @maipai/$pkg path in $file"; done
      print_cmd "$install_cmd (cwd backend)"; print_cmd "$install_cmd (cwd frontend)"
    else
      run_cmd "$ensure_cmd" "$pkg" "$tag" || die "could not ensure $pkg $tag; check the Commons checkout and retry."
      digest="$(run_cmd "$sha_cmd" "$digest_url")" || die "digest command failed for $digest_url; check the command override or network, then retry."
      [[ "$digest" =~ ^[0-9a-fA-F]{64}$ ]] || die "digest command returned an invalid SHA-256 for $digest_url; fix the override and retry."
      for file in "${package_files[@]}"; do
        PIN_FILE="$file" PIN_PKG="$pkg" PIN_TAG="$tag" python3 - <<'PY'
import os, re
path, pkg, tag = os.environ["PIN_FILE"], os.environ["PIN_PKG"], os.environ["PIN_TAG"]
text = open(path).read()
pattern = re.compile(r'("@maipai/' + re.escape(pkg) + r'"\s*:\s*"file:[^"\n]*/)[^/"\n]+(/' + re.escape(pkg) + r'")')
updated, count = pattern.subn(lambda m: m.group(1) + pkg + "-" + tag + m.group(2), text, count=1)
if count != 1: raise SystemExit(f"could not replace @maipai/{pkg} pin in {path}")
open(path, "w").write(updated)
PY
      done
      for file in scripts/install.sh scripts/engine-computer/maipai-engine; do
        if ! rg -Fq "${tag})" "$file"; then
          PIN_FILE="$file" PIN_TAG="$tag" PIN_DIGEST="$digest" python3 - <<'PY'
import os, re
path, tag, digest = os.environ["PIN_FILE"], os.environ["PIN_TAG"], os.environ["PIN_DIGEST"]
text = open(path).read()
pattern = re.compile(r'(?m)^(\s*)\*\)')
updated, count = pattern.subn(lambda m: f'{m.group(1)}{tag}) printf \'%s\\n\' "{digest}" ;;\n{m.group(0)}', text, count=1)
if count != 1: raise SystemExit(f"could not add {tag} digest to {path}")
open(path, "w").write(updated)
PY
        fi
      done
      for dir in backend frontend; do (cd "$dir" && run_cmd "$install_cmd") || die "install command failed in $dir; fix the install and retry."; done
    fi
    message="Pin $tag"
    ;;
  stack)
    [[ "$value" =~ ^[0-9a-fA-F]{7,40}$ ]] || die "malformed Stack SHA '$value'; use 7 to 40 hexadecimal characters."
    [[ -d "$stack_dir/.git" || -f "$stack_dir/.git" ]] || die "Stack directory '$stack_dir' is missing; set MAIPAI_PIN_STACK_DIR to the Stack checkout."
    full_sha="$(git -C "$stack_dir" rev-parse --verify "$value^{commit}" 2>/dev/null)" || die "Stack SHA '$value' is unknown in $stack_dir; fetch or choose a valid commit."
    disk_plan="$(git -C "$stack_dir" show "$full_sha:docs/disk-plan.json" 2>/dev/null)" || die "Stack commit $value has no docs/disk-plan.json; choose a complete Stack commit."
    for file in scripts/install.sh scripts/engine-computer/maipai-engine; do rg -q '^STACK_TAG=' "$file" || die "could not find STACK_TAG in $file; inspect it before retrying."; add_changed "$file"; done
    add_changed shared/diskPlan.json
    if ((dry_run)); then
      printf 'Would change:\n'; printf '  %s\n' "${changed[@]}"
      print_cmd "replace STACK_TAG with $full_sha in both scripts"; print_cmd "git -C $stack_dir show $full_sha:docs/disk-plan.json > shared/diskPlan.json"
    else
      for file in scripts/install.sh scripts/engine-computer/maipai-engine; do sed -E "s/^STACK_TAG=?\"?[0-9a-fA-F]+\"?$/STACK_TAG=\"$full_sha\"/" "$file" > "$file.tmp" && mv "$file.tmp" "$file"; done
      printf '%s\n' "$disk_plan" > shared/diskPlan.json
    fi
    message="Pin Stack ${full_sha:0:7}"
    ;;
  bot)
    [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "malformed bot version '$value'; use X.Y.Z."
    pin_file=backend/src/lib/botReleasePin.json; add_changed "$pin_file"
    if ((dry_run)); then
      printf 'Would change:\n'; printf '  %s\n' "${changed[@]}"
      print_cmd "$gh_cmd release view v$value -R getmaipai/bot --json assets"; print_cmd "resolve assets and update $pin_file"
    else
      release_json="$(run_cmd "$gh_cmd" release view "v$value" -R getmaipai/bot --json assets)" || die "release v$value is missing or could not be read; check GitHub access and retry."
      if ! PIN_FILE="$pin_file" PIN_VERSION="$value" PIN_RELEASE="$release_json" python3 - <<'PY'
import json, os, subprocess
path, version = os.environ["PIN_FILE"], os.environ["PIN_VERSION"]
pin = json.load(open(path)); assets = json.loads(os.environ["PIN_RELEASE"]).get("assets", [])
for entry in pin.get("assets", {}).values():
    asset = next((a for a in assets if a.get("name") == entry.get("name")), None)
    if asset is None: raise SystemExit(f"release asset missing: {entry.get('name')}")
    entry["size"] = asset["size"]
    digest = asset.get("digest") or ""
    if digest.startswith("sha256:"): entry["sha256"] = digest.split(":", 1)[1]
    else:
        url = asset.get("url")
        if not url: raise SystemExit(f"release asset has no digest or URL: {entry.get('name')}")
        command = os.environ.get("MAIPAI_PIN_SHA256_CMD", "curl -fsSL $1 | shasum -a 256 | cut -d' ' -f1")
        result = subprocess.run(["bash", "-c", command, "--", url], text=True, capture_output=True)
        if result.returncode: raise SystemExit(f"digest command failed for {url}: {result.stderr.strip()}")
        digest = result.stdout.strip()
        if len(digest) != 64 or any(c not in "0123456789abcdefABCDEF" for c in digest): raise SystemExit(f"invalid SHA-256 for {entry.get('name')}")
        entry["sha256"] = digest
pin["version"] = version
with open(path, "w") as f: json.dump(pin, f, indent=2); f.write("\n")
PY
      then die "release asset missing or invalid; inspect release v$value and retry."; fi
    fi
    message="Pin bot $value"
    ;;
  *) die "unknown kind '$kind'; use commons, stack or bot." ;;
esac
if ((dry_run)); then
  printf 'Would commit: %s\n' "$message"
  print_cmd "git add -- ${changed[*]}"
  print_cmd "git commit -q -F <message and changed-file list>"
  ((no_land)) || print_cmd "$land_cmd"
  exit 0
fi
changed=()
while IFS= read -r file; do [[ -n "$file" ]] && changed+=("$file"); done < <(git diff --name-only)
((${#changed[@]} > 0)) || die "pin produced no file changes; choose a different pin."
body_file="$(mktemp)"; trap 'rm -f "$body_file"' EXIT
printf '%s\n\nFiles:\n' "$message" > "$body_file"
printf ' - %s\n' "${changed[@]}" >> "$body_file"
git add -- "${changed[@]}"
git commit -q -F "$body_file" || die "commit failed; inspect the staged pin changes and retry."
if ((no_land)); then printf 'Committed %s; landing skipped.\n' "$message"; exit 0; fi
run_cmd "$land_cmd" || die "landing failed; the pin commit remains on this worktree for review."
