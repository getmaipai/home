# Companion characters as pregenerated video (2026-10-21)
> Status (2026-10-31): superseded in part by [companion-three-screens-2026-10-28.md](companion-three-screens-2026-10-28.md): section 12.2 (three tabs, teen editor later).

> **Superseded in part (Owner-approved: 2026-10-25):** [models-censor-app-protects-kids-2026-10-25.md](models-censor-app-protects-kids-2026-10-25.md) retires the adult-side limit stated here (no non-consensual imagery of a real, identifiable person; for an adult the model decides); the minor line and every child and teen floor stand.

Owner ask (Jesse, chat, 2026-10-21): companions become animated characters shown as **pregenerated video**, not animated live. Our own video
tool makes the clips. Every screen state of the companion (thinking, speaking and so on) needs a **template**. The background should be
transparent if that is practical. The character must be **the same character in every clip** (same species, colour, nose, build). A
second message the same day: the character must be able to **start from a picture the person provides, or from one our image tool
makes, which the person edits and approves**, and **the image and video specifications are defined once and always used** (size, frame
rate, resolution and so on).

Status: research and proposal. Nothing is built. Evidence is cited by source; measured numbers are from
[video-generation-2026-10-17.md](video-generation-2026-10-17.md) and [video-speedup-and-control-eval-2026-10-20.md](video-speedup-and-control-eval-2026-10-20.md);
anything not measured is marked **to measure**.

## 0. What this changes

[assistant-layer-2026-10-04.md](../plans/assistant-layer-2026-10-04.md) (Q1) decided Rive (a live, vector-animated mascot) plus a free
CC BY community mascot, with a `.riv` file in the companion package and a still image per state as the fallback. This note replaces
the Rive half: the companion's `animation` is a set of pre-rendered video clips, one per state. The state names, the one mapping
function (idle outside a turn, thinking on `turn_meta` until the first delta, working while a tool or job runs, needs_you on a pending
approval) and the kit `Avatar` slot are kept. The static image per state stays as the fallback and as the reduced-motion view.

## 1. Recommendation in one table

| Question | Pick | Why |
|---|---|---|
| Transparent video? | **Yes: stacked-alpha video** (colour in the top half, a grey matte in the bottom half, one file), composited by a tiny WebGL shader in the `Avatar` slot | Works in Chrome, Firefox and Safari from one render path. The alternatives each break in one major browser (section 3) |
| Animated GIF? | **No** | 256 colours, on or off edges (jagged on any background), no hardware decode, large; see section 3 |
| How the clips are made | Wan2.2 TI2V-5B FastWan through the existing video worker, **image to video from one approved rest picture**, on a flat key-colour background; background removed by chroma key | Same weights, runtime and licence as the shipped tool; frame 0 is anchored to the approved picture |
| Consistency | One approved **character sheet**, one **rest picture**, every clip starts from the rest picture and returns to it, best of N seeds chosen by a measured check, a person approves each state | Video models drift; the design assumes drift and removes it by anchoring, selection and review (section 5) |
| Where it runs | Authoring on the hub (or the Studio for bundled characters); **households play finished files**. Nothing is generated at play time | Zero network at play time; a clip is a static asset in a signed package |
| Specs | One `CompanionMediaSpec` record in `commons/spec`, used by the generator, the checker, the encoder, the package validator and the player (section 2) | One definition, one place (principle 4) |

## 2. The specification (defined once, enforced everywhere)

The numbers below are proposals; the first column is what the generator is asked for, the second is what ships. A clip that is
outside the shipped column is refused by the package validator, never repaired silently at install.

