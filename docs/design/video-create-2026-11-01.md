# Videos: Create, keyframes, extend, Storyboard and consistency (design draft, 2026-11-01)

Status (2026-11-01): proposed; architect APPROVED 2026-11-01 (second ruling, VIDEO-CREATE-01). No code. Item: VIDEO-CREATE-01. Builds on
[video-generation-2026-10-17.md](video-generation-2026-10-17.md) (the model, the runtime, the policy) and
[media-editors-2026-10-31.md](media-editors-2026-10-31.md) section 5 (the Video editor, which stays its own app and whose parts this
note reuses; see section 1a). Follows the shape of [music-listen-create-2026-11-01.md](music-listen-create-2026-11-01.md): one Videos app
with a Browse and a Create mode (the package's own names; the S7 text says Watch and Create, which should be corrected to match), and
every Create item also has a chat tool and a card. S7 is only proposed (branch `wt/fair-heron-music-chat-cards-note`, not in RULES.md on
main); this note follows it as a plan, not as authority.

Owner answers that shaped this note (Jesse, 2026-11-01): build the Videos Create tab the way Music's is built, from a review of what
Higgsfield, Canva and the other leaders offer; expand on the generation already built; everything built is also reachable in chat;
keyframes, extending a shot and joining scenes (storyboarding) are needed; characters, voice and setting must stay consistent across
shots. Picks: first slice is Make, Animate and Creations; a character is saved reference pictures (no training first); camera moves and
effects are built-in prompt recipes; Storyboard follows Make and Characters; a character's voice is laid over silent shots.

## 1a. Supersedes and reuse

Supersedes: nothing approved is replaced. Changes this note makes: the Videos package's three Create placeholders (`create`,
`make-video`, `creations`) get real pages; `generate_video` gains inputs (`start_frame`, `end_frame`, `character`, `place`, `recipe`),
all additive. The Quick and Detailed quality choice becoming the resource tiers is already decided there (resource-tiers section 5.3; TIER-HOME-02 and -03 landed it) and is not this note's change. [media-editors](media-editors-2026-10-31.md)
(MEDIA-EDITORS-DESIGN-01, approved 2026-10-31) is not superseded: the Video editor stays its own pinnable app (EDITOR-16), because an
editor that changes a person's existing files stays separate (proposed S7(b)). Create makes new things; the editor changes files.

Reuse check (org principle 6, one definition each). Reused as they are or as approved: `media.edit` (EDITOR-11) for stitch, trim, mute,
frame grab and audio overlay; the `ClipTimeline` Element (EDITOR-12, proposed, owner sign-off pending) as the Storyboard strip, not a
second strip; EDITOR-14's export as a Library file with provenance for the finished film; EDITOR-15 ("Continue from last frame through
the existing video job") is the one Continue and Extend function, one name (Continue) and one implementation. Both Create and the
editor call them. Considered and not used: shadcn and Kibo have no character or place card, so the Character and Place cards are
composed from `Card`, `Button` and `SafeImage` (a check of the answer-block kinds finds no fit; the card kinds are added once in
`commons`). Engine features for keyframes: LTX keyframe conditioning and the Wan first-and-last-frame variant (benches in section 9).
If EDITOR-12 is not signed off when Storyboard starts, Storyboard waits for it rather than building a strip.

## 1. What exists

- Chat tool `generate_video` (`backend/packages/generate_video`, `lib/videos/tool.ts`): text to video and picture to video ("Animate",
  `from_picture`), orientation, and a quality choice that is still the old two-way Quick (silent, up to 5 s, Wan 2.2 TI2V 5B) and Detailed (up to 10 s,
  sound and speech, LTX 2.3). Owner (2026-11-01): Detailed is old and is dropped as a concept; video follows the resource tiers
  (Standard, Boost, Max; [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) section 5.3) like pictures and music.
- A Stack job (`lib/videos/stack.ts`, `jobs.ts`, `video_jobs` rows) through the household queue; routes in `routes/videos.ts` (status,
  jobs, preview, files, cancel, another, animate); Library storage with `video-gen` provenance; the chat card (`VideoToolRender`).
- Adults on their own screen only; the Stack decides which tiers can run (today `qualities.detailed.image_to_video` gates picture to
  video on the LTX tier; V1 renames it to the tier it serves).
