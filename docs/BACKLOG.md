# Backlog

What's missing to go from "the hub can chat" to a usable family app. This is
a scannable list, not a narrative - full reasoning and decision history for
any item lives in `docs/dev.md` (linked where useful) or the relevant
platform standard in `getmaipai/.github`. Update this file whenever a gap
closes or a new one is found; don't let it drift from what `main` actually
does.

Rough size tags: **S** (a session or less), **M** (a real slice, days),
**L** (a platform-level capability, needs its own design pass first).

## Skills (Tier 0 catalog)

Bundled today: `remember`, `recall`, `weather`, `define`, `joke`, `trivia`.
Everything else a family would reach for is missing, prioritized on one
rule Jesse set (2026-09-05): **a lookup (read a fact, return it) beats a
control/playback action (make something happen in the world) whenever
they'd otherwise tie.** A lookup is cheaper to build (no external device
or playback surface to actually drive, no failure mode beyond "the fetch
failed"), safer (no consequential-gate/permission story to design), and
still real, standalone value on its own - "what song is this" is useful
even before "now play it" exists. A control skill also usually *depends*
on the lookup half existing first anyway (you search for the song before
you can play it), so building lookups first is both lower-risk and
frequently a hard prerequisite, not just a preference.

**Priority 1 - lookups (read-only, no external device/playback surface):**

- [ ] Web search (S-M) - already decided as "permitted and required"
      (`docs/dev.md`'s 2026-09-04 tier 2 note); the highest-value single
      lookup missing, and the one most likely to replace a real fall-
      through-to-model miss today.
- [ ] Music / media search (S-M) - "what's this song," "who sings X,"
      show/movie info and availability. A pure lookup against a
      catalog/metadata API - explicitly NOT the same skill as playing
      anything (see Priority 3 below); this is the half of "media" that's
      cheap, safe, and useful standalone.
- [ ] Unit and currency conversion (S) - pure `host.fetch` shape, same
      pattern as `weather`/`define` (e.g. frankfurter.app for currency).
- [ ] Math / quick calculation (S)
- [ ] News headlines (S-M) - most free headline APIs need a key; find one
      that doesn't, or accept the config step.
- [ ] Sports scores (S-M)
- [ ] Translation (S-M)

**Priority 2 - simple local actions (writes to our own data, no external
device or service to control):**

- [ ] Reminders / timers (S-M) - `host.schedule` already exists; this is
      mostly a recipe + manifest away.
- [ ] Shopping / todo lists (M) - needs a new record type (a list, with
      items), so a small spec addition, not just a recipe.

**Priority 3 - control / playback (drives a real external device or
service; lower priority by the rule above, and often blocked on its own
Priority-1 lookup landing first):**

- [ ] Media playback control (L) - built extensively in the legacy
      pre-rebuild code (YouTube integration, cookie-jar auth, session
      keeper), none of it migrated to this platform yet. Largest single
      skill area by legacy scope, and the one this session's own priority
      rule pushes behind music/media search.
- [ ] At least one skill that actually calls `home.call_service` (S) - the
      permission/security model shipped 2026-09-05; nothing uses it yet.
      Lower priority than the lookups above by the same rule (it drives a
      real device), though it's already unblocked (no missing
      integration to build first, unlike media playback).

## Integrations

- [ ] **Calendar** (L) - doesn't exist. Needs a design decision first:
      local-only entry within MaiPai vs. a real CalDAV/OAuth connection to
      an existing family calendar (Google/Apple/Nextcloud). See the
      compose-step sketch in `docs/dev.md`'s "Notes for later" for how this
      feeds a real multi-source answer. Reading a calendar is itself a
      lookup (Priority 1 by the Skills rule above) - it's the auth/sync
      plumbing underneath that makes this L-sized, not the read.
- [ ] **Email search** (L) - doesn't exist. No permission-vocab slot fits
      inbox access yet; needs its own consent design (see `docs/dev.md`'s
      2026-09-05 note on this) before any client code. Same shape as
      calendar: the search itself is a lookup, the sensitivity and auth
      plumbing are what make it L.
- [ ] **Media/streaming integrations** (L) - see Skills above; split the
      same way: metadata/search auth (feeds the Priority-1 music/media
      search skill, and is the smaller, safer half to build first) versus
      real playback/streaming auth (feeds the Priority-3 playback-control
      skill - rate limiting, the "we are the user" pacing rules already
      written into `getmaipai/.github`, and meaningfully more integration
      surface than a metadata lookup needs).
