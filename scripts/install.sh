#!/usr/bin/env bash
# MaiPai Home installer for macOS and Linux. Installs the latest tagged
# release (never `main` - "the hub deploys from the latest release tag,
# not from main, so main can break without breaking the house") into a
# fixed system location, registers it as a background service (launchd
# on macOS, systemd on Linux) so it survives a reboot with no one logged
# in, and starts it. Also installs the MaiPai Stack (docs/dev.md's "The
# Stack inside Home's installer, designed", HOME-STACK-01): the Stack has
# no release or installer of its own (stack/AGENTS.md's own Limits), so
# this installer places it too, compiled locally from a pinned commit
# (STACK_TAG below), as the household's own logged-in account rather
# than this script's own root/system service (the Stack spawns engines
# that need a real GUI session's Metal/GPU access; Home's own service
# stays root, headless-correct, since it needs neither).
#
# Usage: curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | bash
#        bash scripts/install.sh --dry-run   # see "Dry run" below
#        bash scripts/install.sh --plan recommended|moderate|minimal
#
# Idempotent: re-running upgrades an existing install in place (stop,
# snapshot data/, replace the source tree, keep data/backups untouched,
# restart) - the Stack's own binary is rebuilt from STACK_TAG and its
# service restarted the same way. A run that stopped part way is finished
# by running the same command again. `--rollback` goes back to the
# previous release and the data snapshot taken just before the upgrade.
#
# Ports: MAIPAI_PORT (Home, default 3000) and MAIPAI_STACK_PORT (Stack,
# default 8770) move either one; both are written into Home's service so
# the running app agrees with the installer.
set -euo pipefail

if [ "${1:-}" = "--check" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  exec bun --cwd "${script_dir}/../backend" -e 'import { checkInstallPreflight } from "./src/lib/installPreflight.ts"; console.log(JSON.stringify(await checkInstallPreflight(), null, 2));'
fi

REPO="getmaipai/home"
STACK_REPO="getmaipai/stack"
# HOME-STACK-01: the Stack has no release of its own, so this is a
# commit, not a tag - bumped by whoever cuts a Home release, to whatever
# stack commit that release is meant to carry (docs/dev.md's own "What
# Home's release carries" paragraph). Today's value binds Muse Glimmer 30B
# as the chat model above 24 GB (STACK-MUSE-01, owner's rule 2026-10-16)
# on top of vision URL binding and the embed role on the processor, and
# carries the Muse projector pin (VISION-03a), keep-warm (STACK-WARM-01),
# the Instant judge role (INSTANT-02), the Pocket TTS requirements fix and
# the Chatterbox Turbo voice engine (VOICE-STUDIO-01), voices made from a clip with their own temperature and pitch (VOICES-02) and, from 2026-10-21, the optional Qwen3.6-35B-A3B chat model and a chat-model choice that survives a restart (MODEL-SWITCH-01) and the media job that finishes a companion character's clip (CMEDIA-STACK-01). A bump to this line
# must be checked against every one of those: an old value silently rebuilds
# the Stack without them.
STACK_TAG="47a9a31a719b67552f0acbcda4c641a0ab73b958"
# The Stack at STACK_TAG names its Commons packages in backend/package.json as
# file:../../commons-tags/<package>-<tag>/<package> (core-v0.1.0 and spec-v0.1.136 today). Those
# names are read from that file after the Stack is fetched (stack_commons_deps), so they cannot
# drift from STACK_TAG. What is pinned here is only the digest of GitHub's archive for each tag
# (commons_archive_sha256); the digest is verified before anything is extracted. A Stack bump that
# names a tag with no digest here stops with a message that says which one to add. The same table
# is in scripts/engine-computer/maipai-engine (its update), and a test keeps the two equal.
INSTALL_ROOT_LINUX="/opt/maipai-home"
INSTALL_ROOT_DARWIN="/usr/local/maipai-home"
SERVICE_USER="maipai"
DEFAULT_APP_PORT=3000
APP_PORT="${MAIPAI_PORT:-$DEFAULT_APP_PORT}"
# backend/src/lib/ports.ts is the app's side of these two names.
STACK_PORT_BASE="${MAIPAI_STACK_PORT:-8770}"
UPGRADE_KEEP=2
LOG_ROTATE_MAX_MB=20
ENGINE_STACK_USER=maipai-stack
ENGINE_STACK_ROOT=/opt/maipai-stack
ENGINE_STACK_DATA=/data/stack

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

valid_plan() {
  case "$1" in recommended|moderate|minimal) return 0 ;; *) return 1 ;; esac
}

record_setup_plan() {
  local data_dir="$1" requested="$2" dry_run="$3" record="${1}/setup-plan"
  if [ -n "$requested" ]; then
    if [ "$dry_run" = "yes" ]; then
      log "[dry-run] would record setup plan ${requested} in ${record}"
    else
      mkdir -p "$data_dir"
      printf '%s\n' "$requested" > "$record"
      chmod 0600 "$record"
      log "Recorded setup plan ${requested}. The setup wizard will use it after its checks."
    fi
  elif [ -f "$record" ]; then
    log "Keeping the saved setup plan $(cat "$record")."
  fi
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "this installer registers a system service and must run as root (try: sudo bash install.sh)"
  fi
}

detect_os() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "darwin" ;;
    *) die "unsupported OS: $(uname -s) - MaiPai Home installs on macOS and Linux only (Windows: see install.ps1)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
}

# GitHub's own public release API, no auth - the org standard's one
# periodic outbound call, mirrored here at install time the same way
# backend/src/lib/updates.ts checks it after install (see
# docs/dev/session-f.md's step 10). A person runs this installer once,
# never in a loop, so no rate limiter is needed at this single call site.
latest_tag() {
  local tag
  # Only Home's own release tags (v0.1.0, v1.2.3-rc1) count. The repo also
  # publishes data releases under other tag names (search-assist-weights-v2
  # was GitHub's "latest" on 2026-10-16), and installing one of those would
  # silently put an old snapshot of Home on the computer. The list is newest
  # first; the first v-tag wins.
  tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=30" \
    | grep -o '"tag_name": *"[^"]*"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' \
    | grep -m1 -E '^v[0-9]+(\.[0-9]+)*([-.][0-9A-Za-z.-]+)?$' || true)
  [ -n "$tag" ] || die "could not find a published Home release (a v0.1.0-style tag) for ${REPO} yet - there is nothing to install. Cut a release, then run the installer again."
  echo "$tag"
}

# The TypeScript preflight (backend/src/lib/installPreflight.ts, the one
# definition the wizard's checks share). It imports Home's own packages,
# so it can only run once Bun is installed and the fetched backend has its
# dependencies: main() calls it right after build_app(), before the Stack
# build and before any service starts. Earlier versions ran it first, with
# `bun` from PATH and `../backend` next to this script: under `sudo` (a
# reset PATH) or `curl ... | bash` (no script directory) neither exists,
# so every real install died before doing anything.
run_install_preflight() {
  local bun_bin="$1" backend_dir="$2" port="$3"
  local preflight_json blockers
  [ -x "$bun_bin" ] || die "Could not check this computer before install: the Bun runtime at ${bun_bin} is missing. Run the installer again."
  [ -d "$backend_dir" ] || die "Could not check this computer before install: ${backend_dir} is missing. Run the installer again."
  preflight_json=$(cd "$backend_dir" && PORT="$port" "$bun_bin" -e 'import { checkInstallPreflight } from "./src/lib/installPreflight.ts"; console.log(JSON.stringify(await checkInstallPreflight()));') \
    || die "Could not check this computer before install. Check that Bun runs (${bun_bin} --version), then run the installer again."
  blockers=$(printf '%s' "$preflight_json" | "$bun_bin" -e 'const rows = JSON.parse(await Bun.stdin.text()); const blocked = rows.filter((row) => row.severity === "critical" || row.severity === "error"); for (const row of blocked) console.error(`${row.title}: ${row.text} Fix: ${row.fix?.label ?? "Check the system and try again."}`); console.log(blocked.length);')
  [ "$blockers" = "0" ] || die "This computer did not pass the install checks. Follow the fixes above, then run the installer again."
}

# Finds a free TCP port starting at the requested one, so a box that
# already has something on 3000 (or a previous manual run still holding
# it) gets a working install instead of a service that fails to bind.
# Checked with the same tool every platform ships (`curl` to localhost is
# unreliable pre-bind; a raw connect attempt via /dev/tcp is bash-native
# and needs nothing extra installed).
port_in_use() {
  local port="$1"
  (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}

# True when a MaiPai Stack answers its liveness check on this port, so a
# port held by the Stack being upgraded is not mistaken for a stranger's.
stack_answers_on() {
  curl -sf -m 3 "http://127.0.0.1:${1}/healthz" 2>/dev/null | grep -q '"ok":true'
}

find_free_port() {
  local port="$1"
  local tries=0
  while port_in_use "$port"; do
    tries=$((tries + 1))
    [ "$tries" -lt 50 ] || die "could not find a free port near ${1} after 50 tries"
    port=$((port + 1))
  done
  echo "$port"
}

valid_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

valid_release_tag() {
  printf '%s' "$1" | grep -Eq '^(v[0-9]+(\.[0-9]+)*([-.][0-9A-Za-z.-]+)?|sha-[0-9a-f]{7,40})$'
}

source_mirror_path() {
  local root="${1:-${MAIPAI_INSTALL_ROOT:-${SOURCE_INSTALL_ROOT:-$INSTALL_ROOT_DARWIN}}}"
  echo "${MAIPAI_SOURCE_MIRROR:-$(dirname "$root")/maipai-home-src.git}"
}

ensure_source_mirror() {
  local sha="$1" root="${2:-${MAIPAI_INSTALL_ROOT:-$INSTALL_ROOT_DARWIN}}"
  local mirror remote="${MAIPAI_SOURCE_REMOTE:-https://github.com/${REPO}.git}"
  mirror=$(source_mirror_path "$root")
  if [ ! -d "$mirror" ]; then
    git clone --bare "$remote" "$mirror" >&2 || die "could not create source mirror at ${mirror}. Check Git access, then retry."
  else
    git -C "$mirror" fetch --prune origin '+refs/heads/*:refs/heads/*' >&2 \
      || die "could not refresh source mirror at ${mirror}. Check Git access, then retry."
  fi
  git -C "$mirror" rev-parse --verify "${sha}^{commit}" >/dev/null 2>&1 \
    || die "commit ${sha} was not found in the source mirror. Check the SHA and retry."
  git -C "$mirror" merge-base --is-ancestor "$sha" main \
    || die "commit ${sha} is not on main; land it first."
}

# Everything this installer calls that is not part of a bare macOS or
# Linux. Homebrew is never needed or used. On a Mac these ship with the
# system, so a miss means the Command Line Tools are damaged or absent.
check_required_tools() {
  local os="$1" missing="" tool
  for tool in curl tar rsync unzip df awk sed grep; do
    command -v "$tool" >/dev/null 2>&1 || missing="${missing} ${tool}"
  done
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    missing="${missing} shasum"
  fi
  if [ -n "$missing" ]; then
    if [ "$os" = "darwin" ]; then
      die "these tools are missing from this Mac:${missing}. Install Apple's Command Line Tools: at the Mac's own screen open Terminal, run xcode-select --install, wait for it to finish, then run this installer again."
    fi
    die "these tools are missing from this computer:${missing}. Install them with your package manager (on Ubuntu: sudo apt-get install curl tar rsync unzip coreutils), then run this installer again."
  fi
  if [ "$os" = "darwin" ] && ! xcode-select -p >/dev/null 2>&1; then
    log "Note: Apple's Command Line Tools are not installed. This installer does not need them; if a later step asks for them, run xcode-select --install at the Mac's own screen."
  fi
}

# The Stack is a per-user LaunchAgent and needs a logged-in desktop
# session (GPU access). Over SSH with nobody at the screen there is no
# such session, and install-service would fail with a message about a
# missing domain. Stop first, say why, and give the command to run at
# the Mac itself.
CONSOLE_PROBLEM=""
CONSOLE_FIX_HINT="run the installer again."
check_console_session() {
  local os="$1" user uid
  [ "$os" = "darwin" ] || return 0
  user=$(find_console_user darwin)
  if [ -z "$user" ]; then
    CONSOLE_PROBLEM="Nobody is logged in at this Mac's own screen, and an SSH session does not count. The AI engine needs that desktop session to use the graphics chip. Log in at the Mac (Screen Sharing works), then press Try again."
    log "error: nobody is logged in at this Mac's own screen. An SSH session does not count."
    log "The MaiPai Stack runs as the logged-in person and needs that desktop session to use the GPU."
    log "Fix: sit at the Mac (or use Screen Sharing), log in, then ${CONSOLE_FIX_HINT}"
    return 1
  fi
  uid=$(id -u "$user" 2>/dev/null || true)
  if [ -z "$uid" ] || ! launchctl print "gui/${uid}" >/dev/null 2>&1; then
    CONSOLE_PROBLEM="${user} is the console user but has no desktop session Home can reach (the lock screen counts as logged out). Log in as ${user} at the Mac's own screen, then press Try again."
    log "error: ${user} is the console user but has no desktop session that this installer can reach."
    log "Fix: log in as ${user} at the Mac's own screen (the lock screen counts as logged out), then ${CONSOLE_FIX_HINT}"
    return 1
  fi
}

# Runs a command as the console user. On macOS it joins that user's
# login session first (launchctl asuser), which is what lets the Stack
# register its LaunchAgent in gui/<uid>. Arguments after the user are
# env-style: NAME=value pairs, then the program.
run_as_console_user() {
  local os="$1" user="$2" uid home
  shift 2
  if [ "$os" = "darwin" ]; then
    uid=$(id -u "$user") || return 1
    home=$(dscl . -read "/Users/${user}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
    [ -n "$home" ] || home="/Users/${user}"
    # launchctl asuser needs root; the installer already is, the
    # uninstaller is not.
    local elevate=""
    [ "$(id -u)" -eq 0 ] || elevate=sudo
    $elevate launchctl asuser "$uid" sudo -u "$user" env "HOME=${home}" "$@"
  else
    sudo -u "$user" env "$@"
  fi
}

# Opens the finished install's address in the person's default browser.
# macOS: the installer is root, so open it as the console user inside
# their login session. Linux: only with a desktop session (DISPLAY or
# WAYLAND_DISPLAY) and xdg-open. Never fails the install.
open_setup_page() {
  local os="$1" url="$2" dry_run="${3:-no}" user
  user=$(find_console_user "$os" 2>/dev/null || true)
  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] would open ${url} in the default browser as ${user:-<no console user found>}"
    return 0
  fi
  [ -n "$user" ] || return 0
  if [ "$os" = "darwin" ]; then
    run_as_console_user darwin "$user" open "$url" >/dev/null 2>&1 \
      || log "Could not open the browser for you. Open the address below by hand."
  elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then
    run_as_console_user linux "$user" "DISPLAY=${DISPLAY:-}" "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}" xdg-open "$url" >/dev/null 2>&1 \
      || log "Could not open the browser for you. Open the address below by hand."
  fi
  return 0
}

# Free disk the installer needs (INSTALL-DISK-01). One table holds every size:
# shared/diskPlan.json, a copy of the Stack's docs/disk-plan.json, built from
# the pins' byte counts and measured install sizes. Its "installer" block has
# one line per figure, so this script reads it without a JSON tool:
#   "p64.required_free_bytes": N   Home, the AI engine and its models for the
#                                  plan's default setup: the installed size,
#                                  20 percent more, and the space an install
#                                  needs while it runs.
#   "p64.home_required_free_bytes", "p64.ai_required_free_bytes": the two parts.
# The tier is the plan level (--plan, default recommended) capped by what this
# computer's memory can run. Each folder is checked on its own disk, so a data
# folder on another disk is judged by that disk, and folders that share a disk
# add up. Low headroom warns; a shortfall stops the install before any change.
DATA_RESERVE_BYTES=2147483648   # Home's own records; mirrors DATA_RESERVE_BYTES in shared/diskPlanMath.ts
GIB_BYTES=1073741824

nearest_existing_dir() {
  local p="$1"
  while [ ! -d "$p" ] && [ "$p" != "/" ] && [ "$p" != "." ]; do p=$(dirname "$p"); done
  echo "$p"
}

free_gb_at() {
  df -Pk "$(nearest_existing_dir "$1")" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1048576}'
}

free_bytes_at() {
  df -Pk "$(nearest_existing_dir "$1")" 2>/dev/null | awk 'NR==2 {printf "%.0f", $4*1024}'
}

# The disk a folder is on: the filesystem and where it is mounted.
volume_id_at() {
  df -Pk "$(nearest_existing_dir "$1")" 2>/dev/null | awk 'NR==2 {print $1 "|" $6}'
}

# A byte count as the figure a person reads: whole GB from 10 up, one decimal
# below. "up" rounds a need up and "down" rounds free space down, so the
# sentence never promises room that is not there.
gb_text() {
  awk -v b="$1" -v mode="$2" 'BEGIN { g = b / 1073741824; if (g >= 10) { v = (mode == "up") ? int(g) + (g > int(g)) : int(g); printf "%d", v } else { t = g * 10; v = (mode == "up") ? int(t) + (t > int(t)) : int(t); printf "%.1f", v / 10 } }'
}

check_disk_space() {
  local root="$1" need="$2" what="${3:-Home}" free
  free=$(free_gb_at "$root")
  [ -n "$free" ] || { log "Could not read the free disk space for ${root}; continuing."; return 0; }
  if [ "$free" -lt "$need" ]; then
    DISK_PROBLEM="This computer has ${free} GB free where ${root} lives, and ${what} needs ${need} GB. Free up space (empty the Trash, remove large files), then try again."
    log "error: not enough free disk space: ${DISK_PROBLEM}"
    return 1
  fi
  log "Disk space: ${free} GB free, ${need} GB needed for ${what}."
}

# Whole GiB of memory the AI can use: a Mac's total (its memory is shared with
# the graphics), otherwise an NVIDIA card's. Empty when it cannot be read.
machine_memory_gb() {
  local os="$1" bytes mib
  if [ "$os" = "darwin" ]; then
    bytes=$(sysctl -n hw.memsize 2>/dev/null || true)
    [ -n "$bytes" ] && echo $(( (bytes + GIB_BYTES / 2) / GIB_BYTES ))
  elif command -v nvidia-smi >/dev/null 2>&1; then
    mib=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | awk '{s += $1} END {if (s > 0) printf "%d", s}')
    [ -n "$mib" ] && echo $(( (mib + 512) / 1024 ))
  fi
  return 0
}

