# Phosphene feature review and parity plan (2026-11-13)

Source reviewed: the public Phosphene repository (MIT, a Mac app for local AI video, pictures, speech and songs): its README, `docs/`, and user docs in `webapp/docs/`.
Phosphene is a single-user panel over local engines. Home is a household hub with age gates, so a Phosphene control lands here only through
the existing pages, the shipped kit and the safety gates (RULES.md). Nothing below changes a rule.

## What Phosphene has, and where we stand

Status words: **have** (verified in code), **built now**, **partial** (some of it exists, not audited line by line), **gap**, **skip** (with the reason).

### Video
| Phosphene feature | Status here |
|---|---|
| Text to video, image to video, first and last frame | have (Create, `start_frame`, films) |
| Extend, Retake one moment | have (`edit_video` extend, retake; buttons wait on the VIDEO-INPUTS-04 benches) |
| Add sound, lip-sync to your own audio | have (talking avatar page, voiceover) |
| Colorize black and white | have (`restyle` colorize) |
| Motion Control (copy a clip's motion) | have (reference video) |
| Ingredients (2 to 8 reference pictures) | have (reference sheets) |
| Upscale and Face Fix (2x) | have as `edit_video` upscale; **built now**: `POST /api/plugins/video/actions/sharpen` |
| Make it vertical, portrait, square (blurred fill) | have as `edit_video` reframe; **built now**: `Make it vertical` on the Create feed, `POST .../actions/reshape` (vertical, portrait, square, wide) |
| Output format presets (Standard, Production, Web) | partial (hub picks one encode; a per-person choice is a gap) |
| Seed, Avoid box, Batch prompts | partial (not audited; seed and negative words are engine-side) |
| Anchor or Inspire for a reference picture | have (start frame vs. reference sheet) |
| Per-window prompts, One Shot (30 s to 2 min) | partial (films plan beats; a one-take page is a gap) |
| Storyboard planner, music video cut to the beat | have (make_film, `cut_to_beat`) |
| Editor timeline, clip bar, titles, transitions | have (Studio, `title_card`, `transition`, `credits`) |
| Export for Resolve, Premiere, After Effects | gap |
| Play all (full-screen slideshow of the gallery) | gap |
| "How it was made" panel (prompt, seed, engine, LoRAs) | partial (Remix opens the same words; no read-only panel) |
| Hide a clip with Undo, Hidden filter | partial |
| Character LoRA training from photos and voice | partial (LoRA library and characters exist; training is a gap) |
| CivitAI browser for LoRAs | have (video LoRAs, household library) |

### Images, speech, music
| Phosphene feature | Status here |
|---|---|
| Image models with versions, references, candidates | have (Images app) |
| Ideogram-style text layout canvas | gap (the layout canvas is a new kit element) |
| Speech in preset voices with worded delivery, voice cloning | have (household voices, cloned voices) |
| Songs from lyrics, covers, stems | have (Music Studio) |

### Platform and app shell
| Phosphene feature | Status here |
|---|---|
| Capability table greys unsupported modes with a reason | partial (tiers and readiness flags do this) |
| Health chip, Models window, checksum verify | have |
| Bench (fixed suite, result card) | have (bench scripts and sampling) |
| Completion chime and notifications | have |
| Keyboard shortcuts overlay | have |
| MCP server and CLI for agents | skip: Home is its own tool host; the Stack is only reachable from Home |
| Pro tier, analytics, GitHub star and X links | skip: conflicts with the privacy promise and the product model |
| Windows and Linux paths, Pinokio install | skip |

## UI choices worth keeping (and how they map)

1. **A verb goes on the bar, a property stays in the inspector.** Matches the Studio rule already built.
2. **A disabled control says what would enable it; it never disappears.** Kit rule; the Create feed hides Max when it is not offered on purpose.
3. **Icons only on dense bars, words in menus and tooltips.** Already the kit default.
4. **One edit gate, many callers.** Done again here: `clipEditStart.ts` is the one start for Spatial sound, Reshape and Sharpen.
5. **Estimate before Generate, in plain words.** Exists as the Create time words.

## Built in this pass (PHOSPHENE-PARITY-01)

- `backend/src/lib/videos/clipEditStart.ts`: the shared start of a one-click clip edit (edit gate, own open clip, tool run). Spatial sound now calls it.
- `POST /api/plugins/video/actions/reshape` (`shape`: vertical, portrait, square, wide; a soft blurred copy fills the space) and `.../actions/sharpen`.
- The Create feed's clip menu gains **Make it vertical**. The feed menu is capped at eight and the Studio export card at three, so the other shapes and Sharpen are reachable through chat (`edit_video`) and the two routes until a kit "more" menu exists.
- Tests in `backend/tests/videoSpatialSound.test.ts`.

## Next (each is its own change; none needs a rule change)

1. A clip "More" menu in the kit feed so every shape and Sharpen get a button (commons first).
2. Per-person output format choice (Standard, Production, Web) in Settings, passed to the Stack encode.
3. Read-only "How it was made" panel on a clip.
4. Gallery "Play all" slideshow.
5. One Take page (30 s to 2 min, beats per five seconds), after the VIDEO-INPUTS-04 benches.
6. Resolve, Premiere and After Effects export of a Studio timeline (EDL or FCPXML).
