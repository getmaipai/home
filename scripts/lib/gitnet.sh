#!/usr/bin/env bash
# GITNET-01 (2026-11-01): every remote git operation and every long step the lander, watcher and land/ship scripts run is
# bounded, so one hung connection can no longer block the landing queue (2026-11-01: one stalled `git-receive-pack` over ssh
# held the lander for 37 minutes while nothing landed). Source this file; it defines three things and changes nothing global.
#
#   gitnet_env [repo]            per-process only (no repo or global git config is touched): GIT_SSH_COMMAND gets an ssh config
#                                that reaches github.com through ssh.github.com:443 (port 22 to github.com is dropped on this
#                                network; measured 0 of 5 pushes over port 22 against 5 of 5 over 443) plus ConnectTimeout and
#                                ServerAlive limits, and git over https gets a low-speed abort. The repo's own core.sshCommand
#                                (the deploy key) is kept as the base of the command.
#   bounded_run <secs> <label> <command...>
#                                runs the command in its own process group with a hard wall clock; on timeout it signals only
#                                that group (the pid it started, never a pattern), writes one line to $GITNET_STUCK_LOG and
#                                returns 124. While it runs, $GITNET_OPS_DIR/<pid>.op names it so `pipeline.sh status` can show it.
#   gitnet_https_env             GITNET-02: git talks to GitHub over https first (measured 0.3 to 0.45 s per push, 5 of 5, against an
#                                ssh path that drops on port 22). Per process only, through GIT_CONFIG_* entries appended after any the
#                                caller already exported: ssh-shaped github URLs (git@github.com:, ssh://git@github.com/, the
#                                git@github-jessewebdotcom: alias; the push URL included) are rewritten to https://github.com/, and the
#                                credential helpers are tried in order: gh, the keychain, the token file. The token never appears in an
#                                argument or in the environment: the helper reads the file when git asks. When https authentication
#                                fails or times out, gitnet retries over the ssh path above and remembers for GITNET_HTTPS_BAD_SECONDS
#                                (default 600) to go straight to ssh. GITNET_TRANSPORT=ssh turns https off.
#   gitnet [-C dir] <git args>   `git` through bounded_run, with GITNET_TRIES attempts (default 3) retried only after a
#                                timeout or a connection-class failure (a rejected push is not retried). GITNET_TIMEOUT
#                                (default 90 s) bounds each attempt. Sets GITNET_TIMED_OUT=1 when the last failure was a timeout.

# Port 22 to github.com is dropped here; the same host answers on 443. Written once per user, atomically.
gitnet_ssh_config() {
  local state cfg tmp
  state="${GITNET_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/maipai-gitnet}"
  case "$state" in *[[:space:]]*) return 1 ;; esac
  mkdir -p "$state" 2>/dev/null || return 1
  chmod 700 "$state" 2>/dev/null || true
  cfg="$state/ssh_config"
  tmp="$(mktemp "$state/.ssh_config.XXXXXX")" || return 1
  cat >"$tmp" <<'EOF'
# Written by scripts/lib/gitnet.sh (GITNET-01); safe to delete, it is rewritten on use.
Host github.com
  HostName ssh.github.com
  Port 443
  HostKeyAlias github.com
  BatchMode yes
Host *
  ConnectTimeout 15
  ServerAliveInterval 10
  ServerAliveCountMax 3
Include ~/.ssh/config
EOF
  if [[ -f "$cfg" ]] && cmp -s "$tmp" "$cfg"; then rm -f "$tmp"; else mv -f "$tmp" "$cfg"; fi
  printf '%s\n' "$cfg"
}

