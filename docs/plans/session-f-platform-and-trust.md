# Session F: platform, trust, updates and the first release (backend, spec, scripts, docs site)

A self-contained work order. Read `wave-2.md` first (rules, ownership,
shared-file protocol, contracts), then this file, then code until every
step is merged. Written 2026-09-06.

## Read first

1. `getmaipai/.github/CLAUDE.md`, and `docs/UPDATES.md`, `docs/BACKUPS.md`,
   `docs/NOTIFICATIONS.md`, `docs/ENGINEERING.md`, `docs/STYLE.md`,
   `STACK.md`, `SECURITY.md` there, and `plugin/skills/release/SKILL.md`.
2. `docs/plans/wave-2.md`, all of it. Your steps 1 and 2 are merged
   early and alone because C and D import them.
3. `docs/BACKLOG.md`: "People, relationships and permissions", "UI /
   shell" (Health and Repairs), "Portability and the link" (the fixes and
   the pieces you lay), "Cross-cutting", "Legacy: copy, re-examine,
   record" (the runtime guards and the lessons), and "Wave 2 additions".
4. Platform plan 2.4, 2.5, 4.1, 4.2, 4.11, 4.12, 4.13, 4.15, 7.1, 7.4 and
   13 (read only).
5. `docs/dev.md`: "Hub v0.1 status" (the identity slice and its deferred
   list), "Entities, relationships and grants", "Restore, staged and
   applied at boot", "The notification system", "API routes and
   `@hono/zod-openapi`".
6. `backend/src/lib/{access,personLifecycle,session,secret,keystore,backup,restoreStaging,notifications,llmSupervisor,modelDownload,rateLimiter,hlc}.ts`,
   `backend/src/routes/{auth,people,backups,settings,notifications}.ts`,
   `backend/src/{index,app}.ts`, `scripts/check.sh`.
7. Legacy references (read only): `home-legacy.git`'s `serverUpdate.ts`,
   `quickConnect.ts`, `deviceToken.ts`, `hubIdentity.ts`,
   `hubEndpoints.ts`, `dirtyBoot.ts`, `gracefulExit.ts`, `push.ts`,
   `engineGuards.ts`, `downloadJobsStall.test.ts`, `lib/backup/`,
   `lib/storage/`, `run.ps1`, `run.sh`, `docs/public/install.sh`,
   `docs/public/install.ps1`, the Astro Starlight site under `docs/`,
   and `docs/internal/chat-latency.md`.

## The goal

At the end of this session the hub can be installed by a stranger from
the docs, trusts its own LAN, knows when it is unhealthy and what to do,
updates and rolls itself back, backs up to somewhere off the machine,
and has cut its first release. Concretely:

- `v0.1.0` exists: a tag, a GitHub release, a changelog, a clean-clone
  build, a restore drill, a security review pass.
- One-line install on macOS, Linux and Windows, then a service that
  starts at boot and never needs a terminal again.
- The browser shows no warning on the LAN; the microphone, passkeys and
  push work because the household CA is trusted.
- Health and Repairs are real; a broken build rolls back on its own.
- A grant, not a role name, decides what a person may do; a parent's
  approval gates a child's install.
- Every route is on `@hono/zod-openapi` and `/api/docs` explores it.

## Files you own

See `wave-2.md`, "Ownership map", session F. You do not touch
`turnEngine.ts` and C's memory and voice files, D's package files, or
`frontend/`. Engine supervision, downloads and the model catalogue are
yours; the LLM client (`llm.ts`) and the turn engine are C's.

## Steps, in order

### Step 0: setup (S)

Worktree `../home-f`, branch `session-f-platform-and-trust`, `data-f`,
port 8804, `bun install`, `scripts/check.sh` green. If A's step 11 is not
on `main`, route `telegramChannel.ts` and `voiceCatalog.ts` fetches
through `tryConsume` now, with tests.

### Step 1: issues and Repairs (S; merge alone, first)

Spec first: `spec/schemas/issue.schema.json` (id, source, key, severity,
title, detail, fix, learn_more, created_at, resolved_at, hlc), fixture,
bindings. `lib/issues.ts` with the contract's `raiseIssue` and
`resolveIssue`, the `issues` table, `GET /api/repairs`, fix and dismiss
routes, one `repairs.new` declared notification type at level
`time_sensitive` for `error` severity. Rebase, check, review, commit,
merge to `main` immediately so C and D can import it, then continue on
the branch.

### Step 2: the sidecar contract (S-M; merge alone, second)

