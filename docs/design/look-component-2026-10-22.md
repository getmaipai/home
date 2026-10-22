# Look: one component that names what is in a picture (proposal, 2026-10-22, second draft)

Status: architect ruled NEEDS-RULE-CHANGE on this draft (2026-10-22): all seven earlier blockers are met and only Jesse's word on R1 was
left. **Jesse approved the R1 edit and the robot's own fast pass in chat on 2026-10-22** (see "Decisions"). Nothing is built beyond
measurements. Owner direction (relayed from Jesse, 2026-10-22): the robot's background look must be light and local with detail on
demand; no tactical interim, the proper design first; the same component should later serve chat photos and library photos; no model
downloads beyond the one detector until this is ruled on.

## Supersedes

- Robot vision R1's caption-only path (a robot picture is described once by the chat model and kept as one sentence): R1 is edited, see
  "Rule change" below. R2, R3 and R4 stand.
- "A second look model", listed under "Not built here" in [robot-vision-2026-10-21.md](robot-vision-2026-10-21.md): Look is that model.
- The bot-only tags path in progress on a bot branch (`objects.py`, `scene_tags.py`, a tags JSON route): not landed, not shipped. Its
  detector code and measurements are kept as the robot's standalone fast pass (below) and as the evidence in this note.
- The `0.2.44` scene poster in the bot (a picture to the chat model every minute): switched off in bot 0.2.45 until Look exists.

## What it is

`look(image, detail = "fast" | "detailed", vocabulary?) -> LookResult`

```
LookResult {
  objects: [{ label, count, score, box, attributes: { colour?, kind?, make?, model? }, uncertain }],
  scene:   { room_type?, light, colours: [..], tags: [..] },     // ranked, with confidence
  cost:    { ms, tier }
}
```

- `fast`: no language model. Tier 1 is a COCO detector (boxes, counts) plus cheap colour and brightness statistics. Tier 2 (optional,
  skipped when the host is busy) is an image-embedding tagger: the picture is embedded once and compared with text embeddings of a
  household vocabulary computed ahead of time, so a few hundred prompts cost dot products.
- `detailed`: for each object the fast pass found (never a person: no crop of a person is ever sent, and no detail describes a person or
  a body), crop it and ask the Stack's `vision` role for colour, kind, make and model with a confidence and an `uncertain` flag. Only on
  request or for an object that is new or changed; an uncertain make or model reaches the chat model marked as a guess (R3).
- Pictures and crops are held in memory only and dropped when the call returns.

## Where it lives: the Stack, reusing what exists

Placement: **the Stack** (engine side; Home is its only caller, rule 11). Reuse check, part by part:

| Part | Reuse | Decision |
|---|---|---|
| Tier 1 detector | The Stack's `image-tools` component (onnxruntime, numpy, pillow, opencv, no torch; `stack/docs/components.md`) | A new tool in that component runs YOLOX-nano. No new engine family. |
| Tier 2 tagger | The Stack image-embedding capability that IMG-VISION-SHADOW-01 already waits on (Home BACKLOG, "a Stack image-embedding capability under rule 11") | One embedding capability serves both. If it is not built yet, LOOK-01's tier 2 waits for it; tier 1 does not. |
| Detailed pass | The Stack's `vision` role (VISION-01b, Qwen3-VL-4B-Instruct Q4_K_M, Apache-2.0) | No new small VLM. |
| Tracking across frames | A maintained tracker, not hand-written matching: candidates norfair (BSD-3-Clause), ByteTrack (MIT) or supervision's tracker (MIT). | Chosen at build time by licence and install weight; a hand-written IoU match only if none fits, with the reason recorded. |
| Queue "chat, then images, then video" | The Stack's governor (STACK-13a, STACK-13b: "prove the governor across two engines") | Look jobs run through it. If the governor does not express that order for this lane, a Stack row is filed first. |

The robot keeps its own fast pass for standalone use ("the robot is complete without a hub"): the same tier 1 model and the same
`LookResult` shape, defined once in `commons/spec`. When a hub is paired the robot posts a frame and Home calls the Stack; offline the
bot runs the small detector itself. Nothing is removed from the robot.

One definition, one place: `LookResult`, the default household vocabulary (nouns, scene types, lighting, activities) and the model pins
are declared once in `commons/spec` (spec first, then Stack, then Home, then robot).

