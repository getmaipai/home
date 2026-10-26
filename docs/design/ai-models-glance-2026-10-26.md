# AI and models, at a glance (2026-10-26)

Status: approved by the architect 2026-10-26 (fourth ruling). Item AIMODELS-GLANCE-2026-10-26.
Owner record: Jesse, 2026-10-26, five mockup screenshots ("completely revamp exactly like these screenshots") after the
collapsed job cards still read as too much. His answers the same day: the mockup replaces the Models tab; Engines, Advanced
and Coding tabs stay as they are; per-model memory shows as a marked estimate until measured.

## Supersedes

This note replaces these parts of `ai-models-simple-2026-10-25.md` and of the 2026-10-26 "Where the settings live" placement:

- Sections 2 and 3: the collapsed job cards (`AiJobChoices`, `AiJobCardView`) become rows plus the gear dialog.
- Section 5: the "Set everything to recommended and download" button. Its job moves to the reset arrow per row, "Use recommended" in
  the dialog, and "Download missing (N)".
- Section 9: "Models keeps everything expert". The Models tab goes (owner's answer, 2026-10-26); section 6 below says where each of its
  parts goes.
- Section 10: the component table, for the files named in section 2 below.
- Section 3's rule that a model name shows only under Details: the mockup shows the model name and one line on every row. Owner's
  newer word wins; the (i) in the dialog holds the detail.
- The placement that gave each job's group its own `ai.job_choices` card: the seven job groups now share one `ai.glance` view card.

## Reuse check

Prebuilt first (principle 6, rule 9b). Both bars (Memory and Storage) are the kit's `StorageBar`
(`@maipai/ui/src/primitives/StorageBar`, ui-v0.5.282; `docs/design/UI-DECISIONS.md` line 18; Home already uses it in
`frontend/src/shell/library/LibraryStorage.tsx`). It is a proportional multi-segment bar with a legend. If it lacks the pending
segment, the "after apply" projection or a RAM unit, that is an additive `StorageBar` prop in `commons` first (section 7), never a
second bar. The kit `chart.tsx` and the `shadcndashboard` storage card are not used. Data reuses what exists: `GET /api/ai/choices`
(cards, disk, free space), `api.engines()` (`measuredFootprintBytes`) and the `/api/install` job list; nothing new is polled (rule S6).

## 1. The page (Settings > AI and models > Overview)

The mockup is the spec. One page, top to bottom:

1. Header: eyebrow "Your AI setup", title "AI & models", subtitle "A quick look at what's running on this computer." Top right,
   green "Download missing (N)".
2. Amber banner when models are chosen but not on the computer: "N models not on this device" with names and total size.
3. Purple banner while choices are staged: "N changes staged. Nothing changes until applied." with Discard and "Apply changes".
4. One card with two bars. Memory (total, then in use, Home, free, and a pending segment) and Storage (disk size, used, Models,
   free, a "Free up space" link with the reclaimable size). Each shows "After apply and download: ..." only while changes are staged.
5. "Model choices at a glance" with the counter "2 custom, 4 recommended, 1 disabled", then seven rows: Chat, Pictures, Videos,
   Music, Voice and speaking, Wake word, Coding helper. A row has an icon, the name, an On/Off switch, a badge (Custom with a
   reset arrow, Recommended, Disabled), the model name with one line, "X GB, Y GB RAM", and a gear. A chosen model that is not on
   the computer gets an amber row and a download arrow.
6. Footer: "Last checked just now, this computer, View device".

The gear opens "Choose a model": radio cards (name, Recommended badge, description, size and RAM, "Fits this device", an (i) for
details) plus Disable, "Use recommended" and "Save choice". The reset arrow opens a confirm: "Use recommended for Chat? This stages
Home's recommended model. Your current choice stays in use until you apply the change."

## 2. Decisions

- **Staging is client state.** Choices staged in the gear are held in the page (a map of job to choice id), not written to the
  server; Apply runs the existing `POST /api/ai/choices/:job` per staged job, then one install for what is missing; Discard clears
  the map. No new record, no new route for staging. A reload discards staged changes, which the banner copy already says ("nothing
  changes until applied").
- **Seven jobs, not six.** Wake word leaves the Voice job and becomes its own job (`shared/aiChoices.ts` `AiJobId` gains `wakeword`).
  Its rows come from the disk plan when a tier lists one; a tier with none shows the row Disabled with "Not offered on this computer".
- **Recommended and Custom are derived**, never stored: a job is Recommended when its current choice equals the tier's recommended
  choice, Custom otherwise, Disabled when its switch is off. The counter counts those.
- **Memory is projected, with marked estimates.** Each choice gains `ramBytes` and `ramBasis: "measured" | "estimate"`. The disk
  plan rows (`shared/diskPlan.json`) gain `ram_bytes` and the existing `basis`; a measured Stack footprint (`measuredFootprintBytes`)
  replaces the estimate. Estimates read "about 2.8 GB RAM". The Memory bar projects staged choices from these.
- **Old pieces retire.** The Models tab (`ModelsAndStorageSection`, `SizingPanel`, `ModelsSection`) is removed from the AI page;
  Engines, Advanced and Coding tabs are untouched. The collapsed job cards (`AiJobChoices`, `AiJobCardView`) are replaced by the rows
  and the gear dialog. "Set everything to recommended and download" becomes the per-row reset plus "Use recommended" in the dialog.
- **Copy lives in the spec** (rule S5): new keys for banner, counter, badges, dialog and confirm text go spec-first (`commons`
  tag, then pin); only Jesse says yes to the tag.
- **Kit Elements as shipped** (rule 9): Switch, Badge, Button, RadioGroup, Dialog, AlertDialog, Progress and Alert as the kit
  ships them, no shape className, no wrappers. Both bars are the kit `StorageBar` (Reuse check).

## 3. Slices

0. Spec: the `groups` card field, the key moves, `household.ai_wakeword` and the new copy keys (one `commons/spec` tag).
1. Data: `wakeword` job (generated `ram_bytes` in the disk plan comes from the Stack generator, never a hand edit), `ram_bytes` in the disk plan, `ramBytes` on choices, tests (`shared/aiChoices.test.ts`).
2. Page: rows, banners, bars, gear dialog, reset confirm, staging and Apply, tests, then the preview at 1440 and 390 px.

## 4. Settings placement (rule S4)

`areas.json` gets one `ai.glance` card on tab Overview, drawn by `SettingsShell`, whose view holds the header copy, the two bars, the
banners, the seven rows and the footer (all copy is spec text, rule S5). Every registry group sits in exactly one card, and a card's
view edits only keys of its own groups, so:

- The four engine choice keys the switches write move spec-first from `household.ai_models` into their job groups:
  `engines.image.choice` to `household.ai_pictures`, `engines.video.choice` to `household.ai_videos`, `engines.music.choice` to
  `household.ai_music`, `engines.wakeword.choice` to a new group `household.ai_wakeword` (the seventh job group; six exist today).
  The chat, voice and coding choices are already in their job groups.
- `household.ai_models` ("Model per job") keeps only the roles with no row (router, embed, rerank, judge and the like) (its own card, on the Advanced tab).
- `generation.music.enabled` ("Adults can make music") stays in `household.ai_music` and is drawn in the Music row's gear dialog with
  its spec label and help, so it does not vanish. `generation.video.enabled` stays where it is (`household.pictures`).
- `household.chat_pause` stays its own Overview card below the glance card. "Search and memory" and "Always on" stay below it.
- Tabs: Overview, Engines, Advanced, Coding (Models removed).
- `household.ai_models` keeps its own card, moved to `tab: advanced`.
- **Spec mechanism (spec-first slice):** `AreaCard` carries one `group` today and `areas-check.ts` counts one group per card. The card
  gains an additive `groups: [...]` field that `areas-check.ts` counts as drawn by that card, so the `ai.glance` card draws the seven
  job groups and no group is left unplaced. `commons/spec` tag first, then the Home pin; only Jesse says yes to the tag.
- Backlog: this narrows MODELS-PAGE-01 (per-model rows with speed chips) to the Advanced All parts list; the landing says so.

## 5. Switches, data, refresh

- **On/Off switch** writes the existing `engines.<role>.choice` key: `off` turns the job off, `auto` (or the chosen model id) turns
  it on. `SizingPanel` already writes `off` there today with the same removal confirm. Video and music keep their adult-gate keys
  (`generation.video.enabled`, `generation.music.enabled`) untouched: those say who may make them, not whether the model is kept.
- **Staging** is page state (section 2); Apply writes these keys and the model choice per staged job, one request each.
- **Refresh:** the page refetches on the `/api/install` job list changing (same trigger as the install strip) and after Apply;
  no interval, no new banner or toast. "Last checked" is the time of the last successful fetch. Memory "in use" is the engine's
  measured footprint from `api.engines()` read at the same moments.
- **Banners:** the amber "not on this device" notice is the kit `warning` Alert inside the page's card, with no progress; progress
  stays on `InstallStrip` and the row's own bar. The purple staged banner uses the same Alert shape.

## 6. Where the Models tab parts go

The style (LoRA) list, the per-part Uninstall and the "All parts" list stay reachable: Uninstall of a model is "Free up space"
(already built) plus the row's gear dialog; the All parts list and the style list move to the Advanced tab as the existing
`ModelsSection` card, unchanged. Nothing is deleted except the duplicated memory panel (`SizingPanel`), whose numbers the Memory bar
now draws.

## 7. Kit variants not shipped (rule 9c): each is a `commons` change first

Purple "staged" Alert variant, green Button variant for "Download missing", an amber highlighted row variant, the "Fits this device"
mark on a radio card, and, only if `StorageBar` lacks them, a pending segment, an "after apply" projection and a RAM unit as additive `StorageBar` props. Each is its own `commons` worktree and tag, and only
Jesse says yes to a tag. Rows use the kit Item-style primitive (or `Field`), never a Home `*Row` box. Until the variants ship,
the build uses the closest shipped variant and records the gap, rather than a `className`.

## 8. Wake word limit

The Wake word row's switch only keeps or removes the detector assets. It never turns listening on for any device: wake word stays
default-off with per-device adult authorization (WAKEWORD-CATALOG-01, SAFETY.md). The row says so in its one line.

## 9. Descriptions

The one-line model description on every row and radio card comes from the spec or the model catalog's own copy, never a Home string.

## 10. Not in this design

The setup wizard step (AIMODELS-SETUP-01) reuses the rows later. Stack-unreachable failure copy (S6) stays as shipped.

## 11. As built (2026-10-26)

- Files: `AiGlance.tsx` (the `ai.glance` view), `AiModelDialog.tsx` (the gear dialog body), `aiGlanceRows.ts` (rows, staging, projection).
- **Memory bar:** Home's models, an "Other apps" segment, the staged change and free memory. "Other apps" is the computer's total
  memory, less what it reports free, less Home's models; the hub sends the free reading as `memory_available_bytes` and the
  segment is hidden when the reading is missing or the result is zero. It is an estimate. Each model's RAM is the disk plan's estimate and reads "about X GB RAM" until measured.
- **Storage bar:** the disk total is installed models plus free space. "Free up space" opens the existing dialog.
- **Closest shipped variants** (section 7 gaps stay open): the staged banner is the default Alert, "Download missing" the default
  Button, the staged Memory and Storage segment uses the orange hue, and an unavailable model shows as the amber banner plus the
  row's download arrow, with no amber row. "View device" links to the Engines tab.
- Overview stays on the AI page; Engines, Advanced and Coding are unchanged. The Models tab parts moved to Advanced (section 6).

### Quick, Detailed and Wake word rows (2026-10-26, spec-v0.1.242)

- **Eight jobs.** Quick pictures and Detailed pictures are separate rows. Quick is a radio choice between ERNIE and FLUX.2 Klein
  (`generation.picture_quick_model`, default ERNIE). Detailed is Z-Image Turbo with its own switch and gear
  (`generation.picture_detailed.enabled`, default on). Off is setting-only: the model stays installed, chat then makes Quick
  pictures with the `detailed_off` note, and Free up space lists it as "turned off". `generation.picture_quality` stays the
  household default that chat can override per picture.
- **Wake word lists the model.** The row is the stock openWakeWord "hey jarvis" detector plus its two shared feature models
  (`wakewordAssets.ts`, pinned and sha256-checked). On installs the files, Off removes them, and the next use downloads them
  again. Listening stays default-off and needs the per-device adult opt-in (`voice.wakeword.enabled`); the row never touches it.
