# Resource tiers, profiles and Close apps (developer notes)

Dev tier. Design records: [resource tiers](../design/resource-tiers-2026-10-27.md), [families and options](../design/tier-families-and-options-2026-10-30.md), [resource profiles](../design/resource-profiles-2026-10-30.md), [making space](../design/making-space-2026-10-30.md), [auto-close apps](../design/auto-close-apps-2026-10-30.md), [stem splitting](../design/stem-splitting-2026-10-30.md). This page is the code map for what is on `main` and what is not. The rules that bind it are `RULES.md` rules 0 and 8: age and surface gates run first, and a tier never loosens them.

## Records (commons `spec`, pinned by tag)

- `vocab/resource-tiers.json` defines the tiers, categories (chat, image, video, music, voice, mapped to engine roles chat, image, video, music, tts), typed options, switch-cost classes and the minors policy. Reduced is applied by the system and is not pickable.
- Slot records: `engines.<role>.tier.<reduced|standard|boost|max>` hold `{ model, options, who? }` (`schemas/tier-slot.schema.json`). `model` is a catalog id, `recommended` or `off`. `checkTierSlotOptions` validates options; `optionsForBand` forces options marked `minors:false` (thinking, reasoning budget) to their defaults for a child or teen.
- Grants: `tier.max` (all categories; never a teen's) and `tier.max:<category>` in `vocab/grant-actions.json`. Child never, teen only `tier.max:image` and only by an admin.
- Job fields: `tier`, `window`, `tier_reason` and `profile` (counts only: `lowered`, `queued`, `off`, `closed_apps`, `closed_bytes`; no app names) on the Stack job; `tier` in `GenerationProvenance`; `family` on model capabilities.
- Settings: `resources.preset|quiet_seconds|quiet_max_wait|quiet_timeout|cooldown_seconds|lower_without_asking.<category>|priority|profiles` and `resources.close_apps.mode|always|never|reopen|no_reopen`. Changing one by hand makes the preset read `custom`.

## Who gets which tier: `backend/src/lib/tiers.ts`

`clampTier` is pure; `authorizeTier` binds it to the real grants and slots. Order of lowering: the age band ceiling (`bandCeiling`: child Standard; teen Standard except image; adult Max), guest to Standard, Max without `holdsMax` to Boost, a switched-off slot down a step, then Boost's slot `who` (`everyone`, `assigned`, `admins`). Max is opened by the grant alone. `holdsMax`: owner and admin by role; child and guest never; a teen only per category.

`maxAvailable` is false until an admin points the Max slot at a model of its own, so `tierArgument` lowers Max to Boost with `MAX_NOT_ON_THIS_COMPUTER_LINE` and no Max control shows (`maxOffered`). The recommended Max slot is empty until the evaluations in `docs/design/tier-evaluations-2026-10-30.md` fill it.

`allowedQuality` keeps the old Quick (Standard) and Detailed (Boost) words working. `tierSlotMigration.ts` mirrors `generation.picture_quick_model` and `generation.picture_detailed.enabled` into the picture Standard and Boost slots at boot, and a later write to a legacy key stays mirrored. An explicit slot value wins.

## Queue, window and profile: `backend/src/lib/jobs/`

- `householdQueue.ts`: `order` and `admit` apply the score (`jobScore.ts`: class weight, aging, fair share, admin boost), holds (`heavy_slot`, `max_drain`, `max_window`, `fairness_wait`) and one Boost or Max job at a time. `decideDownshift` is the quiet window: wait for `quiet_seconds` without a chat turn, give up after `quiet_max_wait`, then `quiet_timeout` decides proceed or keep waiting; `cooldown_seconds` stops flip-flopping. No clock cancels a running job; a watchdog CRITICAL requeues once (`requeueAfterCritical`).
- `liveFit.ts` is the admission ladder: for a Boost or Max job it reads the profile row, the Stack's free and evictable memory, and lowers one cell at a time (`run`, `ask`, `queue`, `refuse`) until the lead fits. `profileTable.ts` validates rows; `profileSource.ts` reads `resources.profiles` at every admission; `admissionFit.ts` records the counts-only profile on the job. `fitWording.ts` writes the ask line.
- `activeProfileLine()` and `closedAppsLines()` feed the admin Status line; `openMaxWindow()` and `endMaxWindow()` back the Max-job Stop. `reducedChat.ts` produces the line under the chat input; it never holds Send.
- `closeApps.ts` is the close step: it runs after the table lowers other cells and before chat is lowered, through the Mac app helper (`appHelperClient`: list, quit, reopen by bundle id over a user-only socket; no signals). Eligible apps are on Always, not on Never, not frontmost, not in front in the last two minutes, and not on the built-in floor. App names stay in module memory for the job and the admin Status line only; the job record keeps counts and bytes (rule 6a). Reopen runs at job end unless the app is on `no_reopen`. `closeAppsProbe.ts` is the setup wizard test on Calculator.

## Surfaces

- AI and models: `AiGlance.tsx` (row **Levels** button, `AiSlotDialog.tsx` picks a model per level from the Stack's tier catalog grouped by family, disables what exceeds the cap, saves options and `who`), plus the **Stop the Max job** button.
- Performance (admins): `PerformanceSettings.tsx` (presets, Free up memory, Close apps card, capability table, host tune for the owner, Customize with priorities and the profile table). Routes in `routes/performance.ts` and `performanceApps.ts`.
- Cards and tools: the typed `tier` argument on the picture, video and music tools (no new tool; the cap stays 16), Make it Boost and Make it Max on cards, `edit_music` `change: "stems"` (see [music generation](music-generation.md)).

## Not landed

The Stack's tier catalog, resolver and governor tiers (TIER-STACK-01 to 03), the kit tier segment (TIER-UI-01), and the Max chat lease with the retirement of coding mode (TIER-HOME-05) are open in `docs/BACKLOG.md`. No Max model is recommended for any category. Nothing here is shipped to a live hub by this page.

## Adding a model to a slot

1. Add the candidate to the Stack catalog with its family, measured peak and licence (goes through MODEL-VET-01).
2. If it needs a new option, add it to `vocab/resource-tiers.json` in `commons` spec first, then tag and pin (`docs/PINNING.md`).
3. Add a test beside `tiers.test.ts` for the new slot and its minors behaviour.

## Keeping this true

Docs change in the same commit as behavior. A change to a level, a grant, a preset, the ladder or Close apps updates this page and the matching user page ([levels](../user/levels.md), [performance](../user/performance.md), [close apps](../user/close-apps.md)).
