#!/usr/bin/env bash

# A non-blocking single-flight lock for one Git worktree. It uses descriptor 6 because the machine-wide
# gate-lock.sh (which wraps the child --pre) owns 7, 8 and 9 and closes 7 when it unlocks, which hid the
# inherited lock from the child and made every full check say another check was running. The descriptor
# stays open in the calling shell, so a nested `check.sh --pre` inherits the
# same lock and releases it automatically when the outer check exits.
acquire_worktree_lock() {
  local git_dir worktree lock_file inherited
  git_dir="$(git rev-parse --git-dir 2>/dev/null)" || {
    echo "worktree lock: cannot locate this checkout's Git directory" >&2
    return 1
  }
  case "$git_dir" in
    /*) ;;
    *) git_dir="$(cd "$git_dir" 2>/dev/null && pwd -P)" || return 1 ;;
  esac
  worktree="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  lock_file="$git_dir/gate-worktree.lock"

  # A full gate invokes --pre as a child process. The exported path marker
  # is meaningful only alongside the inherited lock descriptor.
  inherited="${MAIPAI_WORKTREE_LOCK_PATH:-}"
  if [ "$inherited" = "$lock_file" ] && [ -e /dev/fd/6 ]; then
    return 0
  fi

  if ! exec 6>>"$lock_file"; then
    echo "worktree lock: cannot open $lock_file" >&2
    return 1
  fi
  if perl -MFcntl=:flock -e 'open(my $fh, ">&=", 6) or die "worktree lock: fd 6: $!\n"; exit(flock($fh, LOCK_EX | LOCK_NB) ? 0 : 75)'; then
    MAIPAI_WORKTREE_LOCK_PATH="$lock_file"
    export MAIPAI_WORKTREE_LOCK_PATH
    echo "worktree lock: held for $worktree"
    return 0
  fi
  exec 6>&-
  local holders
  holders="$(lsof -t "$lock_file" 2>/dev/null | tr '\n' ' ')"
  echo "worktree lock: another check is already running in $worktree (lock $lock_file${holders:+; held by pid $holders})" >&2
  return 1
}
