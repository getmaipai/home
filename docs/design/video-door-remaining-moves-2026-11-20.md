# The rest of VF-DOOR-01: what still uses the old door, and the order to move it

Status: proposal for the architect. No code. Written 2026-11-20 after Max, extend, retake, another take and the identity route moved onto the Stack's generic make door.
The young-person and companion moves are audience gates (rules C8 and C10): they need the architect and a review before any code.

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

So nothing is deleted. All three files stay, with their tests, until the reference clip moves (section B3). Port before delete: each row above needs its new-path behavior and a test first.

One gap this code carries today and the move must close: its composed first pictures skip `gateFinished` (listed in the video and film pipeline note, gate gaps). The generic route already gates its derived picture, so moving the reference clip closes it.

## B. The moves left

For each path: what Home sends today that the door does not carry, where that wording lives after the move, the test that proves it is no less safe, what stays in Home.

### B1. Companion takes (all-ages audience, a household member's companion, no free text from a child)

Home sends today (`companionTakes.ts`): a prompt built from the companion's prompt pack (state words, motion words, light named, no blink words), a fixed negative list (`TAKE_NEGATIVE_PROMPT`, or the longer `PACK_TAKE_NEGATIVE_PROMPT` for a pack take), the size from the companion's media settings, seconds, the key-colour start picture as the start image, audience all-ages, a seed per take.
The door carries: description, shape, level, seconds, seed, start and end picture, quiet window.
Missing on the door: the negative list and the instruction to use the prompt as written (the Stack's prompt writer would rewrite it).

After the move: two small Stack additions, no new wording in the Stack. A clip request may say `prompt_mode: verbatim` (the Stack uses `description` as written and skips the recipe) and may carry `negative` words (a list, appended to the pack's own). The companion's wording stays in Home's prompt pack, which is the household's own record (rule 4 of the platform principles: one definition, one place).
Test: golden prompts. For a fixed set (every state of three companions, pack and non-pack, 24 requests), capture what the engine receives through the old door and through the door, and assert byte equality of prompt and of the negative list. The Stack side captures at the dispatch boundary; the Home side builds the legacy body. A difference fails the test.
Stays in Home: the take count, the model check, the gate on the finished clip, the audience.

### B2. Young-person paths (child and teen lanes)

Home sends today (`videos/tool.ts`): for a child, the prompt wrapped by `forceCartoon` (`CHILD_PROMPT_PREFIX`: a children's cartoon, flat shapes, not a photograph, safe for young children) and the fixed `CHILD_NEGATIVE_PROMPT` (photographic, logo, text, nude, sexual, violence, gore, weapons, scary, drugs, alcohol); for every young lane the quick model (`videoModelForLane`), audience all-ages, no sound maker. The daily limit, the no-photos redirect, the prompt refusal and the finished-clip gate stay in Home.
The door carries none of the wording, no negative words and no model choice, and it refuses audiences other than adult today (`clipRequestFor`).

After the move: the wording lives in the pack's prompt writer chosen from `audience` and intent: an all-ages request (`audience: all-ages`) is written with the cartoon recipe and the pack's hard negative list, set Stack-side, so a caller cannot ask for less. Home sends the child's words as the description and nothing else about wording. The model is the Stack's pick among parts that serve the all-ages list.
Test, the heart of it: no less safe. For a fixed set of 40 requests (plain words, words that ask for a photograph, for violence, for a brand, for text on screen, in two languages), capture the final prompt and negative words the engine receives, old door against door, and assert: (1) the door's negative list contains every term of `CHILD_NEGATIVE_PROMPT`, (2) the door's prompt starts with the same cartoon instruction (or an instruction the architect accepts as equal), (3) the part is one the all-ages list serves (never the adult sound maker), (4) a child's request never carries an input picture. Any miss fails. Plus a refusal test: every request Home refuses today is still refused before the door is asked.
Stays in Home: all gates and limits. Needs the Stack rule first (a pack-level child recipe), and the architect, and a review.

### B3. Reference clips (`make_reference_video`, adult, Max)

Home sends today: pictures read by role, a composed first picture or a sheet, the scene words, the Ingredients form fields.
After the move the Stack owns it as a route: an operation `reference_clip` with typed inputs (`identity` per person, `object`, `place`), the placement and the face gate as a Stack role (the face models are Stack models), the first picture gated by Home's `gateFinished` through the same derive step as the identity route (typed refusal, one derivation, fail closed), and the clip's face check reported in the receipt. Home keeps the tool offer, the plain lines and `gateFinished`.
Test: the five rows in section A each get a Stack test and a Home test before `referenceFirstFrame.ts`, `firstPictureCompose.ts` and `firstPictureHarmony.ts` are deleted, and the composed picture goes through `gateFinished` (the closed gap).
Waits on the Stack: the `reference_clip` operation and the face role.

### B4. Restyle and Ingredients

Not wired on the Stack's door (`submitVideoRestyle`, `submitVideoIngredients` post to their own routes). Nothing for Home to move until the Stack has the operations. Ingredients is the sheet route of B3 and moves with it. Restyle takes a source clip, a style and a strength: it needs `operation: restyle`, an `edit_source` input and the style id, like extend and retake did.

## C. Order

1. B4 restyle (adult, Max, no free-text wording change, same shape as extend and retake): small, after the Stack row.
2. B1 companion takes: fixed wording, byte-equality proof, no user words.
3. B3 reference clips: adult only, closes a gate gap, then the legacy first-picture code is deleted.
4. B2 young-person paths last: user words and the strictest audience gates; it needs the Stack child recipe, the comparison test above, the architect and a review. Until then the young lanes stay on the old door, which is also the safe default.

Each step keeps the old door as the fallback, so an older Stack or a refused request behaves as it does today.
