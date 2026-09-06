#!/usr/bin/env bash
# MaiPai Home installer for macOS and Linux. Installs the latest tagged
# release (never `main` - "the hub deploys from the latest release tag,
# not from main, so main can break without breaking the house") into a
# fixed system location, registers it as a background service (launchd
# on macOS, systemd on Linux) so it survives a reboot with no one logged
# in, and starts it.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | bash
#
# Idempotent: re-running upgrades an existing install in place (stop,
# replace the source tree, keep data/backups untouched, restart).
set -euo pipefail

REPO="getmaipai/home"
INSTALL_ROOT_LINUX="/opt/maipai-home"
INSTALL_ROOT_DARWIN="/usr/local/maipai-home"
SERVICE_USER="maipai"
APP_PORT="${MAIPAI_PORT:-3000}"

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
  BUN_INSTALL="$bun_home" curl -fsSL https://bun.sh/install | bash
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
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_ROOT_LINUX"
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

main() {
  require_root
  local os
  os=$(detect_os)
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

  if [ "$upgrading" = "yes" ]; then
    log "Existing install found at ${install_root} - upgrading to ${tag}."
    if [ "$os" = "linux" ]; then systemctl stop maipai-home.service 2>/dev/null || true
    else launchctl bootout system /Library/LaunchDaemons/com.maipai.home.plist 2>/dev/null || true
    fi
    rm -rf "${install_root}.new"
    fetch_release_source "$tag" "${install_root}.new"
    # rsync --delete so a file the new release removed also disappears
    # here (a plain cp -a only ever adds/overwrites) - but data/,
    # backups/, and received-backups/ (lib/paths.ts's own layout, all
    # three direct children of the install root, siblings of backend/)
    # are real runtime state, never part of a release tarball, and must
    # never be deleted just because they're absent from `.new`.
    rsync -a --delete \
      --exclude=/data --exclude=/backups --exclude=/received-backups \
      "${install_root}.new/" "${install_root}/"
    rm -rf "${install_root}.new"
  else
    fetch_release_source "$tag" "$install_root"
  fi

  ensure_bun_system_wide "$bun_home"
  local bun_bin="${bun_home}/bin/bun"
  build_app "$install_root" "$bun_bin"

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

main "$@"
