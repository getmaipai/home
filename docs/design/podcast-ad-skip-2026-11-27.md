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

## Features the Podcasts app gains

Use shipped kit primitives only: `Player`, `Badge`, `Pill`, `Toast`, `Progress`, and `Dialog`, plus existing episode, chapter, show, settings, and Stack status components. Do not add a design-system part or wrap a kit Element. Phone layouts stack controls and allow horizontal timeline scrolling; desktop keeps the player and detail list side by side. Every state names what happened and the next action.

### Visual features

1. **Scrubber and mini-timeline.** The existing `Player` scrubber renders ranges for ad, sponsor, bumper, intro, outro, self-promo, and recap, with distinct colour and pattern per kind, a visible text legend, and labels available to screen readers. Colour is never the only cue. Tapping a range previews its start in mark mode or jumps over it in skip mode; range preview has a `Toast` action to return to the prior position. On phone the mini-timeline stays in the player and can be scrolled; desktop shows the full-width timeline. No plan shows the normal scrubber; stale plans hide all ranges and say “Skip plan needs processing” with a retry action; children see playback ranges but no review actions.

2. **Skip confirmation and sound.** A `Pill` over the player says “Skipped a break, 2:53 saved” and offers Undo for the current skip window. It includes the associated bumper when paired with an ad. A Podcasts setting toggles a quiet skip sound, with haptic feedback on supported phones; sound and haptic default off. The pill moves above controls on phone and sits beside the transport controls on desktop. If there is no active skip it is absent; failed playback stays audible and shows a `Toast` with retry guidance.

3. **Intro and recap actions.** “Skip intro” and “Skip recap” buttons appear only while playback is inside that marked range and the resolved policy is `mark`. They use existing `Player` controls and disappear at range end or after activation. Both work in the phone control sheet and desktop transport area. Outside a range they are not rendered; children may use these playback actions.

4. **Episode row badges.** Existing `Badge` on each episode row shows one state: Processing, Ready, N breaks skipped, No ads found, Skipping off, Needs review, or Stack offline. Counts include only active ad/sponsor/break skips, not marked ranges. On phone the badge follows the episode title; desktop aligns it with duration. Empty shows omit episode badges; a failed state includes a plain next step in the row detail; child rows omit Needs review.

5. **Two durations and time display.** Episode page shows original duration and estimated duration with resolved skips. The `Player` elapsed and remaining values use skipped time; one tap on the time display opens a `Dialog` with the corresponding original source position and duration. This works at both widths, with the dialog full-screen on phone. With no plan, both durations match; with a stale plan, only original duration is shown with a processing explanation.

6. **Segment timeline and review.** Episode page uses the existing `Progress` timeline plus a list of kind, source start/end, source, confidence, and status. Each row has Play this range; adults with review permission also get Confirm and Reject. “Add a missing break” enters mark-start then mark-end mode while listening; saving creates a segment with source `person`. The timeline/list stack on phone and sit beside episode details on desktop. No segments shows “No breaks found”; a failed Stack request names the failure and offers retry; children receive playback only, with no list or marking/review controls.

7. **Chapters.** The existing chapter list includes break rows as collapsed rows labelled by kind and source-time span. Expanding reveals the range and available player action. On phone rows use the same disclosure; desktop keeps breaks inline with chapters. No breaks leaves the chapter list unchanged; failed or stale plans do not add rows; children can expand playback rows but see no report or review action.

8. **Show settings and summary.** Show page has “Skip settings for this show” in the existing settings view. Each kind displays its inherited resolved value in grey, an override selector, and Reset to inherit. A summary shows ads skipped, time saved, and last processed. Phone stacks settings and summary; desktop places summary beside settings. A show with no data says “Nothing skipped yet”; a processing failure says Stack offline and offers retry. Children see effective playback state only, not controls or personal stats.

9. **Time saved.** A Podcasts page or existing summary card uses `Progress` and text for this week, this month, per show, and household total. Household totals are aggregate and never name a child; no per-person child totals are stored or shown. Phone uses stacked cards; desktop shows the same periods in a compact grid. No activity says “No listening time saved yet”; unavailable data shows the cause and retry; child accounts see household totals without member breakdown.

10. **Global settings layout.** The Podcasts settings page shows the person's global layer and, for admins, household defaults, using the existing settings components. Include all seven kinds, the bumper toggle, and plain-language explanation: “A bumper is a short sound or spoken tag around an ad break.” Explain that a bumper next to a skipped ad is skipped with it by default. Phone stacks sections; desktop uses the existing settings column layout. Empty values show built-in defaults; save errors identify the value that did not save and offer retry; children see no admin defaults or editing controls.