`lib/sidecars.ts` per plan 4.12: a registry with declared startup order,
health URL, ports, mounts, backup mode and exclude patterns, one
supervisor for all of them (spawn, health poll, restart with backoff,
log ring, stop on exit through a `gracefulExit` hook so a detached
sidecar never holds a port across restarts), and the contract's
`registerSidecar`/`getSidecar`. Move `llmSupervisor.ts` and
`embedSupervisor.ts` onto it (same behaviour, one implementation).
`GET /api/health` reports every sidecar. Merge alone, like step 1.

### Step 3: the runtime guards legacy paid for (S-M)

In `modelDownload.ts`, `llmSupervisor.ts` and the scheduler's download
lane: a download stall watchdog (a 7 GB checkpoint once sat at "28 s
left" for 21 minutes), six-attempt backoff, negative caches that store
only genuine misses (313 poisoned rows once purged), a max-resident
models policy with an orphan sweep (orphaned runners once forced every
load to CPU: a 90 s "hi"), a crash-boot hold that refuses heavy compute
for 30 minutes after a dirty boot (three power-offs in one night;
`dirtyBoot.ts` reads Kernel-Power 41 on Windows, the equivalent on
Linux and macOS best-effort), and the chat-latency rule that the warm-up
prefix equals the chat prefix (a test that fails if C's stable prefix
and the warm-up drift apart; coordinate the export with C through the
backlog). Each guard's origin is one line in your dev file.

### Step 4: `@hono/zod-openapi` and `/api/docs` (M)

The scaffolding (`createRoute`, the OpenAPI document, the explorer at
`/api/docs`, the shared error and pagination schemas), then every route
file you own converted. The org rule says any route another session
touches gets converted by that session; write the pattern once in your
dev file with a worked example so C, D and E copy it, and the backlog
item lists which files remain. `docs/api/` is generated from the
document by a script `check.sh` runs and diffs (never hand-written).

### Step 5: trust on the LAN (M)

`householdCa.ts`: a household certificate authority minted at first
run, a leaf for `maipai.local` and the hub's addresses, rotation as a
Repairs item; the server serves TLS when the certificate exists and
plain HTTP otherwise; `mdns.ts` advertises `_maipai._tcp.local` with the
TXT fields from plan 7.1 (a pure-JS responder; a firewall rule added by
the installer on Windows); `hubIdentity` (instance id minted once, never
rotated) and `hubEndpoints` (the address book: detected LAN addresses,
the overlay name, managed rows) copied from legacy with their reasons
("a laptop on a cafe network gets a 200 from a stranger's box"). The
"trust this hub" step: `GET /api/setup/ca` serves the CA certificate and
a per-platform install hint (a profile on iOS and macOS, the store on
Windows), and a QR for other devices. Tailscale as an optional step
that detects an existing daemon and never installs one silently.

Tests: the CA and leaf validate; the instance-id check refuses a
mismatch; mDNS TXT shape. Acceptance: a browser on the LAN with the CA
installed shows no warning and the microphone prompt appears (Jesse's
devices for the trust step; record what you could verify locally).

### Step 6: passkeys, device tokens, Quick Connect, sessions (M)

WebAuthn through `@simplewebauthn/server` (passkeys as the strong
credential for adults, offered in the wizard, per person, lockout
rules shared with PIN and password); device tokens (365-day, sha256
stored, bound to the instance id, twenty per person, raw value returned
once) so native clients survive a change of address; Quick Connect (a
short code with no 0, O, 1 or I, shown on a device, approved from a
signed-in phone, redeemed once, in memory, five-minute expiry, rate
limited); sessions per device under Profile with revoke; optional TOTP
for owner and admin. The `Device` record in `spec/schemas/device.schema.json`
(kind `robot | pod | tv | phone | desktop | browser`, name, area,
capabilities, token hash reference, watermarks, hlc) is the shape Wave
3's link pairs a robot into; lay it now.

### Step 7: entities, relationships, grants, approvals (M-L)

The hub half of the spec that landed in Wave 1: tables, migrations,
routes, the cross-field validators from `spec/records/ts/` enforced at
the boundary; `GET /api/people/:id/permissions` computing the effective
set (denies win, `safety_stop` undeniable); the approval queue (Ask to
Install, Ask to Browse) with `GET /api/approvals` and its declared
notification type to the parent audience; time allowances and schedules
per category as household settings enforced in the package host's
`ctx` (D reads `ctx.allowance`; you write it). Grants are added beside
roles this wave: every `requireRole` call gains a grant check that
passes when either allows, so nothing a family can do today stops
working, and the backlog's two Jesse's-call items stay open with the
migration path written in your dev file. Person gains `enabled`
(disabled-but-present), guest expiry, memorialise, and the band change
on a birthday with its passive notification. The free-text memory
entity is retired by C once your Entity table lands (coordinate through
the backlog).

### Step 8: backups to somewhere else, the emergency kit, the restore drill (M)

Targets through a backup-agent port: `local`, `smb` (a NAS share), and
`hub` as the interface a robot will use; at least one off-machine target
or the Storage page warns; retention seven daily, four weekly, three
monthly with a size cap; before every update and restore; a failure
raises a Repairs item and two in a row notify admins. The emergency kit
(backup key and hub identity as a printable page and a file, shown once)
generated at setup. Signed archives, a tampered one refused. The restore
drill: a script that restores the latest backup into a temporary data
directory and boots it headless with a sign-in; the release skill runs
it. Partial restore of one person's data.

### Step 9: storage, quotas, uninstall, factory reset, diagnostics (M)

The `data/` layout from plan 4.15 (`db/`, `packages/`, `media/`,
`models/`, `cache/`, `backups/`, `keys/` outside backups, `releases/`),
`GET /api/storage` with sizes per area and per package (D's
`getCacheStats()`), per-person quotas, a disk-full policy (caches first,
then a Repairs item, never a crash), NAS mounts declared with scan
paths; an uninstaller that removes the service and binaries and offers
to keep or wipe `data/`; a factory reset behind a typed confirmation and
a fresh backup; redacted diagnostics download with a `TO_REDACT` list in
`spec/` and a test that no secret, address or family name survives it.

### Step 10: the updates projection and self-update (M-L)

`lib/updates.ts`: one projection (installed, latest, summary, url,
channel, progress, needs, blocked_by) over the app (GitHub Release of
`home`, signed asset and sha256), packages (D's store), models (the
catalogue), sidecars (pinned with the app); one check a day, listed on
the privacy page as the only periodic outbound call; a digest-level
notification at most once a day. `lib/selfUpdate.ts`: verify, back up,
stage into `releases/<version>`, dry-run migrations against the backup,
swap the `current` pointer, restart under the service, health check
within a window or the pointer moves back and the previous version
boots; keep the last two; only in the nightly window and never during a
conversation, a generation, a download or playback; `blocked_by` for
`min_app`; rollback as a button. The Windows rules legacy learned
(Defender holds `dist/` handles past 3 s; an unresolvable upstream never
reads "up to date") are tests.

### Step 11: install, the service, the docs site, the release (M)

- `scripts/install.sh` and `scripts/install.ps1` (one line, latest tag,
  never `main`), a Windows service, a launchd unit and a systemd unit
  with the GPU power ordering `run.ps1` learned, port-conflict detection
  with a chosen alternative, hardware minimums checked by the wizard's
  `hardware` step (your `POST /api/setup/hardware` returns the fit).
- The docs site: Astro Starlight under `docs/site/`, reading `docs/user/`,
  `docs/dev/` and the generated `docs/api/`, published by a
  docs-triggered public workflow only if the repo is public, otherwise
  built locally; the install guide, the update page and the privacy page
  are the three pages the release notes link.
- `scripts/check.sh` gains: the a11y half of E's matrix, the `docs/api`
  drift check, the standards `gen/` presence check `spec/README.md`
  notes as missing, and a reading-level lint on `docs/user/`.
- Performance budgets as a bench: first token, page open, cold start,
  measured against the archived legacy numbers (200 to 900 ms first
  token warm) and recorded; a regression is a Repairs item on the
  bench machine only.
- Then, and only when Jesse says so: the `release` skill for `v0.1.0`
  (a security review pass first, the clean-clone build, the restore
  drill, the changelog, the tag). Cutting it is his call; everything up
  to the tag is yours to have ready.
- `spec-v0.1.0`: prepare the tag (the spec README's pin line, the
  fixtures green in both languages) and stop; the tag itself is Jesse's
  word, and it unblocks the `bot` repo.

### Step 12: wrap up

`docs/dev/session-f.md` complete; the "Wave 2" index in `docs/dev.md`
created with one line per session file (you create the index; the
others add their line); `docs/BACKLOG.md` checked off and corrected;
the org-file drift the backlog lists ("Doc drift the audit found")
written up for Jesse with the exact edits `.github` needs;
`scripts/check.sh` green; `code-review` on the final diff; merge into
`main`; delete the worktree; do not push unless Jesse says ship.

## If you get stuck

- A design question: the `design-resolver` agent, decision recorded.
- A step that needs Jesse's device or account (the CA on his phone, a
  NAS share, a real Windows box): ship the code with tests and the
  scripted check, and name the manual check in your status block.
- A release, a tag, a deploy: never without his word in the moment.
- Something only Jesse can decide: finish every other step, then stop
  with a status block naming exactly what is blocked and why.
