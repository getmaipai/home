# Stack, Home and Catalog: who owns what, how far off we are, and the plan (2026-11-16)

Design review and plan. Read only: nothing is committed and no code was changed. Every file and line is from `origin/main` of each repo, read on the Mac Studio on 2026-11-16. The first draft of this report was written on a smaller model during the conversation; this version is the full re-check on Fable, and section 2 lists what the re-check corrected. The portable apps question has its own report: [portable-apps-and-catalog-review-2026-11-16.md](portable-apps-and-catalog-review-2026-11-16.md).

## 1. Bottom line

1. **The direction is right, and we are closer than the first draft said.** The Stack already has a job queue, a memory governor, a whole-computer memory watchdog, health items with fix actions, an event feed, engine updates with rollback and a model update check. The work is mostly consolidation and deletion, not invention.
2. **The real defect is copies.** Model pins (url, sha256, size) exist in three repos: the Catalog (`models/index.json`), the Stack (`modelCatalog.ts`) and Home (`modelCatalog.ts`). The Stack serves six overlapping lists of the same parts. Home decides memory fit in parallel with the Stack.
3. **Home pins what the Stack installs.** Today Home sends the download url and sha256 to the Stack on install. That is the opposite of the rule and the first thing to fix.
4. **Machine classes are deeper than labels.** `p16` to `p128` decide which roles exist at all, which chat model binds and the working margin. Replacing them with one budget is right, and it is the riskiest Stack change. It needs a parity test.
5. **The queue should not move wholesale.** The Stack decides whether and when a job can run. Home decides whose job goes first. Home passes a priority number and an opaque group with each job.
6. **Size:** about 24 small briefs in 8 phases, Stack and Catalog first. Your three decisions are recorded in section 8.

## 2. What the re-check corrected in the first draft

