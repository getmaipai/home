#!/usr/bin/env bash
# Host tuning for a Mac that runs MaiPai Home all day (the Mac Studio). The one
# definition: the setup wizard's host-tune routes and a person at the Mac both
# call this script. macOS only. It never changes anything unless asked.
#
#   host-tune.sh [options] detect            what is set now, for every item
#   host-tune.sh [options] apply  <id>       make one item the proposed way
#   host-tune.sh [options] revert <id>       put one item back
#
# Options: --json (machine output), --yes (really change things; without it
# apply and revert only print what they would do), --dry-run (the default),
# --data-dir <dir> and --models-dir <dir> (Home's folders for the AUTO items), plus
# --engines-dir, --media-dir and --cache-dir for the other three folders no-spotlight hides.
#
# Modes: auto (inside Home's folders, no administrator), consent (changes the
# host, with permission), advice (never scripted, guidance only).
# Exit codes: 0 ok, 2 bad use, 3 needs an administrator, 4 the change failed,
# 5 not macOS.
set -uo pipefail

# Test seam: a path prefix for the few system files this script writes.
ROOT="${MAIPAI_HOST_TUNE_ROOT:-}"
STATE_DIR="$ROOT/Library/Application Support/MaiPai/host-tune"
DAEMON_LABEL="com.maipai.wired-limit"
DAEMON_PLIST="$ROOT/Library/LaunchDaemons/$DAEMON_LABEL.plist"
DISPLAY_LABEL="com.maipai.display-awake"
DISPLAY_PLIST="${ROOT:-$HOME}/Library/LaunchAgents/$DISPLAY_LABEL.plist"
SU_PREFS="$ROOT/Library/Preferences/com.apple.SoftwareUpdate"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

JSON=0
DRY=1
DATA_DIR="${MAIPAI_DATA_DIR:-}"
MODELS_DIR="${MAIPAI_MODELS_DIR:-}"
ENGINES_DIR="${MAIPAI_ENGINES_DIR:-}"
MEDIA_DIR="${MAIPAI_MEDIA_DIR:-}"
CACHE_DIR="${MAIPAI_CACHE_DIR:-}"
WOULD=()

IDS="no-spotlight no-timemachine-models power display-awake wired-limit no-auto-major-upgrade remote-login advice-accounts advice-radios advice-network advice-toolchains advice-login advice-screensaver"

jstr() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "\\n"} {printf "%s",$0}')"; }

die() { # die <exit> <code> <message>
  if [ "$JSON" = 1 ]; then printf '{"error":%s,"code":%s}\n' "$(jstr "$3")" "$(jstr "$2")"; else printf 'host-tune: %s\n' "$3" >&2; fi
  exit "$1"
}

is_root() { [ "$(id -u)" = 0 ]; }

# run <cmd...>: runs it, or in dry-run only records it. A failure stops with what to do.
run() {
  WOULD+=("$*")
  [ "$DRY" = 1 ] && return 0
  local out
  if ! out="$("$@" 2>&1)"; then
    die 4 failed "This step failed: $*. macOS said: ${out:-nothing}. Check the message, fix it, then run this item again."
  fi
}

write_file() { # write_file <path> <content>
  WOULD+=("write $1")
  [ "$DRY" = 1 ] && return 0
  mkdir -p "$(dirname "$1")" && printf '%s' "$2" > "$1" || die 4 failed "Could not write $1. Check that you are running as an administrator, then try again."
}

pmset_val() { pmset -g 2>/dev/null | awk -v k="$1" '$1==k{print $2; exit}'; }

# The folders no-spotlight hides: name|path, empty paths left out.
spotlight_folders() {
  printf '%s|%s\n' data "$DATA_DIR" models "$MODELS_DIR" engines "$ENGINES_DIR" media "$MEDIA_DIR" cache "$CACHE_DIR" | grep -v '|$'
}
spotlight_dirs() { spotlight_folders | cut -d'|' -f2-; }

# Current item fields, set by load_item.
T_TITLE="" T_WHY="" T_MODE="" T_STATE="" T_CURRENT="" T_PROPOSED=""

