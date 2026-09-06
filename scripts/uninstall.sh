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
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

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

echo "== Done. The application files under $ROOT are still here -"
echo "   delete this directory yourself once you've confirmed data/ is handled."