# GITNET-02: append the https rewrite and the credential helper chain to the caller's GIT_CONFIG_* entries. Entries at or above
# GITNET_BASE_CONFIG_COUNT are the https ones: running a git child with GIT_CONFIG_COUNT=$GITNET_BASE_CONFIG_COUNT drops them (the ssh fallback).
gitnet_https_env() {
  [[ "${GITNET_TRANSPORT:-auto}" != ssh ]] || return 0
  [[ "${GITNET_HTTPS_SET:-}" != 1 ]] || return 0
  local n="${GIT_CONFIG_COUNT:-0}" gh token_file
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  export GITNET_BASE_CONFIG_COUNT="$n"
  gitnet_cfg_add() { export "GIT_CONFIG_KEY_${n}=$1" "GIT_CONFIG_VALUE_${n}=$2"; n=$((n + 1)); }
  gitnet_cfg_add url.https://github.com/.insteadOf git@github.com:
  gitnet_cfg_add url.https://github.com/.insteadOf ssh://git@github.com/
  gitnet_cfg_add url.https://github.com/.insteadOf git@github-jessewebdotcom:
  gitnet_cfg_add credential.helper ''
  gh="$(command -v gh 2>/dev/null || true)"
  [[ -z "$gh" ]] || gitnet_cfg_add credential.helper "!$gh auth git-credential"
  gitnet_cfg_add credential.helper osxkeychain
  token_file="${GITNET_TOKEN_FILE:-$HOME/.config/maipai/gh-token}"
  if [[ -s "$token_file" ]]; then
    gitnet_cfg_add credential.helper "!f() { echo username=JesseWebDotCom; echo \"password=\$(cat '$token_file')\"; }; f"
  fi
  unset -f gitnet_cfg_add
  export GIT_CONFIG_COUNT="$n" GIT_TERMINAL_PROMPT=0 GITNET_HTTPS_SET=1
}

# True while an https authentication failure or timeout is remembered: git goes straight to the ssh path.
gitnet_https_bad() {
  local state f until
  state="${GITNET_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/maipai-gitnet}"
  f="$state/https-bad-until"
  [[ -f "$f" ]] || return 1
  until="$(cat "$f" 2>/dev/null || echo 0)"
  [[ "$until" =~ ^[0-9]+$ ]] || return 1
  (( until > $(date +%s) ))
}
gitnet_https_mark_bad() {
  local state
  state="${GITNET_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/maipai-gitnet}"
  mkdir -p "$state" 2>/dev/null || return 0
  echo "$(( $(date +%s) + ${GITNET_HTTPS_BAD_SECONDS:-600} ))" > "$state/https-bad-until" 2>/dev/null || true
}

gitnet_env() {
  [[ "${GITNET_ENV_SET:-}" != ssh ]] || return 0
  local repo="${1:-.}" base cfg
  # GITNET_NO_SSH_COMMAND=1 (the wt.sh wrapper): export only the https limits. GIT_SSH_COMMAND would carry this repo's deploy key
  # into every repo the children touch, and a deploy key is valid for one repo only.
  if [[ "${GITNET_NO_SSH_COMMAND:-0}" != 1 ]] && cfg="$(gitnet_ssh_config)"; then
    base="${GIT_SSH_COMMAND:-$(git -C "$repo" config --get core.sshCommand 2>/dev/null || true)}"
    [[ -n "$base" ]] || base=ssh
    export GIT_SSH_COMMAND="$base -F $cfg" GITNET_ENV_SET=ssh
  fi
  export GIT_HTTP_LOW_SPEED_LIMIT="${GIT_HTTP_LOW_SPEED_LIMIT:-1000}" GIT_HTTP_LOW_SPEED_TIME="${GIT_HTTP_LOW_SPEED_TIME:-30}" GIT_TERMINAL_PROMPT=0
  export GITNET_ENV_SET="${GITNET_ENV_SET:-https}"
  gitnet_https_env
}