## Tracking and cache (for a camera that looks every few seconds)

`fast` runs on every analysed frame; boxes are matched across frames by the tracker. A tracked object keeps one cached `detailed` answer:
"car" at once, "blue Tesla Model 3" once verified. A `detailed` call is queued only for an object that is new or changed enough (box
area or crop colour past a threshold). **Every robot cache entry lives at most 90 seconds after the object was last seen** (the same bound
as R1's sentence); a longer cache for other callers is a separate decision with its own retention design. Budget: no language-model call
per frame, ever; at most 2 detailed calls a minute per source; all behind chat in the governor.

## Scope

LOOK-01 is the **robot caller only**: tier 1 and the cache, the posted frame, the 90 second memory, the turn context. Chat photo analysis
and library photos each get their own row and their own retention design (library tags that are stored are a new data record and need
the shared-record process).

## Measured so far (this Mac, 2026-10-22; one CPU thread, onnxruntime 1.30)

| Tier | Model | Licence | Size | Speed | Memory |
|---|---|---|---|---|---|
| 1 | YOLOX-nano 416 (COCO, 80 classes) | Apache-2.0 | 3,659,407 bytes, sha256 c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d | 13.5 ms for a 320x240 frame with letterbox, decode, NMS | +23 MB loaded, about 118 MB process after runs (49 MB is onnxruntime) |

Accuracy is not measured (no photographs are kept). Tier 2 and the detailed pass are not measured: no downloads beyond YOLOX-nano are
approved. Candidates, from knowledge and unverified: CLIP ViT-B/32 (OpenAI, MIT) or SigLIP (Google, Apache-2.0); OWL-ViT (Apache-2.0);
Grounding DINO (Apache-2.0); Florence-2 (MIT). Flagged, never the silent default: Ultralytics YOLO26 and YOLOE (AGPL-3.0, with commercial
terms on the weights) and YOLO-World (GPL-3.0). Speeds quoted elsewhere (YOLO26n about 2 ms on Core ML, VLM 3 to 6 s) are unverified.

## Rule change (approved by Jesse in chat, 2026-10-22)

Owner-approved: 2026-10-22

The robot-vision rules R1 to R4 today sit only on the unlanded branch `wt/keen-tiger-robot-vision` (commit 7a78e139b,
"Owner-approved: 2026-10-21"). ROBOT-VISION-01 must land them on `main` first; the session that lands them applies this R1, carrying
the `Owner-approved: 2026-10-22` line. R1 becomes:

> R1. **A picture from a robot is looked at once and dropped.** The robot posts one JPEG to `/api/devices/me/vision`. Home passes it once
> to the Stack's look capability (object labels with counts, scene tags, light). For a person's ask, or for an object that is new or
> changed, Home also passes it to the Stack's vision role for one short sentence or per-object details (colour, kind, make, model). No
> crop of a person is sent for details, and no detail describes a person or a body. Home keeps, per robot and in this process's memory
> only, the latest sentence, tags and details, each for at most 90 seconds after the object was last seen. It drops the picture and every
> crop when the call returns. A pending detail request holds its crop in memory only and is dropped when it expires. No picture, crop,
> sentence, tag or detail is ever written to disk, a stored turn, memory, the library, a backup, a log, a stat, telemetry or a persisted
> queue. No route returns any of them, and no person, admin included, can read them or their history (there is none). Logs carry counts
> and timings only, never a label, tag or detail.

Logging in the Look code follows that last sentence: counts and timings, never a label.

## Decisions (Jesse, chat, 2026-10-22)

- The R1 edit above: approved.
- The robot's own fast pass: yes where the robot can run it. It is a per-robot-type capability, not a rule for every robot: a Pi-class
  robot runs the small detector itself and works with no hub; a StackChan, whose body runs on the hub host with the unit as a camera and
  screen, uses the hub's Look. The robot's profile declares which, so there is one result shape and one model pin either way.

## Conditions for the build (architect)

- Look calls go through the governor as in-memory calls, not as Stack jobs with a "result by id" route (that would break R1's "no route
  returns any of them").
- A request for details comes from the robot's declared `purpose: "ask"` or from a model tool call, never from a word rule in Home.

## Open questions

- Tier 2 default model, after measurement and Jesse's approval to download candidates.
- The default household vocabulary: where it is written and who reviews it.
