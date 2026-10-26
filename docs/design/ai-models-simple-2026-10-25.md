# AI and models, made simple (2026-10-25)

Status: built (page rework landed 2026-10-26; setup step AIMODELS-SETUP-01 still to do). Item AIMODELS-2026-10-25.
Owner record: Jesse, 2026-10-25, with a screenshot of Settings > AI and models > Overview: about 20 checkbox rows with model names, sizes and
"Installed", "impossible to go through". His words: "like I see Imaging and I have an easy choice between a few options, chat the
same thing: easy to understand choices, and see what's selected and what's recommended." He could not find the new picture model
(ERNIE) in the list. Two later asks, same day: one button "Set everything to recommended and download", and a Clean up option for
unused models. Both are in this design (sections 5 and 6).

## 1. The problem, measured

The Overview is the install plan drawn as one flat list: one row per disk plan row (`shared/diskPlan.json`, tier p128 has 16
non-engine rows plus Home itself), each with a model name, a size and a state. The person must know what "projector" and
"Chatterbox" are to choose. Nothing groups rows by what the household wants to do, and the page never says which rows are
needed, which are a choice between two things, and which is the recommended one. The Pictures page already solved this for one job:
Quick or Detailed, a plain sentence each, a Get button, model names only under Details (`PicturesLibrary.tsx`, IMGGEN-QUALITY-01).
This design applies that pattern to every job.

## 2. The page

Route `/settings/ai`, tab Overview (the other four tabs stay, section 9). Top to bottom:

1. **Header line.** "Using 41 GB. 612 GB free. Everything recommended is 62 GB to download." Two buttons beside it: the primary
   "Set everything to recommended and download" (section 5) and the quiet "Free up space" (section 6).
2. **One card per job**, in this order: Chat, Pictures, Videos, Music, Voice and speaking, Coding, Search and memory. Listening has no
   choice on any tier (speech to text is needed, one model), so it is a line in Always on, not a card. Every card has the same
   shape (section 3).
3. **Always on** card at the bottom: one line listing the needed parts with one combined size.
4. A link "All parts, with names and sizes" to the Models tab, for the expert list this page replaces.

A person who opens the page and scrolls once sees seven cards and what is chosen in each.

## 3. The card

Each job card is the same, so the page reads like Pictures does today:

```
Pictures                                        [ Using Quick ]
Make pictures in chat and change the ones you have.

 (o) Quick            Recommended   Installed
     Pictures in a few seconds. Draws words correctly.
 ( ) Detailed                       Not installed, 33 GB
     Slower, with finer detail and more looks to add.        [ Get and use Detailed ]
 Changing pictures                                Installed, always on
     Needed to change a picture and as the backup.

 Tools   [on ] Take out a background, erase, make bigger   Installed
         [off] Name things in a picture                    Not installed, 4 MB
 > Details
```

Rules for every card:

- **Title and one plain sentence** (what it does for the household), then a status chip at the top right: "Using Quick".
- **2 to 4 choices as a radio group.** A radio picks the household's default for that job; it is one of the existing settings (section 4),
  never a second store. Optional single things (Music, Coding, tools) are an on/off switch with the same row layout.
