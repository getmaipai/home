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
#
# Idempotent: re-running upgrades an existing install in place (stop,
# replace the source tree, keep data/backups untouched, restart) - the
# Stack's own binary is rebuilt from STACK_TAG and its service restarted
# the same way.
set -euo pipefail

REPO="getmaipai/home"
STACK_REPO="getmaipai/stack"
# HOME-STACK-01: the Stack has no release of its own, so this is a
# commit, not a tag - bumped by whoever cuts a Home release, to whatever
# stack commit that release is meant to carry (docs/dev.md's own "What
# Home's release carries" paragraph). Today's value is the commit that
# fixed scripts/build-binary.sh's own OUT_DIR handling for an absolute
# path - exactly what this installer always passes it - found live
# wiring this file up for real; the commit before it (b1f40da) compiles
# but silently writes the binary to the wrong place under this
# installer's own real usage.
STACK_TAG="233bc4fd91c01efd54aa44d9147bcccd6fe956a9"
# The Stack at STACK_TAG pins core-v0.1.0 as file:../../commons/core.
# Keep the Commons pin and the digest of GitHub's archive together here;
# the archive digest is verified before anything is extracted.
COMMONS_CORE_TAG="core-v0.1.0"
COMMONS_CORE_SHA256="d3c60aec818e73c00079e5a819d86477ecb590a0172f214a0aee80890d8427f4"
INSTALL_ROOT_LINUX="/opt/maipai-home"
INSTALL_ROOT_DARWIN="/usr/local/maipai-home"
SERVICE_USER="maipai"
APP_PORT="${MAIPAI_PORT:-3000}"
# stack/backend/src/lib/stack/client.ts's own DEFAULT_BASE_URL port.
STACK_PORT_BASE=8770
ENGINE_STACK_USER=maipai-stack
ENGINE_STACK_ROOT=/opt/maipai-stack
ENGINE_STACK_DATA=/data/stack

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

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
  tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  [ -n "$tag" ] || die "could not find a published release for ${REPO} yet - there is nothing to install (this project has not cut v0.1.0 yet)"
  echo "$tag"
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

ensure_bun_system_wide() {
  local bun_home="$1"
  if [ -x "${bun_home}/bin/bun" ]; then return; fi
  log "Installing the Bun runtime to ${bun_home}..."
  mkdir -p "$bun_home"
  curl -fsSL https://bun.sh/install | BUN_INSTALL="$bun_home" bash
  [ -x "${bun_home}/bin/bun" ] || die "Bun install did not produce ${bun_home}/bin/bun"
}

fetch_release_source() {
  local tag="$1" dest="$2"
  log "Fetching ${REPO}@${tag}..."
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  curl -fsSL "https://github.com/${REPO}/archive/refs/tags/${tag}.tar.gz" -o "${tmp}/src.tar.gz"
  mkdir -p "$dest"
  tar -xzf "${tmp}/src.tar.gz" -C "$dest" --strip-components=1
}

build_app() {
  local dir="$1" bun_bin="$2"
  log "Installing dependencies and building the frontend (this can take a minute)..."
  (cd "$dir/backend" && "$bun_bin" install --production)
  (cd "$dir/frontend" && "$bun_bin" install && "$bun_bin" run build)
}

install_systemd_unit() {
  local dir="$1" bun_bin="$2" port="$3"
  local unit=/etc/systemd/system/maipai-home.service
  cat >"$unit" <<EOF
[Unit]
Description=MaiPai Home
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${dir}/backend
Environment=NODE_ENV=production
Environment=PORT=${port}
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
  local dir="$1" bun_bin="$2" port="$3"
  local plist=/Library/LaunchDaemons/com.maipai.home.plist
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
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>${port}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
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
    user=$(logname 2>/dev/null || echo "${SUDO_USER:-}")
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
  curl -fsSL "https://github.com/${STACK_REPO}/archive/${STACK_TAG}.tar.gz" -o "${tmp}/stack.tar.gz" || return 1
  mkdir -p "$dest" || return 1
  tar -xzf "${tmp}/stack.tar.gz" -C "$dest" --strip-components=1 || return 1
}