# The tier a computer with this much memory reaches; the smallest when it is
# below it or unknown (the setup wizard says whether the AI can run at all).
tier_for_memory_gb() {
  local gb="${1:-0}"
  if [ "$gb" -ge 128 ]; then echo p128
  elif [ "$gb" -ge 64 ]; then echo p64
  elif [ "$gb" -ge 32 ]; then echo p32
  else echo p16
  fi
}

# The tier a plan level installs: the level's own tier, never more than the
# computer can run (Recommended on a 64 GB Mac is the p64 plan).
tier_for_level() {
  local level="$1" machine="$2" cap rank_cap rank_machine
  case "$level" in minimal) cap=p16 ;; moderate) cap=p32 ;; *) cap=p128 ;; esac
  case "$cap" in p16) rank_cap=1 ;; p32) rank_cap=2 ;; p64) rank_cap=3 ;; *) rank_cap=4 ;; esac
  case "$machine" in p16) rank_machine=1 ;; p32) rank_machine=2 ;; p64) rank_machine=3 ;; *) rank_machine=4 ;; esac
  if [ "$rank_cap" -lt "$rank_machine" ]; then echo "$cap"; else echo "$machine"; fi
}

# One figure from the table's installer block, or nothing.
disk_plan_value() {
  local file="$1" key="$2" escaped
  escaped=$(printf '%s' "$key" | sed 's/\./\\./g')
  sed -n "s/.*\"${escaped}\": *\([0-9][0-9]*\).*/\1/p" "$file" | head -1
}

# Puts the table for a release in a file and prints its path. The release tag
# is tried first, then main (a release cut before the table existed has none);
# MAIPAI_DISK_PLAN_FILE names a local copy (tests, an offline install).
fetch_disk_plan() {
  local tag="$1" dest
  if [ -n "${MAIPAI_DISK_PLAN_FILE:-}" ]; then
    [ -r "$MAIPAI_DISK_PLAN_FILE" ] && echo "$MAIPAI_DISK_PLAN_FILE"
    return 0
  fi
  dest=$(mktemp "${TMPDIR:-/tmp}/maipai-disk-plan.XXXXXX") || return 0
  if curl -fsSL --max-time 20 "https://raw.githubusercontent.com/${REPO}/${tag}/shared/diskPlan.json" -o "$dest" 2>/dev/null \
    || curl -fsSL --max-time 20 "https://raw.githubusercontent.com/${REPO}/main/shared/diskPlan.json" -o "$dest" 2>/dev/null; then
    echo "$dest"
  else
    rm -f "$dest"
  fi
  return 0
}

# Checks the disks against the plan. scope "full": Home, the AI engine and its
# models for the plan level (a fresh install). scope "home": Home and the AI
# engine program only (an upgrade, or the wizard's engine step), because the
# models are already there or the wizard sizes them itself. Sets DISK_PROBLEM
# and returns 1 on a shortfall; warns and returns 0 when headroom is low.
check_plan_disk() {
  local plan_file="$1" level="$2" scope="$3" os="$4" root="$5"
  local memory tier machine_tier headroom what
  memory=$(machine_memory_gb "$os")
  machine_tier=$(tier_for_memory_gb "$memory")
  tier=$(tier_for_level "$level" "$machine_tier")
  headroom=$(disk_plan_value "$plan_file" "headroom_warn_bytes")
  : "${headroom:=5368709120}"
  local home_need ai_need total_need
  home_need=$(disk_plan_value "$plan_file" "${tier}.home_required_free_bytes")
  ai_need=$(disk_plan_value "$plan_file" "${tier}.ai_required_free_bytes")
  total_need=$(disk_plan_value "$plan_file" "${tier}.required_free_bytes")
  if [ -z "$home_need" ] || [ -z "$ai_need" ] || [ -z "$total_need" ]; then
    log "Could not read the disk sizes for the ${tier} plan; the setup wizard checks the disk again before it downloads."
    return 0
  fi
  if [ "$scope" = "home" ]; then what="Home and the AI engine"; else what="the ${level} setup"; fi

  # The folders and the disk each is on. Folders on one disk are asked for the sum.
  local data_dir="${MAIPAI_DATA_DIR:-${root}/data}" ai_dir="${STACK_DATA_DIR:-${root}/stack/data}"
  local slots=0 i sid skinds sfree
  local kind path vid vfree
  for kind in home data ai; do
    case "$kind" in home) path="$root" ;; data) path="$data_dir" ;; *) path="$ai_dir" ;; esac
    [ "$scope" = "home" ] && [ "$kind" != "home" ] && continue
    vid=$(volume_id_at "$path"); vfree=$(free_bytes_at "$path")
    [ -n "$vid" ] && [ -n "$vfree" ] || { log "Could not read the free disk space for ${path}; continuing."; continue; }
    i=1; local merged="no"
    while [ "$i" -le "$slots" ]; do
      eval "sid=\$SLOT${i}_ID"
      if [ "$sid" = "$vid" ]; then
        eval "SLOT${i}_KINDS=\"\$SLOT${i}_KINDS ${kind}\""
        eval "sfree=\$SLOT${i}_FREE"
        [ "$vfree" -lt "$sfree" ] && eval "SLOT${i}_FREE=$vfree"
        merged="yes"; break
      fi
      i=$((i + 1))
    done
    if [ "$merged" = "no" ]; then
      slots=$((slots + 1))
      eval "SLOT${slots}_ID=\"$vid\"; SLOT${slots}_FREE=$vfree; SLOT${slots}_KINDS=\"$kind\""
    fi
  done

  local state="green" worst_need=0 worst_free=0 need
  i=1
  while [ "$i" -le "$slots" ]; do
    eval "skinds=\$SLOT${i}_KINDS; sfree=\$SLOT${i}_FREE"
    need=0
    case " $skinds " in
      *" home "*"ai "*|*" ai "*" home "*) need=$total_need ;;
      *" home "*) need=$home_need ;;
      *" ai "*) need=$ai_need ;;
    esac
    case " $skinds " in *" data "*) need=$((need + DATA_RESERVE_BYTES)) ;; esac
    if [ "$sfree" -lt "$need" ]; then
      state="red"; worst_need=$need; worst_free=$sfree; break
    elif [ "$sfree" -lt $((need + headroom)) ] && [ "$state" = "green" ]; then
      state="amber"; worst_need=$need; worst_free=$sfree
    fi
    if [ "$state" = "green" ]; then worst_need=$need; worst_free=$sfree; fi
    i=$((i + 1))
  done
  [ "$slots" -gt 0 ] || return 0

  if [ "$state" = "red" ]; then
    DISK_PROBLEM="This computer needs about $(gb_text "$worst_need" up) GB free for ${what}; it has $(gb_text "$worst_free" down) GB. Free up space (empty the Trash, remove large files), or choose a smaller plan with --plan moderate or --plan minimal. Then run the installer again."
    log "error: not enough free disk space: ${DISK_PROBLEM}"
    return 1
  fi
  if [ "$state" = "amber" ]; then
    log "Warning: disk space is tight. ${what} needs about $(gb_text "$worst_need" up) GB and this computer has $(gb_text "$worst_free" down) GB free. Your chats, pictures and updates need room too."
  else
    log "Disk space: $(gb_text "$worst_free" down) GB free, about $(gb_text "$worst_need" up) GB needed for ${what} (the ${tier} plan)."
  fi
  return 0
}

# The plan level the disk check uses: --plan or MAIPAI_PLAN, else the one an
# earlier run saved, else Recommended (the installer's default).
disk_check_level() {
  local requested="$1" root="$2" saved
  if [ -n "$requested" ]; then echo "$requested"; return 0; fi
  saved=$(cat "${root}/data/setup-plan" 2>/dev/null || true)
  if valid_plan "$saved"; then echo "$saved"; else echo recommended; fi
}

# The table for a disk check: the copy in an installed Home when it has one,
# otherwise the release's (fetch_disk_plan).
disk_plan_file_for() {
  local root="$1" tag="$2"
  if [ -r "${root}/shared/diskPlan.json" ]; then echo "${root}/shared/diskPlan.json"; else fetch_disk_plan "$tag"; fi
}

# macOS only. A downloaded binary carries the quarantine flag and an
# unsigned one is killed on Apple Silicon. curl and tar do not set the
# flag, but a browser-downloaded copy of this folder would, so clear it,
# then make sure each executable has a valid signature (ad-hoc is enough).
clear_quarantine_and_sign() {
  local os="$1" dir="$2" bin
  shift 2
  [ "$os" = "darwin" ] || return 0
  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$dir" 2>/dev/null || true
  fi
  command -v codesign >/dev/null 2>&1 || return 0
  for bin in "$@"; do
    [ -x "$bin" ] || continue
    if ! codesign --verify "$bin" >/dev/null 2>&1; then
      codesign --force --sign - "$bin" >/dev/null 2>&1 \
        || log "Could not sign ${bin}. If macOS blocks it, open System Settings, Privacy and Security, and choose Allow Anyway."
    fi
  done
}

# Polls one URL until it answers. Home answers / (the app), the Stack
# answers /healthz. HEALTH_TRIES overrides the count (half a second each).
wait_for_url() {
  local url="$1" label="$2" max_tries="${3:-60}" tries=0
  [ -n "${HEALTH_TRIES:-}" ] && max_tries="$HEALTH_TRIES"
  while ! curl -sf -o /dev/null "$url" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -ge "$max_tries" ]; then
      log "${label} did not answer at ${url} in time."
      return 1
    fi
    sleep 0.5
  done
  log "${label} is answering at ${url}"
}

# The port a previous install used, read back from its service file, so
# an upgrade keeps the address people bookmarked.
previous_home_port() {
  local os="$1" port=""
  if [ "$os" = "darwin" ]; then
    port=$(sed -n 's#.*<key>PORT</key><string>\([0-9]*\)</string>.*#\1#p' "${HOME_PLIST:-/Library/LaunchDaemons/com.maipai.home.plist}" 2>/dev/null | head -n1)
  else
    port=$(sed -n 's#^Environment=PORT=\([0-9]*\)$#\1#p' "${HOME_UNIT:-/etc/systemd/system/maipai-home.service}" 2>/dev/null | head -n1)
  fi
  if valid_port "$port"; then echo "$port"; fi
  return 0
}

# Prints a short note about what happens after a restart. Home is a
# LaunchDaemon and starts by itself. The Stack is a per-user agent and
# starts when that person logs in.
print_reboot_note() {
  local os="$1" auto="" vault=""
  if [ "$os" = "darwin" ]; then
    log "After a restart: Home starts by itself. The MaiPai Stack starts when the Mac's user logs in."
    auto=$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)
    vault=$(fdesetup status 2>/dev/null || true)
    if [ -z "$auto" ]; then
      log "To make that automatic, turn on automatic login: System Settings, Users and Groups, Automatic login."
    fi
    case "$vault" in *"is On"*) log "FileVault is on, which blocks automatic login. After a restart someone must log in once at the Mac for the Stack to start." ;; esac
  else
    log "After a restart: Home and the Stack both start by themselves."
  fi
}

# ---- Upgrade safety: markers, data snapshot, rollback ----
read_marker() { if [ -f "$1" ]; then tr -d '[:space:]' < "$1"; fi; }

# Written as soon as the data copy exists, not with the final markers: an upgrade that dies part way
# never reaches the final markers, and --rollback would otherwise go to an older, stale version.
record_previous_tag() {
  local root="$1" installed="$2" target="$3"
  if [ -n "$installed" ] && [ "$installed" != "$target" ]; then printf '%s\n' "$installed" > "${root}/.previous-tag"; fi
}

snapshot_data() {
  local root="$1" from_tag="$2" ts dest
  [ -d "${root}/data" ] || return 0
  ts=$(date +%Y%m%d-%H%M%S)
  dest="${root}/upgrade-backups/${ts}-from-${from_tag:-unknown}"
  mkdir -p "$dest" || return 1
  chmod 0700 "${root}/upgrade-backups" "$dest" 2>/dev/null || true
  if ! tar -czf "${dest}/data.tar.gz" --exclude='data/logs' -C "$root" data; then
    rm -rf "$dest"
    return 1
  fi
  log "Saved a copy of your data to ${dest}/data.tar.gz"
  prune_snapshots "${root}/upgrade-backups"
}

prune_snapshots() {
  local dir="$1" entries=() line count i
  while IFS= read -r line; do entries+=("$line"); done < <(ls -1 "$dir" 2>/dev/null | sort)
  count=${#entries[@]}
  i=0
  while [ $((count - i)) -gt "$UPGRADE_KEEP" ]; do
    rm -rf "${dir:?}/${entries[$i]}"
    i=$((i + 1))
  done
}

# The newest snapshot taken while upgrading away from <tag>.
find_snapshot() {
  local root="$1" tag="$2"
  ls -1 "${root}/upgrade-backups" 2>/dev/null | sort | grep -- "-from-${tag}\$" | tail -n1 || true
}

restore_snapshot() {
  local root="$1" tag="$2" snap ts
  snap=$(find_snapshot "$root" "$tag")
  [ -n "$snap" ] || { log "There is no saved data copy from ${tag}, so the data stays as it is."; return 0; }
  ts=$(date +%Y%m%d-%H%M%S)
  if [ -d "${root}/data" ]; then
    mv "${root}/data" "${root}/data.rolled-back-${ts}" || return 1
    log "Your newer data was kept at ${root}/data.rolled-back-${ts}"
  fi
  tar -xzf "${root}/upgrade-backups/${snap}/data.tar.gz" -C "$root" || return 1
  log "Restored your data from ${snap}"
}

# ---- Logs: size-capped copies, daily, for the files launchd owns ----
install_log_rotation() {
  local os="$1" dir="$2" plist="${LOGROTATE_PLIST:-/Library/LaunchDaemons/com.maipai.logrotate.plist}"
  [ "$os" = "darwin" ] || return 0
  [ -f "${dir}/scripts/rotate-logs.sh" ] || { log "Log rotation script missing at ${dir}/scripts/rotate-logs.sh; skipping it."; return 0; }
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.maipai.logrotate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${dir}/scripts/rotate-logs.sh</string>
    <string>${dir}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOG_MAX_MB</key><string>${LOG_ROTATE_MAX_MB}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>15</integer></dict>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
EOF
  chmod 644 "$plist"
  launchctl bootout system "$plist" 2>/dev/null || true
  launchctl bootstrap system "$plist" 2>/dev/null || log "Could not register log rotation; logs will keep growing until you run it. Run: sudo launchctl bootstrap system ${plist}"
}

ensure_bun_system_wide() {
  local bun_home="$1" bun_bin="${1}/bin/bun" bun_version
  if [ -x "$bun_bin" ]; then
    bun_version=$("$bun_bin" --version 2>/dev/null) && [ -n "$bun_version" ] && return 0
    log "The Bun runtime at ${bun_bin} is not runnable; replacing it..."
    rm -rf "$bun_home" || die "Could not remove the unusable Bun runtime at ${bun_home}"
  fi
  log "Installing the Bun runtime to ${bun_home}..."
  mkdir -p "$bun_home" || die "Could not create the Bun runtime directory ${bun_home}"
  curl -fsSL https://bun.sh/install | BUN_INSTALL="$bun_home" bash \
    || die "Could not install Bun into ${bun_home}"
  [ -x "$bun_bin" ] || die "Bun install did not produce an executable at ${bun_bin}"
  bun_version=$("$bun_bin" --version 2>/dev/null) \
    || die "Bun was installed at ${bun_bin}, but it could not run"
  [ -n "$bun_version" ] || die "Bun at ${bun_bin} returned an empty version"
}

# Deno runs the built-in data packages (music, news, sports, the almanac set). Pinned like
# Commons: one release, one SHA-256 per platform, checked before anything is unpacked. To
# bump it, change DENO_VERSION and the four digests (the .zip files on the release page).
DENO_VERSION="2.9.7"

deno_target() {
  case "${1}/${2}" in
    darwin/arm64) echo "aarch64-apple-darwin" ;;
    darwin/x64) echo "x86_64-apple-darwin" ;;
    linux/arm64) echo "aarch64-unknown-linux-gnu" ;;
    linux/x64) echo "x86_64-unknown-linux-gnu" ;;
    *) return 1 ;;
  esac
}

deno_zip_sha256() {
  case "$1" in
    aarch64-apple-darwin) echo "5cd46d6268f6f78f5d88bdc7159d20bd44cdaa4b3303474839f87ec6fe7ae25c" ;;
    x86_64-apple-darwin) echo "95daaff11c116a52ad54785e7914c8e9c9cdcaba793c5ed929c74ca2d8e6259a" ;;
    aarch64-unknown-linux-gnu) echo "c832298b1ad4422481334855f6003e0f54145762c5a134f20a489511d2f65bbf" ;;
    x86_64-unknown-linux-gnu) echo "c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490" ;;
    *) return 1 ;;
  esac
}

