# Resource tiers and making space: backlog audit, 2026-10-31

Checked against `origin/main` of Home (`6b653ad07`), Stack (`6a36b64`) and commons (`ui-v0.5.432`, `spec-v0.1.281`). "Live" means the installed Home `sha-6b653ad` and the running Stack on port 8770: its bundled source holds `tier_reduced`, `fits_ever`, `audio/stems` and `reclaim`, and `/stack/v1/capabilities`, `/stack/v1/memory`, `/stack/v1/memory/reclaim` answer 200 and `/stack/v1/tiers/candidates` answers 400 (it needs a category). Stack tier tests (`tiers`, `governorTiers`, `reducedChat`, `engineCatalog`): 32 pass, 0 fail, run on a fresh worktree of Stack `main`.

## Done (ticked by the lander with this record)

| Row | Evidence |
|---|---|
| TIER-EVAL-01 | Home `dc551e579`; verdict in `tier-evaluations-2026-10-30.md`: Reduced chat passes on swap time, first word, memory and tool probe, conditional on pause behavior and household feel (covered by TIER-SHIP-01) |
| TIER-EVAL-02 | Home `dc551e579`; Chatterbox Nano confirmed by Jesse's ear (`a4c63e5b4`) |
| TIER-EVAL-06 | Home `2c576716b`; XL turbo and XL SFT get no slot, Max music stays empty (Jesse's listen) |
| TIER-EVAL-07 | Home `5cfa55f67`; `htdemucs` is the Standard pick, built as TIER-STEMS-01 |
| TIER-EVAL-08 | Home `dc551e579`; answer is no, default stays Parakeet |
| TIER-STACK-01 | Stack `fb713c2`, `378db15`; `tiers.test.ts`; live route `/stack/v1/tiers/candidates` |
| TIER-STACK-02 | Stack `67f6205`, `cfd6677`; `governorTiers.test.ts`; live source holds `fits_ever` |
| TIER-STACK-03 | Stack `cc02490`, `cfd6677`; `reducedChat.test.ts` (in-flight guard, rollback); live source holds `tier_reduced` |
| TIER-UI-01 | commons `bf2389c`, tag `ui-v0.5.432`, pinned in Home `875bf365d` |
| TIER-PRIO-02 | spec keys `resources.*` (spec-v0.1.279); the panel is `PerformanceCustomize.tsx` (priorities, quiet seconds, longest wait, cooldown, lower without asking, profile table) |
| MEM-SPACE-01 | Stack `67f6205` (reclaim steps on the job record, 2-minute pool grace); live `/stack/v1/memory/reclaim` answers 200 |

## Open (owner, what is missing)

| Row | Missing | Owner |
|---|---|---|
| TIER-EVAL-03 | Max video slot empty; LTX dev two-stage run and the 4-bit runtime question not run | tier-evals |
| TIER-EVAL-04 | 13 of 22 bakeoff prompts for Qwen-Image 20B; Max edit slot empty | tier-evals |
| TIER-EVAL-05 | The real chat benches (CHAT-AB-01, KS-BENCH-01) on the Standard, Boost and Max candidates; Max chat undecided | tier-evals |
| TIER-PRIO-03 | `decideDownshift` and `mayRestoreNow` exist and are tested but no production code calls them; wire them into the Max admission, then the 50 s and 61 s acceptance test | tier-queue |
| TIER-HOME-05 | Max chat lease, `max_chat` queue reason, idle release, retiring `coding.home_mode` | tier-queue |
| TIER-STEMS-01 | Screenshot of the stems card at 1440 and 390; `edit_music` bench row | stems |
| TIER-BENCH-01 | `tier-mix-bench.ts` is synthetic and has no recorded result; run it and record the numbers, then add the engine-level scenarios | tier-stack |
| TIER-SHIP-01 | Per-category prove and ship on Jesse's word | tier-stack |
| SPLASH-DISK-01 | Cache is always off (Stack `576bf95`); the two-hour zero-write measurement is not recorded | tier-stack |
| MEM-SPACE-02 | Only Stack media transcodes run at background priority; Home embedding and indexing workers and stem prep do not; first-token within 10 percent not measured | app-helper |
| MEM-SPACE-07 | TextEdit measured; Safari, Music, Messages, Chrome, Firefox, Pages and a second Mac are not | app-helper |
| TIER-STEMS-02 | Upload split: Jesse's decision, left unbuilt | none |