load_item() {
  T_STATE=unknown T_CURRENT="" T_PROPOSED=""
  case "$1" in
    no-spotlight)
      T_TITLE="Keep Spotlight out of Home's files"; T_MODE=auto
      T_WHY="Spotlight reads every file to build a search list. On big model files that wastes the Mac's time. This hides only Home's own folders from it."
      T_PROPOSED="Home's data, models, engines, media and cache folders are not indexed"
      if [ -z "$DATA_DIR" ] || [ -z "$MODELS_DIR" ]; then T_CURRENT="Home's folders are not known to this script. Run it with --data-dir and --models-dir."; return; fi
      local miss="" name dir
      while IFS='|' read -r name dir; do
        [ -n "$dir" ] && [ ! -f "$dir/.metadata_never_index" ] && miss="${miss:+$miss, }$name"
      done < <(spotlight_folders)
      if [ -z "$miss" ]; then T_STATE=ok; T_CURRENT="Home's folders are hidden from Spotlight"; else T_STATE=needs; T_CURRENT="Spotlight can still read these folders: $miss"; fi ;;
    no-timemachine-models)
      T_TITLE="Keep the AI models out of Time Machine"; T_MODE=auto
      T_WHY="The AI models are huge and can be downloaded again. Backing them up fills the backup drive. Home's own data stays in the backup."
      T_PROPOSED="The models folder is left out of Time Machine"
      if [ -z "$MODELS_DIR" ]; then T_CURRENT="Home's models folder is not known to this script. Run it with --models-dir."; return; fi
      local ex
      ex="$(tmutil isexcluded "$MODELS_DIR" 2>/dev/null)" || { T_CURRENT="Could not ask Time Machine. Run tmutil isexcluded on the models folder."; return; }
      case "$ex" in
        *Excluded*) T_STATE=ok; T_CURRENT="The models folder is left out of Time Machine" ;;
        *) T_STATE=needs; T_CURRENT="The models folder would be backed up" ;;
      esac ;;
    power)
      T_TITLE="Never sleep, come back after a power cut"; T_MODE=consent
      T_WHY="Home must answer at any hour. This stops the Mac sleeping, turns it back on after a power cut, and lets another device wake it over the network. The screen still turns off after 10 minutes."
      T_PROPOSED="sleep 0, disksleep 0, displaysleep 10, autorestart 1, womp 1, powernap 0"
      local k v all=1 cur="" first_val
      for k in sleep disksleep displaysleep autorestart womp powernap; do
        v="$(pmset_val "$k")"
        if [ -z "$v" ]; then cur="${cur:+$cur, }$k n/a"; continue; fi # this Mac has no such setting
        cur="${cur:+$cur, }$k $v"
        [ "$v" = "$(power_want "$k")" ] || all=0
      done
      T_CURRENT="$cur"
      first_val="$(pmset_val sleep)"
      if [ -z "$first_val" ]; then T_STATE=unknown; T_CURRENT="Could not read power settings. Run pmset -g."; return; fi
      if [ "$all" = 1 ]; then T_STATE=ok; else T_STATE=needs; fi ;;
    display-awake)
      T_TITLE="Keep the screen from sleeping"; T_MODE=consent
      T_WHY="Some monitors lose their picture when the screen sleeps and do not wake until the Mac is turned off and back on. This keeps the screen awake, so Home stays reachable at the Mac too. It uses a small login service and needs no administrator."
      T_PROPOSED="A login service keeps the screen and the Mac awake"
      if [ ! -f "$DISPLAY_PLIST" ]; then T_STATE=needs; T_CURRENT="The login service is not installed"; return; fi
      local domain="gui/$(id -u)" job
      if job="$(launchctl print "$domain/$DISPLAY_LABEL" 2>/dev/null)"; then
        if printf '%s\n' "$job" | grep -Eq '^[[:space:]]*state = running[[:space:]]*$'; then
          T_STATE=ok; T_CURRENT="The login service is running"
        else T_STATE=needs; T_CURRENT="The login service is installed but is not running"; fi
      elif launchctl print "$domain" >/dev/null 2>&1; then
        T_STATE=needs; T_CURRENT="The login service is installed but is not loaded"
      else T_CURRENT="Could not ask the login service. Sign in at the Mac, then run detect again."; fi ;;
    wired-limit)
      T_TITLE="Let the GPU use more of the memory"; T_MODE=consent
      T_WHY="Needed only for big AI models later. The Mac normally lets the graphics chip use about three quarters of its memory. This raises that, and always leaves at least 12 GB (or 15 percent) for macOS and Home. It is set again at every start."
      local bytes mb keep cur
      bytes="$(sysctl -n hw.memsize 2>/dev/null)"
      if [ -z "$bytes" ]; then T_CURRENT="Could not read the memory size. Run sysctl hw.memsize."; return; fi
      mb=$((bytes / 1048576))
      if [ "$mb" -lt 32768 ]; then T_STATE=ok; T_CURRENT="Default"; T_PROPOSED="Default (this change is only for Macs with 32 GB or more)"; return; fi
      keep=$((mb * 15 / 100)); [ "$keep" -lt 12288 ] && keep=12288
      WIRED_MB=$((mb - keep))
      T_PROPOSED="${WIRED_MB} MB for the GPU, $((keep)) MB kept for macOS and Home"
      cur="$(sysctl -n iogpu.wired_limit_mb 2>/dev/null)"
      if [ -z "$cur" ]; then T_CURRENT="This Mac does not have this setting (it needs Apple silicon)"; return; fi
      if [ "$cur" = "$WIRED_MB" ]; then T_STATE=ok; T_CURRENT="${cur} MB"; else T_STATE=needs; T_CURRENT="$([ "$cur" = 0 ] && echo "Default (about three quarters of memory)" || echo "${cur} MB")"; fi ;;
    no-auto-major-upgrade)
      T_TITLE="No surprise macOS upgrades"; T_MODE=consent
      T_WHY="A big macOS upgrade can break the AI engine overnight. This stops automatic major upgrades. Security updates stay on."
      T_PROPOSED="Major upgrades are off, security updates are on"
      local maj crit
      maj="$(defaults read "$SU_PREFS" AutomaticallyInstallMacOSUpdates 2>/dev/null)"
      crit="$(defaults read "$SU_PREFS" CriticalUpdateInstall 2>/dev/null)"
      if [ "$maj" = 0 ] && [ "$crit" = 1 ]; then T_STATE=ok; T_CURRENT="Major upgrades are off, security updates are on"
      elif [ "$maj" = 0 ]; then T_STATE=needs; T_CURRENT="Major upgrades are off, but security updates are not set"
      else T_STATE=needs; T_CURRENT="$([ -z "$maj" ] && echo "Not set, so macOS may install major upgrades" || echo "Major upgrades are on")"; fi ;;
    remote-login)
      T_TITLE="Turn on SSH (Remote Login)"; T_MODE=consent
      T_WHY="Lets you fix the Mac from another computer without going to it. Only people with an account on this Mac can sign in."
      T_PROPOSED="Remote Login is on"
      local line
      local listing
      listing="$(launchctl print-disabled system 2>/dev/null)" || listing=""
      line="$(printf '%s\n' "$listing" | grep 'com.openssh.sshd')" || line=""
      # No override recorded means macOS's default, which is off, unless port 22 answers.
      if [ -z "$line" ] && [ -n "$listing" ]; then
        if nc -z -w 1 127.0.0.1 22 >/dev/null 2>&1; then line="=> enabled"; else line="=> disabled"; fi
      fi
      case "$line" in
        *"=> enabled"*|*"=> false"*) T_STATE=ok; T_CURRENT="Remote Login is on" ;;
        *"=> disabled"*|*"=> true"*) T_STATE=needs; T_CURRENT="Remote Login is off" ;;
        *) T_CURRENT="Could not tell. Look in System Settings, General, Sharing, Remote Login." ;;
      esac ;;
    advice-accounts)
      T_TITLE="Keep Apple out of this account"; T_MODE=advice
      T_WHY="Home keeps your family private, and these Apple features send data to Apple."
      T_PROPOSED="Skip iCloud sign-in. Turn off Siri, Apple Intelligence and analytics." ;;
    advice-radios)
      T_TITLE="Switch off Bluetooth and Wi-Fi you do not use"; T_MODE=advice
      T_WHY="Each radio is one more way in."
      T_PROPOSED="Only if you use a wired network and keyboard." ;;
    advice-network)
      T_TITLE="Give the Mac a fixed address and join Tailscale"; T_MODE=advice
      T_WHY="Phones and robots need one address that never changes."
      T_PROPOSED="Reserve an address for this Mac in your router. Approve Tailscale when it asks." ;;
    advice-toolchains)
      T_TITLE="Keep the Mac plain"; T_MODE=advice
      T_WHY="Extra programs use memory and need updates."
      T_PROPOSED="Skip Xcode and Docker. Keep the Command Line Tools." ;;
    advice-login)
      T_TITLE="Sign in automatically, FileVault off"; T_MODE=advice
      T_WHY="After a power cut, Home starts again with nobody here. That needs FileVault off, so keep the Mac somewhere safe."
      T_PROPOSED="Turn on Automatic login and turn off FileVault." ;;
    advice-screensaver)
      T_TITLE="Turn the screen saver off"; T_MODE=advice
      T_WHY="A screen saver keeps the graphics chip busy for nothing."
      T_PROPOSED="Set Screen Saver to Never." ;;
    *) return 1 ;;
  esac
}