# Installs the pinned Deno into <install_root>/.deno/bin/deno. Never fatal: Home runs without
# Deno, with the Deno-backed packages off, and prime_deno_cache says what to do. Re-running
# with the pinned version already there changes nothing.
ensure_deno() {
  local install_root="$1" os="$2" arch="$3" dry_run="${4:-no}"
  local deno_home="${install_root}/.deno" deno_bin="${install_root}/.deno/bin/deno" target expected actual tmp
  target=$(deno_target "$os" "$arch") || { log "There is no Deno build for ${os}/${arch}, so the built-in data packages stay off."; return 0; }
  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] would install Deno ${DENO_VERSION} (sha256 $(deno_zip_sha256 "$target")) from https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${target}.zip into ${deno_bin}"
    return 0
  fi
  if [ -x "$deno_bin" ] && "$deno_bin" --version 2>/dev/null | head -n 1 | grep -q "^deno ${DENO_VERSION} "; then
    return 0
  fi
  log "Installing Deno ${DENO_VERSION} to ${deno_bin}..."
  tmp=$(mktemp -d) || { log "Could not create a temporary folder for Deno, so the built-in data packages stay off. Check that the temp folder is writable, then run the installer again."; return 0; }
  expected=$(deno_zip_sha256 "$target")
  if curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${target}.zip" -o "${tmp}/deno.zip" \
    && actual=$(sha256_file "${tmp}/deno.zip") && [ "$actual" = "$expected" ] \
    && unzip -qo "${tmp}/deno.zip" deno -d "${tmp}/out" \
    && mkdir -p "${deno_home}/bin" && cp "${tmp}/out/deno" "${deno_bin}.new" && chmod 755 "${deno_bin}.new" \
    && mv -f "${deno_bin}.new" "$deno_bin" \
    && "$deno_bin" --version >/dev/null 2>&1; then
    rm -rf "$tmp"
    return 0
  fi
  rm -rf "$tmp" "${deno_bin}.new"
  log "Could not install Deno ${DENO_VERSION} (the download, its checksum or the unpacking failed), so the built-in data packages (music, news, sports and the almanac set) stay off. Check the internet connection, then run the installer again."
  return 0
}

fetch_release_source() {
  local tag="$1" dest="$2"
  if [[ "$tag" == sha-* ]]; then
    local mirror full_sha
    mirror=$(source_mirror_path)
    ensure_source_mirror "${tag#sha-}"
    full_sha=$(git -C "$mirror" rev-parse --verify "${tag#sha-}^{commit}" 2>/dev/null) \
      || die "commit label ${tag} is ambiguous or missing in ${mirror}. Use its full SHA and retry."
    log "Fetching commit ${full_sha:0:7} of main..."
    mkdir -p "$dest" || return 1
    git -C "$mirror" archive --format=tar "$full_sha" | tar -x -C "$dest" \
      || return 1
    return 0
  fi
  log "Fetching ${REPO}@${tag}..."
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  if ! curl -fsSL "https://github.com/${REPO}/archive/refs/tags/${tag}.tar.gz" -o "${tmp}/src.tar.gz" \
    || ! mkdir -p "$dest" \
    || ! tar -xzf "${tmp}/src.tar.gz" -C "$dest" --strip-components=1; then
    trap - RETURN
    rm -rf "$tmp"
    return 1
  fi
  trap - RETURN
  rm -rf "$tmp"
}

# Home's own backend/ and frontend/ package.json name their Commons packages as
# file:../../commons-tags/<package>-<tag>/<package>, which resolves to <parent of the install
# root>/commons-tags (/usr/local/commons-tags on macOS, /opt/commons-tags on Linux). A release
# tarball does not carry them, so stage each one (digest-checked) before bun install runs. The
# pins are read from the manifests, so they cannot drift; a test fails when one has no digest.
fetch_home_commons() {
  local dir="$1" work deps pkg cdir tag m
  work=$(dirname "$dir")
  local one all=""
  for m in backend frontend; do
    [ -f "${dir}/${m}/package.json" ] || continue
    grep -q 'file:\.\./\.\./commons-tags/' "${dir}/${m}/package.json" || continue
    one=$(stack_commons_deps "${dir}/${m}/package.json" "Home's ${m}/package.json") || { printf '%s\n' "$one"; return 1; }
    all="${all}${one}"$'\n'
  done
  deps=$(printf '%s' "$all" | sort -u)
  while read -r pkg cdir tag; do
    [ -n "$pkg" ] || continue
    if [ -f "${work}/commons-tags/${cdir}/${pkg}/package.json" ]; then continue; fi
    fetch_one_stack_commons "$work" "$pkg" "$cdir" "$tag" || return 1
  done <<< "$deps"
  link_commons_siblings "$work" "$deps"
}

# Before anything on this computer is stopped or replaced: every Commons tag the fetched Home source pins has a digest
# in this script (or is already staged). Run against the new source, so a missing digest ends the install while the
# old Home is still intact, not after its dependencies were removed (issue 248, 249).
check_home_pins() {
  local dir="$1" label="${2:-this version}" work m deps one pkg cdir tag
  work=$(dirname "$dir")
  for m in backend frontend; do
    [ -f "${dir}/${m}/package.json" ] || continue
    grep -q 'file:\.\./\.\./commons-tags/' "${dir}/${m}/package.json" || continue
    one=$(stack_commons_deps "${dir}/${m}/package.json" "Home's ${m}/package.json") || { printf '%s\n' "$one"; return 1; }
    deps="${deps:-}${one}"$'\n'
  done
  while read -r pkg cdir tag; do
    [ -n "$pkg" ] || continue
    [ -f "${work}/commons-tags/${cdir}/${pkg}/package.json" ] && continue
    if ! commons_archive_sha256 "$tag" >/dev/null; then
      log "${label} pins Commons ${tag}, and this installer has no SHA-256 for it. Nothing was replaced and the running Home is untouched. Add the digest of https://github.com/getmaipai/commons/archive/refs/tags/${tag}.tar.gz to commons_archive_sha256 in scripts/install.sh and scripts/engine-computer/maipai-engine, then run the installer again."
      return 1
    fi
  done <<< "$(printf '%s' "${deps:-}" | sort -u)"
}

# A commit install runs the installer that commit carries. When the script that is running is not the fetched
# commit's own scripts/install.sh, run that one instead, so the digests and steps always match the source.
reexec_with_source_installer() {
  local src="$1"; shift
  [ -z "${MAIPAI_INSTALL_SOURCE_REEXEC:-}" ] || return 0
  [ -f "${src}/scripts/install.sh" ] && [ -f "$0" ] || return 0
  [ "$(sha256_file "$0")" != "$(sha256_file "${src}/scripts/install.sh")" ] || return 0
  local copy
  copy=$(mktemp "${TMPDIR:-/tmp}/maipai-install.XXXXXX") && cp "${src}/scripts/install.sh" "$copy" || return 0
  log "This installer is not the one the commit carries. Running the commit's own installer."
  MAIPAI_INSTALL_SOURCE_REEXEC=1 MAIPAI_INSTALL_SELF_COPY="$copy" exec bash "$copy" "$@"
}

# One Commons package can name another as file:../<name> (core and ui name spec). A checkout of
# Commons has the packages side by side, but here each tag sits in its own folder, so the sibling
# is missing and bun install fails on it. Point each such name at the folder Home already staged.
link_commons_siblings() {
  local work="$1" deps="$2" pkg cdir tag name sibling_dir
  while read -r pkg cdir tag; do
    [ -n "$pkg" ] || continue
    for name in $(grep -oE '"file:\.\./[a-z0-9-]+"' "${work}/commons-tags/${cdir}/${pkg}/package.json" | sed -E 's/^"file:\.\.\/(.*)"$/\1/'); do
      [ -e "${work}/commons-tags/${cdir}/${name}" ] && continue
      sibling_dir=$(printf '%s\n' "$deps" | awk -v n="$name" '$1 == n { print $2; exit }')
      [ -n "$sibling_dir" ] || continue
      ln -s "../${sibling_dir}/${name}" "${work}/commons-tags/${cdir}/${name}" \
        || die "Could not link ${name} next to ${pkg} in ${work}/commons-tags/${cdir}. Check that the folder is writable, then run the installer again."
    done
  done <<< "$deps"
}

build_app() {
  local dir="$1" bun_bin="$2"
  fetch_home_commons "$dir" || die "could not fetch the Commons packages Home needs. Read the message above, fix what it names, then run the installer again."
  log "Installing dependencies and building the frontend (this can take a minute)..."
  # A fresh Mac has no system node, and dependency install scripts (ssh2) run
  # `node`, and package scripts (the frontend prebuild) run `bun` from a child shell
  # that has no Bun on PATH under sudo. Put `node` and `bun`, both the resolved
  # Bun, on PATH for these commands only.
  local shim
  shim=$(mktemp -d) && ln -s "$bun_bin" "${shim}/node" && ln -s "$bun_bin" "${shim}/bun" \
    || die "could not create the temporary node shim. Check that the temp folder is writable, then run the installer again."
  (cd "$dir/backend" && PATH="${shim}:${PATH}" "$bun_bin" install --production) \
    || { rm -rf "$shim"; return 1; }
  (cd "$dir/frontend" && PATH="${shim}:${PATH}" "$bun_bin" install && PATH="${shim}:${PATH}" "$bun_bin" run build) \
    || { rm -rf "$shim"; return 1; }
  rm -rf "$shim"
  prime_deno_cache "$dir"
}

