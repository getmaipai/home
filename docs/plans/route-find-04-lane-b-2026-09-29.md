# ROUTE-FIND-04: literal routing prefers the most specific pattern, and a discourse "look," is not a command

Lane: codex-b, worktree `~/Developer/github.com/getmaipai/home-codex-2`.
Model floor: Codex, low reasoning (a precisely-specified bug fix, no
design judgment).

## Ready handshake

Report ready (model, checkout, branch, "ready for ROUTE-FIND-04"), wait
for "start".

## Why

`docs/BACKLOG.md`'s `ROUTE-FIND-04` row (search for it) is fully
specified - read it in full, it names the exact files, the exact fix,
and the exact test wording. Short version: two real bugs in
`turnEngine.ts`'s `routeLiteral()`/`commandOpenersFrom()` (near line
1445): (a) matching patterns resolve by alphabetical package order
instead of by pattern specificity, silently shadowing a later-sorting
package; (b) a pattern's bare first word is treated as a command
opener, so "Look, I really think we should talk about this" gets
misread as a directive.

## Files you own

`~/Developer/github.com/getmaipai/home-codex-2` (your worktree, sync
first): `backend/src/lib/turnEngine.ts` (`routeLiteral()` and
`commandOpenersFrom()`) and its test file, plus the routing corpus
fixture if the BACKLOG row's own acceptance requires touching it (read
the row - it names this).

## Setup

`cd ~/Developer/github.com/getmaipai/home-codex-2 && git status`
(confirm clean) `&& git fetch origin && git merge --ff-only origin/main`.

## Steps

Follow the BACKLOG row exactly - it is the full spec:
1. `routeLiteral()`: among matching patterns, the one with the longest
   literal prefix wins; ties break by package id.
2. `commandOpenersFrom()`: an opener is a pattern's full literal prefix
   before its first wildcard, never just the bare first word; a first
   word followed by a comma is never treated as an opener.
3. Tests in the row's own exact words: "look up the artist Adele"
   routes to music regardless of package load order; "Look, I really
   think we should talk about this" and "Put simply, it's complicated"
   are not treated as directives.
4. Out of scope, explicitly: a leading "search" (e.g. "search the house
   for the keys") still routes to websearch by the owner's own prior
   rule - do not touch that behavior.

## Acceptance evidence

- The three named test cases passing, in the row's own wording.
- `scripts/check.sh` plus the routing corpus replay (the row names this
  exit check specifically - find and run it, don't skip it).

## Exit checks

- `bash scripts/check.sh` green, scope noted.
- Code review at low effort (a scoped bug fix with named tests) with an
  explicit target (`main...HEAD` in your worktree).
- One commit, staged by name.
- Push once green (`git push origin HEAD:main`).

## Reporting

Ready, then wait for start. Done: commit hash, check.sh pass line, the
three test names and results, routing corpus replay result. Blocked:
exact error. Question: only if the row's own text and the actual code
at `turnEngine.ts:1445` genuinely don't match what's described - re-read
both before concluding that.