power_want() { case "$1" in sleep|disksleep|autorestart_x) echo 0 ;; displaysleep) echo 10 ;; autorestart|womp) echo 1 ;; powernap) echo 0 ;; esac; }
power_default() { case "$1" in sleep) echo 1 ;; disksleep|displaysleep) echo 10 ;; autorestart) echo 0 ;; womp) echo 1 ;; powernap) echo 1 ;; esac; }

# item_json <id> [dry] : one item as JSON.
item_json() {
  printf '{"id":%s,"title":%s,"why":%s,"mode":%s,"state":%s,"current":%s,"proposed":%s}' \
    "$(jstr "$1")" "$(jstr "$T_TITLE")" "$(jstr "$T_WHY")" "$(jstr "$T_MODE")" "$(jstr "$T_STATE")" "$(jstr "$T_CURRENT")" "$(jstr "$T_PROPOSED")"
}

item_text() {
  printf '%-24s %-8s %-8s %s\n' "$1" "$T_MODE" "$T_STATE" "$T_TITLE"
  [ -n "$T_CURRENT" ] && printf '    now:      %s\n' "$T_CURRENT"
  [ -n "$T_PROPOSED" ] && printf '    proposed: %s\n' "$T_PROPOSED"
  return 0
}

need_root() { # need_root <verb> <id>
  [ "$DRY" = 1 ] && return 0
  is_root || die 3 needs-root "$T_TITLE changes the whole Mac, so it needs an administrator. At the Mac, run: sudo bash $SELF $1 $2 --yes"
}

