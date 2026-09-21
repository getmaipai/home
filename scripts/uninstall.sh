#!/usr/bin/env bash
# Uninstalls MaiPai Home from this machine (plan 4.15). Removes whatever
# service registration exists (systemd, launchd, or a Windows service -
# step 11 is the actual service installer; this handles "none installed
# yet" gracefully rather than assuming one exists, since it can land and
# be exercised before that step does), then asks whether to keep or wipe
# the household's own data - `data/` (people, memories, conversations,
# models) AND its two sibling directories (backend/src/lib/paths.ts's own
# layout: local backups and backups a paired device pushed here are never
# nested inside `data/`). Honors MAIPAI_DATA_DIR/MAIPAI_BACKUP_DIR the
# same way the backend itself does, for an install that relocated them.
# Never destroys anything silently: the default on every prompt is "keep."
#
# Also removes the MaiPai Stack (HOME-STACK-01), if scripts/install.sh
# installed one: reads the account it runs as back from stack/.user (the
# marker install.sh wrote), and joins the one existing confirmation
# below rather than a second prompt of its own - "delete my data" means
# every directory listed, stack/data included, or none of them.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# Sourced, not copied: detect_os/detect_arch/render_stack_binary_name
# below are install.sh's own (one definition - a code review found an
# earlier version of this file re-typed the OS/arch mapping inline,
# which a new architecture or platform branch could update in one file
# and not the other). Safe to source: install.sh only runs its own
# main() when executed or piped, never when sourced (see its own
# comment at the bottom for why that guard is written the way it is).
source "${ROOT}/scripts/install.sh"

echo "MaiPai Home uninstaller"
echo "Repo root: $ROOT"
echo

# --- Service (the exact names/locations scripts/install.sh registers) ---
SERVICE_NAME="maipai-home"
removed_service=false

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
  echo "== Found a systemd unit: ${SERVICE_NAME}.service"
  sudo systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
  sudo systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
  sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  sudo systemctl daemon-reload
  echo "   Removed."
  removed_service=true
fi

if command -v launchctl >/dev/null 2>&1; then
  # A LaunchDaemon (system domain), not a LaunchAgent - install.sh
  # registers it that way deliberately, so the hub keeps running with no
  # one logged in, the same reason systemd's unit above targets
  # multi-user.target rather than a per-user session.
  PLIST="/Library/LaunchDaemons/com.maipai.home.plist"
  if [ -f "$PLIST" ]; then
    echo "== Found a launchd daemon: $PLIST"
    sudo launchctl bootout system "$PLIST" 2>/dev/null || true
    sudo rm -f "$PLIST"
    echo "   Removed."
    removed_service=true
  fi
fi

if ! $removed_service; then
  echo "== No registered service found (systemd/launchd) - nothing to unregister."
  echo "   On Windows, run: winsw.exe uninstall \"<install dir>\\maipai-home-service.xml\" from an elevated prompt."
fi
echo

# --- The Stack's own service (HOME-STACK-01), if install.sh installed
# one: the marker file names the account it runs as (install.sh runs it
# as the logged-in console user, never root - see that script's own
# header for why). Unregistering it happens either way, below, after
# the one confirmation - `maipai-stack uninstall-service` both stops the
# service and, with --remove-data, deletes STACK_DATA_DIR in one call,
# so it is normally the thing that actually deletes stack/data, not a
# plain rm.
#
# STACK_USER (found) and STACK_BINARY_USABLE (can actually run
# uninstall-service) are deliberately tracked separately - a code
# review found an earlier version conflated them into one variable,
# cleared entirely the moment the binary check failed, which silently
# dropped stack/data from the confirmation below even when it plainly
# still existed on disk (the binary losing its execute bit, or being
# removed by a partial reinstall, are real states, not hypothetical
# ones - the data surviving either one is exactly the case this
# confirmation exists to protect).
STACK_USER=""
STACK_DATA_DIR=""
STACK_BINARY=""
STACK_BINARY_USABLE=false
if [ -f "${ROOT}/stack/.user" ]; then
  STACK_USER="$(cat "${ROOT}/stack/.user")"
  STACK_DATA_DIR="${ROOT}/stack/data"
  STACK_OS="$(detect_os 2>/dev/null || echo "")"
  STACK_ARCH="$(detect_arch 2>/dev/null || echo "")"
  if [ -n "$STACK_OS" ] && [ -n "$STACK_ARCH" ]; then
    STACK_BINARY="${ROOT}/stack/$(render_stack_binary_name "$STACK_OS" "$STACK_ARCH")"
    [ -n "$STACK_USER" ] && [ -x "$STACK_BINARY" ] && STACK_BINARY_USABLE=true
  fi
fi

