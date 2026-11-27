# Podcast ad skipping on Home (2026-11-27)

**Status: architect verdict pending.** This is a design proposal; it does not claim approval. Stack ownership and the service contract follow the Stack plan at `/Users/jessetorres/Developer/github.com/getmaipai/stack/.claude/worktrees/minuspod-ad-skip-integration-c7a6ad/docs/plans/ad-skip-2026-11-27.md` (Jesse, 2026-11-27). The shared `media-segments` record and its spec must be architect-approved in commons before implementation that persists it.

## Scope and saved copies

Segments belong to one stored audio file, identified by its SHA-256, never to an episode URL: dynamic ad insertion means a new fetch can contain different breaks. Stream-only episodes keep publisher playback and have no reliable skip plan. Home submits `media.segments` only for the household's own `origin: fetched` podcast copy. A manual Save queues processing after the copy is committed; an automatic Save does too, but only during idle time. Followed-show polling alone does not fetch episode audio: newly discovered episodes are processed after the existing automatic keep rule has fetched a copy. A person choosing Listen now with skipping enabled first saves a copy, then processes it; if that path is unavailable, Listen now streams the publisher URL with skipping off. Existing saved copies can be queued when the person enables skipping. A replacement file hash invalidates the old plan and gets a new job. Jobs are deduplicated by SHA.

The Stack fetches/analyzes the bytes Home passes by the permitted URL/path contract; Home does not add a detection network call. Stack down or a failed job leaves normal playback available. No cut render is needed for playback: the player seeks over ranges in Home's copy. Stack's optional render is for a later export feature.

## Policy and settings

Settings are declared in the shared settings declaration and rendered by the settings system; Home does not invent a Podcasts-only settings store. Each segment kind has a household default, an optional person's global preference, and an optional per-show override. Kinds are `ad`, `sponsor`, `bumper`, `selfpromo`, `intro`, `outro`, and `recap`; each setting accepts `skip`, `mark`, `off`, or `inherit` (inherit is available to clear an override). A separate `bumpersWithAds` toggle defaults on: when enabled, a detected bumper adjacent to a skipped ad is skipped with that ad as one break. Bumpers otherwise follow their resolved kind policy.

Resolve in this order: per-show override, person's global preference, household default, built-in default. `inherit` means continue to the next layer. Built-in defaults are ads and sponsors `skip`, bumpers `skip`, self-promo `off`, intro/outro `mark` with a user-invoked button, and recap `mark` pending measured quality. For example, with household ad=`skip`, bumper=`skip`, and person global bumper=`off`, a show X bumper=`skip`, show Y bumper=`inherit`, and show Z unset, the results are:

| Show | Bumper override | Person global | Effective bumper | Adjacent skipped ad when `bumpersWithAds` is on |
|---|---|---|---|---|
| X | `skip` | `off` | `skip` | bumper and ad skip together |
| Y | `inherit` | `off` | `off` | ad skips; bumper does not |
| Z | unset | `off` | `off` | ad skips; bumper does not |

The global layer lives on the Podcasts settings page; household defaults are admin-only there. A show's overflow menu has “Skip settings for this show”; each kind shows its inherited value in grey and can be set to a value or `inherit`. Children use the same resolved playback policy and get no segment-review controls. Settings and segment access remain behind existing Podcasts visibility and age gates.

## Player behavior

Playback uses the saved copy whenever an active skip plan is applied. At a range start the player jumps to its end, preserving elapsed position in the original episode timeline. A “Skipped a break” pill summarizes the skipped break, including a bumper skipped with its adjacent ad, and offers Undo; Undo returns to the beginning of the most recent skipped range and suspends automatic skipping for that play session, restoring both segments together when they formed one break. The pill offers “This was wrong”; choosing it rejects the break's segments through Stack `PUT /stack/v1/segments/{id}` so Stack learns for that show. Marked ranges appear on the scrubber. An intro marked for manual action offers “Skip intro”. A user seek into a marked range follows the same mode policy; seeking backward or resuming never loses the person's chosen position.

The timeline remains the source duration and displayed episode time; audible time is the sum of played spans. Seeking maps a timeline position to the corresponding source position, while an explicit skip advances source position and records the skipped ranges for Undo. Saved-copy playback falls back to plain play if the plan is missing or stale. Stream playback never applies stored-copy timestamps.

