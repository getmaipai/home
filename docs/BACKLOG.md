# Backlog

What's missing to go from "the hub can chat" to a usable family app. This is
a scannable list, not a narrative - full reasoning and decision history for
any item lives in `docs/dev.md` (linked where useful) or the relevant
platform standard in `getmaipai/.github`. Update this file whenever a gap
closes or a new one is found; don't let it drift from what `main` actually
does.

Rough size tags: **S** (a session or less), **M** (a real slice, days),
**L** (a platform-level capability, needs its own design pass first).

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

- [ ] **U0a: the replay set** (S, Sonnet, starts today). `backend/scripts/bench/datasets/owner-replay.json`, the exact words of the owner's own failed turns today plus controls (source: `home/data-scratch/a-corpus-draft-2026-09-22.md` and the plan's point 4; roster names only, never copied text from `home/data/hub.db`) and `backend/scripts/bench/replay.ts` mirroring `scripts/bench/conversation.ts`'s runner. Files: the two above. Pattern to mirror: `scripts/bench/conversation.ts`. Acceptance: run on the OLD path today, the per-row pass/fail recorded in dev.md as the baseline. Out of scope: the new path (nothing to run it on yet). Exit: `scripts/check.sh` plus the bench log in dev.md. Gating: none.

- [ ] **U0b: the no-new-rules lint** (S, Sonnet, starts today). `backend/scripts/lint/rule-budget.ts`, run by `scripts/check.sh`: counts regex literals and word-list arrays (three or more string literals) per turn-path file (`turnEngine.ts`, `turnContext.ts`, `guards.ts`, `unknownNames.ts`, `turnSignal.ts`, `utteranceShape.ts`, `routing.ts`, `replyConstraints.ts`, `unspokenArgs.ts`, `composer.ts`, `turnNext.ts`) against a committed baseline `backend/rules-baseline.json`; fails when a file's count exceeds its baseline unless every new line carries `// rule: <name>` naming a `ruleNames.ts` key; baseline may only go down. Protected modules allow-listed: the safety signals in commons, `consentVocab.ts`, `memoryContentPolicy.ts`, `childDisclosure.ts`, `contentCeiling.ts`, `almanacCompute.ts`, `commands.ts`. Files: `backend/scripts/lint/rule-budget.ts`, `backend/rules-baseline.json`, the call in `scripts/check.sh`. Test: a fixture file with one unmarked regex fails the lint; the same line with a counter-row marker (`// rule: <name>`) passes. Exit: `scripts/check.sh`. Gating: none.

- [ ] **U1: a cache-stable prompt** (S, Codex, starts today). The offered tool set is fixed per model budget and sorted; the window precedes the context message. Files: `turnEngine.ts` (`selectOfferedTools` and its caller), `modelCatalog.ts`. Test: two consecutive turns produce the identical tools block. Acceptance: `cache_reuse_tokens` grows with conversation length on the dev hub (live, on 8787 after restart). Exit: `scripts/check.sh`. Gating: none. Folds LAT-02.

- [ ] **U2: the one-call loop, the new path's core** (M, Sonnet; gated on ARCH-BUILD-01's verdict for its orchestration; the loop's state record written first, Opus, half a day). `turnNext.ts` beside `turnEngine.ts`: safety, the exact commands, the context list, one model call with tools, the model's own tool arguments as the query (grounded against the window), one tool round, the answer with sources, the output gate; the interim always-search rule (plan point 3); consent/confirmation for side effects through the existing pending ask. Files: new `backend/src/lib/turnNext.ts`, `modelCatalog.ts` (the `tool_calling` budget record: rounds, offered set, always-search on/off, context tokens, model-driven transitions on/off, read by the loop and nothing else, no device/tier check). Tests: the replay set's exact words with scripted model drafts. Acceptance: the replay set green on the new path; the same replay set through the same code on the 8B and the 4B with only the budget record differing, both recorded in dev.md. Out of scope: any device or hardware-tier branch. Exit: `scripts/check.sh` plus the replay bench. Gating: ARCH-BUILD-01. Folds REPLY-FIND-05, REPLY-FIND-06.

- [ ] **U3: the thinking budget and the generation record** (S, Codex, starts today). Apply `home/data-scratch/paused-2026-09-22-b-lat01.patch` (`THINKING_ALLOWANCE`, `visibleReplyMaxTokens`): thinking on never cuts the visible answer. Files: `turnEngine.ts` (the generation call sites LAT-00 instrumented). Test: the request-body assertion the LAT-01 row names. Acceptance: "hi" with thinking on is one generation (live: the `generations` array on the next real `[turn]` line in `home/data/logs/hub.log` after an 8787 restart shows one entry). Exit: `scripts/check.sh`. Gating: none. Folds LAT-01.

- [ ] **U4: the answer register by surface** (M, Sonnet, after U2). RESP-01's two halves on the new path: the written policy for a typed screen, the spoken policy for voice, the plan's budget (point 5) as the only length. Files: `register.ts`, `persona.ts`, `replyConstraints.ts`. Tests: the written-set bench, the seeded voice set. Acceptance: per RESP-01's acceptance, run against `turnNext.ts` instead of `turnEngine.ts`. Exit: `scripts/check.sh` plus the named benches. Gating: U2. Folds RESP-01.

- [x] **U5: memory lines dated and labeled** (S, done 2026-09-22; `800329ba`). Each recalled memory renders as a typed, dated line ("remembered Sep 15: ...") in the context list, never bare text. Files: the context-list assembly point both paths read (currently `turnEngine.ts` near :580-584; U2 moves this to the shared context list). Test: a prompt-assembly test that each recalled memory carries its date and a "remembered" label. Acceptance: existing recall tests pass; the old path's chat is unchanged. Exit: `scripts/check.sh`. Gating: none. Folds REPLY-FIND-04.

- [ ] **U6: the flip** (S, the coordinator's call on the numbers; gated on ARCH-MEASURE-01's budget records for the models in the house). **Not yet (2026-09-22 22:45):** U2d's live replay ran the new path under a substring grounding check the record never meant (new path 0 of 7 failed rows and 8 of 13 controls; old path 2 of 6 and 12 of 13); rerun after the term-level fix (2a28e4e8) and decide on the rerun. Default `turn.pipeline.next` to on. Files: the settings registry default. Acceptance: the replay set report on both paths in dev.md, the new path passing every failed row and matching or beating the old path on every control row; the old chat page unchanged. Exit: `scripts/check.sh` plus the replay bench report. Gating: ARCH-MEASURE-01, U2, U3, U4, U5 landed.

- [ ] **D1: delete the lookup ladder** (S, Codex, after U6). `lookupDecision`, `exactFieldOf`, `CURRENCY_MARK_RE`, `deliverableQuery`, the field stop list. Files: `turnContext.ts` (~200 lines). Acceptance: the replay set and the trimmed routing corpus green after. If a deletion turns a row red, revert the deletion; the row becomes a unit, never a new rule. Exit: `scripts/check.sh` plus the replay bench. Gating: U6.

- [ ] **D2: delete the query builders and forced lookup** (S, Codex, after D1). `lookupQueryFor`, `runForcedLookup`, `notePendingLookup`, `worldAnswerQuery`, `holdForLookup`, `lookupConsent`, the lookup branch of `resolvePendingAsk`. Files: `turnEngine.ts` (~500 lines). Acceptance/exit as D1. Gating: D1.

- [ ] **D3: delete the draft reader** (S, Codex, after D2). `readLookupDraft`, `lookupShapeOf`, `hedgedFactShape`, the promise/offer/hedge regexes. Files: `guards.ts` (~120 lines). Acceptance/exit as D1. Gating: D2.

- [ ] **D4: delete the repeat guard and the stuck lines** (S, Codex, after D3). `isRepeatReply`, `guardRepeatSentence`, `guardRepeatQuestion`, `CHAT_LOOP`. Files: `guards.ts` (~80 lines). Acceptance/exit as D1. Gating: D3. Retires REPLY-FIND-01's stopgap, if one landed.

- [ ] **D5: delete the deliverable rules** (S, Codex, after D4). `composeDeliverable`, `deliverableKind`, `pictureDeliverableFor`, the "Here's a video" line. Files: `turnEngine.ts`, `turnContext.ts` (~60 lines). Acceptance/exit as D1. Gating: D4.

- [ ] **D6: delete the register and placeholder-echo guards** (S, Codex, after D5). The register and assistant-register guards, `guardPlaceholderEcho`. Files: `guards.ts` (~130 lines). Acceptance/exit as D1. Gating: D5.

- [ ] **D7: delete Tier 1 embedding routing as a decider** (S, Codex, after D6). `routeSemantic`, `selectOfferedTools`'s per-turn set, `pickTier1Winner`, `ensureRoutingEmbeddings`, `scoreByEmbedding`, the thresholds, and the websearch manifest's `search *`/`look up *`/`google *` wildcard patterns (ROUTE-FIND-03 (b)). Files: `routing.ts`, `turnEngine.ts` (~400 lines), the websearch manifest (~3 lines). Acceptance: as D1, plus the trimmed routing corpus keeps only the exact-match rows. Exit: `scripts/check.sh` plus the replay bench. Gating: D6.

- [ ] **D8: delete the utterance-only argument check** (S, Codex, after D7). Replaced by a window check (an argument must come from the conversation, not just this line), about 40 lines. Files: `unspokenArgs.ts` (~150 of 262 lines). Acceptance/exit as D1. Gating: D7.

- [ ] **D9: delete the subject stack's world half and the pronoun machinery** (S, Codex, after D8). `worldAnswer`, `properNounsIn`'s world branch of `candidatesIn` and `resolveNames`, the world-kind and pronoun regex family; the household half (`parseWhoAnswer`, `applyWhoAnswer`, the relation frames) stays. Files: `unknownNames.ts` (~300 of 1,085 lines). Acceptance/exit as D1. Gating: D8. Last of the deletions; ~2,300 lines retired in all across D1-D9.

## Household storage (2026-09-23)

Every person has their own storage, a parent caps each person and the household, and a person shares a file with named people or the family. The design record is [docs/plans/household-storage-2026-09-23.md](plans/household-storage-2026-09-23.md) (L; its numbered questions are the owner's); the spec row is `STORE-SPEC-01` in commons.

- [ ] **STORE-CAP-01: the two caps, enforced at the record API in the person's words** (M, Sonnet; after STORE-SPEC-01). Objective: the three settings keys (`storage.household.cap_bytes`, `storage.person.default_cap_bytes`, `storage.person.cap_bytes`) declared once and rendered by the generic renderer; the host's record API refuses a write past the owner's cap or the household total with the reason ("Your storage is full; delete some pictures or ask a parent for more room" for a child, with "or raise the limit under Settings" for an adult); usage per person and per household computed from the records, a shared file counted once against its owner; a reconcile that finds bytes without a record or a record without bytes raises a health item, never a purge. Files: the settings registry (spec first), `backend/src/lib/packageHost.ts` (the record API), a new `backend/src/lib/storage/usage.ts`, the health list. Mirror: the allowance settings and the one health list. Acceptance, in these exact words: a child at the cap writing a picture gets the child line, an adult the adult line, a shared file counts once against its owner, no job ever deletes a file. Out of scope: sharing (STORE-SHARE-01), the page (STORE-PAGE-01). Exit: `bash scripts/check.sh`.

- [ ] **STORE-SHARE-01: sharing a file with named people or the household** (M, Sonnet; after STORE-SPEC-01). Objective: share pointer records (the spec's `share`: file id, from, to a person or the household) created and deleted by the owner only, re-sharing as a further pointer on the same file, never a second file record or a copy of the bytes; a second person adding identical bytes receives a pointer to the first person's file (no duplicates at any level); a shared file appears in each recipient's Library under the owner's name and counts against the owner; a child's sharing bounded by the consent floors (the household and its adults); a package reads a shared file only within its `min_role` and permissions; the turn pipeline's disclosure filter treats a shared file as context with the owner's disclosure. Files: the files routes, the Library page, `backend/src/lib/access.ts`, the context node. Mirror: the memory store's `canRead`. Acceptance: a shared file is listed for the recipient and not for a third person; unsharing removes it at once; a child cannot share outside the household (question 2 of the record until ruled). Exit: `bash scripts/check.sh`.

- [ ] **STORE-DELETE-01: a deleted person's files** (S, Sonnet; after STORE-SPEC-01). Objective: the existing person-deletion path (`backend/src/lib/personLifecycle.ts`) gains one step in one place: the person's files with no live share pointer are purged with the person, records and blobs (a blob only when no record points at it); a file with any live share remains, its ownership passes to the household, it counts against the household cap and no personal cap, and the person's name stays in provenance. Mirror: the memory store's tombstones on person deletion. Acceptance, in these exact words: bramble creates a picture and shares it with lucia, lucia shares it with the family, bramble's account is deleted: the picture remains, listed under the household, counted against the household cap, with bramble in its provenance; a second picture bramble never shared is gone, blob and record. Exit: `bash scripts/check.sh`.

- [ ] **STORE-PAGE-01: the Storage page under Settings, one source with the performance panel** (S, Sonnet; after STORE-CAP-01). Objective: the template's data table showing each person's usage against their cap, the household total against its cap, the largest kinds per person, and the cap controls for an admin; the Admin performance page's storage panel (053b1422) reads the same function. Files: the settings pages, `backend/src/routes/`, `usage.ts`. Mirror: the performance page's panel. Acceptance: the two pages show the same numbers for a seeded household; a child sees only their own row. Exit: `bash scripts/check.sh` and the captures.

## Hardware tiers (2026-09-23)

The hub installs on what a family has; the Studio is the top of the range, not the baseline. The design is [docs/plans/hardware-tiers-2026-09-23.md](plans/hardware-tiers-2026-09-23.md): four reference points (the floor, a 24 GB Apple silicon laptop, a 16 GB CUDA laptop, a 128 GB Studio and up), one pipeline, only the budget record and the deployment limits varying, and a configuration that is proposed by the Stack's probe and stepped down by the person, never fixed. The order among voice, photos and pictures is the owner's. The Stack's own rows (STACK-SIZE-01, STACK-FLOOR-01) are in `stack/docs/BACKLOG.md`.

- [ ] **VOICE-LIVE-01: the composer's right-side slot so the waveform mounts** (S, kit, upstream-bound). Objective: `ComposerAction`'s right group gains an append point (`ComposerExtraEnd` on `ThreadComponents`) so the built waveform button and chevron (`frontend/src/apps/chat/composerVoiceControls.tsx`) mount. Files: `commons/ui/src/elements/thread.aui.tsx`'s composer, the kit's upstream note. Mirror: the left slot `ComposerExtra` (ui-v0.5.29 to v0.5.34's recipe), opened upstream onto assistant-ui/assistant-ui#8003 or its successor the same day. Acceptance: the waveform renders in the composer on `/next/chat` when stt and tts are both ready and is absent otherwise; the PR link in the pending-patches table. Out of scope: the live session. Exit: the kit's tag pinned in Home and `bash scripts/check.sh`.

- [ ] **VOICE-LIVE-02: the live voice session** (M, Sonnet; the plan's section 1). Objective: press the waveform and talk: the shipped `voice-conversation.tsx` Element shows listening, the Silero detector ends the utterance, the `stt` role transcribes, the turn runs with `spoken: true` (RESP-01's flag), `reply.speech` is spoken sentence by sentence as it streams through the `tts` role and the spec's sentence chunker, the Element shows speaking, the transcript lands in the thread as text, and stop works at any point from the Element. Files: `frontend/src/apps/chat/` (the runtime adapter, `composerVoiceControls.tsx`), `backend/src/lib/stt.ts`, `sttSession.ts`, `tts.ts`, `backend/src/routes/turn.ts` (the `spoken` flag). Mirror: the dictation path and the read-aloud Element's own stop. Acceptance: a spoken turn end to end on this Mac with the first spoken word under 3 seconds after the utterance ends beside the resident 8B, measured and in dev.md; a child's turn keeps the child rules and carries no reasoning; no new model, no new settings key. Out of scope: barge-in (the existing `VOICE-01`, which follows this item and depends on its stop control and abort signal), the wake word (HANDSFREE-01 c). Exit: `bash scripts/check.sh` and the measured line.

- [ ] **VOICE-LIVE-03: the chevron's voice selection and the wake-word shortcut** (S, Sonnet). Objective: the waveform's chevron lists the `tts` role's voices from the voice catalog and, only when a wakeword package is installed, offers the shortcut to that device's declared wake-word setting (HANDSFREE-01 c's one key and its invariants). Files: `composerVoiceControls.tsx`, `backend/src/lib/voiceCatalog.ts`, the settings registry. Mirror: the composer's thinking control menu (RESP-04 f). Acceptance: choosing a voice changes the next spoken reply; the shortcut is absent with no wakeword package and flips the one same setting when present (asserted). Out of scope: the wake word itself. Exit: `bash scripts/check.sh`.

- [ ] **VISION-01: photos the model understands, a small vision model on demand** (M, Sonnet; the plan's section 2). Objective: the `vision` role as a second llama-server with a multimodal projector, loaded when a photo turn starts and evicted when idle; the context node calls it with the photo and the question and adds the result as a `ContextItem` of source `document`; the chat model answers from it, one pipeline, no branch. Candidate: Qwen3-VL-4B-Instruct at Q4 (Apache-2.0, about 3.5 GB while loaded, unmeasured); fallback Gemma 3 4B; the chat-model swap (a vision-capable 8B) only if the bench fails. Files: `backend/src/lib/turnMachine/nodes/context.ts`, the vision role's supervisor beside `llmSupervisor.ts`, `modelCatalog.ts` (the pin by revision and hash), `spec/schemas/attachment.schema.json` (exists). Mirror: ATT-01's record and the on-demand admission STACK-16 designed. Acceptance: a ten-photo bench with the roster's demo photos judged for "answers the question about the photo"; ENGINE-CONTRACT-01's checks run on the vision engine; peak memory with the model loaded recorded; child-derived content stays out of the judge as ATT-01 rules. Out of scope: documents (ATT-01's Tika half), pictures the model makes. Exit: `bash scripts/check.sh` and the bench table in dev.md.

- [ ] **IMAGE-01: picture creation on a free card through the Stack's image role** (M, Sonnet; the plan's section 3). Objective: the `image` role served where a card is free: on tier 1 today the model host's RTX 3070 as a URL-tier engine (ComfyUI with FLUX.2 Klein 4B, Apache-2.0, pinned by revision and hash, as a systemd service on the laptop, the coding model unloaded while a picture draws), the Stack's job API unchanged (`/v1/images/generations`, queue, cancel, 202 past the deadline), MPS on the Mac as the fallback with the chat engine paused. Files: `stack/backend/src/lib/` (the URL-tier engine address for the image role), `modelCatalog.ts` (`flux2-klein-4b` exists), the laptop's service unit (the private homelab repo records the host). Mirror: the chat and embed roles' URL tier; STACK-13a's queue and STACK-13b's ComfyUI engine. Acceptance: one picture rendered through the job API with time and footprint recorded; the health check reports the remote engine like any engine; nothing leaves the house (the endpoint list in PRIVACY.md unchanged). Out of scope: the chat side (IMAGE-02), video and music. Exit: `bash scripts/check.sh` in both repos and the line in dev.md.

- [ ] **IMAGE-02: "draw me a ..." in chat, the first slice of CHAT-MEDIA-01** (S, Sonnet). Objective: a picture request runs as a job through the executor (a side effect: consent per person, progress in the thread, the picture in the thread through the shipped image Element). Files: `backend/src/lib/turnMachine/nodes/policy.ts` and `tool.ts`, the kit's image Element. Mirror: the tool events (TOOL-EVENTS-01). Acceptance: SAFETY.md's generation invariants asserted in tests: a child profile cannot invoke it until an adult unlocks it per person; the adult unlock is the one-time acknowledgment; every picture passes image safety before display or persistence; no people path. Out of scope: undo, variations, edits. Exit: `bash scripts/check.sh`.

- [ ] **SETUP-SIZE-01: the wizard's sizing page, the proposal with its impact and the step-down** (M, Sonnet; the plan's "proposed, never fixed"). Objective: the first-run wizard's hardware step (the existing "first-run wizard, end to end" row) and the same page under Settings show the Stack's proposal per role with the impact in a parent's words (memory kept back, expected speed, what a smaller choice loses) and let the person move budget between roles in both directions: any role to a smaller pinned candidate, on demand, or off, including the floor ("the robot's brain on your computer"), and the freed memory to another role (a larger chat model than the tier's default, vision resident), with the trade said in a parent's words ("turn off pictures and chat can use the bigger model, which answers better") and a set that does not fit refused with the roles to turn down named; video generation listed as a role, off on every tier today. The per-role Setting record is the one store of the allocation. Files: the settings registry (`engines.<role>.choice`, spec first), the wizard and settings routes, the page from the template's form layout (no hand-built control). Mirror: SETTINGS.md's generic renderer; the Stack's hardware route for the proposal. Acceptance: stepping `chat` down on the dev Mac changes the Stack's resident set on the next start and the page says what changed; a child profile cannot reach the page. Out of scope: the Stack's side (STACK-SIZE-01). Exit: `bash scripts/check.sh` and the captures.

- [ ] **PKG-UNINSTALL-01: the normal package uninstall path** (S, Sonnet; before CAP-GATE-01). Objective: the hub has no uninstall path today (`packageHost.ts` and the packages routes have none): add the route and the package's uninstall hook to PACKAGES.md's rule "Uninstall, and a person's files": the package's code removed and its surfaces hidden, its own settings and state kept for a reinstall, the person's media records (commons MEDIA-RECORD-01) untouched and still reachable from Library and Files, the confirmation in the standard's words. Files: `backend/src/routes/packages.ts`, `backend/src/lib/packageHost.ts`, `plugins.ts`, the apps page's uninstall action from the template's menus. Mirror: the install route. Acceptance: an installed package is uninstalled through the route, its hook ran (a spy), it is gone from the packages route and the apps page, its settings and state rows remain and a reinstall reads them, a media record it wrote is still listed for its owner, and the confirmation text is the standard's; a child profile cannot uninstall. Out of scope: reconcile (CAP-GATE-01). Exit: `bash scripts/check.sh`.

- [ ] **CAP-GATE-01: the node's capability set comes from the engine allocation, and packages follow it** (M, Sonnet; the plan's "Capabilities follow the allocation"; after CAP-VOCAB-01 in commons). Objective: one function derives the node's live capability set from the per-role Setting record plus the Stack's installed state (chat to `gpu_llm` or `cpu_llm`, embed to `embeddings`, the engine roles to their own ids), and every consumer reads it: the package list route and the apps page hide a package whose `requires` names a capability that is off or not installed, the router's offered tool set excludes it, and the catalog install refuses it with the reason ("Pictures is off on this hub"); `optional` degrades instead of hiding; the allocation page lists what each choice hides. **Enforced for every package kind under the one manifest (owner's rule, 2026-09-23):** install is refused when a required capability is absent, with the reason and the setting that turns it on; when the allocation changes and a required capability goes away (a role turned off in the wizard or under Settings, a role uninstalled, a role that fails to install at start), every installed package that requires it is uninstalled through the normal uninstall path (PKG-UNINSTALL-01) and the confirmation names them before the change is applied ("turning pictures off removes Draw and Picture Books"); an optional capability only degrades, never removes; reconcile runs in one place at every start and after every allocation change. A person's files follow PACKAGES.md "Uninstall, and a person's files": a person's output is a household media record (commons MEDIA-RECORD-01), uninstall never touches it, the confirmation reads "the following will be uninstalled and users will lose access" then "your pictures stay in Library". Files: a new `backend/src/lib/capabilities.ts`, `backend/src/routes/packages.ts`, `packageHost.ts` (beside `capability_missing`, which is about host methods and stays), `turnMachine/budget.ts` and the fixed offered set, the apps page and the catalog page, the settings page for the allocation. Mirror: `meetsMinRole`'s one definition read at every site. Acceptance, in these exact words: with image off, a package requiring `image` is absent from the packages route, absent from the tools offered on a turn, and the apps page shows nothing for it; with image on, all three present; the catalog page for it says why while off; a package requiring `image` is installed, image is turned off, the confirmation lists it, after confirmation the package is gone from the packages route and the apps page and its uninstall hook ran; the same with an optional capability leaves it installed and marked degraded; a role that fails to install at start is reconciled the same way. Out of scope: the vocabulary change (CAP-VOCAB-01), the wizard page itself (SETUP-SIZE-01), the uninstall path itself (PKG-UNINSTALL-01). Exit: `bash scripts/check.sh`.

- [ ] **FLOOR-ACCEPT-01: the floor run of the acceptance workload** (S, Sonnet). Objective: the tier workload's floor run: a voice conversation plus a typed one, no photo, no picture, measuring first useful answer, first spoken word, peak memory and cancellation, run on this Mac with the robot's model as a stand-in for an 8 GB machine, recorded honestly as a stand-in, and rerun on an 8 GB machine when one is on the bench to set the floor's limits. Files: the tier workload runner (STUDIO-ACCEPT-01's), dev.md. Mirror: STUDIO-ACCEPT-01. Acceptance: the numbers in dev.md marked stand-in, the floor's limits set only from a real 8 GB run. Out of scope: everything above the floor. Exit: the table in dev.md.

## Chat system optimization

The [2026-09-07 analysis](reports/2026-09-07-chat-system-analysis.md)
records findings at `02e802b`. The
[decision record](dev.md#chat-system-optimization-decisions-2026-09-07)
fixes architecture and supersedes conflicting older future-work prose.
These items are the only completion records for this program. Earlier
entries replaced by links are historical context, not additional tasks.

**Execution contract for every item:** read the decision record and named
files, then the nearby tests before editing. Follow dependencies below.
Work on `main`; do not create a branch unless another active session
requires isolation under the org rule. Do not touch unrelated dirty files.
Add a regression in the existing `bun:test`/pytest suite before each bug
fix; use the real construction helpers and scripted engines. Do not add a
second test runner. For shared records and native wire changes, edit the
existing spec first, regenerate affected bindings, add round-trip fixtures,
then implement Home; robot deployment is out of scope. Update user/dev docs
with behavior changes, generated API docs through registered Zod/OpenAPI
routes, and privacy tables when outbound data changes. Every item exits
with `bash scripts/check.sh` from the repository root in addition to its
named checks. Run the org code-review skill at medium effort or higher
before code commits. Update this checkbox and refresh the derived dashboard
only after the actual acceptance checks pass. A failed live gate leaves
the item open with measured results; do not lower its threshold, invent a
passing result, deploy, or ask the owner to run a runnable command.

**Order (amended 2026-09-12):** the [2026-09-12 block](#chat-direction-2026-09-12-the-next-block-two-tracks)
(FAST, MEM, JOIN) runs before anything below; it fixes the prefix cache,
moves background work off the chat engine, and lets world knowledge
through the guards, all of which the items below assume. Then: CHAT-22
establishes safe live measurement first. Implement
CHAT-01, CHAT-02, CHAT-03, CHAT-05, and CHAT-18 next. Then follow the
individual dependencies. CHAT-23 is the integrated exit gate; CHAT-24
produces recommendations only. All sizes below describe one bounded slice,
not permission to expand scope.

<a id="chat-01"></a>

- [x] **CHAT-01: Share the exact selected context with generation and guards** (M)

    Status (2026-09-13, closed): `backend/src/lib/turnContext.ts` (the
    ephemeral `TurnEvidence`/`TurnIntent`/`ToolExecutionOutcome`/
    `TurnContext`), selection defined as what the render kept, the guard
    input derived from the included evidence alone (`GuardContext.grounding`
    for profile, summary, roster and clock), one frozen clock per turn,
    outcomes pushed per resolved call. Details in docs/dev/session-a.md.

    Depends on: none. Files: `backend/src/lib/turnEngine.ts`, new
    `backend/src/lib/turnContext.ts`, `conversationHistory.ts`, `guards.ts`.
    Mirror `prepareTurn`, `buildConversationWindow`, and existing
    `turnEngine.test.ts` fake-person/context fixtures. Implement the
    `TurnEvidence`, `ToolExecutionOutcome`, and `TurnContext` fields in the
    decision record as ephemeral types, importing existing surface/result
    types. Freeze persona, actor, age-band policy, and time once per turn.
    Load history once; distinguish user assertions, assistant history,
    summaries, profiles, roster, clock, memories, and actual package
    outcomes. Build the prompt and guard inputs from the same selected
    evidence IDs, never all pre-truncation retrieval candidates. Include `intent: { kind: chat|lookup|action|clarify, query,
    subjectEntityIds, explicitDetailedAnswer }`; default kind to chat and
    query to original text. Set the detail flag only for case-insensitive
    `in detail`, `detailed explanation`, or `step by step`. CHAT-13 refines
    intent. Initially preserve budgets; CHAT-12 replaces their selection policy.
    Treat reference text as data and never put package-result text into a
    system-authority message. Preserve the existing public turn shape.

    Acceptance: an included profile/roster/clock fact passes grounding;
    a removed memory is absent from both prompt and guard sources;
    assistant guesses and persona examples never become assertions or
    action-success evidence; a malicious instruction inside reference text
    cannot authorize a tool. Assert meaningful answers using scripted
    completions, not only object shape. Out of scope: new persistence,
    another model pass, new UI, and a duplicate shared record system.
    Checks: `cd backend && bun test tests/turnEngine.test.ts tests/guards.test.ts tests/conversationHistory.test.ts`, then the full exit gate.

<a id="safety-01"></a>

- [x] **SAFETY-01: The conversation's crisis state (offer, never block, on every turn)** (S-M)
    Done 2026-09-14 (docs/dev/session-a.md "SAFETY-01"; the program
    file's finding 26): the self-harm signals gain the live chat's
    wordings (spec/safety, corpus rows both ways); a conversation is in
    the crisis state for ten turns after a self-harm signal on either
    side of a turn (`conversation_turns.crisis_signal`, schema 35);
    in the state every reply carries the crisis overlay, no package
    routes and no tool is offered (the forced lookup cannot run, an
    offer binds nothing, a pending lookup or ask is cleared), and a
    stop gets one acknowledgment then the overlay alone; #85 closed:
    a streamed refusal's resources ride on its error event and the
    chat client shows them. Tests: `backend/tests/safety01.test.ts`
    (blocking and streamed, a roster speaker), the adapter test, the
    corpus; the bench row `self-harm-state`.

<a id="safety-01-followups"></a>

- [x] **SAFETY-01 and ASK-01 follow-ups, second round** (S)
    Done 2026-09-15 (docs/dev/session-a.md "ASK-01", "The second
    round"): the three lows of SAFETY-01's review and the set's reads:
    a who answer with a value is an inform (the judge extracts from
    the answer turn); a bare possessive is not a household frame; the
    two-turn household-frame rule in the judge (the name in the
    previous turn, the kind noun with a pronoun in this one, is stated
    with its pronoun); the role-invention shape reads any unresolved
    name; a confirmed entity answered as another kind keeps its kind
    and the reply says so; finalize on the refusal path inside a try;
    an ephemeral widget query skips the crisis state's routing rule;
    who-ask-declined and open-question-once ask about names of their
    own (the shared bench household). Set 1 of ASK-01 on de9d6a4:
    216, 210, 211 of 276, the hard rows 12 of 12; the partial rerun
    of the five rows after this commit.

    Objective: the three lows of SAFETY-01's review, one test each:
    an answer of another kind about a confirmed entity
    (`applyWhoAnswer()`, `backend/src/lib/unknownNames.ts`) keeps the
    entity but still writes the relation and says "Got it, X is your
    neighbor" (say what was kept instead, write no edge the kind
    refuses); `streamTurnEvents()` (`backend/src/routes/turn.ts`) now
    finalizes a refusal before its error event, so a throw inside
    finalize would end the stream with no terminal event (wrap it, emit
    the error either way); an ephemeral widget query in a conversation
    in the crisis state routes to no package for ten turns (skip the
    state's routing rule for `ephemeral` turns, keep the overlay off
    them). Mirror `tests/safety01.test.ts` and `tests/ask01.test.ts`.
    Exit: `bash scripts/check.sh`.

<a id="chat-02"></a>

- [x] **CHAT-02: Enforce one output safety boundary for chat and packages** (M)

    Status (2026-09-13, closed): `evaluateReply()` (text and speech
    independently, the stricter wins) behind `applyOutputBoundary()` as the
    first step of `finalizeReply()`, so package replies, Tier 2 results,
    confirm prompts, fallbacks, commands and model text all pass one
    evaluator before text, audio and persistence; a refusal clears a
    pending ask; notifications once per turn and category; the streaming
    gate judges the cumulative reply at each boundary. Details in
    docs/dev/session-a.md.

    Depends on: CHAT-01. Files: `backend/src/lib/turnEngine.ts`, `safety.ts`,
    `packageHost.ts`, `notifications.ts`, `backend/tests/turnEngine.test.ts`,
    `safety.test.ts`, and existing `spec/safety` corpus/tests. Extract the
    current output evaluator into one reusable implementation; ordinary
    completions, direct package replies, package-generated text, pending
    prompts, composition, and error fallbacks must reach it before visible
    text, audio, or the persisted assistant reply. Evaluate explicit
    `reply.speech` independently if it differs from visible text; normalize
    approved text only after policy succeeds. Keep core refusals out of the
    style guards. Evaluate final fragments without punctuation and preserve
    existing safe whitespace. Deduplicate parent notifications by turn and
    category. A refusal cancels remaining generation and prevents pending
    tool execution; retain crisis-resource behavior without suppressing
    otherwise permitted help. Add no opt-out, persona exception, or manifest
    flag. Reuse the existing safety vocabulary and age-band derivation.

    Acceptance: safe input with unsafe direct package output, unsafe
    package LLM output, unsafe speech with safe display, split-chunk unsafe
    content, and an unsafe final fragment are stopped before exposure.
    Streaming and direct paths make identical decisions and notify once.
    Existing mandatory floor/ceiling fixtures remain unchanged and green.
    Out of scope: changing content policy or replacing the deterministic
    safety floor with model judgment. Checks: backend safety/turn suites,
    shared safety corpus suites, and the full exit gate.

<a id="chat-03"></a>

- [x] **CHAT-03: Exclude credentials from ordinary chat memory and context** (M)

    Status (2026-09-13, closed): `backend/src/lib/memoryContentPolicy.ts`
    (bounded assignments, known formats, declared fields, redaction, the
    stated limit) behind `prepareTurn()`'s early answer, `remember()`, the
    judge, `host.memory.remember`, the memory API and `logTurn()`'s
    redaction; the read side hides historical records without deleting
    them; the user memory page explains it. Details in docs/dev/session-a.md.

    Depends on: none; integrate with CHAT-06 when it lands. Files:
    `backend/src/lib/memoryJudge.ts`, `memory.ts`, `packageHost.ts`,
    `conversationHistory.ts`, `turnEngine.ts`, existing `secrets.ts` and
    secret-setting declarations, `routes/memory.ts`, and `tests/memoryJudge.test.ts`,
    `memory.test.ts`, `packageHost.test.ts`. Remove the credential-storage
    extraction example. Implement one pure `memoryContentPolicy.ts` used
    by all capture paths. It rejects declared credential-bearing fields,
    bounded explicit assignments to password/token/API-key/cookie/private-key
    labels, and recognized secret formats; use generated synthetic values in
    tests. Never enumerate/decrypt stored credentials to build a matcher.
    Before a supported chat capture request containing detected credentials
    is logged, embedded, or sent to a model, return the fixed safe message
    "Keep passwords and keys in Credentials, not in chat." Persist only a
    redacted event marker, with no raw value. Read-side context filtering
    excludes detected historical credential text from recall, profiles,
    summaries, and notifications without deleting existing records.

    Acceptance: both explicit saves and automatic candidates are rejected;
    store/vector/notification/model spies receive no detected value; a
    benign statement that a password is managed elsewhere passes. Direct
    memory API rejection is a documented 400 with an existing-compatible
    error shape. Record the detection limits honestly: arbitrary unlabeled
    strings cannot be proven nonsecret. Out of scope: credential migration,
    destructive historical cleanup, storing chat credentials in a new
    store. Checks: named backend suites and full exit gate; update the
    user memory/credentials explanation with the same change.

<a id="chat-04"></a>

- [x] **CHAT-04: Stop rejecting valid acknowledgments and general knowledge** (M)

    Shipped 2026-09-13 (the action-claim half; FAST-05 shipped the
    world-knowledge half 2026-09-12): near-echo is a question guard
    (`utteranceShape()` from the new pure `lib/utteranceShape.ts`),
    `GuardContext.outcomes` replaces `actionsRan`, completed action
    claims are matched per package family to a succeeded outcome
    (`unsupported_action`, narrated from the outcome, never a pooled
    line), remembering and future intent are acknowledgments, and the
    #81 sentence-case pass runs on both paths. Design and the shipped
    record in [docs/dev/session-a.md](dev/session-a.md). Closes #74,
    #62; #81 by the pass and a naturalness bench row.

    Depends on: CHAT-01 and CHAT-02; use CHAT-15 outcomes when available,
    otherwise the identical type from CHAT-01. Files:
    `backend/src/lib/guards.ts`, `turnEngine.ts`, `spec/llm/guard-corpus.json`,
    `backend/tests/guards.test.ts`, `turnEngine.test.ts`. Replace universal
    novelty checks for capitals, digits, and dates with narrowly scoped
    household-claim checks. Remove overlap-only acknowledgment rejection.
    Preserve mandatory safety, medication, impossible-experience, and
    known unsupported-household-claim cases. Match explicit action claims
    against successful outcomes for that action; one unrelated successful
    tool is never sufficient. "Got it" needs no memory write, while "I
    saved that" does. Use one sentence decision function in streaming and
    blocking paths, with a reason indicating unsupported action text that
    CHAT-17 can hold. No separate second-model semantic judge in this slice.

    Amended 2026-09-12: FAST-05 lands the world-knowledge half of this
    item first (bare numbers, capitals, dates, hedges, household-only
    location claims, the four probes as permanent tests). This item keeps
    the action-claim half, which needs CHAT-15's outcomes.

    Acceptance: exact regressions include the Pippa allergy disclosure accepts "Got it,
    Pippa is allergic to peanuts."; "It is 4." answers the arithmetic
    question; "The capital is Paris." answers the France question; "She
    likes painting." passes with Pippa resolved and that included memory.
    Add negatives for unknown household whereabouts, failed saves/timers,
    a search followed by an invented save claim, and copied persona
    examples. Deliberately retire old lexical false-positive assertions
    with a documented behavior replacement, never silently weaken safety
    fixtures. Out of scope: proving all natural-language entailment or
    eliminating hallucinations. Checks: named suites, guard corpus runner
    already used by the repository, and full exit gate.

<a id="chat-05"></a>

- [x] **CHAT-05: Make explicit recall include the speaker's saved facts** (S)

    Depends on: none. Files: `backend/packages/recall/recipe.json`,
    `backend/src/lib/packageHost.ts`, `memory.ts`, `backend/tests/packageHost.test.ts`,
    `turnEngine.test.ts`, and the matching shared recall fixtures. Remove
    Recall's hardcoded household-only selection. The chat-facing host
    memory reader defaults to own person records plus authorized household
    records with `selfOnly: true`; apply this even for an owner/admin.
    Explicit household filtering still works. Attempts to name a different
    person through the package port are denied. Keep existing explicit
    owner/admin management APIs for child inspection unchanged. Reuse
    `canRead` and `canAccessPerson`; do not create a second role policy.
    Update shared host-emulator fixtures to model the same behavior without
    changing the record shape. Recall is currently authoritative in Home and is not listed in
    `backend/packages/bundled-provenance.json`; edit it here. Do not migrate
    it to Catalog in this task. For packages actually listed in provenance,
    the existing command is `bun scripts/refresh-bundled-packages.ts` after
    editing their catalog source; this task does not need that command.

    Acceptance: drive real `runTurn` to save "I dislike cilantro", start a
    new conversation, then ask "What do you remember about cilantro";
    return that fact. A sibling's fact never appears, including for admin
    conversational recall. Household shared facts still appear. Exercise
    both turn transports and shared recipe fixtures. Out of scope:
    automatic extraction redesign and admin permission changes. Checks:
    named backend suites, shared recipe fixtures, affected catalog checks
    if its source changes, and full exit gate. Landed date unrecorded (no commit names this ID; ticked before 2026-09-21).

 - [ ] **TOOL-EVENTS-01: the wire streams a tool call's lifecycle** (M). When the turn engine routes to a package (weather, almanac, a lookup) it emits a `tool_call` event at the start (tool_id, a human label the manifest supplies such as "Checking the weather for Seattle", the args it can show) and a `tool_result` or `tool_error` at the end, before the done event, on minors' turns too; the reasoning event is the pattern. Spec first (the event shapes in the wire, a spec tag), then `backend/src/routes/turn.ts` and `turnEngine.ts`, tests for start, end and error ordering. Fed to the Elements' tool-timeline by SHELL-02 slice 5. Exit: `bash scripts/check.sh`. **Frontend half landed 2026-09-22** (pin bump to spec-v0.1.16, `chatModelAdapter.ts` parses `tool_call`/`tool_result`/`tool_error` into a `tool_timeline` tool-call part, `NextChatPage.tsx` registers the kit's `ToolTimeline` Element) - renders nothing live until this item's own backend half (routes/turn.ts, turnEngine.ts) actually emits the events; proven by `chatModelAdapter.test.ts`/`NextChatPage.test.tsx`'s scripted streams only. See `docs/dev.md`, "Slice 5(b): the tool timeline."

- [ ] **TOOL-EVENTS-02: a search step shows the sites it read, as chips with their icons** (M, after TOOL-EVENTS-01's backend half and SRC-ICON-01, 2026-09-22; owner request with the AI SDK chain-of-thought screenshots: "Searching for recent work" over `github.com` and `dribbble.com` chips). The tool timeline already renders each step's label ("Searching the web for who won the Mariners game", "Checking the weather in Seattle"); this adds what the step found. Backend: websearch's `tool_result` carries the result sites it used (host and page URL, at most five, the same list that becomes the reply's sources) as an additive field in the wire's tool event (spec first, a spec tag). Frontend: under the step, each site is the kit's vendored assistant-ui source chip (`sources.aui.tsx`'s `Source`/`SourceIcon`, the SRC-ICON-01 composition: `referrerPolicy="no-referrer"`, icons through `/api/favicon`), inside the kit's `ToolTimeline` step; first check whether assistant-ui's own chain-of-thought or tool-timeline Element already ships a results slot and use it as shipped if so (no hand-built row). A weather or almanac step shows no chips (it read no web page). Acceptance: a live search on 8787 shows the step with its site chips while the reply streams, each chip opens its page, and a weather question shows the weather label with no chips; captures at 1440 and 390, light and dark, opened and judged. Exit: `scripts/check.sh`.

 - [ ] **WEATHER-GEN-01: the weather package emits richer structured parts** (M). Beside its `spec_sheet` (current conditions) the package emits a `chart` part (the next 24 hours' temperature series), a `data_table` part (the 7-day forecast: day, conditions, high, low) and `sources` (the provider it queried, the citation shape CHAT-16 uses), from data it already fetches. The part kinds and shapes join StructuredPart in the spec with fixtures, shaped exactly as the `chart`, `data-table` and `sources` Elements take their data (read the vendored Element props first), so the frontend registration is a pass-through and nothing is drawn by Home. Files: `backend/packages/weather/*`, `commons/spec/records/structured-part*`, tests. **Note, slice 5(a) (2026-09-22)**: `toolName: "sources"` is now registered on `NextChatPage.tsx` for the turn-LEVEL `TurnValue.sources` card (docs/dev.md) - if this item's own weather-package `sources` structured part lands as its own separately-registered tool call, it needs a different `toolName` (or a merge into the turn-level list instead of a second registration), not a collision on the same name. Exit: `bash scripts/check.sh`.

- [ ] **WEATHER-ICONS-01: animated weather icons and condition backgrounds on the weather card** (S-M, after WEATHER-GEN-01). Objective: the weather parts carry a condition code, and the card renders an animated icon for it plus a condition background (the old Home's weather app did this well: amCharts' animated SVG weather icons, downloaded at build time by `scripts/fetch-third-party.mjs` with pinned sha256 sums per file and the licence file kept beside them, never tracked; and `WeatherHeroBg.tsx`'s CSS-animated rain, snow and cloud layers over a gradient chosen by condition and time of day; both in `legacy-backups/home-legacy.git`, reference only, the fetch pattern and the effect parameters are the hard-won part). Rule kept: the icon set is a download, pinned and checksummed (the org's third-party rule), rendered as an `<img>` in the Elements' own card slot; the background is tokens and CSS on the card the Element renders, no hand-built component. Applies to the chat's weather card, the dashboard's Today card (DASH-CARDS-01) and the glance surface. Acceptance: every condition the package can emit maps to an icon and a background (a test over the mapping), day and night variants, reduced-motion honoured, the fetch verified against the sums in the gate, captures of three conditions. Exit: `bash scripts/check.sh`.

- [ ] **ROUTER-RLCD-01: bench a constrained-decoding classifier as the router** (M, a bench with a runbook, owner-authorized 2026-09-22). The candidate is `harshatheg/Qwen-2.5-1B-RLCD` (Qwen2.5-1.5B-Instruct fine-tuned for constrained JSON decoding: structured extraction, decision routing and categorical classification; Apache 2.0; 68 to 270 ms per decision on an M4 Max through MLX with 100 percent schema validity, per its card). Objective: measure it on the routing corpus (`backend/scripts/bench/datasets`, the routing rows, plus ROUTE-FIND-03's rows) against the current router (the rules and the chat model's fallthrough) for route accuracy, per-turn latency and schema validity, on the dev Mac through `mlx-lm` in a throwaway venv under the data directory (never installed globally), with the routing schema as the constrained output (route id, the package's args, a confidence). Rules: the org's learned-component rule (RULES-AND-LEARNED-COMPONENTS.md): it may take the router and the judge's extraction, never the safety, consent or privacy path; the model is fetched pinned by revision and sha256 and never tracked. Second candidate, same bench, added 2026-09-22 (the owner's find): `convaiinnovations/laya`, a ModernBERT-large backbone (421M English, 322M multilingual) with a decision head, Apache 2.0, safetensors, trained by the same RLCD idea but non-autoregressive: one forward pass returns a typed answer with a calibrated probability (their numbers: about 33 ms on a T4, 193 to 464 ms on CPU), which is the shape a router wants and the shape RVW-2 already asks for ("a MiniLM or ModernBERT-class encoder"), so bench it for BOTH the router and the turn-signal head; on this Mac it runs through PyTorch MPS or a converted ONNX or MLX build, and the bench records which path was used and its per-decision latency. The calibrated probability is the part to check hardest: a router that says "weather, 0.42" is only useful if that number means something on our own corpus. Deliverable: a bench log in dev.md with the three numbers per model and a verdict line; if it wins, follow-ups: the `router` role served through an MLX engine kind in the Stack (the Studio's engine) and the judge's extraction on the same model. Exit: the bench script under `backend/scripts/bench/` and `bash scripts/check.sh`.

- [x] **ROUTE-FIND-03 (b): "search"/"look up"/"google" is an explicit websearch command, 2026-09-22 - done 2026-09-22.** **Superseded 2026-09-22:** its wildcard patterns in `websearch/manifest.json` are deleted in D7 (`docs/plans/simple-turn-pipeline-2026-09-22.md`), once the model itself treats a bare "search"/"look up"/"google" as what it already does. "search who won the Seattle Mariners game yesterday" got "Noted.": read against the hub's own logged rows, the model had websearch offered and declined it, and its reply tripped the `placeholder_echo` guard, whose acknowledgment line (`guards.ts`'s `ACKNOWLEDGE`, "Okay."/"Got it."/"Noted.") replaced the cut reply - not, as first read, the remember package's own acknowledgment. `search <anything>` matched nothing in websearch's patterns (`search the web for *`, `search online for *`), so the model was left to decide, and declined; a leading "search" (and "look up", "google") is an explicit websearch command whatever follows, and should never reach the model's discretion at all. Fixed: `backend/packages/websearch/manifest.json` gained `"search *"`, `"look up *"`, `"google *"` patterns (Tier 0, deterministic, always wins, bypassing the model entirely - `turnEngine.ts`'s `routeLiteral()`), which also feeds `commandOpeners()` (routing.ts's `commandOpenersFrom()`) so a search/look-up/google command classifies as a directive and the memory judge skips it, never a fact. Found and fixed along the way: the new bare `"search *"` pattern re-matched text an earlier, more specific pattern had already yielded on for an unresolved reference ("search the web for that movie" with no world head), winning with a wrong, over-broad capture instead of yielding - `routeLiteral()` now makes an unresolved-reference yield skip the rest of that package's patterns entirely, caught by the existing CHAT-13 chunk B test. Also found: `backend/tests/tier2.test.ts`'s invention-retry test used "can you look up the odyssey's rating" as an utterance meant to reach the model (Tier 2), which the new "look up *" pattern now intercepts at Tier 0 - reworded to "can you check the odyssey's rating" (still `REQUEST_RE`-matching, still reaches Tier 2, confirmed with `route()` returning null). Verified: the utterance plus five paraphrases in the routing corpus (`spec/llm/routing-corpus.json`, pinned from `getmaipai/commons` at spec-v0.1.18) with expect `websearch`, a collision pin ("look up the artist Adele" still expects `music`, whose own more specific pattern wins over websearch's new broader one via package iteration order), a `memoryJudge.test.ts` regression proving the judge never treats a search command as a fact, corpus run green with no regression on existing rows, full `bash scripts/check.sh` green (3751 backend + 637 frontend tests, 0 fail). Exit: `bash scripts/check.sh` and the routing corpus bench.

- [ ] **ROUTE-FIND-03 (a): a recent-events question with no search verb is still a search, 2026-09-22** (merges with REPLY-FIND-02, next). **Thrown away 2026-09-22:** the lookup ladder this row would extend is deleted (D1/D2, `docs/plans/simple-turn-pipeline-2026-09-22.md`); the model's own tool call, plus the interim always-search rule for a world question, replaces it. "what did Apple announce this week" got the stuck fallback ("I'm stuck on that one, sorry. Ask me again some other way?") instead of a web search. Not a `route()`/Tier 0-1 fix (design-resolver, 2026-09-22): websearch is deliberately never the deterministic Tier 1 winner from a fuzzy example alone (several `noiseFloorExempt` null rows in the routing corpus encode this on purpose), and a generic recency signal there would flip some of them. The real gap is the existing pre-model lookup-decision path (`backend/src/lib/turnContext.ts`'s `lookupDecision`/`exactFieldOf`/`CURRENCY_MARK_RE`, plus `backend/src/lib/unknownNames.ts`'s org-name resolution) - "forced freshness for a recency question" already exists there but doesn't yet recognize an announcement/news verb plus an explicit time window as a lookup field, and doesn't tag a bare org name like "Apple" as a resolvable subject. An independent architecture review the same day reached the same conclusion for REPLY-FIND-02 ("admit by properties"): the lookup ladder should admit a currency-marked turn by its properties (recency, a world subject, an announcement/news verb), whether it's a question or a statement - so these two rows do one fix together, not two. Files (corrected from the original file pointers, which named `routing.ts`): `backend/src/lib/turnContext.ts`, `backend/src/lib/unknownNames.ts`, `backend/src/lib/turnEngine.ts` (a `decidedLookupFor()` extraction plus `runForcedLookup`), `backend/tests/routingCorpus.test.ts` and `backend/scripts/bench/routing.ts` (so the corpus harness checks the lookup decision when `route()` returns nothing, the same way it already checks skills), `backend/tests/turnContext.test.ts`. Corpus rows first, `spec-v0.1.19` alongside REPLY-FIND-02's row. Exit: `bash scripts/check.sh` and the routing corpus bench.

- [ ] **GATE-SPEED-02 (a): run the backend and frontend legs of `scripts/check.sh` concurrently** (M, after GATE-SPEED-01's per-stage times exist, 2026-09-22). Each leg's output buffered and printed whole; decided only on the measured peak memory of both legs together, since the one-gate-at-a-time rule exists because of memory pressure on a 24 GB machine. Exit: `scripts/check.sh` twice green, stage times before and after in dev.md.

- [x] **GATE-SPEED-02 (b): fix the tests that fail only under the full run - done 2026-09-22, getmaipai/home#123.** This row's original scope (the wildcard-capture test in `turnEngine.test.ts`, the invention pre-check in `tier2.test.ts`, a "port 0 in use" failure) predates a real investigation: filing #123 found five different, real tests failing only under the full suite, none of them these two (the `tier2.test.ts` one was separately fixed as part of ROUTE-FIND-03 (b) above). Root cause for four of the five: a crisis/safety notification and a memory embed job are fired and never awaited in production (by design), so their DB work could still be running when the next test's own `resetDb()` wiped people/sessions out from under it - a new in-flight registry (`backend/src/lib/backgroundWork.ts`) tracks each one, drained after every test via a global `afterEach` in `tests/preload.ts` (a `beforeEach`-based first attempt measurably didn't work - still failed 4-5 times per 44-test run, since only `afterEach` for test N is guaranteed to finish before `beforeEach` for test N+1 regardless of cross-file registration order). One of the two crisis-overlay tests had a second, distinct bug: it calls `resetDb()` a second time inside its own loop over 48 registry keys, a call the global `afterEach` can't protect since that only fires between whole tests - drained explicitly there too, and its timeout raised (5s to 15s) since 48 keys of real work occasionally out-budgets bun's default under genuine full-gate contention; `NotificationBell.test.tsx` hit the identical timeout-under-load shape and got the same two-layer `waitFor`+test-timeout fix its own sibling test already used. The fifth test (`MemoryPage.test.tsx`) no longer exists (retired by 7fe8d9e7's HOME-UI-02d rename to `PersonMemories.tsx`) - added a minimal regression test for its live, previously-uncovered `archiveMemory()` call site. Landed in c7f48acd. The "port 0 in use" failure from this row's original scope is unaddressed - not reproduced during #123's investigation, still open if it recurs.

- [ ] **GATE-SPEED-02 (c): scope the `a11y` stage to the routes a diff touches** (M, after GATE-SPEED-01's per-stage times exist, 2026-09-22). The `a11y` stage launches real Chromium over every route; scope it down only if its measured time justifies it. Exit: `scripts/check.sh` twice green, stage times before and after in dev.md.

- [ ] **ROUTE-FIND-04: literal routing prefers the most specific pattern, and a discourse "look," is not a command** (S, corpus first, 2026-09-22; from ROUTE-FIND-03 (b)'s review, 2e67fd9e). (a) `routeLiteral()` (`turnEngine.ts` near :1445) resolves two packages' matching patterns by the alphabetical package order of `loadAllManifests()`, not by specificity, so a package sorting after `websearch` with its own "search"/"look up"/"google" pattern is silently shadowed; the music/websearch collision is pinned by a corpus row, the mechanism is not fixed. Fix: among matching patterns, the one with the longest literal prefix wins, ties by package id. (b) `commandOpenersFrom()` takes a pattern's first word as a bare command opener, so "look up *" made "Look, I really think we should talk about this" a directive the memory judge skips; the same trait already misfires on "Put simply, ..." and "Open your eyes to ...". Fix: an opener is the pattern's full literal prefix before the first wildcard, and a first word followed by a comma is never an opener. Tests in these exact words: "look up the artist Adele" routes to music whatever the package order; "Look, I really think we should talk about this" and "Put simply, it's complicated" are not directives. Out of scope: (c) the review's note that "search the house for the keys" routes to websearch, which is the owner's stated rule for a leading "search" (ROUTE-FIND-03 (b)). Exit: `scripts/check.sh` plus the routing corpus replay.

- [ ] **REPLY-FIND-01: a repeated question gets its right answer again, never the stuck line** (S, regression test first, 2026-09-22). **Thrown away 2026-09-22:** the repeat guard it would patch is deleted whole in D4 (`docs/plans/simple-turn-pipeline-2026-09-22.md`); if the flip is more than a week out, this row's one-line exemption may land as a stopgap, and is deleted with the family regardless. Found in the owner's own chat and traced from the hub's rows: "who is the president of France", asked twice fourteen hours apart in one conversation, got a correct 35-token answer both times, and the second was thrown away. `isRepeatReply()` (`backend/src/lib/guards.ts` near :1278) found 80 percent overlap with the earlier answer and no new number or proper noun, the one retry gave the same answer, and the loop line replaced it (`guards.ts` near :2128, :2190); the row reads `guard_reason: repeat_reply`. Its only exemption is "say that again" (`repeatRequested`). Fix: (a) when the current utterance matches an earlier user turn in the window (the same normalization the guard uses for replies), the same answer is correct and the guard does not fire; (b) the previous replies the guard compares against come from the same sitting only (a gap of more than the session idle threshold ends a sitting; reuse the constant the window already uses if there is one, else name one in `turnContext.ts` beside `previousReplies`). Mirror the existing REP-01 tests in `backend/tests/` (grep `isRepeatReply`). Acceptance: a test in these exact words (the question asked twice, the second reply the same) passes through unchanged; a test with a 14-hour gap passes through; every existing REP-01 test still passes. Out of scope: the repeat guard's thresholds. Exit: `scripts/check.sh`. Diagnosis: `docs/plans/arch-review-2026-09-22.md`'s companion chat trace, this row.

- [ ] **REPLY-FIND-02: news about a current subject earns a lookup or a question, not a react-and-agree** (M, corpus first, 2026-09-22). **Thrown away 2026-09-22:** the lookup ladder is deleted whole (D1/D2, `docs/plans/simple-turn-pipeline-2026-09-22.md`); the model's tool call plus the interim always-search rule covers this row without a properties fix. Found in the owner's own chat: "new trailer for primetime just dropped" was read as an inform about a world subject (kind trailer, recency current) and given the inform plan (react allowed, ask-back forbidden, 30 words, two sentences); no lookup ran because the ladder only fires on a question with an exact field (`turnContext.ts` near :281, :303-305), and a stale memory (a release date) let the model answer "you've got the date right" about a date the person never gave. Fix: the ladder accepts an inform carrying current recency about a world subject (the signal already has target, kind and recency), and the inform plan allows an ask-back (`register.ts` plan table). Acceptance: the utterance in the routing corpus with its expected rung; a turn test that it reaches websearch; the existing inform rows unchanged. Out of scope: the memory framing (REPLY-FIND-04). Exit: `scripts/check.sh` plus the routing corpus replay.

- [ ] **REPLY-FIND-03: a correction repairs the last turn, and a deliverable search keeps the person's noun** (M, corpus first, 2026-09-22). **Thrown away 2026-09-22:** a correction is conversation the model reads from the window (`docs/plans/simple-turn-pipeline-2026-09-22.md`); the deliverable rule it would also patch is deleted in D5. Found in the owner's own chat: "no, I was talking about the trailer" was read as a correction, but the deliverable rule fired on "trailer" as a video, forced a websearch, and the query builder sent "Primetime video": the first result was a streaming storefront, the actual trailer third, and the composer said "Here's a video, the link's below". Fix: (a) a turn whose signal is `repair: correction` re-reads the previous utterance with the corrected subject through the same ladder REPLY-FIND-02 adds, so the corrected turn reaches the lookup the original should have (the original turn had no intent to re-run: rung none, no outcome); (b) the deliverable query keeps the person's own noun ("trailer", not the kind "video"), and result selection prefers a title containing that noun. Files: the deliverable rule and query builder (grep `deliverable.video`, `lookup.forced` in `backend/src/lib/`). Acceptance: both turns as a two-turn corpus row; a query-builder test that "trailer" survives; a selection test that a title with the noun beats a storefront. Exit: `scripts/check.sh`.

- [ ] **REPLY-FIND-04: a remembered fact enters the prompt dated and labeled, never as the person's words** (S, 2026-09-22; the 2026-09-16 review's item 5, still unbuilt). **Folded into U5 2026-09-22** (`docs/plans/simple-turn-pipeline-2026-09-22.md`, "The chat rebuild" area above): built on the new path's shared context list, both paths' input. Memory snippets reach the prompt as bare text, so the model presented a remembered release date as something the person had just said. Fix: each recalled memory renders as a typed, dated line ("remembered Sep 15: ...") where the memory block is assembled (`turnEngine.ts` near :580-584). Acceptance: a prompt-assembly test that each recalled memory carries its date and a "remembered" label; the existing recall tests pass. Out of scope: the memory budget (see `docs/plans/arch-review-2026-09-22.md`). Exit: `scripts/check.sh`.

- [x] **ARCH-AMEND-01: amend the four ARCH rows and RESP-01 to the accepted review** (M, design, 2026-09-22, done 2026-09-22: each ARCH row carries an "Accepted design" paragraph, RESP-01 is rewritten against `register.ts`, the response-contract record's item 1 is amended, and the `c-99f2` brief is back in `open/`; owner ruling "accept all" on `docs/plans/arch-review-2026-09-22.md`). The three ranked findings are now the design: (1) ARCH-AGENT-01 sizes by measured per-model capability from the tool-calling bench (stored with the model in the catalog), not the governor's memory tiers; keep safety, a properties-admitted fast path and one completion with tools; add the deterministic action-plan executor; a second round only when a bench row needs it; a stable offered tool set per model. (2) ARCH-POLICY-01's boundary runs over one `ContextItem` list (text, source channel, subject ids, disclosure), the only thing a prompt is built from, and presence is a turn input on every surface. (3) One ReplyPlan (the spec's existing `reply-plan.json`, extended with fact classes and a surface-derived budget) is the only place length is decided; `max_words` comes from surface and evidence, not the act table (`register.ts` `planFor`); reply constraints decay by turn count. Work: rewrite each ARCH row's design section and RESP-01's files and acceptance to match, mark superseded text as such, and rewrite the held lane brief `c-99f2` (RESP-01) against `register.ts`. Owner: the Fable session (design). Exit: the docs-only gate.

- [ ] **LOOKUP-HEAD-01: a learned head decides whether a turn needs a lookup** (M, after ROUTER-RLCD-01 reports; Opus for the design and the bench read, Sonnet for the integration; decided 2026-09-22). The design ruling of 2026-09-22 (owner: the word-rule fixes for casing and pronouns are fragile): code decides whether a lookup may and must run from a small closed set of counted properties (a currency marker, a world subject, a news verb with a time window, a present-tense office-holder question), the model's own tool call and the draft reader; the model writes the query (REPLY-FIND-05). This item replaces the properties as the admission decider: a calibrated head over the rows' `rung` and `corrected_next_turn` labels (harvested by `scripts/bench/labels.ts`, the 2026-09-16 review's item 3), the properties kept as the day-one fast path, each regex family retired on the per-rule hit report. Measured 2026-09-22 on the 8B: 0 false tool calls in 100 negative repeats, the failure class is declining a search that fits, so admission cannot be left to the 8B alone. **Track-3 verdict, 2026-09-22 (dev.md, "Track 3: the local decider verdict"):** open-jev-deberta-v3-large is the path, after fine-tuning on household labels; zero-shot it reproduces the interim rule's decision and its failure (every ambiguous negative admitted, 5 of 5) at 65 ms, so it does not enter shadow mode as it stands; jeff and openjev are dropped. Order: (1) the labelled set (U0a's replay rows, the corpus's question and null rows relabelled for lookup need, the owner's own labelled turns, never a frontier model over household transcripts (egress; a frontier model may label roster-based synthetic data only), ambiguous negatives included; `corrected_next_turn` is NULL on every row today, so `labels.ts` starts writing it first), (2) the shadow seat inside U2's model node writing the head's choice and probability to `stats.nodes[]` beside the rule's decision and the model's call, (3) the fine-tune, calibrated, shipped as a fetched artifact, run on CPU, (4) the bench against the interim rule and the 8B's own call on held-out rows and the replay set; adopted per model budget when its false-positive rate on ambiguous negatives beats the rule's with no positives lost and the five-point margin on the corpus. The robot fits on paper (400M, about 1.6 GB f32) and is measured when a Pi is reachable. **Astra's amendments (2026-09-22):** DeBERTa is a pilot, the ModernBERT head runs in the same bench; shadow mode may start once a labelled set exists, with bounded overhead and disagreement logging; 500 to 1,000 locally labelled examples split by conversation; precision, missed lookups, Brier and reliability at the operating threshold; GLiFormer inconclusive; frontier labelling of household transcripts is ruled out (egress). Not before the labelled set. Exit: the bench table in dev.md and `scripts/check.sh`.

- [x] **ARCH-MEASURE-01: the three measurements the four ARCH records wait on** (M, bench, 2026-09-22; verdict written 2026-09-22 22:45, dev.md "ARCH-MEASURE-01: the per-model budget verdict": the 8B, 4B and 1.7B budget records with every unmeasured cell marked and the conservative value taken, always-search on for all three, model-driven transitions on for the 8B only, and a new budget field `query_writer`: the engine's builder writes the query for the 4B and the 1.7B (rewrite 1 of 8 and 2 of 15 rows at the bar), the model for the 8B pending its quiet run; the owed reruns are MEASURE-02). From the independent review (`docs/plans/arch-review-2026-09-22.md`): (1) the tool-calling bench (`scripts/bench/tool-calling.ts`) per candidate chat model on the fixed pipeline, irrelevance detection at 10 repeats; (2) llama-server's cached versus evaluated prompt-token counts on two consecutive turns whose offered tool sets differ (confirms or kills the prefix-cache hypothesis); (3) the routing corpus decision table ARCH-AGENT-01 asks for. A first data point for (1): on 2026-09-22 04:21 the 8B, with websearch offered on the same completion, did not call it for "search who won the Seattle Mariners game yesterday", a measured miss in the inverse direction (a tool that fits, declined) on the fixed pipeline. Numbers recorded in dev.md with engine build, model file and a sanitized hardware line. No ARCH design record starts before this lands. Exit: the three tables in dev.md.

- [ ] **MEASURE-02: the owed model runs** (S each, bench, Sonnet, 2026-09-22). From the ARCH-MEASURE-01 verdict: (1) the 8B query-rewrite bench on all 15 rows in a gate-free window (U2d's acceptance number, the 90 percent bar at 9 of 10); (2) the 4B rewrite rows 9 to 15 (its tool-calling row is confirmed twice: 19 of 50 and 7 of 25 fitting searches); (4) latency per model with the LAT-03 probe (prefill at about 300 and 1,000 tokens, decode at 64 tokens), three cold repeats; (5) the Studio's model on arrival, with the candidates as Astra's stack review names them, all pending the Studio: the Studio's first chat candidate the official Qwen3.8-27B at Q6 on a pinned llama.cpp build, thinking off by default (ordinary and child turns) and no preserved reasoning history, Qwen3.6-35B-A3B second if latency disappoints; the robot trial Qwen3.5-2B at Q4 against the 1.7B baseline, thinking and transitions off, adopted only with acceptable latency beside speech. Each result updates the budget table in dev.md and the model's `turn_budget` record, versioned against the model artifact, engine build, prompt and tool set. **Centrepiece (Astra, 2026-09-22):** end-to-end search success on fresh held-out multi-turn conversations through the shipping configuration, timeouts counted as failures, compared with the builder fallback. Rules: a side instance only, never 8788; start only when no gate runs, or record the gate state per line and count a timeout as not measured. Exit: the table cells filled in dev.md.

- [ ] **ENGINE-CONTRACT-01: the role adapter proves what the engine guarantees** (S, Sonnet, 2026-09-22; Astra's stack review). "OpenAI-compatible" guarantees none of what the turn needs. The chat role adapter (`llm.ts`, the spec's client) gets a check suite per pinned engine build: `tool_choice` `required` and `auto` honoured; reasoning separated from content; a thinking limit per request honoured; cancellation reaching the engine (the request stops decoding); per-call timing fields present. Tests in these exact words: a `required` call returns a tool call every time; an `auto` call on "good morning" returns none; a reasoning-on call returns reasoning and content in separate fields; an abort within 200 ms stops the engine's slot (its `/slots` shows idle); every completion carries `prompt_ms` and `predicted_ms`. Runs against the pinned build on a side instance; the results and the pinned set (Bun, engine build, model digest, quantization, template, thinking settings, tool set) recorded in dev.md. Exit: `scripts/check.sh` and the suite green on the pinned build.

- [ ] **OFFLINE-TEST-01: the egress-denied startup and turn test** (S, Sonnet, 2026-09-22; Astra's stack review). A test that starts the hub with every outbound connection denied at the process level (a Bun fetch shim or the OS firewall in the test's own sandbox, never a machine setting left behind) and runs one full turn on preloaded artifacts: nothing downloads, nothing phones home, dependencies resolve from the frozen cache, and the turn answers; a websearch turn fails with the honest unavailable line, never a hang. Acceptance: the test in `scripts/check.sh`, green; the list of every outbound endpoint the hub may ever contact, declared once (PRIVACY.md) and asserted against. Exit: `scripts/check.sh`.

- [ ] **STUDIO-ACCEPT-01: the tier acceptance workload, run on tier 1 first** (M, Sonnet; retitled 2026-09-23 by the hardware tiers plan, `docs/plans/hardware-tiers-2026-09-23.md`). Objective: one realistic workload per hardware tier that sets that tier's concurrency and residency limits: on tier 1 (this 24 GB Mac) one voice conversation and one typed conversation at once, plus one photo turn and one picture job in the same run, measuring first useful answer, first spoken word, peak memory and cancellation; tier 2 and tier 3 rerun the same workload and set their own limits, the Studio last. Files: `backend/scripts/bench/` (a new `tierWorkload.ts` mirroring `conversation.ts`'s runner and LAT-03's probe), the limits declared once in the Stack's governor and the packages' warm limits, dev.md's table with the pinned set. Acceptance: the numbers recorded per tier with the pinned set, the limits declared once, the workload green on them. Out of scope: the floor run (FLOOR-ACCEPT-01). Exit: the limits declared once and the workload green on them.

- [ ] **REVIEW-0922-01: the smaller findings of the 2026-09-22 architecture review** (S each, 2026-09-22; source `docs/plans/arch-review-2026-09-22.md`, all verified against the code). (a) `sensitiveAllowed()` (`backend/src/lib/turnContext.ts:54`) returns true on every surface but the robot, so a shared screen (the TV client, a glance hub) would show a parent's sensitive memories with children present: presence becomes a turn input on every surface, and no shared-screen surface ships before a test proves it withholds by default. Not live today (no shared surface exists yet). (b) The wake-word invariants ruled 2026-09-22 exist only in DECISIONS.md and this file: write them into `.github/docs/SAFETY.md` and the settings registry. (c) `llm.ts` exports the raw token stream to any importer, so the output gate's "no ungated path" holds for one function, not the system: narrow the export or add a lint rule, and correct the claim. (d) Sentence splitting in `guards.ts` (near :2286) is a regex where `Intl.Segmenter` ships in the runtime (principle 6). (e) ARCH-BUILD-01's candidate list gains XState v5 beside the in-house TurnGraph option (EVAL-06 already names it). (f) The pending-patches table in dev.md has four rows at "PR not yet opened", against the 2026-09-22 rule that an unlinked edit to vendored code is a fork to revert: open or revert each. Exit per part: `scripts/check.sh`, or the docs-only gate for (b), (e) and (f).

- [ ] **TEMP-CHAT-01: a temporary chat that is never remembered** (M, backend first). ChatGPT's temporary chat, and on a household hub whose whole premise is that it remembers, it matters more than it does there: a parent must be able to ask something without it entering history, the thread list, or memory. Not a UI feature - a turn-pipeline one. A conversation marked temporary writes no `conversations` row and no `conversation_turns` rows, and the memory judge never runs on its turns (`backend/src/lib/` memory extraction path); it is gone when the tab closes. **Safety is never skipped**: the safety-first order in `turnEngine.ts`, the role floors and the guards all run exactly as they do on a normal turn (`.github/docs/SAFETY.md`: child-safety protections are non-removable architecture, not a setting), and a child's temporary chat is still age-gated and still subject to every content ceiling. What a temporary chat skips is persistence and memory, nothing else. **Amended 2026-09-22 after Session B found a temporary chat already ships** (Chat 55, `d892052a`, wired into the OLD hand-built chat): turns are already skipped, the thread list already excludes it, minors already get a 403, and the memory judge already cannot see it - but it still writes a content-free `conversations` row. That row goes. What it leaks is metadata (this person had a conversation, on this surface, at this time), which on a household hub is the thing the feature exists to prevent; content-free is not the same as absent. So: no table touched at all, and the multi-turn window lives in process, keyed, size-capped and idle-expired, extending `resumeSessions`/`inFlightTurns` rather than a second store (Session B's catch: a strict zero-row reading without this makes every turn amnesiac, which is a broken chat, not a privacy feature). One implementation, not two - the old chat's call site uses the new path; SHELL-09 deletes the old chat itself. Reasoning: `.github/docs/DECISIONS.md`, 2026-09-22. Entry point: the conversation header's menu (CHAT-HEADER-01) and a New Thread variant, both labelled so a parent understands what is and is not kept. **Widened 2026-09-22, an independent review**: the durable-write audit missed `queueOpenQuestion` (`turnEngine.ts`'s `resolvePendingAsk`, the "who"/"relay" continuation) - unreachable for a temporary conversation in practice (its own `getPendingAsk`/`setPendingAsk` gate already closes the path, proven by a direct test rather than assumed), but named in the acceptance anyway so the guarantee is stated, not inferred from a chain of other things happening to hold. Acceptance: a temporary turn leaves no row in `conversations`, `conversation_turns`, `reply_constraints`, or `open_questions` (asserted directly against the db), the memory judge is never invoked (asserted with a spy), `host.artifact.create()` refuses cleanly instead of hitting the provisional-turn foreign key, the thread list does not show it, a child's temporary turn still hits the same safety path as a normal one (a test that a blocked utterance is still blocked), and reloading loses it. Out of scope: exporting one before it is discarded. Exit: `bash scripts/check.sh`.

- [ ] **CHAT-HEADER-01: the conversation's own title and actions, in the shell header** (M). ChatGPT puts the conversation title top-left with its actions top-right (rename, share, and the rest); the owner wants the same, **on every chat, not only project chats** (owner's call, 2026-09-22: a header that appears only inside a project makes the chrome jump when you move between them, and the actions it hosts are needed everywhere). **It does NOT add a row.** The title and its actions go into the shell header that `shadcndashboard` already renders, beside the existing trigger; a second bar under it repeats the mistake the owner already rejected once (2026-09-21, the chat sidebar toggle 'wastes an entire row of space'). **Named gap (the no-hand-built-UI rule):** the pinned kit (ui-v0.5.29, 144 elements) has no thread-header or conversation-header Element - verified by inventory, not assumed - so the composition is the template's own header slot plus its DropdownMenu primitives, and nothing else is invented. Share uses the shipped `shared-conversation.tsx`. Contents: the conversation title (inline-editable rename), and a menu with rename, share, delete, and the temporary-chat entry (TEMP-CHAT-01). An untitled conversation shows the same placeholder the thread list uses, never a blank bar. Acceptance: the title renders and renames on a normal chat and inside a project, the shell grows by zero rows at 1440 and at 400 (screenshot pair judged as one design, per the mobile rule), the menu's actions each work, and the header is absent on non-chat pages. Depends on: SHELL-09's cutover. Exit: `bash scripts/check.sh` and the captures.

- [ ] **SHARE-CONV-01: wire the header's own Share entry** (M). CHAT-HEADER-01 puts a Share item in the conversation menu (`frontend/src/apps/chat/chatHeaderBar.tsx`) but ships it disabled, behind `shareAllowed`, since no share-creation route exists yet: the shipped `shared-conversation.tsx` Element renders a share once one exists, but nothing today mints the shareable copy or its link. This item is that gap: a route that snapshots a conversation into a shareable record, the link surface, and enabling the header's own item once it is real. Depends on: the shipped Element's own data contract (read it first, don't invent a shape). Exit: `bash scripts/check.sh` and the captures.

- [ ] **HANDSFREE-01: hands-free, three separate things with three homes** (M). The owner drew the distinction that fixes this row (2026-09-22): the waveform is not the wake word, and neither of them is 'just speak to me'. They differ on two independent axes, how a turn STARTS and how the reply COMES BACK, which gives three features, not one control: **(a) Read replies aloud** - typed turn, spoken reply, no microphone involved. An output setting, so it does NOT live under a voice button; it is a per-conversation setting in the conversation header's menu (CHAT-HEADER-01) beside temporary chat, remembered per person with the conversation (PERSIST-CONV-01). The shipped `read-aloud.tsx` Element does the speaking and also gives the per-message control, which belongs in the message action bar slice 5(e) already built; the toggle only makes it automatic. **(b) Voice conversation** - spoken turn, spoken reply, a mode entered deliberately from the composer's waveform button, as SHELL-02 slice 6 plans. Its chevron carries voice selection. **Found landing slice 6 (2026-09-22):** the waveform button and its chevron are already built and unit-tested (`frontend/src/apps/chat/composerVoiceControls.tsx`, gated on stt+tts both ready) but not mounted - `ComposerAction`'s right group (the dictate mic, Send) has no append point the way the left group's `ComposerAddAttachmentOverride`/`ComposerExtra` do. This item cuts a matching right-side slot (a `ComposerExtraEnd`-shaped addition to `ThreadComponents`, commons, the same ui-v0.5.29/v0.5.31/v0.5.34 recipe, upstream-bound onto assistant-ui/assistant-ui#8003 or its successor) when it builds the real live session this control has nothing to drive yet. **(c) Wake word** - the same mode entered by touching nothing. This is hub-and-device state, not conversation state: if the hub is listening it listens whatever conversation is on screen, so per the one-definition rule it is declared once in the settings registry (`.github/docs/SETTINGS.md`, the generic renderer) and shown on the hub's voice settings page, sourced from an installed wakeword package (catalog `wakewords/`). The composer's chevron may offer a shortcut that flips that same setting; it never owns a second copy of it. **Wake-word invariants (owner's ruling, 2026-09-22, non-negotiable):** a wake word is never always on, the person is always in control, and the person always knows when it is listening. Concretely: (i) **off by default** and it stays off - installing a wakeword package does not enable it, an update never enables it, and no migration or default-restore may turn it on; (ii) **an explicit per-device opt-in** by an adult, one device at a time, never household-wide in one click, and a child profile can never enable it; (iii) **a persistent, unmissable indicator whenever the microphone is open** - visible on the screen the whole time it is listening, not a toast that fades, so a person walking into the room can tell; (iv) **turning it off is always one action** from that indicator itself, never a trip into settings; (v) **nothing before the wake word is kept** - the rolling buffer the detector needs is in memory, never written to disk, never a turn, never a memory record, and the detector runs locally like everything else (PRIVACY.md: nothing leaves the house); (vi) the indicator and the off switch are themselves part of the feature's definition of done, so a build that listens without showing it is a defect, not a missing polish item. Acceptance for these specifically: a fresh install with a wakeword package present listens to nothing (asserted); a child profile cannot reach the toggle (asserted); the indicator is present in the capture whenever the listening state is on and absent when off; and a test proves no pre-wake audio reaches disk, the turn log or the memory judge. Every piece hides when its role or package is unavailable (tts for (a), stt+tts for (b), an installed wake word for (c)), so an unconfigured hub shows none of it. Acceptance: with tts available a typed turn is spoken end to end and the Element's own controls work mid-speech, and the toggle survives a reload of the same conversation; the voice mode is unreachable without stt; the wake-word setting is absent with no wakeword package installed, and toggling it from the composer and from the settings page moves the one same value (asserted, not assumed); a child's turn speaks only content that passed the same safety path. Out of scope: barge-in (talking over a spoken reply to interrupt it), which needs the robot's echo cancellation and gets its own row. Exit: `bash scripts/check.sh` and the captures.

- [ ] **MODEL-SEL-01: choosing the model a turn runs on** (M, backend first). Nothing selects a model today: `frontend/src/lib/api.ts`'s `streamTurn` options carry `thinking?: boolean` and no `model`, `backend/src/routes/turn.ts` (both body copies) the same, and there is no engine-selection-by-model path downstream. So the composer control ChatGPT has cannot be built as a frontend slice; the capability has to exist first. Order: the turn route's body schema and the wire gain an optional `model` (additive, per the compatibility rule), the engine selection path honours it against the chat role's own models from the Engines route, and only then the composer entry. Gate the UI on there being 2+ selectable models: the Engines route's `roles` is commonly empty on an unconfigured hub, and a picker with zero or one option renders nothing at all, never a disabled trigger. Acceptance: a turn sent with an explicit model runs on that model, proven by a test asserting the dispatch, not the payload; an unknown or unavailable model falls back to the role default with a status, never an error; the picker is absent with fewer than two models. Split out of RESP-04 on 2026-09-22 after Session A proved the backend gap. **The shipped part probably already exists and the choice is deliberate, not a discovery:** `ui/src/elements/model-selector.tsx` is vendored in the kit - a full Popover + cmdk model picker whose own effort row renders exactly "Thinking" with low/medium/high radios (found by design-resolver during RESP-04 (f), 2026-09-22). It is very likely the answer here rather than a composition. The real question to settle before building is the one Session A raised: adopting it puts a Popover-positioned menu beside `ComposerMenu`'s composer-anchored one, so the composer would carry two menu conventions at once. Decide that deliberately - either the picker adopts the composer-anchored shape, or the thinking control moves into the model-selector's own effort row and `ComposerMenu` retires from the composer entirely (the Element already renders both, which is an argument for the second). Do not discover this mid-build. Out of scope: per-conversation persistence (PERSIST-CONV-01). Exit: `bash scripts/check.sh`.

- [ ] **PERSIST-CONV-01: composer settings remembered with the conversation** (M, spec first). The thinking control (and later the model choice) should persist per person with the conversation, as ChatGPT's does. It cannot today: `conversation.schema.json` in spec-v0.1.17 sets `additionalProperties: false` and has no settings field, and home's `conversations` table (`backend/src/db/schema.ts` line 308) has no column for one; the only precedent, `shellNextCache.ts`, is a single global localStorage key, which is device-local and would drop the setting the moment the same conversation is opened on the phone (the owner's "mobile is the same design" rule). Order, per the org's shared-record rule: the spec gains an optional settings object on the conversation record and a tag is cut, home pins it, a drizzle-kit migration adds the column, the conversation routes read and write it, then the composer reads it instead of per-turn state. Note `consumeThinking()` (`NextChatPage.tsx` line 772, `chatModelAdapter.ts` line 52) is a one-shot read-and-reset per message; these semantics replace that pattern rather than extend it. Acceptance: a setting chosen in one session is still set when the same conversation is reopened in a different browser, proven by a route test plus a history-adapter test; a conversation with no stored setting uses the default. Exit: `bash scripts/check.sh`.

- [ ] **STATS-PCT-01: `context_used_percent` is a permanent null and the old chat renders it anyway** (S). `backend/src/lib/turnStats.ts` line 35 sets `context_used_percent: null` unconditionally; nothing ever computes it, yet it is declared on the wire (`backend/src/wire.ts` line 70) and `frontend/src/apps/chat/chatTurnStats.tsx` line 52 renders a "Context used" row from it, so that row is blank on every turn of the current chat. Found while building slice 5(d) (home f1a3807f), where the same dead field made the obvious fallback for the context bar unusable. Decide and do one of two things, not both: compute it where the turn knows its engine's window (the chat role's `measuredContextLength`, the same value the Engines route already serves the new Details panel), or drop the field from the wire and the old chat's row. Computing it is preferred: the number is real and the new Details panel wants it too. Acceptance: either a turn's stats carry a `context_used_percent` that equals `context_tokens / measuredContextLength * 100` with a test on a scripted turn and the old chat's row filled, or the field is gone from `wire.ts`, `turnStats.ts`, `chatTurnStats.tsx` and their tests with no blank row left behind. Out of scope: CTX-SEG-01's segmented breakdown (home#133), which replaces the single percentage later. Exit: `bash scripts/check.sh`.

- [ ] **RESP-01: the written register for the typed screen** (M; amended 2026-09-22 by ARCH-AMEND-01: the cap is not in `persona.ts`). **Folded into U4 2026-09-22** (`docs/plans/simple-turn-pipeline-2026-09-22.md`, "The chat rebuild" area above): built on the new path, after U2. Two changes, one item. (1) `backend/src/lib/register.ts` `planFor` takes the surface class (`written` for chat and tv, `spoken` for robot, pod and phone voice and for a dictated chat turn, `glance` for overlay) and derives the budget from it: a written turn gets no act cap (a `max_words` and `max_sentences` sized by the evidence: a fact stays short, a how-to, a list or a comparison gets room, and "hi" still gets "hey" because the greeting act keeps its reaction shape, not because of a cap); a spoken turn keeps today's act table; glance keeps the card; the child band's cap holds on every class (a parental control, not a mode); `planLine` names no sentence count on the written class; `turnEngine.ts` keeps reading `max_tokens` from the plan at both generation sites so the cap moves with the plan, and the research-mode 30-word override stays. (2) `persona.ts` gains the written policy beside the spoken one, `composePersonaPrompt` takes the surface class, the engagement fragment's length clause moves into the spoken policy, and the turn request gains an additive `spoken` flag the dictation path sets (nothing marks a dictated turn today). Reply constraints decay: a `length` or `shape` constraint holds for the turn that set it and the next three (`replyConstraints.ts` `constraintsFor` takes the current turn), a banned phrase stays. No spec change: `max_words` and `max_sentences` are already integers on the plan; the fact classes are ARCH-LAYERS-01's, later. Acceptance: `register.test.ts` pins the written budget on chat and the unchanged act table on robot (its helper's default surface becomes robot for the table rows); `persona.test.ts` the policy per class; a turn test that a typed chat question's `max_tokens` is the plan's, not 128; the seeded voice set does not regress; a written set of twenty typed corpus questions judged for completeness against the ChatGPT bar by the benches' judge; "shorter" and "tell me more" work on both surfaces and "shorter" expires after three turns (a test). Design: [docs/plans/response-contract-by-surface-2026-09-21.md](plans/response-contract-by-surface-2026-09-21.md) as amended, and ARCH-LAYERS-01's accepted paragraph. Lane brief: `c-99f2`. Exit: `bash scripts/check.sh` and the named benches.

- [ ] **RESP-02: the spoken projection** (M). `reply.speech` becomes the voice contract: one to three sentences that answer plus the offer when the written answer is longer, produced by the composer from the full answer (a second short generation on the same context, or the model's own lead when it is already short), never truncation to the first sentence; a list reads its top three. Acceptance: a bench row per shape (a one-line fact, a list, a procedure, a comparison) judged for "answers first, offers the rest". Design: the same record. Exit: `bash scripts/check.sh` and the named benches.

- [ ] **RESP-03: the glance projection** (S, after the hub exists). The overlay surface renders the structured part as the card and speaks `reply.speech`; a tap opens the screen contract; the wire needs nothing new. Design: the same record. Exit: `bash scripts/check.sh`.

- [ ] **RESP-04: the composer's two controls, ChatGPT's and nothing more** (S, with SHELL-02 slice 5). **Minors, 2026-09-22 (owner's ruling on reasoning):** a minor's typed chat shows no Instant or Thinking control; the hub decides thinking for a minor from the model's budget record, a minor's request never carries `thinking`, and the backend ignores the field on a minor's turn if a client sends it (the safety exception B implements on the old path; the new path builds it into the context node). The `composer-model-picker` Element as shipped, its options the chat role's models from the Engines API, the label reading the current one; the thinking-effort control from the catalog if it ships one, else the picker's options carry Instant and Thinking; the choice rides the turn request (`thinking`, `model`, additive) and is remembered per person with the conversation, no settings page; voice and glance have no controls. Design: the same record. Exit: `bash scripts/check.sh`. **Found live, 2026-09-22 (Jesse): Thinking reverted to Instant right after sending, a defect against this row's own "remembered per person with the conversation."** Fixed the session-local half: `consumeThinking` no longer resets the mode per turn (`NextChatPage.tsx`), the same lifecycle `bareMode` already had - it now survives a send and resets only when the conversation itself changes (`onThreadIdChange`). Persisting the choice across a reload of the same conversation still waits on PERSIST-CONV-01 (no backend field carries it yet); this fix is the in-session half only.

- [ ] **REASONING-03: a child's reasoning is never persisted, on the old path too** (S, Sonnet, 2026-09-22; owner's ruling, a privacy invariant). The old path's fix 141eaf86 stores reasoning for every turn in REASONING-02's `reasoning` column and gates it on read; a minor's turn must store none at all (the row, the trace, history, exports, backups), on any setting, and the `list()` test that proves an owner may read a child's stored reasoning is retired with this reason. Parental audit keeps the question, the answer, the sources, the executed tools and the policy decisions. Adult retention unchanged (stored, gated on read). Test in these exact words: a child's turn with thinking forced on by a test budget writes an empty `reasoning` column and no reasoning in `stats`; an adult's turn still stores it and a second adult cannot read it. Exit: `scripts/check.sh`.

<a id="chat-06"></a>

- [x] **CHAT-06: Use one idempotent memory-ingestion service** (M)

    Depends on: CHAT-03 and CHAT-05. Files: new
    `backend/src/lib/memoryIngestion.ts`, existing `memory.ts`,
    `memoryJudge.ts`, `packageHost.ts`, `routes/memory.ts`, `db/schema.ts`,
    and their nearby tests. The service accepts actor, text, explicit or
    automatic origin, source turn, requested scope, category, importance,
    and validity bounds; returns saved record IDs, unchanged record IDs,
    or a typed rejection. Validate through the existing spec and content
    policy. Default to actor-person scope; household sharing requires
    explicit scope from an authorized caller, never a model's inferred
    value. Canonical duplicate comparison is Unicode NFC, trimmed and
    collapsed whitespace, case-folded text within identical scope/person;
    preserve original display text. Add a NOOP dedupe outcome for unchanged
    facts. Failed model dedupe leaves work pending instead of defaulting to
    ADD. Same-turn retries must neither duplicate nor repeatedly supersede
    facts. Use a transaction for store writes and job bookkeeping.

    Explicit requests persist the assertion before confirming; enqueue
    normalization for that record so a later rewrite supersedes it without
    changing visibility. Relative dates use the source turn timestamp,
    never retry time. Reuse existing scheduler/pending mechanisms; any new
    local queue state belongs in the existing DB with a migration, not a
    parallel store. Acceptance: repeated save, interrupted normalization,
    failed dedupe, and restart yield one active fact; a correction yields
    one supersession with preserved provenance. Out of scope: merging
    unrelated facts or changing visibility on inferred intent. Checks:
    memory, memoryJudge, packageHost and turn suites plus full exit gate.

<a id="chat-07"></a>

- [ ] **CHAT-07: Capture user assertions across package and model turns** (M)

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

- [x] **CHAT-08: Apply memory validity at read time** (M)

    Depends on: CHAT-06. Files: `backend/src/lib/memory.ts`,
    `memoryJudge.ts`, `routes/memory.ts`, `spec/schemas/memory-record.schema.json`,
    shared record fixtures, and `backend/tests/memory.test.ts`.
    Add an optional `asOf` to the single internal recall reader. Default to
    the turn's frozen time. Include only records satisfying inclusive
    `valid_from` and exclusive `valid_to`, with null bounds open. Current
    reads exclude superseded records; explicit historical reads may include
    superseded records valid at that time. Never include tombstones,
    privacy-denied records, or retention archives. Validate real calendar
    timestamps and reject reversed intervals, not just regex-shaped dates.
    Keep source creation time separate from fact validity in prompt labels.
    Use the existing `chrono-node` path for explicit query dates; if a date
    is ambiguous, ask for clarification rather than select a historical
    window. Add optional API `as_of` through its OpenAPI schema.

    Acceptance: trip ends at its stated boundary; future event is not
    described as currently occurring; an address correction returns the
    new fact now and the old fact for its valid historical date; leap-day
    and timezone boundaries behave deterministically. Undated durable
    facts remain usable. Daily maintenance is not required for expiry to
    work. Out of scope: graph time travel, resurrection of deleted records,
    or migration that guesses dates for existing undated facts. Checks:
    memory/judge tests, changed shared record fixtures, full exit gate.

    **Amended 2026-09-14 (dev.md section 14, part 4; the coherence
    review moves the confidence presentation and the two guard rows to
    CRED-01 and places this item before CUR-01, which archives what
    this reader already excludes):** the same reader
    applies, in order, privacy and disclosure, validity at the frozen
    time, active versus superseded or archived, unresolved conflict,
    confidence presentation, then ranking, and returns a typed
    `FactPresentation` per bullet (`plain | attributed | conflicted`
    with `source_ids`), never a bare float: a certain record plainly, a
    provisional one (below 0.85) with its source and tense, a
    conflicted pair as both with neither called wrong; confidence may
    lower a provisional fact's rank and never removes it; the guards
    read the band (`overclaimed_fact` when the model states a
    provisional fact flatly; `doubt_of_person`, cuttable, on "if
    that's true", "supposedly", "you claim", "are you sure", "that
    seems unlikely"); a historical `as_of` read uses current support
    for the fact valid then. Acceptance adds the recall turns of the
    `credence` conversations, three seeded runs.

<a id="chat-09"></a>

- [x] **CHAT-09: Version vector spaces and remove stale routing examples** (M)

    Depends on: none. Files: `backend/src/lib/routing.ts`, `memory.ts`,
    `llm.ts`, `embedSupervisor.ts`, `db/schema.ts`, `spec/llm/ts/types.ts`
    if the embed result contract changes, and embedding/routing/memory
    tests. Define embedding identity once as model artifact identity,
    dimensions, and preprocessing version. Thread it with query vectors;
    filter stored rows for exact identity before cosine scoring, including
    dedupe and contradiction checks. Preserve current preprocessing:
    routing document prefix with raw queries; memory raw documents/queries.
    Do not make the previously proposed prefix migration automatically.
    Existing unversioned rows are incompatible until re-embedded; use
    lexical fallback and existing retry jobs during migration. Re-embedding
    batches are bounded to 32 records and resume after interruption.

    Prune routing examples absent from the current manifest even when
    there are no missing embeddings, embedding fails, or the new examples
    array is empty. Never delete another package's rows. Invalidate cache
    identity on model changes, including equal-dimensional replacements.
    Acceptance: same-dimension different models never compare; incompatible
    records remain findable lexically; restart resumes migration; removing
    a formerly winning example removes its influence. Out of scope: vector
    database, ANN index, and unmeasured threshold/prefix changes. Checks:
    `routing.test.ts`, `routingCorpus.test.ts`, `memory.test.ts`, existing
    embed tests and full exit gate. Landed 2026-09-21 at 8243873e (c-99a):
    embedding spaces versioned by model artifact and preprocess (migration
    `0054_chat09_embedding_identity.sql`), the stale routing examples
    removed.

<a id="chat-10"></a>

- **CHAT-10: Resolve follow-up subjects for memory retrieval** (folded into CHAT-13 by the coherence review, 2026-09-14; the text below is the requirement CHAT-13 carries)

    Depends on: CHAT-01, CHAT-08, CHAT-09. Files:
    `backend/src/lib/turnContext.ts`, `conversationHistory.ts`, `memory.ts`,
    `entities.ts`, `relationships.ts`, and their existing tests. Build a
    bounded retrieval query from current text plus the last two same-thread
    user messages when the current text is a short follow-up or contains a
    pronoun/reference. Cap added context at 600 characters at whole-message
    boundaries. Keep original user text unchanged for display and literal
    routing. Resolve explicit names/aliases through existing Entity and
    Relationship readers under the actor's permissions; do not create a
    second identity graph. A single compatible recent subject can resolve a
    pronoun; multiple plausible subjects produce a clarification and no
    guessed personal fact. Entity evidence uses existing IDs. Remove the
    first-clause-of-memory-text heuristic only after its fixtures have
    equivalent structured coverage; unlinked old records still use vectors
    and lexical matching.

    Acceptance: Pippa painting followed by "Tell me about her" retrieves
    Pippa; two named relatives followed by an ambiguous "her" asks which
    one; conversation switching cannot carry the old subject; a child
    cannot resolve an inaccessible adult-private entity. Preserve relevant
    standalone queries and current recall floors. Out of scope: new LLM
    rewrite call, embedding-model changes, broad name extraction from
    arbitrary documents. Checks: memory/history/entity/relationship suites,
    turn-level follow-up regressions, and full exit gate.

<a id="chat-11"></a>

- [ ] **CHAT-11: Refresh profiles promptly and invalidate stale summaries** (M)

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

- [ ] **CHAT-12: Budget complete model requests without truncating evidence** (M)

    Depends on: CHAT-01 and CHAT-09. Files:
    `backend/src/lib/turnEngine.ts`, `conversationHistory.ts`, `llm.ts`,
    `llmSupervisor.ts`, existing engine capability/autotune readers,
    `spec/llm/ts/client.ts` and `types.ts`, and their tests. Add a tokenizer
    client for the pinned engine's native tokenizer and use its effective
    per-request context capacity. Apply the decision record's 512/1024
    output reserve, 128-token framing margin, and exact trimming order.
    Count system context, selected history, current message, native tool
    schemas, and later tool results. Select complete entries and history
    pairs, not `.slice` of the assembled prompt. The newest four exchanges
    are no longer exempt from the full-request limit. Required inputs that
    cannot fit return typed `input_too_large` before actions. Mirror the
    existing error catalogue and OpenAPI error response conventions.

    Count the fully rendered native chat template, including tool schemas,
    not just concatenated message text. Cache exact counts by rendered
    prompt plus model/template identity. If native counting fails with no
    matching validated cache, return typed unavailable before model-dependent
    execution; deterministic no-model replies remain available. After tools
    already ran, oversized required results skip composition and use the
    safe direct/error fallback; never report a pre-action rejection or
    repeat an action. There is no guessed byte-count fallback. Acceptance: large history, many tools,
    long profile, multilingual text, emoji, and long current input stay
    within capacity or reject before effects; required evidence never
    silently disappears; model and guard evidence IDs match; output reserve
    is actually sent as `max_tokens`. Out of scope: changing household
    context settings, a second tokenizer library, or increasing prompts to
    hide retrieval failures. Checks: turn/history/LLM/shared client suites
    and full exit gate.

<a id="chat-13"></a>

- [ ] **CHAT-13: Route contextual and mixed requests without extra intent inference** (M)

    Progress 2026-09-15 (dev.md section 16, item 10, amended): the
    routing half landed in chunks A to E (6f51ea6 through 7bc9b91, the
    stack-2 and stack-3 gates): subject extraction, resolution before
    routing and reference resolution, the carried reference's decay,
    the last succeeded lookup as a stack source, a manifest's
    `routing.answers` entity kinds, and a short turn on a live subject
    read as a comment. The typed world subject landed 2026-09-15
    (447e763: "the new Marsh Lantern film" and "the film Marsh Lantern"
    put a world subject of kind film on the stack with its recency
    from the determiner phrase; `subject-before-pattern` is live
    again). The judgment half landed as a first slice (d622648,
    09fb919): a follow-up question asking for an exact field about the
    current world subject ("how many tracks" after the album turn) is
    decided a lookup from the signal and the subject, and the engine
    runs the typed source and the search itself, both paths. The full
    rule landed 2026-09-16 (Session A, the judgment lane): the
    decision takes the question that names its subject too, and needs
    a world or unresolved subject on the stack (a currency marker
    alone, "when is the new album out" with nothing on the stack, names
    no subject: the model's turn, LOOKUP-02's path for a promise or an
    offer in its draft); the query is the subject first, a superlative
    or time word riding, the field after ("Marsh Lantern release
    date", "Rivet newest phone"), never a trailing "new". The eleven
    LOOKUP-01 and LOOKUP-02 mechanism tests: nine asked "when is the
    new album out" with nothing on the stack and pass under the
    subject rule as they were; the hedged-draft test and its row ask
    with no exact field now ("which connector is the Cosmo 7 card",
    a count being the rule's own case); offer-binding's row asks with
    none too ("is the new Marsh Lantern album any good").

    Depends on: CHAT-10, CHAT-12, CHAT-15. Files:
    `backend/src/lib/turnEngine.ts`, `routing.ts`, `turnContext.ts`,
    `spec/llm/routing-corpus.json`, `tool-call-corpus.json`, and existing
    routing/tier2 tests. Keep literal matching on original text. Compute
    contextual semantic scores with the bounded query from CHAT-10, using
    one compatible query vector shared with recall when their input and
    space match. Never call a model solely to rewrite intent. Add an
    `intent` object to the ephemeral context with `kind: chat|lookup|action|clarify`,
    `query`, `subjectEntityIds`, and `explicitDetailedAnswer`; deterministic
    evidence decides only clear cases, otherwise let native tool selection
    decide. Explicit detail phrases are `in detail`, `detailed explanation`,
    and `step by step`, case-insensitive. No speculative user-preference
    classifier. Preserve current measured routing floors until CHAT-23.

    A literal pattern whose captured tail contains an additional explicit
    supported request must fall through to native tools, not execute the
    whole tail as one argument. Detect only declared request-pattern starts
    separated by a sentence boundary or `and`; do not split names or list
    items. Acceptance: weather then "And tomorrow" offers weather with
    resolved context; "search for dinner ideas; I dislike cilantro" both
    answers and captures the disclosure; "weather and my list" runs the
    intended two reads; casual near-matches execute nothing. Out of scope:
    arbitrary multi-step plans and keyword rules for every possible intent.
    Checks: routing/turn/tier2 suites and full exit gate.

    **Amended 2026-09-13 (the design pass, dev.md "The chat design
    pass", sections 3, 4 and 10).** The subject is a stack (depth two
    to start, measured, return by name) of one spec shape, `SubjectRef`
    (its own S item below: a household reference with an `entity_id`;
    a world reference with kind, name, optional year, the typed source
    and its key, and `recency: current | dated | unknown`; an
    unresolved reference with candidates and confidence), with a
    `rejected` list per conversation. Resolution returns `resolved`,
    `ambiguous` or `unknown`; the engine blocks on a clarification only
    when the reply depends on the missing distinction (ASK-01's rule),
    and a world subject never becomes a household entity on any path.
    The resolver's first half is ASK-01's name resolver (the roster,
    the registry, the typed sources; a name outside them is `unknown`,
    never guessed). `intent.kind` is `lookup` when a world subject's
    exact field is asked (a date, a count, a day, a schedule, reviews,
    a rating, a runtime, a price, "is it out") and the subject is not
    `dated`: the engine decides, the model's knowledge is a rung only
    for a dated subject. A correction ("no, the other one", "not that
    one", "I meant X") replaces the active subject (the wrong one goes
    onto `rejected`, never stays as a second candidate), keeps the
    unresolved question (TURN-01's slot, pulled forward here) and
    re-asks it against the corrected subject on the next turn or a bare
    "go on"; a reply sentence naming a rejected subject is cut
    (`rejected_subject`); the window annotates the turn that answered
    about it with a system note. A reflected question ("you?", "what
    about you") after the hub asked one is that question addressed to
    the hub; a reply that only repeats the hub's own previous question
    is `repeat_question`. "What were we talking about" answers from the
    stack and recalls no episodes. Acceptance adds the `new-album` and
    `correction` conversations (design note, section 4) beside the rows
    already named, lookups from recorded fixtures; three seeded runs.
    **Amended 2026-09-14 (the coherence review):** CHAT-10 is folded in
    (the bounded retrieval query is the stack: the resolved subject's
    name plus the last two same-thread user turns, capped as CHAT-10
    said); the stack stays at depth two with no return by name; the
    question carried across a correction is `carried_question` on the
    stack entry, never an ask; the `unresolved` references are ASK-01's
    detector's, read from `TurnContext.subjects`; `TurnIntent.kind` is
    derived from the signal and the stack by one function and
    `subjectEntityIds` is deleted; CHAT-12 stays deferred behind the
    volatile-zone ordering. **From LOOKUP-02's set (2026-09-15):** a
    promise to remember on a question turn ("I'll remember that you're
    excited" answering "when is it out", `new-album` turns 2 and 3) is
    the commissive form of the memory family's claim, which reads
    "I've saved" as the claim and cuts the future tense on a statement
    turn only (EXP-01's rule), so on a question turn it stands; the
    ladder cuts it beside the plain denial it pads.

<a id="chat-14"></a>

- [ ] **CHAT-14: Offer only ready, authorized tools within one hard cap** (M)

    Depends on: CHAT-13. Files: `backend/src/lib/turnEngine.ts`,
    `plugins.ts`, `packageHost.ts`, existing integration readiness readers,
    `spec/schemas/manifest.schema.json` only for genuinely missing shared
    declarations, and `backend/tests/tier2.test.ts`, `plugins.test.ts`.
    Build one candidate-filter function using existing package kind,
    min-role, required integrations/capabilities, and configured status.
    Read status only; tool listing must not send network probes or resolve
    secret values. Cap the final offered set at four, including always-offer
    tools: reserve one slot for a ready always-offered lookup tool, fill the
    remaining slots by score then package ID, then append any additional
    always-offered candidate only if room remains. Preserve exact offered
    IDs through execution and revalidate readiness/permissions at execution
    because configuration can change. Descriptions come from manifests,
    never copied handwritten bench strings.

    If an explicit requested integration is unavailable, provide its
    existing safe setup/error explanation rather than offer a broken tool
    or claim the household has it configured. A general chat message gets
    no unsolicited setup warning. Acceptance: no SearXNG means no search
    offer; explicit search explains missing setup; four is a hard cap even
    with many always-offer manifests; child permissions cannot be widened
    by context; readiness changing mid-turn prevents execution.
    Out of scope: integration installation, new network checks, or automatically
    enabling services. Checks: named suites, package-host permission tests,
    and full exit gate.

<a id="chat-15"></a>

- [x] **CHAT-15: Retain typed outcomes for every accepted package call** (M)
    Verified at the commit that carries this line (the producer
    inventory, each with a test, in docs/dev/session-a.md "CHAT-15").

    Depends on: CHAT-01. Files: `backend/src/lib/llm.ts`, `turnEngine.ts`,
    `turnContext.ts`, `plugins.ts`, `spec/llm/ts/types.ts`,
    `spec/schemas/result.schema.json`, and their tests. Reuse existing
    `PluginResult.data`, `reply`, `error`, `ask`, and `synthesis_hint`.
    Retain native call IDs through parsing and store outcomes using the
    internal type in the decision record. Expose one shared argument
    validator from the package runner so the retained batch is validated
    before any execution or confirmation, without reimplementing AJV.
    Preserve model order and the two-call cap. Consequential proposals ask
    once and execute none of the batch. Keep failed outcomes and safe
    error-catalogue messages alongside successes. Report rejected/excess
    proposals as unexecuted, never implied successes. Direct pattern and
    command paths produce equivalent execution evidence.

    Pending confirmations bind exact package/arguments and consume once;
    resume/reopen clears them as today. Do not interpret an affirmative
    prefix such as "yes, but don't do it" as unconditional consent: accept
    only whole-message affirmative forms from the existing vocabulary,
    optionally terminal punctuation; other text asks a clarification and
    runs nothing. Acceptance: one success/one failure retains both; invalid
    second arguments prevent unvalidated effects; a duplicate delivery or
    retry cannot repeat completed calls; consequential call blocks its
    companion; malformed JSON never reaches a host. Out of scope: general
    agent loops or changing package side-effect semantics. Checks: tier2,
    plugins, commands, pending-ask, shared LLM tests and full exit gate.

<a id="review-2026-09-16"></a>

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
    - [ ] **RVW-1b: A sample floor before a zero-hit rule retires** (S).
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
      the residual** (a person's hours, then M). The 500-turn sheet
      (`data-scratch/eval/turn-signal-review-sheet.md`) reviewed for act,
      stance, emotion and intensity; a MiniLM or ModernBERT-class encoder
      fine-tuned on those labels plus the fixture's turns, calibrated,
      thresholds on precision, ONNX on CPU under 20 ms warm p95; the
      rules keep every decision they make today. Acceptance: section
      12's own 5-point macro-F1 margin over the rules alone, no fixture
      regression, the fallback rate printed. Blocked on the labeling
      hours (the owner's, or a frontier session as the labeler with the
      disagreement rate reported).
    - [ ] **RVW-3: The lookup router and the logit trigger** (S-M). From
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

- [ ] **CHAT-16: Compose contextual package answers through one shared path** (M)

    Progress 2026-09-15 (dev.md section 16 part 4, the amendments, landed
    ahead of the composer core): the search host returns its rows, the
    websearch recipe carries them, the outcome types them as `Source`
    records, `TurnValue.sources` rides the wire additively and is
    persisted on the turn row (migration 0039), and the chat surface's
    `SourcesCard` reads the real field (dca1173, 4642371); a link, a
    picture or a video ask is a deliverable on the intent, a
    back-reference re-sends the last lookup's sources with no new
    search, otherwise the ladder runs with the deliverable query and the
    reply is one line that says the link is below, a child hears that a
    grown-up can open it and gets no chip (fcbb315, 68b570c, 85e3848);
    a denied deliverable takes the same path (chunk c). Bench:
    `link-is-the-answer`, `link-child-band`, `false-capability-cut`.
    Progress 2026-09-16 (K2 and K6, docs/dev/session-a.md "CHAT-16 K2
    and K6"): `backend/src/lib/composer.ts` is the one decision for
    every site that turns outcomes into a reply on both paths (the
    table as designed, the native tool-result messages on K1's wire,
    the two-call budget read from the prepared turn's counter, the
    constraints line, the `shape` for K4, ACT-03's moves as a
    parameter); the websearch recipe returns rows and a
    `synthesis_hint` (the spec's `format` step gains the field, `text`
    optional with it) and no prose; the direct routes compose too; the
    machine owns the phases, the composition streams through the
    gates after a `composing` status the route orders ahead of its
    first delta; the `[turn]` line says `composed: <mode> calls=<n>`.
    Open: K3 (`model_knowledge`), K4 (the shape rendered from rows),
    K5 (typed dates), K7 (pictures inline), the `search_voice` family,
    the ladder by claim type, the 512-token projection, the band's
    ceiling on the evidence. The voice line of part 4 rule 5 waits for
    a voice surface.

    Depends on: CHAT-02, CHAT-12, CHAT-15. Files:
    `spec/llm/ts/types.ts`, `client.ts`, native client tests,
    `backend/src/lib/llm.ts`, `turnEngine.ts`, `turnContext.ts`,
    `backend/packages/websearch/recipe.json`, and chat
    source metadata/rendering. Add native tool-result messages and retain
    assistant call IDs in the shared wire contract first. Apply the exact
    direct/synthesis/failure/pending decision table in dev.md. The composer
    uses the selected persona/context plus typed results; tools are absent
    and a turn permits at most two foreground completions total. Results
    are data, never system instructions. Re-budget before composing. On
    failure, emit ordered approved direct replies and safe failure messages;
    never execute a call again. Use existing result `data` and
    `synthesis_hint`, without a parallel schema.

    Web Search is currently authoritative in Home, not a catalog-mirrored
    package. Edit it here; catalog migration is out of scope.
    Move Web Search's private phrasing completion into this path: return
    bounded title/snippet/URL data, remove the private `llm_complete` recipe
    step and its source-suppression instruction, preserve declared network
    behavior. Show source titles and sanitized URLs using the existing
    generic source UI pattern; do not speak URLs or send unrelated memory
    text as a search query. Acceptance: known food preference shapes the
    answer locally; two results read as one answer; one failure is stated;
    timer confirmation adds no model request; malicious snippets cannot
    enable tools; composition failure never repeats actions. Out of scope:
    web crawling or a search-provider change. Checks: native client, tier2,
    package recipe fixtures, frontend adapter/source tests, affected catalog
    checks and full exit gate.

    **Amended 2026-09-13 (the design pass, dev.md "The chat design
    pass", sections 4, 6, 7 and 10).** The verdict: one composer is
    necessary and not sufficient. The composer realizes the moves
    section 12's plan permits (the coherence review, 2026-09-14: the plan
    decides which exist; these four are the default realization of a
    lookup answer, and typed move fields exist on composed turns only,
    never on a streamed chat turn; the composer receives a bounded
    projection of at most 512 tokens with references to the retained
    outcomes, never a raw result, and this item and ACT-03 core are one
    work order) (react in the companion's register; pick the one or
    two results that answer, never the list; say it as a person who
    just looked; point at the sources and the details pane, "the
    link's on your phone" on voice), a length (two sentences in chat,
    one on voice, CHAT-12's budget as the ceiling), a fixed prompt in
    `lib/persona.ts`'s pattern with results as data and tools absent,
    and a `search_voice` guard family on its own output (cuttable:
    "the search results", "according to the results", "based on my
    search", "the results show", "I found that", "some recommended",
    "include options such as"; a reply that loses every sentence is
    recomposed once, then takes OUT-01's `malformed` line). The ladder
    runs by claim type, decided before composition: household (memory
    and the registry only); exact, current, safety-sensitive or
    source-requested (a typed source, then SearXNG, then an explicit
    "I couldn't find that", the model's knowledge never a rung, so a
    failed lookup stays a failed lookup); stable general knowledge (a
    typed source or retained evidence, then the model's knowledge with
    the evidence kind recorded on the outcome); opinion (SearXNG
    candidates, a bounded pick with a reason); action result (the
    typed outcome). The composer emits a typed `ComposedTurn` (one line
    and an optional document reference, COMP-01), and every producer's
    text reaches the person through OUT-01's boundary. A link ask (a
    link, a URL, a review, "where can I watch") is a deliverable: the
    reply's `sources` carry the URL, the line says it is there, never
    "no link" and never a spoken URL; the decision table gains the row.
    The websearch recipe's `llm_complete` step goes and the recipe
    returns title, snippet and URL rows in `data`. A question about the
    hub's own experience ("have you heard it", "are you gonna listen to
    it", a reflected "you?") is composed from the experience category:
    the experience line plus a familiarity clause from evidence, never
    free prose about its plans. The subject line, the unknown-name line
    and the composer's evidence sit ahead of the memory and episode
    sections in the volatile zone until CHAT-12 packs by priority.
    Acceptance adds the `search-in-a-voice` conversation and the
    experience turns of `new-album` (design note, sections 6 and 7),
    plus `stable-knowledge-ladder` ("why is the sky blue": answered from
    the model, the evidence kind `model_knowledge` on the outcome, no
    lookup run), `opinion-ladder` ("is the Marsh Lantern album any good":
    a SearXNG outcome, a pick of one or two candidates, no `search_voice`
    phrase) and `mixed-intent-ladder` ("add oat milk to the list and how
    long do eggs keep": the list outcome first, one package run, the
    stable-knowledge answer second), the coherence review's rows,
    lookups from recorded fixtures; three seeded runs. **Amended
    2026-09-14 (dev.md section 13, part 2):** the band's content ceiling
    (`getCeilingForBand()`, no consumer today) is applied to the
    evidence set before the composer phrases it, by the one output
    category scorer run over evidence text: an item over a dial is
    dropped from a child's evidence with a marker the composer reads
    and stays for an adult; a rating question from a child is answered
    as a parent would from the typed field and the band, never the
    rating's own words; sources and links are never shown on the child
    band and stay on the outcome; the ladder is unchanged. Every
    lookup or retained result reaches the composer as a typed
    disposition (`full`; `summary` with categories and safe
    descriptors; `withheld` with the reason `content_ceiling` or
    `household_disclosure` and the policy `adult_should_tell`), the
    withheld text removed before prompt construction and the evidence
    ids proving what entered; a dial at `off` means no vivid or
    instructional detail, never denial of an ordinary fact about
    injury or death; the rubric line gains the band, the disclosure
    decisions and privacy (section 13, part 9). Acceptance adds
    `child-goldfish`'s adult twin and a rating question asked by the
    child and by the owner on the film row, three seeded runs.

- [x] **Engine emits `status` events at lookup start (CHAT-16)** (S) -
      Done 2026-09-15 (e4cf3b5): the stream result carries a status
      channel the engine emits into ("Checking that for you." before the
      forced lookup, "On it." before a tool call on the stream); the
      route races it against the next token so the line reaches the
      surface while the model is silent. The original note follows.
      the visible "what MaiPai is doing" line during a turn is built and
      ready on the frontend (lane 11 item 1, docs/dev/session-b.md): the
      transient activity line, a `status` event's own text (`stage:
      "lookup" | "thinking" | "tool"`), and a `spoken_cue` both drive it,
      cleared by the first delta or the terminal event, never persisted.
      Left unchecked: `turnEngine.ts` doesn't emit `status` yet - CHAT-16
      is the natural place (the same lookup-before-answering path that
      makes a "Checking that for you" line worth having in the first
      place), Session A's own work, wired to the exact shape above.

<a id="runtime-01"></a>

- [ ] **RUNTIME-01: The household runtime as a workspace package the hub runs** (L)

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

- [x] **SURFACE-01: The robot surface** (M)

    Done 2026-09-15 in three slices: `robot` is an implemented surface
    with a spoken form for every reply (the first sentence, no URL
    read aloud) and "it's on your phone" for a deliverable (b1d1c75);
    `speaker_evidence` and `present` are on the spec, accepted on the
    robot surface, persisted on the turn row (3de9ef7, migration 0040);
    a sensitive record enters the context on the robot only when the
    body's evidence names the speaker as confirmed and the present
    list is that one person, a second person at any level or no list
    withholding it, chat unchanged (565dc35). The unknown speaker's
    anonymous context and the who-is-speaking ask are COMP-06's. The
    original note follows.

    Filed by the robot's design pass (bot `docs/dev.md`, "named hub
    items"). Objective: `robot` admitted to `IMPLEMENTED_SURFACES`
    (`backend/src/lib/turnEngine.ts:79`, rejected today at `:98`), with
    the surface discriminator the platform plan promises. Files:
    `backend/src/lib/turnEngine.ts`, `guards.ts`, `memory.ts` and the
    prompt sections, `spec/` for the `present` field on the turn (spec
    first), `backend/tests/turnEngine.test.ts`. Mirror: the `chat`
    surface's own branches. Do: spoken presentation on `robot` (one
    sentence, no link read aloud, "it's on your phone" for a
    deliverable), memory sensitivity (a `sensitive` record withheld
    unless the speaker is present and alone, bot dev.md section 6), and
    the `present` list on the turn (who the body says is in the room,
    the input the withholding reads). Acceptance: a robot-surface turn
    runs end to end in the scripted-engine tests; a sensitive record
    reaches the prompt on a `present: [speaker]` turn and never on a
    turn with a second person present; the same turn on `chat` is
    unchanged. Out of scope: the wire events (WIRE-01), the body's
    presence evidence (the robot's own). Exit: the named tests, `bash
    scripts/check.sh`.

<a id="wire-01"></a>

- [x] **WIRE-01: The signal and the plan on the wire** (S-M)

    Done 2026-09-15 for the signal and the cancel (f60b7df: the frozen
    signal rides the stream as its own event right after `turn_meta`
    on every turn; 76931ef, 248812f: `POST /api/turn/{turn_id}/cancel`
    aborts the in-flight completion for real, the stream ends with
    `turn_cancelled` and the partial turn is logged as a disconnect is;
    the turn routes joined the OpenAPI router on the way). The `plan`
    event waits for ACT-03, as the item says. The original note follows.

    Filed by the robot's design pass (bot `docs/dev.md`, "named hub
    items"; section 5 is the consumer's contract). Objective: the robot
    drives its expression from the turn's own signal and plan, so both
    ride the stream. Files: `backend/src/wire.ts` (`TurnStreamEvent`,
    today `turn_meta | delta | spoken_cue | done | error` at `:117`),
    `backend/src/routes/turn.ts` (`streamTurnEvents()`),
    `backend/src/lib/turnEngine.ts`, `spec/streaming/` (spec first),
    `backend/tests/turnEngine.test.ts`, the frontend adapter tests.
    Mirror: the `spoken_cue` event, added the same way. Do: a `signal`
    event right after `turn_meta` (the signal is frozen before routing,
    so it costs nothing and never waits on the model); a `plan` event
    before the first delta once ACT-03 lands; a `cancel` event the
    caller can send and the engine honors with the real abort of the
    in-flight completion. Acceptance: the stream tests read `signal` as
    the second event on every model turn and on every immediate turn;
    `plan` is absent until ACT-03 and asserted there; a cancel mid-stream
    ends the turn with the upstream completion aborted (the bench's
    `inferenceStopped` check). Out of scope: the robot's rendering of
    the cues. Exit: the named tests, `bash scripts/check.sh`.

<a id="chat-17"></a>

- [ ] **CHAT-17: Share streaming and blocking turn execution without dropping calls** (M)

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

- [x] **CHAT-18: Release turn activity exactly once on every exit path** (S)

    Status (2026-09-13, closed): `acquireTurnLease()` with an idempotent,
    per-lease `release()`; blocking turns release in `finally`, streaming
    turns through `holdLease()` on the outermost generator (exhaustion,
    throw, `return()`, abort) and an idempotent `finalize()` with one
    terminal flag; the two-minute timer is a once-per-lease warning, never
    a decrement; a clock seam replaces sleeps. Details in docs/dev/session-a.md.

    Depends on: none. Files: `backend/src/lib/turnActivity.ts`,
    `turnEngine.ts`, `routes/turn.ts`, `routes/openai.ts`,
    `backend/tests/turnActivity.test.ts`, `turnEngine.test.ts`, `openai.test.ts`.
    Replace unpaired global increment/decrement calls with an acquisition
    that returns an idempotent `release()` closure. Acquire at validated
    turn start before safety/pending/command returns can finish; invalid
    requests acquire no lease. Blocking execution releases in `finally`.
    Streaming transfers ownership to its generator and releases on normal
    exhaustion, error, `return()`, and HTTP disconnect. Guard double-finalize
    with one terminal-state flag. Finish timestamps use actual release time.
    Keep an optional stale-task diagnostic but remove the two-minute timer
    as the correctness mechanism; it must never decrement a different
    active turn. An immediate refusal cannot release another user's turn.

    Acceptance: overlap a long model turn with an immediate command and
    refusal; the long turn still blocks background work. Abort before
    first byte, fail during preparation, throw during generation, disconnect
    after a delta, and call release twice; all leave the exact correct
    active count and permit maintenance after 20 seconds. Use the existing
    test timing hooks rather than real sleeps. Out of scope: inference
    priority, new metrics page, or changing refusal semantics. Checks:
    named suites and full exit gate.

<a id="chat-19"></a>

- [ ] **CHAT-19: Give interactive inference priority over all background jobs** (M)

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

- [ ] **CONC-01: Concurrent household conversations** (M)

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
    the bench, full exit gate.

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

- [ ] **CHAT-20: Update memory state in the open chat without reloading it** (M)

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

- [x] **CHAT-22: Make every conversational live bench safe to run** (S)

    Status (2026-09-13, closed): one setup helper
    (`backend/scripts/bench/setup.ts`) refuses a nonempty, non-temp or
    missing data directory and any run without supplied chat and embed
    URLs; every bench ends through `finishBench()` (zero cases exit 1);
    `memory/run.ts` deletes only its own rows; seven entry points proven
    isolated against a stub in `tests/benchSetup.test.ts`. Details in the
    "Session A, after the block" section of dev.md.

    Depends on: none; run before any new live experiment. Files:
    `backend/scripts/bench/{routing,tool-calling,conversation,naturalness,persona-eval,judge-eval,memory-eval}.ts`,
    `backend/scripts/bench/memory/run.ts`, and existing
    `backend/tests/isolation.ts`, `preload.ts`, `reset-db.ts` patterns.
    Build one bench setup helper that creates its own disposable data
    directory before importing database modules, disables service spawning,
    and connects only to an explicitly supplied existing inference URL.
    Never invoke `resetDb` outside bun:test. Refuse an existing/nonempty or
    household data directory before any mutation. Fix the current household
    memory bench's broad cleanup by deleting only records created by that
    bench within its isolated database; cleanup cannot stop a shared model
    server. No auto-download or model replacement. Failed setup exits
    nonzero; zero executed cases cannot report success.

    Acceptance: add deterministic tests using a temporary sentinel directory and stub
    HTTP server proving refusal leaves the sentinel unchanged, repeated
    runs isolate records, and cleanup leaves the external server alive.
    Extend bun:test; do not create a shell test harness. Output synthetic
    transcripts and metrics only, with engine/model identity and executed
    case count. Out of scope: running a benchmark against family history.
    Checks: new tests colocated with existing bench-related tests, existing
    isolation tests, one isolated stub bench invocation for each touched
    entry point, and full exit gate.

<a id="chat-23"></a>

- [ ] **CHAT-23: Gate chat quality on complete conversations and measured latency** (M)

    Status (2026-09-13, a first slice, left open): the baseline
    conversation bench of `docs/plans/measure-first-2026-09-13.md`
    section 2 is built (`scripts/bench/conversation.ts --live`, twenty
    fixture conversations, outcomes read from system state, a frozen
    run header, the four hard rows, the ranked failures) and its first
    run is recorded in [docs/dev/session-a.md](dev/session-a.md): 56 of
    60 scored turns, all four hard rows pass, two conversations broken
    (both by #92), model-turn first delta p50 836 ms, and three runs of
    the same inputs at 54, 54 and 56. The gate below (the
    forty sequences, five repeats, both transports, the thresholds)
    stays open; the next items come from the bench's ranking.
    Status (2026-09-13, later): the fixture is 30 conversations (the
    Cobra film set, four other-kind subjects, three household
    subjects, item 1b of `docs/plans/baseline-fixes-2026-09-13.md`;
    a cancel row and a promise row from the effect standard of
    `docs/plans/conversation-competencies-2026-09-13.md`, with ten
    rows rewritten to observe the effect rather than the reply's
    words) and its table is the chat regression suite: every item that
    touches a turn reports its three runs against it. The last series
    on the 28-conversation fixture was 91, 91 and 85 of 98 scored
    turns; the rewritten rows that need unbuilt pieces (the registry
    read into a turn, a reconciled interruption, a lookup with a
    source) fail on purpose until their items land.

    Depends on: CHAT-02 through CHAT-21 and CHAT-22. Files:
    `spec/llm/{routing,tool-call,guard,naturalness}-corpus.json`,
    `backend/scripts/bench/memory/{fixture,run}.ts`, existing bench runners,
    and the corresponding backend/frontend tests. Extend current corpora
    with stable IDs and separate deterministic control-flow fixtures from
    semantic paraphrase live cases. Do not delete paraphrases because the
    bag-of-words stub cannot solve them. At minimum add 40 sequences:
    eight disclosure/search/correction/recall, eight ambiguous/pronoun
    follow-ups, eight no-tool near-matches, eight two-tool/partial-failure/
    confirmation cases, and eight current/historical/privacy cases. Add
    the four report guard probes and credential/output-safety regressions
    to permanent deterministic tests.

    Acceptance: grade retrieval and capture against expected source IDs, scopes,
    validity, and active record counts. For phrasing use a local judge with
    explicit supported/contradicted/missing claims, retaining synthetic
    evidence and a disagreement list; never let its grade override
    deterministic safety/action assertions. Run each live sequence five
    times in both transports. Require zero observed privacy, credential,
    safety-floor, or false-success failures; at least 95% correct routing
    and required-fact answers, at least 98% capture precision, at least
    90% capture recall, and at most 2% false-tool calls. Report Wilson 95%
    intervals, denominators, failures, and unavailable cases. The thresholds
    are acceptance targets, not claims about current accuracy.

    Measure at least 30 warm turns per condition with/without background
    work: p50/p95 first text/audio, total time, cancellation, and memory
    headroom. Require no more than 10% p95 foreground slowdown under
    background load and no more than 10% ordinary-chat first-text regression
    versus the same-build baseline. Failure leaves this item open with
    findings; never weaken the gate. Out of scope: production rollout.
    Checks: relevant deterministic suites, isolated live bench reports,
    seeded browser/audio exercise, and full exit gate.

<a id="chat-24"></a>

- [ ] **CHAT-24: Compare model, voice, cache, and steering changes without deploying** (M)

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

### Design pass 2026-09-13: the findings from live use, and the companions brief

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

- [x] **RECALL-02: Episodes are evidence, never lines** (S-M)
    Done 2026-09-14 (docs/dev/session-a.md "RECALL-02"): the person's
    side by default, the hub's side only on a "what did you say" turn
    and then as a reported note; the lexical floor of two shared words
    (or one plus the vector floor) before fusion; the vector floor
    raised to the measured 0.72; no block under two content words (the
    design's three moved to two on the first measurement, the
    coordinator's decision) or on a question about this conversation;
    three lines and 400 characters; the guard reads episodes. Three
    seeded runs recorded there. RECALL-02b (2026-09-14, an outside
    reading): the person's side is every caller's default and the
    hub's side opt-in (the callers enumerated in the commit), a
    thank-you with its object and "what did we discuss" refuse a
    lookup, a closer is never a copied line, and three tests read the
    final prompt.

    Objective: a reply never copies a sentence from another
    conversation, and a short or meta turn recalls nothing. Files:
    `backend/src/lib/episodes.ts` (`recallEpisodes`, `formatEpisodeLine`,
    `formatEpisodesForPrompt`, the unused `pairedText`),
    `backend/src/lib/guards.ts` (`guardUnrelatedRecall`),
    `backend/src/lib/turnEngine.ts` (`prepareTurn`'s episode call),
    `backend/scripts/bench/recall-floor.ts`, `backend/tests/episodes.test.ts`,
    `guards.test.ts`. Mirror: the vector floor `EPISODE_MIN_COSINE` and
    the `guardedTurnNote()` system-note shape. Do: assistant-side
    episodes only on a recall-shaped question (the recall package's
    routing examples define the shape), rendered as a reported-speech
    system note with the paired user side, never `you replied: "..."`;
    a lexical floor (two shared content words, or one plus the vector
    floor), measured on the recall-floor bench and recorded; no episode
    block on a turn with fewer than two content words (amended from
    three, 2026-09-14) or a question about this conversation; at most
    three lines and 400 characters;
    `guardUnrelatedRecall` reads `ctx.episodes` beside `ctx.sources`.
    Acceptance: the `copied-line` conversation (design note, section 1,
    the explicit-history third conversation included) and the opening
    turns of household-subject-dog and household-subject-person, three
    seeded runs. Out of scope: CHAT-10's bounded query (the subject
    becomes the query when CHAT-13 lands). Exit: `bun test
    tests/episodes.test.ts tests/guards.test.ts`, the recall-floor
    bench's recorded floor, `bash scripts/check.sh`.

<a id="recall-03"></a>

- [x] **RECALL-03: Within-conversation recall past the window** (S)
    Done 2026-09-14 (docs/dev/session-a.md "RECALL-03 and GUARD-LINES";
    from Jesse's live chat of 2026-09-14): the current conversation's
    own person-side turns that fell out of the window are evidence for
    the turn, recalled by the same floors as an earlier conversation's
    episodes (`recallEpisodes()` gains `withinConversationId` and
    `excludeTurnIds`, the window reporting its `turnIds`), plus the
    earliest dropped turn whatever the floors say when the question is
    about how the chat began (`ASKS_ABOUT_START_RE`,
    `earliestDroppedTurn()`); rendered under "Earlier in this
    conversation" as the person's words, never the hub's side; the
    guards read them as evidence. The `recall-past-the-window`
    conversation (fourteen turns, the two live turn shapes with roster
    names). One seeded set, GUARD-LINES riding on it.

<a id="guard-lines"></a>

- [x] **GUARD-LINES: The replacement bank says the plain honest line** (S)
    Done 2026-09-14 (docs/dev/session-a.md "RECALL-03 and GUARD-LINES"):
    every bank line without "told" or "nobody" (Jesse's rule of
    2026-09-13, applied to the bank itself): "I don't have that one
    yet." for a household fact, "I don't know that one." for a world
    fact, the act-aware lines for an emptied reply; the legacy lines
    stay recognized by the window's strip; `allReplacementLines()` and
    a test that none carries the words; the fixture's `HONESTY_LINES`
    updated. Also here, two folds from EXP-01's set: a future-tense
    promise to act on a statement ("I'll add that to the list") is
    skipped like a completed claim, and a sentence that followed a
    skipped one on a conjunction loses the lead.

<a id="out-01"></a>

- [x] **OUT-01: One validated reply boundary after every producer** (S)
    Done 2026-09-14 (docs/dev/session-a.md "OUT-01"): the rule and the
    repair in `lib/wellFormed.ts`, run in `finalizeReply()` on every
    producer; a short malformed model output regenerated once under a
    48-token cap, its repair standing; the streaming opening hold and
    the final span's repair; the `malformed` line; dash-line persona
    examples (persona-eval before and after recorded); the bench's
    universal `well-formed` check and per-run count. Three seeded runs
    recorded there.

    Objective: a fragment, a lone token, an empty reply or a reply with
    an unmatched quotation mark is never sent or stored, from any
    producer. Files: `backend/src/lib/turnEngine.ts` (`finalizeReply`,
    the one place every producer passes: `runTurnStreamHoldingLease`'s
    `finalize` and first-chunk hold, `peekAndHandle`'s empty-reply
    branch, `runTurnHoldingLease`'s `answerWithSafetyAndGuards`),
    `backend/src/lib/guards.ts` (a `malformed` reason and its bank),
    `backend/src/lib/persona.ts` (`examplesBlock` renders dash lines,
    no quotation marks), `backend/scripts/bench/conversationScore.ts`
    (a universal `wellFormed` check on every row),
    `backend/tests/turnEngine.test.ts`, `persona.test.ts`. Mirror: the
    invention retry's one-retry bound. Do: a complete sentence (a
    terminator; two words, or one from the engine's short-answer
    vocabulary; balanced quotes and brackets; no control markers),
    checked before `logTurn`; one regeneration for a model fragment,
    then the `malformed` line; a package or command line that fails is
    logged loudly and replaced by the same line; the streaming first
    chunk held to two words or a boundary and the final buffered span
    repaired, never emitted raw; the persona-eval bench rerun on the
    unquoted examples. Acceptance: every fixture row passes `wellFormed`
    in three seeded runs; a scripted engine that answers "I", an empty
    string, an unmatched quote and a dangling connector yields the
    retry then the fixed line, and none of the four raw forms is stored;
    "Yes." on a confirmation stands; the check runs on the model, a
    package, a command and a guard replacement. Out of scope: sampler
    changes (record the fragment rate per run instead). Exit: the named
    tests, the persona-eval bench, `bash scripts/check.sh`.

<a id="spec-01"></a>

- [x] **SPEC-01: The design pass's spec migration, one bump** (S-M, spec only; after OUT-01, before every engine item that reads a new field) - shipped 2026-09-14, Session B

    Objective: every record the pass changes is declared once, with a
    default, in one spec release, so the robot pins one bump and no
    engine item waits on a later spec item (dev.md, "Coherence review,
    2026-09-14", question 4). Files: `spec/schemas/memory-record.schema.json`
    (`child_disclosure: child_ok | teen_ok | adult_only` with `set_by`
    and `set_at`, null on person and self scope; `fact_confidence`
    (named against the signal's `act_confidence`, the outside review's
    point), `confidence_evidence`, `conflicts_with` as section 14 defines them,
    default 1.0 with one `legacy_assertion` entry, no writer until
    CRED-01; `scope` gains `companion` with `companion_id`; `expired_at`;
    the per-record retrieval signal REVIEW-01 reads), `entity.schema.json`
    (`pronouns`), `vocab/relationship-types.json` (`relative_of`), a new
    `vocab/entity-kind-nouns.json`, a new `vocab/life-events.json`
    (the adult-to-tell classes and section 14's life-events classes, one
    file), a new `conversation-turn.schema.json` (the shared turn record
    the robot syncs: `signal`, `plan`, `subjects`, `outcomes`, `document`
    nullable, `review_id` nullable, `notice_ids` nullable for AGE-02's
    dedupe and audit key), `turn-signal.schema.json`
    (`refers_to_prior` nullable until CHAT-13), `reply-plan.schema.json`
    (the moves declared once: react, care, say, pick, point, ask_back,
    close, defer; `required | allowed | forbidden` each; playfulness;
    `max_sentences`; `max_words`; the band fields of section 13 part 9),
    `subject-ref.schema.json` (the discriminated union of the item
    folded below, plus `carried_question` on a stack entry),
    `open-question.schema.json` (keyed by person with an optional
    conversation; kinds `who | clarify_fact | relay`; asked once at the
    end of the person's next reply, then cleared), `model-capabilities.schema.json`
    (a `turn-signal` role and a `head` engine kind), a `vocab/defect-codes.json`
    from which the guard reason enum, the `plan_violation` sub-kinds and
    REVIEW-01's five review-only codes are generated, fixtures for every
    variant, both generated bindings, `spec/README.md`. Mirror: step 3a's
    additive fields and their round-trip fixtures. Acceptance: the
    round-trip fixtures for every new field and record; the validator
    refuses a world `SubjectRef` carrying an `entity_id`, a `companion`
    scope without `companion_id`, and a `child_disclosure` on person
    scope; every existing fixture validates unchanged (additive only);
    the bot's pin note names the one version. Out of scope: any hub code;
    the companions and manifest changes (SPEC-02). Exit: the spec suite,
    `bash scripts/check.sh`.

    Second reading taken 2026-09-14, Session B, same bump: an outside
    review of 29ac71f found the schema's own `fact_confidence` default
    (`null`) never matched what a memory record actually requires
    (non-null, 1.0 on migration) - a `memory-legacy` fixture now proves
    the schema's own migration claim is a real, constructible record,
    not just prose. The bigger finding: every cross-field rule (scope
    needing its person/companion_id, `child_disclosure`'s scope rule,
    `fact_confidence`'s kind rule) lived only in the TypeScript
    validator, so a robot validating by the Python binding alone could
    write what the hub refuses. `spec/records/py/validate.py` is now
    that rule set's Python twin, plus seven more refusals in both
    languages: a non-companion scope with a `companion_id`,
    `child_disclosure_set_by`/`_set_at` set inconsistently,
    `retrieval_feedback`'s `corrections`/`last_corrected_at` pairing,
    `TurnSignal.source: head` needing a `classifier_id` (and no other
    source having one), clause ranges unordered, overlapping, or past
    the utterance's length, an `OpenQuestion` whose status contradicts
    its own timestamps, and a world `SubjectRef` with `source_kind` and
    `stable_key` not both set or both null. A refusal fixture per rule
    runs in both suites (`spec/tests/ts/record-validate.test.ts`,
    the new `spec/tests/py/test_record_validate.py`).

<a id="reg-01"></a>

- [x] **REG-01: A statement is not a request, and the assistant register is stripped** (S)

    Done 2026-09-14 (docs/dev/session-a.md "REG-01"): the three rules in
    `lib/guards.ts` reading ACT-01's signal (`act` on the guard
    context): on a statement with no outcome an action claim is skipped,
    never narrated (`isSkippable(reason, ctx)`); the assistant register
    beside the closers, one list, a sentence that is only register
    skipped and a register lead or tail cut (`assistant_register`); the
    hub's previous question said back skipped (`repeat_question`, the
    previous reply on the context). The engine's one retry with the
    note on both paths when nothing remains, then the malformed line.
    Corpus rows both ways; the `statement-not-request` conversation.
    The plan half (a plan forbidding the claim before generation, the
    `plan_violation` family) is ACT-03's.

    Objective: a first-person statement never gets "I've noted that",
    a guard replacement never names a package family the person did not
    mention, and no question is said twice. Files:
    `backend/src/lib/guards.ts` (`guardUnsupportedAction`,
    `unsupportedActionLine`, the #95 closer list extended into one
    `assistant_register` list, a `repeat_question` reason),
    `backend/src/lib/turnEngine.ts` (the statement-turn retry, the
    previous reply's question sentences on the guard context),
    `backend/src/lib/turnContext.ts`, `backend/tests/guards.test.ts`,
    `turnEngine.test.ts`, `spec/llm/guard-corpus.json`. Mirror: the
    SKIPPABLE `claimed_experience` handling and the invention retry. Do:
    on a statement-shaped turn with no outcome an action claim is
    skipped, and an empty result gets one retry with the system note
    "Nothing was asked; respond to what they said"; the assistant-
    register sentences are skippable; a sentence that repeats a question
    from the hub's previous reply is skippable. Acceptance: the
    `statement-not-request` conversation (design note, section 5), three
    seeded runs; corpus rows both ways for each list. Out of scope: the
    companion's register itself (COMP-03, EVAL-03). Exit: the named
    tests, `bash scripts/check.sh`.

<a id="reg-02"></a>

- [ ] **REG-02: Composer-owned voice disfluencies and nonverbal cues** (M)

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

<a id="exp-01"></a>

- [x] **EXP-01: Experience and plan claims** (S)

    Done 2026-09-14 (docs/dev/session-a.md "EXP-01"): the plan forms
    (`PLANNED_EXPERIENCE_RE`: going to, gonna, plan to, can't wait to,
    excited to, looking forward to, curious to, try to, want to, with
    the verbs and their gerunds, an implicit subject allowed, the
    verb's object deciding: "hear what you think" is conversation) and
    "haven't ... yet" are `claimed_experience`; the negation exemption
    only for a plain negation with no yet, but or though; a claim about
    the hub's own past promise ("I said I'd look it up") is
    `claimed_statement` with its own line. Eleven corpus rows both
    ways; the fixture's `PLAN_CLAIM` beside `EXPERIENCE_CLAIM`, the
    `new-album` conversation (its lookup and reflected-question rows
    LOOKUP-01's and CHAT-13's), copied-line-history turn 2 as the
    target turn. Also here, an S line from REG-01's set: the line that
    stands when the register scrub empties a reply reads the act.

    Objective: the hub never says it has seen, heard, played or plans
    to watch anything. Files: `backend/src/lib/guards.ts`
    (`CLAIMED_EXPERIENCE_RE`), `backend/tests/guards.test.ts`,
    `spec/llm/guard-corpus.json`, `backend/scripts/bench/conversationFixture.ts`
    (`EXPERIENCE_CLAIM`). Do: intent forms (going to, gonna, plan to,
    can't wait to, excited to, looking forward to, curious to, with
    watch, see, hear, listen, play, read, try, check out) and
    "haven't ... yet"; the negation exemption only for a plain negation
    without "yet" or "but". Acceptance: the `new-album` conversation's
    "are you gonna listen to it" and "nope, you?" turns (design note,
    sections 4 and 7) show no claim in three seeded runs; corpus rows
    for each new form and for the hearsay forms that must stand ("I
    hear it's good", "I've never heard it"). Out of scope: the composed
    experience answer (CHAT-16). Exit: `bun test tests/guards.test.ts`,
    `bash scripts/check.sh`.

<a id="ask-01"></a>

- [x] **ASK-01: The unknown-name rule (ask, never assume)** (M; spec S first)
    Done 2026-09-14 (docs/dev/session-a.md "ASK-01"): the resolver in
    `lib/unknownNames.ts` (the `compromise` tagger's candidates, the
    household frames, SPEC-01's SubjectRefs on the turn and the row,
    the carry for a pronoun-only turn); the unknown line and the
    registry's subject line ahead of the memory section; the engine's
    own ask appended on both paths (after the last delta on a stream),
    deduped against the model's question, outranking the engagement
    dial; the deterministic answer parser through step 3a's paths
    (kind from the noun vocabulary, relation from `said_as`, pronouns,
    description), a cancel, an unreadable answer falling through; step
    3a's amendment (a name alone is a candidate) with the judge's
    OpenQuestion (`open_questions`, asked once at the end of the next
    reply, answered before it is put, or declined for good);
    `false_familiarity` (replaced by the ask), `pronoun_mismatch`, and
    the role-invention shape for the seltzer row; `entities.pronouns`
    written; five bench conversations and their expectation kinds.
    The seeded set is the coordinator's next "set".

    Objective: a name the hub has never heard is asked about, never
    assumed, and the answer creates the entity as stated; an inference
    is a candidate and an open question, never knowledge. Spec first:
    `spec/schemas/entity.schema.json` gains `pronouns` (nullable
    string); `spec/vocab/relationship-types.json` gains `relative_of`
    (person to person, symmetric, terminable); a new
    `spec/vocab/entity-kind-nouns.json` maps answer nouns to kinds;
    round-trip fixtures and both generated bindings. Then the engine:
    `backend/src/lib/turnEngine.ts` (`prepareTurn`: the name resolver,
    the unknown line in the context ahead of the memory section, the
    appended ask that outranks the persona's engagement dial),
    `backend/src/lib/turnContext.ts` (`subjects`: the `unresolved`
    SubjectRefs the detector writes, SPEC-01's shape; `unknownNames` is
    deleted by the coherence review),
    `backend/src/lib/conversationHistory.ts` (`PendingAsk.kind` gains
    `who`; the `OpenQuestion` record of SPEC-01, keyed by person, kinds
    `who`, `clarify_fact` and `relay`, asked once at the end of the
    person's next reply on any conversation, in place of a conversation
    column),
    `backend/src/lib/subjects.ts` (the deterministic answer parser
    calling `ensureSubjectEntity` and `writeRelation` with `stated:
    true`; the hedge rendering in `subjectLabel` removed),
    `backend/src/lib/memoryJudge.ts` (an inferred entity or
    relationship becomes a candidate plus the open question, not a
    rendered or recallable record, the step 3a amendment),
    `backend/src/lib/memory.ts` (recall never reads an unconfirmed
    inferred relationship), `backend/src/lib/guards.ts`
    (`false_familiarity`, `pronoun_mismatch`; the acknowledgment bank
    never replaces a sentence about an unknown name), their tests, the
    guard corpus. Mirror: `resolvePendingAsk()` for the `who` kind; step
    3a's creation and confirm paths (`promoteToStated`); the
    `compromise` tagger as a dependency through bun (the org's prebuilt
    rule), never a copied word list. **Amended 2026-09-14 (the coherence
    review, question 2):** the detector never calls a typed source or
    the network to classify a name; a name is `unknown` at turn time,
    and the engine's ask fires, only when the utterance frames it as
    household (a relation phrase, "my" or "our", a pronoun for it in the
    same turn, or the roster's shape); a bare proper noun with no frame
    is an `unresolved` SubjectRef with no ask, and part 4's open question
    catches a household inference the judge makes. Step 3a owns every
    transition (confirm, `promoteToStated`, the orphan rule); this item
    owns the asking and the answer parser that calls 3a's paths, and
    adds no transition of its own. Two rows join:
    `who-ask-declined` ("never mind" to "Who's Juniper?": the ask
    cleared, no entity, no second ask) and `open-question-once` (asked
    once at the end of the next reply, never again after "not now").
    Acceptance: the three conversations
    in the design note, section 3 (`unknown-name-person`,
    `unknown-name-pet-lowercase`, `unknown-name-marathon`), plus
    `coworker-likes-seltzer` turn 4 as a target row for the
    false-familiarity family (OUT-01's set, 2026-09-14: "who is Quill"
    answered "the child in the house, Bramble's sibling" with the
    coworker label in the context, a household invention the guards
    did not catch), three seeded
    runs; unit tests per part (the resolver's known set, the appended
    ask deduped against the model's own question and appended under the
    brief persona, the answer parser for a pet, a relative and an
    unreadable answer, the judge's open question asked once and its
    candidate unreadable by recall until confirmed, the two guard shapes
    both ways). Out of scope: CHAT-13's subject stack (it reuses this
    resolver). Exit: the spec round-trip tests, the named backend tests,
    `bash scripts/check.sh`.

<a id="ask-01-followups"></a>

- [x] **ASK-01 follow-ups: the resolver's edges** (S)
    Done 2026-09-14 (docs/dev/session-a.md "ASK-01", "The follow-ups"):
    the eleven lows of the second and third reviews and the seven of
    the fourth, in `lib/unknownNames.ts`, `lib/turnEngine.ts`,
    `lib/conversationHistory.ts`, `lib/memoryJudge.ts` and
    `lib/guards.ts`, each with a regression test in
    `tests/unknownNames.test.ts` or `tests/ask01.test.ts`: the About
    line's entries and the memory bullets' subject labels are
    grounding evidence; the relation question uses the prompt's own
    phrase per type; a bare answer binds only a question this
    conversation raised or about its last subject; a declined engine
    ask is recorded so the judge's later candidate queues no twin; a
    question whose subject is gone, or a pending one older than a
    week, lapses (`expired`); "of course" is not familiarity; the third
    relation pattern needs its connector; a bare yes answers a relation
    question only; a confirmed entity is never replaced by an answer;
    the replacement is created before the guess is retired; "and" is
    never the noun; a possessive name is filtered after the strip.

    Objective: the five low findings of ASK-01's second review, each a
    small change in `backend/src/lib/unknownNames.ts` or
    `backend/src/lib/turnEngine.ts` with a test in
    `backend/tests/unknownNames.test.ts` or `tests/ask01.test.ts`:
    the third relation pattern matches across a verb object ("Tell
    Nadia my phone is broken" frames Nadia as a thing; bound the
    pattern to the name's own clause); the pre-asked answer path reads
    the person's oldest pending question from any conversation, never
    expiring (scope it to the conversation that raised it or the last
    day, and expire the rest per the spec's `expired` status); the
    kind-mismatch replace in `applyWhoAnswer()` acts on whatever the
    subject id points at (limit it to an unconfirmed candidate, as
    `candidateByName()` already does); an open question whose subject
    is gone is still asked and binds an empty name (expire it
    instead); `ensureFreshEntity()` soft-deletes the candidate before
    the create, so a failed create strands its records (create first,
    then retire); a bare "sure" or "right" to "Who's X?" is read as a
    yes with nothing learned (treat a verdict with no candidate edge
    as unreadable); the About line is in the prompt but not in the
    turn's evidence, so the role-invention shape can cut "Quill is a
    generous coworker" with the label only in that line (add the line
    as grounding evidence); the volunteered answer binds the oldest
    pending question rather than one whose subject was in the last
    turn's subjects; `PRONOUN_ANSWER_RE` takes "and" as the noun in
    "he's our rabbit and he bites"; a possessive name ("Grandma's") is
    filtered after the strip, not before. Acceptance: one test per line, `bun test
    tests/unknownNames.test.ts tests/ask01.test.ts`. Out of scope:
    CHAT-13's subject stack. Exit: `bash scripts/check.sh`.

<a id="rep-01"></a>

- [x] **REP-01: A cross-turn repetition guard, and the objection** (S)
    Done 2026-09-16 (docs/dev/session-a.md "REP-01"; dev.md section
    16 part 3, item 4 of its list; findings 29 and 46): one
    deterministic read at the boundary on both paths over the hub's
    previous two replies (`GuardContext.previousReplies`, off the
    window). `repeat_sentence`, skippable: a sentence equal after
    normalization (`normalizeForRepeat()`: case, punctuation and
    whitespace collapsed; a closer is nothing, so is a sentence of two
    words or fewer) to one in either previous reply is skipped
    wherever it sits, on the stream per sentence at the guards' point.
    `repeat_reply`, the whole-reply case (`isRepeatReply()`: content
    words overlapping a previous reply's by 80 percent or more with no
    new proper noun or number, or every sentence a repeat): the
    chat-loop line stands in, marked emptied, and the engine retries
    once with `REPEAT_RETRY_NOTE` (REG-01's retry, the turn's second
    generation); a retry that repeats too leaves the line; on the
    stream the end-of-reply case is recorded on the row. On an
    objection (target hub with a repair, or `OBJECTION_RE`'s shapes)
    a bare assertion of understanding is `self_assertion`, skipped, a
    tail on the register family; the retry note carries the objection
    (`repeatRetryNote()`). The exemptions are by construction: the
    guards read the model's text only (a fixed line the engine
    repeats, a package's deterministic answer and a re-asked
    confirmation or ask never pass through them), and two words are
    never a repeat. The plan half (`repeat: forbidden`, the remedy by
    objection type) rides with ACT-03. The ids join
    `spec/vocab/defect-codes.json`. Bench: `said-that-already`,
    `same-line-twice`, with `retries`, `distinctFromPrevious` and
    `guardHits` as expectation kinds; seven engine tests that scripted
    the same line on consecutive turns vary it now. Tests:
    `backend/tests/rep01.test.ts`, the corpus rows. Exit: `bash
    scripts/check.sh`.

<a id="set-reads-0915"></a>

- [x] **The set's three reads: a child's asserted state, a remark is not the answer, the example line said back** (S)
    Done 2026-09-16 (docs/dev/session-a.md "The set's three reads"):
    the household activity shape reads a state after "is" or "has
    been" ("he's been asleep in the dark") as it reads a progressive,
    so a child's state the owner has no record of is an invention; a
    world mark in a `who` answer counts in an answer's shape only (no
    question, no tag, eight words or fewer), so "she was on that show
    for years, wasn't she" learns nothing; the persona's own example
    line said back ("Got it, added to the list.") is `example_parrot`
    read before the action family, a register-family skip with its own
    retry note. Rows: child-state-invented, remark-not-an-answer,
    example-line-not-an-answer; the corpus rows; tests/setReads.test.ts.
    Exit: `bash scripts/check.sh`.

<a id="ask-02"></a>

- [x] **ASK-02: Candidate hygiene, brands and services, hub-introduced names, the confirmed public figure** (S)
    Done 2026-09-15 (docs/dev/session-a.md "ASK-02"; dev.md section 16
    part 7, item 7 of its list; findings 33 and 44): the resolver's
    world edge in `backend/src/lib/unknownNames.ts`. Rule 1, hygiene
    (`notAName()`): an edge dash trimmed, an oath in its slot
    ("Lord, that took ages"), a token the tagger also reads as an
    expression, an adjective, an adverb or a verb, a capitalized word
    that was an ordinary word in the last three turns or sits after a
    determiner ("that Answer was wrong"), and a typo one edit from a
    predicate word in a predicate's slot ("Wong, that's not it");
    the tagger's lexicon is the word list, nothing on the network.
    Rule 2: a brand or a service (the tagger's organization tag, a
    model number or a product noun after the name) is unresolved with
    `candidate_kinds: [organization]`, no frame, no ask. Rule 3: a
    name the hub introduced (its last two replies, a retained
    outcome's result text; a name the person said first stays theirs)
    is a `world` subject with that provenance, never unresolved,
    never asked back (`KnownNames.hubNames`, `namesIn()`). Rule 4:
    the `who` answer parser reads the world kinds ("the actress,
    Serena Vale", "a public figure", "she's famous", a full name to a
    first-name ask) into `WhoAnswer.world`; the answer creates no
    entity, retires a candidate of the name, puts a `world` subject of
    that kind on the turn, and runs the turn that raised the name
    (`PendingAsk.carriedQuestion`) as a websearch `via: forced` with
    the engine's query (`worldAnswerQuery()`), so the reply is the
    answer; the model's own identity question about a bare unresolved
    name ("someone you know or a public figure?") binds as the ask
    (`replyAsksIdentityOf()`). The `[turn]` line's subjects carry the
    world kind or the hinted kinds. Bench: not-a-name, hub-named-it,
    public-figure (the fake search's film cast row names Serena Vale),
    `subjectsAbsent` and a subject `kind` as expectation kinds. Tests:
    `backend/tests/ask02.test.ts`. Exit: `bash scripts/check.sh`. The
    full set on bc738b5 (86 rows, three runs): 240, 237, 239 of 302,
    the hard rows 12 of 12, the question rate 27.6 to 29.2 percent;
    LOOKUP-02 and ASK-02 accepted on it. The follow-up commit: the
    lookup stand-down reads the turn's household subjects (things,
    places, the carried ones), the stack deduped by entity; the query
    for a pronoun-only question with no world subject is the
    confessing sentence's own words; a queued question in play goes
    first and a relationship question about a name not in play holds;
    hub-named-it seeds its promise, the Serena Vale fixture carries
    what happened, not-a-name names Answer.

<a id="lookup-02"></a>

- [x] **LOOKUP-02: The hedge is a promise, the offer binds its question, the forced lookup is a ladder** (S-M)
    Done 2026-09-15 (docs/dev/session-a.md "LOOKUP-02"; dev.md section
    16 parts 1, 2 and 4, item 3 of its list): the read over the draft's
    first two sentences or 160 characters on both paths (the stream's
    hold widened); a denial of a deliverable (`false_capability`, the
    id in `spec/vocab/defect-codes.json`) is cut first and the promise
    behind it read; the hedge-plus-promise and help shapes join the
    promise and offer families; a hedge beside a checkable value on a
    world question is the other confession (`hedged_fact` on the
    `[turn]` line); an offer binds and never forces; the engine writes
    the lookup's query from the turn's subjects and the confessing
    sentence (`lookupQueryFor()`), never from the person's words; a
    pending lookup binds that question; the imperative consent forms
    run it; the forced lookup is a ladder (`runForcedLookup()`: the
    model's rung under `tool_choice: required`, then the search with
    the same query, the failed rung kept, `via: forced` on its
    outcomes); `capability_claim` is off a request the lookup tools
    serve. Bench: hedged-promise, offer-binds-the-question and its
    go-on-then variant, objection-reruns, hedged-draft,
    ladder-falls-through, with `seedReply` now a real draft through the
    recording proxy and the `outcomeArgsMatch` and `lookupShape`
    expectation kinds; open-question-once seeds its candidate. Tests:
    `backend/tests/lookup02.test.ts`, the corpus rows. Part 1's rule 1
    (the claim-type decision before generation) is CHAT-13's. Set 1 on
    2c3eaee: 38, 38, 38 of 47 over thirteen rows, the item's six green
    every run; its three reads fixed after (a number word is a
    checkable value; offer-binding reads the built query;
    act-register-requests seeds Rover as the registered pet, a seed
    confirming an earlier row's candidate of the same name).

<a id="lookup-01"></a>

- [x] **WINDOW-01: A bank line never reaches the model as its own words** (S)
    Done 2026-09-15 (17de27f, e35bac1; dev.md section 16 part 11,
    finding 38): the window strips a replaced reply's bank line whole,
    two-sentence lines included, and a pending line notes the wait
    instead of quoting the line; the family-note test reads the
    pending rule. Landed in the stack-2 gate with CHAT-13's chunks.
- [x] **REG-02: Wishes are closers, and a tag question is a cut tail** (S)
    Done 2026-09-15 (d8b2427, 14d3736; dev.md section 16 part 9,
    findings 35 and 40): a wish sentence ("good luck", "fingers
    crossed") is register and skipped, a wish tail is cut, a standalone
    or same-line tag question at the end of a reply is cut with its own
    reason `tag_question` on both paths (the streaming path's cut was
    missing in the first commit; the full gate found it through the
    corpus row). Bench: `sign-offs`. Tests: guards.test.ts, the corpus
    rows `reg02-*`, two streaming tests in turnEngine.test.ts.
- [x] **EXP-02: Experience verbs by object, three new forms, the replacement only on an experience turn** (S)
    Done 2026-09-15 (faa95d1 through 4ef16e3; dev.md section 16 part
    8, finding 34): the consumption verbs count only with a sensory or
    consumption object (a food or place word, a title on the stack,
    "it" or "that" when the live world subject's kind is media, place
    or food, the object the question itself named on an experience
    turn), never with a lookup infinitive; "can't wait", "as excited as
    you" and reputation hearsay on a `current` world subject with no
    review or rating outcome are claimed experience; the
    CANNOT_EXPERIENCE line stands in only when the person asked about
    the hub's experience, an objection turn never takes a capability
    line, and elsewhere the sentence is skipped and the rest stands.
    Bench: `experience-forms`. Tests: guards.test.ts "EXP-02", the
    corpus rows `exp02-*`. Four commits: the first three rounds each
    weakened a test to pass; the fourth restored them.
- [x] **The set read of 2026-09-15 on d4fbf6e** (S)
    Done 2026-09-15 (350147d; the full seeded set, 238, 237 and 243 of
    313): chunk E's short-comment reclassification yields to a closing,
    greeting or backchannel the rule layer read ("thanks" after a
    lookup is a closing again, six rows); "check if I remember" is a
    recall promise, not a lookup; "supposed to be" and "meant to be"
    join the hedge marks; `carry-decays` and `comment-not-definition`
    name a cartoon title that is on no roster; `subject-before-pattern`
    is marked red until CHAT-13's typed world subject lands. Left for
    Session A's lane: an asserted state of a child the owner has no
    record of passes the household guess guard (cross-person-recall#2),
    a world-answer mark taken on a long statement that is no answer,
    and the prompt-side drift that draws "Got it, added to the list."
    on a plain statement.
- [x] **CONS-01: Standing reply constraints** (spec S, engine S)
    Done 2026-09-15 (7e816a7 the spec; 145d2df, f773e80, 9ccaf9f,
    16f678f the engine; dev.md section 16 part 9, rules 2 and 3): the
    `reply_constraints` table and its migration, a deterministic parser
    ("stop saying X" checked against the hub's last two replies, the
    shape and length asks) and store (`lib/replyConstraints.ts`); the
    engine writes the constraint after the window and lets the model
    answer; a sentence carrying a banned phrase is cut (`banned_phrase`,
    skippable) and an emptied reply retries with the phrase in the note;
    the spoken cue drops any banned cue, never plays twice in a row for
    a person, and never plays on an objection to the hub
    (`cueSuppressed` on the stream result). Bench: `sign-offs` turn 3,
    `cue-banned`; `list-shape-on-lookup` waits for CHAT-16's composer.
    Tests: replyConstraints.test.ts, guards.test.ts "CONS-01", the
    corpus row, two stream tests.
- [x] **ALM-01: Derived date and time questions as a compute over the almanac** (S-M)
    Done 2026-09-15 (dbf42dd the module; 9d4652c, d69335f the engine;
    7162ed9 the connective prefix, 041d856 the bench clock and the
    `derived-dates` row, both on the next stack; dev.md section 16 part
    6, rule 1):
    `lib/almanacCompute.ts` parses the relative-term grammar, answers
    from a given clock with fixed plain templates and the inputs
    recorded, and annotates a date's relation to today for the
    composer; 18 tests on a pinned Monday clock. The rule layer reads
    the relative term in the shared prepare path before routing and
    answers from the turn's clock with a typed `almanac-compute`
    outcome carrying the inputs; a follow-up reads the carried term;
    the bare almanac questions still route to their packages, behind a
    leading connective too. Rule 2 (every date in a composed answer
    annotated) rides with the composer core.
- [x] **LOOKUP-01: A promise is the lookup, an offer is a pending ask** (S-M)
    Done 2026-09-14 (docs/dev/session-a.md "LOOKUP-01"): the promise
    and offer shapes in `lib/guards.ts` (`lookupShapeOf()`, one
    definition for both paths); a first-sentence promise with no lookup
    outcome is never sent, the forced lookup runs (the invention
    retry's own mechanism) and its answer goes out, or the rest of the
    draft without the promise, or the lookup family's honest line; the
    streaming path holds the first sentence (`LOOKUP_HOLD_MAX_CHARS`)
    and aborts the draft's request before the forced completion; an
    offer or a promise that went out becomes a `lookup` pending ask
    bound to the question (`notePendingLookup()`), which a consent word
    runs through the websearch via ask, a refusal clears, and anything
    else falls through. The `offer-binding` conversation, the bench's
    fake SearXNG, EXP-01's two fold rows, and the bench's question rate
    beside the DailyDialog reference (finding 23, a measurement only).
    Until CHAT-13 gives the
    forced lookup a subject, the forced completion is the invention
    retry's own (the model writes the expression from the same
    messages) and the pending ask binds the person's utterance
    verbatim as the expression. The seeded set: 193, 194 and 193 of
    254 (RECALL-03's 189, 188, 186 of 251), the item's rows green in
    every run; its one regression (a promised lookup forced on a
    household subject) fixed in the follow-up: a question carrying a
    household subject is never looked up on the web and binds nothing.
    Follow-ups left on record: the empty-lookup reply shape (CHAT-13's
    ladder), the frame-only household subject (ASK-01).

    Objective: "let me check that for you" runs the check, and "do it"
    after an offer runs the offer. Files: `backend/src/lib/turnEngine.ts`
    (the first-sentence read on both paths; the forced lookup through
    `lookupTools`, the invention retry's own mechanism; the `lookup`
    pending ask), `backend/src/lib/conversationHistory.ts`
    (`PendingAsk.kind` gains `lookup`, bound to the resolved query),
    `backend/src/lib/guards.ts` (the promise and offer shapes, one
    definition shared with the lookup action family),
    `backend/tests/turnEngine.test.ts`, `tier2.test.ts`. Mirror: the
    invention retry in `runTurnHoldingLease` and `resolvePendingAsk`.
    Do: a promise or offer in the first sentence with no lookup outcome
    is an invalid draft and is not sent; the forced lookup runs on the
    subject and question and its result goes out as every lookup result
    does; a promise later in the reply becomes a `lookup` pending ask
    that a consent word resolves. Acceptance: the `new-album` "when is
    it out" turn and the `offer-binding` conversation (design note,
    section 4), three seeded runs; a scripted-engine test for each path.
    Out of scope: the composer (CHAT-16) and the decision rule for
    exact fields (CHAT-13's amendment). Exit: the named tests, `bash
    scripts/check.sh`.

<a id="engine-host-01"></a>

- [x] **ENGINE-HOST-01: External engines for the hub and the bench** (S)
    Done 2026-09-14 (docs/dev/session-a.md "ENGINE-HOST-01"): the
    three supervisors' URL tiers (`MAIPAI_LLAMA_SERVER_URL`,
    `MAIPAI_BACKGROUND_URL`, `MAIPAI_EMBED_URL`, one name per engine,
    already spawning nothing) now probe the engine they point at and
    read its identity from `/props` (`lib/engineIdentity.ts`: the
    build, the model's file name, the health answer, the host as a
    label only, `local` or `external`, never an address); the `[turn]`
    line carries `engine`; the bench header and setup's refusals print
    the label for a non-loopback engine, the model's file name, and no
    hash for a file this machine does not have (llama-server exposes
    none); the recording proxy fronts the external chat engine as it
    fronts a local one. A test per supervisor and for the identity
    module. The privacy page is unchanged: an engine on the LAN is the
    household's own machine, and the hub talks to it only when the
    household points it there.

    Objective: run the hub and the seeded sets against engines on
    another machine in the house, so the bench machine's memory stops
    mattering and a set holds nothing else. Files:
    `backend/src/lib/llmSupervisor.ts`, `backgroundSupervisor.ts`,
    `embedSupervisor.ts`, `engineIdentity.ts`, `turnEngine.ts` (the
    `[turn]` line), `backend/scripts/bench/setup.ts`,
    `conversationLive.ts`, their tests. Out of scope: any change in
    what the engines do; a settings key for the URLs (the env keys are
    the developer's override, a household setting is its own item).
    Exit: `tests/engineIdentity.test.ts`, the three supervisor suites,
    `bash scripts/check.sh`.

<a id="subject-ref-spec"></a>

- **The `SubjectRef` spec, for CHAT-13** (folded into SPEC-01 by the coherence review, 2026-09-14; the shape is recorded here and lands there)

    Objective: one shape for what a conversation is about, shared by
    the hub, the robot and Go. Files: a new
    `spec/schemas/subject-ref.schema.json` (a discriminated union: a
    household reference with an `entity_id`; a world reference with
    kind, display name, optional year, the typed source and its stable
    key when one answered, and `recency: current | dated | unknown`; an
    unresolved reference with the surface form, candidate kinds,
    provenance and confidence), fixtures, both generated bindings,
    `spec/README.md`. Acceptance: the round-trip fixtures for all three
    variants; the validator refuses a world reference carrying an
    `entity_id`. Out of scope: any hub code (CHAT-13). Exit: the spec
    suite, `bash scripts/check.sh`.

<a id="engine-host-02"></a>

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
    `docs/plans/gpu-card-layout-2026-09-14.md` (the owner's current
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

- [ ] **ENGINE-HOST-03: First-day Metal validation on the Studio** (S, after the Apple Silicon design pass)

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

- [ ] **STACK-16: Home runs on the Stack** (L, after the Stack's STACK-14; design pass in `docs/dev.md` first)
  - [x] **HOME-STACK-01: the Stack inside Home's installer** (M, done 2026-09-21): `scripts/install.sh` places the Stack (fetches `getmaipai/stack@$STACK_TAG`'s source, builds it via that repo's own `scripts/build-binary.sh`, runs it as the logged-in console user rather than root, waits for `/healthz`, writes `engines.stack.url` last, only when that setting is still empty or a previous local write - never clobbering a household's own remote/hand-run Stack); `scripts/uninstall.sh` removes it inside the existing single "DELETE MY DATA" confirmation, still offering and deleting `stack/data` even if the Stack binary itself is gone; the upgrade branch stops, rebuilds and restarts it, clearing `engines.stack.url` if the rebuild fails rather than leaving it pointed at a dead process. `--dry-run` prints the Stack half's whole plan with no root and no side effects; scoped to the Stack section only, a stated boundary, not a retrofit of Home's own pre-existing install flow. Two real bugs found wiring this up, fixed upstream not here (`build-binary.sh`'s own `OUT_DIR` silently broke on an absolute path, `getmaipai/stack@233bc4f`, `STACK_TAG` bumped to it). Two review rounds then found eight more real bugs total, all fixed (`docs/dev.md`'s own entry has the full list): round one - `main()` silently never ran under this script's own documented `curl | bash` usage; `find_console_user()` accepted `root` as a valid console user; `uninstall.sh` could silently leave `stack/data` on disk when the Stack binary was missing; `engines.stack.url` was unconditionally overwritten on every run; a failed upgrade rebuild could leave it pointing at a dead process; `ensure_service_user_linux()`'s own recursive chown would have clobbered the Stack's ownership on Linux (found while fixing the others, not by the review itself - no Linux box to catch it live). Round two, on round one's own fix-hunks - `--dry-run` made a real loopback network call despite its own documented guarantee not to; the "shared" dry-run/real `install-service` command was actually hand-duplicated, not shared. Fixing the second of those surfaced a bigger one: macOS ships bash 3.2 (no `mapfile`/`readarray`, bash 4+ only) as its own `#!/usr/bin/env bash` default, this installer's own primary target - a rule now for every installer script in this repo, not just these two, documented in `docs/dev.md`'s own entry with how it was found. Files: `scripts/install.sh`, `scripts/uninstall.sh` (now sources `install.sh` for `detect_os`/`detect_arch`/`render_stack_binary_name` instead of a second copy), `backend/scripts/set-setting.ts` (new, a one-shot `restore-drill.ts`-shaped script writing the setting directly against the not-yet-started database, `--only-if-empty-or-prefix`). Tests: `scripts/install.test.ts` (10 tests) and `backend/tests/setSetting.test.ts` (new, 6 tests, the real write path, not just a dry-run string). `bash scripts/check.sh` green, full backend suite 3612/3612. Verified live on this MacBook under `/bin/bash` (the real system default, not a dev shell's own `PATH`-preferred bash), never Home's own root-level service, before round one and re-verified after each round: a real `install-service` with a scratch `STACK_DATA_DIR`/port/`STACK_BUN_BIN`, `/healthz` answering, `status` showing every one of those env vars actually baked into the running LaunchAgent, `uninstall-service --remove-data`, `launchctl list | grep maipai` empty afterward, the data directory gone. Out of scope, a stated gap: a real clean-account install and the entire Linux path (`systemd --user`, `find_console_user()`'s `logname` fallback, and the chown-ordering fix above) - none of it has run on a real second machine.
  - [x] **HOME-STACK-02a: Home's Stack client** (done 2026-09-20): the typed client, error surface, and wire types in `backend/src/lib/stack/`; not yet wired into existing modules (that is HOME-STACK-02b).
  - [x] **HOME-STACK-02b: the role wire, behind one setting** (done 2026-09-20): `engines.stack.url` (commons `spec-v0.1.3`, household scope like `chat.model_id`'s own precedent) decides it - empty, the default, and every existing module (`llmSupervisor.ts`, `embedSupervisor.ts`, `ttsSupervisor.ts`, `stt.ts`'s in-process recognizer) is untouched. Set, `lib/llm.ts`'s `complete()`/`startCompleteStream()`/`embed()` (chat, the judge - there is no separate judge role on the wire, only a different prompt - and embeddings all funnel through here already), `lib/tts.ts`'s `synthesizeSpeech()` and `lib/stt.ts`'s `transcribeUtterance()` call the Stack client by role instead; `turnEngine.ts`'s `[turn]` line and `TurnStats` read the reply's identity headers (`lib/stackEngine.ts`'s `getActiveChatEngineIdentity()`) instead of probing a process; `/api/voice/hf-token` writes `stack.engines.tts.hf_token` on the Stack instead of Home's own household setting. A scripted 503 speaks the companion's own "I can't think right now" for chat (embed/tts/stt fail silently to a person, so they keep the plain wording) and raises a Repairs entry carrying the real `offline_reason`; every other StackError kind keeps the Stack's own stated reason. Streaming reuses `@maipai/spec/llm/ts/client.ts`'s own SSE chunk-interpretation logic, ported (not reinvented) against the Stack's `{ stream, headers }` reply instead of that method's own internal fetch, since only that shape gives per-turn identity headers before the first token arrives; the original's idle-timeout re-arming was not ported (a caller disconnect still aborts; a genuinely wedged Stack stream is a follow-up, not silently patched here). `getStackUrl()` also fails safe to "not configured" when the stored value isn't a loopback-shaped URL - found live via safety.test.ts's own settings-stress sweep. Files: `backend/src/lib/stackEngine.ts` (new), `llm.ts`, `tts.ts`, `stt.ts`, `routes/voice.ts`, `turnEngine.ts`, `stack/client.ts` (`identityFromHeaders` exported). Tests: `__setStackClientForTests()` injection with a real scripted Stack (`tests/stackFixture.ts`, `Bun.serve`) in `llm.test.ts`, `tts.test.ts`, `stt.test.ts` and `voice.test.ts` - the flag off (unchanged) and on, a success reply, the 503/companion-line/Repairs path, a 400 keeping the Stack's own reason, the identity headers read before the stream's first token, and a garbage `engines.stack.url` value falling back to unconfigured. Out of scope: HOME-STACK-01 (the setting is hand-set until that item's installer writes it), HOME-STACK-03's event bridge, removing Home's own supervisors (STACK-16 itself, after the Studio proof). Exit: `bash scripts/check.sh`.
  - [x] **HOME-STACK-03: Stack event bridge into Home's notifications** (done 2026-09-20): the SSE bridge in `backend/src/lib/stack/events.ts` that streams `<base>/stack/v1/events`, reconnects with backoff and `Last-Event-Id`, dedupes by `seq`, maps the update events and an opened warning/critical `health.changed` item to household-admin notifications, and exposes an `onEvent` callback for the Engines page's live view; four `engines.*` notification types and their per-person Telegram toggle keys added to `notificationTypes.ts` and `notificationKeys.ts`.
  - [x] **HOME-STACK-05: Updates and Repairs wiring** (done 2026-09-20): Settings > Updates shows the Stack's engine and model update rows (`llama-server`, `mlx-serve`, and installed models) beside Home's own app-release row, each with an Apply/rollback action; Repairs shows the Stack's own health items alongside Home's, each with a working one-click fix; a scheduler job runs the Stack's own maintenance (catalog check, readiness check, storage sweep) once a day, gated on the Stack's own `stack.updates.enabled` setting (not a Home setting - Home never overrides what the Stack was told to do). All gated on `engines.stack.url`, same as HOME-STACK-02b; empty, the Updates and Repairs pages are exactly what they were before this item. Files: `backend/src/lib/stackUpdates.ts` (new), `stackHealthSync.ts` (new, reuses the existing `lib/issues.ts` raise/resolve/fix-handler machinery rather than a second health surface - a Stack item resolved on the Stack's own next read is resolved here too, not left stale), `routes/updates.ts` (`UpdateProjectionSchema.extend({stack: ...})`, additive - the existing flat consumers, `useHubStatus.ts` and `HomePage.tsx`, are untouched), `routes/repairs.ts`, `scheduler.ts`, `stack/client.ts` (`applyEngineUpdate`, `rollbackEngine`, `sweepStorage`, `runCheck`), `frontend/src/apps/settings/UpdatesSection.tsx` + `UpdatesPage.tsx` (new), `App.tsx`, `SettingsPage.tsx`. Tests: `stackClient.test.ts`, `scheduler.test.ts` (+3, the maintenance job on/off/gated-off), `updates.test.ts` (+8, the merged projection, a Stack read failure surfacing `stackError` rather than reading as no Stack, and each new route), `repairs.test.ts` (+2, a Stack health item appearing and one the Stack stops reporting resolving on the next read). Verified manually against an isolated backend (a different port and data directory from the real app) and a scripted Stack fixture: the Updates page's rows, the Apply confirm dialog, a successful apply updating the row and revealing "Go back", and the Repairs page picking up the fixture's health items, each screenshot opened and judged. A medium review caught two real bugs (an engine-agnostic confirm dialog was hardcoded to "chat engine"; a Stack read failure silently read as no Stack at all), both fixed; the gate's own a11y check caught a latent `ThingsTable` kit bug (a 32px "More actions" button, an unlabeled header) no earlier `rowActions` consumer had ever hit, fixed in `commons` as `ui-v0.4.5`. `bash scripts/check.sh` green. Out of scope: HOME-STACK-04a's own Engines admin page (a separate lane); an actual installer for the Stack itself.
  - [x] **HOME-STACK-04a: the Engines API** (done 2026-09-21): `backend/src/routes/engines.ts` (new), the household's own admin surface onto the Stack - twelve routes (roles/engines/budget overview, hardware, per-engine start/stop/restart/install, models, per-model load/unload/pin/unpin, health, health-item fix, and the update-state/check/apply/rollback trio also reachable through `/api/updates/stack/*`), owner/admin gated the same way `repairs.ts` is. Every response is a named Zod schema built once from `stack/types.ts`'s field names, no `any`; the three calls the Stack itself still types as `Record<string, unknown>` (hardware, models, the two action results) get an honest `z.record(...)` rather than a guessed shape. One `classifyStackError()` maps every `StackError` kind to its real status (offline/unreachable 503 with the real `offline_reason`, unverified 409, unknown 400, timeout 504); the three `/updates*` routes delegate to `lib/stackUpdates.ts`'s existing functions instead of calling the client a second time, so applying an engine update has one code path, not two. Files: `backend/src/routes/engines.ts` (new), `app.ts` (mounted at `/api/engines`). Tests: `enginesRoutes.test.ts` (new, 23 tests) - every endpoint's success path, owner/admin required, an unsigned request 401, a bad model-action body and a tag-less rollback both 400 before the client is called, each `StackError` kind mapped to its real status. A routing bug found live by these tests (a two-segment dynamic catch-all registered before two same-shaped literal paths silently swallowed both) fixed by registration order. `bash scripts/check.sh` green, full backend suite 3606/3606. Out of scope: the Engines admin page itself (04b, the frontend).

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

- [ ] **ENGINE-HOST-04: Add Metal and MLX engine entries under one URL contract** (M, after ENGINE-HOST-03; reserved for the Stack, see STACK-16)

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

- [ ] **ENGINE-HOST-05: Provision the measured one-box resident roles** (M, after ENGINE-HOST-04; reserved for the Stack, see STACK-16)

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

- [ ] **ENGINE-HOST-06: Standalone one-box watcher and telemetry** (M, after ENGINE-HOST-05; reserved for the Stack, see STACK-16)

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

- [ ] **MEDIA-HOST-01: Supervised local image generation on MPS** (M, after ENGINE-HOST-05; reserved for the Stack, see STACK-16)

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

- [ ] **MEDIA-HOST-02: Wan video on MPS with measured degradation** (L, after MEDIA-HOST-01; reserved for the Stack, see STACK-16)

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

- [x] **MEM-06: The judge grounds every fact in the speaker's words** (S-M)

    Done 2026-09-15 in five chunks (7bdb484 through 253ef69 on main):
    a fact shares half its content words and every proper noun and
    number with the speaker's words or a confirmed assistant line, or
    is `ungrounded`; a state with a conversational verb is `passing`; a
    fact about the turn's world subject is `world` unless it is the
    speaker's own preference or plan; every kept fact cites one
    eligible clause of the frozen signal, grounded in it, its subject
    matching (`ineligible_act`, `unknown_grounding`,
    `subject_mismatch`); a quoted, hypothetical or joking clause writes
    nothing and says why; a reported clause writes about the third
    party at most 0.4 with the source named, a commissive a goal, a
    project or a dated event, a moderate or high emotion a bounded
    state. Eight judge-eval rows; the step-3a subject tests now have
    the speaker say the names (a name the model invents is never
    written). A sentence-initial capital is not a proper noun. The
    original note follows.

    Objective: no reply text, lookup result, passing state or model
    inference becomes a memory. Files: `backend/src/lib/memoryJudge.ts`
    (a deterministic validator after `rejectPromptEchoes`, three
    rejections counted on its log line), `backend/src/lib/guards.ts`
    (the conversational-progressive list exported, one definition),
    `backend/scripts/bench/judge-eval.ts` and its fixture,
    `backend/tests/memoryJudge.test.ts`. Mirror: the echo filter's
    anchor reading of the turn. Do: a fact shares half its content words
    and every proper noun and number with the speaker's words (or a
    confirmed assistant line) or is `ungrounded`; a `state` with a
    conversational verb is `passing`; a fact whose subject is the turn's
    world subject (a succeeded lookup or typed-source outcome's title,
    read from the retained outcomes; CHAT-13's world `SubjectRef` once
    it exists) is `world` unless it is the speaker's own preference or
    plan; an inferred kind or relationship is ASK-01's candidate, never
    a record; once ACT-01 exists, the clause contract (dev.md section
    12, part 6): every proposed fact cites one eligible clause (an
    `inform` or `commissive` with stance `asserted` or `reported`),
    every proper noun and number in it is grounded in that clause, the
    fact's subject matches the clause's subject, a `reported` clause
    yields a record about the third party only, capped at importance
    0.4 with the source named, a `commissive` clause yields only a
    `goal`, `project` or dated `event`, a `moderate` emotion about the
    speaker or a named subject yields a `state` at importance 0.3 with
    `valid_to` 24 hours out and a `high` one at 0.5 with seven days,
    an explicit time always winning, `none` or `low` yielding nothing,
    and one utterance may split into an event and a state; the
    rejections `ineligible_act`, `quoted`, `hypothetical`, `joking`,
    `unknown_grounding`, `subject_mismatch`, `invalid_emotion_category`,
    `missing_valid_to` and `child_about_adult` (a child-band speaker's
    clause whose subject is an adult writes nothing about the adult and
    at most a `state` about the child, `sensitive`, person scope; a
    child's turn never writes an `adults`-audience record; dev.md
    section 13, part 5) counted beside the rest; two channels, the
    proposition channel (asserted or reported inform and commissive
    clauses only) and the emotional-state channel (a moderate or high
    expressed emotion writes a bounded state about the identified
    speaker from an inform, a question or a commissive, citing the
    emotional clause and never the proposition inside a question), with
    the rejections `question_proposition`, `emotion_subject_mismatch`,
    `minor_state_about_other` and `disclosure_escalation` (the judge
    never raises a record's disclosure; section 13, part 9). **Deferred
    2026-09-14 (the coherence review): the section 14 half that follows
    waits as CRED-01; its fields ride in SPEC-01 with no writer, and the
    judge's "nominate routine, major, same or contradiction" field is
    deleted, the vocabulary and the dedupe pass deciding instead. The judge's
    bounds, from the outside review: at most four eligible clauses per
    turn and one candidate fact per clause reach the extraction, the
    output is capped at 192 tokens, and a structurally invalid answer is
    rejected with its diagnostics kept, never retried.**
    **Amended 2026-09-14 (dev.md section 14):** `confidence` (required on
    `record_kind: memory`, existing records migrated to 1.0 with a
    `legacy_assertion` evidence entry), `confidence_evidence` (source
    id, source person, kind, observed_at; merged on sync as a set union
    by source and kind, then recomputed) and `conflicts_with` on the
    memory record (spec first), and one engine-owned
    `computeFactConfidence()` the judge, the remember package, a
    correction, the curator, recall and the robot all call: 0.95 for a
    routine self-report, 0.50 for a life-events class, a contradiction
    of an active certain record or an unknown subject, +0.15 once for a
    grounded detail, +0.20 for a re-assertion on another calendar day,
    +0.30 for an independent corroboration at the same authorized
    scope, -0.30 for an unresolved contradiction, clamped to 0.10 and
    1.00; the judge model may nominate routine, major, same or
    contradiction and never returns the number; a reported record
    keeps its cap; rejection codes `invalid_confidence_source`,
    `private_corroboration`, `confidence_without_evidence` and
    `stance_not_asserted`. Acceptance: one judge-eval turn per class with roster names, plus "Quill was here"
    persisting no kind and no relation, at 100 percent precision on
    those rows; the `act-memory` conversation (section 12, part 6),
    three seeded runs, effects on the memory table; the seeded bench's memory rows
    unchanged; the drop counts in the run header. Out of scope: the
    prompt's wording. Exit: `bun test tests/memoryJudge.test.ts`, the
    judge-eval bench, `bash scripts/check.sh`.

<a id="spec-02"></a>

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

### Chat parity program (design pass, 2026-09-16)

The dated inventory and product decisions are in
`docs/plans/chat-parity-2026-09-16.md`. These items are additive follow-ups;
they do not change the completed conversation, attachment, composer, or
stats item text above.

- [x] **CHAT-PARITY-01: model picker and current-model caption** (S, after STATS-01)

    Objective: let a parent see and choose the available healthy chat model
    without opening owner diagnostics. Files: `frontend/src/apps/chat/`, the
    AI settings registry, and the engine model-list route. Pattern: mirror
    `useEngineHealth`, `SensesDock`, and the role cards in SETTINGS.md.
    Acceptance: the picker shows only reachable models, the current choice
    persists for the person or household scope, an unavailable choice has one
    repair action, and a child sees only the calm default label. Out of scope:
    model downloads and GPU tuning. Exit: backend and frontend tests,
    responsive screenshots, `bash scripts/check.sh`. Landed date unrecorded (no commit names this ID; ticked before 2026-09-21).

- [x] **CHAT-PARITY-02: temporary chat retention** (S, after CHAT-PARITY-01)

    Objective: provide an explicit per-conversation temporary mode that does
    not enter normal history or memory. Files: conversation schema and
    migration, `conversationHistory.ts`, conversation routes, `ChatPage.tsx`,
    and `docs/user/privacy.md`. Pattern: mirror COMP-02's additive
    conversation mode and the existing retention setting. Acceptance: the
    mode is visible before the first send, its banner names the retention
    behavior, temporary turns cannot create durable memory, reload does not
    restore them into normal history, and child UI exposes no retention
    internals. Out of scope: remote provider retention promises. Exit: spec,
    backend, frontend, and privacy tests, `bash scripts/check.sh`. Landed date unrecorded (no commit names this ID; ticked before 2026-09-21).

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

- [x] **CHAT-PARITY-04: continue a cut-off answer** (M, after CHAT-PARITY-01)

    Objective: continue a stopped or truncated assistant answer from its last
    stable message without pretending the missing text was generated. Files:
    `backend/src/lib/turnEngine.ts`, `backend/src/wire.ts`,
    `frontend/src/apps/chat/chatModelAdapter.ts`, `thread.aui.tsx`, and
    branch tests. Pattern: mirror `chatEditSupersedes.ts`, the existing
    assistant-ui message metadata, and the two-call composer budget. Acceptance:
    the action appears only on an incomplete assistant turn, sends a new
    branch with an explicit continuation instruction, keeps the original
    immutable, stops cleanly, and never sends a third model call. Out of scope:
    reconstructing a crashed remote provider response. Exit: stream, branch,
    guard, and frontend tests, `bash scripts/check.sh`.

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

- [ ] **CHAT-PARITY-06: artifacts and canvas design pass** (L, design pass first)

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

- [ ] **CHAT-PARITY-07: research progress and source timeline** (M, after COMP-02 and PAGE-01)

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

- [ ] **CHAT-PARITY-09: owner repair summary** (S, after STATS-01)

- [ ] **CHAT-PARITY-10: projects** (L, design first; the spec record before any code). What ChatGPT and Claude call a project: a named folder a person creates, holding conversations, uploaded files and a standing instruction, where every conversation inside it starts with the project's files and instruction in scope and the thread list groups them under the project (the owner's own ChatGPT rail: "Projects" above "Recents", each project with its chats indented). Design questions the record answers first: the `project` record in the spec (id, owner person, name, instruction, the file ids, the child projection: a child's project is theirs alone and a parent may see it; sharing across the household later), storage of the files (the same store attachments use, size-capped per project and per household), how the instruction and files enter a turn (the composer context: the instruction as a per-project persona fragment, the files retrieved by the embed role on each turn, never the whole file into the prompt), the thread-list adapter's grouping (the Elements' thread-list-sidebar renders groups as shipped; the adapter supplies the project as the group), moving a conversation into or out of a project, deleting a project (its conversations survive, ungrouped), and the robot and Go clients reading the same record. Then the items: PROJ-01 the spec record and the routes (create, rename, list, add and remove files, move a conversation); PROJ-02 the turn engine's project scope (instruction and retrieval); PROJ-03 the shell (the rail's Projects group in the chat's thread list, the project page from the template's views, the "+" menu's "Work in a project" entry); PROJ-04 the child projection and the parent's view. Depends on: SHELL-02's thread list, the artifact store for files, RESP-01 (a project's instruction is a written-register concern). Out of scope: sharing a project with another household. Exit per item: `bash scripts/check.sh` and the captures.

    Objective: turn engine errors into one owner-readable diagnosis and next
    action. Files: `useEngineHealth.ts`, health and status routes, the
    platform Repairs page, and `docs/user/fix-a-problem.md`. Pattern: mirror
    SensesDock states, settings help text, and the existing repair route.
    Acceptance: a failed turn identifies whether the engine is starting,
    unreachable, or unhealthy without exposing secrets; the parent gets a
    short retry line; the owner gets logs and a restart action behind Expert;
    a child gets neither diagnostics nor provider names. Out of scope: silent
    restarts and automatic model changes. Exit: route, redaction, UI, and
    screenshot tests, `bash scripts/check.sh`.

- [ ] **CHAT-PARITY-10: chat backup and restore** (M, after CHAT-PARITY-03)

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

- [x] **COMP-02: Research mode** (S, after COMP-01, landed 2026-09-16)

    Objective: a conversation that keeps the pane open and streams the
    document after the line. Design: `docs/dev.md` "COMP-02: research
    mode". Files: `spec/schemas/conversation.schema.json`
    (`mode: chat | research`, additive, fixtures), the conversations table
    and migration, `backend/src/lib/conversationHistory.ts`,
    `routes/conversations.ts`, `backend/src/lib/turnEngine.ts`,
    `frontend/src/apps/chat/ChatPage.tsx` and `chatModelAdapter.ts` (a
    header toggle and automatic document handoff). Acceptance: in research
    mode the line is under the short budget and the document streams after
    it; the bubble never carries an article (the `search_voice` family and
    `maxWords` hold); child delivery keeps the existing projection; screenshots.
    Exit: the suites, `bash scripts/check.sh`.

<a id="page-01"></a>

- [x] **PAGE-01: Read a page the person asked about** (M, after COMP-01)

    Objective: let one adult page ask read the returned page and use its
    bounded article text and links. Design: `docs/dev.md#page-01-reading-a-
    page-the-person-asked-about`. Files: the SearXNG host integration,
    websearch recipe and manifest, `backend/src/lib/turnEngine.ts`,
    `backend/src/lib/turnContext.ts`, `backend/src/lib/composer.ts`, the
    conversation bench fixture, privacy docs, and parser dependencies.
    Acceptance: one page fetch uses the same limiter and user agent, checks
    robots and public redirects, stops on the first 403 or 429, and never
    prefetches linked pages; a scripted page exposes three links and bounded
    readable text; `download-link-on-page` selects the matching download
    href; `value-on-page` grounds a value in the page; a missing field says
    the page does not have that; and `who-is-builds-a-card-from-the-page`
    keeps the adult article detail in the document with the child ceiling.
    The package declares the page data source. Exit: targeted tests and
    `bash scripts/check.sh`. Landed date unrecorded (no commit names this ID; ticked before 2026-09-21).

<a id="stats-01"></a>

- [x] **STATS-01: The advanced view of a reply** (M, after COMP-01)

    Objective: give an adult an optional, per-person readout of engine
    work under a reply, with no child disclosure and no engine-host
    privacy leak. Design: `docs/dev.md#stats-01-the-advanced-view`.
    Files: `spec/llm/ts/types.ts` and its tests for the final stream
    `usage` and `timings` payload, `backend/src/wire.ts`,
    `backend/src/lib/llm.ts`, `backend/src/lib/turnEngine.ts`,
    `backend/src/lib/conversationHistory.ts`, the migration and generated
    settings registry for person-scoped `ui.show_turn_stats`,
    `frontend/src/apps/chat/` and the assistant-ui message, plus the
    screenshot pipeline. The additive `TurnStats` object is nullable and
    contains prompt and predicted tokens, speed, first-token and total
    latency, prompt/context counts, cache reuse, sanitized engine label,
    and stop reason. `context_used_percent` stays null without a verified
    engine context capacity.
    Acceptance: a scripted final chunk fills the numbers; a missing
    timing chunk yields nulls, never `NaN`; the same stats reach the
    `done` value, persisted row, and `[turn]` line; adults see a compact
    caption and full kit popover only after opting in; the preference
    persists per person and is off by default; child band renders no
    toggle, caption, or stats; one opened desktop screenshot is judged.
    Out of scope: changing routing, safety, budgets, context sizing, or
    engine launch flags. Exit: targeted backend/frontend tests, screenshot
    review, and `bash scripts/check.sh`.

<a id="comp-03"></a>

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

- [ ] **COMP-04: Per-person companion sets, the kid-safe rule, and the voice per turn** (M, after COMP-03, spec first)

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

- [ ] **REVIEW-01: The conversation quality controller** (M, spec first, after CHAT-16; the auto-apply set waits for a month of the report)

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

- [x] **ACT-01: The turn signal, the spec, the producer's first layers, and the rows** (S-M, before REG-01)

    Done 2026-09-14 (docs/dev/session-a.md "ACT-01"; the spec half is
    SPEC-01's, 29ac71f and 7705ed5): `lib/turnSignal.ts` with the
    protocol and rule layers and the fallback; `readClauses()` in
    `utteranceShape.ts` as the one clause split with ranges;
    `TurnContext.signal` in place of `shape`, the router's and the
    guards' shape a projection (`shapeOf()`); the signal frozen before
    routing on every path, a literal-pattern win freezing a directive
    (a question stays a question); the `signal` column (migration 0034,
    schema version 33) written by `logTurn()` with `judge_status`
    `skipped` at insert when no clause is eligible; the judge's queue
    keyed on the signal; per-stage timings (`signal_us`, routing,
    recall, prompt, first token, finalize, retries, CHAT-13's
    `subjects` slot) on the `[turn]` line and the bench's stage
    summary; an act expectation on every fixture turn and seven new
    conversations (the act-register rows, the act-memory rows whose
    clause-contract checks wait on MEM-06, the curator rows on
    CUR-01); `scripts/bench/turn-signal.ts` with the DailyDialog
    reference and the baseline recorded. The seeded set is recorded
    in the notes.

    Objective: the engine records, before routing and frozen for the
    turn, what kind of turn the person made and what it expressed, on
    the shared turn record, one definition for every consumer. Spec
    first: `spec/schemas/turn-signal.schema.json` (`primary_act`,
    `secondary_acts`, `expressed_emotion`, `emotion_intensity`,
    `target`, `repair`, `refers_to_prior`, `clauses` with range, act,
    stance, subject, emotion, intensity, confidence; `act_confidence`,
    `emotion_confidence`, `source`, `classifier_id`), a
    `conversation-turn.schema.json` that settles the shared turn record
    the robot syncs through the hub and carries the signal beside the
    outcomes, `reply-plan.schema.json` (the moves as required, allowed,
    forbidden; playfulness; `max_sentences`; `max_words`),
    `model-capabilities.schema.json` (a `turn-signal` role and a `head`
    engine kind), fixtures, both bindings. Then:
    `backend/src/lib/turnSignal.ts` (`classifyTurnSignal()` with the
    protocol layer first, reading the pending ask, then the
    high-precision rules: greeting and closing from the near-echo
    guard's vocabulary plus thanks and goodbyes, backchannel as a
    one-to-three-word turn with no content word, question and directive
    from `utteranceShape()`, `repair` from the negation and correction
    phrases the consent and cancel vocabularies list, intensity from
    surface cues, target from the pronoun and the roster, the clause
    split from `utteranceShape()`'s own split with the unmistakable
    stance markers, emotion only on an unmistakable cue; the
    conservative fallback), `backend/src/lib/turnContext.ts`
    (`TurnContext.signal` replaces `shape`; `UtteranceShape` becomes a
    projection inside routing during migration), `backend/src/lib/
    turnEngine.ts` (the protocol and rule layers before routing; a
    literal-pattern win freezes a directive; the signal written to the
    turn row by `logTurn`), `backend/src/lib/memoryJudge.ts` (the queue
    keyed on an eligible clause in the stored signal instead of the
    reply's source; a turn with none marked `skipped` before it is
    queued), `backend/scripts/bench/conversationFixture.ts` (`act`,
    `emotion` and `stance` expectations on every turn; the `memoryRows`
    expectation; the `act-register`, `act-memory` and
    `act-memory-curator` conversations of dev.md section 12) and
    `conversationScore.ts`, `backend/scripts/bench/turn-signal.ts` (the
    DailyDialog distribution and scoring adapter, research use only,
    with the label definitions pinned in the dataset registry),
    `backend/tests/turnSignal.test.ts`. Mirror: `utteranceShape.ts`,
    `intentFor()`, `resolvePendingAsk()`. Acceptance: every fixture
    turn's recorded signal matches its expectation at 95 percent or
    better on acts across three seeded runs; the rule pass and the
    current lexical shape scored on DailyDialog's test split with the
    relabel, macro F1 per act and the baseline recorded in the dev
    docs; a disclosure beside a package answer reaches the judge; a
    closing turn is skipped; no consumer reads a second shape; `refers_to_prior` stays null until
    CHAT-13; the fixture gains the `signal`, `memoryRows` and `subjects`
    expectations of the coherence review's question 5 (the runner reads
    them from the turn row and the memory table, never the log line);
    the `[turn]` line and the bench header carry per-stage timings
    (routing, recall, prompt assembly, first token, finalization,
    retries) so a first-text budget is a measured row.
    Out of
    scope: the heads (ACT-02), the plan and the composer (ACT-03), the
    clause contract and the curator rules (MEM-06, CUR-01). Exit: the
    spec suite, `bun test tests/turnSignal.test.ts
    tests/utteranceShape.test.ts tests/memoryJudge.test.ts`, `bash
    scripts/check.sh`.

<a id="act-02"></a>

- [ ] **ACT-02: The act, emotion and stance heads on the utterance embedding** (M, after ACT-01)

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

- [ ] **ACT-03: The reply plan, from the signal to the composer's permitted moves** (M, rides with CHAT-16)

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

### Track A: the foreground

<a id="fast-01"></a>

- [x] **FAST-01: Make the prompt prefix cache actually hit, and measure it** (M)
  
  Status (2026-09-12, measured and closed with FAST-02): on the real
  prompt assembly the reordered layout shows cache ratio 0.86 and first
  delta p50 385 ms (p95 389 ms), against 1,262 ms and 0.50 for the
  single-message shape; tables in the Track A section of dev.md.

    Depends on: Step 0. Files: `backend/src/lib/engineAutotune.ts`,
    `llmSupervisor.ts`, `llm.ts`, `backend/src/index.ts`,
    `spec/llm/ts/types.ts`, new `backend/scripts/bench/latency.ts`, and
    `backend/tests/engineAutotune.test.ts`, `llmSupervisor.test.ts`,
    `llm.test.ts`, the spec wire tests. Mirror `launchFlagsToArgs()`'s
    existing flag comments, `embedSupervisor.ts`'s URL-tier shape, and
    `scripts/bench/routing.ts`'s "connect only to a supplied URL" rule.

    Do, in this order:
    1. In `launchFlagsToArgs()` append `"--cache-reuse", "256"` after
       `"--jinja"`, with a comment naming this item. Test: the args array
       contains both strings in that order.
    2. In `spec/llm/ts/types.ts` add two optional fields to the chat
       completion request type: `cache_prompt?: boolean` and
       `id_slot?: number`. Additive only; extend the existing wire test
       with one request carrying both.
    3. In `llm.ts`, both `complete()` and `startCompleteStream()` send
       `cache_prompt: true` and `id_slot: 0` on every `chat` request.
       Test in `llm.test.ts`: capture the request through the stub's
       `scriptedChatReply(request)` callback and assert both fields.
    4. In `llmSupervisor.ts`, the override tier (`MAIPAI_LLAMA_SERVER_BIN`
       plus `MAIPAI_CHAT_MODEL_PATH`) also reads `MAIPAI_CHAT_MODEL_ID`;
       when it names an entry in `modelCatalog.ts`'s `CATALOG`, spawn
       with `resolveLaunchFlags(entry, hw)` exactly as
       `trySpawnFromSelection()` does. Without it, keep today's
       flagless behavior. Test: with the id set, the spawn command
       includes `--cache-reuse` (assert on the command array via the
       existing supervisor test seams; do not spawn a real binary).
    5. Warm-up. Add `setWarmupPrompt(provider: () => string)` and
       `warmChatPrefix(client)` to `llmSupervisor.ts`. After a spawned
       backend passes its post-load check, call `warmChatPrefix` once:
       one `chatComplete` with messages `[system: provider(), user:
       "hi"]`, `max_tokens: 1`, `cache_prompt: true`, `id_slot: 0`,
       thinking off; log the result; a failure is logged, never thrown.
       Register the provider from `backend/src/index.ts` with
       `setWarmupPrompt(() => buildStablePrefix())` (this avoids an
       import cycle between `llmSupervisor.ts` and `turnEngine.ts`; do
       not import `turnEngine.ts` from the supervisor). Test: with the
       stub tier and a registered provider, exactly one warm-up request
       arrives after start, none on later `getChatClient()` calls, and
       a provider that throws leaves the client usable.
    6. The bench. `backend/scripts/bench/latency.ts` refuses to run
       unless `MAIPAI_LLAMA_SERVER_URL` is set, sets `MAIPAI_DATA_DIR`
       to a fresh temp directory before any import, and never reads a
       household database. It builds the real stable prefix with
       `buildStablePrefix()`, a fixed synthetic ten-exchange history
       (persona-roster names only), a production-shaped volatile zone
       (rotating memory bullets, a minute-level clock), and thirty
       distinct short user messages, in either of two layouts
       (`--layout=single-message`, the assembled prompt as one system
       message ahead of the history, the old shape's cache behaviour;
       `--layout=reordered`, FAST-02's late context message), both built
       by the real assembly functions with a synthetic actor and salted
       synthetic memory matches. Three uncounted warm-ups, then
       thirty streamed turns; per turn it records time to the first
       content delta, total time, and the engine's own
       `timings.prompt_n` and `timings.cache_n` from the final stream
       chunk (confirmed present on the pinned build). It prints p50 and
       p95 first-delta ms, p50 total ms, mean processed tokens, and
       cache ratio = cached over (cached + processed), over turns 2 to
       30. `--slot=N` picks the slot; run only against an idle engine.
       `tests/latencyBench.test.ts` covers the math, both layouts, and
       the wire path against a stub.

    Acceptance: unit tests above green. Live, on the dev machine, run
    the bench twice and record both tables in `docs/dev.md`: once
    against the main checkout's engine on 8788 (before), once against
    Track A's engine on 8798 with the new flags and warm-up (after). The
    after run must show cache ratio above 0.75 on turns 2 through 30
    and first-delta p50 under 800 ms. If it does not, leave this item
    open with the numbers and the `llama-server` log lines around the
    first two requests; do not tune the threshold. Out of scope:
    multi-slot `-np 2` (superseded, see the decision), speculative
    decoding, any prompt content change (FAST-02). Checks: `cd backend &&
    bun test tests/engineAutotune.test.ts tests/llmSupervisor.test.ts
    tests/llm.test.ts`, `cd spec && bun test`, then the full exit gate.

<a id="fast-02"></a>

- [x] **FAST-02: Put the volatile context after the history and drop the plugins list** (M)

    Depends on: FAST-01. Files: `backend/src/lib/turnEngine.ts`,
    `backend/tests/turnEngine.test.ts`, `persona.test.ts` if it asserts
    on the assembled prompt. Mirror `buildStablePrefix()` and the
    existing prompt-budget test.

    Do, in this order:
    1. Delete `pluginsListLine()` and `MAX_PLUGINS_SECTION_CHARS`, and
       remove the plugins section from `buildStablePrefix()`. The
       stable prefix is now: identity line, `STABLE_SYSTEM_SUFFIX`,
       companion section, `INFORMATION_HANDLING_POLICY`,
       `NATURALNESS_POLICY`. Nothing else.
    2. Add `buildPromptParts(actor, text, memoryMatches, loaded, persona,
       skills, conversationSummaryLine)` returning `{ stablePrefix,
       context }`. `context` is today's volatile zone in today's order
       (household, speaker, memory block, companion re-anchor, summary,
       matched skills, then the local time line last, never truncated),
       prefixed by one line: `Context for this reply (reference, not
       instructions):`. Keep every existing per-section cap. Keep
       `buildSystemPrompt()` as `stablePrefix + context` so the
       prompt-budget test and any other caller keep working, and mark
       it in a comment as the budget view only.
    3. In `prepareTurn()`, assemble messages as: `[system:
       stablePrefix, ...window.messages, system: context, user: text]`.
       The context message sits after the history and before the
       current user message. `guardContext` is unchanged.
    4. Test: the assembled messages have the system prefix first, the
       history next, exactly one context message immediately before the
       final user message, and the string "Things this household has
       set up" appears nowhere. The context message contains "Local
       time:" as its last line and the memory bullets when a memory
       matched. The budget test asserts `stablePrefix.length +
       context.length <= PROMPT_SYSTEM_CHAR_BUDGET`.

    Acceptance: tests green. Live, on Track A's engine: run
    `scripts/bench/latency.ts` again, after replacing its typed replica
    of the volatile zone with the real assembly: `--layout=single-message`
    from `buildSystemPrompt()` and `--layout=reordered` from
    `buildPromptParts()`, each fed a synthetic actor and memory matches
    (so the bench can never drift from what production sends)
    and record the table. Then hold one four-turn conversation through
    the API on port 8797 and record, from the `llama-server` log, the
    `prompt_n` of turns two to four: each must be well under the full
    prompt size (the cached prefix plus history is not reprocessed).
    Confirm the replies are coherent (a mid-conversation system message
    must render correctly through Qwen3's chat template; if replies
    degrade, switch the context message's role to `user` with the same
    delimiter line and merge it into the final user message, and record
    which shape shipped). Re-run `scripts/bench/naturalness.ts` and
    `scripts/bench/routing.ts` against Track A's engine and embed URLs
    and record the rows before and after; no row may regress from
    natural to unnatural. Out of scope: rewriting any policy text
    (FAST-06), changing budgets (CHAT-12), the plugins-list
    free-association fix in the old backlog (closed by this item; tick
    it and point here). Checks: `cd backend && bun test
    tests/turnEngine.test.ts tests/persona.test.ts`, then the full exit
    gate. Landed 2026-09-12 at cf253297.

<a id="fast-04"></a>

- [x] **FAST-04: Literal patterns before the embed round trip, and a stream that starts before the first token** (M)

    Status (2026-09-12, measured and closed): pattern turns answer in 9
    to 17 ms with zero embed calls; the spoken cue lands at 906 to 910 ms
    on every turn whose first sentence takes longer, and stays silent on
    ordinary turns whose first sentence arrives at 736 to 769 ms; a
    tool-resolved websearch turn is `turn_meta`, the cue, then one `done`
    with the package reply intact. Table and readings in the Track A
    section of dev.md.

    Depends on: FAST-02. Files: `backend/src/lib/turnEngine.ts`,
    `routing.ts`, `backend/src/routes/turn.ts`, `spec/llm/ts/stubServer.ts`
    only if it cannot delay a scripted reply, and `backend/tests/turnEngine.test.ts`,
    `routing.test.ts`, `tier2.test.ts`. Mirror the existing
    `streamTurnEvents()` cue race and `runTurnStream()`'s tool-call peek.
    This is a bounded slice; CHAT-17's full event machine later replaces
    it and must keep the public events identical.

    Do, in this order:
    1. Split `route()` into `routeLiteral(text, candidates)` (household
       command match stays where it is; this is the `routing.patterns`
       wildcard match that `route()` already tries first) and
       `routeSemantic(text, actor, loaded, utteranceVector)` (everything
       else `route()` does today, including the keyword-overlap
       override). In `prepareTurn()`, call `routeLiteral` first; only
       when it returns null call `embedUtterance()` and then
       `routeSemantic`. A literal winner never embeds. Export a
       test-only counter `__embedCallCountForTests()` plus a reset from
       `routing.ts`, the same shape as `__resetLlmSupervisorForTests`.
    2. In `runTurnStream()`, stop awaiting `started.tokens.next()`
       before returning. Return `{ ok: true, kind: "stream", startedAt,
       ... }` immediately, with a generator that performs the peek
       itself: if the first step is done with tool calls, it runs
       `resolveToolCalls()` exactly as today and yields the finished
       reply's text as one delta, then finalizes; an all-failed batch
       runs today's tool-free retry through the same gates; otherwise
       it replays the first token into `gateOutputSafety()` and
       `gateGuards()` unchanged. Safety refusals, commands, and Tier 0
       and 1 winners still return `kind: "immediate"`.
    3. In `routes/turn.ts`, `streamTurnEvents()` starts the 900 ms cue
       timer from `startedAt` (the moment `prepareTurn()` began), not
       from its own first `.next()`, so the cue fires 900 ms after the
       utterance arrived when nothing has streamed yet, and never after
       a delta.
    4. Tests: a literal-pattern turn ("remember that I like tea") makes
       zero embed calls and still fires the package; a tools-offered
       turn whose scripted first token is delayed 1,200 ms yields
       `turn_meta`, then `spoken_cue`, then deltas (if the stub cannot
       delay a scripted reply, add an `await`-able return to
       `scriptedChatReply` in `stubServer.ts`, additive); a scripted
       tool-call turn yields `turn_meta` then exactly one `done` whose
       text is the package reply; the existing output-safety cut tests
       still pass unchanged.

    Acceptance: tests green. Live on port 8797: a websearch turn
    ("who won the 1998 world cup") shows `spoken_cue` in the NDJSON
    before the answer; an ordinary turn shows no cue when the first
    sentence arrives within 900 ms; `[turn]` log lines for a
    literal-pattern turn show no embed timing. Record three timings each
    for a pattern turn, an ordinary turn, and a tool turn. Out of scope:
    holding action-claim sentences (CHAT-17), the forced-lookup retry on
    the stream (CHAT-17), stage timings in metrics (CHAT-21). Checks:
    `cd backend && bun test tests/turnEngine.test.ts tests/routing.test.ts
    tests/tier2.test.ts`, then the full exit gate.

<a id="fast-05"></a>

- [x] **FAST-05: Let world knowledge through the guards (the CHAT-04 half that needs no outcomes)** (M)

    Status (2026-09-12, measured and closed): the bare-candidate scan and
    the hedge check are gone, location and attributed-quote claims fire
    only for household subjects, and `unrelated_recall` reads the
    question in its conversation. Live, "1945.", "Paris.", "Eight." and
    the watering answer all arrive uncut (the year was cut before);
    corpus 29 rows with the four probes and three household negatives;
    offline guards bench 23/29 to 21/29, the whole delta being the
    prescribed GUESSING_RE deletion (raised as a question). Details in
    the Track A section of dev.md. FAST-05b (2026-09-12, the answer to
    that question): the guess phrases are back, household-scoped (a
    possessive or roster name in the question, the last two turns, or
    the guessed clause, plus an ungrounded word in the guess); the
    sedan bench row flags again, bench 22/29.

    Depends on: FAST-04. Files: `backend/src/lib/guards.ts`,
    `spec/llm/guard-corpus.json`, `backend/tests/guards.test.ts`,
    `guardCorpus.test.ts`. Mirror the existing corpus row shape and the
    guard test naming. CHAT-04 keeps the other half (an action claim
    needs a typed outcome, which needs CHAT-15).

    Do, in this order:
    1. In `guardInvention()`, delete the bare-candidate loop (the
       `PROPER_NOUN_RE`, `DATE_WORD_RE`, and `BARE_NUMBER_RE` scan and
       `hyphenGroundedPieces()` if nothing else uses it) and the
       `GUESSING_RE` check (a hedge is what the information policy asks
       for, not an invention). Keep, unchanged: `PERSON_TRAIT_RE` with
       the unclaimed-words check, `CLAIMED_EXPERIENCE_RE`,
       `ATTRIBUTED_QUOTE_RE`, medication, `like_i_said`,
       `example_parrot`, `capability_claim`, `near_echo`.
    2. Narrow `LOCATION_CLAIM_RE` to household subjects: it fires only
       when the located subject is a roster name from the guard context
       or a second-person form ("you", "your"). "Paris is in France"
       passes; "Pippa is at soccer practice" with no memory does not.
    3. Fix `unrelated_recall` so a supplied memory that answers the
       question passes: "She likes painting." with the memory "Pippa
       likes painting" present and Pippa resolved is not unrelated.
       Read the function's own comment on what "unrelated" means before
       changing it; the flight-versus-dentist case must still flag.
    4. Corpus: add the four probes as pass rows exactly as written:
       "Got it, Pippa is allergic to peanuts." after that disclosure;
       "It is 4." to "what is two plus two"; "The capital is Paris." to
       "what is the capital of France"; "She likes painting." with that
       memory. Add fail rows: "Pippa is at soccer practice right now."
       with no memory; "Your brother said he'd be late." with no memory;
       "I've been to Paris myself." Retire every corpus row whose only
       basis is a bare number, capitalized word, or date; list the
       retired row ids and the replacement behavior in the track's
       dev.md section.
    5. Tests: one `guards.test.ts` test per probe, named for the
       promise ("general knowledge is not an invention"), plus the three
       new fail cases.

    Acceptance: tests and the corpus runner green. Live on port 8797:
    run `scripts/bench/conversation.ts` against Track A's engine and
    count guard hits from the `[turn]` log over its full script; then
    ask, through the API, "what's the capital of France", "how many legs
    does a spider have", and "what year did the second world war end",
    and record the replies and any guard reason. None of the three may
    be cut or replaced. Record before and after hit counts. Out of
    scope: action-claim matching against outcomes (CHAT-04), replacing
    the pooled canned lines (CHAT-04). Checks: `cd backend && bun test
    tests/guards.test.ts tests/guardCorpus.test.ts tests/turnEngine.test.ts`,
    then the full exit gate.

<a id="fast-03"></a>

- [x] **FAST-03: Package descriptions that a person would say, in the prompt and in confirm prompts** (S-M)

    Status (2026-09-12, measured and closed): all 32 bundled manifests
    carry one imperative sentence (catalog commits 9caebca and 2391831
    for the six mirrored ones), the confirm prompt lowercases only the
    first letter, and the tool-calling bench at 10 repeats matches the
    before run (every positive 10/10, 0/50 false calls) after two copy
    rewrites the bench forced. Details in the Track A section of dev.md.

    Depends on: FAST-02. Files: every `backend/packages/*/manifest.json`
    `description`, their catalog sources for mirrored packages (the
    `catalog_path` in `backend/packages/bundled-provenance.json`, in the
    sibling `catalog` checkout), `backend/src/lib/turnEngine.ts` (the
    confirm prompt), `backend/tests/plugins.test.ts`, `tier2.test.ts`.
    Read `docs/PACKAGES.md` in the org repo before writing copy.

    Rule for every description: one sentence, starts with an imperative
    verb, states what it does for the household, at most 120 characters,
    ends with a period, no dates, no parentheses, no internal notes, no
    platform branding (org trademark rules). Example: weather becomes
    "Get the current weather for a named place." The same sentence is the
    store-card copy, the native tool description, and the confirm prompt
    body.

    Do, in this order:
    1. For packages in `bundled-provenance.json`: edit the manifest in
       the catalog checkout, commit there with a message naming this
       item, then run `bun run refresh-bundled-packages` here so
       provenance records the new commit and hash. For packages not in
       provenance (Recall, Web Search, and any other authoritative one):
       edit here.
    2. The confirm prompt becomes `Do you want me to <description with
       the trailing period removed and the first letter lowercased>?`.
    3. Test: every bundled manifest's description matches
       `/^[A-Z][^()]{10,118}\.$/` and contains no four-digit year; the
       confirm prompt for a consequential package reads as one
       grammatical question.

    Acceptance: tests green; `scripts/bench/tool-calling.ts` against
    Track A's engine still reports zero false calls on its negatives and
    all positives selected; record the run. Out of scope: renaming
    packages, routing examples, catalog CI. Checks: `cd backend && bun
    test tests/plugins.test.ts tests/tier2.test.ts
    tests/bundledPackages.test.ts tests/bundledPackageHash.test.ts`,
    then the full exit gate, plus the catalog repo's own check script
    for its commit.

<a id="fast-06"></a>

- [x] **FAST-06: Variation from samplers, not from a prompt sentence** (S)

    Status (2026-09-12, measured and closed): min-p, XTC and DRY ride
    every plain chat completion (never a JSON-schema or caller-tempered
    one), the "never say the same thing the same way twice" sentence is
    out of the policy, naturalness is identical row for row before and
    after (two runs each), and persona-eval's new repeated-framing
    count went from 1/40 to 0/40. Table in the Track A section of dev.md.

    Depends on: FAST-05. Files: `spec/llm/ts/types.ts`,
    `backend/src/lib/llm.ts`, `persona.ts`, and `backend/tests/llm.test.ts`,
    `persona.test.ts`, `turnEngine.test.ts` where they quote the policy.

    Do, in this order:
    1. Add optional request fields, additive: `min_p`,
       `xtc_probability`, `xtc_threshold`, `dry_multiplier`, `dry_base`,
       `dry_allowed_length` (all numbers). Extend the wire test.
    2. In `llm.ts` define `CHAT_SAMPLING = { temperature: 0.7, min_p:
       0.05, xtc_probability: 0.5, xtc_threshold: 0.1, dry_multiplier:
       0.8, dry_base: 1.75, dry_allowed_length: 2 }` and send it from
       `complete()` and `startCompleteStream()` only when the caller
       passed no `response_format` and no `temperature`. A JSON-schema
       request never gets it.
    3. Remove the sentence beginning "Never say the same thing the same
       way twice" from `INFORMATION_HANDLING_POLICY` in `persona.ts`,
       and fix any test that quotes it.
    4. Test: a plain chat request carries all seven fields; a
       json_schema request carries none of them; a caller-supplied
       temperature wins.

    Acceptance: tests green. Live on Track A's engine: run
    `scripts/bench/naturalness.ts` and `scripts/bench/persona-eval.ts`
    before and after and record; no naturalness row may regress; the
    persona-eval "repeated framing" measure must not get worse. Out of
    scope: control vectors (an EVAL item below), persona prose
    rewrites. Checks: `cd backend && bun test tests/llm.test.ts
    tests/persona.test.ts tests/turnEngine.test.ts`, `cd spec && bun
    test`, then the full exit gate.

### Track B: the background

<a id="mem-01"></a>

- [x] **MEM-01: A background engine on its own process, shaped like the embed role** (M)

    Depends on: Step 0. Files: new `backend/src/lib/backgroundAssets.ts`,
    new `backend/src/lib/backgroundSupervisor.ts`, `backend/src/routes/host.ts`
    (one health field), `backend/src/wire.ts` (that field's type), new
    `backend/tests/backgroundSupervisor.test.ts`, and the privacy page
    under `docs/user/` ("what MaiPai downloads" gains one line). Mirror
    `embedAssets.ts` and `embedSupervisor.ts` line for line: pinned
    asset, no catalog entry, no household selection, URL tier, spawn
    tier, stub tier, `hotReloadState`, `watchEngine`, generation guard.
    Do not edit `llm.ts`, `llmSupervisor.ts`, or `modelCatalog.ts`
    (Track A owns them); import from them freely.

    Do, in this order:
    1. `backgroundAssets.ts`: constants `BACKGROUND_MODEL_FILE =
       "qwen3-1.7b-q8-0.gguf"`, URL
       `https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf`,
       sha256 `061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a`,
       bytes `1_834_426_016`; plus a fallback selected by
       `MAIPAI_BACKGROUND_MODEL=qwen3-4b`: file `qwen3-4b-q4-k-m.gguf`,
       URL `https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf`,
       sha256 `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`,
       bytes `2_497_280_256`. `ensureBackgroundModel()` uses the same
       download-and-verify helper `ensureEmbedModel()` uses. Both are
       Qwen's official GGUF repos at pinned revisions, the same
       provenance rule as the chat model's catalog entry.
    2. `backgroundSupervisor.ts`: tiers in order `MAIPAI_BACKGROUND_URL`,
       spawn (binary from `engineBinaryPath(hw)`), stub. Spawn args:
       `--model <path> --port <MAIPAI_BACKGROUND_PORT or 8789> --host
       127.0.0.1 -c 8192 -ngl <MAIPAI_BACKGROUND_GPU_LAYERS or 0> -t 4
       -fa on --reasoning off --jinja --no-webui --metrics --cache-reuse
       256`. CPU by default on purpose: the GPU stays with the chat
       model. Watch role `background`, label "the memory engine", title
       "MaiPai's memory engine stopped unexpectedly". Exports:
       `getBackgroundClient()`, `restartBackgroundBackend()`,
       `probeBackgroundEngine()`, `getBackgroundBackendKind()`,
       `getBackgroundLivePid()`, and `completeBackground(messages, opts:
       { temperature?, max_tokens?, response_format? })` returning the
       same `LlmOpResult` type `llm.ts` exports, always sending
       `chat_template_kwargs: { enable_thinking: false }`, mapping a
       transport failure to the same `unavailable` shape.
    3. Health: `GET /api/health` gains `background` beside `chat` and
       `embed`, from `probeBackgroundEngine()`.
    4. Tests, mirroring `embedSupervisor.test.ts`: URL tier spawns
       nothing; stub tier answers; restart bumps the generation and a
       stale in-flight start never repopulates the cache;
       `completeBackground` returns `unavailable` when the URL is dead.
       Asset test: the checksum constant is 64 hex characters and the
       fallback switch selects the other file.

    Acceptance: tests green. Live on the dev machine (Track B
    environment): the engine downloads once into the shared models
    directory, spawns, and one `completeBackground` call with the
    judge's extraction JSON schema returns valid JSON; record tokens per
    second from `timings`, the process RSS, and the download time. Out
    of scope: routing, any user-facing reply, catalog entries, the
    orphan-sweep exclusion (JOIN-02). Checks: `cd backend && bun test
    tests/backgroundSupervisor.test.ts tests/embedSupervisor.test.ts`,
    then the full exit gate.

<a id="mem-02"></a>

- [x] **MEM-02: Judge and summaries on the background engine, a judge that drains, and dedupe that asks the model only when unsure** (M)

    Depends on: MEM-01. Files: `backend/src/lib/memoryJudge.ts`,
    `conversationHistory.ts`, `scheduler.ts`, and `backend/tests/memoryJudge.test.ts`,
    `conversationHistory.test.ts`, `scheduler.test.ts`. Mirror the
    existing judge tests' stub wiring exactly.

    Do, in this order:
    1. Replace every `complete("chat", ...)` in `memoryJudge.ts`
       (extraction, dedupe, contradiction, profile rewrite) and in
       `conversationHistory.ts` (`maybeRefreshConversationSummary`,
       `summarizeBeforeDelete`) with `completeBackground(...)`. Replace
       the `getEngineStatus().kind === "stub"` skips in the summary
       paths with `getBackgroundBackendKind() === "stub"` (same reason:
       an echo stub must never write a summary).
    2. Drain: replace `MAX_TURNS_PER_RUN = 1` with a loop in
       `runJudgeBatch()` that keeps taking the oldest pending turn until
       none remain, `turnActiveWithin(JUDGE_IDLE_WINDOW_MS)` becomes
       true, 50 turns are processed, or 5 minutes elapse. Set
       `JUDGE_IDLE_WINDOW_MS` to 5,000 (the 20 s window existed because
       extraction shared the chat slot; it no longer does). Keep the
       per-fact idle re-check inside `judgeTurn()`.
    3. Dedupe band, in `judgeTurn()` before `decideDedupe()`: no
       candidates, or top cosine below 0.60, means ADD with no model
       call; top cosine at or above 0.92 means SUPERSEDE that record
       with the new text and `contradiction: false`, no model call;
       only 0.60 to 0.92 asks the model. Name the two constants.
    4. Export `judgeQueueStats(): { pending: number; oldestCreatedAt:
       string | null }` and log it at the end of every judge tick as
       `[memory.judge] processed=N pending=M oldest_age_s=K`.
    5. Update the `scheduler.ts` comment that still says
       `MAX_TURNS_PER_RUN` is 10.
    6. Tests: during a judge batch the chat stub receives zero requests
       and the background stub receives the extraction request; five
       seeded unjudged model turns are all judged by one
       `runJudgeBatch()` call; the loop stops after
       `markTurnStarted()` is called mid-batch and the remaining turns
       stay pending, not failed; a 0.95-cosine candidate supersedes
       with no model request; a 0.30-cosine candidate adds with no
       model request; a 0.75-cosine candidate asks the model.

    Acceptance: tests green. Live: with the background engine spawned,
    seed twenty synthetic model turns with persona-roster names through
    a small script under `scripts/bench/memory/` that sets
    `MAIPAI_DATA_DIR` to a fresh temp directory before any import and
    refuses to run without it, then record how long until
    `judgeQueueStats().pending` is zero and how many facts were written.
    Out of scope: which turn sources are eligible (CHAT-07), the
    ingestion service (CHAT-06), profile timing (CHAT-11). Checks: `cd
    backend && bun test tests/memoryJudge.test.ts
    tests/conversationHistory.test.ts tests/scheduler.test.ts`, then the
    full exit gate. Landed 2026-09-12 at 6fe46a36.

<a id="mem-03"></a>

- [x] **MEM-03: Store every turn verbatim as searchable episodes** (M)

    Depends on: MEM-01. Files: `backend/src/db/schema.ts`,
    `schema-version.ts`, a generated file under `migrations/`, new
    `backend/src/lib/episodes.ts`, `conversationHistory.ts`, `memory.ts`
    (`forget()`), `scheduler.ts` (the `memory.embedding_retry` handler),
    new `backend/tests/episodes.test.ts`, and the privacy page under
    `docs/user/` ("what MaiPai keeps" gains one line). Mirror
    `memoryEmbeddings`, `pendingEmbeddings`, `embedMemoryRecordSafely()`,
    and `drainPendingEmbeddings()`. Bun's bundled SQLite has FTS5 (verified
    2026-09-12: `bm25()` works in `bun:sqlite`).

    Do, in this order:
    1. Schema: table `episodes` with `id` (text primary key, the repo's
       id helper with prefix `ep`), `turn_id` referencing
       `conversation_turns.id`, `conversation_id`, `person_id`,
       `speaker` (`user` or `assistant`), `text`, `created_at`, `hlc`;
       indexes on `(person_id, created_at)` and `turn_id`. Tables
       `episode_embeddings` and `pending_episode_embeddings` mirroring
       the memory ones. Run `bun run db:generate`, then append to the
       generated SQL file: `CREATE VIRTUAL TABLE episodes_fts USING
       fts5(text, content='episodes', content_rowid='rowid');` and the
       three standard external-content triggers (after insert, after
       delete, after update on `episodes`). Bump
       `CURRENT_SCHEMA_VERSION` to 27 in the same commit.
    2. `episodes.ts`: `recordEpisodes(turn)` inserts one row per side
       (skip a `safety_refuse` turn entirely, skip an empty side) and
       queues both for embedding; `embedPendingEpisodes()` embeds up to
       32 queued rows per call with the raw text (no prefix, matching
       memory's current scheme) and removes them from the queue;
       `deleteEpisodesForTurns(turnIds)`; `deleteEpisodesForPerson(personId)`;
       `listEpisodes(actor, opts)` returning only the actor's own rows.
    3. Call sites: `logTurn()` calls `recordEpisodes` after the turn
       insert; `runRetention()`, `deleteConversationById()`,
       `batchDeleteConversations()`, and `clearConversations()` call
       `deleteEpisodesForTurns` for the turns they remove; `forget()`
       in `memory.ts` calls `deleteEpisodesForPerson`; the
       `memory.embedding_retry` handler also calls
       `embedPendingEpisodes()`.
    4. Tests: a model turn writes two episodes and two queue rows; a
       refused turn writes none; `SELECT ... FROM episodes_fts WHERE
       episodes_fts MATCH 'cilantro'` finds the user side after "I
       dislike cilantro"; `forget()` leaves zero rows for that person in
       `episodes` and zero matches in `episodes_fts`; deleting a
       conversation removes its episodes; `listEpisodes` for one person
       never returns another person's rows, including for an owner.

    Acceptance: tests green; `bash scripts/check.sh` passes the schema
    drift and migration steps; the privacy page line is present. Out
    of scope: retrieval ranking (MEM-04), export, UI. Checks: `cd
    backend && bun test tests/episodes.test.ts
    tests/conversationHistory.test.ts tests/memory.test.ts`, then the
    full exit gate.

<a id="mem-04"></a>

- [x] **MEM-04: Hybrid, time-aware recall over episodes, and a search route** (M)

    Depends on: MEM-03. Files: `backend/src/lib/episodes.ts`,
    `backend/src/routes/conversations.ts`, `backend/tests/episodes.test.ts`,
    `backend/scripts/bench/memory/fixture.ts` and `run.ts`. Mirror
    `recall()` and `similarByVector()` in `memory.ts` for the vector
    half, and any existing `@hono/zod-openapi` route in
    `routes/conversations.ts` for the route. `chrono-node` is already a
    dependency; use it, never a model, for dates.

    Do, in this order:
    1. `recallEpisodes(actor, query, queryVector, opts: { limit = 5,
       excludeConversationId?, now? })` returning `EpisodeMatch[]` of
       `{ episode, pairedText, score }` where `pairedText` is the other
       side of the same turn. Steps inside: parse the query with
       `chrono-node` against `now`; a date or range restricts
       `created_at` to it (a bare day means that whole day; "last week"
       means the seven days before the current week); lexical
       candidates from `episodes_fts` ranked by `bm25()`, the query
       reduced to quoted terms joined with OR, top 20; vector
       candidates by cosine over the actor's episode embeddings, top
       20; fuse with reciprocal rank (k = 60); drop episodes from the
       newest four turns of `excludeConversationId` (they are already
       in the window); keep one match per turn; return the top `limit`.
    2. `formatEpisodesForPrompt(matches, displayName, locale, now)`:
       header line `From earlier conversations (what was said, not
       necessarily true):`, then one line per match, `- Sep 5 (7 days
       ago), <displayName> said: "..."` or `- Sep 5 (7 days ago), you
       replied: "..."`, each quote cut at 200 characters at a word
       boundary, whole block capped at 600 characters. Not wired into
       the prompt here (JOIN-01).
    3. Route: `GET /api/conversations/search?q=&limit=` through
       `@hono/zod-openapi`, actor-scoped, returning turn id,
       conversation id, date, both texts, and score.
    4. Bench: add eight episode questions to
       `scripts/bench/memory/fixture.ts` (a recipe suggested a week ago,
       what was decided about a trip, what the assistant said about a
       named pet, which day a topic came up, one that must return
       nothing) and score them in `run.ts` by expected turn id.
    5. Tests, with a seeded fixture of three conversations spread over
       three weeks: "what recipe did you suggest last week" ranks the
       assistant episode from seven days ago first; "cilantro" matches
       with no vectors stored at all; "last week" excludes a
       three-week-old mention; the current conversation's newest four
       turns are excluded; another person's episodes never appear; the
       formatted block is at most 600 characters and labels sides
       correctly; the route returns 401 unauthenticated and only the
       actor's rows.

    Acceptance: tests green; the bench runs against the shared embed
    URL with a fresh `MAIPAI_DATA_DIR` and reports at least six of
    eight expected turns found; record the table. Out of scope:
    injecting into the prompt (JOIN-01), a reranker (EVAL-04), UI.
    Checks: `cd backend && bun test tests/episodes.test.ts` and the
    conversations route tests, then the full exit gate. Landed 2026-09-12 at da5209e1.

<a id="mem-05"></a>

- [x] **MEM-05: Prove the small judge, or fall back to the 4B pin** (S)
    Resolved as switch, 2026-09-13 (Jesse's decision), verified at the
    commit that carries this line: the household default background
    model is qwen3-4b-q4-k-m; the 1.7B stays behind
    `MAIPAI_BACKGROUND_MODEL=qwen3-1.7b`. Live use showed the 1.7B
    re-emitting its extraction prompt's few-shot examples as memories,
    attributing the hub's replies and world facts to the speaker, and
    saving a conversation's passing state instead of the durable fact,
    about one record in ten real. judge-eval (real scorer, n=2, this
    machine): 1.7B precision 66.7%, recall 100%, 3.19 s/turn; 4B
    precision 100%, recall 100%, 7.31 s/turn cold. On the seeded bench
    with the judge's prompt cache: 1.8 s per judged turn (218 s for 120
    turns) against the 1.7B's 1.2 s, and one echo drop per run against
    13 to 19. Numbers and the CHAT-15 three-run set in
    docs/dev/session-a.md "MEM-05".

    Status (2026-09-13, measured with the real scorer, left open): the
    1.7B (a5015c1's own number), the 4B, and the 8B baseline all now run
    through the repaired extraction scorer (judgeScore.ts, #87) rather
    than the old two-case pass/fail. 1.7B: precision 66.7%, recall 100%,
    retrieval 0/2, 2.59s/turn. 4B: precision 100%, recall 100%,
    retrieval 0/2, 7.005s/turn. 8B (baseline): precision 100%, recall
    100%, retrieval 1/2, 3.552s/turn. Rule outcome: switch to the 4B on
    n=2 (the 1.7B's precision misses the five-point band against the 8B
    baseline by 33.3 points; the 4B matches the baseline on both
    figures). Not applied: a two-case corpus is too small to move the
    household's default background model on, and the 4B costs 2.7x per
    judged turn - a recommendation is not a switch. Re-run on the
    baseline bench's disclosure rows once they exist (measure-first
    step 2), then Jesse decides. Table and reasoning in
    `docs/dev/session-b.md`.

    Depends on: MEM-02. Files: `backend/scripts/bench/judge-eval.ts`
    (read the background URL instead of the chat URL, since the judge
    now runs there), `docs/dev.md`. Find the 8B judge baseline numbers
    in `docs/dev/session-c.md` or the step 6 entry in `docs/dev.md`
    before running.

    Run the judge eval against the spawned background engine on the dev
    machine and record precision, recall, and seconds per turn beside
    the 8B baseline. Keep the 1.7B pin if recall is at least 85% of the
    baseline and precision is within five points; otherwise switch the
    default pin to the 4B fallback in `backgroundAssets.ts`, re-run, and
    record both. If neither passes, leave this open with the numbers
    and do not change the default. Out of scope: changing the
    extraction prompt (an EVAL item does that offline). Checks: the
    bench's own test, then the full exit gate.

### After both tracks merge

<a id="join-01"></a>

- [x] **JOIN-01: Recalled episodes reach the prompt and the guards** (S)

    Status (2026-09-13, measured and closed): episodes render after the
    memory block and ground the guards; live on main, "my dentist is on
    Thursday" in one conversation answered "when is my dentist
    appointment" in the next with "Thursday." from the episode alone (no
    memory record existed). Details in the join section of dev.md.

    Depends on: FAST-02 and MEM-04 merged. Files:
    `backend/src/lib/turnEngine.ts`, `backend/tests/turnEngine.test.ts`.
    In `prepareTurn()`, after `recall()`, call `recallEpisodes(actor,
    text, utteranceVector, { excludeConversationId: conversation.id })`
    and append `formatEpisodesForPrompt(...)` to the context message
    right after the memory block, inside the existing memory-section
    budget plus 600 characters. Add each recalled episode's text to the
    guard context's grounded sources the same way memory bullets are
    added. Test: "my dentist is on Thursday" said in conversation one
    and never judged, then a new conversation asking "when is my dentist
    appointment", yields a context message containing that episode line,
    and a reply "It's on Thursday." passes the guards. Live on `main`:
    the same exchange through the API, recorded. Checks: `cd backend &&
    bun test tests/turnEngine.test.ts`, then the full exit gate.

<a id="join-02"></a>

- [x] **JOIN-02: The orphan sweep leaves the background engine alone** (S)

    Status (2026-09-13, closed): index.ts passes getBackgroundLivePid()
    into the boot-time sweep; a real spawned process registered as the
    background backend survives the sweep with its pid and dies without
    it (llmSupervisor.test.ts).

    Depends on: MEM-01 merged. Files: `backend/src/lib/llmSupervisor.ts`.
    Add `getBackgroundLivePid()` to the same exclusion the sweep already
    applies for `getEmbedLivePid()`. Test: mirror the existing embed
    exclusion test. Checks: `cd backend && bun test
    tests/llmSupervisor.test.ts`, then the full exit gate.

### Scheduled after Track A merges: the model comparison

<a id="eval-01"></a>

- [ ] **EVAL-01: Qwen3.5-4B against the current Qwen3-8B, measured, with a keep-or-drop verdict** (S-M)

    Status (2026-09-13): not tested, no official artifact. Qwen
    publishes `Qwen/Qwen3.5-4B` (transformers format) but no
    `Qwen/Qwen3.5-4B-GGUF` or equivalent official GGUF conversion -
    every GGUF found (unsloth, bartowski, lmstudio-community,
    prithivMLmods, mlx-community's MLX format) is a third-party quant,
    which the item's own instructions rule out substituting. No engine
    was spawned, no catalog entry added, no bench run. Re-check when
    Qwen ships an official GGUF for this model; nothing else in this
    item changes until then.

    Depends on: FAST-01 through FAST-06 merged to `main` (the fixed
    prompt, cache, guards, and samplers are the baseline; a comparison
    before them measures the broken prompt, not the models). Runs as its
    own session, read-only against engine URLs; it changes no product
    behavior. Files: `backend/src/lib/modelCatalog.ts` (one new catalog
    entry for the candidate, pinned the way the 8B entry is: Qwen's
    official GGUF repo, a fixed revision in the URL, the file's LFS
    sha256, the byte count, `implemented: true`, `quality_tier`
    "standard", no `recommended` tag), `docs/dev.md`, `docs/BACKLOG.md`,
    and a bench only if it needs a URL flag it lacks. Read CHAT-24 first;
    this item is CHAT-24's model condition run early, under CHAT-24's
    own rules for what counts as a promotion recommendation.

    Why it is worth running at all, stated so the verdict is honest: a
    same-generation 8B normally beats a 4B on knowledge, instruction
    following, and honesty (the bot measured 79% against 95% on honesty
    traps one size down). The candidate is a newer training run, the
    chat model's job here is narrow (phrase pre-fetched facts, pick a
    tool, hold a persona), and on the hub's 8 GB card a 4B halves
    prefill and decode. The default outcome is "keep the 8B"; the
    candidate has to earn a change on the numbers below.

    Do, in this order:
    1. Add the catalog entry. Use Q4_K_M. If Qwen publishes no official
       GGUF for the candidate at the time, record "not tested: no
       official artifact" in dev.md and stop; do not substitute a
       third-party quant.
    2. Spawn the candidate with the same engine build and the same
       launch flags the 8B gets (the override environment from the Track
       A setup with `MAIPAI_CHAT_MODEL_ID` set to the new entry,
       `MAIPAI_LLAMA_SERVER_PORT=8808`), and the 8B the same way on
       8798. Both warm, both with `--cache-reuse 256`, nothing else
       running on the machine's GPU.
    3. Run, against each engine in turn, with identical inputs and
       seeds: `scripts/bench/latency.ts` (30 turns; first-delta p50 and
       p95, total p50, cache ratio), `scripts/bench/tool-calling.ts`
       (false calls on the negatives, positives selected),
       `scripts/bench/conversation.ts` (guard hits over its script),
       `scripts/bench/naturalness.ts` (rows natural, ambiguous,
       unnatural), `scripts/bench/persona-eval.ts` (register
       consistency per companion), and the guard corpus's four
       world-knowledge probes plus the three household negatives asked
       live. Add one thinking-mode trial: five hard questions with
       `thinking: true` on each model, total time and whether the
       answer is right.
    4. Record one table in dev.md with both columns side by side, the
       engine build, both model files and checksums, and the machine.

    Verdict rule (from CHAT-24, not softened): the candidate qualifies
    for a promotion recommendation only if it holds every correctness
    floor (zero false tool calls, every positive selected, guard hits
    not higher, no naturalness row worse, register consistency not
    lower for any companion, all four probes answered without a cut,
    all three household negatives still caught) AND either first-delta
    p95 improves by at least 15% or total p50 by at least 20%. Otherwise
    the verdict is "keep the 8B", recorded with the numbers, and the
    question is closed until a new model generation appears. A
    recommendation is not a switch: changing the default chat model, a
    hub deploy, or a download on the hub is the owner's explicit call.
    Out of scope: control vectors (EVAL-03), a draft model (EVAL-02),
    the background engine's model (MEM-05 owns it), any prompt change.
    Checks: the benches' own tests, then the full exit gate for the
    catalog entry.

### The block after this one (not scheduled; each needs its design note in dev.md first)

- [ ] **TURN-01: One resolved turn context shared by routing, recall, and tool arguments** (M, after CHAT-10 and CHAT-13). Referent, options the assistant just listed, unresolved question, pending choice; every turn re-routes including follow-ups; a background-model rewrite only when a tool or retrieval will run, 1 s timeout, raw-text fallback, `replaces_previous` flag cancels an in-flight tool; clarify only on a top-two tie or a costly action, else best guess plus a one-clause hedge. Borrow the bot's subject tracker (three turns, wrong subject worse than none).
- [ ] **INVEST-01: A bounded investigation mode inside the turn engine** (M-L; design note: dev.md "Decision 10, revised").

    <a id="invest-01"></a>

    Depends on: CHAT-15 (typed outcomes), CHAT-16 (native tool-result
    messages and the shared composer), CHAT-17 (the streaming state
    machine), JOIN-01 (episode recall in the prompt), THINK-01 for the
    compose-step thinking gate (may land after, with the gate off).
    Files: `backend/src/lib/turnEngine.ts` and the CHAT-17 machine,
    `turnContext.ts`, `llm.ts`, `spec/llm/ts/types.ts` only if an
    observation field is missing from the tool-result message shape,
    `backend/src/routes/turn.ts` (progress text through the existing
    cue event, additive), `backend/tests/tier2.test.ts`,
    `turnEngine.test.ts`, `spec/llm/tool-call-corpus.json`. Mirror
    CHAT-16's decision table and CHAT-17's phases; add a phase, do not
    add a second machine. Read the dev.md design note first; its limits
    are the constants here, named and tested, changed only with a
    measurement.

    Do, in this order:
    1. Observation shape: from each `ToolExecutionOutcome`, build the
       tool-result message content as `{ source, as_of, status:
       found|missing|error, facts }` where `facts` is the result's
       `data` plus `synthesis_hint`, bounded by CHAT-12's budget. Nothing
       from a result enters a system message.
    2. The loop: after a round executes, if the round contained no
       consequential proposal and the round budget is not spent, run one
       more decision completion with the observations appended as tool
       results and the same pre-filtered read-only tool list (plus
       always-offer). Constants: `INVESTIGATION_MAX_ROUNDS = 2`,
       `INVESTIGATION_MAX_CALLS = 4`, `INVESTIGATION_DEADLINE_MS` of
       12,000 for voice surfaces and 25,000 for `chat`. Calls within a
       round run concurrently as today. A consequential proposal at any
       point ends the loop and goes to the existing confirmation; nothing
       else from that batch executes.
    3. Exhaustion: when any budget is hit, compose from what is
       supported and name what stayed unresolved in one plain sentence.
       Never a third round, never a repeated call.
    4. Progress: when a round's execution passes the cue threshold, the
       cue text is derived from the executing tool's user-facing
       description (FAST-03's sentence), for example "Checking Saturday's
       hours." Reuse the `spoken_cue` event; add no new event type.
    5. Thinking at compose: if THINK-01 exists, enable thinking for the
       compose completion when observations conflict (two facts with the
       same subject and different values) or there are three or more
       observations; otherwise leave it off.
    6. Tests, with scripted tool calls keyed on whether the request
       already carries tool-result messages: the museum scenario (round
       one: episode recall returns last week's constraints, the venue
       tool returns hours plus "Saturday sold out"; the scripted second
       decision asks for Sunday; round two returns it; the composed
       answer names the conflict and recommends Sunday); a budget test
       (a scripted model that keeps asking for more gets exactly two
       rounds and four calls, then an answer that names the unresolved
       part); a consequential test (a "book it" proposal in round two
       produces the confirmation and executes nothing); a control test
       (a greeting takes one completion and zero tool calls, a timer
       takes zero completions); a deadline test using the existing
       timing hooks, no real sleeps. Add the scenario rows to the
       tool-call corpus.

    Acceptance: all six tests green, both transports; live on the dev
    machine, the museum question asked with seeded episodes and a
    stubbed venue tool produces the conflict-aware recommendation with
    the progress line spoken, and its total time recorded against the
    deadline. Out of scope: worker models, a planner completion ahead
    of ordinary turns, writes inside the loop, a readability extractor
    for web pages (its own S item once websearch returns structured
    data), memory-first ordering of lookups (folded into the
    pre-filtered tool order, not a separate mechanism). Checks: the
    named suites, then the full exit gate.
- [ ] **VOICE-01: Interruption as a chat gate** (M). Natural spoken filler only when a tool or lookup is predicted over about a second; barge-in cancels inference and reconciles the logged reply with what was heard; a text-based end-of-turn detector on CPU unless a semantic model measures under 150 ms there; first spoken chunk gate lowered from 90 characters after FAST-04's numbers are in.
- [x] **ROUTE-01: The bot's shape guard and routing trace** (S). A question or first-person statement no deterministic tier can place goes to conversation, never to a plugin; log tier, winner, runner-up, and margin per decision; offer the top three tools without a similarity floor and re-measure false calls. Status (2026-09-13, closed): no floor, the clause-aware shape guard, one `[route]` line per decision; routed pass 0/50 false calls, #77's phrasings 10/10 on `remember` through the model path; the compound-request shortfall is #83; the cost is a prefix-cache miss on every tool-set switch, about half a second to a second of time to first token on a command-shaped turn after a question (measured in docs/dev/session-a.md), ROUTE-02's problem.
- [x] **ROUTE-02: A stable ordinary tool set** (S). Status (2026-09-13): implementation complete; switching-latency acceptance outstanding (accepted exception, coordinator ruling 2026-09-13). Ordinary set = always-offer plus the N=2 most used by Tier 2 wins (measured bound: N=3 loses a compound request's second call 3 of 10, N=5 all 10), the warm-up carries the block, greetings and bare statements ride it; the routed bench acceptance is met (0/50 false calls, the #77 rows 10/10). The latency acceptance is not: questions and greetings 300 to 700 ms faster to first token and question-after-command 100 to 250 ms faster, but command-after-question about 800 ms slower in two of three pairs, measured under 4.2 GB of swap (docs/dev/session-a.md); ROUTE-03 carries the re-measure. The offered tool list is byte-identical across ordinary turns (always-offer plus the N most used packages from `routingStats()`, N=2 by measurement, a fixed default on an empty household, sorted by id, computed at boot and on install changes), a command-shaped turn appends only the extras the set lacks, and a turn with no imperative signal (a greeting, "thanks", "okay") is conversation. Files: `backend/src/lib/turnEngine.ts` (`selectOfferedTools`, a new `ordinaryToolSet`), `backend/src/lib/routing.ts` (`utteranceShape`), tests in `tests/tier2.test.ts` and `tests/routing.test.ts`. Design in docs/dev/session-a.md. Acceptance: ROUTE-01's eight-turn TTFT sequence with the set-switch turns within 100 ms of aaaf724, the routed tool-calling pass still 0/50 and 10/10 on the #77 rows; if command extras still cost, record the number and stop, never raise N to pass. Out of scope: tool description length, the chat template, `--cache-reuse`. Exit: `bash scripts/check.sh`.
- [ ] **ROUTE-03: The set-switch latency, measured on a quiet box, and its mechanism** (S). ROUTE-02's command-after-question turn started 1759 to 1890 ms against 1028 to 2132 ms before it, with the rendered tool order verified correct (base first, extras after) and the box under 4.2 GB of swap; by the prefix arithmetic two appended extras after a cached three-tool block should cost less than the four re-evaluated tools before. Re-run ROUTE-01's eight-turn sequence interleaved (ceb354d against main) on a box with no swap in use and the household engines alone, record time to first delta per turn with the swap figure, and find the mechanism if the cost stays (llama-server's slot log for the prompt tokens reused per request is the first place to look). Files: the sequence in docs/dev/session-a.md, `backend/src/lib/turnEngine.ts` (`selectOfferedTools`). Acceptance: the set-switch turns within 100 ms of ceb354d, or the mechanism named with a number and a follow-up sized. Out of scope: raising N, restoring the floor, the template. Exit: the recorded table.
- [ ] **THINK-01: A deterministic thinking gate** (S-M, after FAST-01 numbers). Multi-clause, "why", "how would", "compare", explicit "think about it", or a failed first pass turn `enable_thinking` on with a token budget; measured against always-off on the CHAT-23 corpus.
- [x] **EVAL-01** is now a scheduled item with its own work order above.
- [ ] **EVAL-02: Speculative decoding with a 0.6B same-family draft** (S). `-md` on the hub's actual GPU; keep only if p50 total time improves at least 20% with no quality change.
- [ ] **EVAL-03: Control vector for register** (S-M). Retrain from the selected companion's own examples; replaces `NATURALNESS_POLICY` only if the naturalness bench holds and prompt tokens fall.
- [ ] **EVAL-04: A reranker over hybrid episode recall** (S). Only where MEM-04's bench shows misses; latency budget 100 ms on the background engine.
- [ ] **EVAL-05: Offline prompt optimization for tool descriptions and the extraction prompt** (M). A development-only tool (GEPA-style) over held-out conversations; ships fixed reviewed text; never runs in a household turn.
- [ ] **EVAL-06: XState against the hand-written turn machine** (S, inside CHAT-17). Compare on cancellation propagation, deadlines, exactly-once execution; adopt only if the hand-written version cannot state those invariants as tests.
- [ ] **TALK-01: A fine-tuned quick-reply model for the user-facing answer (Talker/Reasoner)** (L). Research item: needs training data and a loop; not before the household has a stable corpus.

## The 2026-09-05 audit: where the gaps actually are

Historical snapshot from 2026-09-05, not current implementation status.
The 2026-09-07 review and work orders are under Chat system optimization.

Jesse asked for an audit of goals, plans and code against what has been
built, with online research and a comparison against the legacy repos,
focused on three worries: the UI, portability and integration with the
robot, and intelligent, personified, memory- and data-driven chat. Five
read-only passes fed the sections below (backend, frontend, plan versus
built, legacy versus rebuild, the state of the art online); only their
conclusions are recorded here. Four findings rank above everything else
in this file:

1. **Chat is stateless.** The model is sent the system prompt and the
   current message only; the previous exchange is never in the prompt
   (`turnEngine.ts` sends `[system, user]` and says so in its own
   trailer). "And tomorrow?" has no referent. Nothing else here matters
   as much to how the hub feels to use.
2. **The prompt does not know who is talking.** No name, role, age band,
   locale or local time reaches the model, and recall is unscoped, so a
   parent's chat is fed a child's person-scoped memories. "Personified"
   today is a style fragment with no identity behind it.
3. **Memory is written only when someone says "remember", and recalled
   by keyword overlap** while a real embedding engine is already running,
   unused. There is no judge, no profile paragraph, no clock stamp on a
   memory record, and forget is a hard DELETE that a robot replica would
   push back on reconnect.
4. **Every page is hand-written React and the nav is hardcoded.** The UI
   schema in `spec/ui/` renders nothing, the five kit primitives built
   for the first app have no schema nodes, and there is no input-mode
   detection, so TV is undefined rather than unstyled. Neither Go nor the
   robot's standalone shell could render any page that exists today.

"Chat, memory and persona", "Portability and the link" and "Legacy: copy,
re-examine, record" are new sections; UI / shell, Settings and
Cross-cutting grew. Existing items were corrected where the audit found
them wrong (the `embed` role is built and unwired, not missing).

## Naming: rename `skill` to `plugin`, add real `skill` and `command`

Decided 2026-09-05 (full research and reasoning in `docs/dev.md`'s
"Naming: skill, plugin, command, connector" entry). The rename itself is
done; the other two items are still real, tracked work.

- [x] **Rename the `skill` manifest kind to `plugin`** (M-L, done
      2026-09-05, `docs/dev.md`'s "The skill -> plugin rename, executed"
      entry) - no behavior change to `weather`/`joke`/`trivia`/`define`/
      `remember`/`recall`, just the correct name for what they already
      are. Included a real data migration for `conversation_turns` rows
      with genuine data from tonight's live testing, not just a schema
      change. Still open: `getmaipai/.github/docs/PACKAGES.md` (org-wide,
      affects `bot` and `catalog` too) and the planned `catalog` repo
      layout haven't been updated to match yet - a separate repo's commit,
      tracked here so it isn't forgotten.
- [x] **Add a real `skill` kind: plain instructions, Claude-`SKILL.md`-
      compatible, no independent permissions** (M, done 2026-09-05,
      `docs/dev.md`'s "The real skill kind, shipped" entry) - composed
      into the chat model's system prompt when relevant (reusing the
      plugin floor's own `exampleScore` relevance matching, never
      executed on its own), safely user-authorable since it can't touch
      the network or any permission surface. Ships with a real bundled
      example (`storytime-style`) proving genuine Claude-format
      compatibility - real YAML frontmatter, stripped before composition,
      tested. Live-testing it found a real, honest cross-package routing
      collision (a bedtime-story request hijacked by the `joke` plugin's
      own keyword-overlap placeholder) - concrete evidence for the
      already-tracked `embed` role below, not something patched here.
- [x] **Formalize `command` as a first-class, user-creatable primitive**
      (M, done 2026-09-05, `docs/dev.md`'s "The `command` primitive,
      shipped" entry) - reuses `matchPattern` (`turnEngine.ts`) exactly
      as-is, checked before the plugin floor since a household's own
      trigger always wins. Two action shapes (`reply`,
      `home_call_service`, the latter reusing plugin's own
      `home.call_service` plumbing via a new shared `packageHost.ts`
      export). Security-domain commands (lock/alarm/cover/garage/valve)
      require an owner/admin creator and a `min_role` floor of `adult`,
      checked once at creation rather than re-derived per trigger. HTTP
      surface only so far - no authoring UI yet, tracked below.
- [x] **No new "connector" concept needed** - `integration` (an
      existing manifest kind) already is one. Nothing to build here;
      recorded so the question doesn't get re-asked.
- [ ] **A settings UI for authoring commands** (S-M) - `lib/commands.ts`
      and its `/api/commands` routes are done and tested; there's no
      household-facing "when I say X, do Y" builder yet, only the raw
      HTTP surface.

## Skill standards (definition of done)

Jesse's call (2026-09-05): this should rank alongside, not after, building
more skills - a standard nobody's held to gets more expensive to retrofit
the more packages exist, not cheaper. `getmaipai/.github/docs/PACKAGES.md`
already defines a real bar for every package (skills included); checked
against what the 6 bundled skills actually have today, none of them
clear it in full:

- [x] **A real `quality_scale.yaml` per package** (S per package) -
      session-d-packages-and-store.md step 1, 2026-09-06: done for the 5
      packages D owns (define, joke, trivia, weather, storytime-style),
      each stating bronze/silver/gold against docs/PACKAGES.md's real
      criteria, checked by `spec/tests/ts/package-bronze.test.ts`.
      `remember`/`recall` are C's (session-d's ownership map); still
      open for those two.
- [x] **A `smoke` entry per package** (S-M per package, M to design the
      mechanism once) - session-d step 1, 2026-09-06: the mechanism is
      built (`lib/smoke.ts`: a `recipe_fixture` check against a
      `HostEmulator`-run recipe for a Tier 0 plugin, a `static` load
      check for a `skill`, `deno_test` reserved for Tier 1/step 5),
      wired to a daily core job and a boot-time pass (standing in for
      "at install" until the store's real install flow exists, step 6),
      and a failure disables the package and raises an issue
      (`lib/issues.ts`, a local stub until F's real one merges). Declared
      for D's 5 packages; `remember`/`recall` still need their own
      (C's). A package with no `smoke` entry is treated as "not yet
      bronze," never disabled - this session's infrastructure must not
      reach across ownership lines to break a package it doesn't own.
- [x] **A user-tier `README.md` and `CHANGELOG.md` per package** (S per
      package) - session-d step 1, 2026-09-06: done for D's 5 packages;
      `remember`/`recall` still open (C's).
- [ ] **Real i18n for skills** (L) - genuinely undecided, not just
      unbuilt: no `getmaipai/.github` standard mentions i18n at all today,
      so this needs a design decision before any code. At minimum:
      `manifest.json`'s `display`/`description` and a recipe's `format`
      step text are hardcoded English strings today, and `routing.
      examples`/`routing.patterns` (the deterministic floor's whole
      matching mechanism) would need real per-locale variants for
      anything beyond English to route at all - not a small addition
      once the `embed` role and Tier 2 both eventually depend on
      matching against those same examples.
- [x] **i18n scaffolding for the shell, kit, and core pages, done**
      (session E step 8, 2026-09-06) - a narrower, more tractable slice
      of the item above (package/skill strings stay that item's own
      problem). Decided by the design-resolver agent against
      `getmaipai/.github/docs/ENGINEERING.md`'s real "Language and
      locale" rule ("UI strings live in a per-package message catalog;
      English is required") and the real, already-existing
      `household.locale` setting (`backend/src/settings/coreKeys.ts`,
      `range.options: ["en-US", "en-GB"]`) - the resolved
      `purring-chasing-noodle.md` ("plan 6.7") seed document is
      confirmed gone from every getmaipai repo, so the decision is
      grounded in what is actually real and checked in, not a document
      that no longer exists anywhere.

      **Library: Lingui** (`@lingui/core`, `@lingui/react`,
      `@lingui/cli`, `@lingui/vite-plugin`, all `6.6.0`), catalogs as
      `.po` files under `frontend/src/locales/<locale>/messages.po`,
      loaded eagerly (two small catalogs, no lazy-loading complexity
      worth adding yet) and activated from `household.locale` once
      settings load (`App.tsx`, `frontend/src/i18n.ts`) - the pre-auth
      SignIn screen has no household to read a preference from yet, so
      it stays on the source locale (`en-US`) by design, not a gap.

      **The macro transform (`<Trans>`/`t` from `@lingui/react/macro`/
      `@lingui/core/macro`) does not work in this repo and is not
      used** - a real toolchain incompatibility found live, not a design
      choice: Lingui's own documented Vite+React setup wires the macro
      through `@vitejs/plugin-react`'s `babel.plugins` option, but the
      version installed here (`@vitejs/plugin-react@6.1.1`) dropped
      Babel entirely for its own JSX transform (`oxc-transform-react`
      now) and its `Options` type has no `babel` property at all -
      passing it anyway silently did nothing. Every macro call then fell
      through to the macro package's own runtime guard, which throws
      ("executed outside the context of compilation") the instant React
      renders one - this broke the ENTIRE app (a blank page, 0 headings,
      a real `pageerror`) since the affected component was `Shell.tsx`'s
      nav rail, present on every signed-in route. Not caught by
      `bunx tsc --noEmit` (no type error - the option is accepted,
      just silently ignored) or by the first several `bun run a11y`
      passes (their own output was piped through `tail -N`, which
      truncated away the actual per-route failures and left only a
      misleadingly clean-looking tail); caught by grepping the built
      bundle directly for known UI strings ("Chat", "Settings",
      "Household") and finding every single one absent despite the
      bundle containing real React runtime code, then confirmed with a
      direct Playwright check showing the exact runtime error. Fixed by
      dropping macros and using Lingui's plain runtime API instead -
      `<Trans id="..." message="..." />` from the real `@lingui/react`
      (not `/macro`) for JSX, `i18n._("...")` from `@/i18n` for the one
      non-JSX (tooltip) case - which needs no Babel pass at all;
      `lingui extract` finds both forms equally well (marked
      `js-lingui-explicit-id` in the generated catalogs). Re-enabling
      macros later needs either a Babel-based React plugin variant or
      `@lingui/swc-plugin`, neither installed now.

      **Extracted a small, real, working slice**, not a full sweep:
      `Shell.tsx`'s "Search" nav row and `HomePage.tsx`'s "Today"
      heading, both real, both loadable in both catalogs, proving the
      whole pipeline (extraction, catalog loading, `household.locale`
      selection) end to end. A full sweep of every hardcoded string in
      `frontend/src` is tracked below as its own item - doing it in the
      same step as standing up the whole system for the first time would
      conflate "does the plumbing work" with "is every string moved."
      **Deferred, documented, not built**: the far surface's type scale
      per script (`.surface-far` in `tokens.css` stays Latin-only,
      commented as such) - `household.locale`'s own option list is
      Latin-script-only today, so there is no non-Latin locale to verify
      a script-specific scale against, and this org's testing standard
      ("verified means exercised for real") rules out building something
      unverifiable.
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
- [x] **Real code-splitting for the frontend shell chunk** (M) - found
      at Session E's own step 10 wrap-up merge (2026-09-06): the main
      chunk crossed the PWA plugin's default 2 MiB precache ceiling once
      everything Wave 2 merged in landed together (real growth, not a
      broken build - `vite build`'s own "chunks larger than 500 kB"
      warning had already been firing for a while before this). Worked
      around for now by raising `workbox.
      maximumFileSizeToCacheInBytes` to 5 MiB in `vite.config.ts` so the
      app-shell service worker keeps precaching the real shell in full,
      rather than silently dropping it from the one cache it exists to
      populate - not a fix for the underlying size. `vite build`'s own
      suggestion (`dynamic import()`, `rolldownOptions.output.
      codeSplitting`) is the real fix, unexplored so far.

      **Status, done 2026-09-13 (lane 10 item 2)**: route-level
      `React.lazy()` (`App.tsx`'s `lazyNamed()`) for every app but Home
      and Chat (docs/dev/session-b.md, "Lane 10 item 2," has the reasoning
      for keeping those two eager). Entry chunk 2,103.55 kB → 1,891.89 kB
      raw (485.76 kB → 429.02 kB gzip), 1 JS chunk → 39 (Rolldown's own
      automatic vendor splitting, not just this step's 15 route
      boundaries). That's back under Workbox's default 2 MiB ceiling with
      about 205 KB (9.8%) to spare, so the `maximumFileSizeToCacheInBytes`
      override is removed entirely rather than lowered to some other
      number. `RouteSkeleton` (new, `kit/primitives/`) is the Suspense
      fallback; a real in-app navigation never shows it at all
      (react-router-dom's `Link` wraps navigation in `startTransition`,
      which keeps the previous page live rather than flash a loader), but
      a fresh load straight at a lazy route's own URL does, screenshotted
      and opened (`docs/assets/screens/lazy-route-skeleton.png`).

Default packages are held to the same bar as community ones per
`PACKAGES.md` - the release skill is meant to refuse shipping a default
set with anything below bronze, which today it structurally can't check
(there's no `quality_scale.yaml`/smoke mechanism for it to look at).

## Skills (Tier 0 catalog)

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

- [x] Web search (S-M) - shipped 2026-09-06 (`ff8585e`): `websearch`
      package + SearXNG integration (`backend/src/lib/packageHost.ts`),
      offered via Tier 1 routing and Tier 2 native tool-calling in
      `turnEngine.ts`. Verified 2026-09-06 against Jesse's real SearXNG
      instance - found and fixed a silent-failure bug (a URL behind SSO
      returned its login page, read as a normal empty result) and a
      missing-infobox gap (a direct-topic query like "Japan" answers via
      SearXNG's `infoboxes`, not `results`); also needed homelab-side
      fixes (svc_guard allowlist, JSON output format, bot-detection
      passlist, a dead IPv6 route, an engine-list prune to engines that
      don't block a self-hosted instance) - see
      `~/Developer/gitea/homelab`'s `docs/services/searxng.md`. Also found
      (2026-09-07) an 18-month-stale SearXNG install answers real JSON but
      returns zero results once its scraping-based engines' parsers drift
      from the real sites - `lib/searxngHealth.ts` now checks hourly and
      raises a Repairs issue for that, an unreachable/invalid URL, or a
      non-JSON response, so the household finds out instead of concluding
      "search doesn't work." Live-found and fixed 2026-09-07 (Jesse, same
      day as Fix E): `websearch` was still never OFFERED at all for a
      natural question phrasing ("what's the latest stephen king novel,"
      0.66 against the 0.68 Tier 2 offering floor) even after broadening
      its own `routing.examples` - fixed by adding
      `routing.always_offer: true` to its manifest (`manifest.schema.json`'s
      new field, `turnEngine.ts`'s `prepareTurn()` reads it): a genuinely
      open-ended fallback package is now offered on every turn regardless
      of its own embedding score, sound specifically because Fix E folded
      offering into the one completion that answers the turn either way
      (no separate round trip cost to avoid anymore). Verified live end to
      end against the real household chat, including the real
      `search.searxng_url` config actually answering ("The latest Stephen
      King novel is..."). A separate, unrelated bug found and fixed the
      same session while investigating this: a CUTTABLE guard cut after
      the streaming clause-chunker's own early comma-flush could leave a
      reply ending mid-sentence with a bare comma - `closeDanglingClause()`
      (`turnEngine.ts`) closes it into a real sentence, scoped to exactly
      that cause (a real guard cut happened this turn). Full writeup in
      `docs/dev.md`.
- [x] **near_echo false-flagged plain greetings** - self-found while
      wrapping up the websearch/comma fixes above, 2026-09-07, pre-
      existing (confirmed via `git stash` against `a7df33c`, unrelated to
      either fix): a plain "good morning" got `near_echo`-guarded into "I
      don't know, sorry." `guardNearEcho()` (`guards.ts`) now exempts a
      reply that's a bare greeting reciprocation (`Good morning!` or
      `Hi there!`) when the utterance carries a greeting anywhere in it -
      echoing a greeting back is the correct answer, not a stall. Caught
      and fixed in two passes: the first cut anchored the exemption to the
      whole utterance being nothing but the greeting, which a code review
      found still missed the everyday compound case ("good morning, how
      are you" -> `Good morning!`); the reply's own bare reciprocation is
      the real signal, not the utterance's total content. The ps5 bench
      case it was ported to protect stays caught, including inside a
      greeting-carrying utterance ("good morning, I play it on the ps5" ->
      "Okay, playing it on the ps5."). Full writeup in `docs/dev.md`.
- [x] Music / media search (S-M) - the film/TV half done 2026-09-13:
      `media-lookup` (catalog `plugins/info/media-lookup`, bundled),
      keyless (Wikidata for director/cast/runtime/rating/year, Wikipedia
      for the synopsis), 8 routing examples, tests against recorded
      fixtures for two films and one TV show, a typed `not_found`
      (#92's shape), live-checked ("what's the runtime of Cobra" ->
      "Cobra (1986), directed by George P. Cosmatos, 83 minutes.").
      Step 1 of `docs/plans/media-conversation-program-2026-09-13.md`;
      CHAT-13/CHAT-15/CHAT-16 there still own routing a resolved
      subject to it and composing its reply in the companion's voice.
      "What's this song" (music identification) is a different, harder
      problem (audio fingerprinting, not a text lookup) - not
      attempted here, split back out as its own item below if wanted.
      A pure lookup against a metadata API - explicitly NOT the same
      skill as playing anything (see Priority 3 below); this is the
      half of "media" that's cheap, safe, and useful standalone.
- [x] Unit and currency conversion (S) - shipped as the bundled
      `convert` (a recipe) and `currency` (a handler) packages; ticked
      2026-09-15 on a backlog read.
- [x] Math / quick calculation (S) - shipped as the bundled `math`
      recipe package; ticked 2026-09-15 on a backlog read.
- [x] News headlines (S-M) - shipped as the bundled `news` handler
      package; ticked 2026-09-15 on a backlog read.
- [x] Sports scores (S-M) - shipped as the bundled `sports` handler
      package; ticked 2026-09-15 on a backlog read.
- [x] Translation (S-M) - shipped as the bundled `translate` recipe
      package; ticked 2026-09-15 on a backlog read.

**Priority 2 - simple local actions (writes to our own data, no external
device or service to control):**

- [x] Reminders / timers (S-M) - shipped as the bundled `remind` and
      `timer` recipe packages (ticked 2026-09-15 on a backlog read); the
      note below is the history. `host.schedule` already exists; this is
      mostly a recipe + manifest away. Session E's step 2 (2026-09-06)
      scoped "a running timer, as its own page and a card" here and found
      nothing to build against yet: no recipe, no manifest entry, no
      `host.schedule` caller for a timer specifically. Left for whoever
      lands the recipe; the frontend side is a small `list`/`card_grid`-
      shaped page once there's a route.
- [ ] Shopping / todo lists (M) - needs a new record type (a list, with
      items), so a small spec addition, not just a recipe. Session E's
      step 2 (2026-09-06) scoped "lists, as their own page and a card"
      here too and confirmed the backend side is genuinely unbuilt
      (D, step 8, not started): no `spec/schemas/list.schema.json` despite
      being referenced from `manifest.schema.json`, none of
      `GET/POST /api/lists`, `PATCH/DELETE /api/lists/:id`,
      `POST /api/lists/:id/items`, `PATCH/DELETE /api/lists/:id/items/:itemId`,
      `POST /api/lists/:id/clear` exist. The frozen shape (D to E,
      docs/plans/wave-2.md) is `{ id, person, scope, kind: "shopping" |
      "todo" | "custom", title, items: [{ id, text, done, due_at?,
      created_at }], hlc }` - once it lands, the frontend page is a real
      `list` schema node (bind `GET /api/lists`, `row_action` toggling
      `done` via a `PATCH`, `batch` for clear-all) the same way Memory's
      page was built, no new node kind needed; a per-list detail view
      (its own items) is a `split_view`/`detail_pane` pair, the first real
      use of either since they were added for catalog completeness.

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

**Sourced-answer UI (citations, favicons)** - Jesse's ask (2026-09-06):
noticed other chat apps mark which sentence used which source, researched
both prior art and current practice before adding these. Both items below
are blocked on any sourced skill actually existing (Web search above is the
first) - nothing to cite until then, so treat as groundwork to design
alongside the first sourced skill, not before it.

- [ ] **Inline citation markers on sourced answers** (M-L) - doesn't exist
      yet. Legacy (`home-legacy.git`, `loki-doki`) shipped this completely
      once (issue #8, Open WebUI-inspired) and it's worth reading before
      designing fresh, not porting verbatim (feature scope is re-examined
      per `getmaipai/.github`, not carried): a fixed `SOURCE_TOOLS`
      allowlist (search/news/youtube/where-to-watch/holidays/contentRating)
      produced a `Source[]`; `companionTurn.ts` appended a numbered
      `Sources:\n[1] Title — url` block to the prompt and instructed the
      model to cite inline as `[1]`, `[2]`; an SSE `sources` event carried
      the list to the client, persisted to a `messages.sources` column so
      chips survived a reload; the frontend rewrote `[1]` into a
      backtick-wrapped `` `CITE:1` `` token so react-markdown's own
      inline-code renderer could intercept it and swap in a hover-tooltip
      chip linking out, plus a numbered `SourcesCard` under the settled
      (non-streaming) reply. It was entirely prompt-trusted - no
      structural/tool-enforced citation - and scoped to that one tool
      allowlist, never general RAG/notes retrieval.
      Current practice (researched 2026-09-06, not recalled): two real
      patterns exist. Perplexity's is the same shape legacy already built -
      inject a numbered source list, instruct `[N]` markers, and on the
      client accumulate the FULL text buffer before parsing (a marker can
      split across streaming chunk boundaries - parsing one delta in
      isolation misses it), then map `N` to the source list. Anthropic's
      Citations API is structurally different and more reliable: the model
      returns separate content blocks, each carrying real citation
      objects (`document_index`, `cited_text`, a char/page/block location)
      instead of a bare `[N]` in prose, streamed via a dedicated
      `citations_delta` event - `cited_text` doesn't even count as output
      tokens. That needs either a hosted API with native support or real
      constrained-generation work on our own llama-server stack to fake
      structurally, so the pragmatic path here is almost certainly the
      first pattern (which is what legacy already validated), with the
      same streaming-safe accumulate-then-parse discipline Perplexity's
      own docs warn matters.

      **Status, 2026-09-13 (lane 10 item 1)**: the shape and the frontend
      half are built (full writeup: docs/dev/session-b.md, "Lane 10 item
      1"); the engine side still isn't. `spec/schemas/source.schema.json`
      (a `Source` record: id, kind, title, url, site, an optional
      snippet, the shared provenance/clock-stamp envelope) is generated
      into both `spec/gen/ts` and `spec/gen/py`. The chat renders it end
      to end already: `SourcesCard` (a numbered list under a settled
      reply, `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"`
      on every link) and a `[N]` marker rewritten into a small linking
      chip, parsed once from the FULL accumulated reply text
      (`MarkdownTextPrimitive`'s own `preprocess` hook, never one
      streamed delta alone) - both adapters (`chatHistoryAdapter.ts`,
      `chatModelAdapter.ts`) carry a `sources` field forward the moment
      a turn has one. Left unchecked: nothing renders yet in the real
      app, because CHAT-16 hasn't started emitting `sources` on a turn -
      that's the one piece left, Session A's own work, wired to the
      exact shape above.

      **Status, 2026-09-22 (slice 5(a), superseded same day by
      SRC-ICON-01 below)**: the sources CARD is landed on `/next/chat`
      (docs/dev.md, "Slice 5(a)") - `Sources` (the new kit Element,
      `elements/sources.tsx`, not the old `SourcesCard` this note
      describes above, which belongs to the now-retired page), rows
      with no `href` and a bare letter glyph. SRC-ICON-01 replaces that
      row's own composition with `sources.aui.tsx`'s `Source`/
      `SourceIcon`/`SourceTitle` (a real link, a real favicon through
      the hub); `elements/sources.tsx`'s grid/list layouts stay in the
      kit for a caller that still wants them, just no longer this
      page's own. The `[N]` MARKER half described in this item is still
      exactly what's missing: `inline-citation.tsx` (the new kit's own
      would-be replacement for the old marker/chip rewrite) is a static
      demo with no exported way to place a marker in dynamic text, and
      `Thread` has no text/markdown slot to reach one through even if
      it were - filed as `getmaipai/commons#8`. This item stays open
      for that half.
- [x] **Favicon fetch-once, cache, and reuse for citation/source chips**
      (S) - superseded by SRC-ICON-01 below, landed 2026-09-22: a
      server-only cache (no client-side `localStorage` layer - legacy's
      two-layer shape wasn't needed once the hub's own route already
      answers a repeat request from disk), still hitting the exact
      privacy concern this item named (a raw `<img src="https://
      icons.duckduckgo.com/...">` leaking the household's IP and
      Referer to every cited domain).
- [x] **SRC-ICON-01: sources open their page and show the site's icon**
      (S), landed 2026-09-22: `elements/sources.tsx`'s own `Sources`
      card had no `href` (a source could never be opened) and no real
      favicon (a bare letter glyph always) - both filed as kit asks.
      Fixed by vendoring assistant-ui's own citation chip,
      `sources.aui.tsx` (`ui/src/elements/`, commons `ui-v0.5.33` -
      `ui-v0.5.32` was cut without bumping `ui/package.json`'s own
      version field, caught live by home's own tag/version match check;
      `ui-v0.5.33` is one commit later with just that version bump,
      `ui-v0.5.32` left dead, never a valid pin):
      `Source` (a real `<a target="_blank" rel="noopener noreferrer">`),
      `SourceIcon` (a favicon `<img>` with a letter fallback on error),
      `SourceTitle`, composed in `NextChatPage.tsx`'s
      `SourcesFooterContent`/`SourcesActionBarTrigger` inside the kit's
      own `Collapsible`. The favicon itself never comes from the
      browser: `GET /api/favicon?domain=<host>`
      (`backend/src/routes/favicon.ts`, `lib/favicons.ts`) fetches
      `/favicon.ico` then `/apple-touch-icon.png` through the hub (10s
      timeout, 64 KB cap, image content types only, the shared SSRF
      guard `@maipai/core/src/ssrfGuard`'s `assertNotPrivateHost`
      rejecting a private IP or `localhost`), disk-caches the result
      (found or confirmed-absent) under `<dataDir>/favicons/`, and
      sweeps it daily (`favicons.sweep`, `lib/scheduler.ts`): an entry
      unused for 30 days is deleted, the whole cache stays under 20 MB.
      `sourcesFromMessage()` keeps `url` (dropped before); `Source` is
      keyed by `url`, not `domain` (two pages on the same site used to
      collide) or index. See `docs/dev.md`, "SRC-ICON-01."

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
- [ ] **Find people and things** (L, Jesse's ask, 2026-09-06) - two
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

## Vision

- [ ] `host.camera.still` (L) - no pipeline, no hardware path in this repo
      (the hub isn't the camera; this likely means "receive a photo the
      robot or a phone took," not "the hub has a camera").
- [ ] `host.ocr.read` (M) - RapidOCR already decided as the library
      (`docs/dev.md`); needs wiring, a recipe step, and a real image input
      path (upload? robot capture?) before it's reachable at all.
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

## Generation (image, video)

- [ ] **ENGINE-HOST-03: Choose one foreground model for chat, intelligence,
      and coding** (S) - run the owner-ordered conversation, Session C coding,
      and speed bench on Qwen3-Next-80B-A3B, GPT-OSS-120B, GLM-4.5-Air, and
      the rejected-fit Qwen3-235B-A22B control. Measure 4k/16k/32k prompt
      speed, decode, first token, two 64k slots, tool calls, safety, and peak
      memory on the target M5 Max. Out of scope: a permanent second coding
      model. Files: `backend/scripts/bench/memory-eval.ts` and the conversation
      bench. Acceptance: one selected model with a recorded licence, revision,
      checksum, and measured resident profile. Check: the named benches and
      `bash scripts/check.sh`.
- [ ] **ENGINE-HOST-04: Add the MLX and managed-host engine contract** (M) -
      add `managedBy` beside `url`, `spawned`, and `stub`, with health,
      identity, memory, offline, and expected-revision fields. Keep Home's
      guards, URL contract, and provenance. Out of scope: cloud routing and
      host-owned safety. Files: `backend/src/lib/engineCatalog.ts`, the
      supervisor, and engine tests. Acceptance: llama.cpp and MLX pass the
      same tool, safety, identity, and restart fixtures. Check: backend engine
      tests, `tsc --noEmit`, and the full gate.
- [ ] **ENGINE-HOST-05: Provision the measured resident roles** (M) - keep one
      foreground model, a dedicated 8B to 14B judge or the Qwen3-4B floor,
      embed, Moonshine, and the measured Qwen3-TTS/Kokoro choice. Surface peak
      memory and offline state in Repairs and the model page. Out of scope: a
      second always-resident coder or automatic model shuffling. Check: the
      resident-profile soak from ENGINE-HOST-03 and the full gate.
- [ ] **ENGINE-HOST-06: Run the one-box watcher under launchd** (M) - add the
      health and resource samples, pressure hold, facts-first alert, and
      hub-to-watcher heartbeat described in the Apple Silicon plan. Out of
      scope: solving simultaneous power loss. Check: watcher tests and the
      full gate.
- [ ] **MEDIA-HOST-01: Supervise local image generation and editing** (M) -
      install a pinned ComfyUI sidecar with a local queue, health endpoint,
      output directory, FLUX.2 Klein/Qwen Image Edit workflows, LoRA loading,
      child-safety evaluation, provenance, and consent. Measure warm and cold
      1024 px image and edit times. Out of scope: identifiable non-members in
      household pictures. Check: the first-day media bench and full gate.
- [ ] **MEDIA-HOST-02: Generate animated and photorealistic video locally**
      (L) - benchmark LTX on the MLX Apple path and Wan2.2 TI2V-5B on MPS,
      then add progress, cancel, notification, shot-list assembly, titles,
      and the LTX upscaler. Out of scope: a hidden hosted video fallback.
      Check: five-second clip timings, peaks, and the full gate.
- [ ] **MEDIA-HOST-03: Generate music with licence-aware export** (M) -
      benchmark ACE-Step 1.5 and the selected Stability model for one minute
      of audio, store model/prompt/seed/source provenance, and block a
      monetized export when the model or data terms are not cleared. Check:
      the fixed audio bench and full gate.
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
- [ ] Image generation (L) - the design and model/licence bar now live in
      `docs/plans/hub-on-apple-silicon-2026-09-17.md`; do not start code before
      MEDIA-HOST-01's safety and first-day measurement are ready.
- [ ] Video generation (L) - the design now distinguishes animated LTX and
      photorealistic Wan; do not start code before MEDIA-HOST-02's Metal
      timing and memory result is recorded.

## Advanced tool calling (Tier 2)

- [ ] **ARCH-BUILD-01: buy or build, decided per subsystem before any of the four architecture records is written** (M, a spike with a written verdict, 2026-09-22). A second reviewer's push (the owner's own pass, "Luna"): do not design a turn engine from scratch; adopt LangGraph JS for the agent loop and its state, retries, interrupts and checkpoints; Cedar for deterministic authorization; Home Assistant for smart-home execution; Letta's memory-block and archival-search CONCEPTS without its runtime; keep only the protected-information boundary and the response plan as ours. The push is aligned with this org's own principle 6 ("prebuilt over hand-built... a maintained library for a solved problem beats hand-rolled logic doing the identical job"), so it gets a real evaluation rather than a reflex either way, and its verdict binds the four ARCH rows: each record names which parts it builds and which it adopts, citing this item's measurements.

    **Where the reviewer is already right, and it is not a change:** smart-home execution is Home Assistant's job today. `backend/settings/homeAssistantKeys.ts` holds the base URL and token, and every device package is already a thin recipe over `home.call_service` (`backend/packages/lights-on/recipe.json` calls `light.turn_on` with an area target). So the catalog is not "seventy vendor packages"; it is a handful of intents over one integration, and the correct follow-through is to widen the recipe op to carry exclusions and areas (the fish-tank case from the first review) rather than to build a device runtime we never had.

    **What the spike must measure, per candidate, before a verdict:** (1) **Runtime fit.** Home's backend is Bun and Hono (STACK.md); LangGraph JS and Cedar's JS binding (a WASM build) each need a boot and a round-trip proven under Bun, not Node, with their install size and cold-start cost recorded. (2) **Privacy.** Anything that phones home fails outright, including optional telemetry and hosted tracing (LangSmith): the spike runs with the network blocked and records what breaks; "nothing leaves the house" is not negotiable for a dependency either. (3) **What we would throw away.** `turnEngine.ts` is 6,200 lines carrying the safety ladder, the guards, the age bands, the ask and confirm continuations, prefix-cache-friendly prompt assembly and the routing corpus's behaviour; the spike states, in lines, what a LangGraph port keeps, rewrites and deletes, and how the routing corpus is re-proven against it. (4) **Ownership of the control flow.** Adopting a graph runtime means our turn's shape is theirs; the spike names what we lose if they change direction, and what an exit looks like. (5) **Second declaration.** The org rule is one definition in one place: settings and permissions are declared once in the spec. Cedar introduces a policy language; the spike decides whether the spec DECLARES and Cedar EVALUATES (acceptable) or whether Cedar becomes a second source of truth (not acceptable), and proves the generation path if the former. (6) **The robot.** Anything adopted must run, or be cleanly absent, on the Pi class where the whole agent loop is off; a runtime that is mandatory on the hub and impossible on the robot splits the platform, which principle 2 forbids.

    **The part that is ours whatever the verdict,** and both reviewers agree: the protected-information boundary. Cedar can decide that a child may not access a guardian-controlled resource, but nothing off the shelf labels a fact arriving from a tool result, a search result, a document or a sibling's quoted words and keeps it out of that child's context before the model sees it. ARCH-POLICY-01 builds that; Cedar, if adopted, becomes its decision point rather than its replacement. Likewise the response plan (ARCH-LAYERS-01) stays a small object of ours, not an architecture.

    **Second round, 2026-09-22 (the reviewer answered the objections and narrowed her own recommendation; accepted, and it changes this item's method and its likely verdict).** Neither candidate is adopted as architecture; both are spiked as replaceable implementation components, with a much higher bar on the graph runtime than on the policy engine. Specifics that bind the spike: **LangGraph is spiked as the OSS library embedded in our own Bun and Hono process only, never its Agent Server**, whose tracing, telemetry and licensing machinery is needless risk against "nothing leaves the house"; Bun is not obviously incompatible (their own issues show Bun setups) but that is not a guarantee for an embedded workload, so the boot and one real turn are proven or it fails. **The bar: adopt only if it deletes a large amount of MaiPai orchestration without taking ownership of our safety, privacy and control-flow semantics.** The likely outcome both reviewers now expect is the third option this spike must build and measure: **extract our existing engine into an explicit MaiPai state machine**, copying the graph's shape rather than its dependency, which leaves zero framework-exit problem because we own the graph. So the spike is a three-way comparison on one representative turn (safety, model, tool, model, output guard): today's engine, the LangGraph port, and a tiny in-house `TurnGraph`/`TurnState`/`NodeResult` prototype; the measurement that decides it is **how many existing turn-engine lines become unnecessary versus merely wrapped**, with the routing and safety corpora run through all three. Cedar keeps the narrower, better bar: it never owns the turn, its exit is one function (`authorize(principal, action, resource, context)`) and the application never knows Cedar's syntax exists; it is proven on Bun AND on the Pi, network blocked, with authorisation latency, memory footprint, cold start and schema ergonomics recorded. The policy itself stays MaiPai data declared once in the spec, with Cedar as the evaluator, never a second policy logic beside ours. Expected verdicts, to be confirmed or refuted by the numbers, not assumed: Cedar survives, LangGraph probably does not.

    **Deliverable:** one dev.md section with a table (candidate, what it would replace, the six measurements, verdict: adopt, adopt-partially, reject) and a one-paragraph reasoning per verdict; a throwaway spike branch per adopted candidate proving the boot and one real turn; and the four ARCH rows amended with the verdicts. Out of scope: adopting anything in this item; it decides, it does not migrate. Exit: `bash scripts/check.sh` (the spike code is throwaway and not merged) and the owner's review of the verdicts.

    **Verdict, 2026-09-22 (Fable, from Session A's measurements; the owner's review is the exit).** XState v5 is adopted as the sequencing runtime of the new pipeline's loop (U2), with the machine definition and every node ours; LangGraph JS is rejected for orchestration (it would own the tool-call semantics the design keeps deterministic and brings a phone-home surface for a few hundred lines of control flow); the in-house TurnGraph is rejected on principle 6 (its 51 lines are the demo's cost, the trace, deadlines, retries and interrupts the real turn needs are XState's ordinary features); Cedar is adopted partially and deferred to ARCH-POLICY-01's household policy record as its evaluator; Home Assistant stays the device runtime; Letta's concepts are read into ARCH-MEM-01's record. Framework speed and per-framework correctness were not compared (gate-contended timings, single samples). The table and the reasoning: `docs/dev.md`, "ARCH-BUILD-01: the buy-or-build verdict".

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

- [ ] **ARCH-LAYERS-01: personality, conversational state and modality are three separate layers after the answer** (M, design record first, decided 2026-09-22; completes ARCH-AGENT-01 and ARCH-MEM-01, and supersedes part of the response-contract record). The owner brought the separation: the reasoning layer decides WHAT is true, the personality layer decides HOW it sounds, an ephemeral conversational state adapts within the conversation, and the modality layer decides what the surface receives. Checked against Home: two of the four exist, one exists half, one does not exist at all.

    **What we already have.** Personality is already a persistent configuration, not a prompt the model must remember: `backend/src/lib/persona.ts` declares behavioural dimensions (formality, complexity, engagement, filler_density) plus a few-shot `examples` block, composed by `composePersonaPrompt()`, selected by the `persona.active_id` setting; that is exactly the "dimensions plus examples, never 'you are a Southern mother'" shape, and the file's own comment records why (a caricature was the failure mode). The fact-versus-phrasing split is already a rule of the platform: "the model phrases, it does not judge" (turn engine header, plan 4.5), and the guards enforce it. Modality is half built: the response contract by surface (`docs/plans/response-contract-by-surface-2026-09-21.md`, RESP-01 to RESP-04) already rules that a typed screen gets the written register, voice gets one to three sentences and an offer, a glance hub gets a card plus a lead, with no user-facing control beyond ChatGPT's two.

    **The three gaps.** (1) **The personality prompt is not yet split from the length policy**: RESP-01 does that (the brevity sentence moves into the spoken policy), so this item depends on it rather than repeating it. (2) **There is no conversational state.** Nothing tracks, within one conversation, that the person keeps interrupting (be shorter), keeps asking for more (go deeper), is rushed, or is playing; `turnContext.ts` is ephemeral but carries the turn's plumbing, not the person's read. This is the layer that makes an assistant feel like it is paying attention, and it must NOT become long-term memory: it dies with the conversation, is never extracted by the judge, and never becomes a stored preference unless the person says so in words (then it is a real preference record, which the existing judge already handles). (3) **Progressive disclosure is not a voice behaviour yet**: RESP-02 defines the spoken projection, but not the "answer, give one to three useful facts, stop, expand on request" loop with depth tracked per topic.

    **The layer order, to be recorded once so every later item obeys it:** context (thread state and memories) -> reasoning and tools (the agent loop) -> the answer as structured content -> personality (how it is said: dimensions plus examples, one character in every medium) -> conversational state (this conversation's adaptation: length, depth, mood) -> modality (what the surface receives: written, spoken, glance; voice additionally gets prosody, pauses and the interruption contract). A change of personality touches none of search, memory, reasoning or tools, which is the test that the separation is real.

    **Sized by hardware class, as the other two rows are.** Full: all four layers, the personality's examples block in the prompt, conversational state maintained by a cheap scorer over the last turns, progressive disclosure with real depth tracking. Bounded: the same, with fewer examples and a smaller state (length and depth only). Floor only (the Pi robot): the personality dimensions become a fixed short instruction plus two examples, conversational state is length only, and the modality policy is the spoken contract, because a small model handles one instruction well and four badly.

    **The design record answers first** (`docs/dev.md`): the conversational state's fields and their decay (what survives a pause, what dies with the conversation); how it is computed (interruptions and "tell me more" are events the wire already has, or new ones); how it enters the prompt without becoming a second persona; the interruption contract for live voice (what happens to a half-spoken answer); progressive disclosure's depth counter and how a follow-up resumes it; and the child projection (a child's persona and state are the parent's setting, not the child's drift).

    **Acceptance:** the seeded voice set and the written set (RESP-01's) both re-run with one persona and no regression; a scripted conversation where three interruptions shorten the next answers and two "tell me more" lengthen them, asserted in a test; a written-versus-spoken pair for the same question proving the same facts in both and the spoken one stopping after the lead; and a persona swap that changes no retrieval, no tool call and no fact in the answers (the separation test). Files: `backend/src/lib/persona.ts`, `turnContext.ts` (or a new `conversationState.ts`), `turnEngine.ts`'s composition point, `backend/scripts/bench/`. Exit: the design record reviewed, then per-item `bash scripts/check.sh` and both bench sets.

    **Adversarial review, 2026-09-22, accepted and amending this row.** The finding: these layers do not only change wording, they change **which facts survive**. "Be brief" is a selection decision, "tell me more" is a selection decision, and voice's progressive disclosure decides where an answer stops; running them as serial transforms after a finished answer either drops content or forces a rewrite per layer. The example that settles it is a safety one: a parent asks by voice how much children's medicine to give, the conversational state says shorten (three interruptions), the spoken contract says one to three sentences, and each layer trims what it believes is presentation until the dose qualifier is gone. So the design changes: the layers keep separate owners and separate state, but they feed a **response plan built BEFORE generation**: mandatory facts (a safety qualifier is mandatory and cannot be trimmed by any layer), optional facts, prohibited facts (from ARCH-POLICY-01's boundary), desired depth, persona parameters, the surface's budget; the model generates once from that plan, and a check verifies the mandatory facts survived. Personality stays genuinely downstream (it phrases); conversational state and modality are inputs to the plan, not post-processors. This also amends `docs/plans/response-contract-by-surface-2026-09-21.md`: RESP-02's spoken projection is produced from the plan, never by trimming a written answer.

    **Accepted design, 2026-09-22 (ARCH-AMEND-01). Supersedes "the response plan stays a small object of ours" as a new object, and the sentence "personality stays genuinely downstream".** There is one plan. The spec's existing ReplyPlan (`reply-plan.schema.json`, spec-v0.1.18: the moves, playfulness, `max_sentences`, `max_words`, the band fields) is extended in the spec first and then on the hub with the fact classes the adversarial review named (mandatory facts, optional facts, prohibited facts from ARCH-POLICY-01's boundary, desired depth) and a surface-derived budget; no second plan object exists beside it. Length is decided in that plan and nowhere else: `planFor` (`backend/src/lib/register.ts`) derives `max_words` and `max_sentences` from the surface class and the evidence (written: the information need, no act cap; spoken: the act table as today; glance: the card), the persona's engagement dial no longer carries a length (RESP-01 does both, first), `planLine` names no sentence count on the written class, and both generation paths keep reading `max_tokens` from the plan (`turnEngine.ts`, the two `max_words * 1.6 + 32` sites), so no length lives in prose. Reply constraints decay by turn count (`replyConstraints.ts`: a length or shape ask holds for the turn that set it and the next three; a banned phrase stays). Personality is an input to the single generation, not a downstream pass: in prose it is the dimensions plus the examples block, as today, and the item that makes it orthogonal is the 2026-09-16 review's item 4 (a decoding-time control vector per dial, measured on the companion bench), which this row now depends on rather than drops; the separation test (a persona swap changes no retrieval, no tool call and no fact) stays the acceptance. Conversational state and modality remain inputs to the plan, as the adversarial review ruled, and the record still answers the questions listed above.

- [ ] **ARCH-MEM-01: memory as four subsystems around the model, sized by hardware class** (L, design record first, decided 2026-09-22, the companion to ARCH-AGENT-01). The owner brought the current shape: memory is not one thing but thread management, long-term extraction and storage, automatic retrieval, and an explicit memory-search tool, with a smaller model doing extraction and reranking so the best model is spent on conversation. Checked against what Home has, most of it exists; the gaps are specific.

    **What we already have, and it matches.** The extractor is a separate step on a separate model, not the chat model deciding for itself: `backend/src/lib/memoryJudge.ts` runs the `judge` role with its own extraction prompt and eleven categories (fact, preference, relationship, state and the rest), already distinguishing "nothing worth saving" from a durable fact, and CHAT-06 made ingestion idempotent (home 144906a2) so the same fact said twice is one record. Long-term storage is the spec's memory record with provenance, validity (`valid_from`/`valid_to`), the child disclosure flag and the privileged-kind rules (`memory.ts`: `remember`, `archive`, `setChildDisclosure`, `archiveByProvenance`). Automatic retrieval before the call exists: `recall()` runs on the turn with the utterance's own embedding, reusing the vector the router already computed. The kinds are separated rather than one bucket (memory versus entity records, `categoryToRecordKind`), and documents are already a different system (the artifact and knowledge packages), which is the separation the note asks for.

    **The four real gaps.** (1) **No memory-search tool.** Retrieval is automatic only; the model cannot say "I know he told me his monitor, it is not in what I was given" and go look. That is one package in the catalog (`memory-search`, args: a query and an optional scope), which ARCH-AGENT-01's loop then lets the model call; on the floor-only class it is not offered. (2) **Thread compaction is not a first-class state.** A long conversation is trimmed, not compacted into "what we decided, what was rejected, what is open"; the note's THREAD STATE block is the missing piece, and it is also what makes a small model behave on a long thread. (3) **Retrieval ranks on similarity and recency, not on importance, entity match or project scope**, and there is no rerank step; with a few hundred records that is fine, with twenty thousand it is not, and the household will get there. (4) **No project scope at all** until CHAT-PARITY-10 lands, which is the scope key the reranker will want.

    **Sized by hardware class, the same rule as ARCH-AGENT-01.** Full (p64 and up): automatic recall plus the memory-search tool the model may call mid-reasoning, extraction on the judge role after every turn, a rerank pass over the top candidates. Bounded (p32): automatic recall and the tool, extraction batched after the reply (never in the turn's own latency), rerank by a cheap scorer rather than a model. Floor only (p16 and the robot's Pi): automatic recall only, no tool offered, extraction on a small classifier or a rules plus template pass that writes only the high-confidence categories (preference, fact with an explicit subject), and a hard cap on how many memories enter a prompt. A candidate for the small end is the ROUTER-RLCD-01 bench's own models (the calibrated decision head is exactly "is this worth remembering, and of what kind"), which is a second reason to run that bench.

    **The design record answers first** (`docs/dev.md`): the thread-state shape and when it is recomputed; the memory-search tool's args, its permission (a person searches their own memories; an owner may search a child's where the existing rules already allow it) and its child projection; the ranking signals and where importance comes from (the judge already emits a confidence; usage counts exist via `bumpUsage`); whether reranking is a model call or a scorer, per class; how project scope enters once CHAT-PARITY-10 exists; what the robot does alone (its own floor, its own small store, and what syncs on pairing per the portability rules); and the privacy line, which is unchanged and non-negotiable: nothing leaves the house, a child's memories stay a child's, and the credential policy still redacts before anything is stored.

    **Acceptance for the record:** the existing memory bench (`backend/scripts/bench/memory*`) re-run with the proposed retrieval against today's, on the dev hub's real records, reporting precision at 5 for a set of questions whose right memories are known; a latency line per class; and a written answer to "what does the floor-only class do when the right memory exists but was not retrieved", which is the same honesty question as the agent loop's stuck line.

    Files (record first): `backend/src/lib/memory.ts`, `memoryJudge.ts`, `memoryIngestion.ts`, `turnEngine.ts` (the recall and compaction seams), a new `backend/packages/memory-search/`, `backend/scripts/bench/memory*`. Out of scope: changing the record shape itself (the spec's memory record stands), and anything that would put household memory on a machine outside the house. Exit: the design record reviewed by the owner, then per-item `bash scripts/check.sh` and the memory bench.

    **Adversarial review, 2026-09-22, accepted with one note, amending this row.** The finding: this row optimised retrieval before deciding what deserves to exist, and a household does not need a better search engine over twenty thousand records, it needs a small trustworthy picture of people whose facts change, conflict and expire. Reranking cannot repair bad truth maintenance: "I hate mushrooms" versus "I have started liking mushrooms", a move that invalidates "Dad's office is upstairs", two people with one name, a teenager who said while sick that pizza makes them nauseous and gets it served back six months later at their birthday. So the design changes: **store less, and make contradiction and expiry the first-class problem**: a compact current profile and state graph for what is held true now, episodic records only where provenance or history matters, thread and project summaries, and the explicit "remember this" items, with consolidation on write and expiry for weak inferred records. The note: Home already has the bones the review could not see, `valid_from`/`valid_to` on every record and the curator item CUR-01, so this is a promotion of CUR-01 to the centre of the memory design rather than new ground. Second accepted finding: the `memory-search` tool widens the model's authority from "use what was selected for this turn" to "rummage through a person's history", so it is scoped by ARCH-POLICY-01's ingress boundary (a search returns only what this reader may know), logged, and offered only on the classes where a model can be trusted with it.

    **Accepted design, 2026-09-22 (ARCH-AMEND-01), correcting gaps (1) and (3) against the code.** Recall already ranks an entity match as a deterministic override (`backend/src/lib/memory.ts`, the entity-first pass and the pinned-or-entity branch of the scorer), so the ranking gap is importance and project scope only, not entity match. The "told me his monitor" case fails because the judge creates no entity records (`memoryJudge.ts` header), so entity creation by the judge is the first item, ahead of any reranker, and it is also ARCH-POLICY-01's alias dependency. The memory-search tool stays absent until CUR-01 (contradiction and expiry) has landed and the per-model tool budget (ARCH-AGENT-01) says the model may hold it; a search over unconsolidated records serves the stale mushroom fact faster, not better. The prompt budget is a named gap: five snippets and 800 characters (`turnEngine.ts`, `MAX_MEMORY_SNIPPETS`, `MAX_MEMORY_SECTION_CHARS`) against the 1,300 to 1,600 tokens the 2026-09-16 review measured in the strong systems; the record sets a measured budget with the memory bench. The four-subsystem framing above stays as the owner's description; the record's seams are the three the adversarial review found: what is held true now (the profile and the state graph), what happened (episodes, thread and project summaries), and what the person asked to keep.

- [ ] **ARCH-AGENT-01: the turn engine becomes a small agent loop around the model, keeping the deterministic floor** (L, design record first, decided 2026-09-22). The owner brought the current industry shape (Anthropic's tool contract and its tool-search for large catalogs, OpenAI's Agents SDK guidance on narrowly scoped tools, LangChain's "start with one agent and good tools"): a tool-capable main model inside a harness, deterministic rules around it, specialised routing only where it pays, typed events to the UI. Measured against what Home has, the verdict is that we already hold four of the five pieces and the gap is the loop, not a rewrite.

    **Independent review, 2026-09-22, ACCEPTED by the owner the same day (all three ranked findings).** A line-by-line check against the code argues this row keys the design on memory tiers rather than measured model capability, that the p32 agent row is the configuration the 2026-09-16 review measured as unfit, and that the gain here is the action-plan executor, not a multi-round loop. Full case and the counter-proposal: `docs/plans/arch-review-2026-09-22.md`. This record is not written before ARCH-MEASURE-01 lands.

    **What we already have, and it matches.** The tool registry is the package catalog: every capability is a manifest with args, a min_role and a recipe (`backend/packages/*`, `docs/PACKAGES.md`), which is the "narrowly scoped tool with an explicit description" the guidance asks for. The deterministic policy layer is the safety-first order in `turnEngine.ts` (safety, then the plugin floor, then the model), the role floors (`meetsMinRole`), the reply constraints and the guards; the org's own rule already forbids a learned component in the safety, consent or privacy path (`.github/docs/RULES-AND-LEARNED-COMPONENTS.md`), which is exactly the "do not trust probabilistic routing with permissions" line. The typed UI events are the wire: `delta`, `reasoning` (REASONING-01), `status`, `structured_part`, `artifact`, and now `tool_call`/`tool_result`/`tool_error` (TOOL-EVENTS-01, spec-v0.1.17), rendered by the shipped Elements (the chat program's wiring table). The main model with native tool calling exists as Tier 2 (`resolveToolCallsInOrder`).

    **What is different, and the decision.** Home's default path is a classifier ladder in front of the model: Tier 0 pattern match, Tier 1 embedding score over `routing.examples`, then Tier 2, then the model as a phrasing fallback. Two live failures on 2026-09-21 (ROUTE-FIND-03: "search who won the Mariners game yesterday" answered by the *remember* package; "what did Apple announce this week" hitting the stuck line instead of a search) are the predicted failure mode of exactly that shape: each classifier is another place to be wrong, and the model never got to say "this could have changed, search". So: **the ladder stops being the decider and becomes a fast path.** Tier 0 keeps the cheap, obvious, high-volume commands where a wrong answer is embarrassing and a right one is instant (lights, timers, "what time is it", an explicit "remember that"); everything else goes to the model with the tools offered, and the model decides. The loop runs to a bounded depth (model, tool, model, at most N rounds and a wall-clock cap), parallel calls allowed, a failed call returned to the model to try another, and the turn ends when the model stops calling. The deterministic layer stays in front (safety, permissions, the credential policy, forced freshness for a recency question) and behind (the output boundary, the guards, the child projection).

    **Why not a router model for everything.** The same reasoning retires the idea of a chain of classifiers; ROUTER-RLCD-01's bench stays, but its question narrows to "does a calibrated classifier beat the pattern match on the FAST PATH and on the turn-signal head", not "does it replace the model's own judgment".

    **The design record answers first** (`docs/dev.md`, before any code): which utterances stay on the fast path and how that list is maintained (it must be small and testable, the routing corpus is the test); the loop's bounds (rounds, wall clock, token budget, what a minor's turn may do); how forced freshness is expressed as a tool the model must call rather than a route it cannot reach; what the model is told about the catalog when it grows past a handful of packages (Anthropic's tool-search pattern: a `find_tool` tool over the manifests' own descriptions and embeddings, which Home already computes for Tier 1, rather than every manifest in every prompt); how an `ask`/`confirm` continuation survives inside a loop; the child projection at every round; what the wire emits per round (the tool events exist; a round marker may not be needed); and the retirement plan for Tier 1's embedding scorer if the bench says the model plus fast path beats it.

    **Acceptance for the record:** a decision table of the routing corpus's rows against today's ladder and the proposed loop, run on the dev hub, showing no regression on the rows the fast path keeps and a fix for ROUTE-FIND-03's two rows; a measured latency comparison (the fast path is one pattern match, the loop is at least one model call); and a written answer to "what happens when the model calls nothing and knows nothing", which is the stuck line the owner saw.

    **The shape is per hardware class, and the sizer chooses it (the owner's call, 2026-09-22; checked and correct).** An agent loop assumes a model that can hold a tool catalog in its head, emit well-formed calls and know when it does not know. That assumption is false below a size, and the failure is not slowness, it is invention: the 2026-09-07 incident in this repo is the evidence (`docs/dev.md`, "Chat reliability: the 2026-09-07 incident and the five fixes"), where Tier 2 native tool calling fired on ordinary conversational turns with a sampled choice among irrelevant tools, on a model far larger than a robot's. So the architecture is not one shape: it is a shape per class, and the class is a hardware decision the sizer already makes. Three named shapes, with the profile that selects them (the Stack's governor already tiers `p16`, `p32`, `p64`, `p128` by memory, `stack/backend/src/lib/governor.ts`, and Home's `detectHardware`/`primaryBudgetBytes` already classify the host, `commons/core/src/hardware.ts`):

    - **Full loop (p64 and up, the Studio class, a 27B or larger chat role):** the shape above. The model decides, tools are offered in full, the loop runs to its bounds, tool search when the catalog grows.
    - **Bounded loop (p32, a 7B to 14B class):** the same loop with a smaller catalog and a hard cap of one tool round; the fast path is wider (more patterns stay deterministic) because a mid-size model's tool judgment is good but not free; forced freshness stays a rule, not a hope.
    - **Floor only (p16 and the robot's Pi class, a 1B to 4B model or a classifier plus templates):** no open loop at all. The deterministic floor decides, a small calibrated classifier does the routing (this is where ROUTER-RLCD-01's candidates earn their place), the model phrases the reply and never chooses a tool; a request the floor cannot serve says so plainly rather than inventing a call. This is the robot's default when it is alone, and the hub's fallback when its own chat role is a small local model.

    Consequences to design in, not bolt on: the surface's capability is declared, not assumed (a turn carries which shape ran, so an answer's quality can be read against it in the labels and the stats); a pod or robot paired to a hub uses the hub's shape by asking the hub, and its own floor when disconnected (the platform's "complete without a hub" rule); the profile is measured, not guessed (the sizer's own bench decides the class, and a household may pin it); and the same package manifests serve all three, since a tool description is a tool description whether the model chooses it or a classifier does.

    **Adversarial review, 2026-09-22, accepted and amending this row in its most important line.** The finding: replacing a bad classifier with the chat model as the general control plane trades routing mistakes for nondeterministic **execution** mistakes, which is a fair trade for a research assistant and a poor one when the tools message people, spend money, unlock doors and run a robot. The example that settles it: "tell Dad I am leaving, lock the back door, and turn off everything downstairs except the fish tank", where the message and the lock succeed, one smart-home call times out, and the model retries a broader "turn downstairs off" that kills the fish tank; the loop behaved rationally and the household lost its fish. A round cap bounds compute, not side effects. So the design changes: **tools are split by consequence.** Read-only tools (search, weather, knowledge, memory lookup, device state) the model may loop over freely. Side-effecting tools are never called by the model directly: it emits a typed **action plan**, and a deterministic executor validates permissions, exclusions ("except the fish tank" is an exclusion, not a hint), confirmations, idempotency on retry, dependencies and partial completion, then reports what actually happened. Also accepted: the fast path admits by **properties** (a closed intent, deterministic argument parsing, high frequency, low ambiguity, a defined failure behaviour), never by "this failed last night, add a pattern", and it holds intents with grammars, not regex piles; and the three-tier split collapses to **two architectures, agent-capable and not**, with rounds, catalog size and latency as measured runtime budgets per model rather than a third "bounded" architecture that would accumulate special cases. The p32 class therefore runs the agent-capable architecture with a one-round budget, which is a profile, not a design.

    **Third amendment, 2026-09-22 (the second review round), and it retires the class framing above.** The two-architecture split (agent-capable or not) is replaced by something cleaner that also answers the robot objection: **one execution contract everywhere, different capability budgets.** Hub and robot implement the same tiny shape, `TurnState`, `Node`, `Transition`, `ToolRequest`, `ActionProposal`, `PolicyDecision`; the Studio executes a richer graph with more rounds and a larger catalog because its model can, and the Pi executes a small deterministic graph with the model-driven transitions simply unavailable. Same architecture, different available transitions, rather than two or three architectures that would drift apart and give the household two MaiPais. This also means no adopted runtime may be fundamental to our semantics: whatever ARCH-BUILD-01 concludes for the hub, the contract above is what both machines speak.

    Files (the record first, then the items it chunks into): `backend/src/lib/turnEngine.ts` (the 6,200-line file this item finally gives a seam), `backend/src/lib/routing.ts`, `backend/src/lib/plugins.ts`, `backend/scripts/bench/datasets` (the routing corpus), the spec's wire if a round marker is needed. Out of scope: multi-agent anything (the guidance says one agent with good tools, and Home's packages are the tools); the robot's own loop (parity later). Exit: the design record reviewed by the owner, then per-item `bash scripts/check.sh` and the corpus bench.

    **Accepted design, 2026-09-22 (ARCH-AMEND-01; the owner ruled "accept all" on `docs/plans/arch-review-2026-09-22.md`). This paragraph supersedes "the ladder stops being the decider", the three-shape table above (full loop, bounded loop, floor only) and the two-architecture amendment; the third amendment's one execution contract stands.** The shape that runs today is the shape: safety first; a fast path admitted by properties (a closed intent, deterministic argument parsing, high frequency, low ambiguity, a defined failure behaviour; intents with grammars, never a regex added after a bad night); then one completion with the tools offered on it, as Fix E already does; then the output boundary. Two things are added. The deterministic action-plan executor for side effects, as the adversarial review ruled: the model emits a typed plan (`ActionProposal` in the contract), the executor validates permissions, exclusions, confirmations, idempotency on retry, dependencies and partial completion, and reports what happened; nothing side-effecting is called by the model directly. And a second tool round, added only when a routing-corpus row or a bench row needs it and names which; no open loop is designed ahead of that row. Capability is sized per model, never per box: the tool-calling bench (`backend/scripts/bench/tool-calling.ts`, run by ARCH-MEASURE-01) records, per chat model on the fixed pipeline, irrelevance detection and the inverse miss at ten repeats, and the verdict is stored with the model in the catalog (`backend/src/lib/modelCatalog.ts`, a `tool_calling` budget: rounds, catalog size, whether the model may choose a tool at all); the governor's memory tiers (`p16` to `p128`) size residency and never the turn's shape, and a box that loads a small model gets that model's budget. The offered tool set is stable per model and monotonic per conversation (once a candidate is earned it stays offered for that conversation, sorted), because the Qwen3 chat template renders `tools` inside the first system message ahead of the history, so a set that changes turn to turn re-prefills the history and the context every turn (measured 2026-09-22: `cache_reuse_tokens` pinned at 567 on nine of twelve turns; the latency diagnosis, LAT-00 to LAT-03). The evidence offered for a loop is withdrawn: ROUTE-FIND-03's two turns were a fast-path miss and the repeat guard (the rows in `conversation_turns`), not the ladder's failure mode, and the 2026-09-07 incident ran on a pipeline since fixed (a 0.45 floor, a separate up-front call, sampling at 0.8), so "invention below a size" is measured by ARCH-MEASURE-01 before anything is designed against it. The design record is written after ARCH-MEASURE-01 lands and answers, beside the questions already listed: the executor's plan shape; the per-model budget's fields and how the sizer reads them; the sticky offer set's reset rule; and the pending-ask state for a plan that needs two confirmations (today one slot per conversation, `conversationHistory.ts` `setPendingAsk`).

    **Orchestration, decided 2026-09-22 by ARCH-BUILD-01's verdict.** The loop runs as an XState v5 machine whose definition is ours (the contract above: TurnState, Node, Transition, ToolRequest, ActionProposal, PolicyDecision); XState supplies sequencing, actor cancellation for the per-node deadline, and inspection events for the per-node trace; no part of our semantics lives in its primitives, and the same machine runs on the robot's Pi with the model-driven transitions absent from its budget. The interim always-search rule stays on for the 8B (19 fitting searches called in 50, 0 false calls in 50) and gains "unless this conversation already holds the answer" in a structured form the model chooses inside the same forced call (an answer-from-this-conversation tool whose argument is the quoted window line, verified by a set check); the quiet-window run of 2026-09-22 (rule on and off, ten repeats) settles its cost. Design record: `docs/plans/simple-turn-pipeline-2026-09-22.md`, sections 3, 7 and 11.


The 2026-09-07 incident (`docs/dev.md`, "Chat reliability: the
2026-09-07 incident and the five fixes") found today's Tier 2 firing on
every conversational turn with a sampled choice among irrelevant tools.
The two items below are that note's fixes D and E; do D first, E is
verified against D's numbers.

- [x] **Fix D: measure routing on the real embedder, add nomic prefixes,
      widen the corpora** (M) - shipped 2026-09-07. As built, corrected
      from the plan below in three real ways - see `docs/dev/session-c.md`
      for the full numbers and `docs/dev.md`'s Fix D "as built" note for
      the reasoning behind each correction:
      (1) `routing.ts`'s own `ensureRoutingEmbeddings()`/`embedUtterance()`
      get the `search_document:`/no-prefix split directly (no `kind`
      param on `lib/llm.ts`'s shared `embed()` - unnecessary once the
      change stayed routing-only); `memory.ts`'s embeddings deliberately
      do NOT get a prefix yet (filed as its own follow-up item above -
      `embedUtterance()`'s vector is reused for both `route()` and
      `recall()` to avoid a duplicate HTTP round trip, so a query prefix
      here would need a real re-embedding migration for memory's own
      stored vectors first, not a hash bump like routing's own store
      could take). Measured head to head, not assumed: document-only
      prefixing scored the SAME 68/71 true-positive rate as no prefixing
      while cutting the null-row noise ceiling from p90 1.00 to p90 0.86;
      prefixing BOTH sides (the model card's own default) scored WORSE,
      66/71 - confirming the shared-vector constraint and the empirically
      best answer were the identical one, not a compromise.
      (2) The corpus widening dropped 20 planned "paraphrase positive"
      rows entirely: `spec/llm/routing-corpus.json` is ALSO
      `tests/routingCorpus.test.ts`'s stub-embedder regression suite
      (bag-of-words, no real semantic generalization), and a genuine
      paraphrase only ever passes under the real model - all 20 failed
      the stub outright when tried. Landed instead: 32 real conversational
      negatives (the six live incident probe phrases among them) that
      hold under both the stub and the real embedder, plus 5 negatives in
      `spec/llm/tool-call-corpus.json` for Fix E's own future false-call
      measurement.
      (3) `TIER1_THRESHOLD` 0.62 -> 0.75 and `TIER2_AMBIGUOUS_FLOOR`
      0.45 -> 0.68, both set from the measured null-row distribution
      (p50=0.607 p90=0.659 p95=0.705 max=0.798 over 31 ordinary
      negatives - a corpus-row `noiseFloorExempt` flag, added after a
      code review caught the first cut of `scripts/bench/routing.ts`
      computing this stat over EVERY null row unfiltered, excludes the
      handful deliberately designed to score high: a `consequential`
      package's own trigger phrase and the `remember`/`recall`
      near-misses meant for Tier 2). One real, confirmed
      deterministic misroute this caught and fixed: "I can't decide what
      to wear today" won Tier 1 outright against `list-view` at the old
      0.62 threshold (score 0.74, margin 0.08) - gone at 0.75. `translate`
      manifest.json's own routing.examples swapped "translate good
      morning into french"/"...good night to italian" for non-greeting
      phrasing (real hygiene - "good morning" alone scored 0.80 against
      translate - though confirmed NOT a live misroute: `translate`
      requires an arg only a literal pattern's own wildcard capture can
      bind, so `canFire()` already rejected it from ever WINNING Tier 1
      regardless of score; it only ever reached Tier 2 as an offered
      candidate for the model itself to decide on). `backend/scripts/
      bench/routing.ts` now prints each row's top three scores and a
      null-row percentile summary with a recommended-floor line.
      A separate, pre-existing gap found while measuring, NOT fixed here
      (filed below): `ensureRoutingEmbeddings()` only ever ADDS missing
      embeddings for a package's CURRENT `routing.examples` - an example
      REMOVED from a manifest (exactly what the translate fix just did)
      leaves its own old, orphaned embedding row in `routing_embeddings`
      forever, still compared in every future `scoreByEmbedding()` call.
      Verified: full backend suite green, `tsc --noEmit`
      clean, `routingCorpus.test.ts` 107/107 against the stub,
      `scripts/bench/routing.ts` 107/107 against the real embedder with
      zero false positives (down from one).
Stale routing-example cleanup is tracked by [CHAT-09](#chat-09).

- [x] **Fix E: native tool calling, one round trip** (M-L) - shipped
      2026-09-07. Built per plan: `spec/llm/ts/types.ts` gained
      `ToolDefinition`/`ToolCallWire`/`ToolCallDelta` and the request/
      message/chunk-delta fields; `client.ts`'s `chatCompleteStream()`
      accumulates `delta.tool_calls` per index and returns the assembled
      calls as its own generator return value; `stubServer.ts` gained
      `scriptedToolCalls`; `engineAutotune.ts` passes `--jinja` explicitly
      (already the pinned binary's own default, confirmed live);
      `llm.ts`'s `complete()`/`startCompleteStream()` use native
      `tools`/`tool_choice` end to end, `toolCallSchema()`/
      `parseToolCalls()` deleted; `turnEngine.ts`'s `resolveToolCalls()`
      (renamed from `attemptTier2Tools()`, its own separate `complete()`
      call deleted) takes the model's already-decided `ToolCall[]`
      directly; `routing.tier` gained `"tool"` (additive, wire.ts +
      `routingStats()`). One real design decision asked of Jesse rather
      than assumed: `enginePostLoadCheck.ts`'s own tool-calling check
      warns (`toolCallingOk`), never hard-fails the spawn - it runs on
      every real household spawn, not just catalog curation, and the
      plan's literal "caught at spawn" wording would have blocked chat
      entirely over a Tier 2-only gap. One real streaming-path design the
      plan's own prose didn't spell out: `runTurnStream()` peeks the
      completion's first real step with one manual `.next()` (a
      tool-calling reply's `content` stays empty throughout, confirmed
      live) rather than blindly streaming, so the household never sees a
      typing indicator for a turn about to answer as a plugin instead; a
      real first text step is replayed into the SAME
      `gateGuards()`/`gateOutputSafety()` pipeline unchanged. Full "as
      built" writeup, including the exact live-verified wire shapes and
      the peek/replay design, in `docs/dev.md`'s Fix E section.
      **Measured, not assumed** (`scripts/bench/tool-calling.ts`, real
      engine, `MAIPAI_LLAMA_SERVER_URL` pointed at the household's own
      already-running process - never spawned a second one): 40/40
      (100%) across all 8 corpus rows, 5 repeats each, 0% false-call rate,
      well under the 2% bar - including "should I dye my hair black," the
      exact utterance that started this whole incident (the old grammar
      mechanism picked `music`; native tool calling correctly proposes
      nothing, 5/5). One real bug the bench itself had, caught along the
      way: its own hardcoded tool descriptions had drifted from the real
      bundled manifests, which single-handedly produced a 20% false-call
      rate on one row before the fix (a paraphrased "recall what's known
      about a topic" reading as a green light for a general-knowledge
      question) - fixed to load real manifests via `loadManifestOnly()`.
      Verified past what any bench measures too: a live, isolated-DB
      script drove `runTurn()`/`runTurnStream()` themselves against the
      real engine - a natural question answered with no call, and
      "Friday is pizza night, please remember" was offered as a tool,
      natively called, and `remember`'s real recipe actually ran (a real
      row written, confirmed in the `[turn]` log). `tests/tier2.test.ts`/
      `tests/toolCallCorpus.test.ts`/`tests/llm.test.ts` all rewritten
      against the native shape - one real test-quality bug caught while
      writing the new `tier2.test.ts` integration cases: an utterance
      starting with "remember" wins Tier 0's own literal pattern outright,
      so a first draft of "prove native tool calling runs the package"
      silently exercised the WRONG code path and still passed; fixed with
      a `routing.tier === "tool"` assertion (the one signal only
      `resolveToolCalls()` sets) plus rephrased utterances. Out of scope,
      unchanged from the plan: a second completion to phrase a tool
      result in the persona's voice; any agent loop.

      Code review (2026-09-07), fixed before landing: **a real
      correctness bug** - `resolveToolCalls()` validated a proposed
      call's id against the full `ranked` (every Tier 1 candidate)
      instead of the actually-offered subset (`prepared.tools`, capped
      at `MAX_TIER2_TOOLS_OFFERED`), so a call naming a real but
      un-offered candidate passed and ran - including reaching the
      confirm gate for a `consequential` package the model was never
      shown. Fixed by passing the offered id set explicitly; proven with
      a new regression test, confirmed to fail without the fix. Also
      fixed: `enginePostLoadCheck.ts`'s two independent completion calls
      now run via `Promise.all` instead of serially (roughly halves the
      added spawn latency); `complete()`/`startCompleteStream()` now
      explicitly null out a caller-supplied `response_format` whenever
      `tools` is offered, instead of relying only on a comment for a
      combination no real caller makes today;
      `scripts/bench/tool-calling.ts`'s `MAIPAI_BENCH_REPEATS` override
      falls back to the real default on an invalid (NaN) value instead
      of silently running zero repeats and reporting a false "0/0 (0.0%)"
      pass; `wire.ts`'s own doc comment corrected (`routing.score` for
      `tier: "tool"` is the pre-existing Tier 1 ranking score, not a
      measure of the model's own confidence, which nothing here
      measures); `runTurnStream()`'s `replay()` (the documented, tested,
      currently-never-observed edge case of a streamed reply pivoting
      from real text into a tool call partway through) now logs loudly
      if that ever actually happens instead of silently dropping the
      call, rather than the full return-value re-threading a real fix
      would need for a case never yet observed. Not fixed, filed below:
      the `"pattern" | "embedding" | "keyword" | "tool"` routing-tier
      union is a pre-existing duplicated inline literal across three
      files (Fix E only added the 4th value to an already-3x-duplicated
      pattern), a genuine but separate consolidation task.
RoutingTier consolidation is tracked by [CHAT-21](#chat-21).

Streaming recovery and trailing native calls are tracked by [CHAT-17](#chat-17); its fixed event-machine design supersedes the earlier retry proposal.

Bounded multi-source composition is tracked by [CHAT-15](#chat-15) and [CHAT-16](#chat-16). Dependent calls remain authored recipes.

- [x] **Wire the `embed` role into routing** (M) - shipped 2026-09-06,
      Session C step 1 (`lib/routing.ts`, `spec/llm/routing-corpus.json`,
      docs/dev/session-c.md). corrected 2026-09-05:
      the role itself is built and live-verified (nomic-embed-text on a
      second llama-server, `embedSupervisor.ts`), reachable only through
      a diagnostic route. What is missing is embedding `routing.examples`
      once at package load and matching by similarity (Tier 1), plus
      recall (see "Chat, memory and persona").
- [ ] **Plugin/recipe `ask`-continuation: let any plugin pause for a
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

## The chat program: assistant-ui Elements (2026-09-21)

The design record is `docs/plans/shell-on-shadcndashboard-2026-09-21.md`
("The wire the Elements expect", "The artifact record", "The turn-engine
tool"); read it first for the full contract each item below implements
one row of.

### The shell program: shadcndashboard, page by page

- [x] **SHELL-01: `/next` on the template's modern dashboard with Home's real data** (M)

    Objective: `/next` on the template's modern dashboard with Home's real data: engines status, updates, repairs, people, activity. Files: `frontend/src/next/pages/NextDashboardPage.tsx`, the engines, updates, repairs, people, and activity route or lib files, and `frontend/src/apps/home/*` plus the dashboard blocks in the kit that the row retires. Pattern to mirror: the first landed row; until one lands, `NextAppsPage.tsx` for the mount and the template's own view for the data hooks (SWR through its global-fetcher). Acceptance: the page shows Home's data in the template's view as shipped; nothing Home-drawn (the reviewer's first check); a test per data path; captures at 1440 and 390, both looks and themes, opened and judged. Out of scope: editing any vendored component; the old route, which stays until the switch. Exit check: `bash scripts/check.sh`.

    **Backend half landed 2026-09-21**: `GET /api/dashboard` (`backend/src/routes/dashboard.ts`, `lib/dashboard.ts`) is the one aggregate the page's widgets will read - `people_count`, `updates_available`, `recent_activity`, `turns_per_day` (a gap-free 30-day series) for every signed-in person, `repairs_open` and `engines` (Stack health severity counts) additive for owner/admin only.

    **Page half landed 2026-09-21** (code and tests): a real, named gap first - the vendored modern-dashboard widgets take no data at all (docs/plans/shell-on-shadcndashboard-2026-09-21.md's own SHELL-01 gap paragraph), so `NextDashboardPage.tsx` composes Home's own widgets from the SAME shipped primitives (`frontend/src/next/pages/dashboard/*`, one file per widget, each mirroring its vendored counterpart's JSX 1:1), reading `useDashboard.ts`'s one `@tanstack/react-query` hook. Only widgets with a real Home counterpart exist: greeting, people count, updates available, repairs open and engine health (owner/admin only, by field presence), turns per day (chart), recent activity (table) - no revenue/sales/orders/profit cards. `NextDashboardPage.test.tsx`, 6 cases.

    **Captures landed 2026-09-21** against 8787 on ui-v0.5.16 (A's CHAT-SDK-01 landing, HOME-UI-04f's own hairline/sidebar/outline fixes): 1440 and 390, dark and light, judged against dashboard-01's rhythm - the hairline grid, sidebar-inner border and sidebar-inset outline are all transparent as HOME-UI-04f intends, four stat cards in one row on desktop collapsing to a 2x2 grid on phone, chart and table stacked full-width below. Jesse's own household showed real, non-empty data throughout (populated turns-per-day curve, real recent-activity rows, no stuck loading state). `scripts/screenshot.ts --next-dashboard-review` is the permanent, re-runnable capture (the pair to `--next-people-review`) - the live-instance judgment is proven from there going forward, not from an ad hoc browser session.

- [ ] **LAT-00: every model call in a turn is recorded, with the engine's own timings** (S, first of the latency program, 2026-09-22). Diagnosis (the Fable session, measured on the dev hub): "hi" takes 3.3 to 5.5 s to its first word while the engine's share is about 1.5 s; the rest is a hidden second generation (LAT-01) and a prefix cache that breaks after the tools block (LAT-02), and neither shows in the logs today. The `[turn]` line and the row's `stats` gain a `generations` array, one entry per model call: reason (`initial`, `think_exhausted`, `fragment`, `no_tools_retry`, `guard:<reason>`), thinking, max_tokens, the engine's `prompt_n`, `cache_n`, `prompt_ms`, `predicted_n`, `predicted_ms`, and `request_sent_ms`/`first_delta_ms` from turn start. Files: `turnEngine.ts` (holdOpening, peekAndHandle, the guard retry closure, logTurnLine), `turnStats.ts`, `llm.ts` (keep per-call stats rather than overwriting `streamStats`). Also: the `[turn]` line gains a timestamp, and the engine's stdout is kept in a log beside hub.log. Test: a streaming turn with a scripted think-only first generation records two entries (`initial`, `think_exhausted`) and the first entry's timings survive. Acceptance: a live "hi" with thinking on shows both generations. Exit: `scripts/check.sh`.

- [ ] **LAT-01: thinking gets its own token allowance, so a short reply is generated once** (S, after LAT-00). **Folded into U3 2026-09-22** (`docs/plans/simple-turn-pipeline-2026-09-22.md`, "The chat rebuild" area above): this is U3's acceptance criterion, unchanged. Every thinking turn today spends two generations: the first runs with thinking on and `max_tokens = max_words*1.6+32` (56 tokens for a greeting; `turnEngine.ts` near :6165), the think block eats the cap, no visible text arrives, and the opening hold regenerates with thinking off (near :5843-5849); the row records only the retry. Fix: with thinking on, max_tokens is the plan's visible budget plus a named `THINKING_ALLOWANCE` (512 to start), or thinking is not sent for plans under a named word count. Test: the request-body assertion in the existing turn tests. Acceptance: "hi" and "what's 12 plus 30" with thinking on show one generation on the live hub. Exit: `scripts/check.sh`.

- [ ] **LAT-02: the offered tool set stays stable within a conversation, so the prompt cache survives** (M, after LAT-00). **Folded into U1 2026-09-22** (`docs/plans/simple-turn-pipeline-2026-09-22.md`, "The chat rebuild" area above): U1 fixes the set per model budget rather than growing it per conversation. Qwen3's template renders `tools` inside the first system message, ahead of the history, so any change in the offered set invalidates everything behind it; `selectOfferedTools` (`turnEngine.ts` near :1248) appends a per-turn Tier 1 candidate, and 9 of 12 turns on 2026-09-22 pinned `cache_reuse_tokens` at 567, re-reading 250 to 700 tokens (measured: the same conversation re-sent with two tools reordered cached exactly 567). Fix: the offered set is monotonic per conversation (an earned candidate stays offered, sorted), so the block changes at most once per new tool. Files: `selectOfferedTools` and its caller near :3284, a per-conversation sticky set. Test: two consecutive turns with different earned candidates give a second request whose tools are a superset in the same order. Acceptance: live `cache_reuse_tokens` grows with conversation length instead of pinning at 567; routing corpus unchanged. Expected with LAT-01: about 1 s to first word for "hi". Exit: `scripts/check.sh` plus the routing corpus replay.

- [x] **LAT-03: measure f16 KV cache against today's q8_0** (S, bench, needs an engine restart; done 2026-09-22: f16 is not faster, q8_0 prefilled at 411/405 tok/s against f16's 393/386 at about 285 and 911 prompt tokens on a one-slot side instance, three repeats each; no flag change; the table and the method are in `docs/dev.md`, "LAT-03"). The engine runs `-ctk q8_0 -ctv q8_0` with flash attention on Metal; the hub's effective prefill is 183 tok/s against 279 to 369 on direct probes of the same engine. Rerun the two-request probe with `-ctk f16 -ctv f16` (fit with 2 slots or `-c 16384`), record prompt tok/s at 300 and 1,000 tokens, and change `llmSupervisor`'s flags only if f16 wins by more than 30 percent. Numbers in dev.md with engine build, model file and a sanitized hardware line.

- [ ] **ADMIN-LAYERS-01: an admin sees each chat layer's health and can test each one** (M, after U2 and ADMIN-PERF-01; owner request 2026-09-22). Built on the rebuild plan's section 11 (`docs/plans/simple-turn-pipeline-2026-09-22.md`): every layer is a node with a typed contract and every turn carries one per-node trace. (1) **Health:** the admin performance page gains a Layers panel, one row per node (safety, commands, context, model, each tool, answer, output gate): implementation id and version, median and p95 time over the last 24 hours, error rate, the last error with its time; composed from the dashboard template's data table and chart wrapper, no hand-built UI. A node that turns slow or starts failing raises one health item on the one health list and one declared admin notification, the same detector and rules as PERF-ALERT-01. (2) **Test:** each node contract gains a `selfTest()` with a canned, fixture-only input and an expected property (never household data), run by `POST /api/admin/layers/:id/test` (zod-openapi, admin only) and a Test button per row plus Test all; the result shows pass or fail, time, and the node's own output summary. Swapping a layer's implementation is proven first by its self-test, then by the replay set. Acceptance: the panel shows real numbers on the dev hub, every node's self-test passes, a node forced to fail (a fixture engine that errors) shows red with its error and raises the health item; non-admin gets 403; captures at 1440 and 390. Exit: `scripts/check.sh`.

- [ ] **PERF-ALERT-01: the hub notices slow replies, tells an admin, and shows when it started and where the time goes** (M, design note first, with or right after ADMIN-PERF-01; owner request 2026-09-22). Why: on 2026-09-22 "hi" took 3.3 to 4.4 s to its first token for a 300-token prompt while every stage before the model took about 0.1 s, and nobody knew until the owner felt it. Pieces, all existing systems, nothing bespoke: (1) **Record where the time goes.** Each turn's stored `stats` (`turnStats.ts`) gains the stage split the log line already has (`TurnTimings`: routing, recall, prompt build) plus the engine's own `prompt_ms` and `predicted_ms` from the stream timings and the retry count, so "waiting on the engine", "the engine reading the prompt" and "a guard threw the first reply away" are separable after the fact. (2) **Detect.** A scheduler job (the backups' job list) every 5 minutes reads the last 20 model turns: slow when the median first-token time is over the admin's budget (a declared setting, `perf.first_token_budget_ms`, default 1500 for typed chat) OR over twice the same model's own 7-day median at a similar prompt size, for 10 minutes running. Recovers when under 1.3 times the baseline and under budget for 10 minutes. (3) **Tell.** One health item on the one health list ("Replies are slow since 2:14 PM: 3.9 s to first word, usually 0.8 s; most of it is the engine reading the prompt"), `started_at` fixed at the first slow turn, updated in place, cleared on recovery; and one declared notification event (`hub.replies_slow`, `time_sensitive`, audience admins, rate-limited to once per episode, a "Show me" action to the performance page) plus a `passive` "back to normal" when it clears. (4) **Show.** ADMIN-PERF-01's first-token chart shades each slow episode and breaks the median into the stages from (1). When the Stack runs the engines, its own health item for engine prefill throughput feeds the same list, never a second one. Acceptance: a test that a seeded run of slow turns raises exactly one health item with the first slow turn's time and one notification, that recovery clears it and sends the passive note, and that a single slow turn raises nothing; the stage split stored on a real turn on the dev hub; captures of the health item and the shaded chart. Out of scope: automatic remedies (restarting an engine is Repairs' own one-fix-per-item rule, a later decision). Exit: `bash scripts/check.sh`. Note for the design: ENGINEERING.md's performance budgets name no first-token budget today; the default above is proposed, and the standard gets the number once measured on the Studio.

- [x] **ADMIN-PERF-01: the admin's performance dashboard** (M, design note first, after DASH-CARDS-01) - **landed 2026-09-23.** Objective: an owner/admin page, `/next/performance` (reached from Settings' Manage section; the System card is DASH-CARDS-01's, not landed yet), that shows how the hub is doing over time, from data the hub already records or the engines already report: per turn, the LM Studio-class numbers (model, thinking on or off, time to first token, total time, generation tokens per second, prompt and completion tokens, context used, the route taken) aggregated as medians and p95 per day and per engine; the engines' health history (Repairs' own engine-sourced issues - no restart-history table exists); the memory and embedding queues (pending work, the CHAT-06 ingestion counts); the label harvest (guard hits, rule hits, the retire-eligible list from RVW-1b, read live rather than off the weekly export); disk and the Stack's hardware/roster state; a Layers panel (median/p95 per U2 trace node, the coordinator's 2026-09-22 addition, empty until `turn.pipeline.next` produces a traced turn). DASH-CARDS-01's card registry doesn't exist yet, so this ships as a plain page (panels under `frontend/src/next/pages/performance/`, ready to become cards later) rather than registry cards; the Stack's own job feed has no bulk-list endpoint, so that part of the objective is a named gap, not built. Backend: `GET /api/performance` (`backend/src/lib/performance.ts` + `backend/src/routes/performance.ts`, zod-openapi, admin only); no new collection; retention is `conversation.retention`'s existing daily purge (90 days), stated, not a second purge path. Full design note and the "Built"/found-gap notes: `docs/dev.md`. Acceptance: real numbers on the dev hub (proven empty-state correct, no live turns on this seeded backend), every panel links to its source page where one exists (Engines does; Storage has none yet, named), non-admin gets 403 and no rail/settings entry; captures at 1440 and 390, light and dark, taken and opened. Exit: `scripts/check.sh` green.

- [ ] **DASH-CARDS-01: the dashboard's cards are a registry with defaults by role, chosen per person** (M, design note first). Objective: one card registry (`frontend/src/next/pages/dashboard/cards.ts`: id, title, the role floor, the data it reads, default on or off per role), the dashboard rendering the person's chosen cards in their order, and a `ui.dashboard.cards` person-scope setting (a list of card ids, `select` multiple or the registry's list selector, declared once in `backend/src/settings/uiKeys.ts` and rendered by the settings renderer under Me) with a "Customize" action on the dashboard that opens that setting. Defaults, from the owner's rulings and the legacy dashboard's bones (glanceable state first, then shortcuts): for everyone: Today (date, the household's weather, the next reminder or timer), Pick up where you left off (the person's three most recent conversations), Your apps (the pinned apps, `ui.pinned_apps`), Notifications (unread count and the newest); for adults: Household (who is in it, a child's recent activity where the parent may see it); for the owner and admins: System (updates, repairs, engines and the last backup on one card, each linking to its page), Usage (turns per day). Every card reads an existing route or the dashboard route; a card with no data shows the template's empty state; nothing drawn by Home beyond the composition already used (Card, Table, the chart wrapper). Files: `frontend/src/next/pages/dashboard/*`, `NextDashboardPage.tsx`, `backend/src/routes/dashboard.ts` for the fields the new cards need (weather from the household location through the weather package, the next reminder from the scheduler, the recent conversations), tests for the role defaults and the chosen order. Out of scope: drag to reorder (the setting's list order is the order). Exit: `bash scripts/check.sh`, captures at 1440 and 390 for a child, an adult and the owner.

- [x] **DASH-LOOK-01: the dashboard is shaded like Settings, no dashed rules** (S). The stat cards and the two panels on /next render flat while the settings page's cards sit on the theme's card surface with a ring; a dashed divider runs under the stat row. Each stat becomes a Card on `bg-card` with its ring, the chart and the activity table each in a Card, and no `border-dashed` rule anywhere on /next (a kit-side rule if the class is a vendored one, a composition change if ours). Files: `frontend/src/next/pages/dashboard/*`, `frontend/src/next/pages/NextDashboardPage.tsx`, `commons/ui/src/tokens.css` if needed. Acceptance: 1440 dark capture judged beside /next/settings and shadcn's dashboard-01. Exit: `bash scripts/check.sh`.

    **Landed 2026-09-21**: the flatness wasn't a missing rule but a real vendored wrapper - `StatCard.tsx`/`TurnsPerDayChart.tsx`/`RecentActivityTable.tsx` were built on `components/shared/dashboard-card.tsx`'s `DashboardCard`, which explicitly overrides `Card`'s own `bg-card`/`ring-1` with `bg-background`/`ring-0` (the flat KPI-row look the template's own demo widgets want); switched all three to the plain `Card` primitive directly, no vendored file touched. The dashed row was `StyleDivider`'s own dotted decorative strip (`components/shared/divider`, also vendored) - removed from `NextDashboardPage.tsx` entirely rather than replaced, since every card now carries its own visible ring and a divider between them competed rather than helped. Folded in as BRAND-01 (commons `ui-v0.5.22`, cut in a `commons-b` worktree): `FullLogo`'s and `Logo`'s own asset imports now carry MaiPai Home's real logo/icon mark instead of the template's "Shadcn Dashboard" wordmark - a vendor-time branding-data edit, the same class as `sidebaritems.ts`, not a component fork; the sidebar's hardcoded `V.1.0` `Badge` is stripped as demo content (Home's real version lives on `/next/updates`). Full record in `commons/ui/docs/dashboard-upstream.md`'s own "Brand assets" section and `CHANGELOG.md`. home-b's pin bumped `ui-v0.5.18` -> `ui-v0.5.22` (`ui-v0.5.21` was cut once, missed bumping `ui/package.json`'s own version, caught by the gate's version/tag check, and was superseded before a fix landed by another lane's `ui-v0.5.22` - deleted rather than left broken since it never had a working consumer).

    **BRAND-01 follow-ups, landed 2026-09-21 (commons ui-v0.5.23)**: found live on 8787. The wordmark pair looked undersized - `preserveAspectRatio="xMidYMid meet"` inside a `viewBox` that didn't match either source PNG's own ratio letterboxed the art inside `FullLogo.tsx`'s fixed `width={100} height={32}` slot, a box that can never grow past that (the attribute wins over `max-w-[120px]`, which never actually engages); both files now use `preserveAspectRatio="none"` to fill that fixed box edge to edge. The rail's own header row sat 1px lower than the top header's - `tokens.css`'s `[data-slot="sidebar-inner"]` deviation rule made the sidebar's own 1px border transparent but left its width alone, and a border occupies its own layout space whether visible or not; now `border-width: 0`. Rail restructuring (owner ruling, same batch): `sidebaritems.ts` drops the System group (Settings alone) and the whole Manage group (Engines, Updates, Repairs, Backups) - those four routes stay real and reachable, from the dashboard's own stat cards (now real `Link`s, `StatCard.tsx`'s own `to` prop) and from a new `NextManageSection` at the bottom of Settings' own Household tab, not permanent rail weight; `NavUser.tsx` (the rail's bottom slot, the same vendor-time-data class as `sidebaritems.ts`) drops the template's own "Help Center"/"Documentation" demo links for Settings (moved down from the retired System group) and Help (Home's own user guide, linked via GitHub - HELP-AI-01, this doc's UI/shell section, is the real in-app version). Tests: link-href assertions in `NextDashboardPage.test.tsx` and `NextSettingsPage.test.tsx`, both now wrapped in `MemoryRouter` (a real router context, not just a click handler, is needed the moment a `Link` renders).

- [ ] **TABLES-01: Home's data table, composed from the template's Table primitives** (M). The shipped `DataTable` carries a literal "Employee Data Table" title, a demo search placeholder, a download icon and a dead pencil/trash Action column on every /next data page (apps, people, engines, updates, repairs, backups). One `NextDataTable` composition in `frontend/src/next/components/` mirrors DataTable's markup line for line (header row, sortable columns, pagination footer, rows-per-page select, the same classes) with a real title prop, search only where a page has something to search, no download icon, an Action column only when a page has a real handler (none yet). The six pages move onto it; the plan's gap paragraph records DataTable as retired from our pages. Acceptance: all six captured at 1440 dark and judged; tests for sorting and paging on the composition. Exit: `bash scripts/check.sh`.

- [ ] **SHELL-02: `/next/chat` on assistant-ui's Elements with Home's real data** (L)

    Objective: `/next/chat` on the template's Elements with Home's real data: capability by capability against the chat's wiring table, starting with reply text, reasoning, tool call, and sources. Files: `frontend/src/next/pages/NextChatPage.tsx`, the existing model, history, thread-list, suggestion, attachment, dictation, and artifact route or lib files, and `apps/chat/thread.aui.tsx`, `chatDocumentPane.tsx`, and the kit's `.aui` files that the row retires. Pattern to mirror: the first landed row; until one lands, `NextAppsPage.tsx` for the mount and the template's own view for the data hooks (SWR through its global-fetcher). Acceptance: the page shows Home's data in the template's view as shipped; nothing Home-drawn (the reviewer's first check); a test per data path; captures at 1440 and 390, both looks and themes, opened and judged. Out of scope: editing any vendored component; the old route, which stays until the switch. Exit check: `bash scripts/check.sh`.

    **First slice landed 2026-09-21**: `/next/chat` mounts the vendored Elements `Thread` (`ui/src/elements/thread.aui.tsx`, self-contained - composer, messages and reasoning render from one mount) on a minimal `useLocalRuntime` built from the existing `createChatModelAdapter` - one real end-to-end turn, reply text and reasoning both rendering. `chatModelAdapter.ts` itself gained two things this slice needed: the `reasoning` wire event (REASONING-01, previously discarded client-side with no Element yet to render it) now builds a `ReasoningMessagePart` alongside the text part on every yield; and a new `speakReplies` deps flag (default `true`, so `ChatPage.tsx`'s own established behavior is unchanged) skips the adapter's TTS scheduling entirely, since this slice's composer has no "stop speaking" control on screen for a reply to hand one to yet. `consumeThinking: () => true`, always on (no "Think longer" toggle exists on this composer yet) - the only way this slice can prove a live reasoning Element renders in ordinary use, not just a test's own scripted event. The crisis-resources banner uses the kit's own shipped `Alert`/`AlertDescription` (`dashboard/components/ui/alert.tsx`), not a hand-rolled div (a code review, 2026-09-21, caught the first draft copying `ChatPage.tsx`'s pre-existing hand-rolled markup). History, the thread list, attachments, suggestions, tools, artifacts and read-aloud are each their own follow-up slice (the wiring table's remaining rows), not wired here - no thread list means no `getConversationId` either; the backend starts a fresh conversation itself when the first turn carries no `conversation_id`. Exit: `bash scripts/check.sh`.

    **Slice 2 landed 2026-09-21 (history and the thread list)**: `getConversationId` is real now (`aui.threadListItem().initialize()` + `api.resumeConversation`, `useRemoteThreadListRuntime`'s own `runtimeHook` - ChatPage.tsx's exact, already-proven pattern), so the page moved from `useLocalRuntime` to `useRemoteThreadListRuntime` over the existing `chatThreadListAdapter.ts` (unchanged - already correct: list, rename, delete, `updateCustom({pinned})`, and a deliberate refusal of archive since "the shared record has no archive state"). `NextThreadList` composes `thread-list.aui.tsx`'s own exported sub-parts (`ThreadListRoot`/`New`/`Search`/`Items`, its own implementation mirrored exactly) rather than the all-in-one shipped `ThreadList`, so New Thread's own click can close the phone/tablet Sheet too (`ThreadListPrimitive.New`'s own onClick composes with, never replaces, one passed in - confirmed in the installed source) - a code review caught selecting an EXISTING thread not closing the Sheet either, both now match ChatPage.tsx's own `onThreadIdChange`. One shared element reference mounts it twice (ChatPage.tsx's own fix for two call sites drifting) - a persistent rail on desktop, the Sheet on phone/tablet. No Pin: the shipped Element's own "more" menu is Rename/Archive/Delete, not Rename/Pin/Delete like the OLD shell's hand-built thread list - the vendored file is used exactly as shipped, never forked to add one. `NextChatPage.tsx` now takes a required `person: Roster` prop (`NextRoutes.tsx` passes it) - `chatThreadListAdapter.ts`'s own `selfName` param for reload-time message attribution. Found live verifying this slice, filed rather than fixed here (getmaipai/home#129): clicking Archive can't succeed (the adapter's own deliberate refusal) and the runtime doesn't restore the active thread after rolling the optimistic update back, so it silently lands on a blank new chat - no data loss, just a confusing jump, and not this slice's call to solve (it needs either a real archive spec, a runtime-level "don't navigate away on a rolled-back optimistic update" fix, or an owner ruling to drop Archive from the menu across all vendored thread lists, none of which are a "compose the shipped parts" job). Exit: `bash scripts/check.sh`.

    **Slice 3 landed 2026-09-21 (tools and generative UI)**: weather's and almanac-date's own structured result (`wire.ts`'s `structured_part`) becomes a real `ToolCallMessagePart` on the `done` event (`chatModelAdapter.ts`), `toolName` the producing package's own real id (`structured_part.tool_id`, new and additive on the wire, set by `composer.ts`'s `structuredPartForOutcomes` at the call site - no `args`/`argsText` since the wire never carries a tool's own call arguments). `NextChatPage.tsx` registers the shipped `SpecSheet` Element for those two tool names via `useAssistantToolUI`, `display: "standalone"` - found live that omitting it tucks the card behind a collapsed "1 tool call" trigger nobody would click to see today's weather. Any other tool call still renders through Thread's own built-in `ToolFallback`, unchanged; a plain-text reply is unaffected. `scripts/screenshot.ts` gained `--next-chat-tools-review`: a real weather question (place included - a review caught the first draft's place-free phrasing never matching `weather/manifest.json`'s own "in \<place\>" routing patterns) resolves deterministically through `seedHousehold()`/`seedWeatherCache()`'s already-seeded fixtures, no scripted LLM reply needed since `structured_part` comes from real package outcomes, never the model's own text. Found live verifying this slice, filed rather than fixed here (getmaipai/home#130): `structured_part` is computed fresh on the live `done` event but never persisted, so a spec-sheet card reverts to plain text on reload - `chatHistoryAdapter.ts` has nothing to rebuild it from. Exit: `bash scripts/check.sh`.

    **Slice 4 landed 2026-09-21 (artifacts)**: `TurnValue.artifact` (`{id, version}` only, never the body - already minted by `composer.ts`'s `artifactForOutcomes`) becomes a real `ToolCallMessagePart` on the `done` event (`toolName: "write_document"`, the one bundled package that writes this record today), the same shape `conversationHistory.ts`'s reload row now carries too (a new `GET /api/artifacts/{id}/current` route, backend/src/routes/artifacts.ts, resolving through the artifact's own Home-internal `artifactKey` - never the client) - so `chatHistoryAdapter.ts`'s rebuilt message and the live one are identical, and this slice survives reload where #130's `structured_part` does not. `NextChatPage.tsx` registers the shipped `ArtifactCard` Element for `write_document`, `display: "standalone"`; clicking it opens `CanvasSplit` beside the thread on desktop or as a bottom Sheet on phone/tablet (mirroring the retired `chatDocumentPane.tsx`'s own split), fed by the same `/current` route so a later turn updating the same artifact id replaces the pane's content on its own (an effect invalidates the query whenever the thread's own message count changes - no id bookkeeping needed, the route always resolves to whatever version is current). A code review caught a second real bug this same pass: switching threads left a previous conversation's artifact canvas open over the new one (now cleared in the same `onThreadIdChange` callback that already closes the phone/tablet Sheet), and the card's own meta line stuck on "Loading..." forever on a failed fetch instead of showing an error.

    **Found live verifying this slice, not fixed here (getmaipai/home#131)**: `write_document` cannot actually create a document on a real turn at all today - `host.artifact.create()` needs the turn's own row in `conversation_turns`, but that row is written by `logTurn()` only after the whole turn (including this tool call) finishes composing, so the insert always fails (a real `SQLITE_CONSTRAINT_FOREIGNKEY`, confirmed with a real `runTurn()` call rather than the existing tests' own pre-inserted-row pattern, which is why nothing had caught this). One layer of it - `createHost()`/`runPlugin()` used to look up the turn's `conversationId` via a DB query that was equally always empty - is fixed alongside this slice (`conversationId` now threaded straight from the caller's own turn context, backend/src/lib/packageHost.ts, plugins.ts, and turnEngine.ts's own runPlugin() call sites); the deeper foreign-key ordering problem is still open, filed as #131 with both real fixes it needs (drop the hard FK, or give a turn a real row before its own tool outcomes run) named but not attempted, since both are bigger and riskier than this slice's own scope. This means the UI side of this slice is proven only against a scripted wire response shaped exactly like a real one (`chatModelAdapter.test.ts`/`chatHistoryAdapter.test.ts`/`NextChatPage.test.tsx`'s own new artifact tests, all passing against the real `write_document` `toolName` and a real `{id, version}` shape) - `scripts/screenshot.ts`'s new `--next-chat-artifact-review` (a real "Could you write me a short note about pizza night?" turn, routed through the real ranking so `write_document` is actually offered - `utteranceShape.ts`'s own `COURTESY_PREFIX` is what lands `shape: "command"`, since write_document has no `routing.patterns` of its own for `commandOpenersFrom()` to read) is written and will work as soon as #131 does, but cannot pass today: not this slice's own bug, but its acceptance ("prove with a real turn on 8787") can't be met until it's fixed. Exit: `bash scripts/check.sh`.

    **Slice 6 landed 2026-09-22 (the composer's "+" menu and dictation)**: `composerAddMenu.tsx` (new) is the composer's one attach control (`ComposerAddAttachmentOverride`, commons ui-v0.5.34 - the shipped bare `ComposerAddAttachment` would otherwise render a second "+" beside it) - Add photos and files (the real `ComposerPrimitive.AddAttachment`, the runtime's attachments adapter now a `CompositeAttachmentAdapter` of the existing local image adapter plus the shipped `SimpleTextAttachmentAdapter` for text/Markdown, client-side only, no route needed), Take a photo (phone-only, `useComposerAddAttachment()`'s own hook plus the native `capture` attribute - no shipped primitive exposes it), and the Apps group (`GET /api/plugins`, `AppsPage.tsx`'s own `kindStyle()` reused for the icon, no icon field on the manifest). The dictation mic needed no new UI at all - `useNextChatRuntime` now passes the real `dictationAdapter`/`attachmentsAdapter` `ChatPage.tsx` already had, and the kit's own `ComposerAction` renders the shipped Dictate button automatically once `thread.capabilities.dictation` is true. Create image, Web search, and choosing an app's actual effect on the turn (an additive `package_scope` field, `api.streamTurn`, not read by `routes/turn.ts` yet) sit behind a new module-level flag (default off, a test-only `__setUnwiredControlsForTests` setter, no other override) - built and unit-tested with it forced on, never visible in a real household until their own wire lands (tracked: COMPOSER-DOC-ATTACH-01 below for PDF/office attachments, U2's own turn-request fields for search/scope). The waveform+chevron live voice control (`composerVoiceControls.tsx`, new) is HANDSFREE-01's own row - built and unit-tested standalone but not mounted here, since `ComposerAction`'s right group has no append point yet (see HANDSFREE-01). `scripts/screenshot.ts` gained `--next-chat-composer-review`. See `docs/dev.md` for the full record and `git show --stat HEAD` for the file list.

- [ ] **COMPOSER-DOC-ATTACH-01: PDF and office documents in the composer's Add menu** (M). SHELL-02 slice 6 found this real: `documentExtraction.ts`'s Tika extraction (ATT-01b) and `attachments.ts`'s `createAttachment`/`readAttachment` (ATT-01c) both exist server-side, fully built, but nothing wires either to a route or to a turn's own content parts - a grep of every route file for `createAttachment`/`extractAttachment` at slice 6 time came back empty, and `routes/turn.ts` has no attachment-id field at all (today's only working attachment path, images, never touches this code: it inlines a base64 data URL straight into the message, client-side only, same as text/Markdown does through the shipped `SimpleTextAttachmentAdapter`). Needs: an upload route that calls `createAttachment`, a turn-wire way to reference an uploaded attachment id (additive, per Compatibility), and `composerAddMenu.tsx`'s "Add photos and files" widened from image+text/Markdown to accept PDF/office types once that path is real. Acceptance: a PDF added in the composer reaches the model as extracted text, a corrupt or unreadable file is refused with a one-line reason, a test per case. Exit: `bash scripts/check.sh`.

- [x] **CHAT-UI-01: five findings on /next/chat with the rail collapsed** (S)

    Objective: Jesse's own five findings, live, comparing /next/chat with the rail collapsed against ChatGPT. Files: `frontend/src/next/pages/NextChatPage.tsx`, `frontend/src/shell/tokens.css`. Exit check: `bash scripts/check.sh`.

    **Landed 2026-09-21**: (1) collapsed section labels render as literal `"..."` and expand to the full word on hover - traced to `nav-collapse/index.tsx` (the vendored template's own hand-rolled section-heading renderer, a hardcoded string plus a `group-hover` swap, confirmed by reading the file directly), a genuinely different component from the primitive `SidebarGroupLabel` a few files over, which already fades labels out cleanly with no dots and no hover-reveal - the demo shows dots too, so this is the template's own default, not local breakage, and no clean composition-level fix exists (nothing to reach through: the two spans have no class or attribute a global rule could target without also hitting every other `group-hover:hidden` use in the app). Named as a real deviation, not fixed, per its own escape valve. (2) the thread-list column sat ~75px into empty space once the rail freed more width than FullLayout.tsx's own `.container` (`max-w-[1367px] mx-auto`, a fixed cap on every /next page's `<Outlet/>`) used - fixed with a scoped `.container:has([data-slot="next-chat-shell"]) { max-width: none; margin-inline: 0 }` in tokens.css (Home's own Tailwind root, not the vendored file), reached through the one marker NextChatPage.tsx's own top-level element now carries. (3) the composer bounced while scrolling to the bottom - two real causes, both fixed: FullLayout's own wrapper around `<Outlet/>` is `min-h-*` not `h-*`, so a growing composer or a streaming reply could push the whole page taller for a moment (fixed: `overflow-hidden` on `next-chat-shell`, a hard ceiling now); and the Footer right below `<Outlet/>` always leaves the page a sliver of real scroll range, which the thread viewport's own scroll chained into at its boundary and rubber-banded back from (fixed: `overscroll-behavior-y: none`, scoped the same way as (2)). (4) a ChatGPT-style collapse for the thread-list column: the shipped `Sidebar` primitive's own collapsible modes render `position: fixed` against the true viewport edge - built to be a page's one top-level sidebar, not a second column nested beside one already there (it would render under or over the app rail) - so this reuses the identical plain-toggle pattern the file already had for the phone/tablet Sheet, not the primitive's own state machine. No hover-peek: the primitive has none to reach for (`SidebarRail`'s own hover only tints its divider line), so per its own fallback that gap is named, not hand-built. (5) a centered date/time divider after a long gap between turns: the catalog's `day-separator.tsx` exists but owns an entire message list's own bubble rendering rather than being an injectable divider for Thread's own per-message flow (which this shell already relies on for reasoning, tool calls and artifacts) - no composable divider atom exists for this composition today, named as a gap rather than forked or hand-rolled. `NextChatPage.test.tsx` gained a case for (4). Exit: `bash scripts/check.sh`.

- [x] **CHAT-UI-02: the desktop rail toggle stops spending its own row, and gains hover-to-peek** (S)

    Objective: Jesse's own screenshot of CHAT-UI-01 finding 4's toggle, sitting on a row of its own above the thread-list column and wasting it. Files: `frontend/src/next/pages/NextChatPage.tsx`. Exit check: `bash scripts/check.sh`.

    **Landed 2026-09-21**: the toggle now rides the row it already has - open, it's inside the column's own top row beside New Thread (`NextThreadList`'s new `collapseToggle` prop); collapsed, the same control floats top-left over the chat area's own top padding (ChatGPT's placement), so no row is spent either way. The header row above it is now `lg:hidden`: its only other button (the mobile Sheet trigger) was already invisible on desktop, so the row itself was dead space there even before this item. Hover-to-peek, the gap CHAT-UI-01 named rather than built: hovering the collapsed toggle shows the thread list as an overlay over the chat area, through the shipped `HoverCard` (Base UI's `PreviewCard`), not hand-rolled `mouseenter`/`mouseleave` state - a review on the first draft caught two real bugs the shipped primitive doesn't have: a dead zone in the gap between the button and an absolutely positioned overlay div (a plain wrapper's hover box excludes an out-of-flow descendant, so the pointer crossing that gap read as leaving), and no keyboard/focus path at all. `open`/`onOpenChange` stay controlled only so `aria-expanded` can mirror Base UI's own decision; the hover/focus/close logic itself (floating-ui's safe-polygon tracking) stays entirely inside the primitive. A click on the toggle still pins the column open, independent of the hover card's own state, and resets the mirrored peek flag so a later collapse never mounts already "open" from a stale one. Four cases in `NextChatPage.test.tsx`: open (toggle beside New Thread, no overlay in the DOM), collapsed (floating toggle with `aria-controls`/`aria-expanded="false"` wired to the not-yet-mounted overlay), peeked (hover mounts the overlay and its own New Thread button, `aria-expanded` flips to `"true"`, leaving unmounts it again), and a click-still-pins case.

    **Follow-up 2026-09-21** (Jesse's own screenshot: the peek read as "some odd popup"): `HoverCardContent`'s own card chrome is overridden to the column's exact look - `w-64`, the same `h-[calc(100vh-140px)]` the chat shell itself uses, `bg-background`, `border-r border-border`, no rounding, no shadow, no ring - and repositioned (`side="bottom" align="start" sideOffset={-40}`) so it starts flush with the toggle's own top-left corner instead of floating below it with a gap. The toggle's own `z-20` is now `z-[60]`, above the popup's shipped `z-50` - found live, the popup was painting over the one control that closes or pins it. Verified with a real hover on 8787: the peek now spans the same height as the open column, with the identical background and right border, and both close-on-leave and pin-on-click still work.

    **Rebuilt 2026-09-21** (Jesse's own pixel-level feedback, three rounds): the HoverCard/floating-ui approach above never reached pixel parity - side/align/offset math against the trigger's own rect measured live at x:537 and x:304 against the real column's own x:272, and overriding Base UI's own Positioner element directly (once the actual positioned node was correctly identified - the Popup itself is `position: static`, its parent Positioner is what floating-ui really places) still failed silently, since the override effect ran before Base UI had portaled `#next-chat-rail-peek` into the DOM at all. Dropped the floating placement entirely, per Jesse's own literal spec: the column (`next-chat-rail`) is now one DOM node that always lives in the page's own layout at its own slot, repositioned between three states with plain Tailwind classes and no JS-measured rect - open is normal flex flow, collapsed is `hidden`, peeked is the SAME node with `absolute inset-y-0 left-0` inside the row's own `relative` box, at its normal open width, above the thread. The peeked box is pixel-identical to the open box by construction (verified live: both measure `{x:272, y:81, width:256, height:683}`), not by measurement. The toggle went through two more rounds: first a single floating button fixed at the row's own top-left in every state (still painted a visibly oversized control over New Thread), then split into two mutually-exclusive instances per Jesse's 22:22 correction - open and peeked render it INLINE, first cell of `NextThreadList`'s own header row, the same icon-button size as the row's other controls; only the collapsed state (no row left to be inline with) falls back to an identically-styled floating instance at that row's former top-left. Closing the peek moved off a `display: contents` wrapper (found live: it never received the browser's own pointerleave - a `display: contents` element has no box for Chromium's hover-tracking to hit-test against) to a plain `onPointerLeave`/`onBlur` on the rail div itself, since the toggle is now a real descendant of it when peeked, so the native ancestor-chain firing needs no manual dead-zone check. `NextChatPage.test.tsx`'s four cases were rewritten for the new structure (happy-dom computes no real layout, so "peeked equals open" is proven structurally - same node reference across states, the peeked classes anchoring it to `left-0`/`inset-y-0` against the same positioned ancestor the open flow starts at, the same `w-64` in both - rather than by a measured rect). Live probe on 8787: open rail, collapsed toggle, and peeked rail all measured `{x:272, y:81}`; the peeked rail's full box exactly matches the open rail's `{256, 683}`; the app header's own bottom edge (y:65) stays above the peeked overlay's top edge (y:81) in every case; real mouse movement confirmed no dead zone moving from the toggle into the rail, and closes correctly moving out to the thread/composer area.

- [x] **ADMIN-COMPARE-01: tell whether a dumb reply is the model or the pipeline** (M)

    Objective: an owner/admin's own diagnostic - (a) an admin-only action on any assistant message re-sends its user message and history to the chat role bare (one plain system prompt, thinking on, no routing, no packages, no persona, no guards but the unconditional minor safety pass), opening a two-column compare (ours vs bare, with the trace) in the canvas-split Element; (b) a per-conversation `bare: true` switch on the real turn request so an admin can run a whole conversation both ways. Files: `backend/src/routes/turnBare.ts`, `backend/src/lib/conversationHistory.ts`, `backend/src/lib/turnEngine.ts`, `backend/src/lib/turnStats.ts`, frontend chat/kit wiring (not yet started). Exit check: `bash scripts/check.sh` in home and commons.

    **Landed so far, 2026-09-21 (backend only, feature (a)'s one-off compare)**: `POST /api/turn/bare`, `requireAuth` plus an inline `isOwnerOrAdmin` gate, `buildConversationWindow(conversation, { excludeTurnId, beforeCreatedAt })` (the new `beforeCreatedAt` option, so comparing a turn that isn't a conversation's newest doesn't leak later turns into "the same history" - a medium review caught the narrower id-only exclusion, together with a missing `turnId` on `gateOutputSafety`'s own per-turn notification dedup; both fixed, re-reviewed clean) for history, `startCompleteStream` for the bare completion, `gateOutputSafety` unconditionally for the safety pass (age-banded off the ORIGINAL turn's own speaker, never the admin), streamed as NDJSON (`trace`/`reasoning`/`delta`/`refused`/`done`), nothing persisted. The trace line reads straight off the turn's own row (`rung`, `rules`, `routing_tier`/`routing_score`, `guard_reason`, `source`, `plugin_id`/`command_id`, `stats`) plus a fresh `resolvePersona`/`composePersonaPrompt` call for "persona fragments in effect" (the household's CURRENT setting, not necessarily what was active when the original turn ran, since persona isn't stored per-turn). `TurnStats` gains a `thinking: boolean` field for the trace's own "thinking on/off" line - `buildTurnStats()` threaded through the three `logTurnSafely()` call sites that already produce stats, no migration (an existing JSON-in-a-text-column field, the same as every other `stats` field). Tests: the admin gate, the no-store rule, the minor safety pass (refused on a child's own turn, and unconditionally on the admin's own conversation too, proving it isn't conditional on bare mode), and the `beforeCreatedAt` fix's own regression case.

    **Landed since (this line was stale, drifted, and is corrected here rather than in a drive-by, per the org's own "update in the same commit" rule)**: feature (a)'s frontend half - `CompareWithBareModelMenuItem` (the admin-only "..." menu entry) and `BareCompareCanvasPanel` (the two-column compare view, canvas-split Element) - landed alongside slice 5's own chat work, undocumented here until now.

    **Landed 2026-09-22 (feature (b) in full)**: the per-conversation `bare: true` switch, wired into the real `POST /api/turn/stream` request, not a separate endpoint. `backend/src/lib/bareCompletion.ts` (new) is the one implementation of the bypass both features now share - persona, routing, packages and the quality guards (`guardReply()`) removed; the safety floor (`gateOutputSafety()`) never removed, and not a parameter of the function at all, so there is no exported way to obtain the bypass's raw, ungated tokens ("unskippable by construction," COORDINATOR's own bar). `backend/src/lib/turnBareStream.ts` (new) is `runBareTurnStream()`, a sibling to `runTurnStream()` built entirely from already-shared pieces (`resolveOrCreateConversation`, `buildConversationWindow`, `acquireTurnLease`, `fallbackSignal`), never a branch inside `turnEngine.ts` itself. Three gates, all asserted: admin-only and never-a-minor (checked at the route, checked again inside the function as a structural backstop, and implicitly by `resolveOrCreateConversation`'s own ownership rule, which makes the turn's speaker always the actor). `conversation_turns.bare` (migration 0060, hub-internal, no spec change) is the durable per-turn marker; the switch itself is ephemeral, session-local React state - it does not survive a reload or a conversation switch, so a mode that changes what the assistant IS can never silently outlive the investigation that turned it on. A persistent banner (`role="status"`, no dismiss control) stays visible the whole time it's on. The memory judge excludes a bare turn twice (`judgeStatus: "skipped"` at write, and `pendingTurnWhere()`'s own `eq(bare, false)`, belt and suspenders). A "Bare model" badge shows on the message, live or reloaded.

    Two review passes (one high-effort, focused on the safety floor specifically) caught four real defects before landing, all fixed: the lease leaked on an engine-unavailable failure that returned instead of throwing (try/catch became try/finally, matching `runTurnStream()`'s own reasoning for why it uses one); `Cancel` didn't actually stop a bare-mode generation (no `AbortSignal` was threaded through - now is); `crisis_signal` was never written on the row regardless of what the bare reply actually said, breaking `conversationInCrisis()`'s own 10-turn continuity check; and the persistence write had no `try/catch`, unlike the real pipeline's `logTurnSafely()`, so a transient DB failure would have surfaced as a failed turn to the admin even after a successful reply. A frontend-only bug found the same way: sending a bare-mode message unconditionally consumed the composer's own Instant/Thinking selection even though bare mode ignores `thinking` entirely, a confusing side effect on a value the request never read - fixed by skipping the consume for a bare send.

- [x] **SHELL-03: `/next/apps` on the template's data-tables view with Home's real data** (M)

    Objective: `/next/apps` on the template's data-tables view with Home's real data: packages list, install and remove. Files: `frontend/src/next/pages/NextAppsPage.tsx`, the packages route or lib file, and `apps/apps/*` plus `ThingsTable` that the row retires. Pattern to mirror: the first landed row; until one lands, `NextAppsPage.tsx` for the mount and the template's own view for the data hooks (SWR through its global-fetcher). Acceptance: the page shows Home's data in the template's view as shipped; nothing Home-drawn (the reviewer's first check); a test per data path; captures at 1440 and 390, both looks and themes, opened and judged. Out of scope: editing any vendored component; the old route, which stays until the switch. Exit check: `bash scripts/check.sh`. Fed by: GET /api/plugins (backend/src/routes/plugins.ts), the same list the old Apps page reads.

    **Landed 2026-09-21**: `GET /api/plugins` already existed and is the exact route `AppsPage.tsx`'s own `pluginsQuery` reads today - no new backend route was needed. `NextAppsPage.tsx` maps each `InstalledPackage` into a plain row (name, category, type, version, a real Ready/Attention status via `packageState()`, exported from `AppsPage.tsx` so both routes read the identical rule) and hands it to the template's own `DataTable`, which genuinely takes a `data` prop and derives its own columns - unlike the dashboard's demo widgets, no gap-composition was needed to get real rows and columns onto the page. Two narrower gaps found and named in the plan doc: `DataTable`'s own header is a hardcoded "Employee Data Table" string with no title prop (fixed with a real `CardHeader`/`CardTitle` above it, the shipped primitives every other `/next` page's own header already uses - the vendored file itself is untouched); its per-row Action column's pencil/trash icons have no click handler wired to either at all, so real install/remove stays on `AppsPage.tsx` until a shipped table with an actions callback exists to move it to. `NextAppsPage.test.tsx`, 4 cases. Captures at 1440 and 390, dark and light, against a real backend: page 1 of 4 of real bundled packages (Define, Translate, Joke, Lights On, Timers), real category badges, real Ready status, sortable and paginated as shipped. `scripts/screenshot.ts --next-apps-review` is the permanent capture.

- [ ] **APPS-VIS-01: a person sees only the packages they may invoke** (S)

    Objective: `GET /api/plugins` filters its own list by the requesting actor's role before returning it, so a child's Apps list excludes packages their role can't invoke, on both the old shell (`AppsPage.tsx`) and `/next/apps` (`NextAppsPage.tsx`) at once, since both already read the identical route. Files: `backend/src/routes/plugins.ts`'s `GET /` handler. Pattern to mirror: `meetsMinRole()`, already used to gate whether a package can run (`lib/plugins.ts`'s `runPlugin()`, `lib/widgets.ts`, `lib/turnEngine.ts`) - the identical check, just moved earlier, to what's listed rather than only what's invoked. Found landing SHELL-03 (2026-09-21): `min_role` today gates invocation only; nothing filters the list itself, on either shell, so a child currently sees every installed package including ones they can't run. Acceptance: a child actor's `GET /api/plugins` response excludes any manifest whose `min_role` they don't meet; an owner/admin sees the unfiltered list; a test per role tier. Out of scope: hiding a package from routing/chat (already correctly gated); the Action column's install/remove wiring (SHELL-03's own separate gap). Exit check: `bash scripts/check.sh`.

- [x] **SHELL-04: `/next/people` on the template's user-profile and data-tables views with Home's real data** (M)

    Objective: `/next/people` on the template's user-profile and data-tables views with Home's real data: people, memories tab. Files: `frontend/src/next/pages/NextPeoplePage.tsx`, the people and memories route or lib files, and `apps/people/*` plus `apps/memories/*` that the row retires. Pattern to mirror: the first landed row; until one lands, `NextAppsPage.tsx` for the mount and the template's own view for the data hooks (SWR through its global-fetcher). Acceptance: the page shows Home's data in the template's view as shipped; nothing Home-drawn (the reviewer's first check); a test per data path; captures at 1440 and 390, both looks and themes, opened and judged. Out of scope: editing any vendored component; the old route, which stays until the switch. Exit check: `bash scripts/check.sh`. Fed by: GET /api/people and the person's own profile route.

    **Landed 2026-09-21**: one route, two of the template's views stacked, matching the Step 1 stand-up's own original pairing. The household list is `/next/apps`'s own `DataTable` pattern reused exactly: `GET /api/people` (unscoped by design, same as `PeoplePage.tsx`) mapped to real name/role rows, a real `CardHeader`/`CardTitle` ("People") above the vendored table's own hardcoded title. The profile half is a genuine SHELL-01-style gap - the vendored `UserProfile` has zero data-binding surface, every field a local `useState` seeded with demo values - composed instead from the same shipped `Card`/`CardContent`/`Avatar` primitives it's built from, mirroring its header card's shape but dropping every field with no Home counterpart (email, phone, position, social links, address, the Edit dialogs). Shows the signed-in person's own profile only; another person's profile and the Memories tab stay on `PersonProfilePage.tsx` for now (named in the plan doc). `NextPeoplePage.test.tsx`, 5 cases. Captures at 1440 and 390, dark and light, against a real household (Sage/Marlow/Nova, Owner/Teen/Child): own profile card plus the real roster table, no demo copy anywhere. `scripts/screenshot.ts --next-people-review` (extended to both themes, its stale "Personal Information" wait condition replaced) is the permanent capture.

- [x] **SHELL-05: `/next/settings` on the template's form-layouts in tabs and cards with Home's real data** (M)

    Objective: `/next/settings` on the template's form-layouts in tabs and cards with Home's real data: the settings renderer's keys by section and scope. Files: `frontend/src/next/pages/NextSettingsPage.tsx`, the settings renderer's route or lib file, and `apps/settings/*` plus `apps/privacy/*` that the row retires. Pattern to mirror: the first landed row; until one lands, `NextAppsPage.tsx` for the mount and the template's own view for the data hooks (SWR through its global-fetcher). Acceptance: the page shows Home's data in the template's view as shipped; nothing Home-drawn (the reviewer's first check); a test per data path; captures at 1440 and 390, both looks and themes, opened and judged. Out of scope: editing any vendored component; the old route, which stays until the switch. Exit check: `bash scripts/check.sh`. Fed by: GET /api/settings and the settings registry routes.

    **Landed 2026-09-21**: docs/SETTINGS.md's generic renderer, pointed at the template's own form primitives - a genuine SHELL-01-style gap first (the vendored form-layouts view has zero data-binding surface, same as the dashboard's demo widgets), so `NextSettingField.tsx` ports the kit's own `SettingField.tsx` (home/kit-authored, not vendored - already solved the registry-selector-to-primitive mapping against the pre-shadcndashboard primitives) selector by selector onto the template's `Input`/`Select`/`Switch`/`Button`, reusing its two pure exported helpers rather than redefining them. `NextSettingsRenderer.tsx` reuses `groupSettings()`/`sectionTitle()` directly (pure grouping logic, unmodified) and renders sections as `Card`/`CardHeader`/`CardTitle`. `NextSettingsPage.tsx` splits Household vs Me through the template's `Tabs`, gated to owner/admin exactly as `SettingsPage.tsx`'s own switcher is. `NextSettingsPage.test.tsx`, 5 cases: a select key changing live through a real PUT, a household boolean folded behind "Show N advanced settings" toggling once expanded, a non-admin seeing no tab bar, an unsupported selector's fallback never crashing, and a failed fetch's error+retry. Every dedicated management page (Users, Models, Backups, Voices - `VOICE-BROWSER-01` among them - Commands, Devices, Repairs, Updates, Health) stays on the old route, named in the plan doc's own gap paragraph.

- [x] **SHELL-06: `/next/engines` on the template's data-tables and cards with Home's real data** (M)

    Objective: `/next/engines` on the template's data-tables and cards with Home's real data: the Engines API (HOME-STACK-04a). Files: `frontend/src/next/pages/NextEnginesPage.tsx`, the Engines API route or lib file, and none (new). Pattern to mirror: the first landed row; until one lands, `NextAppsPage.tsx` for the mount and the template's own view for the data hooks (SWR through its global-fetcher). Acceptance: the page shows Home's data in the template's view as shipped; nothing Home-drawn (the reviewer's first check); a test per data path; captures at 1440 and 390, both looks and themes, opened and judged. Out of scope: editing any vendored component; the old route, which stays until the switch. Exit check: `bash scripts/check.sh`. Fed by: GET /api/engines.

    **Landed 2026-09-21**: the first frontend `GET /api/engines` has ever had - a grep of the whole frontend before starting came back empty, matching this row's own "Old file it retires: none (new)". Real fix at the source first: neither `GET /api/engines` nor `GET /api/engines/health` distinguished "no Stack configured" (Jesse's own household) from a real Stack failure - both threw the identical 503 either way. `backend/src/routes/engines.ts` now checks `isStackConfigured()` before ever calling the Stack and returns `configured: false` (200, empty/null fields) for the ordinary case, the same posture `dashboard.ts`'s own `engineStatusCounts()` already took. `NextEnginesPage.tsx` reads both routes and renders three `DataTable` instances (roles by address, engine state, health severities) when configured, or a calm "No Stack configured" card when not - never an error banner for an expected state. `NextEnginesPage.test.tsx`, 5 cases, including a review-caught regression: engine status now reads the real `needsRestart` field rather than string-matching `stateReason`. Captures at 1440 and 390, dark and light, against the real seeded household (no Stack, same as Jesse's): the honest empty state throughout, exactly as the acceptance asks. Real engine actions (start/stop/restart, a role switch) and a memory-budget card stay out of scope, named in the plan doc's own gap paragraph - the vendored table's Action column has no click handler wired to it, same gap every `/next` data-table has found so far.

- [x] **SHELL-07: `/next/updates`, `/next/repairs`, and `/next/backups` on the template's data-tables and cards with Home's real data** (S each)

    Objective: `/next/updates`, `/next/repairs`, and `/next/backups` on the template's data-tables and cards with Home's real data: the routes HOME-STACK-05 landed. Files: `frontend/src/next/pages/NextUpdatesPage.tsx`, `frontend/src/next/pages/NextRepairsPage.tsx`, `frontend/src/next/pages/NextBackupsPage.tsx`, the updates, repairs, and backups route or lib files, and `apps/settings/UpdatesSection.tsx`, repairs, and backups pages that the row retires. Pattern to mirror: the first landed row; until one lands, `NextAppsPage.tsx` for the mount and the template's own view for the data hooks (SWR through its global-fetcher). Acceptance: the page shows Home's data in the template's view as shipped; nothing Home-drawn (the reviewer's first check); a test per data path; captures at 1440 and 390, both looks and themes, opened and judged. Out of scope: editing any vendored component; the old route, which stays until the switch. Exit check: `bash scripts/check.sh`. Fed by: GET /api/updates, /api/repairs, and /api/backups.

    **Landed 2026-09-21**: unlike SHELL-06, all three backend routes already had a real, working old-shell frontend, so this is a genuine port. Updates reuses `UpdatesSection.tsx`'s own `rowsFrom()`/`hasUpdate()` (exported, not redefined) for the identical Home/engine/model rows and update-available rule. Repairs and Backups read `GET /api/repairs` and `GET /api/backups` directly into real `DataTable` rows; Backups also shows the real "Ready to restore" banner when one is staged. A correction to the row's own ask: Backups was framed as carrying "size and outcome" and "a schedule card" - `BackupInfo` has no outcome field (a failed attempt never produces a listed file) and neither the old page nor the API has ever had a schedule concept, so neither was built. All three pages gate to owner/admin exactly as their old counterparts do. 13 tests across three new dedicated test files. Captures at 1440 and 390, dark and light, against a real seeded backend: Updates shows a real "MaiPai Home 0.1.0, Up to date" row, Repairs shows a real raised issue (a genuine Wyoming satellite server bind failure from this session's own throwaway backend, not fabricated), Backups shows the honest "No data available." empty state (nothing has ever run a backup in a fresh data dir). Real actions (apply/rollback, fix/dismiss, run/restore) all stay on the old pages, named in the plan doc's own gap paragraph - the vendored table's Action column has no click handler wired to it, the same gap every `/next` data-table has found.

- [x] **SHELL-08: `/next/sign-in` on the template's auth view with Home's real data** (M)

    Objective: `/next/sign-in` on the template's auth view with Home's real data: Home's sign-in and passkeys. Files: `frontend/src/next/pages/NextSignInPage.tsx`, the sign-in and passkeys route or lib files, and `apps/auth/*` that the row retires. Pattern to mirror: the first landed row; until one lands, `NextAppsPage.tsx` for the mount and the template's own view for the data hooks (SWR through its global-fetcher). Acceptance: the page shows Home's data in the template's view as shipped; nothing Home-drawn (the reviewer's first check); a test per data path; captures at 1440 and 390, both looks and themes, opened and judged. Out of scope: editing any vendored component; the old route, which stays until the switch. Exit check: `bash scripts/check.sh`. Fed by: the sign-in routes under /api/auth.

    **Landed 2026-09-21**: the real profile picker and secret entry (`GET /api/auth/profiles`, `POST /api/auth/select`, `/verify-secret`), composed from the template's own auth form primitives rather than its email/password demo, mirroring `SignIn.tsx`'s own state machine and reusing `usePinAutoSubmit` directly. A correction to the row's own ask: `SignIn.tsx` has no PIN-vs-password distinction to mirror - every profile gets the identical field, and the 4-digit-numeric auto-submit is what makes a PIN feel instant without the UI needing to know a profile's secret kind in advance. `/next/sign-in` is now genuinely reachable while signed out: `App.tsx`'s `/next/*` route used to redirect a signed-out visitor to `/` before this tree ever mounted, so `NextRoutes` now splits into `NextRoutesInner` (authenticated) and `NextSignedOutRoutes`, each calling only the hooks its own auth state allows. Landing this also found `useShellNext()` could spin `RouteSkeleton` forever on a real settings-fetch failure (a genuine 401 race during sign-out, not just a cold-load edge case) since it only checked `!query.data`; it now checks `query.isError` too and bounces to `/`, the plan doc's own SHELL-08 gap paragraph has the full account. 10 tests across `NextSignInPage.test.tsx` (7) and a new `useShellNext.test.tsx` (3, including the isError regression). Captures at 1440 and 390, dark and light, of the real profile picker (Sage/Marlow/Nova) reached via a real in-session sign-out and client-side navigation. Out of scope, named in the gap paragraph: the vendored header's own "Log Out" button points at the vendored demo's nonexistent route, not a real sign-out - no real sign-out control exists in `/next`'s own chrome yet, so the live verification's sign-out half runs through the old shell's already-real control.

- [x] **SHELL-FLAG-01: `ui.shell.next` on means the whole app, not just `/next`** (S).

    Objective: with `ui.shell.next` on, `/` redirects to `/next` instead of showing the old dashboard, sign-out from either shell lands on `/next/sign-in`, and signing in there lands on `/next`; with the flag off, everything stays exactly as before. Files: `frontend/src/App.tsx`, `frontend/src/shell/oldShellRedirect.ts`. Pattern to mirror: `useShellNext()`'s existing three-state `ShellNextState`. Acceptance: the three redirects, both ways, tested; a signed-out visit still shows the sign-in form immediately, no wait on the flag. Exit: `bash scripts/check.sh`.

    **Landed 2026-09-21**: `App.tsx`'s old `/*` route is now `OldShellRoutes`, which checks `shouldRedirectRootToNext`/`isRootStillResolving`/`signOutDestination` (new, `frontend/src/shell/oldShellRedirect.ts`, three pure functions kept separate from `App.tsx` itself since that file's `@/i18n` import pulls in a `.po` file bun's test runtime has no loader for). A review caught a real bug before it shipped: the first draft checked the redirect before the `person === null` check, so a never-authenticated visitor to `/` would block on `useShellNext()`'s own auth-gated settings fetch (a guaranteed 401 for them) before ever seeing the sign-in form - fixed by gating the whole block on `person !== null`, so a signed-out visit is unchanged from before this item. `oldShellRedirect.test.ts` (13 cases) plus one integration test in `NextRoutes.test.tsx` for the sign-in redirect. `useShellNext`'s own shape and its one existing consumer (`NextRoutes.tsx`) were left untouched, on purpose, to keep the pending HOME-UI-04g rebase small - the same three-state branching now exists in both places, a real but deliberate duplication, noted in `oldShellRedirect.ts`'s own comment.

- [ ] **SHELL-09: the cutover, then the old interface is deleted** (M, after SHELL-02 to SHELL-08 are ticked and the owner says cut).
    Objective: `/next/*` becomes `/*` and the `ui.shell.next` setting is removed (its registry entry, its spec key, its user-doc bullet), the old shell and chat stop shipping, and everything that existed only for them is deleted in the same release, in this order, each its own commit: (1) the routes: `frontend/src/next/NextRoutes.tsx` mounts at `/`, `frontend/src/App.tsx` loses the old shell tree and the flag branch, the old page files under `frontend/src/apps/*` and `frontend/src/shell/*` that the wiring table's "Old file it retires" column names go, with their tests and the old `scripts/screenshot.ts` captures; (2) the old chat: `frontend/src/apps/chat/thread.aui.tsx`, `chatDocumentPane.tsx`, the old panes and chips the Elements replaced, keeping the adapters the Elements thread still uses; (3) the kit (commons, its own tag): `ui/src/Shell*`, `DetailPane`, `ThingsTable`, `ui/src/blocks/*`, the `.aui.tsx` files under `ui/src/assistant-ui/`, the `data-look` mechanism and every `[data-look=...]` rule in `ui/src/tokens.css`, the old look tokens the template's palette replaced (the navy set stays only as the `navy` preset block in `globals.css`), the kit's own icon wrappers the template does not use, and their tests and docs; (4) the spec (commons, spec tag): the removed setting key, any record field only the old shell read, the fixtures for them; (5) the docs: `docs/design/home-pages-2026-09-20.md` marked superseded at the top with a pointer to the program record, `docs/user/*` screenshots regenerated from the new pages, the settings user page's "New shell (preview)" bullet removed, the dev.md shell section closed with the cutover hash. Acceptance: no file under `frontend/src` imports from `@maipai/ui/src/Shell`, `blocks/` or `assistant-ui/` (a grep in the commit); `ui.shell.next` appears nowhere in home or commons; the full gate green in both repos; captures of every page at 1440 and 390 in both modes regenerated and judged; the old-shell-only settings (`ui.look`'s retired values) migrate on read. Out of scope: the robot and Go. Exit: `bash scripts/check.sh` in home and in commons.

- [x] **ARTIFACT-02: the `artifact` recipe primitive** (M, high review -
      spans `commons/spec`, both interpreters, and Home) - the sanctioned
      way for the model to create or update a chat artifact live, found
      while landing the artifact data layer (`lib/artifacts.ts`,
      `spec/schemas/artifact.schema.json`, spec-v0.1.7): every native
      tool call in `turnEngine.ts`'s `resolveToolCallsInOrder()` assumes
      a real catalog package (`rankedById.get(c.tool)!.manifest` - offer,
      dedupe, cap, consequential and arg-schema checks all read a real
      `PackageManifest`), and a Tier 1 `handler.ts` has zero DB access
      (runs as an isolated Deno subprocess - confirmed reading
      `packages/almanac-date/handler.ts`'s own "no import from anywhere
      outside its own directory"). The one sanctioned path a package
      already uses to write a real structured record is a recipe
      primitive (`remember`'s `"op": "remember"` step, implemented
      identically in `commons/spec`'s `interpreters/ts/recipe-
      interpreter.ts` AND `interpreters/py/recipe_interpreter.py` - the
      file's own header: "must stay behaviorally identical... the
      conformance fixtures prove that" - calling a method on the shared
      `Host` interface, `host-emulator.ts`, that `packageHost.ts`
      implements for real).

      **The design (coordinator-approved 2026-09-21, build it as
      written, not re-derived):**

      An 18th recipe op: `{"op": "artifact", "as": "result", "title":
      "{title}", "kind": "{kind}", "body": "{body}", "id_from":
      "artifact_id"}`, added to `recipe.schema.json`'s `step` oneOf,
      `interpreters/ts/recipe-interpreter.ts`'s `RecipeStep` union and
      switch, and `interpreters/py/recipe_interpreter.py` identically,
      with new conformance fixtures in `spec/fixtures/recipes/` proving
      both languages agree. `title`/`kind`/`body` interpolate normally
      (`interpolate(step.field, scope)`, the same as every other step) -
      always required in `write_document`'s own tool args, even on an
      update (the model just resends the current title unchanged rather
      than the interpreter threading "optional on update" through the
      templating layer, which has no clean way to express it).
      `id_from` names a scope variable to read DIRECTLY, no `{}`
      wrapping - the exact bare-name convention `pick`'s own `"from"`
      field already uses (`scope[step.id_from]`), not the same
      `interpolate()` path `title`/`kind`/`body` take, because
      `interpolate()` leaves an unresolved `{name}` template as the
      literal string `{name}` rather than resolving to `undefined` -
      indistinguishable from a real answer that happened to look like
      that string, and wrong for a field whose ABSENCE (the model's tool
      call omitted `artifact_id`) is the create/update discriminator
      itself, since the recipe language has no conditional to branch on
      one. Whether `scope.artifact_id` is defined is what the op uses to
      call `host.artifact.create()` vs `host.artifact.update()` - no
      other branching needed.

      `Host` (`host-emulator.ts`) gains an `artifact` member:
      `create({title, kind, body}): {id, version}` and
      `update({artifact_id, title, body}): {id, version}`, both throwing
      `HostError` with an EXISTING `errors/errors.json` code
      (`not_found` for an unknown `artifact_id`, `invalid_input` for one
      that is no longer current) rather than inventing a new one. A
      matching deterministic in-memory implementation goes on the TS and
      Python emulators (`emulators/ts/host-emulator.ts`,
      `emulators/py/host_emulator.py`) for the conformance fixtures to
      run against. New permission `artifact:write` in
      `vocab/permissions.json`, one line, matching every other host
      method's own entry there (`"Call host.artifact.create/update."`).

      **Provenance, the one addition past the original draft
      (coordinator, 2026-09-21): the op records provenance the way
      `remember` already does** - `packageHost.ts`'s own `remember()`
      sets `source = turnId ?? \`package:${manifest.id}\`` (a comment
      there: "the turn id when this call is happening inside a turn...
      package id otherwise") - `host.artifact.create`/`update`'s real
      implementation uses the IDENTICAL expression for
      `createArtifact`/`updateArtifact`'s own `provenance` field, so a
      document knows which turn (or which non-turn package invocation)
      wrote each version, not a bespoke string. `packageHost.ts`'s real
      implementation resolves `conversation_id` by looking up the bound
      `turnId`'s own row (real DB access a Tier 1 handler could never
      have) before calling `lib/artifacts.ts`'s `createArtifact`/
      `updateArtifact` directly.

      The op ALSO binds two flat scope keys directly (not nested under
      `result` - `interpolate()` has no dot-path support, and every
      existing step's own `data` mapping only ever reads flat top-level
      scope vars): `scope.artifact_id = result.id` and
      `scope.artifact_version = result.version`. The bundled `documents`
      package (`backend/packages/documents/`, `kind: plugin`, ranked and
      consequential like any action package)'s recipe: the `artifact`
      step, then a `format` step whose `data` is `{"artifact_id":
      "{artifact_id}", "artifact_version": "{artifact_version}"}` -
      exactly the shape `composer.ts`'s `structuredPartForOutcomes()`
      already reads weather's/almanac-date's own flat `result.data`
      fields from, so `TurnValue.artifact` (landed, additive, no writer
      until this item) gets set from this outcome the identical way.
      The tool name is `write_document`, args `title`, `kind`, `body`
      (always required; `artifact_id` optional, its presence is the
      update discriminator) - that exact name is what artifact-card's
      own toolkit binds to on the frontend, so nothing extra needs
      registering there.

      Acceptance: a model-driven live chat creates then edits an
      artifact, `TurnValue.artifact` gets set from the real tool call,
      and the TS/Python conformance fixtures prove both interpreters
      agree. Out of scope: any OTHER package gaining artifact-writing
      permission by default - `documents` is the one bundled caller
      until a real reason exists for a second. Check: `spec`'s own
      `bun test`/`pytest` (conformance fixtures), backend's artifact and
      turnEngine tests, `bash scripts/check.sh` in both repos.

      **Landed 2026-09-21** (`commons` `1c1306d`/`spec-v0.1.9` - `spec-
      v0.1.8` shipped with `spec/package.json`'s own version field still
      reading `0.1.7`, caught by this repo's own pin-honesty check and
      fixed same-session by `commons` `3246608`/`spec-v0.1.9`, `v0.1.8`
      retired unused; `home` this commit). The bundled package/tool is
      named `write_document`,
      not `documents` as this item's own prose casually called it:
      `resolveToolCallsInOrder()`/`selectOfferedTools()` key a model's
      tool call by the package's own `manifest.id`, so the id had to be
      the literal tool name for the acceptance criterion's own "nothing
      extra needs registering" to hold. Its manifest first declared
      `always_offer: true` (`websearch`'s own pattern) - that put it on
      every turn's offered-tool list and shifted Tier 2 ranking margins
      enough to fail 3-5 unrelated tests (LOOKUP-01, hub-named-it);
      removed, since a document-writing request is nothing like
      `websearch`'s open-ended fallback role - it ranks normally now.
      `packageHost.ts`'s `update()` also gained an ownership check this
      item's own design didn't spell out: `lib/artifacts.ts`'s
      `updateArtifact()` has none, and `routes/artifacts.ts` is
      read-only, so this host method was the only place a non-owner
      could otherwise supersede someone else's artifact by guessing an
      id - `not_found`, matching the read routes' own "can't see it, so
      it doesn't exist" convention. A high-effort review on the `commons`
      side caught a real TS/Python divergence before it shipped (an
      explicit JSON `null` `artifact_id` created in Python, updated
      against `null` in TS); fixed and covered by a fifth conformance
      fixture.
- [x] **REASONING-01: stream the model's thinking as its own part** (M) -
      `reasoning` (`assistant-ui.com/elements/reasoning`) binds to a
      `{type: "reasoning", text, status?}` message part; Home has no such
      stream event today. Not a clean bolt-on: `wellFormed.ts`'s
      `thinkingPrefix()`/`visibleText()` already split a model's
      `<think>` block from the visible reply, but the extracted prefix is
      REATTACHED to the raw text at several points deep in
      `turnEngine.ts`'s streaming buffer and sentence-splitting logic
      (`composeBlocking`, the retry-token machinery, the mid-stream
      `<think>` handling around line 5654) for reasons not fully
      explained by a read-only pass - understand why that reattachment
      exists before extracting reasoning as an independently-streamed
      event, or a fix here risks silently breaking that reassembly.
      Acceptance: a `thinking: true` turn streams `{type: "reasoning",
      text}` events distinct from `delta`, the visible reply is
      unaffected, and whatever the reattachment was protecting still
      holds (name it, then prove it in a test). Check: turnEngine stream
      tests, `bash scripts/check.sh`. Landed 2026-09-21 at 57c4b430:
      `routes/turn.ts`'s `streamTurnEvents()` splits the pipeline's combined
      text into `reasoning` and `delta` wire events at the route boundary
      (`wellFormed.ts` `feedThinkSplit()`/`flushThinkSplit()`), the engine's
      own `reasoning_content` separation preferred over tag parsing
      (spec-v0.1.11), the reattachment upstream untouched so stored and
      visible text are byte-identical to before, and a minor's own turn never
      receives the reasoning event. The follow-up a second review pass
      surfaced (a tool-resolved turn's own reasoning was discarded entirely,
      not just hidden from the wire) landed the same day as **REASONING-02**,
      docs/dev.md.
- [ ] **EXPORT-01: a person's export shaped like their read path** (S) -
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
- [ ] **Canvas / Artifacts: a side panel for iterating on a document or
      running code, not just chat text** (L) - doesn't exist. Real
      differences worth knowing before designing this, not just "build a
      canvas": Claude Artifacts actually execute and render results live
      in the panel (React components, HTML, SVG - as of June 2026 you can
      highlight part of an artifact and describe an edit in place), while
      Gemini Canvas is edit-only - it does not execute code, you copy it
      out to run it. Code execution itself is a separate, real capability
      none of the three vendors bolt onto raw chat text: Gemini's code
      execution tool runs actual Python server-side (30-second cap, learns
      iteratively from its own output). If this gets built, "does it run
      code or just display it" is the first real design fork, not a
      detail - and running arbitrary code has a real sandboxing story to
      design (Tier 1's Deno boundary is the closest existing precedent in
      this codebase, not a ready answer).
- [ ] **Deep Research: a multi-step, multi-source research mode that
      returns a cited report** (L) - doesn't exist, and it's a different
      shape than the Tier 2 note's own rejected "autonomous loop": ChatGPT
      and Gemini call it Deep Research, Claude calls it Research; all
      three run several minutes of multi-step web search/reading and
      return one cited report, which is closer to "one long, bounded,
      author-understood job with a fixed goal" than to open-ended runtime
      tool selection - worth a design pass of its own, not lumped into the
      Tier 2 note's already-decided "no autonomous loop" verdict without
      checking whether this specific bounded shape is actually the same
      risk the note was written against.
- [ ] **A stated policy on identifying a person from a photo** (S to
      decide, since it's a decision not code) - a real, undecided gap this
      research surfaced, distinct from the vision/generation gaps already
      listed. The three vendors disagree with each other: ChatGPT refuses
      identifying anyone from an image outright ("I can't identify people
      in images for privacy reasons"); Claude's model appears to recognize
      public figures internally but its output is trained to refuse
      disclosing it; Gemini will name a public figure on request, and
      Google's separate "Personal Intelligence" feature (expanded to all
      free US users March 2026) links Gemini directly to a user's Google
      Photos face-recognition data. `getmaipai/.github`'s existing hard
      rule ("no feature is built whose purpose is generating imagery of
      identifiable real people") governs generation only - there is no
      MaiPai stance at all on recognizing/naming a person from an uploaded
      photo, which is a real, separate question `host.camera.still`/`host.
      ocr.read` will eventually force regardless of which vendor's
      posture MaiPai ends up closest to.

Three more items the research turned up that are worth a one-line note
here but are NOT new gaps - they sharpen or confirm something already
listed above, so read them as amendments, not additions:

- **Barcode/QR reading** (Jesse's own example) turns out to already have a
  decided answer in this repo's own notes: `docs/dev.md`'s vision-review
  section already picked `zxing-cpp` for barcodes specifically (real
  dedicated decoders read a 1D UPC barcode far more reliably than asking
  a vision-language model to "read" one - confirmed general capability,
  not a barcode-specific one, in this research: all three vendors can
  read a clean QR code as an image-understanding task, which is a
  different and easier problem than decoding a real, imperfectly-lit 1D
  barcode). Nothing new to add to the Vision section above; it already
  lists `host.ocr.read`/`host.camera.still` as the real blocking gaps.
- **Scheduled automation** (ChatGPT Tasks, Gemini Scheduled Actions, Claude
  Scheduled Tasks) confirms the Proactive/ambient intelligence section
  above is aimed at something real and already shipped elsewhere, not a
  speculative idea - worth citing concretely: reporting says ChatGPT's
  original Tasks was "a glorified reminder app" and Gemini's was
  restricted to Google Workspace tools, while Claude's version does real
  automation (multi-step workflows, broad connectors, cloud-persistent
  execution independent of any device being on) - a genuine target shape
  for the "caching/freshness layer" piece already broken out in that
  section, not a reason to rewrite it.
- **Full-duplex, barge-in voice conversation** (GPT-Live, Gemini Live - both
  can listen and generate at the same time instead of waiting for a pause,
  sub-500ms median latency reported for ChatGPT's) is the concrete target
  shape for the Voice/robot section's "wake word past phase 1" line above,
  not a new item - a real number to measure against once that work starts,
  where today there is no number at all.
- **Custom GPTs / Gemini Gems** turn out to already be close to something
  MaiPai has, not a gap: a GPT/Gem is a closed, vendor-specific custom
  assistant, while MaiPai's own package manifest (skill/app/companion/
  integration, with declared permissions and routing) is structurally
  closer to the open, portable "Skill" format multiple vendors and tools
  now read (a SKILL.md-shaped standard, per this research, read by over
  30 different tools as of early 2026) than to a closed GPT/Gem. The real
  gap here isn't a new concept to design - it's the `catalog` repo
  existing for real, already listed above as its own item.

Sources consulted (this research pass, 2026-09-05): [ChatGPT Projects guide](https://www.ai-toolbox.co/chatgpt-management-and-productivity/how-to-use-chatgpt-projects-guide-2026), [ChatGPT custom instructions update](https://www.mywritingtwin.com/blog/chatgpt-projects-setup-guide), [Claude Artifacts 2026 guide](https://suprmind.ai/hub/claude/features/), [Claude Live Artifacts](https://www.eigent.ai/blog/claude-live-artifacts-guide), [Gemini Canvas](https://gemini.google/overview/canvas/), [Gemini Gems](https://geotoolbox.ai/blog/gemini-gems), [Gemini code execution docs](https://ai.google.dev/gemini-api/docs/code-execution), [Gemini/Google Photos face recognition](https://pasqualepillitteri.it/en/news/1055/google-photos-ai-scanning-gemini-recognition), [Google Personal Intelligence privacy concerns](https://vucense.com/privacy-sovereignty/surveillance-biometrics/google-gemini-personal-intelligence-photos-privacy-2026/), [ChatGPT/Claude photo-identification policy](https://github.com/openai/openai-python/discussions/2495), [Claude Scheduled Tasks vs. ChatGPT/Gemini](https://www.xda-developers.com/claude-scheduled-tasks-feature/), [voice mode comparison (GPT-Live/Gemini Live/Claude)](https://apidog.com/blog/gpt-live-vs-gemini-live/), [Claude voice moves to Opus/Sonnet/Haiku](https://www.techradar.com/computing/artificial-intelligence/claude-tipped-to-get-its-answer-to-chatgpts-advanced-voice-mode-soon-is-adding-an-ai-voice-to-a-chatbot-yet-another-tick-box-exercise), [Claude Skills vs ChatGPT GPTs vs Gemini Gems](https://www.open-claw.sh/blog/claude-skills-vs-chatgpt-gpts-vs-gemini-gems), [barcode/QR reading across vendors](https://www.dynamsoft.com/codepool/python-flet-chat-app-barcode-gemini.html).

## Chat, memory and persona (the intelligence gap)

- [x] **S: Keep the shell visible when the phone composer gains focus.**
      `frontend/src/kit/ui/sidebar.tsx` anchors the shell to the viewport,
      matching the fixed phone navigation. The existing demo browser pipeline
      reproduces keyboard document panning and checks the header and input
      remain visible and tappable. Exit: `bun run scripts/screenshot.ts --chat-focus-review`;
      add `--webkit` for Safari's engine. Physical phone deployment is unverified.
      No message anchoring, API, or runtime changes.

What "intelligent, personified, memory- and data-driven chat" needs that
`turnEngine.ts`, `memory.ts` and `persona.ts` do not have today. Ordered
by payoff per day of work; the first five together turn stateless Q&A
into a conversation with someone who knows who is talking.

**Conversation and context**

Embedding compatibility is tracked by [CHAT-09](#chat-09). Preserve current preprocessing until CHAT-23 demonstrates that a migration improves held-out recall.

- [x] **Fix B: a package failure is a failure, canned text is never the
      model's voice, the UI shows who answered** (M) - shipped 2026-09-07.
      `docs/dev.md`'s "Chat reliability: the 2026-09-07 incident" note has
      the full B1-B4 writeup and B3/B4 "as built" corrections. Built as
      planned: `spec/schemas/result.schema.json`'s optional `error`
      (regenerated `gen/ts`/`gen/py`); the seven handlers
      (`backend/packages/{almanac-holiday,almanac-onthisday,currency,
      knowledge,music,news,sports}/handler.ts`) report `{ error }` instead
      of a hand-copied string; `denoHost.ts`'s `callTier1Handle()` returns
      `CallTier1Result` (`{ok:false,...}` for a genuine upstream failure,
      no strike); `plugins.ts`'s `runPlugin()` returns
      `{ ok: false, status: 502, error, fallback_reply }`; `turnEngine.ts`'s
      pattern branch speaks the fallback as `plugin_error`, Tier 2's
      existing `oks.length === 0 → null` already fell through correctly
      with zero changes; `conversationHistory.ts`'s
      `nonModelWindowNote()`/`buildConversationWindow()` push a `system`
      note (never `assistant`) for every non-model source, name resolved
      via `loadManifestOnly()` (plugin) or a direct `commands` table query
      (command - `lib/commands.ts` itself isn't importable here, a real
      cycle through `turnEngine.ts`); `chatSourceCaption.tsx` (frontend)
      renders "via Music Lookup" for `plugin`/`plugin_error`/`command`,
      fed by `chatHistoryAdapter.ts` and `chatModelAdapter.ts` both
      attaching the same `source`/`pluginId`/`commandId` message metadata.
      A real, deeper bug surfaced proving B3: `route()` had no
      `manifest.kind` check, so a skill (no `recipe.json` - never meant to
      run on its own) could win routing outright and crash into
      `plugin_error` every time; fixed at the root in `turnEngine.ts`'s
      `route()`, proven by a direct unit test. Widgets picked up a real
      typecheck regression from the 502 status widening
      (`backend/src/lib/widgets.ts`'s `getWidgetData()`) - fixed by
      showing the package's own `fallback_reply` text as the widget's one
      item rather than dropping the widget. Not done: a dedicated
      `tests/tier2.test.ts` case for a Tier 1 upstream failure inside
      model tool-calling (see the follow-up below) - the existing suite
      and `tsc`'s type-narrowing both confirm the code path, just not a
      standing regression test yet.
- [ ] **A real-Tier-1-failure regression test for the two callers that
      still only rely on reading, not testing, a 502**: "a package that
      fails upstream is not a Tier 2 success" (`tests/tier2.test.ts`) and
      `POST /api/plugins/:id/run` returning `fallback_reply` alongside the
      error (`tests/plugins.test.ts`)** (S) - deferred 2026-09-07 from Fix
      B above. Objective: prove `attemptTier2Tools()` (`turnEngine.ts`)
      treats a Tier 1 handler's genuine `{ ok: false, status: 502 }` the
      same as "no tool answered" (falls through to a normal model reply),
      not just by reading `oks.length === 0 → null`, and that
      `routes/plugins.ts`'s direct-run route includes `fallback_reply` in
      its JSON body for the identical failure - both currently verified
      only by reading the code and by `tsc`'s own type-narrowing, not by a
      standing regression test. The blocker: every one of the seven
      packages that can produce this is Tier 1 (a real `deno run` sandbox
      + a real network fetch), and nothing in this codebase can force a
      deterministic, offline network failure through that path today -
      `denoHost.test.ts`'s own timeout tests get around the equivalent
      problem for `recordFault()` via `__setTestFetchDelayMsForTests()`,
      but there's no matching seam for "the fetch throws." Pick one: add a
      small `__setTestFetchFailureForTests()` knob next to the existing
      delay one (`denoHost.ts`), or a tiny test-only Tier 1 fixture
      package under `backend/tests/fixtures/` whose handler always
      returns `{ error }` (mirrors the sandbox permission tests' own
      `mkdtempSync` pattern, `denoHost.test.ts`'s second describe block).
      One harness unlocks both test gaps. Acceptance: the tier2 test calls
      `attemptTier2Tools()` with a candidate that fails upstream and
      asserts the result is `null` (falls through), never a fabricated
      `plugin` success. Exit: `scripts/check.sh`.
- [x] **Fix C: guards narrow to household claims, cut instead of splice,
      proven by a corpus** (M) - shipped 2026-09-07 (getmaipai/home#62).
      `backend/src/lib/guards.ts`: `GUESSING_RE`'s `sounds like (a|an)`
      alternation removed (a real conversational idiom reacting to
      something the PERSON just said, not a guess about the household -
      `probably (a|an|the)` deliberately KEPT: a code review caught a
      first cut removing that too, with no incident evidence and no
      corpus row justifying it, and "That's probably a delivery driver."
      answering "who's at the door" is a genuine invented guess); the
      bare `PROPER_NOUN_RE`/`DATE_WORD_RE`/`BARE_NUMBER_RE` candidate loop
      kept UNCHANGED, correcting this item's own original plan (deleting
      it wholesale would have broken "a fabricated weather stat is still
      caught," which only that loop catches - see `docs/dev.md`'s Fix C
      "as built" note for the full reasoning); a new `HYPHEN_COMPOUND_RE`/
      `hyphenGroundedPieces()` pair grounds a reply's own "Spider-Man"
      against a household's plain "Spiderman" (kept local to guards.ts,
      not `tokenize()` - `memory.ts` recall and `routing.ts` example
      matching share that function and neither wants hyphen-collapsing);
      new exported `isCuttable()`, the one place CUTTABLE-ness is decided.
      `backend/src/lib/turnEngine.ts`: `gateGuards()` rewritten to
      genuinely match `guardReply()`'s own three real branches
      (guards.ts:517-526) - a code review caught a first cut's own
      mismatch: guardReply() STOPS at the first flagged sentence every
      time (no fall-through to a later sentence, cuttable or not), while
      the first cut dropped just a cuttable sentence and kept streaming
      later ones, producing a different reply than the non-streaming path
      would for the identical model completion. As built: a cuttable
      reason with something already spoken keeps only that prefix and
      stops (no honest line, matching `kept.join(" ")`); a cuttable reason
      with nothing spoken yet, or any non-cuttable reason, replaces with
      the honest line and stops (matching `replacementFor(reason, ...)`)
      - draining, never yielding, whatever the model would have said
      next either way. `spec/llm/guard-corpus.json` (20 rows) +
      `backend/tests/guardCorpus.test.ts` (mirrors
      `tests/routingCorpus.test.ts`, both the non-streaming and streaming
      paths, in `check.sh`); direct `gateGuards()` unit tests added to
      `tests/turnEngine.test.ts` (none existed before this fix), each
      asserting `gateGuards()` against `guardReply()`'s own real decision
      on the identical input, not just against a standalone expectation.
      Verified live against all six incident probe phrases (small talk
      passes untouched both non-streaming and streaming; the weather
      invention is still caught) and against
      `scripts/bench/conversation.ts` (unchanged 23/29, no regression on
      the 5 pre-existing known gaps).
- [x] **Send prior turns to the model** (S-M) - shipped, Session A step 3
      (2026-09-05): `buildConversationWindow()` in `lib/conversationHistory.ts`,
      newest 4 turns always kept verbatim, older ones added
      most-recent-first under a 1,200-token (chars/4) budget, exactly
      legacy's numbers. `maybeRefreshConversationSummary()` refreshes the
      rolling summary post-turn (never in the request path) once at
      least 4 turns have fallen out of the window since
      `summary_through_turn`.
- [x] **A speaker block in the prompt** (S) - shipped, Session A step 1
      (2026-09-05): display name, nickname, role, an age band (derived
      from birthdate when present, role otherwise), and locale (the real
      key is `household.locale`, not `core.locale` as this item names it)
      with a locale-formatted local time replacing raw ISO UTC.
- [x] **A household context block** (S) - shipped, Session A step 1
      (2026-09-05): every active person's display name and role
      (`lib/access.ts`'s `listActivePeople()`). Presence and "what
      packages are installed" are not built - presence has no signal
      source yet (robot/ambient-context, not this session), and the
      plugins list already exists as its own separate prompt section
      (`pluginsListLine()`, predates this item).
- [x] **Stable-first prompt order with a persona re-anchor** (S) -
      shipped, Session A step 4 (2026-09-05): identity/companion/rules/
      standing-skills stable, household/speaker/memory/re-anchor/summary/
      matched-skills/time volatile; `companionReanchorLine()` repeats the
      persona's `display_name` right after the memory block,
      unconditionally.
- [x] **Per-section prompt budget test** (S) - shipped, Session A step 4
      (2026-09-05): every section (rules, companion, memory, plugins,
      skills, summary) has its own real cap via a shared `capSection()`
      (the ellipsis now counts inside the cap - a genuine off-by-3 bug
      the old per-section inline copies all had, fixed in the same pass).
- [x] **Rate-limit `/api/turn` and `/api/llm/*` per person** (S) - done
      before this line was written (the per-person token bucket on
      `POST /api/turn`, `/api/turn/stream` and `/api/llm/*`, the
      `turn_rate_limited` error code, tests through the real routes,
      home#106); ticked 2026-09-15 on a backlog read.
- [x] **Decide what an emptied conversation becomes** (S decision, found
      by Session A step 3's own code review, 2026-09-05) - decided and
      shipped, Session C step 9 (2026-09-06): auto-close, tombstoned by
      retention. `runRetention()` now closes (`status: "closed"`, the
      same value a household member's own "start a new conversation"
      already writes) any conversation its own delete emptied out to
      zero remaining turns, gated on `status = 'open'` so an already-
      closed or already-deleted thread is never touched. Three tests:
      an emptied conversation closes, a surviving-turn one stays open,
      a deleted one is never reopened.

**Memory**

- [x] **Scope recall to the actor** (S, privacy bug) - shipped, Session A
      step 2 (2026-09-05): `recall()`'s new `selfOnly` option makes the
      turn engine's own call require `record.person === actor.id` for
      person-scope, regardless of role; the parental view
      (`GET /api/memory`, `POST /api/memory/recall`) is unchanged.
- [x] **Person-scoped `remember`, with turn provenance** (S) - shipped,
      Session A step 2 (2026-09-05): a word-boundary first-person check
      in `packageHost.ts`'s `Host.memory.remember` writes `scope: person,
      person: actor.id` when the recipe step leaves scope unset (an
      explicit scope from a recipe step still always wins); `source` is
      the real turn id end to end (`turnEngine.ts` generates it once,
      up front, and hands it to `createHost()` and to the turn's own
      `conversation_turns` row).
- [x] **Wire `embed` into recall** (M) - shipped, Session A step 5
      (2026-09-05): `memory_embeddings`/`pending_embeddings` tables,
      embed on write with a `pending_embeddings` retry queue drained by
      a real `every:1m` core job, `recall()` scores real cosine
      (`0.7 cos + 0.2 importance + 0.1 recency`, floors 0.55
      episodic / 0.37 durable, legacy's tuned numbers ported verbatim),
      keyword overlap as the fallback when no vector exists either
      side, entity-first pass kept. **Still open**: the legacy eval
      probes are ported and passing 7/11 (`backend/scripts/bench/
      memory-eval.ts`), but only against the stub embed backend - the 4
      failures are the true paraphrase cases a stub can't fake. Re-run
      against a real downloaded chat model (unlocks the real
      nomic-embed-text-v1.5 spawn) before trusting either the floors or
      the weights for v0.1; see docs/dev.md's step 5 entry.
- [x] **The memory judge: extract at turn end, consolidate at idle** -
      shipped, Session A step 6 (2026-09-05): `lib/memoryJudge.ts`, a
      real `memory.judge` core job (every:1m) per `source: model` turn -
      one grammar-constrained (`response_format`/`json_schema`, added to
      `LlmCompleteOptions` and the wire types this pass) extraction call,
      tier derived from category in code (not asked of the model - "the
      schema is tiny on purpose"), dedupe against the speaker's own
      readable records at cosine 0.5/top 5 (`similarByVector()`), a match
      always supersedes rather than inserts, a contradiction closes
      `valid_to` on the old record. Poison guard (3 attempts, tracked
      persistently across ticks via new `judge_status`/`judge_attempts`
      columns, then `judge_failed`) and one `memory.updated` notification
      per run that wrote something (the notification registry already
      existed - this added one entry, not the system itself). Legacy's
      rules ported (source rule, time rule, discard rules) with one real
      adaptation: possessives resolve to the SPEAKER'S REAL NAME, not a
      generic "the user" - this platform has multiple named people per
      household reading the same facts, unlike legacy's one-account
      assumption, so "the user's wife" would be ambiguous the moment a
      second person can read it. `memory_ids` provenance needed no new
      column: `remember(..., source: turn.id)` is exactly what
      `listConversationTurns()` already joins on (step 3). Consolidate is
      scoped to what's cleanly buildable on existing primitives -
      contradiction detection (ported from legacy's own consolidate.ts)
      and demoting never-recalled durable records (`uses = 0`, 30+ days
      old) - not the near-duplicate MERGE pass (needs a "retire two old
      records into one new one" primitive this store doesn't have yet)
      or "re-tense expired states" (nothing consumes `valid_to` yet -
      real bi-temporal reads are step 10's own job). Entity-record
      creation was a real, deferred gap here; closed by Session C step 9
      (2026-09-06, see the memory bench entry below) - the extraction
      schema's own "person"/"place"/"thing" categories now write
      `record_kind: "entity"`. Procedural/Notes routing remains deferred:
      the plan's own step 6 schema still has no `kind` field for it.
      Bench (`backend/scripts/bench/judge-eval.ts`,
      LongMemEval-shaped): run against the stub chat backend, extraction
      never produces valid JSON (the stub only echoes text), so 0 facts
      were ever written - the honest result is abstention trivially
      passing (nothing to hallucinate) and the knowledge-update case
      failing (nothing to update). Needs a real chat model before this
      bench means anything; see docs/dev.md's step 6 entry.
- [x] **A maintained profile block per person** - shipped, Session A
      step 7 (2026-09-05): one pinned, person-scoped `category: identity`
      record per person (`lib/memory.ts`'s `PROFILE_SOURCE` marks it,
      `getProfileParagraph()` is the read side), written and rewritten
      ONLY by `memory.consolidate` (the weekly job, never the per-turn
      judge) from that person's own facts via a small chat call, capped
      in code at 600 chars regardless of what the model returns.
      Injected whole at the top of `buildSystemPrompt()`'s memory block,
      before any recalled item, sharing that section's existing budget
      rather than a separate cap of its own. ChatGPT and Claude both
      inject a maintained summary rather than a search-result list;
      Letta's memory blocks are the same idea.
- [x] **Dated memories in the prompt, and a closing reminder** (S) -
      shipped, Session A step 4 (2026-09-05): each bullet carries "(as of
      Sep 2, 8 days ago)" off `created_at`; the block ends with one fixed
      trust-these-facts reminder. Absolute day count, not legacy's "N
      weeks ago" rounding - the plan's own text asked for "<n> days ago"
      literally.
Memory clock stamps and validity writes already exist. The remaining temporal-read gap is tracked by [CHAT-08](#chat-08).

Maintenance is already scheduled in `backend/src/index.ts`; profile freshness and unified inference scheduling are tracked by [CHAT-11](#chat-11) and [CHAT-19](#chat-19).

Loaded-history chips and the memory page exist. getmaipai/home#64 (2026-09-13) added a narrower live-status path (the chip polling a `memory.updated` notification); **CHAT-20 has since landed and replaced it** - `chatMemoryState.ts`'s own store now reads `judge_status`/`memory_ids` straight off the conversation-turns re-poll (real `pending`/`saved`/`not_saved`/`failed` states, the 5s/10min poll lifecycle, per-message save/forget wiring), and `memory.updated` is now purely the notification-center record (in-app + optional Telegram), not the chip's live data source. 2026-09-21: `memory.updated` finally got its own settings toggle (`notifications.memory.updated.telegram`, spec-v0.1.13) after being configurable with no way to configure it since #64, and its sibling `memory.judge_failed` (the judge's other terminal outcome, the poison guard giving up) now fires too - the 1:1 backend counterpart to the chip's pre-existing "failed" state, which previously had no notification-center record of its own.

- [ ] **Retire the chip's own poll in favor of notifications** (M) -
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

- [ ] **A memory change feed for clients** (M) - the older UI work order's
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

- [x] **A household memory bench** (M) - shipped, Session C step 9
      (2026-09-06): `backend/scripts/bench/memory/{fixture,run}.ts`, the
      four LongMemEval categories `scripts/bench/memory-eval.ts` (session-a
      step 5) doesn't cover - knowledge updates, abstention, temporal
      reasoning, multi-session recall - driving real `runTurn()` calls,
      not just `recall()`/`buildSystemPrompt()` lookups. Run for real
      against this dev machine's Qwen3 8B + nomic-embed-text: abstention
      2/2, multi-session 1/2, knowledge-update 0/2, temporal 0/1 - the
      low numbers are the SAME already-tracked "short utterances free-
      associate onto the plugins list" bug step 4 first found (confirmed
      via `route()` returning null for every failing probe), not a new
      memory-store problem; see docs/dev/session-c.md's step 9 entry.
- [ ] **Skip the graph database** (decision, recorded) - Mem0 dropped its
      graph store for entity linking in a flat table; Graphiti needs
      Neo4j and a capable model. Entity columns, FTS5 and vectors on the
      one SQLite file is the local-first answer and keeps the robot
      replica trivial. The Entity/Relationship spec already gives the
      structured half.
- [ ] **Speaker resolution confidence on memory writes** (S, once voice
      ID exists) - a fact heard at low speaker confidence is stored in a
      quarantine scope and not injected until confirmed. The 2026
      multi-user memory research (AFA) names this exact shared-device
      failure, "persona confusion", and fixes it this way.

**Persona and companions**

- [x] **A Companion/Persona spec record** - shipped, Session A step 8
      (2026-09-05), as a `companion` block on the existing manifest
      shape rather than a new top-level `spec/schemas` record:
      "companions are packages" (`kind: "companion"` already existed in
      manifest.schema.json's own enum). Identity (`display_name`,
      `pronouns`, `tagline`), a short `backstory`, `interests`, 3-5
      few-shot `examples` (legacy's review: "the single biggest lever
      for small-model voice fidelity," now a real few-shot block in the
      composed prompt, not just stored), a linked `voice_id`, a
      per-companion confirmation pool (`replyVariation.ts`, scoped to
      the one constant worth it this pass, shared pool as the default),
      and the prompt prefix using `display_name` instead of a hardcoded
      "You are MaiPai" (already true since step 4; this step just made
      the catalog itself real packages). Four bundled companion packages
      (`default`/`buddy`/`pal`/`tutor`) replace `lib/persona.ts`'s old
      hardcoded array. Still open: the plan's nine sliders (four dials
      shipped, mapping or justifying the rest is unstarted) and
      activation steering (see that item below, unrelated to this one).
- [ ] **Persona is not the same as how to address the listener** - the
      "speech profile per person" item under People is the other half;
      build them as two records injected in order: who I am, then who
      you are, then memory, so style never blunts facts.
- [x] **Activation steering spike** (M, before any nine-slider prose) -
      shipped and run for real, Session C step 4 (2026-09-06):
      `backend/scripts/bench/steering-spike.ts` +
      `backend/scripts/bench/steering/{positive,negative}.txt`. Trained a
      control vector from Buddy's own register (in under a second, CPU
      only, on this dev machine's already-downloaded Qwen3 8B and the
      pinned llama-server build, which bundles `llama-cvector-generator`)
      and ran the same thirty-turn scripted conversation live against
      both conditions. **Decision recorded**: the vector wins cleanly on
      cost (a 72-char system prompt vs. 707, ~26% fewer total prompt
      tokens over thirty turns, seconds to train) and edges out the
      paragraph on a crude register proxy (23/30 vs. 19/30 casual-
      contraction turns), but reading the transcripts side by side shows
      the paragraph currently captures Buddy's SPECIFIC voice markers
      (the "I mean" filler, playful asides) better than this spike's
      generically-trained vector does - likely because the training
      pairs were generic casual/formal contrast, not Buddy's own
      `examples` field. Not yet a clear win on fidelity; worth a second
      pass training on each companion's own examples before the
      nine-slider prose question is decided either way. Full writeup:
      docs/dev/session-c.md's step 4 entry.
- [x] **A persona consistency test** - shipped, Session A step 8
      (2026-09-05), as a bench (`backend/scripts/bench/persona-eval.ts`)
      rather than the deterministic suite: ten scripted exchanges through
      the real turn engine per bundled companion, scored by string checks
      (address form, length cap, forbidden phrases). Run against the stub
      chat backend: address-form and length-cap pass structurally (40/40
      each - a content-blind echo can't leak another companion's name or
      run long), forbidden-phrases (12/40) is honestly uninformative
      against a stub that echoes the user's own words regardless of any
      system prompt. The model-judged version shipped Session C step 4
      (2026-09-06): `backend/src/lib/personaJudge.ts`, wired into
      persona-eval.ts behind `--judge`, run for real against this dev
      machine's Qwen3 8B - tutor held its register the WORST of the four
      (0/10), opposite of what the string checks alone suggested; see
      docs/dev/session-c.md's step 4 entry for the full numbers and a
      genuine, unrelated finding it surfaced (short ambiguous utterances
      free-associating onto the household's Weather plugin listing).
- [x] **The bot's honesty guards as a post-model pass** (M) - shipped
      2026-09-06, Session C step 3 (`backend/src/lib/guards.ts`,
      `backend/tests/guards.test.ts`,
      `backend/scripts/bench/conversation.ts`, docs/dev/session-c.md).
      legacy
      `guards.py` (invention, unrelated recall, near-echo, medication
      doses, capability claims), `_marked_repeat` ("Like I said" never
      across conversations) and the attractor-removal rule for prompt
      examples were each fixed against a real broken reply, with tests.
      The hub has none of them.

**Data-driven answers**

Ready, authorized candidate selection is tracked by [CHAT-14](#chat-14); structured outcomes and composition by [CHAT-15](#chat-15) and [CHAT-16](#chat-16).

- [ ] **Declare package-owned exposed records and actions** (M) - retain
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
- [x] **Grammar-constrained tool calls, verified before acting** (S, with
      Tier 2) - shipped 2026-09-06, Session C step 2 (`lib/llm.ts`'s
      `tools`/`tool_choice`, a `response_format` JSON-schema grammar, not
      OpenAI-wire tool_calls; `runPlugin()`'s existing ajv validation is
      the reused "verified before acting" check). an unparseable call is "ask again", never a silent drop;
      llama.cpp's lazy grammars still let malformed calls through on
      recent Qwen builds (upstream issue 24807).
- [x] **The routing eval corpus as a permanent test** (M) - shipped
      2026-09-06, Session C step 1 (`spec/llm/routing-corpus.json`,
      `backend/tests/routingCorpus.test.ts`). plan 4.5 says
      routing accuracy "is the number that decides whether tier 2 is
      built at all"; no corpus exists. Utterance, expected package or
      none, expected arguments, near misses that must not fire, every
      real miss added before it is fixed. Legacy `llm/router.ts` had
      about twenty regex classes each annotated with a live misroute
      ("I GOT THE JOB" routed to remember; "do you know who X is" must
      never hit search); mine those for the first rows.
- [x] **Bench models for tool calling** (S) - mechanism shipped
      2026-09-06, Session C step 2 (`backend/scripts/bench/tool-calling.ts`,
      `spec/llm/tool-call-corpus.json`) - the actual Qwen3-4B-Instruct-2507/
      Gemma 4 E4B numbers are NOT recorded (no real llama-server/GGUF
      available in that session's environment; run against the stub only,
      0/3, expected - see docs/dev/session-c.md). Qwen3-4B-Instruct-2507 and
      Gemma 4 E4B are the published sweet spots for on-device tool use
      in 2026; measure on our own tool set, not their leaderboards.
- [ ] **Speak MCP for local tools inside the hub** (M, decision first) -
      one tool contract that catalog packages and Go can share, and the
      route by which MCP Apps result panels could arrive later. Plan
      v0.1 named an "MCP spike"; nothing was spiked.
- [x] **Output-side safety on streamed sentences** - shipped, Session A
      step 9 (2026-09-05): `runTurnStream()`'s own `tokens` generator is
      wrapped by a new `gateOutputSafety()` (`lib/turnEngine.ts`, not
      `streamTurnEvents` - the route layer just consumes whatever the
      engine hands back), buffering deltas into whole sentences (the
      chunker, moved to `spec/safety/ts/sentenceChunker.ts` per this
      item's own plan text) and checking each with the identical
      `evaluateSafety()` the input path uses. A refuse category throws
      before the offending sentence (or anything after it) is ever
      delivered; a new `spec/errors/errors.json` code
      (`safety_refused`) rides the wire's `error` event. `runTurn()`'s
      non-streaming twin got the same whole-text check for symmetry,
      beyond this item's own literal ask. `frontend/src/lib/
      sentenceChunker.ts` still has its own duplicate copy - Session A
      doesn't own `frontend/`; see docs/dev.md's step 9 entry for the
      Session B follow-up that finishes the "one definition" move.

Sources for this section (research pass, 2026-09-05): [Mem0, state of agent memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026), [Letta sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime/), [Letta memory blocks](https://www.letta.com/blog/memory-blocks/), [Zep temporal knowledge graph](https://arxiv.org/abs/2501.13956), [LongMemEval](https://arxiv.org/abs/2410.10813), [Temporal semantic memory](https://arxiv.org/abs/2601.07468), [AFA, multi-user memory](https://arxiv.org/html/2604.25022v1), [ChatGPT memory Dreaming, secondary](https://letsdatascience.com/news/openai-upgrades-chatgpt-memory-architecture-for-fresher-pers-b26b51d5), [Open WebUI memory](https://docs.openwebui.com/features/chat-conversations/memory/), [PERSONA steering vectors, ICLR 2026](https://arxiv.org/html/2602.15669), [llama.cpp control vectors](https://github.com/jukofyork/control-vectors), [AgentFloor, small-model tool use](https://arxiv.org/abs/2605.00334), [llama.cpp tool-call grammar issue](https://github.com/ggml-org/llama.cpp/issues/24807), [Home Assistant LLM API](https://developers.home-assistant.io/docs/core/llm/), [Anthropic, context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [semantic-router](https://github.com/aurelio-labs/semantic-router), [MCP Apps spec](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/).

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

- [x] **The hub half of entities and relationships** (Session F step 7,
      2026-09-06) - tables and migration (`entities`, `relationships`,
      `grants`, plus the hub-internal `approvals` queue), every cross-
      field rule from `spec/records/ts/validate.ts` enforced at the
      write boundary (`lib/entities.ts`, `lib/relationships.ts`,
      `lib/grants.ts`), and `GET/POST/PATCH/DELETE` routes for all
      three plus `GET /api/people/:id/permissions` (the effective,
      resolved grant set - denies win over allows on the same action;
      `safety_stop` needs no special case since no grant action for it
      exists in the closed vocabulary to begin with) and the approval
      queue (`GET/POST /api/approvals`, `POST /:id/{approve,deny}`, its
      own `approvals.requested` notification to every adult). No UI yet
      - that's E's kit work on top of this.
- [x] **Migrate authorization from roles to grants, additively** (Session
      F step 7, 2026-09-06) - narrower than the original framing: grants
      were added *beside* roles this wave, not as a full replacement.
      `requireRoleOrGrant()` (`middleware/auth.ts`) lets an active ALLOW
      grant open a gate for someone outside the usual `roles` list, as a
      pure OR - it never narrows what an owner/admin's role already
      allows, so nothing a family could do before this landed stopped
      working. Wired to the 5 route groups with a real, already-defined
      grant action to check (`people.manage`/`people.grant` on
      `routes/people.ts` and `routes/grants.ts`, `backups.run`/
      `backups.restore` on `routes/backups.ts`, `relationships.manage`
      on the new `routes/relationships.ts`). The other ~17 `requireRole`
      call sites (`host.ts`, `plugins.ts`, `scheduler.ts`, `repairs.ts`,
      `memory.ts`'s `maintenance/run`, `totp.ts`) have no matching
      `grant-actions.json` entry today and were deliberately left on
      plain `requireRole()` rather than mechanically converted for zero
      behavioral gain - each needs a real vocabulary entry (a spec
      change) before it can gain a grant check, and `totp.ts` specifically
      should probably never gain one: which roles may even HAVE TOTP is
      a hard policy (plan 4.1: "optional TOTP for owner and admin only"),
      not an action a household should be able to grant its way around.
- [ ] **`min_role` on every package manifest becomes a grant check too**
      (L) - a manifest's declared minimum role is D's package-host
      territory (`packageHost.ts`), not touched by Session F step 7.
      Once `use:<package>` grants are actually consulted anywhere (see
      `ctx.allowance`/package gating below), a manifest's `min_role`
      should become the *default* grant a package's install seeds,
      overridable per person the same way `packages.use_all` already is.
- [ ] **Resolve the unrestricted-mode age collision** (S, Jesse's call) -
      the org's Safety invariants unlock unrestricted chat and generation
      "per-user by an adult" and restrict child profiles by default, both
      age-shaped; the grant model removes age from authorization
      entirely, so nothing can check a grantee is an adult. The Grant
      record enforces what it can (the acknowledgment is signed and must
      be by the person it is about) and documents what it cannot. Two
      correct rules in genuine conflict, not an oversight.
- [ ] **Do roles keep age-flavoured names?** (S, Jesse's call) - once
      roles are authorization-only, `adult`/`teen`/`child` either become
      labels that seed a default grant set and mean nothing afterward, or
      go entirely. The second is the only one where nobody can mistake a
      label for a rule.
- [ ] **Relationship inference** (L, and its own design pass first) -
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
- [x] **A frontend for entities and relationships** (M, lane 11 item 2,
      2026-09-13, docs/dev/session-b.md) - "People and things," a
      section in the Memory app: list by kind with relationships in
      plain words, create (with an optional relationship to a household
      member), edit a name, remove one or several. `docs/user/memory.md`
      gained its own section.
- [x] **Confirming an inferred entity or relationship** (S) - the
      transition is built (step 3a, 2026-09-13, docs/dev/session-a.md):
      `PATCH /api/entities/:id` and `PATCH /api/relationships/:id` with
      body `{ "confirm": true }`, a household adult only (403 otherwise),
      only an inferred and unconfirmed record (409 otherwise), an
      unknown body key refused (400); an entity becomes `local`, a
      relationship keeps `source: inferred` and gains
      `confirmed_by_person_id` and `confirmed_at` on both directions.
      The relationship half shipped 2026-09-14, Session B (lane 12 item
      2): the Confirm control in "People and things," adult-only
      (hidden for a child), calling `PATCH /api/relationships/:id`; the
      "Unconfirmed" mark already read `confirmed_by_person_id`. Left:
      the entity half - `subjects.ts`'s own `ensureSubjectEntity()`
      writes real `source: inferred` entities in production
      (unconfirmed pets, places, and people the judge guessed at from
      conversation) and `listEntities()` returns them with no filter,
      but "People and things" carries no Unconfirmed mark or Confirm
      control on an entity's own row, only on its relationship lines -
      an inferred entity has no UI path to ever leave that state (a
      second code review on lane 12 item 2 found this; filed as
      getmaipai/home#119 rather than folding into this item's own S
      size). Files: `frontend/src/apps/memory/` (the entities section).
      Checks: the frontend suite (green: 17 tests in
      PeopleAndThings.test.tsx, the Confirm ones among them) and a
      screenshot of a confirmed row - deferred (coordinator's ruling,
      2026-09-14): no synchronous producer of an inferred relationship
      exists to seed one for the screenshot pipeline honestly (POST
      /api/relationships and /api/entities both hardcode `source`; the
      only real producer is memoryJudge.ts's `ensureSubjectEntity()`,
      the background judge after a real chat turn, not the turn
      itself), and the ruling was not to add judge timing to that
      pipeline for one picture. Lands as its own S line, "Screenshot
      the Confirm row," once a deterministic producer exists (ASK-01's
      open-question path or a seed hook, whichever comes first).
      The entity half shipped too (f16f5ad, home#119 closed): the
      Unconfirmed mark and the Confirm control on an inferred entity's
      own row. Ticked 2026-09-15 on a backlog read.
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
- [ ] **A speech profile per person** (M) - how to address someone
      (complexity, pace, vocabulary), distinct from persona, which is who
      the assistant is being. `persona.ts` already has a `complexity`
      dimension doing half the job for the wrong owner: two people
      sharing a companion must still be addressed differently.
- [x] **An `enabled` state for a person** (Session F step 7, 2026-09-06)
      - see "Lifecycle events" above.
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
- [ ] **Does the People directory grow beyond account holders?** (open
      question, Jesse's call, 2026-09-06) - `/people` was split from
      account management on 2026-09-06 (roster add/edit/remove moved to
      Settings -> Household -> Users, `UsersSection.tsx`) and today only
      ever lists people with a real account (`GET /api/people`). Jesse's
      own framing when asking for the split: "anyone with a user account
      should be able to browse people that are users - open question if
      we let users browse all people" - naming a non-account entity
      (an ex-partner, a delivery driver, a lunch lady) as his own example
      of what a broader "people" concept could include. This is exactly
      the Entity/Person-vs-User split "The hub half of entities and
      relationships" (above) would introduce - PeoplePage.tsx cannot
      answer this on its own since there is no Entity storage yet. When
      that work starts, this needs a real design pass before code, not
      just "show everything": the spec's own "Inference is the dangerous
      half" section is exactly this risk (a household member browsing an
      entry for someone else's relationship, an inferred connection
      nobody confirmed) - same shape as the already-recorded open
      question above ("may a parent see a relationship inferred from
      their teen's conversation") but for browsing rather than
      inference specifically.
- [x] **A self-service way to change your own display name** (S) - a
      real, deliberate regression from the 2026-09-06 People/Users split:
      the old PeoplePage.tsx let anyone edit their own row (`canManagePerson`
      allows `actorId === target.id` regardless of role), which was the
      only way a non-admin could rename themselves. That Edit button
      moved to Settings -> Household -> Users with the rest of roster
      management, which is admin-gated - a non-admin has no path to
      renaming themselves at all today. Needs its own home (Settings ->
      Me is the obvious candidate, alongside Appearance/Personality/
      Voice) since `display_name` is a `Person` field, not a settings-
       registry key, so it doesn't fit `SettingsRenderer`'s generic
       schema without its own small hand-built section. Done 2026-09-15:
       a Your name section in Settings, Me scope (`DisplayNameSection.tsx`),
       any role, through the existing self-edit rule.

## Settings

- [ ] **Rebuild Settings as a real settings editor** (L) - Jesse,
      2026-09-05, with a VS Code screenshot: a tree sidebar showing the
      section and subsection you are in, search, scope as tabs, and each
      setting stacked title / description / control. Researched against
      `getmaipai/.github/docs/SETTINGS.md` and most of it is already
      decided there rather than new: Rule 1 ("a setting lives with the
      thing it configures, once") is violated by today's single long
      page, and Rule 5 already specifies a generated index with
      `@modified`/`@app:`/`@level:`/`@person` filters, which is VS Code's
      own filter model. Genuinely new and worth adding to the standard:
      the sidebar-as-table-of-contents, admin as its own area, and
      "regular users never see admin settings, even disabled ones" (which
      the grant vocabulary's `settings.admin` action now makes
      enforceable by rendering nothing rather than disabling controls).
- [ ] **Do NOT add a global "show advanced" toggle** - Jesse asked to
      double-check this one, and the answer is that SETTINGS.md Rule 4
      already forbids it deliberately: "three levels, disclosed locally,
      never a global mode... No per-person advanced mode switch." VS Code
      has no such toggle either; advanced-ness lives in groups and
      filters. Recorded here so it is not re-proposed.

- [ ] **Selector renderers so the custom sections can become declared
      keys** (M; the concrete reason Settings cannot be declarative
      today) - `SettingField` handles text, number, select and boolean,
      and secrets are read-only. Eight of ten sections on the page are
      custom React (voice catalog, cloned voices, PIN, commands, HF
      token, models, backups, routing stats) against SETTINGS.md Rule 1.
      Add `duration`, `time`, `person`, `media` and a secret-entry flow,
      then re-declare the sections that only needed those.

- [ ] **SET-TITLES-01: every settings section has a friendly title** (S)

    Objective: `groupSettings.ts`'s `sectionTitle()` falls back to a group's raw `lives_in` id when `SECTION_TITLES` has no entry for it - found live landing SHELL-05 (2026-09-21), two real sections (`household.storage`, `person.allowance`) render literally as "household.storage" and "person.allowance" instead of a real title, on both the old Settings page and `/next/settings` at once (both read the identical function). Files: `commons/ui/src/settings/groupSettings.ts`'s `SECTION_TITLES` map. Pattern to mirror: the map's own existing entries (e.g. `"household.system": "System"`). Acceptance: `SECTION_TITLES` has an entry for every `lives_in` value the registry (`spec/settings/keys.json`) declares for `home`; a test that derives the registry's own set of `lives_in` ids and asserts each has a real title (not equal to the id itself), so a future key with a new, untitled section fails the gate instead of shipping a raw id. Out of scope: the registry's own `section.id`/`order`/`collapsed` fields (unused by any real key today) and the broader "Rebuild Settings as a real settings editor" item above. Exit check: `bash scripts/check.sh` (commons repo).

- [x] A household-location setting (S-M) - done 2026-09-11. Found live a
      second time on Home itself: with no place configured, the "Today"
      weather card asked a place-free "what's the weather like today?"
      and left the model to guess a `place` argument on its own - it
      guessed the literal word "here", and Open-Meteo genuinely has a
      village named that, so the card showed a real (and very hot)
      temperature for entirely the wrong place, right next to the
      package-widget grid's own hardcoded "Seattle" default. `coreKeys.ts`
      now declares `household.home_place` (a plain place-name string,
      editable today through Settings > System via the generic renderer -
      no dedicated first-run prompt or picker yet, still open if wanted).
      `lib/plugins.ts`'s `withHouseholdPlaceDefault()` overrides any
      `place` input with it (used by `warmPackage()`, replacing weather's
      hardcoded warm key, and by `lib/widgets.ts`'s `getWidgetData()`,
      replacing its hardcoded widget default); Home's own weather card
      threads it into the fixed-turn question so a configured household
      gets the reliable deterministic pattern match instead of a model
      guess. See `backend/tests/plugins.test.ts`'s
      `withHouseholdPlaceDefault` suite and `frontend/src/apps/home/
      HomePage.test.tsx`.

- [x] A household-name tagline on Home (S) - done 2026-09-11. Found live
      alongside the household-location fix above: Home's header hardcoded
      the generic "Made for your everyday" line with no way for a
      household to make the page its own. `household.family_name`
      (`coreKeys.ts`, blank by default) lets a household set its own
      name; `frontend/src/apps/home/HomePage.tsx`'s `Tagline` renders
      "{name} Family" once set, falling back to the original generic line
      otherwise. See `HomePage.test.tsx`'s Tagline suite.

## UI / shell

- [x] **LINT-UI-01: @shadcn/lint on Home's new UI** (S) - the org's no-hand-built-UI rule made mechanical on `src/next/**`; three real gaps (Sheet has no size/max-dimension prop) recorded as a draft upstream note, everything else fixed with a real variant, size, or token. Landed 2026-09-22 (b1a4457b).

- [x] **PWA-SW-01: a waiting service worker must activate** (S, `getmaipai/home#128`) - Chrome kept an app shell days old: the new worker sat in `waiting` and never activated despite `registerType: autoUpdate` and `installReloadOnceOnNewServiceWorker`; the fix is `skipWaiting` on install plus `clients.claim`, with the existing reload-once guard, so one reload brings the new build in. Files: `frontend/src/sw.ts`, `frontend/src/main.tsx` (`installReloadOnceOnNewServiceWorker`), `frontend/vite.config.ts` (the PWA plugin block). Mirror: the plugin's own `workbox.skipWaiting`/`clientsClaim` options. Acceptance: a test in `frontend/src/sw.test.ts` that a registration with a waiting worker ends active after one reload; a manual check in Chrome that a rebuild appears on the next load. Out of scope: changing what is precached. Exit: `bash scripts/check.sh`. Landed 2026-09-21 (codex-270): `install` calls `skipWaiting()` unconditionally; the manual Chrome check is the coordinator's.

- [x] **HOME-UI-04d: one theme writer on /next** (S, found live 2026-09-21) - the /next header's logo sometimes shows the wrong light/dark variant. Three things decide "dark" on /next and disagree: `shell/useAppearance.ts` writes the `.dark`/`.light` class from `ui.appearance` (mount applies "system" first, the fetched value later); the vendored template's own `ThemeProvider` (`ui/src/dashboard/context/shadcntheme/ThemeContext.tsx`) is not mounted, so the header's `Light-Dark.tsx` toggle is a no-op and the logo swap in `layouts/full/shared/logo/FullLogo.tsx` (`block dark:hidden` / `hidden dark:block`) follows the class alone; and the kit's `ui/src/tokens.css` still carries `@media (prefers-color-scheme: dark)` blocks beside its `.dark` blocks, so when the setting differs from the OS the kit's variables and the template's class-driven parts split. Fix: mount the vendored `ThemeProvider` as shipped on /next, a Home hook `next/useNextAppearance.ts` (mirror `next/useNextLook.ts`) feeding `ui.appearance` into `setTheme` and writing the toggle's choice back to the setting; `NextRoutes` stops calling `useAppearance`; in `tokens.css` the media-query blocks apply only when no class is present. Acceptance: `ui.appearance` light with the OS dark renders /next light everywhere including the logo, and the reverse; the header toggle flips the page and persists as `ui.appearance` across reload; a test in `next/NextRoutes.test.tsx` that the class on `<html>` follows the setting, not the media query. Out of scope: the old shell's appearance. Exit: `bash scripts/check.sh`, kit tag ui-v0.5.11.

- [x] **HOME-UI-04e: one Tailwind root, the source's own default palette** (M, found live 2026-09-21) - comparing `/next/people` to the shadcndashboard demo's own user-profile side by side at 1440px: ours rendered the phone layout (hero stacked, cards full-width) where upstream renders a row and two columns, and ours read as stacked lit panels where upstream reads as one dark sheet with faint hairlines. Root cause 1: `ui/src/tokens.css` and `ui/src/dashboard/css/globals.css` were each their own `@import "tailwindcss"` root in one Vite build - two roots generate each unique utility class independently, and cross-root dedup places every colliding class wherever load order puts it, so globals.css's lazy /next chunk re-emitted every `sm:`/`md:`/`lg:`/`xl:` responsive variant after tokens.css's entry-loaded copy, winning every tie site-wide (HOME-UI-04b's sidebar fix patched one symptom, not the cause). Root cause 2: the vendored snapshot's default `:root`/`.dark` had been replaced with Home's own navy hex palette rather than the template's own shipped one, including its translucent `--border`/`--sidebar-border`/`--input`. Fix: `tokens.css` stops being a Tailwind root (its `@import "tailwindcss"`/`tw-animate-css`/`shadcn/tailwind.css`/`tw-shimmer` move to `globals.css`, the one root left); Home's `shell/tokens.css` imports both, globals.css first; `NextRoutes.tsx`'s own lazy CSS import is gone. The default palette becomes the source's own, byte-for-byte from its pinned commit (owner ruling, "identical to the source"); Home's former navy survives as its own preset, `.style-navy` (`ui.look = "navy"`, spec-v0.1.14). A live-browser re-check after the first fix found `.style-calm`/`.style-studio` still inheriting Home's navy (they carried no color of their own, and `tokens.css`'s own bare `:root`/`.dark`, deliberately kept navy for the old shell, ties with and can beat globals.css's new default depending on import order) - both get full palette blocks of their own now, same shape as the other seven presets. Acceptance: at 1440 dark, `/next/people`'s hero is a row, the info panels are two columns, and a live pixel probe of body/card/hairline matches the demo's own three values exactly (verified against a real clone of the pinned upstream commit's dev server, not just a source diff); at 390 the phone layout is unaffected; the old shell's own pages are unchanged (still navy); exactly one `@import "tailwindcss"` resolves in the build (`dist/assets/*.css` carries the responsive rules once, no duplicate in the lazy /next chunk). Out of scope: Stack/Catalog, which don't yet import `dashboard/css/globals.css` at all. Exit: `bash scripts/check.sh`, kit tag ui-v0.5.13, spec-v0.1.14, `bun run scripts/screenshot.ts --next-people-review`.

- [x] **CHAT-SDK-01: bump @assistant-ui/react to 0.15.21, coordinated** (M, 2026-09-21) - `ui/src/elements/thread.aui.tsx` reads `ThreadMessage.metadata.modality`, a field `@assistant-ui/core` added after the `0.3.17` this repo's own `0.15.18` pin was built against, blocking `/next/chat` (ui-v0.5.4's own named gap; an earlier attempt, ui-v0.5.1 through 0.5.4, bumped only the kit's own pin and broke Home's existing chat - two different `@assistant-ui/react` module instances, one for the kit's own hand-built wrapper components already in production use by `ChatPage.tsx`, one for Home's own direct import left behind). This time both move together to the identical `0.15.21`: `frontend/package.json`'s own pin, `assistant-stream` (`0.3.41` to `0.3.44`, 0.15.21's own floor), and the root `package.json` `overrides.zod` (`4.5.4` to `4.6.5`, moved up not loosened - the override itself guards a past incident, getmaipai/home 6190d3d9, where a loose range split `@modelcontextprotocol/sdk`'s own schema instances from backend's). Nine backend Tier 1 packages' own hardcoded `npm:zod@4.5.4` Deno import specifiers go stale the same way (`deno test --cached-only` can't find an exact-pinned version bun's `node_modules` no longer has) - two of them (knowledge, media-lookup) are catalog-sourced and fixed there instead (getmaipai/catalog b876690), pulled back via `refresh-bundled-packages.ts`. A real, pre-existing race in `ChatPage.tsx` (starting a temporary chat, then losing the mode to a redundant re-fetch triggered by its own `setSearchParams` call) surfaced as a reproducible failure once the new SDK's scheduling changed timing enough to expose it - fixed with `selfSetModeRef`, verified safe against the installed library's own source (a controlled `threadId` prop change passes `emitThreadIdChange: false`, no echo loop). Also: `kitElementsAliasPlugin` (vite.config.ts) plus a matching `tsconfig.json` `paths` entry so the Elements' own `@/elements/*` self-imports resolve, infrastructure for the follow-up `/next/chat` item, not wired to a route yet. Exit: `bash scripts/check.sh`, kit tag ui-v0.5.16.

- [x] **LOOK-01: ui.look drops studio and calm, default becomes neutral** (S, 2026-09-21, owner ruling) - "I like the black as the default, same as the shadcn dashboard example, but we should be using themes and have a black theme as our default": the default is a named shadcn theme, not a Home name that hides what it is. `studio` and `calm` were geometry-only presets (a 12px tile vs. a circle) over the palette `neutral` already renders byte-for-byte, and the template's own default geometry already matches what `studio` set, so neither needs a preset anymore. `ui.look`'s enum shrinks from ten values to eight (`neutral`, `stone`, `zinc`, `mauve`, `olive`, `mist`, `taupe`, `navy`); default moves from `studio` to `neutral` (`backend/src/settings/uiKeys.ts`, spec-v0.1.15, regenerated from source not hand-edited). `commons-a/ui/src/dashboard/css/globals.css` loses `.style-studio`/`.style-calm` and their now-dead `@custom-variant` declarations (ui-v0.5.17) - checked live, neither variant was ever used as a Tailwind prefix in the kit's own source. A stored `studio`/`calm` value migrates to `neutral` via a real data migration (`db/migrations/0057_look_studio_calm_to_neutral.sql`, deletes the stale row so it falls back to the new default - `lib/settings.ts`'s own read path decodes whatever's stored with no re-validation against the current registry, so a stale row would otherwise read back as a retired value forever), not a code-level coercion; `frontend/src/shell/useLook.ts`'s own `isLook()` fallback is a second line of defense for any row the migration hasn't reached yet. ui-v0.5.17's own review missed a second, live mechanism: the OLD SHELL's separate `data-look="studio"` attribute (`@/shell/useLook.ts`, unrelated to /next's `.style-*` body-class one) drove real styling too - `tokens.css`'s tile-radius/canvas-background/group-label/divider/active-gradient rules and the main nav rail's own pill geometry (`ui/src/blocks/dashboard/components/nav-main.tsx`) - all permanently dead the moment `studio` left the enum, silently reverting the rail to Calm's plainer fallback for most people (Studio was the registry default). Fixed the same way, ui-v0.5.18: Studio's own values promoted to unconditional, verified against each rule's own built CSS before promoting it. Acceptance: a fresh person renders `neutral`; a stored `studio` or `calm` reads back as `neutral` (`backend/tests/lookMigration.test.ts`); the Look select shows eight values; a probe on 8787 shows unchanged colors (the default was already `neutral`'s own palette) across both /next and the old shell's own nav rail. Exit: `bash scripts/check.sh`, kit tags ui-v0.5.17 and ui-v0.5.18, spec-v0.1.15.

- [x] **HOME-UI-04g: no flash on refresh of /next** (S, found live 2026-09-21) - refreshing `/next` shows a navy body flash and the old shell's `RouteSkeleton` before React paints the kit. Root cause: `NextRoutes` renders the loading branch (RouteSkeleton) until the settings query resolves, and the body's `.dark`/`.style-*` classes are only applied by React hooks after mount. Fix: a per-browser `localStorage` cache (`frontend/src/next/shellNextCache.ts`, key `maipai.shell.next`) written by `useNextLook` (look) and `useNextAppearance` (theme) and read by `main.tsx`'s `applyCachedNextPalette()` before React mounts, so the first paint already has the correct look/theme; `useShellNext` seeds its initial state from the cache (`on`/`off`/`loading`) instead of always starting at "loading"; `NextRoutes` calls `useNextLook` unconditionally (fixing a Rules-of-Hooks violation) and the loading branch is wrapped in a `data-testid` for tests. Acceptance: a refresh of `/next` with a prior cache renders no navy flash and no RouteSkeleton; a first visit with no cache still shows the loading skeleton. Exit: `bun tsc --noEmit` and `bun eslint .` clean, full frontend suite 528 pass.

- [x] **HOME-UI-01: the rail, header, footer and dashboard to the
      owner's ruling on "Home's pages under the kit"** (M,
      2026-09-20) - [docs/design/home-pages-2026-09-20.md](design/home-pages-2026-09-20.md).
      `shared/ui` gained five components at `ui-v0.3.0` (`IconTile`,
      `PanelHeader`, `HubCard`, `FooterBar`, `HeaderSearchField`) and a
      `Shell` footer slot; `AppShell.tsx` rebuilt (grouped nav - Home,
      Household, System, Manage omitted for now - the hub card, a real
      centered header search field, a new `ThemeToggle`, route-owned
      header title/subtitle via `shell/routeHeader.ts`); `HomePage.tsx`
      rewritten to the section's own composition (metric row, Today/
      Recent-memories panels, Your apps, People/Activity/Quick actions -
      the ask box moved to the header). The header rule's "no duplicate
      title" swept across six other pages (`hideTitle`) plus a second,
      separate duplicate `SettingsPage.tsx` had on its own. A real,
      previously-unwired backend feature (`GET/POST /api/updates`) got
      its first frontend caller for the Updates metric/footer segment/
      quick action, rather than a fabricated placeholder. Full account
      in [dev.md](dev.md)'s own entry. Exit check: `bunx tsc --noEmit`
      and `bun test` clean (484 pass), screenshots opened beside
      `shared/ui/docs/reference/overview-dashboard.png` and judged.
- [x] **HOME-UI-02: the Apps page as a real things table** (M,
      2026-09-20) - the "Apps" paragraph of
      [docs/design/home-pages-2026-09-20.md](design/home-pages-2026-09-20.md).
      `AppsPage.tsx` rebuilt on the kit's `ThingsPage`/`FilterColumn`/
      `ThingsTable`/`DetailsPane`/`KeyValueList` over the 33 real
      installed packages `GET /api/plugins` reports (plugin/companion/
      skill - a different catalog from the nav shortcuts the old page
      showed, which are untouched); Remove wired to the real uninstall
      route, gated on role and on whether the package actually has an
      active store install, never conflating "can't check" with
      "confirmed nothing to remove." `shared/ui` gained `TypeBadge`, a
      real async-safe confirm step on `DetailsPane`'s destructive
      actions, and a `PhoneModeContext` actually wired to a live
      breakpoint (`ui-v0.3.2`) - three real gaps in code that had never
      been exercised until this page used it, none caught by
      `ui-v0.3.0`/`0.3.1`'s own review passes. `scripts/screenshot.ts`
      never had a `/apps` route entry at all; closed in the same commit.
      Full account in [dev.md](dev.md)'s own entry. Exit check: `bunx
      tsc --noEmit` and `bun test` clean on both repos, screenshots
      opened (desktop/phone, light/dark, plus the pane open).
- [x] **HOME-UI-02c: two looks, one setting, and the collapsed rail
      fix** (M, 2026-09-20) - the owner's "Two looks, one setting" and
      "The collapsed rail" rulings
      ([docs/design/home-pages-2026-09-20.md](design/home-pages-2026-09-20.md)).
      A person picks "Look" (Settings > Me > Appearance): Studio
      matches the reference exactly and is the hub's own default, Calm
      is the softer look HOME-UI-01/02 shipped first - `ui-v0.4.0`
      carries the mechanism (`data-look` on `<html>`, a `studio:`
      Tailwind variant, `--tile-radius`/`--canvas-background` tokens),
      Home's own `useLook.ts` reads the new `ui.look` settings key
      (`spec-v0.1.2`) and applies it live from the same TanStack Query
      cache entry the Settings page's own renderer writes to. Same
      commit fixes the collapsed rail in both looks: one toggle (the
      in-rail `RailToggle` deleted), 64px width, every row a real
      40x40 centered target with its touch target still floored at
      48px, the active item's collapsed fill gradient-in-Studio/flat-
      in-Calm, the hub card a real icon tile instead of a lone status
      dot. `ActionTile`/`MetricCard`'s label truncation fixed in both
      looks. Full account in `shared`'s own `docs/dev.md` and
      `CHANGELOG.md`. Exit check: `bash scripts/check.sh` green on
      both repos; `scripts/screenshot.ts --shell-rail-review` run with
      a household forced to Calm and again at the real Studio default,
      both 180 pages/0 violations; the four `shell-rail-{expanded,
      collapsed}-desktop-{light,dark}.png` captures opened and judged
      against the owner's own checklist.
- [x] **HOME-UI-02d: the phone dashboard, Conversations folds into
      Chat, and the rail's navigation correction** (M, 2026-09-20) -
      the owner's "Phone density, and conversations inside Chat,"
      "Navigation, corrected," "The phone composition," "The rail
      geometry, exactly," and "The Studio look, the numbers" rulings
      ([docs/design/home-pages-2026-09-20.md](design/home-pages-2026-09-20.md)).
      Phone dashboard rebuilt to the reference's own composition: a
      wordmark header with search/theme/bell folded into the avatar
      menu (the bell's count as a dot on the avatar), a hero ask card,
      the four metrics as one 32px-tile strip, 18px section titles with
      13px subtitles, horizontal shelves for recent conversations and
      memories, two-column app cards. Conversations retired as its own
      page: Chat's own thread list (search, rename, delete already
      built in) is the persistent desktop column and a phone/tablet
      sheet, `/conversations` redirects to `/chat?list=1`. Rail
      regrouped to Home (Home, Chat, Apps) / Household (People) /
      System (Settings) - Privacy stays in the rail for HOME-UI-03 to
      fold into Settings; Memories moved onto a person's own profile
      as a Memories tab (`PersonProfilePage.tsx`, reusing the old
      MemoryPage's own components unchanged), `/memory`/`/memories`
      redirect there. "Your apps" on the dashboard is now the
      reference's compact installed-components strip, not tall cards
      with a density slider. The screenshot pipeline gained a real
      per-panel overflow check (`scripts/panelOverflow.ts`,
      `findOverflowingPanels`) replacing its old page-level-only one,
      and seeds the rail footer's device name ("Bramble hub," the
      persona roster, matching HOME-UI-03's own already-uncommitted
      fix) instead of the real machine hostname. `ui-v0.4.1`/`0.4.2`
      carry the kit side: `PhoneNav`'s configurable `max` (Home's own
      three-destination phone tab bar), the notification badge's
      broken position and "9+" cap, and the rail's own reference-exact
      Studio geometry (fixed 252px/72px rail width, exact padding/
      radius/gaps, the active item's real gradient/ring/glow,
      `NotificationPopover`'s badge) - `0.4.2` fixed four box-model
      bugs a code review caught in `0.4.1`'s own geometry (an over-
      constrained width+margin box overflowing the rail by its own
      right margin, an 8px brand-tile/pill misalignment, a group-
      divider double-inset, a stale comment/changelog contradiction on
      the collapsed rail's own width). Three real, pre-existing bugs
      found and fixed along the way, not this item's own scope but
      blocking its acceptance: Radix's `Dialog.Root` (Chat's own
      thread-history Sheet) aria-hiding the page's own h1 the instant
      it mounts open, whether or not its content is CSS-hidden, which
      hung the screenshot pipeline on desktop before `phone &&
      threadsOpen` gated it correctly; the "WhoIsHere/MediaShelf" real-
      Chromium shelf-collapse quirk (HOME-UI-02c already named it
      twice) hitting a third component, the phone dashboard's own new
      shelves; Chat's own header controls and a Settings > Voices card
      running past their own edge at 390px, never caught by the old
      page-level overflow check - exactly the evidence
      `findOverflowingPanels` (`scripts/panelOverflow.ts`) existed to
      produce. What retiring Conversations as its own page cost is
      recorded under the design doc's own "Conversations live inside
      Chat" ruling and scoped as HOME-UI-02e, next. Full account in
      [dev.md](dev.md)'s own entry. Exit check: `bash scripts/check.sh`
      green on both repos; `scripts/screenshot.ts` (full matrix) and
      `--shell-rail-review` clean; captures at 1440 and 390, both looks
      and themes, of the dashboard, Chat with the list open, and a
      person's Memories tab, opened and judged; the 390 dashboard read
      against the owner's own phone reference's prose description (the
      reference image itself is another product's screen and stays out
      of both repos); `panelOverflow.test.ts` proving the new check
      catches a seeded overflow.
- [x] **HOME-UI-02e: rail geometry corrected, then Conversations' own
      real functions move into Chat's thread list** (S-M) - two parts,
      both done. **Part one (`ui-v0.4.3`/`.4`, 2026-09-20):** HOME-UI-02d's
      own committed capture didn't match the rail-geometry numbers it
      claimed to (pixel-measured, not visually scanned) - the active
      pill unset, the brand tile clipped at x 0, no gap before the
      first group label; fixed twice over (`ui-v0.4.3` restated the
      owner's own literal numbers, `ui-v0.4.4` found `home`'s own
      `AppShell.tsx` `Brand` component silently dropped every
      className the kit ever tried to inject on it - no version of the
      kit's own fix could have worked until `Brand` forwarded its
      props). `hubIdentity.ts`'s `MAIPAI_DEMO_HUB_NAME` env-var branch
      removed too. Full account in [dev.md](dev.md)'s own "Rail
      geometry, corrected again" entry. **Part two (`ui-v0.4.8`,
      2026-09-20):** the four things the old Conversations page did
      that the new thread list didn't - a person picker for an admin's
      oversight of a child's conversations, multi-select with batch
      delete and a clear-all, pin and unpin on the thread row and its
      menu, and search backed by the existing server-side message-body
      search - are all restored. `chatThreadListAdapter.ts` now takes
      `{ personId, query }` and implements `updateCustom` for pin
      (piggybacking on `RemoteThreadListAdapter`'s own `custom`
      extension point, not a new adapter shape); `thread-list.aui.tsx`
      (the kit) gained multi-select, a batch bar, clear-all, and pin UI
      behind a new opt-in `actions`/`pinnable` prop pair, so a caller
      that doesn't supply them is unaffected. A real backend bug
      surfaced along the way and is fixed too: `GET /api/conversations`
      used to silently drop whichever person was being viewed the
      moment a search query was present (`query ? undefined : person`),
      so an admin searching while viewing a child's own list would have
      searched their own conversations instead. Full account in
      [dev.md](dev.md)'s own "Conversations' real functions, restored"
      entry. Exit check: `bash scripts/check.sh` green; a regression
      test per restored function (a parent picking a child's own thread
      list and seeing only theirs, a batch-delete removing exactly the
      selected threads, a clear-all, pin surviving a reload, a
      message-body search finding a thread its title never mentions) -
      all five in `chatThreadListAdapter.test.ts` and
      `conversationHistory.test.ts`; captures at 1440 (list open, a
      selection active) and 390 - the 390 capture is blocked by a
      pre-existing, unrelated bug (see dev.md).
- [x] **HOME-UI-02f: fold the phone header's search/theme/bell into the
      avatar menu, the bell as a dot** (S) - done, `ui-v0.4.9`.
      HOME-UI-02d's own known gap: the phone header showed search/
      theme/bell as three separate icons instead of the reference's own
      folded avatar menu with the bell's own count as a dot.
      `Shell.tsx` gained two new optional props, `phoneHeaderTitle` and
      `phoneHeaderActions` (a render prop, so the product's own phone
      menu can open the kit's command palette), that replace
      `headerTitle`/`search`/`headerActions` on phone width only when
      both are given - any consumer that hasn't adopted the fold
      (Stack, Catalog) sees no change. `primitives/Avatar.tsx` gained
      an optional `dot` prop (the vendored shadcn `AvatarBadge`).
      `AppShell.tsx`'s `PhoneWordmark` (the compact wordmark + version
      pill) is the phone title; `ProfileSwitcher`'s existing popover
      gained an `extraActions` render prop and a `dot` prop, and
      `PhoneHeaderExtras.tsx` (new) supplies the folded Search/
      Appearance/Notifications rows - the avatar menu already existed,
      the fold adds to it rather than building a second menu. A real
      accessibility gap found running this item's own capture: the
      desktop `headerTitle`'s own `<h1>` was the ONLY heading on any
      page (no page's own content renders one), so the phone fold
      would have removed it everywhere on phone - fixed with a real,
      `sr-only` `<h1>` alongside the wordmark, which also keeps every
      phone capture in `scripts/screenshot.ts` working (all wait on
      `getByRole("heading", {level: 1})`). Landed after two review
      rounds on the kit branch, both finding real defects (full account
      in `commons`'s own `ui/CHANGELOG.md`, `ui-v0.4.9` entry). Full
      account in [dev.md](dev.md)'s own entry. Exit check: `bash
      scripts/check.sh` green on both repos; a 390 dashboard capture,
      both themes, closed and with the avatar menu open, showing one
      avatar control with no separate search/theme/bell icons and the
      bell's unread count as a dot on the avatar, not a floating badge
      (`data-scratch/screenshots/phone-header-fold-*.png`, opened and
      judged).
- [ ] **STORE-01: a real GET route to browse a trusted catalog index,
      and the settings it needs** (S/M) - the gap HOME-UI-02 found and
      deliberately did not build around: "the store is the same page
      behind a 'From the catalog' filter"
      ([docs/design/home-pages-2026-09-20.md](design/home-pages-2026-09-20.md))
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
- [x] **Fix SettingsPage's content squeeze at the kit's real 960px
      breakpoint, then drop the `--breakpoint-lg` override** (S) - step
      5a (2026-09-20) restored `--breakpoint-lg` to 1024px in
      `frontend/src/shell/tokens.css` rather than let the kit's own
      960px reopen a real squeeze bug in `SettingsPage.tsx`'s own
      `lg:hidden`/`lg:flex` split (the shell's rail plus the settings
      tree sidebar crowding the content column below ~1024px, first
      found 2026-09-05). Fixed by narrowing the settings tree sidebar
      from `w-52` to `w-44` so the content column holds at the kit's
      real 960px `lg` tier, and deleting the `--breakpoint-lg`
      override from `tokens.css`. Added a 1000px viewport to
      `scripts/screenshot.ts` to exercise the 960-1024px gap.
- [ ] **Chat's empty state and message turns don't yet match
      `commons/ui/docs/spec.md`'s Chat section** (M) - found live, step
      5b (2026-09-20), judging the acceptance screenshot set against the
      spec text just landed alongside it. Three gaps, all pre-existing
      (`thread.aui.tsx` moved into `apps/chat/` largely unchanged per
      that step's own scope, which was the four new kit components -
      senses dock, child band, sources card, memory chip - not a
      redesign of the message list): (1) "Empty, loading, error" wants
      the companion's 64px avatar, its name, and one capability line
      above the three suggestion chips (`ThreadWelcome`/`ThreadSuggestions`
      in `frontend/src/apps/chat/thread.aui.tsx`) - today's empty state
      is a bare "How can I help you today?" heading with no avatar and
      no populated suggestions (the wiring to assistant-ui's own
      `ThreadPrimitive.Suggestions` is there; nothing feeds it real
      starter-prompt data). (2) "Thread" wants a 24px avatar and name at
      the left of every assistant turn; today's turns render as plain
      text with neither. (3) "Streaming" wants a "2px teal caret"; the
      current caret (`ThreadMessage`/`MarkdownText` in the same file)
      renders in the foreground color, not teal. Needs a design pass on
      where the avatar asset and capability copy come from before
      implementation. Exit check: `home/scripts/check.sh` green, the
      same five-state screenshot set re-opened and matching spec.md's
      "Empty, loading, error" and "Thread" text.
- [ ] **TV-focusable nav rail, regressed by the `@maipai/ui` kit adoption**
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
- [x] Person edit and delete (M) - done 2026-09-05. `PATCH`/`DELETE`
      `/api/people/:id` plus `POST /api/people/batch-delete`, the rules
      in `lib/personLifecycle.ts`, and real UI with multi-select. A
      deleted person's memories, conversations, settings, jobs and
      recordings are erased for real; the person row becomes a tombstone.
      See `docs/dev.md`, "Person edit and delete".
- [x] Backup restore, end to end (S) - done 2026-09-05. Staged, not
      applied live: the route decrypts and verifies, `db/index.ts`
      swaps it in at the next start. Owner-only, with a real
      confirmation. See `docs/dev.md`, "Restore, staged and applied at
      boot".
- [x] A privacy page ("what leaves the house") (M) - done 2026-09-05.
      `GET /api/privacy` aggregates every bundled package's
      `data_sources[]` plus the hub's own downloads (models, engine,
      wake word, TTS program, TTS model, voice files, embeddings);
      `/privacy` renders it in dad-test language. See `docs/dev.md`,
      "The privacy page".
- [ ] **A generic "share" mechanism in the UI schema/manifest system**
      (L, Jesse's ask, 2026-09-06) - the actual ask was sharing specific
      creations (images, videos, music playlists, video playlists,
      AI-generated podcasts), but Jesse's own follow-up reframed the
      shape: this should be "a mechanism in our app template/schema...
      ability to share," not a bespoke share button built per content
      type. Matches platform principle 1 (one definition, one place) -
      the right home is likely `spec/ui/schema.json` (a `share` action
      alongside the existing action union - see `EmptyState.tsx`'s
      comment on `navigate`/`call`/`play`/`confirm`/`ask`) or a manifest-
      level capability a package declares once and the generic renderer
      honors everywhere, rather than each of images/videos/playlists/
      podcasts growing its own share affordance independently. Needs a
      design pass on what "share" even means for a private, self-hosted,
      no-phone-home hub before any code (share TO whom - another
      household member only, or an exported file/link off the hub
      entirely; the org's privacy architecture rules govern the second
      case directly) - not just wiring up a button.
- [x] **Batch select and clear-all everywhere else** (M) - done 2026-09-13
      (lane 3 item 4). The org rule landed 2026-09-05
      (`getmaipai/.github/docs/UI.md` > Batch actions, Jesse: "every
      section should provide easy batch and or delete all mechanism").
      People and Conversations already had it; Memory was the case Jesse
      named specifically. `MemoryPage.tsx`'s default (own-memories) view
      moved from the generic schema-page interpreter back to
      hand-written (the same "stays hand-written" call People and
      Conversations already made): the interpreter's own batch mechanism
      only loops one call per selected item, never a single request
      carrying every id, and a real clear-all needs exactly that. New
      "Select memories" -> "Forget selected" and "Clear all" both call
      the new `POST /api/memory/batch-forget` (`backend/src/lib/
      memory.ts`'s `forgetByIds`, one round trip regardless of count),
      finally giving `forget()`'s real erasure a UI on the default list,
      not just the per-person admin view. Partial failure (a pinned or
      entity record) is reported, never swallowed. The per-row "Archive"
      quick action is unchanged. Notifications still inherits the same
      rule when it gets a surface.
- [x] **The kit owns the batch-selection pattern** (S) - done 2026-09-05.
      `kit/primitives/BatchBar.tsx` (the count, the caller's own batch
      actions, Done) and `SelectModeToggle`; `PeoplePage.tsx` now consumes
      it instead of hand-rolling the row. Entering select mode's exact
      wording stays page-specific (copy differs per list); the
      destructive confirmation panel itself was ALSO lifted once a
      fourth hand-copy turned up (`kit/primitives/DestructiveConfirm.tsx`,
      2026-09-06: Users, Conversations, Memory's admin view). Memory's
      own default list became the pattern's real consumer 2026-09-13
      (item above). See `docs/dev.md`, "Session B: step 1".
- [x] Notifications UI (done 2026-09-05, `docs/dev.md`'s "The
      notification system, a real working slice" entry) - `NotificationBell`
      (shell header: pending list + toast on new arrival). Still real gaps:
      no thirty-day history page yet (only the pending list and the
      `GET /api/notifications/history` route it would read from), and
      "clear all" isn't built (this item's own "batch actions" rule
      applies once it is).
- [ ] Package/skill catalog browsing and install (L) - blocked on the
      `catalog` repo existing for real; today only local bundled packages
      run at all. Confirmed again in session E's step 3 (2026-09-06):
      none of `GET /api/store/index`, `/packages`, `/packages/:id`,
      `POST /install`, `/install/confirm`, `/uninstall`, `/rollback`,
      `/channel` (docs/plans/wave-2.md's frozen D-to-E contract) exist
      yet - "not a line of it exists" below is still literally true.
      Deliberately not built against a fixture the way widgets/lists
      were in step 2: the store's own real UX (a two-call permission
      prompt, README rendering, channel/rollback/uninstall) is too large
      and too security-sensitive to build convincingly without a real
      install to drive it against, unlike a card that degrades to
      "nothing yet."
- [ ] Admin / parental-controls surface beyond the generic settings
      renderer (M)
- [x] **Wire the measurable half of accessibility into the screenshot
      pipeline** (S) - done 2026-09-06 (Session E, step 0).
      `scripts/screenshot.ts` now runs `@axe-core/playwright` plus a
      horizontal-overflow check against every route App.tsx declares, at
      every viewport (phone/tablet/desktop/far) and theme (light/dark);
      `bun run screenshots` is the full matrix (saves PNGs under
      `docs/assets/screens/` for a human to look at before a commit),
      `bun run a11y` is a fast two-combo subset meant for `scripts/
      check.sh`.
- [x] **Wire `bun run a11y` into `scripts/check.sh`** (S) - done
      2026-09-13 (cdd80f0): the contrast finding blocking this was fixed
      first (aaaf724, `--destructive` retuned per-theme), then the a11y
      scan added back to `check.sh`'s frontend section right where the
      comment above said it used to sit.
- [x] **#71: Phone keyboard regression in empty/loading/desktop layouts** (M, Session B, 2026-09-12)

    The phone-keyboard fix in 27858d0 regressed six things across empty,
    loading, and desktop chat layouts. Full defect list, root causes, and
    verification detail: docs/dev.md's "Session B follow-up" entry.
    Files: `frontend/src/kit/assistant-ui/thread.aui.tsx`,
    `frontend/src/kit/useVisualViewportHeight.ts` (+ its test),
    `frontend/src/kit/ui/sidebar.tsx`, `frontend/src/apps/chat/ChatPage.tsx`,
    `frontend/src/apps/chat/ChatPage.test.tsx`, `scripts/screenshot.ts`,
    `frontend/tests/stubMatchMedia.ts` (new, shared with `useSurface.test.ts`).
    Out of scope: #60 (message edit branching), #66 (shipped separately).
    Checks: `bunx tsc --noEmit`, the full `bun test` suite,
    `bash scripts/check.sh`, `bun run scripts/screenshot.ts --chat-review`,
    every regenerated screenshot read by hand.

- [x] **#59: The wake word toggle crashes the dev server** (S, Session B, 2026-09-12)

    Root cause was not what the issue guessed: `wasmPaths = "/ort/"` made
    onnxruntime-web's WASM backend `import()` a file under `public/`, which
    Vite's dev server refuses by design (confirmed against Vite's own error
    text). Fixed by leaving `wasmPaths` unset in dev (resolves inside
    `node_modules` instead, which Vite serves normally) and keeping it only
    in production (`import.meta.env.PROD`), preserving the no-CDN privacy
    guarantee. `ort.env.wasm.proxy = false` was already the library's
    default and isn't the actual fix, kept only for explicitness. Full
    story: docs/dev.md's "Session B, second lane" entry. Files:
    `frontend/src/lib/voice/wake-word-runtime.ts`,
    `frontend/src/lib/voice/wake-word-runtime.test.ts` (new). Checks:
    `bunx tsc --noEmit`, `bunx eslint .`, the full `bun test` suite,
    `bun run build`, `bash scripts/check.sh` (all checks passed), clicking
    the toggle in a real `bun run dev` session (console and dev-server log
    both read).

- [x] **#69: WebKit reports a keyboard trap on Home** (S, Session B, 2026-09-12)

    Not a real focus defect: macOS's `AppleKeyboardUIMode` default excludes
    every `<button>`/`<a>` from WebKit's Tab order, leaving only a handful
    of form fields and explicitly-tabindexed elements to cycle through -
    exactly the 5-element loop the check flagged. Fixed by pressing
    `Option+Tab` (Playwright's `"Alt+Tab"`, WebKit's own override that
    reaches every control regardless of the system setting) instead of
    plain `Tab` when the check runs against WebKit; Chromium unchanged. No
    OS-level preference touched (a first attempt using `defaults write`
    was rejected on review for exactly that reason). Full story:
    docs/dev.md's "Session B, second lane" entry. Files:
    `scripts/screenshot.ts`. Checks: `bun run scripts/screenshot.ts
    --a11y-only --webkit` (34 pages, 0 violations, keyboard-trap check
    passing). Note: the full `--chat-review --webkit` repro command still
    fails on an unrelated, pre-existing WebKit chat-exchange timeout - not
    a keyboard issue, filed as #75. Also filed #76: a `--webkit` run
    silently overwrites the Chromium screenshots the docs publish, since
    output filenames carry no browser tag - hit this myself verifying
    #69, reverted the overwritten images by hand.

- [x] **#56: The Privacy page screenshot was stale** (S, Session B, 2026-09-12)

    Regenerated with `bun run screenshots`, opened, confirmed the #12
    reorganization (leads with "Can someone outside see what we say to
    MaiPai?", then "Can someone reach into your house?", then "What
    leaves your house (15)"), real content, no spinner or empty state.
    Checked `docs/user/privacy.md` against it - no drift, no prose change
    needed. Files: `docs/assets/screens/privacy-desktop-light.png`.

- [x] **#76: A WebKit screenshot run overwrote the Chromium images** (S, Session B, 2026-09-12)

    Every browser wrote to the same `docs/assets/screens/<name>.png` path;
    a `--webkit` run (a11y/keyboard-trap verification, never screenshot
    review) silently overwrote the published Chromium images. Fixed:
    Chromium keeps the published path, every other browser writes under a
    gitignored `docs/assets/screens/webkit/` subdirectory instead - chosen
    over "write no PNGs unless `--write`" since it still allows visual
    inspection of a real WebKit rendering bug. Full story: docs/dev.md's
    "Session B, lane 3" entry. Files: `scripts/screenshot.ts`,
    `.gitignore`. Checks: a `--webkit` run's own log line confirms the
    webkit-subdirectory path and leaves `git status` on `docs/assets/`
    clean; a plain Chromium run confirms the published path is unchanged.

- [x] **Privacy page: the inbound row rendered its fields in the wrong slots** (S, Session B, 2026-09-12)

    Renderer bug, not a data bug: `backend/src/lib/privacy.ts` deliberately
    repurposes `destination`/`who` for the one inbound row (there's no real
    "host the hub reaches out to" for a connection running the other way,
    its own comment explains this), but `ConnectionRow`
    (`PrivacyPage.tsx`) rendered every row identically regardless of
    `direction`, putting a scope sentence in bold as the heading with the
    real source name dangling unlabeled at the bottom. Fixed: inbound rows
    use the source name as the heading and show the scope description as
    a labeled "Scope:" field instead; outbound rows unchanged. Full story:
    docs/dev.md's "Lane 3 item 2" entry. Files: `frontend/src/apps/
    privacy/PrivacyPage.tsx` (+ test). Checks: `bunx tsc --noEmit`,
    `bunx eslint`, full `bun test` suite (484 pass), the regenerated
    screenshot opened and read.

- [x] **#66: Hardcoded "unavailable" error code masked safety refusals** (S, 2026-09-12)

    Fixed: pass event.code through; show generic banner only for "unavailable";
    show backend's message for coded errors like "safety_refused". Files:
    `frontend/src/apps/chat/chatModelAdapter.ts`,
    `frontend/src/apps/chat/chatModelAdapter.test.ts`. Checks:
    `bun test src/apps/chat/chatModelAdapter.test.ts`, `bash scripts/check.sh`.

- [x] **#60: Message edit vanishes on history reload** (M) - done 2026-09-13.
    A nullable `supersedes` column on `conversation_turns` (migration 0030,
    no spec change - it's part of the hub-internal utterance log, not the
    synced conversation thread), threaded through `runTurn()`/
    `runTurnStream()` and `POST /api/turn(/stream)`; `chatHistoryAdapter.ts`
    rebuilds the real branch tree from it (`fromBranchableArray()`) so an
    edit's sibling survives a reload. See docs/dev/session-b.md for the
    full writeup, including why getting the edited message's own id out of
    assistant-ui took two dead ends before landing on reading state
    directly inside `EditComposer`.
- [x] **Parallelize `scripts/screenshot.ts`'s full matrix** (S) - done
      2026-09-13 (lane 3 item 5). A code review (2026-09-06) noted the 4
      viewport x 2 theme x up to 17 route matrix ran fully sequentially
      against one browser, taking several minutes; nothing about
      Playwright requires that (one Chromium process supports many
      concurrent contexts). Added a small pool (`runPool()`, start at 4,
      per this note): combos run concurrently against each other, each
      combo's own routes stay sequential inside their one context.
      `--chat-review` stays pool size 1 (its two combos share and mutate
      one conversation, `POST /api/conversations/clear` - concurrent
      would race). Full matrix: 1:38 to 55s (~1.8x, not the naive 4x -
      Chromium and the one shared backend cap how much four contexts
      actually overlap). Output not byte-identical, but proven to be
      run-to-run variance the script already had (a same-code control
      run differs by a near-identical count, same routes each time,
      visually identical when opened) - see `docs/dev.md`. `bun run
      a11y` unchanged: 0 violations.
- [x] **`--primary` contrast, done** (session E step 7, 2026-09-06) -
      white text on `--primary` (`#ffffff` on the original `#06a9c6`,
      `hsl(189 94% 40%)`) measured at 2.8:1, under WCAG AA's 4.5:1 floor
      for normal text, on every route with a default-variant `Button` or
      an active sidebar nav item (Home, Chat, People, Memory, Privacy,
      Settings and its sub-pages). Fixed at the token level (same hue
      and saturation, darkened to `hsl(189 94% 29%)`, `frontend/src/kit/
      tokens.css`) - measures ~5:1 now, checked against both light and
      dark themes (dark theme's own pairing was already ~10:1 and
      untouched). `--ring`/`--sidebar-ring` follow `--primary` to the
      same value rather than diverging (their own 3:1 non-text
      requirement was never the violation and stays clear). Re-running
      the full `bun run a11y` matrix confirms every one of these
      instances is gone.
- [x] **A second, narrower contrast finding, found while verifying the
      fix above** (session E step 7, 2026-09-06; root-caused and closed
      Session B lane 3 item 3, 2026-09-12) - the `#85858d`-vs-`#70707a`
      mismatch was never an assistant-ui theming gap: it was axe-core
      scanning before the chat pane's `fade-in` entrance animation
      (`animate-in fade-in duration-150`) finished, catching the
      timestamp mid-transition at a lighter, still-animating color.
      Proved deterministically (`scripts/screenshot.ts`'s own
      `settleAnimations()`, see `docs/dev.md`): with the settle step
      removed and the fade lengthened to 5s, the scan reliably fails (11
      nodes on chat/phone/dark, 7 on chat/desktop/light); with the
      settle step restored before the same 5s fade, it passes at 0
      violations. The element itself is `frontend/src/apps/chat/
      chatDayDivider.tsx`'s own `MessageTimestamp`, not an assistant-ui
      internal. Fixed by moving the settle wait to run before every
      route's axe scan (previously only chat-review's post-scan cleanup)
      and closed alongside the type-floor fix below.
- [x] **`scrollable-region-focusable`, done** (session E step 6/7,
      2026-09-06) - re-running the full `bun run a11y` matrix after
      merging main (F's real `GET /api/health` landed with
      `requireAuth`, which needed `scripts/screenshot.ts`'s own
      `waitForHealth()` fixed to treat any response, not just a 200, as
      proof the backend is up - it is a liveness probe, not an
      authenticated health check) surfaced this rule failing on Setup,
      Home, and Privacy: a scrollable `overflow-y-auto`/`overflow-x-auto`
      region with no keyboard access. Privacy was already known (noted
      here as "pre-existing, unrelated"); Setup and Home were not.
      Grepped every `overflow-{x,y}-auto` container in `frontend/src` and
      found the same gap repeated across eleven files (`Wizard.tsx`,
      `SchemaPage.tsx` - covering every Settings sub-page that renders
      through it - `HomePage.tsx` (both its page body and the "Who is
      here" avatar strip), `SettingsPage.tsx`, `PrivacyPage.tsx`,
      `MemoryPage.tsx`, `ConversationsPage.tsx`, `NotificationsPage.tsx`,
      `PeoplePage.tsx`, `SearchPage.tsx`, `WidgetRow.tsx`'s horizontal
      item strip, and `ChatPage.tsx`'s thread-list sidebar) - only
      `DetailPane.tsx` and `SplitView.tsx` already had the fix. Applied
      `DetailPane.tsx`'s own
      established pattern (`tabIndex={0}` + `FOCUS_RING` + the same
      `eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex`
      comment) everywhere rather than only the three routes the matrix
      happened to catch: the other six pages don't overflow with today's
      demo data, but the same latent bug would resurface the moment a
      real household has enough people, notifications, or conversations
      to make them scroll. Full `bun run a11y` matrix confirms zero
      instances of this rule remain.
- [x] **Keyboard-trap testing and reduced motion verification, done
      against the home route** (session E step 7, 2026-09-06) - both
      real, automated, in `scripts/screenshot.ts`'s `bun run a11y`, not a
      manual read-through: `checkReducedMotion` opens two Playwright
      contexts, one per `reducedMotion` preference, and confirms
      `ProfileSwitcher.tsx`'s own header trigger button's computed
      `transition-duration` (Tailwind's `transition-all`, real and non-
      zero by default) is genuinely non-zero under the normal preference
      and collapses to ~0 under `"reduce"` - checked both ways, since
      only checking the reduced side would also pass if the CSS rule
      were deleted (an element with no transition at all also computes
      near-zero); `checkKeyboardTrap` tabs 40 times and compares the
      first half's distinct focus targets against the whole run - a
      fixed size floor ("at least N elements") would let a real trap
      cycling among N-or-more real elements (a dialog with a close
      button, a few fields, submit) pass undetected, so this checks
      instead whether the second half ever finds an element the first
      half hadn't already seen, which catches a cycle of any size, not
      just a small one. Both verified against a real, deliberately-
      broken CSS rule / a real, deliberately-added cycling trap to
      confirm they actually fail when the thing they check for is
      genuinely broken, not just checked for a clean pass. **Scope
      note**: both run once, against `/`, not the full per-route matrix
      - `bun run a11y`'s own design goal is staying fast enough for every
      commit (its header comment), and a keyboard trap or a missing
      reduced-motion override is architectural (the global CSS rule, the
      shell's own focus order) rather than per-route, so one real page is
      real signal without paying N times the cost. A trap or a motion
      regression confined to one specific page's own markup would not be
      caught by this - genuinely open, not implied "done" by this entry.
- [x] **A screen-reader read-through of each real page, done as far as
      this environment allows** (session E step 7, 2026-09-06) - no real
      screen reader (VoiceOver/NVDA) is drivable from here (no GUI
      session, no accessibility-permissioned macOS process), so this
      used the closest real, scriptable proxy instead: Playwright's
      `ariaSnapshot()`, the exact structured accessibility tree an AT
      actually receives, captured for all 17 real routes and read
      through by hand rather than skipped or claimed done without it.
      Found and fixed two real gaps axe's rule-based scan can't catch
      (neither is a WCAG success-criterion violation, both are real
      screen-reader confusion): `Avatar.tsx`'s fallback initial had no
      `aria-hidden`, so every avatar announced its own letter as real
      text right before the adjacent name everywhere Avatar is used -
      "S Sage Owner" on People, "S You M Marlow N Nova" on Home's Who's
      Here strip; and `SettingsPage.tsx`'s tree sidebar signaled the
      active section only by color/weight (`bg-muted font-medium`), so a
      sighted user sees "you are here" and a screen-reader user hears a
      flat list of identical buttons - fixed with `aria-current="page"`.
      One hypothesis from the read-through turned out wrong before being
      "fixed": the main nav rail's active-page marker looked absent in
      the snapshot's own rendering, but checking the real DOM directly
      showed `NavLink`'s own `aria-current="page"` was already there -
      `ariaSnapshot()`'s format simply doesn't surface that attribute,
      which is exactly why "check the read-through's own hypothesis
      against the real DOM before touching code" mattered here. **Not
      covered**: `/setup`'s real wizard steps - seeding the demo
      household for this pass completes setup first, so every visit to
      `/setup` redirects to Home before the wizard's own accessibility
      tree can ever be captured; verifying it would need a second,
      unseeded backend run, not done here.
- [x] **User-tier docs (`docs/user/`), for the screens Session E built,
      done** (session E step 9, 2026-09-06) - nine pages, one per real,
      working feature: getting started (the setup wizard), Home, Chat
      and talking to it (folding in Conversations, a short section
      rather than its own page), People and parental controls, Memory,
      Notifications, Privacy, Settings, and Fix a problem. Written to
      `docs/STYLE.md`'s tier-1 rules (grade 6-8, one task per page,
      "what you see and tap" steps, no route paths or system-internal
      nouns as instructions) with plain Markdown front matter (`title`/
      `description`) so it drops into F's docs site directly. Screenshots
      embedded only where a real, non-empty state existed to show (five
      pages: Home, Privacy, Settings, Users, Repairs) - every one opened
      and looked at before use, per the org's own screenshot rule; the
      others (Chat, Memory, Notifications) stayed text-only rather than
      embedding a misleading image, for two different reasons: Chat's
      only available capture showed the same canned reply repeated four
      times (the WeatherCard/Chat-history-pollution bug this file already
      tracks elsewhere, not something to paper over by cropping it out),
      and Memory/Notifications' captures are both genuinely empty states
      (a fresh demo household that never accumulated either) - the org's
      "no spinner, skeleton, empty state" screenshot rule ruled both out,
      not a shortcut.

      **Deliberately not documented, because neither is built yet**:
      "the store" (plan 4.10's package-install UI - `docs/BACKLOG.md`'s
      own "store host on the hub" item is still open) and "update"
      (no real update-check/install flow exists anywhere in the app -
      grepped for one, found none). The session plan's own step 9 list
      named both; writing a user-tier page for a feature nobody can
      actually use would violate "docs update in the same commit as the
      change they describe" in the specific direction of describing a
      change that never happened. Both get their own page once D's store
      work and a real update flow exist.
- [ ] Onboarding beyond the one-time initial household setup (M)
- [x] Accessibility audit (M) - done 2026-09-05, driven against the
      running app at phone and desktop, not read off the source: 142
      violations found, all fixed, re-measured at zero. See `docs/dev.md`,
      "The accessibility audit". Not covered and still open below: colour
      contrast, screen-reader flow, keyboard traps, and the TV surface.
- [ ] Any UI for calendar, email, camera/vision, or generation (blocked on
      each of those existing first)
- [ ] **The `app` kind: full, multi-page apps (Videos/Weather/Podcasts-
      style), re-decided 2026-09-06, not yet built.** The 2026-09-05
      "own nested route subtree" verdict is superseded: it contradicted
      plan 6.2 (pages are schema data; custom React only as a
      `platforms: [web]` federated bundle), couldn't install from a
      catalog without a rebuild, and couldn't be served by the robot's
      standalone shell or Go's native renderer. A `design-resolver` pass
      (session E, 2026-09-06) found the fix needs zero new node kinds:
      an `app` package's page is just a `page` document through the
      *existing* SchemaPage/NodeRenderer path (the same one
      `spec/ui/pages/memory.json` already runs through) - that identity
      is the proof "the app kind is data," not a new node could ever be.
      Concretely: `contributes.pages[]` entries `{id, icon, label, nav,
      kind: "schema" | "web", module}` (D's manifest file), no `to`
      field - the route is derived (`/apps/<package id>/<page id>`,
      `id: "index"` derives the bare `/apps/<package id>`), served at a
      new `GET /api/plugins/:id/pages/:pageId`. Data stays the existing
      `binding` mechanism with one required addition: `useBinding` needs
      package-scoped path resolution and a same-package guard (reject a
      package page's binding that reaches outside its own route
      namespace) via a `PackageScopeContext`, since today's bare
      `request(binding.path)` would let a package page read e.g.
      `/api/people` verbatim. No incremental-patch protocol is needed for
      v1 - poll via the query layer's normal cadence like every other
      page (widgets' own `refresh_s` is the only real refresh case that
      exists today); `binding.stream` (declared, unimplemented) is the
      named landing spot if real-time patches are ever wanted later. The
      `platforms: [web]` escape hatch is `contributes.pages[].kind:
      "web"` (valid only when the manifest's own `platforms` includes
      `"web"`) with the loader rejecting it outright for all of Wave 2 -
      a manifest field, never a sibling node kind, since a node
      SwiftUI/Go can't render would hollow out `catalog.test.ts`'s own
      agreement test. **The schema blocker on D is cleared** (Session D
      step 10, 2026-09-06): `manifest.schema.json`'s `contributes` is now
      an object keyed by blueprint kind, with `pages[]` typed exactly as
      recommended above (`{id, icon, label, nav, kind: "schema"|"web",
      module}`) alongside `widgets[]`; the redundant top-level
      `pages: string[]` is gone, and every bundled manifest's own empty
      `"pages": []` was dropped with it. **Still open for E**: the
      `GET /api/plugins/:id/pages/:pageId` route itself, `PackageScopeContext`,
      the nav-registry merge, and `PackagePage.tsx` - no package
      populates `contributes.pages` yet (D's own `lists` didn't end up
      needing a dedicated page this wave, so there's still nothing real
      to prove the consuming side against).
- [x] **Build the missing kit primitives before the first full app, not
      alongside it** (M) - done 2026-09-05. `getmaipai/.github/docs/UI.md`
      decided that apps never build their own chrome (sidebar, search,
      cards): they declare typed blueprint contributions and compose
      pages from shared kit primitives, never hand-rolled UI. The five
      the standard names and the kit lacked - `CardGrid`, `MediaShelf`,
      `List`, `DetailPane`, `SplitView` - are now in
      `frontend/src/kit/primitives/`, generic and content-agnostic, with
      the breakpoints and density budgets owned by `kit/responsive.ts`.
      Building them first is what forces the first app into the shared
      vocabulary instead of risking a repeat of legacy's separate
      `VideosRail`/`MusicRail`/`PodcastRail`/`NewsLayout` for what should
      be one shared component. Details in `docs/dev.md`, "The five
      missing kit primitives".
      **The other half of this item, done 2026-09-05:** `frontend/src/
      shell/nav.ts` is now the data-driven nav registry `Shell.tsx` reads
      (matching `spec/ui/schema.json`'s new `nav_entry` def field-for-
      field); core's five pages register there by hand until a package's
      manifest `contributes.pages` can feed a sixth entry in without
      editing this file. See `docs/dev.md`, "Session B: step 2".
- [x] **The data contract half, superseded and shipped** (Session D
      step 9, 2026-09-06): `docs/plans/wave-2.md`'s own frozen D-to-E
      contract answered the open design questions below for real -
      `contributes.widgets[]` (`{id, title, size: "card"|"row",
      refresh_s, inputs?}`) is the manifest hook, `GET /api/widgets`
      lists what a role can see, `GET /api/widgets/:package/:id/data`
      returns `{as_of, items}` by calling the exact same `runPlugin()` a
      live chat turn or a warm tick already calls and wrapping its
      `reply.text` as one item - no new "structured widget data" shape
      invented, no live fetch outside the existing package cache.
      `weather`, `news`, `list-view`, `almanac-date` are the first four
      real widgets. **Still open, and still Jesse's design pass, not
      decided by this contract**: the visual card/row system itself
      (size, density, the size slider), which packages actually surface
      on the dashboard vs. staying chat-only, and the legacy prior art
      below - all E's/the dashboard's own build, once picked up.
- [ ] **Skills as home-screen widgets - cards and rows** (L, needs its own
      design pass before any code - Jesse, 2026-09-05). The idea: a
      skill's data shown on a dashboard as a card (or, for some skills, a
      horizontal row of cards) instead of only being reachable by asking
      for it in chat. The manifest hook and the data route are real now
      (see the item above); the card/row system itself - which packages
      opt in, size/density, refresh cadence on the actual dashboard - is
      still undecided.
      **Real prior art from the legacy app**, kept as reference for the
      design pass, not as something to port (the org's "copy from legacy"
      allowance is for hard-won logic, never UI or feature scope - so this
      informs a fresh design, it isn't the design):
      - `homeWidgets.ts` was a single source-of-truth catalog (id, title,
        description, icon, an `allowWide` flag for a full-width 2-column
        tile, and a `toolId` gating availability on whether the backing
        tool/skill was actually installed - the direct precedent for "a
        widget only exists if a real skill backs it," never a "coming
        soon" tile).
      - A `supportsRowMode` flag: some widgets, expanded to full width,
        switched from a vertical card to a horizontal strip of smaller
        cards - the actual "cards vs. rows" distinction Jesse's asking
        about, already had a real precedent.
      - `CardSizeControl.tsx` - a popover slider (range 180-560px, step
        10, default 260) driving one CSS variable
        (`--takeover-card-min`) that every grid consumed via `repeat(
        auto-fill, minmax(var(--takeover-card-min), 1fr))`, persisted per
        app per device. Its own comment names the inspiration directly:
        the Apple Photos / Plex / Lightroom toolbar-zoom pattern. This is
        the "slider to dynamically adjust card size" Jesse referenced -
        real, working code in the legacy app, a good reference point for
        a fresh implementation, not a drop-in port.
      **What a real design pass still needs to decide** (the manifest
      hook, the data route, and the reply-text-as-widget-item mapping
      are answered now - see the item above): the actual visual card/row
      system on the dashboard, which packages surface there by default
      vs. opt-in, and how this interacts with the proactive/caching idea
      noted below (a widget is the most natural place a proactively-
      fetched fact would actually surface).

- [x] **The home screen: keep the dashboard, make it a real home**
      (decision for Jesse, then a design pass, M) - Jesse asked
      (2026-09-05) whether legacy's home (a grid of app shortcuts with
      favorites, search, a greeting and the weather, every app standalone
      with a consistent back-to-home) is still the modern answer. The
      honest read from the research and the 2026-08-25 navigation note:
      the bones are right and current, the emphasis is dated.
      - **Right and still current:** a consistent app shell with Back
        that always works (plan 6.4, Apple TV and every smart display do
        this); favorites as the family's own list, shipped with fewer
        pins than eleven so it never becomes a menu; search on the home
        screen; the home's row order following the pinned order (Plex's
        one-list-two-payoffs trick, already in the 08-25 note).
      - **Dated:** a grid of app icons as the *content* of home. That is
        a 2010 phone home screen. Every 2026 family surface (Hearth,
        Skylight, Echo Show, Nest Hub) leads with glanceable state (who
        is here, today's plan, one thing worth knowing) and keeps app
        shortcuts as a strip. Hearth's "built with the child as the
        primary user" is the closer reference for a shared kitchen
        screen than Skylight's parent-first calendar.
      - **Recommendation:** home is shell-owned (plan 6.1: the platform
        owns all chrome), composed from package contributions: a
        greeting with who is here (from sign-in now, voice or face ID
        later), a row of "today" cards (the "skills as home-screen
        widgets" item above is exactly this, so the two items merge),
        a pinned-apps strip driven by the same `pinnedIds` the sidebar
        uses, and one prompt box that is both search and chat (type or
        talk; finds apps, memories and answers). Each app keeps the
        consistent header with Back; on desktop the sidebar stays the
        one permanent navigation and auto-collapses in consumption
        modes, on phone it is the bottom bar, on TV the focusable rail,
        exactly as plan 6.1 already says, so "standalone app" is what
        every surface except desktop looks like anyway.
      - **Personal data on the shared screen only after the person is
        confirmed** (Nest Hub's voice-matched-only toggle is the model);
        until then home shows household-level cards only.

      **Status, done 2026-09-13 (lane 9 item 1)**, reconciled by
      reading `frontend/src/apps/home/HomePage.tsx` directly, not this
      prose (full per-clause audit: docs/dev/session-b.md, "Lane 9 item
      1"). Built: the greeting and who's-here strip; the Today cards
      plus a separate, already-shipped "Your packages" widget grid
      (the manifest hook, data route, and a real card-size slider -
      "skills as home-screen widgets" below stays its own item on
      purpose, for the density/opt-in design questions it still has
      open; the grid itself was merged into the "Your apps" strip below
      on 2026-09-20, HOME-UI-01 - COORDINATOR's own ruling that a
      pinned app and an installed package are one tile shape, not two
      stacked sections - this paragraph otherwise describes what shipped
      on 2026-09-13, unedited); the pinned-apps strip, reading the sidebar's own
      `pinnedIds` (one definition, `usePinnedApps`); the prompt box,
      now real search-and-chat for typing (apps, people, memories,
      conversations, settings, commands - the same shared query lane 9
      item 2 built). Each app's consistent header with Back is real.
      Not built, left open rather than claimed: voice into the search
      box ("talk" - only Chat's own composer has dictation today); the
      sidebar's auto-collapse "in consumption modes" (the collapse
      control itself is real, but manual-only by design,
      `Shell.tsx`'s own comment: "the person's own choice - never the
      default"). Not applicable: "confirmed person" gating - the
      current auth model has no signed-in-but-unconfirmed state to
      gate against (`App.tsx` renders sign-in INSTEAD of Home, never
      both); what this describes is the same future ambient/shared-
      screen case "voice or face ID later" above already names, not a
      gap in today's build.
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
- [x] **Input-mode detection in the kit** (M, everything TV depends on
      it) - done 2026-09-05. `kit/useSurface.ts`: `{ pointer, hover,
      input, far }` from `usehooks-ts`'s `useMediaQuery` (`pointer`,
      `hover`) plus a hand-written keydown/pointerdown/gamepadconnected
      listener for `input`, and a webOS/Tizen/Fire TV user-agent check
      for `far` (arrow keys alone are indistinguishable from a keyboard's
      - the real signal legacy's own table row named). See `docs/dev.md`,
      "Session B: step 2".
- [x] **Two render profiles per component, near and far** (M) - done
      2026-09-05 for the shell's own nav: the Sidebar renders as a real
      focusable TV rail via `@noriginmedia/norigin-spatial-navigation`'s
      `useFocusable` when `useSurface().far` is true (arrow keys move
      focus, Enter navigates - verified live against a simulated webOS
      user agent), and a `.surface-far` class bumps the type scale.
      **Extended 2026-09-06 (session E step 7) below the shell**:
      `Card.tsx` and `List.tsx`'s `onSelect` row both gained the same
      `useFocusable` treatment, split into their own `TvCardButton`/
      `TvListRowButton` components (Shell.tsx's own `NavItem`/`TvNavItem`
      pattern - the hook can't be called conditionally, and needs
      `ensureTvNavInit()` to have already run, which every route
      guarantees by rendering under `Shell` first); `focused` drives a
      `ring-2 ring-ring` ring, matching the nav rail's own visual
      language. `CardGrid`, `MediaShelf`, and `WidgetCard` all inherit
      this for free through `Card`. Verified live the same way the nav
      rail was: a real Playwright context with a TV user agent, two apps
      pinned through the real settings route so Home's `PinnedAppsStrip`
      renders real cards, then real `ArrowDown`/`ArrowRight` presses -
      confirmed Norigin moved real focus onto a card (`data-focused`,
      the ring class, both present in the live DOM). **Still open:**
      `FormNodeView`'s text/number `<Input>` fields have no far branch -
      deliberately deferred, not silently skipped: no `spec/ui/pages/
      *.json` page declares a `form` node today (`NodeRenderer`'s
      generic form/`on_select` paths are exercised only by the schema-
      conformance test, never a real page), and the real fix (real DOM
      `.focus()` on far, since a software keyboard needs actual focus to
      attach to, not just Norigin's own `focused` flag) needs a real TV
      browser to confirm the platform's own on-screen keyboard actually
      appears - not something a Chromium-headless matrix can verify.
      Build it once a schema page ships a real `form` node, verified on
      real hardware then.
- [x] **Phone chrome per UI.md** (M) - done 2026-09-05. `shell/PhoneNav.tsx`:
      a five-entry bottom bar (today's five real pages fit exactly, so
      "More" has no content yet; the mechanism exists for a sixth),
      replacing the icon-only rail under 640px. See `docs/dev.md`,
      "Session B: step 2".
- [x] **A profile switcher in the header** (S) - done 2026-09-05.
      `shell/ProfileSwitcher.tsx`: a Popover (matching NotificationBell's
      own non-modal pattern, not a Dialog) listing every other household
      member, a PIN prompt for secured ones (reusing `api.select`/
      `api.verifySecret`, the same routes SignIn's picker already calls),
      and sign-out moved inside it as a secondary item. A known, accepted
      duplication: the PIN auto-submit-on-4-digits behavior is copied
      from `SignIn.tsx` in small form rather than extracted into a shared
      hook under this session's time budget - a real follow-up.
- [x] The UiNode renderer, and the schema catching up to the kit (M-L) -
      done, session-b-ui.md step 5 (2026-09-05): `spec/ui/schema.json`
      now carries twelve node kinds (`list`, `card_grid`, `media_shelf`,
      `detail_pane`, `split_view` added alongside v0's set), each with a
      real `NodeRenderer.tsx` case, and `spec/ui/pages/memory.json` runs
      live through it. "Make Chat the first page rendered from JSON" was
      deliberately reversed instead (reasons in `spec/ui/README.md`), a
      closed decision, not outstanding work. This item's stale text
      (six kinds, nothing rendered) is corrected here rather than left to
      mislead the next reader; the `app`-kind re-decision it named is its
      own item above, resolved 2026-09-06.
- [x] **Compact chat composer and status panel** (S, 2026-09-07) -
      `ChatPage.tsx`, `thread.aui.tsx`, and `SensesDock.tsx`: one input
      row that grows with text; Think longer in Chat options; Brain,
      Mouth, Ears, and Eyes in Chat status. Wake word stays mounted
      when the status panel closes. Verified by the seeded screenshot
      flow at phone/dark and desktop/light.
- [x] **Chat uses real saved conversations** (M, 2026-09-07) -
      `chatThreadListAdapter.ts`, `chatHistoryAdapter.ts`, and
      `chatModelAdapter.ts` use the existing per-conversation API.
      New chats get distinct ids; selected history and outgoing turns
      use that id; titles and confirmed deletion persist across reloads.
      The URL keeps the selected chat, and Conversations links to it.
      Spec-first `POST /api/conversations/:id/resume` explicitly reopens
      owned chats before sending, without weakening stale-ID rejection.
      Mirror the existing `Conversation` lifecycle and assistant-ui
      adapters. Acceptance: create two, reload, continue the first,
      rename, delete the second, reload again. Out of scope: persistent
      branches, attachments, and continuous voice. Exit checks:
      `bash scripts/check.sh`, `bun run screenshots --chat-review`.
- [x] **FEED-01: Thumbs up and down on a reply, as labels** (M, spec
      first, 2026-09-16). Objective: the household rates a reply with
      one tap and the rating becomes a human label for the review
      program, never a hidden counter. Spec first:
      `spec/schemas/reply-feedback.schema.json` (turn id, person id,
      `verdict: up | down`, an optional one-tap `reason` from a fixed
      list: `wrong`, `too_long`, `did_not_listen`, `off`, `unsafe`, the
      clock stamp, provenance), fixture and bindings. Backend: a
      `reply_feedback` table and migration, `POST /api/conversations/
      turns/:id/feedback` and its read (Zod, OpenAPI), and the row joins
      RVW-1's weekly label export (`docs/BACKLOG.md` "RVW-1") with the
      turn's rung and fired rules, so a thumbs down is a labeled failure
      with its causes beside it. Frontend: the installed assistant-ui
      (0.15.18) already ships `ActionBarPrimitive.FeedbackPositive` /
      `FeedbackNegative` and a `FeedbackAdapter`; wire that adapter to
      the route in `frontend/src/apps/chat/chatActionBar.tsx` beside
      Listen and Remember, a down tap opening the five-reason chip row.
      Child band: the two buttons only, no reason row. Acceptance: tap
      down on a reply, pick "wrong", reload, the state persists per
      person, and the week's export lists the turn with its rules.
      Mirror `chatMemoryActions.ts` for the call and `chatMemoryChip`
      for the chips. Out of scope: any change to the reply from a
      rating (that is the classifier's job, RVW-2). Exit:
      `bash scripts/check.sh`, the screenshot of the reason row opened.
      - [x] **FEED-01a: feedback table and migration** (mechanical). Add
            `reply_feedback` and its migration, mirroring the nearest
            person-scoped write table and its schema-version test. Acceptance:
            one row per person and turn upserts safely; exit: targeted backend
            tests and `bash scripts/check.sh`.
      - [x] **FEED-01b: feedback action bar** (mechanical). Wire
            `ActionBarPrimitive.FeedbackPositive` and `FeedbackNegative`
            through assistant-ui's `FeedbackAdapter`, mirroring
            `chatMemoryActions.ts` and `chatMemoryChip`. Acceptance: down opens
            the five chips and reload preserves the selected state; exit:
            chat tests and the reason-row screenshot.
      - [x] **FEED-01c: feedback export join** (mechanical). Extend
            `scripts/bench/labels.ts`'s RVW-1 row query and tests, mirroring
            `labelOf()` and `exportLabels()`. Acceptance: weekly JSONL places
            verdict and reason beside rung and rules by `turn_id`; exit:
            labels tests and `bash scripts/check.sh`.
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
- [x] **Chat stream reconnection and persistent message branches** (M) -
      `chatModelAdapter.ts`, `chatHistoryAdapter.ts`, and the turn API.
      Markdown, multiline input, stop, copy, suggestions, timestamps,
      day dividers, and streaming announcements already exist; the old
      missing-basics list was stale. Mirror the existing turn stream
      and history fixtures. Acceptance: an interrupted stream resumes
      without duplicate text; edits and regenerated alternatives survive
      reload with the chosen history. Spec-first design before changing
      persisted shapes. Out of scope: projects and attachments. Exit:
      `bash scripts/check.sh` plus new stream/branch regression tests.
      - [x] **CHAT-STREAM-01: resumable turn stream** (S, design landed
            2026-09-16). Add an opaque owner-bound resume token to the
            initial `turn_meta` event, sequence deltas, and resume an
            interrupted generation without replaying acknowledged text.
            Preserve the original safety, routing, guard and ceiling
            decisions. Exit: backend and frontend interruption tests.
      - [x] **CHAT-STREAM-02: persisted branch runtime** (M, spec landed
            2026-09-16). Use `parent_turn_id` and `branch_chosen` from the
            ConversationTurn record for edits and regenerated alternatives;
            reload the chosen path while retaining siblings for
            assistant-ui's `BranchPickerPrimitive`. Exit: API, history,
            merge and picker tests.
      - [x] **CHAT-STREAM-03: landing gate** (S). Combine stream resume,
            branch choice and reload coverage; judge the chat screenshots,
            run the targeted suites, and run `bash scripts/check.sh`.
- [x] **Conversations as records** (M, spec first) - done, session A step
      3 (backend: a real `Conversation` shape, `GET /api/conversations`
      as a real thread list, rename/delete/batch-delete/clear-all) plus
      session E step 5 (2026-09-06: the frontend page,
      `frontend/src/apps/conversations/ConversationsPage.tsx`, and a
      real, live bug this step found and fixed along the way -
      `chatHistoryAdapter.ts`'s own history load was still calling the
      bare `/api/conversations`, which session A's step 3 had already
      repointed to the new thread-list shape, so every Chat page load
      was fetching the wrong shape and silently rendering `undefined`
      user/assistant text; the fix pointed it at the real
      `/api/conversations/turns` instead. The companion axis per
      conversation plan 4.14 leaves unspecified is still open.
- [x] **Push-to-talk in the composer** (M) - done, session E step 4
      (2026-09-06): a real `DictationAdapter`
      (`frontend/src/lib/voice/sttDictationAdapter.ts`) against a real
      `WS /api/stt/stream` client, wired into assistant-ui's own stock
      mic button. Uses the server's own VAD for barge-in, not the named
      legacy Silero numbers specifically (0.5/0.35 hysteresis, 0.32 s
      pre-roll) - those stay recorded below for whoever tunes the
      server-side VAD itself, since this session's own barge-in just
      forwards whatever the server decides rather than running local
      detection.
- [x] **A real bug this session found, not caused by it, and not fixed
      here** (session E step 5, 2026-09-06) - fixed 2026-09-13. Home's
      `WeatherCard` (`runFixedTurn.ts`) calls the exact same `POST
      /api/turn/stream` route Chat itself uses for a fixed "What's the
      weather like today?" utterance, and the turn engine persisted
      every turn it handled regardless of caller (`chatHistoryAdapter.ts`'s
      own comment: "the backend already persists every turn server-side...
      independent of anything this adapter does"). That meant every time
      a household member's Home page ran its own weather check, a
      visible "What's the weather like today?" turn silently appeared in
      their REAL Chat history - previously invisible only because the
      bug above broke history loading entirely. Confirmed live: the
      screenshot matrix's own repeated Home visits (across viewports/
      themes, one shared session) left several duplicate weather turns
      sitting in Chat's thread once the load bug was fixed, visible in
      `chat-desktop-light.png`. Fixed with the smaller of the two options
      named below: an additive `ephemeral?: boolean` on `POST
      /api/turn/stream`'s body and on `runTurnStream()`'s opts
      (`routes/turn.ts`, `turnEngine.ts`), threaded only to the three
      `logTurnSafely()` call sites inside `runTurnStreamHoldingLease()` -
      the reply, the output safety boundary, and the lease all still run
      exactly as for a real turn, only the log write (and, since
      `recordEpisodes()` runs inside `logTurn()`, the episode write) is
      skipped. `runFixedTurn.ts` sets it; `api.streamTurn()`'s new
      trailing param carries it. See `docs/dev/session-b.md`,
      `backend/tests/turnEngine.test.ts`'s ephemeral suite, and
      `frontend/src/apps/home/runFixedTurn.test.ts`.
- [x] **Kit gaps found by the audit, partial** (S each) - done 2026-09-05:
      `AsyncState` (loading, error with retry, empty - built, not yet
      wired into the five pages that hand-roll the triad; that's step 3's
      data-layer job) and Checkbox (`PeoplePage.tsx`'s select-mode row now
      uses `kit/ui/checkbox.tsx` instead of a raw `<input>`). See
      `docs/dev.md`, "Session B: step 1". **Still open:** Textarea, Tabs
      with a URL-bound active tab, a real Chip/Toggle (Chat's two pill
      toggles now use `Button` with a variant, which fixed the raw-
      element and focus-ring lint findings but isn't a dedicated Chip
      component); MemoryPage onto `List`; Shell and NotificationBell
      tests.
- [x] **The kit ESLint config UI.md mandates** (S) - done 2026-09-05.
      `frontend/eslint.config.js`: `typescript-eslint`, `react-hooks`
      (rules-of-hooks/exhaustive-deps only, not the full v7 React
      Compiler set - recorded why in dev.md), `jsx-a11y`, and
      `eslint-plugin-better-tailwindcss`'s three correctness rules
      (no-unknown-classes, no-conflicting-classes, no-restricted-classes
      banning hex/rgb arbitrary values). Bans `lucide-react` outside
      `kit/icons.ts`, raw `<button>`/`<input>` in `src/apps`, and (a
      hand-written rule, no plugin covers it) a `hover:` variant with no
      paired `focus` on a native element. `bun run lint` runs it;
      `scripts/check.sh` calls it. See `docs/dev.md`.
- [x] **A real PWA** (S-M) - done 2026-09-13 (lane 4 item 2). Removed
      the one oversized icon from the manifest, added maskable variants.
      Switched `vite-plugin-pwa` from `generateSW` to `injectManifest`
      (`generateSW`'s own `navigateFallback` blocked a real network-first
      rule from ever running) and wrote `src/sw.ts` with the legacy
      `sw.js` v5 rules: navigations network-first with a precached
      offline page, full Firefox passthrough (its Local Network Access
      gate blocks SW-routed fetches to a LAN host). Reload-once-on-
      `controllerchange` and a stale-chunk reload already existed
      (`pwaBoot.ts`, Vite's own `vite:preloadError` event - stronger
      than a hand-wrapped `lazyRetry`, since nothing here is
      `React.lazy()`-loaded yet). Added the one real gap, a React error
      boundary (`kit/primitives/ErrorBoundary.tsx`), for a render crash
      after boot that the existing boot watchdog doesn't cover. Verified
      live: killing a spare-port backend mid-session and reloading shows
      the offline page; Chrome's own `Page.getInstallabilityErrors`
      reports zero errors. See `docs/dev.md` for the full detail,
      including a real bug (`caches.match` vs `matchPrecache`) found and
      fixed during that live verification. Privacy page needs no
      change - no new outbound connection.
- [x] **Reduced motion, type floor, theme colour** (S) - done 2026-09-05.
      `kit/tokens.css` now has one global `prefers-reduced-motion: reduce`
      rule (zeroes animation/transition duration everywhere); the
      appearance setting (`ui.appearance`: system/light/dark, person
      scope, `backend/src/settings/uiKeys.ts`) exists and `shell/
      useAppearance.ts` applies it (a `.dark`/`.light` class, and drives
      `theme-color` off the resolved value instead of the hardcoded dark
      meta tag). The bell badge and thread timestamp this note named are
      done (Session B lane 3 item 3, 2026-09-12): the bell badge (`shell/
      NotificationBell.tsx`) was already on `text-base` from an earlier,
      unrelated change; `chatDayDivider.tsx`'s `DayDivider` and
      `MessageTimestamp` were the two `text-xs` (12px) instances this
      note pointed at, under the kit's 16px floor, and are now
      `text-base`. No `text-[10px]` instances exist anywhere in the
      current codebase. **The repo-wide sweep is done too** (lane 7 item
      3, 2026-09-13): all 49 remaining `text-xs` instances judged one by
      one - 26 real body text/labels/headings moved to `text-base`, 23
      left as deliberate exceptions with a comment naming why (a badge
      or chip, a keyboard-shortcut/byte-size/duration token, a compact
      size variant like Button's `xs` or Avatar's small fallback, a
      typographic convention like `<sup>`), matching `eslint.config.js`'s
      own established policy that `src/kit/ui`/`src/kit/assistant-ui`
      (vendored shadcn/assistant-ui output) get the floor applied by
      hand where it matters rather than swept wholesale. A new
      `local/type-floor` ESLint rule (same shape as the kit's own
      `hover-needs-focus`), scoped to `src/apps`/`src/shell` matching
      that same file-scope convention, fails a sub-floor class with no
      nearby exception comment - proven both ways (a planted violation
      failed, the same class with an exception comment passed), so the
      sweep can't quietly regress.
- [x] **A screenshot matrix in the pipeline** (M; sharpens the tracked
      "wire the measurable half" note) - done 2026-09-13, reconciled
      against getmaipai/.github's docs/UI.md and docs/STYLE.md. What the
      standard asks for and the matrix now does: every page (18 routes)
      at every surface (phone, tablet, desktop, TV via a user agent) in
      light and dark (136 shots); horizontal overflow; the
      `clippedStrips` check (a real layout bug class, the WhoIsHere/
      MediaShelf `overflow-x-auto` quirk); WCAG 2.2 AA via a real axe
      scan (`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`/`wcag22aa`/
      `best-practice`); reduced-motion and keyboard-trap checks; a
      generated `manifest.json` per shot (capture script, viewport,
      theme, date), merged across partial runs (`--chat-review` etc.)
      rather than a second manifest system or a wipe. Two things the
      standard also names, found NOT met and NOT S-sized, so left open
      rather than forced: (1) undersized touch targets - axe-core
      4.13.0 ships no target-size rule at all (checked its own rule
      list directly), and a live measurement across the full matrix
      found dozens of real interactive elements under the kit's own
      48px floor on nearly every page (sidebar nav rows, icon buttons,
      role tabs) - enforcing this is a kit-wide redesign, not a
      pipeline check; new item below. (2) the AI vision-model review
      STYLE.md describes (a verdict per shot, written into the
      manifest, failing the build on a miss) - not built; a new,
      separate pipeline stage, not a screenshot-matrix gap. High
      Contrast, the third fixed theme STYLE.md names, isn't captured
      either, but that is blocked on the theme system itself (no High
      Contrast preset ships yet) - a theming gap, not this item's.
- [x] **Enforce the kit's 48px touch-target floor** (M) - done
      2026-09-13, lane 8 item 1. A `page.evaluate()` measurement in
      `visitRoute()` (real rendered geometry, not an axe rule - axe-core
      still ships none), crediting the kit's own pseudo-element hit-area
      extension (`::before` or `::after`, button.tsx's `xs`/`sm`/
      `icon-xs`/`icon-sm`/`icon-lg`, slider.tsx's thumb) and exempting
      `aria-hidden` mirrors (Radix Select's hidden native `<select>`)
      and anything carrying `data-touch-target-exempt` (the sidebar's
      own resize rail: mouse-only, `tabIndex={-1}`, redundant with the
      header's real `SidebarTrigger`). Every real violation the sweep
      found got fixed at the floor, not exempted: the brand-mark links
      (Shell.tsx), the composer's own input and its five action buttons
      (thread.aui.tsx, `size="icon-lg"` fixed in button.tsx plus a
      per-site hit area since a couple of wrapping components' own
      baked-in classes beat a bare `size` prop in the merge order), New
      chat and Chat options (ChatPage.tsx), the conversations list's
      title links, the settings back link and search field
      (SettingsPage.tsx), the card-size slider's thumb (slider.tsx,
      `::after` credited, not just `::before`), and - found only once a
      real transcript loaded, not by the empty-state matrix - the whole
      per-message action bar (Copy, Refresh, More, Listen, Remember
      this), fixed once in `TooltipIconButton`'s own default size rather
      than five call sites. Proven both ways: a planted 24px button
      failed the check with its exact measured size, then passed clean
      again reverted. `bun run a11y` (34 combos) and `bun run
      screenshots` (136 combos, twice) both 0 violations; `bun run
      scripts/screenshot.ts --chat-review` (the one path that renders
      real assistant messages) also 0. Full writeup: docs/dev/
      session-b.md, "Lane 8 item 1: the touch-target floor".
- [ ] **A vision-model verdict per screenshot** (L) - getmaipai/.github's
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
- [ ] **Health and Repairs pages, the updates projection, self-update
      with stage, swap, health check and rollback** (L) - plan v0.1
      scope, absent here entirely; "cut a first release" below cannot be
      exercised end to end without them. **Repairs done** (session E,
      step 3, 2026-09-06): `GET /api/repairs` was the one real, fully
      landed contract of the five this step named (F step 1) - a real
      page, `frontend/src/apps/settings/RepairsPage.tsx`/`RepairsSection.tsx`,
      linked from Settings' Household tree next to Backups/AI models
      (owner/admin only, the same gate). Hand-written, not a schema
      `list` node: an `Issue`'s `fix` and `learn_more` are both nullable
      per-row, and the generic `list` node's `row_action` can't
      conditionally disappear per row - the same "stays hand-written"
      call already made for People/Privacy/Settings. **Health, Updates
      and Storage still not built** (all three confirmed backend-unbuilt
      2026-09-06): `GET /api/health` is still `{status: "ok"}`, an
      unrelated liveness check (F's own step 2 replaces it, not landed);
      `GET /api/updates`/`GET /api/storage` don't exist at all. Left for
      whoever lands each contract - the frozen shapes are in
      `docs/plans/wave-2.md`'s "F to E" section, and the frontend side of
      each is a small schema or hand-written page against a real
      `GET`, the same size of work Repairs just was.
- [ ] **A shared horizontal-rail primitive for `WhoIsHere` and
      `MediaShelf`** (S) - found in a code review, 2026-09-13, fixing a
      real layout bug: an `overflow-x-auto` element also computes
      `overflow-y` to `auto` (CSS spec), which zeroes a flex item's own
      automatic minimum size and collapses it to zero height inside a
      `flex-col` ancestor. `MediaShelf.tsx`'s scroll rail (`kit/
      primitives/MediaShelf.tsx`) already works around this with padding
      (2026-09-05, a different symptom there - focus-ring clipping, not a
      height collapse); `HomePage.tsx`'s `WhoIsHere` avatar row hit the
      height-collapse version live (every name clipped at the top of its
      letters in the published Home screenshot) and was fixed with
      `min-h-16 shrink-0` (2026-09-13). Two different techniques for the
      one underlying quirk, in two files, with nothing centralizing it.
      Not unified in either fixup pass (bigger than either pass's own
      scope, and `MediaShelf`'s rail isn't confirmed to hit the
      height-collapse symptom anywhere it's mounted today, only
      theoretically capable of it). Acceptance: one shared horizontal-
      rail primitive (or a documented, reusable class/utility) that both
      `WhoIsHere` and `MediaShelf` build on, so the fix for this quirk
      lives in one place; `scripts/screenshot.ts`'s own `clippedStrips`
      check (added the same commit as the `WhoIsHere` fix) is the
      regression backstop either way - keep it passing. Out of scope:
      redesigning either component's visual layout, only the shared
      scroll-rail mechanics.
- [ ] **HELP-AI-01: an AI-assisted help system behind the rail's Help item** (M, design first). Objective: Help opens a chat-shaped panel (the same Elements as chat, in the canvas-split or a Sheet) whose answers come from the user guide and the settings registry's own help text, retrieved locally (the embed role over docs/user/*.md and each key's help), answered by the chat role in the written register with the source page linked; never household data; a child sees it too. Files: a `help` bundled package with its recipe over the local index, `frontend/src/next/pages/NextHelpPage.tsx`; design note first in docs/dev.md (what is indexed, refresh on update, the child projection). Acceptance: "how do I add a person" answers from people.md with the link; an unknown question says so and links the guide. Exit: bash scripts/check.sh.

## Proactive / ambient intelligence

- [ ] **Cache skill lookups proactively, and surface them unprompted when
      relevant** (L, needs its own design pass - Jesse, 2026-09-05).
      The example: a person who knows you like video games might say "oh,
      Grand Theft Auto VI comes out today" without being asked - MaiPai
      doesn't do anything like this today; every skill only ever runs
      when a person's own message routes to it. Three genuinely separate
      pieces, worth naming separately since they're different sizes:
    - **A caching/freshness layer for skill results** (S-M) - the
      scheduler (`host.schedule`/`runDueJobs`) already exists and is real;
      this is "run certain lookups on a schedule and keep the last result
      somewhere," which is mostly new plumbing on top of infrastructure
      that's already built, not a new subsystem.
      Sharpened 2026-09-05: plan 4.10 already declares the manifest
      fields for this (`cache: {key_template, ttl_s, stale_ok_s,
      max_bytes}` and `warm: {schedule, keys}`, `warm_on`), so this is
      implementing a declared shape, not designing one.
    - **Matching a cached fact to what a specific person actually cares
      about** (M-L) - needs a real answer to "how does the hub know
      someone likes video games" at all. `memory.ts`'s existing recall
      already does keyword-overlap matching against stored facts, which
      is a plausible starting point (a remembered "I love video games"
      fact matching a cached "GTA VI released" fact), but a dedicated
      interest/preference model would work better and doesn't exist -
      real design work, not just wiring.
    - **Deciding when and how to actually say it** (L) - the hardest and
      most product-sensitive part. Surfacing something unprompted in the
      middle of a conversation risks landing as useful or as intrusive
      depending entirely on timing and judgment a fixed `format` template
      cannot express (the same "no conditional branching in a recipe"
      limit the tier 2 compose-step note above already names). This
      overlaps real estate with the notification system below (both are
      "tell someone something they didn't ask for") but is a distinct
      surface - a notification is its own explicit channel; this is
      about weaving a fact naturally into an ongoing chat, which is
      closer to the persona work's "engagement depth" dimension
      (`docs/dev.md`, companion personas note) than to notifications.
      Worth deciding together with that note rather than separately.

## Portability and the link (hub <-> robot)

Plan chapter 7 (pairing, one oplog with HLCs, merge policies, the
never-sync allowlist, adoption) and principle 3 (every record is the
spec shape with id, provenance and clock stamp from first boot, so
pairing is a transfer, never a translation). The audit checked the code
built so far against that promise. `bot` itself is docs-only and blocked
on a spec tag that was never cut.

**Fixes (data debt already accruing)**

- [x] **Forget and person-delete must write tombstone ops, not bare
      DELETEs** - shipped, Session A step 10 (2026-09-05):
      `memory.forget()` and `erasePersonData()`'s own memory-records
      handling both tombstone now (`status: archived`, `text` wiped to a
      real sentinel, `embedding_space` cleared, `deleted_at` set, row
      kept) instead of hard-deleting - a robot that synced before the
      forget can no longer push the memory back on reconnect. Settings
      and scheduled jobs still hard-delete on person deletion
      deliberately (see docs/dev.md's step 10 entry): only memory
      records carry the "a device could resurrect this via sync" risk a
      tombstone exists to close.
- [x] **A clock stamp on every spec record** - shipped for Person,
      MemoryRecord and Grant, Session A step 10 (2026-09-05): all three
      now carry `hlc`, set from `lib/hlc.ts` on every real write.
      `lib/hlc.ts` itself gets a real, dedicated test file
      (`tests/hlc.test.ts`) covering what the existing settings.test.ts
      coverage didn't - the counter's same-millisecond advance proven
      directly, `compareHlc()`'s own node tiebreak, and `seedHlc()`'s
      exact same-`wall_ms`-lower-counter boundary. Entity and
      Relationship still need this (Entity is memory-record's own
      `record_kind: "entity"`, already covered by this step's
      memory-record change; Relationship is a separate schema, not
      touched this pass).
- [ ] **A spec-or-local verdict for each hub-internal table** (M) -
      `conversation_turns`, `scheduled_jobs`, `commands`,
      `notification_deliveries`, `cloned_voices`, `model_download_jobs`
      each say "promote when the robot needs it". Plan 4.14 syncs robot
      turns as conversation records, 4.7 runs timers on both nodes, and a
      household's "when I say X" command must work on a standalone robot
      (principle 2). Promote turns, jobs and commands now; record why
      the other three stay local.
- [x] **Cut `spec-v0.1.0`** (S, Jesse's call: it is a release) - the bot
      repo pins a tag that does not exist. One tag unblocks Robot v0.1.
      Landed differently than written here: the refocus (2026-09-20)
      moved `spec/` out of this repo to `getmaipai/shared` before this
      item was reached, so the tag exists there
      (`getmaipai/shared@spec-v0.1.0`, commit `2c87009`, corrected same
      day to `spec-v0.1.1`/`1aee790` - stale `home/spec` references the
      move left behind), not on `home`, and landed through the same
      routine workspace-tag flow as `core-v0.1.0`/`ui-v0.1.0` (no
      separate release ceremony), accepted by COORDINATOR. Bot's own pin
      URL changes accordingly - see `shared/spec/README.md`, "How the
      robot pins this".
- [ ] **Mark `weather`, `define`, `joke`, `trivia` `platforms: ["home",
      "bot"]`** (S) - nothing in them is hub-specific; the robot needs
      weather offline-capable per plan 5.4.

**The link itself**

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
- [ ] **Copy the legacy link plumbing that was fixed on real reconnects**
      (S-M) - `deviceToken.ts` (365-day, sha256 stored, 20 per user),
      `hubIdentity.ts` (instance id minted once) and `hubEndpoints.ts`
      (an address book that must match the instance id before posting
      credentials: "a laptop on a cafe network gets a 200 from a
      stranger's box"), the bot's `pairing.py` (token 0o600, atomic,
      corrupt means "not paired", never a crash), `OfflineQueue` (max
      500, dedupe by key in place, drop oldest), duplicate-session
      eviction with `destroy()` on the old socket, a bounded writer,
      EADDRINUSE treated as down. Legacy had no HLC or merge; only the
      transport lessons transfer.
- [ ] **One pairing flow, with a rate limit** (M, verdict) - legacy grew
      three code flows (6-char pod, claim-by-hardware-id, 5-minute TV
      Quick Connect) and `/pair` had no limiter. Plan 7.1 is one flow for
      a ROBOT/pod pairing into the household (Wave 3, still deferred -
      touches every record table). Decided for the human sign-in half
      (Session F step 6, 2026-09-06): Quick Connect for TV sign-in is
      its own separate flow, not this one - `lib/quickConnect.ts`, rate
      limited from the start (`code + poll_token`, 5-minute expiry).
      This item now covers only the robot/pod pairing flow.
- [ ] **Verdict: robot fallback order** (Jesse's call) - the legacy bot's
      `FallbackLanguageModel` is local-first; the plan is hub-as-brain
      with a sub-second connect timeout and no hedging. Decide before
      the robot's dialogue loop is rebuilt.
- [ ] **Python ports of the shared floor** (M, required for Robot v0.1)
      - the safety classifier, `normalizeForSpeech` and
      `records/ts/validate.ts` are TS-only; plan 4.3 says the floor runs
      on the robot even when the hub answers. Same corpus, both
      languages, kept identical like the recipe interpreters.
- [ ] **An export bundle** (M) - JSON, one file per record type,
      provenance kept; the fallback pairing path and the per-person
      export the spec already promises. Watch the W3C agent-memory
      interop group and the Agent Memory Protocol rather than adopting
      either; nothing is used widely enough to depend on.
- [x] **Speak Wyoming and expose an OpenAI-compatible chat endpoint** (M)
      - shipped, Session C step 8 (2026-09-06):
      `POST /v1/chat/completions` (`backend/src/routes/openai.ts`,
      streaming and non-streaming, reusing spec/llm/ts/types.ts's own
      OpenAI shapes) and a real Wyoming TCP server
      (`backend/src/lib/{wyoming,wyomingServer}.ts` - hand-written
      framing, not the `wyoming` npm package, which is real and ISC-
      licensed but a 0.1.0 "work in progress" with no stable API to
      build a child-safety-adjacent listener against). Both authenticate
      against a new interim per-person API token
      (`backend/src/lib/apiToken.ts`, `POST`/`DELETE
      /api/settings/api-token`) - kept as its own mechanism even after
      F's real device tokens (session-f-platform-and-trust.md step 6)
      landed mid-step, once checked directly and found to solve a
      different problem (a native client's session redemption after a
      network change, not a stateless bearer credential for programmatic
      access); see docs/dev/session-c.md's step 8 entry for the full
      reasoning. Unlike the base Wyoming protocol (confirmed against the
      reference docs: "no authentication or encryption, by design") and
      unlike legacy's own unauthenticated socket, every connection must
      send a real token as its first message or gets closed outright -
      `describe`/`transcribe`/`synthesize`/`handle` never run for an
      unauthenticated caller. Verified live end to end over a real TCP
      socket and a real HTTP request (not just unit tests): a scripted
      client authenticates, gets a real `info` response, a real
      `handled` reply from the turn engine, a real `transcript` from
      step 5's STT (scripted backend, no model installed in this
      sandbox), and real framed audio from TTS's own stub backend. No
      Home Assistant instance was reachable to verify the Assist-
      pipeline acceptance itself - noted as owed to Jesse in
      docs/dev/session-c.md.
- [ ] **Round-trip fixtures across both repos** (S, once the link exists)
      - a record written on the robot and synced to the hub is byte-
      identical to one written on the hub; the robot never translates.

## Voice / robot

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

- [ ] Wake word past phase 1 (L) - mic capture + inference exists
      in-browser; everything else (barge-in in this repo, satellite mode,
      robot-side wiring) isn't built here.
- [ ] Robot pairing / the link API (L) - not implemented in `home` at all.

## Cross-cutting

- [x] **Local source startup commands** (S): root `package.json` and
  `scripts/app.sh` provide `bun start`, `bun stop`, and `bun restart`.
  Restart calls stop, then start. Start builds the frontend, runs the
  backend in the background, and prints direct and configured URLs using
  the existing `hubEndpoints` address book. Tests:
  `backend/tests/localApp.test.ts` and `startupUrls.test.ts`. Installed
  services and DNS configuration are out of scope. Exit check:
  `bash scripts/check.sh`.

- [x] **Fix A: engines survive `bun --hot`, and the turn pipeline logs**
      (M) - shipped 2026-09-07. `backend/src/lib/llmSupervisor.ts`/
      `embedSupervisor.ts`/`ttsSupervisor.ts`: each module's own state
      (backend, startingPromise, generation, plus llmSupervisor's
      lastPostLoadCheck/manuallyStopped) moved off a module-level `let`
      onto `globalThis` via a new shared `backend/src/lib/hotReloadState.ts`
      helper (a code review caught the first cut hand-copying the same
      globalThis-plumbing three times; one generic `hotReloadState<T>(key,
      init)` instead - each module still owns its own state shape).
      `backend/src/lib/sidecars.ts`'s `sweepOrphanProcesses()` takes an
      `excludePids` option; `llmSupervisor.ts`'s
      `sweepOrphanEngineProcesses(extraLivePids)` passes its own chat
      backend's pid plus whatever `index.ts` forwards from
      `getEmbedLivePid()`/`getTtsLivePid()` (kept as three small pid
      getters stitched at the call site, not one shared process registry -
      a real, deliberately deferred simplification if a fourth spawned
      role is ever added). `backend/src/lib/turnEngine.ts`: one JSON
      `[turn]` line per completed turn (`turn_id`, `conversation_id`,
      `surface`, `source`, `plugin_id`/`command_id`, `routing`, `guard`
      reasons, `safety_action`, `duration_ms` - never utterance or reply
      text, unconditionally, no debug escape hatch (a code review caught
      a first cut's own `MAIPAI_TURN_DEBUG=1` env var writing the raw
      utterance to this line - a plain env var is not the admin-toggled,
      auto-reverting mechanism `docs/ENGINEERING.md`'s Logging section
      actually specifies, and the line is unconditionally persisted to
      disk - removed rather than half-fixed). `gateGuards()` gained an
      optional `onGuardHit` callback to feed it (a code review flagged
      this as a side-channel a return-value shape would avoid - kept as
      the callback anyway: the return-value alternative would have
      widened `TurnStreamResult.tokens`'s own type and rippled into
      `routes/turn.ts`, a bigger blast radius than the fix warranted).
      New `backend/src/lib/log.ts`: `appendLogLine()`, a size-and-days
      rotated append to `data/logs/hub.log` - deliberately NOT a blanket
      `console.log`/`warn`/`error` mirror (a first cut did exactly that;
      a code review caught it teeing all ~47 pre-existing `console.*`
      call sites across the codebase to disk unconditionally with no
      redaction step anywhere, a real secret/PII-surface risk the org's
      own Logging standard forbids - removed; `logTurnLine()` is the one
      caller today, and it already omits utterance/reply text); reuses
      `paths.ts`'s existing `ensureDataDir()` rather than a second
      directory-creation helper (another review catch). Tests:
      `tests/llmSupervisor.test.ts` (the shared-state mechanism proven
      directly, `excludePids` wiring), `tests/sidecars.test.ts`
      (`excludePids` protects a real spawned process from a real sweep),
      new `turnEngine.test.ts` `gateGuards()` coverage doubles as this
      fix's own `[turn]`/guard-field proof. Verified: full backend suite
      green (1702 tests) with `bun --hot` itself running throughout;
      `tsc --noEmit` clean. Not independently re-verified: a live
      save-while-chatting check against a real spawned chat engine (none
      was running on the dev machine at fix time - only the embed
      server) - the mechanism itself (globalThis persistence, pid
      exclusion) is unit-tested directly, but the end-to-end "save a file,
      the in-flight reply survives" moment hasn't been watched live.
- [ ] Cut a first real release (S, but blocking) - no tag has ever been
      made. The deploy-from-release-tag model, the clean-clone build
      check, and update delivery have never been exercised for real.
- [ ] Real i18n (L) - "language and region" is a stored preference today
      with no translation behind it.
- [x] The notification system (4.13) (L, a real working subset done
      2026-09-05, `docs/dev.md`'s "The notification system, a real
      working slice" entry) - declared types, `in_app` + Telegram
      channels, non-configurable types, `safety.flagged_turn` and
      `model.download_ready`/`failed` wired to real events. Session E
      step 5 (2026-09-06) adds the thirty-day history page
      (`frontend/src/apps/notifications/NotificationsPage.tsx`, reachable
      from the bell's own "View history" link) - a client-side window
      over the real, genuinely unbounded `GET /api/notifications/history`
      (confirmed by reading `lib/notifications.ts`'s `listHistory()`: no
      date filter or cap exists server-side). Lane 15 (2026-09-14):
      `POST /api/notifications/dismiss` (`{ ids }` or `{ all: true }`,
      one transaction, scoped to the signed-in person, returns the
      count) backs the bell popover's own "Dismiss all", the history
      page's "Clear all", and its new multi-select "Dismiss selected" -
      the per-item `POST /:id/dismiss` route stays for a single
      dismiss. Still open: quiet hours and the web-push opt-in (both need new
      settings keys in `backend/src/settings/notificationKeys.ts`, F's
      file per `docs/plans/wave-2.md:113`'s grouping - not built, and not
      E's file to add them to), `passive`-level digest batching, browser
      push / Go / TV overlay / robot speech (no such clients exist yet),
      a real parent/guardian audience (see the Relationship/Grant work
      above). Package-declared notification types shipped in Session D
      step 8 (2026-09-06): `registerAllPackageNotificationTypes()`
      (`lib/plugins.ts`) reads every bundled package's own manifest
      `notifications[]` and registers each through F's own
      `registerPackageNotificationTypes()` (`lib/notificationTypes.ts`)
      at boot, proven end to end (not just wired) by the `remind`/`timer`
      packages' real `remind.due`/`timer.done` notifications
      (`backend/tests/scheduler.test.ts`).

- [x] **Doc drift the audit found: the plain corrections** (S) - done
      2026-09-13. `spec/llm/README.md`'s "Non-streaming only" paragraph
      was genuinely stale (streaming, tools, JSON-schema-constrained
      output and `chat_template_kwargs` all shipped since it was
      written, per `spec/llm/ts/types.ts`/`client.ts`) - rewritten to
      say so, cross-referencing the file's own later "Tools: real,
      native" section instead of duplicating it. `spec/ui/README.md`'s
      named "single-shot JSON" claim was checked against the file and
      isn't there anymore - no stale text to fix, the file already only
      describes the schema/interpreter split accurately. The two
      remaining parts of the original item, both genuinely Jesse's
      call, are split out below rather than folded back into one line.

- [ ] **Jesse's call: commit the platform plan into `home/spec/design/`**
      (S decision) - `.github/CLAUDE.md` says the rebuild follows
      `home/spec/design/`, which does not exist; the plan lives at
      `~/.claude/plans/purring-chasing-noodle.md`, outside every repo
      and unversioned. `.github/STACK.md` and the global `CLAUDE.md`
      point at a `home/agents.md` that does not exist either (the real
      file is `home/AGENTS.md`, capitalized). Committing the plan needs
      a PII pass first (it names Jesse's machines), and once it's in a
      real, editable file, its own stale terminology can finally be
      fixed too: plan 5.1/5.6 still say `skill` for what shipped as
      `plugin`.

- [ ] **Jesse's call: rename the tier ladder** (S decision) - "tier"
      means both routing tiers 0/1/2 (plan 4.5) and package tiers 0/1
      (plan 5.2), often in adjacent sentences across the docs; one
      ladder should be renamed so the word means one thing.
- [ ] **Roles versus grants is a wider conflict than the one item under
      People** (S decision) - the Grant spec removes age and role from
      authorization while `Person.role` stays required, `min_role` is on
      every manifest, and ENGINEERING.md, UI.md's kid presets and plan
      4.2/4.3/5.7 are all age-shaped. Safety's own half of this is done
      (Session C step 7, 2026-09-06: `lib/ageBand.ts`, birthdate-derived,
      shared by both the prompt and `evaluateSafety()`) - the wider
      roles-vs-grants decision itself is still Jesse's call, unchanged.
      `age_range` in a package's own `ctx` is still real, deferred work:
      it needs session-f-platform-and-trust.md step 7's package-host
      `ctx` mechanism, which does not exist yet (F is at step 5 as of
      2026-09-06).
- [x] **Content ceiling record and dials** (M) - shipped, Session C step
      7 (2026-09-06): `spec/schemas/content-ceiling.schema.json` (per
      band: the 8 legacy-endorsed dial categories, a `floor` field
      documenting - never enforcing - the classifier's own non-
      configurable refuse categories, hlc), three fixtures (child/teen/
      adult), generated bindings, `backend/src/lib/contentCeiling.ts`
      (the three built-in records as reviewed code, not household-
      editable data - no per-household custom-profile authoring UI yet,
      that's the separate, larger "nine sliders" work). The safety
      classifier now reads the age band (`lib/ageBand.ts`, shared with
      the prompt) instead of the role proxy - proven with two direct
      tests (a birthdate overriding a mismatched role in both
      directions). The crisis overlay's non-configurability is proven
      for real: a test stresses every real settings-registry key to its
      most permissive value and confirms a self-harm turn still returns
      `allow_with_resources` with real crisis resources every time.
      Deferred, honestly: `age_range` in package `ctx` (blocked on F's
      step 7) and the one-time adult acknowledgment via a Grant (the
      Grant SPEC already ships `chat.unrestricted`/`generate.unrestricted`
      with `acknowledged_at` - real, ready to consume - but F's hub-side
      grants table doesn't exist yet, so `hasUnrestrictedGrant()` is a
      documented stub returning false, the safe direction for this
      specific gap to fail in).
- [x] **`@hono/zod-openapi` conversion, the scaffolding and F's own
      routes** (Session F step 4, 2026-09-06) - `lib/openapi.ts`
      (`apiRouter()`, `errorResponses()`, `PaginationQuerySchema`/
      `paginatedResponseSchema()`), `/api/docs` (Scalar), `docs/api/
      openapi.json` generated and drift-checked by `check.sh`.
      `repairs.ts`, `notifications.ts`, `settings.ts`, `backups.ts`,
      `people.ts` converted (five of F's six pre-existing route files);
      `auth.ts` deliberately left for a dedicated pass (a shared
      Response-building helper across two differently-shaped routes -
      see `docs/dev/session-f.md`'s step 4 for the real reason). The
      other 11 route files (C, D, E's) still need converting when each
      session next touches theirs, per the org rule.
- [x] **Rate-limit the remaining raw fetches** (Session F step 3,
      2026-09-06) - `telegramChannel.ts` and the HF voice catalog both
      go through `tryConsume` now.
- [ ] **A generic wall, budget and probe layer before any media package**
      (M) - `rateLimiter.ts` is a non-blocking bucket only. Legacy's
      `quiet.ts`/`accessMonitor.ts`/`sessionKeeper.ts` trio encodes the
      2026-08-28 YouTube wall: a per-service wall remembered 24 h, daily
      caps split household 1500 / background 400 so background exhausts
      first, one probe per 6 h with the result persisted (the old probe
      ran five clients every 30 min and kept the wall up five days), a
      failure-quiet after three failures, one writer per cookie jar.
      Build it once, generically, before the first integration needs it.
- [ ] **The hub's Python runtime question in STACK.md** (S decision) -
      STACK.md gives the hub no Python, yet `tts` needs `uvx` at runtime;
      flagged in `spec/voice/README.md`, decided nowhere.
- [x] **A household CA with `maipai.local` mDNS and a trust step**
      (Session F step 5, 2026-09-06) - `lib/householdCa.ts` (a real,
      node-forge-minted CA and leaf, boot-time-conditional TLS),
      `lib/mdns.ts` (`_maipai._tcp.local`, TXT fields designed for this
      step since plan 7.1 wasn't available in this checkout - Jesse's
      call, see docs/dev/session-f.md), `GET /api/setup/ca`. The
      TXT field list and the trust-step UI (a device downloading and
      installing the cert, rendering the QR) are not this - the fields
      may need revisiting against the real platform plan text, and the
      UI is E's kit work.
- [x] **Passkeys, device tokens, Quick Connect, sessions, optional
      TOTP** (Session F step 6, 2026-09-06) - `lib/passkeys.ts`
      (`@simplewebauthn/server`, self-service registration on an
      already-signed-in profile, shared lockout with PIN/password),
      `lib/deviceTokens.ts` + `lib/devices.ts` (365-day tokens, 20 per
      person, oldest-evicted, `spec/schemas/device.schema.json` laid for
      the link), `lib/quickConnect.ts` (code + a separate poll_token, 5-
      minute expiry, rate limited, TOTP re-confirmed at approval when
      the approver has it on), `GET/DELETE /api/auth/sessions`
      (per-device, revoke), `lib/totp.ts` (`otpauth`, owner/admin only,
      anti-replay via a last-used-step counter, its own shared lockout).
      Two review passes on this diff, both fixed: the first found seven
      issues on first pass (see docs/dev/session-f.md); the second found
      TOTP bypassable via Quick Connect's poll and a stolen device
      token's redeem (fixed by gating the approval step instead - a
      redeemed token stays silent by design, the standard "remembered
      device" shape), a stale `hasSecret()` letting a passkey-only
      person be promoted to admin/owner, a 500 instead of 401 on an
      unknown personId, and `auth.ts`'s own conversion to
      `@hono/zod-openapi` (deferred past the first pass since it wasn't
      new code, then required once this diff rewrote most of the file).
- [x] **The approval queue** (Session F step 7, 2026-09-06) - see the
      People/relationships/permissions section below.
- [x] **The emergency kit, hub/smb backup targets, and the restore
      drill** (Session F step 8, 2026-09-06) - see "Backups to somewhere
      else" below.
- [ ] **Identity and trust pieces plan v0.1 scopes and this file did not
      track, still open** (M each) - hub-key signing of the bundled
      default set, and the `user/` docs tier (only `dev/` exists).
- [ ] **Tests the audit found missing** (S) - `access`, and one test
      proving a specific recalled memory text actually lands in the
      prompt for a matching query (memory tests stop at `recall`; prompt
      tests use synthetic matches). `hlc.ts` seed and compare landed
      earlier (this line was never checked off); `personLifecycle`
      landed with Session F step 7, 2026-09-06
      (`memorializePerson`/`disableExpiredGuests`/`ageBandForBirthdate`/
      `applyAgeBandChanges`).
- [x] **Copy the legacy runtime guards, most of them** (Session F step 3,
      2026-09-06) - checked `llmSupervisor.ts`/`modelDownload.ts`/
      `telegramChannel.ts` for equivalents first, per this item's own
      instruction: the download stall watchdog (90s idle timeout) and
      6-attempt backoff already existed in `modelDownload.ts`, untouched.
      Shipped new: `lib/dirtyBoot.ts`'s crash-boot hold (Windows Kernel-
      Power 41, macOS `pmset -g log` Shutdown Cause, Linux journalctl
      boot-boundary check, all best-effort except Windows's real signal;
      30-minute hold on a REAL chat/embed spawn only, never the stub or a
      developer's URL override) and `lib/sidecars.ts`'s
      `sweepOrphanProcesses()` (a boot-time sweep for a stray engine
      process freePort() can't see because it isn't on the port a fresh
      spawn is about to claim - the actual fix for "orphaned runners once
      forced every load to CPU: a 90s 'hi'"; residency itself is already
      capped at one process per role by construction, chat and embed each
      being a single module-level singleton).
- [ ] **The two runtime guards without a clean home yet** (S) - negative
      caches for genuine misses: no analog exists in this architecture
      today (nothing here repeatedly re-probes a known-failing URL or
      resource the way legacy's media-stream resolution did; revisit once
      the scheduler's own download lane or a package's periodic re-check
      needs one, rather than inventing a cache for a problem that doesn't
      exist yet). A boot watchdog capped at three reloads: not backend
      code - that's the OS service manager's job (systemd's
      `StartLimitBurst`, launchd's `ThrottleInterval`, or `run.sh`/
      `run.ps1`'s own retry-with-a-cap), so it belongs in step 11's
      install/service work, not here.

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
      stems; Podcasts (with generated shows, gpodder, snips); Books,
      readers, OPDS and KOSync; Bookmarks, Reader and Clipper;
      Reference (Kiwix ZIM); the coding agent and sandbox; Remote (SSH,
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
- [ ] **The wake-word training and calibration pipeline** (L; bot
      `dev.md` already plans the port, the code is where the fixed
      pipeline lives) - `train_wakeword.py` plus `wakewordTrainer.ts`:
      event-replay calibration (per-window counting picked thresholds
      that measured 40-140 false accepts per hour live), gates of at
      most one false accept per hour and recall of at least 0.85 on
      held-out real audio, the possessive near-miss bucket, harvested
      false triggers. The trained manifest v2 reached 0.00 FA/hr and 85%
      recall over 34 minutes of real audio and still fires on "hey my
      pie".
- [ ] **The bot's voice loop numbers** (M, when the voice loop is
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

## The other three products (status, not this repo's job to fix)

- **`bot`** (robot companion) - only docs ported from the legacy
  pre-rebuild code onto the fresh repo; the hardware-bench work referenced
  elsewhere was on the *old* codebase, not this platform. Blocked on the
  `spec-v0.1.0` tag (see "Portability and the link"), and its `dev.md`
  cites legacy `hardware.md` and `design-decisions.md` by path without
  containing them (see "Legacy: copy, re-examine, record").
- **`catalog`** (public package store) - repo scaffolding only
  (LICENSE/NOTICE/README, standards pin).
- **`go`** (Apple TV/iPhone client) - marketing copy only, no real app yet.

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

- [ ] **SETUP-LOOK-01: install and first-run setup in the same look as the shell** (M, with "The first-run wizard, end to end" below; the screens half of it). Objective: the installer's own pages and the first-run wizard look and feel exactly like the rest of Home under the new shell: the template's auth views (`ui/src/dashboard/views/auth/auth2` and `authforms`, the same card, type, spacing and palette the sign-in page already uses, SHELL-08) and its form-layouts for each wizard step, composed as shipped, tokens only, the Neutral theme by default and the person's look once one exists; the same rules as every other page (no data surface: compose from the primitives, name the gap). The wizard's steps are plan 12's, one screen each, with a progress rail on the left (the template's own stepper if it ships one, else the sidebar primitive as a step list), "restore from a backup" as the second screen, and the phone at 390 the same design stacked. The old `frontend/src/apps/setup/SetupWizard.tsx` retires with the cutover (SHELL-09); until then the new wizard mounts at `/next/setup` behind the flag and `POST /api/auth/setup` is the only route it has, so every later step past the owner account is a real screen with its real route named as pending, never a fake. Acceptance: the seeded fresh-hub capture set (a run from an empty data directory) at 1440 and 390 for every step, judged beside the sign-in page and the dashboard for sameness; a first-run on a fresh data directory reaches the dashboard signed in as the owner. Exit: `bash scripts/check.sh`.

- [ ] **The first-run wizard, end to end** (M, E for the screens, F for
      the routes) - plan 12 in full: language, locale and time zone,
      household name; the owner with a passkey or password; the
      AI-outputs disclaimer and the one-time adult acknowledgment; hardware
      detection and the model set that fits, with the first download's
      size and time shown; "trust this hub"; the default package set;
      Tailscale as an optional step; the emergency kit shown once; a
      backup target; done with "what to try"; restore always the second
      screen. Only `POST /api/auth/setup` (the owner) exists today. Legacy
      `SetupWizard.tsx` had welcome, profile, PIN, consent, area,
      components and download steps; its consent step (uncensored,
      internet, companions, liability) is superseded by the org's
      acknowledgment and privacy rules, kept as a reference only.
- [ ] **A family member joins, a kid profile, a guest** (S-M, E and F) -
      the QR from the admin's screen carrying the address and the CA, the
      picker, PIN or passkey; birthdate in, band out, presets shown to
      the parent with what they will see; a guest with an expiry and no
      memory (plan 12, 7.4).
- [x] **Lifecycle events** (Session F step 7, 2026-09-06) - `enabled`
      on Person (enforced at every sign-in boundary: `/select`,
      `/verify-secret`, passkey authenticate, device-token redeem, Quick
      Connect's poll, TOTP challenge, plus the 10s session cache), guest
      expiry removal (`disableExpiredGuests()`, a daily core job),
      memorialise (`POST /api/people/:id/memorialize` - every credential
      and session revoked, memories and conversations untouched, "export
      offered" left to the client), the band change on a birthday
      (`applyAgeBandChanges()`, a daily core job, `person.band_changed`
      passive notification to adults). See the People/relationships/
      permissions section below.
- [x] **Sessions per device with revoke, optional TOTP for owner and
      admin** (Session F step 6, 2026-09-06) - see the entry above under
      "Identity and trust pieces".
- [x] **Time allowances per category** (Session F step 7, 2026-09-06,
      backend half only) - `settings/allowanceKeys.ts` +
      `lib/allowance.ts::dailyMinutesAllowed()`, one person-scoped daily-
      minutes setting per manifest category, default 0 (no limit
      configured). Deliberately daily-minutes only, not "and schedules":
      a time-of-day window needs either the settings system's untested
      `time` selector (nothing renders one yet) or a JSON blob the
      settings standard's one-atomic-value-per-key shape does not
      support - landing an untested selector to satisfy the letter of
      the plan text would be its own half-finished feature. Also not
      done: actually enforcing this in `ctx.allowance` - that needs live
      per-day usage bookkeeping, which belongs to the package host's own
      session tracking (D's file, out of this session's scope per this
      repo's own `CLAUDE.md`); D reads the configured limit from
      `dailyMinutesAllowed()` and combines it with elapsed usage to
      produce `ctx.allowance`. E's controls page still needs building on
      top of this.
- [x] **Backups to somewhere else, the emergency kit, the restore
      drill** (Session F step 8, 2026-09-06) - `local` retention/size cap
      already existed (2026-09-04); this landed the rest of 2.5:
      - **Health tracking and escalation**: "a failure raises a Repairs
        item and two in a row notify admins" - tracked per target
        (`backup_health` table) so `local` and `smb` never mask each
        other's streak. A single failure sits on the Repairs list at
        severity `warning` (never auto-notifies, per Issue's own schema
        comment); the second consecutive failure escalates to `error`
        and fires `backups.target_failing` by hand (`raiseIssue()`'s own
        "new open error" gate does not catch a severity change on an
        already-open row).
      - **The `smb` target**: never an in-process SMB client - the admin
        mounts their NAS share at the OS level (`PUT /api/backups/
        targets/smb`, a plain directory path, validated it exists before
        `enabled: true`), and every kept local backup is mirrored there
        (`GET /api/backups/targets` for both targets' health).
      - **The `hub` target**: `POST/GET/DELETE /api/backups/received` -
        a paired device pushes its OWN already-encrypted archive here
        (`received_backups` table, per-device subdirectory,
        `receivedBackupsDir` deliberately a SIBLING of the household's
        own `backupDir`, never nested in it - a code review, 2026-09-06,
        caught the nested version breaking a sibling test file's own
        non-recursive cleanup, and it's also one bug away from a foreign
        `.db.enc` file being swept into this household's own retention
        math). Cold storage only - this hub never holds the sender's own
        backup key.
      - **The emergency kit**: `GET /api/backups/emergency-kit` (the
        backup key, `backupCrypto.ts`'s own header had been waiting for
        this exact route since 2026-09-04; plus hub name/instance id),
        owner-only with no grant widening (unlike every other backups
        route), safe to call more than once - "shown once" describes a
        wizard step (E's, not built here), not a hard one-time API lock.
      - **Partial restore of one person's data**: `POST /api/backups/
        {filename}/restore-person/{personId}` - memories, conversation
        history and settings only, never credentials/sessions/passkeys/
        grants/role (live security state an old backup must never
        resurrect). `ATTACH DATABASE` against the decrypted backup,
        explicit column lists read fresh from `PRAGMA table_info()`
        rather than hand-typed (so a schema drift fails loudly per table
        instead of silently). Embeddings are never restored (memory-
        record's own "embeddings never sync" rule) - every restored
        memory is re-queued in `pending_embeddings` so the already-
        scheduled `memory.embedding_retry` core job re-embeds it for
        real, reusing existing infra rather than inventing a second embed
        path. `INSERT OR IGNORE` throughout: safe to run twice on the
        same backup.
      - **"Before every update and restore"**: wired for restore (a
        fresh, prune-skipped safety backup right before `stageRestore()`
        - a code review, 2026-09-06, caught the FIRST version's own
        `pruneBackups()` call evicting the very backup an admin was
        restoring FROM, if its retention bucket was already spent by the
        brand-new safety backup; regression test in `backup.test.ts`).
        Not wired for update - no update system exists yet (step 10);
        documented here rather than faked.
      - **The restore drill**: `backend/scripts/restore-drill.ts` +
        top-level `scripts/restore-drill.sh` - decrypts the latest real
        backup into a throwaway data directory, boots a real hub against
        it, confirms `GET /api/auth/profiles` (the public sign-in picker)
        answers with real people. Deliberately stops short of a full PIN/
        password ceremony (needs a real secret this script has no
        business knowing); verified by hand against a real backup before
        landing. The release skill itself lives in the separate
        `getmaipai/.github` repo, out of this session's scope - this
        script is the contract it calls, matching `scripts/check.sh`'s
        own "thin wrapper, real logic in backend/" shape.
      No UI yet for any of this - Storage page and wizard steps are E's
      kit work on top of these routes.

**Health, updates, storage, install**

- [ ] **The sidecar contract** (M, F) - plan 4.12: one supervisor for
      llama-server, the voice programs, SearXNG and later Kiwix and
      ComfyUI, with declared startup order, health URL, ports, mounts,
      backup mode and exclude patterns. Today `llmSupervisor.ts`,
      `embedSupervisor.ts` and `ttsSupervisor.ts` are three copies of the
      same shape. Narrowed 2026-09-07: the supervision half (exit watch,
      health poll, backoff respawn, crash-loop cap with a Repairs fix) is
      already one implementation, `watchEngine()` in `sidecars.ts`, used
      by all three (`docs/dev.md`, "What was actually killing the chat
      engine"); what remains is the declaration side (order, ports,
      mounts, backup mode) and folding the three lazy spawns into it.
- [x] **Storage: sizes, quotas, disk-full policy, NAS mounts, factory
      reset, diagnostics** (Session F step 9, 2026-09-06) -
      `GET /api/storage` (bytes per area - database/models/engines/voice/
      cache/backups, plus D's `getCacheStats()` per package, plus real
      free/total disk via `statfsSync`). "Caches first" needed no new
      code: `lib/packageCache.ts` (D's file) already evicts its own
      oldest entries against real free disk space on every write; this
      step's own job (`storage.check_disk_full`, hourly) is the "then a
      Repairs item" half for when free space is STILL critical after
      caches have done everything they can, since real household data
      cannot shrink itself the way a cache can. Per-person quotas:
      `checkPersonQuota()` checks the one per-person upload with a
      tracked byte count today (cloned voices), default unlimited - the
      mechanism is built, `routes/voice.ts` (C's file) still needs to
      call it before a new upload, the same "mechanism here, wiring
      there" cross-session split step 7's `ctx.allowance` uses. NAS
      mounts: `GET/POST/DELETE /api/storage/nas-mounts`, declaration
      only (a real, already-mounted directory path + scan-path strings)
      - no media-library scanner exists yet to walk them, so nothing
      reads `scanPaths` today. Factory reset: `POST /api/storage/
      factory-reset` (owner-only, no grant widening), typed confirmation
      (`"DELETE EVERYTHING"`), a real backup taken first and refused
      whole if that backup fails, staged and applied at the next boot -
      the identical safety shape `lib/restoreStaging.ts` already
      established for restore (the live database is renamed aside, never
      deleted outright, so a mistaken reset is still recoverable by
      hand). Diagnostics: `GET /api/storage/diagnostics`, built
      structurally (every field deliberately chosen, never a fuller dump
      filtered after the fact) per `spec/diagnostics/to-redact.json`'s
      own categories - never a display name/nickname/birthdate, never a
      hub endpoint's address or the hub's own (admin-typable) display
      name, never a person-scoped settings value, never a settings value
      the registry marks `secret: true`. `data/` layout formalization
      (plan 4.15's `db/` subdirectory) was NOT done: `hub.db` stays at
      `dataDir`'s own root rather than moving under a new `db/` folder -
      a real migration of the live database's own path is a materially
      riskier change than this step's other pieces, and nothing found a
      concrete reason it's needed yet. Hub migration and two-hubs support
      also NOT done (genuinely separate scope from a single hub's own
      storage/reset/diagnostics story). No UI yet for any of this - a
      Storage page is E's kit work on top of these routes.
      **A real bug fixed in already-merged code while building this**:
      `lib/restoreStaging.ts`'s `applyPendingRestore()` (step 5) could
      split a database from its own WAL/SHM journal across a crash mid-
      rename - found while giving `lib/factoryReset.ts`'s copy of the
      identical shape the same treatment, and it took two review passes
      to get fully right (see `docs/dev/session-f.md`'s step 9 write-up).
      Both files now share one fixed implementation
      (`moveDbSet`/`dbSetExists`/`partialMoveInProgress`).
- [x] **The updates projection, app half only** (Session F step 10,
      2026-09-06) - `GET/POST /api/updates` (`GET` reads the cached last
      check; `POST /check`, owner/admin, forces a fresh one), a real GET
      against GitHub's own public release API for `getmaipai/home`,
      cached in a new `app_update_state` table so a route never blocks on
      a live network call, a daily core job (`updates.check`), a
      `passive`-level `updates.available` notification when
      `isNewerVersion()` (real numeric semver comparison, not a string
      one - `"0.9.0" < "0.10.0"` fails lexicographically) says the
      release found is genuinely newer than the installed version.
      `lib/privacy.ts` gained the matching row in the same commit (org
      standard: an outbound endpoint's privacy-page row lands with the
      code that adds it) - this is the ONE periodic, not household-
      triggered outbound call this hub makes, and it reaches GitHub's own
      public API, never a MaiPai-operated server.
      **Deliberately not built, and why:**
      - **Packages, models, sidecars** (the plan's other three
        projection halves) - nothing real to check against yet. No
        package catalog is live (`getmaipai/catalog` doesn't consume
        anything yet), `lib/modelCatalog.ts` (D's/F's shared catalog) is
        a static hand-maintained list with no version-comparison concept
        of its own, and sidecars are "pinned with the app" (they follow
        whatever the app's own release settles on, not tracked
        separately). Building a projection for data with no real
        "latest" to compare against would be speculative code with
        nothing to verify it against.
      - **`lib/selfUpdate.ts`** (verify, back up, stage into
        `releases/<version>`, dry-run migrations, swap, restart, health-
        check-or-roll-back) - genuinely blocked on step 11 (no service
        exists yet to restart under, and no release has EVER been cut
        for this project - `CHANGELOG.md`'s own header still says so),
        and on cross-cutting "never during a conversation/generation/
        download/playback" hooks into `turnEngine.ts`/`packageHost.ts`/
        voice playback - all other sessions' files, not F's to wire.
        Attempting this now would be unverifiable by construction
        (nothing real to restart, nothing real to roll back to).
      - **`installedVersion()`** currently reads a placeholder
        (`package.json`'s own `0.1.0`, or a global override tests set) -
        there is no real "what version is this build" stamping mechanism
        yet either, since that is properly the release skill's job
        (a separate, org-level repo) once a release is actually cut.
      No UI yet - the "MaiPai Home {version} is available" surface is
      E's kit work on top of `GET /api/updates`.
- [ ] **Hub migration, two hubs** (S-M, F) - plan 4.15; none exist.
      Migration keeps the instance id and CA so pinned clients survive;
      two hubs are two instance ids and a client remembers its choice.
- [x] **Service install and the one-line installer** (Session F step 11,
      2026-09-06) - `scripts/install.sh` (macOS + Linux) and `scripts/
      install.ps1` (Windows): fetch the latest GitHub release tag (never
      `main`), install Bun system-wide, build the app, register a real
      background service (systemd on Linux, a launchd LaunchDaemon on
      macOS - not a LaunchAgent, since the hub has to run with no one
      logged in - and a Windows service via WinSW, pinned to v2.12.0 and
      checksum-verified before use), and start it. Both detect a port
      already in use and pick the next free one, and are idempotent
      (re-running upgrades in place via `rsync --delete`/`robocopy /MIR`,
      excluding `data/`/`backups/`/`received-backups/`). `scripts/
      uninstall.sh` (step 9) had drifted from this - it looked for a
      LaunchAgent - fixed to match, plus a Windows removal hint.
      A new `POST /api/setup/hardware` (the plan itself assumed this
      already existed from an earlier step; it didn't) gives both
      scripts something real to check hardware minimums against, reusing
      `lib/hardware.ts`/`lib/modelCatalog.ts` read-only.
      **The legacy `run.ps1`'s GPU power-ordering lesson was deliberately
      NOT carried forward**: its own comments record that the brownouts
      it guarded against were traced to a failing laptop battery (since
      replaced), and the power-cap workaround was already disabled by
      default in the last legacy version before this repo's fresh start.
      Reimplementing a mitigation for a hardware fault that turned out to
      have a hardware fix would be exactly the "carrying forward feature
      scope, not hard-won logic" the org's own rebuild standard warns
      against.
      **Real system-service registration was not exercised end to end**
      (no machine here to safely register a real systemd/launchd/Windows
      service on) - `install.sh` is shellcheck-clean, `install.ps1`
      parses cleanly under PowerShell's own AST parser, and every
      non-destructive function (port detection, the WinSW XML config
      generation, the "no release published yet" path) was function-
      tested directly. Manual check, once `v0.1.0` is cut: run the
      installer on a real target machine of each OS, confirm the service
      survives a reboot with no one logged in, confirm `uninstall.sh`
      cleanly removes it.
      **The performance-budget bench (first token, page open, cold
      start, measured against the archived legacy numbers) was NOT
      built** - Jesse's own explicit scoping choice, not a guess: it
      needs a real GPU and a downloaded, warm model to produce numbers
      worth recording, neither of which exists in a dev sandbox, and a
      fabricated number would be worse than no number. Left for whenever
      real bench hardware is available.
      **The docs site** (`docs/site/`, Astro Starlight, reading `docs/
      user/`, `docs/dev/`, and the generated `docs/api/openapi.json` via
      `starlight-openapi`) shipped as part of this same step - see
      `docs/dev/session-f.md`'s step 11 writeup for the full detail
      (the sync-script bridge, the two real bugs a real build caught,
      why it stayed a standalone project rather than a root workspace
      member).
      **`scripts/check.sh` gained one of the plan's four named
      additions outright**: a check that the sibling `.github` checkout's
      own `standards/gen/ts`/`gen/py` output exists before spec codegen
      runs (`docs/api`'s drift check already existed from an earlier
      step). **The other two exist as real, working tools but are
      deliberately NOT wired in as gates**: E's a11y matrix (`bun run
      a11y`, already built) was tried and backed out - it immediately
      and reproducibly fails on the already-tracked "second, narrower
      contrast finding" above, not anything new; a reading-level lint on
      `docs/user/` (`scripts/reading-level.ts`, real Flesch-Kincaid
      scoring, built this step) finds 7 of 9 pages over grade 8. Both
      would block every commit repo-wide over content/code this session
      doesn't own - see the two entries above/below for exactly what's
      blocking each and the one-line check.sh addition to make once
      they're clear.
      **The release ceremony itself (a security review pass, the
      clean-clone build, the changelog, the tag, and `spec-v0.1.0`'s own
      tag prep) was NOT attempted** - Jesse's own explicit call, matching
      the org standard that cutting a release is always his word in the
      moment, not a session's to schedule.
- [ ] **The reading-level lint, wired as a check.sh gate** (S, F/E) -
      `scripts/reading-level.ts` exists and is correct (Flesch-Kincaid
      Grade Level against docs/STYLE.md's grade 6-8 target), but wiring
      it into check.sh now would block every commit repo-wide over
      content this session doesn't own the prose of: 7 of 9 docs/user/
      pages currently exceed grade 8 (memory.md highest at 14.4). Filed
      as `getmaipai/home#42` with the exact scores and the one-line
      check.sh addition to add once Session E has simplified the flagged
      pages.
- [ ] **The performance-budget bench** (S, F) - first token, page open,
      cold start, measured against the archived legacy numbers (200 to
      900 ms first token warm) and recorded; a regression is a Repairs
      item on the bench machine only. Needs real bench hardware (a GPU,
      a downloaded warm model) this dev sandbox doesn't have - Jesse's
      own explicit call to defer it, not a scope guess.
- [x] **GPU validation bench** (S, Codex) - `backend/scripts/bench/gpu-validate.ts`
      validates fill, concurrent throughput, throttling, and a minimum
      single-stream rate before a household engine moves onto a new card.
- [ ] **The release ceremony for v0.1.0** (M, F, only when Jesse says so)
      - a security review pass, the clean-clone build, the restore
      drill, the changelog, the tag; `spec-v0.1.0`'s own tag prep (the
      spec README's pin line, the fixtures green in both languages) so
      it unblocks the `bot` repo. Cutting it is Jesse's word in the
      moment; everything up to the tag should be ready to go once he
      gives it.
- [ ] **The Windows self-update rules as tests** (S, F, with self-update)
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
- [ ] **Web push as a notification channel** (S-M, F backend, E opt-in)
      - the PWA exists after Wave 1, so the "no such clients yet" note
      above no longer holds; legacy `push.ts` (VAPID keys generated once,
      never a manual step) is the reference.
- [x] **A `Device` record** (Session F step 6, 2026-09-06) -
      `spec/schemas/device.schema.json`; see the entry above under
      "Identity and trust pieces". `lib/deviceId.ts` remains a separate,
      unrelated thing (the memory/entity/episode id suffix, its own
      header explains).

**Packages**

- [x] **The Tier 1 host under Deno, and the MCP spike** - shipped,
      session-d-packages-and-store.md step 5 (2026-09-06):
      `lib/denoHost.ts` (lazy-started, `--allow-read`/`--allow-write`
      scoped to exactly the package's source and data dirs, no env, no
      net), MCP over stdio via the official SDK (`Client`/`McpServer`,
      both directions of the `Protocol` base class's `request()`/
      `setRequestHandler()` used for real - `vscode-jsonrpc`'s recorded
      fallback was never needed), `host/fetch` proven end to end through
      `packageHost.ts`'s own cache/rate-limit/SSRF path. Three-strikes
      fault handling with a real Repairs issue, idle-kill, a graceful-
      exit hook. `knowledge` (Wikipedia's public REST summary API) is
      the first Tier 1 package, verified live against a running dev
      server. `deno_test` smoke (step 1's own reserved, unbuilt kind) is
      real now too.
- [x] **The store host on the hub** (M-L, D) - shipped, Session D step 6
      (2026-09-06): `lib/store.ts` (install/rollback/uninstall/
      setChannel, all against a real TUF-shaped signed index via
      `lib/storeIndex.ts`), unpack per version under
      `data/packages/<id>/versions/<version>/`, smoke-before-enable
      (`lib/smoke.ts`'s `runSmoke()`, real bronze gate), per-package
      channel, rollback (the prior version's files are kept, never
      deleted, until a newer install replaces them), `routes/store.ts`'s
      full REST surface. `lib/packageResolve.ts`'s `resolvePackageDir()`
      is the one place "bundled copy vs. installed override" is decided,
      so a store install actually takes effect everywhere a package's
      files are read from - `lib/plugins.ts`, `lib/denoHost.ts`,
      `lib/skills.ts`, `lib/smoke.ts` all resolve through it. The
      permission prompt and the tamper suite (bad hash, untrusted
      signer, rollback-to-older-index) are real tests in
      `backend/tests/store.test.ts` and `spec/tests/ts/storeIndex.test.ts`,
      not just described.
- [x] **The catalog tooling and the signed index** (M, D) - shipped,
      Session D step 6 (2026-09-06): the `catalog` repo's `tools/` (lint
      against the mirrored spec schema, pack, sign, `build-index`, the
      scorecard, the `check` CLI running all of it against every
      package), a TUF-shaped root/targets/timestamp with a second
      signer, the public CI (tag- and PR-triggered, minutes are free on
      a public repo). The bundled default set (`define`, `joke`,
      `knowledge`, `trivia`, `weather`, `storytime-style`) moved to
      `catalog` as canonical source; `home` keeps a checked-in,
      hash-pinned copy (`backend/packages/bundled-provenance.json`,
      `scripts/refresh-bundled-packages.ts`) refreshed from there rather
      than hand-edited - proven the hard way in Session D step 9, when a
      hand-edit to `home`'s own mirrored `weather` manifest was caught
      immediately by `bundledPackages.test.ts`'s hash check and had to
      be redone in `catalog` (`catalog@12479aa`) instead.
- [ ] **`ask` continuation, `confirm`, `end_conversation` from a result**
      (S-M, D produces, C consumes) - `result.schema.json` has them;
      `runRecipe` never sets `ask`, and the turn engine reads none of
      them. A lookup cannot ask "which Springfield" deterministically.
- [ ] **Consequential packages need a confirmation at run time** (S, C)
      - `consequential: true` exists in the manifest and raises nothing;
      the security-domain check happens at command creation only.
- [x] **A `compute` recipe step** (S, D, both interpreters) - shipped,
      Session D step 7 (2026-09-06): `compute_step` in both the TS and
      Python interpreters, a restricted `mathjs`/equivalent expression
      evaluator (no network, no arbitrary code), backing the bundled
      `math` and `convert` packages.
- [ ] **Audit `host.*` against plan 4.9** (S, D) - not reached this wave.
      `host.log`, `host.config.get`, `host.data.forget`,
      `host.diagnostics` and the emulator twins are still missing or
      unverified; Session D step 5-9's own package work only ever needed
      `host.fetch`, `host.home.call_service`, `host.lists.*`,
      `host.reminders.set`, `host.timers.set`, and `host.integration.call`
      for real, so this audit was never forced and stayed unbuilt.
      Genuinely open for a future session.
- [x] **Package-declared notification types** (S, D and F) - see the
      notification-system entry above (Cross-cutting): shipped in
      Session D step 8.
- [x] **Almanac: date, time, holidays, moon phase, on-this-day as one
      package** (S, D) - shipped, Session D step 7 (2026-09-06): split
      into five packages (`almanac-date`, `almanac-time`,
      `almanac-holiday`, `almanac-moon`, `almanac-onthisday`) rather than
      one, since `turnEngine.ts`'s `deterministicArgs()` can only ever
      bind one required arg per package and each of the five is its own
      zero-arg question - "one package" would have needed either a
      required arg none of them actually take or five near-duplicate
      routing patterns racing each other. `chrono-node` carries the
      date-parsing half forward as genuinely reusable hard-won logic
      from legacy's own `datetime.ts`/`time.ts`.
- [x] **The speech lint on every package `speech` string** (S, C
      defines, D runs) - already true by construction: C's
      `lintSpeechTemplate()` is wired into
      `spec/tests/ts/package-bronze.test.ts`, which sweeps every bundled
      package including D's own (it found and fixed a real false
      positive against D's `trivia` package before that package landed -
      see docs/dev/session-c.md's step 6 entry). Nothing further for D
      to build; the universal bronze sweep is D's own "runs" half.

**Intelligence and voice**

- [x] **A naturalness bench** (S-M, C) - shipped, Session C step 4
      (2026-09-06): `spec/llm/naturalness-corpus.json` (8 robotic/natural
      pairs) and `backend/scripts/bench/naturalness.ts`. The three named
      framing pairs (time as a fragment, yes/no as a fragment, a list as
      a sentence) joined the stable prefix as `lib/persona.ts`'s
      `NATURALNESS_POLICY`. Run for real against this dev machine's
      Qwen3 8B: 1 natural, 0 robotic, 7 ambiguous of 8 - a real first
      data point, not a gate; see docs/dev/session-c.md's step 4 entry,
      including a genuine unrelated finding it helped surface (below).
- [x] **Short, ambiguous utterances free-associate onto the plugins
      list** (S, C found it; closed by FAST-02 on 2026-09-12, which
      removed the list from the prompt) - `buildSystemPrompt()`'s standing "Things
      this household has set up" section names Weather unconditionally;
      Session C step 4's live naturalness/persona bench runs against a
      real Qwen3 8B (2026-09-06) found several completely unrelated
      utterances ("what time is it", "okay thanks", "why did the router
      just restart") all getting the identical reply, "It's 57.5 degrees
      in San Francisco" - confirmed via a direct `route()` call that this
      is model free-association onto the plugins list, not the
      deterministic floor firing (every score was well under
      `TIER1_THRESHOLD`). Needs whoever next touches `pluginsListLine()`
      to look at grounding it better (maybe: don't list a plugin's
      capability unless something in the turn is actually plugin-shaped).
- [x] **Spoken numbers by library, in both languages** (S, C) - shipped,
      Session C step 6 (2026-09-06): `numberToWords` replaced with
      `to-words` (MIT) on the TS side, `spec/voice/py/
      normalize_for_speech.py` added using `num2words` (LGPL-2.1,
      dependency only) on the Python side, both licences recorded in
      NOTICE. The clock-time, ordinal, currency, and unit ruleset stays
      hand-written beside it, unchanged, per the plan's own words. One
      shared fixture (`spec/voice/fixtures/normalize-for-speech.json`,
      32 cases) drives both `bun test` and `pytest`; both passed on the
      first real run. The speech lint (`lintSpeechTemplate()`) shipped
      alongside it, wired into `spec/tests/ts/package-bronze.test.ts` -
      see docs/dev/session-c.md's step 6 entry for a real false positive
      it found and fixed against D's own `trivia` package before landing.
- [x] **STT on the hub** (M, C) - shipped, Session C step 5 (2026-09-06):
      `backend/src/lib/{sttAssets,sileroVad,stt,sttSession}.ts`,
      `backend/src/routes/stt.ts`, `spec/voice/ts/sttTypes.ts`.
      `WS /api/stt/stream`, `POST /api/stt/transcribe`,
      `GET /api/voice/stt/status`. Sherpa-onnx-node's real Node bindings
      (verified live under Bun, no segfault) mean this needs no
      supervision through `lib/sidecars.ts` or a bespoke process
      supervisor the way `ttsSupervisor.ts` needs one for Pocket TTS's
      separate Python process - a deliberate, positive deviation from
      this item's own original wording; see docs/dev/session-c.md's step
      5 entry for the full reasoning. Silero VAD hysteresis (0.5/0.35),
      0.32s pre-roll, RMS pre-gate, 30s force-flush, and Moonshine's own
      silent-head retry are all ported from the legacy hub's proven
      `sttSession.ts`/`sileroVad.ts`, repointed at Moonshine instead of a
      whisper.cpp sidecar. Live acceptance verified against the pinned
      Moonshine tiny-en model and its own test fixture: exact transcript
      match.
- [x] **Import from the legacy hub** (M, C) - shipped, Session C step 10
      (2026-09-06): `lib/legacyImport.ts` + owner-only `POST /api/memory/
      import/legacy`, reads a legacy `app.db` directly, matches people by
      display name (never auto-creating a child or teen without a
      parent's own pick), imports `memories` (person/household scope,
      `source: import:legacy:memory:<id>`, embedded fresh on write, an
      entity-shaped category correctly kinded `record_kind: "entity"`
      via the same `categoryToRecordKind()` the judge uses), and pairs
      legacy `messages` into `conversations`/`conversation_turns` per
      person. Idempotent by construction (deterministic ids and a
      source-lookup, not a separate tracking table) rather than a literal
      once-only lock, so a household can re-run it after picking a
      profile for a previously-skipped child. A real (non-dry-run) run
      refuses without a backup on file first. **Real, deferred gap**:
      legacy's separate `entities` table now has a better home in F's
      own `lib/entities.ts` (`source: "imported"` already exists there
      for exactly this), but `createEntity()` has no override for it and
      no idempotency support, and it's F's owned file - left for F to add
      a bulk-import path to, not mechanically converted mid-wave. Legacy
      `memory_episodes` isn't imported either; the plan's own words for
      this step name only people/memories/conversations. See
      docs/dev/session-c.md's step 10 entry.
- [x] **Routing embeddings persisted per package** (S, C, with Tier 1) -
      shipped 2026-09-06, Session C step 1: `routing_embeddings`, keyed
      by `(package_id, example_hash, space)` so an unchanged example is a
      pure DB lookup, never a re-embed.
      re-embed only when an example changes; a cold boot must not
      re-embed sixty packages.
- [ ] **Re-embed on an embedding model change** (S) - found 2026-09-06
      (Session C step 1's own code review, while adding
      `routing_embeddings`): neither `memory_embeddings` nor
      `routing_embeddings` reconciles `space` on lookup - `recall()`'s
      cosine compare and `scoreByEmbedding()` both compare a query/
      utterance vector against every stored vector regardless of which
      model embedded it. A household that changes its embedding model
      keeps scoring against stale vectors from the old one indefinitely,
      silently, no error. Today's real mitigation is "there is exactly
      one pinned embedding model" (embedAssets.ts); this is real data
      debt the day that stops being true. Fix belongs to both stores at
      once (the identical gap, not two separate ones): either filter by
      the CURRENT space at query time (cheap only if the current space is
      known without an embed call) or a real migration that re-embeds
      everything on a model change.

**Deferred to Wave 3, recorded so it is not lost**

- The link transport, the oplog and sync engine, pairing over the
  network, the Python ports of the memory store, the Robots page: one
  session after the four merge, because it touches every record table.
  Wave 2 lays what it needs (Device, device tokens, Quick Connect, HLC
  everywhere, the never-sync allowlist as a spec test).
- Media: the player runtime (plan 4.8), Videos, Music and Podcasts
  rebuilt after their verdicts, the wall and budget layer before the
  first of them. Hub v0.2 scope; the lookups ship first by the rule at
  the top of this file.
- Generation (image, video), the Desktop shell, pods on ESPHome, Go.

## The 2026-09-06 code review: deferred findings

A security/correctness/performance review (23 findings, `NOTE-review-
2026-09-06/code-review.md`, outside git) was worked through in full;
every High and Medium landed as its own commit, along with all but four
Lows. Those four needed real design work or broke an existing,
widespread test/UX convention badly enough that forcing them in the
same sitting would have been its own separate, disruptive change - each
is filed as a GitHub issue with the full finding and is tracked here so
it stays visible on the dashboard, not just in the tracker.

- [x] **PIN-free adult profiles are a one-tap sign-in** (S-M, done
      2026-09-06, `getmaipai/home#35`, `getmaipai/home#47`) -
      `routes/auth.ts`'s `/select` issues a session for any secret-free,
      non-deleted profile with no throttle; `routes/people.ts` only
      forced a secret for owner/admin, so anyone on the LAN got full
      adult-tier chat with one tap. Fixed by requiring a secret for
      `role: "adult"` too, in both the create route and
      `checkRoleChange`'s promotion guard - deliberately NOT by gating
      `contentCeiling.ts`'s `hasUnrestrictedGrant()` or any ceiling
      lookup, since that's a further, still-unwired tier past the
      baseline adult ceiling and touching it would silently resolve the
      still-open "unrestricted-mode age collision" question below
      instead of fixing the actual exposure (which also includes
      `routes/approvals.ts` and `lib/commands.ts`'s role-based adult
      gates, untouched by any ceiling-layer fix). Scoped to `adult` only
      - `teen`'s ceiling is already non-unrestricted and no route
      role-gates on `teen` the way approvals/commands gate on adult.
      Migrated the ~26 affected test files' fixture helpers to create
      with a secret and sign in via `/api/auth/verify-secret`; two tests
      that specifically needed a passkey-only, zero-secret profile
      (proving a passkey alone satisfies the same guard) now construct
      that row directly rather than through the now-gated create route.
      No migration path was added for already-existing secret-free adult
      profiles in a running household - not yet a real-world concern
      pre-0.x, worth a BACKLOG item if it becomes one after release.
- [x] **Background LLM work has no idle gate against foreground turns**
      (S, done 2026-09-06, `getmaipai/home#33`, `getmaipai/home#45`) -
      `memoryJudge.ts`'s judge/consolidation jobs already gated on
      `turnActiveWithin()` before this review cycle; `conversationHistory.ts`'s
      `maybeRefreshConversationSummary()` was the one path left, and
      couldn't just reuse the same boolean gate as-is (it only ever runs
      INLINE right after the turn that would make that check true, so a
      naive gate would permanently disable the feature). Fixed by
      delaying it instead: `turnEngine.ts`'s post-turn hook now schedules
      a check `DEFAULT_IDLE_WINDOW_MS` later (a new shared constant,
      `lib/turnActivity.ts`, also now used by memoryJudge.ts instead of
      its own private copy) and only actually runs the refresh if no
      newer turn landed in that window - a rapid back-and-forth schedules
      one of these per turn, and only the last one (nothing newer to
      defer to) ever fires. Regression test in
      `tests/conversationHistory.test.ts` proves both halves with a real,
      sped-up timer (`__setSummaryRefreshDelayForTests()`).
- [x] **Backups block the event loop** (M, done 2026-09-22,
      `getmaipai/home#46`) - `lib/backup.ts`'s `runBackup()` ran
      SQLite's `VACUUM INTO` and `backupCrypto.ts`'s whole-file AES
      encrypt/decrypt synchronously on the main thread, stalling every
      other request for the duration on a large database. Fixed by
      running `VACUUM INTO` in a `node:worker_threads` worker with its
      own SQLite connection and replacing the whole-file AES
      encrypt/decrypt with streaming `node:crypto` cipher + `node:fs`
      streams. Measured: a 300 MB backup (315 MB encrypted) takes 656
      ms on the worker while an unrelated `GET /api/people` completes
      in 2 ms on the main thread. Exit check: `backup.test.ts`'s
      "a running backup does not block unrelated request handling on
      the event loop" seeds a 300 MB BLOB into `memory_records`,
      starts `runBackup()`, and asserts the unrelated request returns
      200 in under 100 ms.
- [x] **`memorializePerson()` isn't atomic** (S, done 2026-09-06,
      `getmaipai/home#49`) - had the same multi-statement-with-no-
      transaction shape `deletePerson()` had before COR-5's fix
      (`personLifecycle.ts`). Fixed by wrapping the write portion in a
      named `sqlite.transaction()`, the same pattern `commitPersonUpdate()`
      and `deletePerson()` already use. Same commit also closed
      `getmaipai/home#37` (`deletePerson()` left passkeys, devices, device
      tokens and the TOTP secret behind).

## How to use this file

- Check an item off only when it's shipped and verified (per
  `getmaipai/.github`'s own definition of done), not when it's started.
- A new gap found while working on something else gets added here, not
  just mentioned in passing in `docs/dev.md`.
- Size tags are a rough gut check for planning, not a commitment.
