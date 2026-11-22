# Home: pinning commons and running the gate

> **Current rules (2026-10-24).** A pin bump is one command: `bash scripts/pin.sh commons <pkg>-vX.Y.Z`, `stack <sha>` or `bot <version>`. It edits every file the pin lives in (both `package.json` files, the SHA-256 tables in `install.sh` and `maipai-engine`, `STACK_TAG` and `shared/diskPlan.json`, the bot pin file), runs `bun install --force`, commits and lands through the lander. Do not edit those by hand. What is live is no longer judged on port 8787: the family's hub is the installed app on `localhost:3000`, updated only by `bash scripts/ship.sh`; 8787 and the main checkout are not a place to restart or preview anything (a development hub there blocked the installer three times). A pin or manifest change reaches the live hub when it is shipped; say in the done report whether it was. The text below describes the old manual flow and the old gate; the facts about how pins resolve still hold.

Dev tier. Full text moved out of `AGENTS.md`. Load before bumping a `@maipai/*` pin, resolving a lockfile conflict, changing a bundled manifest, claiming something is live on port 8787, or running `scripts/check.sh` for the first time on a machine.

## Pinning `getmaipai/commons`, lockfile conflicts and what is live on 8787

**Pinning `getmaipai/commons`:** this repo resolves `@maipai/core`,
`@maipai/ui` and `@maipai/spec` each from their own immutable per-tag
worktree, not from the sibling `getmaipai/commons` checkout itself -
that checkout is one mutable directory any session on the machine can
`git checkout` a different tag into, and reading it directly let one
session's pin change silently detach every other consumer underneath
it (SHARED-PIN-01, `commons/docs/dev.md`). `scripts/check.sh` calls
`commons`'s own `scripts/ensure-tag.sh <workspace> <tag>` for each pin,
which creates `../commons-tags/<workspace>-<tag>` as a detached worktree
of that tag the first time it's asked for and reuses it after (`../
commons` by default for locating the `commons` repo itself, override
with `MAIPAI_COMMONS_DIR`). Each `package.json` `file:` dependency names
that same worktree path directly (e.g. `file:../../commons-tags/
core-core-v0.1.0/core`). Bumping a pin is therefore two edits: the tag
string in `scripts/check.sh` and the matching `file:` path in
`backend/package.json` or `frontend/package.json`, then run
`scripts/check.sh` (it creates the new tag's worktree if this is the
first consumer to ask for it) followed by `bun install --force` in
`backend/` and `frontend/` (a plain `bun install` doesn't refresh a
`file:` dependency's snapshot in bun's content-addressed store). Never
delete `node_modules` and `bun.lock` to get there: a fresh install floats every dependency
to its latest compatible version, not just the pin you
changed (2026-09-21: one recovery from a `bun.lock` merge conflict silently
moved `@assistant-ui/core` 0.3.17 to 0.3.20 and broke the chat's tests before
it was caught by diffing against a clean `origin/main` worktree). On a
lockfile conflict, take `main`'s `bun.lock` whole, then `bun install --force`;
the diff against a clean `origin/main` worktree before committing is what
proves only your pin moved. The same applies to the main checkout that serves `localhost:8787`:
a pin bump landed on `main` is not on 8787 until `bun install --force`
has run in that checkout's `frontend/` and `backend/`, because `bun
restart` rebuilds with whatever `file:` snapshot the store already
holds (2026-09-21: 8787 served a build with the kit's single-root fix
but the previous tag's palette, because the bump to ui-v0.5.13 was
installed in the session's worktree and never in `main`'s). A done
report's "what you see on reload" line is proven on 8787 itself after
the restart, by a probe or a screenshot taken from that port, never
from a worktree's own build. The same holds for a bundled manifest
under `backend/packages/`, not just a pin: the running hub re-reads an
edited manifest by mtime but validates it against whatever spec schema
it booted with, so a manifest or spec-pin change isn't live on 8787
until the hub restarts, and the done report for that kind of change
says whether the restart happened (MANIFEST-REFUSAL-01, fixes #166 -
the 2026-09-26 incident was exactly a bundled-manifest change landing
without one).

## Changing a shared kit element (commons first, rule 9)

When a Home screen needs a kit Element to look or behave differently (a prop or variant that does not exist yet), the change goes
into `getmaipai/commons`. Home never works around it with `className` or a wrapper. Agents often stop here believing the pinned
tag blocks them. It does not: the pinned tag directory is the immutable one, but `commons` itself has its own worktrees.

1. Make the commons change in a commons worktree, never in `../commons-tags/...` and never in another session's worktree:
   `cd /Users/jessetorres/Developer/github.com/getmaipai/commons` (its main checkout), then `bash scripts/wt.sh start <short-name>`,
   and work in the path it prints last.
2. Add the prop or variant with a test beside it in commons. Run that package's own test and `tsc --noEmit`, then commit by file name.
3. Land on commons main from that worktree with `bash scripts/wt.sh land`. If it refuses, stop and report why.
4. Tag it yourself. A new `ui-vX.Y.Z` tag is a library release; Jesse decided (2026-11-01) that sessions take their own
   recommendation on tags, spec changes and releases and do not ask. Cut and push the next tag from the landed commons commit.
5. After the tag exists, the Home change is the normal pin bump in this file's first section, then the screen change that uses the new prop.

## Running the gate: prerequisites, docs scope and the lock

package's own tests; `tsc --noEmit` (backend) or `tsc --noEmit && eslint
.` (frontend) to lint. `bash scripts/check.sh` from the repo root is the
full pre-commit gate: it needs a sibling `getmaipai/.github` checkout
(`../.github` by default, override with `MAIPAI_STANDARDS_DIR`, which may be
relative to the repo root) with its
own `gen/ts` and `gen/py` already generated, and a sibling
`getmaipai/commons` checkout present with the pinned tags fetched (see
"Pinning" above - the gate resolves each into its own worktree itself),
or the gate fails with a "missing" error that looks unrelated to what
you changed.
A commit that touches only docs runs `bash scripts/check.sh --docs` instead (the reading-level lint plus the standards core, seconds not minutes).
Every scope but docs first takes the machine-wide full-gate lock from
`../.github/standards/bin/gate-lock.sh` (override with `MAIPAI_GATE_LOCK`)
and waits its turn behind any other repo's gate on this machine; `bash
../.github/standards/bin/gate-lock.sh status` shows who holds it and who
is queued. Never hand-roll a wait for another gate: run `check.sh`.

## The Stack's admin page needs its ui tag pinned too

The Stack builds its admin page (`admin-ui/`) only when the `@maipai/ui` tag named in `admin-ui/package.json` sits in `commons-tags`. The
installer (`fetch_stack_commons`, then `fetch_stack_admin_ui`, in both `install.sh` and `maipai-engine update`) reads that name from the fetched
Stack, checks the archive against the same `commons_archive_sha256` table and places it, so `bash scripts/pin.sh stack <sha>` also adds a digest
for every Commons tag the Stack's `backend/` and `admin-ui/` name that the table lacks. A tag that cannot be placed, verified or built never
blocks the Stack: the installer says in one sentence that the admin page was skipped, builds without it, and `/admin/` answers 503 until the next run.

The ui tag's own `file:../spec` (and any other `file:../<name>`) is never taken from the Stack backend's `spec` tag, which can be older (Stack
6895990: backend spec-v0.1.471, ui-v0.5.728 written against the spec of its own commit, 0.1.478; linking the older one failed `tsc` on
`@maipai/spec/stack/ts/stack-choices` and the live `/admin/` answered 503). A Commons archive is the whole repository at that commit, so the
installer unpacks the ui tag's siblings from the same archive into `commons-tags/ui-<tag>/<name>`, under the ui tag's one verified digest. No second
digest is needed, so `pin.sh stack <sha>` adds none for them; a test fails if the page's spec is a link or lacks the files the ui imports.

## Bumping `STACK_TAG` also copies the disk plan table

`shared/diskPlan.json` is a verbatim copy of the Stack's `docs/disk-plan.json` (every install's size per component and tier, from the
Stack's pins and its measured table). The installer reads it before any Stack exists, and the setup checks, the plan step and the storage
step read it until the Stack answers with its own. When a release moves `STACK_TAG` in `scripts/install.sh`, copy the file from the Stack
checkout at that commit (`git -C ../stack show <STACK_TAG>:docs/disk-plan.json > shared/diskPlan.json`) in the same commit.
`backend/tests/diskPlanTable.test.ts` compares the two (set `MAIPAI_STACK_DIR` when the Stack checkout is not `../stack`) and fails when the copy is out of date.
After a pin's byte count changes in the Stack, run `bun run measure:disk-plan` and `bun run gen:disk-plan` there first; its own test fails until you do.
