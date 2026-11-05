# Higgsfield video feature list against Home (2026-11-05)

Owner request (Jesse, 2026-11-05): compare the Higgsfield video feature list with what Home has, and build the gaps. Answers: build
frames, characters and storyboard first; cloud-only features are marked later and benched before any button exists. Compared against
`origin/main` at aeca7aa0c. Designs already exist for most rows: [video-create-2026-11-01.md](../design/video-create-2026-11-01.md),
[video-still-first-2026-11-02.md](../design/video-still-first-2026-11-02.md), [video-chat-2026-11-02.md](../design/video-chat-2026-11-02.md),
[video-tiers-2026-11-02.md](../design/video-tiers-2026-11-02.md), [media-editors-2026-10-31.md](../design/media-editors-2026-10-31.md).

Status words: **Built** (code on main), **Designed** (note and backlog row, no code), **Local later** (a local model must pass a bench
first), **Not planned** (no local model and not in scope).

| Higgsfield feature | Home today | Next step |
|---|---|---|
| Text to video (model, length, size, audio) | Built: `generate_video`, three resource tiers, look, camera, voices, portrait or landscape | none |
| Image to video | Built on Wan, LTX-2.3 and LTX-2.5 (Stack VIDEO-INPUTS-01 landed: start picture and end picture) | none |
| Reference to video (pictures, video, audio) | Designed: `references` slots, `audio` and `video` kinds | VIDEO-INPUTS-03, -05, -06 |
| Start and End frame, keyframes | Stack built (LTX-2.5 start and end picture); Home `end_frame` argument and slot not built | VIDEO-INPUTS-03 |
| Multi-shot and AI director | Storage built: Productions hold episodes, scenes and shots (PRODUCTION-01, backend only). No render, no director | PRODUCTION-VIDEO-01 (new) |
| Camera and lens presets | Built: 8 camera moves, 5 looks, sample loops. Lens, era looks, speed ramps: not built | later row below |
| 3D angles, virtual reshoot | Local later | LOCAL-VIDEO-GAPS-01 |
| Storyboard, nine views from a still | Designed (Storyboard); nine views Local later | V5 |
| Cast, places, props (Soul ID, Elements) | Built, backend only: saved subjects (IMG-SUBJECT-01) and Productions with cast, sets and props (PRODUCTION-01), landed 2026-11-05. Not yet used by `generate_video`, no UI. VIDEO-CREATE-01 V4 is replaced by these | PRODUCTION-VIDEO-01 (new) |
| Emotion and performance direction | Prompt text only | none planned |
| Motion transfer, Genjutsu | Local later | LOCAL-VIDEO-GAPS-01 |
| Prompt-based video edit, retake | Designed: `retake`, needs a bench | VIDEO-INPUTS-04, -06 |
| Object, outfit, text replacement | Local later | LOCAL-VIDEO-GAPS-01 |
| Face swap, recast | Local later; consent rules apply (likeness) | LOCAL-VIDEO-GAPS-01 |
| Restyle, Mixed Media | Partly built (looks apply at generation); restyle of footage Local later | LOCAL-VIDEO-GAPS-01 |
| One-click effects, transitions | Designed as built-in prompt recipes | V1 recipes |
| Video extension | Built: Continue from last frame (EDITOR-15). Stack extend and retake on Max landed (LTX25-EDIT-01); Home does not call them yet | VIDEO-INPUTS-06 |
| Reframe, aspect conversion | Not built | LOCAL-VIDEO-GAPS-01 |
| Background removal, depth map | Cutout exists for companion clips; not for generated clips | LOCAL-VIDEO-GAPS-01 |
| Relight, grade, HDR | Not built | LOCAL-VIDEO-GAPS-01 |
| Upscale, frame interpolation | Designed benches: VIDEO-EVAL-02, -06; LOKI-PORT-02 | benches |
| Native audio | Built on LTX tiers (speech, sound) | none |
| Lip sync, talking avatars | Designed bench: `lipdub` blocked without a Stack-owned LoRA | VIDEO-INPUTS-04 |
| Voiceover, cloning, dubbing | Built: voice or song over a clip (Studio, `mix`). Dubbing and translation not built | LOCAL-VIDEO-GAPS-01 |
| Presenter shorts, reels, faceless, explainers | Not built | LOCAL-VIDEO-GAPS-01 |
| Product ads, UGC, ad variants, hook scoring | Not planned (URL-driven ads need outside sources) | none |
| Canvas workflows, API, MCP | Home chat is the workflow surface; the Stack has a job API | none |
| Model catalog (Kling, Seedance, Veo, ...) | Not planned: cloud models. Local catalog is LTX and Wan | none |

## Build order agreed with the owner

1. Done in the Stack: picture start and end picture on LTX-2.5 (VIDEO-INPUTS-01), extend and retake on Max (LTX25-EDIT-01).
2. Home: `end_frame` argument and slots (VIDEO-INPUTS-03), still first (VIDEO-INPUTS-02), Home calls for extend and retake (VIDEO-INPUTS-06).
3. PRODUCTION-VIDEO-01 (slice A, saved subjects on `generate_video`, built 2026-11-05): `generate_video` takes saved subjects and a production shot (cast and places as start pictures and prompt text), so characters stay the same across shots. Characters are not rebuilt: V4 is dropped in favor of IMG-SUBJECT-01 and PRODUCTION-01.
4. Storyboard render: play a production's shots in order and join them (needs EDITOR-11; the `ClipTimeline` sign-off).

Items 1 and 3 touch the Stack and `commons` and each has a bench before its button, so they land as separate slices.
