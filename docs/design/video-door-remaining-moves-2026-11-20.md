# The rest of VF-DOOR-01: what still uses the old door, and the order to move it

Status: amended 2026-11-20 after the architect rejected the first version (VF-DOOR-REMAINING-01). Proposal, no code. For the architect again.
Written after Max, extend, retake, another take, film shots and the identity route moved onto the Stack's generic make door.
Rules in play: 0, 10, E2, E6, E7, C3, C8, C10, C11 in [RULES.md](RULES.md). The child and companion moves are audience gates: nothing is built in those paths before the architect and a review.

## Supersedes

This note changes the approved [video-film-pipeline-2026-11-20.md](video-film-pipeline-2026-11-20.md) in four places:

- Section 3.1 ("What Home sends"): `inputs[]` gains the roles `object` and `place` (reference clips, B3), and the identity face check moves from Home code to a Stack face role that returns pass or fail (B3). Home still decides when a check is required and keeps the copy.
- Section 3.2 ("What a pack declares"), Negations row: "none" stays true for the packs' prompts. The child recipe (B2) adds, per pack, a typed list of words the pack avoids, keyed by rating. For an engine that has no negative prompt the list is expressed as positive scene words by the pack's recipe, never as a negation (rule 7 holds).
- Section 3.5 rules 4 and 7: rule 4 (one prompt per engine from the same shot) now also covers the companion take and the child recipe, as pack recipes selected by operation and rating. Rule 7 is unchanged and is the reason `prompt_mode: verbatim` and caller negative words from the first version of this note are dropped.
- The gate-gap table in section 4 gives "composed first pictures skip `gateFinished`" to VF-ROUTE-01 and VF-CAST-01. VF-ROUTE-01 closed it for the identity route (the derived picture is gated). The reference clip's composed picture is closed by B3 of this note, not by VF-CAST-01.

Not superseded: the receipt (3.4), the planner and admission (3.3), the identity route as built, and "Home names no model".

## Reuse check

Searched 2026-11-20 in Home and Stack (names tried: companion, take, recipe, operation, restyle, reference, ingredients, face, gate, minor, child, negative, cartoon, prompt writer, rating).
Extended, not duplicated:
- The Stack's operation switch in `lib/clipRoute.ts` and `lib/makeDispatch.ts` (`clip_film_shot`, `retake_from`, `extend`): the companion take, restyle and reference clip are three more operations through the same planner, with rows in the same pack data.
- The Stack's prompt writer `video/promptWriter.ts` and the pack `recipes/` folders (VF-PROMPT-01): the companion and child wording become recipes there.
- The Stack's face code (`liveportrait`, the face models Home reaches today through `firstFrameTools`) and `media.verify` checks: the face role reads the same models.
- Home's `gateFinished` (`pictures/laneGate.ts`), `deriveStart.ts` and `doorClip.ts`: the reference clip reuses the derive step and the door; no second gate.
- Home's rating and audience helpers (`laneOf`, `stackAudienceFor`, the household ceilings of C3): the child path sends them, it adds none.
New: one operation each for the companion take, restyle and reference clip; a face role; a rating-keyed child recipe with its catalog flag. Nothing adds a second queue, store, model table or gate.

## A. The legacy first-picture code: who still calls it

`lib/videos/referenceFirstFrame.ts` (315 lines), `firstPictureCompose.ts` (149) and `firstPictureHarmony.ts` (82) have exactly one production caller: `lib/videos/referenceVideo.ts`, the `make_reference_video` tool (REFVIDEO-01), reached from `turnMachine/nodes/tool.ts` and from the Another take route in `routes/videos.ts`. Their tests are `referenceFirstFrame`, `firstPictureCompose`, `firstPictureHarmony` and `referenceVideo`.

