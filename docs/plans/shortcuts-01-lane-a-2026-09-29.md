# SHORTCUTS-01: a keyboard shortcut reference on Cmd+/

Lane: codex-a, worktree `~/Developer/github.com/getmaipai/home-codex`.
Model floor: Codex, low reasoning (small, mechanical, no design judgment).

## Ready handshake

Report ready (model, checkout, branch, "ready for SHORTCUTS-01"), wait
for "start".

## Why

`docs/BACKLOG.md`'s `SHORTCUTS-01` row (search for it): chat shortcuts
(new chat, focus composer, stop reply) plus a reference sheet, built
from the kit's already-shipped dialog primitive, listing the kit's
existing Cmd+K and Cmd+B alongside the new ones.

## Files you own

`~/Developer/github.com/getmaipai/home-codex` (your worktree, sync
first per usual): the chat surface's keyboard-handling code and a new
shortcut-reference dialog component under `frontend/src/`. Find the
kit's existing dialog primitive (search `@maipai/ui` for a `Dialog`
export, mirror an existing dialog's usage in this repo rather than
inventing a new pattern) and the existing Cmd+K/Cmd+B handlers (grep
for them) so your new shortcuts and reference sheet match their exact
style and registration pattern.

## Setup

`cd ~/Developer/github.com/getmaipai/home-codex && git status` (confirm
clean) `&& git fetch origin && git merge --ff-only origin/main`.

## Steps

1. Find how Cmd+K and Cmd+B are currently wired (grep `frontend/src` for
   their key-handling) - this is your pattern to mirror exactly for
   "new chat", "focus composer" and "stop reply".
2. Add the three new shortcuts, each doing the real action (not a stub):
   new chat, focus the composer input, stop an in-flight reply.
3. Build the Cmd+/ reference dialog from the kit's shipped `Dialog` (or
   equivalent) primitive, listing all five shortcuts (the three new
   ones plus the existing Cmd+K and Cmd+B) with plain labels.
4. A test for each new shortcut firing its real action, and one for the
   reference dialog opening on Cmd+/ and listing all five - mirror an
   existing shortcut test's pattern if one exists in this repo.

## Acceptance evidence

- The three shortcuts work for real (exercised in a test, not just
  wired).
- Cmd+/ opens the reference dialog listing all five shortcuts.
- A real screenshot of the open dialog, opened and judged by you before
  reporting done (per the org's screenshot rule - no spinner, no wrong
  route).

## Exit checks

- `bash scripts/check.sh` green, scope noted.
- Code review at low effort (small, mechanical UI addition) with an
  explicit target (`main...HEAD` in your worktree).
- One commit, staged by name.
- Push once green (`git push origin HEAD:main`).

## Reporting

Ready, then wait for start. Done: commit hash, check.sh pass line,
screenshot path and what it shows, test results. Blocked: exact error.
Question: only if the kit's dialog primitive or the existing shortcut
pattern genuinely isn't findable - don't guess at either.
