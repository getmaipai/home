#!/usr/bin/env bash
# Prints what a finished item should have cleaned up: claims, locks, agent worktrees, unmerged branches.
# Read-only. Run it at every agent report and in the weekly sweep.
cd "$(git rev-parse --show-toplevel)" || exit 1
echo "== claims (done plan items should have none)"; ls data-scratch/claims 2>/dev/null
echo "== lane locks"; ls data-scratch/lane-locks 2>/dev/null
echo "== agent worktrees"; git worktree list | grep -v "^$(pwd) "
echo "== local branches not merged into main (name, behind main, last commit)"
for b in $(git for-each-ref --format='%(refname:short)' refs/heads | grep -vx main); do
  git merge-base --is-ancestor "$b" main 2>/dev/null && { echo "MERGED (delete with git branch -d): $b"; continue; }
  git cherry main "$b" | grep -q '^+' || { echo "PATCH-ON-MAIN: $b"; continue; }
  echo "unmerged: $b  behind $(git rev-list --count "$b"..main)  $(git log -1 --format=%cr "$b")"
done