Checked and not callers: companion takes (`companionTakes.ts` draws its start picture elsewhere), films (`films/sheetViews.ts` has its own drawn views), edits (continue uses the Stack's frame op), the old door's start-picture path in `videos/tool.ts` (it takes a stored picture as it is).

Does the generic route now cover the reference clip? No. What it covers: one person's picture as an `identity` input, the Stack's typed `needs_start_picture`, one derived first picture through `gateFinished`. What `make_reference_video` does that it does not:

| Behavior a person has today | On the generic route? |
|---|---|
| Several attached pictures: people, objects and places read by role | No: only `identity` (one person) and `wardrobe` exist as roles |
| Up to two people cut out and placed in one scene (sharp placement with masks, then a harmonize pass) | No: the route draws one person into a blank canvas |
| Face gate on each person against their photo (SFace, `FACE_GATE` 0.5) and a re-draw when it fails | No |
| After the clip: faces measured over six frames and the "may not look like the photo" line (`LOOK_ALIKE_LINE`) | No |
| The sheet route: one reference sheet shown on the card, then the Stack's Ingredients adapter at Max (`POST /v1/videos/ingredients`) | No: the door has no Ingredients operation |

So nothing is deleted yet. All three files stay, with their tests, until the reference clip moves (B3), and then only after each of the five behaviors above has a Stack test and a Home test (port before delete).

One gap this code carries today and the move must close: its composed first pictures skip `gateFinished` (listed in the video and film pipeline note, gate gaps). The generic route already gates its derived picture, so moving the reference clip closes it.

## B. The moves left, in the order to build them

Principle for every move: Home sends the request in plain words and generic fields (audience `minor` or `adult`, a rating level, a loop, the quiet window, typed inputs). The Stack's pack holds every word of recipe and every list of words to avoid, selected by an operation or by the rating. Each move deletes the Home code that picks or tests a model (E2) and that builds a prompt for one (E7). The old door stays the fallback, so an older Stack or a refused request behaves as today.

### B4. Restyle (first)

Restyle posts to its own route today (`submitVideoRestyle`). It needs the Stack's operation `restyle` with the clip as the `edit_source` input, the style id and a strength, the same shape extend and retake took. Adult and Max only, so no audience change. Home keeps the range checks and the refusal lines it has now. The move deletes the model name `ltx25-max` and the style add-on file from `submitVideoRestyle` and `restyleBody` (`videos/stack.ts`, `videos/editPlan.ts`): Home sends the clip, the style id, the strength and the words, and the Stack's pack picks the model and the add-on (E2, E7). Stack row: VF-RESTYLE-OP-01 (spec first). Test: the existing restyle tests run with the door switched on (`MAIPAI_TEST_DOOR=1`), and a door test that a catalog without the keys sends it to the old door.

### B1. Companion takes

What Home sends today (`companionTakes.ts`, `companionArt.ts`): a prompt built from the companion prompt pack, a fixed words-to-avoid list (`TAKE_NEGATIVE_PROMPT`, `PACK_TAKE_NEGATIVE_PROMPT`), the clip size from a model-keyed table (`takeClipSize`), an end-picture choice made by testing the model (`art.model.startsWith("ltx25")`, `ltx25EndPictureReady`), and the lane's model pick (`resolveCompanionClip`, `MAIPAI_PACK_MAX`). These are code constants and model tests in Home, not a household record; the first version of this note was wrong to call them one. They are E2 and E7 violations today.

After the move: Home sends the state's action in plain words, a loop (the end picture equals the start picture) and the quiet window, and asks for the operation `companion_take`. A Stack recipe selected by that operation holds the locked-shot wording, the words to avoid and the end-picture choice, the way `clip_film_shot` holds a film shot's. No verbatim mode and no caller negative words exist (E7).
Deleted from Home with the move: `TAKE_NEGATIVE_PROMPT`, `PACK_TAKE_NEGATIVE_PROMPT`, the `ltx25` test and `ltx25EndPictureReady` in the take path, `takeClipSize(art.model, ...)`, the lane picks in `resolveCompanionClip` and `MAIPAI_PACK_MAX`.
Test: the byte-equality idea becomes the pack's golden fixtures. For every state of three companions (pack and non-pack, 24 requests) the Stack's recipe output on today's engine is fixed in a golden file, produced once from today's Home prompt so the wording is the same on day one, and any later change to the recipe is a reviewed diff of that file.
Audience: some companion takes are made for a child or teen viewer (`laneOfPerson`), and B1 would be the first non-adult request on the door. So B1 first covers adult viewers only. A non-adult viewer's take moves with the E6 checks of B2 (the minor's list, speech checked, a loosening field refused) and not before; until then it stays on the old door.
Stack row: VF-COMPANION-RECIPE-01 (the operation, the recipe, the golden fixtures).

### B3. Reference clips

