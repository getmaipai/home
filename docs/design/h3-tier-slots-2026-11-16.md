# MiniMax H3 as the picture and video family for every tier (owner decision, 2026-11-16)

Status: proposed, needs an architect verdict. Decisions recorded 2026-11-16 (the owner chat quotes are in [model-choice-2026-11-16.md](model-choice-2026-11-16.md); no household's own settings are recorded here). This note is the written owner decision the eval record asked for (section 7 of [minimax-h3-eval-2026-11-15.md](minimax-h3-eval-2026-11-15.md)) and the decision of every tier.

## Supersedes

- [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) 2a.3, "pictures, video: no Reduced model; they queue with the reason `max_window`": pictures and video get a Reduced slot (H3 streaming).
- [h3-swap-2026-11-16.md](h3-swap-2026-11-16.md) section 5 ("H3 ... must not be a default engine of a released product") and section 7.3 (single-source features optional and off by default): answered by the owner decision.
- RULES.md W1 (words pictures on ERNIE) is **amended by model-choice-2026-11-16.md**, not by this note: this note leaves word pictures on the rule's route until that note lands.
- The LICENCE FLAG ("no default or recommended slot without a written owner decision") on H3-SLOTS-HOME-01, H3-MAX-01 and H3-VIDEO-STACK-01 and section 7 of the eval record: the owner decision is given; the licence is handled by the household acceptance flow (LICENCE-ACK-01, `lib/licenceFlow.ts`) and is shown in the engine's own record, not raised in copy or settings.
- The default picture and video makers of [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) and [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md) for adults: replaced by the Primary and Secondary of [model-choice-2026-11-16.md](model-choice-2026-11-16.md) (a new install: FLUX 3 and LTX-2.5 primary, H3 secondary); Z-Image, Klein and LTX-2.5 stay installed and selectable (nothing is removed: port before delete).
- H3-SLOTS-HOME-01 is amended in place (below). FLUX 3 Image Klein is **adopted** by [model-choice-2026-11-16.md](model-choice-2026-11-16.md) (bench of 2026-11-16, eval record sections 8 and 9): the shipped default Primary for pictures, with H3-Image as the Secondary, either role set by the household.

## Reuse check

One family: `minimax-h3-image` and `minimax-h3` (H3-IMAGE-STACK-01, H3-VIDEO-STACK-01, landed in the Stack), the Home H3 maker (95bb6e5), `TIER_CANDIDATES` and the per-feature AI and models cards (AI-ROWS), OPTION-NAMES-02 for names. No new engine, no new setting.

## The decision for every tier

Pictures (H3-Image: new pictures, edits and up to 16 references, one model at every tier):

| Tier | Setting | Measured |
|---|---|---|
| Reduced (system only) | streaming INT8, 1024 px, 6 steps, up to 4 references | 33 s, 1.8 GB (eval) |
| Standard | resident INT8, 1024 px, 6 steps; the Stack streams instead when fewer than about 25 GB are free | 9 to 13 s, 19.7 GB |
| Boost | resident INT8, 1536 px, 6 steps, up to 16 references | 1536 not yet measured (H3-MAX-01) |
| Max | 2048 px; 4096 px stays advanced until measured | author: 2048 about 57 s and 22 GB; not measured here |

Video (the H3 tier table, for any household where H3 is the Primary or the Secondary; LTX-2.5 keeps its own tiers in the other role):

| Tier | Setting | Measured |
|---|---|---|
| Reduced and Standard | H3 streaming build, 864x480, 5 s, with sound, light upscale | 170 s, 14.8 GB (eval) |
| Boost | H3 8-bit resident, 864x480, up to 8 s, with sound | about 4 min, 42 GB |
| Max | H3 8-bit, 864x480, up to 10 s until H3-MAX-01 measures 1344x768 | 10 s clip not yet measured |

Edits and Studio features on H3: first and last picture at every tier it runs; Swap (CREATOR-57) Max only (85 to 112 GB); character sheets (H3-SHEET-STACK-01) Boost and Max (35 GB), Standard and below keep the current sheet builder.

Unchanged: children and teens keep today's makers and lanes (Wan Quick, Klein; gates unchanged); LTX-2.5 and its Max profile keep their own tiers in whichever role they hold (the shipped default Primary for video on a new install), chosen by the household in AI and models or by the person's own picker; the Secondary is the answer when the Primary is not installed or not ready (the maker choice already falls back).

## Build rows

1. H3-SLOTS-STACK-01 (Stack, limited to what is missing: the Standard and Boost picture slots already exist in `tiers.ts`): `TIER_CANDIDATES` entries and tier slots for `minimax-h3-image` Reduced (streaming) and Max (2048), and for `minimax-h3` video and `minimax-h3` video (streaming Reduced and Standard, 8-bit Boost and Max), `recommended` resolving to the household's Primary per tier; tests for each tier's choice and admission.
2. H3-SLOTS-HOME-01 (Home, amended): the picture quality slots and the edit slot use the household's Primary picture model per tier (H3-Image's tier table when it holds that role); the video makers follow the household's Primary and Secondary; the AI and models cards name the model and the alternate (OPTION-NAMES-02); nothing removed; children and teens unchanged; previews at desktop and phone width.
3. H3-MAX-01 stays the bench for the Max cells (2048 and 4096 px pictures, 1344x768 for 10 s video).