- **The current choice is marked twice**: the filled radio (or switch on) and the chip "Using Quick". A choice that is chosen but not
  installed reads "Chosen, not ready" and the card keeps the existing Alert ("Detailed is chosen, but it is not ready. Chat makes Quick
  pictures until it is on this computer.").
- **"Recommended"** is a kit Badge on exactly one choice per card (the choice whose disk plan row has `need: "recommended"` for this
  computer's tier; when none, the default row of the tier). It never moves because of what is installed.
- **Size and state** are small secondary text: "Installed" or "Not installed, 33 GB". Never a model name or MB figure.
- **One action per choice that is not ready**: "Get and use Detailed" downloads it and makes it the choice in one press. For an
  installed choice that is not current the action is "Use this". The current choice has no button.
- **Details** (kit Collapsible, closed): model names, sizes in MB, where each one runs, the licence line, and which features use it.
  This is the only place a model name appears (owner's rule).
- **A choice this computer cannot hold** stays visible, greyed, with the reason in plain words and the number: "Needs about 74 GB
  free. This computer has 38 GB free." or "This computer does not have the memory for it." The reason comes from the disk plan verdict and the Stack's
  `requirement_reason`; it is never hidden.
- **Installing**: the choice row shows the kit Progress bar from the job record (rule S6: one job's progress lives on its own card)
  while the shell progress strip (`InstallStrip`) carries the same job. Failure: "Did not finish. Try again." with the existing Repairs item.

### The cards and their copy (grade 6, no model names)

Where the copy lives (rule S5): the option labels and descriptions of the radio choices are the spec copy fields (`copy.options`) of the settings
they set (`generation.picture_quality`, `generation.video_quality`, `generation.music.enabled`, the voice and chat choices), read through
`describeSetting`; the card titles and one-sentence descriptions are `areas.json` card copy. Both ship spec first in slice 5 (the existing
picture and video option texts are rewritten there: Quick no longer says "a few seconds" only, it adds that it draws words correctly). Neither `aiChoices.ts` nor the view holds a hand-written description. Size, state and reason lines are data, not setting help.

| Card | One sentence | Choices | Recommended | Maps to disk plan rows |
|---|---|---|---|---|
| Chat | Talk with Home, and let it look at pictures you send. | Standard chat AI. Faster on Apple chips (shown only where the tier lists it). Switch: Chat can look at pictures. | Standard; looking at pictures on | `chat`, `chat-mlx`, `reads-pictures` |
| Pictures | Make pictures in chat and change the ones you have. | Quick: "Pictures in a few seconds. Draws words correctly." Detailed: "Slower, with finer detail and more looks to add." Changing pictures (fixed): "Needed to change a picture and as the backup." Tools switch: "Take out a background, erase something, make a picture bigger." Switch: "Name things in a picture." | Quick; tools on | Quick = the ERNIE row, Detailed = `pictures-zimage`, Changing = `pictures` (Klein), `image-tools`, `tool-look` |
| Videos | Make short videos in chat. | Quick videos: "A short clip in a few minutes." Detailed videos with sound: "Longer wait, sharper, with sound." | Quick videos (owner, 2026-10-25); Detailed with sound is one click away and not recommended | `video` (recommended), `video-detailed` (optional) |
| Music | Make songs and tunes. | Switch: Make music. | Off until asked for (plan says optional) | `music` |
| Voice and speaking | Choose how Home sounds when it talks. | Standard voice (always installed). Better voice: "Warmer and more natural, uses more space." | Better voice | `voice` (always on), `voice-better` |
| Coding | Help with code in the Code app and in chat. | Switch: Coding helper. | On | `coding` |
| Search and memory | Look things up on the web and remember what you tell Home. | No choice: both are needed, so this card is one line and a link to Settings > Search and web, where the web search controls already live (rule S4: a group is placed once). | n/a | `search`, `embed` (always on) |

Always on (one line, Details lists them): "Always on: Home itself, the helper that checks answers, listening, the standard voice,
memory search and web search help. About 3.1 GB. They are needed, so they cannot be turned off." The sum comes from the plan rows with
`need: "required"` plus the non-selectable `search`, `embed`, `judge`, `stt`, `voice`, `home` and the engine rows they use.

## 4. One source of truth

No new setting, no new store. A new pure function in `shared/aiChoices.ts` builds the cards from three inputs that already exist:
the tier's disk plan rows (`shared/diskPlan.json`, `diskPlanMath.ts`), the Stack component list (`ComponentRow`: state, sizes, `used_by`,
`can_install`, `can_uninstall`, `uninstall_block`, `requirement_reason`) and the household settings. The card's current choice is read,
and written, where it already lives:

| Card | Current choice read from, and written to |
|---|---|
| Pictures | `generation.picture_quality` (`quick` or `detailed`). Quick means the ERNIE row when installed and falls back to Klein, exactly as the bakeoff note section 4 and `policy.ts` already do; Home adds no `ernie` value to the setting. |
| Videos | `generation.video_quality`. |
| Music | `generation.music.enabled`. |
| Voice | the existing voice choice setting under `engines.<role>.choice` (slice 1 confirms the key name; if none exists for the better voice, the slice adds it spec first). |
| Chat, Coding | `engines.<role>.choice`, as today. "Auto" shows as the recommended choice, labelled "Using Standard (automatic)". |
| Tool switches | installed or not installed is the value: the switch is "installed", so on = install, off = uninstall with the usual confirm. |

Pressing "Get and use Detailed" does two existing things in order: `componentsApi.install(row)` and the setting write. If the install
cannot start, the setting is not written. A setting that points at something not installed is allowed (it already is today) and the
card says "Chosen, not ready".

Disk plan changes this design needs (Stack, slice 1): the ERNIE row (added by the separate change) is the `need: "recommended"`
Quick row, the `video` row becomes `recommended` and `video-detailed` becomes `optional` (owner answer 3), and Klein's `pictures` row moves from `recommended` to `required` on tiers that make pictures, because edits and the
Quick fallback need it. Z-Image stays `optional`. The disk plan JSON is regenerated, not hand-edited.

## 5. Set everything to recommended and download

One button at the top: "Set everything to recommended and download".

Before it is pressed, the header shows the numbers it will act on, from `diskVerdict` with the recommended rows selected and
`missingOnly` true:

- "Download 62 GB. Free on this computer: 612 GB." (total of missing recommended rows plus the engine tools they run on.)
- Too small: "This computer has room for 4 of the 6 recommended choices. The Coding helper (20 GB) will be skipped." The button stays
  enabled and applies what fits; the skipped choices are listed with their reasons. If nothing fits, the button is disabled and the
  line says why and what to free ("Free up 20 GB first. Free up space can find about 28 GB.").
- Nothing to do: the button reads "Everything is set to recommended" and is disabled.

Press: a confirm dialog (kit AlertDialog) lists what changes: "Pictures: Detailed to Quick", "Voice: Standard to Better", "Download 62 GB".
Setting a card away from what the household picked is listed in plain words, so it is never a surprise. Confirm does, in one
server call: write each card's recommended choice (the setting) and start the missing installs.

- **Progress**: through the existing surfaces only (rule S6): the shell progress strip (`InstallStrip`, `/api/install`) and each
  card's own Progress bar. No new panel, toast or polling loop.
- **Safe to press twice**: the server starts an install only for a row that is not installed and has no running job; a second press
  returns the existing jobs ("Already downloading") and writes the same settings again with no change. Pressed after a partial
  finish, it downloads only what is missing.
- **It never removes anything.** Moving a card to its recommended choice leaves the old choice installed; it shows up in Free up space
  later. A choice this computer cannot hold is skipped, not forced.
- A video licence that needs a click (LTX) stops that one item at the existing licence prompt; the rest continue (`LicenceOverview`).

## 6. Free up space (clean up unused models)

A quiet button in the header, "Free up space", opens a Dialog (kit Dialog; a bottom sheet is the same Dialog at phone width).
Never automatic: Home never removes a model without this dialog and a confirm.

**What counts as unused** (all must hold; computed in `backend/src/lib/aiUnused.ts`, one function, also used to guard the delete):

1. Installed (`state: "installed"`), and `can_uninstall` is true.
2. No card currently selects it: not the current radio choice, and not a switch that is on.
3. Not in Always on: nothing with `need: "required"`, the chat model, the quick helper, memory search, listening, standard voice, search helper.
4. Not the editor and fallback (Klein) and not any engine tool another kept part depends on (`depends_on`, the engine rows).
5. Nothing running holds it: no active job, not loaded, `used_by` empty for live features (a video or picture job in the queue).
6. No saved style depends on it: a saved style (LoRA) needs its base model, so Z-Image stays "used" while a style that needs it exists, even when Quick is chosen. Styles themselves are never listed.
7. Also listed: leftover older versions of a model Home no longer uses, when the Stack can list them. If it cannot, the first version leaves them out.

Each row: plain name ("Detailed pictures"), size, a plain reason, a checkbox. Examples of reasons: "You use Quick pictures and no saved
style needs this.", "Replaced by a newer version.", "Not used since August." (`last_used_at`, `lastUsedWords`). Model names only
under Details. Top of the dialog: "You can free 52 GB." with "Select all" and the total updating as the person picks ("Free 33 GB").
Nothing is preselected except through the Select all button.

**Confirm step**: the primary button "Remove 2 and free 52 GB" opens a kit AlertDialog: "Remove Detailed pictures and Detailed videos? You
can get them back later. It is a download of the same size, 33 GB and 74 GB, and your settings stay." Below it: "Backups are not affected: they
hold your family's data and settings, and models are not part of them." (Slice 3 verifies this against `docs/BACKUPS.md` before the sentence ships; the line changes if it is wrong.)

**Removal path**: the existing `DELETE /api/components/:id` (`componentsApi.uninstall`), one id at a time, so its in-use guard
(`uninstall_block`) is the one guard. The server re-runs the unused test per id at removal time. A model that became used between
the list and the confirm is skipped and reported ("Detailed pictures is in use now, so it was kept"). The result line:
"Freed 33 GB. 1 kept because it is in use." A failure on one never stops the rest.

Empty: "Nothing to clean up. Everything installed is in use." (no button). Error: the destructive Alert with the next step.

## 7. States, edges, layouts

- **Loading**: each SettingsShell card (drawn by the shell from `areas.json`) holds Skeleton rows; no numbers until the list answers.
- **Stack unreachable**: the failing call's own response in the kit destructive Alert through `lib/failureCopy.ts` (rule S6, "a form or action failed"), with Try again; the cards show last known choices read-only. Stack health itself stays with Repairs and the Status page; chat paused or starting uses the existing chat state, not a new banner.
- **Not an admin**: the page is hidden by the existing `home.engine_admin` view gate; unchanged.
- **Install failed**: card row "Did not finish", Try again, the Repairs item exists (unchanged).
- **Disk getting low** (under `headroom_warn_bytes`): the existing verdict Alert of `PlanDiskSummary` (the green, amber or red check, section 8), shown under the header; no new line or banner. Its text adds "Free up space can find about X GB" when that is above zero.
- **Desktop (1440)**: header line and two buttons in one row; the cards stack in one column at the width the settings shell gives them. Home writes no grid (rule S4); a two-column layout would be an additive `SettingsShell` prop in `commons` first, and is not part of this design.
- **Mobile (390)**: one column; header line wraps, the two buttons stack full width; the per-choice action sits under the choice text, full width; Details is a tap target of at least the target minimum; no horizontal scroll.
- **Large targets** (`ease.targets`): rows grow with the kit token; nothing hard-coded.

## 8. First-run setup

The setup screen (`apps/setup/PlanStep.tsx`, `PlanDiskList.tsx`) uses the same cards. `shared/aiChoices.ts` takes the plan rows for
a tier, so setup and Settings show the same jobs, sentences, choices and Recommended marks. In setup a radio only changes the
selection set (nothing is installed until the install starts), the Recommended choice is preselected, and the card's action
button is hidden. The footer of `PlanDiskList` (total on disk, free space needed, the green, amber or red verdict) stays and is
extracted as `PlanDiskSummary` so both screens use one copy. The checkbox list is deleted from setup in the last slice, after the Settings cards ship and
are judged.

## 9. The other tabs

Nothing is deleted; the long list moves, and the experts keep their tools.

- **Overview**: the cards, the header, the two buttons. The old row list moves to Models.
- **Models**: keeps everything expert: every part with its name, MB, last used, used by, licence, the style (LoRA) list, Uninstall, "Model per job" choices and the memory view. Gains the moved list under the heading "All parts".
- **Engines**: keeps where the AI runs, the engines console, the engine link and credential, the Hugging Face token. Unchanged.
- **Advanced**: keeps the context size overrides, keep warm and the other tuning keys. Unchanged.
- **Coding**: keeps coding mode, people, limits. The Coding card on Overview only installs or removes the helper and links here.

## 10. Components (shipped kit Elements only, rule 9)

All from `@maipai/ui/src/...`; no `className` that changes shape, border, radius, shadow, background, padding, margin, size or layout, and
no Home wrapper around an Element. Colors follow the theme tokens.

| Need | Element |
|---|---|
| The seven cards and Always on | `SettingsShell` cards declared as data in `areas.json` (rule S4); the shell draws every frame. Each card body is a `view` named `AiJobChoices` that renders the Elements below directly and draws no box, frame or Card of its own (rule 9b: no `*Card`, `*Panel` or `*Wrapper` component) |
| Choice rows with a filled radio | `RadioGroup`, `RadioGroupItem`, inside `Field`, `FieldContent`, `FieldLabel`, `FieldDescription` (the kit choice-card pattern; PicturesLibrary already uses `RadioGroup`) |
| Fixed row and switches | `Item`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`, `ItemGroup`, `Switch` |
| Marks and chips | `Badge` (secondary for "Using Quick", outline for "Recommended") |
| Action | `Button` |
| Progress | `Progress` (as `ModelsAndStorageSection` does) |
| Details | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` |
| Messages | `Alert`, `AlertTitle`, `AlertDescription` |
| Confirm and Free up space | `AlertDialog` (confirms), `Dialog` (the list), `Checkbox` |
| Loading | `Skeleton` |

If a selected radio card lacks a visible selected look in the shipped kit, the fix is a prop or variant in `commons` first (own
worktree; Jesse says yes to the tag), never a Home class. The first slice-4 render checks this in the dev app before more is built.

## 11. Proof

Per UI slice: `bun run dev` in the worktree, sign in as the seeded owner, open `/settings/ai`, and open the screenshots myself at
1440 and 390 (`resize_window`): every card, one with a chosen-but-not-ready choice, one too-small choice, the progress state, the
Free up space dialog with two rows, and its empty state, then the setup step. Judged against: the current choice is obvious in one
glance, one Recommended per card, no model name outside Details, no horizontal scroll at 390, no em dash. Also
`cd frontend && bun run lint:ui-rules`, the page tests, and a test that fails if a model name or "MB" appears outside a Details block
(a string scan of the rendered card text).

## Where the settings live (owner ruling 2026-10-26, architect S4 and S5)

Jesse ruled 2026-10-26: the settings move to this page. Spec first, in `commons/spec`:

- `generation.picture_quality`, `generation.video_quality` and `generation.music.enabled` leave `household.pictures`. Each job card declares exactly one new group that holds only that job's keys (`household.ai_pictures` holds `generation.picture_quality`; likewise videos, music, chat, voice and coding), and that card's `AiJobChoices` body is the only thing that draws the group, so no default renderer runs for it. The Search and memory and Always on cards carry no group, like the link cards. The "Pictures, videos and music" card drops them (its other keys stay).
- The chat, voice and coding `engines.<role>.choice` rows leave "Model per job" (`household.ai_models`) and are placed only in their job card. "Model per job" keeps the roles that have no job card.
- The seven job cards and Always on are declared in `areas.json` as `SettingsShell` cards, each body the `AiJobChoices` view for one job. Card titles and sentences are `areas.json` card copy.
- Switches that set no setting (picture tools, picture naming, Chat can look at pictures, Coding helper, Standard voice) carry their label and description as per-choice card copy in the same `areas.json` card, read through the spec copy helper. Neither `aiChoices.ts` nor the view holds them.
- The landed interim copy (`AI_COPY`, card summaries, `SHORT_WORDS`, `PLAIN_ROW_NAMES`, `JOB_WORDS`) is deleted when the spec tag is pinned. The landed frames (section, heading and summary in `AiJobChoices`, the Always on box and the button row in `AiOverview`) and the 2 s and 30 s refetch loop go too: choices refresh when the `/api/install` job list `InstallStrip` reads changes. The Stack-unreachable message goes through `lib/failureCopy.ts`. The Search and memory card renders its one line and the link.
- A view-bodied card is a new spec card kind; if the kit's settings renderer must draw its frame, that is a `commons` change first (rule 9c), named in slice 5.
- A new `commons` spec tag needs Jesse's yes in that turn.

## Supersedes

- SETTINGS-IA-04's line that the 13 `engines.<role>.choice` rows live in the Model per job card: the chat, voice and coding rows move to the job cards, and the three `generation.*` keys leave the Pictures, videos and music card.
- The flat checkbox list as the Overview (`ModelsAndStorageSection` Overview use and `InstallPlanSection` in Settings): replaced by the cards; the list lives on as "All parts" in Models.
- The "Install the recommended extras" button (LICENCE-ACK-01 `installExtras`) on the licence prompt and its use as a second way to get recommended parts: the new button replaces it as the one way (the licence acceptance itself stays; `install.recommended_auto_on_upgrade` keeps its meaning and is read by the new button's list, not duplicated).
- `video-generation-2026-10-17.md` section 15 and VIDEO-LTX-07 (owner ruling 2026-10-17, Detailed video Recommended on 128 GB): replaced by owner answer 3 (2026-10-25). Quick video is recommended, `video-detailed` is optional, and the Recommended free-space figure for that tier and the setup default change with it. The sizes in the examples above are illustrations; slice 1 recomputes them from `diskVerdict`.
- In setup, `PlanDiskList` as a checkbox list (its footer stays).
- Nothing in the image-model decision (ERNIE Quick, Klein edits, Z-Image Detailed), the values and meaning of `generation.picture_quality`, the Pictures page, or any rule.

Fits inside SETTINGS-IA-04 (the household AI and models page structure and its summary strip); no item covers job cards, set-to-recommended or cleanup of unused models.

Reuse check: reuses `diskPlan.json` and `diskPlanMath.ts` (`diskVerdict`, `selectionTotals`), `componentsApi` (install, uninstall and its
in-use guard), `ComponentRow`, `lastUsedWords`, the existing settings `generation.picture_quality`, `generation.video_quality`,
`generation.music.enabled` and the `engines.<role>.choice` keys, the Pictures page's Quick/Detailed pattern and Details, `InstallStrip` for
progress (rule S6), the licence prompt, and the kit Elements in section 10. New: `shared/aiChoices.ts`, `aiUnused.ts`, the apply
and cleanup routes, and the card views. No new setting, status surface, store or engine.

## Decisions (Jesse's answers, 2026-10-25, closing the open questions)

1. Set-to-recommended does change a choice the household already made (Detailed pictures to Quick); the confirm dialog lists those changes first, before the download size.
2. Klein, the editor (about 16 GB), is always on (`required`), as section 4 says.
3. Quick video is the recommended video. Detailed videos with sound (74 GB) stay one click away on the Videos card, marked not recommended, so the one button no longer downloads it.

No open questions remain.

## Build slices

Backend data first. Each slice is 1 to 3 files with its test; Codex or the local lane per the routing order, the dispatcher reads each diff.

1. **AIMODELS-DATA-01**: `shared/aiChoices.ts`, `shared/aiChoices.test.ts`, and the Stack disk plan data (regenerated `shared/diskPlan.json`: Klein required, `video` recommended, `video-detailed` optional). Pure function: plan rows, component rows and settings in; cards out (choices, current, Recommended, state, size, blocked reason, Details, Always on sum). Tests per tier p16 to p128, ERNIE row present and absent, a too-small choice, the picture mapping to `generation.picture_quality`. Also the Stack plan edits (Klein required) via the generator, if the separate ERNIE change has landed.
2. **AIMODELS-UNUSED-01**: `backend/src/lib/aiUnused.ts`, `backend/src/lib/aiUnused.test.ts`. The seven-point unused rule and its plain reasons. Tests: each exclusion (always on, selected, Klein, engine dependency, running job, saved style) and the leftover-version case.
3. **AIMODELS-ROUTES-01**: `backend/src/routes/aiChoices.ts` (+ its test). `GET /api/ai/choices`, `GET /api/ai/unused`, `POST /api/ai/choices/:job` (install then setting), `POST /api/ai/recommended` (idempotent, never removes), `POST /api/ai/cleanup` (per-id guard re-check, partial results). Owner and admin only. Risky surface (deletes data): `code-review` at medium. Checks the backup sentence against `docs/BACKUPS.md`.
4. **AIMODELS-CHOICES-01**: `frontend/src/apps/settings/AiJobChoices.tsx`, `AiJobChoices.test.tsx`, `frontend/src/lib/aiChoicesApi.ts`. The one card-body view (no frame, no wrapper name) (radio and switch variants, every state in section 7). Dev app render at 390 and 1440 opened and judged before slice 5.
5. **AIMODELS-PAGE-01**: `commons/spec` `areas.json` cards for the seven jobs and the Overview tab, plus the `copy.options` and card copy of section 3 (spec first; needs Jesse's yes for a tag, then the pin), `frontend/src/apps/settings/AiOverview.tsx` (header, summary, recommended button and confirm), `settingsViews.tsx` registration, and moving the old list into Models. Tests: page test, tab redirect test, no model name outside Details.
6. **AIMODELS-CLEAN-01**: `frontend/src/apps/settings/FreeUpSpaceDialog.tsx` and its test. List, select all, confirm, partial result, empty state.
7. **AIMODELS-SETUP-01**: `frontend/src/apps/setup/PlanStep.tsx`, `PlanDiskSummary` extracted from `PlanDiskList.tsx`. Setup uses the same cards from `aiChoices.ts`; delete the checkbox list. Screenshots of the setup step at both widths.