- Videos app package (`backend/packages/videos`, 0.1.1): Browse and Create header modes; `create.json`, `make-video.json` and
  `creations.json` are placeholders. The catalog copy (0.1.0) has no Create mode and must be synced.
- Absent: keyframes, extend, multi-shot projects, characters, places, voice overlay, lip-sync, any video edit.

## 2. Leader benchmark (standing rule: review leaders, replicate what fits)

| Leader | What it gives | Our answer |
|---|---|---|
| Higgsfield | Cinema Studio (camera, lens, light controls, multi-shot), Soul ID characters, lip-sync, effects and one-click apps, product-URL ads | Recipes, Characters, Storyboard; lip-sync later; no ads |
| Runway | prompt-based editing of footage (Aleph), performance capture (Act-Two) | not v1 (no tested local model) |
| Kling, Veo, Luma | first and last frame, extend, multi-shot, reference images, native audio | Start and End frame, Extend, Storyboard, reference pictures (each after a bench) |
| Canva, CapCut, Adobe | one editor: generate, then trim, join, add sound | Storyboard stitch (`media.edit`); trim and join tools stay in the Video editor app |

The sources are third-party reviews; counts and prices were not relied on. Features need a local model: nothing below becomes a button
until its bench row passes (section 9).

## 3. Create mode menu

1. **Create** (home): prompt bar, three starter ideas, recent makes.
2. **Make a video**: one shot from words or a picture. Chips on the prompt bar: the kit tier segment (Standard, Boost, Max, with "Make it Max" on a finished clip), Length, Orientation, Recipe, Character, Place,
   Start frame, End frame (End frame appears only when its bench passes).
3. **Characters**: saved characters and places (section 5).
4. **Storyboard**: projects of shots (section 4). After Make and Characters.
5. **Creations**: history, finished films, Make another, Continue, Download, Delete; "Made here" badge.

Phone: the same pages; chips scroll sideways; the strip scrolls sideways. A person whose video lane is off, or any minor, guest, TV, robot
or spoken surface, sees no Create mode (the app stays `min_role: "adult"`; rule 0).

## 4. Keyframes, extend, Storyboard

Terms: **Start and End frame** (keyframes) fix the picture a shot begins and ends on; **Extend** lengthens a shot by continuing from its
last frames; a **Storyboard** (also called multi-shot or scenes) is an ordered list of shots that exports as one stitched film.

- **Shot** (the unit): prompt, optional Start frame, optional End frame, length, tier, character, place, optional recipe, optional
  voice line. Each shot is one `video_jobs` row; a Make is a one-shot project.
- **Continuity default:** a shot's Start frame is the previous shot's last frame, so cuts match; "Hard cut" turns it off.
- **Continue** (also called Extend; one function, EDITOR-15): a new job from the last frame of a made clip, kept as a version chain,
  not a replacement. A true Extend that carries motion and sound is VIDEO-EVAL-04's question; it ships as a separate option only if
  that bench passes.
- **Stitch:** the Stack `media.edit` job (EDITOR-11: trim, concat, mute, frame grab; audio overlay is added to its ops list there, not
  in a second job). The strip is `ClipTimeline` (EDITOR-12). Export is EDITOR-14's: the film is a new Library file with provenance
  listing its shots.
- **Queue:** shots run one at a time through the household queue at video priority (chat first, then images, then video, resource
  priority order). The strip shows each shot's state through the one-job progress row; a failed shot offers Make another, never an
  error bubble, and never blocks the others.

## 5. Consistency across shots

One **Scene bible** per project; every shot inherits it:

| Stays the same | How |
|---|---|
| Character look | a **Character** = 1 to 4 reference pictures plus a name and short description; attached to each shot that names it |
| Setting | a **Place** = 1 to 3 pictures plus words; used as the Start frame source or added to the prompt |
| Style and light | style words and an optional recipe stored on the project, added to every shot's prompt |
| Between shots | previous last frame as next Start frame (section 4) |
| Settings | tier, orientation, size and seed stored on the project; a shot may override one |
| Voice | each character has a **Voice** (an existing household voice, [household-voices](household-voices-2026-10-20.md)); shots in a Storyboard are made silent and the Voice speaks the line over the shot in the stitch step |

