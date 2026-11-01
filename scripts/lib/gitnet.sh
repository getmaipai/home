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

gitnet() {
  local dir="" secs tries label attempt=1 rc err
  if [[ "${1:-}" == -C ]]; then dir="$2"; shift 2; fi
  secs="${GITNET_TIMEOUT:-90}"; tries="${GITNET_TRIES:-3}"; label="${GITNET_LABEL:-git ${1:-}}"
  GITNET_TIMED_OUT=0
  err="$(mktemp "${TMPDIR:-/tmp}/gitnet.XXXXXX")" || err=/dev/null
  while :; do
    rc=0
    if [[ -n "$dir" ]]; then bounded_run "$secs" "$label" git -C "$dir" "$@" 2>"$err" || rc=$?
    else bounded_run "$secs" "$label" git "$@" 2>"$err" || rc=$?; fi
    [[ "$err" == /dev/null ]] || cat "$err" >&2
    if (( rc == 0 )); then GITNET_TIMED_OUT=0; break; fi
    GITNET_TIMED_OUT=0; (( rc != 124 )) || GITNET_TIMED_OUT=1
    (( attempt < tries )) || break
    if (( rc == 124 )) || { [[ "$err" != /dev/null ]] && grep -Eqi "$GITNET_RETRY_RE" "$err"; }; then
      if (( GITNET_TIMED_OUT )); then echo "gitnet: $label timed out after ${secs}s; retry $((attempt + 1)) of $tries" >&2
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