do_apply() {
  local id="$1" k
  case "$id" in
    no-spotlight)
      [ -n "$DATA_DIR" ] && [ -n "$MODELS_DIR" ] || die 2 no-folder "Home's folders are not known. Run again with --data-dir and --models-dir."
      while IFS= read -r k; do run mkdir -p "$k"; run touch "$k/.metadata_never_index"; done < <(spotlight_dirs) ;;
    no-timemachine-models)
      [ -n "$MODELS_DIR" ] || die 2 no-folder "Home's models folder is not known. Run again with --models-dir."
      run mkdir -p "$MODELS_DIR"
      run tmutil addexclusion "$MODELS_DIR" ;;
    power)
      need_root apply power
      if [ ! -f "$STATE_DIR/power.prev" ]; then
        local prev=""
        for k in sleep disksleep displaysleep autorestart womp powernap; do prev="$prev$k $(pmset_val "$k")
"; done
        write_file "$STATE_DIR/power.prev" "$prev"
      fi
      run pmset -a sleep 0 disksleep 0 displaysleep 10 autorestart 1 womp 1 powernap 0 ;;
    display-awake)
      is_root && die 2 wrong-user "The screen login service must belong to your Mac account. Run this item as the signed-in user without sudo."
      local domain="gui/$(id -u)"
      write_file "$DISPLAY_PLIST" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\"><dict>
