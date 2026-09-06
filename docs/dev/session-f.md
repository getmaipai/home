# Session F: platform, trust, updates and the first release

Work order: `docs/plans/session-f-platform-and-trust.md`, under
`docs/plans/wave-2.md`. Worktree `../home-f`, branch
`session-f-platform-and-trust`, `MAIPAI_DATA_DIR=data-f PORT=8804`.

## Step 0: setup

Worktree, own data dir/port, `bun install`, baseline `check.sh` green.

Neither Session A nor Session B had merged to `main` at the time this
session started (their worktrees still showed unmerged steps: A's 11-12,
B's 8-10). Checked `main` directly rather than assuming: A's step 11
(per-person request limits, the Telegram and voice-catalog fetches
through the rate limiter) was confirmed absent - `lib/telegramChannel.ts`'s
`sendMessage` and `lib/voiceCatalog.ts`'s `fetchOnePage` both called
`fetch` directly, with no `tryConsume` anywhere in either file. Per
`wave-2.md`'s own fallback for exactly this case ("If A's step 11 ... is
not on main when C starts, C ships the turn and LLM route half and F
ships the fetch half, in their first steps") and this step's own text,
this session's remaining ownership-map paths are fully disjoint from A's
and B's, so work proceeded rather than blocking on their merge - flagged
to Jesse and coordinated with the concurrent Session D (also starting
against an unmerged A) rather than decided silently.

**Deferred, not forgotten:** the `tryConsume` routing for
`telegramChannel.ts`/`voiceCatalog.ts` fetches itself is not yet done -
folding it into step 3 (the runtime guards step already touches
`llmSupervisor.ts` and the download lane) rather than a separate pass,
since it's the same "every integration goes through the limiter at its
one choke point" work.

## Step 1: issues and Repairs

Merged alone, first, per the wave-2 contract ("F to C and D: issues and
sidecars... F ships this in its step 1 and merges that step alone,
early, so the others can import it").

**Shipped:** `spec/schemas/issue.schema.json` (id, source, key, severity,
title, detail, fix, learn_more, created_at, resolved_at, hlc - schema
v10's `issues` table mirrors it), `lib/issues.ts` (`raiseIssue`,
`resolveIssue`, `listIssues`, `fixIssue`, `dismissIssue`,
`registerFixHandler`), `GET/POST /api/repairs` (owner/admin only, the
same gate `backups.ts` uses), the `repairs.new` notification type
(`time_sensitive`, `adults`, configurable) with its Telegram toggle key.
25 new tests.

**One field beyond the plan's own list, and why:** the plan's step 1
text enumerates the schema fields without `dismissed_at`. A medium-effort
code review on this diff (2026-09-06) caught a real bug in the version
that shipped with only `resolved_at`: `dismissIssue()` had reused
`resolveIssue()`'s own field, so a person dismissing a still-broken
`error` issue lasted only until the owning source's own next routine
recheck called `raiseIssue()` again (which happens on every scheduled
health check regardless of whether anything changed) - that re-raise
looked identical to a fresh occurrence, reopening the row and re-firing
`repairs.new`. Fixed by giving dismissal its own field, the same
`resolved_at`/`dismissed_at` split `notification_deliveries` already
established for read/dismiss state on a delivery: `raiseIssue()` now
preserves `dismissed_at` across a refresh of a still-open row (sticky
until the source calls `resolveIssue()` for real, which clears it), and
the "fire `repairs.new`" transition check only counts a brand-new row or
one that had been genuinely resolved, never a merely-still-open or
merely-dismissed one. Resolvable from the existing pattern already in
this codebase, so fixed directly rather than escalated; noted here per
the org's "record the verdict" practice for a judgment call made without
asking.

Also fixed from the same review: the route layer was returning
`lib/issues.ts`'s internal camelCase DB-row shape (`learnMore`,
`createdAt`, `resolvedAt`) instead of the spec's snake_case wire shape,
breaking the convention every other spec-backed route follows
(`lib/personShape.ts`'s `toPerson()` is the pattern: convert AND
validate through the generated Zod schema at the API boundary, so a
response can never silently drift from the spec). `lib/issues.ts` now
returns the spec-shaped, `Issue.parse()`-validated type everywhere,
including from `raiseIssue`/`resolveIssue`'s own return values, not just
at the route.

**What's deferred, named:** no real source calls `raiseIssue` yet (fix
handlers and the actual health checks land with the sidecar contract,
the backup/storage/engine work in later steps) - step 1 ships the
mechanism and the route surface, proven by its own tests, not a wired-up
Health page. `GET /api/health`'s placeholder (`{ status: "ok" }`) is
untouched; step 2 replaces it with the real sidecar-reporting version.
