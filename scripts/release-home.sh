#!/usr/bin/env bash
# The one way to tag Home and update the live hub on this Mac. Two sessions releasing at once, or an older tag
# installed over a newer one, once downgraded the live hub (2026-10-20); this script refuses both.
# scripts/ship.sh supersedes this script for this Mac's live hub; this remains for tag installs.
# Usage: scripts/release-home.sh --owner-approved [--dry-run]      tag origin/main as the next patch version, install it, verify it
#        scripts/release-home.sh --owner-approved --install vX.Y.Z  install an existing tag (a downgrade needs --allow-downgrade)
# --owner-approved means the owner said yes in this turn; a session never passes it on its own.
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
LIVE=/usr/local/maipai-home
LOCK="${TMPDIR:-/tmp}/maipai-home-release.lock"
APPROVED=0; DRY=0; INSTALL=""; DOWNGRADE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner-approved) APPROVED=1;; --dry-run) DRY=1;; --allow-downgrade) DOWNGRADE=1;;
    --install) shift; INSTALL="${1:-}";;
    *) echo "Unknown option $1. See the usage at the top of scripts/release-home.sh." >&2; exit 2;;
  esac; shift
done
[[ "$APPROVED" == 1 ]] || { echo "Releasing Home restarts the live hub; the owner must say yes first. Re-run with --owner-approved only after they did." >&2; exit 2; }
version_key() { printf '%s' "${1#v}" | awk -F. '{ printf "%05d%05d%05d", $1, $2, $3 }'; }
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Another release is running ($LOCK, started by pid $(cat "$LOCK/pid" 2>/dev/null || echo unknown)). Wait for it to finish; never delete the lock unless that process is gone." >&2; exit 1
fi
echo $$ > "$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT
git fetch -q --tags origin
# A tag pushed from another machine (the laptop holds the GitHub login; the Studio has none, and over ssh its keychain login fails with -25308)
# that already sits on origin/main is installed as it is: no second tag, no push from here (2026-10-27).
if [[ -z "$INSTALL" ]]; then
  for t in $(git tag --points-at origin/main --list 'v[0-9]*.[0-9]*.[0-9]*'); do
    git ls-remote --tags origin "refs/tags/$t" | grep -q . && INSTALL="$t"
  done
fi
LATEST="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | sort -t. -k1.2,1n -k2,2n -k3,3n | tail -1)"
INSTALLED="$(cat "$LIVE/.installed-tag" 2>/dev/null || echo none)"
echo "latest tag: $LATEST; live hub: $INSTALLED"
if [[ -n "$INSTALL" ]]; then
  TAG="$INSTALL"
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "Tag $TAG does not exist on origin. Fetch tags or check the name." >&2; exit 1; }
else
  # scripts/ship.sh labels the live hub sha-<7>, not a tag: that is fine while the commit is on origin/main.
  if [[ "$INSTALLED" == sha-* ]]; then
    git merge-base --is-ancestor "${INSTALLED#sha-}" origin/main 2>/dev/null || { echo "The live hub ($INSTALLED) is not a commit on origin/main. Fetch, or ask the owner." >&2; exit 1; }
  else
    [[ "$INSTALLED" == "$LATEST" ]] || { echo "The live hub ($INSTALLED) is not on the latest tag ($LATEST): someone tagged without installing. Install $LATEST first with --install $LATEST, or ask the owner." >&2; exit 1; }
  fi
  if [[ -z "$(git log "$LATEST..origin/main" --oneline | head -1)" ]]; then
    # A tag pushed from another machine (the Studio holds no push credential) and not yet installed: install it, tag nothing.
    if [[ "$INSTALLED" == sha-* ]] && ! git merge-base --is-ancestor "$LATEST" "${INSTALLED#sha-}" 2>/dev/null && git merge-base --is-ancestor "${INSTALLED#sha-}" "$LATEST" 2>/dev/null; then
      INSTALL="$LATEST"; TAG="$LATEST"
    else
      echo "origin/main has no commits after $LATEST; nothing to release." >&2; exit 1
    fi
  else
    IFS=. read -r MA MI PA <<< "${LATEST#v}"; TAG="v$MA.$MI.$((PA + 1))"
    git ls-remote --tags origin "$TAG" | grep -q . && { echo "$TAG already exists on origin (another session tagged it). Fetch tags and start over." >&2; exit 1; }
  fi