<key>Label</key><string>$DISPLAY_LABEL</string>
<key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-d</string><string>-i</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Background</string>
</dict></plist>
"
      run plutil -lint "$DISPLAY_PLIST"
      if launchctl print "$domain/$DISPLAY_LABEL" >/dev/null 2>&1; then run launchctl bootout "$domain/$DISPLAY_LABEL"; fi
      run launchctl bootstrap "$domain" "$DISPLAY_PLIST" ;;
    wired-limit)
      need_root apply wired-limit
      [ -n "${WIRED_MB:-}" ] || die 4 failed "This Mac is not eligible for this change: $T_CURRENT. Nothing was changed."
      run sysctl -w "iogpu.wired_limit_mb=$WIRED_MB"
      write_file "$DAEMON_PLIST" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\"><dict>
<key>Label</key><string>$DAEMON_LABEL</string>
<key>ProgramArguments</key><array><string>/usr/sbin/sysctl</string><string>-w</string><string>iogpu.wired_limit_mb=$WIRED_MB</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
"
      run chmod 644 "$DAEMON_PLIST"
      [ "$DRY" = 1 ] || launchctl bootout "system/$DAEMON_LABEL" >/dev/null 2>&1
      run launchctl bootstrap system "$DAEMON_PLIST" ;;
    no-auto-major-upgrade)
      need_root apply no-auto-major-upgrade
      run defaults write "$SU_PREFS" AutomaticallyInstallMacOSUpdates -bool false
      run defaults write "$SU_PREFS" CriticalUpdateInstall -bool true
      run defaults write "$SU_PREFS" ConfigDataInstall -bool true ;;
    remote-login)
      need_root apply remote-login
      if [ "$DRY" = 1 ]; then run systemsetup -setremotelogin on
      else
        local out
        out="$(systemsetup -setremotelogin on 2>&1)" || die 4 failed "macOS would not turn on Remote Login: ${out:-no message}. Turn it on by hand in System Settings, General, Sharing, Remote Login. If this program lacks permission, give Terminal Full Disk Access first."
        WOULD+=("systemsetup -setremotelogin on")
      fi ;;
    *) die 2 advice-only "This item is guidance only and cannot be applied by a script. Read what it says and do it in System Settings." ;;
  esac
}

do_revert() {
  local id="$1" k v
  case "$id" in
    no-spotlight)
      [ -n "$DATA_DIR" ] && [ -n "$MODELS_DIR" ] || die 2 no-folder "Home's folders are not known. Run again with --data-dir and --models-dir."
      while IFS= read -r k; do run rm -f "$k/.metadata_never_index"; done < <(spotlight_dirs) ;;
    no-timemachine-models)
      [ -n "$MODELS_DIR" ] || die 2 no-folder "Home's models folder is not known. Run again with --models-dir."
      run tmutil removeexclusion "$MODELS_DIR" ;;
    power)
      need_root revert power
      local args=""
      for k in sleep disksleep displaysleep autorestart womp powernap; do
        v=""
        [ -f "$STATE_DIR/power.prev" ] && v="$(awk -v k="$k" '$1==k{print $2; exit}' "$STATE_DIR/power.prev")"
        case "$v" in ''|'?') v="$(power_default "$k")" ;; esac
        args="$args $k $v"
      done
      # shellcheck disable=SC2086
      run pmset -a $args
      [ "$DRY" = 1 ] || rm -f "$STATE_DIR/power.prev" ;;
    display-awake)
      is_root && die 2 wrong-user "The screen login service belongs to your Mac account. Run this item as the signed-in user without sudo."
      local domain="gui/$(id -u)"
      if launchctl print "$domain/$DISPLAY_LABEL" >/dev/null 2>&1; then run launchctl bootout "$domain/$DISPLAY_LABEL"; fi
      run rm -f "$DISPLAY_PLIST" ;;
    wired-limit)
      need_root revert wired-limit
      run sysctl -w iogpu.wired_limit_mb=0
      [ "$DRY" = 1 ] || launchctl bootout "system/$DAEMON_LABEL" >/dev/null 2>&1
      run rm -f "$DAEMON_PLIST" ;;
    no-auto-major-upgrade)
      need_root revert no-auto-major-upgrade
      run defaults write "$SU_PREFS" AutomaticallyInstallMacOSUpdates -bool true ;;
    remote-login)
      need_root revert remote-login
      run systemsetup -setremotelogin off ;;
    *) die 2 advice-only "This item is guidance only and there is nothing for a script to undo." ;;
  esac
}