| Field | Source image | Generated clip | Shipped clip (per file) | Why |
|---|---|---|---|---|
| Canvas | 1024 x 1024 PNG, sRGB, character centred, 12 percent margin on every side | 832 x 480 (the measured, in-budget Wan size) with the character in the centre 480 x 480 | **480 x 480 colour plus 480 x 480 matte stacked = 480 x 960** | The tool's measured size is 832 x 480; the square crop keeps the character, fits a 240 px avatar at 2x, and the large launcher at about 1.5x. A 720p render is not offered (308 s, 53.9 GB) |
| Frame rate | n/a | 24 fps (the model's native rate) | **24 fps constant** | No retime, so no blended frames |
| Length | n/a | 121 frames (5.04 s) | Loops: trimmed to a clean loop between 2.0 and 4.0 s; one-shots: 1.5 to 4.0 s | Whole-second variety is not needed; short files are small |
| Background | Flat key colour, **#00FF00 by default**, replaced by **#FF00FF** when the character's palette contains green (decided at sheet approval, recorded on the character) | same | Removed; the matte holds the shape | A flat known colour keys cleanly and is stable frame to frame |
| Framing | One fixed camera, no zoom, no pan, no cut | same | same | A moving camera breaks every state switch |
| Pose | Rest pose: standing or sitting, facing the viewer, mouth closed, arms down | Frame 0 is the rest picture; the last frame returns to the rest pose | same | Every state can follow every other through the rest pose (section 6) |
| Codecs | PNG | H.264 mp4 | **AV1 stacked (first, where supported) and H.264 stacked (always)**, CRF chosen by the size budget, 10-bit when the encoder allows (limited-range banding) | One render path, two files |
| Audio | n/a | none | none | The companion's voice is a household setting; clips are silent |
| Size budget | n/a | n/a | **to measure**; target at most 600 kB per loop and 8 MB per character | Jake Archibald's stacked AV1 example was 460 kB, with the alpha half adding about 8 kB |
| Fallback | n/a | n/a | One 480 x 480 PNG with alpha per state (the rest frame) | Reduced motion, a failed decode, and a printed or notification use |

Where the spec lives: a `CompanionMediaSpec` record (and its fixture) in `commons/spec`, spec first, then hub, then robot (the
org rule for shared records). Fields: `image.size`, `image.margin`, `video.width`, `video.height`, `video.fps`, `video.frames`,
`video.max_bytes`, `key.default`, `key.alternate`, `states` (the list in section 6, each with `kind: loop | oneshot`, min and max
seconds), `codecs`. The generator, the checker, the encoder, the package validator and the player all import it. A number appears
nowhere else; a change is a spec bump.

## 3. Transparent video: what is possible (research)

- **VP9 in WebM with alpha** plays with transparency in Chrome, Firefox and Edge. **Safari plays WebM but ignores the alpha** and shows
  an opaque background ([Rotato](https://rotato.app/read/transparent-videos-for-the-web)).
- **HEVC with alpha** (a `.mov`) plays with transparency in Safari on macOS and iOS and not in Chrome. Encoding it needs macOS for a
  good result; the free ffmpeg route is about twice the size. Known bugs: wrong alpha on Chrome for Android, stalls on Firefox for
  Android ([Archibald](https://jakearchibald.com/2024/video-with-transparency/)). Shipping both files and listing HEVC first works but
  doubles the assets and inherits those bugs.
- **Animated AVIF** supports alpha, but Safari renders it slowly and incorrectly and Chrome and Firefox struggle to hold 60 fps (same source).
- **Animated GIF** (not in the sources above; standard format limits): 256 colours per frame and a 1-bit alpha, so an anti-aliased
  character shows a hard fringe of its old background; no hardware decode; a 5 s clip at this size is several times the size of the
  same clip in a video codec. Animated WebP and APNG have full alpha but decode on the CPU, are larger than video, and give no
  seeking or frame-accurate control. None of the three is a best practice for a looping character.
- **Stacked-alpha video** (Archibald's recommendation): the video is twice as tall; the top half is colour, the bottom half is the alpha
  as grey; a small fragment shader combines them. His example was 460 kB in AV1 (Chrome, Firefox, Safari on recent Apple hardware),
  with H.264 or HEVC for other devices, and the alpha half added about 8 kB. The video stays a native `<video>` element, so hardware
  decode, pause and `prefers-reduced-motion` work normally. Pitfalls to test: colour-range banding (use 10-bit), premultiplied
  alpha at the edge (premultiply on the encode side, decode in the shader), and WebGL context limits (one shader and one canvas per
  visible avatar, never more than two on screen).
- **Open-source matting tools for video** (a search found these; none generates video, all cut a subject out of one; licences and
  maintenance not checked): [transparent-background](https://github.com/plemeri/transparent-background) (InSPyReNet, CLI),
  [BackgroundRemover](https://github.com/nadermx/backgroundremover) (MIT code), [ai-rotoscoping](https://github.com/VirtuallyJesse/ai-rotoscoping)
  (SAM 2, ViTMatte, MatAnyone), AlphaCut (BiRefNet, exports VP9 alpha and ProRes 4444). They are the fallback for a clip that did not
  render on a flat key colour; a licence check comes before any is pinned.
- **Not used, and why:** a solid theme-coloured backdrop baked into the video would break the rule that every colour follows the
  selected theme (every colour follows the selected theme, so dark and light themes both need a transparent character).

**The model side.** Wan2.2 5B makes colour video only; there is no alpha output. [Wan-Alpha](https://huggingface.co/htdong/Wan-Alpha/blob/main/README.md)
(Apache-2.0, released 2025-09-30) makes real RGBA video, but it is a Wan **2.1 14B** text-to-video model plus a LoRA and a special VAE,
with no MLX path and no image conditioning; it is far outside the Stack's memory and time budget today. It is the later upgrade
(bench row below), not the start. The start is a **flat key colour plus chroma key**: deterministic and flicker-free across frames,
unlike a per-frame segmentation model. The Stack already carries IS-Net (MIT/Apache-2.0, 0.8 s per picture) for the editor's Remove BG;
it is the fallback for a still that was not made on a flat colour (an uploaded photo), and for a frame where the key fails. Per-frame
segmentation can shimmer at the edge between frames; if it is used for video, the matte is smoothed over time (to measure).

## 4. Where the character comes from: three entry paths, one approval

All three end in the same record and the same approval; nothing downstream knows which path was used.

1. **The person brings a picture** (a drawing, a mascot they own, a photo of a toy). Normalised by the spec: scaled to 1024 x 1024, the
   background removed with IS-Net (Remove BG, already built), composited on the key colour, centred with the margin. A consent and
   rights line is shown on the card ("you made this or have the right to use it"); a picture of a real person goes through the
   likeness consent path ([likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md)) or is refused.
2. **Our image tool makes it from words** (FLUX.2 Klein 4B, the default image model): a prompt template that always asks for the spec
   (one character, full body, rest pose, facing the viewer, flat key-colour background, no shadow, no text), four candidates
   at about 4 s each.
3. **Edit then approve** (either path above): the existing image editor and Klein reference edit (8.4 s warm) change a picture
   ("make the nose brown", "add a scarf") and each result is a new version with Undo. The person can also pick a candidate and say
   "more like this" (the picked picture becomes the reference for four more).

**The approval step produces the character sheet**, the one artefact all clips are made from:

- the **rest picture** (frame 0 of every clip);
- two supporting views by Klein reference edit from the rest picture: **three-quarter left** and **three-quarter right**, plus a
  **mouth-open** picture. These are not video anchors (the model conditions frame 0 only); they are the checks the clip must
  match and the references for edits;
- a **description card** (species, colours as hex values read from the picture, distinguishing features, accessories, proportions),
  written by the household's picture-reading model from the rest picture and then edited by the person. The card is the single
  text every clip prompt starts with, so the words never vary between states (the "yellow dog in one clip and another dog in the next"
  failure is mostly a prompt that described the character a little differently each time);
- the **key colour** (chosen per the palette), the **seed family** and the generation record.

The person sees the sheet (rest picture, three views, card) and presses **Approve** or **Edit**. Nothing is rendered as video before
approval; a rejected sheet costs seconds, a rejected clip costs minutes. The step is the same for a bundled character, where
"the person" is a reviewer of the package (kid-safe flagged, reviewed with the package as the assistant-layer note requires).
Generation records (tool, model hash, prompt, seed) are kept with the art, as ASSIST-NAME-01 already requires. A picture made
by AI is hard to own or trademark (that note's caution); the sheet records it.

## 5. Keeping the character the same (the core risk)

The research finding and ours agree: long or free-form generations drift, and the reliable workflow is approved stills first, then short
clips animated from them ([Figma](https://www.figma.com/resource-library/ai-character-consistency/), the Scenario and community
workflows; vendor and community sources, so read as practice, not proof). Our measured start: the robot image-to-video clip kept its head,
headphones, vent and palette across 5 s and ended in the requested pose (video note, section 5). The same note says the image
conditions frame 0 only. So the design is:

1. **Every clip starts from the one rest picture** (never from another clip's frame, which compounds drift).
2. **Prompt = the description card (verbatim) + one motion sentence.** The motion sentence describes only the change ("raises its
   right paw and waves twice, then lowers it"). The card never changes between states. Fixed negative prompt.
3. **Short clips, one camera.** Only the 2 to 4 s that ship are rendered into the 5 s clip; the tail, where drift is largest, is cut.
4. **Best of N, picked by a measured check** (N = 4 seeds per state, about 9 minutes per state at 135 s a clip): for each clip,
   keyed frames are compared with the rest picture on (a) the mean colour of the character mask against the card's hex values (a
   colour-drift number), (b) mask area and bounding box stability (a size-drift number), (c) an image-embedding distance of the
   first, middle and last frames to the rest picture. The embedding model is the open one the Stack already uses for pictures if
   it has one, else DINOv2 (Apache-2.0; licence and Mac path to verify). A clip over any threshold is dropped before a person sees it.
   The thresholds are set on a bench (to measure) and then fixed in the spec, not tuned per character.
5. **Loop and return-to-rest repair.** A loop is closed by finding the best matching start and end frames inside the clip (lowest
   difference) and cross-fading the join over 4 frames; an idle can use ping-pong (forward then reverse) because it has no speech.
   If the last frame is not the rest pose, a one-shot gets a 6-frame blend toward the rest picture (keyed, then re-matted).
   Later-frame anchors (an end picture, so the clip really ends at the rest pose) are bench VIDEO-EVAL-03; if they pass, this step shrinks.
6. **Human approval per state.** The person (or reviewer) sees the surviving best clip for each state, in a loop, on a light and a
   dark background (the edge fringe shows against the wrong one), and presses Approve, Redo (next seeds) or Edit the motion
   sentence. A state is never shipped unreviewed.
7. **Drift insurance for later.** A small LoRA on the 5B model trained on the approved rest views would hold identity best; training on
   the Mac is unmeasured and the LoRA library is the household's, so this is an option row, not the plan.
8. **Add a state later.** A new state in a new spec version is rendered from the same sheet, same card, same key; the old clips are
   untouched. A character is therefore never "re-rolled".

## 6. The states (the templates)

Each state has a template: a motion sentence, a kind, a length range and a transition rule. All start from, and end at, the rest pose,
so any state can follow any other **through one rest frame** with no visible cut. Loops end only at their loop point; one-shots return
to **idle** when done.

| State | Kind | Seconds | Motion sentence (template) | Driven by |
|---|---|---|---|---|
| `idle` | loop (ping-pong allowed) | 3 to 4 | breathes slowly, tiny sway, one blink | outside a turn |
| `idle_look` | one-shot | 2 to 3 | looks to one side, then back | random, 20 to 40 s apart while idle |
| `listening` | loop | 2 to 3 | head tilts slightly toward the viewer, ears or eyes attentive | the person is speaking to the robot or dictating |
| `thinking` | loop | 2 to 3 | looks up and to the side, one paw to chin | `turn_meta` until first delta |
| `working` | loop | 2 to 4 | busy, small repeated gesture, looking down at its hands | a tool, job or project running |
| `speaking` | loop | 2 to 3 | mouth opens and closes at a speaking rhythm, small head movement | text-to-speech audio playing |
| `needs_you` | loop | 2 to 3 | leans forward, holds up one paw, hopeful | a pending approval of that person's |
| `greeting` | one-shot | 2 to 3 | waves once, smiles | first open of the day, "hello" |
| `happy` | one-shot | 2 | small hop, smile | a good result, a thank you |
| `oops` | one-shot | 2 | rubs the back of its head, sheepish | an error the companion owns ("I could not reach...") |
| `celebrate` | one-shot | 2 to 3 | both arms up, bounce | a long job finished |
| `sleeping` | loop | 3 to 4 | eyes closed, slow breathing, small z | quiet hours, no activity for a set time |

Twelve states. The first seven are the ones the assistant-layer note already named (idle, thinking, working, needs_you) plus the speaking
and listening states a voice companion needs; the rest are the minimum that make a character feel alive. A package may ship fewer
(the fallback for a missing state is `idle`), never more than the spec lists.

**Speaking is the honest limit.** Pre-rendered video cannot lip-sync to arbitrary speech. `speaking` is a generic mouth rhythm, played
while audio plays and stopped at its loop point when the audio ends. Two or three `speaking` variants (calm, lively) can alternate by
sentence; amplitude-driven mouth shapes would need a separate layered mouth (an option row). A character design with a simple mouth
(an animal, a robot) hides this well; a realistic human face would not. The character prompt template says so: stylised, simple face.

**Player rules** (one component, in the kit `Avatar` slot, never a Home wrapper, never a `className` that changes shape; if the slot
lacks a video mode, add the prop in `commons` first, rule 9):
- one state machine: next state is queued and starts at the current loop's loop point (at most 4 s late) or immediately if the
  current clip is a one-shot's last frame; priority `needs_you` > `speaking` > `working` > `thinking` > `listening` > `idle`;
- `prefers-reduced-motion`, a hidden tab, or an off-screen avatar: show the state's PNG fallback and pause;
- a decode failure or a missing file shows the PNG fallback and never blocks the chat;
- no network request at play time (the files are served from the hub), per the privacy rule (zero phone-home); the privacy test must see zero
  outside requests;
- preload `idle` and the next likely state; load the rest on first use.

## 7. Package shape (spec first)

In the companion manifest (`COMP-03` area; the `animation` field the assistant-layer note planned): 

```
animation: {
  kind: "video",
  spec: "<CompanionMediaSpec version>",
  key: "#00FF00",
  states: { idle: { av1: "idle.av1.mp4", h264: "idle.h264.mp4", still: "idle.png", loop: true }, ... },
  sheet: { rest: "rest.png", card: "card.json" },
  provenance: { tool, model_sha256, prompt_hash, seed, approved_by, approved_at }
}
```

`commons/spec` adds the field (optional; a companion with no animation keeps the initial-letter `Avatar`). The package validator checks every file
against the spec (size, fps, frames, bytes, codecs, the PNG fallbacks) and refuses a package that misses it with a plain sentence.
Band rule unchanged: the clips are art, the band comes from the robot's controls (dynamic-companions). A kid-safe flag is set at review.

## 8. The pipeline (authoring)

A new Stack role `companion_art`, a job queue entry, not a new engine: it chains calls to the image worker and the video worker
that already exist, under the existing resource order (chat, then images, then video; queue, never raw errors).

1. `sheet`: normalise or generate the rest picture, three views, the card, the key colour (seconds to a minute).
2. `render`: for each state, N = 4 clips from the rest picture (135 s each at 480p): 12 states x 4 = 48 clips, about **1.8 hours** per
   character on a Studio, one clip at a time (44 GB peak; no other video job runs). Minimum viable first release: 7 states x 4 =
   about 1.1 hours.
3. `check`: automatic selection (section 5.4), keying, despill (remove the key colour's glow from edge pixels), temporal matte smoothing.
4. `fit`: loop closure and return-to-rest.
5. `encode`: stacked alpha, AV1 and H.264, plus the PNG fallbacks. **ffmpeg is not installed on this Mac** (checked 2026-10-21).
   Encoding needs it (libaom or SVT-AV1 for AV1, x264, and `alphaextract`/`vstack`); the Stack would pin an LGPL build, download not vendor,
   as for the other engines (RELEASES-AND-DEPENDENCIES). A decision for the build row, not an owner question.
6. `review`: the approval screen (section 5.6), then the package is signed like any companion package.

A household that makes its own character runs the same job on its hub in the background; at 1.8 hours it is an overnight-class job,
and only on hardware that can run video at all (p128; video is off on smaller tiers per the video note). Bundled characters are
rendered once by us and ship as files, so a Mac that cannot generate video still shows a character.

## 9. Open items and what is measured vs not

| Item | Status |
|---|---|
| Wan2.2 5B I2V holds identity over 5 s | **Measured once** (robot clip). Needs a bench on three styles (animal, robot, person-like) x 12 states |
| Flat key colour holds for the whole clip (no background shading, no colour spill) | **To measure**; FastWan's saturation and contrast bias is the risk |
| Image-embedding and colour-drift thresholds | **To measure** |
| Output size per clip, AV1 vs H.264, 480 x 960 | **To measure** against the 600 kB target |
| WebGL stacked-alpha player in Safari, Chrome, Firefox, and the mobile webviews | **To build and test** (the Archibald component is MIT-style on npm; licence to read before using it, else write the 60-line shader) |
| Sheet views by Klein reference edit hold identity | **To measure**; Klein kept scene identity in the edit bench, characters unmeasured |
| Wan-Alpha (true RGBA) | Later bench; no MLX path |
| Later-frame anchors | VIDEO-EVAL-03 |
| Tiny decoder for faster clips (VIDEO-GEN-11) | Cuts 130 s toward 60 s; pays back the 48-clip render time |
| Robot screens, Go | The StackChan screen cannot play these; it keeps the robot's own face. Go (Apple TV, iPhone) plays HEVC with alpha natively through AVPlayer, so a third encode is a Go row, not this note's |

## 10. Rule check

- **Rule 9 and principle 6:** the player is the kit `Avatar` slot; the missing video mode is added in `commons` first, never forked.
- **Principle 4:** one `CompanionMediaSpec`, one manifest field. **Principle 1:** the video and image workers are reused; no new engine.
- **Privacy:** clips play from the hub; authoring uses local models; a rights line gates uploaded pictures; a real person's picture
  goes through likeness consent; nothing leaves the home.
- **Safety:** clips are package art, reviewed and kid-safe flagged; the band comes from the robot controls, not the art. Absolute lines
  for generated content apply to the character picture (no sexual content, no minors in adult content); the post-render check gap
  (VIDEO-GEN-12) is unchanged.
- **Errors:** a failed state render says what failed and offers "Try again" (next seeds); a package that misses the spec says which file and which number.
- **Needs the architect:** this supersedes a decided Q1 of the assistant-layer plan (Rive). It is Jesse's call (his ask), not a rule change.

## 11. Proposed build order (rows to add, each 1 to 3 files for one task)

1. **CMEDIA-SPEC-01** (spec first, `commons`): `CompanionMediaSpec` plus the manifest `animation` video shape and fixtures.
2. **CMEDIA-BENCH-01** (bench, no product code): three characters, key colour hold, identity drift over the 12 states, size, thresholds. Decides whether the plan stands.
3. **CMEDIA-PLAYER-01**: kit `Avatar` video mode (commons) and the state machine in Home, with PNG fallback and tests for the priorities.
4. **CMEDIA-SHEET-01**: the character sheet flow (upload, generate, edit, approve), reusing the image editor.
5. **CMEDIA-RENDER-01**: the `companion_art` job (render, check, fit, encode) with the pinned ffmpeg.
6. **CMEDIA-REVIEW-01**: per-state approval screen and package signing.
7. **CMEDIA-BUNDLE-01**: render and ship one bundled character first (Sprout, `lively-child`), then the others.

Sources: [Rotato](https://rotato.app/read/transparent-videos-for-the-web), [Archibald](https://jakearchibald.com/2024/video-with-transparency/),
[Wan-Alpha](https://huggingface.co/htdong/Wan-Alpha/blob/main/README.md), [Figma](https://www.figma.com/resource-library/ai-character-consistency/),
[Scenario](https://www.scenario.com/blog/ai-sprite-generator).

## 12. The companion editor (owner ask, 2026-10-21)

Owner ask (Jesse): an editor where he sets the name, description and prompt, and either uploads images or videos or has them generated.
This is the design pass that COMPANIONS-STUDIO-01 was waiting for; it replaces that row with the slices in section 12.6.

### 12.1 Where it lives and who may use it

- **Entry:** a "New companion" button and an "Edit" button in the Companions app ([companions-app-2026-10-21.md](companions-app-2026-10-21.md)),
  route `/companions/:id/edit`. Not a new rail icon.
- **Who:** an adult or an admin creates and edits a household companion. A child or teen never sees the editor (a teen editor is a
  later owner question). Editing a bundled companion makes a household copy; the bundled package is never changed.
- **Storage:** a household companion is stored on the hub as the same manifest shape and the same media files a package has
  (`companion` block, `animation` block of section 7), in the hub's data folder, and read by the same `loadManifestOnly` path as the
  bundled ones. One definition, no second store. "Export as a package" (signed) is a later slice and is the route to the catalog.
- **Status:** `draft`, `rendering`, `needs review`, `ready`. Only `ready` companions can be assigned to a person or robot. The editor
  autosaves drafts. Render progress rides the existing job status mechanisms (no new status UI).

### 12.2 Three tabs, one record

| Tab | Fields | Notes |
|---|---|---|
| **Identity** | name, pronouns, one-line description (`tagline`), about text (`backstory`), interests | Plain text, length caps from the spec |
| **Voice and style** | personality dials (formality, complexity, engagement, filler density), behavior lines (six at most), example lines (shared plus one set per band), the voice picker | All data in the manifest; the composer orders and clamps it. **There is no free-form system prompt**: a "prompt" the editor writes is data the composer places inside the band rules, never text that can loosen them (RULES.md rule 0, dynamic-companions decision 3) |
| **Look** | the **look prompt** (the words the image and video tools start from), reference pictures or video, generated candidates, the character sheet, the 12 states | Sections 4 to 6 of this note |

### 12.3 The Look tab: upload or generate, then approve

1. **Start.** Two buttons: **Upload** (pictures, or a short video of the character) and **Generate** (type or edit the look prompt,
   press Generate, four pictures in about 4 s each). Both can be mixed: upload a sketch, then generate variations from it.
2. **Edit.** Any picture opens the existing image editor (Comment edit, Remove BG, Erase). Every change is a new version with Undo.
   "More like this" sends the chosen picture back as the reference for four new ones.
3. **Approve the sheet** (rest picture, side views, mouth-open view, description card, key colour; section 4). The description card is
   written from the picture and is editable text; it is the single text every clip prompt starts with.
4. **States grid.** Twelve cards, one per state (section 6). Each shows its clip looping over a checkerboard, with a toggle for the
   light and dark theme backgrounds, and its **motion sentence** (editable, defaults from the template). Per card: **Generate**
   (four takes from the rest picture, best one shown, others under "Other takes"), **Upload clip** (see 12.4), **Redo**, **Approve**.
   A **Generate all** button queues every state; the editor shows "7 of 12 ready" and never blocks on a render.
5. **Ready** when the required states (idle, thinking, working, speaking, needs_you) are approved and the Identity and Voice tabs are valid.
   A missing optional state falls back to idle.

### 12.4 Uploads

- **Pictures:** PNG, JPEG or WebP, at most 20 MB, at least 512 px on the short side. Normalised to the image spec (section 2): background
  removed with the Stack's IS-Net, composited on the key colour, centred with the margin. The original is kept as a version.
- **Videos:** MP4, MOV or WebM, at most 30 MB, at most 10 s, no audio kept. A video with an alpha channel (transparent WebM or HEVC
  with alpha) is used as is; any other video is keyed by the key colour if it has a flat one, else by IS-Net per frame with temporal
  smoothing (the fallback in section 3). Either way the encoder re-times to 24 fps, crops and scales to the spec's 480 x 480, fits the
  loop, and stacks the alpha. **The uploaded file is never played as is**, so the spec holds for every clip however it arrived.
- **Checks:** the same drift checks of section 5 compare an uploaded clip with the approved rest picture. A clip that fails one is
  shown with the reason ("the colours are far from the approved character; use Generate, or replace the clip") and the person can still
  override it with a confirm, because they own the character.
- **Rights and likeness:** an upload carries the line "you made this or have the right to use it". A picture or clip of a real
  person goes through the likeness consent path ([likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md)) or is refused with the
  reason. Nothing is uploaded anywhere outside the hub.

### 12.5 Safety of an authored companion

- **The band comes from the robot's controls, never the companion** (dynamic-companions). An authored companion therefore cannot loosen
  a child robot, whatever text it holds.
- **Audience floor:** a new companion is created as `adult` (usable only on adult-controls robots and by adults). Setting it to `teen`
  or `all` needs an admin, and `all` shows a review checklist (no profanity in examples or behavior lines, no romantic or violent
  persona, the look is suitable for children) that the admin confirms; the confirmation, who and when are stored with the companion.
  The word lists and the review live in Home, not in a learned classifier (RULES-AND-LEARNED-COMPONENTS).
- **Prompts and pictures** pass the content policy and the household-name gate the image and video tools already use before any job
  is queued; the absolute lines (no sexual content involving a minor or anyone who looks like one, no non-consensual imagery of a real
  person) are enforced before render. The post-render check gap (VIDEO-GEN-12) stays open and is named on the Look tab's review.
- **Provenance** (tool, model hash, prompt, seed, who approved, when) is saved with every picture and clip.

### 12.6 Rows (each one to three files per task, spec first)

| Row | What | After |
|---|---|---|
| **CMEDIA-SPEC-01** | `CompanionMediaSpec`, manifest `animation`, `companion.status`, authoring limits (commons) | none |
| **CMEDIA-EDITOR-01** | Household companion store and routes (create, read, update, status, delete, copy a bundled one), same manifest shape | SPEC-01 |
| **CMEDIA-EDITOR-02** | Identity and Voice and style tabs, kit form pieces only, validation errors in plain sentences | EDITOR-01 |
| **CMEDIA-EDITOR-03** | Look tab, pictures: upload, generate, edit in the existing editor, sheet approval | EDITOR-01 |
| **CMEDIA-EDITOR-04** | States grid: generate, upload, redo, approve, preview over checkerboard (a kit video preview prop if the kit lacks one) | EDITOR-03, RENDER-01 |
| **CMEDIA-EDITOR-05** | Audience review and the `all` checklist | EDITOR-02 |

Replaces COMPANIONS-STUDIO-01. The editor can ship in slices: Identity and Voice first (no video needed), then pictures, then states.

## 13. The states grid and the finishing step (2026-10-21, decisions for the build)

Owner ask (Jesse, 2026-10-21): build the editor's states grid next: generate, upload, redo and approve a clip per state.

**Correction to section 8.** "ffmpeg is not installed on this Mac" is true of this Mac's PATH and beside the point: the Stack already carries ffmpeg
(the video environment bundles `imageio-ffmpeg`; the media service pins jellyfin-ffmpeg), and Home has no frame pipeline of its own (it uses `sharp` for
pictures only). The engine computer can also be another machine than the hub, so Home must not assume a local ffmpeg.

**Decision: the finishing step is a Stack job.** A new job kind `video.companion_clip` (Stack repo, in the video environment, no new dependency) takes a
finished clip and returns the shipped files. Home never decodes or encodes video.

| | Contract |
|---|---|
| Input | a source: a finished video job id of the Stack's own (`/v1/videos/generations/{job}`) or an uploaded file (mp4, mov or webm, at most 30 MB, at most 10 s); `key` (the character's key colour, or `none` for a clip that already has alpha); `kind` (`loop` or `oneshot`); `min_seconds` and `max_seconds` from the vocab; the rest picture's character colours (hex list) for the checks |
| Steps | decode frames; cut the background (the same unmixing as `keyOut` in Home's `companionLook.ts`, ported once into the Stack and held equal by a shared fixture test; a clip with alpha skips it); smooth the matte over time (3-frame median on alpha); crop the character's box centred into 480 x 480 (fixed scale for the whole clip, never per frame); 24 fps; loop fit (find the best start and end frame pair within the allowed window and cross-fade the join over 4 frames; a one-shot blends its last 6 frames toward its first); stack colour over matte; encode H.264 (required) and AV1 (when the encoder exists) at the vocab's size budget; write the rest frame as a transparent PNG |
| Output | `clip.h264.mp4`, `clip.av1.mp4` (optional), `still.png`, `report.json` with the measured numbers: seconds, frames, bytes per file, mean colour distance of the character to the given colours, character box area drift (largest and smallest over the clip, as a ratio), first-to-last frame difference, share of opaque pixels per frame (min and max), and `ok` plus `reasons` against the vocab's limits |
| Job | an idle-priority job on the media queue (it is CPU work, not the graphics queue); progress by frame; cancel; results fetched by `GET /v1/videos/companion-clips/{job}/{file}` and kept until Home deletes them or seven days pass |
| Not in the Stack job | choosing the best of four takes (Home reads the four reports), prompts, the character card, approval |

**Home's part.** For one state: the editor submits up to four takes through the existing video submit (image to video from the rest picture composited on the key
colour, prompt = the description card verbatim + the state's motion sentence, seed varied, `quality: quick`), one take at a time because a clip holds 44 GB;
each finished take goes through the finishing job; Home keeps the report and the files of each take; the best is the `ok` take with the smallest colour distance
(ties: smallest area drift); the rest are "Other takes". Redo makes up to four more. An **uploaded clip** goes through the same job (key colour from the sheet, or `none` for a transparent WebM).
Approve stores the chosen take as the state's clip in the companion's `animation` block (`h264`, `av1`, `still`, `loop`), with provenance (take seed, model, prompt hash, approver, time).
A state's files live in `<companion folder>/states/<state>/`.

**The grid.** Twelve cards in the vocab's order, required ones marked. Each card: the state's name and the plain "when it plays" line, the motion sentence (editable), the approved clip looping
over a checkerboard with a light and dark toggle, and buttons Generate (or Redo), Upload clip, Approve, Remove. While a state is rendering its card shows the take being made and
the position ("take 2 of 4"). Generate all queues the missing states, one at a time. The page says "7 of 12 ready" and which required states are missing.
A companion can be marked ready only when every required state has an approved clip (the status route adds that rule once the grid ships; until the grid exists the existing rule stands).
Playback in the grid is the real player (CMEDIA-PLAYER-01): until it ships, the grid draws the H.264 stacked file in a `<video>` with the matte applied by a small canvas shader.

**Build order (each its own gated slice):** (1) Stack: `video.companion_clip` and its route, tested with a synthetic clip; (2) Stack release and the pin in Home (the installer digest table);
(3) Home: states store, take orchestration, routes; (4) Home: the grid page and the preview shader; (5) a real run on the Studio, which is also CMEDIA-BENCH-01's first data.
The key-colour bench is still owed and is now cheaper: the finishing job's `report.json` is its measurement. If the bench shows FastWan does not hold a flat background, the finishing job's
cut-out is replaced by a per-frame segmentation fallback, and nothing else in this section changes.

## 15. First real run: Rivet (2026-10-22, CMEDIA-BENCH-01, first data)

Jesse asked for pictures and clips of one companion to judge. Run on the Studio against the live Stack (picture model FLUX.2 Klein 4B, video model Wan2.2 FastWan), calling the engines directly; nothing was installed or changed on the hub.
The companion was Rivet (a small robot). The finished review page is `data-scratch/evaluations/rivet-evaluation.html` (local only).

**What was made.** Four pictures from one prompt in about 40 seconds (1024 square, same look prompt template as section 4). One picked (the one that smiles) and cut out on a hue key. Five clips from that picture at **480 x 480, 3 seconds**:
idle (two seeds), thinking, speaking, greeting. **57 to 60 seconds per clip** (the 832 x 480, 5 second size of the first bench took 130 to 140 seconds), 0.9 to 1.1 MB raw each.
Finished through the Stack's `media.companion_clip` job: **83 to 213 kB per H.264 file** (budget 600 kB), AV1 100 to 350 kB, 2 second loops (one-shot 3 s), loop gaps 0 to 2.4 on a 0 to 255 scale, size steadiness 1.00 to 1.17.

**What held.** One character in every clip (shape, face, outfit). The motions read: thinking raises a hand, speaking opens the mouth, greeting waves. The transparent result plays cleanly over a checkerboard, white and black in a browser through the WebGL shader.

**What did not hold (measured by looking at frames).**
1. **Colour drift.** Dominant colours of the rest picture: yellow (248,200,72), orange (248,136,56). Of the clips: yellow (248,200,8), red (248,56,8). The model re-saturates (the first bench called this the DMD look). A black outline also gets heavier and small extras appear (eyebrows). A one-shot that blends its last frames toward frame 0 therefore shows a visible colour step at its end.
2. **Scale jump.** Frame 0 is the start picture; within about 15 frames the character grows about a third larger. The finishing job's loop window (start 0 to 12) happens to skip most of it for loops; a one-shot starts at frame 0 and keeps the jump (greeting: size steadiness 1.17).
3. **Muted green.** The picture model's "plain solid green background" came out as about (113,174,112), not (0,255,0), and the video model shifts it by a few shades between frames.

**Findings that change the build (status 2026-10-22: START-01, SIZE-01, KEY-01, ALPHA-01, COLOUR-01, LOOP-01 and MEM-01 are built and landed in Home and the Stack; the colour check limits are still first guesses until a real clip is re-measured through the fixed path).**
- **CMEDIA-START-01 (design break, high).** The Stack refuses a clip whose start picture was not made by the Stack, unchanged ("That picture was not made by this computer's image generator", code `reference_not_generated`). `startStateTakes` composites the rest picture onto a key-colour canvas first, so **in production every take would be refused**. Fix: the start picture is a Stack-made picture used as it came out (the approved look picture itself, or a Klein reference edit of it), and the clip is made square (480 x 480 or 608 x 608) so no crop is needed. The sheet's rest picture keeps its background in the clip's start; the transparent cut-out is for display and the still only. Uploaded pictures reach a clip only through a Klein edit.
- **CMEDIA-KEY-01 (high).** Keying must work on the background that was actually drawn, not on a pure key colour: estimate the background from the border of the first frame, and key on how green (or magenta) a pixel is (`g - max(r, b)`, thresholds 12 and 44 worked on Rivet), with the unmix against the estimated background and a green clamp on edge pixels. Both `keyOut` (Home, pictures) and `keyOutRgba` (Stack, clips) assume a pure key today, so both are wrong for real model output. Keep the pure-key unit tests (a red disc on pure green and magenta) passing.
- **CMEDIA-ALPHA-01 (Stack, medium).** The finishing job decides a clip has alpha from the pixel format name. A real VP9 WebM with alpha reports `yuv420p` plus an `alpha_mode` tag, so a genuine transparent WebM is refused as `no_alpha`. Read the stream tag as well.
- **CMEDIA-COLOUR-01 (medium).** Add a per-clip colour match to the rest picture's palette in the finishing job (a global transform toward the rest picture's colours, fixed strength) and use the rest picture's own palette for the colour check, then re-measure. Until then the check will fail most takes; its limits stay first guesses.
- **CMEDIA-LOOP-01 (medium).** A one-shot should also skip the first 15 to 20 frames (the settling jump) and blend toward its own post-settle first frame, not frame 0.
- **CMEDIA-MEM-01 (medium, Stack).** The memory guard stayed "paused" for 1 to 3 minutes after a pressure event even with 100 GB available, and cancelled a running clip at 21 and 37 percent when a 23 GB chat model loaded beside it (swap was 9.7 of 11.2 GB, left over from the coder speed test). The 480 x 480, 3 second size succeeded. Home should wait on the Stack's memory state and retry a cancelled take once instead of reporting a failure.
- **CMEDIA-SIZE-01.** Make the take size square 480 x 480 and 3 seconds (the spec's ship size) instead of 832 x 480 and 5 seconds: about 2.3 times faster and light enough to run beside the chat model.

## 14. The player and the companion in chat (2026-10-21, CMEDIA-PLAYER-01)

Owner ask (Jesse, 2026-10-21): build the kit player and the Avatar state machine so companions show up in chat.

**Where it lives.** The player is a kit Element, not a Home component: `CompanionAvatar` and `StackedAlphaVideo` in `commons/ui` (release `ui-v0.5.309`), with the state machine as a pure module
(`companion-avatar-machine.ts`: no React, no DOM, no clock, tested with an injected clock and random). Home draws it with the kit Element as shipped (rule 9, no wrapper, no className that changes it).
The editor's temporary preview (`StackedAlphaPreview` in Home) is still there and works; replacing it with the kit element is a follow-up row (CMEDIA-PLAYER-02).

**Which state plays.** The host passes live booleans; `pickWanted` takes the highest of `needs_you`, `speaking`, `working`, `thinking`, `listening`, `sleeping`, else `idle`.
A loop clip switches to a different wanted state only at its loop point (at most one clip length, 4 seconds, later); a one-shot plays once and returns to the wanted state;
`needs_you` and `speaking` interrupt a one-shot at once; a one-shot (greeting, oops, celebrate, idle_look) is ignored while `needs_you` or `speaking` is current or wanted. `idle_look` plays itself every 20 to 40 seconds while idle.
A state with no clip falls back to idle; a clip that will not load removes that state for the session; an idle that will not load hides the character and the chat is unchanged.
Reduced motion, a hidden tab or no WebGL shows the state's still. The character never announces anything: the wrapper is one `role="img"` named for the companion, no live region.

**What drives it in chat (Home).** `thinking`: the thread is running and the reply has no text yet. `working`: a tool call is running, or a job in this conversation is running. `speaking`: the chat page's spoken-reply flag.
`needs_you`: a job of this conversation waits for the person, or an approval is pending. `sleeping`: ten minutes with no activity. One-shots: `greeting` the first time the chat opens each day for that person (kept in the browser), `oops` when the last reply ended in an error, `celebrate` when a job of this conversation finishes.
`listening` and `happy` are wired only where a clean signal exists; the wiring task's report says which.

**What it plays and for whom.** `GET /api/companions/avatar` returns the signed-in person's active companion when they may use it, it is ready and it has an idle clip (otherwise `{ avatar: null }` and nothing is drawn).
The approved clip files are served to anyone who may use the companion, with Range support and an etag (a file name repeats after a redo, so no long-lived cache). Placement in this version: the thread's top-right corner (`ThreadViewportExtra`),
a smaller size on a phone, with a "Hide the character" control that is remembered in the browser. Not in this version: the large launcher bubble, the robot's screen, the Apple TV client.
