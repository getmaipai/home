# Releasing Home

Every release does all of these, in order. A release that skips the GitHub Release is not finished: the Releases page and its "Latest" badge are what people read.

1. Merge the work to `main` (`scripts/wt.sh check`, then `scripts/wt.sh land`).
2. On a fresh worktree: add a `## [X.Y.Z] - date` section to `CHANGELOG.md` above the entries, set `version` in `package.json`, test any new migration on a copy of the live database, run `scripts/wt.sh check`, land.
3. Tag the landed commit and push the tag: `git tag -a vX.Y.Z -m vX.Y.Z <sha>` then `git push origin vX.Y.Z`.
4. Publish the GitHub Release: `scripts/publish-release.sh vX.Y.Z --latest` (the notes are that version's CHANGELOG section; it needs `gh` signed in; run it again to update the notes).
5. Install: `sudo -n /usr/local/libexec/maipai-install vX.Y.Z`, then verify the hub answers, the version, the migration count and the Stack roles.
