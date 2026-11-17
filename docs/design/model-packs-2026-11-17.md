# Model packs: the Stack knows each model, Home asks for generic jobs (2026-11-17)

Status: proposed, for the architect and then the owner's sign-off; no code before both. First verdict REJECTED 2026-11-17 (C10 minor wording, W1 text-capable retry, E6 fallback wording, S6 readiness, the `pack.json` and `PACK-*` name clash with companion packs); second verdict REJECTED the same day on two sentences (chat rule 6: a stored line handed to the model; S6: the AI card read readiness twice) and wording; third verdict REJECTED on one leftover priority-2 sentence and the music slice of HOME-PARTS-04; fourth verdict APPROVED 2026-11-17 (MODELPACK-NOTE-03) and fifth APPROVED (MODELPACK-NOTE-04); their wording points (the `text` capability, a `description` field apart from exact `words`) are folded in here. Owner idea (Jesse, 2026-11-17, relayed in chat): a model's quirks, limits, prompt wording, reference counts and the way a character sheet, a swap or a contact sheet is built on it live in the Stack, one pack per model, as data plus recipes with a small code adapter only when data cannot say it. Home asks for generic jobs ("a character sheet of this person", "swap this person into this clip", "a contact sheet") and never names a model. Retiring a model is deleting its pack; Home does not change. This follows the 2026-11-16 ruling that the Stack owns all model data and actions ([stack-home-catalog-separation-2026-11-16.md](stack-home-catalog-separation-2026-11-16.md), rules E1 to E6).

Evidence: [model-packs-audit-2026-11-17.md](model-packs-audit-2026-11-17.md), one row per Home file with a Stay or Move verdict (38 Move, 10 Stay, 9 label only).

## Supersedes

