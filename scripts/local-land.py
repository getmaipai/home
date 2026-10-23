#!/usr/bin/env python3
"""Land and release work done by the local coding model, so development continues when Claude is unavailable.

  python3 scripts/local-land.py land [--dry]    in a worktree: commit the changes by file name, run `wt.sh check`, land on main (fast-forward), remove the worktree
  python3 scripts/local-land.py release --yes   tag origin/main as the next version and install it on the family hub (run it on the Studio)

The model never needs push rights of its own: it calls this script, which applies fixed guards and uses the repo's own `wt.sh` and
`release-home.sh`. It refuses anything touching access, credentials, safety, migrations, installers, the gates or package files; more than
12 files or 700 diff lines; a failing check; a newest main that failed its gate; and a second release within 30 minutes. Standard library only.
"""
import os, re, subprocess, sys, time

PROTECTED = re.compile(
    r"(^|/)(package\.json|bun\.lock|\.env[^/]*|\.github/|\.githooks/|hooks/|docs/design/RULES\.md|scripts/(check|wt|release-home|install|maipai|local-land)[^/]*|"
    r"scripts/engine-computer/|backend/drizzle|backend/src/db/migrations|rules-baseline\.json)|(auth|credential|secret|password|session|consent|safety|csam|age[-_]?gate|codeGate|apiKeys|trustProxy|tailnetNode)",
    re.I)
MAX_FILES, MAX_DIFF_LINES, RELEASE_COOLDOWN_S = 12, 700, 30 * 60
HTTPS = {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "url.https://github.com/.insteadOf", "GIT_CONFIG_VALUE_0": "git@github-jessewebdotcom:"}


def git(cwd, *args, **kw):
    return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, env=dict(os.environ, **HTTPS), **kw)


def guard(worktree):
    """(files, refusal): every path that differs from origin/main (committed, edited or new) outside data-scratch, and one plain sentence when a person must review instead."""
    changed = git(worktree, "diff", "--name-only", "origin/main").stdout.splitlines() + git(worktree, "ls-files", "--others", "--exclude-standard").stdout.splitlines()
    files = sorted({f.strip() for f in changed if f.strip() and not f.startswith("data-scratch/")})
    if not files: return files, "there is nothing to land"
    if len(files) > MAX_FILES: return files, "it changes %d files (the limit for landing without review is %d)" % (len(files), MAX_FILES)
    bad = [f for f in files if PROTECTED.search(f)]
    if bad: return files, "it touches a protected or access-related path (%s), so a person must review and land it" % ", ".join(bad[:3])
    n = len(git(worktree, "diff", "origin/main").stdout.splitlines())
    for f in git(worktree, "ls-files", "--others", "--exclude-standard").stdout.splitlines():
        if not f.startswith("data-scratch/"):
            try: n += len(open(os.path.join(worktree, f), errors="replace").read().splitlines())
            except OSError: pass
    if n > MAX_DIFF_LINES: return files, "the diff is %d lines (the limit for landing without review is %d)" % (n, MAX_DIFF_LINES)
    return files, None


def land(worktree, dry=False):
    files, why = guard(worktree)
    if why: print("not landed: %s. The changes stay in the worktree for review." % why); return 1
    top = git(worktree, "rev-parse", "--show-toplevel").stdout.strip()
    session = re.sub(r"^[a-z]+-", "", os.path.basename(top))
    env = dict(os.environ, **HTTPS, MAIPAI_WT_SESSION=session)
    run = lambda *c, t=3600: subprocess.run(c, cwd=top, capture_output=True, text=True, env=env, timeout=t)
    title = (git(worktree, "log", "-1", "--format=%s").stdout.strip() or "Local coder change")
    if dry: print("dry run: would commit %d file(s) by name (%s), run wt.sh check, then wt.sh land" % (len(files), ", ".join(files[:6]))); return 0
    run("git", "add", "--", *files)
    if run("git", "status", "--porcelain", "--untracked-files=no").stdout.strip():
        msg = os.environ.get("LOCAL_LAND_MESSAGE") or "Local coder: " + " ".join(os.path.basename(f) for f in files[:3])
        c = run("git", "commit", "-q", "-m", msg + "\n\nLocal-Coder: yes")
        if c.returncode: print("not landed: the commit failed:", (c.stdout + c.stderr)[-400:]); return 1
    k = run("bash", "scripts/wt.sh", "check")
    if k.returncode: print("not landed: the repo check failed. The commit stays on the branch for review.\n" + (k.stdout + k.stderr)[-900:]); return 1
    l = run("bash", "scripts/wt.sh", "land")
    tail = (l.stdout + l.stderr).strip()
    if l.returncode: print("not landed: wt.sh land refused:", tail[-500:]); return 1
    print("LANDED on main:", tail.splitlines()[-1] if tail else "ok")
    run("bash", "scripts/wt.sh", "done")
    return 0


def release(repo, yes):
    if not yes: print("Releasing restarts the family's hub. Re-run with --yes only if you want that now."); return 2
    git(repo, "fetch", "-q", "--tags", "origin")
    tip = git(repo, "rev-parse", "origin/main").stdout.strip()
    note = os.path.join(repo, "data-scratch", "main-gate", tip + ".md")
    if os.path.exists(note): print("REFUSED: the newest main (%s) failed its gate. Read %s, fix it, then try again." % (tip[:9], note)); return 3
    stamp = os.path.join(repo, "data-scratch", "main-gate", "last-local-release")
    if os.path.exists(stamp) and time.time() - os.path.getmtime(stamp) < RELEASE_COOLDOWN_S:
        print("REFUSED: a release ran less than 30 minutes ago. Wait, then try again."); return 3
    r = subprocess.run(["bash", "scripts/release-home.sh", "--owner-approved"], cwd=repo, env=dict(os.environ, **HTTPS))
    if r.returncode == 0:
        os.makedirs(os.path.dirname(stamp), exist_ok=True); open(stamp, "w").write(tip)
    return r.returncode


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["land"]: sys.exit(land(os.getcwd(), dry="--dry" in args))
    if args[:1] == ["release"]: sys.exit(release(os.environ.get("HOME_REPO", os.path.expanduser("~/Developer/github.com/getmaipai/home")), "--yes" in args))
    print(__doc__); sys.exit(2)