if [ -n "$STACK_USER" ]; then
  if $STACK_BINARY_USABLE; then
    echo "== Found the Stack, running as ${STACK_USER}: ${STACK_BINARY}"
  else
    echo "== Found a Stack install (ran as ${STACK_USER}) but its binary is missing or not executable at ${STACK_BINARY}."
    echo "   Its data will still be offered below; its service registration will need removing by hand (see the note after)."
  fi
else
  echo "== No Stack install found (or scripts/install.sh's Stack half never came up) - nothing to unregister there."
fi
echo

# --- data/, and its two sibling directories (backend/src/lib/paths.ts's
# own layout: backupDir and receivedBackupsDir are deliberately siblings
# of data/, never subdirectories inside it) ---
#
# A code review (2026-09-06) found this section had two real gaps:
# hardcoding "$ROOT/data" ignored the exact MAIPAI_DATA_DIR override the
# backend itself honors (an admin who relocated their data directory got
# a false "nothing found here"), and this header's own claim that
# deleting "data/" covers backups was never true - backups live in
# siblings this script never touched, silently leaving real household
# data behind after what was presented as a full wipe. Both fixed: every
# directory below is found the same way the backend finds it (the env
# override first, the documented default otherwise), and all three are
# offered together under one confirmation, since "delete my data" means
# all of it or none of it, not two out of three directories.
DATA_DIR="${MAIPAI_DATA_DIR:-$ROOT/data}"
BACKUP_DIR="${MAIPAI_BACKUP_DIR:-$ROOT/backups}"
RECEIVED_BACKUPS_DIR="$(dirname "$BACKUP_DIR")/received-backups"

FOUND_ANY=false
for D in "$DATA_DIR" "$BACKUP_DIR" "$RECEIVED_BACKUPS_DIR"; do
  if [ -d "$D" ]; then
    FOUND_ANY=true
    SIZE=$(du -sh "$D" 2>/dev/null | cut -f1)
    echo "== Found: $D ($SIZE)"
  fi
done
if [ -n "$STACK_USER" ] && [ -d "$STACK_DATA_DIR" ]; then
  FOUND_ANY=true
  SIZE=$(du -sh "$STACK_DATA_DIR" 2>/dev/null | cut -f1)
  echo "== Found: $STACK_DATA_DIR ($SIZE) - the Stack's own models and settings"
fi

CONFIRM=""
if $FOUND_ANY; then
  echo "   Together, this is every person, memory, conversation, model and backup."
  read -r -p "   Delete all of it? Type exactly \"DELETE MY DATA\" to confirm, anything else keeps everything: " CONFIRM
  if [ "$CONFIRM" = "DELETE MY DATA" ]; then
    for D in "$DATA_DIR" "$BACKUP_DIR" "$RECEIVED_BACKUPS_DIR"; do
      [ -d "$D" ] && rm -rf "$D" && echo "   Deleted $D."
    done
  else
    echo "   Kept - nothing above was touched. Move these somewhere safe if you're removing this directory too."
  fi
else
  echo "== No data directories found at $DATA_DIR, $BACKUP_DIR, or $RECEIVED_BACKUPS_DIR."
  echo "   If you moved MAIPAI_DATA_DIR or MAIPAI_BACKUP_DIR elsewhere, set them before running this script."
fi
echo

if [ -n "$STACK_USER" ]; then
  if $STACK_BINARY_USABLE; then
    if [ "$CONFIRM" = "DELETE MY DATA" ]; then
      echo "== Removing the Stack's service and data..."
      sudo -u "$STACK_USER" env STACK_DATA_DIR="$STACK_DATA_DIR" "$STACK_BINARY" uninstall-service --remove-data
    else
      echo "== Removing the Stack's service (data kept)..."
      sudo -u "$STACK_USER" env STACK_DATA_DIR="$STACK_DATA_DIR" "$STACK_BINARY" uninstall-service
    fi
  else
    # No usable binary to call uninstall-service through, so this
    # script deletes stack/data itself when confirmed (it is a plain
    # directory under $STACK_DATA_DIR, not something only the binary
    # can remove) - but the service registration needs a person to
    # remove it, since this script has no way to run one as $STACK_USER.
    if [ "$CONFIRM" = "DELETE MY DATA" ]; then
      [ -d "$STACK_DATA_DIR" ] && rm -rf "$STACK_DATA_DIR" && echo "   Deleted $STACK_DATA_DIR."
    fi
    echo "== Could not run uninstall-service (no usable binary) - remove its service registration by hand as ${STACK_USER}:"
    echo "   macOS:  sudo -u ${STACK_USER} launchctl bootout gui/\$(id -u ${STACK_USER})/com.maipai.stack"
    echo "   Linux:  sudo -u ${STACK_USER} systemctl --user stop maipai-stack.service"
  fi
  echo
fi

echo "== Done. The application files under $ROOT are still here -"
echo "   delete this directory yourself once you've confirmed data/ is handled."
