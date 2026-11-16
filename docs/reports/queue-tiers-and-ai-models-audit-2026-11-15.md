# Queue, levels and the AI and models page: audit, fix plan and redesign (2026-11-15)

Status: analysis and plan only, nothing built. Owner's ask (Jesse, 2026-11-15): audit the queue and level system
(Reduced, Standard, Boost, Max, off, per feature), find what is wrong and plan the fix; check that shared features
such as upscaling are one implementation called through the queue; redesign the AI and models page so what is
assigned, installed and broken is visible at a glance. Mockup: the design canvas "AI & models redesign"
(https://claude.ai/artifact/BAao6YWTzcFvjDJ6ajFQb6, four boards).

Checked against Home `main` at `0ca97f610` and Stack `969f3f0`, plus the running workbench (`/api/ai/tiers/*`,
`/api/performance/capabilities`, `/api/engines/health` read live). Design records: `docs/design/resource-tiers-2026-10-27.md`,
`docs/dev/resource-tiers.md`, `docs/design/ai-models-glance-2026-10-26.md`.

## 1. Answer in short

1. **The queue exists and works for three things only: pictures, videos and music.** Every other AI call (chat,
   voice, listening, picture tools such as upscale and background removal, companion art and clips, film stills,
   cast looks, head swap, likeness masks, voice samples) goes straight to the Stack and is never seen by Home's
   queue. The Stack's own governor is the only thing that stops them from colliding, and it admits one generator at a time.
2. **The levels are half wired.** Video and music read their slot at send time. Pictures never do: a Max picture is
   queued as Max, holds every other job, and then runs the Boost model with no level sent to the Stack. Chat has
   Standard only. Voice has Standard only. Reduced for chat is entered on every Max video, not only when memory needs it,
   and the "Let big jobs simplify chat" switch is written by the page and read by nobody.
3. **The level catalog is mostly empty on the real machine.** On the Studio the Stack reports a level room of 41 GB
   because it counts the resident chat model as always loaded. So video Standard has no model that fits (Wan needs
   25 GB, the cap is 24 GB), chat Max and video Max resolve to nothing, and the installed 72 GB LTX-2.5 Max is
   refused with "this computer can never hold it" on a 128 GB computer. The Performance tab's "What this computer
   can do" table shows the same contradiction (Videos: Standard No, Max Yes).
4. **Upscaling is one engine on the Stack reached by three separate Home wrappers plus two local resizers.** It is
   not queued, has three different error texts, and the "Picture tools" part that holds it is not installed on the
   workbench, so the Picture editor, chat and companion uploads all fail the same way in three different wordings.
5. **The page hides all of this.** The Overview says "1 custom, 10 recommended, 2 disabled" and the profile menu says
   "System: all good" while the Engines tab's Health table has carried three warnings since Nov 6 and two levels
   have no model. The page has three ways to change a model, two ways of saving, dialogs three deep, and the same key
   drawn twice.

## 2. What the design promised and what is built

| Promise (resource-tiers 2026-10-27) | State | Evidence |
|---|---|---|
| Who may use which level: age ceiling, guest, Max grant, off slot, Boost "who" | Built | `backend/src/lib/tiers.ts:75-93` |
| Standard, Boost, Max admission ladder (run, ask, queue, refuse) | Built, starved of input | `lib/jobs/liveFit.ts:60-134`; the Stack's budget lists only what fits in memory free right now (Stack `routes/hardware.ts:29`), so Home's fit table is nearly empty |
| Level travels to the Stack on every job | Video and music yes; **pictures no** | `videos/slotBody.ts:60`, `music/stack.ts:23`; `pictures/stack.ts` `GenerationBody` has no `tier` |
| Max picture runs the Max model (Qwen-Image 20B) | **Not built** | `pictures/quality.ts:10,47-59`: Boost model always; provenance still records "max" (`creations/writers.ts:63`) |
| A switched-off level falls one step with a note | Video and music yes; pictures only the Boost switch | `tiers.ts:125-130`, `pictures/policy.ts:113-119` |
| Reduced chat only when the Max job's peak does not fit (rule 2a.1, MAX-LIVE-01) | **Contradicted** | default `resources.profiles` row `video.max` has `chat: reduced` and `householdQueue.ts:563-589` asks for Reduced on every Max video; the Stack's own path is right (`governor.ts:203-232`) |
| "Let big jobs simplify chat" switch (`engines.chat.tier.reduced`) | Written, never read | `AiGlance.tsx:91`; no reader in Home or Stack |
| Max chat lease holds Boost and Max jobs, Standard keeps running (T6) | **Contradicted on the Stack** | `chatLeaseRuntime.ts:20` uses coding mode; Stack `governor.ts:596` holds every generator |
| Standard jobs run beside each other ("A with A") | Contradicted | Stack `governor.ts:602`: one generator at a time |
| Quiet window before Reduced (S1 to S4) | Built in Home; the Stack's own swap skips it | `householdQueue.ts:252-268`; Stack `maxWindowReduced.ts:41-46` |
| Chat Boost (thinking), Reduced voice (Chatterbox Nano), video Boost, music Boost and Max in the catalog | Designed only | `shared/tierSlotOptions.ts:19-25`; Stack `lib/tiers.ts:45-56` (empty cells); `chatterbox-nano` has no pin |
| Boost video admission | Likely stuck forever (from code, not reproduced) | no Stack candidate gives Boost video a peak, so `liveFit.ts:40` returns Infinity, outcome "refuse", held as `tier_no_room` and re-checked every 5 s (`householdQueue.ts:558-561`) |
| Job `window`, `tier_reason`, music provenance tier, pinned profile cells, save-time validation | Not built | `music/jobs.ts:309`, `profileSource.ts:71`, `profileTable.ts:15` unused |
| Status row per category on the Status page | Not built | nothing on Status reads levels |

Dead code found on the way: `liveFit.ts:164,170` (`stagesFor`, `chatMayReturnBetweenStages`), `householdQueue.ts:270`
(`quietSecondsFor`), `chatLease.ts:103,135` (`noteToken`, `evicted`), `jobProducers.ts:44` (`startImageProducerJob`, no
callers), the all-levels mode of `AiSlotChoices` and `levelsLine` in `aiTierSlots.ts:82`, and `ENGINE_ROLE.sounds` reading a key
that does not exist (`aiGlanceRows.ts:9`). `chatModelSwitch.ts:162` hard-codes the uncensored model id as the download prefix
for every model.

### The level grid on the Studio today (live `/api/ai/tiers/*`, room 41.5 GB)

| | Reduced | Standard | Boost | Max |
|---|---|---|---|---|
| Chat | Qwen3 4B | Qwen3.8 27B Uncensored (custom) | Muse Glimmer 30B | none fits (Ornith 69 GB) |
| Pictures | waits | ERNIE | Z-Image Turbo | Qwen-Image 20B, not installed |
| Videos | waits | **Wan 2.2 does not fit (25 GB over a 24 GB cap)** | **no candidate** (LTX-2.5 has `tiers: []`) | **LTX-2.5 Max installed, "can never fit"** |
| Music | waits | ACE-Step 1.5 | none in the catalog (XL Turbo listed as a part only) | none in the catalog (XL SFT reached through `/stack/v1/music` instead) |
| Voice | Pocket TTS (Nano has no pin) | Chatterbox Turbo | same as Standard | same as Standard |

Why the room is 41 GB and not the designed 72 to 95 GB: `tierRoomBytes()` (Stack `governor.ts:383`) is the effective cap
less every `reserved` item. The resident chat model, judge, embed and voice are reserved, and the Max room never adds
back what Reduced would free. The design says a Max job gets about 72 GB with chat resident and about 95 GB with chat
on Reduced. The candidates route (`routes/tiers.ts:30`) uses the same room, so the slot dialog and the capability table
inherit the error.

## 3. One implementation per shared feature: not yet

Upscale, background removal, erase, depth and restore run on one Stack engine (`image_tools_worker.py:429`, Real-ESRGAN
x4v3 and friends). Home reaches it by three paths that do not share code, status checks or error text:

| Path | Who calls it | Queued | Error when the part is missing |
|---|---|---|---|
| `imageEdit.ts:563` `startEdit` | Picture editor, chat "make clearer", `routes/imageEdit.ts` | no (shows the Stack's own queue position) | 503 with a reason from `editToolsStatus` |
| `imaging/tools.ts:33` `runImageTool` | companion uploads (`routes/companions.ts:905`), `pictures/people.ts` | no | throws "The upscaler isn't installed…" |
| video `media.edit` op upscale (`videos/editTool.ts:570`) | Video app, clip edits | yes (video job) | video job error |

Plus two local non-AI resizers used silently when the engine is absent (`imageEdit.ts:530` Quick clearer with sharp,
`companionLook.ts:301` `localUpscale`). Background removal has the same three paths. There is no "camera still enhance"
feature in the code: `liveView.ts` relays frames and calls no AI.

Everything that bypasses the queue, by file: `companionLookJobs.ts:137,179,334`, `companionTakes.ts:211`,
`companionPackMaker.ts:113,131,151`, `companionTalkMaker.ts:93`, `companionStates.ts:131`, `castLook.ts:59`,
`films/engines.ts:139`, `films/sheetViews.ts:33`, `imaging/headSwap.ts:33`, `imageEdit.ts:605,610,853`,
`imaging/tools.ts:20`, `pictures/people.ts:27`, `pictures/likeness/stackSegment.ts:11`, `pictures/likeness/edit.ts:72`,
`canary/probes.ts:112`, `talent/studio.ts:68,160`, `voiceSamples.ts:23,36`, `recordedSpeech.ts:37`,
`music/libraryAlign.ts:81`, `music/timedWords.ts:50`, `changeVoice.ts:50`. Chat, TTS, STT, embeddings and the robot's
Look are real-time and stay outside the queue by design; they still need the Stack's priority, which is a separate item
(RELIABILITY-PREVENT-07, open).

## 4. Fix plan

Ordered by what unblocks the rest. Each row is one Codex-sized brief (decided, verifiable). Routing: Claude cloud
or Codex first, the local lane for the small ones, per the 2026-11-15 rule.

### A. Make the numbers true (Stack first)

1. **TIER-ROOM-01 (Stack, M):** the level room counts what Reduced frees. `tierRoomBytes()` gets a `withReduced` mode
   used for the Max cap and for `fits_ever`; the candidates route and `/stack/v1/hardware/budget` return both. Test:
   on p128 with the standard chat set resident, the Max cap is at least 72 GB and LTX-2.5 Max (62 GB) fits Max.
   Fixes the "can never fit" refusal and the capability table.
2. **TIER-BUDGET-01 (Stack, S):** `budgetSlots` is computed from the tier room, not from memory free right now.
   Test: the budget lists every category's Standard peak with chat resident.
3. **TIER-CATALOG-01 (Stack, S):** fill the empty cells the owner already ruled on: LTX-2.5 distilled as video Boost
   (VIDEO-TIERS-01), ACE-Step XL Turbo as music Boost and XL SFT as music Max (MUSIC-MAX-01 moves into the catalog),
   Chatterbox Nano gets a pin so Reduced voice is installable. Video Standard: either vet a model under 24 GB or raise
   the Standard cap on p128 to the measured Wan peak (owner ruling; see section 6).

### B. Every job carries its level (Home)

4. **TIER-PIC-01 (M):** pictures read `slotRun` at send time like video and music: the slot's model and options
   travel in `GenerationBody.tier` and `model`; a Max picture runs Qwen-Image when the slot is installed, else is
   lowered to Boost with the existing line. Provenance records the level it really ran at. Tests beside `tiers.test.ts`.
5. **TIER-REDUCED-01 (S):** Reduced is asked for only on a real shortfall. Home drops the `chat: reduced` cell from the
   default `video.max` row and lets the Stack's live `needsReduced` drive `reducedChat.ts`; the Stack's own swap waits
   the quiet window. The `engines.chat.tier.reduced` switch becomes real: `off` means the Stack is told never to swap
   and a Max job that needs it is not offered (design rule 2a.2).
6. **TIER-BOOST-HOLD-01 (S):** a Boost job with no peak known runs at Standard's cap instead of waiting forever; a held
   job is re-checked at most for `quiet_max_wait` and then runs or fails with a reason. Regression test for the
   `needGb` Infinity case.
7. **LEASE-T6-01 (Stack, S):** the Max chat lease holds Boost and Max generators only; Standard jobs that fit keep running.
   `chatLeaseRuntime.ts` stops reusing coding mode.

### C. One implementation, one call, through the queue (Home)

8. **TOOLS-ONE-01 (M):** one `imageTools` module: `startEdit`, `runImageTool` and `runPictureTool` collapse into one
   function with one status check (`editToolsStatus`), one error text per missing part, one poll loop. Callers:
   Picture editor, chat, companions, people finder, film sheets, video upscale (frame by frame stays on the Stack).
   The two local resizers stay only as the explicit "Quick" clearer, never as a silent fallback.
9. **QUEUE-ALL-01 (L, in slices):** a `background` and a `tool` class in the household queue, so companion art and
   clips, film stills, cast looks, head swap, likeness masks, voice-sample clean-up and picture tools are admitted by
   the same scoring and holds as pictures, video and music. Real-time work (chat, TTS, STT, embeddings, Look) stays
   out and keeps the Stack's priority ladder (RELIABILITY-PREVENT-07). Slices: tools first (8), then companions, then
   films and voice samples.
10. **TIER-CAT-01 (S):** every queued kind maps to a level category, so "off" and "who" apply uniformly: picture
    tools and stems under their parent category, companions under pictures or videos. Stems joins `TierCategory`.

**Briefs written (2026-11-15), ready for `wt.sh run codex`:** Stack `data-scratch/briefs/tier-room-01.md`, `tier-budget-01.md`,
`queue-fit-01-stack.md` (fit-based admission plus the lease T6 fix); Home `data-scratch/briefs/tier-pic-01.md`, `tier-reduced-01.md`,
`tier-boost-hold-01.md`, `queue-fit-01-home.md`. Order: the three Stack briefs first (room, budget, fit), then the Home four; the two
QUEUE-FIT halves land together. Owner's sequence (Jesse, 2026-11-15 evening): the briefs are not dispatched yet. First the MiniMax picture
and video evaluation (MODEL-VET-MINIMAX-01), with a different coding model chosen for the fixes before any brief runs; the local lane is not
that model.

### D. Bookkeeping and docs

11. Music provenance tier (`music/jobs.ts:309`), job `window` and `tier_reason`, profile pins and save-time validation,
    delete the dead code listed in section 2, fix the `chatModelSwitch.ts:162` prefix, update `docs/dev/resource-tiers.md`
    and `docs/reports/tier-backlog-audit-2026-10-31.md` (the quiet window is wired; the mirror of legacy picture keys is one-time).
12. The Engines health probe: either clear a stale "needs attention" on the next successful job of that role, or show
    "last check failed, last job succeeded" so the two cannot contradict each other.

## 5. The page: what is wrong and the redesign

### What is wrong today (verified on the workbench)

- **Three ways to change a model, two ways to save.** Row switch, gear model picker and the per-level dialog all
  write model settings; rows and the picker stage until Apply, the level dialog saves at once (`AiGlance.tsx:95-103`).
- **The same key drawn twice.** "Detailed pictures" row and the Pictures Boost level both write
  `engines.image.tier.boost`; turning the row off wipes the slot's model (`aiTierSlots.ts:53-55`).
- **Dialogs three deep.** Gear, then "Levels and models", then "Edit" opens the model picker. For voice the middle
  dialog has one row, a dead hop.
- **Levels are invisible until you dig.** Nothing on the page says "Videos Max has no model". The grid in section 2 is
  not shown anywhere; the Performance tab's capability table shows fits but not assignments; the Engines tab shows roles
  but not levels.
- **Problems are in four places and none on the Overview.** Engines Health (three warnings since Nov 6), the Roles
  table, the Advanced list ("Not installed"), and the Status page. The Overview counter and the profile menu say all is good.
- **Five roles exist only as raw selects** on Advanced (listening, embeddings, rerank, router, judge), although listening
  and embeddings gate which apps appear (`capabilities.ts:10-12`).
- **Two chat-model pickers** (Overview gear and Advanced `ModelsSection`), reading different endpoints.
- **Performance and AI and models split one topic** and use different cache keys, so one does not refresh when the
  other saves.

### What the research says

Few products assign models per feature and per level, so the patterns come from three places:

- **Per-feature defaults with explicit inheritance** (GitLab's AI model selection design, Raycast's per-command model
  with a "Default" option, TYPO3's feature-by-provider table with a precedence order): show the grid, show what is
  inherited, disable incompatible cells with the reason, never silently fall back after a person picked a stronger option.
- **Attention first, empty is good** (Home Assistant's integrations page "Needs attention", AdminBolt's health page,
  ServiceNow's per-page Needs attention panel): one list at the top of the page holding everything broken or missing,
  each with its one action; when it is empty the page says so.
- **Status as a consistent token** (Carbon's status indicator pattern, Dynatrace status and health): one dot vocabulary
  (ready, not installed, problem, off, not a level here) used identically in the grid, the sheet and the parts list;
  color plus a word, never color alone.

Sources: GitLab AI model selection design document (handbook.gitlab.com), Raycast manual "AI Commands" and changelog
v2.9 (manual.raycast.com, raycast.com), TYPO3 AI Foundation "AI Features" docs (docs.typo3.org), Home Assistant
developer docs "Handling setup failures" (developers.home-assistant.io), AdminBolt health page docs (docs.adminbolt.com),
Dynatrace design "Status and health" (developer.dynatrace.com), Carbon Design System "Status indicator pattern"
(carbondesignsystem.com), AI UX Playground "Model selection UI" (aiuxplayground.com).

### The redesign (mockup boards 1 to 5, revised the same day after Jesse's rulings)

1. **One card per feature.** Chat, Pictures, Videos, Music and Voice each get a card with its four levels as chips in a
   row (Reduced, Standard, Boost, Max): model name, one dot, one word (Ready, Missing with size, Problem, Off, "Waits
   for the Max job", "Same as Standard"). The card header names where the feature is used (chat, the Video app, the
   Film maker, companions), which is how the "one implementation" rule becomes visible, and counts ready levels.
   Helpers (picture tools, make clearer Best, listening, describing pictures, stems, sound effects, coding helper,
   search and memory, video from pictures, wake word, telling people apart) follow as one compact list: dot, name,
   model, used by, on or off or Download.
2. **Needs attention at the top, empty when all is well.** Each item is one short sentence, the consequence in plain
   words, and one button (Download 99 MB, Fix, Check again). No model ids or technical causes on the page; those live
   in the sheet. It merges what today sits in the Overview banner, the Engines Health table, the Roles table and the
   Advanced list. One "Download all that is missing" button.
3. **One sheet per feature, no second or third dialog.** Open a card: the sheet lists the levels top to bottom, each
   with its model select (candidates that fit, with the plain refusal on the ones that do not), state, who can use it,
   options, and the consequence when it is off. The adult gate for that feature sits at the bottom. One Save.
4. **Five tabs, each a different question (Jesse's pick).** Features (the cards and the attention strip), Models (what
   is on the disk, grouped by the feature that uses it, with filter chips: problems, missing, unused 30 days, licence to
   accept; replaces the flat Advanced list and the second chat picker), Engines (programs only, never models: llama.cpp,
   MLX, ComfyUI, the music and voice engines, the picture tools service, the Python environment, the Mac app helper, each
   with version, state, one action, and the engine checks under them), Performance (unchanged content), Coding (unchanged).
   Jesse's note: the Engines tab today "has things where models should be"; the roles table and model names leave it.
5. **Calm colour.** One dot and one word per state; no red or amber borders on cards or chips; the attention strip is the
   only place with a red word. A "right now" line under the title shows engine state, what is waiting, memory and
   models space; the Max-window line and Stop button appear there while a Max job runs.
6. **Phone width:** the same cards with two chips per row; the attention strip stays on top.

Kit rule 9 holds: rows are the kit Item, chips are Badge, the sheet is the kit Sheet, the select is the kit Select;
the status dot is a token color on a Badge, never a Home wrapper. Copy keys go spec-first.

Build order after approval: the data first (one `GET /api/ai/overview` that returns the grid, the attention list and
the right-now line from `/api/ai/choices`, `/api/ai/tiers/*`, `/api/engines/health`, `/api/performance/capabilities`
and the queue), then the grid and sheet, then Parts, then the tab moves. The backend fixes in section 4 A and B
should land first or the grid will show the same wrong cells with better typography.

## 6. Owner rulings (Jesse, 2026-11-15, same day)

1. **Video Standard:** neither option. Vet new picture and video models first; Jesse named the newer MiniMax picture and video
   models as the candidates ("should work well"). New row **MODEL-VET-MINIMAX-01** (Stack bench): confirm the weights can run on
   this computer (Home runs only what is local), then measure peak, time and quality on the 22 bakeoff prompts and the video
   scenarios, and place the winners in the level grid under the measured caps. The licence is not a gate: the person accepts it in
   Settings before the download, as for every other model (Jesse, 2026-11-15). The Standard cap stays 24 GB until a
   model that fits is vetted; TIER-ROOM-01 still goes first so the Max and Boost cells read true.
2. **Everything queues, but never serial.** One queue for every generating job, and admission is by fit, not by order: if job 1 is
   running and job 2 fits beside it, job 2 runs now; if job 3 does not fit, it waits; and a quick job that fits beside 1 and 2 never
   sits behind 3. This replaces the Stack's one-generator-at-a-time rule (`governor.ts:602`) and QUEUE-ALL-01 is rewritten as
   **QUEUE-FIT-01**: the Stack admits any job whose measured peak fits the live room beside what is running; Home orders by score but
   admits the first job that fits (backfill), with aging so the big job still gets its window (drain, then hold, as T2 and T3 already
   say). Standard beside Standard, and Standard beside a Boost that leaves room, both run together. Max keeps the machine.
3. **The page design, revised:** one card per feature (not a table), tabs Features · Models · Engines · Performance · Coding,
   Engines lists programs only (ComfyUI, llama.cpp, MLX and the services), look and words at my judgment (calm colour, one dot and
   one word per state, plain attention wording). The canvas now shows this. Briefs may be written from section 5 as revised.

Everything else in sections 4 and 5 is a build decision and needs no ruling.