commons_core_sha256() {
  printf '%s\n' "$COMMONS_CORE_SHA256"
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

# Stack's backend/package.json resolves file:../../commons/core from
# <workspace>/stack/backend, so the pinned workspace must live at
# <workspace>/commons/core beside the fetched Stack source.
fetch_stack_commons() {
  local dest="$1" dry_run="$2"
  local tag="$COMMONS_CORE_TAG" expected
  expected=$(commons_core_sha256)
  if [ "$dry_run" = "yes" ]; then
    log "[dry-run] would fetch getmaipai/commons@${tag} (sha256 ${expected}) into ${dest}/core"
    return 0
  fi
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  log "Fetching getmaipai/commons@${tag}..."
  curl -fsSL "https://github.com/getmaipai/commons/archive/refs/tags/${tag}.tar.gz" -o "${tmp}/commons.tar.gz" || return 1
  local actual
  actual=$(sha256_file "${tmp}/commons.tar.gz") || return 1
  if [ "$actual" != "$expected" ]; then
    log "Commons ${tag} archive SHA-256 mismatch: expected ${expected}, got ${actual}"
    return 1
  fi
  mkdir -p "$dest" || return 1
  tar -xzf "${tmp}/commons.tar.gz" -C "$dest" --strip-components=1 "commons-${tag}/core" || return 1
  [ -f "${dest}/core/package.json" ] || { log "Commons ${tag} archive is missing core/package.json"; return 1; }
}

# Builds via the Stack's own scripts/build-binary.sh (one definition:
# this installer never re-implements what that script already does -
# compile, the migrations/ sibling, and backend-src/, the vendored
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

  local stack_port
  stack_port=$(find_free_port "$STACK_PORT_BASE")

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
  sudo -u "$stack_user" env "${install_service_argv[@]}" \
    || { log "The Stack's install-service command failed. The MaiPai Stack is required; installation cannot continue."; return 1; }
  if [ "$os" = "linux" ]; then
    loginctl enable-linger "$stack_user" 2>/dev/null || true
  fi

  log "Waiting for the Stack to answer at http://127.0.0.1:${stack_port}/healthz..."
  local tries=0 max_tries=40
  [ -n "${STACK_HEALTH_TRIES:-}" ] && max_tries="$STACK_HEALTH_TRIES"
  while ! curl -sf "http://127.0.0.1:${stack_port}/healthz" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge "$max_tries" ]; then
      log "The Stack did not answer /healthz in time. The MaiPai Stack is required; installation cannot continue."
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
  fetch_stack_source "$source_dir" "$dry_run" || { log "Could not fetch the Stack's source. The MaiPai Stack is required; installation cannot continue."; [ "$dry_run" = "yes" ] || rm -rf "$source_root"; return 1; }
  fetch_stack_commons "${source_root}/commons" "$dry_run" || { log "Could not fetch the Stack's pinned Commons dependency. The MaiPai Stack is required; installation cannot continue."; [ "$dry_run" = "yes" ] || rm -rf "$source_root"; return 1; }
  build_stack_binary "$source_dir" "$stack_dir" "$bun_bin" "$dry_run" || { log "Could not build the Stack binary. The MaiPai Stack is required; installation cannot continue."; [ "$dry_run" = "yes" ] || rm -rf "$source_root"; return 1; }
  [ "$dry_run" = "yes" ] || rm -rf "$source_root"
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
  fetch_stack_commons "${source_root}/commons" no || die "Could not fetch Stack's pinned Commons dependency"
  build_stack_binary "$source_dir" "$ENGINE_STACK_ROOT" "$bun_bin" no \
    || die "Could not build Stack binary"
  rm -rf "$source_root"
  chown -R "$ENGINE_STACK_USER:$ENGINE_STACK_USER" "$ENGINE_STACK_ROOT"
  local binary="$ENGINE_STACK_ROOT/$(render_stack_binary_name "$os" "$arch")"
  sudo -u "$ENGINE_STACK_USER" env \
    "XDG_RUNTIME_DIR=/run/user/${engine_uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${engine_uid}/bus" \
    STACK_DATA_DIR="$ENGINE_STACK_DATA" PORT=8770 STACK_BUN_BIN="$bun_bin" \
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