# bounded_run <seconds> <label> <command...>: 124 on timeout, otherwise the command's own status.
bounded_run() {
  local secs="$1" label="$2"
  shift 2
  if ! command -v perl >/dev/null 2>&1; then "$@"; return; fi
  perl -e '
    use strict; use warnings; use POSIX qw(WNOHANG); use Time::HiRes qw(sleep time);
    my ($secs, $label, $ops, $stuck, @cmd) = @ARGV;
    my $pid = fork();
    die "fork failed\n" unless defined $pid;
    if (!$pid) { setpgrp(0, 0); exec { $cmd[0] } @cmd; exit 127; }
    my $rec;
    if ($ops ne "" && -d $ops) {
      (my $l = $label) =~ s/[\t\n]/ /g;
      $rec = "$ops/$pid.op";
      if (open(my $f, ">", $rec)) { print $f join("\t", $pid, int(time), $secs, $l), "\n"; close $f; } else { $rec = undef; }
    }
    my $status; my $timedout = 0;
    eval {
      local $SIG{ALRM} = sub { die "gitnet-timeout\n" };
      Time::HiRes::alarm($secs);
      while (1) {
        my $r = waitpid($pid, 0);
        if ($r == $pid) { $status = $?; last; }
        if ($r == -1 && !$!{EINTR}) { $status = 1 << 8; last; }
      }
      Time::HiRes::alarm(0);
    };
    if (!defined $status && ($@ // "") eq "gitnet-timeout\n") { $timedout = 1; }
    Time::HiRes::alarm(0);
    if ($timedout && !defined $status) {
      kill "TERM", -$pid;
      for (1 .. 30) { last if waitpid($pid, WNOHANG) == $pid; sleep 0.1; }
      kill "KILL", -$pid;
      waitpid($pid, 0);
      if ($stuck ne "" && open(my $s, ">>", $stuck)) {
        (my $l = $label) =~ s/["\\\t\n]/ /g;
        my @t = gmtime(); my $ts = sprintf("%04d-%02d-%02dT%02d:%02d:%02dZ", $t[5] + 1900, $t[4] + 1, $t[3], $t[2], $t[1], $t[0]);
        print $s "{\"ts\":\"$ts\",\"op\":\"$l\",\"pid\":$pid,\"seconds\":$secs,\"action\":\"killed process group\"}\n"; close $s;
      }
      unlink $rec if $rec;
      exit 124;
    }
    unlink $rec if $rec;
    exit(($status & 127) ? 128 + ($status & 127) : ($status >> 8));
  ' "$secs" "$label" "${GITNET_OPS_DIR:-}" "${GITNET_STUCK_LOG:-}" "$@"
}

GITNET_RETRY_RE='timed out|time out|connection (reset|closed|refused)|could not resolve|broken pipe|kex_exchange|connect to host|unable to access|early eof|the remote end hung up|rpc failed|http 5[0-9][0-9]|returned error: 5[0-9][0-9]'
# What an https credential problem looks like; the ssh path is tried once instead (and https is skipped for a while).
GITNET_AUTH_RE='authentication failed|could not read (username|password)|invalid username or password|terminal prompts disabled|returned error: 40[13]|http 40[13]|access denied|repository not found|bad credentials|invalid credentials'

gitnet() {
  local dir="" secs asecs tries label attempt=1 rc err mode=ssh
  if [[ "${1:-}" == -C ]]; then dir="$2"; shift 2; fi
  secs="${GITNET_TIMEOUT:-90}"; tries="${GITNET_TRIES:-3}"; label="${GITNET_LABEL:-git ${1:-}}"
  [[ "${GITNET_HTTPS_SET:-}" != 1 ]] || gitnet_https_bad || mode=https
  GITNET_TIMED_OUT=0
  err="$(mktemp "${TMPDIR:-/tmp}/gitnet.XXXXXX")" || err=/dev/null
  while :; do
    rc=0
    asecs="$secs"
    # https answers in under a second when it works; a slow or stuck https try is given up on early and the next try goes over ssh.
    if [[ "$mode" == https ]] && (( secs > ${GITNET_HTTPS_TIMEOUT:-30} )); then asecs="${GITNET_HTTPS_TIMEOUT:-30}"; fi
    if [[ "$mode" == https ]]; then
      if [[ -n "$dir" ]]; then bounded_run "$asecs" "$label" git -C "$dir" "$@" 2>"$err" || rc=$?
      else bounded_run "$asecs" "$label" git "$@" 2>"$err" || rc=$?; fi
    else
      # The https entries are the ones at or above GITNET_BASE_CONFIG_COUNT: dropping them leaves the caller's own config and the ssh path.
      if [[ "${GITNET_HTTPS_SET:-}" == 1 ]]; then
        if [[ -n "$dir" ]]; then GIT_CONFIG_COUNT="${GITNET_BASE_CONFIG_COUNT:-0}" bounded_run "$asecs" "$label" git -C "$dir" "$@" 2>"$err" || rc=$?
        else GIT_CONFIG_COUNT="${GITNET_BASE_CONFIG_COUNT:-0}" bounded_run "$asecs" "$label" git "$@" 2>"$err" || rc=$?; fi
      elif [[ -n "$dir" ]]; then bounded_run "$asecs" "$label" git -C "$dir" "$@" 2>"$err" || rc=$?
      else bounded_run "$asecs" "$label" git "$@" 2>"$err" || rc=$?; fi
    fi
    [[ "$err" == /dev/null ]] || cat "$err" >&2
    if (( rc == 0 )); then GITNET_TIMED_OUT=0; break; fi
    GITNET_TIMED_OUT=0; (( rc != 124 )) || GITNET_TIMED_OUT=1
    if [[ "$mode" == https ]]; then
      if (( rc == 124 )); then
        gitnet_https_mark_bad
        echo "gitnet: $label over https did not answer in ${asecs}s; ssh is used next and for the next ${GITNET_HTTPS_BAD_SECONDS:-600}s" >&2
        mode=ssh
      elif [[ "$err" != /dev/null ]] && grep -Eqi "$GITNET_AUTH_RE" "$err"; then
        gitnet_https_mark_bad
        echo "gitnet: $label over https was refused ($(grep -Eio "$GITNET_AUTH_RE" "$err" | head -n 1)); trying ssh" >&2
        mode=ssh
        continue
      fi
    fi
    (( attempt < tries )) || break
    if (( rc == 124 )) || { [[ "$err" != /dev/null ]] && grep -Eqi "$GITNET_RETRY_RE" "$err"; }; then
      if (( GITNET_TIMED_OUT )); then echo "gitnet: $label timed out after ${asecs}s; retry $((attempt + 1)) of $tries" >&2
      else echo "gitnet: $label failed on the connection; retry $((attempt + 1)) of $tries" >&2; fi
      sleep "${GITNET_BACKOFF:-$((attempt * 3))}"
      attempt=$((attempt + 1))
      continue
    fi
    break
  done
  [[ "$err" == /dev/null ]] || rm -f "$err"
  return "$rc"
}

# OUTBOX-01 (2026-11-01): the pipeline's main and GitHub's main are two things. The lander lands a change on the local ref
# refs/pipeline/main first (shared by every worktree of this repo; `git fetch` never touches it) and pushes it to GitHub from an
# outbox afterwards, so a slow or failed push never blocks landing, the watcher's tests, a new worktree or dev.
#
#   pipeline_main_sha [repo]     the commit the pipeline treats as main: refs/pipeline/main while it descends from origin/main
#                                (landed, maybe not on GitHub yet), otherwise origin/main.
#   pipeline_main_state [repo]   one word and maybe a number: `sync` (same commit as origin/main), `ahead N` (N landed commits
#                                GitHub has not got yet), `diverged` (GitHub main has commits the landed ones do not descend from;
#                                nothing is ever force-pushed), or `unknown` (no origin/main in this clone).
PIPELINE_MAIN_REF="${PIPELINE_MAIN_REF:-refs/pipeline/main}"

pipeline_main_sha() {
  local repo="${1:-.}" o p
  o="$(git -C "$repo" rev-parse --verify -q 'origin/main^{commit}' 2>/dev/null || true)"
  p="$(git -C "$repo" rev-parse --verify -q "$PIPELINE_MAIN_REF^{commit}" 2>/dev/null || true)"
  if [[ -n "$p" && -n "$o" ]] && git -C "$repo" merge-base --is-ancestor "$o" "$p" 2>/dev/null; then printf '%s\n' "$p"; return 0; fi
  if [[ -n "$o" ]]; then printf '%s\n' "$o"; return 0; fi
  [[ -z "$p" ]] || printf '%s\n' "$p"
}

pipeline_main_state() {
  local repo="${1:-.}" o p n
  o="$(git -C "$repo" rev-parse --verify -q 'origin/main^{commit}' 2>/dev/null || true)"
  p="$(git -C "$repo" rev-parse --verify -q "$PIPELINE_MAIN_REF^{commit}" 2>/dev/null || true)"
  if [[ -z "$o" ]]; then echo unknown; return 0; fi
  if [[ -z "$p" || "$p" == "$o" ]] || git -C "$repo" merge-base --is-ancestor "$p" "$o" 2>/dev/null; then echo sync; return 0; fi
  if git -C "$repo" merge-base --is-ancestor "$o" "$p" 2>/dev/null; then
    n="$(git -C "$repo" rev-list --count "$o..$p" 2>/dev/null || echo 0)"
    echo "ahead $n"; return 0
  fi
  echo diverged
}