# The built-in data packages run under Deno with --cached-only, so nothing
# downloads while Home runs. That makes this the one place their pinned
# dependencies (jsr: and npm: imports) are fetched, once, into a Deno cache
# inside the install that the service points DENO_DIR at. Without it every
# package that imports one fails its boot smoke test and starts switched off.
# A missing Deno is not fatal: those packages stay off and Home says so.
prime_deno_cache() {
  local dir="$1" deno_bin cache="$1/data/deno" entry failed=0 n=0
  if [ -x "$1/.deno/bin/deno" ]; then deno_bin="$1/.deno/bin/deno"; else deno_bin=$(command -v deno 2>/dev/null || true); fi
  if [ -z "$deno_bin" ]; then
    log "Deno is not installed, so the built-in data packages (music, news, sports and the almanac set) will stay off until it is. The installer could not fetch it; check the internet connection, then run the installer again."
    return 0
  fi
  log "Fetching the pinned Deno dependencies for the built-in packages (one time)..."
  mkdir -p "$cache" || { log "Could not create ${cache}; the built-in data packages may start switched off."; return 0; }
  for entry in "$dir"/backend/packages/*/handler_test.ts; do
    [ -f "$entry" ] || continue
    n=$((n + 1))
    DENO_NO_PACKAGE_JSON=1 DENO_DIR="$cache" "$deno_bin" cache --no-check "$entry" >/dev/null 2>&1 || failed=$((failed + 1))
  done
  if [ "$failed" -gt 0 ]; then
    log "${failed} of ${n} built-in packages could not fetch their dependencies (no network to JSR or npm?). They start switched off; run the installer again when the network is back."
  fi
  if [ "${SERVICE_USER:-}" != "" ] && id "$SERVICE_USER" >/dev/null 2>&1; then
    chown -R "$SERVICE_USER" "$cache" 2>/dev/null || true
  fi
}

# Home runs as the unprivileged service account on Linux, inside a
# read-only sandbox, and the Stack step needs root and a normal filesystem
# (it chowns the Stack's folder and registers a user service). So the step is
# its own one-shot unit that Home starts, and the service account may run
# exactly one command as root: start that unit. The scripts folder is
# root-owned and not writable by the service account, so it cannot swap in a
# different script.
STACK_STEP_UNIT=maipai-stack-install.service
install_stack_step_unit() {
  local root="$1" unit="${STACK_STEP_UNIT_FILE:-/etc/systemd/system/${STACK_STEP_UNIT}}" rule="${SUDOERS_FILE:-/etc/sudoers.d/maipai-home}" tmp systemctl_bin
  chown -R root:root "${root}/scripts" 2>/dev/null || true
  chmod -R go-w "${root}/scripts" 2>/dev/null || true
  mkdir -p "${root}/data/logs"
  cat >"$unit" <<UNIT
[Unit]
Description=MaiPai Home: install the AI engine (started by the setup wizard)

[Service]
Type=oneshot
User=root
ExecStart=/bin/bash ${root}/scripts/install.sh --stack-only
StandardOutput=append:${root}/data/logs/stack-install.log
StandardError=append:${root}/data/logs/stack-install.log
UNIT
  systemctl daemon-reload 2>/dev/null || true
  systemctl_bin=$(command -v systemctl || echo /usr/bin/systemctl)
  tmp=$(mktemp)
  printf '%s ALL=(root) NOPASSWD: %s start --no-block %s\n' "$SERVICE_USER" "$systemctl_bin" "$STACK_STEP_UNIT" > "$tmp"
  if command -v visudo >/dev/null 2>&1 && ! visudo -cf "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    log "Could not write the rule that lets Home install the AI engine from the setup wizard. If the wizard cannot, run: sudo bash ${root}/scripts/install.sh --stack-only"
    return 0
  fi
  install -m 0440 -o root -g root "$tmp" "$rule" 2>/dev/null || { cp "$tmp" "$rule" && chmod 0440 "$rule"; }
  rm -f "$tmp"
}

install_systemd_unit() {
  local dir="$1" bun_bin="$2" port="$3" stack_port="${4:-$STACK_PORT_BASE}"
  local unit=/etc/systemd/system/maipai-home.service
  cat >"$unit" <<EOF
[Unit]
Description=MaiPai Home
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${dir}/backend
Environment=PATH=$(dirname "$bun_bin"):${dir}/.deno/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=PORT=${port}
Environment=MAIPAI_STACK_PORT=${stack_port}
Environment=DENO_DIR=${dir}/data/deno
ExecStart=${bun_bin} run start
Restart=on-failure
RestartSec=5
# Kept narrow to what the app actually needs on disk: its own install
# tree. Least-privilege matches CLAUDE.md's credentials rule ("readable
# only by the service account, SYSTEM and administrators") extended to
# the process itself, not just its secret files.
ProtectSystem=strict
ReadWritePaths=${dir}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now maipai-home.service
}

ensure_service_user_linux() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    log "Creating the ${SERVICE_USER} system account..."
    useradd --system --home-dir "$INSTALL_ROOT_LINUX" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
      || useradd -r -d "$INSTALL_ROOT_LINUX" -s /usr/sbin/nologin "$SERVICE_USER"
  fi
  # stack/ is excluded: HOME-STACK-01's setup_stack() (called before
  # this, in main()) already chowns it to the Stack's own console user,
  # never ${SERVICE_USER} - the Stack needs a real GUI-capable session
  # for Metal/GPU access, which a headless system account never has. A
  # plain recursive chown of the whole install root would silently
  # overwrite that the moment this function runs, breaking the Stack's
  # own service on every Linux install; found by re-reading this
  # function's own ordering against setup_stack's, not run live (this
  # session has no Linux box - see docs/dev.md's own stated gap).
  find "$INSTALL_ROOT_LINUX" -mindepth 1 -maxdepth 1 ! -name stack -exec chown -R "${SERVICE_USER}:${SERVICE_USER}" {} +
}

install_launchd_daemon() {
  local dir="$1" bun_bin="$2" port="$3" stack_port="${4:-$STACK_PORT_BASE}"
  local plist="${HOME_PLIST:-/Library/LaunchDaemons/com.maipai.home.plist}"
  mkdir -p "${dir}/data/logs"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.maipai.home</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bun_bin}</string>
    <string>run</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${dir}/backend</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$bun_bin"):${dir}/.deno/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>${port}</string>
    <key>MAIPAI_STACK_PORT</key><string>${stack_port}</string>
    <key>DENO_DIR</key><string>${dir}/data/deno</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <!-- The setup wizard starts the AI engine install from Home. If Home restarts
       while it runs, launchd must not kill that install. -->
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>${dir}/data/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${dir}/data/logs/launchd.err.log</string>
</dict>
</plist>
EOF
  chmod 644 "$plist"
  # Modern launchctl (bootstrap/enable), not the deprecated load/unload -
  # matches Apple's own current guidance for LaunchDaemons.
  launchctl bootout system "$plist" 2>/dev/null || true
  launchctl bootstrap system "$plist"
  launchctl enable system/com.maipai.home
}

# ---------------------------------------------------------------------
# The Stack (HOME-STACK-01). Every function below is written to also
# support --dry-run (see main()): given dry_run=yes it logs what it
# would do and returns without touching the filesystem, sudo, or a
# service manager - the render-style functions (render_stack_binary_name,
# stack_service_env_summary) are pure and have their own tests.
# ---------------------------------------------------------------------

# macOS: the account actually logged into the console (not root, even
# under sudo) - the Stack needs a real GUI session for Metal/GPU access,
# which a LaunchDaemon/root session never has. Linux: the account that
# invoked sudo, so a headless box still gets a real (if session-less)
# user account to run the Stack as; loginctl enable-linger (below) keeps
# its systemd --user instance alive with nobody logged in.
find_console_user() {
  local os="$1" user
  if [ "$os" = "darwin" ]; then
    # `stat -f%Su /dev/console` answers "root" when nobody is logged
    # into the console (a headless Mac reached only over SSH, or the
    # gap between a logout and the next login) - a real, not
    # theoretical, state for a box this installer runs on unattended.
    # Treated as "no console user" rather than a valid one: this
    # installer's whole point in finding one is to avoid running the
    # Stack as root, so root here is exactly the answer it exists to
    # refuse, not to accept because it happened to be non-empty. Found
    # by a code review.
    user=$(stat -f%Su /dev/console)
  else
    # The person who ran the installer. The wizard starts the Stack step
    # through sudo as the Home service account, so SUDO_USER is then the
    # service account, not a person: the installer's own record wins.
    local recorded="${INSTALL_USER_FILE:-${INSTALL_ROOT_LINUX}/.install-user}"
    if [ -f "$recorded" ]; then user=$(tr -d '[:space:]' < "$recorded")
    else user=$(logname 2>/dev/null || echo "${SUDO_USER:-}")
    fi
    [ "$user" = "$SERVICE_USER" ] && user=""
  fi
  [ "$user" = "root" ] && user=""
  echo "$user"
}

render_stack_binary_name() {
  local os="$1" arch="$2"
  echo "maipai-stack-${os}-${arch}"
}

fetch_stack_source() {
  local dest="$1" dry_run="$2"
  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] would fetch ${STACK_REPO}@${STACK_TAG} into ${dest}"
    return
  fi
  log "Fetching ${STACK_REPO}@${STACK_TAG}..."
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  if ! curl -fsSL "https://github.com/${STACK_REPO}/archive/${STACK_TAG}.tar.gz" -o "${tmp}/stack.tar.gz" \
    || ! mkdir -p "$dest" \
    || ! tar -xzf "${tmp}/stack.tar.gz" -C "$dest" --strip-components=1; then
    trap - RETURN
    rm -rf "$tmp"
    return 1
  fi
  trap - RETURN
  rm -rf "$tmp"
}

# The SHA-256 of GitHub's archive for one Commons tag (the tags the Stack at STACK_TAG names; see
# the comment above STACK_TAG). Fails, printing nothing, for a tag with no pinned digest.
commons_archive_sha256() {
  case "$1" in
    core-v0.1.0) printf '%s\n' "d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4" ;;
    spec-v0.1.136) printf '%s\n' "5dece57ae0495d27f8c3e565b7de14217e0f5d1495b0a09feee7e10b625e4342" ;;
    core-v0.1.5) printf '%s\n' "d2fb1699c872ae0200fec895cc2b29f44d4134520e5c2dc903fd5a8c1719be17" ;;
    spec-v0.1.151) printf '%s\n' "1b00dce8dd76676e626f055b4f0aa4a9e33935c3a30c1e8a79401656d05f005f" ;;
    ui-v0.5.231) printf '%s\n' "d52dc6e8ac64f2b5b50c8b9d53267d3459c68baa32ab9240b37cd4b1c0c62dd1" ;;
    spec-v0.1.152) printf '%s\n' "62c1d1f084bf8cfb06eb8e13a6d9a006c10ead436a8c4165053ec380e5a4ea1e" ;;
    ui-v0.5.233) printf '%s\n' "562f0dcca00341cd115b69bd416e96f6d9c8ba721a70b990bb0efdcdc5bc5168" ;;
    ui-v0.5.236) printf '%s\n' "188fabdadcc2f8dbd5999b3eb4fa8e02ba51b58eb500ae9b246bc47fc5418214" ;;
    ui-v0.5.237) printf '%s\n' "e45fdcfba031b5d1f27bb716049ce2625d1b605fbe673cbc1fcb52a08111c860" ;;
    spec-v0.1.153) printf '%s\n' "ba55e798108fa563bc06246f46addfe9e212c7bf42d17267a2acf099645dfa1c" ;;
    ui-v0.5.239) printf '%s\n' "59551bb28888f95afea046fcbc897146824b08a21a4276fb0cd14169950feb68" ;;
    ui-v0.5.240) printf '%s\n' "cc12ed3ae1ba52bf66d2ef48e9ab032d2626032494eed78223f06bbcce124246" ;;
    ui-v0.5.241) printf '%s\n' "66426df1ba3758e3bb11b482ba88bec75e2263dbc96884a973a2367c68853db8" ;;
    ui-v0.5.242) printf '%s\n' "ff70f8a24e87c503a14edb9d96fda2f3865a6c62086e82954aeb6c5cd49a9858" ;;
    ui-v0.5.243) printf '%s\n' "946d499f5e995752a2630af8e206762168b37bfb2fe8ac5ff4675b8fac1e9101" ;;
    ui-v0.5.244) printf '%s\n' "b3cbae2f61c4a666b10ecc340ef3c2edb6d9154cacd9a9b19384ea8b677c2193" ;;
    spec-v0.1.154) printf '%s\n' "907f2563d8135c57debfee8a079164ad9b5303fbdecfc16c1f5e325c4633fb41" ;;
    spec-v0.1.155) printf '%s\n' "fca47c676baf49a47e1e80597a0298ca4efd2310ebbdde0fec72075e5aac3c18" ;;
    ui-v0.5.245) printf '%s\n' "a1f443fdd2f9e9a21d5080d38ae1fa284fbbb3292764fd0f5af6e8c2d5770eda" ;;
    ui-v0.5.246) printf '%s\n' "41b89e971cd57d50a5d8d2098442d0281edd2123bc3577b92310a8603faa3a37" ;;
    spec-v0.1.156) printf '%s\n' "ae71e840bb196595981f5ea4c7a7ed81db20d9d3e27e9174bc87eee72db5e3f8" ;;
    spec-v0.1.157) printf '%s\n' "49767a3badead66901f6d77a083a270696db59779b4533fc151cea81b6424dae" ;;
    spec-v0.1.163) printf '%s\n' "b8cccc646a8f4c7da177beb9e35cb8df0626fecb63b6778f9f9481d32c7dcb57" ;;
    ui-v0.5.255) printf '%s\n' "d84f2397d4ee71d01ca51146eb6aa6a33c4efaa304aa9ba1a21fcbfb32b81d85" ;;
    ui-v0.5.247) printf '%s\n' "531d1b9ea51ec484cce197964f94f9964d644ea538f1398bb661a961e8c40e1e" ;;
    ui-v0.5.248) printf '%s\n' "01e815d0c58a9ea7583ff109122ce85dc96fe1cbe7207f2fdc25a5a040f3efbc" ;;
    ui-v0.5.249) printf '%s\n' "a41284da441aa4d42a76b51d08f6a029f92e2d3f3027f11ccb2e5f69377462ce" ;;
    ui-v0.5.250) printf '%s\n' "86a33e65cd55124a55842359d45aa6b2e9663168a6f4c7e77725909af0857b68" ;;
    ui-v0.5.254) printf '%s\n' "d5f2d8a9f55413230e309f970f73513c8d41c41db82f90f5a8965eb73233487d" ;;
    ui-v0.5.259) printf '%s\n' "842d856291698b6dc24aa71b76339560a903415ce02a38ca94ea7320f3318257" ;;
    ui-v0.5.260) printf '%s\n' "3d0f906333d6796680e0fa9a2d0ef16b26c5f659d21c563afbb580f0c0db73ba" ;;
    spec-v0.1.164) printf '%s\n' "3f9f4e68a10f0c4dcfe1171929d4d4c73331b1feb842ec52bc20268f12cd2722" ;;
    spec-v0.1.166) printf '%s\n' "12d6594ede6c2da439250749c03bc14b2a1b03b7329d1be22f71fe078e706077" ;;
    spec-v0.1.168) printf '%s\n' "f50db828f1fc989c24404f606a2daa326250befb77e7f427985b6d5bde67fdea" ;;
    spec-v0.1.169) printf '%s\n' "ddae785302ffddb0bd7dff90c6b41893d5983f0f37b1b4bf68320cd56155bdf3" ;;
    ui-v0.5.261) printf '%s\n' "f8e890bc1dea73d25f10c58435154c22ec4256ee0bcbd284738f8b287867a8ae" ;;
    spec-v0.1.172) printf '%s\n' "22ab22c489c876468a93294db871f40f09f88153956f9fefa8c3324b48560628" ;;
    ui-v0.5.265) printf '%s\n' "3870aff8af85909daca142f31e70a3da7e32ac871e22658840ffab2c7256e5c8" ;;
    ui-v0.5.268) printf '%s\n' "e4468b36fe71567214805c34eb35221f391c2b21546773e024966669a68f3b0f" ;;
    ui-v0.5.272) printf '%s\n' "2448f37efb6acc382d6f94ad984e073c67c7bfef391bb7b84f96429709a85108" ;;
    ui-v0.5.276) printf '%s\n' "cb4846fcaf046c377d726d7fdee92bb76187898437aa375bab21b43784b71e4c" ;;
    spec-v0.1.173) printf '%s\n' "642b52e8cad4e859db1c2d36204521c2e395c8381ce17bbe3979e4b3a2a19dd7" ;;
    spec-v0.1.175) printf '%s\n' "02dbd96aa478b811eeea04cf267de0067836414c8e9d609557e366a9b7a3a5ac" ;;
    spec-v0.1.178) printf '%s\n' "e551ca0da659cd95416df4f7b47ad55d8fe35f3eaa4907f628c18d9a834cbec9" ;;
    spec-v0.1.179) printf '%s\n' "404e9a96f7217adffd232f82fabd50080e87b9be4a62bd5049fa9ebd999ad906" ;;
    spec-v0.1.183) printf '%s\n' "1c42359a9a0d8042034e0f1500e8077bc3228ebde758aa7d06d818c23f02b09a" ;;
    spec-v0.1.184) printf '%s\n' "11e36d2dbd4ae6d197c1d1846bb685e88e789908da206751109f032bc5c56595" ;;
    spec-v0.1.185) printf '%s\n' "a98c04d29d51bcf40364347afac192de2c817a38d703333fc233566fabc4fadf" ;;
    ui-v0.5.277) printf '%s\n' "ae65a67ad6ab83c7a877503014465cde44cfff2876628a05ea799bf317346fbf" ;;
    ui-v0.5.278) printf '%s\n' "4c86149ec80538072216c879146a2c47edc6dec773ce4703625b0c205718a4da" ;;
    spec-v0.1.187) printf '%s\n' "de8c6dc4cd033adb223c5ceb880f64177cb23e415bb106422ff67e97b052301c" ;;
    spec-v0.1.188) printf '%s\n' "baa0452d951eb8a0e8466195998436a671b8f3b89d386c8a27f0c789244e1043" ;;
    spec-v0.1.189) printf '%s\n' "ce9f7c653e08df83b05896d706351eeb3b2cf6a989e316dcac61eb45305a6760" ;;
    spec-v0.1.192) printf '%s\n' "5ba605c864974fdba6770c3425790fe39f4e40a080ff2009a54c2a8edb07322e" ;;
    spec-v0.1.193) printf '%s\n' "f8ff7c11ae2dbd67d686a73a1af1508d4bbf21f0186a02b8e66183a44749d32b" ;;
    spec-v0.1.194) printf '%s\n' "7f5a7408999bbb708a0067d227435fa04456b4475b4929de05ead04bfd9d41ff" ;;
    spec-v0.1.195) printf '%s\n' "6261d3f27dfb689c5d8ded521b0e62ccee84871098834458de50aa84fa220533" ;;
    spec-v0.1.197) printf '%s\n' "5f5a403d9c968fb312bd51c13a593498391e00c3591d2846879ef690dc385b43" ;;
    spec-v0.1.199) printf '%s\n' "b24dddcd4f7a621668c048f59c5b9048e39059fd594e05baaa29f1bf61fc3edb" ;;
    spec-v0.1.200) printf '%s\n' "96d4d62def4c71cf82ccd449d90ea818e49e1caf1b9354a531b6bf8309c39e33" ;;
    spec-v0.1.201) printf '%s\n' "ddcb0182766b9504f78ae58fbd4b8c69f79f14a0b4c1f6796fb72375521da981" ;;
    spec-v0.1.202) printf '%s\n' "240583f924872d069a1b007eb6ff051ad3d1de08f0011456d6860c9aaebd65cd" ;;
    ui-v0.5.279) printf '%s\n' "fe9d3250e7d1d8253d39e41e90b56d25739523b47e486059985acbaec5eba05b" ;;
    ui-v0.5.280) printf '%s\n' "a0b49373184e9678453c200364325c0cefd4e4e8861043b7667b10bf3adc8b5c" ;;
    ui-v0.5.281) printf '%s\n' "cc91fc50b42a66f794f2d9ebbe6c3e2d1b2c5a0a3d5a9a8f8fbeb33ab30d008c" ;;
    ui-v0.5.282) printf '%s\n' "b2ebbc67ebb152b5ecf3403dee9f5d6d853b2822c1d4c44ce3e67849637d9341" ;;
    ui-v0.5.284) printf '%s\n' "98489b7f9c4d10395d11926646bc2d3a9c07f67bbfbd3d672c6490522a9e3762" ;;
    ui-v0.5.286) printf '%s\n' "2e2cacb3c66a1245e8270438a9251e7d76f49328364b9e90b6be262df4985a2c" ;;
    ui-v0.5.287) printf '%s\n' "11772da1e1be1fcd598b9e5108dfc1772c5015c68592e5124df2009492767854" ;;
    ui-v0.5.288) printf '%s\n' "497a851e0bf5fc450681f2392d145bf74c6bdd181decb53a590718a606e3d5f1" ;;
    ui-v0.5.289) printf '%s\n' "fe0c7df2c7df0302aa07fb032587f450dffe5a31e8eb3820fe97e55e8cb4b948" ;;
    ui-v0.5.292) printf '%s\n' "479206c8b8d7234a8d8e234d104c98e0ec269b42c1d87c2892a81d1535bdaa09" ;;
    ui-v0.5.293) printf '%s\n' "1c5c7f536531253575fd98fc9590ea64407ccf00b25b2c3548fa8150d02bd1ca" ;;
    ui-v0.5.294) printf '%s\n' "895f6a0b779dff2bd41c1038a1a1e137fca530f2914d74339304368a887fcf44" ;;
    ui-v0.5.296) printf '%s\n' "d307f926da4e26aea3d99341aab2a8e93bd73c5a37039bac3795d9ec0bfd467a" ;;
    ui-v0.5.297) printf '%s\n' "a1e573d0cb70fccf3b1db0c49a4192bff019d8ad3c1e33c8ecaaedcfba679d92" ;;
    ui-v0.5.299) printf '%s\n' "6d7074cdb3388ca6b0780bad79799a0ade60dc6117d4943f311accd5a3fc0e80" ;;
    ui-v0.5.301) printf '%s\n' "ce6e1fb9fed45bae99c151c652c1d135afb424e80ea0a30cafc5493861ad357d" ;;
    ui-v0.5.302) printf '%s\n' "8b380ee3905e211de8d476514eaa52768d8d2c9760de1ecaf22934cf36b5168f" ;;
    ui-v0.5.303) printf '%s\n' "a11afe837350f69c55d6dab7cd5aa6261bb18ecc6caaa763d077952881d77f3c" ;;
    ui-v0.5.304) printf '%s\n' "c2fe2f48fd1ab05c5bd5eacc22237f6a958ea6fd6b041c9a684e5bec4b093f10" ;;
    ui-v0.5.305) printf '%s\n' "8c1cbb38163a7ad6d47b106638ca1058188cb023f86cf85960f93bf496ee83f1" ;;
    ui-v0.5.307) printf '%s\n' "e03105e3cc51288f36081f707d1c8cde95b2b8f953bde2ee9d18b76098007542" ;;
    ui-v0.5.310) printf '%s\n' "da189d4beff3831e4fa90bf8a4aa3b6ecd17591b409497fe423c9bf1d7d50bdd" ;;
    ui-v0.5.312) printf '%s\n' "1da911aa0e705aa2541ad651329a6694cf07e466811a0c2eb13391d50f85c099" ;;
    ui-v0.5.317) printf '%s\n' "43134529fc4d2639236eca11d67d8d27838b120c8b967e968ab03107db7326d6" ;;
    ui-v0.5.318) printf '%s\n' "7cf6a29da06e5c7382872a0ccdfa0f2e25ec5a5df7bb66862d1578e5682315c6" ;;
    ui-v0.5.320) printf '%s\n' "e19158e7f3cd8edef97f696b79d272e859286b05579f05c872f51d5becab7a46" ;;
    ui-v0.5.322) printf '%s\n' "b2db635099d1bdec76a2b73fb79d88083314a8e83ed85dec7c63e3ffa5320c08" ;;
    ui-v0.5.323) printf '%s\n' "1ded2736a3b3a70476e6e9e13dc6c608d3a48ee76dcc242ef41c53841d417360" ;;
    ui-v0.5.324) printf '%s\n' "90eaeb413c5fdb5983aabfaab51e314599017e421f5ae59a0c758855f80f2af1" ;;
    ui-v0.5.326) printf '%s\n' "0b0c9119a90fb90db13a288e02d73878d8b13b436555073ec714f6b7653404c4" ;;
    ui-v0.5.327) printf '%s\n' "c8ea087c3b8a533d04acdca052037c30212820df936c4e31bc194a1cf012e047" ;;
    ui-v0.5.330) printf '%s\n' "fa2dd395eae6f8f3b110ba948c033440f585ca14f8a63ffd2deb6fed36ad2be4" ;;
    ui-v0.5.328) printf '%s\n' "7b3b67f869f18bcaf1dfcf66817991ea5c52abd712f19a90679821fef270c71b" ;;
    spec-v0.1.203) printf '%s\n' "78d0d5663a19dc8274c6d222be142251de70aa3e937ecee78e34c097c320ea71" ;;
    spec-v0.1.204) printf '%s\n' "1fe37f7ff49ec4021dda7fa62ba877e3126e6e74069640ce9d3a935be2a34333" ;;
    spec-v0.1.206) printf '%s\n' "b597613454a5429cf649daa2b5aa8f04850b1ce0a8634ebad7aa99b1b5a11c55" ;;
    spec-v0.1.207) printf '%s\n' "0f2eb7efffd6e5f4c41542803a3c94a2d5f0ae7e5db62e602eda2519fc29852d" ;;
    spec-v0.1.208) printf '%s\n' "d4ef6758603bb6182471517e49b126ff621bc77940e52585e7f22e108f6bdbe0" ;;
    spec-v0.1.215) printf '%s\n' "cbb443caaf679e3ba77027ce218330248f9b222cc79a725903189d458b7b8209" ;;
    spec-v0.1.217) printf '%s\n' "1b5d5c9359186ce316d682cbb0a4f569d2c4b85b3ff9c9a85b88fa55740a05e9" ;;
    spec-v0.1.219) printf '%s\n' "2809af78786a1da6bbd3376c99a52628ceaca38ecabcd8045179c2f412041e76" ;;
    spec-v0.1.220) printf '%s\n' "f2bc28d054156d5499ee0d6537927238bdccf4c2a0948827940296d1e2c2061f" ;;
    spec-v0.1.221) printf '%s\n' "12c526223691dea72b1a32cbc0d1d2063bd8dd148c39baa468e951304ba2a8fb" ;;
    spec-v0.1.223) printf '%s\n' "f00865b0a374145e10e1bdfcfbac16a787fa702bf5d1b36d3839cbcb3fd7f660" ;;
    spec-v0.1.225) printf '%s\n' "0c84f31e75daa38532a3b79b19499fd6d7ba7c31c00d3422ebcbf66b61ee4ed0" ;;
    spec-v0.1.226) printf '%s\n' "7e3ef34be782f7446cfc58dc27b336ddfb040442edf2e22c20e6191796177ddd" ;;
    spec-v0.1.227) printf '%s\n' "dab7d30e293b7c50aae525f97f31f4b257e80d75b571f849f7282a67b646cc6f" ;;
    ui-v0.5.331) printf '%s\n' "afc3b904310f1c1534bfa77c703868ecfb17b53a312c7d41ae2a73761aa3cbf9" ;;
    ui-v0.5.332) printf '%s\n' "f021a34b0d8b7d6c40a0b942f623ef75998e6e0650aeea16524d79335cbfa040" ;;
    ui-v0.5.333) printf '%s\n' "016a4724b667f4c672ca7105cf181e85e7cc2eb85d59cd43da9934abb383d426" ;;
    ui-v0.5.334) printf '%s\n' "51162261974c29f60a99c5034d9c473df8470be63117409d1271683392186b9c" ;;
    ui-v0.5.335) printf '%s\n' "ed1f22de80aad9ace8ea2c23c382ed6d131a08dc38cd188e1bdcb1e161a7a703" ;;
    ui-v0.5.336) printf '%s\n' "d4870de390f8f8fb73f66e098b094ab75d1c5e09acd0c69d7b2c544bd8752e47" ;;
    ui-v0.5.337) printf '%s\n' "5bb0f267316082f4946abc17c0d08bee46623cf38313b7318a1e9f79868ef84e" ;;
    ui-v0.5.338) printf '%s\n' "c6bfe00c50bb5df15a388f4d65ab705931eada4146613bd1339f04b6c0d9ee3f" ;;
    ui-v0.5.339) printf '%s\n' "e868dfa5c60b49c4a9deb4a5658fd0a8b101f02862acc58e7fbe4e6dc2967935" ;;
    ui-v0.5.340) printf '%s\n' "c2cfcec9f1f8d56bb84785ed7bc7e9d49270e304d60112252c47d3c8bb2734f6" ;;
    ui-v0.5.341) printf '%s\n' "c6322e4c50e8881c9719309489338bbe8b61f965aab4b46805fc976811929fdc" ;;
    ui-v0.5.342) printf '%s\n' "00477218c77879ec3f892443d9e61e96e9cb24df40eaeefb6424cc7810d156ba" ;;
    ui-v0.5.343) printf '%s\n' "07baec22cad2d031d83764a2a5c5de75ef7b51ef41296cbe0d6d88bf6d413cdf" ;;
    ui-v0.5.344) printf '%s\n' "c98f857cbf7eed0cf14fbf3ded167f7a62f771b36a4c5df012505aa70e78f2a0" ;;
    spec-v0.1.228) printf '%s\n' "32a992cca56dbb4944f04a568199ea0e04bc16f95be51433438d2aaafb8f631e" ;;
    ui-v0.5.346) printf '%s\n' "fc86d9fe1e364f5d5c14c582ca980abd92c9663ff12ad7fbd766feb94f927b09" ;;
    ui-v0.5.347) printf '%s\n' "c3e214dde4d8719a31927b30bbfa8d9dbebf17b71f880e39a814a4103e022e61" ;;
    spec-v0.1.234) printf '%s\n' "fc2ace89db728ccf16006cd7c59b51c944b6067512e4b3021c6c0c75bf83d654" ;;
    ui-v0.5.349) printf '%s\n' "ab54f0a823ff346402e4b40f86cf25e1c18448f3ec47b9def2c6cb9d5e452d78" ;;
    ui-v0.5.351) printf '%s\n' "d055cb6ed56f1e0b1e9687e07447ebb4883425ad4c1a7358768bcb3831af0483" ;;
    ui-v0.5.352) printf '%s\n' "1765af6cff0f0d39cc8a6ad77b38f85c42e4e89323552c95473ab48c0f4ec679" ;;
    ui-v0.5.353) printf '%s\n' "ac1be4fb8bdce5183cbd3be6fe649b42d0d85b32d798746d230c6300fd61b582" ;;
    ui-v0.5.356) printf '%s\n' "0f82879977acc80fe5518a86ceddb3f59ffc03df7c5e04c8d79ecaf7924e88b8" ;;
    ui-v0.5.357) printf '%s\n' "f553dcbb549e84ae94a14c8948717d230d803feed067e4b74692432654193ffc" ;;
    spec-v0.1.236) printf '%s\n' "f0a7bfe9c6ede4835188cbc408463954279231a3cf6a0ba068f39282fbdc80e4" ;;
    spec-v0.1.237) printf '%s\n' "4c21e8191e5cec45319e4a579f95a86dbb790c6652fe41d37d5e0b59a58a412b" ;;
    spec-v0.1.238) printf '%s\n' "f45e3b81ff32ae035c47b0bfbb5a949ba815e69a27702d7aad941cc29ad93d69" ;;
    ui-v0.5.359) printf '%s\n' "8d5b15ffa636ee5d2bcfad619ff7deafdc5f62db402831bb08adae2598f4d349" ;;
    spec-v0.1.239) printf '%s\n' "0c6110979716b3deb5c31dcc222208a173d8ecdcda41dc3192e59f36685664e2" ;;
    ui-v0.5.363) printf '%s\n' "3a9f13f57736d1be30b020be02e008aa2774fb0579023412ebe51e05205d788c" ;;
    spec-v0.1.240) printf '%s\n' "95ac2032d84825d685c02968e6028d0969382f86eeabdee9e8d68988ccaf4331" ;;
    spec-v0.1.241) printf '%s\n' "c3aaba5053cc9285546219386ff1c44cabf5c70c35b012a32ed1883c5f34fe56" ;;
    ui-v0.5.364) printf '%s\n' "4c3a623ecb9ff545e37adfbac358d957c9d251ce3542d493a6c9f71334aeab0d" ;;
    spec-v0.1.242) printf '%s\n' "602bd09b225d44c1206327ec198c5de05f4132a094fa574eb76d8a18b62d0f2b" ;;
    spec-v0.1.243) printf '%s\n' "97768e67099bc87bd19651873a3c0d5c8968caf939d5e0ccbcdbd1d1b3b51e8f" ;;
    ui-v0.5.365) printf '%s\n' "def1af128392b6fde6ca49f68cd634cd70f5905fcee47f78f27bc4742ef8ba43" ;;
    ui-v0.5.366) printf '%s\n' "041dc5f2e853106dceff765f1babb221bd7ed5315d58bbe298ab338b6504814f" ;;
    spec-v0.1.244) printf '%s\n' "988531b67269a8ff560c6de452979655b0c892b7b8f9aa2a781ca6ed8919fe95" ;;
    spec-v0.1.245) printf '%s\n' "600e616cd96503fb16e74ce6acfff3e4506f96a61508a00924d0202b6cb4e1b6" ;;
    ui-v0.5.367) printf '%s\n' "d7daf96a59b1c23df40253d16b9b7388458d36c72347a79502c0add249f7d33d" ;;
    ui-v0.5.368) printf '%s\n' "2a25f92732e12b8b80cc0caf999944cdaaed9e67afef4882bd762aa2d3329184" ;;
    ui-v0.5.369) printf '%s\n' "e5b35d6d0909399d57ad99f102fa1b6216010a9b5d8098cf66b88509b6c50504" ;;
    ui-v0.5.370) printf '%s\n' "65b42cb7413a1c5f6664923374794d1a259e6f55fc10357d0e74741037397071" ;;
    ui-v0.5.371) printf '%s\n' "29614c2b8a88f0ec4cbccdc327aea536ab9469e8cba6c3a324b01186ba41b564" ;;
    ui-v0.5.373) printf '%s\n' "2dac8b8ad73de3805eb563c65047eb2bb8a331ae11ac218a342cffc967c1d2f8" ;;
    spec-v0.1.246) printf '%s\n' "7a96f0a2fa7a149821528fa8cc597576695511dfd7b76f67d558886c211d141c" ;;
    ui-v0.5.374) printf '%s\n' "a273da9e8e88161518d4c5668ebe17fcfb8373262b181af2678271cc6dc4bad3" ;;
    spec-v0.1.247) printf '%s\n' "894a2dc8334939808404658074de2507d662d178596efb1ff523605ced9e80af" ;;
    ui-v0.5.376) printf '%s\n' "eb0e8248415690edfda1643565bb4073eb6d5e8952f19478382ac3da11f02c63" ;;
    ui-v0.5.378) printf '%s\n' "70cba140277fc61a716c5834566ff55a9d42ebae0c766cfb7167c4573daa7737" ;;
    ui-v0.5.379) printf '%s\n' "173e4a8fc67184c5c01527f471de6bdfcd08b50f7800e6d97bf38a7d76dc45ee" ;;
    ui-v0.5.380) printf '%s\n' "64012003da92a561f4056b7bc8f8936e26e9b8c274213ca4322e214a9c991ce2" ;;
    ui-v0.5.381) printf '%s\n' "87995c1be36cab7a7f24186199d35decc69da868fc7603c82e4abea741b26564" ;;
    ui-v0.5.382) printf '%s\n' "69e138ac2533b331dbd358a70bb12bfaac8d206f1fd642537473de7140e38909" ;;
    ui-v0.5.383) printf '%s\n' "0d2c14439fa9b9cfa2fdcb7d08e4246ebdc98115b7058746f055d5f2afaff6b2" ;;
    ui-v0.5.384) printf '%s\n' "8b9fad76dfd045a91be8528e1c30c56099c8ca760aa264bc5536563b88e5ea64" ;;
    ui-v0.5.385) printf '%s\n' "91ab539c20d9a8b612896dcceee24208849f083814e03a6ba4ba865ba6cdfcc5" ;;
    ui-v0.5.386) printf '%s\n' "5e8037e38cca6631d89e627be6b030cabfe8e96d9e25a8740adb914d41cdc2ba" ;;
    ui-v0.5.387) printf '%s\n' "4e3a7aa53b4fec67677191c6f7c939cf47ae11d9f185f22cb9c89b436234d6b1" ;;
    ui-v0.5.388) printf '%s\n' "f906ad7a642bd89c2b6f594916cdffd6d3993d077aa94c1ec68439a2d191044a" ;;
    ui-v0.5.389) printf '%s\n' "c9b87efe0ab8e3618129150b6c5f1b5ed266c10b5ef1076151b0c61a23723473" ;;
    ui-v0.5.391) printf '%s\n' "37a1c7bf9a216fee45f8d11d1a1450e4c9cfaebe5efbe0fb9ef904f74730c4f8" ;;
    ui-v0.5.393) printf '%s\n' "68e9c4407347e075b7d289a2933f2aa158020bc73b1f6e882d21839487c6d84a" ;;
    ui-v0.5.395) printf '%s\n' "14b104ec5a012e93b107ec546659935f25a58ad5fdfc782e91945956d5d5fd27" ;;
    spec-v0.1.251) printf '%s\n' "5fbaff57fc94fad07d70c6808eeb03108abe1d7d7dbb227afb47e025e0afc9e0" ;;
    spec-v0.1.252) printf '%s\n' "c8980fa131eddd05cdb81b2c5869ba6220c05a8ab46fa787a5c8dc8bce310f00" ;;
    ui-v0.5.396) printf '%s\n' "e88452086311c59646dbea826b10a9f03ea9d1ece576be81f0d3227d3d37ced0" ;;
    ui-v0.5.397) printf '%s\n' "69c9a043eadef421499bef21884f2e3fd56df9fee1b2e3992f88f6dd698c0792" ;;
    ui-v0.5.398) printf '%s\n' "38befcd24fd0d4ebfb5ca4338d9a216d8b2c180c79323180612535499f48595a" ;;
    spec-v0.1.253) printf '%s\n' "d9a579f0600f5d77d72e1ce206a0defa07c9db9c69515ce7a6935f583a011144" ;;
    spec-v0.1.254) printf '%s\n' "78743bd49ed006489b93a606aa2651c1554016bdb8776811da8f6255279cb1e1" ;;
    ui-v0.5.399) printf '%s\n' "1699864713517162f8bd069cbe8a659c25c740259f5f355f81dc2bcbabb3a7b4" ;;
    spec-v0.1.255) printf '%s\n' "96aeec0beaf6964f4ebfc3f48e5989bc4ead61bba77bdfbabc0f08bcf604022f" ;;
    spec-v0.1.256) printf '%s\n' "48563e526138431811e28147ca2fd7b5b3af8f89a0d69c3f45fe8aa111f677bc" ;;
    spec-v0.1.257) printf '%s\n' "7c307a04b329339ef3b4807bce3d06ddf53560c5763ab6ec88585e7da628a5f0" ;;
    spec-v0.1.258) printf '%s\n' "f4506d83b3d2c76741d24a23d40c1b957af4947ac7d64148f2026668a3e3d0e1" ;;
    ui-v0.5.400) printf '%s\n' "d6331edbd2203ccd17095c97761149f6df04fe7d47227e0aa11e80f68bd2915f" ;;
    spec-v0.1.259) printf '%s\n' "fd98774bb077ec26d5a4d9e1bbb19fe10c253cbb0a2b32ce36285289b5b729c2" ;;
    spec-v0.1.261) printf '%s\n' "577f983ff2064524b21323b3ee875397e9344ab3734850c33cd321fc6fa99923" ;;
    ui-v0.5.401) printf '%s\n' "be30085f3490a74e1d39d1ae7460615fc00fd8a71b2db289b9df6e7fe855341e" ;;
    core-v0.1.6) printf '%s\n' "197e5e8d61b54fb833bda79a02c1bf62909041b4ec65f714acc1987b4d34c3f2" ;;
    spec-v0.1.262) printf '%s\n' "3652d0ad3f9ee013660c111c373193718d602e0debcb70f307583a3e3368fc47" ;;
    core-v0.1.7) printf '%s\n' "dafb421983daf216e363536e0da77d22a8eacaed252b1080e6cccac571d83b41" ;;
    spec-v0.1.263) printf '%s\n' "8715d97f6fe3757588d2628412fd256224e64750a5e18d2f547a3c1ed4e14bf9" ;;
    ui-v0.5.402) printf '%s\n' "b43899b3cfa378a7b97eb2b5efff8d7440733797c84c4db3271d017ef0802a74" ;;
    spec-v0.1.264) printf '%s\n' "6a9cd6ba5a5ff72d7b079b92eac22aedc06cd569ba2eebf799e7a84b72c962f7" ;;
    ui-v0.5.403) printf '%s\n' "c629abb63832aa364dbc3130d2847b7247370c68af582c6a9237a5e2eebf4cc6" ;;
    spec-v0.1.266) printf '%s\n' "98ab3b254d989e306815d74cca26849b147deeb3b3e62143fc6e7e23802c43d1" ;;
    ui-v0.5.405) printf '%s\n' "7a7be4376de1335ab2fdaa1fcbb75ee6d4adbec03743f3bdcbd805849f70e4c6" ;;
    ui-v0.5.406) printf '%s\n' "d4a254cae882f3e9a3e47f3e33476af2a2551bf969a164c0e6f6b0186587f799" ;;
    spec-v0.1.267) printf '%s\n' "ea29c8854daa0954dd457ff9b8d9192e99bb63bfbdec5fecba488fb274c2d5ef" ;;
    ui-v0.5.407) printf '%s\n' "f315d30f6831dfd629e2ddde56ee7732c93bb73afa94951722215eb790aa7f17" ;;
    ui-v0.5.408) printf '%s\n' "0392485b754dc0b6e700cd75a5496bfe2a3c812d4e98e99d609acd9bdd221d96" ;;
    ui-v0.5.409) printf '%s\n' "a078ae85cecbd5482ae359b3572fc88c5a258b439b2f83e0f8ba04dbf939166b" ;;
    ui-v0.5.410) printf '%s\n' "7ab382b48257196f16a63a71dfcd952148ccfcd1c19bd9e12af756e3c7cf722b" ;;
    ui-v0.5.411) printf '%s\n' "20797ad642c59f7fed790e9dc25cce1012477af6d721a3efc3682dff8b83f711" ;;
    ui-v0.5.412) printf '%s\n' "227ad2bef44f7fa5fb870d1fcc9bc173fa16eb78099c388f558de1f4ac615cc7" ;;
    ui-v0.5.413) printf '%s\n' "d65f434c8ef6ea45cccc3571387970ce3dd15ddca530e4b39351e6047876996e" ;;
    ui-v0.5.414) printf '%s\n' "fc1c88fb0d87d5b0e5515368d40e1fd03dd069b75bbf830cde99068436ee2c70" ;;
    spec-v0.1.269) printf '%s\n' "af1c9a446fbbef9592331de12ecce083a55aa0efd763679325844e76f0e20673" ;;
    spec-v0.1.270) printf '%s\n' "cd14e96acd8fa70aa9b31a4aa334f9d8f3c23b3051cbe7078e4498377e04c15c" ;;
    spec-v0.1.271) printf '%s\n' "763580a36a5482497267e290f62457ae20b62cfc7ad597aaac1c65d0e7bdda85" ;;
    ui-v0.5.415) printf '%s\n' "c58578bbec3ef258c0308fef5893d14c10ea321452811b8c08f6a7dbd5ed5d6e" ;;
    ui-v0.5.416) printf '%s\n' "4edce3b2d4ac33a3bb7c6de23baf0a275ec44f8dc15cc235c52c74aa728dc184" ;;
    ui-v0.5.417) printf '%s\n' "6f71cf28ccd8e74698504870e01ed4f6419059afe9623752de29d8b71ff67b8d" ;;
    *) return 1 ;;
  esac
}

# The Commons packages a Stack's backend/package.json names, one per line as "<package> <dir> <tag>":
# file:../../commons-tags/<dir>/<package> with <dir> = <package>-<tag>. This is the one place the pins
# come from, so they cannot drift from the Stack at STACK_TAG.
stack_commons_deps() {
  local manifest="$1" label="${2:-}" line pkg dir leaf tag found=0
  [ -n "$label" ] || label="The Stack's backend/package.json"
  while IFS= read -r line; do
    pkg=$(printf '%s\n' "$line" | sed -n 's#.*"@maipai/\([a-z][a-z0-9-]*\)"[[:space:]]*:[[:space:]]*"file:\.\./\.\./commons-tags/\([^/"]*\)/\([^/"]*\)".*#\1#p')
    dir=$(printf '%s\n' "$line" | sed -n 's#.*"@maipai/\([a-z][a-z0-9-]*\)"[[:space:]]*:[[:space:]]*"file:\.\./\.\./commons-tags/\([^/"]*\)/\([^/"]*\)".*#\2#p')
    leaf=$(printf '%s\n' "$line" | sed -n 's#.*"@maipai/\([a-z][a-z0-9-]*\)"[[:space:]]*:[[:space:]]*"file:\.\./\.\./commons-tags/\([^/"]*\)/\([^/"]*\)".*#\3#p')
    [ -n "$pkg" ] || continue
    if [ "$leaf" != "$pkg" ] || [ "${dir#"${pkg}-"}" = "$dir" ]; then
      log "${label} names @maipai/${pkg} as ${dir}/${leaf}, which is not <package>-<tag>/<package>. The Stack was bumped to a layout this script does not know; update stack_commons_deps in scripts/install.sh and scripts/engine-computer/maipai-engine."
      return 1
    fi
    tag="${dir#"${pkg}-"}"
    printf '%s %s %s\n' "$pkg" "$dir" "$tag"
    found=1
  done < "$manifest"
  [ "$found" = 1 ] || { log "${label} names no Commons package under ../../commons-tags/. Check that this installer matches the source it fetched."; return 1; }
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

# One Commons package into <workspace>/commons-tags/<dir>/<package>, the place the Stack's
# file:../../commons-tags/<dir>/<package> resolves to from <workspace>/stack/backend.
fetch_one_stack_commons() {
  local work="$1" pkg="$2" dir="$3" tag="$4" expected actual tmp dest="$1/commons-tags/$3"
  if ! expected=$(commons_archive_sha256 "$tag"); then
    log "Commons ${tag} is pinned by a package.json, and this script has no pinned SHA-256 for it. Add the SHA-256 of https://github.com/getmaipai/commons/archive/refs/tags/${tag}.tar.gz to commons_archive_sha256 in scripts/install.sh and scripts/engine-computer/maipai-engine, then run this again."
    return 1
  fi
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  log "Fetching getmaipai/commons@${tag}..."
  if ! curl -fsSL "https://github.com/getmaipai/commons/archive/refs/tags/${tag}.tar.gz" -o "${tmp}/commons.tar.gz"; then
    log "Could not download Commons ${tag} from https://github.com/getmaipai/commons/archive/refs/tags/${tag}.tar.gz. Check that this computer can reach github.com, then run this again."
    trap - RETURN
    rm -rf "$tmp"
    return 1
  fi
  if ! actual=$(sha256_file "${tmp}/commons.tar.gz"); then
    log "Could not compute the SHA-256 of the Commons ${tag} download. Install sha256sum (or shasum), then run this again."
    trap - RETURN
    rm -rf "$tmp"
    return 1
  fi
  if [ "$actual" != "$expected" ]; then
    log "Commons ${tag} archive SHA-256 mismatch: expected ${expected}, got ${actual}. The download may be damaged: run this again, and if it fails the same way, do not continue and report both digests."
    trap - RETURN
    rm -rf "$tmp"
    return 1
  fi
  if ! mkdir -p "$dest"; then
    log "Could not create ${dest}. Check that the folder is writable, then run this again."
    trap - RETURN
    rm -rf "$tmp"
    return 1
  fi
  if ! tar -xzf "${tmp}/commons.tar.gz" -C "$dest" --strip-components=1 "commons-${tag}/${pkg}"; then
    log "Could not unpack ${pkg} from the Commons ${tag} archive. Run this again; if it repeats, the archive no longer has a ${pkg} folder and the Stack pin needs a new tag."
    trap - RETURN
    rm -rf "$tmp"
    return 1
  fi
  if [ ! -f "${dest}/${pkg}/package.json" ]; then
    log "Commons ${tag} archive is missing ${pkg}/package.json. The Stack pin needs a Commons tag that has it."
    trap - RETURN
    rm -rf "$tmp"
    return 1
  fi
  trap - RETURN
  rm -rf "$tmp"
}

# Every Commons package the fetched Stack names, laid beside it: <workspace>/stack is the Stack,
# <workspace>/commons-tags/<package>-<tag>/<package> is each package, so ../../commons-tags/... from
# <workspace>/stack/backend resolves (core and spec at STACK_TAG). Reads the names from the Stack's
# own backend/package.json, so call it after fetch_stack_source.
fetch_stack_commons() {
  local work="$1" dry_run="$2"
  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] would fetch each getmaipai/commons tag named in ${work}/stack/backend/package.json (known: core-v0.1.0 sha256 $(commons_archive_sha256 core-v0.1.0), spec-v0.1.136 sha256 $(commons_archive_sha256 spec-v0.1.136)) into ${work}/commons-tags/<package>-<tag>/<package>"
    return 0
  fi
  local manifest="${work}/stack/backend/package.json" deps pkg dir tag
  if [ ! -f "$manifest" ]; then
    log "The Stack's backend/package.json is not at ${manifest}, so its Commons packages cannot be read. Fetch the Stack source into ${work}/stack first, then run this again."
    return 1
  fi
  deps=$(stack_commons_deps "$manifest") || return 1
  while read -r pkg dir tag; do
    fetch_one_stack_commons "$work" "$pkg" "$dir" "$tag" || return 1
  done <<< "$deps"
}

# Builds via the Stack's own scripts/build-binary.sh (one definition:
# this installer never re-implements what that script already does -
# compile, the migrations/ and ort-wasm/ siblings, and backend-src/, the vendored
# source the stt worker runs from until getmaipai/stack#8 is fixed
# upstream). OUT_DIR points straight at the runtime location; the fetched
# source above is scratch, removed once this returns. SKIP_VERIFY=1: the
# script's own live check (a real network download and transcription) is
# what this item's own report proves once, by hand - repeating it on
# every household's install would mean a real download and a minute-plus
# delay on every single install, for a proof this installer's own later
# /healthz poll already re-covers for the daemon half.
build_stack_binary() {
  local source_dir="$1" out_dir="$2" bun_bin="$3" dry_run="$4"
  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] would run ${source_dir}/scripts/build-binary.sh (OUT_DIR=${out_dir}, SKIP_VERIFY=1) with $(dirname "$bun_bin") first on PATH"
    return
  fi
  PATH="$(dirname "$bun_bin"):$PATH" OUT_DIR="$out_dir" SKIP_VERIFY=1 bash "${source_dir}/scripts/build-binary.sh" || return 1
}

# Stack's build-binary.sh clears OUT_DIR before compiling. Keep its
# scratch output outside the engine install root, where the Bun runtime
# lives, then copy only the compiled payload into place.
publish_engine_stack_binary() {
  local built_dir="$1" out_dir="$2" binary_name="$3" artifact
  mkdir -p "$out_dir" || return 1
  for artifact in "$binary_name" migrations backend-src ort-wasm; do
    [ -e "${built_dir}/${artifact}" ] || return 1
    rm -rf "${out_dir:?}/${artifact}" || return 1
    cp -a "${built_dir}/${artifact}" "$out_dir/" || return 1
  done
}

# install-service's own argv, one token per line - the single source
# both the --dry-run log line (stack_install_service_command, below,
# built from this) and the real sudo -u/env call below actually run
# from, so the two can never quietly drift apart. A code review found
# an earlier version had them hand-duplicated instead: the comment
# claimed they were "the same command" but only the display half
# actually came from the shared helper - a future env var added to only
# one would have passed every test while being silently wrong in the
# other.
stack_install_service_argv() {
  local binary="$1" data_dir="$2" port="$3" bun_bin="$4"
  printf '%s\n' "STACK_DATA_DIR=${data_dir}" "PORT=${port}" "STACK_BUN_BIN=${bun_bin}" "$binary" "install-service"
}

# The same argv as one readable line, for --dry-run's own log output
# and for a test to assert on without shelling out to the real thing.
# `while read` into an array, not `mapfile`/`readarray` (bash 4+ only) -
# this script's own `#!/usr/bin/env bash` resolves to macOS's system
# bash on an unmodified Mac, which is 3.2.57 (Apple has not shipped a
# newer one in years, for licensing reasons) and does not have it at
# all; found live, running this exact line on this dev Mac.
stack_install_service_command() {
  local args=() line
  while IFS= read -r line; do args+=("$line"); done < <(stack_install_service_argv "$@")
  echo "${args[*]}"
}

install_stack_service() {
  local install_root="$1" bun_bin="$2" os="$3" arch="$4" dry_run="$5"
  local stack_dir="${install_root}/stack"
  local stack_data_dir="${stack_dir}/data"
  local binary="${stack_dir}/$(render_stack_binary_name "$os" "$arch")"
  local stack_user
  stack_user=$(find_console_user "$os")

  if [ "$dry_run" = "yes" ]; then
    # find_free_port() below opens a real loopback socket per candidate
    # port (port_in_use()'s own /dev/tcp probe) - a code review found
    # this ran unconditionally, breaking --dry-run's own documented "no
    # network call" guarantee (real, not theoretical, in a network-
    # sandboxed CI container). The base port is shown instead; a real
    # run may pick a higher one if it's already taken.
    log "[dry-run] would create ${stack_data_dir} (0700, owned by ${stack_user:-<no console user found>})"
    log "[dry-run] would write ${stack_user:-<no console user found>} to ${stack_dir}/.user"
    log "[dry-run] would run as ${stack_user:-<no console user found>}: $(stack_install_service_command "$binary" "$stack_data_dir" "$STACK_PORT_BASE" "$bun_bin") (or a higher port near ${STACK_PORT_BASE} if that one is taken)"
    [ "$os" = "linux" ] && log "[dry-run] would run: loginctl enable-linger ${stack_user:-<no console user found>}"
    log "[dry-run] would poll http://127.0.0.1:${STACK_PORT_BASE}/healthz (or that higher port)"
    log "[dry-run] would run: bun run backend/scripts/set-setting.ts engines.stack.url http://127.0.0.1:${STACK_PORT_BASE} --only-if-empty-or-prefix http://127.0.0.1: (port as above)"
    return 0
  fi

  # An upgrade keeps the port the Stack already uses. Without this the old
  # Stack still held its own port while this ran, find_free_port moved to
  # the next one (8771), and Home kept pointing at 8770: chat was down
  # until the setting was fixed by hand (2026-10-28).
  local stack_port previous_stack_port
  previous_stack_port=$(read_marker "${stack_dir}/.port")
  if valid_port "$previous_stack_port" && { stack_answers_on "$previous_stack_port" || ! port_in_use "$previous_stack_port"; }; then
    stack_port="$previous_stack_port"
  else
    stack_port=$(find_free_port "$STACK_PORT_BASE")
  fi

  # `set -e` is suppressed for this whole function (called under `if !`
  # in main()/setup_stack()), which also suppresses bash's normal
  # early-exit on a failing command WITHIN the function body, not just
  # the function's own final exit status - proven live, since it is
  # exactly the kind of thing that looks right and silently is not.
  # Every step below is therefore checked and returned from explicitly;
  # none are left to `-e` to stop at.
  [ -n "$stack_user" ] || { log "Could not determine the logged-in console user. The MaiPai Stack is required; installation cannot continue."; return 1; }
  [ -x "$binary" ] || { log "The compiled Stack binary is missing at ${binary}. The MaiPai Stack is required; installation cannot continue."; return 1; }

  mkdir -p "$stack_data_dir" || { log "Could not create ${stack_data_dir}. The MaiPai Stack is required; installation cannot continue."; return 1; }
  chmod 0700 "$stack_data_dir" || { log "Could not set ${stack_data_dir} owner-only. The MaiPai Stack is required; installation cannot continue."; return 1; }
  chown -R "$stack_user" "$stack_dir" || { log "Could not chown ${stack_dir} to ${stack_user}. The MaiPai Stack is required; installation cannot continue."; return 1; }
  echo "$stack_user" > "${stack_dir}/.user" || { log "Could not write ${stack_dir}/.user. The MaiPai Stack is required; installation cannot continue."; return 1; }

  local install_service_argv=() argv_line
  while IFS= read -r argv_line; do install_service_argv+=("$argv_line"); done < <(stack_install_service_argv "$binary" "$stack_data_dir" "$stack_port" "$bun_bin")
  clear_quarantine_and_sign "$os" "$stack_dir" "$binary"
  run_as_console_user "$os" "$stack_user" "${install_service_argv[@]}" \
    || { log "The Stack's install-service command failed. The MaiPai Stack is required; installation cannot continue. On a Mac this usually means no one is logged in at the Mac's own screen: log in there, open Terminal, and run the installer again."; return 1; }
  echo "$stack_port" > "${stack_dir}/.port" || { log "Could not write ${stack_dir}/.port. The MaiPai Stack is required; installation cannot continue."; return 1; }
  if [ "$os" = "linux" ]; then
    loginctl enable-linger "$stack_user" 2>/dev/null || true
  fi

  log "Waiting for the Stack to answer at http://127.0.0.1:${stack_port}/healthz..."
  local tries=0 max_tries=40
  [ -n "${STACK_HEALTH_TRIES:-}" ] && max_tries="$STACK_HEALTH_TRIES"
  while ! curl -sf "http://127.0.0.1:${stack_port}/healthz" >/dev/null 2>&1; do
    tries=$((tries + 1))
    # install-service can leave the new service file written but not loaded
    # (2026-10-28: the Stack stayed down until `launchctl bootstrap` was run
    # by hand). Halfway through the wait, ask the Stack to start itself once.
    if [ "$tries" -eq $((max_tries / 2)) ]; then
      log "The Stack has not answered yet. Asking its service to start."
      run_as_console_user "$os" "$stack_user" "STACK_DATA_DIR=${stack_data_dir}" "PORT=${stack_port}" "STACK_BUN_BIN=${bun_bin}" "$binary" start >/dev/null 2>&1 || log "The Stack's start command did not succeed; still waiting."
    fi
    if [ "$tries" -ge "$max_tries" ]; then
      log "The Stack did not answer /healthz in time. The MaiPai Stack is required; installation cannot continue. Its log is ${stack_data_dir}/logs/stack.error.log."
      return 1
    fi
    sleep 0.5
  done
  log "MaiPai Stack is running at http://127.0.0.1:${stack_port}"

  # Read the previous address after health succeeds. The local address
  # replaces an empty setting or this installer's previous local address.
  # --only-if-empty-or-prefix (a code review's own finding): a household
  # that has since pointed this setting at a remote or hand-run Stack
  # through the settings UI keeps that choice on the next upgrade,
  # rather than this installer silently overwriting it back to its own
  # local port every time.
  (cd "${install_root}/backend" && "$bun_bin" run scripts/set-setting.ts engines.stack.url "http://127.0.0.1:${stack_port}" --only-if-empty-or-prefix "http://127.0.0.1:") \
    || { log "Could not write engines.stack.url. The MaiPai Stack is required; installation cannot continue."; return 1; }
}

setup_stack() {
  local install_root="$1" bun_bin="$2" os="$3" arch="$4" dry_run="$5"
  local stack_dir="${install_root}/stack"
  local source_root source_dir
  if [ "$dry_run" = "yes" ]; then
    source_root="/tmp/maipai-stack-install-dry-run"
  else
    source_root=$(mktemp -d)
  fi
  source_dir="${source_root}/stack"
  STACK_PROBLEM="Home could not download the AI engine's source. Check that this computer can reach github.com, then press Try again."
  stack_status running fetching
  fetch_stack_source "$source_dir" "$dry_run" || { log "Could not fetch the Stack's source. The MaiPai Stack is required; installation cannot continue."; [ "$dry_run" = "yes" ] || rm -rf "$source_root"; return 1; }
  fetch_stack_commons "$source_root" "$dry_run" || { log "Could not fetch the Commons packages the Stack needs. The MaiPai Stack is required; installation cannot continue. Read the message above, fix what it names, then run this installer again."; [ "$dry_run" = "yes" ] || rm -rf "$source_root"; return 1; }
  # build-binary.sh deletes its OUT_DIR first, and stack/data (models,
  # settings) lives inside stack/. Build into scratch, then copy only the
  # compiled files across so a rebuild never touches the Stack's data.
  local build_dir="${source_root}/output"
  STACK_PROBLEM="The AI engine could not be built. The install log (${STACK_LOG_HINT:-the Home logs folder}) shows why. Press Try again."
  stack_status running building
  build_stack_binary "$source_dir" "$build_dir" "$bun_bin" "$dry_run" || { log "Could not build the Stack binary. The MaiPai Stack is required; installation cannot continue."; [ "$dry_run" = "yes" ] || rm -rf "$source_root"; return 1; }
  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] would copy the built files into ${stack_dir} (the Stack's data/ is not touched)"
  else
    publish_engine_stack_binary "$build_dir" "$stack_dir" "$(render_stack_binary_name "$os" "$arch")" \
      || { log "Could not copy the built Stack files into ${stack_dir}. The MaiPai Stack is required; installation cannot continue."; rm -rf "$source_root"; return 1; }
    rm -rf "$source_root"
  fi
  STACK_PROBLEM="The AI engine was built but would not start. On a Mac this usually means nobody is logged in at the screen: log in there, then press Try again. Its log is ${stack_dir}/data/logs/stack.error.log."
  stack_status running starting
  install_stack_service "$install_root" "$bun_bin" "$os" "$arch" "$dry_run"
}

# Dedicated Linux engine computer. Privileged setup is deliberately
# rendered (never executed) by --dry-run; install-service itself runs
# under maipai-stack's systemd --user manager.
setup_engine_computer() {
  local dry_run="$1" os="$2" arch="$3"
  if [ "$dry_run" != "yes" ]; then
    [ "$os" = "linux" ] || die "--engine-computer requires Ubuntu Linux"
    [ "$(. /etc/os-release && echo "$ID")" = ubuntu ] \
      || die "--engine-computer is supported on Ubuntu only"
  fi
  local bun_bin source_dir
  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] Engine computer Stack setup for ${os}/${arch}"
    log "[dry-run] STACK_TAG=${STACK_TAG}"
    log "[dry-run] sudo useradd -r -U -s /usr/sbin/nologin maipai-stack"
    log "[dry-run] If absent, run:"
    log "[dry-run] sudo groupadd --system maipai-stack"
    log "[dry-run] sudo usermod -d /home/maipai-stack maipai-stack"
    log "[dry-run] sudo usermod -g maipai-stack maipai-stack"
    log "[dry-run] sudo passwd --lock maipai-stack"
    log "[dry-run] sudo mkdir -p /data/stack"
    log "[dry-run] sudo chown maipai-stack /data/stack"
    log "[dry-run] sudo chmod 0700 /data/stack"
    log "[dry-run] sudo loginctl enable-linger maipai-stack"
    log "[dry-run] sudo apt-get install openssh-server"
    log "[dry-run] sudo systemctl enable --now ssh"
    log "[dry-run] install Stack at ${ENGINE_STACK_ROOT}"
    log "[dry-run] Stack data directory: ${ENGINE_STACK_DATA}"
    log "[dry-run] Bun installed under ${ENGINE_STACK_ROOT}/.bun"
    log "[dry-run] maipai-engine helper installed"
    log "Ready to pair. On MaiPai Home, open Settings, then Engines."
    return 0
  fi
  if ! id "$ENGINE_STACK_USER" >/dev/null 2>&1; then
    useradd --system --user-group --shell /usr/sbin/nologin \
      "$ENGINE_STACK_USER"
  fi
  getent group "$ENGINE_STACK_USER" >/dev/null 2>&1 \
    || groupadd --system "$ENGINE_STACK_USER"
  usermod --home /home/maipai-stack "$ENGINE_STACK_USER"
  usermod --shell /usr/sbin/nologin "$ENGINE_STACK_USER"
  usermod --gid "$ENGINE_STACK_USER" "$ENGINE_STACK_USER"
  passwd --lock "$ENGINE_STACK_USER" >/dev/null
  install -d -o "$ENGINE_STACK_USER" -g "$ENGINE_STACK_USER" \
    -m 0700 /home/maipai-stack "$ENGINE_STACK_DATA" \
    "$ENGINE_STACK_ROOT"
  if ! command -v sshd >/dev/null 2>&1; then
    read -r -p "Install openssh-server? [y/N] " answer
    case "$answer" in y|Y|yes|YES) apt-get update && apt-get install -y openssh-server ;; *) die "openssh-server is required for pairing" ;; esac
  fi
  systemctl enable --now ssh
  loginctl enable-linger "$ENGINE_STACK_USER"
  local engine_uid
  engine_uid=$(id -u "$ENGINE_STACK_USER")
  local bun_home="${ENGINE_STACK_ROOT}/.bun"
  ensure_bun_system_wide "$bun_home"
  bun_bin="${bun_home}/bin/bun"
  local source_root
  source_root=$(mktemp -d)
  source_dir="${source_root}/stack"
  fetch_stack_source "$source_dir" no || die "Could not fetch Stack source"
  fetch_stack_commons "$source_root" no || die "Could not fetch the Commons packages the Stack needs. Read the message above, fix what it names, then run this installer again"
  local build_dir="${source_root}/output"
  build_stack_binary "$source_dir" "$build_dir" "$bun_bin" no \
    || die "Could not build Stack binary"
  publish_engine_stack_binary "$build_dir" "$ENGINE_STACK_ROOT" \
    "$(render_stack_binary_name "$os" "$arch")" \
    || die "Could not install the compiled Stack files into ${ENGINE_STACK_ROOT}"
  rm -rf "$source_root"
  chown -R "$ENGINE_STACK_USER:$ENGINE_STACK_USER" "$ENGINE_STACK_ROOT"
  local binary="$ENGINE_STACK_ROOT/$(render_stack_binary_name "$os" "$arch")"
  sudo -u "$ENGINE_STACK_USER" env \
    "XDG_RUNTIME_DIR=/run/user/${engine_uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${engine_uid}/bus" \
    STACK_DATA_DIR="$ENGINE_STACK_DATA" PORT="$STACK_PORT_BASE" STACK_BUN_BIN="$bun_bin" \
    "$binary" install-service
  local helper_dir="$PWD" helper_tmp=""
  if [ ! -f "${helper_dir}/scripts/engine-computer/maipai-engine" ]; then
    helper_tmp=$(mktemp -d)
    local home_tag
    home_tag=$(latest_tag)
    fetch_release_source "$home_tag" "$helper_tmp"
    helper_dir="$helper_tmp"
  fi
  install -D -m 0755 "${helper_dir}/scripts/engine-computer/maipai-engine" \
    /usr/local/bin/maipai-engine
  install -D -m 0644 "${helper_dir}/scripts/engine-computer/pair-response.py" \
    /usr/local/lib/maipai-engine/pair-response.py
  [ -z "$helper_tmp" ] || rm -rf "$helper_tmp"
  log "Ready to pair. On MaiPai Home, open Settings, then Engines."
}

# ---------------------------------------------------------------------
# The Stack step the setup wizard asks for (install.sh --stack-only).
# Home's installer no longer builds the Stack: it brings Home up, and when
# the person says this computer also runs the AI, Home starts this step
# (backend/src/lib/stackInstall.ts) and shows the progress this writes. It
# reuses setup_stack and every function above it; nothing is copied.
# ---------------------------------------------------------------------

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\t' '  '
}

# One small JSON file, replaced whole each time, that the Home backend reads.
# state: running | failed | ready. stage: preflight | fetching | building |
# starting (or null). problem: plain words with the next step (or null).
stack_status() {
  local state="$1" stage="${2:-}" problem="${3:-}" file="${STACK_STATUS_FILE:-}" stage_json="null" problem_json="null"
  [ -n "$file" ] || return 0
  [ -z "$stage" ] || stage_json="\"$(json_escape "$stage")\""
  [ -z "$problem" ] || problem_json="\"$(json_escape "$problem")\""
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 0
  printf '{"state":"%s","stage":%s,"problem":%s,"pid":%s,"updatedAt":"%s"}\n' \
    "$state" "$stage_json" "$problem_json" "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${file}.tmp" \
    && mv "${file}.tmp" "$file"
}

STACK_STAGE=""
STACK_PROBLEM=""
STACK_DONE="no"

on_stack_exit() {
  local code=$?
  trap - EXIT
  [ "$STACK_DONE" = "yes" ] && return 0
  [ "$code" -ne 0 ] || code=1
  stack_status failed "" "${STACK_PROBLEM:-The AI engine install stopped part way. Its log is ${STACK_LOG_HINT:-in the Home logs folder}. Press Try again; it picks up where it stopped.}"
  return "$code"
}

stack_main() {
  local dry_run="$1" os arch install_root bun_bin
  os=$(detect_os)
  arch=$(detect_arch)
  [ "$os" = "linux" ] && install_root="$INSTALL_ROOT_LINUX" || install_root="$INSTALL_ROOT_DARWIN"
  bun_bin="${install_root}/.bun/bin/bun"
  # The wizard's Linux sudo rule gives a clean environment, so the port Home
  # was installed with comes from its own record.
  local recorded_port
  recorded_port=$(read_marker "${install_root}/.stack-port-base")
  if [ -z "${MAIPAI_STACK_PORT:-}" ] && valid_port "$recorded_port"; then STACK_PORT_BASE="$recorded_port"; fi

  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] MaiPai Stack install plan for ${os}/${arch} at ${install_root}"
    log "[dry-run] checks before any change: required tools, a logged-in desktop session (macOS), free disk for the AI engine program (sized by the disk plan table, shared/diskPlan.json)"
    log "[dry-run] Stack port ${STACK_PORT_BASE} (or the next free one)"
    log "[dry-run] STACK_TAG=${STACK_TAG}"
    setup_stack "$install_root" "$bun_bin" "$os" "$arch" "yes"
    return 0
  fi

  require_root
  STACK_STATUS_FILE="${STACK_STATUS_FILE:-${install_root}/data/stack-install.json}"
  STACK_LOG_HINT="${install_root}/data/logs/stack-install.log"
  [ -d "${install_root}/backend" ] || die "Home is not installed at ${install_root}. Run the installer first."
  trap on_stack_exit EXIT
  stack_status running preflight

  STACK_PROBLEM="This computer is missing a tool the AI engine needs. The install log (${STACK_LOG_HINT}) names it. Install it, then press Try again."
  check_required_tools "$os"
  STACK_PROBLEM=""
  CONSOLE_FIX_HINT="press Try again in the setup wizard, or run: sudo bash ${install_root}/scripts/install.sh --stack-only"
  if ! check_console_session "$os"; then STACK_PROBLEM="$CONSOLE_PROBLEM"; return 1; fi
  local engine_plan_file
  engine_plan_file=$(disk_plan_file_for "$install_root" "$STACK_TAG")
  if [ -n "$engine_plan_file" ]; then
    if ! check_plan_disk "$engine_plan_file" "$(disk_check_level "" "$install_root")" home "$os" "$install_root"; then STACK_PROBLEM="$DISK_PROBLEM"; return 1; fi
  else
    log "Could not read the disk sizes for this release; continuing. The setup wizard checks the disk again before it downloads."
  fi

  # Bun is part of Home's own install; this only fills a gap.
  [ -x "$bun_bin" ] || { STACK_PROBLEM="Home's Bun runtime is missing at ${bun_bin}. Run the installer again, then press Try again."; return 1; }
  # setup_stack sets the stage and the plain-words problem for each part.
  setup_stack "$install_root" "$bun_bin" "$os" "$arch" "no" || return 1
  STACK_DONE="yes"
  stack_status ready
  log "The MaiPai Stack is running. Home will find it at http://127.0.0.1:$(read_marker "${install_root}/stack/.port")"
  print_reboot_note "$os"
}

# What the failure trap needs to know: how far the install got.
# ""         nothing on disk was changed yet
# "stopped"  the old Home and Stack were stopped, the old files are intact
# "replaced" the new files are in place, services not yet confirmed
# "done"     finished
INSTALL_STAGE=""
INSTALL_ROOT_FOR_TRAP=""
INSTALL_OS_FOR_TRAP=""

# MAIPAI-CLI-01: the `maipai start|stop|restart|status` command. Best effort: a failure here never fails the install.
install_maipai_command() {
  local root="$1" dest="${MAIPAI_COMMAND_DEST:-/usr/local/bin/maipai}"
  if [ -f "${root}/scripts/maipai" ] && mkdir -p "$(dirname "$dest")" 2>/dev/null && install -m 0755 "${root}/scripts/maipai" "$dest" 2>/dev/null; then
    MAIPAI_COMMAND_INSTALLED="yes"
  else
    MAIPAI_COMMAND_INSTALLED="no"
    log "Could not install the maipai command (stop and start still work through the service manager). Run the installer again to retry."
  fi
}

restart_home_service() {
  local os="$1"
  if [ "$os" = "linux" ]; then
    systemctl start maipai-home.service 2>/dev/null || true
  elif [ -f /Library/LaunchDaemons/com.maipai.home.plist ]; then
    launchctl bootstrap system /Library/LaunchDaemons/com.maipai.home.plist 2>/dev/null || true
  fi
}

on_install_exit() {
  local code=$? root="$INSTALL_ROOT_FOR_TRAP" os="$INSTALL_OS_FOR_TRAP"
  trap - EXIT
  [ "$code" -ne 0 ] || return 0
  case "$INSTALL_STAGE" in
    "")
      log "The install stopped before changing anything on this computer. Read the error above, fix it, then run the installer again."
      ;;
    stopped)
      restart_home_service "$os"
      log "The upgrade stopped before any file was replaced. Home was started again on the version it had before. Your data was not touched. Read the error above, fix it, then run the installer again."
      ;;
    replaced)
      log "The install stopped part way. Your data is safe: it is in ${root}/data, and a copy from before the upgrade is in ${root}/upgrade-backups."
      log "To finish, fix what the error above names and run the same installer command again; it resumes where it stopped."
      if [ -f "${root}/.previous-tag" ]; then
        log "To go back to the previous version ($(read_marker "${root}/.previous-tag")) instead, run: sudo bash ${root}/scripts/install.sh --rollback"
      fi
      log "Logs: ${root}/data/logs/launchd.err.log"
      ;;
  esac
}

main() {
  # A script that replaces its own folder must not run from it: rsync below rewrites scripts/install.sh while bash is
  # still reading it (a go-back runs the installed copy). Run from a temporary copy instead.
  if [ -n "${MAIPAI_INSTALL_SELF_COPY:-}" ] && [ "$MAIPAI_INSTALL_SELF_COPY" = "$0" ]; then
    trap 'rm -f "$MAIPAI_INSTALL_SELF_COPY"' EXIT
  elif [ -z "${MAIPAI_INSTALL_SELF_COPY:-}" ] && [ -f "$0" ] && [ "$#" -gt 0 ]; then
    case " $* " in *" --rollback "*|*" --commit "*)
      local self_copy
      if self_copy=$(mktemp "${TMPDIR:-/tmp}/maipai-install.XXXXXX") && cp "$0" "$self_copy"; then
        MAIPAI_INSTALL_SELF_COPY="$self_copy" exec bash "$self_copy" "$@"
      fi ;;
    esac
  fi
  local original_args=("$@")
  local dry_run="no"
  local engine_computer="no"
  local stack_only="no"
  local plan_flag="" plan_flag_seen="no"
  local plan_flag_count=0
  local version_flag="" commit_flag="" rollback="no"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run) dry_run="yes" ;;
      --engine-computer) engine_computer="yes" ;;
      --stack-only) stack_only="yes" ;;
      --rollback) rollback="yes" ;;
      --version)
        [ "$#" -ge 2 ] || die "--version needs a release tag such as v0.1.0. Run bash scripts/install.sh --help for the next step."
        version_flag="$2"; shift ;;
      --commit)
        [ "$#" -ge 2 ] || die "--commit needs a 7 to 40 character commit SHA."
        commit_flag="$2"; shift ;;
      --plan)
        [ "$#" -ge 2 ] || die "--plan needs a value: recommended, moderate, or minimal. Run bash scripts/install.sh --help for the next step."
        plan_flag="$2"; plan_flag_seen="yes"; plan_flag_count=$((plan_flag_count + 1)); shift ;;
      --help|-h)
        log "Usage: install.sh [--dry-run] [--engine-computer] [--stack-only] [--plan recommended|moderate|minimal] [--version vX.Y.Z] [--commit <sha>] [--rollback]"
        log "With no option this brings up MaiPai Home only. The setup wizard then installs the AI engine (the MaiPai Stack) if this computer should run it."
        log "--stack-only installs just the AI engine on a computer that already runs Home. The setup wizard runs it for you; run it by hand only if the wizard says to."
        log "You can also set MAIPAI_PLAN to recommended, moderate, or minimal. The setup wizard still runs its checks before downloads."
        log "Free disk: the installer checks the plan against the disks that will hold Home, its data and the AI (the installed size, 20 percent more, and the space an install uses while it runs). A smaller plan needs less: --plan moderate or --plan minimal. The setup wizard shows each part with its size."
        log "--version installs a specific release instead of the latest. --rollback goes back to the previous release and the data copy taken before the last upgrade."
        log "--commit installs a landed commit from main and records its sha-<first 7> label."
        log "MAIPAI_PORT (default 3000) and MAIPAI_STACK_PORT (default 8770) change the ports."
        exit 0 ;;
      --*) die "Unknown option: $1. Run bash scripts/install.sh --help for allowed options." ;;
      *) die "Unexpected argument: $1. Run bash scripts/install.sh --help for allowed options." ;;
    esac
    shift
  done

  valid_port "$APP_PORT" || die "MAIPAI_PORT is '${APP_PORT}', which is not a port number. Set it to a number from 1 to 65535, or unset it to use ${DEFAULT_APP_PORT}."
  valid_port "$STACK_PORT_BASE" || die "MAIPAI_STACK_PORT is '${STACK_PORT_BASE}', which is not a port number. Set it to a number from 1 to 65535, or unset it to use 8770."
  if [ -n "$version_flag" ]; then
    valid_release_tag "$version_flag" || die "Invalid version '${version_flag}'. Use a release tag such as v0.1.0."
    [ "$rollback" = "no" ] || die "--version and --rollback cannot be used together. --rollback picks the previous release by itself."
  fi
  if [ -n "$commit_flag" ]; then
    printf '%s' "$commit_flag" | grep -Eq '^[0-9a-f]{7,40}$' || die "Invalid commit SHA '${commit_flag}'. Use 7 to 40 lowercase hexadecimal characters."
    [ -z "$version_flag" ] && [ "$rollback" = "no" ] || die "--commit cannot be combined with --version or --rollback."
  fi
  [ -z "$commit_flag" ] || [ -z "$version_flag" ] || die "--commit and --version cannot be used together."

  local requested_plan=""
  if [ "$plan_flag_seen" = "yes" ]; then
    valid_plan "$plan_flag" || die "Invalid plan '$plan_flag'. Allowed values are recommended, moderate, and minimal. Choose one and run the installer again."
    requested_plan="$plan_flag"
    [ "$plan_flag_count" -le 1 ] || log "--plan was given more than once; using the last value, ${plan_flag}."
    if [ -n "${MAIPAI_PLAN:-}" ] && [ "$MAIPAI_PLAN" != "$plan_flag" ]; then
      log "Both --plan and MAIPAI_PLAN were set; using --plan ${plan_flag}."
    fi
  elif [ -n "${MAIPAI_PLAN:-}" ]; then
    valid_plan "$MAIPAI_PLAN" || die "Invalid MAIPAI_PLAN '$MAIPAI_PLAN'. Allowed values are recommended, moderate, and minimal. Set it to one of those values and run the installer again."
    requested_plan="$MAIPAI_PLAN"
  fi

  local os
  os=$(detect_os)
  local arch
  arch=$(detect_arch)

  if [ "$stack_only" = "yes" ]; then
    [ "$engine_computer" = "no" ] && [ "$rollback" = "no" ] && [ -z "$version_flag" ] && [ -z "$commit_flag" ] \
      || die "--stack-only cannot be combined with --engine-computer, --rollback or --version."
    stack_main "$dry_run"
    exit $?
  fi

  if [ "$engine_computer" = "yes" ]; then
    [ "$dry_run" = "yes" ] || require_root
    setup_engine_computer "$dry_run" "$os" "$arch"
    exit 0
  fi

  if [ "$dry_run" = "yes" ]; then
    if [ -n "$commit_flag" ]; then
      local commit_root
      [ "$(uname -s)" = "Linux" ] && commit_root="$INSTALL_ROOT_LINUX" || commit_root="$INSTALL_ROOT_DARWIN"
      log "[dry-run] would install commit ${commit_flag} of main as sha-${commit_flag:0:7} from mirror $(source_mirror_path "$commit_root")"
      exit 0
    fi
    # A focused dry run of Home's own bring-up. The AI engine is not part
    # of it: the setup wizard asks for it, and `--stack-only --dry-run`
    # shows that plan.
    local install_root
    [ "$os" = "linux" ] && install_root="$INSTALL_ROOT_LINUX" || install_root="$INSTALL_ROOT_DARWIN"
    log "[dry-run] MaiPai Home install plan for ${os}/${arch} at ${install_root}"
    log "[dry-run] checks before any change: required tools, free disk for the plan (sized by the disk plan table, shared/diskPlan.json: Home, the AI engine, its models, plus 20 percent and install space)"
    local dry_plan_file
    dry_plan_file=$(fetch_disk_plan main)
    if [ -n "$dry_plan_file" ]; then
      check_plan_disk "$dry_plan_file" "$(disk_check_level "$requested_plan" "$install_root")" full "$os" "$install_root" || log "[dry-run] a real run would stop here: ${DISK_PROBLEM}"
    fi
    log "[dry-run] Home port ${APP_PORT} (or the next free one)"
    ensure_deno "$install_root" "$os" "$arch" yes
    record_setup_plan "${install_root}/data" "$requested_plan" yes
    log "[dry-run] the MaiPai Stack (the AI engine) is not installed now: the setup wizard installs it if you choose to run the AI on this computer"
    log "[dry-run] would wait for Home at http://127.0.0.1:${APP_PORT}/ and print the address to open"
    open_setup_page "$os" "http://localhost:${APP_PORT}" yes
    exit 0
  fi

  require_root
  check_required_tools "$os"

  local install_root
  [ "$os" = "linux" ] && install_root="$INSTALL_ROOT_LINUX" || install_root="$INSTALL_ROOT_DARWIN"
  SOURCE_INSTALL_ROOT="$install_root"
  local bun_home="${install_root}/.bun"

  local installed_tag previous_tag
  installed_tag=$(read_marker "${install_root}/.installed-tag")
  previous_tag=$(read_marker "${install_root}/.previous-tag")

  local tag
  if [ "$rollback" = "yes" ]; then
    [ -n "$previous_tag" ] || die "there is no earlier version to go back to: ${install_root}/.previous-tag does not exist. Rollback only works after an upgrade made by this installer."
    tag="$previous_tag"
  elif [ -n "$version_flag" ]; then
    tag="$version_flag"
  elif [ -n "$commit_flag" ]; then
    ensure_source_mirror "$commit_flag" "$install_root"
    local resolved_commit
    resolved_commit=$(git -C "$(source_mirror_path "$install_root")" rev-parse --verify "${commit_flag}^{commit}") \
      || die "commit ${commit_flag} is ambiguous in the source mirror. Use a full SHA and retry."
    tag="sha-${resolved_commit:0:7}"
    commit_flag="$resolved_commit"
  else
    tag=$(latest_tag)
  fi

  # "upgrade": a finished install is here. "resume": a folder is here but
  # an earlier run never finished. "fresh": nothing yet. record_setup_plan
  # creates data/ before this point, so the folder alone proves nothing.
  local kind="fresh"
  if [ -n "$installed_tag" ]; then kind="upgrade"
  elif [ -d "${install_root}/backend" ]; then kind="resume"
  fi

  # An earlier install that already has a Stack rebuilds it in this run (an
  # upgrade, a rollback or a resume), so it needs the desktop session and the
  # room for the build. A fresh install has neither: Home only.
  local has_stack="no"
  if [ -f "${install_root}/stack/.user" ]; then
    has_stack="yes"
    check_console_session "$os" || exit 1
  fi
  # Free disk, sized by the disk plan table (INSTALL-DISK-01): a fresh install
  # for the whole plan (Home, the AI engine, its models, plus 20 percent and
  # the space an install needs while it runs); an upgrade, a resume or a
  # rollback for Home and the AI engine program only.
  local disk_scope="home" plan_file
  [ "$kind" = "fresh" ] && disk_scope="full"
  plan_file=$(disk_plan_file_for "$install_root" "$tag")
  if [ -n "$plan_file" ]; then
    check_plan_disk "$plan_file" "$(disk_check_level "$requested_plan" "$install_root")" "$disk_scope" "$os" "$install_root" || exit 1
  else
    log "Could not read the disk sizes for ${tag}; continuing. The setup wizard checks the disk again before it downloads."
  fi

  record_setup_plan "${install_root}/data" "$requested_plan" no

  INSTALL_ROOT_FOR_TRAP="$install_root"
  INSTALL_OS_FOR_TRAP="$os"
  trap on_install_exit EXIT

  local had_existing_stack="no"
  local previous_port=""
  if [ "$kind" != "fresh" ]; then
    previous_port=$(previous_home_port "$os")
    if [ "$rollback" = "yes" ]; then
      log "Going back from ${installed_tag:-the current version} to ${tag}."
    elif [ "$kind" = "upgrade" ]; then
      if [[ "$tag" == sha-* ]]; then log "Existing install ${installed_tag} found at ${install_root} - upgrading to commit ${tag#sha-} of main."; else log "Existing install ${installed_tag} found at ${install_root} - upgrading to ${tag}."; fi
    else
      log "An earlier install at ${install_root} did not finish - continuing with ${tag}."
    fi
    if [ "$os" = "linux" ]; then systemctl stop maipai-home.service 2>/dev/null || true
    else launchctl bootout system /Library/LaunchDaemons/com.maipai.home.plist 2>/dev/null || true
    fi
    INSTALL_STAGE="stopped"
    # The Stack's own service stops too, for the same reason Home's
    # does: its binary lives inside the tree the rsync below replaces.
    # had_existing_stack, set here, is read again after setup_stack
    # below runs: if the rebuild fails, engines.stack.url still points
    # at the process just stopped, and needs clearing rather than being
    # left to point at something no longer running.
    if [ -f "${install_root}/stack/.user" ]; then
      had_existing_stack="yes"
      local existing_stack_user
      existing_stack_user=$(cat "${install_root}/stack/.user")
      local existing_binary="${install_root}/stack/$(render_stack_binary_name "$os" "$arch")"
      if [ -n "$existing_stack_user" ] && [ -x "$existing_binary" ]; then
        run_as_console_user "$os" "$existing_stack_user" "$existing_binary" stop 2>/dev/null || true
      fi
    fi
    # The data copy is taken with everything stopped, so the database is
    # not mid-write. A rollback keeps the newer data aside instead.
    if [ "$kind" = "upgrade" ] && [ "$rollback" = "no" ]; then
      snapshot_data "$install_root" "$installed_tag" \
        || die "could not save a copy of your data before upgrading (is the disk full?). Nothing was changed. Free up space, then run the installer again."
      record_previous_tag "$install_root" "$installed_tag" "$tag"
    fi
    rm -rf "${install_root}.new"
    fetch_release_source "$tag" "${install_root}.new" \
      || die "could not download ${REPO}@${tag}. Check that this computer can reach github.com, then run the installer again. Nothing was changed."
    if [ -n "$commit_flag" ]; then
      reexec_with_source_installer "${install_root}.new" "${original_args[@]}"
    fi
    check_home_pins "${install_root}.new" "${tag}" \
      || die "the source for ${tag} cannot be installed by this installer. Nothing was changed."
    # From here a failure can leave files half replaced, so the exit handler must not say none were.
    INSTALL_STAGE="replaced"
    # rsync --delete so a file the new release removed also disappears
    # here (a plain cp -a only ever adds/overwrites) - but data/,
    # backups/, received-backups/ (lib/paths.ts's own layout, all three
    # direct children of the install root, siblings of backend/), and
    # stack/data/ (the Stack's own equivalent, a child of stack/) are
    # real runtime state, never part of a release tarball, and must
    # never be deleted just because they're absent from `.new`. The same
    # goes for the Bun runtime, the upgrade copies and the version markers.
    rsync -a --delete \
      --exclude=/data --exclude=/data.rolled-back-* --exclude=/backups --exclude=/received-backups \
      --exclude=/stack --exclude=/.bun --exclude=/upgrade-backups \
      --exclude=/backend/node_modules --exclude=/frontend/node_modules \
      --exclude=/.installed-tag --exclude=/.previous-tag --exclude=/.stack-port-base --exclude=/.install-user \
      "${install_root}.new/" "${install_root}/"
    rm -rf "${install_root}.new"
    INSTALL_STAGE="replaced"
    if [ "$rollback" = "yes" ]; then
      restore_snapshot "$install_root" "$tag" || die "could not restore the data copy from ${tag}. Your current data is still in ${install_root}/data. Run the installer with --rollback again, or restore a copy by hand from ${install_root}/upgrade-backups."
    fi
  else
    fetch_release_source "$tag" "$install_root" \
      || die "could not download ${REPO}@${tag}. Check that this computer can reach github.com, then run the installer again. Nothing was installed."
    INSTALL_STAGE="replaced"
  fi

  # Chosen only now, after an existing Home has been stopped above: probed
  # while the old service still held its port, an upgrade moved Home to the
  # next free port (3001) every time, and the address in the final line and
  # every bookmark changed with it. An upgrade keeps the port the last
  # install used unless MAIPAI_PORT says otherwise.
  local want_port="$APP_PORT"
  if [ -z "${MAIPAI_PORT:-}" ] && [ -n "$previous_port" ]; then want_port="$previous_port"; fi
  local port
  port=$(find_free_port "$want_port")
  if [ "$port" != "$want_port" ]; then
    log "Port ${want_port} is already in use - using ${port} instead."
  fi

  ensure_bun_system_wide "$bun_home"
  ensure_deno "$install_root" "$os" "$arch"
  local bun_bin="${bun_home}/bin/bun"
  clear_quarantine_and_sign "$os" "$install_root" "$bun_bin"
  build_app "$install_root" "$bun_bin"
  run_install_preflight "$bun_bin" "${install_root}/backend" "$port"

  # Records for the wizard's Stack step, which runs later with a clean
  # environment: the Stack port base and, on Linux, the person to run the
  # Stack as.
  printf '%s\n' "$STACK_PORT_BASE" > "${install_root}/.stack-port-base"
  if [ "$os" = "linux" ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] && [ "$SUDO_USER" != "$SERVICE_USER" ]; then
    printf '%s\n' "$SUDO_USER" > "${install_root}/.install-user"
  fi

  # A Stack that was already here is rebuilt before Home starts, as it always
  # was: its binary lives in the tree this run replaced. A fresh install has
  # none; the setup wizard installs it when the person says this computer
  # runs the AI.
  local stack_port
  if [ "$has_stack" = "yes" ]; then
    if ! setup_stack "$install_root" "$bun_bin" "$os" "$arch" "no"; then
      log "The MaiPai Stack could not be rebuilt. Home's service was not started."
      exit 1
    fi
    stack_port=$(read_marker "${install_root}/stack/.port")
  else
    stack_port="$STACK_PORT_BASE"
  fi
  valid_port "$stack_port" || stack_port="$STACK_PORT_BASE"

  if [ "$os" = "linux" ]; then
    ensure_service_user_linux
    install_stack_step_unit "$install_root"
    install_systemd_unit "$install_root" "$bun_bin" "$port" "$stack_port"
  else
    install_launchd_daemon "$install_root" "$bun_bin" "$port" "$stack_port"
    install_log_rotation "$os" "$install_root"
  fi

  if ! wait_for_url "http://127.0.0.1:${port}/" "MaiPai Home" 120; then
    log "Home did not come up. Its log: ${install_root}/data/logs/launchd.err.log"
    log "Fix what the log names, then run the installer again; it resumes safely."
    exit 1
  fi
  if [ "$has_stack" = "yes" ]; then
    wait_for_url "http://127.0.0.1:${stack_port}/healthz" "The MaiPai Stack" 20 \
      || log "The Stack is not answering yet. Home will keep retrying; its log: ${install_root}/stack/data/logs/stack.error.log"
  fi

  install_maipai_command "$install_root"

  # Markers last, so an install that died earlier is still seen as
  # unfinished by the next run.
  if [ "$rollback" = "yes" ]; then
    printf '%s\n' "$tag" > "${install_root}/.installed-tag"
    if [ -n "$installed_tag" ] && [ "$installed_tag" != "$tag" ]; then printf '%s\n' "$installed_tag" > "${install_root}/.previous-tag"; fi
  else
    if [ -n "$installed_tag" ] && [ "$installed_tag" != "$tag" ]; then printf '%s\n' "$installed_tag" > "${install_root}/.previous-tag"; fi
    printf '%s\n' "$tag" > "${install_root}/.installed-tag"
  fi
  INSTALL_STAGE="done"
  trap - EXIT

  log ""
  log "MaiPai Home ${tag} is installed and running at http://localhost:${port}"
  [ "${MAIPAI_COMMAND_INSTALLED:-no}" != "yes" ] || log "Stop or start Home any time with: maipai stop, maipai start, maipai status"
  if [ "$os" = "darwin" ]; then
    local lan_name
    lan_name=$(scutil --get LocalHostName 2>/dev/null || true)
    [ -z "$lan_name" ] || log "From another device on your network: http://${lan_name}.local:${port}"
  fi
  if [ "$has_stack" = "yes" ]; then
    log "Logs: ${install_root}/data/logs/ (Home), ${install_root}/stack/data/logs/ (Stack)."
    print_reboot_note "$os"
  else
    log "The setup wizard asks where the AI runs. If it runs on this computer, the wizard installs the AI engine then and shows its progress."
    log "No browser at this computer? From another computer on your network, open that address with this computer's name in place of localhost."
    log "Logs: ${install_root}/data/logs/"
  fi
  open_setup_page "$os" "http://localhost:${port}" || true
  log ""
  log "Open this address to finish setup: http://localhost:${port}"
}

# Guarded so scripts/install.test.ts and uninstall.sh can `source` this
# file to reuse its functions (render/pure ones for testing; detect_os/
# detect_arch/render_stack_binary_name for uninstall.sh, one definition
# instead of a second copy) without main() also running for real.
# `[[ "${BASH_SOURCE[0]}" == "${0}" ]]` looks like the right check and
# is wrong: piped execution (this script's own documented `curl -fsSL
# ... | bash` usage) has an EMPTY BASH_SOURCE[0] and $0 of "bash", so
# that comparison is false and main() would silently never run - found
# by a code review, confirmed with `echo 'echo "[${BASH_SOURCE[0]}]
# [$0]"' | bash` printing "[] [bash]". `(return 0 2>/dev/null)` is the
# portable "am I sourced" test instead: `return` at the top level of an
# executed script is an error (so the subshell exits non-zero and the
# `&&` short-circuits), while a sourced file's `return` succeeds - true
# for direct execution, piped execution, and `bash install.sh` alike,
# proven against all three before trusting it here.
if ! (return 0 2>/dev/null); then
  main "$@"
fi