Honest limits: look and place hold well because shots start from pictures; faces can still drift over many shots (trained looks,
the LoRA path in video-generation section 7, are the next step after a bench, not v1); a Boost or Max shot makes its own voice, which can
change per shot, so a fixed voice uses the silent shot plus overlay; lip-sync to a chosen voice is a later feature with its own bench.

Records (org principles 3, 4, 6). The `place` entity is a geographic household entity (`geo`, `place_kind`, no picture field; geo is
rounded for a child), so it does not fit a film setting and is not reused. New spec records, additive and spec first: one
`video-reference` record with `kind: character | place` (name, description, 1 to 4 picture file ids, optional household voice id,
owner, share pointer), and `video-project` with an ordered `shots` list of job references and the scene bible fields. Each carries id,
provenance and clock stamp. A Character of a household member points at the likeness saved style rather than copying it.

## 6. Recipes

A recipe is tested prompt wording for a camera move or style (dolly in, orbit, handheld, slow motion, time-lapse, and so on), kept as one
list in one place (a settings-style definition, not per page), added to the prompt like music recipes. A recipe ships only after a
bench shows it changes the clip on both models; one that does nothing is dropped from the list.

## 7. Chat: every Create item has a tool and a card (S7)

| Item | Chat tool | Card |
|---|---|---|
| Make, Animate | `generate_video` (built); gains `start_frame`, `end_frame`, `character`, `place`, `recipe` | video card (built) |
| Continue, Extend, Make another | `edit_video` (new, tasks: continue, trim, join; one Continue function, EDITOR-15; a separate Extend only if VIDEO-EVAL-04 passes), on a clip made here | video card gains Continue |
| Characters and places | `make_character`, `make_place` (from a picture attached or made here) | Character and Place cards (kit Elements, answer blocks) |
| Storyboard | `make_storyboard`: the chat model writes a shot list and proposes characters and a place; nothing generates until the person approves | Storyboard card: strip of shots, Approve, Make another per shot, Export |

Rules: a job that takes time uses a named tool-call card that polls the job (chat-cards standard); the new cards are kit Elements in
`commons` (rule 9: never a Home `*Card`), each with a `UI-DECISIONS.md` row first, and the same Element draws in Create. Which video
tools a turn is offered follows the surface or an object in the conversation (a video, a storyboard, a character), at most five, inside
rule 1's cap of 16; each tool gets a bench row before it joins the set. A failed tool never fails the answer (rule 6). Gates run in the
tool, not the card: adult only, own screen only, the household video switch, the model-decides rule for adult content, and the
CSAM line that nothing lifts.

## 8. Safety and privacy

Unchanged: adults on their own screen; a minor is never a maker (Create is `min_role: "adult"`). Family subjects follow rule 0's
household option (on by default): anyone in the household may make videos with or of a household member, and an ordinary mention or a
nonsexual depiction of a minor is not blocked for an adult (rules 0 and 10). A possible minor in nude or sexual output is a CSAM
candidate and is withheld (rule 10). Reference pictures of real people follow rules 0 and 10 and
[adult-content-model-decides-2026-10-26.md](adult-content-model-decides-2026-10-26.md): no adult-side likeness restriction, consent
proof or consent prompt, except as part of CSAM prevention. This note adds no gate. A Character made from a household member is the
household option's family subject; it points at the source pictures of the existing likeness saved style (LIKENESS-01; the style itself is an image adapter and does not work on Wan or LTX) and does not define a
person's likeness a second time. All work is local: zero outbound connections, asserted for every new worker.

Status surfaces (S6): Create's controls follow the existing "Pictures and video are not ready" row (`useMakingAvailability` on the
`["health"]` query); each shot's state uses the "One job's progress" row, which is the job's own card. No new status surface.

## 9. Bench rows (before any button)

Rows 2 and 3 are not new: End frame is VIDEO-EVAL-03 (later-frame picture anchors) and Continue versus Extend is VIDEO-EVAL-04, with
VIDEO-EVAL-05 (keyframe interpolation price) behind them; this note cites those ids and adds no copy. Their design is
`video-speedup-and-control-eval-2026-10-20.md`.