- [h3-character-sheet-2026-11-16.md](h3-character-sheet-2026-11-16.md) section 3 ("Stack: an image job `POST /v1/images/sheets`"): the sheet is the generic `character_sheet` job of section 3 below, and the eight-panel prompt, the five-frame trick and the 1024x1024 size are the MiniMax H3 video pack's recipe for it. H3-SHEET-STACK-01 is replaced by MODELPACK-SHEET-01; H3-SHEET-HOME-01 by MODELPACK-HOME-01; H3-SHEET-BENCH-01 stands. The Home fallback builder (`films/sheetMaker.ts`) stays, as that note's Supersedes section says (port before delete); the 768x448 constant in `films/referenceSheet.ts` is deleted by MODELPACK-HOME-01 once the fallback builder reads the sheet's pixel size from the catalog's `clip_from_sheet` limits (the catalog serves each shape's pixel size, section 4).
- [h3-swap-2026-11-16.md](h3-swap-2026-11-16.md) section 2 ("Stack route: `POST /v1/videos/swap`") and the `h3_swap` status entry: the route stays until Home's swap caller moves (MODELPACK-HOME-01), then it is deleted with the `qualities.h3_swap` entry, by the clean-break rule. The engine, the pins, the measured peaks, the one-at-a-time rule and the Max-only rule are unchanged and become the H3 pack's `swap` recipe and limits. CREATOR-57 and CREATOR-57-LIVE-01 are not changed by this note.
- [stack-home-catalog-separation-2026-11-16.md](stack-home-catalog-separation-2026-11-16.md) section 3, last sentence ("This list replaces the Stack's separate lists of models, the model catalog, components, tier candidates, capabilities and the install plan"): the jobs catalog of section 4 below is the one read that replaces `GET /stack/v1/image`, `GET /stack/v1/video` and `qualities.*` as the capability source; the parts list stays what it is. Section 2's part record gains one pointer, `pack` (the pack id and version), and nothing else.
- Backlog row HOME-PARTS-04 ("no model identity in control flow"): replaced by MODELPACK-HOME-01 to 05, which are its slices (video, pictures, companions, styles, music) with the same exit; its row is closed when the five land, and no second row stays open for the same result. The lint is written by MODELPACK-HOME-01, widened by each later slice, and MODELPACK-HOME-05 makes it repo-wide.
- [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md) section 3 (the LTX-2.5 size table in Home's `quality.ts`) and [ltx-desktop-features-2026-11-06.md](ltx-desktop-features-2026-11-06.md) LTXD-18B (the `ltx-2.3` tested-on-2.5 rule in Home): both tables move into the LTX packs; the rules themselves stand.

Nothing about a child's or teen's protection changes. Rule 0, rule E6, the minor's list and Home's lane check stay as they are until VIDEO-WAN-REMOVE-01; a pack never widens an audience.

## Reuse check

Reuse check: everything below extends what exists. The part record and parts list (PARTS-SPEC-01, PARTS-API-01, `stack/backend/src/lib/partDefs.ts`); the Stack's job queue, heavy gate, admission and results (`lib/jobs.ts`, `lib/heavyGate.ts`, `video/results.ts`, `images/results.ts`); the existing per-model tables that already are packs in all but name: `images/models.ts` (`IMAGE_FAMILIES`, `referencesMaxFor`), `video/videoGen.ts` (`VIDEO_SPECS`), `video/ltx25.ts` (the measured size table), `video/swap.ts` (`H3_SWAP_MAX_SECONDS`, `H3_SWAP_SEGMENT_FRAMES`, the swap prompt), `video/h3.ts`; the licence acceptance store; Home's one video edit job (`startVideoEditJob`), `resolveCast`, the cast's face-marked references, the creation record and Activity text. What is new: one pack record shape in `spec`, one pack folder per model in the Stack, one jobs catalog read, one generic job route, and the deletion of every Home copy the audit marks Move.

Searched before writing (names tried in all repos: pack, recipe, preset, profile, family, capability, adapter): the Stack's `IMAGE_FAMILIES` and `VIDEO_SPECS` are the closest thing and are folded in, not duplicated; `commons/spec/media_template` is a Home-side template for people, not a model recipe, and stays. The word pack is already taken by companion packs (PACK-01, the `pack.json` schema in `@maipai/spec`), so this record is `StackModelPack` in `model-pack.json` and its rows are `MODELPACK-*`; the two share nothing.

## 1. The line, one step further

| Owner | Owns | Never holds |
|---|---|---|
| Stack | every model's pack: limits, shapes, reference counts, prompt recipes, field names, quirks, the adapter when one is needed; which pack serves a job; the plain lines about a job (what it takes, why it cannot run here) | people, age, households, wording about a person, their age or their household |
| Home | the generic job list, the person's inputs (words, photos, a clip, a cast member), the gates, the lines about the person (gates, redirects, their own records), drawing the result and the words the Stack sent to print | a model id, a size in pixels, a step count, a reference count, a prompt template written for one model |

A Home request names a job and its inputs. It may name a `part` only with an opaque id the Stack gave it: the household's order (rule E5, the priority-1 and priority-2 ids of the separation record's section 4), or the catalog's `alternatives[]` for "try it with X" and the retries of chat rules W4 and MODEL-RETRY-01. It never holds a model id in its source to make a feature work. A Home refusal or hint is built from the catalog's words and numbers, never from a constant.

## 2. A pack

A pack is the Stack's knowledge of one model, kept beside its part row, in `stack/backend/src/packs/<part-id>/`:

- `model-pack.json`, the data: validated at boot against `StackModelPack` in `spec` (MODELPACK-SPEC-01). A Stack with an invalid pack does not start, and the test suite loads every pack.
- `recipes/<job>.md`, one prompt recipe per job the model serves, as a template with named blanks (`{description}`, `{references}`, `{panels}`) and a short "measured on" note. Plain files so a change is a diff anyone can read.
- `adapter.ts`, only when data cannot say it: chaining a long clip from segments (H3 swap), laying the source sound back, taking frame 0 of a frozen five-frame clip as the sheet. An adapter implements the one `JobAdapter` interface (prepare inputs, build the runner command, read the result) and is at most a few hundred lines; an adapter that grows a second model's branch is a second pack.

`model-pack.json` holds:

| Field | What it says |
|---|---|
| `id`, `version`, `part` | the pack id, its version, the part row it belongs to |
| `jobs` | one entry per job the model serves: `limits` (max seconds, max references, shapes with their pixel sizes per level, max words, steps fixed or not), `audiences` (derived from the part row's `adult_only`, never stored twice: a job on an adult-only part is adult only; a pack may only narrow it further, for a job whose output cannot be checked for a minor yet, rule E6), `capabilities` (`text`: spells words, chat rule W2's `text: true` mark, so W1's text-capable model is the part whose pack says so; `end_picture`; `sound`; `keeps_likeness`), `recipe` (the recipe file; for `picture` and `picture_edit` it carries W2's words addendum and W5's quoting), `adapter` (the adapter's job hook, if any), `peaks` (measured memory per shape, marked measured or unverified) |
| `style_bases` | the style (LoRA) base ids this model takes, their labels and browse patterns, and a retired base with its bench mark (today's `ltx-2.3` tested-on-2.5 rule) |
| `field_map` | how the generic job inputs map to the runner's own argument names |
| `notes` | plain lines a person may read through the catalog ("Photos that show the face clearly give the best likeness") |

What a pack never holds: an age rule, a household's choice, a person's words, a download link (that is the part row).

## 3. The generic jobs

Each job has one request and one result shape in `spec` (MODELPACK-SPEC-01). Inputs are media ids the Stack already holds (uploads go through the existing upload route first) and plain fields. `description` is what to make; `words` exists only on the picture jobs and holds only exact words to spell (W3), so a picture with no exact words never needs a text-capable part. Every request carries `audience` and an optional `part`; nothing else names a model.

| Job | Request | Result |
|---|---|---|
| `picture` | `description` (the scene, in the person's or the model's words), `words` (only exact words to spell, chat rule W3; absent when there are none), `shape` (landscape, portrait, square), `level` (standard, boost, max), `count`, `styles[]`, `seed` | pictures |
| `picture_edit` | `picture`, `description`, `words` (exact words only), `references[]`, `mask`, `level`, `styles[]` | pictures |
| `clip` | `description`, `shape`, `level`, `seconds`, `start_picture`, `end_picture`, `styles[]`, `seed` | a clip with sound or without, as `made_with.sound` says |
| `clip_from_sheet` | `sheet`, `description`, `shape`, `level`, `seconds` | a clip |
| `restyle` | `clip`, `restyle` (a name from the catalog), `description` | a clip |
| `swap` | `clip`, `references[]` (the cast member's face-marked photos, in order), `description`, `start_seconds`, `seconds`, `level` | a clip with the source sound laid back |
| `character_sheet` | `references[]`, `description`, `kind` (person, object, pet), `level` | one picture, with `panels[]` naming what each panel shows |
| `contact_sheet` | `references[]`, `description`, `count`, `level` | one picture of `count` tiles, with `tiles[]` |

The result shape is the existing job pattern (job id, state, progress, cancel, result files, poster) plus `made_with`: the part id, its label for this audience, the pack version, the shape and seconds actually used, `sound`, and `notes[]` (plain lines the Stack wants the person to see, such as a shortened clip and why). Home stores `made_with` in the creation record and shows it under "How it was made"; it never reads it to branch (rule E2).

A `picture` or `picture_edit` request with `words` is served only by a part whose pack has `capabilities.text` (chat rule W1); the retry of W4 names the next part with `capabilities.text` in the household's order after the one that ran (priority 2 when it has it), and when no text-capable part is on, nothing starts and the adult catalog's `why_not` says so (W1). For a minor with `words` and no text-capable part in the minor's list: when the cause is access (an adult-only part would do it) the minor catalog's `picture` entry simply lacks `capabilities.text` and Home redirects as C10 says; when nothing is installed for anyone, the system line of rule W6 applies, as today.

A job that the person's inputs do not fit is refused before it starts, with one code and one plain line: `too_many_references` (the line says the number the model takes), `too_long` (the ceiling), `shape_not_served`, `level_not_served`. The Stack never silently drops a reference or shortens a clip without a `notes[]` line.

## 4. The jobs catalog: what can be made here, now

One read, `GET /stack/v1/jobs/catalog?audience=adult|minor`. The adult catalog lists every job in section 3. The minor catalog lists only the jobs some part in the minor's list serves, with neutral labels, and carries no `why_not` and no `alternatives[]`: a job a minor may not have is absent, never explained (rule C10). For every job listed: `available` (true when an enabled, installed part in the household's order serves it for this audience and fits), `part` (the id and label that would serve it, or null), `limits` (max seconds per level, max references, shapes with their pixel size per level, levels, max words), `capabilities`, `styles` (bases and max per job), `restyles[]` (names and labels), `why_not` (adult catalog only; a plain line when `available` is false for a system cause: "No video model that can swap a face is turned on. An admin can add one in Settings, AI and models."), and `alternatives[]` (other parts in this audience's list that serve the job, ids and labels, so Home can offer "try it with X" from words the Stack gave).

Home reads this instead of `GET /stack/v1/image`, `GET /stack/v1/video` and the `qualities.*` tree. Readiness stays in one place (rule S6): the catalog's `available` for `picture` and `clip` feeds the `image` and `video` rows of `lib/roleHealth.ts`, and every surface, the AI card's readiness lines included, keeps reading those rows and the parts list's `state`; the catalog is the source for capabilities and limits only (level hints, the Max entry, base pills, Capture the look), never a second readiness read, and no client recomputes it. The Create page's level hints, the video Studio's Max entry, the style picker's base pills, "Capture the look": all are drawn from it. The read is from memory and starts nothing; it changes when parts, choices or the budget change, and the Stack's event feed announces that.

## 5. How a job picks and loads its pack

1. The audience gate ran in Home (rule 0). The request arrives with `audience` and maybe `part`.
2. The Stack picks the part. An adult's job: the named one, if it serves the job; else the first enabled part in the household's order (PARTS-ENABLE-01) that serves it; else the shipped priority. A minor's job: the named one, if it is in the minor's list and serves the job; else the first part in the minor's list, by shipped priority, that serves it; it never reads the household's order (separation record section 3, rule E6, unchanged). A request with `words` skips any part without `capabilities.text` (W1).
3. The pack is already in memory (loaded and validated at boot, keyed by part id). The job entry gives limits; the inputs are checked (section 3 refusals).
4. Fit and memory: the pack's `peaks` for the chosen shape go to admission and the heavy gate as today.
5. The recipe is filled from the inputs and the pack's `field_map` turns them into the runner's arguments; the adapter, if any, runs its hooks around that. The runner is the part's engine part (`runner` on the part row); the Stack starts it as it does now.
6. The result is written in the generic shape with `made_with`.

No step reads a model name in a route or a shared library. The only code that knows a model's name is its pack folder.

## 6. "Not available on this model"

Three cases, each one line a person can act on, in the Stack's words, drawn by Home as it draws every refusal (rule S6 surfaces unchanged):

- **No part serves the job for this audience.** For an adult the catalog says `available: false` with `why_not`; Home draws no action for it on a page and prints `why_not` there. In chat the tool tells the model only the kind of failure (not available here) and the next step (an admin adds a model in Settings, AI and models), and the model says it in its own words (chat rule 6); no stored line is handed to it. For a child or teen the job is absent from the minor catalog, Home draws nothing, and a direct request gives the chat tool "nothing suitable" so the model redirects in its own words, never a line that says the thing is missing or filtered (rule C10, chat rule 6).
- **The chosen part does not serve it**: an adult's request naming a `part` that lacks the job gets 409 `not_on_this_model`, the line "That model cannot swap a face. Home can use <label> instead." and `alternatives[]`. A page shows the line and, where a card exists, the alternatives by the labels the Stack sent; through a chat tool the model gets the kind (not on this model) and the alternatives' labels, and says it in its own words (chat rule 6, as the model-choice record handles a `with` key that is not installed). A minor's request naming a part outside the minor's list is refused as today (PARTS-API-01's contract), with no model named.
- **The inputs do not fit the part**: the section 3 refusals, with the number in the line.

Every result from the generic route passes the same release choke point as today (rules C5 and C6, chat rule 10): no row below moves a caller before the adult Prohibited check and the minor's ceiling run on its output exactly as now. A child or teen never sees a model name or a filter notice in any of these: the minor's catalog carries neutral labels and no reasons, as the parts list does.

## 7. Retiring a model

Delete the part row and its pack folder in one Stack commit; the boot test fails if a recipe, a style base or a `requires` still points at it. Home does not change: a stored part id that is gone is "not found" and the default applies (clean break, section 11 of the separation record); a creation record keeps the label it stored in `made_with`. A style whose base was retired reads `compatible_with` empty from the Stack and is shown as "needs a model that is no longer here", from the Stack's `why_not`.

## 8. Migration order

Each row deletes what it replaces in the same landing (section 11 of the separation record). Stack rows land and ship before the Home row that stops calling the old route; a Stack row that deletes a route lands together with that Home row.

1. **MODELPACK-SPEC-01** (commons): `StackModelPack`, the eight job request and result shapes, the catalog shape. Spec tag.
2. **MODELPACK-STACK-01** (Stack): the pack folders for the parts that exist today (pictures, video, and the music parts `lib/music/stack.ts` names), built from the tables the reuse check names, with a parity test that every limit, size, peak and reference count equals today's constants; the boot validation; `pack` on the part row.
3. **MODELPACK-JOBS-01** (Stack): the jobs catalog and the generic job route for `picture`, `picture_edit` and `clip`, as a second door to the existing runners (additive; the old routes stay until their Home callers move).
4. **MODELPACK-SWAP-01** (Stack): `swap` as a generic job on the H3 pack, additive beside `POST /v1/videos/swap`. Only after CREATOR-57-LIVE-01 is done, so the shipping sessions are not disturbed.
5. **MODELPACK-SHEET-01** (Stack): `character_sheet` on the H3 video pack (the recipe from the character-sheet note) and `contact_sheet` on the H3 picture pack; a real run of each judged by eye. The Home cut-out builder stays the fallback while the catalog says `available: false` or `keeps_likeness` is unmeasured.
6. **MODELPACK-HOME-01** (Home, after the owner's sign-off on this note and rows 1 to 5): the swap caller and "Capture the look" move to the generic jobs; `stackSwap.ts`, the `h3_swap` read and the three-photo constant are deleted; `lint:no-model-names` is added for the video edit and films folders. Then the Stack deletes `POST /v1/videos/swap` and `qualities.h3_swap` in the same landing.
7. **MODELPACK-HOME-02** (Home): pictures (the `PICTURE_MODEL` constant and every `model:` field, companion stills, `imageEdit.ts` references); `TEXT_CAPABLE_MODELS` is replaced by the catalog's `capabilities.text`, and the W4 retry names the next text-capable part in the household's order after the one that ran (section 3). Then the Stack deletes `GET /stack/v1/image` and `POST /v1/images/*` as capability and job routes.
8. **MODELPACK-HOME-03** (Home): video create, companions, the Studio levels, restyle, `clip_from_sheet`, the LTX size tables and `VideoMaker`; the last thing it removes is nothing of the minor lane (that waits for VIDEO-WAN-REMOVE-01). Then the Stack deletes `GET /stack/v1/video` and `qualities.*`.
9. **MODELPACK-HOME-04** (Home): style bases from the packs (`baseFamilies.ts`, the `ltx-2.3` rule, the frontend base pills).
10. **MODELPACK-HOME-05** (Home): music (`lib/music/stack.ts` names `htdemucs` and a `max_model`; the stem and song jobs become generic jobs on the music packs); `lint:no-model-names` becomes repo-wide and HOME-PARTS-04 closes.
11. **MODELPACK-RETIRE-01** (Stack and Home test): delete a test pack in a test Stack; the Home suite passes unchanged and the catalog shows the job gone with `why_not`.
12. Voice and chat packs: later, their own note (the audit's section 6).

Coordination while rows 1 to 5 land: the engines session (queue system and engines) owns `lib/jobs.ts`, admission and the governor; the pack rows add a caller, not a queue change. The creator-video and creator-pictures sessions own the swap, contact sheet and template files in Home; no pack row touches a Home file before row 6, and row 6 starts only after the owner's sign-off and after their swap and contact sheet work is landed.

## 9. Stack release steps for a pack change

1. Edit the pack folder (data, a recipe, or the adapter); the parity or snapshot test beside it updates in the same commit.
2. `scripts/wt.sh check` (the boot validation loads every pack; the contract tests run the catalog for both audiences).
3. Regenerate `docs/api/openapi.json` when a job or catalog shape changed; land on Stack `main`.
4. A new or retired model: a new spec tag is not needed (the shapes do not change); the part row and pack land together.
5. Home pins the Stack commit with `bash scripts/pin.sh stack <sha>`; the pair ships with `bash scripts/ship.sh` on the owner's word. A pack-only change needs no Home change at all: that is the point.

## 10. Risks

1. **The contact sheet and swap are being shipped now by other sessions on the old routes.** The additive order above (new door first, callers move only after sign-off and their landing) keeps them working; the cost is two doors for a few days.
2. **An adapter grows into a second engine.** The `JobAdapter` interface has three hooks and no access to the queue or other packs; a review rejects an adapter that branches on another model.
3. **A generic shape loses a model's best feature** (H3's sixteen references, LTX's end picture). `limits` and `capabilities` carry them per pack, and the catalog shows them, so Home can offer what this model does without naming it.
4. **The minor lane.** No pack row moves a child or teen protection; `audiences` in a pack is checked against the parts list's `adult_only` by a test, and the lane check in Home stays until VIDEO-WAN-REMOVE-01.

## 11. Backlog rows

For `docs/BACKLOG.md`, "Catalog data, Stack actions, Home people", after HOME-PARTS-05. HOME-PARTS-04's objective gains one line: "Done by MODELPACK-HOME-01 to 05; closed when they land."

- **MODELPACK-SPEC-01: the model pack record and the generic job shapes** (M, commons). Exit: fixtures for a pack with an adapter and one without, for every job request and result, and for the catalog; a spec tag.
- **MODELPACK-STACK-01: one pack per installed model, parity with today** (M, Stack). Exit: every limit, size, peak, reference count and style base equals today's tables (parity test, written first); a Stack with a broken pack refuses to start.
- **MODELPACK-JOBS-01: the jobs catalog and the generic job route** (M, Stack; additive). Exit: both audiences' catalogs in contract tests (a minor's holds no adult label, no adult-only job, no `why_not` and no `alternatives`); a minor's job never reads the household order (test); a request naming a part that lacks the job gets `not_on_this_model` with alternatives; `picture`, `picture_edit` and `clip` make the same files as the old routes on a fixed seed.
- **MODELPACK-SWAP-01: swap as a generic job on the H3 pack** (S, Stack; after CREATOR-57-LIVE-01). Exit: a real swap through the new route equal to the old one; the old route untouched.
- **MODELPACK-SHEET-01: character and contact sheets as pack recipes** (M, Stack). Exit: a real character sheet from three messy photos and a real contact sheet, each opened and judged; `keeps_likeness` measured with the face check.
- **MODELPACK-HOME-01: Home's swap and "Capture the look" ask for generic jobs** (M, Home; after the owner's sign-off; lands with the Stack's deletion of the swap route). Exit: the same behavior tests; `lint:no-model-names` green on `lib/videos/edit*`, `lib/films`; no `h3` string in Home source.
- **MODELPACK-HOME-02: pictures ask for generic jobs** (M, Home). Exit: no `PICTURE_MODEL`; a picture with words runs only on a text-capable part and the W4 retry goes to the other one (the existing W1 to W5 tests pass); `lint:no-model-names` widened to `lib/pictures`, companions.
- **MODELPACK-HOME-03: video create, companions and the Studio ask for generic jobs** (L, Home, split by feature). Exit: the LTX tables and `VideoMaker` deleted; the child and teen video tests unchanged.
- **MODELPACK-HOME-04: style bases from the packs** (S, Home). Exit: `baseFamilies.ts` deleted; the style pages draw bases from the backend.
- **MODELPACK-HOME-05: music asks for generic jobs** (M, Home; after MUSIC packs exist in MODELPACK-STACK-01). Exit: no model name in `lib/music`; `lint:no-model-names` runs on all of `backend/src`, `shared` and `frontend/src` and is green; HOME-PARTS-04 closes.
- **MODELPACK-RETIRE-01: retiring a model changes nothing in Home** (S, Stack and Home). Exit: the test of section 7.
