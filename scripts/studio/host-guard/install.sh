#!/bin/bash
# Installs the MaiPai host guard (HOST-GUARD-01). Run as root (the host-tune item or the macOS password box does that).
#   install.sh --owner <account> --uid <n> --data-dir <path> [--source <maipai-host-guard>]   install and start in dry mode
#   install.sh --check --owner <account> --uid <n> --data-dir <path> [--source <file>]        validate only; no root needed
#   --dev-data <path>   optional: a development data folder (land/landings.jsonl, ship/shipped.jsonl) whose timestamps the memory probe
#                       counts, so file-event growth can be matched to build activity. Only timestamps are read.
# Replaces the 2026-11-03 one-off (maipai-watchdog) when it is present: carries its mode over and removes it.
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

CHECK=0; OWNER=""; UIDN=""; DATA=""; SRC=""; DEV_DATA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK=1 ;;
    --owner) OWNER="${2:-}"; shift ;;
    --uid) UIDN="${2:-}"; shift ;;
    --data-dir) DATA="${2:-}"; shift ;;
    --source) SRC="${2:-}"; shift ;;
    --dev-data) DEV_DATA="${2:-}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
[[ -n "$OWNER" && -n "$UIDN" && -n "$DATA" ]] || { echo "usage: install.sh [--check] --owner <account> --uid <n> --data-dir <path> [--source <file>]" >&2; exit 2; }
[[ "$OWNER" =~ ^[A-Za-z][A-Za-z0-9._-]*$ && "$OWNER" != "ALL" && "$UIDN" =~ ^[0-9]+$ && "$DATA" == /* && "$DATA" != *\"* && "$DATA" != *\\* ]] || { echo "owner, uid or data-dir has an unsafe form" >&2; exit 2; }
[[ -z "$DEV_DATA" || ( "$DEV_DATA" =~ ^/[A-Za-z0-9._/\ -]+$ && "$DEV_DATA" != *..* ) ]] || { echo "dev-data has an unsafe form" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SRC:-$HERE/maipai-host-guard}"

DEST="/usr/local/libexec/maipai-host-guard"
PLIST="/Library/LaunchDaemons/com.maipai.host-guard.plist"
SUDOERS="/etc/sudoers.d/maipai-host-guard"
STATE="/var/db/maipai-host-guard"
OLD_STATE="/var/db/maipai-watchdog"

bash -n "$SRC"
PLIST_BODY='<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.maipai.host-guard</string>
<key>ProgramArguments</key><array><string>/usr/local/libexec/maipai-host-guard</string><string>run</string></array>
<key>StartInterval</key><integer>60</integer>
<key>RunAtLoad</key><true/>
<key>Nice</key><integer>-5</integer>
<key>StandardOutPath</key><string>/var/log/maipai-host-guard.log</string>
<key>StandardErrorPath</key><string>/var/log/maipai-host-guard.log</string>
</dict></plist>'
SUDOERS_BODY="# MaiPai host guard recovery commands (HOST-GUARD-01). Remove: sudo $DEST uninstall
$OWNER ALL=(root) NOPASSWD: $DEST status, $DEST mode off, $DEST mode dry, $DEST mode live, $DEST capture, $DEST uninstall, /sbin/shutdown -r now"
CONFIG_BODY="{\"owner\":\"$OWNER\",\"uid\":$UIDN,\"data_dir\":\"$DATA\"${DEV_DATA:+,\"dev_data\":\"$DEV_DATA\"}}"
# Self-repair bounds (HOST-GUARD-08), root-owned so only an administrator changes them; the guard clamps every value again.
REPAIR_BODY='{"mode":"live","capture_gb":4,"fsevents_compressed_gb":8,"emergency_gb":40,"shed_minutes":20}'

tmp="$(mktemp /tmp/maipai-sudoers.XXXXXX)"; printf '%s\n' "$SUDOERS_BODY" > "$tmp"
/usr/sbin/visudo -cf "$tmp" >/dev/null || { echo "sudoers entry failed validation" >&2; rm -f "$tmp"; exit 4; }
printf '%s\n' "$PLIST_BODY" | plutil -lint - >/dev/null || { echo "plist failed validation" >&2; rm -f "$tmp"; exit 4; }
printf '%s\n' "$CONFIG_BODY" | plutil -extract owner raw -o - - >/dev/null 2>&1 || { echo "config failed validation" >&2; rm -f "$tmp"; exit 4; }
if [[ $CHECK -eq 1 ]]; then rm -f "$tmp"; echo "check ok: script syntax, sudoers, plist and config are valid"; exit 0; fi
[[ "$(id -u)" == 0 ]] || { echo "must run as root" >&2; rm -f "$tmp"; exit 5; }
[[ "$(id -u "$OWNER" 2>/dev/null)" == "$UIDN" ]] || { echo "account $OWNER does not have uid $UIDN" >&2; rm -f "$tmp"; exit 6; }

# Carry over from the one-off, then remove it.
if [[ -d "$OLD_STATE" && ! -d "$STATE" ]]; then mv "$OLD_STATE" "$STATE"; chown -R root:wheel "$STATE"; fi
[[ "$(stat -f %Su /usr/local)" == root ]] || { echo "/usr/local is not owned by root; refusing to install a root-run script under it" >&2; rm -f "$tmp"; exit 7; }
mkdir -p /usr/local/libexec; chown root:wheel /usr/local/libexec; chmod 755 /usr/local/libexec
mkdir -p "$STATE/captures"
chown root:wheel "$STATE"; chmod 755 "$STATE"; chmod 700 "$STATE/captures"
if [[ -f "$STATE/mode" && ! -f "$STATE/tuning.json" ]]; then
  m="$(cat "$STATE/mode")"; case "$m" in off|dry|live) ;; *) m=dry ;; esac
  printf '{"mode":"%s","hard_minutes":3,"metal_minutes":10,"max_reboots_per_12h":2}\n' "$m" > "$STATE/tuning.json"
fi
[[ -f "$STATE/tuning.json" ]] || printf '{"mode":"dry","hard_minutes":3,"metal_minutes":10,"max_reboots_per_12h":2}\n' > "$STATE/tuning.json"
rm -f "$STATE/mode"
chown root:admin "$STATE/tuning.json"; chmod 664 "$STATE/tuning.json"
printf '%s\n' "$CONFIG_BODY" > "$STATE/config.json"; chown root:wheel "$STATE/config.json"; chmod 644 "$STATE/config.json"
[[ -f "$STATE/repair.json" ]] || printf '%s\n' "$REPAIR_BODY" > "$STATE/repair.json"
chown root:wheel "$STATE/repair.json"; chmod 644 "$STATE/repair.json"
if [[ -e /Library/LaunchDaemons/com.maipai.watchdog.plist ]]; then
  launchctl bootout system/com.maipai.watchdog 2>/dev/null || true
  rm -f /Library/LaunchDaemons/com.maipai.watchdog.plist /etc/sudoers.d/maipai-recovery /usr/local/libexec/maipai-watchdog
fi
install -o root -g wheel -m 755 "$SRC" "$DEST"
touch /var/log/maipai-host-guard.log; chmod 644 /var/log/maipai-host-guard.log
printf '%s\n' "$PLIST_BODY" > "$PLIST"; chown root:wheel "$PLIST"; chmod 644 "$PLIST"
install -o root -g wheel -m 440 "$tmp" "$SUDOERS"; rm -f "$tmp"
/usr/sbin/visudo -c >/dev/null
launchctl bootout system/com.maipai.host-guard 2>/dev/null || true
launchctl bootstrap system "$PLIST"
launchctl kickstart -k system/com.maipai.host-guard
echo "installed: $DEST (mode: $(plutil -extract mode raw -o - "$STATE/tuning.json")), owner $OWNER, daemon com.maipai.host-guard"