What Home sends today is in section A. After the move the Stack owns the route: an operation `reference_clip` with typed inputs (`identity` per person, `object`, `place`; spec first), the placement, and a face role that returns pass or fail. Home keeps the tool offer, the plain lines, who may be cast (copied exactly from today's rules, with a test that the same people are refused), and `gateFinished` on the composed first picture through the derive step of the identity route (typed refusal, one derivation, fail closed). That closes the gate gap named in Supersedes.
The face gate: the Stack keeps the threshold (0.5, an SFace number, pack data under E7) and returns pass or fail with the score for the receipt. Home decides when a face check is required and owns the copy (`LOOK_ALIKE_LINE`).
Delete order: `referenceFirstFrame.ts`, `firstPictureCompose.ts` and `firstPictureHarmony.ts` go only after each of the five behaviors in section A has a Stack test and a Home test.
Stack rows: VF-REFCLIP-01 (the operation with object and place inputs, spec first) and VF-FACE-ROLE-01 (the face role with the pack's threshold).

### B2. Young-person paths (last)

What Home sends today (`videos/tool.ts`): for a child, the prompt wrapped by `forceCartoon` and the fixed `CHILD_NEGATIVE_PROMPT`; for every young lane the quick model (`videoModelForLane`), audience all-ages, no sound maker. The daily limit, the no-photos redirect, the prompt refusal and the finished-clip gate stay in Home.
The door carries none of this and refuses non-adult audiences today (`clipRequestFor`).

After the move: Home sends `audience: minor` (C3), a rating level (G or PG-13; spec first) and the child's words. The cartoon look belongs to rating G only (C8): a teen at PG-13 is not made a cartoon, and a child whose ceiling an admin raised gets the higher level's behavior. The Stack's recipe holds every safety term keyed on rating G (and the PG-13 set), so a caller cannot ask for less. Home's video code stops using `CHILD_NEGATIVE_PROMPT` and `forceCartoon`; the constants stay in `pictures/lane.ts` because the picture paths use them.
For a minor the Stack refuses any field that would loosen the request: `prompt_mode`, negative words, a level change, sound, any operation other than a plain clip, except `companion_take` once that recipe has wording for each rating (a child's or teen's companion take then moves with B2, never before).

Proof for B2, all with tests. The 40-request comparison is needed but not enough: negative terms only show the words were passed on, and the picture models and some video packs ignore them. So also:
1. The Stack advertises the child recipe in its catalog (a flag). A Stack that does not advertise it sends the clip back to the old door with Home's own wording, never to the new door without the recipe.
2. A teen is not made a cartoon; a child whose ceiling was raised gets the higher level.
3. The part is on the minor's list and its speech is checked (E6; C11 does not relax it).
4. Loosening fields are refused for a minor, so "a photograph, ignore the cartoon" still gets the cartoon.
5. `gateFinished` still runs on the new door's result with the child floor, fail closed.
6. The receipt names the recipe and carries no prompt text.
7. A refusal reaches the child as a redirect, never as a filter message (C10).
8. The daily limit is not counted twice when a request falls back to the old door.
9. The 40-request set (plain words, a photograph request, violence, a brand, text on screen, two languages) is run old door against new door: the words the engine receives are compared, and every request Home refuses today is still refused before the door is asked. Pass criterion for the comparison: on an engine that takes a negative prompt, every term of `CHILD_NEGATIVE_PROMPT` is present in what it receives; on an engine that does not, each term is covered by the recipe's positive wording in its fixed reference output (a golden file, one entry per term).
10. The same set runs against the real Stack with a few finished clips opened and judged by a person.
Review depth for B2: full `check.sh`, code review at high effort on both the Home and Stack diffs, and the architect again on the amended note. Stack row: VF-MINOR-RECIPE-01 (the rating-keyed recipe, the catalog flag, the refusals).
Buildable before the owner is needed: the Stack child recipe and the comparison harness, run in shadow first. Only the Home switch waits for the architect and the review.

## C. Order and rows

1. B4 restyle (Stack row VF-RESTYLE-OP-01 first).
2. B1 companion takes, adult viewers only (VF-COMPANION-RECIPE-01), with the non-adult viewer's take held until the E6 checks land.
3. B3 reference clips (VF-REFCLIP-01, VF-FACE-ROLE-01), then the legacy first-picture files are deleted.
4. B2 young-person paths last (VF-MINOR-RECIPE-01), shadow first.

VF-DOOR-01 row text, to replace the current status line: "Done for the plain clip, Max, extend, retake, another take, film shots and identity. The rest moves per the amended note in the order B4, B1 (adult viewers, or with the E6 checks), B3, B2. The old door stays the fallback, and each step deletes the Home code that tests a model."