fi
if [[ "$INSTALLED" != none && "$INSTALLED" != sha-* && "$(version_key "$TAG")" < "$(version_key "$INSTALLED")" && "$DOWNGRADE" != 1 ]]; then
  echo "$TAG is older than the live hub ($INSTALLED): that is a downgrade. Pass --allow-downgrade only if the owner asked for one." >&2; exit 1
fi
if [[ -n "$INSTALL" ]]; then WHAT="install the existing tag $TAG"; else WHAT="tag origin/main ($(git log "$LATEST..origin/main" --oneline | wc -l | tr -d ' ') commits since $LATEST) as $TAG"; fi
echo "plan: $WHAT, then update the live hub from $INSTALLED"
[[ "$DRY" == 1 ]] && { echo "dry run: nothing changed."; exit 0; }
if [[ -z "$INSTALL" ]]; then
  # Prove the push can authenticate before tagging: a non-interactive ssh session cannot reach the login keychain
  # (error -25308), and a failed push used to leave an unpushed local tag that the next run took for the latest release (2026-10-27).
  git push --dry-run -q origin "origin/main:refs/tags/$TAG" >/dev/null 2>&1 || { echo "Cannot push the tag to GitHub from this session (a keychain-backed login does not work over ssh). Give this checkout a deploy key or token that does not use the keychain, then re-run. Nothing was tagged or stopped." >&2; exit 1; }
fi
# A development Home from the main checkout holds the hub lock and 8787 and blocks the installer (three times on 2026-10-23, the live hub down for
# minutes each time). Stop it now, before the tag is pushed and before the installer stops the live service, so the downtime is only the install.
bash "$(dirname "$0")/stop-dev-home.sh" --live "$LIVE" || exit 1
if [[ -z "$INSTALL" ]]; then
  git tag -a "$TAG" -m "$TAG" origin/main
  git push origin "$TAG" || { git tag -d "$TAG" >/dev/null; echo "Pushing $TAG failed; the local tag was removed so the next run starts clean." >&2; exit 1; }
fi
BEFORE_MIGRATIONS="$(sqlite3 -readonly "$LIVE/data/hub.db" 'select count(*) from __drizzle_migrations' 2>/dev/null || echo 0)"
sudo -n /usr/local/libexec/maipai-install "$TAG"
sleep 5
ok=1
[[ "$(cat "$LIVE/.installed-tag")" == "$TAG" ]] || { echo "FAIL: installed tag is not $TAG"; ok=0; }
[[ "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/)" == 200 ]] || { echo "FAIL: web page is not 200"; ok=0; }
curl -s -m 5 127.0.0.1:8770/healthz | grep -q '"ok":true' || { echo "FAIL: Stack health check is not ok"; ok=0; }
AFTER_MIGRATIONS="$(sqlite3 -readonly "$LIVE/data/hub.db" 'select count(*) from __drizzle_migrations')"
(( AFTER_MIGRATIONS >= BEFORE_MIGRATIONS )) || { echo "FAIL: migrations went from $BEFORE_MIGRATIONS to $AFTER_MIGRATIONS"; ok=0; }
[[ "$(grep -c 'app refused' "$LIVE/data/logs/launchd.err.log" 2>/dev/null || true)" == 0 ]] || { echo "FAIL: 'app refused' in the launchd log"; ok=0; }
(( ok )) && echo "OK: live hub is on $TAG (migrations $AFTER_MIGRATIONS)" || exit 1
