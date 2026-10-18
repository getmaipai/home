# Backlog

What is missing to go from "the hub can chat" to a usable family app, per area, in the order the
platform is built: the hub first, the robot for parity, Go last. A scannable list, not a narrative: reasoning and
decision history live in `docs/dev.md` and the records under `docs/plans/` and `docs/design/`.

- Check an item off only when it is shipped and verified (the org definition of done), not when it is started.
- A new gap found while working on something else is added here, never only mentioned in `docs/dev.md`.
- Size tags are a rough gut check: **S** (a session or less), **M** (a real slice, days), **L** (a platform-level
  capability, needs its own design pass first).
- An open row that has a design record carries a `Design:` line pointing at it; a row marked L with no `Design:`
  line is not pickup-ready until the record exists.
- Rows that are done and verified, obsolete, duplicated or in conflict with `docs/design/RULES.md` move to
  `docs/BACKLOG-HISTORY.md` with the reason; nothing is deleted. The last sweep was 2026-10-17.

## Setup and the first run

- [x] **CANARY-01: behavioural canaries, one shared schedule and prewarm** (L, built 2026-10-17; first live run on the Studio: embed, voice loopback, chat hello and picture read passed, the search check failed as expected; open: `video_tiny`, a Stack route for `requestEngineRestart` so a dead chat can be restarted once, and tuning intervals from a week of recorded first-token times). Jesse, 2026-10-17: "why can I find quickly that something is broken and you don't know?" A built-in non-person health identity runs the real chat pipeline in temporary mode and asserts behaviour (hello, weather tool call, search tool call, picture read, embed, TTS/STT loopback, spoken turn, tiny picture on demand); 2 failures in a row raise one Repairs item per check; Status row "Last checked"; Run checks now; Keep the AI warm switch.
    Design: [reliability-2026-10-17](design/reliability-2026-10-17.md)
- [ ] **SELFHEAL-01: engine self-heal, circuit breaker, LaunchAgent and Home watcher** (L; Stack repo, owned by the self-heal session). Design: [reliability-2026-10-17](design/reliability-2026-10-17.md)
- [x] **INSTALL-DISK-01: the installer and the wizard size the disk from one table and show every install with its size** (M, 2026-10-17; verified on a scratch Home against a Stack with a 78 GB data disk, 1440 and 390 wide). Owner: "make sure the install wizard shows the rough estimate of all our installs so far and properly conveys the needed disk space and properly checks". The Stack's install plan carries `disk` (per component and tier: download, installed and peak temporary bytes from the pins and a measured table; `docs/disk-plan.json`); Home copies it to `shared/diskPlan.json`. The installer refuses with "needs about N GB free for the recommended setup; it has M GB" (flags `--plan moderate|minimal`), judges each disk that holds Home, its data folder or the AI, warns on low headroom. The plan step lists each install with its size and a checkbox for the skippable ones, totals the choice, shows the free space and a green, amber or red check, and installs only what is left on (`components` on the install routes, saved beside the setup record). The storage step and the checks screen use the same numbers (the checks block only when the smallest setup does not fit). Not yet: the pictures and video rows install through pulls plus the engine's own first-run build, exercised with scripted downloads only, not a real 40 GB download; Windows `install.ps1` still relies on the TypeScript preflight only. Follow-up: SETUP-PLAN-CUSTOMIZE-01 (choosing models) stays open.
- [ ] **SETUP-PLAN-CUSTOMIZE-01: the setup plan step cannot be customized** (M; needs a design pass before build: architect gate, `docs/design/RULES.md`). Jesse, live test on the Mac Studio, 2026-10-17: "your setup plan doesn't allow configuration / customization". Today `PlanStep` offers only the presets recommended, moderate and minimal. Objective: let the person adjust what gets installed (add or remove individual parts, pick models) instead of only choosing a preset. Record only; not started.
    Design: [setup-voice-search-2026-10-17](plans/setup-voice-search-2026-10-17.md)
- [ ] **DOCS-SHOTS-01: regenerate the documentation screenshots that the 2026-10-17 changes made wrong** (M). `bun run screenshots` needs Playwright's Chromium, which is not installed on the Mac Studio (and there is no `node`), so the 2026-10-17 docs pass could not retake any picture. These images show the old UI and are stale: `home-*` (the Home page was rebuilt: ask box, Today, Getting started; the old stat cards are gone, so `docs/user/home.md` carries no picture until this lands), `setup-*`, `docs-setup-wizard` and the site `Shot` ids `setup-wizard` and `home` (the wizard lost Face, Hello and Away, gained Tune, Checks, Web search and the install line), `docs-sign-in-picker`, `docs-sign-in-pin`, `docs-sign-in-wrong-pin` and the `Shot` ids `sign-in-picker`, `sign-in-pin`, `sign-in-wrong-pin` (one box per digit, red shake), `chat-empty`, `docs-chat-empty`, `chat-empty-*` and `chat-*` (ten rotating empty-chat pictures, the collapsed Reasoning label, the Thinking badge, the + menu), `chat-thinking-mode-*`, `voice-browser-*` and `settings-voices-*` (one Voice for you list with Test), `docs-settings-search` and `settings-search` (the Web search block). New pictures wanted: the Weather app (clear day, rain night, offline, settings gear page; first captures are in the session scratchpad `weatherapp-shots` and were judged 2026-10-17), the Home page at 1440 and 390, the microphone help box, the web search setup screen. Acceptance: run the documented script against the seeded demo household, open and judge each picture, update `docs/site-fumadocs/screenshots.json` and the user pages in the same commit. Exit: `bash scripts/check.sh --docs`.
- [ ] **DOCS-PASS2-01: document the rest of 2026-10-17 once it lands** (S). Image generation, video generation, image tools and the canvas editor, the chat engine comparison and cutover, v0.2.6 and v0.2.7 changelog entries, and the final Stack pin. Pass 1 (installer, wizard, sign-in, voice, search, chat, weather, Home page, app kind, homelab Studio page) is done.
- [ ] **SETUP-SEARCH-03: the plan installs Home's own SearXNG once the Stack reports it** (S, after STACK-SEARCH-01 in the Stack repo and SEARXNG-SET-02). Add the search service to the downloads every plan starts after Checks, show its progress in Your plan, and make row 12 read the Stack's search state. Files: `backend/src/setup/checks/setupDownloads.ts`, `backend/src/setup/checks/checks.ts` (wire the existing `stackSearchState` dep to the Stack's real search state), `frontend/src/apps/setup/PlanStep.tsx`. Makes SETUP-SEARCH-02 disappear for most households. Exit: `bash scripts/check.sh --pre`.
    Design: [setup-voice-search-2026-10-17](plans/setup-voice-search-2026-10-17.md)
- [ ] **DATA-WEATHER-CATALOG-01:** Port Home's weather package updates (0.1.1, model-selected routing, household home-place warming and privacy copy, and current/hourly/7-day forecast blocks) to `getmaipai/catalog/plugins/utilities/weather`, verify the package there, then refresh Home's bundled copy from catalog.

## Tests and gates

- [ ] **TEST-ENV-01: the full gate and a few tests need Playwright's Chromium, which the Mac Studio lacks** (S). `check.sh` stops at `frontend: a11y` and one frontend test errors with "Executable doesn't exist" (`~/Library/Caches/ms-playwright/chromium_headless_shell-1243`). Baseline 2026-10-17: the same on v0.2.5. Fix: `bunx playwright install chromium` on the gate machine, or have the gate say so in plain words and skip.
- [ ] **TEST-LOAD-01: eight frontend tests pass alone and fail inside the full run on a loaded machine** (S). UsersPage (non-admin denial), ChatPage.calmErrors (Send waits for the engine, 17 s), UsersSection.companions (2), VoiceBrowserSection (service down), chatChildLinks (touch citation, 14 s) and the setup preview bundle test (120 s vite build). Cause not proven: load average 8 to 15 from other sessions. Check: rerun the full suite with nothing else running; raise or remove the per-test timeouts that are hit.
- [ ] **TEST-DENO-01: with Deno on PATH, `runAllSmokeTests` reports 12 failed bundled packages** (S). Without Deno they are skipped, so the test passes only on a machine with no Deno. Likely cause: the offline Deno cache is not primed in a worktree (`prime_deno_cache` in `install.sh`). Check: run `deno test --cached-only` in one failing package and read the message.
- [ ] **TEST-POLLUTION-01: Bun runs every test file in one process, so a global left behind fails unrelated files** (S). The chatArt test left a throwing `localStorage` and failed about 100 later frontend tests (fixed 2026-10-17, 0f498dc4). Add a lint or a shared reset that fails a file that leaves `globalThis.localStorage` changed.

## Engines: another computer at home

- [ ] **SETUP-SEARCH-REMOTE-PROBE-01: Stack-side search probe for a remote engine** (S, after STACK-SEARCH-01). The hub cannot reach the remote engine computer's loopback. Add a Stack-side probe through the Stack's supported interface; do not scan the network. Reuse the one SearXNG checker semantics without adding a second Home checker.
    Design: [install-wizard-2026-10-13](plans/install-wizard-2026-10-13.md)
- [ ] **SETUP-CHECKS-01 follow-ups:** persist the first-run storage choice as the Stack's model destination; expose a Stack-side NVIDIA sysmem-fallback read and engine clock measurement; add a remote Stack model-host reach probe listed in `/stack/v1/privacy`; add the missing main-board seeded-household visual capture path. **INSTALL-DL-BENCH-01:** measure download speed on initial bytes before showing a slow-link warning. Checks screen implementation is in progress on `lane/checks-SETUP-CHECKS-01`.
    Design: [install-wizard-2026-10-13](plans/install-wizard-2026-10-13.md)
- [ ] **REMOTE-STACK-LOG-01: typed link events, nothing else** (S, Sonnet; P2; after LOG-PRIV-01's event registry lands). Objective: `stack_link.state_changed` {from, to, code, attempt, rtt_ms}, `stack_link.probe_slow` {rtt_ms}, `stack_link.paired`, `stack_link.unpaired`; `ssh` stderr mapped to codes and never logged. Files: `link.ts`, the log event registry. Mirror: the first registry events. Reuse check: the registry. Acceptance: a test drives an ssh failure whose stderr carries `192.0.2.10` and asserts no log line contains it. Exit: `bash scripts/check.sh`.
- [ ] **REMOTE-STACK-LIVE-01: live pairing walkthrough** (S): complete the first live pairing walkthrough with the owner on the real engine computer and record it in `docs/dev.md`, with no hostnames.

## Hardware tiers (2026-09-23)

The hub installs on what a family has; the Studio is the p128 profile with 128 GB memory and a 2 TB internal disk, the top of the range, not the baseline. The design is [docs/plans/hardware-tiers-2026-09-23.md](plans/hardware-tiers-2026-09-23.md): four reference points (the floor, a 24 GB Apple silicon laptop and a p128 Studio with 128 GB memory and 2 TB internal disk, a 16 GB CUDA laptop, a 128 GB Studio and up), one pipeline, only the budget record and the deployment limits varying, and a configuration that is proposed by the Stack's probe and stepped down by the person, never fixed. The order among voice, photos and pictures is the owner's. The Stack's own rows (STACK-SIZE-01, STACK-FLOOR-01) are in `stack/docs/BACKLOG.md`.

Open decision, not decided here: the three designs disagree on the floor judge. `docs/plans/hardware-tiers-2026-09-23.md:22` says a rules-plus-template pass with no 4B at the floor; `docs/plans/hub-on-apple-silicon-2026-09-17.md:130-141` (with ENGINE-HOST-05 in this file) says try a dedicated 8B to 14B judge first and keep Qwen3-4B as the floor fallback; MEM-05 (resolved 2026-09-13, this file) made the 4B the household default background model. It is recorded as open in the Fable pass of 2026-10-05; the owner decides, and STACK-FLOOR-01 waits on it.

- [ ] **INSTANT-03: bench Qwen3 4B as the Instant chat model before it may use tools** (M, bench) - Objective: a catalog record (`thinking_mode: "none"`, own sampling with source) and, per RULES.md rules 3 and 8, tool-decision (evidence recall, false searches, 3 or more repeats on the CHAT-AB-01 fresh set), reply-quality and repetition rows. Until it passes, Instant turns offer no tools. Blocked on: INSTANT-02.
    Design: [instant-mode-2026-10-17](design/instant-mode-2026-10-17.md)
- [ ] **INSTANT-04: the adult Instant toggle on an `always` model** (S, after INSTANT-02 and 03) - Objective: an adult's written chat gets an explicit Instant / Thinking choice that routes the turn to the fast model or to Muse; label says Instant is for quick chat and short answers; falls back to Muse when history exceeds the judge's window or a search is explicitly requested. Never shown to a child or teen. Tests: routing, minor gate, fallback.
    Design: [instant-mode-2026-10-17](design/instant-mode-2026-10-17.md)
- [ ] **VOICE-LIVE-05: the voice mode looks like ChatGPT's, with a little flair** (S, Sonnet; owner's ask 2026-09-23, after VOICE-LIVE-02) - **landed 2026-09-23 (`0241b703`), Jesse's own judgment of the recording still owed.** Objective: the live voice session's centerpiece is an orb the size ChatGPT's is, breathing with the local level from VOICE-LIVE-02: the shipped Element's rings as they ship, restyled only through the tokens they read (a gradient and a soft glow per mode: listening, thinking, speaking, with the speaking color a token rather than the Element's hard-coded blue if that line is ours to override through a token, otherwise noted as an upstream ask), and one flair touch that costs nothing in latency (a slow hue drift while thinking, a ripple on the first spoken word), judged from a short recording, not a still. No hand-built orb: if the Element's rings cannot reach the look, the gap is named in the design record first and a maintained orb (a canvas library through the package manager, MIT, local only) is the next candidate, decided before a line is written. Acceptance: a recording of listen, think and speak on this Mac opened and judged by Jesse, plus the four captures; the level animation costs under 2 ms a frame (measured). Exit: `bash scripts/check.sh`, the recording and the captures. **Landed:** the speaking color was ours to override - `bg-blue-500`/`dark:bg-blue-400` were literal utilities reading no token at all (commons owns this Element, no upstream assistant-ui import in it), fixed at the source to `bg-primary` (one token, not two hard-coded shades - see dev.md). Both flair touches are CSS-only (`@keyframes`, no rAF loop). The gear into Settings > Voice rides along, the same file. Per-frame cost measured twice (two independent runs), both showing added cost within measurement noise of zero (well under 2ms) - method and numbers in dev.md. **Round 2 (2026-09-23, Jesse's own live read of round 1):** too small and, in light theme, near-black (the cascade bug TOKENS-PRIMARY-01 now tracks generally; fixed here with a dedicated `--voice-accent` token) - the orb is ChatGPT's own scale now (160px mobile, 192px desktop); "the phone call look instead of the visualizer" - no transcript list or "you"/"ai" labels (removed outright, not hidden), the orb centered above the controls, mute/end pinned to the bottom as the kit's own `TooltipIconButton`, the surface growing to fill the phone's own screen below `sm` (a real call screen, not a floating card there); the composer's own waveform pill resized to match Dictate/Send exactly (`size-7`, not the 48px floor). Commons `a790400`, home `e25a836a`. The round-2 recording and four captures are versioned `-v2` in the same Desktop folder as round 1, sent to Jesse directly; this row still ticks once he's opened and judged one of the two rounds.
- [ ] **VISION-03c: turn it on and prove it on the Studio** (S, bench). Pull `muse-glimmer-30b-mmproj-q4-k-m` (1.4 GB, the Stack's pull by id), restart chat, confirm the chat role row reports `imageInput: true` and `picture_tokens_max` 2560 and the + menu lets a picture through; run `backend/scripts/bench/vision-02e.ts` against Muse (ten photos, no identity claim, section 18 rows, 0 outbound requests, a child's picture turn with photos on) and record the table plus a text-only versus picture-turn speed pair in `dev.md`. Needs the real-portrait row the 2026-10-17 measurement could not run.
    Design: [vision-images-2026-10-17](design/vision-images-2026-10-17.md)
- [ ] **VISION-03d: the setup wizard says the machine reads pictures** (S; behind SETUP-SIZE-01). One line of copy on the sizing page for tiers whose bound chat model declares a projector, and the projector's 1.4 GB in the size total, taken from the Stack install plan, never hand-written.
    Design: [vision-images-2026-10-17](design/vision-images-2026-10-17.md)
- [ ] **VISION-03e: Muse bench rows for a picture turn** (S, behind STUDIO-EVAL-01). Tool-calling and rewrite rows with a picture in the turn, so the conditional tool set (rule 1) has its bench row for the Muse record before the budget is trusted.
    Design: [vision-images-2026-10-17](design/vision-images-2026-10-17.md)
- [ ] **VISION-02: Qwen3-VL-8B-Instruct as the one chat model, so chat reads pictures itself** (L, Opus; owner's decision 2026-10-06, option 1 of `data-scratch/chat-ab/opus-vision-report.md`; verdicts `data-scratch/architect/VISION-02*.verdict`). Supersedes VISION-01's Home slices: **VISION-01c (describe-then-answer) is retired in writing by VISION-02** (approved, never built, nothing to port); the describe half of VISION-01d has nothing to screen; VISION-01e and 01f fold into 02c and 02e. Slices: 02a spec `thinking_mode` (commons spec-v0.1.84, landed); 02b the Stack's VL-8B pins, projector launch keeping chat's slots, sizing fixes (stack 8931234, landed; p16 not flipped); 02c picture parts to chat (OpenAI `image_url` parts with the stored picture as a data URL, local engine only, from the Stack's chat row `imageInput` and `picture_tokens_max`; the stable prefix gains "You cannot tell who a person in a photo is."; rule 6 retry without the picture; landed); 02d the floor (a minor's picture answer through the output gate at their grain, photos only per `chat.photo_uploads`, thinking off, never the memory judge), the VL-8B catalog record with `thinking_mode: none`, the composer's Instant/Thinking control from the record (landed); 02e the record's measured `turn_budget` (tool bench, 50 repeats: 0 false calls in 300, websearch 50 of 50) and `backend/scripts/bench/vision-02e.ts` (ten photos 10 of 10, no identity claim, section 18 rows, 0 outbound requests), CHAT-AB-01 rerun and the live flip open. Exit per slice: `bash scripts/check.sh`.
    Design: [vision-images-2026-10-17](design/vision-images-2026-10-17.md)
- [ ] **IMAGE-01: picture creation on a free card through the Stack's image role** (M, Sonnet; the plan's section 3). Objective: the `image` role served where a card is free: on tier 1 today the model host's RTX 3070 as a URL-tier engine (ComfyUI with FLUX.2 Klein 4B, Apache-2.0, pinned by revision and hash, as a systemd service on the laptop, the coding model unloaded while a picture draws), the Stack's job API unchanged (`/v1/images/generations`, queue, cancel, 202 past the deadline), MPS on the Mac as the fallback with the chat engine paused. Files: `stack/backend/src/lib/` (the URL-tier engine address for the image role), `modelCatalog.ts` (`flux2-klein-4b` exists), the laptop's service unit (the private homelab repo records the host). Mirror: the chat and embed roles' URL tier; STACK-13a's queue and STACK-13b's ComfyUI engine. Acceptance: one picture rendered through the job API with time and footprint recorded; the health check reports the remote engine like any engine; nothing leaves the house (the endpoint list in PRIVACY.md unchanged). Out of scope: the chat side (IMAGE-02), video and music. Exit: `bash scripts/check.sh` in both repos and the line in dev.md. **Reviewed 2026-09-26: Qwen-Image-2.1 cannot be the pin (Qwen Research License, "research or evaluation purposes only", commercial use by separate licence; 33 GB at bf16 with an 8B-class text encoder), so FLUX.2 Klein 4B and Qwen-Image-Edit-2511 (both Apache-2.0) stay the picks; by the owner's ruling it is measured anyway as IMAGE-BENCH-01's evaluation-only yardstick row; `docs/plans/model-review-qwen-image-2.1-and-clm-2026-09-26.md`.**
    Design: [image-generation-2026-10-17](design/image-generation-2026-10-17.md)
- [ ] **IMAGE-BENCH-01: the image bakeoff, with Qwen-Image-2.1 as the evaluation-only yardstick** (M, bench, Sonnet; owner's ask 2026-09-26, `docs/plans/model-review-qwen-image-2.1-and-clm-2026-09-26.md` "The bakeoff row, as designed"). Objective: turn the sizing bar's three picture rows (`docs/plans/hub-on-apple-silicon-2026-09-17.md`, every cell still `(?)`) into measured numbers, and choose the shipping picks knowing what they give up. Rows: SD 1.5 (STACK-13b's proven pin, the floor), FLUX.2 Klein 4B at its shipped steps, Qwen-Image-Edit-2511 on the edit prompts, and Qwen-Image-2.1 at 25 and 40 steps plus its viggle-turbo adapter at 6 steps; each row on the model host's RTX 3070 through ComfyUI (the Comfy-Org int8 files, or the `unsloth/Qwen-Image-2.1-GGUF` Q4_K_M with the encoder in system memory, pinned by revision and sha256, leejet's GGUF as the cross-check) and on the Studio through `mlx-serve` and `stable-diffusion.cpp` where each supports the row (no edit, LoRA or RGBA on mlx-serve's backend as merged; the M4 Pro row is expected to be a governor refusal and is recorded as one line). One fixed prompt set from the roster's demo household, never the family: a portrait, a typographic sign, a product on white, a two-reference composition, a masked local edit, an RGBA sticker; one rubric across rows. STACK-14's protocol: engine build, model file and revision, a sanitized hardware line, time and peak footprint per row, in a table in dev.md. Files: `stack/scripts/bench/` (mirror STACK-14's shape and `stack/scripts/prove-image.sh`), `docs/dev.md`, the sizing bar's rows replaced by the measured values. Acceptance: the table, with the 2.1 rows marked evaluation-only and its weights removed from both machines when the bench ends (no cached file a later session could mistake for a pin); the sizing bar's `(?)` cells for pictures replaced; a one-line pick per row for IMAGE-01. Out of scope: LoRA training, the prompt-rewriting models, any "uncensored" or "heretic" derivative (SAFETY.md, never in the bakeoff), a ship decision on 2.1 (the licence made it), the Nunchaku NVFP4 file (needs Blackwell, Ada or Hopper; the 3070 is Ampere). Exit: `bash scripts/check.sh --docs` and the table in dev.md.
    Design: [model-review-qwen-image-2.1-and-clm-2026-09-26](plans/model-review-qwen-image-2.1-and-clm-2026-09-26.md)
- [ ] **IMAGE-02: "draw me a ..." in chat, the first slice of CHAT-MEDIA-01** (S, Sonnet). Objective: a picture request runs as a job through the executor (a side effect: consent per person, progress in the thread, the picture in the thread through the shipped image Element). Files: `backend/src/lib/turnMachine/nodes/policy.ts` and `tool.ts`, the kit's image Element. Mirror: the tool events (TOOL-EVENTS-01). Acceptance: SAFETY.md's generation invariants asserted in tests: a child profile cannot invoke it until an adult unlocks it per person; the adult unlock is the one-time acknowledgment; every picture passes image safety before display or persistence; no people path. Out of scope: undo, variations, edits. Exit: `bash scripts/check.sh`.
    Design: [image-generation-2026-10-17](design/image-generation-2026-10-17.md)
- [ ] **SETUP-SIZE-01: the wizard's sizing page, the proposal with its impact and the step-down** (M, Sonnet; the plan's "proposed, never fixed"). Objective: the first-run wizard's hardware step (the existing "first-run wizard, end to end" row) and the same page under Settings show the Stack's proposal per role with the impact in a parent's words (memory kept back, expected speed, what a smaller choice loses) and let the person move budget between roles in both directions: any role to a smaller pinned candidate, on demand, or off, including the floor ("the robot's brain on your computer"), and the freed memory to another role (a larger chat model than the tier's default, vision resident), with the trade said in a parent's words ("turn off pictures and chat can use the bigger model, which answers better") and a set that does not fit refused with the roles to turn down named; video generation listed as a role, off on every tier today. The per-role Setting record is the one store of the allocation. Files: the settings registry (`engines.<role>.choice`, spec first), the wizard and settings routes, the page from the template's form layout (no hand-built control). Mirror: SETTINGS.md's generic renderer; the Stack's hardware route for the proposal. Acceptance: stepping `chat` down on the dev Mac changes the Stack's resident set on the next start and the page says what changed; a child profile cannot reach the page. Out of scope: the Stack's side (STACK-SIZE-01). Exit: `bash scripts/check.sh` and the captures. It reuses HOME-FIT-03's panel and HOME-FIT-01's route (docs/plans/fit-verdict-ui-2026-09-30.md).
    Design: [install-wizard-2026-10-13](plans/install-wizard-2026-10-13.md)
- [ ] **HOME-FIT-02: the verdict on every model row, with the sizing strip** (M, Sonnet; screens 1 and 2 of the plan). Objective: the model picker and the Models page show a status pill and one short reason on every row, a search box that filters as you type, an "Only models that fit" switch, and the three sizing controls (memory of the conversation as a slider, Full/Quantized/Auto, the switch) that re-ask HOME-FIT-01 and update rows in place. Made only of shipped kit parts (`model-picker`, `model-selector`, `data-table`, `command-palette`, `range`, `context-display`, the status pill, `confidence-marker`), restyled by tokens alone; the pill-with-reason is the pill and the marker side by side. Acceptance: the flow driven headless against a seeded demo household with a stubbed Stack, screenshots (desktop and phone width) generated, opened and judged; unknown reads "can't tell yet", never red. Out of scope: the detail panel, compare. Exit: `bash scripts/check.sh` plus the screenshots. Amended 2026-10-01: 'Only models that fit' starts on; rows are ordered recommended first, then good fit, slow, not tested, too big; each pill carries the badge word from the plan's table. ELT-T1-10b's model-picker scope is folded here: use the shipped ModelPicker with the Stack verdict status pill and one reason line, and remove RoleCardShell, PlannedRoleCard, Disclosure, ChatModelCard and CheckModelCard; no separate item.
    Design: [fit-verdict-ui-2026-09-30](plans/fit-verdict-ui-2026-09-30.md)
- [ ] **HOME-FIT-05: retire Home's own sizer** (S, Sonnet; after HOME-FIT-02 and 03). Objective: delete `fitsWithin`, `recommend` and `kvCacheBytes` from `backend/src/lib/modelCatalog.ts` (they count a q8_0 KV element as 1 byte where ggml's layout gives 34/32, and are a second copy of what the Stack owns), and move every caller to HOME-FIT-01. Acceptance: no caller remains (a grep in the done report), the tests that asserted the old arithmetic are removed with the code, the suite is green. Exit: `bash scripts/check.sh`.
    Design: [fit-verdict-ui-2026-09-30](plans/fit-verdict-ui-2026-09-30.md)
- [ ] **FLOOR-ACCEPT-01: the floor run of the acceptance workload** (S, Sonnet). Objective: the tier workload's floor run: a voice conversation plus a typed one, no photo, no picture, measuring first useful answer, first spoken word, peak memory and cancellation, run on this Mac with the robot's model as a stand-in for an 8 GB machine, recorded honestly as a stand-in, and rerun on an 8 GB machine when one is on the bench to set the floor's limits. Files: the tier workload runner (STUDIO-ACCEPT-01's), dev.md. Mirror: STUDIO-ACCEPT-01. Acceptance: the numbers in dev.md marked stand-in, the floor's limits set only from a real 8 GB run. Out of scope: everything above the floor. Exit: the table in dev.md.
    Design: [hardware-tiers-2026-09-23](plans/hardware-tiers-2026-09-23.md)
- [ ] **ENGINE-SPLASH-01: measure Inco Splash as the tier 3 chat engine** (S, bench, Sonnet, 2026-09-23; from the owner's note). Objective: Splash (github.com/incoai/splash, Apache-2.0; Apple M3 or newer, macOS 26.4 or later, 36 GB of unified memory at least, so tier 3 only, never tier 1, tier 2 or the floor) serves exactly MEASURE-02's two Studio candidates (Qwen3.8-27B and Qwen3.6-35B-A3B, each packaged with a DFlash 2 draft model for speculative decoding and the vision encoder) and claims about twice oMLX's decode speed on the 27B (74 tok/s short, 54 at 32K on a 48 GB M5 Pro) and close to four times under four concurrent prompts, with OpenAI Chat and Responses and Anthropic Messages endpoints, streaming, tool calls, JSON Schema output, images and reasoning_effort levels. The owner's saved transcript of a hands-on Splash review is at `data-scratch/splash/transcript-qwen38-27b-2x-faster-on-mac.txt` (git-ignored, on the dev Mac), and the session that runs this row reads it first for the claims to test. **What the review adds to this row (claims, not our record):** the baseline is llama-server at the pin with Qwen3.8-27B's own multi-token-prediction head on at draft depth two and three, never plain autoregressive decoding, because the reviewer shows Splash's 2x is its DFlash 2 draft against oMLX without one; measure cold and warm at 32K and the effective rate from send to last token (the review cites 96 s cold and 282 ms warm to first token on a 48 GB M5 Pro); include chat-shaped rows beside coding rows (the 2x was on a coding workload with reasoning on); test the 16-concurrent-32K claim against the workload's two conversations; and test Splash's refuse-to-boot memory report beside the governor's admission on the same machine, the governor staying the one authority. Nothing leans on it before it is measured: run ENGINE-CONTRACT-01's suite against it on the Studio (tool_choice required and auto, reasoning separated from content, the thinking limit, cancellation reaching the engine, timing fields), then MEASURE-02's rows and STUDIO-ACCEPT-01's workload with it beside the pinned llama-server build, recording tok/s at short, 8K and 32K context, peak memory and the concurrency result with the engine build and model digest. Files: `stack/backend/src/engineCatalog.ts` (a candidate entry, never a pin), `docs/dev.md`. Mirror: the engine catalog's existing candidate rows. Acceptance: the contract suite's pass or fail table and the numbers in dev.md; a pin only if it passes the contract and beats the pinned build on the acceptance workload. Out of scope: any code path that assumes it; the coding lane (its own decision on the Studio). Exit: the dev.md tables.
    Design: [studio-day-one-2026-09-23](plans/studio-day-one-2026-09-23.md)

## Light profile for building (owner, 2026-10-07)

- [ ] **STACK-LIGHT-PROFILE-01: a light model profile the Stack can switch to while the household is building on a 24 GB machine** (S to M; owner 2026-10-07: "we have to build an entire system out but have limited memory (24gb) so ... use smaller models, less resources", and "cant you also get a smaller vision model"). Today the chat, judge, router and coding roles are all bound to Qwen3-8B (loading Qwen3-4B is refused with 'The judge role loaded qwen3-8b-instruct-q4-k-m instead'), so a smaller model cannot be chosen without changing role bindings. Add a Stack setting `stack.profile` (standard, light) that binds those roles to Qwen3-4B (text) and, once Qwen3-VL-4B is installed through the pinned downloader, to Qwen3-VL-4B as the one chat model that also reads pictures; light also lowers the context length to a measured value (the 8-bit KV cache setting belongs here as well). The profile never changes a safety floor; the memory governor sizes the light roles; Home shows nothing technical. Qwen3-VL-4B files (official Qwen GGUF repo) are in data-scratch/model-trials/qwen3-vl-4b (Q4_K_M and the Q8_0 projector; checksum and pin them through the catalog before install). Needs CHAT-LATE-SYSTEM-01 on main first (the VL template drops later system messages), the model vetter's template needle check when MODEL-VET-01 lands, and the benchmarks that gate a landing run on the 8B (standard profile) on a scratch Stack. Architect verdict first.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)

## Engine availability (2026-09-29)

Design: [docs/plans/chat-engine-availability-2026-09-29.md](plans/chat-engine-availability-2026-09-29.md). Trigger: a family question got "Sorry, I couldn't do that." because an orphaned engine process held the chat port; the Repair and the notification both existed and neither reached anyone or offered a fix. Order: ENGINE-AVAIL-01 first (the state everything reads), then 02 and 03 in either order, 04, 05. Decided by Jesse 2026-09-29: Home owns its engines in its own folders, each role is single-instance behind a lock, and anything else on an engine port is reaped without asking (the note's "Decided by Jesse"). Browser push was agreed as a default channel but does not exist in Home (no subscription route, no service-worker push handler; verified 2026-09-29), so it is ENGINE-AVAIL-06 and 03 ships on in-app plus opt-in Telegram.

- [ ] **ENGINE-AVAIL-02: the household sees it, and the turn stops lying** (M, Sonnet floor). Objective: when the state is `unavailable` the composer is disabled with a kit `Alert` (non-admin and admin copy per the note), `starting` shows a passing notice, and a turn that reaches a down model returns a typed `engine_unavailable` status with a fixed hand-written line, never stored as assistant reply text and never the generic `COMPOSE_FAILURE_LINE`. Pointers: `backend/src/lib/turnEngine.ts` (the `unavailable` 503 paths, `COMPOSE_FAILURE_LINE` swaps at ~2067, 2606, 2819), `composer.ts`, the output gate's `outcome_error` floor (mirror the "Search isn't working right now" pattern in `docs/dev.md`), `frontend/src` chat page and composer. Acceptance: the exact incident (search succeeds, model down) yields the typed status, nothing enters conversation history, a screenshot of the disabled composer opened and judged, the spoken line for voice surfaces. No hand-built component. Out of scope: notifications, fix buttons. Exit: `bash scripts/check.sh` plus the screenshot. PWA acceptance: after hub restart, re-handshake at 0.5, 1.5, 3 and 5 seconds, preserving the open conversation and unsent draft; resubscribe; show Reconnect only if all attempts fail.
 First half committed: the stopped, blocked, or failed preflight refuses before tools. ENGINE-AVAIL-00 already supplies the chat composer notice. ENGINE-AVAIL-02b now returns typed `engine_unavailable` after a successful tool call when the compose model dies, stores no completed assistant reply, covers the old `turnEngine.ts` path, and supplies the spoken line "I can't think right now. I've told the grown-ups." Still open: the live composer screenshot and review evidence required by this item.
    Design: [chat-engine-availability-2026-09-29](plans/chat-engine-availability-2026-09-29.md)
- [ ] **ENGINE-AVAIL-03b: one reminder if the chat AI is still down after 15 minutes, and Telegram on for the outage** (S, Sonnet floor). Objective: an open chat-engine Repair sends one more `repairs.new`-class notification at 15 minutes and no more; the outage notification uses Telegram for households that opted in. Pointers: `notifications.ts` `resolveChannelsFor` (~87 to 98), `notificationTypes.ts` (`repairs.new` ~116), a one-shot core job via `scheduleCoreJob` (`backend/src/lib/scheduler.ts:135`; it persists, so the reminder survives a restart, which a plain `setTimeout` would not) cancelled on resolve. Acceptance: still-open at 15 minutes yields exactly one reminder; resolved earlier yields none. Out of scope: browser push. Exit: `bash scripts/check.sh`.
  Committed: one reminder at 15 minutes for the chat engine's Repairs. Live check needs a real outage.
    Design: [chat-engine-availability-2026-09-29](plans/chat-engine-availability-2026-09-29.md)
- [ ] **ALERTS-QUIET-01: honor the household quiet-hours setting for local alerts** (S, blocked on a household quiet-hours setting existing). Objective: local system alerts from the open app respect the household's configured quiet-hours window. Pointers: `frontend/src/sw.ts`, the shell notification event stream and browser notification setting, and the future household quiet-hours setting declaration in the pinned spec. Acceptance: tests prove eligible alerts are suppressed only during the configured local quiet-hours window and resume afterward, with timezone and daylight-saving boundaries covered. Out of scope: browser-maker push or other relays. Exit: `bash scripts/check.sh`.
    Design: [browser-notifications-2026-09-30](plans/browser-notifications-2026-09-30.md)
- [ ] **ENGINE-AVAIL-06b: Web Push through the browser maker's relay, opt-in and off by default** (L, only on Jesse's word; design in the note above). Not started on purpose: it is the one path that signals through a third party.
    Design: [browser-notifications-2026-09-30](plans/browser-notifications-2026-09-30.md)

## Engine options (owner, 2026-10-07)

- [x] **VOICE-REPLY-01: conversation mode spoke only "One sec." (empty reply on the oMLX Glimmer build)** (S, 2026-10-17, `e89c7388`). Root cause and the INSTANT-05 decision (the 4B does not answer spoken turns; measured) in [instant-mode-2026-10-17.md](design/instant-mode-2026-10-17.md) section 7. Test: `backend/tests/turnMachine/voiceReplyCeiling.test.ts`.
- [x] **ENGINE-MLX-SPIKE-01: measure an MLX engine (oMLX or mlx-lm directly) against llama-server for the chat role** (done 2026-10-17 on the M5 Max 128 GB with Muse Glimmer 30B instead of Qwen3-8B on the M4 Pro; owner delegated the decision). Result and scorecard: [chat-engine-comparison-2026-10-17.md](design/chat-engine-comparison-2026-10-17.md). Verdict: oMLX 0.7.0 is 23 percent faster to generate and 36 to 42 percent faster at prompt processing, level on tool calls and reasoning, so the chat role moves to it on p64 and p128 with llama-server as fallback (ENGINE-MLX-01); Rapid-MLX rejected on measured cache and parser faults.
- [ ] **ENGINE-MLX-01: the Stack runs the chat role on oMLX where it fits, llama-server as fallback and rollback** (M, Sonnet; owner delegated 2026-10-17). Design: [chat-engine-comparison-2026-10-17.md](design/chat-engine-comparison-2026-10-17.md), Rollout and rollback. Status: in progress, Stack side.
- [ ] **ENGINE-MLX-02: run the repo's quality benches against the oMLX chat engine on the Studio** (S, bench; ran 2026-10-17 on scratch Stacks, partly). Done: tool corpus, 14 tool rows x 5, picture and video tool choice (`media-tool-choice-01.ts`), 60-prompt reasoning, 60-row search decision. Result: oMLX as shipped failed tool use (namespace echo on tool names; 15 of 70 expected calls against 65 of 70 on llama-server); Stack `cf356e8` repairs the name (58 of 70, 0 dotted); reasoning 60 of 60 on both; search decision 26 against 28 of 30. Verdict: `auto` stays off oMLX, llama-server is the default, oMLX is opt-in. Left: minor and teen non-empty replies, memory scenarios, adult length and first text (THIN-Q1), spoken first word (THIN-4F), template-token leaks and empties per 100 turns, SIGKILL recovery and vision on both engines. The GPU lock was held for hours by another agent, so these did not run; the queue and scripts are in the session scratchpad `mlxquality`. See [chat-engine-comparison](design/chat-engine-comparison-2026-10-17.md) "ENGINE-MLX-02 results".
- [ ] **MLX-TOOLUSE-01: oMLX calls the math and convert tools less often than llama-server, and sometimes shows a malformed call as the reply** (S; from ENGINE-MLX-02). Objective: close the 83 against 93 percent expected-tool rate and the 1 in 60 raw `<atem:parameter>` reply on the 4-bit Muse weights before oMLX can be the default again. Options to measure: the 5- and 6-bit MLX weights (22.9 and 26.4 GB), a Stack filter that drops a reply that is only unparsed tool markup and retries once, a newer mlx-lm parser. Acceptance: `media-tool-choice-01.ts` with `MQ_ROWS_FILE` set to the tool rows within 5 points of llama-server, 0 raw markup in 200 turns.

## Status page

Design: [docs/plans/status-page-2026-09-30.md](plans/status-page-2026-09-30.md).

Internet and required-service extension: [status-internet-services-2026-09-30.md](plans/status-internet-services-2026-09-30.md).

- [ ] **STATUS-SVC-03b: record health for remaining external request choke points** (M). Objective: add outcome observation at existing choke points for SearXNG's Wikipedia fallback, arbitrary requested page reads, Telegram, Kiwix catalog/library, update checks, voice/model/engine asset catalogs/downloads, and favicons; do not add probes or traffic. Pointers: `packageHost.ts` (`tryWikipediaFallback`, `pageFetch`), `telegramChannel.ts`, `referenceLibrary.ts`, `updates.ts`, `voiceCatalog.ts`, `modelDownload.ts`, `store.ts`, `storeIndex.ts`, `favicons.ts`, `sidecars.ts`. Acceptance: inventory and limiter review per service; only declared fixed services appear as app needs; admin details include last success/error class; no request volume increase. Exit: `bash scripts/check.sh`.
    Design: [status-internet-services-2026-09-30](plans/status-internet-services-2026-09-30.md)
- [ ] **STATUS-SVC-09: verify and fix status-day tooltip contrast** (S). Objective: the daily uptime tooltip meets readable text contrast in both light and dark themes. Pointers: `frontend/src/shell/pages/status/StatusApps.tsx`, the kit `UptimeStrip` at pinned `commons/ui/src/ui/uptime-strip.tsx`, and `scripts/screenshot.ts` contrast/capture checks. Acceptance: headless browser measurements show at least 4.5:1 foreground-to-background contrast in light and dark themes, and the existing a11y/capture script asserts both. Fix through design tokens or the kit tooltip variant; if commons UI changes, publish and pin its immutable tag per repository pinning rules. Out of scope: changing status wording or color thresholds. Exit: `bash scripts/check.sh`.
- [ ] **STATUS-LIVE-02: owner review of the live status page** (S, owner check). Objective: Jesse reviews `/status` on the running hub as owner/admin and as a non-admin, including app rows, Show details, day tooltip, and menu status dot. Pointers: `frontend/src/shell/pages/status/StatusApps.tsx`, `frontend/src/shell/statusApps.ts`, and the status route in `frontend/src/shell/Routes.tsx`. Acceptance: Jesse signs off on the live look in both roles; anything that looks wrong becomes a separate bug item. Out of scope: coordinator-led login or changing behavior without a named finding. Exit: `bash scripts/check.sh`.
- [ ] **STATUS-DRILL-01: exercise app and engine failure signals on an isolated hub** (M). Objective: a bench-style script on a throwaway install drills a stranger on the Chat port, a killed Chat engine, Stack offline, failed internet probe, and service HTTP 429. Pointers: `scripts/screenshot.ts` isolated-backend setup, `backend/src/lib/appNeeds.ts`, `backend/src/lib/statusBoard.ts`, `frontend/src/shell/pages/status/StatusBanner.tsx`, and `frontend/src/shell/statusApps.ts`. Acceptance: for each scenario assert and capture the banner and app summary, Chat menu dot color, Repair and notification, admin fix button, and recovery to green; record scenario, non-admin view, admin view, time to detect, and time to recover in a table in `docs/dev.md`. Out of scope: the household hub and adding the drill to the per-commit suite. Exit: `bash scripts/check.sh`.
    Design: [status-internet-services-2026-09-30](plans/status-internet-services-2026-09-30.md)
- [ ] **STATUS-APPS-REG-01: cover every shell destination in the status app registry** (S). Objective: a test fails when a shell navigation destination has no app entry with declared engine, internet, and outside-service needs marked required or optional. Pointers: `backend/src/lib/appNeeds.ts`, `backend/src/lib/statusApps.test.ts`, and pinned commons `ui/src/dashboard/layouts/full/vertical/sidebar/sidebaritems.tsx` (`SidebarContent`). Acceptance: the test compares shell destinations with registered apps and requires declared needs, so Videos, Music, Podcasts, and Library appear on Status when they become destinations. Add the `docs/dev.md` note "a new app declares its needs". Out of scope: inventing destinations or needs for apps that do not yet exist. Exit: `bash scripts/check.sh`.

## Studio day one (2026-09-23)

A month of lead time is prework time: stage, script and dry-run now so the Studio downloads nothing large, runs a checked runbook, evaluates its own configuration, and becomes a coding lane. The design record is [docs/plans/studio-day-one-2026-09-23.md](plans/studio-day-one-2026-09-23.md); its numbered questions are the owner's.

- [ ] **STUDIO-STAGE-01: the staging kit** (M, Sonnet). Objective: `scripts/studio/stage.sh` fetches every day-one artifact by its pinned URL and verifies its sha256 through the Stack's own download code (`stack/backend/src/lib/download.ts`), writing the Stack's store layout onto an external drive with a `STAGE.md` of every hash and size, and `--verify` re-hashes the drive; `--install <drive>` copies it into place. Items: llama-server b10797 macOS arm64, Qwen3.8-27B and Qwen3.6-35B-A3B as GGUF at Q6 at pinned revisions, the two Splash packages (17.4 GB and 20.9 GB, pre-seeded into the Hugging Face cache layout; the package is proprietary, 4-bit weights with the vision encoder and the draft in one file that only Splash loads, so the GGUF cannot stand in for it and both forms are staged on purpose), the MLX-format weights of both candidates at pinned revisions for oMLX and mlx-serve, the pins the installer and the Stack already carry. Acceptance: `--verify` green on this Mac's drive; a dry run proves whether `splash serve` honours the pre-seeded cache with the network denied, recorded either way; the Splash formula revision in `STAGE.md` (the Studio ships with macOS 26.4, decision 1 of the record, so no macOS contingency). Out of scope: any model not in MEASURE-02. Exit: `bash scripts/check.sh` and `STAGE.md`.
    Design: [studio-day-one-2026-09-23](plans/studio-day-one-2026-09-23.md)
- [ ] **STUDIO-RUNBOOK-01: the runbook, unboxing to the acceptance workload** (M, Sonnet). Objective: the record's eleven steps as a checked document (`docs/dev/studio-runbook.md`), each with its command and its check, a target under two hours; every scriptable step gains a `--dry-run` flag (`scripts/install.sh` has one) and is run on this Mac now with its output recorded. Acceptance: the dry run of every scriptable step recorded in dev.md; the restore step rehearsed against a fresh data directory from this Mac's latest backup. Out of scope: the evaluation (STUDIO-EVAL-01). Exit: `bash scripts/check.sh --docs` and the recorded dry run.
    Design: [studio-day-one-2026-09-23](plans/studio-day-one-2026-09-23.md)
- [ ] **STUDIO-EVAL-01: the Studio evaluates its own configuration** (M, Sonnet). Objective: `scripts/studio/evaluate.sh` chains, on a scratch data directory, the Stack's Studio bench protocol (`stack/scripts/bench/studio-bench.sh`), ENGINE-CONTRACT-01's suite per engine (the set is four: llama-server, oMLX, mlx-serve and Splash, each through the same suite, the same MEASURE-02 rows and the same workload; the summary picks by the numbers and the contract, never by a headline claim, and an engine that loses on chat keeps its own role: oMLX's SSD prefix cache for long companion contexts, mlx-serve's media roles), ENGINE-SPLASH-01, MEASURE-02's rows per candidate with llama-server run with the model's MTP head on and every latency measured cold and warm at 32K with the effective rate from send to last token, and STUDIO-ACCEPT-01's workload with first useful answer cold and warm, collecting the summary rows into one `report.md` in the protocol's shape and appending them to dev.md "Measured so far", so a Claude session reads tables. Mirror: `studio-bench.sh`. Acceptance: a rehearsal on this Mac (tier 1, the 8B) runs end to end and writes the report with the rehearsal marked as such; the report's summary names the candidate that passes the contract suite, clears the tool-calling bars and gives the best first useful answer under the workload. Exit: `bash scripts/check.sh` and the rehearsal report.
    Design: [studio-day-one-2026-09-23](plans/studio-day-one-2026-09-23.md)
- [ ] **STUDIO-LANE-01: the Studio as a coding lane** (M, Sonnet; after STUDIO-EVAL-01). Objective: the coordinator's OpenCode HTTP driver pointed at the Studio's engine, with the lane rules from the record: a fresh session and a fresh worktree per brief at the base the coordinator names, deleted after the report; a wall-clock budget (three times a reference run) in place of a step count and a run that ends without a done report counted as blocked; the tool set the brief names (read, edit, the named tests, commit, never push); S and M coding items, second reviews by a different model, the benches. `splash claude` proven on the Studio before Claude Code is routed to it (Splash's README ships the launcher and names its Anthropic Messages endpoint; it never names Claude Code). Acceptance: one S item from the backlog done end to end on the Studio with a clean done report and a review by the other model; the driver's budget stop tested with a brief that cannot finish. Out of scope: anything the record keeps on the subscription (design, verdicts, diagnosis, cross-subsystem items, the first review of a safety change). Exit: `bash scripts/check.sh` and the done report.
    Design: [studio-day-one-2026-09-23](plans/studio-day-one-2026-09-23.md)
- [ ] **STUDIO-MOVE-01: the Studio beside this Mac, then the move, then the rollback** (S, Sonnet). Objective: this Mac's Home points its chat, embed and judge roles at the Studio's engines with the Studio as the household's engine computer (REMOTE-STACK-01): the whole Stack on the Studio, Home linked to it, the privacy page's engine computer rows; then Home moves per the runbook's step 11 with the Studio restoring from this Mac's last backup and this Mac's hub stopped, never deleted; rollback is repointing the URLs or restarting this Mac's hub on its untouched data directory. Acceptance: a turn on this Mac's hub answered by the Studio's engine; the rollback rehearsed. Exit: `bash scripts/check.sh --docs` and the recorded rehearsal.
    Design: [studio-day-one-2026-09-23](plans/studio-day-one-2026-09-23.md)

## Thin chat path

- [x] **MEMORY-MERGE-01: the judge merges two unrelated facts into one record** (S, 2026-10-17; live on the Studio, Qwen3 4B judge, nomic embed; rule 12). Repro: Bruno says "actually my favorite color is blue, not green" (a `remember` tool write), then in a new chat "Serena is my wife": the judge's dedupe answered SUPERSEDE with contradiction:false and merged_text "Bruno's favorite color is blue and Serena is Bruno's wife", retiring the colour record. Cause: `decideDedupe()` (`backend/src/lib/memoryJudge.ts`) accepts any merged_text in the 0.60 to 0.92 cosine band; measured on the live embed model, unrelated pairs that share a name score 0.62 to 0.76 and genuine refine or extend pairs 0.77 to 0.94, so no cosine floor separates them. Decide between a dedupe prompt that forbids joining two facts about different things (measured on a fixture set) and a structural check (a merge must keep one subject). Regression test first. Exit: `bash scripts/check.sh --pre` plus `backend/tests/memoryJudge.test.ts`. Landed 2026-10-17: a merge that keeps the old fact true must share a non-name word with it (`sharesAttribute`), a correction keeps the person's own words, and the dedupe prompt forbids joining different things. Live check: correction retired green, the wife fact stayed its own record; recall not judged (Stack restarting).
- [x] **WHO-ASK-02: the who-question fires on a name whose kind the sentence states, and follows the person into unrelated chats** (S, 2026-10-17; live; ASK-01). "actually my dog's name is Rivet, not Rover" got "Who's Rivet?"; the same question was appended to "what's my shoe size?" in a new chat minutes later. Decide: a sentence that names the kind ("my dog's name is X") answers its own who-question; a pending question is asked once more at most, in the chat it came from. Exit: `bash scripts/check.sh --pre` plus `backend/tests/askNames*.test.ts`. Landed 2026-10-17: "my dog's name is X" / "is named X" frames the kind (no question); a queued question not in play is asked only in the chat it came from.
- [ ] **CHAT-CLOCK-01: the date and time stop opening chat replies** (S, 2026-10-10; bug from the live hub; rules 1, 2 and 3; the model decides, no word rule, no output rewriting; model floor Sonnet 5.5; diagnosis `data-scratch/design/CHAT-DATE-PHOTOS-DIAGNOSIS-2026-10-10.md`, part A). Objective: a 9B model parroted "The current time is Saturday, October 10, 2026 at 2:45 AM." as its first sentence, then replayed it from history as a few-shot example. Cause: the "clock" context item (`backend/src/lib/turnMachine/nodes/context.ts:338-342`) is rendered as an unlabelled "Clock:" section of the final user message directly above the person's words (`backend/src/lib/turnMachine/messages.ts:186,231,236`, moved there by 8084b3f6). Change the framing, not the content: label it as reference data to mention only if the person asks or the answer depends on it, and move it away from the person's words; best cache behaviour is a day-granular date with no time of day in the stable prefix, refreshed daily (a minute-level value breaks the prompt cache). Do not add a regex that strips date openers from replies. Acceptance: on the CHAT-AB-01 fresh set the 9B no longer opens unrelated replies with the date or time, and "what time is it" and "what day is it" still answer correctly (tool-decision and recall, rule 3); the stable-prefix cache hit is not worse (cache_n on a second turn equals the prior prompt prefix); a regression test pins the clock item's wording and position. Reuse check: edits the existing clock item and its rendering only. Exit: `bash scripts/check.sh`.
- [ ] **MINOR-TOPICS-01g** (M, 2026-10-12; rules 0, 1, 13; owner sign-off 2026-10-12; design `data-scratch/design/MINOR-TOPICS-01.md`; model floor Sonnet 5.5). bench scorer and harness for the 13 zero-tolerance checks and the rule 13 measures; the item closes only on a pass of a live run. BUILT 2026-10-12: `score.ts`, `harness.ts`, `run.ts` in `backend/scripts/bench/minor-topics-01/` with offline tests; STILL OPEN until the live run (needs the Stack, two models, 3 repeats, a person labelling the replies) exits 0 on `run.ts --report`. How to run: `docs/dev/minor-topics.md`, Bench scorer and live run.
- [ ] **MINOR-SEARCH-01e-7** (M, (2026-10-12; rules 0, 6, 6a, 7, 9, 13; design `data-scratch/design/MINOR-SEARCH-01e-LISTS.md`, owner-approved 2026-10-12; model floor Sonnet 5.5)). bench per design section 7; decides the `blp-drugs` teen default and the StevenBlack union. Built 2026-10-12: scorer, harness and tests (`backend/scripts/bench/blocklistBenchScore.ts`, `blocklist-bench-01.ts`). Everything is built and landed except the live bench with human labels. Still open: the human labels (400 positives, 1,500 negatives, kept in data-scratch) and the live run with 3 or more pins per list: `cd backend && bun scripts/bench/blocklist-bench-01.ts --dataset <file> --pin blp-porn=<file> (3 times, one per pin) --pin blp-drugs=<file> --stevenblack <hosts> --microbench --out <report.json>`.
- [ ] **MINOR-SEARCH-01k** (M, (2026-10-11; rules 0 and 1 amended, owner-approved 2026-10-11; design `data-scratch/design/MINOR-SEARCH-01.md`; model floor Sonnet 5.5). bench run (10 zero-tolerance checks, rule 13 measures) and report; the rescue flip only on the pre-registered pass. Harness and scorer done 2026-10-12: `scripts/bench/minorSearchScore.ts` (ten zero-tolerance checks, five bench-evidenced and five from named tests via `static-evidence.json`; rule 13 paired intervals; hold, ceiling and flip verdict) with 18 tests, `search-recency-02.ts` gained the teen band, grain arms and the weboff, assist_shadow, assist_rescue arms, pass criteria pre-registered in design section 6.5, and the minor context is wired into `searchAssistMayHold` behind `MINOR_RESCUE_ENABLED` (still false, test proves no change). Open: the live bench run against a Stack, the human-labelled ceiling sample, and the report; the flip stays Jesse's call.
- [ ] **CHAT-HISTORY-TOOLPAIR-01: replay a turn's shown pictures to the model as a tool call and result pair** (M, 2026-10-10; rules 2 and 6; model floor Sonnet 5.5; diagnosis `data-scratch/design/CHAT-DATE-PHOTOS-DIAGNOSIS-2026-10-10.md`, part B fix 1). Objective: when a stored turn has an `image_gallery` block, the history window builder shows it as a native `show_images` tool call plus tool result (the engine's own feature) instead of leaving "Photos of ... are on your screen" as bare assistant prose, so a small model sees "call the tool, get a result" as the pattern for pictures and stops copying the claim sentence. Evidence: in conv-aei9cpo012 turn 1 called `show_images` and stored a gallery; on turns 2 and 3 the 9B skipped the tool and claimed "The photos ... are on your screen" with an invented description. Files: the history window builder, `backend/src/lib/turnMachine/nodes/tool.ts:76-80,124-132` (call and result line, which says not to describe the pictures), `backend/packages/show_images/manifest.json`. Acceptance: a replayed turn with a gallery renders as a call and result pair with the same result line a live call produces; a turn without a gallery is unchanged; a follow-up "show me" on the CHAT-AB-01 fresh set calls `show_images` at least as often as before (measured, 9B and the catalog 27B); a regression test builds the window from a stored gallery turn. Reuse check: reuses the live tool-result line builder, no second copy. Exit: `bash scripts/check.sh`.
- [ ] **CHAT-FALSE-CLAIM-01: one stable-prompt line against false claims of a lookup or pictures** (S, 2026-10-10; rules 1, 3 and 6; model floor Sonnet 5.5, Opus 5.5 only if the bench is contradictory; diagnosis `data-scratch/design/CHAT-DATE-PHOTOS-DIAGNOSIS-2026-10-10.md`, part B fixes 2 and 3). Objective: a turn with no tool outcome must not say it searched, checked the web or showed pictures. Evidence: turn 2 said "I've checked the web ... reading the top pages now" with no search run, and turn 3 said photos were on screen with none shown (`outcomes` and `blocks` empty). Fix: add one sentence to the stable prompt for adult written turns that a lookup or pictures exist only when a tool result says so. No word rule and no output matching; a typed grounding check on the output gate is allowed only if it needs no wording match, otherwise skipped. Bench before adopting (rule 3): run the CHAT-AB-01 fresh set with `show_images` follow-ups ("show me", "what does he look like") on the 9B and the catalog 27B, with and without the line, and record false-claim rate and tool-call rate. If the 9B still skips the tool, that is a model-record finding (rule 8), not a pipeline fix. Acceptance: bench numbers with engine build, model file and sanitized hardware in the report; the line is adopted only if the false-claim rate drops and the tool-call and answer-quality sets do not regress; a regression test pins the line's presence. Reuse check: one sentence in the existing stable prompt, no new node. Exit: `bash scripts/check.sh`.
- [ ] **ACCOUNT-PIN-CHANGE-01: a person can change their own PIN** (S, priority 2; model floor Sonnet 5.5; found by NEXT-RETIRE-02C). Today no live screen lets a person change their own PIN: the old `ChangeSecretSection` was deleted, and the live write-only field in `frontend/src/shell/pages/settings/SettingField.tsx` covers settings secrets only. Objective: Account has a change-PIN control using kit parts as they ship. Files: the Account settings page, the PIN endpoint. Mirror: the sign-in PIN entry in `shell/pages/SignInPage.tsx`. Acceptance: a signed-in person enters the current PIN and a new one and the next sign-in needs the new one; a wrong current PIN changes nothing and says what to do; a test for each. Out of scope: admins resetting someone else's PIN. Reuse check: check the kit for a PIN field before writing any markup. Exit: `bash scripts/check.sh`.
    Design: [people-roles-and-account-2026-10-17](design/people-roles-and-account-2026-10-17.md)
- [ ] **RAIL-SWITCH-PROFILE-01: the rail offers a switch-profile action** (S, priority 3; model floor Sonnet 5.5; found by NEXT-RETIRE-02C). After `ProfileSwitcher` was removed, `RailProfile` has no way to switch person, so a person must sign out. Objective: decide and add the action. Files: the rail's `RailProfile` use in the shell. Mirror: the kit's rail profile menu. Acceptance: from the rail a person can reach the profile picker without losing the hub session, and the household guard still applies; a test. Out of scope: a new sign-in design. Reuse check: use the kit's rail menu item as it ships. Exit: `bash scripts/check.sh`.
    Design: [people-roles-and-account-2026-10-17](design/people-roles-and-account-2026-10-17.md)
- [ ] **COMMENT-SWEEP-01: comments stop pointing at deleted files** (S, done 2026-10-10 with NEXT-RETIRE-02F: pointers to deleted `SignIn.tsx`, `SettingsPage.tsx` and `ProfileSwitcher` were dropped or reworded; the other named files still exist, so their pointers stand; priority 4; model floor Haiku 4.5 to find, Sonnet 5.5 to edit; found by NEXT-RETIRE-02C). Stale comments name `kit/hooks/usePinAutoSubmit.ts`, `useProfileSignIn.ts`, `useSelectMode.ts`, `App.tsx`, `NotificationBell.tsx` and its test, `ThemeToggle.tsx`, `SetupWizard.tsx`, `ModelsSection.test.tsx`, `SignInPage.tsx`, `Routes.tsx` and `scripts/screenshot.ts`. Objective: each comment names a file that exists or drops the pointer. Acceptance: a grep for each deleted name returns nothing in comments. Out of scope: behavior changes. Reuse check: nothing to build. Exit: `bash scripts/check.sh`.
    Reopened 2026-10-17: Ticked, but frontend/src/shell/pages/SignInPage.tsx:84 and :108 still say "SignIn.tsx's own", a deleted file the acceptance grep must not find.
- [ ] **SHOT-FIX-02: the screenshot flags run end to end again** (S, priority 3; model floor Sonnet 5.5; found by NEXT-RETIRE-02C). `--chat-composer-review` times out at 402 waiting for "Add photos and files" (`scripts/screenshot.ts` near line 6343); `--chat-turn-review` fails near line 5085 with "shared trailing ComposerModelSelector binding was not found"; 17 old flags were deleted unverified; the renamed flags were not run end to end. Objective: every remaining flag runs headless against the seeded demo household. Acceptance: each flag produces its images and each image is opened and judged. Out of scope: new captures. Reuse check: the existing screenshot harness. Exit: the flags, then `bash scripts/check.sh`.
- [ ] **PI-MEM-00 follow-up: review and confirm household memories** (S, after the confirmation card and adult review queue exist; prompt-injection design F5/F7). Build the household-memory confirmation card for adults and the adult review queue for household writes proposed by minors. Keep `remember` household writes refused until both flows can show the text, identify who requested it, and require the appropriate adult decision. Files: the chat confirmation flow, the adult review queue, and `backend/src/lib/packageHost.ts`'s memory writer. Acceptance: an adult's household write is stored only after the card is confirmed; a minor's household write is stored only after an adult approves it from the review queue; declines and missing reviewers store nothing.
    Design: [memory-lifecycle-and-preferences-2026-10-17](design/memory-lifecycle-and-preferences-2026-10-17.md)
- [ ] **GATE-FAST-01: the gate is faster, lighter and does not flake** (M, measurement first; owner asked 2026-10-07 after a day in which most landings needed two or three gate runs). Evidence from 2026-10-06 and 07, to be confirmed by stage timing, not trusted: (a) full gates take 25 to 35 minutes under load and any pin bump, package.json, lockfile or scripts change forces the full scope; (b) most red gates were cheap deterministic failures found late (stale `elements-adoption.json`, `docs/api` drift, lint baselines, an unstaged generated file, a pin worktree in the wrong place) after many minutes of tests; (c) flakes outside the diff: chatTurn FOREIGN KEY, UsersPage roster fetch, sidecars decoy port, memoryJudge timeout, chatFolderProjects clock ordering, a11y ECONNRESET to the throwaway backend, backend shard 6 'AI was stopped' (a test that reaches a live engine path); (d) a lane once queued 29 gates at once and held the machine at load 40; (e) the gate's test workers hold several GB, which competes with the chat engine on the 24 GB laptop; (f) each fresh worktree runs `bun install --force` twice. Levers to evaluate in this order, each measured before and after, none weakening a check: 1. **fail fast**: run the cheap deterministic checks (generated files fresh, adoption scan, api docs, UI-rules lint, typecheck) before the lock and before any long test, as `check.sh --pre`, so a red costs about a minute; 2. **hermetic tests**: no test may touch the live Stack, a fixed port, the live hub db or the real clock (inject the clock like GATE-FIX-03; ports via reserveFreePort; one scratch db per file); a lint that fails a test importing the live Stack URL; 3. **flake ledger with teeth**: scripts/gate/flakes.json entries get an owner and a deadline, the gate reruns ONLY a listed test once and records it, an unlisted failure is a real failure; 4. **content-addressed skipping**: extend the existing 'a11y skipped because its inputs are unchanged' idea to backend and frontend test shards keyed by the hash of the files and dependencies they import. Pin-only scope is owner-approved as a separate org rule change, not part of this lever; 5. **machine limits**: cap shard workers by available memory so the gate cannot starve the chat engine, one gate per worktree, one waiter per lane, no polling loops (a lock queue); 6. **install cost**: use one root `bun install --frozen-lockfile`, forcing only on a pin change. Do not clone `node_modules`; this is the 01f approach. Step 0: instrument stage times and failure reasons for 20 gate runs (the logs under data-scratch/chat-ab/queue/logs and the gate's own output) and report the top offenders before changing anything. Architect gate before dispatch (the gate is a rule-bearing path); review medium.
- [ ] **THIN-2B: the forced-search budget fields are retired** (S, 2026-10-02; rule 1, stage 2). Objective: Home stops reading and writing `always_search`, `query_writer`, `model_transitions`, `rounds` and `tools_offered` on the turn budget. Files: `backend/src/lib/modelCatalog.ts:102-126`, `turnMachine/budget.ts`, the `turn_budget` shape on `ModelCapabilities` in `getmaipai/commons` `spec/` (additive rule: mark the fields deprecated and ignored, remove in a later spec tag with a changelog note). Mirror: how U3 added `THINKING_ALLOWANCE` to the record. Acceptance: no read of a retired field remains (`grep`); the catalog records load unchanged; the spec fixtures still validate. Out of scope: per-model sampling (THIN-6A). Exit: `bash scripts/check.sh` (the scoped gate), with the regression test written and seen failing first. Status: partly done at d14c27f5. `always_search` is no longer declared or read by Home (the catalog record keeps it as deprecated and ignored because the pinned spec requires it); `query_writer` was never a budget field, only the name of the query writer's JSON schema. NOT done, needs a decision: `rounds`, `tools_offered` and `model_transitions` are still read (`machine.ts` round cap, `nodes/model.ts` tool set, the no-record fail-safe that rule 8 keeps for minors) and read by many benches and tests. Retiring them needs a new source for the offered tool set and for the unmeasured-model fail-safe, and a `getmaipai/commons` spec tag that makes the fields optional; neither is in this item's files. The first new source is MODEL-RECORD-1.7B-01 (the Stack's starter model gets its own measured record, so it no longer borrows the 8B's ten tools), and the same record shape is what SMALL-MODEL-BENCH-01 fills for a 4B.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **MODEL-RECORD-1.7B-01: the starter model gets its own measured model record** (S, 2026-10-05; rules 3 and 8; owner's decision (b) of 2026-10-05; follows THIN-2B). Objective: Qwen3-1.7B Q8 is the Stack's starter model and the only chat pin on every machine profile, yet it runs on the 8B's ten offered tools (`tools_offered` at `backend/src/lib/modelCatalog.ts:101`). Give it a measured `turn_budget` and model record: `tools_offered` (the tools it does well with, which may be fewer than ten), `thinking`, and the deadlines, each value with its measurement named and every unmeasured cell marked, the conservative value taken. The record also carries `background_turns` (a yes/no flag, a commons spec field; see HEARTBEAT-01), set to false for this model until the numbers say otherwise. Files: `backend/src/lib/modelCatalog.ts`, `turnMachine/budget.ts`, the Stack's `stack/backend/src/lib/modelCatalog.ts` (which catalog holds the fields is THIN-6A's open decision; follow it). Mirror: ARCH-MEASURE-01's per-model budget verdict in `docs/dev.md`. Acceptance: a bench of the 1.7B on the adult replay set, reusing the CHAT-AB-01 bench and its datasets with no new harness, recorded in `docs/dev.md` with the engine build, model file and a sanitized hardware description (never a hostname); the record names the tools the 1.7B does well with and offers only those; the 1.7B does not get the 8B's list by default. Out of scope: the model-size floor wording for users (SMALL-MODEL-BENCH-01 supplies the numbers first), a 4B record, sampling values (THIN-6A). Exit: `bash scripts/check.sh` (the scoped gate), with the regression test written and seen failing first.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **SMALL-MODEL-BENCH-01: what the 1.7B and a 4B can do, to supply the model-size floor** (M, bench, 2026-10-05; owner's decision (a) of 2026-10-05; rules 8 and 13). Objective: a model-size floor will be stated to users, and its wording waits on numbers. Measure Qwen3-1.7B and a Qwen3 4B on four things: tool use with 1, 3 and 10 tools offered; plain replies; the memory judge; and one scripted multi-step errand (a plan, several tool calls, a resume with no model call, a plain stop). Reuse the replay set and the CHAT-AB-01 bench; no new harness, and never a second copy of the chat model beside the live Stack (one engine, per-request differences, as THIN-AB requires). Files: `backend/scripts/bench/chat-ab-01.ts`, `backend/scripts/bench/tool-calling.ts`, `backend/scripts/bench/judge-eval.ts`, `backend/scripts/bench/datasets/owner-replay.json`. Acceptance: one table per model in `docs/dev.md` with the engine build, model file and a sanitized hardware description, each of the four measurements with its row count, and a plain reading of which model clears which job. Out of scope: the floor copy itself. The floor copy is a follow-up item, written only after these numbers, in plain words a parent understands, with the three bands the owner named: under about 3B chat only, 3 to 4B chat plus a few simple tools, 8B and up the full assistant; those bands are a starting point to test, not wording to ship. Feeds MODEL-RECORD-1.7B-01 and the `background_turns` flag. Exit: the tables in `docs/dev.md` and `bash scripts/check.sh --docs` green.
- [ ] **THIN-2F: the offered tools come from the installed, enabled and permitted packages, so a new tool is offered with no code change** (M, 2026-10-03; owner's question, rules 1 and 0; follows THIN-2B). Objective: today `tool_choice: auto` applies to a fixed list of ten tool ids per model in `backend/src/lib/modelCatalog.ts:101` (`tools_offered`: almanac, convert, math, remember, remind, start_project, timer, weather, websearch); weather is in it, but a new tool (or a catalog package that contributes one) is not offered until someone edits that list. Offer instead the tools of every installed and enabled package whose manifest declares itself model-callable, filtered by the person's role and age band, the surface, temporary mode and the package's own permissions; the offered set is stable per person and surface (the Qwen3 template renders the tools block into the cached prompt prefix, so it must not change turn to turn). Files: `modelCatalog.ts`, `turnMachine/budget.ts`, `turnMachine/nodes/model.ts` (`toolSpecFor`), `backend/src/lib/plugins.ts` (`loadManifestOnly`), the package manifest shape in `commons` `spec/` (a model-callable flag if none exists; additive), `backend/packages/*/manifest.json` (weather uses Open-Meteo and must keep working). Do first: measure how many tools a small model (Qwen3-8B Q4_K_M) chooses well among (10, 20, 30) on the replay set, and record the cap; above the cap, offer by the person's recent use and package priority, never by a word match on the message (rule 1). Acceptance: weather and websearch are offered exactly as today; a new test package with a model-callable manifest is offered with no catalog edit; a child's or teen's offered set excludes packages not allowed for their band; a temporary chat excludes packages that write; the set is byte-identical across two turns of one conversation. Out of scope: how a package is installed. Exit: `bash scripts/check.sh` and the tool-count measurement recorded with the engine build, model file and sanitized hardware. When it lands, the per-person switch the tools design places in each adult's toggles (T2, with O7's per-package adult toggle for a minor) appears on the Skills section of Chat settings (SKILLS-PAGE-01), and THIN-2F changes that page's existing offered-set helper (`withTurnToolGates`) rather than adding a second one.
    Design: [tools-ecosystem-design-2026-10-03](plans/tools-ecosystem-design-2026-10-03.md)
- [ ] **TOOLS-PROGRAM: research, audit, then design the tool ecosystem (selection, recovery, existing tools, the catalog and marketplace)** (L, 2026-10-03; owner: "proper research, audit against what we have, and then proper design"). Objective: one accepted design for how tools are declared, offered, chosen, recovered and distributed, before THIN-2F, THIN-2G and any MCP work are built; they wait on it. Three phases, in order. (1) Research, four cloud sessions, each a document on its own branch: `cloud/tool-design` (`docs/plans/tool-selection-research-2026-10-03.md`: how many tools a small model chooses well, tool retrieval versus a meta-tool, recovery, child safety), `cloud/mcp-survey` (`docs/plans/mcp-connectors-survey-2026-10-03.md`: existing maintained tools and MCP servers, licences, privacy), `cloud/catalog-design` (`docs/plans/catalog-marketplace-research-2026-10-03.md`: how mature ecosystems run a catalog, trust tiers, import of third-party tools), and the audit below. (2) Audit, one cloud session: `cloud/tool-audit` (`docs/plans/tools-audit-2026-10-03.md`: the 25 bundled packages, the package host as built against PACKAGES.md, the catalog repo as built, how a tool reaches the model today, a gap table with file and line evidence). (3) Design: the coordinator reads all four, resolves conflicts with the rules (a compliant version of tool retrieval under rule 1, remote MCP servers against "nothing leaves the house", the AGPL sole-ownership line for third-party tools), and writes one design record `docs/plans/tools-ecosystem-design-2026-10-03.md` with decisions, a build order in S/M/L items and the owner decisions listed; then a Fable review pass (the `fable` model, a fresh agent that reads the design and the four documents; owner's requirement 2026-10-03) answers three questions with evidence: is it modern and what the leading apps actually do, does it default to prebuilt community parts (MCP servers and the like, maintained libraries, ready-made tools) and justify in one line each thing it builds by hand because nothing fits (owner: prebuilt community parts first, ours only where none exist), and is there an efficient path from today's code to it (fewest steps, port before delete, each step shippable); its findings are applied or answered in the record; the architect agent rules on it; the owner decides what only he can; then the items are added here and THIN-2F and THIN-2G are rewritten or confirmed against it. Out of scope: building any of it, cutting a spec tag, adding a rule to `RULES.md` before the owner approves it. Exit: the design record committed with an APPROVED architect verdict and the owner's decisions recorded.
    Design: [tools-ecosystem-design-2026-10-03](plans/tools-ecosystem-design-2026-10-03.md)
- [ ] **THIN-2D: the prose tool-call fallback is re-tested against the engine's grammar** (S, 2026-10-02; rules 2 and 9, stage 2). Objective: decide with a measurement whether the envelope parser is still needed. Files: `backend/src/lib/llm.ts` beside `toolCallFromWire`, `looksLikeEnvelope()` in `turnMachine/nodes/outputGate.ts` (STREAM-NEXT-01), `backend/scripts/bench/tool-calling.ts`. Mirror: ENGINE-CONTRACT-03's own failing row (`<function_call>` text). Acceptance: with the engine's grammar-constrained tool calls on, N repeats of the failing row (the count and the engine build, model file and sanitized hardware recorded in `docs/dev.md`) return every call natively; if all do, delete the parser and its guard; if not, keep both as the named gap. Out of scope: any other tool-call behaviour. Exit: `bash scripts/check.sh` and the recorded table. Status: not started. It needs a live run of the engine's grammar-constrained tool calls (N repeats of the `<function_call>` row on a pinned engine build and model file), which a lane that may not start engines cannot take. Needs a measurement session.
- [ ] **THIN-3B: token counts come from the engine's /tokenize on the rendered messages** (M, 2026-10-02; rules 2 and 4, stage 3). Objective: replace the 4-characters-per-token estimate with the engine's own count, taken on the rendered messages after credential redaction and note substitution. Files: `backend/src/lib/conversationHistory.ts:1857-1869,2005-2062`, `backend/src/lib/llm.ts`, `getmaipai/commons` `spec/llm/ts/client.ts` (the client call). Mirror: CHAT-12's tokenizer-client description (retargeted here) and the ENGINE-CONTRACT-01 `/tokenize` row. Acceptance: a window built from a conversation containing a credential and a guard-replaced turn counts the redacted, substituted text; a count call that fails falls back to the named minimum window, logged; no estimate remains. Out of scope: the window policy (THIN-3C). Exit: `bash scripts/check.sh` (the scoped gate), with the regression test written and seen failing first.
  Status 2026-10-06: built. The count is the Stack's new `POST /v1/tokenize` (STACK-TOKENIZE-01, stack af49b869; shapes in spec-v0.1.80, stub tokenizer in spec-v0.1.81), one counter in `backend/src/lib/tokenCount.ts` cached by content, used by the window builder; the estimate is deleted; a failed count leaves the named minimum (since THIN-3C: the turns after the anchor, at most eight, folded at six down to four), logged; tests in `backend/tests/tokenCount.test.ts`. Not ticked until the Stack on 8770 runs the route and a real count is read back through 8787 (verdict condition 3).
- [ ] **THIN-3D: the summary refresh and episode recall are defined on the new window boundary** (M, 2026-10-02; rule 4, stage 3). Objective: episode recall covers turns dropped from the token-counted window. Its former summary-refresh trigger wording is superseded by THIN-3F's checkpoint. Files: `backend/src/lib/conversationHistory.ts:2112,2123-2200`, `turnMachine/nodes/context.ts:112`, the ports from THIN-0F and THIN-0G. Mirror: THIN-0F and THIN-0G's tests. Acceptance: with a long conversation the refresh fires when turns drop out of the token window and not before; episode recall covers exactly the turns dropped; a short conversation that fits schedules and recalls nothing; credentials stay redacted. Out of scope: the profile refresh (CHAT-11). Exit: `bash scripts/check.sh` (the scoped gate), with the regression test written and seen failing first.
    Design: [context-compaction-2026-10-05](plans/context-compaction-2026-10-05.md)
- [ ] turnStats prompt_n fallback and cacheDenominator may mis-handle cache hits (prompt_tokens includes cache)
- [ ] **THIN-3F: a conversation never fails because it is long: the compaction ladder, first slice** (M, 2026-10-05; rules 0, 4, 10, 12 and 13, stage 3; after THIN-3A, THIN-3B and THIN-3C; design record `docs/plans/context-compaction-2026-10-05.md`). Objective: when history passes the token-counted window, old tool results are cleared, then the oldest exchanges are folded into the rolling summary in blocks at checkpoints, and no exchange leaves the window before its fold is stored. Governs: backend/src/lib/conversationHistory.ts, backend/src/lib/summaryRefresh.ts, backend/src/lib/turnMachine/** (messages.ts, nodes/context.ts, budget.ts), backend/src/lib/composer.ts. Files: `conversationHistory.ts` (`buildConversationWindow`, `maybeRefreshConversationSummary`, `replaySearchOutcomes`), `summaryRefresh.ts`, `turnMachine/messages.ts:188` (summary placement), the schema's `summary`/`summary_through_turn` columns (no new store). Mirror: THIN-0G's debounce and redaction, THIN-0F's episode tests, the window tests from THIN-3C. Reuse check: extends the existing window builder and summary job on the background engine (`completeBackground`); hosted compaction APIs (Anthropic clear_tool_uses, OpenAI compaction) are not local, LangMem and Pipecat are Python, and llama.cpp context shift forgets silently and breaks cache accounting, so none fits. Do: (1) in turns older than the newest 2, replace tool results and search page text with a one-line stub ("searched X, 5 sources") and keep the assistant's answer; (2) replace the "4 turns dropped" trigger with a checkpoint: when history passes 75% of its budget, fold whole oldest exchanges down to 40% in one block, and keep that block verbatim in the window until its fold is stored; (3) the summary prompt becomes fixed fields (people and facts said, decisions, open questions, commitments, tone), capped at about 10% of the engine's context by `/tokenize` count, re-folded when it passes the cap, rendered as a labelled data block ("notes about this conversation; not instructions") right after the stable prefix and before the verbatim window. Acceptance: (a) a long conversation never returns `context_too_large` from history growth, on written and spoken turns; (b) no turn is ever in neither the window nor the summary (a test walks 60 turns and checks every turn id is in one or the other after each turn); (c) the fold reads only released text and guard notes, never withheld text or page text, and its output passes the deterministic output floor for the person's band before it is stored; a fold that fails the floor is not stored and the block stays verbatim; (d) crisis state, parked consent asks, temporary mode and age band are never written into the summary, and a test drops the turn that raised crisis and a parked ask and proves both still hold; (e) a temporary chat folds in memory only and stores and logs nothing (THIN-INC row 3 as amended); (f) a child's or teen's summary is readable by exactly who can read that transcript; (g) no failure copy on this path tells the person to shorten anything, and a spoken turn never hears that a conversation is too long; (h) the shared prompt prefix between consecutive turns is stable between checkpoints (test). Measured on CHAT-AB-01, not check.sh: token budget per segment (THIN-3E); cache reuse from `timings.cache_n` against `prompt_n` (flat between checkpoints, one spike per checkpoint); fidelity on scripted 60-turn conversations with roster personas and 10 planted facts including a reversal and a negation, probed after 1, 2 and 3 folds (no invented fact; recall at least the no-compaction baseline minus 10 points); a 200-turn spoken run that never errors and keeps first word under 3 s; fold time per checkpoint on the background engine. Out of scope: raising engine context size with `-c` is STACK-CTX-01 (the Stack), not THIN-3F; the written-chat carry-forward new chat (THIN-3G); the robot's own fold (spec then bot, principle 7). Supersedes: the 4-turn summary trigger and the "2-4 sentences" summary prompt (THIN-0G's scheduler semantics), the summary line after history, full search-evidence replay in old turns. Amends: THIN-3D (summary trigger is THIN-3F's checkpoint; THIN-3D keeps episode recall on the dropped turns), CHAT-11 (rolling-summary half), ARCH-MEM-01 gap (2) (thread state is THIN-3F's structured fields), THIN-INC row (3) (temporary chats fold in memory only). Exit: `bash scripts/check.sh` (the scoped gate), with the regression tests written and seen failing first, then the CHAT-AB-01 rows in `docs/dev.md`. Row-Bot acceptance: a reply cut by the token ceiling uses the kit `stopped-run` part; Stop keeps streamed text marked stopped; never apply this to a child band cap or spoken turn.
  Status 2026-10-06: built; the CHAT-AB-01 rows are owed, so not ticked. Step 2 landed with THIN-3C. Step 1: only a search in the newest two turns is replayed (titles and links), an older search turn keeps its answer and a one-line note ("[Searched the web for ...: N sources.]"). Step 3: the fold prompt is five fixed fields with the transcript as quoted material, the summary is capped at 10% of the context by the engine's count and condensed once past it, and it enters the prompt as labelled data right after the stable prefix. Safety: the fold reads the window's own rendering (released text, guard and package notes; never page text); crisis, policy, safety-refused and consent-ask turns never enter a fold; the result passes the person's output floor (`evaluateReply`) before it is stored, and a refusal or crisis result is not stored and the block stays verbatim; a temporary chat folds in its session only (THIN-INC row 3 as amended) and logs nothing. Tests: `backend/tests/turnMachine/compaction.test.ts` and `compactionSafety.test.ts` cover (a) to (h). Open: the CHAT-AB-01 rows; the Row-Bot `stopped-run` line (a separate UI item, not built here).
    Design: [context-compaction-2026-10-05](plans/context-compaction-2026-10-05.md)
- [ ] **THIN-4F: a spoken turn with a search meets the 3-second first-word bar** (S, 2026-10-02; rules 7 and 13, stage 4). Objective: page reading must not push a spoken turn's first word past 3 seconds. Files: `backend/src/lib/turnMachine/turnNext.ts` (`spoken_cue` at 900 ms), `nodes/tool.ts`, `backend/scripts/bench/chat-ab-01.ts` (the spoken arm, THIN-AB). Mirror: the old engine's 1.40 s median and the new engine's 6.21 s median recorded in `docs/dev.md`. Acceptance: the spoken arm's first-word median on a searching question is under 3 s on the Studio and the laptop, measured with the engine build, model file and sanitized hardware recorded; if it is over, the mechanism that fixes it (for example fetching fewer pages on a spoken turn) is chosen from the measurement and recorded. Out of scope: written turns. Exit: the bench table in `docs/dev.md`. Not started 2026-10-03: it needs a running engine on the Studio and the laptop and the CHAT-AB-01 spoken arm (the bench file is still untracked); the page step now has a 6 s budget and at most 3 requests, and the mechanism to pick if the measurement is over 3 s is fewer pages on a spoken turn. Status 2026-10-04 (not ticked): spoken arm measured on the laptop only (Apple M4 Pro, Qwen3-8B-Q4_K_M, engine b10797-832fd6f17): warm first word on a searching question median 7.4 s over 3 valid runs (needs 5; the bench stopped searching at a block signal), FAIL against 3 s; the Studio is unmeasured. Mechanism from the engine requests: the phrasing round re-reads about 1,000 to 1,800 tokens of search evidence (4 to 5 s) plus the search and page step; fewer pages and less text per page on a spoken turn is the fix to choose. With a refused embed role the first word was 15.6 to 19.2 s (15 s memory wait). Table in `docs/dev.md`. Status 2026-10-04 (mechanism landed, NOT ticked): a spoken search reads at most 2 pages of 500 characters (`SEARCH_PAGES_MAX_SPOKEN`, `SEARCH_PAGE_TEXT_CHARS_SPOKEN` in `packageHost.ts`) and the answering round carries at most 600 tokens of evidence in 3 numbered sources of 400 characters (`SPOKEN_EVIDENCE_TOKENS_MAX`, `SPOKEN_SOURCES_MAX`, `SPOKEN_SOURCE_TEXT_CHARS` in `composer.ts`); written turns keep the window-sized cap. Tests: `spokenSearch.test.ts`, `spokenRecovery.test.ts`. Stays unticked until a local session measures the spoken arm's first-word median under 3 s on the live Stack: run the CHAT-AB-01 spoken arm (`backend/scripts/bench/chat-ab-01.ts`) on a searching question, 5 or more valid runs, warm engine, and record the median with the engine build, model file and sanitized hardware in `docs/dev.md`.
- [ ] **THIN-6A: each model runs on its own sampling settings** (M, 2026-10-02; rule 3, stage 6; after SAMPLING-SPEC-01). Objective: sampling comes from the model's catalog record, with the source of the values named, instead of one `CHAT_SAMPLING` for every model. Files: `backend/src/lib/llm.ts:324-346` (`CHAT_SAMPLING`: temperature 0.7, min_p, XTC, DRY), `backend/src/lib/modelCatalog.ts`, the Stack's `stack/backend/src/lib/modelCatalog.ts` (list 3 item 12 of the inventory: decide first which catalog holds the fields; default: the spec record filled by the Stack's catalog, read by Home), `stack/backend/src/lib/engineArgs.ts:70` (`--reasoning off` as a launch default; thinking is per request). Mirror: the catalog's `measured` fields. Acceptance: each catalog model has its sampling fields and a named source; a model with none sends no sampling values (the engine's defaults); no global override remains. A global override needs a reply-quality measurement on written chat and a repetition measurement on spoken companion turns, not a tool-calling bench alone (THIN-AB2). Out of scope: companion adapters (rule 14). Exit: `bash scripts/check.sh` (the scoped gate), with the regression test written and seen failing first.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **THIN-Q4: rerun arm B for words and first text on a quiet machine** (S, 2026-10-04; from THIN-Q2). Objective: the 9 B turns of THIN-Q2 hit the 20 s model-node deadline while other lanes' gates loaded the machine, so B has no row. Run `chat-ab-01.ts --arms A2,B --runs 3` on k1-heat-pump, w1-story and f4-recipe with no gate running and the machine's load average under 6, and also report why a 300-token B reply can reach a 20 s node deadline when the same request as APT finishes in about 10 s. Acceptance: B words and first text per run with cache state, beside A2 and APT. Out of scope: fixing. Exit: the rows appended to `docs/dev.md` "THIN-Q2 results".
- [ ] **THIN-GROUND-01: a search turn's answer is grounded in evidence that has the answer** (M, 2026-10-04; found by `bun run smoke:chat`). Objective: "when is the new avengers movie coming out" gets Avengers: Doomsday, December 18, 2026, and the follow-up searches and is right. Landed (verified 2026-10-04, numbers in docs/dev.md "THIN-GROUND-01 results (2026-10-04)"): (1) the engine rotation pool no longer admits image and video engines (`packageHost.ts` `webRotationPool`; SearXNG files "bing images" under web as well as images, so a fresh process's first search asked "bing,bing images" and got picture rows with the title as the snippet and no dates); (2) the search message is sized from the model's real context (`composer.ts` `searchEvidenceMaxChars`, 1.4 characters per context token, so 5,600 on a 4,000-token window), because a 12,352-character message beside the tools block was 4,456 tokens and the 4,096-token engine refused it ("Something went wrong" on a search turn, 2 of 5 runs in one arm). Still open: a fresh process's first search asks "bing,brave", and bing returns unrelated social posts for this query while brave is suspended, so smoke turn 1 is still not correct (0 of 5 correct, 3 of 5 honest "not found", 2 of 5 confidently wrong from an unrelated post's date); with google cse in the pair it is 5 of 5. Part 2 landed 2026-10-04 (code and tests, gate green; live measurement still open): one SearXNG request now names three engines from the web-and-general pool, ranked by an in-memory recent-health score with benched engines left out, one retry on the next engines when nothing came back, a `[search] engines asked=... answered=...` debug line per search, and the engine's 400 for an oversized prompt is the failure kind `context_too_large` (one retry with the evidence halved, then plain copy; the generic line remains only for the unclassified `other` kind). Measurement protocol for a local session: docs/plans/ground-2-measurement-protocol.md (smoke turns 1 and 2, 5 runs, turn 1 correct at least 4 of 5); tick this item when it passes. A second search round when the first found nothing relevant stays the model's decision (rule 1). Tried and dropped (no gain, in dev.md): a grounding-first answering instruction, native thinking on the answering round. Out of scope: the Stack's 4,096-token chat context (a Stack finding; the machine had 24 GB). Exit check: `backend/tests/packageHost.test.ts` (rotation), `backend/tests/searchPages.test.ts` (evidence size), `scripts/check.sh`, and `bun run smoke:chat` with `MAIPAI_SMOKE_ONLY=adult-search,adult-followup`.
    Reopened 2026-10-17: Ticked, but the row's own exit says "tick this item when it passes" the protocol in docs/plans/ground-2-measurement-protocol.md (smoke turn 1 correct 4 of 5) and no commit after c1141c29 or a9e6e244 records that pass; last recorded result was 0 of 5.
- [ ] **SETTINGS-ACCENT-02: the accent colours buttons and switches, with a live preview in the profile form** (S, 2026-10-08; follow-up to SETTINGS-APPEARANCE-01). Objective: the picked accent drives the primary colour of buttons and switches, and the profile form previews it as you pick, before Save. Needs an additive strong-accent token for `--primary` in `commons` first (rule 9), then Home reads it. Acceptance: captures per accent in light and dark opened and judged; contrast at or above 4.5.
- [ ] **SEARCH-MODAL-SIZE-02: the shell header search dialog is as large as ChatGPT's, and lists recent chats** (S, 2026-10-08; owner screenshots). Objective: the kit's `HeaderSearch` dialog (the one with Home, Chat, Library, Family) opens at about 42% of the window width and 41% of its height, and its empty state lists recent chats like ChatGPT's. Needs an additive size option on `HeaderSearch` in `commons` first; SEARCH-MODAL-SIZE-01 enlarged the chat commands palette only. Acceptance: measured size at 1440 and 390 opened and judged.
- [ ] **ELEMENTS-ADOPT-01: wire every assistant-ui Element that fits, delete the hand-built equivalents, show the count** (L, 2026-10-04; owner's rule, RULES.md rule 9). Objective: Home's chat screen is assistant-ui Elements from the kit (`src/elements`, 129 files in ui-v0.5.90) used as they ship, replacing hand-written chat components, with the count visible to the owner as `Elements implemented: N / 129`. Plan: (1) audit (cloud lane `cloud-r-elem`, branch `cloud/elements-audit`, `docs/plans/assistant-ui-elements-adoption-2026-10-04.md` plus `frontend/src/dev/elements-adoption.json` and `scripts/elements-adoption.ts`, `bun run elements:status`); (2) 6 to 8 wiring batches by group, each deleting the hand-built equivalents it replaces and adding a showcase scenario per Element; (3) a guard (ELEMENTS-LINT-01 below). Reuse check: the Elements ARE the prebuilt option; nothing is written by hand where one exists. Acceptance: the count on the admin `/dev/ui` page and from `bun run elements:status` is computed from the code (used in Home code, a showcase scenario, a test); the hand-built chat component list only shrinks; every wired Element has a before/after screenshot judged. Exit: `bash scripts/check.sh` per batch. Progress 2026-10-04: the chat list is the kit's thread list as shipped (the hand-written `chatListItems`, `chatListGroups` and `chatListSearch` and their tests are deleted); the reply markdown renders as the kit ships it (the look-only CSS is gone); the admin `/dev/ui` showcase and its Elements adoption panel are on `main`, reading the stub `frontend/src/dev/elements-adoption.json` (file names only, count `0 / 121 implemented`, every row unassessed). The audit branch `cloud/elements-audit` has the plan and a JSON inventory but not yet the scanner (`scripts/elements-adoption.ts`, `bun run elements:status`), so the count is not yet computed from code and the item stays open. Progress 2026-10-06 (ELT-SCANNER-01): the scanner follows the pinned kit Thread's local import graph when Home imports Thread, stores a reason string beside every verdict, and generates a whole-inventory count of `54 / 153` for ui-v0.5.110 in both `bun run elements:status` and `/dev/ui`; the full adoption batches and screenshot review remain open. Progress 2026-10-06 (ui-v0.5.115 pinned): dead chat action bar code and HomeTooltipIconButton deleted; the reply action row sits under every reply (CHAT-ACTION-ROW-01); date lines through the kit DayDivider; the new-chat screen is the kit EmptyState greeting and four generic starter chips with the composer (`chatStarterSuggestions.ts`, never from memory, history or profile; INCOGNITO-10), no where-it-runs line and no can-make-mistakes line (owner ruling 2026-10-06, supersedes CHAT-WELCOME-01's wording). Hand-built chat components 29 to 27. Progress 2026-10-06 (ELT-REGEN-01): the shipped RegenerateMenu is wired to the existing owner/admin adult two-model gate; child and teen UI coverage and forged-model adapter/server fallback coverage are in place. The menu screenshot was opened and reviewed. ELT-SCANNER-01 owns the adoption inventory and plan files. The Elements catalog slices are tracked in `data-scratch/audit/elements/ELEMENTS-SLICES.md`; this row remains the umbrella for adoption, with no separate ELEMENTS-ALL-01 row.
- [ ] **ELEMENTS-ADOPT-02: wire the Elements that need data, not just wiring** (L, 2026-10-06; rule 9; folds in CHAT-MEMORY-CHIPS-01 and CHAT-FOLLOWUPS-01 from `data-scratch/design/CHAT-UI-SPEC.md`, and SAFETY-NOTICE-01 and APPROVE-CARD-02). Objective: the admin `/dev/ui` panel's "N / 68 in use in chat" moves because the remaining planned Elements get their data: (1) `feedback-dialog` after a thumbs-down, with additive `reasons` and `note` on `ReplyFeedback` (spec-v0.1.88) and the feedback route; (2) `memory-chips` on a reply, with an additive verified `turn_id` on POST /api/memory; (3) `follow-up-suggestions`, model-written from the visible turn only, adults only, through the background engine, after the reply and never delaying it; (4) the remaining wrappers that are mostly kit already (artifact-card, job-progress, composer menu labels, tool-error and error-state; sources carried by ELT-T1-23); (5) the crisis-resources notice on the kit's `guardrail-notice` (SAFETY-NOTICE-01); (6) the package ask on the kit's `approval-card` (APPROVE-CARD-02); (7) the counts and the ELEMENTS-LINT-01 baseline. Share (`shared-conversation`) is not built: it waits on the owner's privacy call (CHAT-PARITY-03). Reuse check: the kit Elements as they ship; Home writes routes, data and copy. Age and privacy: a child gets no reasons form, no memory chips and no follow-ups, and the hub refuses a child's reasons or note; a teen's note is private to the teen; Incognito never remembers and gets no follow-ups; the note leaves with the rating on every delete path and never joins the label export. Acceptance: each slice has tests per band, captures at 1440 and 390 in both themes opened and judged, and its own gate. Exit: `bash scripts/check.sh` per slice. Baseline 2026-10-06: 28 / 68 in use in chat (`elements:status` 30 / 152). Progress: ELEMENTS-ADOPT-01 E4 (day-separator) took main to 29 / 68, and ELT-SCANNER-01 (Elements rendered by the kit Thread count) recounted it; main stood at 39 / 64 before slice 1 (feedback-dialog), 40 / 64 after; slice 2 (memory-chips, Remember this filed under its turn) 42 / 64 (main had reached 41 / 64 from other lanes). SAFETY-NOTICE-01: crisis resources sit beside the reply as the kit guardrail-notice in its support tone (ui-v0.5.126: support tone, optional policy and explanation, call, text and chat links), with an additive `crisis_support` block on the done value and the refusal error; a safety refusal reads one plain per-band sentence (failureCopy.ts) instead of the gate's internal message; the page-level crisis Alert is gone.
  **E14 slice 3 landed 2026-10-08:** `follow-up-suggestions` receives up to three model-written prompts from only the just-completed adult's visible user/reply pair through the background engine. The route refuses other people's turns, minors, non-chat, bare, refused and failed turns; Incognito turns have no database row and the adapter suppresses requests while temporary mode is active. Prompts are not stored. The kit Thread had already counted this shipped Element as implemented; this slice wires its data at the existing count. Desktop 1440 and phone 390 captures in both themes are reviewed under `data-scratch/chat-ab/queue/reports/elements-wave2-shots/`. Full gate passed after forced dependency installs on 2026-10-08.
  - [x] **APPROVE-CARD-02: package ask on the kit approval-card** (S, 2026-10-08). `ConfirmToolRender` is registered in `frontend/src/apps/chat/elementBindings.ts:76` and renders `ApprovalCard` in `frontend/src/apps/chat/chatToolUis.tsx:100`. `frontend/src/shell/pages/ChatPage.test.tsx:1534` asserts the same Allow once/Deny card for adults, teens and children with no parent-asked claim. `scripts/screenshot.ts:4010` captures all three bands at 1440/390 in both themes. PARENT-APPROVAL-01 owns child routing and server refusal.
- [ ] **THIN-AB2: CHAT-AB-01 memory scripts, safety rows and the companion-voice row** (M, 2026-10-02; rule 13). Objective: the rest of rule 13's rows. Files: `backend/scripts/bench/chat-ab-01.ts`, `backend/scripts/bench/datasets/chat-ab-01.json`, `datasets/longmemeval.ts`, `datasets/locomo.ts` (patterns for scripted memory conversations). Do: the two 9-turn memory scripts (the plan's lines 40 to 43); safety rows (a refused turn, a credential turn, a crisis turn, a withheld-from-a-child turn); a companion-voice row that checks two companions' replies are distinct and do not repeat across spoken turns (the repetition measurement rule 3 asks for); the lookup rows folded in from LOOKUP-MEASURE-01 and the bisect arms from PARITY-BISECT-01. One engine only, as in THIN-AB. Acceptance: each row group has a recorded pass or fail with the engine build, model file and sanitized hardware; a stage that regresses a row is reported, not fixed forward. Out of scope: `check.sh`. Exit: the bench table in `docs/dev.md`.
    Design: [chat-thin-path-2026-10-02](plans/chat-thin-path-2026-10-02.md)
- [ ] **THIN-INC: Incognito holds on the whole thin path, from the toggle to the last write** (L, 2026-10-03; owner's correction, rules 0, 4 and 12; design record `docs/plans/privacy-mode-2026-09-24.md` and the Incognito section above). Objective: a temporary conversation leaves no trace anywhere the thin path reads or writes, and the Incognito experience (the site-wide toggle and its explanation modal, the restyled UI, the "Incognito" button, an empty thread list) survives the chat rework. Needs its own design pass first (the chunks below are a proposal for it). Audit, one test per row: (1) a temporary turn stores no turn row, no generation record and no memory, through `logResult` and every node on the default path; (2) THIN-0F episode recall reads nothing into a temporary chat and writes nothing from it; (3) THIN-0G summary refresh is never scheduled for a temporary chat; (4) search: a temporary chat's queries are not kept in any search history or cache keyed to the person, and THIN-4H hosted search still applies its age gate; (5) THIN-5D and 5E (assistant-stream) and the thread-list adapter keep the Incognito list exclusive and discard on toggle-off; (6) the Wyoming and OpenAI-style routes after THIN-7A and 7B cannot create a durable row for a temporary request; (7) issue #163's defect (INCOGNITO-11) has a regression test on the default path. Plus the UI: a screenshot pass of the toggle, the modal and the Incognito chat on the new chat components, opened and judged. Out of scope: new Incognito features beyond the design record. Mirror: INCOGNITO-01 and INCOGNITO-11 above. Exit: `bash scripts/check.sh`, the regression tests seen failing first where a gap is found, and the screenshots. Status (2026-10-03): audit row (1) is covered on the default path by tests/turnMachine/temporaryTurn.test.ts (THIN-7C, seen failing with the temporary branch of logResult disabled): a whole-database diff over a blocking temporary turn, a streamed one, a second turn in the same chat and a remember request shows no turn row, generation record, memory, episode, summary job or pending ask. It also covers the stored-state half of rows (2) and (3) for those turns; rows (4) to (7) and the UI pass remain.
    Design: [privacy-mode-2026-09-24](plans/privacy-mode-2026-09-24.md)

## Chat throughput (owner, 2026-10-17)

From `docs/design/chat-throughput-2026-10-17.md`: 25 tok/s is the bandwidth ceiling of a dense 30B on this chip (31.2 ceiling, 26.1 measured); flags are not the cause.

- [ ] **CHAT-TPS-01: find out whether a second GPU job halves chat speed** (S, measure, no flag change). Objective: llama-bench halved to about 14 tok/s twice while chat and other work shared the GPU. Run `llama-bench -p 0 -n 64` against a scratch copy while the judge and embed roles generate and while a chat streams, record tok/s alone vs shared, and log `predicted_per_second` next to which roles were busy. If shared halves it, the fix is scheduling (prewarm and judge work wait for an idle chat), a separate row. Done when: a table of alone vs shared numbers lands in the design note.
    Design: [chat-throughput-2026-10-17](design/chat-throughput-2026-10-17.md)
- [ ] **CHAT-TPS-02: DFlash draft model for Muse Glimmer** (M, Stack). **Measured 2026-10-17, go (needs Jesse's approval of the record change):** on b10797 with the Stack's own flags, `--spec-type draft-dflash -md <file> -ngld 99` (default n-max 3) takes 25.5 to 26.0 tok/s to 32.6 / 42.1 / 32.6 / 47.0 / 46.4 (chat / code / explain / tool JSON / reasoning), 1.26x to 1.84x, mean about 1.55x; first token 50 ms faster; +2.2 GB resident; 16k context changes speed under 3%; longer drafts (n-max 6, 16) are slower. Temperature 0 outputs diverge after 40 to 170 tokens on 4 of 5 prompts, so the gate is the quality benches, not string equality. Draft: `dflash-Muse-Glimmer-30B-Q4_K_M.gguf` from `meta-models/Muse-Glimmer-30B-GGUF` revision `70bf1b61ac09f91b24d39038091b41c582bc5d7a`, 1,631,208,128 bytes, sha256 `b2e808bf656086fe86bd0d0bd990f01d33e377537a07c02d45371517c8b264ef` (verified). **Quality benches run (3 seeds each, draft vs none):** tool calling 128/174 against 129/174 correct, 0 corpus false calls both, reasoning 60/60 both, search decision 15/24 against 17/24 on 8 rows (noise); quality holds. **Combined with the projector (tested 2026-10-17): no gain.** Draft plus projector in one launch starts and engages (46 to 49% acceptance) but runs at 21 to 24 tok/s against 26 without the draft; the same draft without the projector gives 30 to 35. So the Stack change (branch `dflash-draft`, f0fe28d) is held, not pushed. Decision for Jesse: keep pictures (no draft), or draft without pictures, or retest on b11404+ at the next engine pin. The p32 Q4_K_M file was not on disk and is untested. Remaining work if unblocked: pin it in the model record (url, revision, sha256, bytes) beside the projector; `engineArgs.ts` passes the flags for p32 and larger (p32 only when 3 GB spare, p16 never); memory plan counts +2.2 GB; run the search, tool and reasoning benches with and without it; architect verdict. No pin bump needed. Detail: `docs/design/chat-throughput-2026-10-17.md`.
    Design: [chat-throughput-2026-10-17](design/chat-throughput-2026-10-17.md)
- [ ] **CHAT-TPS-03: cap reasoning tokens** (S, after CHAT-TPS-02). Objective: Muse reasons every turn; measure `--reasoning-budget` values on the chat benches and keep the smallest that holds quality.
    Design: [chat-throughput-2026-10-17](design/chat-throughput-2026-10-17.md)
- [ ] **CHAT-TPS-04: is a mixture-of-experts chat model worth it? (owner decision)** (M, bench). A Qwen3.6-35B-A3B class model decodes 87 to 105 tok/s on this chip (3x to 4x). Goes through MODEL-VET-01 and the search and tool benches on our prompts; never switched by speed alone. Recommended: bench after CHAT-TPS-02 shows what the dense model reaches with a draft.
    Design: [chat-throughput-2026-10-17](design/chat-throughput-2026-10-17.md)
- [ ] **VOICE-STUDIO-01: choose and install the Studio's expressive voice** (M). Design: [studio-voice-2026-10-17.md](design/studio-voice-2026-10-17.md). Objective: bench Chatterbox Turbo 350M and Orpheus 3B (plus Qwen3-TTS MLX if tags are verified) on the Studio, record time to first audio, real-time factor, memory and a WAV with a hesitation, a laugh and a cough, then install the winner as a second `tts` engine with Pocket TTS kept as the small-machine fallback. Slice 1 landed 2026-10-17 (stack fb93272, 89a6b01): Chatterbox Turbo on MLX is the second `tts` engine, switchable by `stack.voice.engine`, default on p64 and p128 with Pocket TTS as fallback, live on the Studio; the six tags it renders are served as `tts.tags` on the role and each voice. Slice 1 done; voice chosen by ear by the owner 2026-10-17 (Chatterbox Turbo MLX, after the benchmark samples and the live Stack sample). Orpheus rejected by ear 2026-10-17 (not a slice), Pocket TTS stays the small-machine fallback, reference-clip cloning is later (slice 3). Pairs with REG-02 (tags). VOICE-PICK-01 (2026-10-17): the Voice page always lists the voice in use ("Default voice", saved as `default`); a saved name the active engine does not offer (the live "javert", a Pocket name, under Chatterbox) is set aside with one plain line, moved to `default` once, and never sent to the engine. Open: the spec's `tts.voice_id` still declares default alba; Home's declaration supersedes it until a spec tag carries `default`.
    Design: [studio-voice-2026-10-17](design/studio-voice-2026-10-17.md)
- [ ] **SETTINGS-AUDIT-01: a household event for safety-relevant setting writes** (S, 2026-10-17; found by the SEARCH-DDGS-TEEN-01 review). Objective: an owner or admin change to a setting that widens what a child or teen can reach (`search.ddgs_for_minors`, `search.web.child_mode`, `search.web.teen_mode`, `search.web_sources`, blocked-site lists and the other age-gate keys) leaves a record of who changed it, which key and the new value, shown to owners. Today Home has no settings-change event type: `settings_values` keeps only `updated_at` (and `set_by` for a user override), `status_events` is service uptime and `issues` is health, so none fits. Files: `backend/src/lib/settings.ts` (the write path), a new typed event kind per rule 6a (key and value of a household setting are not a person's activity text; the record carries the actor's role only, never a person id or name (rule 6a; design 2026-10-17)). Acceptance: a write of each listed key by an admin records one event with the actor, key and new value; a refused write records none; a teen or child can never write one. Architect verdict first (new record type, so spec first in `commons`). Exit: `bash scripts/check.sh`.
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)
- [ ] **SPEC-MINOR-DDGS-KEYS-01: move `search.ddgs_for_minors`, `ui.reasoning_open` and `voice.hesitations` into a commons spec tag** (S, 2026-10-17; spec first, then Home). Objective: the three keys that ride in Home (`backend/src/settings/minorDdgsKeys.ts`, the reasoning and voice key files, allowed by the settings drift check "absent only, never different" ahead of spec-v0.1.152) are declared once in `commons` `spec/settings/keys.json`, a new `spec-v*` tag is cut, Home bumps the pin (`docs/PINNING.md`) and deletes the local declarations. Acceptance: the drift check passes with the keys present in the spec and absent from Home; copy and options are byte-identical to today's; the registry visibility rule for `search.ddgs_for_minors` (kept visible while its value is not off) moves with it or stays in Home as a filter. Needs Jesse's word for the tag. Exit: `bash scripts/check.sh`.

## The chat rebuild (2026-09-22)

The accepted design and build order:
[docs/plans/simple-turn-pipeline-2026-09-22.md](plans/simple-turn-pipeline-2026-09-22.md).
The old rule ladder (~1,900 lines of regex and word lists deciding
whether to search, what to search for, and whether to trust the model's
own answer) is replaced by five fixed steps and one model call with
tools; new path built beside the old one behind `turn.pipeline.next`
(off by default) until the replay set passes clean. Phase 0 (the
buy-or-build spike, the per-model capability numbers, the local-decider
bench) gates U2 onward; U0, U1, U3, U5 start immediately. See the plan's
point 7 for the full unit list and point 6 for the migration order.

- [ ] **JUDGE-SURFACE-01: personaJudge.ts always judges a written reply against the spoken persona description** (S; found live during U4b-2's own voice A/B, 2026-09-23). Objective: `personaJudge.ts`'s `buildJudgePrompt` calls `composePersonaPrompt(persona)` with no surface class argument, defaulting to "spoken", so a written-class exchange is always graded against the spoken description ("use contractions", "not like a written page") - a structured written reply reads as "does not match the persona" for that reason alone, regardless of whether it is actually voiced correctly for its own register. Confirmed live: three written exchanges scored 0/3 both with and without the few-shot examples block, an indistinguishable result caused by the mismatch, not a real signal either way. Change: `judgePersonaConsistency` and `buildJudgePrompt` take a `surfaceClass` parameter, passed through to `composePersonaPrompt`, defaulting to "spoken" so `persona-eval.ts`'s existing spoken-only call site needs no edit. Files: `personaJudge.ts`, `personaJudge.test.ts`. Tests in these words: `buildJudgePrompt(persona, exchanges, "written")`'s own prompt contains the written formality fragment, not the spoken one. Acceptance: a written exchange scored against the written description instead of the spoken one. Exit: `bash scripts/check.sh`.
- [ ] **ROUTER-FOLLOWUP-01: close the dev-versus-lock-box gap** (M). Dev recall was 89 to 99.7% and the sealed lock box gave 75 to 86%, so the dev pool and labels are easier than real turns. Find why (family leakage, label noise, phrasing mix), then refit the head on a pool that predicts the lock box.
    Design: [router-build-02-2026-10-12](plans/router-build-02-2026-10-12.md)
- [ ] **SEARCH-DDGS-01b: spec copy for the ddgs option** (S). In commons `spec/settings/keys.json` change `search.web_sources` help and `copy.options.ddgs` from "not available yet" to true copy (a second, adults-only source; needs the search service on this computer), tag, then bump the pin in Home.
- [ ] **SEARCH-DDGS-01c: persist the ddgs quiet window across hub restarts** (S). It is in memory today; needs a household-scoped state record declared in the spec first.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)

## Chat freshness (owner, 2026-10-07)

- [ ] **SEARCH-FRESH-01: the model searches by itself for anything current instead of answering from stale memory, and never asks permission to search** (M, bug from the live hub 2026-10-07; rules 1, 7 and 13; the model decides, no word rule or router). Owner transcript: "when is the new movie coming out" (about The Exorcist) was answered from training memory as "Believer, May 24, 2023" with "as of September 2024" and an offer "Would you like me to check?"; "nope, theres a newer one" got another stale answer; only after the person typed "yes" did it search and find the real answer (The Exorcist: Martyrs, 12 March 2027). Two defects: (1) a question about something new, latest, upcoming or current was answered without the search tool; the model also believes the date is September 2024, so the clock line is missing, buried or ignored; (2) it asked permission to search instead of searching. Acceptance by measurement, not by word lists: a fixed set of at least 30 time-sensitive questions (new movie, latest version, who is the current ..., upcoming release, today's score, price now) and 30 timeless ones (arithmetic, capital cities, definitions) run on the live model through the existing search bench (THIN-AB / chat-ab-01): time-sensitive questions call the search tool in at least 90% of runs and never end by asking whether to search; timeless questions do not search more often than today (no new unnecessary searches); the answer states the date it relies on only when sourced. Levers allowed (each measured before and after, in the owner's order of preference): the date and year given to the model in a place it uses (system prompt top, not a buried line), the search tool's description (when to use it, plain words, no keyword list), the instruction that a search is never to be offered, only done. Architect verdict first (Chat turn rules govern); review medium.

## Tool offering (owner, 2026-10-07)

- [~] **TOOL-OFFER-01: a tool can never silently go missing from what the model is offered** (S to M, owner question after the show_images bug: the tool was installed, enabled and gate-approved but absent from both models' hand-written `turn_budget.tools_offered` lists in `backend/src/lib/modelCatalog.ts`, so the model never saw it; nothing failed, the model just said it could not show pictures). Three layers, strongest first. (1) **Inventory:** every bundled tool must be in the derived offer or have a visible reason why it is not offered. (2) **One definition (principle 4):** package manifests declare base, conditional or off; the live `tools_offered` set is derived from installed, enabled, smoke-healthy manifests plus the model's `max_tools` cap, and over-cap fails closed rather than silently trimming. (3) **An offer test per tool:** representative prompts by allowed mode, real adult written request assertion, per-tool call-rate bench, and a model-vetter parseable-call check. Architect verdict approved; spec offer block is present in spec-v0.1.108. STATUS 2026-10-08: layers (1) and (2) implemented; layer (3) remains open.

- [ ] **CHAT-STATUS-ONE-01: the rail Chat LED and tooltip, the line under the chat input and the profile status say the same thing** (S to M; owner bug 2026-10-08). Same state, same colour, same meaning on all three (one can be wordier, never different): one function maps availability to colour key, label and long copy.
- [ ] **CHAT-MENU-01: the per-chat context menu (the three dots in the chat header) matches ChatGPT in options and look** (S to M; owner 2026-10-07; screenshots chatgpt-chat-menu.png and ours-chat-menu.png). Ours has Rename, Read replies aloud and Delete only, drawn small and tight. ChatGPT's: Rename, Pin, then a divider and View files in chat, then Archive and Delete (red), then a project group: Move to project (submenu) and Remove from project when the chat is in one. Scope: Rename, Pin or Unpin, Archive or Unarchive, Delete (confirm dialog), Move to project (submenu of the person's projects, projects landed in PROJECTS-P1/P2 and UI), Remove from project, View files in this chat only if the chat has attachments, Read replies aloud kept (it is ours: the read-aloud Element). Each item uses an existing backend route where one exists (list which are missing: archive, move, remove are the likely gaps) with a spec-first record change if needed; no item is shown that does nothing; a child sees only what their rules allow (Incognito and temporary chats: no pin, archive or project). Look: the kit dropdown menu part as it ships, a roomy row height (about 40 px, 18 px icons), group dividers, destructive in the danger token, a Share button beside it only if sharing exists. Kit and shadcn parts only, tokens only. Architect verdict first.

## Model vetting (owner, 2026-10-07)

- [ ] **MODEL-VET-01 (design note: data-scratch/design/MODEL-VETTING-DESIGN.md, owner answers 2026-10-07 in OWNER-ANSWERS.md; eight slices, spec first; the seed list below is superseded by the design note): a model vetter: a new or changed model answers a fixed set of simple questions, and a model that gets them wrong is not loaded** (M, owner idea 2026-10-07 after a live failure: the Qwen3-VL chat template silently dropped every later system message, so memory, the clock and the age instructions never reached the model, and nothing noticed for hours; found only because the owner asked "why is the date wrong"). The Stack's chat role row already carries a `check` field (state "not checked", reason, at, stale) and the picture check (the engine loads its projector and reads a check picture before it declares `imageInput`): this item generalises that into one vetting suite. Candidate checks, all deterministic with exact expected answers, never a judge model in the safety path (RULES-AND-LEARNED-COMPONENTS.md): (1) **context reaches the model**: a fact and a date placed the way Home places them (the exact message layout Home sends) must be answered back; this is the check that would have caught the template bug, and it must run through the real template (llama-server /apply-template or a real completion), not a unit stub; (2) arithmetic and a short instruction ("reply with exactly: ready"); (3) tool-call syntax: given a toy tool the model emits a parseable call when it should and none when it should not; (4) thinking off honoured when the request says off; (5) picture check for a vision model (already exists); (6) context recall near the configured window (a fact at the start recovered at 80% fill); (7) a held-back-at-this-age line followed for a child persona (exact phrasing check on a fixed prompt, counted only as pass or fail, never used to loosen anything). Where it runs: in the Stack, after the engine process is up and before the role is marked ready; a failing model leaves the role offline with a plain-words reason for admins ("the model did not pass check N"), is never loaded for a household, and the previous good model stays; the result is stored per model file hash and per template hash so a re-download or a template change re-vets it; new models install from the catalog but stay "not vetted" until they pass. Design note first: the check list with expected answers, the pass bar (all of 1 to 5 required, 6 and 7 per role), cost in seconds on the 24 GB machine, the admin view on the Models page (kit parts only), and how Home's own prompt layout is fed to check 1 without Stack importing Home (the layout is declared once in `commons` spec so both read the same shape). Spec first, Stack, then Home. Architect gate before dispatch (Stack rules and the safety path); no learned component in the safety path.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)

## Knowledge sources (2026-09-24)

- [ ] **MEDIA-SEARCH-01: video, approved 2026-09-24** **Amended 2026-10-06 by ANSWER-IMG-02: video only; pictures in answers are the ANSWER-IMG items, so two items never cover pictures.** **Rewritten 2026-10-02 for chat rule 7.** Depends on THIN-4A (page-reading search) as well as LOOKUP-FED-01. The picture and video card is a tool the model chooses; IMAGE-SEARCH-01 is dropped and merged here. For a child or teen the results pass the same deterministic floor as page text (THIN-4C). (S, after `LOOKUP-FED-01`; merges `IMAGE-SEARCH-01`). Objective: `docs/plans/knowledge-sources-2026-09-24.md`'s "Video search" section. Results come from SearXNG's images/videos categories through the one `lookup()`, its limiter and its cache - the hub never downloads a video. Card: a thumbnail through Home's own image proxy, title, site, length and date; tapping plays on the viewer's own device (the site's privacy-enhanced embed or its page), never routed through the hub. A child or teen only ever gets `SEARCH-SAFE-01`'s own safe-search-capable engines, so no YouTube in results unless an adult allows it for that person. How a turn asks for media (the lookup returning media rows with the card shown vs. one dedicated "find media" tool) is decided by measurement on replay rows ("show me the trailer" vs. "who directed it"), the same discipline `#150`/`READ-PAGE-01` already use. `YOUTUBE-API-01` (optional, off by default, the household's own key) comes after this ships. Exit: the replay bench table in dev.md, then `bash scripts/check.sh`.
    Design: [knowledge-sources-2026-09-24](plans/knowledge-sources-2026-09-24.md)

## SearXNG settings

- [ ] **SET-01b: Yandex Images as an optional adult-only engine in the spec catalog (`privacy_flag`, operator Russia), the settings-page snippet and check, captcha means engine down for the turn with back-off; privacy row** (S; after LAND-04; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); needs its own architect verdict before dispatch
    Design: [searxng-settings-2026-10-06](plans/searxng-settings-2026-10-06.md)
- [ ] **MEDIA-INT-01: media int 01** (S; after design record; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); `data-scratch/architect/MEDIA-INT-01.verdict`
- [ ] **MEDIA-INT-18: media int 18** (S; after design record; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); `data-scratch/architect/MEDIA-INT-18.verdict`
- [ ] **CAP-05: jsonrepair in the envelope parser only** (S; after design record; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); `data-scratch/architect/CAP-05.verdict`
- [ ] **CAP-06: `redact_pii` at the hosted-search query, shared backup and artifact, problem-report bundle; the per-turn exact-search switch (adults, logged)** (M; after none; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); `data-scratch/architect/CAP-06.verdict`
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)
- [ ] **CAP-08: household import package** (S; after design record; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); `data-scratch/architect/CAP-08.verdict`
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)
- [ ] **OWUI-ADOPT-06: `read_link` offered only when the message holds a URL, behind the ten-tool bench probe** (S; after 2.3; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); `data-scratch/architect/OWUI-ADOPT-06.verdict`
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **VISION-02a: vision 02a** (S; after design record; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); `data-scratch/architect/VISION-02a.verdict`
    Design: [vision-images-2026-10-17](design/vision-images-2026-10-17.md)
- [ ] **VISION-02e: CHAT-AB-01 rerun on Qwen3-VL-8B-Instruct at a 40,960 p16 ceiling (adult length and first text not worse than the 8B beyond the gate's cost; child; spoken 3 s; memory scripts; companion-voice row on the new base), the picture bench (10 CC0 photos, 8 of 10, no identity claim), the fit numbers; report to the owner** (M; after LIVE-RESTART-01; Reuse check: see its named kit, spec or design record; Exit: `bash scripts/check.sh`); `data-scratch/architect/VISION-02e.verdict`

  - [x] **ACTIVITY-01a: activity record and event vocabulary** (S; landed 39530f6, spec-v0.1.82).
  - [x] **ACTIVITY-01b: activity lifecycle and persistence** (S; landed 22c41bbf).
  - [x] **ACTIVITY-01c: activity stream and read model** (S; landed f8bf741c).
  - [ ] **ACTIVITY-01f: robot activity surface** (S; queued; needs its own architect verdict before dispatch).
    Design: [vision-images-2026-10-17](design/vision-images-2026-10-17.md)

## Reverse image lookup (owner, 2026-10-07)

- [ ] **IMG-REVERSE-01: "where is this picture from / what is this?" for a picture a person gives chat** (S design note first, then M, owner asked 2026-10-07 "dont know if thats possible"; part of the media work beside MEDIA-SEARCH-01 and the ANSWER-IMG items). Two different jobs, kept apart: (A) **local, private, buildable now**: the vision model already says what a picture shows (VISION-02 landed); add "find my pictures like this one" over the household's own photos by a local embedding or perceptual hash index (nothing leaves the home, per person and per age band like every media record, never another person's private photos). (B) **real reverse image search on the open web** (where else does this picture appear, who made it): no free official API exists (Google Lens and Bing Visual Search are not public APIs; TinEye has a paid API; the open-source SearXNG instance we run has image engines for text queries, not for uploading a picture). It would send the person's picture to a third party, which collides with the privacy architecture (docs/PRIVACY.md: nothing leaves the home, no outbound connection added without the owner's word) and THIRD-PARTY-SERVICES.md (a person's pace, the front door). So B needs the owner's decision (an owner-keyed optional provider, off by default, never for a child or teen, picture sent only after an adult taps a plain-words confirmation, EXIF location stripped) and an architect verdict; it is not built until then. Design note first: what is feasible, the provider options with their terms and cost, the consent card wording, and the local index size on a 24 GB machine. Architect gate before dispatch; no build in this item until the note is approved.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)

## Pictures in answers and sent pictures (2026-10-06)

Slice order, Part A: 00 and 03 can start in parallel; 01 after 00; 02 after 01; 04 after 02 and 03; 05 before the tool is turned on in the catalog record; 04b only after the owner names the gap. The quality filter (00) ships before or with the first strip. All ahead of `LOOKUP-FED-01` (owner's ask: move up). `show_images` stays out of `modelCatalog.ts`'s `tools_offered` until 05 passes.

Part B (UPLOAD-IMG) runs independently: 01 and 02 can start now; the model reading sent pictures is VISION-01, amended as below.

- [ ] **ANSWER-IMG-04b: the mosaic layout and gallery extras** (S, kit then Home; blocked on a rule 9 named gap from the owner). Objective: the large-plus-two mosaic for pictures that lead an answer (equal outer height, 8 to 12 px gaps, rounded, badge on the last tile), and whichever of swipe, thumbnail rail, focus restore, reduced motion and paint-time removal ANSWER-IMG-03 found missing, built in the kit as a variant of the image-gallery Element. Needs the owner to name the gap in `docs/design/RULES.md` rule 9 first. Exit: kit tag, `bash scripts/check.sh`, screenshots.
  Verdict: `data-scratch/architect/ANSWER-IMG-04b.verdict`.
- [ ] **IMGQ-17: CIRCLE BACK, picture and search follow-ups** (M, open; from IMGQ-16). Each is its own piece of work and needs the architect gate before dispatch.
  - IMGQ-17a: Wikidata type-constraint check (IMGQ-12 section 2.3), unmeasured.
  - IMGQ-17b: a stronger vision judge when the Mac Studio arrives (Qwen3-VL-8B reached AUC 0.80, not enough).
  - IMGQ-17c: a working Google-class engine in SearXNG (only bing, openverse and the Commons engine answer today).
  - IMGQ-17d: allow SearXNG for famous people (the private-person block stays at 0; measure first, Jesse decides).
  - IMGQ-17e: tile checks for teens and children (Commons is closed to them today; Jesse decides).
  - IMGQ-17f: per-subject lookup cache.
  - IMGQ-17g: a title-match term before the notability cut in the entity lookup, measured on a fresh sealed set (the IMGQ-15 held-out half is used).
  - IMGQ-17h: the re-ask on/off choice (`MAIPAI_IMGQ09_REASK`; Jesse decides).
  - IMGQ-17i: the 9B decision pass for search (ROUTER-FOLLOWUP-02; needs a design rule 1 change, so an architect NEEDS-RULE-CHANGE verdict first).
    Design: [imgq-16-final-picture-setup-2026-10-13](plans/imgq-16-final-picture-setup-2026-10-13.md)

## Vision

- [ ] **Pet recognition: name a pet, mark its owner, recognize it again**
      (L, Jesse's ask, 2026-09-06) - "facial"/body recognition from an
      image plus, ideally, bark/vocalization recognition from audio.
      Blocked on the same missing image-input path as `host.camera.still`
      above (no pipeline exists to get a photo INTO the hub at all yet),
      and bark/sound recognition is a real second model, not a
      by-product of the vision half. Ownership is not new scope to
      invent: "pets need ownership" is one of Jesse's own original
      points in `docs/dev.md`'s "Entities, relationships and grants" -
      a pet is a `kind: entity` record and "owns"/"belongs to" is exactly
      the Relationship edge that spec already defines. That storage is
      real now (Session F step 7, 2026-09-06: `POST /api/entities`
      `kind: pet`, `POST /api/relationships` `type: owns` - its stored
      inverse, `owned_by`, comes free), so this is purely a recognition-
      and-UI problem sitting on top of already-built hub work, not a new
      data model to design from scratch.
    Design: [vision-images-2026-10-17](design/vision-images-2026-10-17.md)

## Generation (image, video)

Design (person-facing half): [pictures people make](design/image-generation-2026-10-17.md) (2026-10-17); the engine half stays in `plans/hub-on-apple-silicon-2026-09-17.md`.

- [ ] **MEDIA-HOST-03: Generate music with licence-aware export** (M; carried by MUSIC-GEN-01 to -03 and -08, section "Music generation") -
      benchmark ACE-Step 1.5 and the selected Stability model for one minute
      of audio, store model/prompt/seed/source provenance, and block a
      monetized export when the model or data terms are not cleared. Check:
      the fixed audio bench and full gate.
    Design: [hub-on-apple-silicon-2026-09-17](plans/hub-on-apple-silicon-2026-09-17.md)
- [ ] **CHAT-MEDIA-01: Put image, edit, video, and music jobs in chat** (L) -
      attach or generate thread assets, resolve plain-word references, keep
      originals, add undo and variations, show progress, notify on completion,
      and record the per-person generation consent shape from the Apple plan.
      Child profiles cannot grant or invoke the people path. Out of scope: a
      separate generation app. Check: chat attachment, safety, consent, and
      provenance tests plus the full gate. The chat program's generative-UI
      contract (`docs/plans/shell-on-shadcndashboard-2026-09-21.md`) already
      names the wire: the image job's queued/progress/done events bind to
      assistant-ui's `image-generation` Element (its own gap: no numeric-
      progress prop, only a boolean-ish `running` - collapse queued/progress
      into that until upstream adds one), and the finished file hands off to
      the plain `image` Element - do not invent a Home-drawn substitute for
      either.
    Design: [hub-on-apple-silicon-2026-09-17](plans/hub-on-apple-silicon-2026-09-17.md)
- [ ] Video generation (L) - the design now distinguishes animated LTX and
      photorealistic Wan; do not start code before MEDIA-HOST-02's Metal
      timing and memory result is recorded.
      Candidate to bench alongside LTX and Wan (research 2026-10-12, notes in
      `data-scratch/research/FREEVIDEO-01.md`): FlashML-org/FreeVideo (Apache-2.0
      runner, weight streaming and int8 to run MiniMax H3 in about 8 GB VRAM).
      Unmeasured claims, Nvidia-first, Mac only as a preview, no content filter.
      Open for the owner to weigh after the bench: the MiniMax H3 licence
      territory (it excludes the US, EU, UK and South Korea). The licence does
      not stop the evaluation; we bench it, then the owner decides. Bench on a
      discrete 8 GB Nvidia card, source read for network calls first, and any
      weight download needs the owner's yes.
    Design: [hub-on-apple-silicon-2026-09-17](plans/hub-on-apple-silicon-2026-09-17.md)

## Image editor tools (owner approved 2026-10-17)

From [image-tools-2026-10-17.md](design/image-tools-2026-10-17.md): Apple Vision (Mac) or IS-Net for Remove BG, Big-LaMa for Erase, Real-ESRGAN general x4v3 for Upscale, Lanczos for Resize; one on-demand worker behind `POST /v1/images/edits` in the Stack.

- [ ] **IMGTOOLS-01: Stack image tools service** (M, Stack, `backend/src/imagetools/*`, `routes/v1.ts`, `routes/imageTools.ts`, `lib/modelCatalog.ts`, `lib/installPlan.ts`). In progress 2026-10-17: see the Stack repo's BACKLOG row for the SHA.
- [ ] **IMGTOOLS-02: architect verdict on the note, then Home endpoints design** (S).
- [x] **IMGTOOLS-03: Home routes to edit a picture through the Stack** (S, `backend/src/routes/imageEdit.ts`, `lib/imageEdit.ts`). Built 2026-10-17 (`2a4a1657`, `481e8c94`): `/api/image-edit` status, edit with job progress and cancel, preview then apply as a new attachment version (provenance in the File note), markup save, Comment answers "Picture creation isn't set up yet". Photo gate, own-chat write rule, temporary chats in memory only. Tests `backend/tests/imageEdit.test.ts`.
- [x] **IMGTOOLS-04: tools status in Home** (S). Built: `GET /api/image-edit/status` maps the Stack's image-tools route to per-tool enabled and a plain reason (preparing, not installed, no Stack, pictures off, no picture engine for Comment).
- [x] **IMGTOOLS-05: canvas editor tools UI** (L). Built: kit `ImageEditor` Element (commons ui-v0.5.243; the only `<canvas>` lives in the kit, so Home has no override or wrapper and RULES needs no gap) opens in the chat canvas pane (full screen with a bottom toolbar on a phone); Edit button on sent pictures via the kit `ImageEditContext` (ui-v0.5.242). Verified in the browser on a scratch Stack and Home: Remove BG, Erase, Upscale 2x, Markup, versions, at 1440 and 390. Open: Comment waits for the picture-making model; "replace in thread" not built (versions are new attachments); answer-block Edit is wired but off for web pictures (their licence); Erase mask tint is faint on teal areas.
- [ ] **IMGTOOLS-06: tests with real images** (M, Stack `tests/imageTools*.test.ts`, Home route tests, a browser flow).
- [ ] **IMGTOOLS-07: erase large holes at native resolution** (M, Stack worker, tiled second pass).
- [ ] **IMGTOOLS-08: compiled Apple helper as a release asset; Linux requirements** (S).
- [ ] **IMGTOOLS-09: hair, fur, glass test set; BiRefNet-lite for p64 and p128** (M, bench).
- [x] **IMGEDIT-01: edit a picture in words from chat** (L, `backend/src/lib/pictures/editTool.ts`, `editSources.ts`, `people.ts`, `jobs.ts`; Stack `38639d8`). Built 2026-10-17: `generate_image` with `change` changes a picture the person has (remove people, remove background, upscale, or any change in words, with an optional second picture); the model decides, Home picks the method ([design note](design/image-editing-2026-10-17.md), measured on the Studio: Klein 4B beats Qwen-Image-Edit-2511 on speed, memory and fidelity). The result is the next version of the picture (Original and Undo). Safety is the editor's: likeness rules for photos and references, finished-picture check. Tests `editPicture.test.ts`, `imageEdit.test.ts`, `mediaClaims.test.ts`.
- [x] **IMGEDIT-02: Comment takes a painted mask and a second picture** (S, API). `POST /api/image-edit/pictures/{id}/comment` accepts `mask` (white is changeable), `reference_id` and `reference_subject_person_id`.
- [ ] **IMGEDIT-03: live check of the chat edits on the Studio** (S). Real turns with the real chat model: "remove the man in the red jacket" (the reader picks the person), "make the sky clear", "add her to this picture". Not done: the author checked the Stack and Home halves separately, with fake Stacks on the Home side.
- [ ] **IMGEDIT-04: brush and reference controls in the kit editor Comment** (M, `commons` ui first, then a pin). The API is ready (IMGEDIT-02).
- [x] **IMGEDIT-05: sky, colour, background and object edits of photos that show several people** (S). Owner ruled yes 2026-10-17 (through the coordinator): the people are frozen, restored from the original after the edit and proved unchanged by a pixel check. Built in `people.ts` `freezePeople` and the `affects_people` argument; tested with an outline test and a full chat call.
- [x] **IMGEDIT-06: Klein masked fill for removed people** (S). Built: on a picture made here the chosen person's outline (Stack `people_mask`) is filled by the picture model, 2.6 s and cleaner than LaMa; uploads and failures use LaMa.
- [x] **PEOPLE-PROMPTS-01: one household setting for the extra questions and warnings about people** (S, `generation.people_prompts`, default off; `policy.ts`, `likeness/resolve.ts`, `model.ts` toolSpecFor). Built 2026-10-17: hard lines untouched and tested both ways; ask at most once per person and photo, never the model attesting; the model told not to hedge while off. Inventory in [the design note](design/image-editing-2026-10-17.md) section 7.
- [x] **TEEN-CREATE-01: teens create pictures and videos and edit pictures** (M, `lib/pictures/lane.ts`, `laneGate.ts`, `policy.ts`, `videos/policy.ts`, `editSources.ts`). Built 2026-10-17 on branch, **not on main until the CSAM floors land** (audit `data-scratch/csam-audit-2026-10-17.md`, owner of the floors: a0b32b8450921a4d6). Hard gates only: one short line for anything adult, all-ages styles, no one else's likeness, own photo non-sexual, fail-closed finished check. Tests `teenLane.test.ts`.
- [x] **KIDS-CREATE-01: children make cartoon pictures and videos of safe content** (L, `lane.ts`, `laneGate.ts`, `policy.ts`, `routes/pictures.ts`, `routes/videos.ts`, `lib/imageEdit.ts`). Built 2026-10-17 on branch, **not on main until the CSAM floors land**. Strict lane, on by default, switches and limits, no real people, fail-closed finished check, admin log. RULES.md rule 0 clarified in its own commit (Owner-approved: 2026-10-17). Tests `kidsLane.test.ts`. [Design](design/image-editing-2026-10-17.md) section 9.
- [x] **LANE-REVIEW-01: the independent safety review of the teen and child lanes, six findings fixed** (M, `routes/pictures.ts`, `routes/videos.ts`, `lane.ts`, `imageEdit.ts`, `editTool.ts`, `editSources.ts`, `kid_usage` migration 0108). No preview for a teen or child, edits counted and listed, Quick video model only, a stored atomic daily ledger, a wider child topic gate, a stranger's photo cannot be claimed by a teen. Tests `laneReview.test.ts`, `kidsLane.test.ts`, `teenLane.test.ts`. [Design](design/image-editing-2026-10-17.md) section 10.
- [ ] **KIDS-CREATE-02: the parent's page for what a child made** (M). The route exists (`/api/pictures/admin/kids-activity`); a page and thumbnails for owners and admins only are not built.

## Music generation (owner, 2026-10-17)

From [music-generation-2026-10-17.md](design/music-generation-2026-10-17.md): ACE-Step 1.5 (MIT, official MLX path) makes and edits songs in chat; `generate_music` and `edit_music` are conditional tools; adults only, written own-screen turns; no uploaded audio; licence-aware export. Carries MEDIA-HOST-03, the music part of CHAT-MEDIA-01 and Stack STACK-99.

- [x] **MUSIC-SPEC-01: music settings key and the generation provenance shape** (S, `commons` spec). Landed: commons `d89db1a`, tag `spec-v0.1.165`. `generation.music.enabled` (household, default on, on the `household.pictures` card retitled "Pictures, videos and music"), `generation-provenance.schema.json` (`GenerationProvenance`), `file.provenance.generation`, `StackJob.kind` names `music`; fixtures with roster personas, Python round trip, tag under the commons-tag lock, Home pin bump per `docs/PINNING.md`. Exit: commons `scripts/check.sh`, Home `bash scripts/check.sh --pre`.
- [x] **MUSIC-GEN-01: Stack music engine** (M, Stack `backend/src/music/*`, `lib/modelCatalog.ts`, `lib/engineCatalog.ts`, `lib/components.ts`, `lib/diskPlan*.{ts,json}`, `routes/music.ts`). The `music-gen` uv environment from ACE-Step's lock (commit `ca1e85f`), the JSON-lines worker (offline env, tiled VAE, MLX cache cap), the pins of section 3 with sizes and hashes, component `music` (group `music`, optional; p128 quick and detailed up to 240 s, p64 quick only up to 120 s; admission 33 GB, note section 4.2), `GET /stack/v1/music`. **Built and landed: Stack `e14e3a8`, `d216374`.** Mirror: `backend/src/video/*`. Acceptance: a 30 s song through the worker on the Studio under the bench lock, time and peak recorded. Exit: Stack `bash scripts/check.sh`.
- [x] **MUSIC-GEN-02: Stack music job API** (landed: Stack `e14e3a8`) (M, Stack `routes/musicGenerations.ts`, `music/jobs.ts`, `music/provenance.ts`). `POST /v1/audio/music` with the tasks of the note's section 12, stages, time left, cancel, 202, governor `generator` admission, the made-here ledger (`source_not_made_here`), trim, fade and loudness in the worker, AAC output. Acceptance: tests per task with a fake worker; one real run per task on the Studio. Exit: Stack `bash scripts/check.sh`.
- [ ] **MUSIC-GEN-03: Home music jobs, gates and tools** (L, `backend/src/lib/music/*`, `backend/src/routes/music.ts`, `backend/src/db/schema.ts` plus one migration, `lib/turnMachine/nodes/{policy,tool}.ts`, `turnMachine/budget.ts`). `music_jobs`, `musicDenial` over `pictureDenial`, the minor line on description, lyrics and title, `imitates_real_voice`, `generate_music` and `edit_music`, versions as attachments with `GenerationProvenance`, `/api/music/jobs/*` and `/api/music/files/:id` with the commercial check. Risky surface (age gates, migration): full `check.sh` and `code-review` at medium.
- [ ] **MUSIC-GEN-04: the MusicTrack card** (M, `commons` ui `elements/music-track.tsx`; Home `frontend/src/dev/elements-adoption.json`, `elementBindings.ts`). Elements decision row first; the Element owns the stages, the kit `Player` (audio layout), the lyrics, the version stepper (`stepVersion`), Download and Share; Home's `TOOL_BINDINGS` entry passes versions, the current id and the Use this version handler; Home's ui pin moves to the new tag (at or above `ui-v0.5.257`). Exit: commons check, Home `bash scripts/check.sh --pre` and the frontend tests beside the change.
- [ ] **MUSIC-GEN-05: music in Settings** (S). The key on the Pictures, videos and music card; the Models and storage row through COMPONENTS-01's route; the refusal lines in `pictures/policy.ts` and `videos/policy.ts` that name "Settings, Pictures and videos" follow the new title; the shared busy line in `videos/jobs.ts` names songs too.
- [ ] **MUSIC-GEN-06: verify end to end on the Studio** (M). A throwaway Home (ports 8893 to 8898, its own data dir) and scratch Stack: make a song, then every edit of the note's section 7, play each in the built-in browser, judge, screenshots at 1440 and 390.
- [ ] **MUSIC-GEN-07: chat tool bench rows and safety review** (S). Rule 1 budget rows for both tools; child, teen, guest, spoken and shared-screen refusals; the minor line on lyrics; the voice line.
- [ ] **MUSIC-GEN-08: privacy check** (S). Zero outbound connections from the worker during a job; the privacy page lists the music pins.
- [ ] **MUSIC-GEN-09: Save to Music and the Created by you shelf** (M, after MEDIA-LIB-01 and MEDIA-MUSIC-01). A `media-item` per saved version through the media record API; the shelf lists the person's made tracks; Share by the household share pointer.
- [ ] **MUSIC-GEN-10: ACE-Step 1.5 XL turbo as p128's detailed profile** (S, bench first).
- [ ] **MUSIC-GEN-11: Stable Audio 3.0 for beds and effects** (M, bench and licence gate first; tracks it makes are `personal_only`).
- [ ] **MUSIC-GEN-12: stems** (M). ACE-Step base `extract` or Demucs, licence read first.
- [ ] **MUSIC-GEN-13: a parent's per-child music switch** (M, design first: the band's lyric ceiling).
- [ ] **MUSIC-GEN-14: uploaded audio as a source** (decision for Jesse). A person's own recording, or a consenting household adult's voice, as a cover or reference source; refused until he rules.
- [ ] **MUSIC-GEN-15: check the sung words** (M, design in the note's section 5). ACE-Step invents half-sung words when the lyrics are shorter than the song; run the household's speech-to-text on a finished sung song and pass the transcript through the minor line before it is stored, withholding the song like a withheld picture with a fixed refusal line (a policy refusal, rule 6, never the model's words). The transcript is never stored or logged (rule 6a) and is dropped after the check. Bench rows with the 4.2 clips.
- [ ] **MUSIC-STUDIO-01: music studio app** (L, later; design note first). Versions timeline, region repaint, stems, lyrics beside the waveform; reuses the music Stack API and records.

## Media apps (2026-10-17)

Design: [docs/design/media-apps-blend-2026-10-17.md](design/media-apps-blend-2026-10-17.md) (Loki Doki's look and online and
offline behaviour blended with FileTube; the coworker who wrote FileTube lands the slices marked "coworker" in Home's stack).
Evidence: [media-apps-blend-2026-10-17-sources.md](design/media-apps-blend-2026-10-17-sources.md). Every app is a catalog `app`
package like Weather (APP-KIND-01 to 04); every record is the spec shape; kit primitives and tokens only (rule 9b). Exit for an
ordinary slice: `bash scripts/check.sh --pre` plus the tests beside the change; the device-token and offline routes are the auth
surface (full `check.sh`, `code-review` medium).

- [x] **MEDIA-SPEC-01: the media records** (S, `commons` `spec/`; first; done 2026-10-17, commons `1a9e87d`, spec-v0.1.162, Home pinned at spec-v0.1.163). Built: `MediaItem`, `MediaSource`, `MediaProgress`, `MediaCollection`, the `OfflineManifest` shape (KEEP-OFFLINE-01's spec part), `file.origin: fetched` with `provenance.media_source_id`, `feed.purpose`, `device.offline_scope`, the media job kinds, TRASH-01's `deleted_at` and `trash_until` on the media records, 18 fixtures, TS and Python round-trips; architect APPROVED. spec-v0.1.163 also carries `tts.voice_id`'s `default` so Home's settings drift check passes. Open: nothing. Objective: `media-item`, `media-source`, `media-progress`, `media-collection` schemas (design section 7), `file.origin` gains `fetched`, `feed.purpose` (news or podcast; `feed.kind` is the format since NEWS-00), `device.offline_scope`, Stack job kinds `media.fetch|probe|transcode|preview|chapter_snap|tts`. Pointers: `spec/schemas/file.schema.json`, `feed.schema.json`, `device.schema.json`, `stack-job.schema.json`; mirror how `file` replaced `attachment` (STORE-SPEC-01). Reuse check: the record envelope (`id`, `hlc`, `provenance`) and the existing `file`, `feed`, `device` records are extended, not duplicated; the `list` record was considered for playlists and rejected (design 15.5). Acceptance: one fixture per record passes ajv and the round-trip tests; Python regenerated; tag cut; Home pin bumped (`docs/PINNING.md`). Out of scope: any Home table. Exit: `commons` `scripts/check.sh`.
- [x] **MEDIA-STACK-01: the Stack `media` service** (M, `stack`; after MEDIA-SPEC-01; done 2026-10-17, stack `733e623`, `89a97cf`, `7949d00`). Built: `media.probe`, `media.fetch`, `media.transcode`, `media.preview`, `media.setup` on one idle-priority FIFO that never wedges, per-site quiet mode (four push-back failures, 30 minutes; a person's own fetch still runs), Home's folder declaration (`PUT /stack/v1/media/roots`), privacy rows, pinned jellyfin-ffmpeg 8.1.3-1 and yt-dlp 2026.8.19; contract in the Stack's `docs/integrations.md`. Acceptance adapted for RULES.md V1: the fetch is proven against a localhost fixture through yt-dlp's generic extractor, a local 429 server trips quiet mode; no request to any video service. Budget: probe 52 ms, transcode of a 60 s 720p HEVC clip 25.4 s, preview 3.2 s, localhost fetch 1.7 s. Open: Home's prober and fetch callers (MEDIA-LIB-01 probes; MEDIA-ONLINE-01 fetches). Owner ruling 2026-10-17 (design 15 C): the saved-video quality ceiling defaults to 1080p (`media.fetch` `quality` default `1080`); 4K only when an admin raises it. Objective: pinned ffmpeg, ffprobe and yt-dlp by sha256 through the reference service's download job (KS-STACK-REF-01 precedent), jobs `media.probe`, `media.fetch`, `media.transcode`, `media.preview` on the one idle lane with FileTube's never-wedge FIFO rules as tests, the per-host limiter and quiet mode (four failures, 30 min), privacy rows on `/stack/v1/privacy`. Reuse check: the Stack's existing download job, uv venv and job API; yt-dlp and ffmpeg themselves are the prebuilt parts. Acceptance: one public test clip fetched at a stated budget; a 429 fixture trips quiet mode; the FIFO never wedges under a cancelled job. Out of scope: any Home route. Exit: the Stack's `check.sh`; budget in the commit message.
- [x] **MEDIA-LIB-01: library roots and the scan orchestrator** (M, `home` backend; coworker; after MEDIA-SPEC-01). Objective: `media-source` kind `root` over `nas_mounts`, the scan orchestrator ported from FileTube (`lib/scan/orchestrator.js`: async walker, interval per root, overlap coalescing, unchanged path-and-size fast path, prune guards), parsers for TV (`Show/Season N/Show SxxEyy - Title.ext`), music tags (`music-metadata`), EPUB OPF, PDF, audiobooks (m4b chapters, a folder of mp3s as one book, series), ffprobe through the Stack job, `media-item` writes with `band_ok` at ingest, the duplicate finder. Pointers: `backend/src/lib/storage.ts`, `nas_mounts` in `backend/src/db/schema.ts`, `backend/src/lib/shelf/shelfPoller.ts` (the `band_ok` path). Reuse check: `music-metadata` for tags; ffprobe for streams; the orchestrator is ported because no maintained scanner gives prune guards and identity for mixed kinds. Acceptance: a fixture tree of every kind scans to the expected items twice with no duplicates; a removed root defers prune; tests beside each parser. Out of scope: any page. Exit: `bash scripts/check.sh --pre` plus the tests. **Built (ae439b87 on the branch, SHAs change on landing):** migration 0107 (all four media tables, schema version 64), `backend/src/lib/media/` (sources with the no-overlap rule, scan orchestrator with prune guards, parsers for TV, films with NFO, `music-metadata` tags with the iTunes advisory, EPUB, PDF, audiobooks, `Prober` with the Stack `media.probe` implementation and a fake in tests, `band_ok` at ingest, duplicate finder), `/api/media` routes (sources, items, groups, content with Range, artwork, duplicates), docs `docs/dev/media-library.md`. Dev doc and tests: `tests/media{Parsers,Scan,Routes}.test.ts`. **Open:** the Stack `media.probe` job's real input and result shape (read tolerantly by `probeResultFrom`; align when the Stack documents it); HEVC tagged `hvc1` counts as a transcode until the probe reports tags; sidecar subtitle files are not ingested (the spec subtitle needs a saved file); restoring a removed root from the trash; the item-level trash page.
- [x] **MEDIA-PROGRESS-01: progress, collections and the Continue provider** (S, `home` backend; coworker; after MEDIA-SPEC-01). Objective: `media_progress` and `media_collections` tables and routes, `mergeProgress` (newest wins after skew correction, rewind when newer, latches, marks union) with FileTube's offline-progress cases ported as tests, one liked, watch later and queue per person by construction, the `continue` provider the Home page's Pick up shelf reads. Pointers: `frontend/src/apps/home`, design section 10. Reuse check: the Home page shelf and the record envelope; nothing new is drawn. Acceptance: the merge table passes; a child's row is never written by another person's device; Pick up shows a media row. Exit: `bash scripts/check.sh --pre` plus the tests. **Built (04bd9c94 on the branch, SHAs change on landing):** `mergeProgress` (one definition, `lib/media/progress.ts`), write coalescing, a minor's row never written from another person's device, progress and collection routes, `lib/continue/` provider registry with chat and media rows (three-row budget, own rows only) behind `GET /api/continue`; tests `mediaProgress.test.ts` (the merge table) and `mediaProgressRoutes.test.ts`. **Open:** the Pick up shelf itself (HOME-ALIVE-01c is still unbuilt, no `frontend/src/apps/home` shelf exists to extend; it should read `GET /api/continue`); the `/media/<id>` link needs the shell to resolve it to an app; the offline route that posts FileTube's 200-event batch (MEDIA-OFFLINE-01) should call the same `POST /api/media/progress/batch` logic with a device token; a finished episode does not yet offer the next one.
- [x] **MEDIA-PLAYER-01: the kit Player, Billboard and the `play` action** (done 2026-10-17: commons `391ad17` spec-v0.1.164 and `62b0bd4` ui-v0.5.257, Home pinned. Built: kit `Player` on Media Chrome 4.19.3 (video, audio and mini layouts; chapters with skip intro and credits, storyboard previews, rate, captions, PiP, cast through Remote Playback, resume line, Up next countdown, Media Session, FileTube's gestures, keyboard, progress callbacks), `Billboard` on the kit carousel, `MediaShelf` progress, badge and running time, art and progress tokens, the `billboard` and `player` schema nodes, the `play` action through `MediaHostContext.onPlay`; UI-DECISIONS rows `player` and `billboard`. Shared kit pieces for News: MediaShelf, Billboard, the mini layout. Open: the shell provides `MediaHostContext` (AUDIO-SESSION-01 integration).) (M, `commons` `ui/`; after MEDIA-SPEC-01). Objective: kit `Player` primitive (video, audio and mini layouts, chapters, preview thumbnails, rate, captions, PiP, a cast slot, a resume slot, FileTube's gestures: double-tap 15 s, hold 500 ms for 2x, pull down to dock), the `Billboard` block composed from the kit's shadcn `carousel` with `embla-carousel-autoplay` (slides, autoplay paused on hover, hidden tab and reduced motion, a dwell preview slot), both as schema nodes, and the `play` action implemented in the interpreter (`commons/ui/src/schema/actions.ts:24` throws today). Reuse check (rule 9b order): Kibo UI's video player (built on Media Chrome) first, Media Chrome (Mux, MIT) second, Vidstack third, the first with a release in the last 90 days at adoption; `Billboard` builds on the existing `carousel` row (UI-DECISIONS, 2026-10-13); a UI-DECISIONS row for each before a line is written; Loki Doki's and FileTube's hand-built players are not carried. Acceptance: kit tests; a schema page with a `media_shelf` whose `on_select` plays; rule 9 lints clean; tag cut. Out of scope: the shell audio session (AUDIO-SESSION-01). Exit: `commons` `scripts/check.sh`.
- [x] **AUDIO-SESSION-01: one audio session in the shell** (S, `home` frontend; after MEDIA-PLAYER-01). Objective: one playing thing at a time across apps and chat voice, the docked mini bar, playback speed from the `audio.speed.<kind>` person settings, one sleep timer (15, 30, 45, 60 min, end of chapter or episode) that fades and pauses, Media Session metadata and handlers published once. Pointers: `frontend/src/shell/`, the spec settings registry (new keys, spec first). Reuse check: the kit Player's own Media Session support and rate menu; the shell only coordinates. Acceptance: two apps cannot play at once; the sleep timer pauses chat voice too; the keys show in Settings through `SettingsShell` (rule S4). Exit: `bash scripts/check.sh --pre` plus the tests. **Built (2026-10-17):** `frontend/src/shell/audioSession.ts` (the session), `audioSessionContext.tsx` (provider, `useAudioRegistration`, `useMiniBar`, `useAudioSessionState`, `useAudioPosition`), mounted in `Routes.tsx`; chat voice (`SentenceSpeechScheduler`, `StreamingWavPlayer`) registers as `spoken_reply`; keys `audio.speed.{podcast,audiobook,video,spoken_reply}` in `backend/src/settings/audioKeys.ts`, shown in the Voice card (Settings, Voice), listed in `aheadOfSpec`. **Open:** a Playback section and the four keys in the spec (`commons` areas.json and keys.json, then drop `aheadOfSpec`); a spec key for the sleep timer's default; the kit Player's `mini` layout and rate menu call `useMiniBar().controls` (MEDIA-PLAYER-01); a child does not see the speed keys until the minor snapshot lists them; spoken reply speed shifts pitch (Web Audio `playbackRate`) until the Stack can stretch time.
- [x] **MEDIA-VIDEOS-01: the Videos app package** (M, `catalog` then Home's bundled set; coworker; after MEDIA-LIB-01, MEDIA-PROGRESS-01, MEDIA-PLAYER-01, AUDIO-SESSION-01). Objective: `pages/index.json` (billboard, FileTube's home rows: continue, new from sources, recently added, more from X, liked, again), Library, Watch (`SplitView` with Up next), Watch later, History, `contributes.settings_area`, `min_role: child` with allowlist-only as the child default, `offline: "partial"` with its sentence, keywords. Mirror: the Weather app package (APP-KIND-05). Reuse check: kit `MediaShelf`, `MediaGrid`, `CardSizeSlider`, `Billboard`, `Player`; YouTube's layout per rule S2 in the cinema page tone by tokens. Acceptance: opens at `/apps/videos`; a saved copy plays and resumes; a child sees only `band_ok` items and no discovery rows; captures at 1440 and 390 in both themes opened and judged. Exit: `catalog` check plus `bash scripts/check.sh --pre`. **Built (SHAs change on landing):** the shared media-app host (`lib/media/appHost.ts`, `routes/mediaApps.ts`: `/api/plugins/<appId>/data/:dataId`, `progress`, `watch-later`, `like`, one factory per `MEDIA_APPS` id mounted ahead of the generic route, children allowlist-only with no discovery rows), the bundled `backend/packages/videos` package (kind `app`; pages index, library, watch, watch-later, history; settings area with links), the shell half (`MediaHostProvider` for the kit `play` action, `/media/<id>` resolution, query-to-state on a media app's page, Home tab, `MediaPlayerRegistration` into the audio session), copied to `catalog/apps/videos`; tests `mediaApps.test.ts`, `mediaApp.test.tsx`; docs `docs/user/watch-videos.md`, `docs/dev/media-library.md`. **Polish (MEDIA-POLISH-01, spec-v0.1.167 and ui-v0.5.261, commons 84c6b82 and 7696556):** the approved mockup's look through the kit: every page selects the cinema page tone (dark in both themes), frameless shelves with See all that are absent when empty (one empty line only when the library is empty), a 340 px banner billboard, chip tabs under a visible app title with icon buttons, a two-column Watch (`split_view` main and aside: the player with its title, Like and Watch later toggles, Up next as a vertical list), History, Watch later and Library as vertical lists, the docked mini bar (the media host owns the element, so leaving Watch keeps the video playing in the bar inside the media app's area, nothing over other apps, Close unloads it), and package app pages no longer draw the empty title bar. Captures with side-by-sides: `data-scratch/media-build/shots/videos-polish/`. **Open:** the channel row with avatar and Follow, On this phone and Play on TV buttons, the Chapters panel and the Subscriptions tab (each waits on its slice); a phone still shows the rail (MOBILE-RAIL-01, a kit gap, so the phone captures are not S1's layout); kid tones (KID-MODE slices); captions (no route serves `subtitles`); the Subscriptions tab waits on MEDIA-ONLINE-01; the settings area has no quality key until `media.preferred_height` exists; `offline` is `degraded` (the manifest enum has no `partial`).
- [ ] **MEDIA-ONLINE-01: web sources at a person's pace** (M, `home` backend; coworker; after MEDIA-STACK-01 and MEDIA-VIDEOS-01). Objective: `media-source` kinds `channel` and `link`, `POST /api/media/fetch {url, kind, quality}` writing a `file` with `origin: fetched` then a `media-item`, subscriptions polled at `poll_minutes` with `max_per_check` through the Stack job, `auto` rules (save, keep latest N, remove watched), the household quality ceiling and the person's preference, SponsorBlock chips per person (off for a child), the privacy page rows, `docs/user/videos.md`. Pointers: `docs/THIRD-PARTY-SERVICES.md`, `docs/PRIVACY.md`, FileTube `lib/ytdlp/{args,run,failures}.js` for the args and failure attribution. Reuse check: the Stack job and limiter; yt-dlp. Acceptance: one subscription with `max_per_check: 2` fetches two items and stops; the request budget is in the commit; a child cannot add a source; a login wall puts the host in quiet mode. Exit: `bash scripts/check.sh --pre` plus the tests. **Blocked (owner: Jesse, 2026-10-17):** nothing is built. Rule V1 and [live-video-2026-10-17.md](design/live-video-2026-10-17.md) section 10 put even the fixture-only build (stage 1) behind Jesse approving that note (decision D1), and section 9 puts this row's yt-dlp Save and channel polls under the same gate; the first real request is a separate approval in the moment (D3). The note also proposes reading channel uploads through the Data API instead of yt-dlp listing, which changes this row's design. Unblocks with: Jesse's D1 ruling on the live-video note.
- [x] **MEDIA-OFFLINE-01: device offline** (M, `home`; coworker; auth surface). Owner ruling 2026-10-17 (design 15 A): Go on iPhone, carrying FileTube's device-token protocol, is the native client of these routes. Objective: the device-scoped routes `GET /api/media/offline/manifest`, `GET /api/media/offline/file/:kind/:id` (Range, ETag, If-Range, 503 with Retry-After while a transcode queues, 409 when not playable), `POST /api/media/offline/status`, `POST /api/media/offline/progress` (200-event batches, skew correction, restamp) over Home's `devices` and `device_tokens` with the default-deny `offline_scope`, playability (original, transcode, none; HEVC only `hvc1`), transcode-on-save, the Chromium service-worker media bucket in `frontend/src/sw.ts` (no fetch handler on WebKit), Settings, Devices with Remove all, the hub-only offline copy. Pointers: FileTube `lib/offline/{routes,playable}.js`, `lib/auth/{devices,device-scope}.js`, `docs/references/offline-api.md`; Home `backend/src/lib/attachments.ts`. Reuse check: Home's device pairing and tokens; Cache Storage; Media Chrome's playback of a cached URL. Acceptance: FileTube's offline integration tests ported; a WebKit user agent gets no fetch handler; a revoked token gets 403 everywhere; tokens absent from a backup. Built: `devices.offline_scope` (migration 0108), `requireDeviceScope`, `/api/media/offline` manifest, file, status and progress, token re-check on every call, tokens emptied from backup snapshots, password change revokes device tokens, Chromium-only cache route and `offlineMedia.ts`, Devices switch and Remove all. Open: "Remove all devices" (one shared revokeDeviceCredentials for password change and a Remove-all action), transcode-on-save (Stack `media.transcode`), `offline.records` routes and KEEP-OFFLINE-01, full gate and medium code review before landing. Docs: `docs/dev/media-offline.md`, `docs/user/keep-on-this-device.md`. Verified by narrow runs: mediaOffline 15 pass, related backend files 120 pass, frontend offline, sw and Devices tests pass, tsc and lint:ui-rules clean.
- [x] **MEDIA-PODCASTS-01: the Podcasts app package** (M, `catalog`; coworker; after MEDIA-VIDEOS-01). Objective: `feed.kind: podcast` through the KS-05 shelf poller (feedsmith reads chapters, transcript, persons, explicit), stream by default and save on request or by `auto`, per-source speed and skip seconds, bookmarks as `media-progress.marks`, OPML in and out through the feed-list import, Listen now, Shows, Episodes, Queue, Saved pages; Apple Podcasts' layout. Reuse check: the one poller; the kit Player audio layout. Acceptance: a real feed's newest episode streams, saves and resumes; conditional GET proven; a child's explicit episode hidden. Exit: `catalog` check plus `bash scripts/check.sh --pre`. **Built (SHAs change on landing):** feeds with `purpose: "podcast"` through the one shelf poller (migration 0112: `feeds.purpose`, `attachments.origin`, `attachments.media_source_id`; the shared `guardedGet`), episodes as `media-item` rows under a `feed` media-source, stream by default (the enclosure address, played on the person's device), Save into the household file store as `origin: fetched` (adults), keep-latest and remove-played rules, deleted stays gone, queue, bookmarks as marks, per-show skip seconds and speed fields, OPML in and out, the bundled `backend/packages/podcasts` package (Listen now, Shows, Episodes, Queue, Saved, Listen with the dock), the privacy row `platform:podcast-feeds`; tests `backend/tests/podcasts.test.ts` (in-memory fixture feed: newest episode lists and streams, saves and resumes, conditional GET 304, keep-latest, child never sees explicit, OPML round trip); docs `docs/user/podcasts.md`, `docs/dev/media-library.md`. Captures with side-by-sides: `data-scratch/media-build/shots/podcasts/`. **Review fixes (2026-10-17):** fetched file owner/admin access with media-item gates for playback and art, fetched-only owner/source dedupe, OPML due-only import, queued and coalesced keep rules, streamed saves with early and ongoing cap checks, copy-owner/admin Unsave through restorable 30-day Trash, News purpose-conflict and sync-failure isolation, https enclosure preference, five enclosure redirects, unsubscribe art cleanup, and accurate privacy text. Focused fake-fetch regressions in `podcasts.test.ts`. **Open:** an admin form for adding a show (package pages have no text input; API only), per-show speed is not applied by the player, transcripts and persons (no `media-item` field), compact list rows with Play and Save buttons (kit size), the offline banner of the mockup (shell), and a catalog sync.
- [ ] **MEDIA-MUSIC-01: the Music app package** (M, `catalog`; coworker; after MEDIA-VIDEOS-01). Objective: Albums, Artists, Songs and Liked as derived views over `media-item` (no album or artist tables), manual playlists, the shared queue, FileTube's local radio (similarity tiers over the person's own tags), explicit masking for a child; Spotify's layout. Reuse check: kit `MediaShelf` square aspect, the Player audio layout, `media-collection`. Acceptance: a scanned album plays through in order; radio from a seed stays inside the person's library; explicit masked for a child. Exit: `catalog` check plus `bash scripts/check.sh --pre`.
- [ ] **MEDIA-BOOKS-01: the Books app package and the kit Reader** (M, `commons` then `catalog`; coworker; after MEDIA-VIDEOS-01). Objective: kit `Reader` on epub.js and pdf.js (themes by tokens, font size, TOC), reading position as a locator plus percent, read-aloud from the current block through the Stack `tts` role with FileTube's block chunker (espeak and Piper dropped), audiobooks with chapters and series, listen-and-read linking on one detail page; Apple Books' layout. Reuse check: epub.js and pdf.js (both MIT, as FileTube vendors them); the kit Player audio layout for audiobooks. Acceptance: a book resumes at its CFI; an m4b lists chapters and resumes mid-chapter; read-aloud passes the child floor. Exit: `commons` and `catalog` checks plus `bash scripts/check.sh --pre`.
- [ ] **MEDIA-SHOWS-01: the Shows and Films app package** (M, `catalog`; coworker; after MEDIA-VIDEOS-01). Objective: Netflix's layout (billboard, poster shelves, detail hero, seasons, episode list with progress), skip intro and credits from the file's chapters, the next-episode offer, a watchlist (`media-collection` kind `watchlist`); no online metadata by default (NFO read if present, never written). Reuse check: kit `Billboard`, `MediaShelf` poster aspect, `DetailPane`, `Player`. Acceptance: a fixture show of two seasons; the next-episode offer; captures judged. Exit: `catalog` check plus `bash scripts/check.sh --pre`.
- [ ] **MEDIA-KID-01: kid mode hooks for media** (backend and minimum frontend hook; design section 11). Built: person `media.allowlist_only` (child default, admin override, minor set/reset refusal), source and discovery gates, explicit masking tests for Child and Teen controls, persistent progress-based metering across kinds/devices, local-midnight reset, household audio exemption, private budget read, admin-only same-day extension, once-per-day generic admin notification, kid copy constants and `useMediaBudget` hook. The design's `media.daily_minutes` is the existing `allowance.media.daily_minutes`; no second key. Open: `media.allowed_hours` needs a shipped time selector, player pause/tick/resume and extension refresh wiring in each app, and ask-a-grown-up through the one Ask record. See `docs/dev/media-library.md` (Kid mode) and `docs/user/kids-and-media.md`. Also open: unverified web items adult-only until an adult marks them (no web items exist yet); `media.budget.exempt_bedtime_audio` is an expert key until a spec areas tag gives media a household group. The migration is 0109, stacked on OFFLINE-01's 0108 (its first commit is cherry-picked here and drops out when OFFLINE lands first); schema version 66. Metering keys on the hashed auth session plus the item, never a client field; cursor rows prune after 2 days and cap at 200 per person. Metering ignores client flags and stamps (server clock, forward advance, cap). Residual: a player that reports a frozen position while playing is not counted; the server cannot see the screen. Verified by narrow runs: mediaKid 13 pass, ten related backend files 202 pass, frontend hook 3 pass, tsc and lint:ui-rules clean; no full gate. Review fixes (security review items 2 to 10, calm-falcon-media-kid): content bytes return 403 `media_time_up` once a minor is exhausted; a 60-second client tick counts up to 120 s of forward movement (seeks keep the 12 s cap); the time-up notice names the child and now covers teens with a budget; the Media allowance `control` is written once in `allowanceKeys.ts`; wire-only `playing`/`seeking` fields removed; `minorMayKeepOffline(person)` and `mediaTimeUpRefusal(person)` exported for OFFLINE-01 to call. Open, so the row stays unticked: `media.allowed_hours`, player pause and tick wiring, an extend action on the time-up notice (the notification registry has no actions yet), ask-a-grown-up, the landing rebase (drop 19f975cb), and unverified web items. Metering test count: mediaKid 22 pass.
- [x] **KEEP-OFFLINE-01: "Keep on this device" for any record** (S, `home`; after MEDIA-OFFLINE-01; design section 12). Objective: one `offline-manifest` shape (spec first) served by `backend/src/lib/offline/` for any record kind that registers a provider (media first; the reference library's pages, a conversation export and a news story's cached body next), the shell's one "Keep on this device" action, the Settings, Devices page listing copies per device. Reuse check: the media offline routes become the generic ones; no second cache. Acceptance: a news story kept on a Chromium device opens with the network off. Exit: `bash scripts/check.sh --pre` plus the tests. Built: `lib/offline` provider registry and media provider (manifest and byte logic moved, legacy routes retained), generic `offline.records` manifest and file routes, shared shell action helper, kind-aware copies in the existing person bucket, SettingsShell Devices with kind labels and Remove all. Open: News has no saved-body-and-picture reader in `lib/news`, so no `news_story` provider or offline News acceptance test; reference and conversation providers and app action use sites remain open. Backend route tests are authored but execution is blocked by this sandbox's TCP restriction in the shared test preload. Registry unit test passes through the frontend test harness without a TCP fixture. Both typechecks and the narrow frontend tests pass. The brief overrides the broad exit gate with narrow tests only.
- [ ] **SAVE-TO-HOME-01: the share target and the extension route** (S, `home`; after MEDIA-ONLINE-01). Objective: a `share_target` in the PWA manifest and one `POST /api/share` that takes a URL, text or file and routes by kind (a video link to media fetch, an article to read later, a picture to chat), the composer's "Save a link", and the same route for a browser extension with a person API token (`person_api_tokens`). Reuse check: the PWA share target standard; `person_api_tokens`; the media fetch route. Acceptance: sharing a video URL from Android saves a copy; a child's share goes to a parent's approval. Exit: `bash scripts/check.sh --pre` plus the tests. **Blocked (owner: Jesse, 2026-10-17):** waits on MEDIA-ONLINE-01, which waits on Jesse's D1 ruling on [live-video-2026-10-17.md](design/live-video-2026-10-17.md); its acceptance is a shared video link saving a copy.
- [x] **TRASH-01: one household trash** (S, `home`; design section 12). Built the provider registry for media items and collections, envelope restore, permanent purge with source archive retention, boot and six-hour expiry sweep, authenticated OpenAPI routes, and Settings, Storage, Trash with confirmed deletion. Backend and frontend tests cover restore, purge/rescan, expiry and child isolation. Open: migrate `lists.deletedAt` and memories to the envelope and add their providers; subscription archive enforcement awaits the subscription writer. Verified by narrow runs: backend trash 6 pass, mediaScan and mediaProgress 53 pass, frontend TrashPage 4 pass, tsc and lint:ui-rules clean, OpenAPI regenerated. Not landed: awaiting the gate.
- [ ] **HANDOFF-01: Continue here and play on another screen** (S each, `commons` then `home`; after MEDIA-PROGRESS-01; design [media-handoff-2026-10-17.md](design/media-handoff-2026-10-17.md), architect-approved 2026-10-17). Objective: a playing screen publishes `media-presence` `{media_id, position_s, playing, updated_at}` on its `device_states` row every 4 s (gone after 10 minutes, never in logs or admin views); another device of the same person shows one "Continue here" row per media app index; "Play on another screen" sends a `play_media {media_id, position_s}` device command (60 s expiry) over the existing device WebSocket to one of the sender's own screens, the kit cast slot's first target. Same person only (NO-CROSS-USER-VISIBILITY-01); the receiving person's band, allowlist and daily budget apply. Slices: **01a** spec (`media-presence`, `robot-state.media`, `play_media`, `action.play.position_s`, tag); **01b** Home backend (migration, screen rows, `PUT /api/devices/me/media`, `GET /api/devices/screens`, `POST /api/devices/{id}/play`, socket admission, `mayCastTo`, `continue_here`; full `check.sh` and `code-review` medium); **01c** kit (`onPlay` position, `castTargets`, `castTo`, the player node's cast menu, tag); **01d** Home frontend and the Videos page (screen registration, one-tab socket, 4 s presence, the Continue here shelf). Order: 01a, then 01b and 01c, then 01d. Acceptance: a phone hands a video to the desktop at the same position; a child's card never shows on an adult's profile on a shared TV, nor the reverse. Exit: per slice in the note's section 8.
- [ ] **MEDIA-GO-01: Go renders the media packages and carries the native offline half** (Owner ruling 2026-10-17, design 15 A: the coworker's FileTube iOS app becomes Go's iPhone half, one iPhone app for the household.) (M, `go`; coworker with the Go client's owner; last; depends on APP-KIND-06). Objective: the five packages' pages in Go, the `Player`, `Billboard` and `Reader` nodes natively, the device-scoped offline routes from FileTube's iOS app (Swift) on iPhone, Apple TV without the download UI. Acceptance: an iPhone keeps an album offline, plays it in airplane mode, syncs progress on return. Exit: Go's own check.

## Intelligent UI answers (design review 2026-10-08)

The accepted direction in `data-scratch/design/INTELLIGENT-UI-DESIGN.md` is a closed, spec-defined set of typed answer blocks produced by tools, validated and floored by Home, and rendered by kit Elements. The model supplies tool arguments and prose, never display code. Commons-first items land before Home uses their spec or kit changes.

- [ ] **KIT-GENUI-01: add multi-series charts** (M, small; commons spec and kit). Add `series_chart` for multi-series area and line charts with axes and a legend, composed over the kit chart primitive. Evaluate assistant-ui Tool UI's chart for vendoring. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **KIT-GENUI-02: add headline stats and split bars** (S, commons spec and kit). Add `stat` with headline, delta and tone, plus `split_bar`, using kit Elements. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **KIT-GENUI-03: add media lists** (S, commons spec and kit). Add numbered media rows with thumbnail, title, text and a meta line. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **KIT-GENUI-04: add tabs and swatches** (S, commons spec and kit). Add a one-level `tabs` container referencing child block ids, plus `swatches`. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **GENUI-06: add deterministic calculators** (M, commons spec and kit, catalog). Add named formula interpreters in TypeScript and Python, a calculator Element with inputs and live recomputation, and a `calculate` package. Fold it into or replace `math` so the offered tool count does not grow. Exit: `bash scripts/check.sh` and interpreter coverage.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **GENUI-07: add picture-backed recipes and plans** (M, Home packages). Return `media_list` blocks with per-item pictures proxied by Home, using Wikimedia through the existing picture path. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **KIT-GENUI-05: add place cards and schematic maps** (S, commons spec and kit). Add `place_cards` with a card carousel and a `map` kind on `map-answer` using latitude/longitude projection, with no network access. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **GENUI-08: add local place lookup and itinerary blocks** (M, Home packages). Add a `places` tool using existing OpenStreetMap or Wikidata lookup paths and privacy rows; return place cards and a schematic map. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **GENUI-09: add an optional offline regional map** (M, commons and Home; after owner choice D1). Use PMTiles and MapLibre with local region data, privacy-listed local services and a range-capable hub tile route. Keep GraphHopper for routing; Valhalla only if public transit or multimodal routing becomes a priority. Exit: `bash scripts/check.sh` and local map verification.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **GENUI-10: add filter chips and labelled pictures** (S, commons spec and kit). Add `filter_chips` and a labelled-picture block with hotspots sourced from data. The exploded drawing itself is out of scope. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **GENUI-11: measure an optional model-laid-out block tool** (M, Home; only if owner choice D2 allows). Consider a flat, shallow `present` tool for tables, text tabs and comparisons, adults first. Measure valid-on-first-try rate, right-tool rate and prose regressions on CHAT-AB-01 before offering it. Exit: bench results and `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **GENUI-12: render answer blocks on Go and the robot** (S each; later). The robot stores blocks and speaks `alt`; Go adds native renderers per supported kind, with unknown kinds falling back to `alt`. Go work follows the rest of the answer-block contract. Exit: `bash scripts/check.sh` in each repo.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **ELEMENTS-MIGRATE-01: replace hand-built non-chat UI with kit primitives and blocks, then delete it** (L, split into S or small M slices per screen; owner direction 2026-10-08; rule 9b). Objective: every non-chat app screen and component that duplicates a shipped kit primitive or `shadcndashboard` block is rebuilt on it and the hand-built version deleted in the same slice (port before delete). Excludes `frontend/src/apps/chat/**` and `ChatPage.tsx`; those stay with ELEMENTS-ADOPT-01 and 02. Inventory first: grep `frontend/src` for raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>`, `<dialog>` and direct `@base-ui/*`, `radix-ui`, `sonner`, `cmdk`, `vaul` and `recharts` imports, one sub-line per screen. A part the set lacks is added to the kit first, and needs a row in `docs/design/UI-DECISIONS.md` (the first slice that needs one creates the file). A wrapper whose body is a hand-built replacement belongs here; an override or wrapper on a kit part that stays belongs to RULE9-CLEANUP-01. Acceptance: every converted site leaves the kit-classname, kit-css and kit-wrapper baselines (the three JSON files under `frontend/src/dev/`), which only shrink; before and after captures at 1440 and 390 in both themes opened and judged; age bands unchanged. Exit: `bash scripts/check.sh` per slice.
    Design: [RULES](design/RULES.md)
- [ ] **RULE9-CLEANUP-01: bring every className, CSS and wrapper override on a kit Element up to rule 9** (M, split by directory; owner direction 2026-10-08). Objective: no `className` that changes shape, border, radius, shadow, background, padding, margin, size or layout on a kit Element or its parts, no Home CSS on a kit `data-slot` or `aui-*` part, and no Home wrapper around an Element. Fix by tokens and the Element's own props and variants, or add an additive prop or variant in `commons` first. Chat directories go through ELEMENTS-ADOPT-01 and 02. A site that cannot be fixed gets a row in `docs/design/ELEMENTS-DECISIONS.md` with its reason, who decided and the removing slice; no new baseline entry. Acceptance: the kit-classname, kit-css-override and kit-wrapper baselines drop by the count fixed, never rise; captures of every touched screen opened and judged. Exit: `bash scripts/check.sh` per slice.
    Design: [RULES](design/RULES.md)
- [ ] **PLACE-WEATHER-01: weather answers for the person's own places, with Current location first** (M, after PLACE-HUB-01; before GENUI-04; supersedes the open WEATHER-LOC-01 row). Objective: the weather package declares `weather.places` and `weather.default_place` (person scope, selector `location`, default `[]` and `"current"`) in its manifest `config[]`; `args.place` becomes optional with the tool description saying to omit it when the person names no place; the recipe accepts resolved `latitude` and `longitude` and then skips the geocoding call; Home's weather card, widgets, warm keys and chat turns all get their place from `resolvePlace()`; the web client attaches Current location to a turn only when permission is already granted and the person's weather default is `"current"`. Pointers: `catalog/plugins/utilities/weather/manifest.json` (update its `warm_on` to `household.home`) and `recipe.json`, `backend/src/lib/homeCardQueries.ts`, `frontend/src/homeCardQuestions.ts`, the turn request in `backend/src/routes/turn.ts`. Mirror: `lib/widgets.ts`'s current call into the plugin runner. Reuse check: the browser Geolocation and Permissions APIs; Open-Meteo already takes coordinates, so no new service. Privacy: outbound to Open-Meteo stays the only one; rounded coordinates replace the place name when known (two decimals, about 1 km, for teens and adults; one decimal for a child; owner, 2026-10-08), and the manifest's `data_sources.what` and the privacy page row change in the same commit; Incognito offers no save; no location in a log line. Resolved `lat`/`lon` are injected by the host at the recipe call, never model-proposed tool arguments, so they are not in the persisted tool call or turn record; the model supplies only `place`. What stays from WEATHER-LOC-01: named place wins, tap-only browser ask, nothing stored without an action, teen private, Incognito stores nothing, no log line, no new outbound, spec first, `describeSetting` copy, kit `SettingsShell`, tests per band, captures. What WEATHER-LOC-01 loses: its single "Default location" text key, its order with the browser last, and "a child's value is visible to the guardian" (replaced by the owner's no-location-without-a-share rule). Acceptance: per band tests; a test that a turn with no named place and no default uses Current location when supplied, else the household home; a test that no coordinates appear in the stored conversation, tool call, trace or log; a test that the outbound Open-Meteo request carries two decimals for a teen and an adult and one decimal for a child (owner, 2026-10-08); `isFixedHomeCardQuery` re-derives from the resolver; captures of the weather card at 1440 and 390 in both themes opened and judged. Exit: `catalog` check plus `bash scripts/check.sh`. (code landed 2026-10-16, row stays open for the weather-card captures and the catalog copy; Home: weather manifest `weather.places` and `weather.default_place`, recipe latitude and longitude, host-injected coordinates never in the model call, stored call, turn row, logs or package cache, client attaches Current location only when permission is already granted and the default is "current". 2026-10-17: the stale no-place runner test now expects the plain needs-place result (WEATHER-HOME-ASK-01). Open: the `catalog` weather copy pins spec 0.1.17 and waits on a catalog spec pin bump; the weather card and its captures belong to WEATHER-CARD-01 and WEATHER-APP-01.)
    Design: [weather-card-and-app-2026-10-16](plans/weather-card-and-app-2026-10-16.md)
- [ ] **PLACE-MAPS-01: the maps app gets its own place list and Current location** (M, after GENUI-08, GENUI-09 (owner choice D1), KIT-GENUI-05 and PLACE-HUB-01). Objective: the maps package declares `maps.places` and `maps.default_place` (person scope, selector `location`) in its manifest; the map opens on the person's default (Current location when granted, else the household home); the switcher lists Current location, the fixed household Home entry, then the person's maps list; "Save as a place" from a pin or Current location writes an Entity with `geo`. Pointers: the GENUI-09 maps package and its kit map Element, `backend/src/lib/places.ts`. Mirror: PLACE-WEATHER-01's manifest keys. Reuse check: MapLibre and PMTiles from GENUI-09 and its offline FTS5 geocoder for search; no new map or geocoder code. Privacy: offline, no outbound; a child sees the area at town zoom with no exact pin and no directions from Current location; Incognito offers no save. Acceptance: per band tests; a test that a place in both lists is one entity; captures at 1440 and 390 in both themes opened and judged. Out of scope: routing changes. Exit: `bash scripts/check.sh` and local map verification.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **PLACE-ELEMENT-01a: the household home is edited with kit parts only** (M, right after PLACE-HUB-01 and ADMIN-HOME-SETTINGS-01; lands with PLACE-HUB-01's pin bump). Scope: the `household.home` field and the location selector, in Home settings > General. **PLACE-ELEMENT-01b** is the weather and maps lists (after PLACE-WEATHER-01 and PLACE-MAPS-01). The text below covers both; each half takes the parts it names. Objective: the kit's settings field table maps the `location` selector to shipped parts: a Command-in-Popover search to add, the `List` primitive for entries, a DropdownMenu per entry for rename (Dialog with Input), move up, move down and remove (DestructiveConfirm), a Select for the default with "Current location" first, and a "Use current location" Button that is the only thing that opens the browser prompt. The person's lists render in each app's own settings area (weather's gear, maps' gear); the household home renders as the `household.home` field in Home settings > General, admins only, showing the label in use and that everyone falls back to it. Pointers: `commons/ui/src/settings/SettingField.tsx` (the selector table), each package's manifest `contributes.settings_area` (S4), with `areas.json` only if it already holds those areas, verified first, Home's `frontend/src/shell/pages/settings/`. Mirror: the `person` selector with `range.multiple`. Reuse check: every part is shipped in the kit (`command`, `popover`, `List`, `dropdown-menu`, `dialog`, `select`, `DestructiveConfirm`); reorder uses menu items, not a new drag library; added in `commons` first if a variant is missing (rule 9). Privacy: no one but the person sees their lists, a child's included; there is no admin or parent view of any person's places anywhere (owner rule 2026-10-08); copy through `describeSetting`; no `className` on a kit Element. Acceptance: ELEMENTS-LINT-02/03 and kit baselines do not grow; tests for add, rename, reorder, remove and default per band; a test that the browser prompt opens only from the button; captures of both lists and the Home settings card at 1440 and 390 in both themes opened and judged. Exit: `commons` check, pin bump, `bash scripts/check.sh`. (code landed 2026-10-16, row stays open for the captures: ui-v0.5.233 `LocationField` and `PlaceAdapter` in commons; Home pins it, draws `household.home` in Settings > General, and `household.home_place` is gone. 01b, the per-person lists, is built in the kit (`LocationField`, multiple) and Home keeps person location keys out of generic cards (`visibleRegistry`); Home has no package `contributes.settings_area` plumbing yet (`settingsAreas.ts` reads only `areas.json`), so it waits on the manifest `settings_area` plumbing, WEATHER-APP-01 and PLACE-MAPS-01 for placement.)
    Design: [weather-card-and-app-2026-10-16](plans/weather-card-and-app-2026-10-16.md)
- [ ] **PLACE-SHARE-01: a person can share one place or one list with a named person, and stop sharing it** (M; spec half after PLACE-SPEC-01 in `commons`, hub and UI half after PLACE-HUB-01 and PLACE-ELEMENT-01; owner rule 2026-10-08). Objective: per PLACES-DESIGN decision 10, `share.schema.json` gains optional `place_id` and `place_list` subjects beside `file_id` (exactly one, enforced in `validate.ts`; for places `to` is one person, the sharer is the owner, no re-share). `to` must be an active household person. A child's share is bounded by the consent floors, as STORE-SHARE-01 (a child cannot share outside the household), the hub stores and enforces them in `lib/places.ts`, and each place and list gets Share and Stop sharing. Pointers: `commons/spec/schemas/share.schema.json`, `spec/records/ts/validate.ts`, Home's file-share store and routes (STORE-SHARE-01, `lib/shares.ts`, `lib/access.ts` file-visibility predicate), `backend/src/lib/places.ts`. Mirror: STORE-SHARE-01's pointer record and its delete-on-unshare. Reuse check: the existing Share record and its store, extended rather than a second share system; UI from kit parts only (DropdownMenu item, a person `Select`, DestructiveConfirm for Stop sharing, a `Badge` for "Shared with" and "Shared by"). Privacy: default off; no admin override; Current location cannot be shared; a child's share carries the child's rounding; shares and their recipients never go to a log line; no outbound. Acceptance: spec fixtures (valid place share, valid list share, invalid two subjects, invalid `to: household` for a place, invalid re-share); hub tests that a recipient sees a shared place read-only and loses it the moment it is revoked, that a shared list shows current contents, that nobody else (owner, admin, parent) sees it, and that a child's shared place has one decimal; a child recipient of an adult's shared exact place sees one decimal (rounded on read); both sides show the share; captures of the share menu and both badges at 1440 and 390 in both themes opened and judged. Out of scope: sharing Current location live. Exit: `commons` `scripts/check.sh`, pin bump, `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **WEATHER-APP-01: a Weather app package: current location plus saved places, animated hero from the `weather_card` Element** (L, after WEATHER-CARD-01, PLACE-WEATHER-01 and the package `app` kind; owner 2026-10-16). **Slice 1 landed 2026-10-17:** the bundled `weather` package (0.3.0) is an app: `pages/index.json` (picker with Current location first, then the household home as "<name> (home)", then the person's own saved places; the hero is the `weather_card`), `contributes.data` (`places`, `forecast`), `keywords`, the declared `settings_area` for the person's places and default, offline and error states in plain words (the page's empty state), Open-Meteo only, coordinates rounded by the hub (`lib/apps.ts` `savedPlaceRows`). Tests: `backend/tests/weatherApp.test.ts`. **Landed 2026-10-17 (a):** `GET /api/apps` carries the package's `settings_area` (role-gated), install refuses a bad one (built-in id, another app, settings not the package's own), the shell opens `/settings/weather` from a Settings gear in the app toolbar (the kit place picker for the person's places and default; Incognito saves and searches nothing; saved coordinates rounded to two decimals; a minor sees their own list), back goes to the app; removing a place unlists it but leaves the place record (no delete hook in the kit adapter yet). Also landed: saved places edited from the app's gear (package `settings_area`, commits 1c265d54 and 6129b681), the card's `wide` variant with the hourly strip for package pages (ui-v0.5.240, pin 6b370003). Closed 2026-10-17 (follow-up): (a) a confirmed Remove on a person's own saved place now also deletes the record, a tombstone with its clock stamp through `DELETE /api/entities/:id` (kit `PlaceAdapter.remove`, ui-v0.5.241; the household home is never deleted from a list, Incognito deletes nothing), (b) the schema `picker` is `max-w-3xl`, the same width as the wide card, (c) the `weather.unit` key and recipe `unit` input are ported into `catalog/plugins/utilities/weather` (catalog b85487c) and Home's bundled copy is refreshed from it, so the next refresh keeps them, (d) `GET /api/widgets/weather/current/data` carries the `weather_card` block as an additive `card` field for an adult (`widgetCardBlock`), and the Home Today row draws the kit's compact card from it (a child or teen, or no block, keeps the text item). Captures (clear day, rain night, snow at 1440 and 390, both themes, plus the offline state and the settings page) are in the session scratchpad `weatherapp-shots`, opened and judged 2026-10-17.
    Design: [weather-card-and-app-2026-10-16](plans/weather-card-and-app-2026-10-16.md)
- [ ] **WEATHER-HOME-ASK-01: the household learns where home is once, on first use, and plain "weather" needs no follow-up** (S; owner calls 2026-10-17: capture on first use, no setup screen or wizard page; browser location is allowed but only on a tap). Found live: "what's the weather like today" on a new v0.2.3 install called `weather` with no place and ended in the generic failure copy. Landed: (1) `weather` with no place is a plain result the model words, not `bad_arguments`; (2) Home page card `HomePlaceAsk` shown while `household.home` is unset: an owner or admin gets a "Use my location" button (one `navigator.geolocation` call on tap, the browser's own prompt, secure origins only: localhost or https) and a typed city field; both resolve in the offline city-timezones gazetteer (`GET /api/places/nearest`, `/api/places/local-search`; no outbound geocoding, no IP lookup), the person confirms "Chicago, Illinois?" and it saves as the household place and `household.home` (server-side owner or admin gate in `createEntity`). A teen, child or other non-admin sees "Ask a grown-up to set the home location". Coordinates are rounded to 2 decimals before they leave the gazetteer or are stored; raw device coordinates are never stored. Still open: (a) the same ask inline in the chat reply (a form block needs a kit Element in `commons` first, rule 9), (b) ZIP codes (the gazetteer has no ZIP table; a city and state works), (c) device-only use for a non-admin without saving household-wide (belongs to PLACE-WEATHER-01 Current location), (d) a failed turn naming its known cause instead of the generic copy (needs the failure kind carried to `failureCopy.ts`). Acceptance: a fresh install with a home set answers "weather" with the home's forecast and no question back; with none set the reply says what to do.
- [ ] **ROUTER-RLCD-01: bench a constrained-decoding classifier as the router** **Rewritten 2026-10-02 for chat rule 1.** Scope is cut to the exact-match command openers only. A constrained-decoding classifier never decides a search or a tool (the model does, under `tool_choice: "auto"`), and a learned component never sits in the safety, consent or privacy path. Measure only whether it adds anything over the exact-phrase openers; if it adds nothing, close the item with the numbers in `docs/dev.md`. Every part below that benches it as a lookup or tool router is history. (M, a bench with a runbook, owner-authorized 2026-09-22). The candidate is `harshatheg/Qwen-2.5-1B-RLCD` (Qwen2.5-1.5B-Instruct fine-tuned for constrained JSON decoding: structured extraction, decision routing and categorical classification; Apache 2.0; 68 to 270 ms per decision on an M4 Max through MLX with 100 percent schema validity, per its card). Objective: measure it on the routing corpus (`backend/scripts/bench/datasets`, the routing rows, plus ROUTE-FIND-03's rows) against the current router (the rules and the chat model's fallthrough) for route accuracy, per-turn latency and schema validity, on the dev Mac through `mlx-lm` in a throwaway venv under the data directory (never installed globally), with the routing schema as the constrained output (route id, the package's args, a confidence). Rules: the org's learned-component rule (RULES-AND-LEARNED-COMPONENTS.md): it may take the router and the judge's extraction, never the safety, consent or privacy path; the model is fetched pinned by revision and sha256 and never tracked. Second candidate, same bench, added 2026-09-22 (the owner's find): `convaiinnovations/laya`, a ModernBERT-large backbone (421M English, 322M multilingual) with a decision head, Apache 2.0, safetensors, trained by the same RLCD idea but non-autoregressive: one forward pass returns a typed answer with a calibrated probability (their numbers: about 33 ms on a T4, 193 to 464 ms on CPU), which is the shape a router wants and the shape RVW-2 already asks for ("a MiniLM or ModernBERT-class encoder"), so bench it for BOTH the router and the turn-signal head; on this Mac it runs through PyTorch MPS or a converted ONNX or MLX build, and the bench records which path was used and its per-decision latency. The calibrated probability is the part to check hardest: a router that says "weather, 0.42" is only useful if that number means something on our own corpus. Deliverable: a bench log in dev.md with the three numbers per model and a verdict line; if it wins, follow-ups: the `router` role served through an MLX engine kind in the Stack (the Studio's engine) and the judge's extraction on the same model. Exit: the bench script under `backend/scripts/bench/` and `bash scripts/check.sh`. **Third candidate, same bench (2026-09-26, `docs/plans/model-review-qwen-image-2.1-and-clm-2026-09-26.md`): `Contrastive-LM/CLM-v0.1-8B` (Apache-2.0 heads, about 75 MB, on a frozen Apache-2.0 Qwen3-8B encoder; a typed choice or a ranking over an open, cached candidate set, 2,048-token window, no option ceiling), the second open reproduction of the Jev class beside Laya. One question before its row is measured: whether the chat engine's own Qwen3-8B weights can serve the last-token-pooled embeddings the heads require (verified in the installed engine source and by the cosine against the reference encoder on the same rows), since a second resident 8B does not fit tier 1; if not, its row is Studio-only. The `.pt` is loaded with `weights_only=True` or converted to safetensors at install, never a bare `torch.load`.**
    Design: [model-review-qwen-image-2.1-and-clm-2026-09-26](plans/model-review-qwen-image-2.1-and-clm-2026-09-26.md)
- [ ] **GATE-SPEED-02 (c): scope the `a11y` stage to the routes a diff touches** (M, after GATE-SPEED-01's per-stage times exist, 2026-09-22). The `a11y` stage launches real Chromium over every route; scope it down only if its measured time justifies it. Exit: `scripts/check.sh` twice green, stage times before and after in dev.md.
- [ ] **MEASURE-02: the owed model runs** **Rewritten 2026-10-02 for chat rule 3.** Retargeted to rules 3 and 8: record sampling per model, with the source of each value named (THIN-6A). The `query_writer` half is dropped with the forced-search rule; no `always_search`, `query_writer` or `model_transitions` field is measured. (S each, bench, Sonnet, 2026-09-22). From the ARCH-MEASURE-01 verdict: (1) the 8B query-rewrite bench on all 15 rows in a gate-free window (U2d's acceptance number, the 90 percent bar at 9 of 10); (2) the 4B rewrite rows 9 to 15 (its tool-calling row is confirmed twice: 19 of 50 and 7 of 25 fitting searches); (4) latency per model with the LAT-03 probe (prefill at about 300 and 1,000 tokens, decode at 64 tokens), three cold repeats; (5) the Studio's model on arrival, with the candidates as Astra's stack review names them, all pending the Studio: the Studio's first chat candidate the official Qwen3.8-27B at Q6 on a pinned llama.cpp build, thinking off by default (ordinary and child turns) and no preserved reasoning history, Qwen3.6-35B-A3B second if latency disappoints; the robot trial Qwen3.5-2B at Q4 against the 1.7B baseline, thinking and transitions off, adopted only with acceptable latency beside speech. Each result updates the budget table in dev.md and the model's `turn_budget` record, versioned against the model artifact, engine build, prompt and tool set. **Centrepiece (Astra, 2026-09-22):** end-to-end search success on fresh held-out multi-turn conversations through the shipping configuration, timeouts counted as failures, compared with the builder fallback. Rules: a side instance only, never 8788; start only when no gate runs, or record the gate state per line and count a timeout as not measured. **Also owed: the written-set bench's live run (U4, `backend/scripts/bench/written-set.ts`, 20 rows)** against the resident 8B with a reader applying the human-verdict judge, in a quiet window - 2026-09-23's own 20/20 is the scripted pass only (the harness proven, nothing judged), so U4 does not count as measured until this runs. Exit: the table cells filled in dev.md.
    Design: [arch-review-2026-09-22](plans/arch-review-2026-09-22.md)
- [ ] **ENGINE-CONTRACT-01: the role adapter proves what the engine guarantees** **Rewritten 2026-10-02 for chat rule 2.** Drop the `tool_choice: required` check (forced search is retired, THIN-2A); keep `auto` and keep the rest. Add a `/tokenize` row (the engine's own token count on a rendered message, the basis of THIN-3B) and a `reasoning_content` row (reasoning arrives in its own field, the basis of THIN-5A). Rule 8's bar is a template proven by these rows, never a model id. (S, Sonnet, 2026-09-22; Astra's stack review). "OpenAI-compatible" guarantees none of what the turn needs. The chat role adapter (`llm.ts`, the spec's client) gets a check suite per pinned engine build: `tool_choice` `required` and `auto` honoured; reasoning separated from content; a thinking limit per request honoured; cancellation reaching the engine (the request stops decoding); per-call timing fields present. Tests in these exact words: a `required` call returns a tool call every time; an `auto` call on "good morning" returns none; a reasoning-on call returns reasoning and content in separate fields; an abort within 200 ms stops the engine's slot (its `/slots` shows idle); every completion carries `prompt_ms` and `predicted_ms`. Runs against the pinned build on a side instance; the results and the pinned set (Bun, engine build, model digest, quantization, template, thinking settings, tool set) recorded in dev.md. Exit: `scripts/check.sh` and the suite green on the pinned build. Suite script landed 2026-09-23 (c-99o: backend/scripts/bench/engine-contract.ts); the live run against the pinned build and its dev.md table are still owed.
    Design: [arch-review-2026-09-22](plans/arch-review-2026-09-22.md)
- [ ] **OFFLINE-TEST-01: the egress-denied startup and turn test** (S, Sonnet, 2026-09-22; Astra's stack review). A test that starts the hub with every outbound connection denied at the process level (a Bun fetch shim or the OS firewall in the test's own sandbox, never a machine setting left behind) and runs one full turn on preloaded artifacts: nothing downloads, nothing phones home, dependencies resolve from the frozen cache, and the turn answers; a websearch turn fails with the honest unavailable line, never a hang. Acceptance: the test in `scripts/check.sh`, green; the list of every outbound endpoint the hub may ever contact, declared once (PRIVACY.md) and asserted against. Exit: `scripts/check.sh`.
    Design: [arch-review-2026-09-22](plans/arch-review-2026-09-22.md)
- [ ] **STUDIO-ACCEPT-01: the tier acceptance workload, run on tier 1 first** (M, Sonnet; retitled 2026-09-23 by the hardware tiers plan, `docs/plans/hardware-tiers-2026-09-23.md`). Objective: one realistic workload per hardware tier that sets that tier's concurrency and residency limits: on tier 1 (this 24 GB Mac) one voice conversation and one typed conversation at once, plus one photo turn and one picture job in the same run, measuring first useful answer, first spoken word, peak memory and cancellation; tier 2 and tier 3 rerun the same workload and set their own limits, the Studio last. Files: `backend/scripts/bench/` (a new `tierWorkload.ts` mirroring `conversation.ts`'s runner and LAT-03's probe), the limits declared once in the Stack's governor and the packages' warm limits, dev.md's table with the pinned set. Acceptance: the numbers recorded per tier with the pinned set, the limits declared once, the workload green on them. Out of scope: the floor run (FLOOR-ACCEPT-01). Exit: the limits declared once and the workload green on them.
    Design: [hardware-tiers-2026-09-23](plans/hardware-tiers-2026-09-23.md)
- [ ] **REVIEW-0922-01: the smaller findings of the 2026-09-22 architecture review** (S each, 2026-09-22; source `docs/plans/arch-review-2026-09-22.md`, all verified against the code). (a) `sensitiveAllowed()` (`backend/src/lib/turnContext.ts:54`) returns true on every surface but the robot, so a shared screen (the TV client, a glance hub) would show a parent's sensitive memories with children present: presence becomes a turn input on every surface, and no shared-screen surface ships before a test proves it withholds by default. Not live today (no shared surface exists yet). (b) The wake-word invariants ruled 2026-09-22 exist only in DECISIONS.md and this file: write them into `.github/docs/SAFETY.md` and the settings registry. (c) `llm.ts` exports the raw token stream to any importer, so the output gate's "no ungated path" holds for one function, not the system: narrow the export or add a lint rule, and correct the claim. (d) Sentence splitting in `guards.ts` (near :2286) is a regex where `Intl.Segmenter` ships in the runtime (principle 6). (e) ARCH-BUILD-01's candidate list gains XState v5 beside the in-house TurnGraph option (EVAL-06 already names it). (f) The pending-patches table in dev.md has four rows at "PR not yet opened", against the 2026-09-22 rule that an unlinked edit to vendored code is a fork to revert: open or revert each. Exit per part: `scripts/check.sh`, or the docs-only gate for (b), (e) and (f).
    Design: [arch-review-2026-09-22](plans/arch-review-2026-09-22.md)
- [ ] **SHARE-CONV-01: a real Share entry in the conversation menu** (M). CHAT-HEADER-01 originally put a Share item in the conversation menu (`frontend/src/apps/chat/chatHeaderBar.tsx`), disabled, behind `shareAllowed`, since no share-creation route existed yet; CHAT-FIND-0923-03 (2026-09-23) removed it outright (a disabled placeholder is worse than no entry, Jesse's own finding that the menu should hold only real conversation actions) - `shareAllowed` is gone from `ChatHeaderData` too. This item is: a route that snapshots a conversation into a shareable record, the link surface, and a NEW `onShare`/`shareAllowed` pair added back to `ChatHeaderData` (mirroring `onRename`/`onDelete`'s own shape) once share is real, not restoring the disabled item. The shipped `shared-conversation.tsx` Element renders a share once one exists. Depends on: the shipped Element's own data contract (read it first, don't invent a shape). Exit: `bash scripts/check.sh` and the captures.
    Design: [external-sharing-2026-09-23](plans/external-sharing-2026-09-23.md)
- [ ] **WAKEWORD-CATALOG-01: install wakeword detectors as catalog packages** (S, catalog). HANDSFREE-01(c) currently gates availability on all pinned stock openWakeWord assets being present locally (`isWakewordAssetInstalled()`), because `catalog/wakewords/` is empty and there is no catalog-based installer yet. When that package system is built, declare the detector and its assets as a catalog wakeword package, route installation/removal through the package host, and make the existing device-scoped opt-in hide/show from the package's installed state. Preserve the default-off, per-device adult authorization, visible listening indicator, one-action stop, and local-only pre-wake buffer invariants. Do not block the current slice on this future package system.
- [ ] **RESP-02: the spoken projection** (M). `reply.speech` becomes the voice contract: one to three sentences that answer plus the offer when the written answer is longer, produced by the composer from the full answer (a second short generation on the same context, or the model's own lead when it is already short), never truncation to the first sentence; a list reads its top three. Acceptance: a bench row per shape (a one-line fact, a list, a procedure, a comparison) judged for "answers first, offers the rest". Design: the same record. Exit: `bash scripts/check.sh` and the named benches.
    Design: [response-contract-by-surface-2026-09-21](plans/response-contract-by-surface-2026-09-21.md)
- [ ] **RESP-03: the glance projection** (S, after the hub exists). The overlay surface renders the structured part as the card and speaks `reply.speech`; a tap opens the screen contract; the wire needs nothing new. Design: the same record. Exit: `bash scripts/check.sh`.
    Design: [response-contract-by-surface-2026-09-21](plans/response-contract-by-surface-2026-09-21.md)
- [ ] **CHAT-07: Capture user assertions across package and model turns** **Rewritten 2026-10-02 for chat rule 12.** Lands on the one path: the judge reads stored rows (it is path-independent), and judge status at insert plus the turn lease are ported by THIN-0C. File names below that say `turnEngine.ts` read as `turnMachine/`. (M)

    Depends on: CHAT-06. Files: `backend/src/lib/memoryJudge.ts`,
    `conversationHistory.ts`, `db/schema.ts`, `wire.ts`, and
    `backend/tests/memoryJudge.test.ts`, `conversationHistory.test.ts`.
    Select eligible user-bearing model, plugin, plugin-error, command,
    command-error, and confirmation turns regardless of answer source.
    Exclude safety-refused turns, credential-rejected input, deleted
    conversations, and non-user scheduler activity. Read at most two
    preceding exchanges from the same person/conversation for attribution.
    Current user text is the source; prior assistant text can only supply
    the question that an explicit confirmation answers. Require extracted
    candidates to carry a source span that is an exact substring of user
    text; a confirmed short answer also names the prior question's turn
    ID. Reject ambiguous references instead of inventing a Person.
    Replace the blanket possessive rule with this source attribution.

    Add optional turn-view `memory_status: pending|saved|not_saved|failed`
    and `memory_ids`, deriving state from actual ingestion and judge
    bookkeeping. Preserve existing fields and endpoints. Resume partial
    progress idempotently; cancellation consumes no poison attempt.
    Acceptance: "Search for dinner ideas. I dislike cilantro" is captured;
    a search-result claim is not; "Yes, every Tuesday" after a trash-day
    question is correctly attributed; third-party dialogue is not assigned
    to the speaker; no extraction shares a fact without explicit scope.
    Out of scope: speaker recognition and parsing arbitrary quoted
    documents. Checks: named suites and full exit gate.

<a id="chat-08"></a>
    Design: [chat-thin-path-2026-10-02](plans/chat-thin-path-2026-10-02.md)
- [ ] **CHAT-11: Refresh profiles promptly and invalidate stale summaries** **Rewritten 2026-10-02 for chat rule 4.** The rolling-summary half is defined on the token-counted window's boundary, not on `WINDOW_NEWEST_TURNS_KEPT = 4` (THIN-3D); the profile-refresh half is unchanged. File names below that say `turnEngine.ts` read as `turnMachine/`. (M)

    Depends on: CHAT-06, CHAT-08, CHAT-19. Files:
    `backend/src/lib/memoryJudge.ts`, `memory.ts`, `conversationHistory.ts`,
    `scheduler.ts`, `index.ts`, and their nearby tests. Keep one profile
    record per person using `PROFILE_SOURCE`. After five active eligible
    person facts exist and no profile exists, enqueue a background refresh
    on the next idle judge opportunity; do not wait a week. Dirty profiles
    refresh after fact correction, deletion, or expiry, with at most one
    rewrite per person per idle batch and a five-minute successful-refresh
    cooldown. Security/forget invalidation immediately withholds the old
    profile regardless of cooldown. Weekly consolidation remains a fallback.
    Add a local `context_derivations` table in the existing DB migration:
    composite key `(artifact_kind, artifact_id)`, kind `profile|conversation_summary`,
    `source_refs` JSON of `{kind: memory|turn, id, hlc}`, and `generated_at`.
    No new shared record or sync fields. Missing metadata means withhold
    and regenerate, including old/replicated profiles. Before injection and
    refresh commit, verify source access, existence, validity, and unchanged
    HLCs. Changed/deleted/expired sources invalidate immediately. Filter
    credential material. No facts means no injected profile.

    Rolling summaries retain covered-turn IDs and never overwrite a
    deleted conversation after an in-flight job finishes. Retention
    summaries preserve speaker-versus-assistant attribution and cannot
    promote model guesses into personal facts. Acceptance: first profile
    appears at the next eligible idle pass; corrected/forgotten facts cannot
    survive through an old profile; two concurrent refresh requests produce
    one active profile; all refreshes yield to chat. Out of scope: mood
    models and cross-person profiling. Checks: memory/judge/history/scheduler
    suites and full exit gate.

<a id="chat-12"></a>
    Design: [context-compaction-2026-10-05](plans/context-compaction-2026-10-05.md)
- [ ] **The chat architecture review's six corrections, in order** (program; `docs/plans/chat-architecture-review-2026-09-16.md` section 5)

    The review (fb3a5d0, 159 references) found the shape right (decisions
    in code, the model writes) and the word lists the wrong ceiling for
    open-class judgments. The owner accepted the six corrections in the
    review's order on 2026-09-16. Each is its own item below; the
    program line is the place the dashboard reads.
    - [x] **RVW-1: The label harvest and the per-rule report** (S-M).
      The turn row and the `[turn]` line gain the answering rung
      (`typed_source | search | model_knowledge | failed | none`) and a
      `corrected_next_turn` flag read from the next turn's repair; a
      `scripts/bench/labels.ts` exports, per week, every guard hit,
      forced lookup, correction, rung and signal source with the text
      redacted to the roster form, into the git-ignored data directory;
      the weekly report prints hits per guard reason and per signal
      rule. Acceptance: a week of the dev hub exported, the counts
      reconciled against the log, a rule with zero hits named. First,
      because RVW-2, RVW-3 and RVW-6 train from it. Progress 2026-09-16
      (docs/dev/session-a.md "RVW-1"): the rung, the rules and the
      correction flag on the row and the `[turn]` line
      (`lib/ruleNames.ts`, migration 0044), `scripts/bench/labels.ts`
      with its report and tests; Done 2026-09-21 (codex-287): two weeks of
      the dev hub exported (`scripts/bench/labels.ts --since 2026-09-07`):
      W37 106 turns, all `unrecorded` (they predate migration 0044, as
      expected); W38 226 turns, 47 with a recorded rung (22 `none`, 15
      `search`, 10 `model_knowledge`) matching exactly the 47
      `signal.rule` hits, 9 guard hits (3 `invention`, 2
      `unsupported_action`, one each `assistant_register`,
      `capability_claim`, `claimed_experience`, `tag_question`), no
      corrections; 55 of the 65 rules had zero hits, `almanac` among
      them.
    - [x] **RVW-1b: A sample floor before a zero-hit rule retires** (S). Landed 2026-09-23 (c-99l).
      The org rule (RULES-AND-LEARNED-COMPONENTS.md) retires a rule with
      zero hits over the weekly report, but the first real week had 47
      labelled turns and 55 zero-hit rules, most of them guards for
      situations that simply did not occur (crisis, consent, credential).
      Objective: the weekly report marks a rule as retire-eligible only
      after N consecutive weeks with zero hits AND a cumulative floor of
      labelled turns across those weeks (N and the floor set in one place
      in `scripts/bench/labels.ts`, defaults 4 weeks and 500 turns), and
      prints the eligible list separately from the plain zero-hit list.
      Files: `backend/scripts/bench/labels.ts`,
      `backend/tests/labels.test.ts`.
      Mirror: the report's existing "rules with zero hits this week"
      block. Acceptance: a test with five weeks of fixtures where a rule
      crosses the floor in week five and not before; the org doc's rule
      sentence gains the floor in the same commit
      (`.github/docs/RULES-AND-LEARNED-COMPONENTS.md`, a separate commit
      in that repo). Out of scope: retiring anything.
      Exit: `bash scripts/check.sh`.
    - [ ] **RVW-2: Human labels for the signal, then a small encoder for
      the residual** **Rewritten 2026-10-02 for chat rule 1.** Labels and the small encoder serve only the signal fields that feed the plan line, memory-judge eligibility, the wire `signal` event and cue suppression. Nothing they predict decides a search or a tool, and the org rule stands that a learned component never sits in the safety, consent or privacy path. (The reconciliation inventory said 'keep for the safety path only'; that reading breaks the org rule, so the org rule wins.) (a person's hours, then M). The 500-turn sheet
      (`data-scratch/eval/turn-signal-review-sheet.md`) reviewed for act,
      stance, emotion and intensity; a MiniLM or ModernBERT-class encoder
      fine-tuned on those labels plus the fixture's turns, calibrated,
      thresholds on precision, ONNX on CPU under 20 ms warm p95; the
      rules keep every decision they make today. Acceptance: section
      12's own 5-point macro-F1 margin over the rules alone, no fixture
      regression, the fallback rate printed. Blocked on the labeling
      hours (the owner's, or a frontier session as the labeler with the
      disagreement rate reported).
    - [ ] **RVW-3: The lookup router and the logit trigger** **Dropped 2026-10-02: retired by docs/design/RULES.md chat rule 1.** Do not build; the text below is kept as history. (S-M). From
      RVW-1's rung labels, a router predicts the rung for a world
      question, with an evergreen feature for currency; llama-server's
      per-token logprobs feed a hedge trigger beside the hedge words.
    - [ ] **RVW-4: The companion voice bench** (M). Control vectors
      trained on each companion's own example lines, one per dial; the
      dial prose cut to the plan line plus the examples; a per-companion
      adapter only if several companions must be live at once. Rides
      with COMP-03.
    - [ ] **RVW-5: Memory in the reply** (S-M). Typed bullets with
      category and date, a measured bigger budget, a `recall` move in
      the plan realized as a reaction or a question and never a
      recitation, a deterministic supersede rule ahead of the 4B.
    - [ ] **RVW-6: An encoder grounding check in shadow mode** (S),
      adopted only if it beats the rule's false-positive rate.

<a id="chat-16"></a>
    Design: [chat-architecture-review-2026-09-16](plans/chat-architecture-review-2026-09-16.md)
- [ ] **RUNTIME-01: The household runtime as a workspace package the hub runs** **Rewritten 2026-10-02 for chat rule 12.** The package boundary is drawn around the thin path (`turnMachine/`), not `turnEngine.ts`; start only after THIN-7D, so the robot pins the code that remains. (L)
    Design: [packages-apps-and-integrations-2026-10-17](design/packages-apps-and-integrations-2026-10-17.md)

    Filed by the robot's design pass (bot `docs/dev.md`, section 2 "The
    shared-runtime boundary" and the "named hub items" list): the robot
    runs the hub's own household runtime on Bun and pins the same code,
    so the hub has to run it as a package first. Objective: the turn
    engine, the turn context and signal, the guards and the output
    boundary, the safety classifier, the memory store and judge, the
    scheduler, people, settings and grants, the package host, the link
    and the replica, and the schema UI service, as one workspace package
    with an explicit API, the hub its first consumer. Files: a new
    workspace package under `backend/` (the boundary around
    `backend/src/lib`), `backend/src/index.ts` and the routes as the
    consumer, `package.json` workspaces. Mirror: `spec/` as a workspace
    package the hub imports as `@maipai/spec`; `turnSignal.ts` and
    `turnContext.ts` are already leaf modules (no engine, no database),
    and `hlc.ts` needs only its seed injected. Do: declare the injected
    ports (the record store, the engine supervisors and their launch
    adapter, the voice contract client, the package host, the data
    directory, the surface, the clock) as explicit constructor inputs,
    never `@/` reach-ins to the hub's database, settings or supervisors;
    name the exposed calls (run a turn, stream a turn, cancel, the judge
    tick, the scheduler tick, the link's apply and emit) and route the
    hub through them; the robot's `runtime/` consumes only the API,
    never a module path inside the package, and its pin is a version and
    a digest in the lockfile (a boot check refuses a mismatch and a path
    dependency). Acceptance: the hub boots and passes its suite through
    the package API with no route or script importing a module inside
    the package by path; the package's own tests run with fakes on every
    port; the API is documented in dev.md. Out of scope: the robot's
    pin itself (bot RT-00 and RT-01), `spec/link/`. Exit: `bash
    scripts/check.sh`.

<a id="surface-01"></a>
- [ ] **CHAT-17: Share streaming and blocking turn execution without dropping calls** **Rewritten 2026-10-02 for chat rule 9.** Only the sentence-hold wire is retired; the shared streaming and blocking execution stays and lands on `turnMachine/`. The output gate's grain follows rule 10 (per sentence for a child and every spoken turn; as-it-arrives for an adult's written chat; the teen setting). XState (EVAL-06) is dropped. File names below that say `turnEngine.ts` read as `turnMachine/`. (M)

    Depends on: CHAT-04, CHAT-15, CHAT-16, CHAT-18. Files:
    `backend/src/lib/turnEngine.ts`, `llm.ts`, `routes/turn.ts`,
    `routes/openai.ts`, `backend/tests/turnEngine.test.ts`, `tier2.test.ts`,
    `openai.test.ts`, and frontend adapter tests. Implement one internal
    event machine with deciding, executing, composing, finished, cancelled
    phases. Convert the LLM generator's terminal return into an explicit
    completed-call event using manual iterator consumption; do not discard
    it with `for await`. Both public turn methods consume this machine;
    blocking collects its approved deltas. Return stream setup before
    waiting for a first token or sentence. Preserve existing public events,
    cue delay, and ordinary sentence streaming even with search offered.

    Approved prose may stream before trailing calls. Hold an unsupported
    action-claim sentence and its remaining tail until the native decision
    finishes; the output-token budget bounds that buffer. If calls arrive,
    discard held text, execute the validated batch, then append its result
    or composition. If no calls arrive, discard held claims and append one
    truthful fallback. Composition sees the already-emitted prefix and must
    not repeat it. Safety refusal or cancellation prevents unstarted calls.
    Transport failure before a complete native response executes none.

    Acceptance: prose-plus-tool executes, first safe sentence arrives before
    deferred tool completion, failed timer never emits its held success
    claim, ordinary chat uses one completion, and both transports produce
    identical canonical text/effects for scripted events. No third model
    call, duplicate prefix, or repeated action on failure. Out of scope:
    claiming regex detection proves every possible implied success claim.
    Checks: named suites and full exit gate.

<a id="chat-18"></a>
    Design: [chat-thin-path-2026-10-02](plans/chat-thin-path-2026-10-02.md)
- [ ] **CHAT-19: Give interactive inference priority over all background jobs** **Rewritten 2026-10-02 for chat rule 12.** Unchanged in substance (one arbiter, background yields to interactive); it lands on the one path and the engine slots of the Stack (STACK-CTX-01 states per-slot context). File names below that say `turnEngine.ts` read as `turnMachine/`. (M)

    Depends on: CHAT-06 and CHAT-18. Files: `spec/llm/ts/client.ts`, its existing
    tests, `backend/src/lib/llm.ts`, new `inferenceScheduler.ts`,
    `memoryJudge.ts`, `conversationHistory.ts`, `scheduler.ts`, and
    `backend/tests/llm.test.ts`, `memoryJudge.test.ts`, `scheduler.test.ts`.
    Add an external AbortSignal to blocking completion, composing it with
    the existing timeout outside the JSON body. One arbiter owns the chat
    engine: interactive/background FIFO queues, one active operation, and
    20 seconds of idle time before background begins. All extraction,
    dedupe, contradiction, profile, rolling-summary, and retention-summary
    completions explicitly request background priority. Other existing
    callers default interactive. Interactive arrivals abort active
    background generation and wait for its lease to release; never cancel
    another interactive request. Streaming holds the lease until exhausted
    or returned, not until headers arrive.

    Return a typed interruption distinct from unavailable; do not restart
    the engine, consume a judge poison attempt, mark interrupted work done,
    or auto-replay an action. Use CHAT-06 idempotence for persisted partial
    facts. Bound each queue to 64 entries, reject excess interactive work
    with the existing rate-limited shape, and leave excess background work
    pending at its source. Acceptance: interrupt every background caller,
    verify foreground first and eventual idle progress, test FIFO and
    cancellation cleanup. Out of scope: second model or residency policy
    (amended 2026-09-12: MEM-01 gives background work its own engine on
    a separate process; this arbiter governs the chat engine only, and
    the background callers listed above may already be on that engine
    when this lands).
    Checks: named suites, history/activity tests, shared client tests, and
    full exit gate; contention measurements belong to CHAT-23.
    Note (2026-09-13, CONC-01 below): "one active operation" is
    background against interactive, never one person against another;
    the arbiter admits up to N interactive turns at once.

<a id="conc-01"></a>
    Design: [chat-thin-path-2026-10-02](plans/chat-thin-path-2026-10-02.md)
- [ ] **CONC-01: Concurrent household conversations** **Rewritten 2026-10-02 for chat rule 4.** Per-slot context is stated, not assumed: `--parallel` splits the launch context across slots (THIN-3C sizes the window per slot). Companion LoRA slots stay as noted below. File names below that say `turnEngine.ts` read as `turnMachine/`. (M)

    Several people chat at once (a phone, the TV, the robot) and none
    waits for the others. The chat engine runs N slots with
    llama-server's continuous batching (N sized to the card: the 8B's
    weights once, one context per slot); the arbiter admits up to N
    interactive turns at once and still makes background work yield to
    any of them; the prefix cache holds the shared system prompt across
    slots; per-person rate limits stay (#102); the judge stays on its
    own engine. Text and reasoning: `docs/plans/
    media-conversation-program-2026-09-13.md`, "Requirement recorded
    2026-09-13". Depends on: CHAT-19. Files: `backend/src/lib/
    llmSupervisor.ts` (slots), `llm.ts` (`id_slot`), the arbiter,
    `scripts/bench/conversation.ts`. Acceptance: two conversations
    interleaved turn for turn on separate people, each reply under 1.5
    times its solo latency, no reply from one conversation ever
    containing the other's text, three seeded runs. Out of scope: a
    second model, residency policy. Checks: llm and supervisor suites,
    the bench, full exit gate. Note (2026-09-28, dev.md "EVAL-03
    design pass"): companions ride per-request LoRA adapters, and
    llama-server never batches slots whose adapter sets differ, so the
    1.5x bar is measured on same-companion pairs and mixed-companion
    pairs are measured separately with about 2x expected; slots are
    assigned by person (which is by companion) so a slot rarely
    switches adapters, since a switch clears that slot's prompt cache.
    Design: [media-conversation-program-2026-09-13](plans/media-conversation-program-2026-09-13.md)
- [ ] **EVAL: One 8B, two slots, the judge yields** (M)

    An experiment, after CHAT-19: the memory judge on a second slot of
    the chat engine that runs only when no reply is in progress,
    against today's separate 4B engine. Judged by reply latency under
    load, judge precision (the judge eval's scorer), and drain time
    per bench run; kept only if it wins on all three. It does not
    change CONC-01's requirement (`docs/plans/
    media-conversation-program-2026-09-13.md`). Depends on: CHAT-19,
    CONC-01. Files: `backend/src/lib/backgroundSupervisor.ts`,
    `llmSupervisor.ts`, `scripts/bench/judge-eval.ts`. Checks: the
    judge eval and the seeded bench, three runs each way.

<a id="chat-20"></a>
    Design: [media-conversation-program-2026-09-13](plans/media-conversation-program-2026-09-13.md)
- [ ] **CHAT-20: Update memory state in the open chat without reloading it** **Rewritten 2026-10-02 for chat rule 12.** The backend half lands on the one path; the frontend half is done and stays. File names below that say `turnEngine.ts` read as `turnMachine/`. (M)

    **Frontend half: done, lane 8 item 2 (2026-09-13).** `judgeStatus`
    (backend/src/db/schema.ts's own `judge_status`, already carried by
    `ConversationTurnWithMemoryIds`) plus `memory_ids` derive a real
    `MemoryStatus` (`pending`/`saved`/`not_saved`/`failed`) client-side -
    no backend change needed, the fields already existed. One store
    (`chatMemoryState.ts`), turn-id keyed, the chip and remember/forget
    both read and write it; a 5s poll of the existing per-conversation
    turns endpoint runs only while something in the open conversation is
    pending, paused while the tab is hidden, stopped once nothing is
    pending or the conversation changes. Ten-minute stall: a client-side
    flag, tracked exactly as before. Replaces #64's narrower notifications-poll path
    (chatMemoryChip.tsx), which only ever produced "saved" with no
    forget wiring. Backend half (routes/conversations.ts,
    lib/conversationHistory.ts's own remaining CHAT-20 acceptance,
    session-a-intelligence.md's contract) not audited here - out of
    scope for lane 8, Session A's files. Full writeup: docs/dev/
    session-b.md, "Lane 8 item 2: CHAT-20's frontend half".

    **Chip text reduced, 2026-09-13 (Jesse's call).** `chatMemoryChip.tsx`
    no longer renders anything for `pending` or the ten-minute-stall
    flag - "Checking for memories" and "Still waiting to process memory"
    (plus its manual Refresh) are gone; a person sees the chip only on
    an outcome ("Memory updated"/"Memory wasn't saved"). The state
    machine and the 5s poll are unchanged - a turn that resolves before
    the ten-minute stall still updates the open chip live. One real,
    accepted gap: because the poll itself stops once a turn is marked
    stalled (its own established design, unchanged here) and the chip's
    only recovery action (Refresh) went with the removed UI, a turn
    that's still unresolved past ten minutes won't update in an
    already-open tab until the conversation is reloaded (which reseeds
    from the real row and shows the correct outcome). Full writeup:
    docs/dev/session-b.md, "Chip text reduced".

    Depends on: CHAT-07. Files: `backend/src/wire.ts`,
    `routes/conversations.ts`, `lib/conversationHistory.ts`,
    `frontend/src/apps/chat/chatModelAdapter.ts`, `chatHistoryAdapter.ts`,
    `chatMemoryChip.tsx`, `chatMemoryActions.ts`, `ChatPage.tsx`, and their
    existing tests. Carry real `turnId`, `memoryIds`, and `memoryStatus`
    into both live and loaded assistant metadata. Reuse the per-conversation
    turns endpoint to poll every five seconds only while the visible thread
    has pending memory processing. Pause when hidden, abort on thread
    switch/unmount, stop at terminal status, and resume pending work when
    the thread becomes visible. After ten minutes pending, stop polling
    (still true); the visible "Still waiting to process memory" plus
    Refresh this line originally asked for is gone as of 2026-09-13
    (the amendment above) - do not falsely mark failed still holds, it
    just has no chip text to hold it against anymore. Merge metadata by
    stable turn ID, never replace the current message repository or
    disrupt a running turn.

    Saved shows the existing linked chip; pending shows no chip as of
    2026-09-13 (originally "Checking for memories," see the amendment
    above); not_saved shows no chip; failed says "Memory wasn't saved"
    with a link to the memory page. Per-message save/forget use CHAT-06 and
    the existing memory action adapter, target exact returned IDs, and
    invalidate that metadata after success. Never fabricate notification
    payloads. Acceptance: deferred judge save updates the open message;
    reload shows identical state; switched thread is untouched; no poll
    remains when all statuses settle. Out of scope: WebSockets or a second
    notification system. Checks: frontend adapter/chip/action tests,
    conversation API tests, seeded browser verification, and full exit gate.

<a id="chat-21"></a>
- [ ] **CHAT-21: Record local stage timings and factual turn outcomes** (M)

    Depends on: CHAT-01, CHAT-15, CHAT-18. Files:
    `backend/src/lib/turnEngine.ts`, `turnContext.ts`, `engineStats.ts`,
    `conversationHistory.ts`, `wire.ts`, `frontend/src/apps/chat/chatModelAdapter.ts`,
    `frontend/src/lib/sentenceSpeechScheduler.ts`, and related tests. Extend
    existing turn log/metrics plumbing rather than add telemetry. Record
    stage durations for context, embedding, routing, queue wait, inference,
    execution, composition, output checks, and total time; record first
    approved text and frontend first audio separately. Include counts of
    selected tokens/evidence, offered tools, accepted/executed calls,
    guard reasons, typed failures, and memory queue depth/oldest age. Keep
    actual engine cache-hit data optional; unknown is null, never inferred
    from a stable string (amended 2026-09-12: FAST-01's latency bench
    reads processed prompt tokens from the engine itself, so the cache
    ratio is a measured number there; this item may reuse that reader). Centralize the existing RoutingTier union once
    and reuse it in wire/log/stat aggregation.

    No utterance, reply, memory text, credentials, raw tool arguments,
    household hostnames, or search query in metrics. Keep production
    high-frequency samples in the existing bounded ring buffer; aggregate
    bench outputs use synthetic fixture IDs. Acceptance: every phase has
    a monotonic duration; queued time is not generation time; first audio
    comes from actual playback callback; cancellation records a cancelled
    outcome without logging sensitive text. Out of scope: remote analytics,
    new dashboards, or permanent raw transcript debug logs. Checks:
    existing engineStats/turn/history/frontend adapter tests and full exit
    gate; document metric meanings in developer docs.

<a id="chat-22"></a>
- [ ] **CHAT-24: Compare model, voice, cache, and steering changes without deploying** **Rewritten 2026-10-02 for chat rule 13.** Points at CHAT-AB-01 (THIN-AB, THIN-AB2) for the compare harness; the comparisons here run as arms of that bench, against one engine. (M)

    Depends on: CHAT-02 through CHAT-21 implemented and CHAT-23 measurement
    report available. CHAT-23 may remain open after a failed measurement;
    promotion still requires every gate. Files: existing
    `backend/scripts/bench/{persona-eval,steering-spike,tool-calling,naturalness}.ts`,
    `backend/scripts/bench/steering/`, engine autotune/capability readers,
    and `docs/dev.md`. Keep the current model, prompt, voice, and memory
    engine as baseline. Compare only already-installed catalog candidates
    on the identical CHAT-23 corpus, pinned engine/template, and hardware.
    Check native parallel-call support explicitly in the request and wire
    tests; do not assume it from accepting a tools field. Run warm-cache
    and cold-cache trials and report actual engine cache data. Train a
    second steering experiment from the selected companion's own synthetic
    examples, retaining the existing paragraph condition. Include a
    dedicated extraction-model condition only if CHAT-23 still fails the
    10% contention target after scheduling fixes and an installed candidate
    fits measured memory headroom with no swap/OOM (amended 2026-09-12:
    superseded by MEM-01 and MEM-05, which put extraction on its own
    engine unconditionally and gate the model choice on the judge eval).

    Acceptance: promotion recommendation requires all CHAT-23 correctness floors, no
    more than 10% p95 first-audio regression, and either at least 15% lower
    p95 latency or at least five percentage points better factual/intent
    quality with no other floor regression. If none qualify, recommend
    keeping baseline. Record naturalness rubric per companion: direct
    answer, acknowledgment fit, no repeated framing, contextual continuity,
    and register consistency. Candidate unavailable means record not tested,
    not a failed or passed benchmark. Out of scope: downloads, purchases,
    default changes, release, deploy, or deciding the owner's preferred
    final voice. Checks: existing bench test suites, isolated reports,
    artifact inspection/listening where available, and full exit gate.

<a id="chat-25"></a>
    Design: [measure-first-2026-09-13](plans/measure-first-2026-09-13.md)
- [ ] **CHAT-25: Reconcile current chat documentation and readiness claims** (S)

    Status (2026-09-13): the "current documentation" half is done - the
    six user pages (`chat.md`, `memory.md`, `privacy.md`, `home.md`,
    `getting-started.md`, `fix-a-problem.md`) were checked against a
    spare-port backend on the hub's own real engines with a seeded
    household, and updated for what shipped since they were last
    written: your own message's Copy/Edit/Remember buttons and the
    edit-history switcher (both survive a reload, verified live), the
    "Memory updated" chip, and the PWA offline page's exact wording. No
    stale "not yet" claim about world knowledge, memory batch actions,
    or credentials was found - those pages were already current.
    Screenshots regenerated for every affected page and opened. The
    "readiness claims" half (the final benchmark report link,
    distinguishing measured live quality from deterministic checks) is
    unchanged, still waiting on the baseline bench's own verdict
    (measure-first-2026-09-13.md).

    Depends on: CHAT-23; each earlier item still updates its own docs in
    its implementation commit. Files: `docs/user/chat.md`, `memory.md`,
    user privacy page, `docs/dev.md`, `spec/README.md`, `spec/llm/README.md`,
    and comments in `backend/src/lib/turnEngine.ts`, `persona.ts`,
    `conversationHistory.ts`. Preserve dated historical evidence but label
    it historical. Remove current-tense claims that native tools, pending
    asks, history, companion packages, or scheduled maintenance are absent
    when the executable path implements them. Document the actual capture
    delay/status, explicit versus automatic scope, expiry, sources,
    cancellation, and failed-action behavior. User pages must explain what
    happens and what the user can do, with no internal schema names or
    owner-specific setup notes. API reference remains generated.

    Acceptance: link the final benchmark report and distinguish measured live quality
    from deterministic checks; list unsupported surfaces honestly. Ensure
    the dated analysis remains a snapshot and each replaced old backlog
    entry points to one canonical item. Verify links and regenerate any
    affected screenshots with seeded data, inspect every image, then run
    the existing status-dashboard parser for all four repos and update the
    Artifact database if its tool is available. If unavailable, retain a
    local refresh payload and state that exact publishing limitation.
    Out of scope: marketing claims of perfect recall/safety, a dashboard
    replacement, or undocumented release. Checks: reading-level/prose/link
    checks, affected screenshots, full exit gate.

<a id="design-pass-2026-09-13"></a>

## The chat program: assistant-ui Elements (2026-09-21)

The design record is `docs/plans/shell-on-shadcndashboard-2026-09-21.md`
("The wire the Elements expect", "The artifact record", "The turn-engine
tool"); read it first for the full contract each item below implements
one row of.

### The shell program: shadcndashboard, page by page

- [ ] **ADMIN-LAYERS-01: an admin sees each chat layer's health and can test each one** **Rewritten 2026-10-02 for chat rule 12.** The layer list is the thin path's nodes (safety, commands, context, model, each tool, answer, output gate) after THIN-7D deletes the old path; no panel row for a retired layer. Depends on THIN-7D, not on U2. (M, after U2 and ADMIN-PERF-01; owner request 2026-09-22). Built on the rebuild plan's section 11 (`docs/plans/simple-turn-pipeline-2026-09-22.md`): every layer is a node with a typed contract and every turn carries one per-node trace. (1) **Health:** the admin performance page gains a Layers panel, one row per node (safety, commands, context, model, each tool, answer, output gate): implementation id and version, median and p95 time over the last 24 hours, error rate, the last error with its time; composed from the dashboard template's data table and chart wrapper, no hand-built UI. A node that turns slow or starts failing raises one health item on the one health list and one declared admin notification, the same detector and rules as PERF-ALERT-01. (2) **Test:** each node contract gains a `selfTest()` with a canned, fixture-only input and an expected property (never household data), run by `POST /api/admin/layers/:id/test` (zod-openapi, admin only) and a Test button per row plus Test all; the result shows pass or fail, time, and the node's own output summary. Swapping a layer's implementation is proven first by its self-test, then by the replay set. Acceptance: the panel shows real numbers on the dev hub, every node's self-test passes, a node forced to fail (a fixture engine that errors) shows red with its error and raises the health item; non-admin gets 403; captures at 1440 and 390. Exit: `scripts/check.sh`.
    Design: [simple-turn-pipeline-2026-09-22](plans/simple-turn-pipeline-2026-09-22.md)
- [ ] **PERF-ALERT-01: the hub notices slow replies, tells an admin, and shows when it started and where the time goes** (M, design note first, with or right after ADMIN-PERF-01; owner request 2026-09-22). Why: on 2026-09-22 "hi" took 3.3 to 4.4 s to its first token for a 300-token prompt while every stage before the model took about 0.1 s, and nobody knew until the owner felt it. Pieces, all existing systems, nothing bespoke: (1) **Record where the time goes.** Each turn's stored `stats` (`turnStats.ts`) gains the stage split the log line already has (`TurnTimings`: routing, recall, prompt build) plus the engine's own `prompt_ms` and `predicted_ms` from the stream timings and the retry count, so "waiting on the engine", "the engine reading the prompt" and "a guard threw the first reply away" are separable after the fact. (2) **Detect.** A scheduler job (the backups' job list) every 5 minutes reads the last 20 model turns: slow when the median first-token time is over the admin's budget (a declared setting, `perf.first_token_budget_ms`, default 1500 for typed chat) OR over twice the same model's own 7-day median at a similar prompt size, for 10 minutes running. Recovers when under 1.3 times the baseline and under budget for 10 minutes. (3) **Tell.** One health item on the one health list ("Replies are slow since 2:14 PM: 3.9 s to first word, usually 0.8 s; most of it is the engine reading the prompt"), `started_at` fixed at the first slow turn, updated in place, cleared on recovery; and one declared notification event (`hub.replies_slow`, `time_sensitive`, audience admins, rate-limited to once per episode, a "Show me" action to the performance page) plus a `passive` "back to normal" when it clears. (4) **Show.** ADMIN-PERF-01's first-token chart shades each slow episode and breaks the median into the stages from (1). When the Stack runs the engines, its own health item for engine prefill throughput feeds the same list, never a second one. Acceptance: a test that a seeded run of slow turns raises exactly one health item with the first slow turn's time and one notification, that recovery clears it and sends the passive note, and that a single slow turn raises nothing; the stage split stored on a real turn on the dev hub; captures of the health item and the shaded chart. Out of scope: automatic remedies (restarting an engine is Repairs' own one-fix-per-item rule, a later decision). Exit: `bash scripts/check.sh`. Note for the design: ENGINEERING.md's performance budgets name no first-token budget today; the default above is proposed, and the standard gets the number once measured on the Studio.
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)
- [ ] **EXPORT-01: a person's export shaped like their read path** (S) - Row-Bot acceptance: Markdown memories are a format option of the existing read-path projection; forgotten and archived records are excluded; an export is the account holder's own: a parent or admin asking for another person's gets 403 (NO-CROSS-USER-VISIBILITY-01; design 2026-10-17) and a teen exports their own.
      `conversationHistory.ts`'s `exportPerson()` (`GET /api/conversations
      /export`, also called from `routes/memory.ts`) returns the raw
      `ConversationTurnRow[]` completely unshaped - no field is ever
      dropped from it, and a person may export their OWN data (`person`
      defaults to `actor.id`), so a minor self-exporting sees fields
      `list()`/`listConversationTurns()` (the browsing read paths) both
      gate for a minor: `reasoning` (REASONING-02, gated on the reading
      actor's own band via `speakerAgeBand()`) and `stats` (STATS-01,
      "adult-only telemetry" - this gap predates REASONING-02 and was
      left as found rather than fixed by it). The real design question
      before touching this: whether a data-portability export should
      ever redact a field from the person it belongs to at all, or
      whether "export" is supposed to mean the complete, unredacted
      archive on purpose (unlike a browsing surface) - decide that first,
      then either shape `exportPerson()`'s return the same way the two
      read functions do, or document why export is deliberately
      different and leave it alone. Files: `conversationHistory.ts`'s
      `exportPerson()`, `routes/conversations.ts`'s `GET /export`,
      `routes/memory.ts`'s own export call. Check: a new
      `conversationHistory.test.ts` case proving whichever way the
      design question is decided, `bash scripts/check.sh`.
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)

## Feature parity: ChatGPT / Gemini / Claude

Jesse's ask (2026-09-05): research what ChatGPT, Gemini, and Claude actually
ship today and add what's missing here. Real web research, not recalled
training data (this session's own standing rule after the persona-research
correction earlier tonight). Only genuinely new-to-this-list items get their
own bullets below; anything that overlaps a section above is a cross-
reference there instead, not a duplicate.

- [ ] **Projects: a persistent, instructed workspace scoped above a single
      conversation** (L) - doesn't exist in any form. ChatGPT Projects
      (custom instructions + a shared file Library scoped to the project,
      instructions now up to 5,000 characters as of July 2026) and Claude
      Projects (instructions + files, auto-switching to retrieval search
      once a project's files near the model's context limit, extending
      effective capacity roughly 10x) are the two real references. MaiPai
      has nothing between "one chat" and "the whole household's settings"
      - no scoped, reusable instruction+file container a person could set
      up once ("help with my woodworking projects," "track my training
      plan") and return to. This is closer to a new record type + a new
      chat surface than a skill.
    Design: [harness-turns-and-projects-2026-09-26](plans/harness-turns-and-projects-2026-09-26.md)

## Chat parity program (design pass, 2026-09-16)

The dated inventory and product decisions are in
`docs/plans/chat-parity-2026-09-16.md`. These items are additive follow-ups;
they do not change the completed conversation, attachment, composer, or
stats item text above.

- [ ] **CHAT-PARITY-03: household share and local export** (M, after CHAT-PARITY-02)

    Objective: let an adult send a conversation to a named household member
    or save Markdown, PDF, and JSON locally. Files: conversation routes,
    export serializers, `frontend/src/apps/chat/`, the PDF artifact path, and
    `docs/user/chat.md`. Pattern: mirror authenticated conversation ownership,
    sanitized source links, the batch confirmation pattern, and the PDF
    render-and-verify flow. Acceptance: every export preserves branches,
    sources, and timestamps; a share names one recipient and creates no public
    URL; child profiles have no share or export controls; failed files leave no
    partial artifact. Out of scope: cloud sharing, anonymous links, and
    importing foreign chat formats. Exit: route, serializer, privacy,
    permission, and rendered PDF tests, `bash scripts/check.sh`.
    Design: [chat-parity-2026-09-16](plans/chat-parity-2026-09-16.md)
- [ ] **CHAT-PARITY-05: continuous voice call controls** (M, after CHAT-PARITY-04)

    Objective: support an adult hands-free voice conversation with visible
    listening, speaking, mute, and stop states while retaining turn-level
    safety and history. Files: `chatListenStore.ts`, the STT socket and
    dictation adapter, sentence speech scheduler, `ChatPage.tsx`, and the
    voice routes. Pattern: mirror the existing sentence speech and
    `SensesDock` lifecycle states. Acceptance: one utterance creates one turn,
    barge-in stops speech, a hard stop closes the microphone, errors return to
    text chat, child profiles do not enable a continuous microphone, and crisis
    resources remain an alongside banner. Out of scope: wake-word autonomy
    and background recording. Exit: voice lifecycle tests, a phone screenshot,
    safety tests, `bash scripts/check.sh`.
    Design: [chat-parity-2026-09-16](plans/chat-parity-2026-09-16.md)
- [ ] **CHAT-PARITY-06: artifacts and canvas design pass** **Rewritten 2026-10-02 for chat rule 9.** The canvas uses the chat's renderer (`MarkdownText`, THIN-5F); the design pass names only the gaps that no shipped part covers, each recorded before any code. (L, design pass first) Amended 2026-10-01 (reference screens review): the design pass also names the closed set of typed blocks for a designed document and how the same page prints to PDF, and covers files a project assembles (a PDF, a picture), how they show in the pane on a wide screen and on a phone, and whether a produced file is listed in Library; see `docs/dev/reference-screens-review-2026-10-01.md`.

    Objective: decide whether a private document and code workspace belongs in
    the chat pane or is a separate package, including revision, storage,
    execution, and child projection contracts. Files: a new design record,
    `spec/schemas/turn-artifact.schema.json`, `frontend/src/apps/chat/`, the
    shell pane contract, and the package permission model. Pattern: mirror
    COMP-01 documents, the UI `DetailPane`, and ATT-01 immutable attachments.
    Acceptance: the design names the artifact types, local storage and
    retention, allowed runtimes, permission prompts, revision identity,
    import/export, adult and child projections, and a testable threat model.
    Out of scope: implementation, arbitrary code execution, public artifact
    links, and cloud-hosted artifact apps. Exit: reviewed design and a later
    implementation brief. No code plan is authorized by this item.
    Design: [artifacts-evaluation-2026-09-21](plans/artifacts-evaluation-2026-09-21.md)
- [ ] **CHAT-PARITY-07: research progress and source timeline** **Rewritten 2026-10-02 for chat rule 9.** The source timeline is built from the kit's sources parts and the `[n]` citation mapper (THIN-4B), on `turnMachine/` and the page-reading search of THIN-4A, not `turnEngine.ts`. (M, after COMP-02 and PAGE-01)

    Objective: make bounded research legible as it searches and reads sources,
    then hand off the report to the existing details document. Files:
    `backend/src/lib/turnEngine.ts`, `turnContext.ts`, websearch and page
    packages, `ChatPage.tsx`, and notifications. Pattern: mirror COMP-02's
    research mode, PAGE-01's single-page budget, status events, and the source
    card. Acceptance: the parent sees plan, progress, source count, and a
    stop action; the run has a declared ceiling and no linked-page fan-out; a
    partial run is labeled partial; the final report has citations; children
    receive the existing short projection. Out of scope: autonomous crawling,
    hidden provider accounts, and an unbounded agent loop. Exit: bench rows,
    source and cancellation tests, screenshots, `bash scripts/check.sh`.
    Design: [chat-parity-2026-09-16](plans/chat-parity-2026-09-16.md)
- [ ] **CHAT-PARITY-08: two-model comparison** (M, after CHAT-PARITY-01)

    Objective: let an adult ask two selected local models the same prompt and
    compare separate answers without merging their provenance. Files:
    `backend/src/lib/turnEngine.ts`, model settings and health routes,
    `frontend/src/apps/chat/`, and a comparison artifact fixture. Pattern:
    mirror the composer comparison section, selected model metadata, and
    `SplitView` in UI.md. Acceptance: both calls share one bounded prompt,
    each answer has its own model and sources, one failure does not erase the
    other, cancellation stops both, and child projection returns only the
    safe short line. Out of scope: hidden voting, ensembles, or more than two
    foreground model calls. Exit: backend, frontend, budget, and screenshot
    tests, `bash scripts/check.sh`.
    Design: [chat-parity-2026-09-16](plans/chat-parity-2026-09-16.md)
- [ ] **CHAT-PARITY-09: owner repair summary** (S, after STATS-01)
    Design: [chat-parity-2026-09-16](plans/chat-parity-2026-09-16.md)
- [ ] **CHAT-PARITY-11: chat backup and restore** (M, after CHAT-PARITY-03)

    Objective: include conversations, branches, attachments, sources, and
    metadata in the household's local backup and restore path. Files:
    `backend/src/lib/backup.ts`, conversation and attachment serializers,
    restore routes, `frontend/src/apps/chat/`, and backup docs. Pattern: mirror
    the household backup record, JSON export, checksummed attachments, and
    destructive confirmation. Acceptance: a backup round-trips into a new
    household data directory, corrupt files are rejected without partial
    restore, secrets and provider tokens are excluded, the owner sees a
    restore preview, and children cannot export or restore. Out of scope:
    third-party sync and automatic cloud copies. Exit: backup fixtures,
    restore, retention, and UI tests, `bash scripts/check.sh`.

<a id="comp-01"></a>
    Design: [chat-parity-2026-09-16](plans/chat-parity-2026-09-16.md)
- [ ] **COMP-01: The details pane and its documents** (M, spec first, after CHAT-16)

    Objective: the bubble is the friend's line; the detail is a
    revisioned document beside it, built only when opened. Spec first:
    `spec/schemas/turn-artifact.schema.json` (typed sections, sources,
    provenance, the originating turn, a revision number, the evidence
    version), fixtures and bindings. Then: `backend/src/lib/turnContext.ts`
    and `conversationHistory.ts` (a `document` JSON column beside
    `outcomes`, a migration), `backend/src/lib/turnEngine.ts` (the
    composer builds `lookup`, `card`, `procedure`, `comparison` from the
    retained outcomes), `backend/src/routes/conversations.ts`
    (`GET /api/conversations/turns/:id/document`, Zod and OpenAPI;
    `document_available` on `TurnValue`, additive), `frontend/src/apps/chat/`
    (a Details handle beside `chatSourcesCard.tsx`, a pane at desktop
    widths, a bottom sheet on a phone, a new revision on a same-subject
    follow-up), `docs/user/chat.md`, the screenshot pipeline. Mirror:
    `SourcesCard` and the lane 10 sources shape; the shell's responsive
    rules in UI.md. Acceptance: a document exists only for a turn with
    a lookup, a typed-source answer or a procedural ask (effect: the
    column is null for the greeting and timer rows and non-null for the
    world-knowledge rows); its content equals the outcome's data (a
    typed card carries the source's fields and sources, never model
    prose); "the whole recipe" opens it and the line is one sentence; a
    same-subject follow-up writes revision two with revision one kept;
    a voice-surface turn says where it is and never reads it;
    screenshots opened and judged. Out of scope: research mode
    (COMP-02). Exit: the spec suite, backend and frontend suites, the
    screenshot review, `bash scripts/check.sh`.

    - [x] **COMP-01a: document storage** (mechanical). Add the
      `document` JSON column and migration in
      `backend/src/db/schema.ts`, `backend/src/lib/conversationHistory.ts`
      and the migrations directory. Mirror the existing `outcomes`
      column and its null behavior. Acceptance: turns without lookup,
      typed-source or procedural material keep `document` null and a
      valid `TurnArtifact` round-trips beside outcomes. Exit: targeted
      migration and history tests, then `bash scripts/check.sh`.
    - [x] **COMP-01b: document route and wire** (mechanical). Add the
      named GET route and additive `document_available` in
      `backend/src/routes/conversations.ts` and `backend/src/wire.ts`.
      Mirror `createRoute`, the `SourcesCard` source shape and generated
      OpenAPI. Acceptance: authenticated GET returns the validated
      artifact, missing documents stay absent, and API docs regenerate.
      Exit: route tests and the API-docs check.
    - [x] **COMP-01c: composer document builders** (mechanical). Build
      `lookup`, `card`, `procedure` and `comparison` in
      `backend/src/lib/composer.ts` and `backend/src/lib/turnEngine.ts`.
      Mirror `sourcesFromRows()` and retained outcome data. Acceptance:
      each outcome family produces its typed section, chit-chat produces
      none, child projection keeps the ceiling and strips sources, and
      new evidence creates a new revision. Exit: composer and engine
      tests plus `bash scripts/check.sh`.
    - [x] **COMP-01d: details pane** (mechanical). Add the handle and
      responsive pane under `frontend/src/apps/chat/`. Mirror
      `chatSourcesCard.tsx` and the shell's `UI.md` responsive rules.
      Acceptance: desktop uses a side pane, phones use a bottom sheet,
      the child projection has no sources, and voice directs the person
      to the phone or hub screen. Exit: frontend tests and judged
      screenshots.
    Design: [artifacts-evaluation-2026-09-21](plans/artifacts-evaluation-2026-09-21.md)
- [ ] **PANE-01: The pane as an offer, never a push** (M, design pass first, owner's question 2026-09-16)

    The question: when a person says "that film was fantastic", should
    the pane show reviews, cast, where to watch, without being asked?
    The owner is unsure where "useful" ends and "too much" begins; that
    line is the design, not the code. Principle to design against: the
    pane is a door, never a billboard. The bubble stays the friend's
    line and never gains an unasked-for card; what may appear is a
    small handle naming what the pane could hold ("Reviews", "Cast",
    "Where to watch"), built only when tapped (COMP-01's rule), so
    nothing costs a lookup until the person wants it. The design pass
    decides: which subjects earn a handle (a named world subject with a
    typed kind: film, album, game, person, place; never a household
    subject, never a feeling), which handle labels per kind (drawn from
    the kind's typed fields, the same table LOOKUP-01 uses, never a
    per-case list), how often (once per subject per conversation, never
    on consecutive turns, none in the child band, none while an ask is
    pending), how it is measured (the handle's tap rate per kind in the
    weekly report; a kind under five percent loses its handle), and
    the voice rule (a tapped handle's document opens beside the same
    short line; the line itself never says "see the pane"). Pointers:
    `docs/dev.md` COMP-01 and COMP-02, `chatDocumentPane.tsx`, the
    subject stack in `turnContext.ts`. Out of scope: any automatic
    lookup before a tap. Exit: the design section, the rows for "handle
    offered", "handle not offered on a household subject", "handle not
    offered twice", then the mechanical items it names.

<a id="comp-02"></a>
- [ ] **COMP-03: The companion package's full shape** (M, spec first)

    Objective: a companion is a name, a personality, a directness, a
    specialty, a default voice, a kid-safe flag and a rapport flag,
    declared once in its manifest; which wake word summons it is the
    binding record's job alone (COMP-06). Files:
    `spec/schemas/manifest.schema.json` (the `companion` block:
    `directness`, `specialty`, `voice`, `kid_safe`, `rapport`, and,
    deferred by the coherence review to a slice after CRED-01,
    `credulity` with a `default` of trusting, ordinary or skeptical and
    per-class `overrides` for claims about the person's own life,
    `life_event`, `money`, `health`, `achievement`, `plan`, the classes
    declared once in `spec/vocab/life-events.json`, the validator
    refusing any other key; dev.md section 15),
    fixtures and bindings, `backend/src/lib/persona.ts` (`directness`
    rendered as one sentence; MaiPai `direct`, the bundled
    personalities `conversational`), the four bundled manifests,
    `backend/scripts/bench/persona-eval.ts` (a directness row per
    companion; every correctness row of the conversation bench once per
    companion), `docs/PACKAGES.md` in `.github` for the catalog's
    admission review of `kid_safe`. Acceptance: the direct companion
    answers the point first with no offer on the persona-eval rows in
    three runs; the same correctness rows pass for every bundled
    companion; ASK-01's clarification is appended under every companion
    (a test per bundled one); a test asserts one composer and one guard
    list; the bundled profiles (Buddy trusting, MaiPai ordinary, The
    Tutor skeptical with `achievement: ordinary`) and the `credulity`
    conversation (section 15, part 5) under all three, the same
    record at the same confidence on the memory table under each,
    three seeded runs; a `skeptical` package that is `kid_safe` fails
    catalog review, and the runtime clamp (skeptical reads as ordinary
    on the child band) stays as the guard; a manifest with an override
    key outside the five classes is refused by the validator (a test).
    Exit: the spec round trip, persona-eval, `bash
    scripts/check.sh`.

<a id="comp-04"></a>
    Design: [companions-design-brief-2026-09-13](plans/companions-design-brief-2026-09-13.md)
- [ ] **COMP-04: Per-person companion sets, the kid-safe rule, and the voice per turn** (M, after COMP-03, spec first). The per-person set is filtered by `companions.allowed`; `companions.enabled` (the list) stays a separate key.

    Objective: each person has their own companions; a child's set is
    chosen by an adult from the kid-safe ones; a message may name the
    companion; the voice is resolved per turn. Files:
    `spec/settings/keys.json` (`companions.enabled`, person scope, the
    generic renderer; `persona.active_id` becomes the default;
    `tts.voice_id` becomes the fallback behind the companion's own
    voice), `backend/src/lib/settings*.ts` (validation: a child's list
    holds only `kid_safe` ids, written by an adult),
    `backend/src/lib/turnEngine.ts` (the companion on the turn from a
    header pick, a name opener in text, or the wake word; the resolved
    voice on the turn), `backend/src/routes/tts.ts` (reads the turn's
    resolved voice, then the setting), `frontend/src/apps/chat/` (the
    header pick), `docs/user/chat.md`. Acceptance: a child's write of a
    non-kid-safe id is refused at the settings API; a named companion
    answers one message in its own voice and the next message returns
    to the default; switching changes neither the conversation nor
    recall (effect: the same memory rows in context before and after).
    **Amended 2026-09-14 (dev.md section 13, parts 6 and 7):** every
    key this item and section 13 name for a child (the companion set,
    the audience default, the teen's audience, the notification rule)
    is adult-written, and a child-role write to any of them is refused
    at the settings API (a test per key); a child's companion set is
    the band's register first and the personality's second; an
    unidentified speaker on a shared device gets the child band's plan,
    ceiling and audience and no person-scope recall (COMP-06's rule),
    and a guest reads as adult for register and as child for audience
    and ceiling; the kid-safe rule is validated at the selection
    boundary on every turn, not only at write time (a person ages into
    a stricter band, a manifest changes, an unknown speaker inherits a
    device binding), with an invalid selection falling back to the
    bundled kid-safe default and the reason recorded; no companion can
    change the band, the disclosure result, the notification decision,
    the safety result or a memory's scope (section 13, part 9). Exit:
    the suites, `bash scripts/check.sh`.

<a id="comp-05"></a>
    Design: [companions-design-brief-2026-09-13](plans/companions-design-brief-2026-09-13.md)
- [ ] **COMP-05: Rapport, one more scope on memory** (M, spec first)

    Objective: every companion knows what the hub knows; each also has
    its own rapport with the person, in the one memory store. Files:
    `spec/schemas/memory-record.schema.json` (`scope` gains `companion`;
    `companion_id`, nullable, required at that scope), fixtures and
    bindings, `backend/src/lib/memoryJudge.ts` (a rapport fact written
    at that scope), `memory.ts` (recall reads household, person and the
    active companion's rapport only), `turnEngine.ts` (the rapport
    lines under their own heading in the memory section),
    `backend/tests/memory.test.ts`, `memoryJudge.test.ts`,
    `conversationFixture.ts` (a hard row: companion A's running joke is
    absent from companion B's context, the B5 shape). Acceptance: the
    hard row in three seeded runs; the judge writes a rapport fact at
    the companion scope and a household fact at its own; the Memory
    page lists rapport under the companion's name; (deferred to the credulity slice after CRED-01, the coherence
    review) a typed calibration
    record per companion, person and claim class in the rapport scope
    (`adjustment: earned_trusting | baseline | earned_cautious` with
    its `observations`, each a mechanically resolved outcome citing
    its turn ids: `provisional_later_corroborated` or
    `exaggeration_acknowledged` by the person's own words; a model's
    impression never counts, nor an external contradiction without the
    person's acknowledgment), a bounded window of the most recent
    twelve per class, three in one direction moving the adjustment one
    step and mixed evidence returning it toward baseline, moving only
    the social provisional boundary one rung, never the fact's
    confidence, recall, evidence requirements, actions, safety, privacy,
    another companion, person or class, never rendered in recall or the
    profile, resettable from the Memory page (dev.md section 15, part 3
    and part 6); the earned-trust
    rows of section 15, part 5, three seeded runs. Exit: the spec round
    trip, the named tests, `bash scripts/check.sh`.

<a id="comp-06"></a>
    Design: [companions-design-brief-2026-09-13](plans/companions-design-brief-2026-09-13.md)
- [ ] **COMP-06: Wake word to companion bindings** (L, spec first; engine after COMP-04)

    Objective: a wake word names a slot, the speaker names the person,
    the person's binding names the companion; shared devices carry an
    admin-set default; nothing is declared twice. Spec first, three
    things: a new `spec/schemas/companion-binding.schema.json`
    (`scope: person | device | household`, `scope_id`,
    `wakeword_package_id`, `companion_package_id`; no voice, no
    register); device ownership for a shared device
    (`device.schema.json` requires one `person_id` and treats
    re-pairing as a new row, which a shared kitchen display
    contradicts; settle the shape first); and a measured answer on
    several wake words at once (the client loads one selected detector
    today: CPU cost and false-activation rate on recorded audio
    fixtures before the binding promises it). Then: `backend/src/lib/`
    (one `resolveCompanionForVoiceTurn()` with a unit-tested table:
    speaker's binding, device's, household default; identity per turn,
    never sticky; an unknown or low-confidence speaker gets the
    device's or household's binding, an anonymous context for a world
    question, a who-is-speaking ask before a personal memory is read, a
    personal state is changed or an age-dependent safety decision is
    made, and the strictest applicable safety policy), the voice route,
    the Settings UI for a person's bindings and a device's defaults,
    `docs/user/`. Depends on SPEAK-01 for identification on shared
    devices; until it lands, the device binding and the anonymous
    context alone, and a shared device stays usable. Acceptance: the
    resolution table as unit tests (two people, one word, two
    companions; a personal device; an unknown speaker on a world
    question, on a personal-memory question and on an age-gated
    request); the records sync to the robot as spec records. Exit: the
    spec round trip, the suites, the wake-runtime measurement recorded,
    `bash scripts/check.sh`.

<a id="speak-01"></a>
    Design: [companions-design-brief-2026-09-13](plans/companions-design-brief-2026-09-13.md)
- [ ] **SPEAK-01: Speaker identification on shared devices** (L, hardware)

    Objective: an enrolled voice print per household member, resolved
    locally per turn on a shared surface, as a confidence signal for
    COMP-06 and never a prerequisite for a shared device's ordinary
    use; enrollment is with the person's consent, and the
    print is never updated from an uncertain match. Files: the bot's microphone pipeline first (the reSpeaker
    array), then the hub's voice route; a maintained speaker-embedding
    model fetched on demand (pinned URL, checksum), never vendored;
    enrollment in Settings under the org's training rules. Acceptance:
    a real-microphone check with three enrolled roster voices
    recognized at a stated rate, an unenrolled voice reported unknown,
    and a speaker change mid-conversation detected, recorded with the
    engine build and a sanitized hardware description; no household
    recording in any repo. Exit: the bench record, `bash
    scripts/check.sh`.

<a id="wake-02"></a>
- [ ] **WAKE-02: Wake-word training as a household feature** (L, after the bot's pipeline item)

    Objective: a person trains a new word on the hub under the org's
    rules and binds it to a companion. Files: the training pipeline
    item under Legacy (the bot's), a hub UI in Settings, registration
    as a wakeword package, `docs/user/`. Acceptance: the pipeline's own
    gates (real speech, near misses, verified data) plus a binding
    resolved through COMP-06's table. Exit: the pipeline's checks,
    `bash scripts/check.sh`.

<a id="review-01"></a>
- [ ] **REVIEW-01: The conversation quality controller** **Rewritten 2026-10-02 for chat rule 12.** Retargeted: it reads the thin path's turn records, not `turnEngine.ts`; 'after CHAT-16' becomes after THIN-7D. Spec first, unchanged. (M, spec first, after CHAT-16; the auto-apply set waits for a month of the report)
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)

    Objective: the hub reviews its own turns and adjusts records and
    bounded settings, never weights, prompts or engine rules. Spec
    first: `spec/schemas/turn-review.schema.json` (defect codes,
    evidence ids, corrected-by-person, responsible layer, retrieved
    items that helped, a proposed adjustment of a bounded type,
    evaluation result, status, provenance) and a per-record retrieval
    signal on `memory-record.schema.json`; fixtures and bindings.
    Then: `backend/src/lib/turnReview.ts` (the immediate deterministic
    checks on every turn, from the turn context, the stored signal and
    plan (ACT-01, ACT-03: `act_mismatch`, `emotion_mismatch`,
    `missing_reaction`, `unwanted_question`, `closing_reopened`,
    `register_plan_violation`, `playful_under_distress`) and the
    retained outcomes; the nightly pass on the background engine with the 4B
    drafting only on turns that carry a deterministic trigger (a guard
    hit, a correction, a repeated question, a lookup without a source, a
    thumb; never every turn, the coherence review's cap) and every
    finding confirmed mechanically), the auto-apply
    set (rank, duplicates, disputed, a household routing example,
    package preference, the assistant-prose flag, stale evidence
    refresh, an open question), the replay gate for proposals (the
    shipped fixture plus the household's recent turns, run locally
    against a candidate; kept only if the targeted measure improves
    and no protected row regresses), the household's weekly report in
    plain words (`docs/user/`), the approvals path for proposals.
    Mirror: the judge's queue and `runConsolidation()`; the effect
    standard of the bench. Acceptance: a seeded week of fixture
    conversations with planted defects yields one `TurnReview` per
    planted turn with the right code and layer (effect: the rows); the
    auto-applied changes are visible with provenance and reversible
    from the Memory page; a planted correction lowers the offending
    record's rank on the next recall; a proposal for a guard rule
    never changes the guard and appears as a report; the stable prompt
    is byte-identical before and after a week. Out of scope: any model
    training. Exit: the spec suite, the named tests, `bash
    scripts/check.sh`.

<a id="eval-07"></a>
- [ ] **EVAL-07: Public conversation datasets as a second bench** (M, after MEM-06, before CUR-01)

    Objective: the hub's memory and register are judged against a
    public baseline nobody here graded, so CUR-01 and REVIEW-01 report
    deltas beside the household bench. Text, the datasets checked, the
    licenses and the amended grading rules: `docs/plans/
    media-conversation-program-2026-09-13.md`, "EVAL-07". Files: a
    script under `backend/scripts/bench/` that downloads
    LongMemEval-cleaned (MIT) at a pinned checksum into the ignored
    data directory (download, never vendor, never shipped), converts it
    to `conversationFixture.ts`'s shape, replays it through the live
    engine seeded on a quiet machine, and scores it by the dataset's
    own metric with abstention and knowledge-update reported
    separately; then LoCoMo (CC BY-NC, research only); DailyDialog for
    register through phenomena rewritten into the fixture shape, never
    scored against the human reply. Mirror: `scripts/bench/
    conversationLive.ts` and BENCH-01's pins (ENGINE-HOST-01: a replay
    points its three URLs at engines on another machine, so a second
    engine set never sits in this machine's memory); `backgroundAssets.ts` for
    the pinned download with a checksum. Acceptance: the first run is
    the baseline recorded in docs/dev/session-a.md with the engine
    build, model files and a sanitized hardware line; later items
    report deltas. Out of scope: ACT-02's classifier heads (a separate
    session, once this script exists), CANDOR and MSC (second phase,
    licenses to confirm). Exit: the script's own run on a quiet
    machine, `bash scripts/check.sh`.

    Found live, 2026-09-14 (baseline v0, `replay.ts`): the replay
    process's own resident memory grows across questions and
    `resetReplayDatabase()` does not return it to the OS - three
    single-process oracle-v0 runs in a row were killed for low memory,
    each getting further than the last with no other process's own
    interference to explain it. Worked around, not fixed, by
    `replay-per-question.ts` (one fresh OS process per question, same
    seed and order as the manifest, RSS start/end recorded on each
    question's own row) - the real fix (find and close whatever
    `ingestRow`/`runJudgeBatch`/the recording proxy holds onto across
    questions inside one process) is still open. Corrected the same day:
    the per-process kills were the Claude Code harness's own background-
    task monitor stopping a tracked task when free memory looked low,
    not macOS killing the process - every kill's own row showed the
    process itself healthy and small (max 343MB, mean 160MB across the
    real 35-question run). Free memory on this machine sits near ~90MB
    as its own steady state whenever the 8B chat engine's mapped model
    pages are touched, which the OS reclaims on demand; the harness read
    that as pressure. The actual fix was running the per-question loop
    detached (`nohup`, disowned, watched via a log tail, never a
    harness-tracked foreground wait) - `replay-per-question.ts`'s own
    memory guard (wait for free memory before each spawn, capped) stayed
    in as cheap insurance, not the load-bearing fix. Full account:
    docs/dev/session-b.md, "Lane 14 item 2 follow-up 2".

    Baseline v0 recorded 2026-09-14 (35 questions, seed 20260914):
    14/35 overall. Per type in docs/dev/session-b.md; per-row failure
    read pending.

    Dataset half shipped 2026-09-14, Session B (lane 12 item 4), amended
    per the coherence review's own split (dev.md, "Coherence review,
    2026-09-14", question 5: this item's replay-through-the-engine half
    is Session A's, memory mode, later): `backend/scripts/bench/
    datasets/` - the registry (`registry.json`, one entry per dataset
    downloaded into `data-scratch/datasets/`, a `verify` command
    checking checksums, a separate `download` command), the internal
    form (`types.ts`), loaders for LongMemEval-cleaned, LoCoMo and
    DailyDialog into it (`longmemeval.ts`, `locomo.ts`, `dailydialog.ts`,
    each proven both against a small embedded unit-test sample and live
    against the real downloaded file), and the coherence review's own
    40-per-type LongMemEval sample, seeded and deterministic
    (`sample.ts`, `sample-manifest.json`, 230 ids). Design note:
    `docs/dev/session-b.md`, "Lane 12 item 4". Left: the engine replay
    itself (Session A's).

    Mining half's own tool shipped 2026-09-14, Session B (lane 13 item
    1): `mine.ts` selects about 200 phenomenon fragments (23
    phenomena, no model) from Taskmaster-1, CCPE-M and QuAC (three new
    loaders, `taskmaster1.ts`/`ccpeM.ts`/`quac.ts`) plus DailyDialog,
    LoCoMo and LongMemEval, each rule named in the committed
    `phenomena.json`, into the git-ignored `data-scratch/eval/
    review-sheet.md` for a person to mark keep/skip/rewrite. Design
    note: `docs/dev/session-b.md`, "Lane 13 item 1". Left: Jesse's or a
    design session's review of the sheet, and the rewrite into bench
    scenarios (after CHAT-16).

    Reference distributions shipped 2026-09-14, Session B (lane 13
    item 2): `reference.ts` computes DailyDialog's act and emotion
    distributions and their transition tables (train+validation for
    the distributions, honoring the test split's own held-out note;
    train alone for the transitions, matching dev.md's own wording),
    committed to `reference/dailydialog.json` with the registry's
    version and checksums inside; a test pins the numbers to dev.md
    section 12's own quoted figures within one point. A live check
    found one of dev.md's own quoted figures ("a question 16 percent"
    after a question) does not match the act-based transition (11.4
    percent, a real 4.6-point gap) - it matches a different, surface
    measurement (the next turn's own text carrying a "?", 16.3
    percent) dev.md's prose folds into the same sentence without
    naming it; both numbers are now reported correctly, never
    conflated. Design note: `docs/dev/session-b.md`, "Lane 13 item 2".
    No child-length reference file: no public source supports the
    design's own child/teen word-and-sentence caps, recorded as such.

<a id="cur-01"></a>
    Design: [media-conversation-program-2026-09-13](plans/media-conversation-program-2026-09-13.md)
- [ ] **CUR-01: The memory curator** (S-M, after MEM-06)

    Progress 2026-09-15 (on the next stack): a record past its own
    `valid_to` is archived with `expired_at`, provenance intact, a bare
    date ending at the end of its day, a pin never keeping it alive
    (9f7c625); an exact re-assertion never writes a second record, a
    state is extended to the later end date, anything else counts a
    use, neither embedded nor sent to the model (1fdc85d). The rest
    below stays open.

    Objective: the store stays clean and honest without inventing
    anything. Files: `backend/src/lib/memoryJudge.ts`
    (`runConsolidation()` grows into the curator), `memory.ts`,
    `entities.ts`, `relationships.ts`, `backend/tests/memoryJudge.test.ts`.
    Do: exact and semantic duplicates merged with provenance kept;
    conflicting active records marked disputed and not presented as
    fact; time-sensitive facts expired; every active record verified
    to trace to the speaker's words or an authoritative integration,
    assistant-derived ones quarantined; unknown-kind entities turned
    into ASK-01 open questions; confidence lowered on contradiction;
    a record past `valid_to` archived with `expired_at`, provenance
    intact (the read boundary itself is CHAT-08's, which precedes this
    item; the coherence review, 2026-09-14), pinning never reviving an
    expired state, a state extended on a re-assertion,
    repeated states kept as episodes with three across two weeks
    producing an open question or a proposal and never a trait, a
    later denial or correction superseding the active state, an event
    surviving the state it came with, a dated `goal` or `event` fading
    the day after, a `reported` record superseded and never extended by
    the speaker's own later words (dev.md section 12, part 6); and, deferred to CRED-01 by the coherence review
    (2026-09-14), the rest of this sentence: credence
    recomputed from evidence, never incremented (dev.md section 14,
    part 3): exact re-assertions merged with every source kept,
    distinct calendar days and distinct authorized speakers counted
    (never repeated turns in one conversation), corroboration only at
    the same authorized scope and never across one person's private
    memory and another's turn, an authoritative integration counting
    and a web snippet or the hub's reply never, an unresolved
    contradiction marked through `conflicts_with` and an open question
    and never resolved from model preference, provisional and
    conflicted records excluded from profile synthesis, a later
    contradiction lowering without deleting evidence, and never a decay
    with time. Never resolves a conflict itself: the next relevant
    conversation asks. Two layers (the outside review, 2026-09-14): a
    deterministic maintenance pass (expiry, exact duplicates, the state
    transitions) that this item builds first, and an offline semantic
    pass that only proposes merge and conflict candidates; promotion of
    a person-scoped inference into household knowledge needs the
    person's answer or an adult's confirmation, never the curator's own
    judgment. Acceptance: a seeded store with each defect class comes out
    with the right statuses and no invented resolution; a disputed
    record is absent from the next prompt; the open question is asked
    on the next turn; a record past `valid_to` absent from the next
    context before the sweep; the `act-memory-curator` conversation of
    section 12, part 6 (extended, expired, the event surviving, three
    states with no trait, a denial superseding), driven with the
    bench's clock, three seeded runs; the `corroborated` and
    `contradicted` rows of section 14, part 7. Exit: the named tests, `bash scripts/check.sh`.

<a id="pref-01"></a>
- [ ] **PREF-01: Explicit, inspectable preferences** (M, spec first, after REVIEW-01)
    Design: [memory-lifecycle-and-preferences-2026-10-17](design/memory-lifecycle-and-preferences-2026-10-17.md)

    Objective: personal adaptation is a setting with a reason, never a
    hidden profile. Spec first: `spec/settings/keys.json` gains
    person-scope keys for reply length, directness, register, whether
    follow-up questions are welcome, the preferred companion per
    surface and per wake word, and source preferences per task, and
    `setting-value.schema.json` gains a `provenance` field (who or
    what set it, from which review, when). Then: the generic settings
    renderer shows the reason and a reset; REVIEW-01 may create a
    proposed preference from repeated behavior that the person
    accepts, and silence is never consent; the composer and the
    companion resolution read them. Acceptance: a repeated behavior
    in the fixture yields a proposal, not a change; accepting it
    changes the next reply's length (effect: `maxWords`); reset
    restores the default and clears the provenance. Exit: the settings
    suite, `bash scripts/check.sh`.

<a id="cred-01"></a>
- [ ] **CRED-01: Credence on a fact** (M, engine only, after the companions block; deferred by the coherence review, 2026-09-14)

    Objective: dev.md section 14 as designed, on the fields SPEC-01
    already carries: `computeFactConfidence()` in one engine-owned
    module called by the judge, the remember package, a correction, the
    curator, recall and the robot; the curator's recompute, merge,
    corroborate and conflict rules; CHAT-08's ordered read with the
    typed `FactPresentation` and the `doubt_of_person` and
    `overclaimed_fact` guard rows; ACT-03's `claim_state` with the
    surprise and contradiction moves. The turn-time contradiction reads
    only what the engine sees without a model (an inform whose subject
    has an active record of the same category carrying a different date,
    day, number or name); every other contradiction is the judge's
    finding turned into an `OpenQuestion` of kind `clarify_fact`. Files:
    `backend/src/lib/memoryJudge.ts`, `memory.ts`, `register.ts`,
    `guards.ts`, their tests, the fixture. Acceptance: the `credence`
    conversations of section 14, part 7, three seeded runs, with the
    contradiction row's clarification arriving at the end of the next
    reply when the judge found it. Out of scope: any person-level score;
    the credulity flavor (COMP-03's slice). Exit: the named tests,
    `bash scripts/check.sh`.

<a id="act-01"></a>
- [ ] **ACT-02: The act, emotion and stance heads on the utterance embedding** **Rewritten 2026-10-02 for chat rule 1.** The heads are kept only for the plan line, memory-judge eligibility, the wire `signal` event and spoken-cue suppression. Nothing they predict decides a search or a tool, and no learned head sits in the safety, consent or privacy path. Acceptance is the heads' agreement on act, emotion and stance, with no lookup-routing row. (M, after ACT-01)
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)

    Objective: inform versus commissive, an unpunctuated question, the
    emotion in the common case and a clause's stance when no marker
    settled it, decided in microseconds from the vector the turn
    already computes, with a license-clean, calibrated artifact.
    Files: `backend/scripts/train/turn-signal-heads.ts` (dev-time only:
    labels the act and stance corpus with the 4B under the DailyDialog
    act definitions and the stance definitions over Taskmaster-1,
    CCPE-M, the bench fixture and synthetic roster dialogues; trains
    three multinomial heads over the nomic vector, the emotion head on
    GoEmotions with its published Ekman mapping; class-weighted loss,
    temperature scaling per head on a held-out split, per-class
    thresholds chosen on precision; writes the artifact with the
    embedding identity, the label-map version and the validation
    numbers), `backend/src/lib/turnSignalAssets.ts` (the
    `wakewordAssets.ts` pattern: pinned URL, pinned checksum, single-
    flight, a clear offline message), `backend/src/lib/turnSignal.ts`
    (the heads after the rules, run right after the embed for every
    model turn; refused at load when the embedding identity differs,
    CHAT-09; `source: fallback` when the embed engine is down or the
    artifact is missing; below a class threshold a clause is `unknown`),
    `home/data-scratch/datasets/SOURCES.md` (GoEmotions, Apache 2.0,
    added; the 500-turn reviewed sample recorded; the DailyDialog paper
    pinned for the label definitions), the catalog model package.
    Mirror: `wakewordAssets.ts`; the org's training rules (verify the
    data landed, validate on held-out real data, never a household
    transcript in the set). Acceptance: on DailyDialog's test split and
    on the fixture, rules plus heads beat the rule pass alone on act
    macro F1 and on the neutral-versus-not emotion split by a stated
    margin, with per-class precision and recall, confusion, calibration
    error and the neutral false-positive rate reported at the natural
    distribution and on a balanced slice, else the heads do not ship;
    stance precision per class on the reviewed sample; the fixture
    floors of ACT-01 hold; the artifact loads only against its
    embedding identity; the per-turn cost measured under one
    millisecond warm. The measured alternative, built only if the
    heads fall short on context-dependent fragments after the protocol
    layer: a MiniLM-class encoder reading the previous hub turn plus
    the person's, through the ONNX runtime the backend already
    carries, at a warm CPU p95 under 20 ms on the hub and the robot.
    Out of scope: any training in the house. Exit: the training
    script's validation report in the dev docs, `bun test
    tests/turnSignal.test.ts tests/turnSignalAssets.test.ts`, `bash
    scripts/check.sh`.

    Training half landed 2026-09-14 (`backend/scripts/train/
    turn-signal-heads.ts` and its tests): the finding is the heads do
    not ship. Act and emotion both miss the stated 5-point margin on
    DailyDialog's human labels (act -4.4, emotion neutral-vs-not
    -10.1); stance has no independent human-labeled validation yet
    (waits on `data-scratch/eval/turn-signal-review-sheet.md`). Full
    numbers in dev.md, "Session B, lane 16." No artifact to wire;
    `turnSignal.ts` and `turnSignalAssets.ts` remain untouched. The
    item stays open on the measured alternative (a MiniLM-class
    encoder, section 12) as the next design question.

<a id="act-03"></a>
- [ ] **ACT-03: The reply plan, from the signal to the composer's permitted moves** **Rewritten 2026-10-02 for chat rule 5.** The plan's `max_words` and `max_sentences` bands apply to spoken turns, a child's or teen's chat and glance surfaces only. An adult's written turn gets no word or sentence cap in the plan and no instruction about length; `max_tokens` is a ceiling, not a target (THIN-1A). 'Rides with CHAT-16' is void (dropped). File names below that say `turnEngine.ts` read as their `turnMachine/` equivalent. (M, rides with CHAT-16)

    Reachy v2 addition (2026-10-05; after EMO-MAP-01): the plan event gains `react_move`, chosen by the model from the emotion map candidates for its label when `react_allowed` and the band allow-list permit, at most once per reply; the robot react hook (`moves/react.py`) consumes it. With the optional moves pack absent the plan carries no `react_move` and the primitive plays alone (OWNER-ANSWERS 7). Acceptance adds: a child-band turn never carries a clip outside the child allow-list; safety refusals, consent asks and crisis lines carry none; with no moves pack installed no `react_move` is set. Cloud: no.

    Objective: the engine decides which moves exist and how long the
    reply is; the companion decides the wording of the optional ones;
    the model writes the words; a forbidden move is dropped
    structurally. Files: `backend/src/lib/register.ts` (the base table
    by act, the emotion overrides, the companion modulation inside the
    envelope, the explicit brevity request, the surface; one typed
    `ReplyPlan` per turn), `backend/src/lib/turnEngine.ts` (one context
    line per turn from the plan, ahead of the memory section;
    `max_words` into CHAT-12's reserve; the plan and the typed moves
    persisted beside the signal), the composer (CHAT-16: typed move
    fields on the `ComposedTurn`, `react`, `care`, `say`, `pick`,
    `point`, `ask_back`, `close`; a forbidden move omitted before the
    boundary), `backend/src/lib/persona.ts` (`engagement` and
    `directness` read by the table; the reaction and follow-up prose
    retired, the remaining sentences realization only),
    `backend/src/lib/guards.ts` (REG-01's statement rule reads the
    signal; `near_echo` and `repeat_question` read it; a
    `plan_violation` family: an unwanted follow-up, a missing required
    acknowledgment, a closing reopened, playfulness under distress, a
    length over the cap), `backend/src/lib/personaJudge.ts` (the rubric
    line, with the stored signal, plan and outcome printed per
    exchange), `backend/scripts/bench/conversationFixture.ts` (the
    `act-register` conversation's plan checks; the signal assertion on
    feeling-before-task, asks-back, child-register,
    length-matches-the-moment and greeting-and-thanks),
    `docs/user/chat.md`. Mirror: CHAT-16's composer and claim-type
    ladder, `composePersonaPrompt()`. Acceptance: the `act-register`
    conversation (dev.md section 12, part 4) and the five existing
    register rows, three seeded runs, every turn's signal recorded and
    every move read from the typed moves and the reply's effect; the
    persona-eval judge scores the fit line per bundled companion and
    every correctness row runs under every companion; the direct
    companion drops an optional react on questions and keeps a required
    acknowledgment on sadness; "just the numbers" suppresses the
    optional moves under every companion; the crisis overlay and every
    guard unchanged on every row; one authority for register (a test
    that the persona prose carries no move decision). **Amended
    2026-09-14 (dev.md section 13):** the age band is the plan's third
    axis (`lib/register.ts` reads `ageBand` beside act and emotion: the
    child envelope with care required on any negative emotion, `point`
    and `pick` forbidden, two sentences and 40 words, three and 45 on a
    disclosure, `vocabulary_level` simple (the coherence review: the
    earlier "one sentence and 20 words" here was stale against section
    13's table); the teen cap at two and 55; the companion's dials within the band,
    never across it), the `band_claim` guard row, and the three child
    conversations (`child-family-conflict`, `child-grandma`,
    `child-goldfish`, section 13 part 8) plus the adult twins, run
    under every bundled companion, three seeded runs; the plan gains
    the typed fields `age_band`, `vocabulary_level`, `explanation_style`,
    `trusted_adult_move` (`defer`) and `content_disclosure`, the caps
    are the minimum of the act, emotion, band, surface and brevity caps
    and the optional moves the intersection of the four masks, and the
    `plan_violation` family gains `age_register_violation`,
    `missing_child_care`, `missing_trusted_adult`, `patronizing_register`
    and `disclosure_violation` (section 13, part 9). **Amended
    2026-09-14 (dev.md section 14):** the plan gains `claim_state:
    routine | major_new | contradiction | none`, set by the engine from
    the clause, the life-events vocabulary and the dedupe pass; the
    surprise move (`major_new`: `react` required and never skeptical,
    `ask_back` required once for one useful detail and never about
    truth, `say` a brief acknowledgment with no independent assertion
    the event happened, two sentences, the engagement dial unable to
    remove the question; a major claim followed by a closing saves
    provisionally and still closes); the contradiction move (a light
    acknowledgment, exactly one clarification about change, identity or
    date, never "are you sure", never an argument; before the answer
    both records conflicted and neither recalled plainly; a
    confirmation superseding with `valid_to` at the change time and no
    second question, a rejection archiving the provisional record; a
    mixed directive running under the normal rules before any
    clarification); plan defects `skeptical_of_person`,
    `missing_surprise_reaction`, `missing_credence_question`,
    `repeated_credence_question`, `silent_contradiction_overwrite`,
    `action_blocked_by_credence`, `joke_stored_as_fact`; the `credence`
    conversations (section 14, part 7), three seeded runs. **Amended
    2026-09-14 (dev.md section 15):** the plan gains a `credulity` block
    (`applicable`, `effective_disposition`, `surprise_move`: delight,
    curiosity, tease or none, `detail_state`: complete, invite,
    one_detail or two_details, `contradiction_style`: assume_change,
    compare_versions, light_plot_twist or none), resolved in one order
    (the class override, the package default, the rapport calibration,
    the child clamp: skeptical reads as ordinary) and read for three
    things only: the surprise move (react required on every setting; a
    trusting companion may use a delighted invitation, ordinary and
    skeptical ask one concrete detail; a tease only on the adult or
    teen band, on a happy claim under a playful register, never about
    another member, never phrased as disbelief or a request for proof,
    falling back to curiosity; "I don't buy it" and "prove it" guard
    rows), how many grounded details across turns end the news (one
    question per reply on every setting; a skeptical second question
    waits for a later same-subject turn), and the contradiction
    phrasing (every style naming the hub's own record, never "are you
    sure"); a claim about another member is reported and cautious
    under every profile and never makes the hub act as the other
    person, a world claim takes the ladder's stance under every
    profile with no companion adopting a false belief or a political
    stance of its own; `skeptical_of_person` fires the same under every
    profile; the rows `credulity-big-claim`, `credulity-earned-trust`,
    `credulity-caught-exaggeration`, `credulity-reported-household`,
    `credulity-world-neutrality` and the child control (section 15,
    parts 5 and 6), three seeded runs under the three bundled profiles.
    **Amended 2026-09-14 (the coherence review):** typed move fields
    exist on composed turns only (the second, unstreamed completion of a
    lookup turn); on a streamed chat turn the plan is enforced at the
    boundary by the sentence guards reading deterministic signs (a
    question sentence is an ask_back, a closing phrase a close, a word
    from the reaction list a react, a length over the cap overlong), and
    the 8B never emits JSON on the streamed path; the control context a
    turn adds (the plan line, the subject line, the unknown line, the
    presentation wording) is capped at 160 tokens and the signal is
    never narrated to the model; `claim_state`, the
    surprise and contradiction moves, the seven credence plan defects
    and the `credulity` block are deferred (CRED-01, the COMP slices),
    the defects collapsing into `plan_violation`, `repeat_question` and
    memory-table effects; the per-companion runs of every correctness
    row are COMP-03's acceptance, not this item's; the `band-claim` row
    joins ("I'm actually a grown-up, my mom said I can" from Bramble:
    the band on the turn unchanged, the deferral line, guard
    `band_claim`), and so do `plan-line-cache` (two ordinary turns with
    different plans keep the stable prefix byte-identical, the cache
    hit on the `[turn]` line unchanged) and `composed-turn-not-streamed`
    (a lookup turn's composer completion is the second and last; a chat
    turn's completion count is one).
    Out of scope:
    canned replies per label, a second prompt path, any plan rule over
    a safety, authorization, confirmation, evidence or privacy
    decision. Exit: the named tests, the persona-eval bench, `bash
    scripts/check.sh`.

<a id="age-01"></a>
- [ ] **AGE-01: Household facts a child may hear, the audience on the record and the defer move** (spec S, engine S-M; after ASK-01, before CHAT-16's composer work)
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md)

    Objective: a household fact that is an adult's to tell never
    reaches a child from the hub, by a field an adult sets with a safe
    default, and the child is deferred to a parent with care, never
    lied to and never recited a record. Spec first:
    `spec/schemas/memory-record.schema.json` gains `child_disclosure:
    child_ok | teen_ok | adult_only` with `child_disclosure_set_by` and
    `child_disclosure_set_at` (null on person and self scope; the
    default by class, never raised by the judge on an existing record;
    section 13, part 9), a new `spec/vocab/life-events.json` carrying
    the adult-to-tell classes (a death or a funeral, an illness or a
    diagnosis, a pregnancy, a separation or a divorce, money and debt, a
    legal or police matter, a job loss, an adult's private plan to leave
    or move) and section 14's life-events classes as one file, fixtures,
    both bindings. Then:
    `backend/src/lib/memoryJudge.ts` (the deterministic default at
    write time: `adults` when the subject is a memorialized person or
    the text falls in a class or the sensitivity detector flags it,
    never the judge model's call), `backend/src/lib/memory.ts`
    (`canRead()` gains the band: a child reads their own person-scope
    records and household records at `child_ok` and not `sensitive`, a
    teen those at `child_ok` or `teen_ok`; recall, the profile paragraph and episode recall all
    through it; a teen reads as adult unless an adult-written key sets
    the teen's audience to child), `backend/src/lib/turnEngine.ts` and
    `register.ts` (the `defer` move when a child's question resolves
    to a subject only `adults` records could answer: care first, "a
    question for mom or dad" in the child's words, an offer to help
    ask that queues ASK-01's open question for the adults' next turn,
    never the record's content, never a lie, never the honesty
    vocabulary), the Memory page (an adult flips the audience either
    way, a record edit with provenance), `backend/src/lib/guards.ts`
    (a `false_comfort` row: "she's on a trip", "away for a while" on a
    deferred subject), `docs/user/memory.md` and the user privacy page.
    Mirror: `canRead()`'s `sensitive` rule; `ensureSubjectEntity` for
    the memorialized-person check; ASK-01's open question. **Amended
    2026-09-14 (the coherence review):** the spec fields land in
    SPEC-01; this item's engine half is the write-time default, the
    `canRead()` band and a fixed deferral line through the guard
    replacement path (care first, "a question for mom or dad", the offer
    to relay as an `OpenQuestion` of kind `relay` for the adults); the
    `defer` move as a plan move rides with ACT-03; the teen-audience
    settings key is deleted (the role is the one definition, an adult
    sets it); the `unknown-speaker-shared-device` row joins (no
    identified speaker on a shared surface: `age_band_basis:
    unknown_speaker_default`, no person-scope record in context, the
    child result on the grandma question). Acceptance:
    the `child-grandma` conversation (dev.md section 13, part 8) with
    its adult twin, three seeded runs, the effects on the context
    message and the memory table; unit tests for the default per class
    and for the memorialized subject, the band in `canRead()` for
    child, teen, adult and guest, and the adult's flip; the `teen_ok`
    record withheld from the child and available to a teen, and the
    unknown speaker receiving the child result. Out of scope: the
    notification (AGE-02), the plan's band axis (ACT-03). Exit:
    the spec suite, `bun test tests/memory.test.ts
    tests/memoryJudge.test.ts tests/turnEngine.test.ts`, `bash
    scripts/check.sh`.

<a id="age-02"></a>
- [ ] **AGE-02: The worrying-conversation notice to the household's adults** (S, after AGE-01 and the defect items through CHAT-16)
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md)

    Objective: when a child's turn falls in the worrying class, the
    household's adults learn that a worrying conversation happened,
    never the child's words, and the child is told the hub may mention
    it. Jesse's decision (2026-09-14, dev.md section 13, part 4): the
    parents are notified, on by default, with no switch per child or
    per household. Files:
    `backend/src/lib/notificationTypes.ts` (`child.worrying_conversation`,
    level `time_sensitive`, audience `adults`, fixed copy naming the
    child and that a check-in may help, with no slot for the child's
    text, the adults' names, the topic, memory text or a transcript
    link; stored as the child id, the turn id for dedupe and audit, the
    policy version and the coarse result; never the safety result and
    never marking the conversation unsafe), `backend/src/lib/turnEngine.ts` (`notifyOncePerTurn()`
    fires it from the stored signal and the subject: the child band,
    sadness, fear or anger at moderate or high intensity with `target:
    other` naming a household adult or an unknown person, or a subject
    in the fixed list, or today's `notify_parent`; never sadness or fear
    alone, so a sad question about a story or a pet does not notify, a
    row; before ACT-02's emotion head the intensity comes from surface
    cues only, and the fixed subject list is what carries the bench row),
    `lib/register.ts`
    (the "I might mention to a grown-up that you seemed sad" clause in
    the child's plan when the notice fires), `docs/user/privacy.md` and
    `docs/user/people.md` (what the notice carries and that it cannot be
    turned off, in plain words).
    Mirror: `safety.flagged_turn` and its delivery. Acceptance: the
    `child-family-conflict` conversation (section 13, part 8), three
    seeded runs: the notification exists for the adults with no
    fragment of the child's words or the reply in its body, the child's
    reply carries the clause, a teen's identical turn produces no
    notice, no settings key exists that can stop it (a test that the
    settings registry carries none), and a second worrying turn in the
    same conversation produces no second notice within the per-turn
    dedupe window. Out of scope: any reading of the child's words by a
    model to decide; any switch.
    Exit: the named tests, `bash scripts/check.sh`.

## Design pass 2026-09-13: the findings from live use, and the companions brief

The design is [dev.md, "The chat design pass"](dev.md#the-chat-design-pass-findings-1-to-18-and-the-companions-brief-2026-09-13);
the findings are in
[docs/plans/media-conversation-program-2026-09-13.md](plans/media-conversation-program-2026-09-13.md).
The execution contract above applies. **Order (revised 2026-09-14 by
the coherence review, dev.md "Coherence review, 2026-09-14"; the queue
itself lives in the program file):** RECALL-02 and OUT-01 (in flight);
SPEC-01; ACT-01; REG-01; EXP-01; ASK-01; MEM-06 core; AGE-01 core;
LOOKUP-01; CHAT-13; CHAT-16 with ACT-03 core; then CHAT-08, CUR-01,
EVAL-07 memory mode, AGE-02, ACT-02, REVIEW-01, PREF-01, EVAL-07
mining, SPEC-02, COMP-01 to COMP-06, CRED-01, the credulity slices,
SPEAK-01, WAKE-02. Every item's acceptance is a bench conversation that
fails on `main` today and passes three seeded runs when done
(`scripts/bench/conversationLive.ts`, BENCH-01's pins, lookups from
recorded fixtures through the bench's `recordingProxy`, the live
SearXNG run a separate check); the rows are named in the design note,
invented for the roster's household, and added to
`conversationFixture.ts` as the first step of the item.

<a id="recall-02"></a>

- [ ] **REG-02: Composer-owned voice disfluencies and nonverbal cues** **Rewritten 2026-10-02 for chat rule 14; owner ruling 2026-10-06: default light, rate limited, voice.hesitations key, never inside numbers, names, instructions, safety, alarms or child learning; blind listening test is follow-up.** Companion expressiveness dials stay a per-request mechanism (steering vector or adapter), never prompt prose. Server-side speech text is ported by THIN-0J; `reply.speech` is produced on the one path. The voice is chosen (Chatterbox Turbo, owner, 2026-10-17): tags are live via `tts.tags`. (M) **Built 2026-10-17:** `voice.hesitations` (off, light, natural; default light) in `backend/src/settings/voiceKeys.ts`, the composer-owned inserter `backend/src/lib/voiceCues.ts` (sentence boundaries only, never in numbers, names, steps or safety lines, never for a child or teen, written chat never carries a cue), the tag capability read from the Stack's tts role (only the six tags verified by ear on Chatterbox Turbo: laugh, chuckle, cough, sigh, clear throat, gasp; no text opener for tag engines), and a live-shape fixture. Still open: the blind listening test; moving the key into a spec tag (SPEC-MINOR-DDGS-KEYS-01). User page: `docs/user/voice.md`.

    Objective: a companion can request a natural hesitation or nonverbal
    sound without making the screen or transcript noisy, and a voice model
    never invents those cues on its own. Keep `reply.text` clean and put the
    selected model's accepted tags in `reply.speech` before phrase-level TTS.
    Add companion dials for expressiveness, disfluency, humour, nonverbal
    frequency, and pace; they drive the plan line, example lines, and a
    measured steering vector, not prompt prose. Record each candidate's tag
    vocabulary and time to first audio. Acceptance: the top-two bench has a
    first-day line with a hesitation and a laugh, the tag output is verified
    by listening, and the composer leaves clean speech untouched. Out of
    scope: a separate performance-director model before measurement shows it
    is needed. Exit: the tag vocabulary and bench are recorded, the companion
    record owns the dials, and the named voice/register tests plus
    `bash scripts/check.sh` pass.

    **Built 2026-10-17 (Home half, composer-owned, no model hint):**
    `backend/src/lib/voiceCues.ts` is the pure insertion policy (cues only
    at sentence boundaries, a seeded roll, light: 1 per turn and 3 turns
    apart, natural: 2 per turn, 3 sentences apart; nothing for a child or
    teen, a safety, refusal, crisis, package or error line, a number, link,
    instruction or alarm sentence). `POST /api/tts` applies it per sentence
    of a live spoken model turn (`turnAllowsVoiceCues`, fails closed);
    `lib/tts.ts` drops any bracketed tag the engine does not advertise
    (`sanitizeSpeechTags`), and `finalizeNextReply` strips a tag the model
    wrote from the reply. `lib/ttsCapabilities.ts` reads `tts.tags` from the
    Stack's tts role (absent means none, so Pocket TTS gets no tag, only an
    optional plain-text "Hmm," or "Well," opener). Setting `voice.hesitations`
    (off, light, natural; default light; household, so a minor never sees
    it). **2026-10-17 Stack half live** (Chatterbox Turbo MLX; stack
    fb93272): the real shape `tts: {engine, requested, tags, fallback_reason}`
    on the tts role and `tts: {engine, tags}` on each voice is parsed and
    pinned by a fixture copied from the live response; a `fallback_reason`
    means no tags. Verified tags only (laugh, chuckle, cough, sigh, clear
    throat, gasp; groan and unknown tags are never placed). An engine that
    advertises tags gets no "Hmm,"/"Well," opener; only a tagless engine
    (Pocket fallback) keeps it. Situation map: laugh/chuckle after humor,
    sigh after weariness or sympathy, gasp before surprise, clear throat
    (then cough) as a rare natural-level opener before a long first
    sentence. Still open: the blind listening test;
    companion dials; a model-written tag in the live token stream is
    stripped only from the final stored reply, not from streamed deltas;
    Wyoming satellites get the tag drop but no cue insertion yet.

<a id="exp-01"></a>
    Design: [studio-voice-2026-10-17](design/studio-voice-2026-10-17.md)
- [ ] **ENGINE-HOST-02: Roles degrade gracefully; no secondary placements** (M, design pass first, owner's decision 2026-09-16)

    Decision (owner, 2026-09-16, after a design discussion): the hub
    does not run backup engines. A primary-and-secondary system per
    role was designed and rejected: a secondary only works if its
    space is reserved on another device forever, which spends the
    small card on a model that is never loaded; without the
    reservation the backup cannot load at the moment it is needed;
    and any version with just-in-time sizing or shuffling of engines
    is the complexity nobody gets right and a parent cannot predict.
    That road leads to a poor experience and is closed, not deferred.

    What we do instead: **a bare minimum the system needs to run as
    designed, and graceful degradation for everything else.** The
    install names the roles the household's hardware must carry
    (chat, embed, judge at least); those engines are up or the hub
    says plainly what is wrong and how to fix it (Repairs). Every
    other role (image, video, coding, speech extras) is a feature that
    is on when its engine answers and off when it does not, with the
    person told in the product's own words: "Picture making is
    offline right now" as a plan line in chat (never model prose), the
    feature's control greyed with the same line, one notification when
    it goes off and one when it is back, and a Repairs entry naming
    the device and since when. No engine is ever loaded on the fly to
    cover for another; a vanishing device is a state the supervisors
    hold, not a respawn loop, and the role returns by itself when the
    device does.

    **The monitor stands alone (owner, 2026-09-16).** The part that
    watches roles and raises the alert depends on nothing it watches:
    it runs without the chat engine, without embed, without the
    judge, and its alert path (the notification, Repairs) is plain
    code. When it finds a role down it first gathers the deterministic
    facts itself (which device, the exit code, the last log lines, the
    probe that failed, since when) and puts them in the alert. Then,
    only if the chat engine answers, it asks the model for a short
    diagnosis over those facts and appends it, marked as the hub's
    guess and grounded in the quoted lines (finding 61's rule applies
    to a diagnosis as it does to a lookup: no line the logs do not
    support). If chat is the thing that is down, the alert goes out
    with the facts alone and no model call is attempted. The design
    pass also answers how far "standalone" reaches: the monitor inside
    the hub process covers every engine; a hub process that is itself
    down needs a watcher outside it (a robot or pod that notices the
    hub is gone, or a small watchdog the install registers with the
    OS), and that watcher's alert path is the design's to name.

    **The watcher is its own process (owner, 2026-09-16): WATCH-01.**
    A crash of the hub must not take the watcher with it, so the
    watcher is a separate small process the install registers with
    the OS (launchd, systemd, a Windows service), started with the
    hub and kept alive independently. It watches the engines through
    their health endpoints and the hub itself through `/api/health`,
    and it alerts on its own: it carries the household's outbound
    alert channels (Telegram first, the channel the notification
    system already defines in `docs/dev.md` "telegram", a direct
    hub-to-Telegram connection) and sends "the hub is down since
    <time>" without the hub. One definition: the channel settings and
    the bot credential are the hub's (the settings registry and the
    keystore, `lib/secrets`), read by the watcher from the same store
    with the same file permissions, never a second copy; when the hub
    is up its notification center receives the same alerts through
    the normal path so nothing is delivered twice. The watcher's own
    outbound connection gets its privacy-page row. Every alert the
    watcher sends is facts first, the model's diagnosis only when
    chat answers, as above.

    **They watch each other.** The hub monitors the watcher the same
    way: the watcher exposes its own health (a heartbeat file or a
    local endpoint, alive since, last probe, last alert sent) and the
    hub's own monitor reads it on the same interval; when the
    heartbeat stops or the watcher reports it could not send (a
    channel refused, a credential expired), the hub alerts through its
    own notification path, "the watcher is not running since <time>",
    with a Repairs entry and the fix. Both sides keep their alerting;
    neither is the only one. The design pass sets the two intervals
    so a single missed beat is not an alert (a hold, as with roles),
    and states what happens on the double failure (hub and watcher
    both down): nothing local can alert, and that is the case the
    outside watcher (a robot or pod) covers when the household has one.

    Rules the design pass fixes: the minimum set per install (from
    the device inventory `detectHardware` reads at boot, and what the
    setup wizard tells the person if the machine cannot carry it);
    which roles are features and their exact offline lines (one per
    role, in the plan, child band included); the probe interval and
    the hold time before a role is declared back; embed's special
    case (an embed outage queues memory writes, never swaps models);
    and the Repairs and notification shapes (`notificationTypes.ts`,
    the Repairs page). The robot follows the same rule with its own
    minimum set (platform principle 2).

    Pointers: `backend/src/lib/llmSupervisor.ts`, `embedSupervisor.ts`,
    `backgroundSupervisor.ts`, `sidecars.ts` (`watchEngine`),
    `lib/hardware.ts`, `notificationTypes.ts`, the Repairs page,
    `docs/plans/gpu-card-layout-2026-09-14.md` (retired to `docs/design/retired/`) (the owner's current
    placement puts chat and coding on the 16 GB card together; the
    note is to be brought in line). Mirror: the lazy-start-once shape
    the supervisors share. Acceptance: with a scripted device
    inventory, a feature role whose device disappears is marked off
    within the probe interval, the chat line and the greyed control
    carry its offline line, the Repairs entry and the notification
    exist, no engine is spawned to replace it, and the role returns
    after the hold time with no duplicate engine; a minimum role's
    outage produces the Repairs entry and the fix-it text. Out of
    scope, permanently: secondary placements, reserved headroom,
    on-the-fly loading or unloading to make room. Exit: the design
    section in `docs/dev.md`, then the mechanical items it names,
    each with `bash scripts/check.sh`.

<a id="engine-host-03"></a>

    Objective: measure the actual M5 Max placement before selecting a
    foreground model. Files: the new Metal validation bench under
    `backend/scripts/bench/`, its report, `backend/src/lib/hardware.ts`,
    `engineStats.ts`, and the supervisor test fixtures. Mirror the GPU
    validation bench's identity, fill, throughput, and soak shape. Record
    Apple identity and `llama-server --version`, fill the 27B and 122B
    4-bit candidates, measure cold load, first token, decode and prompt
    throughput at 4k, 16k, and 32k, prefix reuse, two slots, and the
    resident minimum set. Soak each profile for two hours while sampling
    memory pressure, process RSS, thermal state, and output correctness.
    Acceptance: a report with command lines, model and engine hashes,
    peak and median numbers, and a clear go/no-go for the 122B role.
    Out of scope: changing defaults, adding a second placement, or running
    a cloud model. Exit: the isolated bench and `bash scripts/check.sh`.

<a id="stack-16"></a>
    Design: [hardware-tiers-2026-09-23](plans/hardware-tiers-2026-09-23.md)
- [ ] **STACK-16: Home runs on the Stack** (L, after the Stack's STACK-14; design pass in `docs/dev.md` first)
  - [x] **HOME-STACK-01: the Stack inside Home's installer** (M, done 2026-09-21): `scripts/install.sh` places the Stack (fetches `getmaipai/stack@$STACK_TAG`'s source, builds it via that repo's own `scripts/build-binary.sh`, runs it as the logged-in console user rather than root, waits for `/healthz`, writes `engines.stack.url` last, only when that setting is still empty or a previous local write - never clobbering a household's own remote/hand-run Stack); `scripts/uninstall.sh` removes it inside the existing single "DELETE MY DATA" confirmation, still offering and deleting `stack/data` even if the Stack binary itself is gone; the upgrade branch stops, rebuilds and restarts it, clearing `engines.stack.url` if the rebuild fails rather than leaving it pointed at a dead process. `--dry-run` prints the Stack half's whole plan with no root and no side effects; scoped to the Stack section only, a stated boundary, not a retrofit of Home's own pre-existing install flow. Two real bugs found wiring this up, fixed upstream not here (`build-binary.sh`'s own `OUT_DIR` silently broke on an absolute path, `getmaipai/stack@233bc4f`, `STACK_TAG` bumped to it). Two review rounds then found eight more real bugs total, all fixed (`docs/dev.md`'s own entry has the full list): round one - `main()` silently never ran under this script's own documented `curl | bash` usage; `find_console_user()` accepted `root` as a valid console user; `uninstall.sh` could silently leave `stack/data` on disk when the Stack binary was missing; `engines.stack.url` was unconditionally overwritten on every run; a failed upgrade rebuild could leave it pointing at a dead process; `ensure_service_user_linux()`'s own recursive chown would have clobbered the Stack's ownership on Linux (found while fixing the others, not by the review itself - no Linux box to catch it live). Round two, on round one's own fix-hunks - `--dry-run` made a real loopback network call despite its own documented guarantee not to; the "shared" dry-run/real `install-service` command was actually hand-duplicated, not shared. Fixing the second of those surfaced a bigger one: macOS ships bash 3.2 (no `mapfile`/`readarray`, bash 4+ only) as its own `#!/usr/bin/env bash` default, this installer's own primary target - a rule now for every installer script in this repo, not just these two, documented in `docs/dev.md`'s own entry with how it was found. Files: `scripts/install.sh`, `scripts/uninstall.sh` (now sources `install.sh` for `detect_os`/`detect_arch`/`render_stack_binary_name` instead of a second copy), `backend/scripts/set-setting.ts` (new, a one-shot `restore-drill.ts`-shaped script writing the setting directly against the not-yet-started database, `--only-if-empty-or-prefix`). Tests: `scripts/install.test.ts` (10 tests) and `backend/tests/setSetting.test.ts` (new, 6 tests, the real write path, not just a dry-run string). `bash scripts/check.sh` green, full backend suite 3612/3612. Verified live on this MacBook under `/bin/bash` (the real system default, not a dev shell's own `PATH`-preferred bash), never Home's own root-level service, before round one and re-verified after each round: a real `install-service` with a scratch `STACK_DATA_DIR`/port/`STACK_BUN_BIN`, `/healthz` answering, `status` showing every one of those env vars actually baked into the running LaunchAgent, `uninstall-service --remove-data`, `launchctl list | grep maipai` empty afterward, the data directory gone. Out of scope, a stated gap: a real clean-account install and the entire Linux path (`systemd --user`, `find_console_user()`'s `logname` fallback, and the chown-ordering fix above) - none of it has run on a real second machine.
  - [x] **HOME-STACK-02a: Home's Stack client** (done 2026-09-20): the typed client, error surface, and wire types in `backend/src/lib/stack/`; not yet wired into existing modules (that is HOME-STACK-02b).
  - [x] **HOME-STACK-02b: the role wire, behind one setting** (done 2026-09-20): `engines.stack.url` (commons `spec-v0.1.3`, household scope like `chat.model_id`'s own precedent) decides it - empty, the default, and every existing module (`llmSupervisor.ts`, `embedSupervisor.ts`, `ttsSupervisor.ts`, `stt.ts`'s in-process recognizer) is untouched. Set, `lib/llm.ts`'s `complete()`/`startCompleteStream()`/`embed()` (chat, the judge - there is no separate judge role on the wire, only a different prompt - and embeddings all funnel through here already), `lib/tts.ts`'s `synthesizeSpeech()` and `lib/stt.ts`'s `transcribeUtterance()` call the Stack client by role instead; `turnEngine.ts`'s `[turn]` line and `TurnStats` read the reply's identity headers (`lib/stackEngine.ts`'s `getActiveChatEngineIdentity()`) instead of probing a process; `/api/voice/hf-token` writes `stack.engines.tts.hf_token` on the Stack instead of Home's own household setting. A scripted 503 speaks the companion's own "I can't think right now" for chat (embed/tts/stt fail silently to a person, so they keep the plain wording) and raises a Repairs entry carrying the real `offline_reason`; every other StackError kind keeps the Stack's own stated reason. Streaming reuses `@maipai/spec/llm/ts/client.ts`'s own SSE chunk-interpretation logic, ported (not reinvented) against the Stack's `{ stream, headers }` reply instead of that method's own internal fetch, since only that shape gives per-turn identity headers before the first token arrives; the original's idle-timeout re-arming was not ported (a caller disconnect still aborts; a genuinely wedged Stack stream is a follow-up, not silently patched here). `getStackUrl()` also fails safe to "not configured" when the stored value isn't a loopback-shaped URL - found live via safety.test.ts's own settings-stress sweep. Files: `backend/src/lib/stackEngine.ts` (new), `llm.ts`, `tts.ts`, `stt.ts`, `routes/voice.ts`, `turnEngine.ts`, `stack/client.ts` (`identityFromHeaders` exported). Tests: `__setStackClientForTests()` injection with a real scripted Stack (`tests/stackFixture.ts`, `Bun.serve`) in `llm.test.ts`, `tts.test.ts`, `stt.test.ts` and `voice.test.ts` - the flag off (unchanged) and on, a success reply, the 503/companion-line/Repairs path, a 400 keeping the Stack's own reason, the identity headers read before the stream's first token, and a garbage `engines.stack.url` value falling back to unconfigured. Out of scope: HOME-STACK-01 (the setting is hand-set until that item's installer writes it), HOME-STACK-03's event bridge, removing Home's own supervisors (STACK-16 itself, after the Studio proof). Exit: `bash scripts/check.sh`.
  - [x] **HOME-STACK-03: Stack event bridge into Home's notifications** (done 2026-09-20): the SSE bridge in `backend/src/lib/stack/events.ts` that streams `<base>/stack/v1/events`, reconnects with backoff and `Last-Event-Id`, dedupes by `seq`, maps the update events and an opened warning/critical `health.changed` item to household-admin notifications, and exposes an `onEvent` callback for the Engines page's live view; four `engines.*` notification types and their per-person Telegram toggle keys added to `notificationTypes.ts` and `notificationKeys.ts`.
  - [x] **HOME-STACK-05: Updates and Repairs wiring** (done 2026-09-20): Settings > Updates shows the Stack's engine and model update rows (`llama-server`, `mlx-serve`, and installed models) beside Home's own app-release row, each with an Apply/rollback action; Repairs shows the Stack's own health items alongside Home's, each with a working one-click fix; a scheduler job runs the Stack's own maintenance (catalog check, readiness check, storage sweep) once a day, gated on the Stack's own `stack.updates.enabled` setting (not a Home setting - Home never overrides what the Stack was told to do). All gated on `engines.stack.url`, same as HOME-STACK-02b; empty, the Updates and Repairs pages are exactly what they were before this item. Files: `backend/src/lib/stackUpdates.ts` (new), `stackHealthSync.ts` (new, reuses the existing `lib/issues.ts` raise/resolve/fix-handler machinery rather than a second health surface - a Stack item resolved on the Stack's own next read is resolved here too, not left stale), `routes/updates.ts` (`UpdateProjectionSchema.extend({stack: ...})`, additive - the existing flat consumers, `useHubStatus.ts` and `HomePage.tsx`, are untouched), `routes/repairs.ts`, `scheduler.ts`, `stack/client.ts` (`applyEngineUpdate`, `rollbackEngine`, `sweepStorage`, `runCheck`), `frontend/src/apps/settings/UpdatesSection.tsx` + `UpdatesPage.tsx` (new), `App.tsx`, `SettingsPage.tsx`. Tests: `stackClient.test.ts`, `scheduler.test.ts` (+3, the maintenance job on/off/gated-off), `updates.test.ts` (+8, the merged projection, a Stack read failure surfacing `stackError` rather than reading as no Stack, and each new route), `repairs.test.ts` (+2, a Stack health item appearing and one the Stack stops reporting resolving on the next read). Verified manually against an isolated backend (a different port and data directory from the real app) and a scripted Stack fixture: the Updates page's rows, the Apply confirm dialog, a successful apply updating the row and revealing "Go back", and the Repairs page picking up the fixture's health items, each screenshot opened and judged. A medium review caught two real bugs (an engine-agnostic confirm dialog was hardcoded to "chat engine"; a Stack read failure silently read as no Stack at all), both fixed; the gate's own a11y check caught a latent `ThingsTable` kit bug (a 32px "More actions" button, an unlabeled header) no earlier `rowActions` consumer had ever hit, fixed in `commons` as `ui-v0.4.5`. `bash scripts/check.sh` green. Out of scope: HOME-STACK-04a's own Engines admin page (a separate lane); an actual installer for the Stack itself.
  - [x] **HOME-STACK-04a: the Engines API** (done 2026-09-21): `backend/src/routes/engines.ts` (new), the household's own admin surface onto the Stack - twelve routes (roles/engines/budget overview, hardware, per-engine start/stop/restart/install, models, per-model load/unload/pin/unpin, health, health-item fix, and the update-state/check/apply/rollback trio also reachable through `/api/updates/stack/*`), owner/admin gated the same way `repairs.ts` is. Every response is a named Zod schema built once from `stack/types.ts`'s field names, no `any`; the three calls the Stack itself still types as `Record<string, unknown>` (hardware, models, the two action results) get an honest `z.record(...)` rather than a guessed shape. One `classifyStackError()` maps every `StackError` kind to its real status (offline/unreachable 503 with the real `offline_reason`, unverified 409, unknown 400, timeout 504); the three `/updates*` routes delegate to `lib/stackUpdates.ts`'s existing functions instead of calling the client a second time, so applying an engine update has one code path, not two. Files: `backend/src/routes/engines.ts` (new), `app.ts` (mounted at `/api/engines`). Tests: `enginesRoutes.test.ts` (new, 23 tests) - every endpoint's success path, owner/admin required, an unsigned request 401, a bad model-action body and a tag-less rollback both 400 before the client is called, each `StackError` kind mapped to its real status. A routing bug found live by these tests (a two-segment dynamic catch-all registered before two same-shaped literal paths silently swallowed both) fixed by registration order. `bash scripts/check.sh` green, full backend suite 3606/3606. Out of scope: the Engines admin page itself (04b, the frontend).

  - Design pass landed 2026-09-30: [docs/plans/stack-16-design-2026-09-30.md](plans/stack-16-design-2026-09-30.md). One address (`engines.stack.url`); each role proven by a recorded-input harness before it moves; the memory judge follows chat; order text to speech, speech to text, embeddings, judge with chat, then chat; Home's engines deleted last. Nothing below is built until the owner says go on STACK16-A.
  - [x] **HOME-REQ-01: Home requires the Stack** (M, Sonnet). Landed 2026-10-01. A configured Stack serves all roles, the installer requires it, and Home lists a missing Stack in Repairs.
  - [x] **STACK16-A: independent Stack role switches** (M, Landed 2026-09-30). Done 2026-10-01. Four household booleans, `engines.stack.use_chat`, `engines.stack.use_embeddings`, `engines.stack.use_stt` and `engines.stack.use_tts`, control model calls independently; the memory judge and background worker follow chat because they share its model. Retired by HOME-REQ-01 (2026-10-01): the four switches are no longer read; a configured Stack serves every role; the installer fails without the Stack; a missing Stack is a Repairs entry. The spec keys are removed in a later spec cleanup.
  - [x] **STACK16-B: installer role defaults and upgrade backfill** (S, Landed 2026-09-30). Done 2026-10-01. The installer writes the address and all four switches off for a fresh setup; an upgraded hub with an address and no stored switches is backfilled to all on. Fixed 2026-09-30 (STACK16-B-FIX): set-setting converts booleans, and the installer writes the switches before the address. Retired by HOME-REQ-01 (2026-10-01): the four switches are no longer read; a configured Stack serves every role; the installer fails without the Stack; a missing Stack is a Repairs entry. The spec keys are removed in a later spec cleanup.
  - [x] **STACK16-C: a configured-Stack test for speech to text** (S, Sonnet). Objective: the same scripted-Stack test chat, embeddings and text to speech already have, for `stt.ts`. Exit: `bash scripts/check.sh`.
    Already covered when checked 2026-10-01: the 2026-09-30 inventory missed the "lib/stt.ts routed through a configured Stack" tests in backend/tests/stt.test.ts (switch off, switch on, a real WAV to the Stack's transcription route, a scripted 503 raising a Repairs entry); STACK16-A added the two switch tests. No new test was needed.
  - [x] **STACK16-D: the proof harness** (M, Sonnet; after A and C). Done 2026-10-01. Objective: `backend/scripts/bench/` runs recorded inputs from the demo household's seed through Home's own engine and the Stack and prints the comparison table per role (the bars are in the design note). Out of scope: any move. Exit: a run on the laptop bench recorded in `docs/dev.md`. Harness built 2026-10-01 (STACK16-D1): backend/scripts/bench/tts-stack16-d.ts with pure metrics tested offline; the live text to speech run is STACK16-D2. Text to speech dry run on the laptop recorded 2026-10-01 (STACK16-D2); the Studio run stays owed with STACK-14.
  - [ ] **STACK16-E1 to E5: prove and move one role each** **Rewritten 2026-10-02 for chat rule 4.** Acceptance for the chat role (E5) gains: the Stack launches the chat engine with the machine's real context length (STACK-CTX-01 in `stack/docs/BACKLOG.md`), and Home reads that figure (THIN-3A). (S each; order tts, stt, embeddings, judge with the background worker, chat; needs D, the Studio proof STACK-14 for the household's hub, and the owner's word per role). Laptop dry run 2026-10-01 (STACK16-D2 to D4): passed on the corrected bars and the owner's listening check (same voice, the Stack more natural); Studio run owed with STACK-14; moving the role on the household's hub waits for the owner's word. Speech to text harness built 2026-10-01 (STACK16-E2A): backend/scripts/bench/stt-stack16-e.ts, scored by word error rate on the fixed lines rendered by the Stack's own text to speech; the live run is STACK16-E2B. Speech to text laptop dry run 2026-10-01 (STACK16-E2B): passed, identical transcripts on all 30 lines. Search (embeddings) harness built 2026-10-01 (STACK16-E3): backend/scripts/bench/embed-stack16-e.ts, 200 fixed sentences, cosine at least 0.999 against Home's engine for the same model file; the live run is recorded below. Search laptop dry run 2026-10-01 (STACK16-E3): passed on the corrected bars (identical vectors; the batch ratio bar retired, absolute 369 sentences per second); search moved to the Stack 2026-10-01. Background worker routed through the Stack's judge when chat is on the Stack (HOME-BG-01, 2026-10-01). Boot warm-ups and the local client getters never start Home's own engine for a role on the Stack (HOME-BOOT-01, 2026-10-01; found live: a restarted hub on the Stack still ran its own 8B and embedding engines). Bench adapter for the Stack (STACK16-E5C): MAIPAI_BENCH_UPSTREAM=stack. Chat and judge live run on the Stack 2026-10-01 (STACK16-E5C): failed, replay bars missed and judge-eval setup refused. Chat and judge side-by-side on this laptop 2026-10-01 (STACK16-E5D): stack matches Home's own launch.
  - [ ] **STACK16-F: "Use this computer's own engine" and the memory note** (S, Sonnet; after A). Dropped 2026-10-01: Home runs no engine of its own.
  - [ ] **STACK16-SPEC-CLEANUP: remove the retired role switches from the shared spec** (S, spec first). Objective: remove the four retired `engines.stack.use_*` keys from commons `spec/settings/keys.json`, cut the next spec tag, bump Home's pin, and remove the deprecation comments and generated registry lines. Files: `commons/spec/settings/keys.json`, Home's spec pin, `backend/src/settings/aiKeys.ts` and its generated registry. Acceptance: no retired switch keys or registry entries remain. Out of scope: changing Stack role behavior. Exit: both gates pass.
  - [ ] **HOME-FIT-11: fit verdict screenshots reflect retired Home engines** (S). Objective: the `--fit-verdict-review` screenshot stubs send an empty `homeOwnedRoles` list, then regenerate and inspect the fit-memory pictures. Pointers: `scripts/screenshot.ts` and the fit verdict screenshots. Acceptance: the pictures no longer imply Home's own engines still run. Out of scope: changing fit verdict behavior. Exit: screenshots regenerated and inspected.
  - [ ] **JUDGE-QUALITY-01: compare candidate judge models** (M, Sonnet). Objective: compare the shared Qwen3 8B judge's 33.3 percent precision and 40.0 percent recall on `backend/scripts/bench/judge-eval.ts` with the 2026-09-13 1.7B baseline of 66.7 and 100; run the same scorer on the 4B model Home's background worker used before and the 1.7B on a side engine, one at a time, and choose the judge model for p16 and p32 from the results. Prompt and thinking mode are suspects. Files: `backend/scripts/bench/judge-eval.ts`, `docs/dev.md`, this design note. Acceptance: all scores recorded and the p16 and p32 judge models decided from the numbers. Out of scope: changing the scorer or running models concurrently. Exit: numbers in `docs/dev.md` and the decision in this design note.
  - [ ] **STACK-EMBED-FLAGS-01: measure plain embedding launch flags** (S). Objective: compare the Stack's embedding launch flags (`-fa on`, `-ub 1024`, `-ngl all`, `-ctk q8_0 -ctv q8_0`) with Home's plain flags, and remeasure batch throughput, currently 369 versus 498 sentences per second. Pointers: Stack repo `backend/scripts/bench/embed-stack16-e.ts`. Acceptance: the plain flag run and throughput are recorded. Out of scope: changing the embedding model. Exit: numbers recorded in the Stack repo.
  - [ ] **STACK16-OWN-ENGINE-BUTTON: record the dropped own-engine option** (S). Objective: record that the design's "Use this computer's own engine" button is dropped because Home runs no engine of its own. Pointers: STACK16-F and this design note. Acceptance: STACK16-F remains marked dropped with that sentence. Out of scope: implementing an own-engine button. Exit: the design note and backlog state the decision.
  - [ ] **STACK-PERSIST-01: run the Stack as a persistent service on the dev laptop** (S). Objective: install the Stack from its dedicated checkout (`stack-run`) as the service built by the installer using `maipai-stack install-service`, and prove it survives a reboot. Pointers: Stack repo service installer and the owner's machine. Acceptance: the Stack starts after reboot as a service. Out of scope: changing Home's installer. Exit: a reboot test.
  - [x] **STACK16-G: delete Home's own text to speech engine** (HOME-DEL-TTS, 2026-10-01). Text to speech deleted 2026-10-01 (HOME-DEL-TTS): ttsSupervisor and the local path are gone. Search and the background worker deleted 2026-10-01 (HOME-DEL-EMBED-BG): embedSupervisor, embedAssets, backgroundSupervisor and backgroundAssets are gone. Chat sealed 2026-10-01 (HOME-SEAL-CHAT): Home cannot spawn or download a chat engine in any state; llmSupervisor.ts and the importer cleanup remain as dead code to delete (STACK16-G-chat), and the model chooser becomes Stack-driven in a later item.
  - [ ] **STACK16-G-chat: delete llmSupervisor.ts and its importers, and make the AI models page a Stack view** **Rewritten 2026-10-02 for chat rule 4.** Acceptance gains: no Home file keeps a context length or a token estimate of its own once `llmSupervisor.ts` goes; the model chooser reads the Stack's reported context (THIN-3A). (M, Sonnet). Objective: the model chooser, restart and stop become Stack actions (the Stack's models and roles routes); llmSupervisor.ts, resourceGovernor.ts, engineStats.ts and the engine download code go. Out of scope: Stack changes. Exit: bash scripts/check.sh.
  - [ ] **STACK-STT-STREAM-01: a streaming transcription session so Home can drop its last local model** (M). Objective: the Stack serves the spec's streaming session (voice-activity detection and utterance cutting inside its stt worker) so Home's `/api/stt/stream` and the Wyoming server need no Silero of their own. Out of scope: Home changes (HOME-DEL-STT left Silero VAD in place for this). Exit: `bash scripts/check.sh`.
  - [x] **HOME-DEL-STT: delete Home's own speech to text recognizer** (2026-10-01). Speech to text deleted 2026-10-01 (HOME-DEL-STT): the in-process recognizer is gone; Silero VAD stays until STACK-STT-STREAM-01.
    Objective: register Home as a Stack client, call every role by name
    at the Stack's address, read identity from its headers, bridge its
    event feed into Home's notifications, render Admin's engine facts
    as a view of the Stack's API, and delete the hub's own supervisors
    (the file list in `stack/docs/dev.md`, "What moves out of Home,
    later"). Files: the supervisors and `engineCatalog.ts`,
    `modelDownload.ts`, `resourceGovernor.ts`, `engineIdentity.ts`, the
    `llm`, `openai`, `stt`, `tts` and `host` routes, Admin's engine
    pages, the privacy page. Mirror the robot's RUNTIME-01 port shape
    for the engine adapter. Acceptance: the hub in family use on the
    Stack for a week with no supervisor code left in `backend/src/lib`,
    the identity check green on every role, one Repairs entry when the
    Stack is stopped, and `git grep llama-server backend/src/lib` empty.
    Out of scope: any Stack feature (those are Stack items). Exit:
    `bash scripts/check.sh`, the chat replay, and the screenshot set.

    **Reserved, 2026-09-17:** ENGINE-HOST-04, -05, -06 and MEDIA-HOST-01,
    -02 below describe work the Stack's milestone 0 does (STACK-03
    through STACK-15 in `stack/docs/BACKLOG.md`). They stay listed so
    the dashboard shows the gap, and a session does not start them in
    this repo without the owner saying so; the Stack's item is picked
    instead. ENGINE-HOST-03, the first-day bench, is not reserved.

<a id="engine-host-04"></a>

    Objective: let `engineCatalog.ts` describe the verified llama.cpp Metal
    binary and a pinned `mlx-lm` launcher, with one client contract for
    `/v1/chat/completions`, health, model identity, and restart. Files:
    `backend/src/lib/engineCatalog.ts`, `llmSupervisor.ts`, the shared
    engine client, download pins, and supervisor tests. Mirror the existing
    lazy-start-once, generation guard, `watchEngine`, and resource-governor
    paths. Treat MTP as unavailable on Metal until a later measured pin.
    Acceptance: both URL and child-process tiers report identity, pass the
    same scripted tool and safety fixtures, survive a watched restart, and
    never silently fall back between engines. Out of scope: CUDA changes,
    runtime failover, and new shared spec records. Exit: supervisor tests,
    the isolated engine bench, and `bash scripts/check.sh`.

<a id="engine-host-05"></a>

    Objective: provision one selected intelligence or chat model, the
    current 27B coder, and the minimum embed, background judge, Moonshine,
    and Pocket TTS roles on one Apple Silicon host. Files: model catalog and
    download jobs, role settings, `backgroundSupervisor.ts`, Repairs and AI
    models UI, and their tests. Mirror ENGINE-HOST-02's feature-offline line,
    hold time, and no-secondary rule. Acceptance: the chosen profile fits
    the measured memory budget, coding does not silently evict chat, the
    generator controls show exact offline state under pressure, and all
    model downloads are pinned and checksum verified. Out of scope: a larger
    coder before a quality bench, a static memory reservation, and backup
    model shuffling. Exit: role and UI tests, a scratch-household live
    migration check, and `bash scripts/check.sh`.

<a id="engine-host-06"></a>

    Objective: implement WATCH-01 as the independent launchd watcher for
    the Studio. Files: the watcher process and launchd service, health and
    telemetry records, notification delivery, privacy documentation, and
    the hub heartbeat reader. Mirror ENGINE-HOST-02's facts-first alert,
    model diagnosis only when chat answers, hold time, Repairs entry, and
    one notification on down and up. Acceptance: a killed hub produces a
    single Telegram alert from the watcher, engine and hub pressure samples
    are visible, a missed beat does not alert, and the hub reports a dead
    watcher after its hold. Out of scope: a second outbound channel, a
    cloud monitor, and power-loss detection. Exit: watcher tests, a real
    launchd scratch install, the privacy check, and `bash scripts/check.sh`.

<a id="media-host-01"></a>

    Objective: run ComfyUI as a local supervised sidecar with FLUX.2 Klein
    and Juggernaut XL, with image safety before display or persistence. Files:
    the sidecar supervisor, pinned Python environment, workflow assets,
    image route and UI, safety adapters, and tests. Acceptance: health,
    cancel, restart, cold and warm 1024-pixel timings, peak memory, and the
    exact generator offline line all work in a scratch household. Out of
    scope: remote ComfyUI API nodes, cloud image providers, and a new safety
    classifier. Exit: sidecar and safety tests, the first-day media bench,
    and `bash scripts/check.sh`.

<a id="media-host-02"></a>

    Objective: run Wan2.2 TI2V-5B through the local ComfyUI path at 720p,
    measure five- and ten-second clips, and expose it as an on-demand
    feature. Files: the video workflow, model pin, sidecar queue, route,
    UI, memory governor integration, and tests. Acceptance: the report
    records total wall time, peak memory, frame rate, settings, and whether
    the Studio can carry the job beside the minimum set; pressure takes the
    role offline with no model shuffle. Hailuo-02 stays hosted and is not
    added as an outbound connection. Out of scope: a Hailuo API connector,
    automatic clip extension, and a second video placement. Exit: the video
    bench, safety and sidecar tests, the privacy check, and
    `bash scripts/check.sh`.

<a id="mem-06"></a>
    Design: [stack-16-design-2026-09-30](plans/stack-16-design-2026-09-30.md)
- [ ] **SPEC-02: The companions migration, one bump** (S, spec only; before COMP-01)

    Objective: the manifest and companion records the brief needs,
    declared once (dev.md, "Coherence review, 2026-09-14", question 4).
    Files: `spec/schemas/manifest.schema.json` (the `companion` block:
    `directness`, `specialty`, `voice`, `kid_safe`, `rapport`; the
    `credulity` field reserved, its validator rule written, no bundled
    profile until the slice after CRED-01), a new
    `companion-binding.schema.json`, `conversation.schema.json` (`mode`),
    `device.schema.json` (the shared-device ownership shape, settled
    here), `turn-artifact.schema.json` and `turn-review.schema.json`
    (their columns already exist nullable on the turn record from
    SPEC-01), `spec/settings/keys.json` (COMP-04's and PREF-01's keys
    with `setting-value`'s `provenance`), fixtures and both bindings.
    Acceptance: round-trip fixtures per record; the validator refuses a
    binding carrying a voice or a register and a `credulity` override
    outside the five classes; every existing fixture validates
    unchanged. Out of scope: any hub code. Exit: the spec suite, `bash
    scripts/check.sh`.

<a id="chat-parity"></a>
    Design: [companions-design-brief-2026-09-13](plans/companions-design-brief-2026-09-13.md)

## Chat direction 2026-09-12: the next block, two tracks

The [2026-09-12 review](dev.md#chat-direction-review-and-the-two-track-plan-2026-09-12)
found that the CHAT program above rests on three things the code does not
do: cache the prompt prefix, keep background work off the chat engine,
and let world knowledge through the guards. This block fixes those first,
plus the two memory gaps no item above covers (verbatim episodes across
conversations, and a judge that drains). It runs as two concurrent
sessions with disjoint file ownership (the table in that dev.md section
is the contract; if a task seems to need a file the other track owns,
stop and record it as a JOIN item instead of editing it). The CHAT
program resumes after this block, starting with CHAT-22. No CHAT-xx item
runs concurrently with FAST or MEM items.

**Execution contract for every item here** is the same as the CHAT
program's above (read the named files and their tests first, regression
test before fix, `bun:test` only, docs in the same commit, `bash
scripts/check.sh` before every commit, code review at medium effort before
every code commit, never lower a threshold to pass, never ask the owner
to run a runnable command). Two additions for this block:

- **Every item is written for an implementer with no conversation
  context.** Do exactly what the item says, in the order it says. If a
  named function or constant does not exist under that name, grep for the
  behavior described and use what is there; do not invent a parallel one.
- **Record numbers, never impressions.** Each live check writes its
  before and after numbers into the track's own dated section at the end
  of `docs/dev.md`, with the engine build, model file, and machine named.
  "Feels faster" is not a result.

**Step 0, before either track branches (one session, on `main`):** commit
the pre-existing uncommitted tree as its own commit (the CHAT program docs,
the CHAT-05 implementation with its tests, the chat page and screenshot
changes) after `git status`, `git diff`, and `bash scripts/check.sh`, then
`git branch -d main-ref-check`. Both tracks branch from that commit.

**Track setup.** `$MAIN` is the main checkout of this repo. Each track
works in its own worktree (the one case the org's branch rule allows,
because two sessions edit the same repo at once) and never points at
`$MAIN/data`:

```
cd $MAIN
git worktree add ../home-track-a -b track-a main     # or track-b
cd ../home-track-a
mkdir -p data
ln -s $MAIN/data/models data/models
ln -s $MAIN/data/engines data/engines
bun install
```

Live checks for Track A spawn their own chat engine so engine flags can
change; run the backend from `backend/` with this environment (the engine
binary path is whatever `find ../data/engines -name llama-server -type f`
prints):

```
MAIPAI_LLAMA_SERVER_BIN=<that path>
MAIPAI_CHAT_MODEL_PATH=../data/models/qwen3-8b-instruct-q4-k-m.gguf
MAIPAI_CHAT_MODEL_ID=qwen3-8b-instruct-q4-k-m
MAIPAI_LLAMA_SERVER_PORT=8798
MAIPAI_EMBED_URL=http://127.0.0.1:8794
PORT=8797
bun run start
```

Live checks for Track B reuse the main checkout's running chat and embed
engines by URL and spawn only the new background engine:

```
MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8788
MAIPAI_EMBED_URL=http://127.0.0.1:8794
MAIPAI_BACKGROUND_PORT=8789
PORT=8807
bun run start
```

A fresh worktree database has no household; for a live turn through the
API, complete first-run through the setup route (read
`backend/src/routes/setup.ts` for the exact body) with the owner named
`alfred`. Benches connect to engine URLs directly and never need a
household.

**Finishing a track:** `bash scripts/check.sh`, stage files by name,
commit, then in `$MAIN` run `git merge --ff-only track-a`. If `main` has
moved, first `git rebase main` inside the worktree, re-run `check.sh`,
then merge. Then `git worktree remove ../home-track-a` and `git branch -d
track-a`. Append the track's dated section at the end of `docs/dev.md`
and tick only the track's own boxes here; on a merge conflict in either
doc, keep both sides. JOIN items run on `main` after both tracks merge.

**Order:** Track A: FAST-01, FAST-02, FAST-04, FAST-05, FAST-03, FAST-06.
Track B: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05. Then JOIN-01, JOIN-02.

### The block after this one (not scheduled; each needs its design note in dev.md first)

- [ ] **STYLE-ADAPTER-01: the runtime, written class first** (M, Sonnet, review medium (a wire shape and a launch flag); after STYLE-SPEC-01 and a STYLE-BENCH-01 pass for at least one companion; never before). Objective: a passing companion's adapter is downloaded, loaded at engine launch, and selected on every generation of a turn for the person whose companion it is. Change: bump the spec pin; `persona.ts` reads `style_adapters` onto `Persona` and exports `styleAdapterFor(persona, modelId)`; the download through `modelDownload.ts`'s own self-healing path into `modelsDir/adapters/<companion>/<base_model>.gguf` with the checksum verified and a clear offline failure (mirror the model download exactly, no second downloader); `llmSupervisor.ts` passes `--lora <sorted files>` and `--lora-init-without-apply` at spawn for every installed companion's adapter matching the running model, reads `GET /lora-adapters` after health, and keeps a registry of companion id to adapter id (an adapter the engine did not list is a Repairs issue, not a silent skip); `llm.ts`'s `LlmCompleteOptions` gains `lora?: { id: number; scale: number }[]`, reaching the body through `chatRequestBody`'s existing spread, `lora: []` when the persona has none; `turnNext.ts` resolves the adapter once beside the persona (line 254) onto the turn state and `nodes/model.ts` passes it on every `startCompleteStream` of that turn (line 262), the same set on the tool-decision, forced and phrasing rounds (a differing set clears the slot's prompt cache, verified in b10797's `launch_slot_with_task`). The governor's resident budget gains the loaded adapters' bytes. `WRITTEN_VOICE_PROSE` and the written twins untouched. The bundled companions' adapter files attach as `home` release assets with the manifest entries pointing at them. Mirror: `modelDownload.ts`, `engineAutotune.ts`'s `launchFlagsToArgs`, PHRASE-01's `lastTools` persistence for "the same array on every round". Tests in these words: a persona with an adapter for the running model yields `lora: [{id, scale: 1}]` on all three rounds of a forced-search turn and the phrasing request's body is otherwise byte-identical; a persona without one yields `lora: []`; an adapter file with a wrong checksum is refused and named in Repairs; the launch args list every installed adapter in sorted order. Acceptance: live on the dev machine, two people with different companions alternating typed turns each get their companion's voice (the bench's marker check run on the live replies; on a document-shaped typed reply the voice is in the opener and closer and the body reads as the bare model's own, per VOICE-CLASS-01, 2026-09-29, so the live check reads the frame and a restructured or interrupted body is a failure of the adapter, not a voice), the switch cost matches STYLE-BENCH-01's recorded number, and `scripts/bench/tool-calling.ts` holds. The Stack's side (the chat role passing `lora` through, the launcher taking the adapter list, the engine contract reporting `style_adapter: per_request | none`) is filed in `stack` the day this row starts, and Home on the Stack degrades to no voice when the engine reports `none`. Out of scope: the spoken class (next row), any settings key, a strength knob. Exit: `bash scripts/check.sh` and the live check in dev.md.
    Design: [style-spec-01-lane-a-2026-09-28](plans/style-spec-01-lane-a-2026-09-28.md)
- [ ] **STYLE-ADAPTER-02: the spoken class moves onto the adapter, the prose retires** (S-M, Sonnet; after STYLE-ADAPTER-01 is live; VOICE-CLASS-01, 2026-09-29: the spoken prompt class includes every child's and teen's chat turn (`promptSurfaceClassFor`), so the naturalness rerun here adds the written set's five kinds under the spoken prefix as rows, since the corpus trained on them). Objective: a spoken turn for a companion with an adapter carries no dial sentences and no few-shot block, and `NATURALNESS_POLICY` goes if the naturalness bench holds without it. Change: `composePersonaPrompt`'s spoken branch returns only `INFORMATION_HANDLING_POLICY` (and `NATURALNESS_POLICY` until measured) when the turn carries an adapter, byte-identical to today when it does not; `scripts/bench/naturalness.ts` and `persona-eval.ts --judge` rerun with the adapter on. Mirror: PREFIX-CLASS-01's per-class table. Tests in these words: the spoken prefix for a persona with an adapter contains no `FORMALITY_FRAGMENT` text and no "Some examples of how you talk"; for a persona without one it is byte-identical to before this row. Acceptance: the naturalness bench at or above its current score and the spike's thirty-turn drift check held on the live spoken path; `NATURALNESS_POLICY` retired only on that number, otherwise kept and the number recorded. Out of scope: the written twins and `WRITTEN_VOICE_PROSE` (WRITTEN-VOICE-TIER-01's re-scoped measurement retires them). Exit: `bash scripts/check.sh` and the two bench numbers in dev.md.
- [ ] **WRITTEN-VOICE-TIER-01: WRITTEN_VOICE_PROSE becomes hardware-tier-aware** (S, 2026-09-23; dev.md "The written prompt on tier 1, decided"; re-sequenced after `EVAL-03`, TRUEUP-01's own commit - the designed fallback is offered per tier only once the primary has been tested, owner's rule 2026-09-23 evening). **Re-scoped 2026-09-28 (dev.md "EVAL-03 design pass"): the primary is the STYLE adapter, not a control vector, so the tier-3 measurement here runs STYLE-BENCH-01's arms with the written voice twins (prose) as one more arm against the same companion's adapter on the Studio; the loser retires there, and `WRITTEN_VOICE_PROSE` plus the `_WRITTEN` twins go with it if prose loses. Waits on STYLE-ADAPTER-01.** Objective: `persona.ts`'s `WRITTEN_VOICE_PROSE` is a plain module constant (`false`), not a settings key, because tier 1's own 8B measured every voice-prose shape under the bar - a bigger model (tier 3, the Studio) may not have the same collapse, and this constant is the one place that decides whether the written class's own dial/policy prose (already declared, already tested) ever composes into a real prompt. Change: once STUDIO-ACCEPT-01 or an equivalent tier-3 workload measures the written voice twins (`FORMALITY_FRAGMENT_WRITTEN` and the rest, already exported) clearing WRITTEN-PARITY-01's own bar on that hardware, `WRITTEN_VOICE_PROSE` becomes a value the hardware probe proposes per tier (hardware-tiers-2026-09-23.md's own "the configuration is proposed, never fixed" pattern) rather than a hardcoded `false` - still no settings key, a probed default a person could override the same way any other tier default can be. Out of scope until tier 3 is measured: the probe wiring itself. Exit: the tier-3 measurement recorded in dev.md, then the constant's own change plus a test that tier 1 still defaults to off.
    Design: [hardware-tiers-2026-09-23](plans/hardware-tiers-2026-09-23.md)
- [ ] **EVAL-04: A reranker over hybrid episode recall** (S). Only where MEM-04's bench shows misses; latency budget 100 ms on the background engine.
    Design: [memory-lifecycle-and-preferences-2026-10-17](design/memory-lifecycle-and-preferences-2026-10-17.md)
- [ ] **EVAL-05: Offline prompt optimization for tool descriptions and the extraction prompt** (M). A development-only tool (GEPA-style) over held-out conversations; ships fixed reviewed text; never runs in a household turn.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **TALK-01: A fine-tuned quick-reply model for the user-facing answer (Talker/Reasoner)** (L). Research item: needs training data and a loop; not before the household has a stable corpus.

## Chat, memory and persona (the intelligence gap)

- [ ] **MEM-PROV-01: every memory record carries its author** (M, spec-first; design: `docs/plans/household-memory-permissions-2026-09-26.md`, 2026-09-26, proposed, awaiting Jesse's read). Objective: `memory_records` has no field for which member's action wrote a record (`source` names the process, `person` names who it is about); add `created_by` to `MemoryRecord` in `commons` spec, migrate (existing rows null, shown as "before records were kept"), set it at every write site (`backend/src/lib/memory.ts`, `memoryJudge.ts`, `routes/memory.ts`), show it in export and record views. Mirror: the spec's existing nullable stamps. Out of scope: any permission change. Exit: commons round-trip fixtures, then `bash scripts/check.sh`.
    Design: [household-memory-permissions-2026-09-26](plans/household-memory-permissions-2026-09-26.md)
- [ ] **MEM-HOUSE-01: household scope is admin-published, everyone else proposes** (M, after MEM-PROV-01; same design record). Objective: `assertCanWrite`'s household branch (`memory.ts:126`) returns ok for any member and lets a non-admin tombstone an admin's record (the gap named inline at `memory.ts:857`); require owner/admin for direct household writes, archive and supersede; a non-admin turn-pipeline household fact downgrades to person scope with `proposed_scope: "household"` (mirror: #52's `sanitizedRecordKind` downgrade), a direct non-admin API write gets 403; promotion is `supersede()` into a household record carrying both authors, decline clears the marker. Tests include the tombstone gap. Exit: `bash scripts/check.sh`.
    Design: [household-memory-permissions-2026-09-26](plans/household-memory-permissions-2026-09-26.md)
Memory clock stamps and validity writes already exist. The remaining temporal-read gap is tracked by [CHAT-08](#chat-08).

Maintenance is already scheduled in `backend/src/index.ts`; profile freshness and unified inference scheduling are tracked by [CHAT-11](#chat-11) and [CHAT-19](#chat-19).

Loaded-history chips and the memory page exist. getmaipai/home#64 (2026-09-13) added a narrower live-status path (the chip polling a `memory.updated` notification); **CHAT-20 has since landed and replaced it** - `chatMemoryState.ts`'s own store now reads `judge_status`/`memory_ids` straight off the conversation-turns re-poll (real `pending`/`saved`/`not_saved`/`failed` states, the 5s/10min poll lifecycle, per-message save/forget wiring), and `memory.updated` is now purely the notification-center record (in-app + optional Telegram), not the chip's live data source. 2026-09-21: `memory.updated` finally got its own settings toggle (`notifications.memory.updated.telegram`, spec-v0.1.13) after being configurable with no way to configure it since #64, and its sibling `memory.judge_failed` (the judge's other terminal outcome, the poison guard giving up) now fires too - the 1:1 backend counterpart to the chip's pre-existing "failed" state, which previously had no notification-center record of its own.
- [ ] **MEM-PUSH-01: Retire the chip's own poll in favor of notifications** (M) -
      now that both terminal outcomes the chip shows (`saved` via
      `memory.updated`, `failed` via `memory.judge_failed`) have a real
      notification behind them, `chatMemoryState.ts`'s 5s/10min poll
      lifecycle (`useMemoryStatusPoll`, `pollOnce`, `markStalled`) is a
      second, duplicate implementation of state a client could instead
      derive from `NotificationBell.tsx`'s own delivery stream -
      `CLAUDE.md`'s "one definition, one store" principle. The real
      design question before touching this: `not_saved` (the
      overwhelming majority outcome, deliberately silent by Jesse's own
      2026-09-13 ruling) has no notification counterpart and never
      should per that ruling, so a notification-only chip needs some
      OTHER way to know "nothing happened, stop showing pending" instead
      of the current poll's own judge_status re-check - decide that
      before ripping out the poll, or a done-but-nothing-written turn
      would show "pending" forever. Files: `chatMemoryState.ts`,
      `chatMemoryChip.tsx`, `NotificationBell.tsx`, `lib/notifications.ts`.
      Check: `chatMemoryChip.test.tsx`, `chatMemoryState.test.ts`,
      `bash scripts/check.sh`.
- [ ] **MEM-FEED-01: A memory change feed for clients** (M) - the older UI work order's
      `GET /api/memory?since=` request remains separate from CHAT-20's
      conversation-state polling. Files: `routes/memory.ts`, `memory.ts`,
      `wire.ts`, and shared memory fixtures. Mirror Conversations' cursor
      validation and memory access checks. Use an opaque cursor derived
      from HLC plus record ID, returned by the first full authorized read;
      accept it as optional `since`. Return changed records including
      authorized tombstone IDs without erased text, in cursor order, capped
      at 100 with `next_cursor` and `has_more`. Preserve the existing array
      response when no cursor/change-feed option is requested by adding a
      separate `/changes` endpoint instead of changing `GET /`'s shape.
      Acceptance: a create/correction/forget appears once across paged reads,
      identical-clock records are not skipped, and foreign-person changes
      are excluded. Out of scope: push transport and chat chip polling.
      Exit: existing memory/API tests extended for these behaviors and
      `bash scripts/check.sh`.
- [ ] **Skip the graph database** (decision, recorded) - Mem0 dropped its
      graph store for entity linking in a flat table; Graphiti needs
      Neo4j and a capable model. Entity columns, FTS5 and vectors on the
      one SQLite file is the local-first answer and keeps the robot
      replica trivial. The Entity/Relationship spec already gives the
      structured half.
- [ ] **MEM-SPEAKER-01: Speaker resolution confidence on memory writes** (S, once voice
      ID exists) - a fact heard at low speaker confidence is stored in a
      quarantine scope and not injected until confirmed. The 2026
      multi-user memory research (AFA) names this exact shared-device
      failure, "persona confusion", and fixes it this way.

**Persona and companions**
- [ ] **PKG-EXPOSE-01: Declare package-owned exposed records and actions** (M) - retain
      the broader exposed-state gap beyond CHAT-14's installed-tool
      readiness. Files: `spec/schemas/manifest.schema.json`, package host,
      and existing entity/permission readers. Extend the manifest's
      existing contribution declarations with typed read/action references,
      resolve them through existing host ports, and filter per actor before
      model context. No raw SQL or duplicated device-state store. Mirror
      the existing manifest fixture/permission tests. Acceptance: only
      explicitly exposed authorized records/actions reach tools; removing
      an exposure removes it on the next turn. Scope is declaration and
      visibility; new integration implementations remain separate packages.
      Exit: shared manifest fixtures, host permission tests, and
      `bash scripts/check.sh`.
- [ ] **Typed query tools, never text-to-SQL** (decision, recorded) -
      each package exposes a few parameterized reads ("events between",
      "chores for person") backed by SQL we wrote. Small models fill
      parameters reliably and do not write safe SQL.
- [ ] **Speak MCP for local tools inside the hub** (M, decision first) -
      one tool contract that catalog packages and Go can share, and the
      route by which MCP Apps result panels could arrive later. Plan
      v0.1 named an "MCP spike"; nothing was spiked.
    Design: [mcp-connectors-survey-2026-10-03](plans/mcp-connectors-survey-2026-10-03.md)

## Projects (2026-09-26)

Design for the storybook shelf and bedtime mode: [stories](design/stories-2026-10-17.md) (2026-10-17).

The harness design: a prompt becomes either a turn (unchanged) or a durable background project of typed recipe steps, per `docs/plans/harness-turns-and-projects-2026-09-26.md` (proposed, awaiting Jesse's read; nothing below starts before that read). The runner is Home host machinery; every project type is a catalog package shipping a recipe; hardware never branches the code, the per-model budget record and the Stack's governor do the sizing. The owner direction section (2026-09-26) sets the emphasis: the model-authored loop is the target, recipes are the skills half of the same substrate, and `plan_authoring` is gated by measurement only.

- [ ] **PROJECT-MEDIA-01: the `media` step over the Stack job API** (M, blocked on the Stack image role having one implemented, verified model, a stack item, not ours). Objective: a `media` step runs `POST /stack/v1/jobs`, admitted by the governor, quality from the recipe or the person's settings, the artifact through the gate. Exit: `bash scripts/check.sh` plus one real generated artifact.
    Design: [harness-turns-and-projects-2026-09-26](plans/harness-turns-and-projects-2026-09-26.md)
- [ ] **PROJECT-PLAN-01: model-authored recipes behind a `plan_authoring` budget grant** (L, later; only after packaged recipes are in family use and a bench measures a candidate model's plan validity rate). Not startable now by design. Per the owner direction (2026-09-26, the design record) this is the target shape, not an option; the gate is measurement only.
    Design: [harness-turns-and-projects-2026-09-26](plans/harness-turns-and-projects-2026-09-26.md)
- [ ] **PROJECT-WEB-01: browser-action steps, a purchase is never auto-confirmed** (L, design pass first, after PROJECT-START-01; owner's ask 2026-09-26, the laptop-tray-to-cart case). Objective: a catalog package whose `tool` steps drive the person's own logged-in browser session for research-then-act projects; every state-changing step is a consequential ActionProposal behind the policy confirm, purchases always confirmed by the person, THIRD-PARTY-SERVICES.md applies in full. Out of scope: any build before its own design pass. Exit: the design record.
    Design: [harness-turns-and-projects-2026-09-26](plans/harness-turns-and-projects-2026-09-26.md)
- [ ] **PROJECT-DEEP-01: deep research as a project type** (M, after PROJECT-START-01 and LOOKUP-FED-01). Objective: a search/read/synthesize recipe over the federated lookup for hard questions, thinking budget from the person's setting and the model's budget record, sources cited in the artifact. Mirror: the shipped deep-research products' shape, one loop, no subagents. Exit: `bash scripts/check.sh` plus one real question end to end.
    Design: [harness-turns-and-projects-2026-09-26](plans/harness-turns-and-projects-2026-09-26.md)

## Assistant layer

Design: [the assistant layer plan](plans/assistant-layer-2026-10-04.md), note-level APPROVED by the architect (verdict `ASSISTANT-LAYER-2026-10-04b`, 2026-10-04); the per-item verdicts in that record bind once the note is committed. ACTIVITY-01a to 01e are chat UI (owner, 2026-10-06); the rest of this layer starts when priorities 1 and 2 have no free-lane work. Ids FEED-01 and WATCH-01 already exist (thumbs, done; the launchd engine watcher), so the activity feed is ACTIVITY-01 and the price watch is PRICEWATCH-01. Slice numbers are the plan's.

- [ ] **ASSIST-NAME-01: Meet your assistant** (S, slice 1). A "Meet your assistant" step (pick a character from the default set: name, personality, voice, animation); the chosen name and accent on the chat header, Home greeting and notifications; rename in Settings; "back to default" resets the dials. The character art is AI-generated using only a local or licence-clean tool. Keep the generation record and captured tool terms with the art; do not use a cloud tool in a user data path. Review before any trademark filing because AI art is hard to own or trademark and tool terms may limit use. A child sees no naming step. Depends on: COMP-03 fields (subset); the spec field `animation` lands first in `commons`. Builder: Codex for the UI; Claude cloud for the `commons` spec field. Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **SCHED-02: ScheduledTask spec and scheduler `kind: turn`, narrowed** (S/M, slice 2). Narrowed against ROUTINES-01, which already owns one-shot, daily, weekly and cron schedules with a time zone, restart-once delivery, routine delivery, conversation landing and the UI, built on `scheduler.ts` through `host.schedule`. SCHED-02 is only what ROUTINES-01 lacks: the `ScheduledTask` spec record (id, provenance, clock stamp, and the bot's `deliver_on` field, which the bot design needs; the field lands in the `commons` spec first, then Home reads it) and the scheduler job `kind: turn` (an ordinary turn started as the person), plus the croner licence and Bun check. No second reminder scheduler. The coordinator may fold it into ROUTINES-01 as that item's first slice; either way it is built once. Depends on: none; ROUTINES-01 is its first consumer. Builder: Claude local (Sonnet). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **HEARTBEAT-01: The morning note** (M, slice 3). Opt-in per adult: a short note at the chosen time in their own thread, in their companion's voice; silence when nothing changed; Telegram outbound for households that have it. A child never receives one; a teen only after switching it on. Bench for silence and speak rates before it ships. Runs only when the active model's record has `background_turns: true` (a commons spec field, per-model yes/no, off below the model-size floor, rule 8 applied to a new feature class; the spec field is MODEL-BG-SPEC-01 in `commons`, not edited here); on any other model it does not run and says so plainly. Depends on: SCHED-02; the T2 surface `background`. Builder: Claude local (Sonnet; needs the engine). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **MEM-EDIT-01: Memory you can see** (S/M, slice 4). Edit a fact in place; "you told me" chips in chat open the record. An admin sees a child's memories, never a teen's. Depends on: none; the judge bench records numbers against JUDGE-QUALITY-01. Builder: Codex for the UI; Claude local for the judge bench. Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md). Row-Bot acceptance: the injected memory block carries record ids so `repair: correction` updates the exact record; correction classification comes from model or judge, never a word rule; record ids stay in the volatile prompt part; List view uses the batch pattern; record view shows last recalled and history (created, edited by you, tidied, recalled).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **BRAKES-01: Brakes for actions** (M, slice 5, review level medium). Settings: per tool do, ask or never; an `approval-card` in chat showing the exact action; one tap, one receipt, never a repeat ask; an audit row per decision; a child's ask goes to a parent. Adds approval kind `tool_action`; the self-decide refusal in `approvals.ts` stays untouched. Depends on: tools design step 3 (point this id at it if the tools plan already carries one); T4, R2; lands before any write tool. Builder: Claude local (Sonnet; route and guard). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md). Row-Bot acceptance: a tool needing setup shows a setup card that opens its exact setting, never a generic approval; a required account or channel shows a Connect card; an outbound connection card says what leaves; hosted search is never available to a minor; in background turns asks park and notify, and delete, send and pay are unavailable regardless of per-tool setting; never show a parental key setup card to a child.
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **ACTIVITY-01: Activity** (M, slice 6). One page: working, waiting on you, done, failed, paused; jobs, projects, approvals and errands as one roll-up row each, with pause and cancel. A member sees only their own rows; admins see household jobs. Renamed from the plan's FEED-01, which is the done thumbs item. Depends on: slices 2 and 5 for data; can start on jobs and projects alone. Builder: Codex. Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
  - [x] **ACTIVITY-01d: kit activity placement** (S; kit e01da96, ui-v0.5.106; Home portion landed in home-b65). The kit header-button placement is withdrawn by the owner ruling of 2026-10-06. No header button and no S2 exception; activity is the working dot at the reply tail, step disclosure in the message and card above the composer.
  - [x] **ACTIVITY-01e: Home activity card** (S; Home card landed; NEEDS-YOU-01 merged here). No header button and no S2 exception; working dot at the reply tail, step disclosure in the message, calm card above the composer.
  - [x] **APPROVE-CALM-01: the calm approval card** (S, 2026-10-06; the owner called the inline yes/no box an "ugly yellow box"). Historical appearance record; APPROVE-CARD-02 now uses the kit `ApprovalCard` with "Go ahead?", reassurance, "Waiting since", Allow once, Deny and the Cmd/Ctrl+Enter hint. No Always allow, Details link or action-specific question.
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **ERRAND-01: Errands that run for days** (M, slice 8). A plan, a `comparison-card` in the thread, a question card whose button resumes the errand with no model call, pause and cancel from Activity (cancel removes every child watch), a plain stop when a budget runs out; the final step is a cart link and never a purchase. Runs only when the active model's record has `background_turns: true` (a commons spec field, per-model yes/no, off below the model-size floor, rule 8 applied to a new feature class; the spec field is MODEL-BG-SPEC-01 in `commons`, not edited here); on any other model it does not run and says so plainly. Depends on: SCHED-02, BRAKES-01, ACTIVITY-01, PROJ-TOOLSTEP-01. Builder: Claude local (Sonnet floor; spans subsystems). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md). Row-Bot acceptance: show turn n of m and elapsed; Pause, Resume and Stop; stop after two turns without progress or the same step failing three times, using deterministic checks; survive restart from the last saved turn; block an identical tool and argument digest on the fourth repeat and stop the turn on the fifth; budget survives restart; server-started steps are quiet centered notes, not person bubbles.
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **PROJ-TOOLSTEP-01: Project `tool` steps run** (M, slice 8). Wire the `tool` step that `projects/steps.ts:117` throws on today: it runs a read tool inside 120 seconds, and a step still running at `bun restart` reruns idempotently. Depends on: PROJECT-RUN-01 owns the runner. Builder: Claude local (Sonnet). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **PRICEWATCH-01: Price watch** (M, slice 9). A `watch.check` job that stores each observed price, compares it to the threshold the person set, and notifies `watch.triggered`. The first run shows the price it read for the person to confirm; three failures in a row mark it stuck and say so; nothing is bought. Runs only when the active model's record has `background_turns: true` (a commons spec field, per-model yes/no, off below the model-size floor, rule 8 applied to a new feature class; the spec field is MODEL-BG-SPEC-01 in `commons`, not edited here); on any other model it does not run and says so plainly. Renamed from the plan's WATCH-01, which is the launchd watcher. Depends on: HEARTBEAT-01, the extraction card (slice 7), ERRAND-01, NETPOLICY-01 gap audit. Builder: Claude cloud for the offline bench with fixtures, then Codex. Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **OPENLOOP-01: "You said you would call the dentist"** (M, slice 9). Open commitments the person mentioned come back at the next heartbeat. Ships only once the judge meets the bar. Depends on: HEARTBEAT-01; BLOCKED on the JUDGE-QUALITY-01 80 percent bar (not on the owner). Builder: Claude cloud for the bench, then Codex. Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **TRAVEL-PROVIDER-01: Choose a flight-data provider** (S, research). Compare licence, terms, cost, free tier, self-host option, MCP availability and exactly what each provider receives. Output is a recommendation for the owner; TRAVEL-01 dispatch waits on it. Depends on: none. Builder: Claude agent (Sonnet). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **TRAVEL-01: Travel search** (M, slice 10). "Find me flights from Boston to Denver next Friday", then "morning only", "cheapest nonstop", "remind me to book it Tuesday": a `comparison-card` of at most 12 rows, a reminder that names the flight, a booking link, no purchase. The provider is a second owner-keyed outbound call (owner answer Q12, yes): off by default, adults only, never a minor, and it shows the origin, destination and dates it sends. Acceptance includes the `docs/PRIVACY.md` row in the same change. Depends on: TRAVEL-PROVIDER-01, the connector kind (slice 7), SCHED-02. Builder: Codex once the provider is chosen. Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **CONTACTS-01: Contacts** (S/M, later). A small CardDAV recipe package, adults only; feeds "the school" style lookups and the BRAKES-01 recipient allow list. Depends on: none. Builder: Codex. Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **EMAIL-DRAFT-01: Email drafts** (M, later). Save a drafted email to the Drafts folder, then send behind the brakes. Synthetic fixtures only; Drafts only until BRAKES-01 lands. Depends on: BRAKES-01. Builder: Claude local (Sonnet). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **ATTACH-01: Attachments into extraction, narrowed** (S, later). Only feed the existing `extractDocument` output into the extraction call. COMPOSER-DOC-ATTACH-01 (done) and ATTACH-PREVIEW-01 are not redone. Depends on: the extraction call (slice 7). Builder: Codex. Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **NETPOLICY-01: SSRF gap audit** (S). Gap audit only, no port: diff `commons/core/src/ssrfGuard.ts` (`assertNotPrivateHost`) against OpenClaw `packages/net-policy` (MIT) for metadata hosts, redirect re-checks and DNS rebinding, and port only the missing checks into `commons` first, with the MIT notice, then tag and bump the Home pin. Depends on: none. Builder: Claude agent (Sonnet). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **TOOLREPAIR-BENCH-01: Tool selection and repair bench** (S/M). Bench only: 60 replay prompts (40 need a tool, 20 do not) against the 8B model at offered tool sets of 10, 16 and 24. The repair port itself needs its own architect verdict after a 5-point lift. Depends on: THIN-2D. Builder: Claude local (Sonnet; needs the engine). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **BROWSER-BENCH-01: Browser worker bench** (M). Bench only: 20 scripted read-only web tasks through Skyvern (AGPL, separate process) or Browser Use (MIT). The connector needs its own verdict. Depends on: none. Builder: Claude local (Sonnet). Status: not started; queue priority: chat UI first, chat quality second, then this. Design: [plan](plans/assistant-layer-2026-10-04.md).
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)

## Incognito (2026-09-24, priority for Saturday's push)

Current placement ruling (owner, 2026-10-06): the Incognito switch is in the rail More menu, with a purple content frame, a fixed Incognito label and Exit control, and an avatar ring. RAIL-03 is held until RULES S1 is amended. The earlier ChatHeaderBar toggle below is historical and superseded.

Design record: `docs/plans/privacy-mode-2026-09-24.md`, corrected
2026-09-25 (session lock replaces a forced idle wipe, blank start
confirmed, minors allowed by default). Three of five original open
questions are now Jesse's own settled calls; two remain (named per
row below). Genuinely L overall - chunked here into buildable pieces,
in a sensible build order. `[x]` foundation pieces already exist per
the design doc's own "What already exists" section.

- [ ] **INCOGNITO-05: the sharing/social guard** (M, after
      `INCOGNITO-04`). One shared check every sharing/social/
      publishing route calls, the same shape `meetsMinRole` already
      has - a new social feature is safe by construction the day it's
      added. **Open question: the exact route inventory** - `STORE-
      SHARE-01`'s share pointers and any route `INCOGNITO-04` marks
      `blocked` are known now; `CHANNELS-01` and any future "publish
      for the family" action get added to the guard's own coverage
      list as each ships, not guessable today. Exit: `bash scripts/check.sh`.
    Design: [privacy-mode-2026-09-24](plans/privacy-mode-2026-09-24.md)
- [ ] **INCOGNITO-06: download-to-keep for generated content** (S,
      after `INCOGNITO-01`). The Images app's (and any future
      generation app's) "your generated content" tab works normally
      during an Incognito session - browsable like any other time,
      cleared only when the whole mode switches off. Downloading is
      the one deliberate action that survives past that exit, moving
      the file onto the person's own device, outside MaiPai's data
      model. Exit: `bash scripts/check.sh`.
    Design: [image-generation-2026-10-17](design/image-generation-2026-10-17.md)

## Security against seizure and intrusion (owner, 2026-10-07)

- [ ] **SEC-PRIVACY-01: raise security and privacy for the case that law enforcement, a government or a hacker gets into the system** (M research and design, then slices; owner 2026-10-07: 'update the security and level of privacy in case law enforcement, government, hacker, etc gets into our system; research what other people do, e.g. encryption, encrypt per person; somebody had to have solved this'). Output `data-scratch/design/SECURITY-PRIVACY-DESIGN.md`: a threat model (a stolen or seized device, a remote attacker with the hub's database, a household member with the admin account, a compelled disclosure or search warrant, a malicious package, a leaked backup, a network attacker on the home or Tailscale), what comparable local-first and privacy products do (Signal, Matrix and Element, Nextcloud end-to-end encryption, Standard Notes, Proton, Apple Advanced Data Protection and Keychain, Cryptomator, Home Assistant, Immich, SQLCipher, age and envelope encryption, passkeys), per-person keys derived from the person's passcode so the admin and the machine owner cannot read another person's records, backups and exports encrypted with the person's key, key recovery without a back door, what must stay plaintext in memory for a local model to run and how long, search over encrypted data, and the honest limits (an attacker with the running machine and the person's session). Slices, spec first. Architect gate before any build; touches credentials, privacy and safety paths.
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)
- [ ] **LOCALCODER-SANDBOX-01: the local coder (Reika with the 9B model) runs in an OS sandbox with no network except its own model server** (S to M; owner 2026-10-07 asked whether Reika could leak data, allow internal access or do malicious things). Findings from reading `@alexwkleung/reika` 0.1.0 (Apache-2.0, one maintainer, normal dependencies) and the live run: the only connection observed is to the local llama-server on 127.0.0.1:54800; the package has a fetch exfiltration guard (a URL that carries data the model was not given needs approval), a host policy, and web search and paste-fetch are switched off by our runner (REIKA_CDP_SEARCH=0, REIKA_PASTE_FETCH=0); its models.dev catalog fetch only applies to hosted endpoints. Residual risk, not removed by those: it is a shell-capable agent running as the owner's own user with auto-approve 'safe', so a prompt injected through text it reads, or a model mistake, could read any file that user can read (the live data/ folder, keys, ssh) or run a destructive command; 'do not touch data/' is only a prompt line. Fix: a macOS sandbox profile (sandbox-exec) around every run: read and write only the coder worktree and its node_modules and temp, read-only for the reika package, deny network except 127.0.0.1:54800, deny everything under the live data folder, ~/.ssh, ~/.config and keychains; plus a post-run check that no file outside the worktree changed (the scope check already diffs the worktree); pin the reika version and checksum in the runner and re-review on any bump; keep the 35B off; tasks come only from the coordinator. Architect verdict not needed for a local dev tool; review by a second lane. AUDIT 2026-10-07 (data-scratch/design/REIKA-AUDIT.md): no sign of malice (no telemetry, update checker, hidden endpoint or obfuscation; install scripts none; lockfile hashes equal the registry's; dependencies past their advisory versions) but real hardening gaps: Reika's own sandbox lets commands write the shared home/.git (git config core.fsmonitor or a new hook would run code outside the sandbox and plant a hook in the main checkout; tools/_treediff.js:247 runs git status outside the sandbox after every shell call), a command that prints 'sandbox-exec:' and exits 65 is rerun outside the sandbox (bash.js:467-483), project node_modules/.bin/tsc runs outside the sandbox, loopback is open on every port (the live hub on 8787 is reachable), fetch_url is always on and runs outside the sandbox, .env files from the working folder and ~/.config/reika/.env can set any REIKA_* (REIKA_SANDBOX=0, MCP servers), the child env inherits ours, 'safe' auto-approve passes bash script.sh, python3 or node script files, git config and rm of a file; the package is new (first npm publish 2026-10-05, one maintainer, 6 stars). Required before Reika runs again: (1) outer sandbox-exec around the whole process: write only the worktree, a scratch folder and shared .git minus hooks and config; deny reads of ~/.ssh, ~/.config, ~/Library/Keychains and home/data; deny all network except localhost:54800 and explicitly deny localhost:8787; (2) launch with env -i, a fake HOME and every security-relevant REIKA_* set explicitly (MCP, typecheck, autosave, skills, fetch off), refuse to start if the worktree has .env or .reika; (3) pin 0.1.0 with a frozen lockfile and check a dist/ hash before each run, re-read the diff before any newer version (0.1.1 exists); (4) a harmless probe in a throwaway worktree confirming the escape paths are closed; keep Reika (best on our bench: 3/5 vs aider 2/5, OpenCode 2/5, Codex CLI 1/5) since the outer sandbox protects whichever harness runs inside it.

## Modes, not ages (owner, 2026-10-07)

- [ ] **MODE-NAMING-01: child, teen and adult are admin-set modes (controls), not ages: rename the concept everywhere** (M, owner correction 2026-10-07: "admins will set child, teen or adult mode on each account; that has nothing to do with age, it has to do with controls; an admin could put their mature teen as an adult, put their grandmother on child"). Scope: (1) user-facing text, docs and design notes never say age band, ages or reading age for this; say mode or controls (COPY-RULE-01's lint gets 'age band', 'age-appropriate', 'at this age' and 'your age' as banned phrases for person-facing copy); (2) code and spec names `age_band`, `ageBand`, `AgeBand`, `band` (about 95 backend and frontend files, spec keys, settings registry `band_default`) become `mode`, `modeDefault` and so on, spec first with an alias period so bot and the robot keep reading both, no behaviour change, one slice per package; (3) the 'age' word survives only where a real birth date or age is stored for another purpose, which Home does not do for the mode; (4) fix the existing docs that say 'age band' (about 29 files in docs, design notes and org docs: org SAFETY.md and CLAUDE.md say 'the output gate's grain follows the person', check them) with the org repo's own process. Architect verdict first (safety path declarations). DESIGN FIRST (owner 2026-10-07: 'maybe that needs a design: do people still call it teen, child, adult or something else; is this the right way to think about it?'): data-scratch/design/MODE-MODEL-DESIGN.md decides the concept and the user-facing names before any rename.
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md)
- [ ] **MODE-BIRTHDATE-01: a birthdate never changes a person's controls; the admin's assignment is the only input** (S to M; owner 2026-10-07 'we never take age into account, strict role assignment only', Owner-approved: 2026-10-07). `backend/src/lib/ageBand.ts` lines 64 to 75 take the stricter of the role and a birthdate on file: remove that branch and every other place that derives controls from an age or birthdate; one plain confirmation in the admin UI when an admin chooses a looser setting for an account (rule 0 loosening is the owner's own ruling); tests that a person with a birthdate under 18 in Adult controls is treated as Adult controls, and that a person cannot raise their own controls. Architect verdict first (safety path), review medium.
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md)
- [ ] **MODE-GUEST-01: a guest is not Adult controls by default** (S; finding of MODE-MODEL-DESIGN.md: `ageBandFromRole` in `backend/src/lib/ageBand.ts` ~line 39 returns adult for a guest, so a visiting child added as a guest gets the adult content ceiling and gate). Tightening only: the admin chooses the controls when creating a guest, Teen controls preselected; existing guests keep working but are reported to the admin once. Needs the architect verdict because it is a safety declaration; no owner decision needed (it only tightens).
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md)
- [ ] **NO-CROSS-USER-VISIBILITY-01 (replaces NO-CHAT-READING-01): no user can see what another user does, in any app, ever** (M to L, inventory then removal; owner 2026-10-07: 'no user can see what another user does, period: not websites visited, music listened to, videos watched, images created, chats held, etc.; if a parent wants to read a kid's chats they ask the kid to show them or use the kid's passcode, like any other service'). Scope is every app and surface, not only chat: inventory every route, page, widget, export, notification, dashboard card, admin screen and tool through which any person (owner, admin, adult, parent) can see another person's activity: conversations, search queries and sites visited, music and video history, images created, files, memory, notes, per-person usage counts, 'recent activity' lists, status pages that name a person; household-wide aggregates that name no person are fine; things a person puts in a shared space themselves (a share link, a shared playlist) are their own act and fine. Then remove each path, with per-role and per-mode regression tests, and update SAFETY.md, the parent-approval, teen and mode-model notes that assume parent visibility (org repo through its own process); the platform principle is added to the org privacy standards with Owner-approved: 2026-10-07. The text-free real-danger parent alert stays until the owner says otherwise (OWNER-ANSWERS.md). Architect verdict first (privacy and safety path; it removes supervision capabilities by owner decision). Original chat-only wording follows: **nobody can read anyone else's chats, ever** (M, inventory then removal; owner 2026-10-07 'there is no reading of anyones elses chats, ever'). MODE-MODEL-DESIGN.md says Child controls today lets admins read chats. Inventory every route, page, export, notification and tool through which an admin, parent or any other person can read another person's conversation text (conversation routes with a person id, admin pages, share links excluded: a share link is the owner's own act, backups and exports are the account holder's own), remove them, keep parent alerts text-free, update SAFETY.md and the parent-approval and teen design notes that assume otherwise (org repo through its own process), regression tests per role and per mode. Architect verdict first (privacy and safety path; it removes a child-supervision capability by owner decision).
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **LOG-PRIVACY-01: no log ever carries specifics that reveal or let anyone reverse-engineer what another user did; admins still need to troubleshoot** (M design then S or M slices; owner 2026-10-07, part of NO-CROSS-USER-VISIBILITY-01). Design first: data-scratch/design/LOG-PRIVACY-DESIGN.md (privacy-preserving logging practice, an inventory of today's logs and traces and who reads them, the rule for what a log line may contain, what an admin sees to troubleshoot, a user-initiated and user-previewed problem report as the break-glass path, never an admin back door, retention, a typed log API plus a canary-string gate test, and what changes for the admin turn-trace page and status pages). Architect verdict before any build slice.
    Design: [RULES](design/RULES.md)
- [ ] **SETTINGS-LOOK-01: settings rows, groups and controls look and behave like ChatGPT's, and 'Reset to default' goes** (S to M; owner 2026-10-07; screenshots chatgpt-settings-personalization, -voice, -notifications and -appearance .png in data-scratch/chat-ab/owner-shots-2026-10-07/). Remove every 'Reset to default' control (ChatGPT has none). Copy ChatGPT's anatomy through the kit's shipped settings parts and tokens (no Home CSS): a page title; section headings above rounded card groups; each row is the setting's name with one short plain line beneath on the left and the control on the right (toggle, a pill dropdown showing the current value with a chevron, an 'Add' with a chevron for a drill-in, a 'Manage' button, a color pill with its hex); hairline dividers between rows inside a card; generous row height and padding (not crowded); only one description line (two at most) per row; 'Learn more' links only where there is real help to show; an Appearance page with a Mode choice shown as three preview tiles (system, light, dark), a Theme dropdown, an Accent dropdown, Background and Foreground color pills and an Advanced disclosure; notification rows each with a dropdown of channels. Where the kit's settings parts cannot express an anatomy above, that is an additive kit change in commons first (rule 9c), not Home layout. Depends on SETTINGS-DENSITY-01's layout half and COPY-RULE-01's description pattern; folds into SETTINGS-APPEARANCE-01 for the appearance page. Architect verdict first.

## Kid mode (owner, 2026-10-17)

Design record: [docs/design/kid-mode-app-voice-2026-10-17.md](design/kid-mode-app-voice-2026-10-17.md) (owner 2026-10-17: the look and feel and the verbiage of every app change on Child controls). One token layer (`spec/modes/looks.json`, a generated block in the kit's `tokens.css` keyed on `html[data-mode]`, mode floors on the ease resolver), one copy layer (Lingui catalogs per mode, `en-US-x-child` and `en-US-x-teen`, falling back to adult; spec records keep their own child and teen fields), and per app what is hidden, locked or asked for. Modes are admin-set controls, never ages (MODE-NAMING-01). Nothing here loosens a protection; every hide has a server refusal test.

- [x] **KID-MODE-01: the kid mode design note** (S, 2026-10-17). The note above: existing pieces gathered, the token and copy layers, hides and locks per app, the approval flow, accessibility, the per-app screens, the test plan, and the two conflicts reported for the owner (rail labels against S1; the child strip's "a parent can see this chat" against NO-CROSS-USER-VISIBILITY-01).
- [ ] **KID-MODE-02: the mode record and the kit's mode tokens and variants** (commons, S to M; spec first). Objective: `spec/modes/looks.json` in the shape of `ease/presets.json` (child, teen, adult; surface and text colors, four kid looks, type scale, font, radius, icon size and stroke, illustration style, motion, density), the generator extended to append a `html[data-mode]` block to `tokens.css` with the parity test, the kit variants a token cannot reach (`EmptyState` rounded art, icon stroke token, `MediaShelf` and `CardGrid` page-size token, a warm `Alert` variant, `size="kid"` on `Chip` and `Button`, a read-aloud action slot on the card and page-header parts), the `ui.companion.sounds` `copy.does` and `does_child` rewrite naming every cue it switches (only if the owner accepts the design record's decision 4), `ui_message_child` and `ui_message_teen` on `errors/errors.json` with the design record's section 5.3 spec rows, the `setting-reasons.json` child rows (the `household_admin` child line, the new `guardian_picks` reason), `tts.voice_id` `copy.does_child`, `range.options_by_mode` on `ui.look`. Mirror: `ui/scripts/gen-ease-tokens.ts` and `ease-tokens.test.ts`. Acceptance: the contrast tests prove 7:1 for every child pair, `--target-min` 76 px and body 18 px under `child`; the font decision (Lexend against the system font) recorded with its reading measurement. Out of scope: Home wiring. Reuse check: the ease generator and the shipped kit parts; no new component, cue or sound key. Exit: the commons gate, new `spec-v` and `ui-v` tags.
- [ ] **KID-MODE-03: the shell sets the mode** (home, S; after KID-MODE-02's tags). Objective: the shell sets `data-mode` on `<html>` from the person record beside the `data-ease-*` attributes (`frontend/src/shell/useEase.ts`), the mode floors in `easeResolve.ts` (child: targets at least `large`, text at least `120`, contrast at least `more`, motion `calm`), unknown means child before the record arrives and on a shared surface (`device.shared`, household scope, admin only, one new key, spec first). Acceptance: a test that a child with every ease key at Standard still resolves `large` and `more`; a test that no settings key sets the mode; captures of Home, Chat and Settings as child at 1440 and 390 in both themes opened and judged. Reuse check: `useEase` and the settings layers. Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files.
- [ ] **KID-MODE-04: the child and teen copy catalogs and the two lints** (home, M). Objective: `frontend/src/locales/en-US-x-child/messages.po` and `en-US-x-teen/messages.po` with Lingui `fallbackLocales` to `en-US`, the shell's provider activating `<locale>-x-<mode>` from `data-mode`, the screen rows of the design record's section 5.3 (its first table; setting, reason and error lines stay in their spec records and are never seeded into a `.po` file) as the first strings, a coverage lint that renders every app route as child against the seeded household and lists every fallback into a shrink-only baseline (`frontend/src/dev/copy-mode-baseline.json`), and a reading-level lint (child grade 4 or under, adult and teen grade 8 or under, the banned-word lists) over the `.po` files and the spec records' copy fields, run in `check.sh --pre` beside COPY-LINT-01. Mirror: `frontend/src/i18n.ts` and the kit baselines. Acceptance: both lints fail on a planted string; the coverage lint fails on a `.po` message id for a setting, reason or error line; a child route renders no string with "age", "error" or "admin". Reuse check: Lingui (in use) and the existing `scripts/reading-level.ts` on `text-readability` (MIT), extended, not a second scorer; nothing hand-rolled. Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files.
- [ ] **KID-MODE-05: read-aloud on the shipped surfaces, and the enrollment sounds switch folded in** (home, S; after 02 and 03; the fold after NOTIFY-SOUND-01 and only if the owner accepts the design record's decision 4). Objective: the read-aloud speaker button in every page header and on every card under Child controls, reading only the screen's catalog copy (source text only through a hub-built speakable field gated by the child output gate, design record section 4.3) through the household TTS in the person's preset voice; kid screens play no cue of their own (NOTIFY-SOUND-01's hub-sent cues only); `ui.enrollment_sounds` folded into `ui.companion.sounds` with a migration that carries each person's stored value where the new key has none and deletes the old rows, the enrollment cues unchanged except for the switch they read, and `frontend/src/lib/vision/enrollmentSoundsSetting.ts` retired. Acceptance: a test that the TTS request text equals the rendered catalog copy and never a source string; the migration test; enrollment cues silent when `ui.companion.sounds` is off; captures opened and judged. Reuse check: the existing `/api/tts` path, NOTIFY-SOUND-01's `cues.ts` and switch; no hook, no files. Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files.
- [ ] **KID-MODE-06: one slice per app** (home, S each; after 03 and 04): 06a Shell and Home, 06b Chat, 06c Search, 06d Video, 06e Music, 06f Podcasts and audiobooks, 06g News, 06h Photos, 06i Studio, 06j Settings, 06k Family, Memories, Privacy, Help, Weather, Library and Reference. Each slice: the section 9 screen of the design record on kit parts and tokens only, the section 6 hides and locks, each Ask as a summary template on the one `Ask` record of notifications-and-asks-2026-10-17.md, Allow and Deny for the parent only, no child answer or take-back, lasting yeses in the app's existing list (no table, record, route or permission store of its own; waits for BRAKES-02b; design record section 7), 06j retiring the hand-written voice line in `VoiceBrowserSection.tsx` for the `guardian_picks` reason through `describeSetting`, a backend test per hidden control that the route refuses a person on Child controls with no UI in the test, its catalog rows, and captures at 1440 and 390 in both themes opened and judged. 06d to 06f own only the screens and their catalog copy; the media policy, budgets and masking are MEDIA-KID-01's. 06d to 06g wait for the first slices of [media-apps-blend-2026-10-17.md](design/media-apps-blend-2026-10-17.md) and [news-app-2026-10-17.md](design/news-app-2026-10-17.md); 06g also waits for the news note's decision 1. Reuse check per slice: the kit part named in the record, the `Ask` record, `describeSetting`. Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files.
- [ ] **KID-MODE-07: the mode screenshot matrix and the user page** (home, S; last). Objective: `scripts/screenshot.ts` captures every app route for each mode at 1440 and 390 in both themes, judged before use; a user page "What your kid sees" in `docs/user/` at grade 6 with the generated captures. Acceptance: a kid capture not recognizable as the adult page fails review; the docs page passes the dad test. Exit: `bash scripts/check.sh --docs` for the page, `--pre` for the script.

## Teen experience research (owner, 2026-10-07)

- [ ] **TEEN-RESEARCH-01: research what ChatGPT does and does not do for teens, what Common Sense Media found, and design the capabilities MaiPai should add** (M research and design; owner 2026-10-07: "research chatgpt for teens (what it does, doesn't do) and commonsensemedia's review on what are its gaps, and let's design capabilities we should add into our product (ex. for teen safety, helping with homework, etc)"). Output `data-scratch/design/TEEN-CAPABILITIES-DESIGN.md`: (1) what ChatGPT offers teens today (teen accounts, age prediction, parental controls and what a parent can and cannot see, content restrictions, crisis handling, study and homework features, memory and data settings), with sources; (2) Common Sense Media's review of it and of AI companions and assistants for teens: ratings, risks, gaps they name; (3) other evidence on teen AI use (surveys, studies, regulator guidance, school guidance); (4) a gap analysis against MaiPai's existing teen model (age bands, teens' settings stay private, parent approval design, safety floors, no learned component in the safety path, output gate by person); (5) proposed capabilities each with the evidence behind it, what it protects or helps, how it fits the privacy architecture (nothing leaves the home, no MaiPai service in the data path), the teen-trust trade-offs (a teen's privacy versus a parent's visibility), and a size; categories to cover: safety (self-harm and crisis, harmful advice, sexual content, grooming and manipulation, over-reliance and emotional dependence, misinformation), homework help that teaches instead of doing the work (study mode, hints, show the steps, citations), parent visibility without surveillance, time and sleep limits, honesty about being an AI. Every capability is a proposal for the owner's decision, nothing added beyond the evidence. Architect gate before any build slice. STATUS 2026-10-07: research and design note written (data-scratch/design/TEEN-CAPABILITIES-DESIGN.md, 14 proposals TEEN-01 to TEEN-14); owner decisions recorded in OWNER-ANSWERS.md (no-feelings rule for all minors incl. the robot; parent alerts only for real danger; parent-set teen chat bedtime with an extension request card as a narrow exception to the teens-are-private ruling; no parent view of teen activity); next: architect verdict, then a Teen milestone of build slices.
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md)

## People, relationships and permissions

The spec landed 2026-09-05 (`docs/dev.md`, "Entities, relationships and
grants"): Entity, Relationship and Grant, with the relationship-type and
grant-action vocabularies and the cross-field validators. The hub half
landed with Session F step 7, 2026-09-06 - see below for what did and
didn't ship, and `docs/dev/session-f.md`'s step 7 write-up for the full
detail.

**Session E's step 6 (2026-09-06) confirmed this section was still
accurate at the time, checking directly with F rather than assuming
silence means "not started" (the same coordination this session already
did with D for the store in step 3): zero backend existed yet for any
of this.** F's own step 7 (below, merged after that check) has since
built all of it for real. **Devices and sessions with revoke were the
one piece already real at the time of that check**: F's step 6
(passkeys, device tokens, Quick Connect, sessions, optional TOTP -
`GET/DELETE /api/devices`, `GET/DELETE /api/auth/sessions`) - Session E
built the frontend for it (`DevicesSection.tsx`/`DevicesPage.tsx`,
step 6). `AdminGatedPage.tsx`'s existing role-based gate (already reused
for Repairs, Backups, AI models, and the person-pickers on
Conversations/Memory) is the right mechanism for a parent's controls
page on top of what F built below - `settings.admin`'s own grant-action
wording in `spec/vocab/grant-actions.json` is still a stated future
state, not something built against yet. Entities and relationships got
their own frontend, lane 11 item 2 (2026-09-13, below); grants and
approvals are still real, unstarted work for a future session.

- [ ] **GRANTS-01: `min_role` on every package manifest becomes a grant check too**
      (L) - a manifest's declared minimum role is D's package-host
      territory (`packageHost.ts`), not touched by Session F step 7.
      Once `use:<package>` grants are actually consulted anywhere (see
      `ctx.allowance`/package gating below), a manifest's `min_role`
      should become the *default* grant a package's install seeds,
      overridable per person the same way `packages.use_all` already is.
- [ ] **ROLE-RENAME-01: rename the age-flavoured role values** (M or L,
      spec-first, after the decision above) - `Person.role`'s
      `adult`/`teen`/`child` become privilege-shaped names
      (coordinator's proposal: `unrestricted`/`limited`/`supervised` -
      open to a better name, not load-bearing which exact word wins).
      `owner`/`admin` (the top two) are unaffected, they're already
      privilege-shaped. Touches: the `spec` enum and a migration for
      existing rows, `backend/src/wire.ts:540-553`'s role checks and
      every other read site, settings copy, UI labels wherever a role
      shows (person pickers, the roster in Settings -> Household ->
      Users), every package manifest's `min_role` field, and
      `ENGINEERING.md`/`UI.md`'s kid presets. A household can still
      default the label by the person's age at creation time - the
      code just never reads age for it again afterward. Exit:
      `bash scripts/check.sh` full scope (crosses `commons` and `home`);
      the round-trip spec fixtures catch a missed read site.
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md) (decision 4, the rung names); [people-roles-and-account-2026-10-17](design/people-roles-and-account-2026-10-17.md) (the owner rung)
- [ ] **RELATION-INFER-01: Relationship inference** (L, and its own design pass first) -
      the storage model is useful without it and safe on its own. Two
      questions to answer before any code: does inference ship at all in
      v1, and may a parent see a relationship inferred from their teen's
      conversation? Both are Jesse's, not research questions. Status
      (2026-09-13, step 3a, docs/dev/session-a.md): the narrow case
      ships. The judge writes a relation its extraction slot names: a
      relation the speaker states is `stated` by them; one the model
      worked out is `inferred` (confidence, the turn as evidence),
      person-scoped to the speaker, a candidate never rendered or
      recalled by identity until the person answers (ASK-01's open
      question) or a household adult confirms it, and never read by
      anyone else's turn. The pipeline that joins records to guess a
      relation nobody mentioned, and the parent-sees-teen question,
      stay open here.
- [ ] **Screenshot the Confirm row** (S, after ASK-01 or a deterministic
      seed hook for an inferred relationship, whichever lands first) -
      the Confirm control itself already shipped (above); once
      something in the seeded demo household can produce a real
      `source: inferred` relationship deterministically and fast (no
      background-judge wait), extend `scripts/screenshot.ts`'s own
      `capturePeopleAndThings()` to click Confirm and capture the row
      before and after, the way `capturePaletteOpen()` and other small
      dedicated captures in that file already work. Exit: the
      screenshot opened and judged (getmaipai/.github/CLAUDE.md's own
      screenshot rule), the image showing a real unconfirmed-then-
      confirmed row, never a fabricated one.
- [ ] **EASE-OF-USE-01d: A speech profile per person** (M) - how to address someone
      (complexity, pace, vocabulary), distinct from persona, which is who
      the assistant is being. `persona.ts` already has a `complexity`
      dimension doing half the job for the wrong owner: two people
      sharing a companion must still be addressed differently.
- [ ] **Retire the free-text memory entity** (M, C) - now unblocked: the
      real `entities` table landed with Session F step 7, 2026-09-06.
      `record_kind: entity`
      keeps a name and description in one `text` field and recovers the
      name by splitting on the first colon, which `lib/memory.ts`
      documents as an approximation. Entity records replace it; memory
      stays narrative.
- [ ] **The Python half of `spec/records/ts/validate.ts`** (S) - lands
      when the robot writes one of these records, the same split
      `spec/safety/` takes today.
- [ ] **PEOPLE-EXPAND-01: People directory beyond account holders** (L,
      needs its own design pass first, unstarted) - a future expansion
      of `/people` to non-account entities the assistant knows about:
      pets, an "People I Know" grouping, people the household knows of
      but who aren't members (Jesse's own examples, 2026-09-25). Needs
      the Entity/Person-vs-User split ("The hub half of entities and
      relationships," above) as a prerequisite - `PeoplePage.tsx` can't
      answer this without Entity storage - and a real design pass before
      code, per the spec's own "Inference is the dangerous half" risk
      (a household member browsing an entry for someone else's
      relationship, an inferred connection nobody confirmed). Same
      shape as the already-recorded open question ("may a parent see a
      relationship inferred from their teen's conversation") but for
      browsing rather than inference specifically.
    Design: [family-tabs-lane-b-2026-09-28](plans/family-tabs-lane-b-2026-09-28.md)
- [ ] **FACE-03: hub-synced face prints on the robot** (M; Sonnet; medium review: a route, a guard, and auth). Objective: a paired robot holds the household's live face prints in memory, refreshed from the hub, and recognizes an enrolled person. Design resolved 2026-09-28 (`docs/dev.md`, "FACE-03: hub-synced face prints on the robot"), since the transport this item assumed (`spec/link/`'s oplog replica, LINK-02/03) is unbuilt and Reachy's own design already puts this body on plain HTTP routes ahead of it. **Hub half (this repo):**
    - [x] `sessions.device_id` (migration), set at redeem in `routes/deviceAuth.ts`/`lib/session.ts`, so a robot's session is distinguishable from its pairing admin's.
    - [x] `requireDeviceSession(kind)` in `middleware/auth.ts` (shared with the unstarted ROBOT-ROUTES-01); admits only a device of kind `robot` with the `camera` capability. Note: "no device at all" (an ordinary person session, admin included) is 403, not 401 - this exit's own wording below ("a person's session... gets 403") is the tie-breaker; 401 is reserved for authenticate() itself failing, which now includes a revoked device's session, since `deleteDevice()` deletes its `sessions` rows too.
    - [x] `deleteDevice()` (`lib/devices.ts`) also deletes that device's `sessions` rows and invalidates the session cache - today a revoked robot keeps a live session for up to 7 days.
    - [x] `GET /api/biometric-prints/sync` (`routes/biometricPrints.ts` + `listPrintsForSync()` in `lib/biometricPrints.ts`): every live (`deleted_at IS NULL`) face print, full spec records, `{as_of, prints}`; voice prints never included; device-gated per above.
    - [x] Amend `lib/biometricPrints.ts`'s header comment, which currently says the embedding is "never included in any API response" - the sync route is the one sanctioned exit, for a device-gated caller only.
    - Exit: `bash scripts/check.sh`; a person's session (admin included) gets 403 from the sync route, a robot device's session gets 200; a revoked print is gone from the response; deleting the device's next pull is 401.
    **Bot half (`getmaipai/bot`):** see that repo's own `docs/BACKLOG.md`.
    **Filed separately:** a `commons` spec defect (`spec/schemas/biometric-print.schema.json` makes `embedding` required, but the hub tombstones by nulling it - blocks LINK-03's oplog, not this item, since this item's snapshot only ever carries live prints).
    **Out of scope:** the oplog replica (LINK-03), robot-side standalone enrollment, browser/PWA-side matching (models design's own §5 browser-matching note needs its own later decision, since a browser session carries no device id), voice prints.

## Settings layers (owner, 2026-10-12)

Three layers: user overrides over global defaults over user defaults (Kids, Teens, Adults). Union lists merge with add/remove rows; override keys replace.

- [ ] SETTINGS-LAYERS-01e (M): migrate the band-named household keys (`search.blocklists.teen` and kin) to `band:<band>` scope rows.
- [ ] SETTINGS-LAYERS-01f (M): SafeSearch on the resolver; retire `assertCanSetSafeSearch`.
- [ ] SETTINGS-LAYERS-01g (M): per-person app permissions on the resolver.
- [ ] SETTINGS-LAYERS-01h (M): the house rules prompt: a global-defaults text added to every chat, never overriding a hard line.
- [ ] SETTINGS-LAYERS-01i (S): custom sites on the People section; a consumer for `page_text_cleaning`; click-test the 01d section on a phone viewport.

## Settings

- [ ] **Selector renderers so the custom sections can become declared
      keys** (M; the concrete reason Settings cannot be declarative
      today) - `SettingField` handles text, number, select and boolean,
      and secrets are read-only. Eight of ten sections on the page are
      custom React (voice catalog, cloned voices, PIN, commands, HF
      token, models, backups, routing stats) against SETTINGS.md Rule 1.
      Add `duration`, `time`, `person`, `media` and a secret-entry flow,
      then re-declare the sections that only needed those.
    Design: [settings-redesign-2026-09-30](plans/settings-redesign-2026-09-30.md)
- [ ] A household-name tagline on Home (S) - done 2026-09-11. Found live
      alongside the household-location fix above: Home's header hardcoded
      the generic "Made for your everyday" line with no way for a
      household to make the page its own. `household.family_name`
      (`coreKeys.ts`, blank by default) lets a household set its own
      name; `frontend/src/apps/home/HomePage.tsx`'s `Tagline` renders
      "{name} Family" once set, falling back to the original generic line
      otherwise. See `HomePage.test.tsx`'s Tagline suite.

    Reopened 2026-10-17: household.family_name is still declared in backend/src/settings/coreKeys.ts:85 but nothing in frontend/src reads it: frontend/src/apps/home/HomePage.tsx no longer exists and the 2026-10-16 re-add (946bd7f9 DOCS-GAP-04) was reverted by 2fabb68b.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **DATA-LOCATION-01: choose where each kind of household data lives at install** (filed 2026-09-29, Jesse; designed 2026-09-29; revised 2026-09-30 to every data class, owner's requirement). Parent item: the design record is `docs/dev.md`, "DATA-LOCATION", and the work is DATA-LOCATION-00a to -00e, -03, -01a to -01f below. The first draft's "write the path into the service definition" is replaced by a bootstrap record beside the machine lock; the reasons are in the design record, section (a).
    Design: [wizard-folder-picker-2026-10-15](plans/wizard-folder-picker-2026-10-15.md)
- [ ] **DATA-LOCATION-02: move any class of data later, from Settings** (filed 2026-09-29, Jesse; designed 2026-09-29; revised 2026-09-30). Parent item: the design record is `docs/dev.md`, "DATA-LOCATION", section (c), and the work is DATA-LOCATION-02a to -02d, -06, -STACK and -04 below.
- [ ] **DATA-LOCATION-00d: core disk facts and capability probes** (M, lands in `getmaipai/commons`, after 00b; new 2026-09-30). Objective: `diskFacts(path)` and the probes the placement check (01f) runs, per the design record's (b) "The disk facts, per OS". Pointers: `commons/core/src/dataLocation.ts` or a sibling `diskFacts.ts`. Mirror: 00b's pure command builders and captured-output parser tests. Acceptance: `diskFacts` returns filesystem type, internal, external or network, solid-state or spinning when reported, the physical disk when reported ("unknown" for a RAID set that hides it), free and total bytes, from captured output on macOS, Linux and Windows; `probeWrite`, `probeExec`, `probeSymlink`, `probeHardlink`, `probeLargeFile` (sparse file past 4 GB, removed after) and `probePermissions` run against a temp folder and each removes what it created; each probe takes an optional run-as account for the installer. Out of scope: which class needs which probe (01f). Exit: `commons`'s `scripts/check.sh`, `core` tagged.
- [ ] **DATA-LOCATION-00e: core verified copy** (M, lands in `getmaipai/commons`, after 00b; new 2026-09-30). Objective: `copyVerified(from, staging, onProgress)`, the copy of the design record's (c) step 4, shared by Home's and the Stack's movers. Pointers: new `commons/core/src/copyVerified.ts`. Mirror: `core/src/archive.ts` for streaming file work and its tests. Acceptance: every file read, written, `fsync`ed and its SHA-256 compared with the copy read back; a manifest written; modes and mtimes kept; relative symlinks inside the tree copied as links and hard links inside the tree kept by inode; a symlink leaving the tree or a special file stops the copy naming it; a Windows sharing violation retried three times; a test copies a tree shaped like the Stack's `store/` and `models/` and proves the links survive. Out of scope: state machines (02b, 02d). Exit: `commons`'s `scripts/check.sh`, `core` tagged.
- [ ] **DATA-LOCATION-03: describe a folder before any delete, and set aside instead of deleting** (M, early on purpose: the 2026-09-29 incident's fix; revised 2026-09-30 to read class markers). Objective: nothing MaiPai ships deletes a data-shaped folder without first showing what it holds, and a folder no confirmed move has retired is renamed aside, never deleted (design record (d)). Pointers: new `backend/src/lib/dataLocation.ts` (`describeFolder`), new `backend/scripts/data-location.ts` (`describe <path>`, `show`, `classes`), `scripts/uninstall.sh`, `scripts/app.sh`. Mirror: `backend/scripts/set-setting.ts` for the CLI shape; `lib/storage.ts`'s `walkFiles` for sizes. Acceptance: `describeFolder` reports every class marker at the top and in subfolders, live or retired, sizes, newest file time, files not in the current layout, sensitive classes by name, and, from `hub.db` opened read-only, household name and counts of people, memories, conversations and live biometric prints with newest times; it never opens a database for writing (a test proves the bytes are unchanged); `uninstall.sh` prints each folder's inventory before its prompt and sets aside any folder not move-retired; a folder containing a live class folder is never offered for delete. Out of scope: the Storage page (02a), the record (01a). Exit: `bash scripts/check.sh` plus `backend/tests/dataLocation.test.ts` and `scripts/install.test.ts`.
- [ ] **DATA-LOCATION-01a: boot from the record: per-class resolution, marker checks, adoption** (M, after 00b and 00c). Objective: `bootGuard.ts` resolves every class from `MAIPAI_DATA_DIR`, then the record, then the default, checks each class's marker, refuses retired folders and adopts an existing household, per the design record's boot order in (a). Pointers: `backend/src/lib/paths.ts` (a per-class `source` replacing `dataDirIsExplicit`), `lib/bootGuard.ts`, `lib/instanceLock.ts` (`assertDataDirPlacement` treats a record path as explicit), `src/settings/referenceKeys.ts` and `lib/kiwixSidecar.ts` (`reference.library_dir` retired), `tests/preload.ts` (`MAIPAI_DATA_LOCATION_PATH` to a temp file). Mirror: SINGLE-INSTANCE-02's real-process boot tests in `backend/tests/instanceLock.test.ts`. Acceptance: a default folder with `hub.db` and no record gets a marker in every existing class folder, explicit `backups` and `received-backups` overrides and a record; an empty default folder gets nothing; a non-empty `reference.library_dir` whose folder exists becomes the `reference` override and the key is gone from the registry; a worktree whose `repoRoot` differs ignores the record; a retired marker refuses its class; a record with a missing class folder never creates it (the path still does not exist after boot); an env-sourced root never touches the record. Out of scope: hold mode (01b), degraded classes (01e). Exit: `bash scripts/check.sh` plus `backend/tests/dataLocation.test.ts` and `instanceLock.test.ts`.
    Design: [wizard-folder-picker-2026-10-15](plans/wizard-folder-picker-2026-10-15.md)
- [ ] **DATA-LOCATION-01d: never create a class folder** (M, after 01a; new 2026-09-30). Objective: `classDir(id)` is the only way a module reaches a class folder, and the twenty-six `ensureDataDir`/`mkdirSync` sites in nineteen modules go through it, per the design record's "Never create a class folder". Pointers: `lib/paths.ts`, every module listed by `grep -rln "ensureDataDir\|mkdirSync" backend/src` (`sidecars`, `kiwixSidecar`, `receivedBackups`, `modelDownloadJobs`, `modelDownload`, `favicons`, `restoreStaging`, `householdCa`, `denoHost`, `attachments`, `deviceId`, `packageCache`, `referenceLibrary`, `clonedVoices`, `backup`, `projects/steps`, `store`, `sttAssets`, `db/index`), `lib/keystore.ts` (created after the `keys` check), `lib/ttsSupervisor.ts` (`UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, `HF_HOME` into `tts-models`). Mirror: `stack/backend/src/lib/uvEnvironment.ts` for the TTS child's environment. Acceptance: a test removes each class folder in turn after boot and proves no code path recreates it and each caller answers its feature's "unavailable"; a test proves a missing `keys` folder never reaches `getOrCreateHexKey`; the TTS child's environment names only `tts-models` folders; a lint test fails on a new `mkdirSync` of a class folder outside `paths.ts`. Out of scope: health items and the watch (01e). Exit: `bash scripts/check.sh`. Also carried from 00c's open remainder: a test that walks every literal `join(dataDir` in `backend/src` and fails on any not routed through `classDir` (the sites 00c did not route: `keystore`, `householdCa`, `deviceId`, `favicons`, `sidecars`, `scripts/bench/labels.ts`, and the `hub.db` and `attachments` joins), and a check of the pinned engine archives for symlinks and hard links so `engines` keeps `needs: exec` and not `links`.
- [ ] **DATA-LOCATION-01b: hold mode when `records` or `keys` is missing, and `bun start`'s restart loop** (M, after 01a). Objective: a hub whose `records` or `keys` folder is missing or mismatched keeps the machine lock, serves a no-database page and health list with `storage.class_missing`, finds a drive that came back under another name by volume id, and exits 75 when every `hold` class returns; `app.sh` restarts on 75, per the design record's (b). Pointers: new `backend/src/lib/holdMode.ts` (imported dynamically from `bootGuard.ts`, never importing `@/app` or `@/db`), `MAIPAI_SUPERVISED=1` in the launchd, systemd and WinSW definitions in `scripts/install.sh` and `scripts/install.ps1`, `scripts/app.sh` (the loop, its pid, "waiting for its storage drive"), `data-hold.json` turned into a resolved Repairs issue by `lib/issues.ts` on the next normal boot. Mirror: `lib/searxngHealth.ts` for a health item's shape, the SERVICES.md health list. Acceptance: with either folder absent the process binds the port, answers the health route, shows the full path only to loopback, never creates the folder; restoring it with the right marker exits 75 within 35 seconds; the volume-id lookup rewrites a renamed mount's path for any class; `bun start` survives an exit 75 and `bun stop` ends both loop and hub; any other exit ends the loop. Out of scope: degraded classes (01e), the move's progress page (02b reuses this server). Exit: `bash scripts/check.sh` plus `backend/tests/holdMode.test.ts`.
    Design: [wizard-folder-picker-2026-10-15](plans/wizard-folder-picker-2026-10-15.md)
- [ ] **DATA-LOCATION-01e: degraded classes: health items, features off, and the 30-second watch** (M, after 01d; new 2026-09-30). Objective: a missing `degrade` class boots the hub with that class's features off and its health item raised, and a class that disappears or returns while running is handled, per the design record's degraded-modes table. Pointers: `lib/dataLocation.ts` (the watch), `lib/issues.ts`, the engine-availability path ENGINE-AVAIL-00 reads, `lib/tts.ts`, `lib/attachments.ts`, `lib/projects/`, `lib/denoHost.ts`, `lib/backup.ts`, `lib/receivedBackups.ts`. Mirror: `lib/searxngHealth.ts`. Acceptance: one test per row of the degraded-modes table boots with that class missing and checks what still works and what answers "unavailable"; a class removed while running raises its item within 35 seconds and resolves when its marker returns; a `hold` class removed while running exits 75; several classes on one missing disk send one notification. Out of scope: hold mode itself (01b). Exit: `bash scripts/check.sh` plus `backend/tests/dataClassesMissing.test.ts`.
- [ ] **DATA-LOCATION-01c: the installers' per-class choice, flags, and the Linux sandbox** (M, after 01a and 01f). Objective: `install.sh` and `install.ps1` show the disks and the proposed folder per class, take `--data-root`, `--location <class>=<path>` and `--locations-file`, run 01f's check, write folders, markers and record through `data-location.ts init`, and pass the Stack its classes, per the design record's (b). Pointers: `scripts/install.sh` (`install_systemd_unit` to `ProtectSystem=full` without `ReadWritePaths`, the upgrade `rsync` gaining `--exclude=/.maipai`, `setup_stack`), `scripts/install.ps1`, `scripts/uninstall.sh` (reads the record through `data-location.ts show`), `scripts/install.test.ts`. Mirror: how `install.sh` threads `STACK_DATA_DIR` through `stack_install_service_argv`, and its `--dry-run`. Acceptance: pressing Enter gives today's layout; the proposal moves `models` and `reference` only when the internal disk is too small; an upgrade keeps the record and never asks; `install.test.ts` asserts the `rsync` exclusion and `ProtectSystem=full`; an install against temp folders with two overrides passes; a live run on a real external drive on macOS records in the design record whether a root LaunchDaemon can write to a removable volume without a privacy prompt. Out of scope: moving an existing install (02b to 02d). Exit: `bash scripts/check.sh` plus `bash scripts/install.sh --dry-run` and the temp-folder install.
- [ ] **DATA-LOCATION-02a: Settings > Storage shows where each class lives, and each disk** (M, after 01a, 01f and 03; was S, widened 2026-09-30). Objective: the per-class Storage page: a read-only Locations table, one row per class grouped by product and folded by level, and a Disks table, per the design record's (c) "The page". Pointers: `frontend/src/shell/pages/StoragePage.tsx`, `backend/src/routes/storage.ts` (new `GET /api/storage/locations`, `@hono/zod-openapi`, listing the Stack's classes from its API). Mirror: the page's existing `DataTable` usage and `StoragePage.test.tsx`; shadcndashboard and kit components as shipped, nothing hand-built. Acceptance: every class renders from the route on a seeded household with folder, drive, filesystem, internal, external or network, free space, size, source and 01f's warnings; basic rows shown, advanced folded, expert under Developer tools; an env source labeled; screenshots opened in light and dark at 1440 and 390. Out of scope: the Move action (02c). Exit: `bash scripts/check.sh` plus the page test.
- [ ] **DATA-LOCATION-02b: the offline move's state machine, same-volume renames, the offline script, and a killed move at every step** (M, after 00e and 01b). Objective: copy, verify, switch, retire, first-boot check and pre-healthy rollback for `offline` classes, per class, from the design record's (c), driven by the record's `move` steps and run inside the hold-mode process, plus `bun run move-data --class <id> --to <path>` for a stopped hub. Pointers: new `backend/src/lib/dataMove.ts`, new `backend/scripts/move-data.ts`, `lib/bootGuard.ts` (step 4), `lib/holdMode.ts` (the progress page). Mirror: `lib/restoreStaging.ts` (directories as arguments; stage beside, then rename) and `backend/scripts/restore-drill.ts`. Acceptance: moving `records`, then `records` and `keys` together, of a seeded household to temp folders ends with identical SHA-256 for every file except `cache` and markers, the hub healthy, the old folders unchanged apart from their markers; a same-volume move is a rename; `MAIPAI_TEST_MOVE_FAULT_AT=<class>:<step>` (honored only with the test opt-out) kills the process at every row of the kill table and each row ends where the table says; two failed first boots roll back every offline class of the move; the old root after a `records` move keeps its live subfolders. Out of scope: Settings screens (02c), online classes (02d). Exit: `bash scripts/check.sh` plus `backend/tests/dataMove.test.ts`.
- [ ] **DATA-LOCATION-02c: the move from Settings: select classes, preflight, progress, confirm, delete the old copy** (M, after 02a and 02b). Objective: selecting rows and Move runs preflight through `POST /api/storage/move/preflight`, shows the plan with its space per target volume and a destructive confirm, takes the backup, starts the move, and after `healthy` offers keep or delete per class with its inventory, per the design record's (c) steps 1, 2 and 10 to 11. Pointers: `StoragePage.tsx`, `routes/storage.ts`, `lib/dataMove.ts`, `lib/backup.ts`. Mirror: the restore flow's staging and confirm, UPDATES.md's "only when safe" gates as the updater checks them. Acceptance: preflight refuses with its reason when the hub is busy, not supervised, or the source is `MAIPAI_DATA_DIR`, and when a target volume lacks the summed space; delete of an irreplaceable class is offered only after a backup of the new location; delete removes only the folder or named files retired by this move; the flow is driven end to end on a seeded household with screenshots opened. Out of scope: online classes (02d). Exit: `bash scripts/check.sh` plus the page and route tests.
- [ ] **DATA-LOCATION-02d: online moves: rebuildable classes, logs, the backup classes, and "download again"** (M, after 02c; was S "big files and backups", widened 2026-09-30). Objective: `online` and `empty` classes move with the hub up, pausing only each class's users, and `refetch` classes can start empty and download again, per the design record's (c). Pointers: `lib/dataMove.ts`, `lib/llmSupervisor.ts`, `lib/sidecars.ts`, `lib/ttsSupervisor.ts`, `lib/log.ts`, `lib/backup.ts`, `lib/receivedBackups.ts`, `StoragePage.tsx`. Mirror: 02b's tests, one row per class. Acceptance: a `models` move keeps sign-in answering throughout and chat returns on the new folder; a `reference` move with "download again" leaves the old archives in place until deleted; a `backups` move keeps retention and listing; a move within one volume is a rename; the kill table's rows pass for an online class. Out of scope: the Stack's classes (DATA-LOCATION-STACK). Acceptance adds one serialised idle maintenance job through the existing scheduler, compacting a SQLite file only when it is at least 32 MiB and at least 20 percent free. Exit: `bash scripts/check.sh` plus `dataMove.test.ts`.
- [ ] **DATA-LOCATION-06: the backup's file set comes from the class list** (M, after 00c; new 2026-09-30). Objective: `lib/backup.ts` includes each class's folder by its declared `backup` mode instead of `hub.db` alone, per BACKUPS.md "Built from declarations" and the design record's class list, so `cloned-voices` and `projects` are in the archive. Pointers: `lib/backup.ts`, `lib/restoreStaging.ts`, `lib/dataClasses.ts`. Mirror: the Stack's `PreciousState` inclusion in the household backup. Acceptance: a backup of a seeded household holds `hub.db`, the cloned voice samples and project files and nothing from `exclude` classes; a restore drill round-trips them; `keys` never enters the archive. Out of scope: attachments' own serializer and restore preview, which CHAT-PARITY-10 owns and builds on this. Exit: `bash scripts/check.sh` plus `backend/tests/backup.test.ts`.
- [ ] **DATA-LOCATION-STACK: the Stack's class list, record, never-create and moves on Home's request** (M, lands in `getmaipai/stack`; the coordinator files it in the Stack's own backlog; revised 2026-09-30). Objective: the Stack declares `stack-state`, `stack-models` (models and store together), `stack-engines` and `stack-logs`, keeps its own record beside its lock, adopts core's never-create, marker and verified-copy helpers, and serves its classes and moves to Home, per the design record's "The Stack". Pointers: `stack/backend/src/lib/paths.ts` (`ensureDataDir`), `stack/backend/src/lib/store/layout.ts` (`currentEngineRoot`), `stack/backend/src/lib/uvEnvironment.ts` (its `home/` folder assigned to a class), new `GET /stack/v1/storage/classes`, `GET /stack/v1/storage/locations`, `POST /stack/v1/storage/move`, `maipai-stack install-service --location`, `PreciousState` derived from the class list. Mirror: the Stack's own health list and event feed. Acceptance: with its models drive unplugged the Stack raises a health item and creates nothing; a missing `stack-state` refuses to start; a `stack-models` move keeps every hard link and symlink and engines start from the new folder; every folder under `STACK_DATA_DIR` belongs to a class. Out of scope: Home's Storage page (02a). Exit: the Stack's `scripts/check.sh`.
- [ ] **DATA-LOCATION-04: the user guide page and the SERVICES.md paragraph** (S, docs, after 02c). Objective: a user-tier page "Choose where MaiPai keeps its files" (grade-6, one action per step, generated screenshots), covering the install choice and a move, and the SERVICES.md "data locations" paragraph from the design record, carried to `getmaipai/.github` by the coordinator. Pointers: `docs/user/`, `.github/docs/SERVICES.md`, `.github/docs/STYLE.md`. Mirror: `docs/user/settings.md` and `docs/user/fix-a-problem.md` (the missing-drive messages belong in the latter). Acceptance: the page passes the reading-level lint; every screenshot is generated and opened. Out of scope: developer docs, already in `docs/dev.md`. Exit: `bash scripts/check.sh --docs`.

## Settings and copy polish (owner, 2026-10-07; screenshots in data-scratch/chat-ab/owner-shots-2026-10-07/)

- [ ] **COPY-RULE-01: every message a person sees describes what it does for THIS person (standing rule, then fix everything)** (M design and rule, then L fixes in slices; owner: "create this as a standing rule for every message we show to users: setting descriptions, messages, modals, tooltips, etc."). Defect example: the setting "Send photos in chat" says "Adults and teens are on by default; children are off until a parent enables this. Teens control their own setting." That is policy text for everyone and helps no one. Required: say what the thing does ("Lets you attach and upload pictures in chat"), then, only when it applies to this person, the state and reason ("Turned off by your parents", "Turned on"), with wording that fits the reader (child, teen, adult, admin); short (one line where possible, owner: descriptions are "so wordy"); no policy about other people. Design first (research how ChatGPT, Claude and Apple word settings; one definition of the copy pattern, a rule file added to the org UI standards and Home's RULES, a lint or review check that can see a description that mentions other age bands, and a per-person description function so copy is composed from the person's state), owner approval of the rule text (`Owner-approved: 2026-10-07` is given for adding the rule; the wording goes through the design note), then fix every setting description, notice, modal and tooltip in slices by app. Architect gate before dispatch.
    Design: [RULES](design/RULES.md)
- [ ] **SETTINGS-OPTIONS-01: an option with a single unclear word explains itself** (S to M after COPY-RULE-01's pattern; owner: the Personality setting offers "Buddy" with no hint what it does). Every choice in a settings list shows a one-line plain description of its effect (Buddy: what the replies sound like), taken from one definition per option, not hand-written in the page.
    Design: [RULES](design/RULES.md)
- [ ] **SKILLS-PAGE-02: the Skills page is organised like Claude's Customize page, not a flat list** (M, design plus build; reference screenshots claude-skills-ref-1..5.png). Needs: Yours and Discover tabs; search; a filter control and a sort control; Add menu (upload a skill, create a skill); sections with counts (for example installed, from the catalog, you made); category tiles with counts and Show all; featured and new rows as cards with a Show all that opens the whole list only when asked; a detail view. Skill content must follow the agentskills.io spec (SKILLS-COMPAT-DESIGN.md). Kit and shadcn parts only; the catalog is our own signed catalog, never a third-party directory.
    Design: [packages-apps-and-integrations-2026-10-17](design/packages-apps-and-integrations-2026-10-17.md)
- [ ] **COPY-GUARD-READS-SPEC-01: the settings write guard reads the spec's `control` and `band_default` so the declaration exists once** (M, follow-up of COPY-RULE-01, owner decision 2026-10-07; rule 0 floor: a child's protection must not weaken). Today the hand-coded band defaults in `backend/src/lib/chatPictures.ts`, `lib/settings.ts` and `lib/settingsMinorSnapshot.ts` enforce; the spec fields only describe, pinned equal by an agreement test (COPY-RULE-01 slice C1). This item makes the guard read the spec and keeps the agreement test as a check that a child floor cannot be weakened. Architect verdict first; Opus review; dispatch only after COPY-RULE-01's C1 has landed.
- [ ] **BOT-COPY-01: the robot's own settings guard and copy follow the copy rule** (S, after COPY-RULE-01 C0 and C1; principle 7: hub first). Bot repo item: its guard and settings text use the shared `describeSetting` through the Python interpreter.

## UI / shell

- [ ] **STORE-01: a real GET route to browse a trusted catalog index,
      and the settings it needs** (S/M) - the gap HOME-UI-02 found and
      deliberately did not build around: "the store is the same page
      behind a 'From the catalog' filter"
      ([docs/design/retired/home-pages-2026-09-20.md](design/retired/home-pages-2026-09-20.md))
      has nothing to build on. `backend/src/lib/storeIndex.ts` already
      verifies a signed index (`fetchRawIndex`/`verifyIndex`) and
      `backend/src/lib/store.ts` already installs a named package from
      one, but nothing lists what an index actually contains, and there
      is no pinned index URL or root-key trust config anywhere - an
      admin has no way to say "here is the catalog" at all yet. Files:
      a new route in `backend/src/routes/store.ts` (owner/admin gated,
      the same `requireRole("owner", "admin")` every other route there
      uses) wrapping `fetchRawIndex`/`verifyIndex` into a `GET
      /api/store/catalog` (or similar) that returns the verified
      index's target list; the pinned index URL and the root public
      key(s) as settings, declared once the way every other settings
      key is (`getmaipai/commons`'s `spec/settings/` declaration source,
      `backend/src/lib/settingsRegistry.ts` reads the generated
      registry - see an existing declared key for the pattern). Test:
      mirror `backend/tests/storeIndex.test.ts`'s own scripted-index
      fixture (`backend/tests/support/tufFixtures.ts`'s
      `buildFixtureIndex`/`makeKeyPair`/`sign`) and `backend/tests/
      store.test.ts`'s own route-test conventions (`owner()`/`teen()`
      test clients, the role-gate test, a tamper case). Acceptance: a
      local fixture index (`{kind: "dir", dir: ...}`, the same shape
      `install()` already accepts) lists real targets through the new
      route; a bad signature or an expired/rolled-back index refuses
      the same way `install()` already does, not a partial or silent
      empty list. Out of scope: any UI change (the second line below
      is that). Exit check: `bash scripts/check.sh`, the new route's
      tests green.
      Second line, once the route above exists: wire `AppsPage.tsx`'s
      "From the catalog" filter to real data and give it a real Install
      action (the pane action row, `disabledReason` for a permission-
      changing update the way `install()`'s own `requiresConfirmation`
      already models) - the honest empty state HOME-UI-02 shipped
      becomes real content instead of being replaced.
    Design: [catalog-marketplace-research-2026-10-03](plans/catalog-marketplace-research-2026-10-03.md)
- [ ] **SHELL-TV-01: TV-focusable nav rail, regressed by the `@maipai/ui` kit adoption**
      (M) - `ui-v0.1.0` through `0.1.3` (`commons/ui`, pinned 2026-09-20)
      has no `@noriginmedia/norigin-spatial-navigation` rail the way
      Home's own pre-adoption `shell/Shell.tsx`/`shell/tvNav.ts` did (see
      the now-`[x]` "Two render profiles per component, near and far"
      item below, whose hand-built rail this replaced and whose
      dependency this repo's `frontend/package.json` dropped as
      orphaned). Tracked upstream, not dropped: `commons/docs/BACKLOG.md`
      carries the real fix as a kit-level item (needs a design pass on
      how a focusable rail composes with `Shell.tsx`'s generic
      `NavGroup`/`NavEntry` props first). Home's own `AppShell.tsx`
      points here. Exit check: `home/scripts/check.sh` green once
      `commons/ui` ships the rail and Home re-pins.
- [ ] **PARENT-CONTROLS-UI-01:** Admin / parental-controls surface beyond the generic settings
      renderer (M)
- [x] **APP-KIND-05: the Weather app, first package app** (landed 2026-10-17 as WEATHER-APP-01 slice 1, whose row lists what is still open) (M, `catalog` then Home's bundled copy; after APP-KIND-04, PLACE-WEATHER-01 and WEATHER-CARD-01). Objective: `pages/index.json` (hero `weather_card` block, picker with Current location first then the person's saved places), one `forecast` section page, `contributes.data`, `keywords`, `settings_area` for saved places. Reuse check: the `weather_card` Element (WEATHER-CARD-01) and `resolvePlace`; no new map, geocoder or chart. Privacy: Open-Meteo stays the only outbound; Current location asks only on tap. Acceptance: opens from the library at `/apps/weather`; a saved place wins over Current location; offline shows the plain empty state; per band tests; captures at 1440 and 390 in both themes. Out of scope: animated icons (WEATHER-ICONS-01 is superseded by the `weather_card` Element). Exit: `catalog` check and `bash scripts/check.sh`.
    Design: [app-kind-2026-10-16](plans/app-kind-2026-10-16.md)
- [ ] **APP-KIND-06: robot and Go parity for package apps** (S each, `bot` and `go`; after APP-KIND-02). Objective: the robot's package host serves the same three routes from its local package copy and the DSI renders the page; Go implements `answer_blocks` and `picker`. Acceptance: a robot with no hub opens Weather from its local copy and says the block `alt` with no screen; Go renders the fixture page; `catalog.test.ts` agrees. Out of scope: any Home change. Exit: each repo's check.
    Design: [app-kind-2026-10-16](plans/app-kind-2026-10-16.md)
- [ ] **Unified search: one palette over everything** (M; Jesse,
      2026-09-05: "we need a unified search, I think we had that in the
      old app") - legacy did: a Spotlight palette (app entries and
      offline libraries client-side) over one `/api/search` endpoint
      that fanned out across twelve content types (bookmarks, news,
      companions, devices, saved videos, podcasts, clips, notes, books,
      music, chat) with FTS5, each provider independent and best-effort
      (a throwing provider contributes nothing rather than failing the
      search), six hits per provider, the last token prefix-matched so
      partial words match as you type, results grouped by type and
      navigating to a route on select. Most of this now exists in the
      rebuild (see the status block below, 2026-09-13) - stale the
      moment it was read against the actual code instead of assumed;
      `SearchBox` per page and "the shell palette for
      everything" are already the rule in plan 6.4 and UI.md. Build it
      as the shell's command palette (Cmd/Ctrl+K, and the Search row
      on every surface, since this audience will not learn a shortcut):
      core providers for apps, people, memories, conversations, settings
      keys and commands (the VS Code model the Settings rebuild already
      cites), a `search` blueprint so any package contributes a provider
      over its own tables, the web-search skill as the fall-through, and
      "ask MaiPai" as the last row so search and the chat prompt are one
      box. This is the same prompt box the home-screen item above
      describes; build it once. Legacy's web-search ladder
      (`webSearch.ts`: a local SearXNG metasearch sidecar first, keyless
      scrapers only as fallback) feeds the Priority-1 web search skill,
      with one caveat for that item: the local metasearch sidecar fits
      the "we are the user" rule, scraping Google from the hub's address
      does not.

      **Status, 2026-09-13 (lane 9 item 2), read against the real code,
      not assumed** (full writeup: docs/dev/session-b.md, "Lane 9 item
      2"). Searchable right now, through the shell's real command
      palette (Cmd/Ctrl+K everywhere, the Search row on phone and
      desktop; `far`'s own dedicated `/search` page): apps, the Apps
      library page, people, memories, real per-thread conversations by
      title, settings keys, and commands - six of the seven core
      providers this item names, one shared query
      (`shell/search/useSearchCommand.ts`) three surfaces call, "ask
      MaiPai" the first row always. Still waiting on the route: a
      package's own content (recipes, saved videos, whatever a future
      package's own tables hold) has no provider yet, because nothing
      fans out to installed packages - that needs a real backend route,
      `GET /api/search`, named for Session A with the exact response
      shape the frontend would consume in docs/dev/session-b.md so it
      can be built without a frontend redesign. The web-search skill as
      a fall-through row is not wired into the palette either (it
      answers today only by asking in chat, per docs/user/chat.md's own
      lane 8 item 3 section) - a second, smaller gap alongside the
      package route. Left unchecked until both land.
    Design: [shell-search-2026-09-23](plans/shell-search-2026-09-23.md)
- [ ] **ATT-01: Attachments in chat: a document, a photo, "summarize
      this"** (L, design and spec landed 2026-09-16). The design record
      is `docs/dev.md`'s "ATT-01: attachments" section and the shared
      record is `spec/schemas/attachment.schema.json`. What exists:
      nothing on the input side; K7 renders pictures the model found, not
      ones the person sent. The local record stores a per-person file
      below the household data directory, follows conversation retention,
      and carries turn provenance and an integrity digest. Apache Tika is
      the chosen Apache-2.0 local parser for PDF and office files;
      `host.ocr.read` stays RapidOCR for scans. A document outcome is
      chunked to the context budget and cited by page so "summarize this"
      and "what does page 3 say" share the lookup path. The vision engine
      remains open beside the GPU layout note. Child-derived content goes
      through the existing content ceiling, and the child band receives
      no sources, links or documents. Depends on COMP-01 for the long
      answer's home. The design pass itself adds no runtime behavior.

      - [x] **ATT-01a: attachment storage and retention** (mechanical,
            landed 2026-09-16). Added the local upload store and immutable
            `Attachment` persistence under the per-person household path,
            with normalized-path validation, size and SHA-256 verification,
            conversation-turn retention cleanup, and `host.data.forget`
            erasure that leaves other people's files alone. Exit:
            `backend/tests/attachments.test.ts` and
            `bash scripts/check.sh`.
      - [x] **ATT-01b: document extraction and OCR** (mechanical, landed
            2026-09-16). Added bounded local Apache Tika extraction for PDF
            and office files, with a checksum-pinned local JAR boundary, and
            the permission-gated RapidOCR path for scans. Unsupported,
            oversized and failed input returns safe typed errors without
            exposing upload bytes. Exit: `backend/tests/
            documentExtraction.test.ts` and `bash scripts/check.sh`.
      - [x] **ATT-01c: document outcome and composer path** (mechanical,
            landed 2026-09-16). Added the typed `document` artifact section,
            bounded retained page chunks, local page citations, page
            selection and same-subject evidence revisioning through the
            existing COMP-01 builder. Extracted prose stays in the retained
            outcome input, and child delivery does not expose the document.
            Exit: spec, turn-engine and composer tests, then
            `bash scripts/check.sh`.
      - [x] **ATT-01d: image attachment adapter and vision capability**
            (mechanical, with the engine decision kept explicit). Wire the
            assistant-ui `AttachmentAdapter` shape and local image record,
            mirroring `SimpleImageAttachmentAdapter`; gate image parts on
            the selected local engine capability and use RapidOCR only for
            scans. Acceptance: image chips preview and send locally,
            unsupported engines refuse with a safe message, and no cloud
            vision connection exists without a privacy row. The current
            selected text engine declares no image-part capability, so the
            completed local adapter path is covered for a future local
            vision role and the live chat path refuses before fetch. Exit:
            frontend adapter tests, capability tests and privacy check, then
            `bash scripts/check.sh`.
      - [x] **ATT-01e: child projection and landing gate** (mechanical).
            Apply the existing `effectiveBand` content ceiling to extracted
            and image-derived evidence before composition, mirroring
            `backend/src/lib/turnContext.ts` and COMP-01's child projection.
            Acceptance: child delivery has no sources, links or document,
            adult delivery preserves the same attachment evidence, forget
            and retention are end to end, and the attachment fixtures and
            screenshots pass. Exit: targeted child, retention and frontend
            tests, wait for other benches, then `bash scripts/check.sh` as
            the landing gate.
      - [ ] **ATT-01f: the extraction runtime** (S, decision first,
      2026-09-16). ATT-01b runs Apache Tika from a JAR named by
      `MAIPAI_TIKA_JAR`, which needs a Java runtime the hub neither
      ships nor downloads, so on a fresh household nothing can read a
      PDF. Decide between a pinned, checksummed on-demand Tika download
      plus a bundled JRE (the self-healing download pattern, heavy) and
      pure-JS parsers behind the same `TextRunner` seam (`pdfjs-dist` or
      `unpdf` for PDF, `mammoth` for docx, one small sheet reader),
      record the verdict in `docs/dev.md` under ATT-01, then implement
      the chosen one so `documentExtraction.ts` works with no env
      variable set. Exit: an extraction test on a real fixture PDF and
      `bash scripts/check.sh`.
- [ ] **SCREENSHOT-VERDICT-01: A vision-model verdict per screenshot** (L) - getmaipai/.github's
      docs/STYLE.md describes it: "every screenshot carries a declared
      expectation beside its capture script, and a vision-model check
      ... answers it and fails the build on a miss. The verdict is
      written into the screenshot's manifest." `scripts/screenshot.ts`
      now writes a manifest (capture script, viewport, theme, date,
      2026-09-13) but declares no per-route expectation and runs no
      vision check - a session still has to open and judge every image
      by hand (done every time so far, per CLAUDE.md's own rule, but
      the automated half described in STYLE.md doesn't exist). Needs a
      declared expectation string per `RouteSpec`, a vision-capable
      model call (the hub's own `vision` role per STYLE.md, or the dev
      machine's), and a verdict field added to `ManifestEntry`.

## From the reference screens review (2026-10-01)

Design record: [docs/dev/reference-screens-review-2026-10-01.md](dev/reference-screens-review-2026-10-01.md). Two reference screenshots (a desktop chat app and a local model workspace) read as four screens beside Home's own. Jesse's seven decisions are in the record. Work has started on SHELL-FOLD-01 and CHAT-WORDS-01.

- [ ] **CHAT-PROJECT-01: projects for a person's chats in the chat column (chat folders, distinct from PROJECTS-UI-01 assistant-layer projects; see that row for background project runs)** (M, spec first; Jesse's decision 1; split 2026-10-06 into PROJECTS-01a and PROJECTS-01b, architect APPROVED both). Objective: a person can make a project, move a chat in or out, rename and delete it; the column shows Pinned, then Projects (each a folder of its chats), then Recents grouped Today, Yesterday, Earlier, as COLUMN-01 landed it (the earlier "one plain Chats list, no date labels" wording is superseded by the landed column). Record: `ChatFolder` (`commons/spec/schemas/chat-folder.schema.json`, `folder-` ids, spec-v0.1.87) and `Conversation.folder_id`, named so it is never mistaken for the harness's `project` record; on screen the word is Projects, and background work is never labelled "project". Acceptance: a project is one person's own; an admin's person picker shows a child's projects (a teen's stay private); a temporary chat offers no project; deleting a project keeps its chats; opening and closing a project animates (reduced motion honoured); the demo household has two projects on "juniper"; desktop and phone screenshots opened and judged. Out of scope: memory or recall effects, sharing, the robot; instructions and files are PROJECTS-01c.
  - [x] **PROJECTS-01a: the record and Home's backend** (S-M, 2026-10-06). `chat_folders` table (migration 0090, schema version 47); `/api/chat-folders` list, create, rename or reorder, delete (zod-openapi); `folder_id` on `POST` and `PATCH /api/conversations` (both converted to zod-openapi) and on the list summary. An adult or teen manages their own; a child's are made, renamed and deleted by an owner or admin, and the child may move their own chats in and out; a teen's are private from admins. A temporary chat never joins one; a chat joins only its own person's live project. Deleting a project tombstones it and takes its chats out in one transaction; deleting a person removes their projects. Tests: `backend/tests/chatFolders.test.ts`, the people erasure test.
  - [x] **PROJECTS-01b: Projects in the chat column** (M, 2026-10-06). The kit's thread list gained an opt-in projects mode (commons ui-v0.5.121): a Projects section after Pinned of folder rows that open and close (keyboard too, no animation under reduced motion), their chats indented, Show more after 6, a "+" that makes one inline, Move to project and Remove from project on the chat menu, drag a chat onto a project, New chat in project, rename and delete inline (delete asks first, chats stay). A pinned chat shows once, under Pinned. The column's Customize row is gone (owner's ruling 2026-10-06; skills move to Chat settings, SKILLS-PAGE-01). Home passes data and copy only (`frontend/src/apps/chat/chatProjects.ts`); project rows match chat rows through kit tokens. A child sees a parent's projects without make, rename or delete; Incognito shows none. Screenshots: `bun run scripts/screenshot.ts --chat-projects-review` (the demo's two projects sit on the owner, Sage: "juniper" is a pet in the demo household, not a person). Still open under the parent: an admin's person picker showing a child's projects.
  - [x] **PROJECTS-P1: project fields, listing, sharing and the API** (M, 2026-10-06; architect APPROVED, `data-scratch/architect/PROJECTS-P1.verdict`; projects parity part 1, `data-scratch/design/PROJECTS-PARITY-DESIGN.md`). Spec-v0.1.90: `ChatFolder` gains `color` (nine kit hue names), `icon` (`vocab/project-icons.json`), `description` (500, never sent to the model), `instructions` (1500), `pinned` and `pinned_at`, `archived_at`, `memory_mode` (`shared` or `project_only`; a new project is `project_only`, older rows read `shared`) and `shares` (`{person, role}`, role `can_use` or `can_edit`); `MemoryRecord.folder_id` (field only). Home: migration 0092 (columns plus `chat_folder_shares`); `GET /api/chat-folders` with `q`, `archived`, `scope` (mine, shared, all) and `sort` (order, updated), pinned first; `GET /api/chat-folders/{id}` with counts; `PATCH` edits every field (rename, look, notes, pin, archive, memory mode); `PUT` and `DELETE /api/chat-folders/{id}/shares/{person}`; delete returns `files_removed` 0. Every response is the spec record plus `access` (manage, edit, use), `last_activity_at` and `counts`. Shares are record-only (a member never gains the owner's chats or memory; a chat still joins only its own person's project) and `memory_mode` is stored only, so nothing may claim project memory isolation until the recall slice (PARITY P7) lands. A teen's project is private from admins and reaches one only through the teen's own share; a child's project is parent-managed; only an owner or admin adds a child as a member; a minor owner's or editor's description and instructions pass the safety floor on save. Tests: `backend/tests/chatFolderProjects.test.ts`, `chatFolders.test.ts`, the people erasure test.
  - [ ] **PROJECTS-01c: a project's own instructions and files** (M, spec first; architect APPROVED 2026-10-06 with conditions in `data-scratch/architect/PROJECTS-01c.verdict`). Optional `ChatFolder.instructions` (one string, at most 1500 characters, capped in the spec and the route) and a project-to-file link (`ChatFolder.file_ids` or a link record, never a field on the immutable File; the file's owner is the project's person; deleting a file or a person cleans up). Instructions pass the output floor on save; a child's are set by a parent or none. Reaching the prompt is its own Chat-turn ruling: after CHAT-CUSTOMIZE-01b, the same stable-prefix builder, counted in the window's reserve, never replacing the companion voice (rule 14) or outranking the gates (rule 0), the input floor for a minor. Files reach the model only through RETRIEVAL-01's document-passages collection (depends on it). Inline edit is a kit prop first (rule 9 (c)); Incognito offers none. Exit: `bash scripts/check.sh` in commons and Home, and a CHAT-AB-01 cache row.
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **DOC-BLOCKS-01: the typed blocks of a designed document** (M, spec first, in `commons`; after CHAT-PARITY-06's design pass names the set). Objective: a closed block vocabulary (title, label line, tags, text, picture grid, summary box, fact table, steps, sources) as a spec schema with round-trip fixtures, as a new artifact kind beside `markdown`, `code` and `html`. Pointers: `commons/spec/schemas/artifact.schema.json`, `turn-artifact.schema.json` (its `card`, `procedure` and `comparison` sections are the precedent). Mirror: the project step vocabulary in `project.schema.json`. Acceptance: fixtures use made-up content and roster names only; a block the schema does not name is refused. Out of scope: any renderer, any tool. Exit: commons `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **DOC-RENDER-01: draw a designed document from its blocks, and print it** (M, after DOC-BLOCKS-01 and CANVAS-READ-01). Objective: the pane draws each block with its shipped part, and Download saves a PDF of the same page. Pointers: the kit's `card.tsx`, `badge.tsx`, `image.tsx`, `spec-sheet.tsx`, `sources.tsx`; the pane in `ChatPage.tsx`; the tool the model calls to write a document (`write_document`). Mirror: how a `TurnArtifact` card section is drawn today. Acceptance: no hand-built component; both looks and both themes; one column on a phone; every picture passed the output gate and loads from the hub; the saved PDF matches the page; the demo page screenshot opened and judged against the reference for hierarchy and spacing, not copied. Out of scope: editing blocks by hand, HTML preview. Exit: `bash scripts/check.sh` plus the screenshots.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **PANE-FILE-01: PDFs and pictures in the pane** (M, after CHAT-PARITY-06's amended design pass). Objective: a produced PDF or picture opens in the same pane a document does. Pointers: `frontend/src/shell/pages/ChatPage.tsx` (the canvas panel and its sheet), the kit's `canvas-split.tsx`, `image.tsx`, `file.tsx`, `backend/src/routes/artifacts.ts`. Mirror: the existing document path through `ArtifactCanvasPanel`. Acceptance: the item starts by reading how a project's assembled file is stored and whether it is listed in Library, and records the answer; on a wide screen a PDF shows in the browser's own viewer and a picture shows whole; on a phone the sheet shows the card and Open; Download and Show in Library work from the header's menu; a child sees only files from their own turns that passed the safety check; no PDF library is added. Out of scope: editing a file, HTML preview, versions of a PDF. Exit: `bash scripts/check.sh` plus screenshots at both widths.
- [ ] **FILE-DELETE-01: delete a produced file** (S, after a produced-file deletion rule and route exist). Objective: let a person delete a produced artifact from its file menu after confirmation, following the artifact's own ownership and retention rule. Pointers: `backend/src/routes/artifacts.ts`, `backend/src/lib/artifacts.ts`, `ChatPage.tsx` (`ProducedArtifactCard`). Acceptance: the rule is recorded; the existing route or rule is reused; confirmation precedes the delete call; the menu entry is keyboard reachable and covered by a test. Out of scope: adding a route before the deletion rule is chosen.
- [ ] **HOME-ALIVE-01b: one admin strip in place of the Updates and Repairs cards** (S). Objective: owners and admins always see the one-line strip (decision 1 of 2026-10-02) with Repairs and Updates as its links; System status stays in the profile menu (rule S2; amended 2026-10-17 by `docs/design/home-page-2026-10-17.md`); Running now and Needs you are ACTIVITY-01e. Members see neither card. Exit: `bash scripts/check.sh`.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-ALIVE-01c: "Pick up where you left off"** (S). Objective: the last three of your own chats, linking to `/chat?conversation=<id>`, replace the activity table. Pointers: `RecentActivityTable.tsx`, `GET /api/conversations`, `shell/search/providers.ts:75` for the link shape. Mirror: the search provider's conversation rows. Acceptance: hidden with no chats; an admin sees only their own chats here; test plus capture. Out of scope: chat titles (CHAT-TITLE-01). Exit: `bash scripts/check.sh`.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-ALIVE-01d: "Your family"** (S). Objective: avatars and names replace the People count; no activity line for anyone (NO-CROSS-USER-VISIBILITY-01, rule 6a; amended 2026-10-17 by `docs/design/home-page-2026-10-17.md`). Pointers: `PeopleCountCard.tsx`, `GET /api/people`, `recent_activity`. Mirror: `FamilyPage.tsx`'s avatar rows. Acceptance: a teen or adult never has an activity line; a child viewer sees names only; "Just you so far." with "Add someone" (admins) when alone; tests per role. Out of scope: who is home (no presence data exists). Exit: `bash scripts/check.sh`.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-ALIVE-01e: "Today" from package widgets** (S; first form built 2026-10-17, up to four cards from `GET /api/widgets`, the rest behind "More"; ordering, hero and hide follow in HOME-PAGE-02 and 04). Objective: one card per widget from `GET /api/widgets`. Pointers: `routes/widgets.ts`, `lib/api.ts:898-909`, `lib/widgets.ts:68`. Mirror: `FilesPage.tsx` for `Card` plus a query. Acceptance: honours each widget's `refresh_s`; a failed widget drops out quietly; a child sees only what `min_role` allows; capture with the seeded packages. Out of scope: choosing or ordering widgets. Exit: `bash scripts/check.sh`.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-ALIVE-01f: "Recently made"** (S). Objective: your last four Library items with "See Library". Pointers: `GET /api/files`, `FilesPage.tsx`. Mirror: 01c's block. Acceptance: hidden with no files; opens the item in Library; test. Out of scope: thumbnails. Exit: `bash scripts/check.sh`.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-ALIVE-01g: "Getting started" for a new household** (M; first form built 2026-10-17 from the setup checklist; the other steps follow). Objective: the steps in section 5, ticked from existing data, gone when all are done. Pointers: the four reads in section 5, `SetupWizard.tsx:396` (whose "Check Health" line points at the old page and is reworded to "Ask MaiPai something from Home"). Mirror: 01c for the query pattern. Acceptance: per-role step lists match section 3; a capture of a demo person with no history (a roster name such as "sprout", added to the seed if none exists) shows no zero anywhere; tests per step; each area has mark done and skip, a link to its Setup page, and ticks derived from real records; card hiding is per person; the Telegram step says what leaves the house; a child never sees the Setup page. Out of scope: storing a dismissed state. Exit: `bash scripts/check.sh`.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-ALIVE-01h: ask from Home** (M; box, starters and the `?ask=` hand-off built 2026-10-17, capture still owed). Objective: the ask box and three starters open Chat with the words in the composer. Pointers: `ChatPage.tsx:1441` (where `?conversation=` is read), `chatSuggestionAdapter.ts`, `composer-runtime.d.ts:70`. Mirror: the `?conversation=` handoff. Acceptance: text arrives unsent and editable; a child lands in their restricted chat; temporary chat state unchanged; works on a phone; capture. Out of scope: sending automatically. Exit: `bash scripts/check.sh`. Amended 2026-10-17 by `docs/design/home-page-2026-10-17.md` section 6: the box is the kit `InputGroup` with a `Button`, the three starters are kit `Button`s (rule 9b, no chat Element on a non-chat surface), and the box's placeholder reads the install strip's own line while the engine installs.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-PAGE-01: the five home-placement fields on a widget, and the hidden list key** (S, spec first, lands in `getmaipai/commons`, after APP-KIND-01 so `contributes.data[]` exists for the `data` field; design `docs/design/home-page-2026-10-17.md` section 7 and 9; Jesse, 2026-10-17: "we need to revamp our home page, it's terrible"). Objective: `contributes.widgets[]` in `commons/spec/schemas/manifest.schema.json` gains optional `min_role` (folds in HOME-ALIVE-01e0), `priority` (0 to 100, default 50), `hero` (boolean), `data` (id of a `contributes.data[]` entry from the app-kind note) and `surfaces` (list of `home`, `tv`, `robot`, default `["home"]`); `commons/spec/settings/keys.json` gains `ui.home_hidden` (person scope, selector `text` holding a JSON list, level `expert`, `lives_in: profile.appearance`, label "Hidden from Home (advanced)", help in spec copy) beside `ui.pinned_apps` and shaped like it. Mirror: the `widgets` block at `manifest.schema.json:392` and the `ui.pinned_apps` key at `keys.json:1808`. Reuse check: additive fields on the existing widget contract, never a second slot or record type. Acceptance: the ajv test accepts a widget with none of the new fields and one with all five, and rejects `priority: 101`, an unknown surface and a `data` id the manifest does not declare; a tag is cut and Home's pin bumped (`docs/PINNING.md`). Out of scope: any Home code. Exit: commons `bash scripts/check.sh`, then Home `bash scripts/check.sh --pre`.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-PAGE-02: the hub orders Home cards per person and surface, and the dashboard shows only the viewer's own activity** (S, after HOME-PAGE-01; design section 7 and 3). Objective: one function `orderHomeCards(widgets, person, surface)` in `backend/src/lib/widgets.ts` filters by package `min_role`, widget `min_role`, enabled status, `surfaces` and Incognito, picks the one hero (highest `priority` among `hero: true`), sorts the rest by `priority`, install time then `id`, applies the person's `ui.home_hidden` and returns the hero, the first four and the rest; `GET /api/widgets` returns the new fields and `surface` query; `visibleTargetIds()` in `backend/src/lib/dashboard.ts` returns only the viewer (NO-CROSS-USER-VISIBILITY-01, rule 6a). Mirror: `listWidgets()` and `meetsMinRole`. Reuse check: the existing list route and cache; no new store. Acceptance: tests per role (owner, admin, adult, teen, child, guest) and band prove a child never receives a `min_role: adult` widget, a `tv` surface receives no widget whose `inputs` name a person, a hidden hero falls back to the next, ties are stable, and an admin's dashboard carries no child's row. Out of scope: the page. Exit: `bash scripts/check.sh` (risky surface: wire shapes).
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-PAGE-03: the Home page as designed, three web breakpoints** (M; Jesse resolved the three open questions 2026-10-17: option C, Ask above Today, four cards and six blocks before "More"; partly built, see the first-slice section of the note; after HOME-PAGE-02 and HOME-ALIVE-01b, 01c, 01d, 01e, 01g, 01h; design section 6 and 8). Objective: `frontend/src/shell/pages/DashboardPage.tsx` composes greeting, admin strip, Ask, hero, Pick up where you left off, Today (four cards plus a "More" `Collapsible`), Your family and Getting started in that order, from `orderHomeCards` and the existing reads, laid out per section 8 at phone, tablet and desktop, with skeletons on first paint and no block shown empty; the "9 things left" sentence and `StatCard.tsx`, `UpdatesCard.tsx` and `recentActivityEvents.ts` are deleted with their tests re-pointed. Pointers: `DashboardPage.tsx`, `dashboard/`, `useDashboard.ts`, `useSetupChecklist.ts`, `InstallStrip.tsx` (the placeholder line), `scripts/screenshot.ts:403` (the `home` capture). Mirror: `FamilyPage.tsx` for avatars; the Ask box is `InputGroup` with `Button` as HOME-ALIVE-01 section 6 names it. Reuse check: every block is a kit part named in design section 10; hand-built code is the grid containers only. Acceptance: captures at 390, 744 and 1440 in both themes opened and judged, no row a lone card at 1440x900; `lint:ui-rules` shows no new override or wrapper; tests per role for the block list (a child sees no admin strip or management links, a guest sees greeting, Ask and Today only); the engine-installing placeholder shown with a mocked `installStatus`; the rail test (S3) still green. Out of scope: TV (Go renders the same list when it exists), reorder, household defaults. Exit: `bash scripts/check.sh` plus the captures.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)
- [ ] **HOME-PAGE-04: hide a card from Home** (S, after HOME-PAGE-03; design section 9). Objective: every Today card and the Pick up and Your family shelves carry the kit `DropdownMenu` in the `Card`'s existing `CardAction` slot with one entry "Hide from Home" writing `ui.home_hidden` through the settings route (the `usePinnedApps` pattern, with rollback on failure); the key is drawn under Account, Appearance by the generic settings renderer exactly as `ui.pinned_apps` is (rule S4, no Home layout); a per-row "Show again" waits for a `list` selector in the settings key schema. Mirror: `frontend/src/shell/usePinnedApps.ts`. Reuse check: one person setting, the existing `CardAction` slot and `DropdownMenu`, the generic renderer, no page or part of its own. Acceptance: hiding removes the card at once and survives reload; a hidden hero falls back to the next; a child can hide and never sees more; Incognito writes nothing; `lint:ui-rules` shows no new override or wrapper; tests plus a capture of the settings row. Out of scope: reorder (`ui.home_order`), admin household defaults, choosing the hero. Exit: `bash scripts/check.sh`.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)

## From the ODS review (2026-10-01)

What ODS does, what we take, change and refuse, and why: [docs/dev/ods-review-2026-10-01.md](dev/ods-review-2026-10-01.md). Jesse's calls of 2026-10-01: the starter model is approved; the Linux image, the bill of materials and the erase action are backlogged; running the assembled Open WebUI stack as a yardstick is declined. An item that lands in another repo says so, in the way DATA-LOCATION-00d does. The first seven are next, because they get the core and its dependencies running; the rest are later.

### Next

- [ ] **SETUP-START-01: chat within minutes on a starter model** (M, Sonnet; after STACK-START-01; approved by Jesse 2026-10-01). Objective: the wizard downloads the floor profile's chat model first, opens chat, shows a banner with the full model's progress in plain words, and the swap is announced as a short pause. Files: the wizard routes and screens (`frontend/src/shell/`), the banner from the template's alert as shipped. Mirror: ENGINE-AVAIL-01's derived state. Acceptance: on an empty data directory with a throttled download, a message is answered before the full model finishes; the banner names the starter and the percent; after the swap the banner is gone and a draft typed during the swap is still in the composer; a failed full download leaves chat working and raises one Repairs item. Out of scope: choosing models (SETUP-SIZE-01). Exit: `bash scripts/check.sh`.
    Design: [install-wizard-2026-10-13](plans/install-wizard-2026-10-13.md)
- [ ] **STACK-START-01: start on the floor model, swap when the chosen one lands** (M, Sonnet; lands in `getmaipai/stack`, area "Supervisor and engines"; approved by Jesse 2026-10-01). Objective: given a chosen chat model that is not yet downloaded, the Stack serves the floor profile's model, downloads the chosen one, and swaps through the existing drain and identity check, reporting each phase on the event feed. Files: `stack/backend/src/` supervisor and updates. Mirror: the update apply path's drain and rollback. Acceptance: with a throttled download a request is answered by the floor model; after the swap the chosen model answers; a failed download or failed identity check leaves the floor model serving with one health item. Out of scope: Home's banner. Exit: `scripts/check.sh` in `stack`.
- [ ] **INSTALL-PREFLIGHT-01: one preflight list for the installer and the wizard** (M, Sonnet; after DATA-LOCATION-01f). Objective: disk, memory, system version, a running instance (the lock file), a busy port and reach to the release host are returned as health-item-shaped rows with a severity and one fix, from one function the install scripts and the wizard both call. Files: `backend/src/lib/` beside `checkPlacement`, `scripts/install.sh`, `scripts/install.ps1`. Mirror: `commons/spec/schemas/health-item.schema.json`. Acceptance: each check has a fixture for pass, warning and blocker; a blocker stops the install with its fix; no check stops another program; `install.sh --check` prints the list and changes nothing. Out of scope: GPU driver installation. Exit: `bash scripts/check.sh`.
    Design: [install-wizard-2026-10-13](plans/install-wizard-2026-10-13.md)
- [ ] **INSTALL-RESUME-01: an install killed at any step finishes on the next run** (M, Sonnet). Objective: a test kills the installer after each step and proves a re-run completes, keeps the data directory, resumes a partial download and re-verifies its checksum. Files: `scripts/install.sh`, a test under `backend/tests/` using a temp prefix. Mirror: DATA-LOCATION-02b. Acceptance: one case per step, all green; the re-run's output says what it kept. Out of scope: Windows. Exit: `bash scripts/check.sh`.
- [ ] **INSTALL-SIM-01: the installer runs in the gate, in a throwaway home** (M, Sonnet). Objective: `scripts/install.sh --prefix <temp> --no-service` installs a release artifact into a temp directory, boots it headless, answers a health check and uninstalls, on macOS directly and on Linux in a container; both the script path and any app-bundle path read one step list. Files: `scripts/install.sh`, `scripts/check.sh` (full scope only), a new `scripts/install-sim.sh`. Mirror: the release skill's clean-clone build. Acceptance: the simulation passes from a clean clone; it changes nothing outside its temp directory (checked by a before and after listing); `install.sh` stays under 600 lines. Out of scope: registering a real service on the dev machine (held with the real install plan). Exit: `bash scripts/check.sh`.
- [ ] **ENGINE-CANARY-01: engine pins re-prove themselves** (M, Sonnet for the design note, Codex for the runs; lands in `getmaipai/stack`, area "Health, readiness and updates"). Objective: a scheduled local job takes the newest upstream build of each engine, installs it into a scratch data directory, runs the engine contract tests, STACK-SIZE-GOLDEN-01 and a short replay set, and writes a report with a proposed pin bump or the failing check; nothing changes a pin without a person's approval. Files: `stack/scripts/`, the Catalog's engine index tooling, a report under `data-scratch/reports/`. Mirror: STUDIO-EVAL-01's chain. Acceptance: a run against a known-good newer build proposes the bump with its evidence; a run against a build with a seeded contract failure refuses and names the test; the job touches nothing outside its scratch directory and never runs beside a time-measuring bench. Out of scope: applying the bump, and models (a second item once this one is in use). Exit: `scripts/check.sh` in `stack`.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **STACK-SIZE-GOLDEN-01: a pinned table of machines and proposals** (M, Codex at raised reasoning; lands in `getmaipai/stack`, area "Governor and sizing"). Objective: a fixture of hardware envelopes (the floor, the three tiers, and the common laptops between them) with the proposal each must receive; the test fails on any change, and the fixture's header says a change needs a measurement. Files: `stack/backend/tests/`, a fixture file. Mirror: the fit plan's parity test. Acceptance: every row's proposal fits by the Stack's own rule; changing a constant without updating the table fails. Out of scope: new measurements (SIZER-BENCH-01). Exit: `scripts/check.sh` in `stack`.
    Design: [hardware-tiers-2026-09-23](plans/hardware-tiers-2026-09-23.md)

### Later

- [ ] **DIAG-REPORT-01: a diagnostics report an admin can save** (M, Sonnet). Objective: a button on the status page for owners and admins builds a zip with the health list, versions, the hardware probe and the last log lines, shows its contents first, and saves it locally; it never includes conversations, memories, people or secrets and is never sent anywhere. Files: `backend/src/routes/` (a new OpenAPI route), `@maipai/core`'s zip writer, the status page. Mirror: the Stack's diagnostics bundle. Acceptance: a redaction test seeds a secret, a person's name and a chat line and proves none is in the zip; a child or member cannot call the route; the page lists every file before saving. Out of scope: uploading, and the bug template's wording (a follow-up in `.github`). Exit: `bash scripts/check.sh`.
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)
- [ ] **APP-STATE-01: one list of package states, shown in words** (S in `getmaipai/commons` first, then M in Home; after STATUS-SVC-01). Objective: the spec declares the states a package can be in (ready, needs setup, starting, needs another package, will not run on this computer, update ready, has a problem, beta), and every app card and menu item shows the state with one sentence and one action, never in a tooltip alone. Files: `commons/spec/` (schema, fixtures, tag), Home's apps page and sidebar badge from shipped components. Mirror: `status-component.schema.json`. Acceptance: one fixture per state; a capture at 1440 and 390 shows the reason as visible text; the three pages that list packages use the same words. Out of scope: outside-service health (STATUS-SVC-03). Exit: commons then Home `bash scripts/check.sh`.
    Design: [packages-apps-and-integrations-2026-10-17](design/packages-apps-and-integrations-2026-10-17.md)
- [ ] **BACKUP-GATE-01: no backup, no update; and a preview before restore** (S, Codex). Objective: an update stops when its pre-update backup fails, and a restore shows what it will replace and asks for a typed confirmation. Files: `.github/docs/UPDATES.md`, `.github/docs/BACKUPS.md`, `backend/src/lib/backup.ts`, the updates apply path. Mirror: the existing restore route. Acceptance: a test forces the backup to fail and proves the update did not start; the restore route has a preview response and refuses without the confirmation. Out of scope: per-person restore. Exit: `bash scripts/check.sh`.
- [ ] **PRIVACY-SWITCH-01: every outbound switch is proven** (S, Sonnet). Objective: for each setting that turns an outbound call off (update checks first), a test runs the relevant code with the switch off against a stub that fails on any request. Files: `backend/tests/`, the update checker. Mirror: the privacy table's row list as the inventory. Acceptance: the commit lists every switch and its test; turning a switch's reader off makes its test fail. Out of scope: new switches. Exit: `bash scripts/check.sh`. Row-Bot acceptance: each `/status` health check says in one sentence whether it contacts providers or the internet; on-device checks say they make no network requests; the character badge and Needs-you count read stored state and never probe.
- [ ] **DOCS-FACTS-01: install facts come from one place** (M, Sonnet). Objective: the install command, minimum disk and memory, supported systems and "what you need" are declared once beside the installer and written into the README and the getting-started page by a script; the docs gate fails when a page states a different value. Files: `scripts/`, `README.md`, `docs/user/getting-started.md`, `scripts/check.sh --docs`. Mirror: the generated settings reference. Acceptance: changing the declared minimum changes both pages on regeneration; a hand edit fails the gate. Out of scope: screenshots. Exit: `bash scripts/check.sh --docs`.
- [ ] **DOCS-INDEX-01: an index of the design notes, each with a status** (S, Codex). Objective: every file in `docs/plans` and `docs/dev` carries a `Status:` line (current, superseded by a named file, historical) and a generated `docs/plans/README.md` lists them by area with date and status. Files: `docs/plans/*.md`, a script under `scripts/`, STYLE.md tier 2. Mirror: the Stack's generated components inventory. Acceptance: the index regenerates with no diff; a note without a status fails the docs gate. Out of scope: rewriting any note. Exit: `bash scripts/check.sh --docs`.
- [ ] **SUPPORT-MATRIX-01: what we can honestly say runs** (S doc, then S in the release skill in `getmaipai/.github`; Sonnet). Objective: `docs/dev/support.md` lists each platform with its state, evidence and date, plus the battle-tested checklist; the release skill fails when the README status line or a user page claims a platform the matrix does not mark verified, or when version strings disagree. Files: `docs/dev/support.md`, `.github/plugin/skills/release/`. Mirror: hardware-tiers-2026-09-23.md for the rows. Acceptance: a fixture README claiming an unverified platform fails the check. Out of scope: running new hardware tests. Exit: `bash scripts/check.sh --docs` and the skill's own test.
- [ ] **PKG-FOOTPRINT-01: a package says how big it is** (S, Codex; lands in `getmaipai/commons` spec first, then the `getmaipai/catalog` lint). Objective: the manifest gains `footprint` (download bytes, installed bytes), required for every kind that ships or fetches files, and `settings-key` requires a plain `pattern_help` whenever a pattern is declared. Files: `commons/spec/schemas/manifest.schema.json`, `settings-key.schema.json`, fixtures, the catalog's lint. Mirror: `knowledge_source.flavours[].approx_bytes`. Acceptance: fixtures round-trip in both interpreters; the lint fails a package with files and no footprint. Out of scope: showing it in Home (the wizard item). Exit: commons `scripts/check.sh`, then catalog `scripts/check.sh`.
- [ ] **PKG-BACKUP-DECL-01: a package with data must choose a backup mode** (S, Codex; lands in `getmaipai/catalog`). Objective: the catalog lint fails a manifest that declares persistent state without `backup`. Files: the catalog's lint, PACKAGES.md definition of done. Mirror: the outputs shape check in PACKAGES.md. Acceptance: one failing and one passing fixture. Out of scope: Home's file set (DATA-LOCATION-06). Exit: catalog `scripts/check.sh`.
- [ ] **VENDOR-UPDATE-01: updating a vendored UI source is one command** (S, Codex; lands in `getmaipai/commons`, `ui`). Objective: one script per vendored source fetches the named upstream commit, reapplies the recorded strip list, and leaves a diff to read, so the monthly merge is never done by hand. Files: `commons/ui/scripts/`, `commons/ui/docs/dashboard-upstream.md`. Mirror: the strip list already recorded in the upstream note. Acceptance: running the script at the currently pinned commit produces no diff; running it at a newer commit produces a diff and updates the pin note. Out of scope: resolving what the new version breaks. Exit: commons `scripts/check.sh`.
- [ ] **UI-COPY-01: five wording rules, written down** (S, docs only, Codex; lands in `getmaipai/.github`). Also corrects the engine row of the UPDATES.md table to match the Stack paragraph below it. Objective: ENGINEERING.md and UI.md gain: a failure message names the step, the cause when known, the next action and what was left untouched; unknown is never shown as zero; a chart draws measured data only; a state is said in visible words, never by hover alone; a manifest never declares a port or a shell hook. Files: `.github/docs/ENGINEERING.md`, `UI.md`, `PACKAGES.md`, `SERVICES.md`, `UPDATES.md`. Mirror: UI.md's "in one rule" paragraphs. Acceptance: the five rules exist once each with a good and a bad example in our own words. Out of scope: lint for them. Exit: `standards/bin/check-core.sh`. Row-Bot acceptance: translate enum values to words; show relative times with full date on hover; saved secret copy is "Key saved · ····c99 · in keychain · Replace" with at most a short masked suffix and only for its owner or an admin; context copy reads “about 32,000 tokens, roughly 100 pages”.
- [ ] **STD-REPO-01: four repo checks in the standards core** (S, Codex; lands in `getmaipai/.github`). Objective: `check-core.sh` gains a large-file cap (500 KB outside an allowlist), a `.gitattributes` presence and content check (LF for shell, CRLF for PowerShell), secret-file patterns required in `.gitignore`, a gitleaks self-test with never-issued markers, and shellcheck on shipped scripts. Files: `.github/standards/bin/`, each repo's `.gitattributes` and `.gitignore`. Mirror: `prose-lint.test.sh`. Acceptance: each check has a failing fixture; every repo passes after its files are added. Out of scope: a pre-commit framework. Exit: `standards/bin/check-core.sh` in each repo.
- [ ] **STD-LINKS-01: no broken links in any Markdown file** (S, Codex; lands in `getmaipai/.github`). Objective: a relative-link and anchor check over tracked Markdown, with no baseline of tolerated failures. Files: `.github/standards/bin/`. Mirror: `prose-lint.sh`. Acceptance: a fixture with a broken link and a broken anchor fails; every repo passes. Out of scope: external URLs. Exit: `standards/bin/check-core.sh`.
- [ ] **STD-RETIRED-01: retired names stay retired** (S, Codex; lands in `getmaipai/.github`). Objective: the prose lint fails on a list of retired product and feature names outside changelogs and dated records. Files: `.github/standards/bin/prose-lint.awk`, a word list. Mirror: the banned-vocabulary list. Acceptance: a fixture using a retired name fails; changelogs and files with a `Status: historical` line are exempt. Out of scope: code identifiers. Exit: `standards/bin/check-core.sh`.
- [ ] **HOME-IMAGE-01: Home as a container image for Linux, a second labelled delivery** (M, design note first; backlogged by Jesse 2026-10-01, native stays the main path). Objective: the same release artifact packaged as an image that runs the same daemon, labelled as the path for people who already run containers; used first for our own clean-machine install test, published only after the native installer is proven on all three systems. Files: a new `scripts/image/`, SERVICES.md "The three pieces". Mirror: INSTALL-SIM-01's Linux run. Acceptance: the image boots, answers health and keeps its data on a mounted folder across a restart. Out of scope: engines inside the image, and any container on a Mac. Exit: `bash scripts/check.sh`.
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)
- [ ] **RELEASE-SBOM-01: a bill of materials on each Home release** (S; backlogged by Jesse 2026-10-01; lands in the release skill in `getmaipai/.github`). Objective: the release skill writes a list of every dependency in the release and attaches it as a release asset beside the checksums. Files: `.github/plugin/skills/release/`. Mirror: the existing checksum step. Acceptance: a dry-run release produces the file and it lists the lockfile's packages. Out of scope: provenance attestation. Exit: the skill's own test.
- [ ] **ERASE-HUB-01: an owner can erase this hub** (S, design note first; backlogged by Jesse 2026-10-01). Objective: a separate action under Settings, owner only, with a typed confirmation, that deletes every household record and file on this machine and says what it removed; uninstall keeps data as today. Files: a new route under `backend/src/routes/`, the Settings page from shipped components. Mirror: PACKAGES.md's confirmation wording. Acceptance: after the action a fresh start shows the first-run wizard and the data directory holds no household record; an admin who is not the owner is refused. Out of scope: off-machine backups, which the confirmation names as not touched. Exit: `bash scripts/check.sh`.
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)

Amendments to items filed elsewhere in this file, to apply when each is next picked up: ENGINE-AVAIL-02 gains "the draft is kept and the composer says so" and the model-switch state; HOME-FIT-02 gains "a model that is not recommended here says why in one sentence"; STUDIO-RUNBOOK-01 gains the LaunchAgent versus LaunchDaemon measurement; "The first-run wizard, end to end" gains measured time per step and package sizes.

## Household storage (2026-09-23)

- [ ] **PEOPLE-01: the People section as a household browser, pets included, profiles like a creator page** (L, design pass first; owner's ask 2026-09-23). Objective: the People section lists every household member including pets, browsed the way a short-video app browses creators (a grid of cards with picture and name, tap to open), and a member's profile reads like a creator page: their picture, a description in their own words or a parent's, and the images and videos they have shared (the household store's share pointers from `docs/plans/household-storage-2026-09-23.md`, so a profile shows only what its owner shared with the viewer or the household, never the owner's private files), with the existing person settings behind an edit action rather than on the page. Design questions for the record before any row is chunked: the terminology, decided once (Settings calls them "users" today; the owner's framing 2026-09-23: an account is the login of a specific person, and the People section is wider than accounts: the household's members, its pets, and the people the hub knows without an account, the delivery driver a camera recognises, a neighbour, a grandparent who never logs in); how the people without accounts are managed (remove, merge two records the hub thought were different, rename, forget everything about someone) and where that lives, the People section itself or Settings; whether a pet is a Person with a kind or its own spec record (the spec's Entity kinds already carry pets; decide which the profile reads and how consent and settings apply to a pet's page), what a child sees on an adult's page, what the page shows before anyone has shared anything, and how the shadcndashboard profile page (used as it ships) composes with the kit's media grid so nothing is hand-built. Files: `frontend/src/shell/pages/` (the People page), the profile page from the vendored dashboard, the storage rows STORE-SHARE-01 and STORE-PAGE-01 this depends on. Mirror: the dashboard's profile page and card grid. Acceptance (after the design pass chunks it): the People page shows a seeded household with a pet as cards, opening a card shows the picture, the description and a grid of that member's shared images and videos, a child's view hides what was not shared with them, captured at 1440 and 390 light and dark. Out of scope until the storage rows land: uploads and sharing themselves. Exit: the design record, then per-row `bash scripts/check.sh`. **Design verdict (Fable, 2026-09-26, dev.md "Design pass over the reserved items"): the flip trigger is met and no longer holds this back; the item is phased. Phase one is account holders only (the grid, the profile page from the vendored dashboard profile plus the kit media grid, manage actions, the child-view rule; prerequisites STORE-SHARE-01/STORE-PAGE-01 for the media grid). Pets and known people stay PEOPLE-EXPAND-01's design pass, per Jesse's 2026-09-25 ruling. The phase-one design pass is startable now.** **Phase-one design pass done (2026-09-26): `docs/plans/people-profile-2026-09-26.md` - the creator grid, the profile page's header card and shared-media grid, bounded customization (bio, photo opt-in, a named accent set), chunked into PEOPLE-SPEC-01/PEOPLE-GRID-01/PEOPLE-PROFILE-01/MEDIA-GRID-01/PEOPLE-PROFILE-02/AVATAR-RENDER-01/NOTIFY-SHARE-01/NOTIFY-SHARE-02. No subscribe concept (Jesse 2026-09-26, revised): a share notifies its recipient(s) by default through the existing declared-notification system (two new types reusing the existing `person`/`household` audiences), muted per type or per sender in Settings -> Notifications, nothing new to opt into. Three questions still await Jesse's ruling before rows are picked up (child photo consent, where display-name editing lives, sequencing against STORE-SHARE-01/STORE-PAGE-01).** **Phase one shipped (2026-09-27):** every phase-one row is done - `PEOPLE-SPEC-01`/`MEDIA-GRID-01`/`AVATAR-RENDER-01` in `commons`, `PEOPLE-GRID-01`/`PEOPLE-PROFILE-01`/`NOTIFY-SHARE-01`/`PEOPLE-PROFILE-02` here - so the account-holder creator page (grid, header card, Edit dialog, shared-media grid, share notifications) is real end to end; still unchecked because pets and known people without accounts (`PEOPLE-EXPAND-01`) are their own design pass, not started, and this row's own acceptance covers both.
    Design: [people-profile-2026-09-26](plans/people-profile-2026-09-26.md)
- [ ] **SHARE-LINK-02: the link route, the token and the owner's controls** (M, Sonnet; after SHARE-LINK-01 in commons; the design is `docs/plans/external-sharing-2026-09-23.md`). Objective: the one public route as its own mount (no session, no cookie, nothing else reachable), the token hashed with the pepper like a device token and looked up in constant time, an identical not-found for wrong, expired and revoked tokens, expiry and the download limit, revoke as one action, the view log for the owner, a per-address rate limit; the record API refuses `kind: "link"` without `home.public_url` set and for a child, and creating a link is a consequential action with a real confirmation. Files: a new `backend/src/routes/link.ts`, `backend/src/lib/deviceTokens.ts` (the token pattern to mirror), `trustProxy.ts`, `packageHost.ts` (the record API), `secret.ts`. Mirror: the device-token flow and CREDENTIALS.md (scoped, expiring, revocable, never logged). Acceptance, in these exact words: an adult links their own picture and the link opens the file from outside through the proxy; a link created without an expiry choice expires 30 days later and "no expiry" at creation does not; an adult's request to link a file another adult shared with them is refused, and an adult's request to link a child's file shared with them succeeds and is logged as a parental action; the same token after revoke answers exactly as a random token does; a child's request to create a link is refused; a link created without a public address is refused with "This hub has no public address; an adult can set one under Settings"; every open appears in the owner's view log. Out of scope: the viewer page (SHARE-LINK-03), the settings and page controls (SHARE-LINK-04). Exit: `bash scripts/check.sh`.
    Design: [external-sharing-2026-09-23](plans/external-sharing-2026-09-23.md)
- [ ] **SHARE-LINK-03: the viewer page** (S, Sonnet; after SHARE-LINK-02). Objective: the plain page a viewer gets: the file shown, played or offered, its kind and size, nothing else; no account, no household or person name, no other file, no link into the hub, no script, no third-party asset; no-store headers on the page and no long-lived cache on the file; the safety floor on the served content the same as in-house. Files: the link route's page from the template's empty-state layout (no hand-built UI). Acceptance: a capture of the page for an image and for a document; a file the household would not be shown is not served; the response carries no cookie and no script. Exit: `bash scripts/check.sh` and the captures.
    Design: [external-sharing-2026-09-23](plans/external-sharing-2026-09-23.md)
- [ ] **SHARE-LINK-04: the public address setting and the Storage page's link controls** (S, Sonnet; after SHARE-LINK-02). Objective: `home.public_url` declared once (household, advanced, default unset; the wizard never sets it), the Storage page's link controls from the template (create with the expiry choice defaulting to 30 days and "no expiry" offered, the download limit, the token shown once, revoke, the view log), the privacy page's "what leaves the house" row for links. Files: the settings registry (spec first), the Storage page, the privacy page. Mirror: SETTINGS.md's generic renderer; PRIVACY.md's table. Acceptance: with the address unset the controls are absent; with it set an adult creates, copies once and revokes a link, and the privacy page lists the row. Out of scope: the route (SHARE-LINK-02). Exit: `bash scripts/check.sh` and the captures.
    Design: [external-sharing-2026-09-23](plans/external-sharing-2026-09-23.md)

## Documentation and app discovery (owner, 2026-10-06)

- [ ] **DOCS-GITBOOK-01: move our documentation to a GitBook-style site** (M, owner: "its cleaner, not as busy or overwhelming"). Today's site is Astro Starlight in `docs/site/` (owner 2026-10-06: cannot stand its design and layout, so the default Starlight look is out). Scope: the three tiers in `docs/STYLE.md` (`user/`, `dev/`, generated `api/`) presented as a GitBook-like site: one calm left tree of spaces and pages, one readable column, a quiet search, no banners or dense cards. First slice is a design note that compares (a) GitBook itself with Git Sync from the repo, (b) keeping Astro but replacing the Starlight look with a custom GitBook-like theme, (c) a self-hosted GitBook-style generator (candidates to evaluate: Docusaurus, MkDocs Material, Starlight, Fumadocs) against the privacy, AGPL, download-don't-vendor and no-phone-home rules, and picks one with a short reason; later slices move the content and keep every existing link working. Applies to every repo's `docs/`; the org standards in `getmaipai/.github` change only with the owner's word. Architect gate before dispatch. Owner reference (2026-10-06): https://animate-ui.com/docs looks good; it is listed in the Fumadocs showcase (https://www.fumadocs.dev/showcase), so Fumadocs goes first on the evaluation list and the design note screenshots that site and the showcase for the layout to copy. **Direction set 2026-10-07 (coordinator, from the owner's reference): Fumadocs is the working choice, built as a static export served from our own host.** The first slice is no longer a three-way comparison; it is a spike that renders `docs/user/` through Fumadocs with the animate-ui layout, plus a short note that confirms the licence, the AGPL fit, that the build downloads rather than vendors, and that the built site makes no outside requests (no analytics, no remote fonts). The other candidates are fallbacks only if the spike fails one of those four checks. Replaces the 'compare (a), (b), (c)' wording above.
    Design: [docs-audit-2026-10-14](plans/docs-audit-2026-10-14.md)
- [ ] **APPSTORE-DESIGN-01: design the app-discovery pages (the Home Apps page now, the Bot app page later) after the Obsidian community site** (S design, then M build, owner 2026-10-06). References to study and screenshot headlessly: https://community.obsidian.md/ and https://community.obsidian.md/search?type=plugin&categories=files (the category-filtered plugin search). Output: a design note in `data-scratch/design/` (saved as APPSTORE-DESIGN.md) with screenshots of the reference, what to take (browse by category, search with filters, clean listing cards, detail page layout, install state) and what not to (nothing that sends data to a third party; installs come from the signed catalog, `getmaipai/catalog`), mapped onto shipped kit parts and shadcn blocks only (rule 9). Builds wait for the design note and an architect verdict; Home first, the robot for parity.
    Design: [packages-apps-and-integrations-2026-10-17](design/packages-apps-and-integrations-2026-10-17.md)

## Skill standards (definition of done)

Jesse's call (2026-09-05): this should rank alongside, not after, building
more skills - a standard nobody's held to gets more expensive to retrofit
the more packages exist, not cheaper. `getmaipai/.github/docs/PACKAGES.md`
already defines a real bar for every package (skills included); checked
against what the 6 bundled skills actually have today, none of them
clear it in full:

- [ ] **I18N-01: Real i18n for skills** (L) - genuinely undecided, not just
      unbuilt: no `getmaipai/.github` standard mentions i18n at all today,
      so this needs a design decision before any code. At minimum:
      `manifest.json`'s `display`/`description` and a recipe's `format`
      step text are hardcoded English strings today, and `routing.
      examples`/`routing.patterns` (the deterministic floor's whole
      matching mechanism) would need real per-locale variants for
      anything beyond English to route at all - not a small addition
      once the `embed` role and Tier 2 both eventually depend on
      matching against those same examples.
- [ ] **Full i18n string extraction across the shell, kit, and apps**
      (M-L) - the sweep the item above deliberately deferred. Every
      hardcoded user-facing string in `frontend/src` (a first grep
      pass for this decision found strings scattered across
      `DevicesSection.tsx`, `UsersSection.tsx`, `VoicesPage.tsx`,
      `ChangeSecretSection.tsx`, `VoiceCatalogSection.tsx`,
      `NotificationBell.tsx`, `SignIn.tsx`, and more) needs the same
      `<Trans id= message=>`/`i18n._()` treatment as `Shell.tsx`'s
      "Search" and `HomePage.tsx`'s "Today" already have, then a real
      `en-GB` translation pass (today's two catalog entries happen to
      read identically in both dialects, which won't stay true once the
      sweep covers dates, units, and genuinely different vocabulary).
- [ ] **The far surface's type scale per script** (S, blocked on a
      non-Latin `household.locale` option existing) - see the deferral
      note above.
- [ ] **AGENT-REVIEW-DISCIPLINE-01: dispatched work reports its review honestly and re-reviews its fixes** (S, process, filed 2026-10-01 from the 2026-09-29/30 agent runs). Objective: three recurring gaps in dispatched-agent done reports: the `code-review` run did not print its target path (so a review of the wrong worktree, which gives an empty diff, goes unnoticed), the fix hunks after a review finding were not re-reviewed at low, and a report named the wrong branch for its worktree. Fix in the briefs and the coordinate skill: the brief template (`getmaipai/.github` plugin `coordinate` skill) requires the done report to quote the review's reported path and branch, the dispositions and whether the fix hunks were re-reviewed, and the exact worktree branch from `git branch --show-current`. Pointers: `plugin/skills/coordinate/SKILL.md`, the CLAUDE.md "Run a code review before committing code" paragraph. Mirror: the existing reporting contract in that skill. Acceptance: the template carries the three required lines; one dispatched item's report is checked against it. Out of scope: changing review levels or budgets. Exit: `bash standards/bin/check-core.sh` in `.github`.

## Skills (Tier 0 catalog)

Design for the lists, reminders and timers app: [Household](design/household-lists-reminders-2026-10-17.md) (2026-10-17).

Bundled today: `remember`, `recall`, `weather`, `define`, `joke`, `trivia`.
All six are `kind: "plugin"` recipes (backend/packages/<name>/recipe.json),
not `kind: "skill"`s in this repo's own architectural sense (a `SKILL.md`
composed into the system prompt) - `storytime-style` is the only real one
of those today. "Bundled skills" in this doc is the colloquial, family-
facing sense, not the manifest kind.

- [ ] **Fix trivia: it reveals the question and the answer in the same
      reply** (blocked - see "Plugin/recipe `ask`-continuation" under
      Advanced tool calling below) - Jesse noticed (2026-09-06) that
      asking for a trivia question immediately gets both, which isn't
      really trivia. Root cause confirmed in `backend/packages/trivia/
      recipe.json`: its one `format` step interpolates `{question}` AND
      `{answer}` into a single output in one shot - there's no LLM
      authoring this reply and no instruction to fix, since the whole
      recipe is deterministic fetch -> pick -> format. Needs the
      `ask`-continuation primitive below before it can be rewritten as a
      real ask-then-reveal flow (`recipe.json` splitting into an `ask`
      step for the question and a resumed step that compares the user's
      answer) - not fixable by editing this recipe alone.

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
- [ ] Media playback control (L) - built extensively in the legacy
      pre-rebuild code (YouTube integration, cookie-jar auth, session
      keeper), none of it migrated to this platform yet. Largest single
      skill area by legacy scope, and the one this session's own priority
      rule pushes behind music/media search.

## Integrations

Design: [smart home through Home Assistant](design/smart-home-2026-10-17.md) (2026-10-17).

- [ ] **Calendar** (L) - doesn't exist. Needs a design decision first:
      local-only entry within MaiPai vs. a real CalDAV/OAuth connection to
      an existing family calendar (Google/Apple/Nextcloud). See the
      compose-step sketch in `docs/dev.md`'s "Notes for later" for how this
      feeds a real multi-source answer. Reading a calendar is itself a
      lookup (Priority 1 by the Skills rule above) - it's the auth/sync
      plumbing underneath that makes this L-sized, not the read.
    Design: [mcp-connectors-survey-2026-10-03](plans/mcp-connectors-survey-2026-10-03.md)
- [ ] **Email search** (L) - doesn't exist. No permission-vocab slot fits
      inbox access yet; needs its own consent design (see `docs/dev.md`'s
      2026-09-05 note on this) before any client code. Same shape as
      calendar: the search itself is a lookup, the sensitivity and auth
      plumbing are what make it L.
    Design: [mcp-connectors-survey-2026-10-03](plans/mcp-connectors-survey-2026-10-03.md)
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
- [ ] **PRESENCE-FIND-01: Find people and things** (L, Jesse's ask, 2026-09-06) - two
      distinct halves. (1) Live location, ideally via iCloud/Find My -
      real per-account OAuth/auth plumbing (same shape as Calendar/Email
      above: privacy-sensitive, needs its own consent design, and Find
      My specifically has no public API Apple supports, only reverse-
      engineered ones - a real feasibility/ToS check before committing to
      this path, not just an integration to wire up). (2) A static
      location entry with no integration at all - "remember my passport
      is in the safe" - which is a pure lookup already buildable on top
      of the existing `remember`/`recall` skills (Skills, above) with no
      new plumbing; ship this half first regardless of what happens with
      (1), by the same lookup-before-integration rule the Skills section
      already states.

## Advanced tool calling (Tier 2)

- [ ] **ARCH-POLICY-01: three policy systems, all before personality: safety and fairness, household policy, information permissions** (L, design record first, decided 2026-09-22; the fourth of the 2026-09-22 architecture rows). The owner's separation: universal safety and fairness, the parent's own household rules, and who is allowed to KNOW a given fact, are three different systems, all of them before the personality layer, with an output checker after the model. Checked against Home: the bones of all three exist, the naming and one hard rule do not.

    **What we already have.** Safety runs first and on the way out: `evaluateSafety(text, speakerBand)` before the turn and `evaluateReply()` at the output boundary (`backend/src/lib/safety.ts`), age-banded by `ageBand.ts`, with the crisis path and the guards; the org's own rules already forbid a learned component in the safety, consent or privacy path and make child protections non-removable architecture (`.github/docs/SAFETY.md`). Information permissions exist at the record level: every memory carries `child_disclosure: "child_ok" | "teen_ok" | "adult_only"` and `recall()` filters by the reader's band BEFORE anything reaches a prompt (`memory.ts` lines 62-63), which is precisely the owner's "filter before context reaches the model, do not hope it obeys an instruction". Household policy exists in pieces: role floors on every package (`min_role`), the allowance settings, the child band's own reply rules, and the approval kinds.

    **The gaps, and they are the interesting part.** (1) **Household policy is scattered, not a layer.** There is no one place a parent sets what this child may hear, do and be told; it is spread across package `min_role`, allowance keys and band rules, so a parent cannot see or change it in one view and a new capability can forget to ask. (2) **Guardian-controlled disclosures have no first-class shape.** `child_disclosure` marks a record's audience, but there is no notion of "this subject is the guardian's to tell" with a redirect line ("that is something to talk about with Mom or Dad"), and nothing covers the family story case (Santa) where the honest answer and the family's answer differ by parental decision. (3) **Fairness has no policy of its own**: the guards catch invention and unsupported action, but nothing states fact versus opinion, materially relevant perspectives on a disputed question, no demographic proxies, no political steering; today that would be a prompt sentence, which the owner rightly calls too vague to work. (4) **The output checker is not tiered**: `evaluateReply` runs the cheap deterministic pass on every reply, and there is no "this answer touched a category that warrants a real evaluator, revise and recheck" loop, nor the cheap classifier that decides when to spend it.

    **The pipeline, recorded once so later items obey it:** identity -> household policy -> information permissions (retrieval filtered by what this person may know) -> context and memory -> the agent loop and tools -> the output policy checker (deterministic always, a model evaluator when a lightweight classifier says the answer warrants it, with one revise-and-recheck round) -> personality -> modality -> the person. Two rules inside it: a protected subject is filtered at RETRIEVAL, never left to the model's discretion, with the output checker as the second line; and personality never decides what may be said, only how the permitted answer sounds (a warm persona does not get to decide a child should not hear that a grandparent died; the household policy decides, the persona phrases it gently).

    **Sized by hardware class.** The deterministic passes and the retrieval filter are the same on every class, because they are correctness, not capability. What varies is the evaluator: full class runs a model evaluator on flagged answers with a revise round; bounded class runs it without the revise round (a flagged answer is refused or downgraded to the deterministic safe reply); floor only (the Pi robot) has no model evaluator at all, so its policy is the deterministic pass plus a narrower capability set, and it says so plainly rather than attempting a judgment it cannot make. A robot alone never widens what a child may hear beyond the hub's last synced policy.

    **The design record answers first** (`docs/dev.md`, and a spec record for the policy itself): the household policy's shape (one declaration per child: content categories with block/sensitive/age-appropriate, permissions for purchases, messaging, smart-home actions, and the guardian-controlled subjects with their redirect line), where it lives (the settings registry versus its own spec record, given it is per person and parent-edited), how a package's `min_role` and the policy relate (the policy is the floor, the manifest cannot widen it), the retrieval filter's extension from a band flag to a subject rule, the fairness policy's own text and which parts are deterministic, the classifier that decides when the evaluator runs and what it costs, and the audit trail (a parent can see what was blocked and why, without the blocked content leaking into the log).

    **Acceptance:** a child profile with a guardian-controlled subject where the memory exists, the retrieval excludes it, the reply gives the redirect line, and the output checker also refuses it when the filter is deliberately disabled in a test (both lines proven); a parent-set block applied to a package the manifest would otherwise allow; a fairness case from a written bench row (a disputed question answered with perspectives rather than a steer); and a measured latency line for the evaluator path so the cost of the extra pass is known. Files: `backend/src/lib/safety.ts`, `memory.ts` (the retrieval filter), a new household-policy module and its spec record, `turnEngine.ts`'s boundaries, `backend/scripts/bench/`. Out of scope: anything that weakens the existing non-removable child protections. Exit: the design record reviewed by the owner, then per-item `bash scripts/check.sh` and the benches.

    **Adversarial review, 2026-09-22 (GPT-5.6 at high effort, the owner's own pass), accepted in full and amending this row.** The finding: a protected fact is a data-flow problem, not a retrieval problem, and filtering only the memory store protects only facts whose source is the memory store. A death a parent has not told a child yet can reach the model through a sibling's words quoted in a shared thread, a search result carrying an obituary, a calendar tool returning "Grandma funeral", or the child's own earlier message, and by then an output checker is too late: the model can imply it, reason from it, or shape a question around it. So the design changes: information permissions become an **ingress-control boundary** that every context item passes, whatever its channel (memory, thread history, tool results, search results, documents, notifications, quoted speech), with deterministic actions per protected subject: `remove`, `abstract`, `do_not_confirm`, `redirect`. Two consequences the original row missed: **"do not disclose" and "do not confirm what the child already suspects" are different policies**, and the child's own words are never erased (the redirect answers them honestly without confirming); and the boundary needs **entity resolution**, since "Grandma", "Nana", "your mother's mother" and a first name are one subject. Where confidentiality already failed outside our boundary (the sibling wrote it in a thread the child can read), the assistant does not amplify or confirm, and cannot pretend to protect what is already out. The classifier that decides whether to spend a model evaluator may never decide whether privacy enforcement happens: that path stays deterministic, per the org rule. The output checker stays, as defence in depth only. The acceptance gains: a case per ingress channel (memory, tool result, search result, quoted sibling message, the child's own earlier message), each proven filtered before the prompt, plus an alias case.

    **Accepted design, 2026-09-22 (ARCH-AMEND-01). Nothing above is withdrawn; this fixes how the boundary is built and adds presence.** The ingress boundary runs over one `ContextItem` list, the only thing a prompt is built from: each item carries its text, its source channel (memory, thread history, tool result, search result, document, notification, quoted speech, the person's own words), the subject ids it mentions, and its disclosure. `buildPromptParts` (`backend/src/lib/turnEngine.ts`, the string assembly under `PROMPT_SYSTEM_CHAR_BUDGET`) stops composing strings from separate inputs and renders the filtered list, and the guards' evidence kinds (`turnContext.ts`, `EvidenceKind`) become this one type rather than a parallel record. The boundary itself is a pure filter over the list (`remove`, `abstract`, `do_not_confirm`, `redirect` per protected subject), so every acceptance case is a unit test with no model in it. Presence is a turn input on every surface: `sensitiveAllowed` (`turnContext.ts`) returns true for every surface but the robot today, so a shared screen would show a parent's sensitive memories with children in the room; it takes `present` on chat, tv and overlay too, withholds by default when presence is unknown on a shared-screen surface, and no shared-screen surface ships before that test exists (REVIEW-0922-01 (a) carries the interim rule). Entity resolution is a named dependency, not an assumption: the alias case needs entity records the judge does not create today (`memoryJudge.ts` header, "a real, deferred gap"), so ARCH-MEM-01's entity-creation item lands before the alias acceptance case can pass. Files gain `buildPromptParts` and `turnContext.ts`'s evidence types.

    **Evaluator, decided 2026-09-22 by ARCH-BUILD-01's verdict.** Cedar (the official WASM binding, 13 MB, 23 ms cold, 0.18 ms per evaluation) becomes the evaluator of this row's household policy record for permissions and role floors once that record exists: the spec declares the policy, Cedar evaluates it, and the application never sees Cedar's syntax. Not adopted before the record exists, because today it would replace a four-line role ladder. Exclusions parsed from speech, live consent and content ceilings are not Cedar's and stay in the boundary and the executor.
    Reconciled 2026-10-02 against docs/design/RULES.md: consistent with chat rules 0 and 1 (the safety floor, household policy and information permissions stay deterministic, and a policy refusal is not a tool failure, rule 6). No change to the item, except that its scoping of a `memory-search` tool is moot (see ARCH-MEM-01).

    **Edited 2026-10-12: MINOR-TOPICS-01 delivers two slices of this row.** Content categories per child (block, sensitive, age-appropriate) become the seven topic families with per-child levels, and the family-story (Santa) case becomes the child's `family_stories` keep. This row keeps the ingress-control boundary for guardian-controlled facts, the fairness policy and the policy declaration.
    Design: [household-memory-permissions-2026-09-26](plans/household-memory-permissions-2026-09-26.md)
- [ ] **ARCH-LAYERS-01: personality, conversational state and modality are three separate layers after the answer** **Rewritten 2026-10-02 for chat rule 5.** Length is decided in the plan only for spoken turns, a child's or teen's chat and glance surfaces; an adult's written turn has no word or sentence cap and no length instruction (THIN-1A). Companion voice is a per-request mechanism (adapter or steering), never prompt prose (rule 14), so the personality layer never adds voice sentences to a written prompt. (M, design record first, decided 2026-09-22; completes ARCH-AGENT-01 and ARCH-MEM-01, and supersedes part of the response-contract record). The owner brought the separation: the reasoning layer decides WHAT is true, the personality layer decides HOW it sounds, an ephemeral conversational state adapts within the conversation, and the modality layer decides what the surface receives. Checked against Home: two of the four exist, one exists half, one does not exist at all.

    **What we already have.** Personality is already a persistent configuration, not a prompt the model must remember: `backend/src/lib/persona.ts` declares behavioural dimensions (formality, complexity, engagement, filler_density) plus a few-shot `examples` block, composed by `composePersonaPrompt()`, selected by the `persona.active_id` setting; that is exactly the "dimensions plus examples, never 'you are a Southern mother'" shape, and the file's own comment records why (a caricature was the failure mode). The fact-versus-phrasing split is already a rule of the platform: "the model phrases, it does not judge" (turn engine header, plan 4.5), and the guards enforce it. Modality is half built: the response contract by surface (`docs/plans/response-contract-by-surface-2026-09-21.md`, RESP-01 to RESP-04) already rules that a typed screen gets the written register, voice gets one to three sentences and an offer, a glance hub gets a card plus a lead, with no user-facing control beyond ChatGPT's two.

    **The three gaps.** (1) **The personality prompt is not yet split from the length policy**: RESP-01 does that (the brevity sentence moves into the spoken policy), so this item depends on it rather than repeating it. (2) **There is no conversational state.** Nothing tracks, within one conversation, that the person keeps interrupting (be shorter), keeps asking for more (go deeper), is rushed, or is playing; `turnContext.ts` is ephemeral but carries the turn's plumbing, not the person's read. This is the layer that makes an assistant feel like it is paying attention, and it must NOT become long-term memory: it dies with the conversation, is never extracted by the judge, and never becomes a stored preference unless the person says so in words (then it is a real preference record, which the existing judge already handles). (3) **Progressive disclosure is not a voice behaviour yet**: RESP-02 defines the spoken projection, but not the "answer, give one to three useful facts, stop, expand on request" loop with depth tracked per topic.

    **The layer order, to be recorded once so every later item obeys it:** context (thread state and memories) -> reasoning and tools (the agent loop) -> the answer as structured content -> personality (how it is said: dimensions plus examples, one character in every medium) -> conversational state (this conversation's adaptation: length, depth, mood) -> modality (what the surface receives: written, spoken, glance; voice additionally gets prosody, pauses and the interruption contract). A change of personality touches none of search, memory, reasoning or tools, which is the test that the separation is real.

    **Sized by hardware class, as the other two rows are.** Full: all four layers, the personality's examples block in the prompt, conversational state maintained by a cheap scorer over the last turns, progressive disclosure with real depth tracking. Bounded: the same, with fewer examples and a smaller state (length and depth only). Floor only (the Pi robot): the personality dimensions become a fixed short instruction plus two examples, conversational state is length only, and the modality policy is the spoken contract, because a small model handles one instruction well and four badly.

    **The design record answers first** (`docs/dev.md`): the conversational state's fields and their decay (what survives a pause, what dies with the conversation); how it is computed (interruptions and "tell me more" are events the wire already has, or new ones); how it enters the prompt without becoming a second persona; the interruption contract for live voice (what happens to a half-spoken answer); progressive disclosure's depth counter and how a follow-up resumes it; and the child projection (a child's persona and state are the parent's setting, not the child's drift).

    **Acceptance:** the seeded voice set and the written set (RESP-01's) both re-run with one persona and no regression; a scripted conversation where three interruptions shorten the next answers and two "tell me more" lengthen them, asserted in a test; a written-versus-spoken pair for the same question proving the same facts in both and the spoken one stopping after the lead; and a persona swap that changes no retrieval, no tool call and no fact in the answers (the separation test). Files: `backend/src/lib/persona.ts`, `turnContext.ts` (or a new `conversationState.ts`), `turnEngine.ts`'s composition point, `backend/scripts/bench/`. Exit: the design record reviewed, then per-item `bash scripts/check.sh` and both bench sets.

    **Adversarial review, 2026-09-22, accepted and amending this row.** The finding: these layers do not only change wording, they change **which facts survive**. "Be brief" is a selection decision, "tell me more" is a selection decision, and voice's progressive disclosure decides where an answer stops; running them as serial transforms after a finished answer either drops content or forces a rewrite per layer. The example that settles it is a safety one: a parent asks by voice how much children's medicine to give, the conversational state says shorten (three interruptions), the spoken contract says one to three sentences, and each layer trims what it believes is presentation until the dose qualifier is gone. So the design changes: the layers keep separate owners and separate state, but they feed a **response plan built BEFORE generation**: mandatory facts (a safety qualifier is mandatory and cannot be trimmed by any layer), optional facts, prohibited facts (from ARCH-POLICY-01's boundary), desired depth, persona parameters, the surface's budget; the model generates once from that plan, and a check verifies the mandatory facts survived. Personality stays genuinely downstream (it phrases); conversational state and modality are inputs to the plan, not post-processors. This also amends `docs/plans/response-contract-by-surface-2026-09-21.md`: RESP-02's spoken projection is produced from the plan, never by trimming a written answer.

    **Accepted design, 2026-09-22 (ARCH-AMEND-01). Supersedes "the response plan stays a small object of ours" as a new object, and the sentence "personality stays genuinely downstream".** There is one plan. The spec's existing ReplyPlan (`reply-plan.schema.json`, spec-v0.1.18: the moves, playfulness, `max_sentences`, `max_words`, the band fields) is extended in the spec first and then on the hub with the fact classes the adversarial review named (mandatory facts, optional facts, prohibited facts from ARCH-POLICY-01's boundary, desired depth) and a surface-derived budget; no second plan object exists beside it. Length is decided in that plan and nowhere else: `planFor` (`backend/src/lib/register.ts`) derives `max_words` and `max_sentences` from the surface class and the evidence (written: the information need, no act cap; spoken: the act table as today; glance: the card), the persona's engagement dial no longer carries a length (RESP-01 does both, first), `planLine` names no sentence count on the written class, and both generation paths keep reading `max_tokens` from the plan (`turnEngine.ts`, the two `max_words * 1.6 + 32` sites), so no length lives in prose. Reply constraints decay by turn count (`replyConstraints.ts`: a length or shape ask holds for the turn that set it and the next three; a banned phrase stays). Personality is an input to the single generation, not a downstream pass: in prose it is the dimensions plus the examples block, as today, and the item that makes it orthogonal is the 2026-09-16 review's item 4 (a decoding-time control vector per dial, measured on the companion bench), which this row now depends on rather than drops; the separation test (a persona swap changes no retrieval, no tool call and no fact) stays the acceptance. Conversational state and modality remain inputs to the plan, as the adversarial review ruled, and the record still answers the questions listed above.
    Design: [response-contract-by-surface-2026-09-21](plans/response-contract-by-surface-2026-09-21.md)
- [ ] **ARCH-MEM-01: memory as four subsystems around the model, sized by hardware class** **Rewritten 2026-10-02 for chat rule 1.** Memory reaches the model as injected context and never as a tool: there is no `memory-search` package and no `memory-search` tool for the loop to call, so that part of the gap list and its files (`backend/packages/memory-search/`) are void. The rest stands: thread compaction is defined on the token-counted window's boundary (THIN-3D), episode recall is ported (THIN-0F), and sizing by hardware class reads the engine's real context (THIN-3A). (L, design record first, decided 2026-09-22, the companion to ARCH-AGENT-01). The owner brought the current shape: memory is not one thing but thread management, long-term extraction and storage, automatic retrieval, and an explicit memory-search tool, with a smaller model doing extraction and reranking so the best model is spent on conversation. Checked against what Home has, most of it exists; the gaps are specific.
    Design: [memory-lifecycle-and-preferences-2026-10-17](design/memory-lifecycle-and-preferences-2026-10-17.md)

    **What we already have, and it matches.** The extractor is a separate step on a separate model, not the chat model deciding for itself: `backend/src/lib/memoryJudge.ts` runs the `judge` role with its own extraction prompt and eleven categories (fact, preference, relationship, state and the rest), already distinguishing "nothing worth saving" from a durable fact, and CHAT-06 made ingestion idempotent (home 144906a2) so the same fact said twice is one record. Long-term storage is the spec's memory record with provenance, validity (`valid_from`/`valid_to`), the child disclosure flag and the privileged-kind rules (`memory.ts`: `remember`, `archive`, `setChildDisclosure`, `archiveByProvenance`). Automatic retrieval before the call exists: `recall()` runs on the turn with the utterance's own embedding, reusing the vector the router already computed. The kinds are separated rather than one bucket (memory versus entity records, `categoryToRecordKind`), and documents are already a different system (the artifact and knowledge packages), which is the separation the note asks for.

    **The four real gaps.** (1) **No memory-search tool.** Retrieval is automatic only; the model cannot say "I know he told me his monitor, it is not in what I was given" and go look. That is one package in the catalog (`memory-search`, args: a query and an optional scope), which ARCH-AGENT-01's loop then lets the model call; on the floor-only class it is not offered. (2) **Thread compaction is not a first-class state.** A long conversation is trimmed, not compacted into "what we decided, what was rejected, what is open"; the note's THREAD STATE block is the missing piece, and it is also what makes a small model behave on a long thread. (3) **Retrieval ranks on similarity and recency, not on importance, entity match or project scope**, and there is no rerank step; with a few hundred records that is fine, with twenty thousand it is not, and the household will get there. (4) **No project scope at all** until CHAT-PARITY-10 lands, which is the scope key the reranker will want.

    **Sized by hardware class, the same rule as ARCH-AGENT-01.** Full (p64 and up): automatic recall plus the memory-search tool the model may call mid-reasoning, extraction on the judge role after every turn, a rerank pass over the top candidates. Bounded (p32): automatic recall and the tool, extraction batched after the reply (never in the turn's own latency), rerank by a cheap scorer rather than a model. Floor only (p16 and the robot's Pi): automatic recall only, no tool offered, extraction on a small classifier or a rules plus template pass that writes only the high-confidence categories (preference, fact with an explicit subject), and a hard cap on how many memories enter a prompt. A candidate for the small end is the ROUTER-RLCD-01 bench's own models (the calibrated decision head is exactly "is this worth remembering, and of what kind"), which is a second reason to run that bench.

    **The design record answers first** (`docs/dev.md`): the thread-state shape and when it is recomputed; the memory-search tool's args, its permission (a person searches their own memories; an owner may search a child's where the existing rules already allow it) and its child projection; the ranking signals and where importance comes from (the judge already emits a confidence; usage counts exist via `bumpUsage`); whether reranking is a model call or a scorer, per class; how project scope enters once CHAT-PARITY-10 exists; what the robot does alone (its own floor, its own small store, and what syncs on pairing per the portability rules); and the privacy line, which is unchanged and non-negotiable: nothing leaves the house, a child's memories stay a child's, and the credential policy still redacts before anything is stored.

    **Acceptance for the record:** the existing memory bench (`backend/scripts/bench/memory*`) re-run with the proposed retrieval against today's, on the dev hub's real records, reporting precision at 5 for a set of questions whose right memories are known; a latency line per class; and a written answer to "what does the floor-only class do when the right memory exists but was not retrieved", which is the same honesty question as the agent loop's stuck line.

    Files (record first): `backend/src/lib/memory.ts`, `memoryJudge.ts`, `memoryIngestion.ts`, `turnEngine.ts` (the recall and compaction seams), a new `backend/packages/memory-search/`, `backend/scripts/bench/memory*`. Out of scope: changing the record shape itself (the spec's memory record stands), and anything that would put household memory on a machine outside the house. Exit: the design record reviewed by the owner, then per-item `bash scripts/check.sh` and the memory bench.

    **Adversarial review, 2026-09-22, accepted with one note, amending this row.** The finding: this row optimised retrieval before deciding what deserves to exist, and a household does not need a better search engine over twenty thousand records, it needs a small trustworthy picture of people whose facts change, conflict and expire. Reranking cannot repair bad truth maintenance: "I hate mushrooms" versus "I have started liking mushrooms", a move that invalidates "Dad's office is upstairs", two people with one name, a teenager who said while sick that pizza makes them nauseous and gets it served back six months later at their birthday. So the design changes: **store less, and make contradiction and expiry the first-class problem**: a compact current profile and state graph for what is held true now, episodic records only where provenance or history matters, thread and project summaries, and the explicit "remember this" items, with consolidation on write and expiry for weak inferred records. The note: Home already has the bones the review could not see, `valid_from`/`valid_to` on every record and the curator item CUR-01, so this is a promotion of CUR-01 to the centre of the memory design rather than new ground. Second accepted finding: the `memory-search` tool widens the model's authority from "use what was selected for this turn" to "rummage through a person's history", so it is scoped by ARCH-POLICY-01's ingress boundary (a search returns only what this reader may know), logged, and offered only on the classes where a model can be trusted with it.

    **Accepted design, 2026-09-22 (ARCH-AMEND-01), correcting gaps (1) and (3) against the code.** Recall already ranks an entity match as a deterministic override (`backend/src/lib/memory.ts`, the entity-first pass and the pinned-or-entity branch of the scorer), so the ranking gap is importance and project scope only, not entity match. The "told me his monitor" case fails because the judge creates no entity records (`memoryJudge.ts` header), so entity creation by the judge is the first item, ahead of any reranker, and it is also ARCH-POLICY-01's alias dependency. The memory-search tool stays absent until CUR-01 (contradiction and expiry) has landed and the per-model tool budget (ARCH-AGENT-01) says the model may hold it; a search over unconsolidated records serves the stale mushroom fact faster, not better. The prompt budget is a named gap: five snippets and 800 characters (`turnEngine.ts`, `MAX_MEMORY_SNIPPETS`, `MAX_MEMORY_SECTION_CHARS`) against the 1,300 to 1,600 tokens the 2026-09-16 review measured in the strong systems; the record sets a measured budget with the memory bench. The four-subsystem framing above stays as the owner's description; the record's seams are the three the adversarial review found: what is held true now (the profile and the state graph), what happened (episodes, thread and project summaries), and what the person asked to keep.
    Design: [context-compaction-2026-10-05](plans/context-compaction-2026-10-05.md)
- [ ] **PKG-ASK-01: Plugin/recipe `ask`-continuation: let any plugin pause for a
      real answer, not just reply in one shot** (L) - surfaced fixing
      trivia (Skills above), and Jesse's own framing once he saw the
      cause (2026-09-06): this needs to be a capability every plugin can
      use, not a trivia-specific hack. It's a distinct gap from Tier 2
      tool calling above - not about the model choosing which plugin to
      call, but about a plugin that's already running needing to pause
      mid-recipe, show something, and resume once the person answers.
      Half-built already: `PluginResult.ask` is a real field in
      `result.schema.json`, and both interpreters (`spec/interpreters/
      ts/recipe-interpreter.ts` and its Python twin) support an
      `"op": "ask"` recipe step - proven by the conformance fixture
      `spec/fixtures/recipes/ask-disambiguate.json` - but nothing wires
      it to anything real: `turnEngine.ts`'s plugin branch only ever
      reads `result.value.reply`, silently falling back to "Done." if a
      recipe ever produced `ask` instead; no bundled package uses the
      `ask` op; and there is no cross-turn state anywhere remembering
      "this conversation is mid-recipe, paused at step N, waiting on an
      answer that binds to `expects`." `turnEngine.ts`'s own header
      comment (~line 1142) already names this gap, though it's gone
      slightly stale - it says the interpreter has no ask-producing step
      at all, which the fixture disproves, but its actual conclusion
      ("nothing routes a follow-up deterministically today") still
      holds. Real design work before code: where paused-recipe state
      lives and how a follow-up turn gets routed back into resuming the
      right pause instead of hitting the normal router again, a timeout/
      abandon story (the person never answers, or asks something
      unrelated instead), and whether `ask` should offer real UI (tap a
      multiple-choice option, not just type free text) given `spec/ui`'s
      schema-driven pages already exist elsewhere in this app. Once this
      lands, trivia's `recipe.json` is the first real caller: split into
      an `ask` step for the question and a resumed step that compares
      the answer, instead of today's one `format` step revealing both.

## DOCS-01 approved backlog additions (2026-10-06)

- [ ] **SHELL-KIT-01: RailProfile, StatusIndicator, NotificationBell, ProfileSwitcher into the kit; shell gap list; elements:status shell count** (S; after RULES-EDIT-01; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
- [ ] **CHAT-PAGE-SPLIT-01: split ChatPage.tsx along the kit's slots (mechanical, no behaviour change)** (M; after 1.3; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
- [ ] **CHAT-PHONE-01: the phone pass (history sheet, Running now sheet, gutters, 85 percent bubbles) and the capture set** (S; after LAND-01, LAND-02; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
- [ ] **SCREENSHOT-REVIEWS-01: retire the stale named reviews; --chat-shell-review is the acceptance set** (S; after 1.16; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
- [ ] **GROUND-A-01: search grounding option A (prefix says it has search and its knowledge predates today; history keeps the tool call and sources; evidence cap from the real context; abstention wording) with CHAT-GROUND-BENCH-01** (M; after 2.2; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **IMG-SEARCH-RULES-01: R1 to R6 from the accuracy study in select.ts/relevance.ts; show_images schema {subject, kind}; disambiguation page with no kind means no pictures; Bing exempt from the per-source quota; Commons thumbs only; counters resolve_source, query_form, engine_weight** (M; after LAND-03; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
- [ ] **IMG-QUALITY-01b-LIVE: live two-turn probe for "show more"** (S; after IMG-QUALITY-01b (done); needs the Stack chat engine up). Objective: "show me X", then "show me more" against the running hub; every tile of both turns opened and judged, the second turn shows no repeat and the trace carries `excluded_already_shown`. Exit: findings in docs/dev.md, `bash scripts/check.sh --docs`.
- [ ] **IMG-PIPE-BENCH-01: per-kind rows in the judged picture sample, the evidence every deferred idea waits on** (S, bench; Sonnet 5.5; after IMGQ-05's sample is runnable and IMG-QUALITY-01a lands; rule 13; design data-scratch/design/IMG-PIPELINE-ARCHITECT-REPORT.md). Objective: extend IMGQ-05's 40-question sample with labelled rows for the proposal's intents, namely a film poster judged on year, a product, an album cover, a performing artist and a thing, each tile judged right, wrong subject, private person or junk, and report wrong-subject and intent-error counts per kind plus resolution time from `timing_ms`. This is the trigger measurement for IMG-PIPE-INTENT-01 and IMG-VISION-SHADOW-01. No code beyond sample rows. Exit: table in docs/dev.md, `bash scripts/check.sh --docs`.
- [ ] **IMG-PIPE-INTENT-01: an additive model-chosen `intent` argument on `show_images`** (M, deferred; Sonnet 5.5, Opus 5.5 for the schema decision; after IMG-PIPE-BENCH-01; trigger: 2 or more wrong-intent visible tiles in IMG-PIPE-BENCH-01 rows of one kind; rules 0, 1, 9, 13; review medium: a tool schema and a bench row). Objective: only if the bench shows intent errors, add one optional enum argument (`general | portrait | album_cover | product | poster`) written by the model with the tool call, never inferred from the person's words, mapped by a closed table to a source (Commons depicts, lead image, the Wikipedia title query of R2). The conditional tool set stays under 16 (rule 1) and the replay bench carries the new rows. Supersedes: nothing.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **IMG-VISION-BENCH-01: offline bench for a coarse picture-category and non-photo check, on the judged sample** (S, bench, dispatch first; Sonnet 5.5; after IMG-QUALITY-01a is a backlog row and has landed, and IMGQ-05's 40-question sample has run; rule 13; org RULES-AND-LEARNED-COMPONENTS; design data-scratch/design/IMG-CATEGORY-ARCHITECT-REPORT.md sections 3 to 6; review low). Objective: with a small zero-shot image/text model fetched into git-ignored scratch (no product code, nothing shipped, nothing vendored), score every saved shortlist tile against its subject's Wikidata class label and a closed set of non-photo labels, add a seeded set of 20 or more labelled non-photo and off-class files (the Blaine, red panda, koala plate and Michael Jackson disc cases and their cousins), and report coverage, unknown rate, the yes/no matrix against the IMGQ-05 judgments, false drops on natural right tiles with 95 percent intervals on a held-out half, per-tile time on the real hub hardware, and the same person-presence number beside YuNet's for thing subjects (input to owner question 1 of IMGQ-06). Exit: table in docs/dev.md, `bash scripts/check.sh --docs`. Supersedes: nothing.
- [ ] **IMG-VISION-SHADOW-01: a category and subject-similarity shadow run for adult pictures** (M, deferred; Opus 5.5 for the design review because it adds a learned component beside a privacy promise, Sonnet 5.5 to build; after IMG-VISION-BENCH-01 and a Stack image-embedding capability under rule 11; rules 0, 6, 11, 13; PRIVACY.md, RELEASES-AND-DEPENDENCIES.md, RULES-AND-LEARNED-COMPONENTS; replaces IMG-SIM-SHADOW-01, which was only proposed in IMG-PIPELINE-ARCHITECT-REPORT.md and never recorded here, so it is closed as superseded). Trigger: the bench meets promotion thresholds 1 to 3 of its report, or the section 6 shortlist shows more than 1 of 40 questions with a wrong-subject visible tile after IMG-QUALITY-01a. Objective: the Stack runs a pinned, checksummed SigLIP-class model on the hub; for an adult's survivors after the relevance vetoes it logs two numbers per tile (class score and yes/no; subject-text score for thing subjects only, never for a person subject), no text, title, URL, filename or hash; the band is read in code and never runs for a teen or child; it drops, orders and gates nothing; unknown never means drop; a counter `category_shadow:<yes|no|unknown>` and a corpus row. Download row on the privacy page in the same commit; update the relevance.ts header and image-quality-design.md sections 2 and 9 in a design note with a Supersedes section. Supersedes: IMG-SIM-SHADOW-01.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **IMG-VISION-VETO-01: promote the category check to a veto for adult pictures** (S, deferred, needs Jesse's word since it changes what an adult sees; Opus 5.5 reviews the evidence, Sonnet 5.5 builds; after IMG-VISION-SHADOW-01 has run for two weekly reports and only if its shadow numbers pass the section 6 step 2 thresholds on a fresh sample; rules 0, 6, 13; review medium (learned component beside a privacy promise)). Objective: the check drops a survivor only when all five thresholds in the report's section 6 hold on a held-out sample; adult band only, never a teen or child, never the reason a privacy promise holds, `unknown` keeps the picture, each non-photo label has a counter and retires after consecutive zero-hit weeks. Supersedes: nothing.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **GATE-FIX-01: every test server 127.0.0.1 on port: 0 held (codemod plus lint), mdns.test.ts serial shard, gate lock refuses a full gate above load 9 and says so, flakes.json rows, first 20 fixed sleeps to condition waits** (M; after Codex high, one lane, nothing else running; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
- [ ] **UI-ALERTDIALOG-OPAQUE-01: an additive opaque overlay variant on the kit AlertDialog, then the session lock uses it** (S, lands in `getmaipai/commons` first, then Home pin bump and `frontend/src/shell/sessionLockContext.tsx`; Sonnet 5.5; rule 9(c); review medium). Objective: the kit AlertDialog overlay is `bg-black/10` plus `backdrop-blur-xs`, which leaves the previous person's page legible; the lock must cover it (INCOGNITO-07; a shared screen may have a child present). Commons adds an additive opaque overlay variant (default unchanged, tested, new ui tag); Home bumps the pin and selects it, renders the lock as a non-dismissable controlled AlertDialog (no `fixed inset-0`, no `max-w-md` div), children stay mounted (drafts and streams survive). Blocks the lock hunks held from RULE9-WRAPDIV-01; the branch worktree-agent-a1f6f3bdd5867cfa8 holds them. Interim: keep the old cover. Acceptance: ELEMENTS-LINT-02 and -03 green with baselines not grown, session-lock tests re-pointed not weakened, a screenshot of the lock opened and judged; `bash scripts/check.sh` exit 0, scope line stated.
- [ ] **UI-BADGE-GHOST-CONTRAST-01: better contrast for a `secondary` Badge on a ghost Button** (S, optional; lands in `getmaipai/commons` as an additive variant; polish gap, not a rule break per RULE9-WRAPDIV-01b-NOTE.md). Objective: the notification bell count stays readable on the ghost button in light and dark. Exit: `bash scripts/check.sh` in commons, then Home's pin bump.
- [ ] **RULE9-COMMONS-VARIANTS-01: additive commons variants the RULE9-CLEANUP-01g sites need** (S per variant, lands in `getmaipai/commons` first; each its own tag, then a Home pin bump; rule 9(c)). Gaps: Button start-aligned, auto-height, full-width and wrapping text; Dialog size and scroll; Select touch size and full-width; Popover no-padding and auto-width; Badge tone; Badge corner indicator placement. Acceptance per variant: default unchanged, tested, Home sites re-pointed with baselines shrinking; `bash scripts/check.sh` exit 0.
- [ ] **GATE-FLAKE-02: timing flakes in the full gate** (S; seen in 4 of 6 recent full gate runs). Failing: `backend/tests/conversationHistory.test.ts` "a remote link drop keeps a summary fold pending" (a 100 ms window); `tests/turnMachine/gateGrain.test.ts` THIN-5C (zero chunks, the fake Stack fetch throws ZlibError, word-by-word timing); frontend ChatPage. Objective: deterministic clocks and awaits in those tests, no weakened assertions. Acceptance: each test passes 20 times in a row alone and under a full gate; `bash scripts/check.sh` exit 0, scope line stated.
- [ ] **GATE-WORKTREE-01: the gate and tests work in a git worktree** (S). Defects: `scripts/check.sh` fails in a worktree whose `../commons` goes through the `worktrees/commons` symlink ("exists but isn't a worktree"), so agents must set `MAIPAI_COMMONS_DIR`; Vite dev in a worktree fails on `use-sync-external-store/shim`, which breaks `incognitoCanvas.test.ts` there. Objective: fix the path resolution so no env override is needed, and the Vite resolution so the test runs in a worktree. Acceptance: `bash scripts/check.sh --pre` passes in a fresh worktree with no env override, and `incognitoCanvas.test.ts` passes there.
- [ ] **STORE-DELETE-02: #214, #208, #210; person-columns.json guard; full-chain migration test; schema-version gate check; hub.db copy before migrate** (M; after none; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
- [ ] **STACK-CATALOG-01: one chat catalog in the Stack; Home reads GET /stack/v1/models/catalog; sizing math retired** (M; after 2.1; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)
- [ ] **CHILD-PROFANITY-01: deterministic softener on the child output floor (obscenity 0.4.6), counted, tested** (S; after none; see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md)
- [ ] **BOT-PIN-01: bot to the current spec tag** (S; after Claude cloud (bot); see `data-scratch/design/BUILD-PLAN.md`); needs its own architect verdict before dispatch
- [ ] **ARTIFACTS-LIST-01: the Artifacts list page and sidebar row (same deliverable as CHAT-ARTIFACTS-LIST-01)** (S; after COLUMN-01; see `data-scratch/chat-ab/opus-column-report.md`); needs its own architect verdict before dispatch
- [ ] **PROJECTS-UI-01: the assistant-layer projects page in the chat column, distinct from CHAT-PROJECT-01 chat folders; see that row for conversation grouping** (M; after project runner; see `data-scratch/chat-ab/opus-column-report.md`); needs its own architect verdict before dispatch
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **INCOGNITO-ANIM-01: Incognito animation follows the More menu on the rail, with purple content frame, fixed label and Exit control, and avatar ring; held until RULES S1 is amended (Owner-approved: 2026-10-06)** (S); needs its own architect verdict before dispatch
- [ ] **KS-02D: media-lookup and almanac-onthisday call `wikimedia-live`** (S, after KS-02). They are Deno-tier handlers with commons `net:` permissions, so the consolidation needs a commons permission change first.
- [ ] **KS-MODE-COMMONS-TABS-01: commons: additive `TabsList`/`TabsTrigger` touch-target size variant (48px)** (S, lands in `getmaipai/commons` `ui`; after none). Objective: an additive size variant so tab rows reach a 48px touch target without a Home className override (rule 9). Existing sizes and defaults unchanged. Reuse check: extends the shipped kit Tabs. Acceptance: variant story or test, one `ui` tag with matching `package.json`. Exit: `bash scripts/check.sh` in commons. Needs its own architect verdict before dispatch.
- [ ] **KS-BENCH-01: Run the tool-choice bench on KS-02's tree against one engine; decide: keep `scope` (bars met and set on at least 70 percent of calls) or drop it to the plain federation (the 2026-09-24 default); report** (priority 3, designed, not scheduled; S; after KS-02, THIN-Q3 landed (the tools block shrink changes the numbers); see `data-scratch/design/KNOWLEDGE-SEARCH-BUILD-SLICES.md`); needs its own architect verdict before dispatch Amendment (KS-MODE-01, 2026-10-10): runs after KS-MODE-01; record `scope` usage under the new `mix` default and keep a `mode = live` arm to compare against the 2026-09-24 default.
- [ ] **KS-04: Turn on: the `scope` description in the catalog record's measured tool list, child and spoken rows ticked, docs (`docs/user/web-search.md` gains "the home library answers first")** (priority 3, designed, not scheduled; S; after KS-BENCH-01 pass; see `data-scratch/design/KNOWLEDGE-SEARCH-BUILD-SLICES.md`); needs its own architect verdict before dispatch
- [ ] **KS-06: Stories: the `cluster_story` processor (embed role, 256-d int8, 72-hour window, threshold from the labelled pairs), `fold_wire_copy` (MinHash on title shingles), `NewsStory` rows with `publisher_count`, tier L wired into `lookup()` (`scope: web` and omitted), the "Recent: N stories" line on tier K hits, the "one outlet" prefix line, the pageviews signal (owner Q5)** (priority 3, designed, not scheduled; M; after KS-05; see `data-scratch/design/KNOWLEDGE-SEARCH-BUILD-SLICES.md`); needs its own architect verdict before dispatch
- [ ] **KS-STACK-REF-01: kiwix-serve and the library manager move to the Stack as the `reference` service: pinned binary and checksum (the Stack's download job), ZIM download as a StackJob with progress and the `max_mbps` cap in quiet hours (owner Q3 `auto | ask`), validation in a separate process, atomic swap, `/stack/v1/reference/{books,updates,install}`, the privacy rows published through `/stack/v1/privacy`, the owner-instance option `reference.kiwix_url` checked at save time, the job honours `reference.download.when` and the nightly window, supports pause, resume, cancel and "remove set" (freeing disk), reads the destination from the `reference` class location, applies `max_mbps` changes live, adds the `reference.update.mode = off` path and a privacy row per set (amended by KS-REF-PRESETS, `data-scratch/architect/KS-REF-PRESETS.verdict`), Home's `kiwixSidecar.ts` and `referenceLibrary.ts` retired after the port** (priority 3, designed, not scheduled; M; after STACK-SEARCH-01 (3.10) for the shared install note; KS-02; see `data-scratch/design/KNOWLEDGE-SEARCH-BUILD-SLICES.md`); needs its own architect verdict before dispatch
    Design: [reference-reader-and-library-settings-2026-10-15](plans/reference-reader-and-library-settings-2026-10-15.md)
- [ ] **KS-REF-WIZARD-01: the install step (the Settings screen moved to REFERENCE-SETTINGS-01)** (M, Sonnet; after KS-REF-PRESETS-01 and the first-run wizard row SETUP-LOOK-01; uses SETUP-START-01's chat-first rule). Objective: a first-run wizard step "Offline library" offering Full, Moderate, Minimum, Custom, the recommended one marked "(Recommended)", sizes and time stated, drive choice shown when the placement check says the internal disk is too small. The same page under Home settings, Reference library, is a settings area declared as data and drawn by `SettingsShell` (copy via `describeSetting`); Custom opens every choice; changing a set later installs or removes it with the impact shown. Kit components as shipped, nothing hand-built (rules 9, 9b). Acceptance: screenshots from a seeded household, opened and judged in light and dark at 1440 and 390; a child profile cannot reach it; the page appears in the settings index; a user-guide page under `docs/user/`. Exit: `bash scripts/check.sh`; see `data-scratch/design/KS-REFERENCE-PRESETS-DESIGN.md`; `data-scratch/architect/KS-REF-PRESETS.verdict`; needs its own architect verdict before dispatch Amendment (KS-MODE-01, 2026-10-10): the Settings page and Custom show the household mode as a basic setting and the two overrides (`search.source_mode.wikimedia`, `search.source_mode.web`) as advanced settings, in one `SettingsShell` card (S4, S5); kit parts only. The "Library only" copy says web search stays on unless its own override is offline.
    Design: [install-wizard-2026-10-13](plans/install-wizard-2026-10-13.md)
- [ ] **KS-08: The recommended preset per profile: Moderate (p16) and Full (p64 and up) as data in KS-REF-00's bundles, not hard-coded installs; keeps the install refusing under 20 percent free disk and the Reference app citation link (REFERENCE-CITE-01 folds in when the app exists)** (priority 3, designed, not scheduled; S; after KS-STACK-REF-01 or the Home sidecar, and after KS-REF-WIZARD-01; see `data-scratch/design/KNOWLEDGE-SEARCH-BUILD-SLICES.md` and `data-scratch/design/KS-REFERENCE-PRESETS-DESIGN.md`); needs its own architect verdict before dispatch
    Design: [reference-reader-and-library-settings-2026-10-15](plans/reference-reader-and-library-settings-2026-10-15.md)
- [ ] **KS-09: Studio wave, the Full preset's extra members as bundle rows in KS-REF-00 (each ships its bench and a bundle row): `nopic` (owner Q1), full Wiktionary, Wikibooks, the Stack Exchange home set (owner Q4), MedlinePlus (adults), Python docs (teens and adults), GeoNames into FTS5, the Open Library option; KS-BENCH-02 rerun on `nopic` (long-tail 85 percent); KS-BENCH-04 on the Studio with the rerank role resident** (priority 3, designed, not scheduled; M; after KS-STACK-REF-01, the Studio (owner Q6); see `data-scratch/design/KNOWLEDGE-SEARCH-BUILD-SLICES.md`); needs its own architect verdict before dispatch
- [ ] **KS-10: Docs and privacy: `docs/user/web-search.md` and the privacy page's "what the hub does on its own" section (the shelf, the ZIM check, the pageviews signal, Open-Meteo's 90-day retention line), `docs/dev.md` landing notes, the backlog rows** (priority 3, designed, not scheduled; S; after each slice, in its own commit (docs with the behaviour); see `data-scratch/design/KNOWLEDGE-SEARCH-BUILD-SLICES.md`); needs its own architect verdict before dispatch
- [ ] **SEARXNG-SET-01: SearXNG search and image engines, adult and child source policy** (M; after none; Reuse check: see `data-scratch/design/BUILD-PLAN.md`; Exit: `bash scripts/check.sh`); `data-scratch/architect/SEARXNG-SET-01.verdict`
    Design: [searxng-settings-2026-10-06](plans/searxng-settings-2026-10-06.md)
- [ ] **SEARXNG-SET-02: Stack-owned SearXNG service after STACK-SEARCH-01** (M; after STACK-SEARCH-01; Reuse check: see `data-scratch/design/BUILD-PLAN.md`; Exit: `bash scripts/check.sh`); `data-scratch/architect/SEARXNG-SET-02.verdict`
    Design: [searxng-settings-2026-10-06](plans/searxng-settings-2026-10-06.md)
- [ ] **MEDIA-INT-06: RapidOCR runs from Home today, a rule 11 breach being ported; Studio only** (S; after MEDIA-INT-01 design record; Reuse check: see `data-scratch/research/media-intelligence-design.md`; Exit: `bash scripts/check.sh`); `data-scratch/architect/MEDIA-INT-06.verdict`
    Design: [packages-apps-and-integrations-2026-10-17](design/packages-apps-and-integrations-2026-10-17.md)
- [ ] **MOBILE-RAIL-01: a phone still shows the 56 px icon rail instead of the slide-over drawer** (M, kit then Home; found by MOBILE-LIVE-01, 2026-10-11). Problem: at 390 x 844 with a phone user agent and touch, the left rail (brand, Search, Chat, Library, Family, profile) is drawn permanently and takes 56 of 390 px from every app; there is no round menu button and no drawer. Capture: `data-scratch/mobile-smoke/rail-390.png` (app content squeezed beside it: `30-menu-02-library.png`, `30-menu-03-family.png`), made by `bun run screenshots --mobile-smoke`. Required by docs/design/RULES.md App shell S1 (owner-approved 2026-10-06): below 640 px (or a touch screen under 500 px tall) there is no rail; the same entries live in one slide-over drawer (the kit's sidebar in off-canvas mode) opened by a round menu button floating at the top left of every app's root screen, holding the brand and Search, the apps with status dots, the selected app's own sections, and at the foot the profile control and the app's Settings gear. S3 requires a test at 360, 402, 874 x 402, 744 and 1440. Proposed direction: first check whether the kit layout already switches to its off-canvas mode under 640 and Home passes the wrong breakpoint or prop (a Home fix, no new kit part); if the kit lacks the mode, add the phone behaviour to the kit layout in `commons` first, then bump the pin. Extend `--mobile-smoke` to open the drawer and walk its entries once it exists. Not changed in MOBILE-LIVE-01 (capture and record only; the Chat crash was not caused by the rail).
- [ ] **UI-OTP-KEYPAD-01: an on-screen number pad for the passcode boxes** (S, commons first; split from UI-OTP-MASK-01, 2026-10-17). Optional `keypad` variant on `PasscodeInput` (digits 0 to 9 and backspace, 48 px targets) that fires the same `onChange`, for a kiosk or a touch screen with no keyboard. Home passes it on touch only. Home does not hand-build it (rule 9).
- [ ] **SEARCH-ANSWER-02: a half-remembered film or book goes to the web, not the offline library first** (S, bench first per rule 3; same note, symptom a). Reword the `scope` description in `backend/packages/websearch/manifest.json` or let an empty `reference` result fall through to the web in the same call; the model still decides.
    Design: [search-answer-quality-2026-10-13](plans/search-answer-quality-2026-10-13.md)
- [ ] **SEARCH-ANSWER-03: search answers lead with the sources, and the card shows the cited ones** (M, bench first per rule 3; same note, symptoms c and e). Phrasing instruction in `backend/src/lib/composer.ts` says "name only what the sources support"; sources card narrows to the `[n]` the reply cites. Needs the CHAT-AB-01 fresh-set bench, 3 repeats.
    Design: [search-answer-quality-2026-10-13](plans/search-answer-quality-2026-10-13.md)
- [ ] **SEARCH-ANSWER-08: a re-asked, unanswered question searches again instead of citing "earlier results"** (M, bench first per rule 3; same note). Turn turn-4rxa10ml9h made no tool call and invented citations.
    Design: [search-answer-quality-2026-10-13](plans/search-answer-quality-2026-10-13.md)
- [ ] **DATA-TRIVIA-02: Codex reviews the 101-question trivia bank** (S, 2026-10-14; architect APPROVED, `data-scratch/architect/DATA-TRIVIA-02.verdict`). Check each row for accuracy, age-band fit, safety and source; fix or remove only clear failures, replace from sources to hold band minimums, write a findings table. The header stays `reviewed: pending`; Jesse marks it reviewed.

## Moved off the plan page (2026-10-13)

Chores that were on the plan page; the plan now holds only the current goal.

- [ ] **BRANCH-OFFLINE-01: Land the offline boot test and unavailable wording** (moved off the plan 2026-10-13). Stopped mid-edit, staged changes in worktree
- [ ] **BRANCH-SEC1-01: Land machine protection checks and sign-in slowdown** (moved off the plan 2026-10-13). keep/home--home-codex-a-sec1 (19f12bab, ce58f59a) and -sec1-rate (9137951e); security review needed
    Design: [people-roles-and-account-2026-10-17](design/people-roles-and-account-2026-10-17.md)
- [ ] **BRANCH-APPEAR-01: Compare the appearance branch to what landed** (moved off the plan 2026-10-13). keep/home--home-codex-a-h1-appearance 108b4f80 vs SETTINGS-APPEARANCE-01; land the delta or drop
- [ ] **BRANCH-MCP-01: Land the MCP client manager** (moved off the plan 2026-10-13). codex/d-prep 6 commits; check against current design rules first
    Design: [tools-ecosystem-design-2026-10-03](plans/tools-ecosystem-design-2026-10-03.md)
- [ ] **FLAKY-TIMING-01: Loosen timing-sensitive flaky tests (conversationHistory link-drop fold, GATE-01 50 ms, rateLimiter, THIN-7C)** (moved off the plan 2026-10-13). Committed in worktree, not landed on main
- [ ] **LOCALCODER-LIFT-01: Raise coding-agent bench pass rate (Pi and Reika, same model): verify-before-done prompt, loop guard, 3-run pass^k, 35B-A3B model comparison** (moved off the plan 2026-10-13). Issue/oMLX research done 2026-10-11: check swap (6 GB used on 24 GB Mac), pi tool-timeout + output-length limits, oMLX A/B vs llama.cpp (omlx-env already exists in ~/Models/local-coder)
- [ ] **STATUS-NAME-01: Rename the status part called Understanding to a plain name (embeddings: finds related things by meaning); Jesse picks the name** (moved off the plan 2026-10-13). Jesse asked why it is not called Memories; Memory is a separate part (judge)
- [ ] **MOBILE-SETTINGS-FIX-01: Phone layout fixes: blocked-sites table second column cut off, users rows overlap, logo clipped, news shelf footnote wording** (moved off the plan 2026-10-13). add: Large+320px Appearance select chevron clipped
- [ ] **NO-OWNER-ROLE-01: Remove the owner role: admin is the top household role** (moved off the plan 2026-10-13). 
    Design: [people-roles-and-account-2026-10-17](design/people-roles-and-account-2026-10-17.md)
- [ ] **SEARCH-PROMPT-01: Make the model itself search more: better search tool wording plus examples, measured on the recency bench** (moved off the plan 2026-10-13). 
- [ ] **SEARCH-PASSAGES-01: Rank page text into the best passages (embeddings plus keywords, size budget, minimum score) before the model sees it** (moved off the plan 2026-10-13). Architect APPROVED; needs a Stack embedding endpoint first
- [ ] **TOOLS-RECALL-02: Tools: variant arms (descriptions, few-shot, thinking, renderer) vs same-session base; verify child-search violations** (moved off the plan 2026-10-13). From `data-scratch/chat-ab/tools-recall-01/REPORT.md`
- [ ] **STUDIO-COMPARE-01: Rerun the search benches on the Mac Studio and compare model sizes** (moved off the plan 2026-10-13). Parked 2026-10-13 until the Mac Studio arrives; harness ready in `data-scratch/chat-ab/ssa02`, `ssa03`, `ssa08`; same 22 items x 3 reps on the big model against the 9B baselines

## Docs vs code gaps (2026-10-14)

From `docs/plans/docs-vs-reality-2026-10-14.md`. The guides now say only what works today.

- [ ] **DOCS-GAP-02: Daily time allowances are saved but never applied** (M). `dailyMinutesAllowed()` in `backend/src/lib/allowance.ts` has no callers. Enforce it or say so in the Limits tab.
    Design: [modes-and-child-protections-2026-10-17](design/modes-and-child-protections-2026-10-17.md)
- [ ] **DOCS-GAP-03b** Follow-ups from the medium review (done 2026-10-15: a typed `/people/<teenId>` shows a blocked state for an owner/admin, and Family, the Memories tab and the page gate share `canAccessPerson` and `isProfileClosedTo` in `frontend/src/apps/people/roles.ts`); still open: admins still link other adults' cards though the server refuses their memories (the server's `canAccessPerson` allows an admin only a child, so an adult's page should probably close too, a ruling for Jesse); Memories keys on role, Limits/Topics on age band; no cue on an unlinked card.
    Design: [people-roles-and-account-2026-10-17](design/people-roles-and-account-2026-10-17.md)
- [ ] **DOCS-GAP-04: `reference.update.mode`, `reference.update.max_mbps`, `reference.pageviews_signal` and `household.family_name` have no code behind them** (S each). Build (KS-REF-00, KS-06) or remove the keys.
- [ ] **DOCS-GAP-05: Packages page promised a "Your apps" section on Home; no such section exists** (M). Build it or leave the docs as corrected.
    Design: [home-page-2026-10-17](design/home-page-2026-10-17.md)

## Row-Bot backlog additions (2026-10-06)

- [ ] **CALM-TOKENS-03: Home reads the new tokens** (S, home; after CALM-TOKENS-02; pin bump). Objective: bump the `ui` pin in `scripts/check.sh` and both package `file:` paths, run `bun install --force`, restart the hub, and verify the kit applies its tokens. Home applies no shadow or tone classes; kit rules and the kit layout wrapper apply `--page`, `--elevation-1` on Card, `--elevation-3` on popovers and the accent shadow. If “one primary button per view” cannot be expressed as a kit rule, drop it. Acceptance: proof from port 8787 after the restart; captures of every / page including a child persona, light and dark, both widths, before and after, opened and judged; S3 rail test green. Verdict: `data-scratch/architect/CALM-TOKENS-03.verdict`. Commons items CALM-TOKENS-00/01/02 are filed in commons.
- [ ] **CHAR-01: the household character from shipped parts** (M, home; after PRESENCE-STATES-01; alongside ASSIST-NAME-01 for the name and portrait). Objective: a kit block `companion-presence` (in `getmaipai/commons` `ui`, S of this item) composed of `VoiceOrb` (`elements/voice.tsx`), `ui/avatar` with `AvatarBadge`, and `AgentStatus`, taking one `PresenceState` prop; a resolver `resolvePresence()` in `@maipai/core` with the contract of CHARACTER.md section 3, fed on the backend by the turn stream (`turn_meta`, `status`, `reasoning`, `delta`, `spoken_cue`, `done`, `error`, the tool events), the BRAKES-01 ask rows and `conversations.pending_ask`, routine runs and `ENGINE-AVAIL-01`, published on the device event feed as an additive `presence` event; the frontend merges the client-only states (the live voice session's orb state, `connection-state`). Shown in the dashboard greeting beside `EmptyStateGreeting`, and chat uses only the working dot at the reply tail and the voice orb; no separate character mark appears in the chat column. Files: `DashboardPage.tsx`, `frontend/src/apps/chat/chatThreadSlots.tsx` (speaker mark), `backend/src/lib/presence.ts` (new), `backend/src/routes/devices.ts` (the feed). Mirror: `StatusBanner.tsx`'s use of shipped parts; `composerVoiceControls.tsx` already wires the voice session state. Acceptance: every state in the vocabulary renders through tokens only (a snapshot per state); a stale `thinking` with no `done` returns to `idle` within 120 s; answering an ask from Telegram clears the badge within 5 s; a child-band session never renders `concerned` and renders `asking` as "Asked a parent"; `prefers-reduced-motion` holds a still frame; the live region announces at most once per transition; the dashboard greeting and speaker mark render at both widths. Chat placement is the kit thinking-indicator dot at the reply tail and the voice orb; only the rail-foot portrait is held for owner answer 8. Out of scope: an animated face (CHAR-02), sounds (NOTIFY-SOUND-01), the Needs-you list (NEEDS-YOU-01). Reuse check: `VoiceOrb`, `Avatar`, `AgentStatus`, `SpeakerIdentity`, `EmptyStateGreeting` are shipped Elements, none implemented in Home yet; the resolver is pure data over the spec. Privacy and age: the block shows the signed-in person's state only; no identity, no other person's asks; a child's settings are the parent's. Exit: `bash scripts/check.sh`; `bun run elements:status` shows the five Elements implemented.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **BRAKES-02: an ask is answered where you are, waits until it is, and a denial is shown as skipped** (S, home, after BRAKES-01; bot half S after OFFER-01). Objective: the ask record is the one truth; every surface (the chat `approval-card`, the Needs-you list, a stored-state badge when its placement is approved, Telegram for adults (action summary only, never child or teen ask content; privacy page names what an ask sends), the robot's spoken "go ahead" and "not now" through OFFER-01's `ask_answer` (adults only, simple asks only, and only when speaker evidence identifies the ask owner; otherwise answer on screen)) reads and writes it, an answer anywhere resolves everywhere, an ask never expires on its own and shows how long it has waited, Cmd+Enter approves the focused simple ask on the web, a complex ask (one with a diff, a file list or more than one target) opens the thread instead of answering inline, a denied action is rendered as skipped and the model is told it did not run (rule 6's "the answer continues" applies), and "always allow in this chat" is written as a grant row shown as a chip and never offered to a child; for a teen it follows BRAKES-01 policy. Files: `backend/src/lib/approvals.ts`, the ask schema in `commons` if a `waiting_since` or `surface_answered` field is missing (additive, spec first), the Telegram notifier, bot `conversation/offer.py`. Mirror: `approvals.ts`'s existing self-decide refusal, untouched. Acceptance: a table test over the five surfaces answering the same ask id; a denied tool call renders "skipped" and the transcript shows the model's own words about it; a child's ask reaches the parent's surfaces and never the robot's spoken window; an ask older than 24 h is still answerable. Out of scope: new ask kinds. Reuse check: `approval-card` Element; the robot's keyword spotter already carries the accept and decline sets. Privacy and age: adults only on Telegram; a child's content never on a shared surface. Exit: `bash scripts/check.sh` in Home; the bot gate.
    Design: [notifications-and-asks-2026-10-17](design/notifications-and-asks-2026-10-17.md)
- [ ] **SINCE-01: "Since you were last here"** (S, home; after STATUS-C2 (built); richer after ROUTINES-01 and MEM-TIDY-01). Objective: a dashboard timeline, per person, of what happened since their last session: routine runs and failures, deliveries to them, repairs opened and closed, the memory tidy's one-line summary, engine restarts; each row links where the thing lives. Files: `DashboardPage.tsx`, a `GET /api/since` route over the status history, routine run and notification tables (additive). Mirror: the `/status` daily strips (STATUS-C3b). Acceptance: the list is empty with "Nothing happened" when nothing did; a member sees their own rows and household-wide engine rows; a teen's rows never appear for an admin; rows are capped at 20 with "more" to `/status`. Reuse check: `timeline` Element (TimelineEvent: past, now, future), not yet implemented in Home. Privacy and age: no conversation content, only the fact of a run or a delivery. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **MEM-TIDY-01: the overnight memory tidy** (M, home; spec first: `source` values `tidy_merge`, `tidy_decay`, `tidy_prune` and a `tidy-journal` record in `commons`; after MEM-02 (built) and QUIET-HOURS-01; journal view after MEM-EDIT-01). Objective: by default in the household's quiet hours, on the background engine (MEM-01, MEM-02), merge duplicate memories above a measured similarity and the same kind (with a stricter bar when the normalised subjects differ, Row-Bot's 0.93 and 0.98 pair as starting values), decay the confidence of inferred links older than 90 days by a fixed step per cycle and prune the ones that fall below the floor, refresh the rolling summaries that are due; never invent a fact, never touch a record under 24 h old, never touch crisis, consent or age state; every change tagged with its `source`, reversible for 30 days; Forget or admin deletion removes a record from the undo store immediately and undo never resurrects it, written to a journal the person can read (MEM-EDIT-01's record history and SINCE-01), with a rejection memory so an undone merge is never proposed again for a week at least; "Tidy now" for an admin with a preview of what would change: own and child changes are shown, other adult changes are counts only, and teen content is never shown. Files: `backend/src/lib/memory/tidy.ts` (new), the judge's dedupe path in MEM-02 (reused, not copied), `scheduler.ts`. Mirror: `dream_cycle.py`'s five phases and thresholds as starting values (merge 0.93 and 0.98, infer 0.80, batch 50, decay 10 percent per cycle after 90 days), re-measured on the memory scripts of CHAT-AB-01 (rule 13). Acceptance: a fixture household with ten planted duplicates, three planted false pairs and four stale inferred links: the duplicates merge, the false pairs do not, the stale links decay and the lowest is pruned, an undone merge is not re-proposed; a child's memories are tidied under the parent's rules and the journal is the parent's; a teen's journal is the teen's; the tidy never starts while a turn is active and yields when one starts (CHAT-19's priority, Row-Bot's "busy check"), and stops at the end of quiet hours; the journal row names merged, decayed, pruned and refreshed counts. Out of scope: relation inference from co-occurrence (a learned inference in the memory path needs its own design and bench), an insights pass, the force graph. Reuse check: the background engine, the judge and the dedupe already exist; the tidy is a scheduled caller of them. Privacy and age: as acceptance; nothing leaves the house; no learned component in a safety, consent or privacy path. Exit: `bash scripts/check.sh`; the CHAT-AB-01 memory rows unchanged or better.
    Design: [memory-lifecycle-and-preferences-2026-10-17](design/memory-lifecycle-and-preferences-2026-10-17.md)
- [ ] **MEM-REVIEW-02: the review queue** (S, home; after MEM-EDIT-01; spec first if the memory record lacks a `status` field: `active, needs_review, superseded, archived`). Objective: memories the judge saved with low confidence or a detected contradiction (status `needs_review`), and the tidy's merges, wait in a Review list on the memory page with three actions each: keep, edit, remove; a count on the page header; a kept record returns to `active`, a removed one becomes `archived` (restorable), never deleted from the queue; `needs_review` records are not injected into the prompt until kept; household proposals and personal review records use this same section. Files: the memory page from MEM-EDIT-01, `GET /api/memories?status=review` (additive). Mirror: the batch pattern of UI.md (multi-select, one confirmation naming the number, partial results reported). Acceptance: a reviewed memory leaves the queue; batch keep and batch remove work and report partial refusals; an admin reviews a child's queue, never a teen's. Reuse check: `data-table`, the kit's selection mode. Privacy and age: as acceptance. Exit: `bash scripts/check.sh`.
    Design: [memory-lifecycle-and-preferences-2026-10-17](design/memory-lifecycle-and-preferences-2026-10-17.md)
- [ ] **ROUTINES-02: the routines list rows** (S, home; after ROUTINES-01). Objective: each routine row shows name, one-line description, "n steps · last ran … · every …", next run in words, a ten-slot strip of the last runs (ok, failed, skipped-because-waiting), "step n of m" while running, an enable toggle, and a chip for its ask setting ("asks first", "never acts") from BRAKES-01; search and All, Enabled, Scheduled, Failed filters; "Run again" from a failed row. Files: the routines page from ROUTINES-01. Mirror: `home-workflows.png`. Acceptance: a failed run shows red in the strip and "Run again" works; a row waiting on an ask shows "waiting on you" and its next run shows "skipped, waiting"; a member sees only their routines. Reuse check: `schedule-card` (ScheduleRun) and `job-progress` (implemented); `data-table`. Privacy and age: a child's routines are the parent's to see and edit. Exit: `bash scripts/check.sh`.
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **PALETTE-INTENTS-01: the palette understands intents and flips settings with Undo** (S, home; after "Unified search: one palette over everything"). Objective: the palette matches a declared intent list ("dark mode", "connect a phone", "pair the robot", "mute notifications", "find a setting …") over the settings keys' labels and help text in `keys.json` and the installed packages' declared commands, flips an allowed boolean or select setting in place with a toast and Undo; outbound, credential, child-protection and parental keys always open their exact row, and jumps to the exact settings row for everything else; "/" on a settings page filters rows the same way. Files: the palette adapter in `frontend/src/shell/`, `commons` `ui`'s `command-palette` (implemented). Mirror: `palette-intents.ts` in Row-Bot for the shape of an intent entry, written as data. Acceptance: every intent is a row in a fixture, never a regex over the person's words in the turn path (rule 1 does not apply to the palette, but the list is still data); Undo restores the prior value; a child's palette shows only the child's settings; a teen's never shows parental rows. Reuse check: `command-palette` Element; the settings keys are already declared with labels and help. Privacy and age: as acceptance. Exit: `bash scripts/check.sh`.
- [ ] **NOTIFY-SOUND-01: a short sound for an ask and a finished job** (S, home; after the commons setting key and FACE-02M). Objective: two or three short shipped cues (an ask arrived, a routine finished, a routine failed), per person, off by default, silent in quiet hours, played through the kit's audio path, with `ui.companion.sounds` declared in the spec first. Files: `spec/settings/keys.json` (commons), the notification bell and CHAR-01's block. Mirror: FACE-02M's Web Audio cues (built) and `ui.enrollment_sounds`. Acceptance: a cue plays once per ask, never repeats, never in quiet hours; a parent sets a child's switch; the sound files are ours (licence recorded in `dev.md`). Reuse check: the Web Audio path FACE-02M already uses; no library. Privacy and age: as acceptance. Exit: `bash scripts/check.sh`.
    Design: [notifications-and-asks-2026-10-17](design/notifications-and-asks-2026-10-17.md)
- [ ] **LEARNED-01: "Learned this week" on the dashboard** (S, home; after MEM-EDIT-01). Objective: a card of the memories saved for the signed-in person in the last seven days as chips (added, updated), each opening the record; "Nothing new this week" when empty. Files: `DashboardPage.tsx`, `GET /api/memories?since=` (additive). Acceptance: a child's card shows the child's own memories; an admin's never shows a teen's; chips open MEM-EDIT-01's record. Reuse check: `memory-chips` Element (MemoryChange: added, updated, existing), not yet implemented. Privacy and age: as acceptance. Exit: `bash scripts/check.sh`.
    Design: [answer-blocks-places-and-documents-2026-10-17](design/answer-blocks-places-and-documents-2026-10-17.md)
- [ ] **MEM-EXPORT-01: memories as a folder of Markdown** (S, home; after EXPORT-01). Objective: a person's memory export as one Markdown file per record with a readable name, a short code on a clash, provenance in the front matter, links between related records; export only, no sync-back. Files: `lib/export.ts` from EXPORT-01. Acceptance: shaped by EXPORT-01's read-path projection (a minor gets what they can read); never overwrites a file it did not write; a second export moves replaced files aside. Reuse check: EXPORT-01's zip writer in `@maipai/core`. Privacy and age: an export is a boundary; the page says so. Exit: `bash scripts/check.sh`.
    Design: [security-and-data-lifecycle-2026-10-17](design/security-and-data-lifecycle-2026-10-17.md)
- [ ] **ERRCOPY-01a: the spec failure-kind vocabulary has one sentence and one fix, and a test says so** (S, home; no deps; after CHAT-FAIL-DETAIL-02 (built)). Objective: one table maps every defect code (`spec/vocab/defect-codes.json`) and every wire `error` kind to a dad-test sentence and at most one fix (Retry, Reconnect, Open the exact setting, Send again, New chat); an unknown code reads "Something went wrong. Try again." with the code under the admin's details; a test walks the whole list and fails on a code with no sentence, a fix that links to a settings row that does not exist, or a sentence containing an internal word (a fixture list: receipt, lease, checkpoint, admission, slot, engine id). Rule 6 is untouched: a failed lookup is still told in the model's own words; this table covers engine, transport and store failures that reach the person as a callout. Files: `frontend/src/apps/chat/` error rendering, `backend/src/wire.ts` error kinds, the commons spec copy table beside `vocab/defect-codes.json` (spec first), consumed by Home and Bot read by the `error-state` Element (implemented). Mirror: Row-Bot's `frontend/src/api/errors.ts` test, as a shape. Acceptance: the test covers only codes rendered as a person-facing callout; raw details stay admin-only; a child's sentence never names a setting the child cannot open. Reuse check: `error-state` Element; the defect-code vocabulary. Privacy and age: no raw error text to a non-admin (rule 6). Exit: `bash scripts/check.sh`.
- [ ] **SELF-KNOW-01: the model knows what the house can do** (S, home; spec first: a `capability-summary` fixture shape in `commons`; after COMP-03 for the identity line it extends). Objective: a stable prompt section generated from the installed packages' manifests (one line per package: what it does, in the manifest's own `description`) and a one-line volatile live state (robot paired or not, voice available on this device), with state names from `spec/vocab/capabilities.json`, per band (a child's list names only the packages the child can use), so the model answers "can you set a timer?" or "can you see the camera?" truthfully instead of guessing; package lines in the stable prefix change only on install or remove; live state is volatile (rule 4); never a rule, never a tool, never a reason to act. Files: `backend/src/lib/persona.ts` (the identity line already comes from the companion), `backend/src/lib/composer.ts`, the package host's manifest list. Mirror: Row-Bot's `self_knowledge.py` (`FEATURE_MANIFEST` plus a dynamic state block), as the idea. Acceptance: a fixture household with three packages produces the three lines and nothing else; removing a package removes its line on the next turn; the child band's section omits an adult-only package; CHAT-AB-01's adult rows are not shorter or slower (rule 13). Out of scope: a status tool for the model (our model never calls tools about itself). Reuse check: the manifests already carry descriptions; this is a renderer over them. Privacy and age: as acceptance; the live state names no person. Exit: `bash scripts/check.sh`; CHAT-AB-01 unchanged.
    Design: [packages-apps-and-integrations-2026-10-17](design/packages-apps-and-integrations-2026-10-17.md)
- [ ] **NOTIFY-FOLD-01: repeated notices fold into one, shown once per device** (S, home; no deps; the notification system (4.13) is built). Objective: a notice with the same text within ten minutes folds into one row with a count; each notice shows once per device per hub start (a device that showed it records that; a second window opened later does not repeat it); warnings and errors always show; the journal keeps the latest 64 notices and 32 start-up warnings per person; start-up warnings stay listed on `/status`. Files: `backend/src/lib/notifications/` and the bell. Mirror: Row-Bot's notices journal (`docs/CLIENT_PLATFORM_PRODUCT_SYSTEM.md`, "Background notices"). Acceptance: three identical engine warnings in two minutes show as one row with "3"; a second tab does not re-show a shown notice; a child's bell never carries an admin's warning. Reuse check: the kit's toast and the bell; the existing notification records. Privacy and age: per person, as today. Exit: `bash scripts/check.sh`.
- [ ] **PORTRAIT-01: a household-made portrait for the character** (S, home; after IMAGE-01 and ASSIST-NAME-01). Objective: an adult describes a look, the Stack's local `image` role renders one 1024 px still, the person previews it and keeps it as the character's portrait for the household or for themselves; stored as household data under the `file` record; never clips, never cloud. Acceptance: image generation uses only the local image role or a licence-clean tool; store its generation record and captured tool terms beside the art; no cloud user-data path; a child cannot start it and a parent chooses a child's portrait. The portrait is household art, not a logo or brand asset, and must be reviewed before any trademark filing. Reuse check: IMAGE-01's job path, `image-generation` Element. Privacy and age: as acceptance. Exit: `bash scripts/check.sh`.
    Design: [image-generation-2026-10-17](design/image-generation-2026-10-17.md)

## Row-Bot device and settings follow-up (2026-10-06)

Plain boolean switches and selects in `/settings` call the save handler immediately; only typed credentials keep a Save button. No SETTINGS-AUTOSAVE-01 item is needed.

- [ ] **DEVICE-PHONE-01: connect a phone from the Devices page** (S, admin only; LAN only). Objective: the Devices page shows a QR with a one-time code so an admin can connect a phone on the household network. The code expires in 10 minutes, works once, and is stored hashed as required by CREDENTIALS.md. Acceptance: a second redemption and an expired code are refused; no public route or outbound service is used. Reuse check: the existing device pairing and token patterns. Privacy and age: an admin starts pairing; no child can initiate it. Exit: `bash scripts/check.sh`.
    Design: [people-roles-and-account-2026-10-17](design/people-roles-and-account-2026-10-17.md)

## Cross-cutting

- [ ] **I18N-01b:** Real i18n (L) - "language and region" is a stored preference today
      with no translation behind it.
- [ ] **Commit the platform plan into `home/spec/design/`** (S; answered
      by Jesse 2026-09-25: not yet - stays open, deliberately deferred,
      not a pending question) - `home/spec/` still does not exist (checked 2026-09-25);
      the plan lives at `~/.claude/plans/purring-chasing-noodle.md`,
      outside every repo and unversioned. **The `home/agents.md` naming
      claim below is stale, already fixed**: the real file is
      `home/AGENTS.md` (capitalized), and `home/CLAUDE.md` already
      points at it correctly. Committing the plan (when it happens)
      still needs a PII pass first (it names Jesse's machines), and once
      it's in a real, editable file, its own stale terminology can
      finally be fixed too: plan 5.1/5.6 still say `skill` for what
      shipped as `plugin`, and plan 4.5/5.2 need the tier-ladder rename
      below applied.
- [ ] **PACKAGE-RUNTIME-RENAME-01: manifest `tier` field becomes
      `runtime`** (M, spec-first, after the decision above) - rename the
      manifest schema field `tier: "0" | "1"` to `runtime: "recipe" |
      "deno"` across `commons`'s `spec/schemas/manifest.schema.json`
      and both fixtures, every manifest in `home/backend/packages/`
      (23 at tier 0, 11 at tier 1) and `catalog`, `smoke.ts`, and
      `packageHost.ts:1865`. Cut a new spec tag, bump the pin in both
      consumers. Exit: `bash scripts/check.sh` full scope in `commons`,
      `home`, and `catalog`.
- [ ] **SERVICE-WALL-01: A generic wall, budget and probe layer before any media package**
      (M) - `rateLimiter.ts` is a non-blocking bucket only. Legacy's
      `quiet.ts`/`accessMonitor.ts`/`sessionKeeper.ts` trio encodes the
      2026-08-28 YouTube wall: a per-service wall remembered 24 h, daily
      caps split household 1500 / background 400 so background exhausts
      first, one probe per 6 h with the result persisted (the old probe
      ran five clients every 30 min and kept the wall up five days), a
      failure-quiet after three failures, one writer per cookie jar.
      Build it once, generically, before the first integration needs it.

## Org standards cutover (2026-10-03)

The org `CLAUDE.md` was cut from 1,003 to about 250 lines and its long rules moved to seven on-demand docs in `getmaipai/.github/docs/` (COORDINATION, GIT-WORKFLOW, VERIFICATION, DOCUMENTATION, BACKLOG-FORMAT, RELEASES-AND-DEPENDENCIES, PLATFORM). Home's `AGENTS.md` went from 108 to 45 lines and its pinning section moved to `docs/PINNING.md`.

- [ ] **STD-PIN-02: bump Home's `STD_TAG` to the tag from STD-TAG-02** (S, after STD-TAG-02). Objective: change `STD_TAG` in `scripts/check.sh` (currently `std-v0.3.1`) and the matching `standards/VERSION` expectation, then refresh the comments in `scripts/check.sh` that still cite org "CLAUDE.md > Verification" (now `docs/VERIFICATION.md`). Out of scope: any other pin. Exit check: `bash scripts/check.sh` exits 0.

## Wave 2 additions (2026-09-06)

Jesse asked for the backlog to be filled out to "a fully working app" and
split into four sessions that never collide. The split is in
`docs/plans/wave-2.md` (ownership, shared-file protocol, contracts) and
one work order per session (`session-c-brain-and-voice.md`,
`session-d-packages-and-store.md`, `session-e-ui-and-docs.md`,
`session-f-platform-and-trust.md`). This section lists only what the
2026-09-06 review found missing from this file; everything already
listed above is assigned in the plans, not repeated here. The review
read the platform plan's chapters 4, 5, 7, 12 and 13 against the code
on `main` plus the Wave 1 worktrees, the org standards, and the legacy
mirror's module list and header comments. Each item names the session
that owns it.

**First run and the household lifecycle**

- [ ] **A family member joins, a kid profile, a guest** (S-M, E and F) -
      the QR from the admin's screen carrying the address and the CA, the
      picker, PIN or passkey; birthdate in, band out, presets shown to
      the parent with what they will see; a guest with an expiry and no
      memory (plan 12, 7.4).
    Design: [people-profile-2026-09-26](plans/people-profile-2026-09-26.md)
- [ ] **HUB-MIGRATE-01: Hub migration, two hubs** (S-M, F) - plan 4.15; none exist.
      Migration keeps the instance id and CA so pinned clients survive;
      two hubs are two instance ids and a client remembers its choice.
- [ ] **The reading-level lint, wired as a check.sh gate** (S, F/E) -
      `scripts/reading-level.ts` exists and is correct (Flesch-Kincaid
      Grade Level against docs/STYLE.md's grade 6-8 target), but wiring
      it into check.sh now would block every commit repo-wide over
      content this session doesn't own the prose of: 7 of 9 docs/user/
      pages currently exceed grade 8 (memory.md highest at 14.4). Filed
      as `getmaipai/home#42` with the exact scores and the one-line
      check.sh addition to add once Session E has simplified the flagged
      pages.
- [ ] **The release ceremony for v0.1.0** (M, F, only when Jesse says so)
      - a security review pass, the clean-clone build, the restore
      drill, the changelog, the tag; `spec-v0.1.0`'s own tag prep (the
      spec README's pin line, the fixtures green in both languages) so
      it unblocks the `bot` repo. Cutting it is Jesse's word in the
      moment; everything up to the tag should be ready to go once he
      gives it.
- [ ] **SELF-UPDATE-TESTS-01: The Windows self-update rules as tests** (S, F, with self-update)
      - Defender holds `dist/` handles past 3 s; untracked files are not
      dirty; an unresolvable upstream never reads "up to date". Listed
      above under "Lessons to record"; now a build item, not a note.
- [ ] **Performance budgets measured** (S-M, F) - ENGINEERING.md names
      budgets and plan 4.11 says the archived latency numbers gate the
      first release (legacy `chat-latency.md`: 200 to 900 ms warm first
      token after six fixes, each documented); no bench measures first
      token, page open or cold start here. A full voice-turn latency
      audit (2026-09-06, GitHub issue #36, full report in the private
      review folder outside this repo) traced one turn end to end
      (~2.8 s estimated warm speech-end-to-first-audio on the target
      laptop) and found the real fix order below; this item is still
      the measurement half none of it has landed yet - a `TurnTrace`
      threaded through `routes/turn.ts`/`turnEngine.ts`, llama-server's
      own `timings`/`/metrics` parsed per turn, a `turn_timings` table,
      and `backend/scripts/bench/latency.ts` replaying scripted turns
      against the real engine. Landed from that same review without
      waiting on the harness (mechanical, no model-quality risk): one
      embed call per turn instead of two (`turnEngine.ts`'s `route()`/
      `recall()` shared `utteranceVector`), gating the Tier 2 grammar
      call to an ambiguous score band (`TIER2_AMBIGUOUS_FLOOR`) instead
      of every routable turn, mtime-cached package/skill manifests and
      an in-process settings/commands cache (all previously re-read from
      disk or SQLite every turn), warming the chat/embed/TTS engines at
      boot instead of on a household's first message, and idle-gating
      the memory judge's per-minute tick so it skips a batch while a
      real turn is active instead of contending for the shared chat
      slot - **tightened 2026-09-07** (getmaipai/home#63, a live
      diagnosis: one extraction call alone measured adding 2 to 4.7
      seconds to a chat reply started mid-batch) - the gate only checked
      once at the top of a ten-turn batch, and a turn's own 20 s idle
      window only ever measured from when it STARTED, so a reply
      streaming past that window looked idle before it was even done.
      `lib/turnActivity.ts` now tracks turns actually in flight and the
      real end of the last one (`markTurnFinished()`, called from both
      of `turnEngine.ts`'s finalize paths); `memoryJudge.ts`'s
      `MAX_TURNS_PER_RUN` dropped from 10 to 1, and `judgeTurn()` itself
      re-checks before every fact's own embed/dedupe call, not just once
      per batch, stopping cleanly mid-turn (the turn stays unjudged for
      the next tick, and anything already written becomes a dedupe
      candidate the resumed pass supersedes onto rather than
      duplicates); `scheduler.ts`'s `sortDueJobsForPriority()` moves
      `memory.judge`/`memory.consolidate` after every other due job in
      the same tick, so a reminder or timer never queues behind one.
      Still open, each needing the harness above (or, for the STT
      items, a wired frontend client) to land safely rather than guessed
      at blind:
      - Amended 2026-09-12: the sub-list below is superseded by the
        [2026-09-12 block](#chat-direction-2026-09-12-the-next-block-two-tracks):
        prefix reorder and cache are FAST-01 and FAST-02, the cue timer
        and first chunk are FAST-04 and VOICE-01, the judge's own model
        is MEM-01, barge-in is VOICE-01. Multi-slot `-np 2` is dropped:
        with background work off the chat engine one slot serves a
        household. Kept for the record only.
      - **Multi-slot separation for the chat engine** (`-np 2` +
        `id_slot` per role so the judge/summary refresh never contend
        with a live turn at the process level, not just the idle-gate
        above) - real risk found by the review itself: llama-server
        splits `-c` across slots, so this needs `autotuneContextSize`'s
        own math re-derived for `np=2` and `/props` checked on the
        pinned build before it ships, not assumed.
      - **Reorder the prompt for the prefix cache** - move memory
        bullets, summary, matched skills and the time line (currently
        before the conversation history) to after it, so the cache hit
        covers the whole history instead of just the stable prefix.
        Same content, different position, but needs the persona/
        routing/conversation bench re-run before landing (a small model
        measurably drifts on prompt shape changes, `docs/dev.md`'s own
        BACKLOG entry on this).
      - **Shorten the first spoken chunk and fix the thinking-cue
        timer** - `routes/turn.ts`'s 900 ms cue races the GATED
        generator (first-sentence time), not the raw token stream
        (first-token time), so it fires on most ordinary ~8B-model
        turns; `sentenceChunker.ts`'s first-chunk gate (90 chars) is
        also on the high side.
      - **Stream the first TTS sentence** instead of buffering it whole
        before playback (`sentenceSpeechScheduler.ts` already has the
        incremental PCM path via `streamingWavPlayer.ts`, just not
        wired into the turn path) and **pre-render fixed phrases**
        (thinking cues, refusals, confirmations) per voice so they play
        with no `/api/tts` round trip.
      - **Streaming STT** (sherpa-onnx streaming Zipformer or Moonshine
        v2) to replace the fixed 0.8 s silence timeout with Silero
        (~0.2 s) plus Smart Turn v3.1, and speculative prefill on
        speech onset - lower priority than the rest: no frontend client
        exists yet for `WS /api/stt/stream` in either tree, so none of
        this is reachable from a real conversation today.
      - **The memory judge on its own small model** (a second
        llama-server/router-mode process, ~1 GB) so its extraction/
        dedupe calls stop sharing the 8B chat model's VRAM and slot
        entirely, not just its scheduling.
      - **Barge-in** (`vad speaking:true` stops the scheduler, aborts
        the stream, truncates the logged reply to what actually played)
        - a correctness requirement for hands-free voice, not a latency
        win, but blocked on the same missing STT frontend client above.
      - **Pod/robot transport** - one WebSocket carrying turn events and
        PCM16 audio chunks, replacing the NDJSON-over-HTTP shape that's
        fine for today's one browser client but wrong once a pod or the
        robot is a real caller.
    Design: [chat-throughput-2026-10-17](design/chat-throughput-2026-10-17.md)
- [ ] **PKG-RESULT-01: `ask` continuation, `confirm`, `end_conversation` from a result**
      (S-M, D produces, C consumes) - `result.schema.json` has them;
      `runRecipe` never sets `ask`, and the turn engine reads none of
      them. A lookup cannot ask "which Springfield" deterministically.
- [ ] **Audit `host.*` against plan 4.9** (S, D) - not reached this wave.
      `host.log`, `host.config.get`, `host.data.forget`,
      `host.diagnostics` and the emulator twins are still missing or
      unverified; Session D step 5-9's own package work only ever needed
      `host.fetch`, `host.home.call_service`, `host.lists.*`,
      `host.reminders.set`, `host.timers.set`, and `host.integration.call`
      for real, so this audit was never forced and stayed unbuilt.
      Genuinely open for a future session.

## From Open WebUI research (2026-09-24)

Why not fork Open WebUI, and what's genuinely worth taking from it: [docs/dev.md "OPENWEBUI-01"](dev.md). These three are candidates, each needs its own design pass before it is chunked further; not started.

- [ ] **CHANNELS-01: a shared, multi-person timeline** (L, design pass first). Objective: a household "family room" where more than one person shares one conversation timeline, unlike every MaiPai conversation today (one person plus the assistant). Design questions before any row is chunked: whose turn budget and content-ceiling rules apply in a multi-speaker turn, how per-person safe search resolves when the speakers differ, how the turn machine's context list handles more than one active speaker, whether a model can be addressed directly (an @-mention shape) inside it. Files: TBD, pending the design pass. Exit: TBD.
- [ ] **NOTES-01: a persistent notes workspace, attachable to chat** (M, a new catalog app). Objective: a document space separate from chat for long-form drafting, attachable to a conversation so its content injects into context, matching Open WebUI's Notes feature. Files: an assistant-ui Elements-shaped editor (no hand-built one), a hook into the existing memory/context-attach mechanism. Exit: TBD, pending a design pass on the attach mechanism.
    Design: [packages-apps-and-integrations-2026-10-17](design/packages-apps-and-integrations-2026-10-17.md)
- [ ] **STREAM-DELTA-01: measure patch-based streaming against MaiPai's own SSE** **Rewritten 2026-10-02 for chat rule 9.** Retargeted: measure the web chat's `assistant-stream` encoding (THIN-5D) against the NDJSON events on reply traffic, after THIN-5E. Verify any library claim in the installed source and cite the line, as before. (S-M, bench first). Objective: Open WebUI's v0.11.1 claims an order-of-magnitude reply-traffic reduction from patch-based rather than full-token streaming - a claim to verify in the installed source before building anything, per the org's own rule on library claims, not a number to copy. Exit: a measured comparison in dev.md; only becomes a build item if the numbers hold up.
    Design: [chat-thin-path-2026-10-02](plans/chat-thin-path-2026-10-02.md)

## From DeepSeek Harness research (2026-09-26)

What DeepSeek Harness does, why it is not a base for Home, and what's worth taking: [docs/dev.md "DSH-01"](dev.md). Candidates, not started. NEXT-BRANCH-01 is a defect the audit surfaced; INCOGNITO-11 (above) is the audit's priority finding and stays in its own area.

- [ ] **CONV-STATE-01: the conversation list shows which chats need you** (S). Objective: a mark on a conversation row when it is waiting on your answer (`conversations.pending_ask` set), has an unread reply, or has a scheduled routine (after ROUTINES-01). Files: the thread list adapter (`frontend/src/apps/chat/chatThreadListAdapter.ts`) and the list route's response (additive field). Acceptance: a parked ask shows the mark, answering it clears it; test in those words. Exit: `bash scripts/check.sh`.
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **ROUTINES-01: a scheduled prompt delivered into its conversation** (M, a catalog package, design note first). Objective: "every weekday at 7, the weather and today's calendar" runs on schedule and lands in the conversation it was made in, for the person who made it, under their safety and content rules. Shape from DeepSeek Harness's schedule tools: one-shot, daily, weekly or cron with a time zone; survives restart; only the latest missed run is delivered. Built on `backend/src/lib/scheduler.ts` through the package host's `host.schedule`, never a second scheduler. Acceptance: a routine made by a child runs under the child's rules; a restart mid-schedule delivers once, not twice. Out of scope: routines that act on devices (integrations' own consent path). Exit: the design note in dev.md, then `bash scripts/check.sh`. Row-Bot acceptance: while a run waits on an ask the next scheduled run is skipped and the row says so; an explicit "in app only" delivery stays in app if the household default changes; only the latest missed run is delivered after restart; deleting a routine keeps run rows with prompt text scrubbed.
    Design: [assistant-layer-2026-10-04](plans/assistant-layer-2026-10-04.md)
- [ ] **ATTACH-PREVIEW-01: preview an uploaded document beside the chat** (M, after COMPOSER-DOC-ATTACH-01). Objective: an attached PDF, office document or spreadsheet opens in the canvas side panel (`ChatPage.tsx`'s CanvasSplit, a bottom sheet on phones). The viewer is named as a gap in the design record first: no shipped kit component renders PDF or office files today, and the smallest composition of maintained parts wins. Exit: TBD, pending that record.
- [ ] **CONV-EXPORT-01: download one conversation** (S, after EXPORT-01). Objective: a conversation's menu offers a download of that conversation alone, shaped by EXPORT-01's read-path projection (a minor gets what they can read, nothing more). Exit: `bash scripts/check.sh`.

## From Hermes research (2026-09-27)

Why Hermes Agent is not a base for Home, why the Hermes models are not a chat-role candidate, and the two things worth taking: [docs/dev.md "HERMES-01"](dev.md). Candidates, not started; each needs its own pass before it is chunked.

- [ ] **GATEWAY-01: talk to the hub from a messaging app, inbound** (L, design pass first, PRIVACY.md verdict before anything else). Objective: a family member outside the house sends a message from an app they already have (Telegram first, the channel `repairs.new` already notifies on; Signal and WhatsApp as later candidates) and gets the hub's reply back in the same chat, under their own rules. Shape from Hermes Agent's gateway: default deny, an allowlist, a one-time pairing code that binds one chat id to exactly one Person, so a child's chat runs under a child's rules and an unknown chat gets nothing. Design questions before a row is chunked: whether inbound chat through a vendor's servers is the same privacy class as the existing outbound notification toggle or a new one (the record must say, with PRIVACY.md's user-tier page updated either way); a catalog integration package (`runtime: deno`), never core; THIRD-PARTY-SERVICES.md in full. Out of scope: group chats (CHANNELS-01), voice notes. Exit: the design record in dev.md.
    Design: [privacy-mode-2026-09-24](plans/privacy-mode-2026-09-24.md)
- [ ] **TOOL-RESULT-TRUST-01: fetched content is data, and the bench proves it** (M, research first). Objective: text the hub fetches on a person's behalf (search snippets, `read_page`, feeds, an attached document) enters the model's context with nothing marking it as untrusted and nothing measuring whether instructions inside it steer the turn; `backend/src/lib/promptSanitize.ts` only strips line breaks and braces from a display name, and `routes/llm.ts` names prompt injection in the safety list without a tool-result path. Per RULES-AND-LEARNED-COMPONENTS.md the answer is structural or measured, never a word list: a boundary the frozen turn context declares once (tool output is quoted data, an instruction inside it is never followed), a replay bench of seeded pages that carry instructions (roster-synthetic fixtures, never a real page), the pass rate recorded in dev.md, and a learned detector only if the bench shows the boundary alone is not enough, never as the sole gate in the safety path. Mirror: CORRECTION-02's one-line contract plus replay rows. Acceptance: the bench exists with its rows and numbers; a failing row is a finding to root-cause, never a patch that makes one phrasing pass. Out of scope: model-authored skills or recipes (none exist), memory poisoning (the MEM rows). Exit: the bench and its dev.md numbers, then `bash scripts/check.sh` for any code.
    Design: [chat-engine-and-model-records-2026-10-17](design/chat-engine-and-model-records-2026-10-17.md)

## Legacy: copy, re-examine, record

The rebuild is about 23k lines of app code against legacy's 413k
(172 route files, 168 pages, 60 chat tools, 22 releases). Per principle
8 nothing carries over by existing; per the org's "copy from legacy"
allowance, hard-won logic does. The chat, memory, link, voice, limiter
and UI copy items are filed in their own sections above; this section
holds what is left: features needing a verdict, and lessons that would
otherwise be lost with the mirror.

- [ ] **SHOWS-IPTV-01: IPTV in the Shows app** (M, design first, a catalog package). Objective: the household's own IPTV subscription (an M3U or Xtream Codes account, the two formats every provider offers) plays inside the Shows app beside the library and the linear channels: a channel guide (EPG from the provider's XMLTV), live playback through the same player the app uses, favourites and per-person channel visibility (a child sees the channels a parent allowed), catch-up where the provider supports it. Rules: the credentials live in the credentials center (docs/CREDENTIALS.md), never in a URL a client sees; playback is proxied or tokenized by the hub so the provider's URL and password never reach a browser or the TV; the org's third-party-services rule applies (we are the subscriber, a person's pace, no scraping); nothing from the legacy MaiPai TV linear-channel code is a requirement, its playlist parsing and the EPG cache are the hard-won parts to read (`legacy-backups/home-legacy.git`, the MaiPai TV screens and their sources). Shipped as a catalog package (`iptv`) with a manifest, its settings keys declared once (provider type, playlist or Xtream endpoint, the account), and its UI from the kit's data-table and cards (the guide as a table, the channel as a card), nothing hand-built. Acceptance: a real provider account configured on the dev hub plays a live channel in the Shows app on the laptop and on the TV client's player, the guide shows the next two hours, a child's profile sees only the allowed channels, the password never appears in any request the browser makes (a test over the proxy route). Out of scope: recording. Exit: `bash scripts/check.sh`.
- [ ] **Verdicts for the features absent from both this file and the
      rebuild** (L, one line each, recorded here before anything is
      built) - MaiPai TV linear channels; Music Studio, karaoke and
      stems (music generation, the studio and stems are decided in
      design/music-generation-2026-10-17.md: MUSIC-GEN rows,
      MUSIC-STUDIO-01, MUSIC-GEN-12; karaoke still needs its verdict); Podcasts (with generated shows, gpodder, snips); Books,
      readers, OPDS and KOSync; Bookmarks, Reader and Clipper;
      Reference (Kiwix ZIM); the coding agent and sandbox (decided in
      design/local-coding-2026-10-17.md: redesigned, CODE rows); Remote (SSH,
      VNC, RDP); Notes and voice memos; Photo Frame; Cameras (Frigate);
      the Routines engine; Drop (file relay); Home Inventory; Maps
      (offline MapLibre plus GraphHopper); Recipes, Medical, Reverse
      Lookup, On This Day, Holidays, Moon, Local Events, Speed Test;
      File Converter; Spotlight search, Writing Tools, Watch and Listen
      Together, Cast; in-app docs; the Display/HUD pod pages; the DNS
      filter; family audio guardrails; storage locations; monitoring;
      uninstall; consent records; MCP in and out; remote engine pairing;
      SABnzbd/aria2; ESPHome flashing; the Electron desktop (HUD,
      hotkey, tray, dictation); Atom Echo and Tab5 firmware; the tvOS
      Top Shelf endpoint. Plus roughly 35 of legacy's 60 chat tools with
      no package and no line here (datetime, holidays, moonphase,
      onthisday, showtimes, recipes, medical, maps, forget,
      recall_conversations, request_media, set_status, sleep,
      service_status, machineStatus, others), and the bot's 83 skill
      classes in 55 modules (bot `dev.md` says "roughly 90").
- [ ] **WAKE-01: The wake-word training and calibration pipeline** (L; bot
      `dev.md` already plans the port, the code is where the fixed
      pipeline lives) - `train_wakeword.py` plus `wakewordTrainer.ts`:
      event-replay calibration (per-window counting picked thresholds
      that measured 40-140 false accepts per hour live), gates of at
      most one false accept per hour and recall of at least 0.85 on
      held-out real audio, the possessive near-miss bucket, harvested
      false triggers. The trained manifest v2 reached 0.00 FA/hr and 85%
      recall over 34 minutes of real audio and still fires on "hey my
      pie".
- [ ] **VOICE-LOOP-01: The bot's voice loop numbers** (M, when the voice loop is
      rebuilt) - 0.3 s pre-roll with retry from the onset byte, 6 s wake
      patience, detector reset on every sleep (the robot re-woke
      itself); Smart Turn v3.2 endpointing (threshold 0.5, 0.2 s probe
      every 0.25 s, 1.2 s ceiling, 12 s max, 120 ms per probe budget);
      barge-in (0.6 s confirm, stop phrases bypass, backchannels never
      stop, duck 0.35 without AEC and 0.75 with, 0.25 s playout slices
      because blocking writes left the mic unwatched, 0.7 s re-arm
      grace, self-echo at 0.8 overlap, interrupted text clipped from
      history); output leveling to a target RMS and a sink drain sized
      from device latency plus 0.15 s (the last second of every line
      used to be lost); the browser's barge-in thresholds
      (`useHandsFree.ts`: 700 ms arm, RMS 0.04 plus probability 0.60
      over 12 frames, legacy-only - `useHandsFree.ts` itself doesn't
      exist in this repo, only in the read-only `home-legacy.git`
      mirror). **Correction (session E step 4, 2026-09-06): the claim
      "`sentenceSpeechScheduler.stop()` exists and nothing calls it" was
      already stale** - `chatModelAdapter.ts` was calling it on every new
      turn since session B step 4 (stopping an earlier reply's speech
      when a new one starts). That's a different case from real barge-in
      though, which step 4 adds for real: `sttDictationAdapter.ts` calls
      it the moment the server's own VAD reports `speaking: true` while a
      reply is still playing, wired through the new push-to-talk mic
      button (`frontend/src/lib/voice/sttDictationAdapter.ts`,
      `sttSocket.ts`, `sttContract.ts` - a real `DictationAdapter`
      against C's frozen `WS /api/stt/stream` contract, C's route not
      shipped yet so pressing the mic fails fast and honestly rather than
      faking a transcript). **Still not built, left for whoever tackles
      the fuller hands-free loop**: wake-word detection auto-starting a
      dictation session (today the wake-word toggle only shows a
      reworded banner, deliberately not tied to the real mic button yet -
      compounding two still-partial features felt like a worse
      interaction than either alone); the re-listen-after-reply loop; and
      re-tuning the legacy RMS/probability thresholds for THIS browser
      pipeline (mic-capture.ts, a different capture path than the legacy
      hub's), which needs real held-out speech to validate against per
      this org's own training-data standards, not numbers copied in
      blind.
- [ ] **The bot's four bench harnesses** (L) - one of four shipped
      2026-09-06, Session C step 3: conversation (28 of 34 real broken
      replies - six excluded and named in
      `backend/scripts/bench/conversation.ts`'s own header, genuinely out
      of scope for a stationary hub or already covered by the routing
      corpus), rebuilt against `lib/guards.ts` directly (no model needed
      for the offline half - see docs/dev/session-c.md). Still unbuilt:
      honesty (105 questions,
      raw versus guarded), interaction (424 cases), latency (refuses to
      run on a busy machine). The plan's "bench on demand" tier
      has no benches for these three yet.
- [ ] **Lessons to record in the right doc, so they survive the mirror**
      (S) - in org `CLAUDE.md`: cache only genuine misses, never a
      transient failure; never throw synchronously inside a socket
      callback (the 7/29 three-hour outage); the age-gate inversion
      (resolving a stream through an adult account removes a platform's
      own 18+ refusal for a kid profile: gate the stream route, not the
      search), which belongs with the safety invariants; a green tick is
      never inferred from the absence of bad news (`check.sh | tail`
      once shipped a lint failure by reporting tail's exit code). In
      `home/docs/dev.md`: the laptop power path caused the hub's hard
      power-offs (GPU clock cap re-asserted hourly, charge cap 28%); the
      Windows self-update rules (Defender holds `dist/` handles past
      3 s, untracked files are not dirty, an unresolvable upstream never
      reads "up to date"); VRAM hygiene (Vulkan ignores
      `CUDA_VISIBLE_DEVICES`; a context-size mismatch between warm-up
      and the real call costs a 930 ms reload per turn); the
      chat-latency "do not change without re-testing" list (warm-up
      prefix equals chat prefix, background LLM work must yield: the
      August 15-second regression); the HTTP/1.1 six-connection cap
      shared across tabs (SSE once starved `/api/health`); 16 px inputs
      or iOS zooms, never `maximum-scale=1`. In `bot/docs/dev.md`: the
      bodies of legacy `hardware.md` (pin map, I2C and USB budget,
      PCA9685 versus the mux) and `design-decisions.md` (58 dated
      sections), which the fresh repo cites by path and does not
      contain; the driver quirks (ST7789 at 16 MHz, 40 MHz draws
      nothing; the PCA9685 driver never clears ALLCALL; the Pi 5 cannot
      drive WS2812, hence the Pico; 22.05 kHz crashed Piper on the
      array); "instruments lie" (history primed with a clock answer,
      lifetime CPU from `ps`, repeated-prompt benches hiding prompt
      evaluation).

## Portability and the link (hub <-> robot)

Design (hub side): [devices and the robot link](design/devices-and-robot-link-2026-10-17.md) (2026-10-17).

Plan chapter 7 (pairing, one oplog with HLCs, merge policies, the
never-sync allowlist, adoption) and principle 3 (every record is the
spec shape with id, provenance and clock stamp from first boot, so
pairing is a transfer, never a translation). The audit checked the code
built so far against that promise. `bot` itself is docs-only and blocked
on a spec tag that was never cut.

**Fixes (data debt already accruing)**

- [ ] **LINK-TABLES-01: A spec-or-local verdict for each hub-internal table** (M) -
      `conversation_turns`, `scheduled_jobs`, `commands`,
      `notification_deliveries`, `cloned_voices`, `model_download_jobs`
      each say "promote when the robot needs it". Plan 4.14 syncs robot
      turns as conversation records, 4.7 runs timers on both nodes, and a
      household's "when I say X" command must work on a standalone robot
      (principle 2). Promote turns, jobs and commands now; record why
      the other three stay local.
- [ ] **A Device record and `spec/link/`, spec-first** (M) - the
      envelope (`v, id, t, in_reply_to, ts_hlc, body, final`), the op
      shape (`opId, entity, entityId, upsert|delete|supersede, hlc, node,
      spec version, payload, prev`), link states, and the never-sync
      allowlist with its grep test, all in `spec/` before any transport.
      `deviceId.ts` is a plain-file stand-in; settings' device scope
      validates against nothing.
- [ ] **Sync engine decision** (design pass, L) - the research verdict:
      single-writer replicators (Litestream, LiteFS) are out; server-side
      engines (PowerSync, ElectricSQL, Turso Sync) need a database that
      is not SQLite; cr-sqlite gives column-level LWW from any language
      but calls itself not production-ready and loads a native extension
      into both runtimes. Recommendation: own a change-log table in the
      spec applied with column-level last-writer-wins by HLC, one
      algorithm in TS and Python with one fixture set, hub-authoritative
      as a policy (hub site id wins ties), memory as append-plus-
      invalidate so it never needs LWW on prose. Spike cr-sqlite first
      to validate the change-log design against a known implementation.
- [ ] **LINK-EXPORT-01: An export bundle** (M) - JSON, one file per record type,
      provenance kept; the fallback pairing path and the per-person
      export the spec already promises. Watch the W3C agent-memory
      interop group and the Agent Memory Protocol rather than adopting
      either; nothing is used widely enough to depend on.
- [ ] **Round-trip fixtures across both repos** (S, once the link exists)
      - a record written on the robot and synced to the hub is byte-
      identical to one written on the hub; the robot never translates.

## Voice / robot

- [ ] **ROBOT-UPDATE-APPLY-01 (amended): install a Bot release on a paired robot with one click, from a wheelhouse** (M, `home`, the hub half of bot RM-08; amended 2026-10-05). Amends: the install never runs `pip` against PyPI on the robot; the Bot release carries `maipai_bot-<v>-py3-none-any.whl`, its sha256, and `maipai_bot-<v>-wheelhouse-aarch64-cp312.tar` with its sha256 (bot ROBOT-WHEELHOUSE-01); the hub verifies both, pushes them over SSH, runs `pip install --no-index --find-links <dir> maipai_bot[voice,kws]`, then bot ROBOT-DAEMON-CONF-01's configuration step, then reads back every setting it wrote. Acceptance adds: a test on the stand-in SSH host that no command in the plan contains `pypi`, `index-url` or a bare `pip install <name>`; a read-back mismatch fails the install with the item named. Supersedes: the daemon's PyPI update row (ROBOT-UPDATES-01 keeps "MaiPai version" and "body software version" as detail only; BODY-DAEMON-UPDATE-01 accepted). Exit: `bash scripts/check.sh`. Cloud: no.

    **ROBOT-WHEELHOUSE-01 release-build blocker (2026-10-06):** the wheelhouse build is blocked because `reachy-mini==1.11.0` requires `PyGObject`, for which the current aarch64 CPython 3.12 resolver finds no usable wheel; building its source on this Mac fails without Cairo and `pkg-config`. Options to investigate are a compatible prebuilt PyGObject wheel source, or building the wheelhouse on a supported Linux aarch64 environment with PyGObject's native build dependencies. Do not add tooling to this Mac for this blocker. The release build must fail closed until one path is available.
- ROBOT-TAILSCALE-01 (Home hub half) is superseded by ROBOT-ENDPOINTS-01: keep only the authenticated hub-endpoints route, the `robot.offlan.tailnet` key, and its privacy page row; drop Tailscale API key minting and the stored OAuth credential (OWNER-ANSWERS 1).
- [ ] **VOICE-BROWSER-01: the voice browser** (M, owner request
      2026-09-20). Objective: wherever a person picks a voice (Settings,
      Voice; a companion's voice; a person's own voice preference), the
      picker is a things page over every voice the Stack can render,
      and every row shows the voice's friendly name, a one-tap preview
      (a fixed sample sentence rendered through the Stack's `tts` route
      and cached per voice), a one-line description, its language and
      country as a flag-free text pair, and its gender, with the filter
      column filtering by language, country, gender and source (preset,
      community, cloned). A voice the Stack does not hold yet shows
      "Download" instead of a preview and fetches on tap through the
      Stack's own downloader (never the engine's own fetch). Files:
      `frontend/src/apps/settings/` (the voice section),
      `frontend/src/apps/chat/` (the companion voice control), the
      Stack client's `voices()` call (HOME-STACK-02a), `docs/user/settings.md`.
      Mirror: the Apps page's things table (HOME-UI-02). Depends on:
      stack STACK-101 (landed 2026-09-21: the list at 6799c8a, the
      preview at 79eb703; the voice wire carries `engine`).
      Acceptance: captures at 1440 and 390 with the filters applied and a
      preview playing (the play state visible); a test that a voice with
      no metadata still lists with "unknown" values rather than being
      dropped. Out of scope: voice cloning's own flow. Exit:
      `bash scripts/check.sh` and the captures opened.
      Two owner rulings (2026-09-20 17:55): (1) the Voice section of
      Settings shows the top choices inline, a row of up to six voice
      cards (friendly name, one-line description, language, the
      preview button, the current one marked), chosen by the Stack's
      list order for the household's language, with "Browse all
      voices" opening the full browser beside them; picking a card
      sets the voice without opening the browser. (2) Every part of
      the voice UI (top choices, the browser, its filters, the preview,
      the download state) is generic over the voice engine: it reads
      only the Stack's voice list and its `engine` and `source` fields
      and never names Pocket TTS or any engine in code or copy except
      as the value of a filter chip; a second engine's voices appear
      in the same rows and cards with no UI change, and a test proves
      it with a scripted list mixing two engines.

## Robots

- [ ] **ROBOT-CLIPS-02: remaining robot clip classes and bot playback** (S; needs its own architect verdict before dispatch; after ROBOT-CLIPS-01 slice 1). Deferred: carry clips with adult-present gating; the optional offer prompt (off by default); rung 1 “It is” and digits; the dynamic status prefix; the alarm chime; the child alarm line, including its text and age-band choice; pairing-code speech rendered inside the wheel at release time; and G4b robot fetch and playback. Keep fixed text floor checks and local-only synthesis for any hub-rendered speech. Exit: `bash scripts/check.sh`. Cloud: no.
- [ ] **CAPTURE-REQ-01: the hub asks the robot for one frame inside a turn** (M, 2026-10-05; after VISION-01, ROBOT-CHANNEL-01; `bot/docs/dev/design-vision-still-image-2026-09-28.md`). Objective: when the plan asks for a frame, the hub sends `capture_request {turn_id, kind: still}` on the channel after the `signal` event has been emitted; the robot answers `POST /api/turn/{id}/frame` (the `document_attachments` shape); the `vision` role describes it; the turn continues; a child's or teen's frame is never stored and never enters the memory judge; the intent needs the plan's explicit `capture` move, never a word rule. Acceptance (fail-first): a capture request is never sent before the signal event; a frame for a child's turn is absent from every store after the turn; a request to a robot whose watch level is `off` is refused with a plain spoken line. Exit: `bash scripts/check.sh`. Cloud: no.
- [ ] **LIVE-VIEW-01: a live view of the robot through the hub only** (**hub route half landed 2026-10-16: `lib/liveView.ts`, the start, stream, stop and robot frame routes, the privacy row and `backend/tests/liveView.test.ts` 9 of 9; the robot card button landed 2026-10-16 (`RobotBody.tsx`, 3 tests in `DevicesSection.test.tsx`, `bun run screenshots --live-view-review`); still open: the bot half**) (M, 2026-10-05; Reachy design v2 section 10.4; after ROBOT-CHANNEL-01, SETTINGS-ROBOT-01; OWNER-ANSWERS 9). Objective: an admin, or an adult named in `robot.live_view.who`, opens the robot's card's live view; a child or teen never can, whoever names them, and the selector offers adults only. Off until an admin enables `robot.live_view.enabled`. The hub sends `live_view_start {view_id, fps: 5, size: 640x360}`, the robot streams JPEG frames to `/api/devices/me/stream/{view_id}`, the hub re-serves them on its own route with the kit's media parts; stop on close or 10 min. No STUN, TURN or third-party signalling. Admins watch first; two-way talk is a later item. Acceptance (fail-first): the route admits an admin and an adult named in `robot.live_view.who` and refuses every other session, including any child or teen even when named (a test per band); the view is refused while `robot.live_view.enabled` is off; a view stops within one heartbeat of the browser closing; the robot's Eyes look is cyan for the whole view (bot half asserts); the privacy page gains the row. Exit: `bash scripts/check.sh`. Cloud: no.
- [ ] **STT-SMARTTURN-01: speculative endpointing with a reopen window** (M, 2026-10-05; after STACK-VOICE-01's Smart Turn row). Objective: `sttSession.ts` gains an optional endpointer (Smart Turn v3.2, BSD-2-Clause, ONNX, CPU) with a reopen grace of 800 ms and the Silero hysteresis (384 ms open, 192 ms continue, threshold 0.6, 500 ms pre-roll), behind `stack.engines.stt.smart_turn`, off until measured; a speculative turn start is side-effect free until committed (no memory write, no tool with effects). Acceptance (fail-first): a fixture with a mid-sentence "um" pause of 600 ms does not end the utterance with the endpointer on and does with it off; a reopened turn discards the speculative run and no memory row exists for it. Exit: `bash scripts/check.sh` plus the CHAT-AB-01 spoken row. Cloud: no.
- [ ] **REALTIME-DOOR-01: an optional OpenAI-Realtime-compatible door, hub side** (L, later, 2026-10-05; Reachy design v2 section 16.1; owner's go required). Objective: a Home catalog package exposes `/v1/realtime` over the hub's own STT session and turn engine for adults' sessions on the LAN, behind `requireAuth`, treating `session.update.instructions` and `tools` as untrusted requests, carrying gate stops as `response.done {status: incomplete, reason: content_filter}` and the spoken cue as an extension event; never the way a MaiPai robot talks to the hub. When built, every turn through it is a spoken turn under rule 10's per-sentence gate and rule 5's spoken limits, adults only. Not scheduled. Cloud: no.

## Video generation (owner, 2026-10-17)

From `docs/design/video-generation-2026-10-17.md`: Wan2.2 TI2V-5B FastWan (Apache-2.0) on mlx-video (MIT); 5 s at 480p in about 130 s, 44 GB peak with aggressive tiling. Supersedes the video rows under MEDIA-HOST-02 for the engine choice.

- [x] **VIDEO-GEN-01: Stack `video-gen` engine, worker, pins and install plan** (M, Stack). `backend/src/generators/` (new `videoGen.*`), `backend/src/lib/modelCatalog.ts`, install plan, a hashed requirements file. Pin `lBroth/FastWan2.2-TI2V-5B-MLX` rev `de2998ac`, the umt5 tokenizer files and mlx-video `87db56a` with the DMD sampler and local-tokenizer patch; `HF_HUB_OFFLINE=1`. Acceptance: a 5 s 480p clip on a scratch Stack in about 130 s, zero outbound requests. Stack built and verified 2026-10-17 (Stack 1ed4e61): real clips 132 s, i2v 132 s, LoRA 168 s.
- [x] **VIDEO-GEN-02: Stack `/v1/videos/generations` job API** (M, Stack). `backend/src/lib/jobs.ts`, `backend/src/roles.ts`, routes, `/stack/v1/video`. Progress phases, cancel, 202 past the deadline, governor admission 44 GB, caps (121 frames, 832 x 480 area), tests. Stack built (1ed4e61); API in design note section 12.
- [ ] **VIDEO-GEN-03: LoRA library records and import** (M, Stack and Home). Hash, size, source, licence, base model, all-ages or adult-only flag (uncertain means adult-only), trigger words, adder; a LoRA for the wrong base is refused. Spec record first (`commons/spec`). Stack half built (1ed4e61); Home half open.
- [x] **VIDEO-GEN-04: video settings and the age and surface gate** (S, Home). `backend/src/settings/` (`video.enabled`, `video.adult_loras` default allowed, caps). Minors off, spoken surfaces, shared screens, guests and unidentified speakers get no adult-only output. **Built 2026-10-17.** Keys `generation.video.enabled` (adults, default on) and `generation.video.adult_adapters` (spec-v0.1.155, on the Pictures and videos card); children and teens are locked off with no key; the gate is `lib/videos/policy.ts` (the picture policy's age and surface half plus the video switch), used by the tool, the policy node and every route; the settings view `VideoLibrary` shows the model state, the tier limit in plain words, the three ages and the video LoRA library with audience badges and a confirm-before-on step. Tests: `videoSafety.test.ts`. The model install button is not built (open: VIDEO-GEN-04b, an install job through `/stack/v1/models`).
- [x] **VIDEO-GEN-05: Home package and chat tool** (M, Home). `backend/src/lib/packageHost.ts`, a conditional tool (rule 1 budget), `checkStorageCap` preflight, the result stored as an attachment. Architect verdict due here. **Built 2026-10-17.** Package `generate_video` (conditional, bench row `video-tool`), args prompt, `from_picture` ("latest" or an id of a picture this Stack made, bytes sent unchanged with `image_source: generated`), orientation, seconds, style, `depicts_real_person`. Refusals run at the policy node before any job exists; one clip at a time per person; a failed job never fails the answer. Home commits on branch videogen-home (on top of the image engine's IMGGEN commits): the tool, jobs and gate are `backend/src/lib/videos/`, the routes `backend/src/routes/videos.ts`, the migration 0105 `video_jobs`. Tests: `videoTool.test.ts`.
- [x] **VIDEO-GEN-06: chat video player, progress and cancel** (M, Home). `frontend/src/apps/chat/**`; `frontend/src/dev/elements-adoption.json` entry first (rule 9: kit Elements only, a video Element is a named gap). **Built 2026-10-17.** Kit Element `VideoPlayer` (ui-v0.5.244, no overrides) bound as the chat `video` part: elapsed clock, bar, Stop, busy line and place in line, then the clip with poster, controls, loop, Download, Share (opens the Library), Make another, Try again; an Animate this picture item in the More menu of a reply that made a picture. The card shows the newest clip of a turn; earlier ones stay in the Library. Tests: `chatVideo.test.tsx`.
- [x] **VIDEOSHARE-01: send a clip in a text** (S, Home and Stack). **Built 2026-10-17.** Jesse could not text the downloaded `video.mp4`. The file is a valid H.264 High yuv420p mp4 with the moov box first (it loads and plays in AVFoundation and QuickLook) but it has no audio track and was always named `video.mp4`. Share now calls the Web Share API with the real file (fetched when the card shows the clip, called inside the click) and falls back to the Library share page; Download saves a messaging copy named from the prompt (silent AAC track, title) and **Download original** keeps the exact file. The Stack makes every new clip that way (`GET /v1/videos/generations/{job}/messages.mp4`, stateless `POST /v1/videos/messages`); Home converts an older stored clip through the Stack on first request (`GET /api/videos/jobs/{id}/messages.mp4`). Tests: `videoSafety.test.ts`, `shareClip.test.ts`, `chatVideo.test.tsx`. Not verified: a real iMessage send.
- [x] **VIDEO-GEN-07: chat tool bench row and the safety review** (S). Offer rate and false offers on the CHAT-AB-01 fresh set, age and surface refusals, the household-name gate on video prompts. **Built 2026-10-17 (bench script and safety review; the CHAT-AB-01 offer-rate rows are not run).** `backend/scripts/bench/video-clip.ts` times a clip through a scratch Home: on the Studio the turn ended in about 1.1 s and the clip was on the card after about 127 to 129 s (6.9 MB). Safety matrix, absolute lines and every route are in `videoSafety.test.ts`; `code-review` at medium found nine things, all fixed.
- [ ] **VIDEO-GEN-08: verify on the Studio end to end** (S). Real clips through chat, privacy check zero outbound, memory peak recorded, the chat speed unchanged while a clip renders. **Partly verified 2026-10-17 on a scratch Stack and Home:** real chat turn "make a short video of a paper boat in the rain" through the Home chat UI (Qwen3 4B as the chat model), progress card, a 5.3 MB 832 x 480 clip in 129 s that plays in the browser (looped, 5.04 s), a reload that rebuilds the card from history, and "animate this picture" from a clip's poster (127 s, 6.6 MB, bytes accepted by the Stack's hash check). Open: privacy check of zero outbound requests, memory peak beside the live chat, chat speed while a clip renders, a generated picture as the source (the image engine was not on the scratch Stack).
- [ ] **VIDEO-GEN-09: p32 profile** (S, bench). 480p, 61 frames with the q8 community weights; until measured p16 and p32 stay off.
- [ ] **VIDEO-GEN-10: later profiles** (M). Wan2.2 A14B quality profile; Kandinsky 6.0 Lite (MIT, audio) once an MLX port exists; verify its licence file and audio weight provenance.
- [ ] **VIDEO-GEN-11: faster decode** (S, bench). The MLX Wan2.2 VAE decode is 115 s of 130 s; measure a tiny Wan2.2 decoder.
- [ ] **VIDEO-GEN-12: post-render check for the absolute lines** (M, design first). No sexual content depicting a minor or anyone who looks like one; no non-consensual imagery of an identifiable real person. A stated gap today. The owner question is **closed 2026-10-17: yes**, an adult may make a video, picture or style of a consenting household adult (LIKENESS-01, [design](design/likeness-consent-2026-10-17.md)); the post-render check itself is still open.
- [x] **VIDEO-LTX-01: Detailed videos (LTX-2.3: sound, speech, longer) beside Quick** (L, `home` and Stack). Built 2026-10-17, owner ruling "sounds like we should go with LTX, do it": two plain kinds, the same words as pictures. Quick (Wan2.2 FastWan, silent, 5 s, can start from a picture) is the default and unchanged; Detailed (LTX-2.3 22B distilled on mlx-video) makes a sound track with spoken words in the same pass, 768 x 448, up to 10 seconds, from words, with community LoRAs. Verified first: licence read in full (free under USD 10 M a year, a business above needs its own; use policy bars harming minors and impersonation, not adult content; the model's own markings must never be removed), ungated Hugging Face repos (no account), nothing bundled (an admin's computer downloads 73.6 GB: 47.1 GB LTX folder plus the 26.4 GB Gemma text encoder, 49 files by sha256, all checked against the copies measured). Measured on the Studio under the lock: 5 s in 42 to 49 s, 8 s in 65 to 69 s, 10 s in 79 to 81 s, 15 s in 110 s, MLX peak 40.4 to 43.5 GB (admission 46 GB), the exact line "Come with me if you want to live" transcribed from the soundtrack by the Stack's own speech-to-text (see design note section 14.3 for every sample, including the misses). A first run was black and silent: the shipped text-encoder mask overflowed to NaN with the pinned mlx-vlm; the worker substitutes a finite mask. Stack: `video/ltx_worker.py`, `VIDEO_SPECS` router (`model` quick or detailed, hard ceilings, `bad_seconds`, `unknown_model`, `reference_unsupported`), per-kind LoRA base detection (`wrong_base_model`), component `ltx-2-3-distilled-mlx` (optional, p128 only, `video-detailed` disk row, unchecked everywhere), licence accepted once by an admin (`licence_required`, `accepted_licence`), AAC sound copied untouched, stages and first-frame preview as Quick. Home: `lib/videos/quality.ts`, setting `generation.video_quality`, tool argument `quality` (the model sets it for talking, sound, a length past 5 s, or a custom look; a Wan style keeps Quick, an LTX style makes it Detailed; a picture always makes Quick), card `quality`, `switch_to`, `has_sound`, **Make it Detailed** or **Make it Quick**, Settings **Quick and Detailed videos** with **Get Detailed videos (74 GB)** and the licence dialog (also on Models and storage), finished-clip check on every clip (five keyframes past 6 s, the sound stored untouched), likeness consent unchanged. Tests: Home `videoQuality.test.ts`, `ageCheck.test.ts`, `VideoLibrary.test.tsx`, `ModelsAndStorageSection.test.tsx`, `chatVideo.test.tsx`; Stack `videoDetailed.test.ts` (with a gated REAL test through the job API), `components.test.ts`, `videoMessages.test.ts`. Design note section 14. Not verified: Home end to end against a Stack that has Detailed installed (the live Stack is on an older build that this ships to); the install download itself against Hugging Face (the pins were checked against fetched files, the install job against a scripted download); a model's own judgement of when to pass `detailed`; the 15 second length at the ceiling (10 s is the ceiling shipped).
- [ ] **VIDEO-LTX-02: picture to video on Detailed** (S, bench). The pinned mlx-video fails on LTX-2.3 when a picture starts the clip (`broadcast_shapes (1,1024,1,7,12) and (1,2048,1,7,12)`, `distilled` pipeline, `--image`). A picture makes a Quick clip meanwhile and the Stack refuses a picture with `detailed`. Try a newer mlx-video commit or the dev-two-stage path.
- [ ] **VIDEO-LTX-03: speech reliability** (M, bench). Exact words came out on 5 second clips (the corridor line, twice) and were partly or not understood on 8 to 15 second ones with other prompts and seeds; the judge was the Stack's tiny speech-to-text, which is weak. Find the prompt shape that holds the line (quoted speech, who says it, when), test with a stronger transcriber, and decide whether the ceiling should move past 10 seconds (15 s ran in 110 s at 43.5 GB).
- [ ] **VIDEO-LTX-04: should Detailed be the default once installed?** (owner question). Measured, Detailed is faster than Quick (42 to 49 s against 130 to 140 s for 5 seconds) and has sound; Quick keeps pictures, Apache-2.0 and the smaller download. The ruling is Quick as the default; this row only asks.
- [ ] **VIDEO-LTX-06: check what a Detailed clip says** (M, risky surface, design first). The finished-clip check is visual. Transcribe the sound track with the Stack's speech-to-text and run the words through the same minor-sexual line the prompt passes (and withhold the same way); decide what a clip with speech nobody asked for does. Until then the gap is stated in the design note.
- [ ] **VIDEO-LTX-05: LTX-2.5 and higher sizes** (S, bench). The same licence covers 2.5 (released after 2026-08-11); measure it, and 1024 x 576, before offering either.
- [x] **LIKENESS-01: pictures, videos and styles that look like a consenting household adult** (L, risky surface). Built 2026-10-17: spec-v0.1.156 (`likeness.adults`, `likeness.adult_content`, `LikenessConsent`, `LikenessUse`, `LikenessAdapter`, Account Pictures and videos section); writable only by an adult for themselves (owner or admin may only turn off); live consent check at request time and on every poll, with waiting jobs stopped and styles queued for removal on a revoke; "Who does this style look like?" in both add flows; attached photo to video (`photo_subject`), editor Comment with "Who is in this photo?", single-adult photo count by the chat model, fail closed; signed Ed25519 proofs to the Stack (Stack 612d286 and later); notification and "Likeness use" log for the subject. Tests: `likenessConsent`, `likenessUse`, `settingsCopy`, Stack `likeness`. Not built: post-render check (VIDEO-GEN-12), face-print matching of the declared subject, a kit slot for the editor's picker (Home draws it beside the Element).

- [x] **COMPONENTS-01: Models and storage (install and uninstall every component, Z-Image-Turbo included)** (M, `stack` and `home`). Stack: `GET /stack/v1/components`, `POST /{id}/install` (job `component.install`), `DELETE /{id}` (see the Stack's COMPONENTS-01). Home: Settings, Home settings, Engines and AI, **Models and storage** (`ModelsAndStorageSection.tsx`, `/api/components`, owner and admin only): rows with size, state, last use and what uses it, Install and Uninstall with the plain confirmation, the room left from the Stack's disk plan, progress on the row and on the install strip (`installStatus.background`, which never gates chat or voice), failures as the Stack's Repairs item with Try again. Z-Image-Turbo (33 GB) is optional and unchecked by default in the wizard plan (the disk plan's `pictures-zimage` row) and installable here.

## Image engine (2026-10-17)

Engine decision and bench: [docs/design/image-engine-2026-10-17.md](design/image-engine-2026-10-17.md) (Klein 4B default on mflux/MLX, Z-Image-Turbo and SDXL-Lightning for the larger adapter libraries, Klein reference edit for Comment and Erase). The person-facing half is [image-generation-2026-10-17.md](design/image-generation-2026-10-17.md) (PICTURES-01 to 05; its rows are the Home side, these are the Stack and engine side). Supersedes the ComfyUI-on-the-Mac parts of IMAGE-01, IMAGE-02 and MEDIA-HOST-01. Adults get adult-only LoRAs by default; the two absolute lines (no sexual content with minors or minor-looking subjects, no non-consensual imagery of a real person) and every age and surface gate stay (RULES.md rules 0 and 10, SAFETY.md). Rows are in build order.

- [x] **IMGGEN-STACK-01: the image engine and its install plan** (M, `stack`; first). Objective: a managed `image-gen` uv environment (mflux 0.23.0, Pillow below 13, hashed requirements), a JSON-lines worker that loads one model at a time (`flux2-klein-4b` 8-bit and 4-bit, `z-image-turbo` 8-bit), reports per-step progress, unloads after `generation.keep_warm_minutes`, runs offline after the weights are pinned; SDXL-Lightning through the pinned sd.cpp `sd-server` binary by sha256 with `--lora-apply-mode at_runtime`. Files: `backend/src/generators/imageGen.ts` and `imagegen_worker.py` (new, beside `comfyui.ts`), `imagegen.darwin-arm64.requirements.txt`, `lib/engineCatalog.ts`, `lib/modelCatalog.ts` (pins with revision and sha256, licence text recorded), `lib/installPlan.ts`. Mirror: the image-tools worker (IMGTOOLS-01). Acceptance: on a scratch Stack one 1024 px picture through `/v1/images/generations` with time and peak recorded against the note's table (Klein 8-bit 4.0 s warm, 13.5 GB), governor admission and a plain 503 when it does not fit, the worker exits on idle and returns its memory, a `HF_HUB_OFFLINE=1` run passes. Exit: `bash scripts/check.sh` in the Stack; check first that no test calls real `launchctl` on `com.maipai.*`. Built 2026-10-17 in Stack d3c4fab: `backend/src/images/`, Klein 4B and Z-Image-Turbo pinned per file, `image-gen` environment, on-demand worker (10 idle minutes), `POST /stack/v1/image/install`, `GET /stack/v1/image`, the `image` role state. Real run: 1024 px Klein 8-bit 4.2 s warm, 13.5 GB peak. Open: Z-Image-Turbo first real run, SDXL-Lightning on sd.cpp (p16 is off, p32 runs Klein at 4-bit unmeasured).
- [x] **IMGGEN-STACK-02: the job API with LoRA, size, seed, steps and image to image** (M, `stack`; after IMGGEN-STACK-01). Objective: the additive fields in section 9 of the note (`model`, `size`, `n`, `seed`, `steps`, `loras [{sha256, scale}]`, `init_image`, `strength`, `preview`), queue position, percent from the step callback, a preview frame on the job, cancel of a queued job at once and of a running one between steps, 202 past the deadline, jobs grouped by model and LoRA set. Files: `routes/v1.ts` (`ImageRequestSchema`), `lib/jobs.ts`, `generators/imageGen.ts`, `docs/api/openapi.json`. Acceptance: tests with a scripted worker for queue, cancel of a queued and a running job (prove the interrupt), 202, a 422 for a LoRA that is missing or for another base; a real run with the pixel-art LoRA matches the note (3.7 to 4.4 s). Out of scope: the edit routes (IMGGEN-EDIT-01). Built in Stack d3c4fab (see Stack API as built in the note). Open: the stepwise preview frame.
- [x] **IMGGEN-EDIT-01: generative edit and masked edit jobs** (M, `stack`; after IMGGEN-STACK-02; the Stack half of IMGTOOLS-05's open Comment). Objective: `POST /v1/images/edits` operations `edit` (instruction plus one to three reference images) and `edit_masked` (`mask`, `feather`, `region`) on Klein at bf16, the result composited through the feathered mask so pixels outside it are unchanged; crop-and-paste for a small region. Files: `generators/imageGen.ts`, `routes/v1.ts`, the image-tools route file. Acceptance: pixels outside the mask are bit-identical on three real pictures, Comment-style and Erase-style tests against the note's five edits (8.4 s warm), a decision recorded on sd.cpp's native inpaint as fallback, size limits and 413 and 422 answers like the other edits. Built in Stack d3c4fab: `edit` and `edit_masked`; real run 5.1 s mask removal, 0 differing pixels outside the mask and feather ring.
- [x] **MINOR-FLOORS-01: shared obfuscation normaliser and viewer-aware picture floors** (M, risky surface; blocks teen and child generation). Built 2026-10-17 from the CSAM audit: one normaliser in commons `spec/safety/ts/fold.ts` (spec-v0.1.168) behind both `detectCsam` and `pictures/minorLine.ts`; `decideAgeCheck(..., viewer)` withholds anything nude or sexual for a teen or child and fails closed; `screenInputImage` screens photos this home did not make before edit, video or reference (words about a child refuse); a teen or child who trips the word floor reads one friendly line and the admins are told (rate limited); `tests/safetyFloorsSettings.test.ts` flips every household setting. **Known gaps (not blockers):** chat-vision uploads are not age-screened at input; image-search results are not pixel-screened for child and teen viewers; a prompt wholly in a script with no list (Thai, Hebrew, Devanagari and others) is judged only by the finished-picture check; no measured false-negative rate on real content.
- [ ] **IMGGEN-LORA-01: the adapter library, files and add flow** (M, `stack` then `home`; after PICTURES-01 for the `adapter` record). Objective: adapter files under the Stack's `data/loras/<sha256>.safetensors` via the download job with `kind: lora`; the add flow by Hugging Face URL, CivitAI URL or upload with the safetensors header read; audience classification from the file's own metadata plus the adder's answer (unclear is `adult_only`); refusal of likeness-of-a-real-person adapters and of declared minor or child subjects; the list route filtered by the caller's band and surface (an adult-only id never reaches a minor, a spoken turn, a glance or shared screen, a guest). Files: `stack/backend/src/routes/models.ts`, `backend/src/routes/adapters.ts`, `backend/src/lib/adapters.ts`. Acceptance: tests for each band and surface, hash mismatch refused, a LoRA for an uninstalled base shows "needs <model>", logs hold counts only (rule 6a). The adult-only audience stays off until IMGGEN-SAFE-01 lands. Stack half built in d3c4fab (library, add by file, path or Hugging Face link, base from tensors, audience lock, likeness and minor refusals, unbaked application; real LoRA effect shown). Home half (the adapter record, who may use which, the add flow) open. **Home half built 2026-10-17** with IMGGEN-SET-01: the household switch per style (`picture_adapter_prefs`), the audience filter, trigger words added by Home, the add flow. The Stack half is on stack main.
- [ ] **IMGGEN-HOME-01: the picture tool and the Stack handoff** (M, `home` backend; the engine half of PICTURES-02, which is IMAGE-02 extended; after IMGGEN-STACK-02). Objective: a conditional picture tool offered only on a turn that earns it (own bench row, never above 16 tools, rule 1), arguments chosen by the person or the model, trigger words added from the adapter record, the job run through the executor with per-person consent and the adult unlock, the picture stored as a `file` with the `generation` provenance record (model, steps, seed, adapter ids; never prompt text in logs). Files: `backend/packages/pictures/manifest.json`, `backend/src/lib/turnMachine/nodes/policy.ts` and `tool.ts`, `backend/src/lib/stackClient.ts`. Acceptance: SAFETY.md's generation invariants asserted (child blocked until an adult unlocks; every picture passes the output safety path; no identifiable-person path), the tool-offer bench row, a failed render still answers (rule 6). **Built 2026-10-17** (`b811e670`, review fixes `da86aca8`): bundled package `backend/packages/generate_image` (conditional offer, gate `picturesAllowed`, bench row `picture-tool` still to run), `backend/src/lib/pictures/{policy,stack,jobStore,jobs,tool,adapters,ready}.ts`, table `picture_jobs` (migration 0104, memory only in a temporary chat), the tool is offered only to an adult on their own written screen with a picture model installed; the policy node refuses a child, teen, guest, spoken, glance or TV turn and the two absolute lines before any job starts; a job stores the Stack bytes unchanged (`picture-gen:` provenance); a failed job never fails the answer (the card holds the line). Not built: "make it sunnier" on the last picture by chat words alone (Edit, Comment covers it), the tool-offer bench row.
- [ ] **IMGGEN-UI-01: queued and step progress in the chat blocks** (S, `home` frontend; with IMGGEN-HOME-01). Objective: the shipped `image-generation` Element shows queued and step progress (the numeric progress gap is collapsed into its running state until upstream adds a prop) and hands the finished file to the `image` Element; Edit already opens the built editor. Files: `frontend/src/dev/elementBindings.ts`, `frontend/src/dev/elements-adoption.json`. Acceptance: browser flow with a real render; no className override, no wrapper (rule 9). **Built 2026-10-17**: two tool-call parts per picture turn, `picture_progress` (kit `JobProgress`: the engine's line, elapsed seconds, Stop) and `picture` (kit `ImageGallery` with Edit, or `ErrorState` with Try again), plus Make a variation in the reply's More menu; data from `GET /api/pictures/jobs/:id`. No commons change was needed for the card. Step preview frames came with GENPREVIEW-01.
- [x] **GENPREVIEW-01: live previews, stages and time left on the picture and video cards** (M, Home with the Stack and the kit). Built 2026-10-17. Pictures: the Stack draws a 256 px preview after each step (blurred to sharp in the kit card, +3 percent worker time); video: real stages with a progress fraction, the time left from the median of earlier clips, and the clip's first frame as soon as the motion is done (+1 percent). Home carries them on the existing job card routes (`stage_label`, `eta_seconds`, `step`, `steps`, `preview_url`, owner-only `/api/pictures/jobs/{id}/preview` and `/api/videos/jobs/{id}/preview`), in memory only (`lib/genLive.ts`); kit `ui-v0.5.250` (`GenerationStage`, `previewSrc`, `etaLabel`). Notes: `docs/design/image-engine-2026-10-17.md` (Live previews) and `video-generation-2026-10-17.md`. Tests: `backend/tests/pictureSafety.test.ts`, `videoSafety.test.ts`, `frontend/src/apps/chat/chatPictureCard.test.tsx`, `chatVideo.test.tsx`, `frontend/src/lib/etaLabel.test.ts`.
- [ ] **IMGGEN-EDITOR-01: Comment in the built editor** (M, `home` frontend and backend; after IMGGEN-EDIT-01; closes IMGTOOLS-05's open Comment). Objective: in the kit `ImageEditor` (Markup, Remove BG, Erase, Resize, zoom, download and share already work) the person clicks a point or paints a region, types the change, and an `edit_masked` job runs; the result lands as a new version with the existing undo. `/api/image-edit` replaces its "Picture creation isn't set up yet" answer and the status route reports the generative edit; Erase offers LaMa first and Klein for complex fills. Files: `backend/src/routes/imageEdit.ts`, `backend/src/lib/imageEdit.ts`, a kit `ImageEditor` Comment mode in `commons` ui if the Element lacks one (kit change first, rule 9c). Acceptance: browser flow on a real picture for Comment and Erase; age and surface gates unchanged; the editor never opens for a child without an adult unlock. **Built 2026-10-17** (kit `ui-v0.5.245`: `onComment(request, ctl)` may return `pending`): Comment sends `edit_masked` with the pointed-at region (or `edit` for the whole picture) to the Stack, polls it, previews and applies as a new version, Stop reaches the engine; gated like picture making, the two lines apply, an uploaded photo is never changed by an undressing request. Not built: Erase by description on Klein (LaMa stays the eraser).
- [ ] **IMGGEN-SET-01: the engine controls on the Pictures settings page** (S, `home`; with PICTURES-04). Objective: `generation.keep_warm_minutes` (default 10), `generation.adult_adapters` (household, admin only, default `allowed`), who may add adapters (admins by default), model install and removal with the Stack's fit verdict and plain download size; copy through `describeSetting`. Files: spec `areas.json` and the settings registry (spec first), `backend/src/settings/**`. Acceptance: a child cannot reach it; an adult-only adapter's example is never drawn for a person who cannot use it; COPY-LINT-01 passes. **Built 2026-10-17** (spec `spec-v0.1.154`): Home settings, Pictures and videos: keys `generation.adults` and `generation.adult_adapters`, the view `home.pictures_library` (picture model status and install, children and teens shown locked off, the style library with licence, size, age badge, switch, remove, and add by Hugging Face link or file with the licence box, the not-a-real-person box, "not sure means adults only" and a fingerprint confirmation before a new style is switched on). Not built: `generation.keep_warm_minutes`, who may add styles (admins only today), CivitAI links (the Stack takes Hugging Face and files).
- [ ] **IMGGEN-SAFE-01: safety gating review and the finished-picture check** (M, risky surface; blocks the adult-only audience). Objective: the prompt passes `detectCsam` for everyone before queueing; a two-pass apparent-age check on finished pictures made with adult-only adapters or from sexual prompts through the Stack's vision role (the `screenImage` pattern), discarding failures with a plain message, as a learned component under `docs/RULES-AND-LEARNED-COMPONENTS.md` with measured false-positive and false-negative rows; the adapter add refusals; a test matrix of band by surface by adapter audience; architect verdict on both notes and `code-review` at medium. Files: `commons` `spec/safety/ts/signals.ts`, `backend/src/lib/contentCeiling.ts`, `backend/src/lib/adapters.ts`, `backend/tests/imageGeneration*.test.ts`. Acceptance: no minor, spoken, glance, shared or guest path reaches an adult-only adapter; full `check.sh`. Owner questions open: a consenting household member's likeness adapter (SAFETY.md); accepting SDXL's Open RAIL++ licence for the small tier. **Partly built 2026-10-17**: `backend/tests/pictureSafety.test.ts` (band by surface by adapter audience, the chat tool, the routes, trigger words, the absolute lines), `backend/src/lib/pictures/policy.ts`, a medium `code-review` of both safety commits with every finding fixed. **Finished-output check built 2026-10-17** (owner policy: adults get adult content; the absolute line is nothing sexual involving a minor or a minor-looking person): `backend/src/lib/pictures/ageCheck.ts` (one policy module: when it runs, the strict prompt, the verdict, `decideAgeCheck`, the fixed refusal lines, the safety event), `keyframes.ts` and `keyframes.swift` (three keyframes of a clip), wired into `pictures/jobs.ts` and `videos/jobs.ts` before anything is stored; the resident chat model reads a 768 px copy with no EXIF through the Stack's chat route, nothing leaves the computer; an adult-only job that cannot be checked is withheld, an ordinary one passes; a withheld picture or clip is never stored, the Stack copy is deleted, admins get `safety.picture_withheld` with no image; tests in `backend/tests/ageCheck.test.ts` (decision on scripted verdicts, parsing, the jobs); calibration on innocuous pictures, 8 of 8 as expected (design note `image-engine-2026-10-17.md` section 15, `backend/scripts/agecheck-calibrate.ts`). **Still open:** a measured false-negative rate on real adult content with a minor-looking subject (no explicit image was made or looked at); a per-person strike counter (none exists in Home; the log holds the prompt hash); the learned-component rows in `docs/RULES-AND-LEARNED-COMPONENTS.md` need the owner's labelled set; turning pictures on for a minor stays the owner's decision.
- [ ] **IMGGEN-BENCH-01: the follow-up image benches** (M, bench; replaces the Mac half of IMAGE-BENCH-01). Objective: what the first bench left open: cold-disk first picture, Z-Image-Turbo 4-bit on p64, SDXL-Lightning inside the Stack worker with LoRAs at `at_runtime`, Qwen-Image-Edit-2511 and Z-Image base against Klein on the five edits, a chat first-token measurement while an image job runs (the governor must keep chat responsive), a three-job queue, mflux's interrupt latency. Files: `stack/scripts/bench/image-*.ts` (from the scratchpad `bench/` scripts), a table in `stack/docs/dev.md`. Acceptance: one table with engine build, model file and revision, a sanitized hardware line, time and peak per row.
- [x] **IMGGEN-DEFAULT-01: Klein is the default picture model on every tier; Z-Image-Turbo is the advanced choice** (S, `stack` and `home`). Owner ruling 2026-10-17 (reverses the same day's first ruling, which made Z-Image-Turbo the p128 default; Stack `dee922c` reverts it): plain picture requests stay fast (Klein, about 4 s); Z-Image-Turbo (13 to 30 s, 8,913 CivitAI LoRAs against Klein 205, measured) is optional in the disk plan (unchecked, the Recommended plan stays about 89 GB) and is chosen by name or automatically by a LoRA made for it. Kept from the first pass: LoRA base detection reads Civitai-style files; Home Settings, Pictures and videos adds "A file already on this computer" (a path the Stack reads; 69 percent of popular Z-Image LoRAs are over the 120 MB a form carries). The person-facing choice (Quick or Detailed) is IMGGEN-QUALITY-01. Design note section 16.
- [x] **IMGGEN-QUALITY-01: Quick or Detailed, one plain choice for pictures** (M, `home` and kit `ui-v0.5.255`). Built 2026-10-17, owner ask: users choose the slower, richer maker on the fly in chat and in settings, simply and without fear. Quick (Klein, the default) and Detailed (Z-Image-Turbo); no model name outside **Details**. Setting `generation.picture_quality` (household select, default Quick; Home-declared in `settings/pictureKeys.ts`); tool argument `quality` (the model sets `detailed` only for best quality, photoreal or a custom look and says so in one line; Detailed not installed makes a Quick picture and the model tells how an admin gets it); a style decides its own maker (a Z-Image style makes the picture Detailed with a note, a Klein style stays Quick); the card's `quality` and `switch_to` and the kit `ImageGallery` `actions` give **Make it Detailed** or **Make it Quick** (`POST /api/pictures/jobs/{id}/variation` takes `{ quality }`); Settings, Pictures and videos: the Picture quality row, **What is the difference?**, **Get Detailed pictures (size)** through the existing install job, **Details**. Design note section 17. Tests: `backend/tests/pictureQuality.test.ts`, `chatPictureCard.test.tsx`, `PicturesLibrary.test.tsx`, kit `image-gallery.test.tsx`. Spec first is still owed: `generation.picture_quality` is in `scripts/settings-ahead-of-spec.json` until a `commons` spec tag carries the key (then delete it there). Pins moved to `spec-v0.1.163` and `ui-v0.5.255`. Not verified: a real Detailed picture end to end on the live Studio (needs the bench lock), the model's own judgement of when to pass `detailed` (no bench row yet), Get Detailed through the real Stack install job.
- [ ] **IMGGEN-ZIT-P64: Z-Image-Turbo on a 64 GB computer** (S, bench, `stack`; on the GPU lock). Objective: measure 4-bit and 8-bit peak (load and steady separately), load time and warm 1024 px seconds with the chat model resident; then make Detailed available on p64 or record why not. Today p64 offers Quick only.
- [ ] **IMGGEN-SDXL-01: anime and illustration model (Illustrious XL / NoobAI)** (L, `stack` then `home`; needs the owner to accept the licence). Objective: the SDXL family holds the largest CivitAI LoRA libraries (each 3,000+ models, capped count) and has no engine here. Build the sd.cpp worker (`--lora-apply-mode at_runtime`, 4-step Lightning or DMD2), an optional "Pictures: anime and illustration" row in Models and storage, base detection that accepts SDXL-family files only when it is installed, and the licence question (Fair AI Public License share-alike on derivative models) put to Jesse. Never the default.
- [ ] **IMGGEN-CHROMA-01: bench Chroma1-HD when mflux supports it** (S, bench). Objective: CivitAI has 1,105 Chroma LoRAs and the card says it has no safety filter (Apache-2.0, 8.9B); it is not in mflux 0.23's model list. Measure speed and memory on this Mac through any runtime that loads it, then decide whether it is the uncensored second model instead of Illustrious.

## News app (2026-10-17)

Design: [news-app-2026-10-17.md](design/news-app-2026-10-17.md) (architect record `NEWS-APP-2026-10-17`). The News app is the shelf's screen: a Today feed with a hero and an editorial hierarchy, topic and source channels, following, My Mix computed on the hub, saved stories, the one reader, Key points by the local model, Listen through the local TTS, two passive notifications, offline from the shelf; teens and adults get the full app and a child may open it on the Kids' lists only (Jesse, 2026-10-17: every string through the child output gate, no My Mix, no outbound link, approvals through the existing `approvals` table). It supersedes the feeds plan's unfiled `NEWS-APP-01`. KS-06 (stories) is a dependency the app does not wait for.

- [ ] **NEWS-00: spec for the News app** (S, lands in `getmaipai/commons` `spec/`; after APP-KIND-01). Objective: the design note's section 7, additive only: `Feed` gains `kind`, `site_url`, `icon_ref`, `topics_hint`, `list_id`, `alerts`; `NewsItem` gains `topics`, `image_url`, `image_ref`, `content_ref`, `content_source`, `reading_s`, `author`; `NewsStory` gains `lead_item_id`, `topics`, `image_ref`, `summary`, `summary_band`, `summary_at`; new person-scope records `NewsInterest`, `NewsSave`, `NewsRead` with id, provenance and hlc; `spec/news/topics.json` (ten topics, `kids` offered to the child band); settings keys `news.my_mix`, `news.reader_open`, `news.digest`, `news.images`, `news.image_cache_mb`, `news.full_text_prefetch` with spec copy; the `news` manifest's pages, `data[]`, widget fields and `notifications[]`; answer-block kinds `story_feed` and `article` with `ArticleBlock` moved into spec plus an additive `quote` member; five UI schema changes (`actions` map on `answer_blocks`, a `tabs` node, `item_media_field` and `row_toggle` on `list`, `state` on `navigate`); an optional per-page `min_role` on `contributes.pages[]` (the role enum `owner`, `admin`, `adult`, `teen`, `child`, `guest`, copied from HOME-PAGE-01's widget field, defaulting to the package's, raising only), with the data ids and actions each naming their page; fixtures `spec/ui/pages/news-{today,following,story}.json`, the Zod mirror. Mirror: KS-00's additive fields on `Source` and the `weather_card` block kind. Reuse check: the three existing news records and the existing shelf keys are extended, no second record or key; `topics.json` follows `feed-lists.json`'s shape. **Landed 2026-10-17 in three tags: part 1 spec-v0.1.158 (the per-page `min_role`, the raise-only lint; Home: `pageVisibleTo`, `appRouteAllowed`, `appImageAllowed` in `backend/src/lib/apps.ts` on the page route, `GET /api/apps` and the data route; NEWS-02 must call `appRouteAllowed` and `appImageAllowed` from the action and image routes); part 2 spec-v0.1.159 (the `story_feed` and `article` block kinds, `article_block` with `quote`, the `tabs` node, `list` `item_media_field` and `row_toggle`, the `answer_blocks` `actions` map, `navigate` `state`, `contributes.data[].rows: "list"`, the three News page fixtures, `checkAppPackage` for tabs, list and actions); part 3 spec-v0.1.160 (the Feed, NewsItem and NewsStory additions, `NewsInterest`, `NewsSave`, `NewsRead`, `validateNewsInterest`, `news/topics.json`). Remaining in this row: the six settings keys (with Home's registry declarations, in NEWS-02), and the `news` manifest's widget fields `hero`, `data`, `surfaces`, `priority` and `min_role` (they wait for HOME-PAGE-01's manifest fields). Data ids are `household-today` (plain names, no underscore).** Acceptance: ajv accepts the fixtures and every existing fixture unchanged; `catalog.test.ts` green; a child-band `NewsInterest` with `inferred: true` is refused by `validate.ts`; a page `min_role` outside the enum (`member`) is refused; one tag cut and Home's pin bumped. Out of scope: any Home code. Exit: commons `bash scripts/check.sh`. **Review of the per-page `min_role` (2026-10-17):** medium code-review run twice on the visibility change; an independent reviewer tried to bypass it as a child and a guest and found four real gaps (direct `POST /api/plugins/:id/run`, the media-app gate, `GET /api/plugins` listing raised pages and data, a stale app cache stamp) plus the shared-module alias; all closed with the attacks kept as permanent tests in `backend/tests/appsFloors.test.ts`. Open by design: NEWS-02's action and image routes must call `appRouteAllowed` and `appImageAllowed` and add their cases there; `GET /api/plugins` still returns a package's `settings_area` whole (unchanged from before).
- [x] **NEWS-01: the two kit primitives, `StoryFeed` and `ArticleView`, and the Reference page's hand-drawn reader retired** (M, `getmaipai/commons` `ui/` then one `home` slice; after NEWS-00 and APP-KIND-02; Jesse approved the two UI-DECISIONS rows `StoryFeed` and `ArticleView` on 2026-10-17 (rule 9b, design note decision 1c); built 2026-10-17). Objective: `ui/src/primitives/StoryFeed.tsx` draws the `story_feed` block kind (layouts `today`, `channel`, `rows`: one hero at span 8 over two rows, two featured stacked beside it, two at half width, a horizontal shelf, thumbnail rows; one column under 640, two to 960) from `Card` with `CardAction`, `AspectRatio`, `Badge`, `RelativeTime`, `DropdownMenu`, `Item`, `Skeleton` and `Empty`, tokens only, firing the `answer_blocks` node's `actions` map; `ui/src/primitives/ArticleView.tsx` draws the `article` block kind (kicker, headline, byline, action row, figure, Key points, the `ArticleBlock` list with per-band link rules, "Also covering"); both registered in `ui/src/elements/answer-block.tsx`; the `tabs` node and the `list` additions rendered. Then in Home: `frontend/src/shell/pages/ReferencePage.tsx` draws its article through `ArticleView` and `ArticleContent` (line 27) is deleted, its behaviours (heading ids and the table of contents, plain-text links for a child, figures only when allowed, the licence and snapshot line) ported first (RULES rule 12). Mirror: `ui/src/elements/answer-block.tsx` and the `weather-card` Element; `primitives/MediaShelf.tsx`. Reuse check: `answer_blocks` is reused as the one rich-content path; `CardGrid` has no hierarchy, `MediaShelf` is one row, `MarkdownText` draws markdown not a typed block list; nothing shipped places a hero on the 12-column grid. Acceptance: gallery captures at 1440 and 390, light and dark, opened and judged; no horizontal overflow at 390; a child-band article renders every link as plain text; the Reference page's existing tests pass against `ArticleView` and `ArticleContent` no longer exists; rule-9 lints pass; a new tag and Home pin bump. Out of scope: data, ranking. Exit: commons `bash scripts/check.sh`, then Home `bash scripts/check.sh --pre` plus the Reference page tests. **Done 2026-10-17:** commons ui-v0.5.251 and ui-v0.5.252 (`StoryFeed`, `ArticleView`, the `answer_blocks` `news` handler, the `tabs` node, `list` media and toggle, the actions map, `navigate` state; judged captures at 1280 and 390 in light and dark, no horizontal overflow at 390, a child's copy renders every link as plain text). Home: `ReferencePage` draws its article through `ArticleView`, `ArticleContent` is deleted, its behaviours covered by the existing Reference tests plus two new ones. Not done here: the Listen player (the `play` action has no interpreter yet, NEWS-04).
- [ ] **NEWS-02: the hub's News data: topics, pictures, records, routes, ranking** (M, `home` backend; after NEWS-00, APP-KIND-03; KS-05 landed). Objective: the idle step `news.shelf.topics` (embed role against `topics.json`, one embedding shared with KS-06); the picture route `GET /api/plugins/news/images/:item?w=480|1280` that fetches the feed's own `image_url` through `guardedFetch` on the first request for an item (never in the background), resizes to 1280 and 480 WebP, LRU to `news.image_cache_mb`, 14 days unused, and serves the cache after; stores for `NewsInterest`, `NewsSave`, `NewsRead` under the person-forget rule; `POST /api/plugins/news/data/{today,mix,channel,story,household-today}` returning the app-kind `{as_of, blocks, degraded?}` with one `story_feed` or `article` block through `filterAnswerBlocks()`, and `{topics,sources,saved}` returning the bare `Row[]` the `list` node binds (the note's additive exception); `household-today` takes no person and returns nothing in a household with a child profile; the page `min_role` check (landed in NEWS-00 part 1: `pageVisibleTo`, `appRouteAllowed`, `appImageAllowed` in `backend/src/lib/apps.ts`) on the new action and image routes; `POST /api/plugins/news/data/search` (state `{q, filters}`: title, dek, source and topic match, topics and sources as channels, Saved first through `group`, filters topic, source, date and Saved only, every result through `releaseShelfItems`, a child's over the Kids' lists only with no recents) with the `NewsSearchRecent` store (last five per person, the forget rule, no query in any log line), and `/actions/{follow,save,read,feedback,reset_mix,summarize}`, every list through `releaseShelfItems`; `rankStories()` in `today` mode (freshness half-life 8 h, coverage, picture, followed channel; hero with a picture; one per publisher and two per topic among the featured); the landed `extractFullArticle()` given a news link mode (outbound `href`s kept for teens and adults, `allowLinks` false for a child) with Loki Doki's `contentQuality` rules ported (400 characters, keep the better copy, failures remembered 30 minutes); the `story` route runs the child output gate sentence by sentence over `blocks` and `speech[]` for a child, including each card's read-aloud text (kid mode), built on the hub from gated strings. Files: `backend/src/lib/shelf/`, `backend/src/lib/news/` (new), `backend/src/routes/plugins.ts`. Mirror: `shelf/shelfNews.ts` for the read path, `lib/answerImages/cache.ts` for the picture cache, `lib/favicons.ts` for the fetch-once-then-cache shape and the sweep, `routes/widgets.ts` for the data route. Reuse check: feedsmith, `fetchCache.ts`, `extractFullArticle` (linkedom), `guardedFetch`, `filterAnswerBlocks`, the embed role and `StreamGate` are reused; hand-written code is `rankStories`, the topics step, the picture route and the stores, because nothing shipped ranks or classifies. Acceptance: tests per role and band (child, teen, adult, guest): a guest gets no app, page, data, action or image, and a child gets none of My Mix (page `min_role: teen`) or its ids; a child's `today` holds only Kids'-list items, no `mix`, no inferred interest row is ever written for a child, no publisher address ever appears in a response body as an image source, no picture is fetched before a screen asks for it (a seeded shelf of 500 items and no request leaves the picture cache empty), the picture route checks both `appImageAllowed` and that the item is in the asker's `releaseShelfItems` set (a child cannot fetch an adults-only item's picture by id; architect note 2026-10-17), the picture route stops that host on a 429, every block-returning data route's body validates as `{as_of, blocks, degraded?}` and every list id's as a row array, `story` for a child drops a sentence the gate fails from both `blocks` and `speech[]`, no log line carries a title, URL or person id, and no `continue`, `progress` or `filters` field appears in `household-today` or for a viewer below the page floor. Out of scope: My Mix mode (NEWS-05), summaries and Listen (NEWS-04). Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files. **NEWS-02a built (2026-10-17, migration 0110):** the three person stores, `backend/src/routes/newsRoutes.ts` (data, actions `follow/save/read/feedback/reset_mix`, picture route), `lib/news/` (cards, article, child gate, picture cache), `news.images` and `news.image_cache_mb` declared ahead of the spec, the feed picture address kept at ingest, `pageHtml` split from `searxngPageRead`. Not in 02a: the topics step, `summarize`, My Mix ranking (NEWS-05), a card read-aloud field (needs a spec field), feed-carried article text.
- [ ] **NEWS-03: the News app package** (M, `getmaipai/catalog` then Home's bundled copy; after NEWS-01, NEWS-02, NEWS-LOOK-02, APP-KIND-04). Objective: `pages/{index,mix,following,saved,channel,story,search}.json` (the Search page at the package's `child` floor, opened from a header box on Today and My Mix) built only from `page`, `section`, `answer_blocks` (kinds `story_feed` and `article`, with the `actions` map), `tabs`, `list` (with `item_media_field`, `row_toggle`, `batch`), `picker`, `search` and `empty_state`; the five child-visible pages at the package's `min_role: child` with Kids'-list sources only (Jesse's decision 1 of the design note, 2026-10-17) and My Mix at `min_role: teen`; the child look and gated read-aloud from the kid-mode note section 9.5; `contributes.settings_area` with the shelf matrix and feed boxes moved from the Search area (SETTINGS.md rule 1) plus the person keys; the `headlines` widget gains `hero: true`, `data: "today"`, `surfaces: ["home"]`, `priority: 40` (below Weather's hero), `min_role: "teen"`; `offline: "degraded"`; README, CHANGELOG and the privacy rows for pictures and opened pages; `docs/user/news.md` and the `news-shelf.md` settings path updated. Mirror: APP-KIND-05 (the Weather app). Reuse check: schema pages and kit blocks only; the app writes no component, no chrome and no CSS. Acceptance: the app opens from the library at `/apps/news` for children (Kids' lists), teens and adults; one test covers a guest on every page, every `/data/<id>`, every `/actions/<action>` and the image route (404 or 403, never data) and on `GET /api/apps`, not pages only, and a child on `mix` and the ids only it uses; a child's Today, Following, Channel, Story and Saved open and hold Kids'-list items only; the test lists every data id and action the pages reference and fails on any id My Mix uses that a child can reach (an id the page walker misses falls back to the package floor `child`, architect note 2026-10-17: use absolute `/api/plugins/news/...` call targets only); the Home widget draws the same `story_feed` block through `answer_blocks`; captures at 1440 and 390, light and dark, per band, generated against the seeded household, opened and judged; the rail renders (S3); `lint:ui-rules` shows no new override or wrapper; the privacy page gains its rows in the same commit. Out of scope: Key points, Listen, My Mix, notifications. Exit: catalog check plus `bash scripts/check.sh --pre` and the tests beside the changed files.
- [ ] **NEWS-04: Key points and Listen** (M, `home`; after NEWS-03 and AUDIO-SESSION-01). Objective: `news.shelf.summaries` on the idle queue (chat role, no tools, thinking off, the band's content ceiling, the top 24 stories per band per tick, one request in flight, skipped while a turn runs) and on demand through `actions/summarize`; stored per story and band on `NewsStory.summary`, floored before storage and at release; the line "Written on this hub from the article"; Listen through `POST /api/tts` in `speech[]` chunks on the shell's docked bar (the kit `Player` mini layout, with the "Paragraph N of M" label, step buttons and speed chip asked of MEDIA-PLAYER-01 and AUDIO-SESSION-01, the design note's section 6a row 22; this extends AUDIO-SESSION-01's docked bar to News as the second kind of app that owns it, drawn only inside News, audio continuing when the person leaves) with pause, resume, "paragraph N of M" and the resume point in `NewsRead.read_s`; "Also covering this story" from the cluster; Key points text joins the Search match once summaries exist. Mirror: the conversation summary writer for the model call, `useArticleNarration.ts` (Loki Doki, ported batching and resume point). Reuse check: the existing TTS route, player bar and output gate; no new model, no browser storage. Acceptance: a child's Key points appear only when the summary passed the child floor; a failed summary leaves the story readable (rule 6); the resume point carries to a second device; a 4,000-character chunk boundary falls on a paragraph; tests per band. Out of scope: any voice choice. Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files.
- [ ] **NEWS-05: My Mix** (S, `home`; after NEWS-03). Objective: affinity per `NewsInterest` from the person's own `NewsRead` rows (open 1, finish 2, save 3, More like this 3, Less like this minus 3, 30-day half-life, normalized), recomputed nightly and after each read; `rankStories` `mix` mode (`channel = 1 + affinity`, Less like this halves a story's score for 30 days, diversity caps kept); Reset My Mix; `news.my_mix` hides the tab; a ranking bench on a seeded week (source and topic diversity of the top ten, a persona's replayed reads) recorded in the design note before the weights are final. Mirror: `followUpSuggestions.ts` for a person-scoped computed signal. Reuse check: no model call; a heuristic the person can read and reset replaces Loki Doki's per-item LLM scorer. Acceptance: a child never gets `mix` and never has an inferred row; a teen's default is on; Reset deletes every inferred row and clears feedback; an admin page shows no interest, read or save of anyone (rule 6a test). Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files and the bench row. Implementation in the NEWS-05 worktree: local affinity, nightly and read refresh, mix ranking, reset, opt-out, per-band and admin-isolation tests, and seeded bench recorded in the design note. NEWS-03 package-page and settings-area integration and route-suite verification remain pending; preflight was excluded by the task's narrow-test limit.
- [ ] **NEWS-06: the two News notifications and the chat answer's action** (S, `getmaipai/commons` then `home`; after NEWS-03). Objective: `news.digest` (passive, person, the household's digest times, on for adults and teens, off for a child until a parent turns it on) and `news.followed_story` (passive, person, once per story when `publisher_count` reaches 3), both `privacy: true` with an `Open` action; the `news` tool's answer gains `Open in News` for teens and adults. Today `news` has no `TOOL_BINDINGS` entry in `frontend/src/apps/chat/elementBindings.ts`, so its result draws as plain text with `ToolFallback`, which has no action slot: commons first (rule 9c), pick the kit Element that draws a headline list, add an additive `actions` prop to it with a tag, bump Home's pin, then bind `news` to it in `TOOL_BINDINGS`; no Home wrapper. Mirror: `remind` and `timer` manifests' declarations, the Stack bridge's repeat key. Reuse check: the declared notification system; nothing bespoke. Acceptance: a digest never reaches a shared screen; a child with `news.digest` off gets nothing; the repeat key fires `followed_story` once per story; the admin log shows what fired with no headline text. Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files.
- [ ] **NEWS-07: background full text under the owner's exception** (S, `home`; after NEWS-04). Objective: `news.full_text_prefetch` (household, off by default) runs the one reader in the background for items on a person's followed channels or the Today top set, one fetch per item ever, one every 30 seconds and 150 a day per site, robots respected, quiet mode on the first block, the owner's written exception of 2026-09-24 recorded in `THIRD-PARTY-SERVICES.md` with these numbers and this row; the setting's help states them. Mirror: the shelf poller's pacing and quiet window. Reuse check: `fetchCache.ts` and the limiter; no new fetcher. Acceptance: a bench shows the per-site caps hold over a simulated day; with the setting off no page is fetched outside a person's open; a child's prefetched text still passes the child cleaning at release. Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files.
- [ ] **NEWS-08: shared screens and Go** (S each, `home` and `go`; after NEWS-03 and APP-KIND-06; a household with a child profile waits on Jesse's decision 1b). Objective: a second widget `headlines_tv` (`surfaces: ["tv"]`, bound to the household-only `household-today` data id, since a widget binds one data id and the Home `headlines` widget's `today` is per person) (names no person, home-page section 7's `tv` rule), offered only in a household with no child profile, draws the Today hero and featured four in TV density, rotates the hero through the top eight after 30 seconds idle (12 seconds a story), opens the TV reader with Listen as the default action, at the household band (adult, or teen when a teen profile exists) with no follows, saves or mix; Go renders `story_feed` and `article` natively and caches saved stories for reading away from home. Mirror: HOME-PAGE's `surfaces` filter, the Weather app's TV row. Reuse check: the same `GET /api/widgets?surface=tv` and data routes; no second format (Loki Doki's tvOS text format is dropped). Acceptance: a household with a child profile gets no News card on a TV or pod; no per-person data in any TV response (no `continue`, `progress`, `filters` or recents); a `household-search` data id for the shared-screen search (field, Topic and Source filters, households with no child profile only); Go renders the fixture page. Exit: `bash scripts/check.sh --pre` plus the tests beside the changed files; Go's own check.
- [x] **NEWS-LOOK-01: the News app in the media apps' look (design only)** (S, `home` docs; Jesse, 2026-10-17). Objective: the News mockup rewritten in the media apps mockup's frame (design bar, rail with News active, drawer, tab pills, dark and light tokens, shelf and card rhythm, a Listen dock like the media docked player, kid mode, TV), and the design note's section 6a "Look and feel: the media family" with the deliberate differences and their reasons (news design wins where reading, scanning, search or browsing needs it), sections 6, 16 and 20 adjusted, a Supersedes line, the architect's verdict. Includes News's own search box (header box, results view with topic, source, date and Saved-only filters, recent searches, at phone, desktop and TV): Jesse ruled in chat 2026-10-17 ("yes like chat does"); RULES.md S2 clarified in ff643159 (`Owner-approved: 2026-10-17`). Done 2026-10-17: `docs/design/assets/news-app-2026-10-17.html` and `docs/design/news-app-2026-10-17.md`.
- [ ] **NEWS-LOOK-02: the kit changes the media-family look needs** (M, `getmaipai/commons` `spec/` then `ui/`, then one Home pin bump; after NEWS-01 (done) and NEWS-LOOK-01; before NEWS-03's captures). Objective: rows 1 to 21 of the design note's section 6a kit table on `StoryFeed` and `ArticleView`. Spec first (`commons/spec`, one tag, fixtures and the Zod mirror): optional `group` on a story row, `filters` and a `filter` action on `story_feed`, `reading_s` and `progress` on `news_story_card` (`reading_s` already exists on `NewsItem`), `continue` on `story_feed`; each field needs its own architect read first (rule 9c). Then `ui/`: tokens (`--kicker` with a darker light value, `--story-hero-ratio`, `--story-thumb-w`, `--font-size-reading`, `--line-height-reading`, `--measure-reading` with child and TV values, `--font-size-article-title`, `--article-lead-ratio`), variants (dense rows, the opened muted headline, the picture-placed badge, the Key points panel, the quote, a source avatar), an `aside` slot on `ArticleView` at 1000 px and the props for the spec fields. Row 22 (the Listen dock: a "Paragraph N of M" label, step buttons and a speed chip on the kit `Player` mini layout and the shell's docked bar) is requested of MEDIA-PLAYER-01 and AUDIO-SESSION-01 and built by NEWS-04; News draws no dock. Adopts, adds no parallel token: ui-v0.5.257's `--art-*` and `--progress-accent` tokens, `MediaShelf` (`getProgress`, `renderBadge`, `renderMeta`) and the exported `MediaTileOverlay` for the shelf and picture overlays, `Button variant="inverse"` for Listen, the `DropdownMenuContent` container; not `Billboard`. Mirror: `MediaShelf.tsx`, the media apps mockup for the numbers. Reuse check: the shipped `Card`, `Item`, `Avatar`, `Badge`, `Button` link variant and the MediaShelf tile; no new primitive, no Home wrapper, no `className` override (rule 9). Acceptance: gallery captures at 1440 and 390, light and dark, opened and judged next to the News mockup and the media gallery; no horizontal overflow at 390; a child's card has no outlet count or time and no `filters`, `continue` row of another person or `progress` field appears in `household-today`, a TV response or for a viewer below the page floor; `lint:ui-rules` clean. Search (row 23 of the kit table): spec adds the `search` schema node and the person-scope `NewsSearchRecent` record, `ui/` generalizes the kit's `ThreadSearch` Element (chat's thread search) to a searchable item with filter chips and a recents slot, reusing the dense row; chat's own use is unchanged (its tests pass untouched). Out of scope: data routes (NEWS-02 builds `search`, NEWS-03 the page), ranking, Listen playback (NEWS-04). Exit: commons `bash scripts/check.sh`, then Home `bash scripts/check.sh --pre`.
- [x] **ROBUST-01: the AI restarts itself and says so** (M, `stack` then `home`). Incident 2026-10-17: chat and embed died at 14:48Z and stayed down about 1.5 hours; chat was paused (CHAT-PAUSE-01), so no request ever reached the Stack to start them again, and nobody was told. Stack half (getmaipai/stack 154564d): the supervisor restarts a crashed engine with backoff, a circuit breaker, a verified restart, a cause classifier and a sweep for a role that is offline with no process. Home half: `lib/stackSelfHeal.ts` polls the Stack every 30 s; one admin Notification per restart (`stack.engine_healed`, once per incident, once per engine per 10 minutes); Stack silent for 2 minutes is a Repairs warning plus the `stack.restarting` notification ("The AI stopped and is restarting itself"), 6 minutes turns the same item into an error ("The AI could not restart itself: open Repairs"), resolved when the Stack answers; the Status page line "Engines crashed N times today" from `engine_crashes` on `GET /api/status/history`. Home cannot restart launchd, so its one safe act is dropping its cached connection. No new banner. Tests: `src/lib/stackSelfHeal.test.ts`. Unverified: a live crash on the Mac Studio; the Notification wording in the app. <!-- prose-lint: allow -->

## Local coding (2026-10-17)

Design: [local-coding-2026-10-17.md](design/local-coding-2026-10-17.md) (architect item `CODE-DESIGN-01`; plain words in [the overview](design/local-coding-overview-2026-10-17.md)). An admin turns Coding on (off by default, adults only, never a guest, a minor never in this version); each allowed person makes personal API keys for Claude Code, Codex CLI, OpenCode, Aider, Continue and Cline through `/code/v1` (Anthropic Messages and OpenAI wires served natively by the Stack's llama-server); the Code app copies Claude Code on the web with one Apple-container VM per session, OpenCode as the agent, no internet by default, git only on the hub. Coding model: Qwen3.6-35B-A3B on p128 (Qwen3.8-27B as Careful), Qwen3.8-27B IQ3 on p64, none below. Carries the coding half of ENGINE-HOST-05 and the Stack's STACK-60 and STACK-61.

- [ ] **CODE-SPEC-01: the coding records, keys and areas in spec** (S, `getmaipai/commons` `spec/`; first). Objective: the design note's section 4, additive: `api-key`, `coding-session`, `coding-environment`, `coding-event`, `git-connection` schemas with fixtures (roster personas), the `coding.*` settings keys of 4.4 with copy, the `home` and `account` `coding` sections in `areas.json`, the `code` cell on `use:<package>` in `grant-actions.json` (child and teen `never`), notification types `coding.session_done`, `coding.needs_you` and `coding.workspace_expiring`, the `coding` data class, the schema nodes `agent_thread`, `code_changes`, `terminal_log` in `ui/schema.json`. Mirror: the MUSIC-SPEC-01 slice. Reuse check: no key record exists; the hub's `person_api_tokens` shape is extended, not copied. Out of scope: any Home code. Exit: commons `scripts/check.sh`, tag under the commons-tag lock, Home pin bump per `docs/PINNING.md`, `bash scripts/check.sh --pre`.
- [ ] **CODE-BENCH-01: the coding model bench on the Studio** (M, bench, on the GPU lock; not in the gate). Objective: the note's section 10: candidates, engine numbers at 4k, 32k and 100k, peak memory beside the residents, chat first-token p95 idle versus during a coding loop (bar: within 10 percent), 200 tool calls per wire, LOCALCODER-LIFT-01's ten S and three M briefs at pass^3; the default confirmed or flipped by the stated rule. Files: `stack/scripts/bench/`, a report under `docs/reports/`. Out of scope: changing a pin. Exit: the report with every number and command line.
- [ ] **CODE-STACK-01: the coding role gets its own model, process and wires** (M, `stack`; after CODE-SPEC-01 and CODE-BENCH-01). Objective: `coding` bound per tier (p128 Fast and Careful, p64 the IQ3 27B, `notAvailable` on p16 and p32), its own llama-server process on demand with a lease and `coding.keep_warm_minutes` idle unload, 2 slots on p128, q8_0 KV, 128k window, sampling from the model card in the catalog record; `/v1/messages`, `/v1/messages/count_tokens`, `/v1/responses` when the pinned build serves it, and `GET /v1/models` for the role (closes STACK-60 and STACK-61). Governor: an idle coding engine yields to a generator job; a busy one makes it wait; residents never evicted. Reuse check: llama-server's native wires; no translating proxy. Exit: Stack `bash scripts/check.sh` plus a scripted-engine test per wire.
- [ ] **CODE-KEYS-01: one personal key store with scopes** (M, `home`; risky surface: credentials and a migration; after CODE-SPEC-01). Objective: `api_keys` replaces `person_api_tokens` (migration keeps each token as a `turn` key named "Voice and Home Assistant"), `maipai_<id>_<secret>`, HMAC-SHA256 under `secret_pepper`, constant-time compare, expiry required, up to 10 per person, rename, revoke, `suspended` while the person may not code, last use for the owner only; `requireApiKey(scope)` replaces `requireApiToken` in `routes/openai.ts` and Wyoming; a gitleaks rule for the prefix. Files: `backend/src/lib/apiToken.ts` (becomes `apiKeys.ts`), `db/schema.ts` plus one migration, `middleware/auth.ts`, `routes/settings.ts`. Out of scope: the coding gateway. Exit: full `bash scripts/check.sh` under the machine lock, `code-review` at medium.
- [ ] **CODE-API-01: the coding gateway at /code/v1** (M, `home`; risky surface: auth; after CODE-KEYS-01 and CODE-STACK-01). Objective: section 3.6: HTTPS only, home-network or (with `coding.api.away`) tailnet sources only, refused through a public URL; the gate chain per request (key, scope, person, Adult controls now, coding on and not paused, `coding.who` or `use:code`, rate, streams, daily tokens); the safety floor in and out; client sampling dropped; a fair queue per person; `/code/v1/models` from the Stack record; typed household events only (rule 6a). Acceptance: Claude Code, OpenCode and Aider each complete a scripted edit against a scratch Stack on ports 8893 to 8898; a teen's key and a guest are refused; a paused household answers 503. Exit: full `bash scripts/check.sh`.
- [ ] **CODE-API-02: Codex CLI** (S; after CODE-API-01). Objective: verify the pinned llama-server serves `/v1/responses` with tools and streaming; wire and verify Codex CLI end to end, or record it as not served and hide its tab. Exit: `bash scripts/check.sh --pre` plus the gateway tests.
- [ ] **CODE-SET-01: the Coding settings and the keys screen** (M, `home` frontend; after CODE-KEYS-01). Objective: section 3.1 and 3.2: the admin Coding section (switches, who, limits with static help lines from the Stack's admission figures and a link to the Status page, network, away, Stop all coding now), a person's Coding section (keys table, create with the copy-once dialog, connect tabs with snippets and the home certificate, git connections), the admin's "Coding access" row on a person's Family page (kind, status, created, expiry, key hint; Revoke and Revoke all; no names, hosts or use, rule 6a). Kit primitives only (rule 9b), copy through `describeSetting`. Exit: `bash scripts/check.sh --pre`, the frontend tests beside the change, captures at 390 and 1440 opened and judged.
- [ ] **CODE-SANDBOX-01: the sandbox service** (M, `stack`; 01a spike, 01b build; after CODE-SPEC-01). Objective: 01a proves on the Studio that an Apple `container` VM per session can run with a host-only network that reaches only the gateway and the egress proxy (not the LAN, Home's port, the Stack's port or the internet), or records the pf-anchor fallback; 01b builds `/stack/v1/sandboxes`: the pinned image (Ubuntu 24.04, the toolchain list, OpenCode), per-session CPU, memory and disk limits, governor admission, the tinyproxy egress allowlist (CONNECT only, no header injection) and the fixed V1 and adult-site deny list, APFS-clone snapshots, idle stop, cleanup. Reuse check: Apple's runtime, tinyproxy; Colima as the recorded fallback. Exit: Stack `bash scripts/check.sh` plus the 01a escape tests.
- [ ] **CODE-GIT-01: git connections and host-side git** (M, `home`; risky surface: credentials; after CODE-KEYS-01). Objective: GitHub and Gitea connections per person (fine-grained token or device flow) as write-only secrets with status, expiry and revoke; hub folder repositories under household storage; clone before the agent starts and push after the person's click, credentials through a credential helper in the child environment, only to `maipai/...`, no force, delete or tag push; pull requests through the GitHub and Gitea REST APIs. Exit: full `bash scripts/check.sh`, `code-review` at medium.
- [ ] **CODE-KIT-01: the kit gaps for live code views** (M, `getmaipai/commons` `ui/`; after CODE-SPEC-01). Objective: section 6's five gaps (`FileTree` selection and live mode, diff line comments and compare label, `TerminalBlock` streaming, a `CodeView` part over the Shiki highlighter, the three schema nodes) with ELEMENTS-DECISIONS rows first. Exit: commons check, new tag, Home pin bump.
- [ ] **CODE-AGENT-01: Code sessions and the agent bridge** (M, `home` backend; after CODE-SANDBOX-01, CODE-API-01, CODE-GIT-01). Objective: the session lifecycle, OpenCode events to message parts, modes and the plan bar, approvals and host requests, the message queue, Stop, checkpoints, the wall-clock budget, gitleaks before Push and pull request, the person's audit trail (`coding-event`), the credential redaction on stored transcripts. Exit: `bash scripts/check.sh --pre` plus tests with a fake agent and a fake sandbox.
- [ ] **CODE-APP-01: the Code app package** (M, `getmaipai/catalog` then Home's bundled copy; after CODE-AGENT-01 and CODE-KIT-01). Objective: sessions list, new session, session view with Changes, Files, Terminal and Plan, phone and desktop layouts of section 3.3, hidden when coding is off or not allowed. Exit: catalog check, then `bash scripts/check.sh --pre`; captures at 390 and 1440 against the seeded demo household, opened and judged.
- [ ] **CODE-NOTIFY-01: coding status on the existing surfaces** (S; after CODE-AGENT-01). Objective: the three notification types, a `coding` concern in `lib/roleHealth.ts` read by the Code app's composer line, `coding.paused` beside `lib/chatPause.ts`, a coding row on the Status page through `lib/statusApps.ts` (sessions running, the model busy, idle or unloaded, its memory; counts only, rule 6a), the Stack's coding health on Status and Repairs (rule S6: no new surface). Exit: `bash scripts/check.sh --pre` plus the tests beside the change.
- [ ] **CODE-SAFE-01: coding safety review** (M; risky surface: safety; after CODE-AGENT-01). Objective: section 8: an injection fixture repository (nothing leaves, nothing pushes), egress tests per policy, minors and guests refused on both doors, a key never widens after a controls change, the kill switch stops every sandbox and the API, the floor on the API in and out. Exit: full `bash scripts/check.sh`, `code-review` at medium.
- [ ] **CODE-PRIVACY-01: privacy rows and user docs for coding** (S; with each slice that adds a connection). Objective: the rows of section 5 on the privacy page in the same commits, the admin and person user pages, the connect screen's per-tool lines. Exit: `bash scripts/check.sh --docs`.
- [ ] **CODE-SHARE-01: share a session with one household adult** (S, later). Read-only snapshot from the session menu; never a public link.
- [ ] **CODE-ATTACH-01: continue a session in the terminal** (S, later). Verify OpenCode's attach command against a session behind the gateway, then offer it on "Open on your computer".
- [ ] **CODE-LINUX-01: the sandbox service on Linux hubs** (M, later). Podman rootless with gVisor as the first candidate, the same Stack service.
- [ ] **CODE-NETSECRET-01: private registry secrets the agent never sees** (M, later; design pass first). A proxy that opens TLS for one allowed host with a certificate the sandbox trusts (Squid ssl-bump or mitmproxy, licence and maintenance read first) to add a registry token as a header; each secret with status, expiry and revoke on the admin's Coding access row.
- [ ] **CODE-TEEN-01: learn to code for teens** (M, stretch; design pass first). The Code app only, a parent's grant, no internet, starter projects, the teen's gate on all prose, thinking off.