valid_id() { case " $IDS " in *" $1 "*) return 0 ;; esac; return 1; }

# ---- main ----
CMD="" ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON=1 ;;
    --dry-run) DRY=1 ;;
    --yes) DRY=0 ;;
    --data-dir) shift; DATA_DIR="${1:-}" ;;
    --models-dir) shift; MODELS_DIR="${1:-}" ;;
    --engines-dir) shift; ENGINES_DIR="${1:-}" ;;
    --media-dir) shift; MEDIA_DIR="${1:-}" ;;
    --cache-dir) shift; CACHE_DIR="${1:-}" ;;
    detect|apply|revert) CMD="$1" ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) if [ -n "$CMD" ] && [ -z "$ARG" ] && [ "$CMD" != detect ]; then ARG="$1"; else die 2 usage "Unknown option '$1'. Use: host-tune.sh [--json] [--yes] detect | apply <id> | revert <id>."; fi ;;
  esac
  shift
done
[ -n "$CMD" ] || die 2 usage "Say what to do: detect, apply <id> or revert <id>. Add --help for details."

if [ "$(uname -s)" != Darwin ]; then
  if [ "$CMD" = detect ] && [ "$JSON" = 1 ]; then echo '{"supported":false,"items":[]}'; exit 0; fi
  die 5 unsupported "Host tuning is for a Mac. This computer is not running macOS, so nothing was changed."
fi

case "$CMD" in
  detect)
    if [ "$JSON" = 1 ]; then
      printf '{"supported":true,"items":['
      first=1
      for id in $IDS; do
        load_item "$id"
        [ "$first" = 1 ] || printf ','
        first=0; item_json "$id"
      done
      printf ']}\n'
    else
      for id in $IDS; do load_item "$id"; item_text "$id"; done
    fi ;;
  apply|revert)
    [ -n "$ARG" ] || die 2 usage "Name the item: host-tune.sh $CMD <id>. Run detect to see the ids."
    valid_id "$ARG" || die 2 unknown-id "'$ARG' is not a host-tune item. Run detect to see the ids."
    load_item "$ARG"
    if [ "$CMD" = apply ]; then do_apply "$ARG"; else do_revert "$ARG"; fi
    load_item "$ARG"
    [ "$CMD" = apply ] && [ "$DRY" = 0 ] && [ "$T_STATE" = ok ] && T_STATE=applied
    if [ "$DRY" = 0 ] && [ "$CMD" = apply ] && [ "$T_STATE" != applied ]; then
      die 4 failed "The change ran but $T_TITLE still reads: ${T_CURRENT:-unknown}. Run detect, then try again or set it by hand."
    fi
    if [ "$JSON" = 1 ]; then
      printf '{"item":'; item_json "$ARG"
      printf ',"dryRun":%s,"would":[' "$([ "$DRY" = 1 ] && echo true || echo false)"
      sep=""; for w in "${WOULD[@]+"${WOULD[@]}"}"; do printf '%s%s' "$sep" "$(jstr "$w")"; sep=","; done
      printf ']}\n'
    else
      [ "$DRY" = 1 ] && echo "Dry run: nothing changed. Add --yes to do it. It would run:"
      for w in "${WOULD[@]+"${WOULD[@]}"}"; do echo "  $w"; done
      item_text "$ARG"
    fi ;;
esac
