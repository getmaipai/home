# Companion characters as pregenerated video (2026-10-21)

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
| Length | n/a | 121 frames (5.04 s) | Loops: trimmed to a seamless loop between 2.0 and 4.0 s; one-shots: 1.5 to 4.0 s | Whole-second variety is not needed; short files are small |
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