| First draft said | The code says | Effect on the plan |
|---|---|---|
| Add a new `GET /stack/v1/models` | That route exists (`stack/backend/src/app.ts:155`): installed and known models, install, remove, load, catalog | The new list is `/stack/v1/parts`; the old routes are deleted, not kept beside it |
| Home calls install by id | Home sends `url` and `sha256` in the install body (`home/backend/src/lib/stack/client.ts:207`, used at `chatModelSwitch.ts:99`, `routes/engines.ts:271`, `setup/checks/setupDownloads.ts:85`; accepted by `stack/backend/src/routes/models.ts:32`) | Install becomes id only. The caller never supplies a pin |
| Move the queue from Home to the Stack | The Stack has its own queue (`lib/jobs.ts`, 535 lines: per-role queues, one generator at a time, position, a cap) and admission (`lib/admission.ts`, `governor.ts` 1,289 lines). Home's `jobs/householdQueue.ts` (640) orders by people: class weights, aging, fair share, per-person limit, a child's daily cap (`jobs/jobScore.ts`) | Two layers stay, with a clean line: resources in the Stack, people in Home |
| Home runs its own llama-server | Chat goes through the Stack. `llmSupervisor.ts` throws "Home runs chat through the MaiPai Stack" unless a developer env override is set (lines 449-568). No launch service on the Studio sets that override | It is leftover code with 15 importers, plus `engineCatalog.ts` (118 lines, Home's own engine pins) and `modelDownloadJobs.ts` (289). Delete all three |
| Model pins live in the Stack and Home | Also in the Catalog: `catalog/models/index.json` and `engines/index.json`, signed and published, and read by the Stack's update check (`stack/backend/src/updates/catalog.ts`) | The one definition should be Catalog data; see 3b |
| Classes are tags on parts | `stack/backend/src/profiles.ts` sets resident, on-demand and not-available roles per class and binds the chat model per class (lines 20-85); `governor.ts:40-43` sets the working margin per class | Deleting classes needs a planner that derives all three from the budget |
| The Stack lacks a status read | It has `/health`, `/memory`, `/jobs`, `/hardware/budget`, `/events`, `/engines/self-heal` | `status` is a composed view, small |
| Updates need building | `routes/updates.ts` already reports installed and available per engine and per model and applies and rolls back engines | Only model apply and a flag on each row are missing |

## 3. The design

### 3a. The line

| Owner | Owns | Never holds |
|---|---|---|
| **Catalog** | The signed data: every installable part (models, tools, engines) with its name, description, files, url, sha256, size, licence id, measured peaks. Every package | Running state, household choices |
| **Stack** | Every action and every runtime fact: install, uninstall, update, enable, what fits, what is loaded, what is running or waiting, what is wrong, how big the budget is | People, age, households, wording for people |
| **Home** | People, age and surface gates, the household's choices (order, on or off, budget percent, priority policy), wording, notifications, drawing what the Stack serves | Model names, descriptions, urls, sha256, sizes, fit math, health logic, engine processes |

The Stack has no users, so Home tells it the audience (`adult` or `minor`) on each read and each job, and the Stack enforces it.

### 3b. One definition of a part, as Catalog data

A **part** is anything the Stack installs and runs: a model, a tool (sharpener, background removal, stem splitter, wake word, listening), or an engine (llama.cpp, the picture runner, a Python environment). One record shape in `commons/spec`, one source file in the Catalog, one signed published index. The Stack pins a Catalog tag at build (the same way it pins `@maipai/spec`), so a fresh install works offline, and reads a newer signed index only when update checks are on.

```ts
interface Part {                    // commons/spec, source in catalog/parts/index.json
  id: string;                       // opaque key; never shown, never parsed
  kind: "model" | "tool" | "engine";
  category: string;                 // "chat" | "pictures" | "video" | "music" | "voice" | "restore" | "stems" | ...
  priority: number;                 // shipped order within the category, 1 first
  label: string;                    // true name, adults only
  neutral_label: string;            // what a child or teen is served
  description: string;              // one plain line
  adult_only: boolean;
  version: string;                  // revision or build tag
  files: { url: string; sha256: string; bytes: number; path?: string }[];
  licence: { name: string; notice_id: string | null };   // id only; text lives in the accept flow
  runner: string;                   // the engine part that runs it; the Stack refuses a runner it does not have
  requires: string[];               // other part ids (an engine, a text encoder)
  builds?: { tier: "standard" | "boost" | "max"; options: Record<string, unknown> }[];
  peaks: { options: Record<string, unknown>; bytes: number; status: "measured" | "unverified"; measured_on?: string }[];
  min_stack: string;
}
```

Why the Catalog and not Stack code: the update check already reads the Catalog; a new revision of a model is then data and needs no Stack release; and one signed file replaces three hand-kept copies. A new model family still needs runner code in the Stack, which `runner` and `min_stack` make explicit.

No machine class appears in the record. No field says which household prefers what.

### 3c. What Home reads and sends

One list. It replaces `/models`, `/models/catalog`, `/components`, `/tiers/candidates`, `/capabilities` and `/install-plan` as lists of parts.

```ts
GET /stack/v1/parts?audience=adult|minor&kind=&category=
-> { parts: {
     id; kind; category; priority; label; description;      // minor: neutral label, empty description, adult_only rows absent
     enabled: boolean;
     state: "ready" | "missing" | "installing" | "updating" | "failed" | "unsupported";
     size_bytes; download_bytes; percent: number | null;
     fits: { standard: boolean; boost: boolean; max: boolean; reason: string | null };
     can_install; install_block: string | null; can_uninstall; uninstall_block: string | null;
     licence_needed: boolean; required_by: string[];
     update: { available: boolean; version: string | null } }[] }

POST   /stack/v1/parts/{id}/install      // id only. No url, no sha256 from the caller
DELETE /stack/v1/parts/{id}
POST   /stack/v1/parts/{id}/update       // stage, verify, swap, check, roll back on failure
POST   /stack/v1/parts/{id}/rollback
PUT    /stack/v1/parts/choices           // { category: { order: string[]; off: string[] } }, sent by Home when the household changes it
```

Generation routes take an optional `part` id and `audience`. The Stack refuses a part that is not installed, is off, or is not allowed for the audience, with a plain reason. With no `part`, the Stack uses the first enabled part in the household order, then the shipped priority.

Home knows four things about a part: category, the id plus the name to print, the description, and the priority. Plus the state it draws.

### 3d. The household's choice: one store

Home's household settings, one key per category: `engines.<category>.choices = { order: string[]; off: string[] }`, empty by default. Empty means the shipped priority with everything on. Priority 1 is the Primary, 2 is the Secondary; "try the other model" and the word-check retry use priority 2. Home is the settings master and pushes the value to the Stack; the Stack never stores a household. Nothing about any household goes into a repo, a default or a migration. Engines have no switch: the Stack turns an engine on when an enabled part requires it.

### 3e. Sizing: one budget, no classes

One setting, `memory.budget_percent` (1 to 100), drawn by Home as a slider in plain words. The Stack turns it into bytes, limited by the hardware ceiling (total memory minus the OS margin, and the Metal limit). 50% of 128 GB and 100% of 64 GB are then the same budget and get the same fit answers.

Three things today depend on the class and must come from the budget instead:
1. **Which parts can ever run:** peak for the chosen options against the tier's share of the budget (the existing 0.6, 0.85, 1.0 in `tiers.ts:65`).
2. **What stays resident and what loads on demand:** take required parts in priority order until the resident share is full; the rest are on demand; a part that can never fit is "unsupported" with a reason.
3. **The working margin:** a continuous function of the budget in place of four steps (today 4, 8, 12 and 20 GB at 16, 32, 64 and 128 GB, which is 25% falling to 16%).

A second, live check stays at job start: budget minus what is loaded and what the rest of the computer uses (the governor's `admissionRoomBytes`, `governor.ts:377`). `GET /stack/v1/sizing?percent=N` previews the result in plain lines before the person saves. Speed is served separately from measured timings, because equal budgets are not equal machines.

### 3f. Jobs, memory and the queue

- **Stack:** one queue, admission, pausing heavy work for chat and voice (`heavyGate.ts`), reclaim, closing apps to make room, the watchdog. A job submit gains two fields: `priority` (a number) and `group` (an opaque key). The Stack orders by priority, then age, with a fair share across groups.
- **Home:** computes the priority from household policy (`resources.priority`, `resources.strict.*`, a child's daily cap) and uses the person's id, hashed, as the group. It shows the Stack's position, reason and estimate, and sends notifications.
- **Deleted from Home:** `jobs/liveFit.ts` (192 lines), `admissionFit.ts` (90), `profileTable.ts` (49), `profileSource.ts` (75), `closeApps.ts` (102), `resourceGovernor.ts` (197), `computerMemory.ts` (30). `householdQueue.ts` shrinks to the scoring and the mirror of Stack job states.

### 3g. Status

`GET /stack/v1/status` composes what exists: health (`ok`, `degraded`, `down`, `updating`), running and waiting counts, what holds memory, memory pressure, the jobs, and a `problems` list with a plain cause and a fix for each. Home draws it and keeps health logic only for its own database, its own jobs and the link to the Stack. Only Home can say "the Stack is not answering".

### 3h. Video without Wan, and children's video done properly

Owner ruling 2026-11-16: no Wan. Second ruling the same day: removing the sound for children is a poor fix and is not built; solve it properly.

Why children and teens are on Wan today: the check on a finished clip only looks at the picture. It does not listen. LTX-2.5 can speak, so a clip could say something a child should not hear and nothing would catch it (`docs/design/video-tiers-2026-11-02.md:50-52`). So yes, the worry is what is said.

The proper fix already has a backlog row, **VIDEO-LTX-06** (`docs/BACKLOG.md:3112`, open, risky surface): transcribe the clip's sound track with the Stack's speech-to-text and run the words through the same child and teen line that the prompt and written replies pass, and withhold the clip the same way. With that in place children and teens use LTX-2.5 with sound, checked.

Order (port before delete, rule 12): VIDEO-LTX-06 ships first, then children and teens move to LTX-2.5, then Wan is deleted. Until then the children's lane stays exactly as it is, and Wan is hidden from every adult list.

### 3i. A Stack with no Home

Possible after this work, because Home becomes one caller of a complete API. It needs: Stack-issued keys with scopes in place of Home's single token (`requestGuard.ts:7-38`), a `maipai-stack` command line that makes the same calls Home makes, a network bind that is off by default and needs a key, its own installer and updater, and the CSAM block inside the Stack because a stand-alone run has no age gates. It stays without an interface. Worth doing small; not worth competing with general chat servers. Decision 2 in section 8.

### 3j. Clean break

Each brief deletes what it replaces in the same landing. No alias lists, no "new key else old key", no branches for an older Stack (`home/backend/src/lib/stack/client.ts` has several "absent on older Stacks" paths), no legacy tables. Old setting keys are removed by one migration that writes no household value. Ids that name files already on disk stay, because they are opaque keys. A stored id that no longer exists is simply not found. The Stack and Home ship as a pair, and the contract goes public only after the break.

## 4. How far off we are

**Stack (closest).** Has the runtime. Off by: six overlapping part lists and five name tables (`tiers.ts:33-62` candidates, `components.ts:213-249` labels, `components.ts:115` disk rows, `modelCatalog.ts` pins, `profiles.ts:82-85` bindings); install by caller-supplied pin (`routes/models.ts:32`); classes in about 160 places (`modelCatalog.ts` 75 mentions, `tiers.ts` 28, `components.ts` 21, `diskPlan.ts` 11, `profiles.ts`, `supervisor.ts:2087`, `governor.ts:40-43`, `updates/catalog.ts:22`); no audience; no enable switch; no model update apply; Wan still present (`tiers.ts:49`, `components.ts:247`); one shared token and loopback only.

**Catalog (data is there, shape is old).** `models/index.json` and `engines/index.json` exist and are signed, but carry `profile` classes, no label, description, priority, kind or peaks, and cover only the Stack's shipped chat pins. The README still says "pre-code" while 13 packages and the tooling exist.

**Home (furthest).** It holds:
- A second model catalog with urls and sha256: `backend/src/lib/modelCatalog.ts` (682 lines; line 142 says it mirrors the Stack's pin).
- Engine pins and download jobs of its own: `lib/engineCatalog.ts`, `lib/modelDownloadJobs.ts`, `lib/llmSupervisor.ts` (672), `lib/engineAutotune.ts` (159).
- Music pins: `lib/music/models.ts:11-18`.
- A hidden helper catalog with names and Stack ids: `routes/aiChoices.ts:138-148`.
- Model identity in control flow: `lib/videos/quality.ts:11-22,95,136,176` (the `wan | ltx25 | ltx25max | h3` union), `videos/tool.ts:272-302`, `videos/slotBody.ts:15-20,49-101`, `videos/ready.ts:40-72`, `routes/videos.ts:121,188-203`, `lib/companionArt.ts:46-63`, `lib/pictures/quality.ts:9,11`, `lib/pictures/lane.ts:101-108`, `lib/tiers.ts:140`.
- Names shown to people: `lib/media/videoCreateApp.ts:300`, `frontend/src/shell/installWords.ts:41-42`, `frontend/src/apps/settings/aiTierSlots.ts:96`, `frontend/src/apps/settings/styles/` (`StyleBrowser.tsx:32-33`, `StyleConfirm.tsx:37-100`, `StyleEditor.tsx:166`, `stylesApi.ts:9-80`, `stylesShared.tsx:47-49`), `lib/loras/baseFamilies.ts:23-25,52`.
- Removal and install decisions: `lib/aiUnused.ts:24-139`, `lib/videos/ingredientsAdapter.ts:16-28`.
- Memory and fit decisions: the seven files in 3f.
- Stack health logic: `lib/operatorDiagnose.ts` (133), `lib/stackHealthSync.ts`, `lib/healthSnapshot.ts`, `lib/engineStats.ts`.
- Stale leftovers: `lib/pictures/policy.ts:103-104` (returns "ernie"), `frontend/src/lib/settingCopy.generated.ts:495-500`.

**Bot.** No model name, class or pin in its code (one grep across the repo; only the firmware phrase file and `NOTICE` matched). It conforms when it reads `/parts` like Home. **Go** is not checked out on this Mac and was not read.

**Docs behind the design:** `home/docs/design/model-choice-2026-11-16.md` (sections 1, 4, 5, 6), `h3-tier-slots-2026-11-16.md`, `resource-tiers-2026-10-27.md` (line 114 and 2a.3), `video-tiers-2026-11-02.md:28`, `stack/docs/integrations.md`, `.github/docs/PACKAGES.md` (the `model` kind), and the Stack README's "installs only through Home".

## 5. The plan

Order matters: spec, then Catalog, then Stack, then Home, then Bot. Every brief is small, lands alone, deletes what it replaces, and has an exit check that can fail. Size: S is one to three files, M is up to about ten, L is more and gets split when it starts.

### Phase 0. Record the decision (docs only)
- **D-01 (home, stack; S).** One design note from this report; architect verdict; amend the five notes listed in section 4. Exit: `check.sh --docs` green, verdict recorded.
- **D-02 (home; needs your word).** One hard rule in `RULES.md`: Home holds no model or part data and makes no fit decision. Exit: the commit carries `Owner-approved`.

### Phase 1. One definition (commons, catalog)
- **P-01 (commons; M).** The `part` record, the `/parts` wire shapes, `stack-status` and `sizing` shapes in `spec`, with fixtures. Exit: schema tests; tag cut.
- **P-02 (catalog; M).** `parts/index.json`, generated once by a script from the Stack's current tables, then hand-reviewed; signed index; `models/index.json` and `engines/index.json` deleted. Exit: a parity test shows every url, sha256 and byte count equals the Stack's pins today; the lint refuses a `profile` field.

### Phase 2. Stack serves parts (stack)
- **S-01 (L, split by category).** The Stack reads the pinned parts snapshot. Delete the pin tables in `modelCatalog.ts`, `TIER_CANDIDATES`, the `LABELS` map, `DISK_ROW`. Exit: installs resolve the same files as before (parity test); a test fails on any model name outside the snapshot.
- **S-02 (M).** `/stack/v1/parts` list, install, uninstall, with `audience`. Delete `/models` install-by-pin, `/models/catalog`, `/components`, `/tiers/candidates`, `/capabilities`, `/install-plan` in the same landing as H-01. Exit: a contract test that the `minor` list holds no adult label; install with a url in the body is refused.
- **S-03 (M).** `enabled`, `required_by`, `choices` push; tools and engines as parts. Exit: a part that another enabled part needs cannot be turned off or removed, and the answer says why.
- **S-04a (stack; S).** Hide Wan from every adult list now (`adult_only` is not enough; it gets a `minor_lane` flag the adult payload never carries). Exit: no adult payload or screen contains it.
- **S-04b (stack then home; M, risky surface, design first).** VIDEO-LTX-06: listen to a finished clip (speech-to-text in the Stack, the child and teen line in Home), withhold on a miss. Exit: a test clip that says a blocked line is withheld for a child and a teen; a clean clip passes; architect verdict.
- **S-04c (stack then home; M, risky surface).** Children and teens move to LTX-2.5 with the audio check; delete Wan (pins, environment, rows, Home's lane constants). Exit: a real child-lane clip made and checked; no "wan" string in either repo.
- **S-05 (S).** `update` on each row; model update apply and rollback. Exit: a fake newer entry shows the flag, applies, and a failed apply rolls back with a `problems` line.
- **S-06 (S).** `GET /stack/v1/status`. Exit: a stopped engine, a full disk and a failed install each produce one problem with cause and fix; an update in progress reads `updating`, never `down`.

### Phase 3. Sizing without classes (stack)
- **Z-01 (S).** `memory.budget_percent`; delete `model_budget_bytes` and `reserve_gb`. Exit: 128 GB at 50% and 64 GB at 100% give identical fit answers from the same peaks.
- **Z-02 (L, the riskiest brief).** The planner of 3e in place of `profiles.ts`; margin as a function; delete every `p16` to `p128`. Exit: at 16, 24, 32, 64 and 128 GB at 100% the new plan equals today's plan, or each difference is listed and accepted; real installs on the Studio at 100% and at 50% run chat, a picture and a song.
- **Z-03 (S).** `GET /stack/v1/sizing?percent=`. Exit: plain lines per category; no byte figure in a line meant for people.

### Phase 4. Home conforms: parts (home)
- **H-01 (M).** Typed client generated from the Stack's OpenAPI; delete the hand-written types and every "older Stack" branch. Exit: compile; no optional-for-old-Stack field.
- **H-02 (M).** `engines.<category>.choices`, one writer, pushed to the Stack; the old slot and quick-model keys removed by one migration. Exit: reading defaults writes nothing; an unknown id is skipped.
- **H-03 (M, UI).** Settings, AI and models, and the setup wizard drawn from `/parts`: Primary and Secondary rows, on or off, Install, Remove, Update. Exit: preview opened at desktop and phone width; no name in Home source.
- **H-04 (L, split by feature).** Remove model identity from control flow in video, pictures, music, companions and styles; send the request, read the answer. Exit: the same behavior tests pass; `lint:no-model-names` green.
- **H-05 (M).** Delete `modelCatalog.ts`, `engineCatalog.ts`, `modelDownloadJobs.ts`, `llmSupervisor.ts` spawn code, `engineAutotune.ts`, `music/models.ts`, the helper rows, `aiUnused.ts` decisions, `ingredientsAdapter.ts` pins, `installWords.ts` product names. Exit: a test finds no url, sha256 or revision string in `backend/src`.

### Phase 5. Home conforms: memory, queue, status (stack, then home)
- **M-01 (stack; M).** `priority` and `group` on job submit; fair share across groups; closing apps moves to the Stack. Exit: replay of Home's queue test cases gives the same order.
- **M-02 (home; M).** Delete the seven files of 3f; `householdQueue.ts` keeps scoring and mirroring. Exit: a heavy job on a small budget waits or lowers with the Stack's own reason; child-lane tests unchanged.
- **M-03 (home; S).** Status and repair pages read `/status`; delete the Stack half of `operatorDiagnose.ts`, `stackHealthSync.ts`, `healthSnapshot.ts`, `engineStats.ts`. Exit: the three failure cases of S-06 show on Home's page.

### Phase 6. Bot and Go
- **B-01 (bot; S).** Read `/parts` and `/status`. Exit: the robot's setup lists parts with no name in its code. Go follows when it is built.

### Phase 7. Stack alone (only if decision 2 says yes)
- **A-01 (read only).** Review Ollama, LM Studio, llama-swap, LocalAI, ComfyUI, Jan and its Cortex server, Open WebUI and the Hugging Face Hub pinning model against their current docs. Exit: one page of what to copy and what to avoid, with sources.
- **A-02 (stack; M).** Keys with scopes; Home becomes a key holder. **A-03 (stack; M).** The `maipai-stack` command line. **A-04 (stack; M).** Keyed bind, own installer and updater, CSAM block in the Stack. Exit: a clean Mac installs the Stack, installs a part, makes a picture and updates, with no Home.

### Phase 8. The features that started this
- `MODEL-WITH-01` and `MODEL-RETRY-01` from `model-choice-2026-11-16.md`, now a few lines each: the chip lists `/parts`, the retry asks for priority 2.

### Holding the line
- Home lint: no model or engine brand string in `frontend/src` or `backend/src`.
- Stack lint: no label, url or sha256 outside the parts snapshot.
- Both: a grep test for `legacy`, `alias`, `compat`, `deprecated` in touched files.
- Routing: these are decided, testable briefs, so they go to Codex first, per the org rule.

## 6. The quality bar

- **Secure:** install by id only; every file checked against its sha256 on install and on a schedule; signed index; audience enforced in the Stack with a test; keys hashed, scoped and revocable; loopback by default; an audit line for install, uninstall, update and key changes; no outbound call except the pinned download hosts and the update check.
- **Fast:** `/parts` and `/status` answer from memory in under 100 ms and start no work; changes arrive on the event feed; the update check runs at most daily and never during a heavy job.
- **Manageable:** every failure is one problem line with a cause and a fix; every update can roll back; the command line can do what Home can.
- **Maintainable:** one schema in `spec`, one data file in the Catalog, one generated client; API changes additive after the break.

## 7. Risks, plainly

1. **Z-02 (classes).** A wrong planner could load too much on a small Mac. The parity test and two real runs are the guard. If parity cannot be reached, keep the budget setting and the fit check and leave the resident-set rule for a second pass.
2. **S-01 (pins to data).** A wrong generated entry would install the wrong file. The byte-for-byte parity test is the guard, and sha256 verification stops a bad file anyway.
3. **S-04b and S-04c (children's video).** They change what protects a child's clip and which model makes it. Risky surface, full check, real clips. Wan cannot be deleted before the audio check ships.
4. **Two releases that must ship together.** Phases 2 and 4 remove routes Home uses. Each pair lands and ships as one release, or the live hub breaks.
5. **Not verified:** Go was not read. The Catalog's root key and pinned store address were open in October and were not re-checked.

## 8. Your decisions (answered 2026-11-16)

1. **A hard rule in `RULES.md`** that Home holds no model or part data and makes no fit decision: **yes.** D-02 carries `Owner-approved: 2026-11-16`.
2. **The Stack alone:** **yes, small, after Home conforms** (phase 7 after phase 5).
3. **Children's and teens' video:** **not the silent workaround.** Solve it properly and put it on the backlog. That is VIDEO-LTX-06, already an open row; section 3h and briefs S-04a to S-04c carry it.

## Appendix A. The Codex diff (`wt/stack-swift-panda-model-pair-stack`, 17 files, uncommitted)

Do not land it. It adds another name table (`FEATURE_MODEL_FAMILIES`, `FEATURE_DEFAULTS`), types the names again in Stack settings options, stores one family per feature in Stack settings with no Secondary, picks child or adult names by which family is chosen, marks the video Secondary unavailable, loosens `diskPlan.test.ts`, and renames Wan to "Quick video" where the ruling is to delete it. Its useful idea, role, description and size on every row, is covered by the `/parts` list. The worktree can be discarded once this plan is accepted.