1. Start frame holds identity and scene on Wan and LTX (picture to video, already built): measure drift over 3 chained shots.
2. End frame: VIDEO-EVAL-03 (LTX keyframe conditioning, Wan first and last frame variant).
3. Extend versus direct: VIDEO-EVAL-04.
4. Recipes: each of ten moves changes the clip on both models.
5. Voice overlay: a 20 s film with a household voice speaking over silent shots, in sync with the cuts.
6. Reference-picture character across five shots: same person judged in a blind pair test.
7. Queue: a ten-shot Storyboard does not delay a chat turn or an image job (resource priority).
8. Few-step distilled add-on (section 9a): same seed, same prompt, a distilled adapter on the LTX Boost model against the baseline:
   seconds, peak memory, and a blind quality pair.
9. Two-stage Max (section 9a): this is TIER-EVAL-03 (LTX-2.3 dev two-stage with guidance); the note adds no copy, only the identity check on the refine pass.
10. Tool decisions (rule 1, the VIDEO-GEN-07 shape): offer rate and false offers for `edit_video`, `make_character`, `make_place`,
    `make_storyboard` and the new `generate_video` arguments, with the worst case (a video in the Videos pane) at 16 tools or fewer.

### 9a. What the Pika-H3-Flex and 2K upscale video adds (reviewed 2026-11-01)

Source: a ComfyUI walkthrough (transcript pasted by Jesse; channel and date unknown, no on-screen values), so every number below is
the presenter's claim, not a measurement. Models in it (MiniMax-H3, Pika-H3-Flex, a 2K refiner) are not ours; I have not verified them.

What it shows: a distilled few-step adapter cut sampling from 20 to 50 steps to 6; speed tweaks (chunked feed-forward, a scheduler
swap worth about 8 to 9 percent); and a two-stage path: generate small, upscale the video latent 2x with a small 3D-conv upscaler
(never decoded to pixels), then run the refiner as a LoRA for 2 or 3 steps. He reports a 1440p clip in about 440 s on a 16 GB card;
his own base runs took 150 to 200 s, and he saw the refiner change a face's identity at full strength, so strength needs tuning.

What carries over, and what does not:
- **Does not:** the upscaler and the refiner are trained on that model's own latent format. They do not work on LTX or Wan.
- **Does:** (1) a few-step distilled adapter is the way to make a tier faster; our Boost is already LTX-2.3 distilled, so the
  question is whether a further adapter helps on Mac (bench row 8). (2) Generate small then refine is the right shape for **Max**:
  LTX-2.3's own two-stage pipeline (a latent spatial upscale, then a refine pass) is the same idea in a model we can run, and it is the
  existing Max video proposal (resource-tiers section 5.3). Bench row 9 measures it; Max video stays empty until it passes.
- **For Storyboard:** the refine pass is the identity risk; keep its strength low and compare against the reference pictures (bench 6).
- **Not a plan:** the 60-second headline. A film is still stitched from shots (section 4).

## 10. Slices, in order

| # | Size | Slice | Done when |
|---|---|---|---|
| V1 | M | Create home, Make a video, Creations, Recipes, Start frame; catalog Videos copy synced | Sage makes a clip from words and from a picture with a recipe; it shows in Creations; preview on desktop and phone |
| V2 | S | `generate_video` gains frame and recipe inputs; card shows them | the same clip is asked for in chat and matches |
| V3 | M | Bench rows 1 to 7 (rows 8 and 9 belong to the tier bench; row 10 runs inside V2, V4, V5 and V6 before each tool or argument joins the set) | numbers recorded; each result decides which buttons ship |
| V4 | L | Characters and Places (spec first), `make_character`, `make_place`, Character and Place Elements | a character holds across five shots in the blind test |
| V5 | L | Storyboard, stitch (`media.edit`), voice overlay, `make_storyboard`, Storyboard Element | "a 30 second film about X" yields an approved shot list, shots, and one stitched film |
| V6 | M | Extend, End frame, `edit_video` (only the parts that passed V3) | each adds one version and keeps the old |
| V7 | S | Privacy check on each new worker, export and share | zero outbound connections asserted |

## 11. Open points for Jesse

None block V1. Later and not decided: trained looks (LoRA) for likeness; lip-sync; product-URL ads (not planned; they need outbound
fetches); whether a Storyboard may be shared as a project, not only as a film.