- [ ] Verify Home Assistant against a real instance (S, blocked on
      hardware/access, not effort) - the client is built and mock-tested;
      never proven against the real thing.
- [ ] A recipe step (or Tier 1 path) that can actually reach
      `host.integration.call` (M) - the host method exists; nothing can
      invoke it today.

## Vision

- [ ] `host.camera.still` (L) - no pipeline, no hardware path in this repo
      (the hub isn't the camera; this likely means "receive a photo the
      robot or a phone took," not "the hub has a camera").
- [ ] `host.ocr.read` (M) - RapidOCR already decided as the library
      (`docs/dev.md`); needs wiring, a recipe step, and a real image input
      path (upload? robot capture?) before it's reachable at all.

## Generation (image, video)

- [ ] Image generation (L) - deliberately not started. The org's
      non-removable child-safety invariants for generation features (see
      `getmaipai/.github` > Safety invariants) mean this needs real design
      attention before any code, not a quick slice.
- [ ] Video generation (L) - same posture, same reason.

## Advanced tool calling (Tier 2)

- [ ] Real multi-source, multi-skill answers (L) - see `docs/dev.md`'s
      2026-09-04 tier 2 note and the 2026-09-05 stress-test against it.
      Explicitly NOT an open agentic loop by design; the current best
      candidate shape is a bounded `compose` recipe step (one model call,
      author-fixed tool sequence) plus richer chained recipes. Sequencing
      already decided: ship `embed` (real semantic routing) first, ship
      more real skills, measure the actual fall-through rate from real
      conversation history, then decide whether to build this at all.
- [ ] The `embed` role itself (M) - referenced everywhere as the fix for
      today's keyword-overlap routing placeholder; not built.

## UI / shell

- [ ] Person edit and delete (M) - no backend route exists for either,
      not just missing UI. `PeoplePage.tsx`'s own comment documents this
      as a deliberate scope cut, not an oversight - still needs doing.
- [ ] Backup restore, end to end (S) - `restoreBackup()` is real and
      tested; there's no HTTP route calling it and no UI.
- [ ] A privacy page ("what leaves the house") (M) - a required org
      standard (every product keeps one); never built for this repo.
- [ ] Notifications UI (L, blocked on the notification system below)
- [ ] Package/skill catalog browsing and install (L) - blocked on the
      `catalog` repo existing for real; today only local bundled packages
      run at all.
- [ ] Admin / parental-controls surface beyond the generic settings
      renderer (M)
- [ ] Onboarding beyond the one-time initial household setup (M)
- [ ] Accessibility audit (M) - never done against any shipped page.
- [ ] Any UI for calendar, email, camera/vision, or generation (blocked on
      each of those existing first)

## Voice / robot

- [ ] Wake word past phase 1 (L) - mic capture + inference exists
      in-browser; everything else (barge-in in this repo, satellite mode,
      robot-side wiring) isn't built here.
- [ ] Robot pairing / the link API (L) - not implemented in `home` at all.

## Cross-cutting

- [ ] Cut a first real release (S, but blocking) - no tag has ever been
      made. The deploy-from-release-tag model, the clean-clone build
      check, and update delivery have never been exercised for real.
- [ ] Real i18n (L) - "language and region" is a stored preference today
      with no translation behind it.
- [ ] The notification system (4.13) (L) - not built; several manifests
      already declare a `notifications` field that goes nowhere.

## The other three products (status, not this repo's job to fix)

- **`bot`** (robot companion) - only docs ported from the legacy
  pre-rebuild code onto the fresh repo; the hardware-bench work referenced
  elsewhere was on the *old* codebase, not this platform.
- **`catalog`** (public package store) - repo scaffolding only
  (LICENSE/NOTICE/README, standards pin).
- **`go`** (Apple TV/iPhone client) - marketing copy only, no real app yet.

## How to use this file

- Check an item off only when it's shipped and verified (per
  `getmaipai/.github`'s own definition of done), not when it's started.
- A new gap found while working on something else gets added here, not
  just mentioned in passing in `docs/dev.md`.
- Size tags are a rough gut check for planning, not a commitment.