### Functional features

11. **Processing queue.** Enabling skipping processes eligible saved episodes on follow and each new fetched episode, during idle time only. An adult can backfill the latest N episodes of a followed show and open the existing queue view to see position/state and cancel a job. Phone queue is a stacked list; desktop adds progress in a side column. Empty queue says nothing is waiting; errors identify the episode and retry option; children cannot start backfill or cancel review work.

12. **Cross-device resume mapping.** Store resume position against the original source timeline and map it to the current skipped timeline on every device. A position saved before or after a skip resumes at the same source time elsewhere. If the source hash changed, discard the old map and resume at the last valid source position with “Episode changed; skip plan is processing.”

13. **Hear it anyway and Play original.** During the Undo window or by long-pressing a skipped-break control, “Hear it anyway” plays that range once. “Play original” disables skipping for the whole episode without changing policy. On phone long-press exposes these actions in a `Dialog` or player menu; desktop exposes the same actions in the pill/menu. Missing range offers no action; stale/offline plan falls back to original playback and explains why; children may hear a range or play original.

14. **Correction and learning.** Adults can choose “This was wrong” for a skipped break or “Missed an ad” to mark a range. Both submit the correction to Stack for that show; a person mark has source `person`. Confirm success with a `Toast`; on failure preserve the range and offer retry. Controls use the phone menu and desktop row actions. Children get neither correction action nor review controls.

15. **Saved and downloaded copies.** Ship the skip list with each saved copy; do not create cut copies during ordinary saving. Offline playback uses that list against the saved source bytes. A cut copy may be rendered only on explicit export. If a copy lacks its list, play original and show “Skip plan unavailable offline”; if its source hash differs, suppress the list until reprocessed. Phone and desktop expose identical saved-copy behavior; child access follows the same policy and hides export/review controls.

16. **Go and robot parity.** Apple TV and phone Go clients and the robot receive the same resolved skip plan through Home, including source hash, ranges, kind, and policy version. Home remains the plan authority; clients map resume positions as in item 12. If Home is unreachable, clients play the saved copy without skipping and report the connection state. Go uses its native Player surface; robot announces a skip in its existing playback voice/status. No client invents a plan.

17. **Child behavior.** Children use the same resolved skipping policy, Undo, Hear it anyway, and Play original. They receive no confirm/reject, missing-break marking, correction, processing queue, or per-person time-saved controls. Household aggregates never name them. These restrictions apply on phone, desktop, Go, and robot.

18. **Privacy disclosure.** Existing Podcasts privacy page row states that Stack fetches/analyzes episodes itself from the feed host and lists the host. Show the actual Home request `User-Agent` value and explain it identifies Home's fetcher. This row appears at phone and desktop widths. If a feed host is unknown, say it is unavailable; do not claim no request occurred after a fetch failure.

19. **Admin Stack status.** Existing Stack status page adds the segments queue, learned bumper count per show, and “Clear learned bumpers” for a selected show. Clearing calls the Stack-owned operation and confirms completion or failure in a `Toast`; no new kit part. Phone stacks the status rows; desktop uses the existing status grid. Empty queue/count show zero; offline identifies Stack and offers retry; only admins see the action.

20. **Failure honesty.** Every processing, playback, correction, save, queue, and offline state says what happened and what to do next. Reuse row text, `Badge`, `Toast`, and `Dialog`: for example “Analysis timed out. Play without skipping or retry.” Empty is distinct from failed, and stale plans are never labelled Ready. Phone and desktop use the same wording; child copy gives the safe next action without review controls.

21. **Accessibility.** All controls work by keyboard and screen reader, have names and visible focus, and announce skips, for example “Skipped a 2 minute break.” Timeline ranges expose kind, start/end, and action without relying on colour. Phone and desktop use the same accessible names and action order. Empty and error messages are announced; child restrictions do not remove playback control labels.

22. **First-run explainer.** The first time skipping is turned on, show one existing `Dialog` explaining skip ads, mark only, and off, plus what a bumper is and that it may skip beside an ad. Remember dismissal per person; it does not change policy beyond the selected choice. Phone uses a full-screen dialog; desktop uses the standard dialog. Reopen from Podcasts settings; if loading fails, defaults remain unchanged and the person can close or retry. Children do not get the setup dialog and inherit the resolved policy.

## Build boundary

No frontend work is authorized by this first-slice brief. The backend slice is gated on the shared spec-first/architect review and should be started only after that contract exists; this note does not mark any item approved or complete.
