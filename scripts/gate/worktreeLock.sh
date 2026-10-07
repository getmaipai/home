#!/usr/bin/env bash

# A non-blocking single-flight lock for one Git worktree. The descriptor
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
  if [ "$inherited" = "$lock_file" ] && [ -e /dev/fd/7 ]; then
    return 0
  fi

  if ! exec 7>>"$lock_file"; then
    echo "worktree lock: cannot open $lock_file" >&2
    return 1
  fi
  if perl -MFcntl=:flock -e 'open(my $fh, ">&=", 7) or die "worktree lock: fd 7: $!\n"; exit(flock($fh, LOCK_EX | LOCK_NB) ? 0 : 75)'; then
    MAIPAI_WORKTREE_LOCK_PATH="$lock_file"
    export MAIPAI_WORKTREE_LOCK_PATH
    echo "worktree lock: held for $worktree"
    return 0
  fi
  exec 7>&-
  echo "worktree lock: another check is already running in $worktree (lock $lock_file)" >&2
  return 1
}