## Episode page and review

The episode page lists detected segments with kind, source time, confidence and status. `held` segments are grouped for review and never auto-skipped. Confirm or reject sends the person's correction using Stack `PUT /stack/v1/segments/{id}`; Home does not locally rewrite Stack-owned segment truth. Deleting an analysis uses Stack DELETE and clears the Home link. Children have the same playback skipping but no list, held queue, confirm/reject or correction affordance.

## Privacy and failure states

Home adds no outbound destination. Podcast feed and enclosure fetching remain the existing guarded Home fetches; audio analysis is served by the configured Stack. No transcript, title, person identity or listening position is sent beyond the Stack job's required input. Logs carry counts/timing only.

Podcasts states are explicit: **Not processed** (copy exists, no analysis); **Processing** (Stack job accepted or running); **Nothing found** (analysis completed with no segments); **Stack offline** (analysis unavailable; plain play works). A Stack error never blocks Listen, Save or transcript access. A changed copy is shown as Not processed until its new hash finishes.

## Acceptance and verification

Using the seeded dev hub, save a fixture episode and prove that only its fetched copy gets a `media.segments` job; verify the returned record id and SHA bind to that copy, a matching skip plan is exposed, and the scripted Stack stand-in covers queued, completed, empty, malformed, timeout and offline replies. Replace the file and prove stale ranges are not used. Play a saved episode through ranges and Undo without losing source-time position; prove a bumper adjacent to a skipped ad is included in the same “Skipped a break” pill and Undo restores both, and “This was wrong” rejects both segments through Stack PUT for that show. Play the stream fallback with no skipping. Exercise household/person/show resolution including `inherit`, the `bumpersWithAds` toggle, grey inherited values, defaults, held review calls, and child playback with no review route/UI. Verify idle-only automatic work and that logs contain no titles, transcript text, URLs or person identifiers. Open the seeded dev Podcasts app at desktop and phone widths when UI slices are built.

## Build order

All slices depend on an architect-approved `media-segments` spec in commons. Sizes are S or M; file lists are expected touch points, refined against the approved spec.

| Id | Size | Objective, files, acceptance |
|---|---|---|
| HOME-ADSKIP-01 | S | Stack adapter and saved-copy analysis lifecycle; `backend/src/lib/media/podcastSegments.ts`, `backend/src/lib/stack/client.ts`, `backend/src/lib/stackEngine.ts`, `backend/src/db/schema.ts`, migration, save and poller hooks. Scripted Stack tests prove submit/poll, SHA binding, dedupe, stale invalidation, idle scheduling and graceful offline behavior. |
| HOME-ADSKIP-02 | S | Declared household/person/show settings and resolver; commons settings declarations, `backend/src/lib/media/podcastSegments.ts`, Podcasts settings page and show overflow menu/tests. Declare per-kind `skip`, `mark`, `off`, `inherit` for `ad`, `sponsor`, `bumper`, `selfpromo`, `intro`, `outro`, `recap`, plus `bumpersWithAds`; prove show > person > household > built-in resolution, grey inherited values, example policy, and child playback inheritance with no review UI. |
| HOME-ADSKIP-03 | M | Saved-copy skip plan API and shared audio Player behavior; `backend/src/routes/podcastApp.ts`, `backend/src/lib/media/podcastSegments.ts`, `frontend/src/shell/MediaPlayerRegistration.tsx`, player tests. Prove source-time mapping, Undo, marked scrubber, intro button and stream fallback. |
| HOME-ADSKIP-04 | M | Episode segment list and held review; `backend/src/routes/podcastApp.ts`, Podcasts package episode page, review tests. Confirm/reject calls Stack PUT; child receives no review data or action. |
| HOME-ADSKIP-05 | S | Honest processing/empty/offline states and seeded-hub verification; Podcasts package pages and focused UI tests. Verify desktop and phone, plus no outbound Home request. |

## Build boundary

No frontend work is authorized by this first-slice brief. The backend slice is gated on the shared spec-first/architect review and should be started only after that contract exists; this note does not mark any item approved or complete.