main() {
  local dry_run="no"
  local engine_computer="no"
  for arg in "$@"; do
    case "$arg" in
      --dry-run) dry_run="yes" ;;
      --engine-computer) engine_computer="yes" ;;
    esac
  done

  local os
  os=$(detect_os)
  local arch
  arch=$(detect_arch)

  if [ "$engine_computer" = "yes" ]; then
    [ "$dry_run" = "yes" ] || require_root
    setup_engine_computer "$dry_run" "$os" "$arch"
    exit 0
  fi

  if [ "$dry_run" = "yes" ]; then
    # A focused dry run: what the Stack half of this installer would do,
    # against the values a real run on this machine would use. It does
    # not also simulate Home's own pre-existing fetch/build/service
    # steps above (those never supported a dry run before this item and
    # adding it is out of this item's own scope) - running this script
    # for real is still how Home's own half gets proven.
    local install_root
    [ "$os" = "linux" ] && install_root="$INSTALL_ROOT_LINUX" || install_root="$INSTALL_ROOT_DARWIN"
    local bun_bin="${install_root}/.bun/bin/bun"
    log "[dry-run] MaiPai Stack install plan for ${os}/${arch} at ${install_root}"
    log "[dry-run] STACK_TAG=${STACK_TAG}"
    setup_stack "$install_root" "$bun_bin" "$os" "$arch" "yes"
    exit 0
  fi

  require_root
  local tag
  tag=$(latest_tag)
  local install_root
  [ "$os" = "linux" ] && install_root="$INSTALL_ROOT_LINUX" || install_root="$INSTALL_ROOT_DARWIN"
  local bun_home="${install_root}/.bun"

  local port
  port=$(find_free_port "$APP_PORT")
  if [ "$port" != "$APP_PORT" ]; then
    log "Port ${APP_PORT} is already in use - using ${port} instead."
  fi

  local upgrading="no"
  [ -d "$install_root" ] && upgrading="yes"
  local had_existing_stack="no"

  if [ "$upgrading" = "yes" ]; then
    log "Existing install found at ${install_root} - upgrading to ${tag}."
    if [ "$os" = "linux" ]; then systemctl stop maipai-home.service 2>/dev/null || true
    else launchctl bootout system /Library/LaunchDaemons/com.maipai.home.plist 2>/dev/null || true
    fi
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
        sudo -u "$existing_stack_user" "$existing_binary" stop 2>/dev/null || true
      fi
    fi
    rm -rf "${install_root}.new"
    fetch_release_source "$tag" "${install_root}.new"
    # rsync --delete so a file the new release removed also disappears
    # here (a plain cp -a only ever adds/overwrites) - but data/,
    # backups/, received-backups/ (lib/paths.ts's own layout, all three
    # direct children of the install root, siblings of backend/), and
    # stack/data/ (the Stack's own equivalent, a child of stack/) are
    # real runtime state, never part of a release tarball, and must
    # never be deleted just because they're absent from `.new`.
    rsync -a --delete \
      --exclude=/data --exclude=/backups --exclude=/received-backups --exclude=/stack \
      "${install_root}.new/" "${install_root}/"
    rm -rf "${install_root}.new"
  else
    fetch_release_source "$tag" "$install_root"
  fi

  ensure_bun_system_wide "$bun_home"
  local bun_bin="${bun_home}/bin/bun"
  build_app "$install_root" "$bun_bin"

  # The Stack must be fully installed and configured before Home's own
  # service starts.
  if ! setup_stack "$install_root" "$bun_bin" "$os" "$arch" "no"; then
    log "MaiPai Stack setup failed. Home requires the Stack. Home's service was not started."
    exit 1
  fi

  if [ "$os" = "linux" ]; then
    ensure_service_user_linux
    install_systemd_unit "$install_root" "$bun_bin" "$port"
  else
    install_launchd_daemon "$install_root" "$bun_bin" "$port"
  fi

  log ""
  log "MaiPai Home ${tag} is installed and running at http://localhost:${port}"
  log "Open that address in a browser to finish setup."
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
