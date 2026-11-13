# CreatorOS Studio: what comes over to MaiPai Home (CREATOR-PORT-01)

Status: design note, 2026-11-13. Owner ask (Jesse, 2026-11-13): bring all of CreatorOS Studio's functionality over, each function in the right Home app and page, on our own models where one does the job and on a named proposed model where none does. Source: github.com/thePloggy/CreatorOS-Studio (Apache-2.0), read as data by five readers; nothing was run. Their reports (kept in the session scratchpad, not in the repo): the feature audit (57 unique functions, every preset list), the UI audit, the engine audit (recipes, speed tricks, clip checks, queue), the gap map against Home and the Stack, and the editor consistency audit. Related notes this one extends: [phosphene-parity-2026-11-13](phosphene-parity-2026-11-13.md) and its [deep audit](../reports/phosphene-deep-audit-2026-11-13.md), [VIDEO-LD-PORT-2026-11-13](VIDEO-LD-PORT-2026-11-13.md), [images-app-2026-11-03](images-app-2026-11-03.md), [make-film-2026-11-06](make-film-2026-11-06.md), [talent-2026-11-07](talent-2026-11-07.md), [companion-pack-2026-11-10](companion-pack-2026-11-10.md), [reference video](../dev/reference-video.md).

## Findings

CreatorOS is a ComfyUI studio on one NVIDIA card. Its README counts 62 functions; they are 62 menu entries and 57 unique names (Restore, Movie Studio, Lip Sync, Talking Avatar and Add Sound sit in two menus). Against Home, of the 62 entries 24 are built and reachable, 3 are built with no page that reaches them, 13 are partial or designed, 22 have nothing (one of those is a duplicate row, one is the ComfyUI workflow download, which a Home rule leaves out). The biggest gaps are not models. They are pages: the Images Create page, the Film entry, the Talking avatar page and the one-take page are "coming soon" stubs over code that works. The second gap is one family of Max-only video adapters (remove people, edit by words, change background, motion copy, another angle) that one Stack route already serves for Colorizer and Ingredients. The third is a set of habits CreatorOS has and Home lacks: a clip check after every render with a re-shoot rule, a face check against the character's photo, the same job order by model, presets kept as data, and a read-only "how it was made". Home is ahead on editing (the kit editors), on safety (child and teen floors, CSAM check), on speech and music, and on the reference-picture video work, which this note builds on. Nothing in CreatorOS needs ComfyUI to be reproduced: every function has a Home place and either an engine we run or a named proposed model. What is left out is left out by a named Home rule (section 8). Four owner additions shape the plan: the reference video work gets fixed and extended first (section 5), cast members are real synths, companions and saved characters that every feature takes through one record (section 6), every made item stores what it was made from (section 7), and a synth's profile page shows its credits from that same link (section 7).

## 0. Rules that bind this work

- Rule 0 and rule 10 (`docs/design/RULES.md`): age and surface gates outrank everything; for an adult, Home blocks only CSAM, every other content decision belongs to the model. Child and teen floors, the finished-item checks and the fail-closed unrun check stay exactly as they are. Every new picture, clip, film and edit passes the same delivery gate as today.
- Rule 9 and 9b: no Home CSS and no wrapper around a kit Element. A missing prop or Element goes to `commons` first, tagged, then pinned. No fixed colours (owner rule 2026-10-19): every colour comes from theme tokens.
- Rule 11: only Stack components run models. Every new model is a Stack pin, tested, and listed in the setup wizard and in Settings, AI and models with size, licence and readiness (the REFVIDEO-PARTS-01 pattern: `shared/aiChoices.ts` jobs, words in `lib/aiCopy.ts`).
- S6: every slow job reports through the existing Activity mechanism: Home `lib/jobs.ts` `createJob` and `updateJob` feeding `lib/activity.ts`, the job's own card, the progress strip for installs. No new banner, dot, panel or toast. Each row below that starts a slow job carries this in its exit check. A fast action (under about two seconds) needs no job.
- Rule 8 of the platform principles: every feature is reviewed, then rebuilt. Section 3 records the verdict for each function.
- V1: nothing here sends a request to a live video service. Model downloads happen in the Stack from pinned revisions only.
- Reuse first (org rule, 2026-11-04). Every row below names the code or record it extends. Where grep found nothing under several names, the row says so.

## 1. What CreatorOS does better than Home today (and what Home does better)

| Area | CreatorOS | Home today | Taken |
|---|---|---|---|
| Clip check | After every video job, on CPU: black, frozen, jump, blur, face drift, camera move not seen, loop seam; one automatic re-shoot, both takes kept | `lib/videos/frameCheck.ts` (IVY-QC-01) reads only 3 to 5 stills, never says a clip is fine | Section 4.2 |
| Face check | YuNet plus SFace, two samples a second, flags a median under 0.363 | Reference video only, six frames, warns at 0.35, never retakes | Sections 4.2 and 5 |
| Job order | Waiting jobs sorted by recipe so a heavy model is not reloaded between jobs | Stack lanes and governor, resource order chat, pictures, video, rest; no grouping by model | Section 4.3 |
| Presets | Looks, lights, formats, angles, camera chips, shot-card vocabularies, reel formats, music presets as data files | 16 picture templates as `media_template` records; camera words in a tool enum | Section 4.4 |
| How it was made | Per render: recipe, seed, LoRAs, models and licences, read-only | A JSON note on the file; prompt only on the job row; no cast | Section 7 |
| Characters | Reference sheet plus 12 images plus an optional identity LoRA, applied per page | Saved subjects, model sheets, packs; no training; look is not stored as a sentence | Sections 5 and 6 |
| Start and end frames, re-shoot, next shot, coverage | One-click verbs on any picture or clip | `end_frame`, `continue`, `extend` exist; no verbs on the card | Slices 22, 23 |
| Speed | Step-distilled schedules, one temporal decode tile up to 10 s, no purge between same-model jobs, estimate table | Stack governor and tiers; estimates VIDEO-ESTIMATE-01 open | Section 4.3 and Stack benches |
| Editing | Gallery pages, mini editor | Kit `ImageEditor` and `TrackStudio`, ahead of both | Section 4.1 |
| Safety | A word blocklist and a nudity scanner on every render | Child and teen floors, CSAM check, model decides for adults | Not carried (section 8) |

## 2. Where each function goes (placement table)

Key. Row: the backlog row that builds it (CREATOR-nn is new in this note; other ids exist already). Tool: the chat tool and card; "arg" means an additive argument or `op`/`change` value on a tool that exists, so the tool count does not grow (rule 1 tool cap); two new conditional tools are proposed (`make_object`, `train_look`). Activity: yes means the job runs through `createJob` and `updateJob` and shows in Activity. "Built" means a person can already do it and nothing is needed. Models marked (proposed) are not benched; every one is in section 9. Engine names in plain words: Klein is FLUX.2 Klein 4B bf16, the video engine is LTX-2.5 (Standard, Boost, Max packs).

### 2.1 Images

| # | CreatorOS function | Home app and page | Engine and model | Chat tool and card | Activity | Row |
|---|---|---|---|---|---|---|
| 1 | Text to image, prompt rewrite | Images > Create | Klein, Z-Image-Turbo, ERNIE-Image, Qwen-Image (have) | `generate_image`, picture card | yes | IMG-UI-01, CREATOR-15 |
| 2 | Photo with references (up to 6) | Images > Create, From reference | Klein takes 2 references; a cast sheet counts as one; 6 needs Qwen-Image-Edit-2511 (proposed) | `generate_image` args `references`, `cast` | yes | CREATOR-15, CREATOR-43 |
| 3 | Try-on, Product placement, Moodboard | Images > Create, template rows | Klein with references | `generate_image` arg `template` | yes | CREATOR-14 |
| 4 | Angles on a photo (8 angles) | Images Studio tool "Angle" | Klein words now; multiple-angles LoRA on Qwen-Image-Edit-2511 (proposed) | `edit_picture` op `angle` | yes | CREATOR-17, CREATOR-43 |
| 5 | Styles: 56 looks | Images > Create templates; Settings > Styles | Klein plus image LoRAs (have) | `generate_image` arg `template` | yes | CREATOR-13 |
| 6 | Relight, 10 lights | Images Studio "More"; templates | Klein words (benched 8.5 s) | `edit_picture` op `relight` | yes | CREATOR-13 |
| 7 | Expand: 16:9, 9:16, 4:5, 1:1, plus 30% | Images Studio "More" | Klein masked fill over the new canvas (bench first) | `edit_picture` op `expand` | yes | CREATOR-17 |
| 8 | Restore photo | Images Studio; template "Restore" | Real-ESRGAN (have) plus Klein words; SeedVR2 and GFPGAN (proposed) | `edit_picture` op `restore` | yes | CREATOR-17, CREATOR-52 |
| 9 | Brush retouch (Inpaint) | Images Studio | Klein mask | `edit_picture` | yes | Built (IMGEDIT-02), IMG-STUDIO-01 |
| 10 | Transparent background | Images Studio | ISNet, Apple Vision | `edit_picture` | yes | Built |
| 11 | Photo to 3D object | Images Studio "More", Library viewer | TripoSR (proposed), then TRELLIS.2 | new conditional tool `make_object`, kit viewer card | yes | CREATOR-55, CREATOR-41 |
| 12 | Carousel | Images > Create, "Set of pictures" | Klein plus the chat model as planner | `generate_image` arg `set` | yes | CREATOR-16 |
| 13 | Product shot, Ad pack | Images > Create, Product templates; hand-off to Video | Klein references; ERNIE-Image for text on a poster | `generate_image` arg `template` | yes | CREATOR-14 |
| 14 | Create a character (4 faces, sheet, 12 images) | Images > Characters; Synths | Klein or Z-Image plus the sheet maker | `generate_image` arg `cast`; "Make a character" card | yes | CREATOR-19, CREATOR-06 |
| 15 | Train a character LoRA | Settings > Styles "Train from the sheet"; Characters | mflux LoRA training on Klein 4B (proposed) | new conditional tool `train_look` | yes | CREATOR-46, CREATOR-47 |
| 16 | Import your own LoRA | Settings > Styles | Stack LoRA routes | n/a | no | Built (VIDEO-LORA-07, -08) |
| 17 | `@` mentions of character, outfit, place | Chat composer, kit `prompt_bar` in every Create page | n/a | arg `cast` | no | CREATOR-05, CREATOR-39 |
| 18 | Depth map | Images Studio "More" | Depth Anything V2 Small (proposed) | `edit_picture` op `depth` | yes | CREATOR-44 |
| 19 | Style reference | Images > Create, "Like this picture" | Klein with the style picture as reference (CreatorOS uses Krea 2 plus a style LoRA; bench ours) | `generate_image` arg `template` | yes | CREATOR-14 |
| 20 | Photo dump (4 everyday photos of one person) | Images > Create template with a cast slot | Klein references, four scenes | `generate_image` arg `template` | yes | CREATOR-14 |
| 21 | Coverage (wide, three-quarter, tight) | Images Studio; video feed menu | Klein words | `edit_picture` op `coverage` | yes | CREATOR-17 |
| 22 | Next shot (still) | Images Studio | Qwen3-VL writes the shot, Klein draws it | `edit_picture` op `next_shot` | yes | CREATOR-17 |

### 2.2 Video

| # | CreatorOS function | Home app and page | Engine and model | Chat tool and card | Activity | Row |
|---|---|---|---|---|---|---|
| 23 | Text to video; image to video with sound; draft mode | Video > Create | LTX tiers (have) | `generate_video`, video card | yes | Built |
| 24 | One-click reel from a brief | Video > Create, Film entry | The film pipeline plus Klein, LTX, ACE-Step, ffmpeg | `make_film`, film card | yes | FILM-06, CREATOR-24, CREATOR-25 |
| 25 | Redo one shot with a new motion | Film card, Film entry | Film orchestrator (built) | `make_film` action Redo a shot | yes | CREATOR-25 |
| 26 | Voice-over per shot; cut on the beat | Built (FILM-05, `cut_to_beat`) | Pocket TTS, Chatterbox Turbo, beats engine | `make_film`, `edit_video` | yes | Built |
| 27 | Camera and effects gallery (25 presets) | Video > Create chips; Styles | LTX camera-control LoRAs through the Stack LoRA install; the Wan 2.1 LoRAs for orbit, arc and crash zoom have no LTX twin, so camera words and a bench | `generate_video` arg `camera` | yes | CREATOR-21 |
| 28 | Movie Studio shot card (camera, lens, light, film stock, 4 takes) | Video > Create "Shot card"; Film shot cards | LTX words | `generate_video` arg `card`; shot-card answer block | yes | CREATOR-20, CREATOR-25, CREATOR-39 |
| 29 | Sketch to video | Images > Create "From a sketch", then Video | LTX edge IC-LoRA (proposed) | `generate_video` arg `from_sketch` | yes | CREATOR-49 |
| 30 | 3D Scene (block a shot in 3D) | Video Studio "Scene" tab | LTX Layout-to-Render IC-LoRA plus a kit 3D blocker (proposed) | `generate_video` recipe `scene` | yes | CREATOR-49, CREATOR-41 |
| 31 | Seamless loop | Video > Create "Loop" chip | LTX with the end picture equal to the start; seam SSIM at least 0.9; the `loop` op seam is CREATOR-IP-06 | `generate_video` arg `loop` | yes | CREATOR-22, CREATOR-IP-06 |
| 32 | Green screen, transparent background | Video Studio | Apple Vision subject mask, SAM 2.1 | `edit_video` | yes | Built |
| 33 | Masters export (HLG HEVC, ProRes, EXR) | Video Studio export presets; Settings | ffmpeg on the Stack | `edit_video` change `master` | yes | CREATOR-29, CREATOR-45 |
| 34 | Upscale to 1080p; restore a clip | Video feed menu; Video Studio "Restore" | Real-ESRGAN (have); SeedVR2 (proposed) | `edit_video` change `upscale`, `restore` | yes | Built, CREATOR-52 |
| 35 | Stabilize | Video Studio | ffmpeg `vidstab` or `deshake` (Stack op, no model) | `edit_video` change `stabilize` | yes | CREATOR-45 |
| 36 | Colorize a B&W clip | Video feed menu | LTX Max Colorizer (have) | `edit_video` change `colorize` | yes | Built |
| 37 | Smooth motion (frame doubling) | Video Studio | RIFE 4.25 through rife-mlx (benched in LOCAL-BENCH-01) | `edit_video` effect `fps_boost` | yes | CREATOR-53 |
| 38 | Next shot (coverage, push-in, next beat); Extend (sequel, prequel) | Video feed menu "Next shot" | LTX extend and continue (Max); Klein stills | `edit_video` change `next_shot` | yes | CREATOR-23 |
| 39 | Re-shoot (same inputs, new seed, checks) | Video feed menu; "Another take" | Same engine | `edit_video` change `reshoot` | yes | CREATOR-10, CREATOR-23 |
| 40 | Re-shoot from a new angle | Video feed menu "Another angle" | CrossView-Warp IC-LoRA plus MoGe-2 (proposed) | `edit_video` change `angle` | yes | CREATOR-50 |
| 41 | Long take (17 s to 1 min) | Video > Create, "One take" | LONGTAKE-01 chain (built backend) | `generate_video` arg `seconds` | yes | CREATOR-27 |
| 42 | Dubbing, lip sync | Video Studio "Dub" | MuseTalk 1.5, LatentSync 1.6 or InfiniteTalk (proposed, benches in LOCAL-BENCH-02) | `edit_video` change `dub` | yes | CREATOR-51 |
| 43 | Reframe 9:16, 16:9, 1:1, 4:5 | Video feed menu | Blurred fill (built); AI edge fill (bench) | `edit_video` change `reframe` | yes | Built |
| 44 | Motion control (animate a still with a driver clip) | Video > Create "Copy motion" | LTX pose and depth IC-LoRAs (proposed); Wan2.2-Animate only as a fallback | `generate_video` recipe `copy_motion` | yes | CREATOR-49 |
| 45 | Change background; retouch by words (Ripple); place object; remove objects (Clean-Plate); add water; fix | Video feed menu; Video Studio "Retouch" | LTX IC-LoRAs on Max plus SAM 2.1 (proposed) | `edit_video` change `retouch`, `remove`, `background` | yes | CREATOR-48 |
| 46 | Swap or Mix characters (one to three people) | Video Studio "Swap character", takes a cast member | LTX IC-LoRA plus SAM 2.1 masks first; Wan2.2-Animate fallback (needs Jesse's yes) | `edit_video` change `swap` | yes | CREATOR-57 |
| 47 | Dance (34 dances, 20 studios) | Video > Create "Dance", takes a cast member | Pose IC-LoRA plus our own dance clip set (CreatorOS's mocap files are not in its repo and their licence is unchecked) | `generate_video` recipe `dance` | yes | CREATOR-49 |
| 48 | Video effects (7 LTX effect adapters) | Video > Create Styles | LTX IC-LoRAs (proposed) | `generate_video` arg `styles` | yes | CREATOR-21, CREATOR-48 |
| 49 | Editor (mini reel editor) | Video Studio (built, `TrackStudio`) | ffmpeg ops | `edit_video` | yes | Built; VIDEO-LD-03; CREATOR-33 to 36 |
| 50 | Generated transition between two shots | Video Studio, between clips | LTX with start and end pictures; the transition LoRA only after a bench (proposed) | `edit_video` change `bridge` | yes | CREATOR-60 |
| 51 | Add sound to a clip (video to audio) | Video Studio "Add sound" | LTX-2.5 video to audio (bench VIDEO-INPUTS-04); MMAudio or HunyuanVideo-Foley (proposed) | `edit_video` change `add_sound` | yes | CREATOR-54 |
| 52 | Auto clip check (black, frozen, jump, blur, face drift) | Automatic; Library badge | CPU checks plus YuNet and SFace (have) | note on the video card | no (it runs inside the job) | CREATOR-09, CREATOR-10 |
| 53 | Social check (hook, subject, tips) | Video Watch right pane | Qwen3-VL (have) plus the clip check | `edit_video` change `review` (read only) | yes | CREATOR-28 |
| 54 | Talking avatar (photo plus voice or typed line) | Video > Talking avatar | LTX quoted line now; talking-head LoRA or audio-driven route later | `generate_video` arg `cast` with a spoken line | yes | CREATOR-26, CREATOR-51 |

### 2.3 Sound, characters, library, platform

| # | CreatorOS function | Home app and page | Engine and model | Chat tool and card | Activity | Row |
|---|---|---|---|---|---|---|
| 55 | Music Studio (17 presets, lyrics, vocals) | Music > Studio, Create | ACE-Step 1.5 (have) | `make_song`, song card | yes | Built; presets in CREATOR-13 style data; Studio move CREATOR-37, CREATOR-38 |
| 56 | Sound effects | Music > Sound effects | ACE-Step now; Stable Audio 3 small sfx (proposed, MUSIC-GEN-11) | `make_sound`, sound card | yes | CREATOR-54 |
| 57 | Dialog and voice studio (preset voices) | Voices; Video Studio Voice lane | Pocket TTS, Chatterbox Turbo, Fish Audio Drama (have). CreatorOS's 7 Kokoro voices are not carried (rejected by the owner's ear, 2026-09-04) | `edit_video` change `mix`, speech tools | yes | Built |
| 58 | Voice clone | Voices | Chatterbox Turbo plus the cloner (have) | voice tools | yes | Built |
| 59 | Voice changer | Voices; Music Studio | SoulX-Singer for songs (have); Chatterbox VC for speech (proposed) | voice tools | yes | CREATOR-56 |
| 60 | Companions that talk | Synths | LivePortrait packs (have) | n/a | yes | Built (PACK, MAKER rows) |
| 61 | Character pages: list, switch, duplicate, delete, wardrobe, voice, credit | Synths page; Images > Characters | The synth and saved-subject records | n/a | no | CREATOR-04, CREATOR-19 |
| 62 | Library: review (approve, reject), folders, trash, provenance, "how it was made", play all | Library; Video Watch | n/a | n/a | no | CREATOR-18, CREATOR-30 |
| 63 | MCP server (15 tools) and agent skill | Settings > Developer | Home's own chat tools | n/a | no | CREATOR-32 |
| 64 | Diagnostics, GPU state, bug report | Settings > AI and models; Status | Stack health | n/a | n/a | Built (DIAG-REPORT-01) |
| 65 | Phone capture (QR) and live preview | Library upload; Video Create card | Stack preview jpg route (have) | n/a | yes | CREATOR-31 |
| 66 | Small-card profiles, setup wizard, French UI, mobile UI | Resource tiers, install wizard, i18n, phone layout | n/a | n/a | n/a | Built; not ported |
| 67 | ComfyUI workflows, 262 official workflows, Extensions store, workflow download, recipe import | none | none | n/a | n/a | Left out, rule 11 (section 8) |

Every picture and video row is also a template or recipe for the chat: "a template or recipe the chat can ask for" means the tool arg above exists and the Create page's button calls the same function (one definition, one implementation). A tool result opens on the existing card; the two answer blocks that are new are the shot-card summary (kit `prompt_bar` chip values) and the 3D object (kit viewer). Both are kit Elements added in `commons` first.

## 3. Verdicts (rule 8: reviewed, then rebuilt)

- Rebuilt on our engines: everything in 2.1 and 2.2 marked "Home" with an engine we run (Klein, LTX, Real-ESRGAN, SAM 2.1, ffmpeg, ACE-Step, Chatterbox). CreatorOS's recipes are not carried; only the parameters we can verify are, and each lands behind a bench row ("Each gets a bench on the Studio before any button", LOCAL-VIDEO-GAPS-01).
- Redesigned: the function page pattern. CreatorOS has three generations of page layout; Home keeps its own kit pages and one editor frame (section 4.1). Taken from CreatorOS's page pattern: a numbered steps panel with the next step marked, a preset gallery of real renders (ours are the sample renders of `media_template`), a per-page "Renders" list (Home: the Library filter), a failed card that offers "same settings, as a draft" (Home: Another take at the Standard tier), time on the button (VIDEO-ESTIMATE-01), and hover verbs on a card (Approve, Reject, One more with a new seed, Clone settings). Not taken: the "How it works" video carousel (Home has docs and the setup tour).
- Left out: section 8.

## 4. Shared pieces (one definition, used by many slices)

### 4.1 One editor frame for pictures, video and music

Source: the editor consistency audit (2026-11-13), read against kit tag ui-v0.5.627. The picture editor (`ImageEditor`), the Video Studio (`TrackStudio`) and the Music Studio (hand-written `MusicStudioView.tsx`, `MusicWaveform.tsx`, 256 plus 46 lines, not a kit Element) each draw their own header, tool buttons, history, zoom, busy card and keyboard code. The plan extracts the common parts into kit pieces, moves both Elements onto them, then moves music onto `TrackStudio`. All of it is `commons` work first, tagged; Home pins after.

| Kit piece | What it is | Used by |
|---|---|---|
| `EditorShell` (extends `studio-layout.tsx`) | header (close, title, versions, download, primary action), notices, bar, stage, inspector and footer slots; container-width `compact`; fit-height; variants pane and screen | picture, video, music |
| `EditorToolbar` and `EditorToolButton` | one tool-action table (id, label, icon, shortcut, group verb or property, enabled, reason, run) feeding the bar, a More menu and the right-click menu; a disabled tool stays visible and says why; tooltip ends with the shortcut | all |
| `EditorInspector` | right panel on wide, bottom sheet on phone; sections with title, Reset, "Selected: name"; properties live here, verbs on the bar | all |
| `EditorBusy` | one job card: name, size, wait, Stop, queue position; its `onProgress` mirrors into Activity (S6) so the picture editor's busy card reaches the Activity page | all |
| `EditorHistory`, `EditorZoom` | one undo and redo model with coalescing; one zoom control (percent, Fit, Ctrl+wheel, plus and minus) | all |
| `EditorCompare`, `EditorVersions` | before and after as slots (two pictures or two synced clips); a versions popover | all; music keeps `versions` |
| keymap and Esc ladder | one table; Esc cancels the run, closes the tool, discards the preview, closes the editor | all |
| `TrackStudio kind="audio"` | lanes for song and stems with a hue per stem, an Effects panel (EQ six bands, compressor), a BPM grid and section flags, a loop region; the Web Audio chain beside the video one | Music Studio, later podcasts |

Music Studio follows the person's theme: it draws on page tokens like the Video Studio since PRO-LOOK-STUDIOS-01, with no forced dark scheme. The `page.surface: "studio"` scope was retired and is not brought back. The Studio's `initialTool` and `initialPanel` props let Trim, Captions, Voiceover and the other "coming soon" video pages open the one Studio on a tool, as the picture Studio's pages already do. Slices: CREATOR-33 to CREATOR-38.

### 4.2 Clip quality check (from CreatorOS's `controle_clip.py`)

One module in Home (`lib/videos/frameCheck.ts` grows into it; IVY-QC-01's three tests keep their numbers) with the thresholds in one table, fed by a per-frame series. Stack work is a CPU `media.check` op that decodes the whole clip once and returns the series (luma, difference to the previous frame, Laplacian sharpness, optionally optical-flow totals); Home applies the thresholds, so there is one rule table.

| Defect | Rule (CreatorOS's measured values) | Level |
|---|---|---|
| Black | frame luma under 12 for at least 0.3 s | serious |
| Frozen | frame-to-frame difference under 0.35 for at least 1.0 s | serious |
| Jump | one frame whose difference is over max(28, 8 times the median) | serious |
| Soft | sharpness under 0.35 of the clip median for at least 0.5 s | warning; serious at 1.5 s |
| Face drift | SFace cosine to the cast member's photo, YuNet score at least 0.9, face at least 6% of frame width, two samples a second, at least 3 measures; low when the median is under 0.363 or at least max(2, n/4) measures are under it | warning (the clip is kept) |
| Camera move not seen | optical flow on every other frame at 192 px, classified fixed, forward, back, lateral, vertical, mixed; only when a camera preset asked for a move | warning |
| Loop seam | SSIM of the last 0.05 s against the first frame at least 0.9, only for a loop | warning |

Re-shoot rule: after take 1, a serious defect starts one more take with a new seed (`parent` set in the creation record, section 7); after take 2 the lower weight (10 times the serious count plus all findings; a tie keeps the retake) is the kept one and the other is marked rejected, never deleted; a take already marked as a retake is never retaken again. A film shot uses the same rule. The check never blocks a clip and never says a clip is fine; it says what it measured. The numbers come from the engine audit; each is re-measured on our clips in the slice's bench (the face numbers on the pairs IVY measured: same person about 0.36, different people 0.02 to 0.22).

### 4.3 Job grouping by model (Stack work)

CreatorOS sorts the waiting queue by recipe when more than two jobs wait, so a heavy model is not reloaded between jobs; it keeps the head in place, calls no `/free` between same-model jobs, and calls it only before jobs that need the room. Home's Stack already orders by resource class and fairness (TIER-PRIO rows). The addition is one tie-break in the Stack governor: among waiting jobs of equal priority, prefer the one that uses the model already resident, never move the head, never beat the household queue's fairness or the quiet window. Home side: the film orchestrator and batch jobs (takes, carousel, photo dump) submit by model, stills together, then clips. Related and already open: STACK-GEN-WAIT-01 (two generators waiting on each other). Slice CREATOR-42.

### 4.4 Presets as data

One definition per kind, none typed into code (principle 4). The picture and video presets are `media_template` records (spec `media-template.schema.json`, fields `kind` picture or video, `prompt`, `references`, `styles`, `aspect`, `transparent`; reader and `check.sh` validation from IMG-TPL-01; files `backend/packages/generate_image/images/templates/*.json`, video beside them). One additive spec value is needed for the shot card: `kind: "fragment"` with a `group` (camera, lens, focal, aperture, framing, light, film_stock, look, grade) and the English `prompt` fragment, so the chips of the shot card and the prompt builder read the same records. The values are carried from CreatorOS's data files in our own wording, with the Apache-2.0 attribution recorded in the NOTICE file.

| Preset family | Count in CreatorOS | Source section of the feature audit | Home form |
|---|---|---|---|
| Looks (styles) | 56 in 8 or so families | "Styles: 56 looks" | `media_template` picture |
| Relight | 10 lights, each ends with a shared keep sentence | "Relight: lights" | `media_template` picture, `references: 1` |
| Expand formats | 5 | "Expand: formats" | `aspect` values on a template |
| Angles | 8 | "Multi-Angle: 8 angles" | `media_template` words, later an angle LoRA |
| Coverage, photo dump, style reference, try-on, product, moodboard, ad pack | 3, 4, 6 chips, 3 reference presets, 6 chips and 4 formats | "Other preset sets" | `media_template` picture with slots |
| Shot-card vocabulary | 7 camera bodies, 4 lenses, 6 focal lengths, 4 apertures, 9 framings, 9 lights, 6 film stocks, 8 looks, 7 grades, a palette of up to 8 colours, 6 starter shots | "Shot-card vocabularies" | `media_template` `kind: fragment`, starters as video templates |
| Camera and effect presets | 25 (6 LTX camera LoRAs, 3 camera words, Wan 2.1 orbit, arc, crash zoom and similar, 7 LTX effect adapters) | "Camera and effect presets" | video templates with `styles`; LoRA files through the Stack LoRA install |
| Transitions | 3 editor, 9 generated | "Transitions and editor option lists" | `edit_video` options and video templates |
| Reel formats and presets | 6 formats, 4 presets plus 1 hidden | "Reel formats", "Reel presets" | planner data (CREATOR-24) |
| Music presets | 17 | "Music presets" | `song-style` records (existing spec) |

### 4.5 "How it was made" panel

A read-only panel on every picture, clip, film and song, in the Library viewer, on the Video Watch page and in the editors' version popover. It reads the creation record (section 7): model, revision and licence, seed, size, length, tier, styles, cast, sources, the check result, what it was made from. The words and the plan show to the person who made it only. Phosphene's "how it was made" idea and CreatorOS's per-render details are the same panel. A "Make another like this" and "Clone settings" button open the editor or Create with the record loaded. Slice CREATOR-18.

### 4.6 Finishing: titles, credits, transitions, looks, captions, mixing, loops

Source: the finishing comparison (a reader's report against CreatorOS and Phosphene, 2026-11-13; nothing was run, the Mac had no ffmpeg, so each bug is marked confirmed from the code or likely until a one-minute render settles it). All our finishing is ffmpeg filter graphs in the Stack (`media/editOps.ts`, run one op after another by `media/jobs.ts`); Home builds the op lists (`lib/videos/editPlan.ts`, `editTool.ts`, `films/engines.ts`, `studioPlan.ts`). Verdict: on classic transitions (20 kinds against 2), per-piece fades, beat cutting and credits we are ahead of both projects. We are behind on three things, and they are slices here: real auto captions timed to the speech (Phosphene), generated bridge transitions between two different shots (CreatorOS), and a Studio that shows the transition and look controls we already have in the Stack.

In progress, built now by other builders (listed so nobody plans them again; each is a row below marked in progress):

| Fix (finishing report id) | What is wrong | Row |
|---|---|---|
| Film assembly and per-shot transitions (B1, B2) | A faceless film of three or more shots joins footage twice and can pass the 12-op limit; a regular film ignores the planner's per-shot transition | CREATOR-IP-01 |
| Ken Burns time base (B4) | The zoom reaches its end after one second and keeps growing | CREATOR-IP-02 |
| Mix safety (B6, B7, B13) | No limiter or loudness target after `amix`; film music is not tied to the film's end; equal-power crossfade curve | CREATOR-IP-03 |
| Encode quality and colour tags (B5, B9) | Five lossy generations at CRF 20 on the film path, untagged colour | CREATOR-IP-04 |
| Credits geometry and cards (B10, B14) | Roll lines past the 15th never enter; cards have no letterbox bars | CREATOR-IP-05 |
| Loop seam (the `loop` op) | The `loop` op repeats with no seam treatment | CREATOR-IP-06 |
| Frame-snapped fades (B3, B12) | Crossfade offsets land between frames; stream-copy joins can stretch audio | CREATOR-IP-07 |

What this note plans on top of them:

| Function | Home place | Engine and model | Chat tool | Activity | Row |
|---|---|---|---|---|---|
| Auto captions timed to the speech | Video Studio Captions lane; Video Watch captions list; film card | MLX Whisper large-v3-turbo (already pinned in the Stack as `STACK_MUSIC_WHISPER`, `mlx-community/whisper-large-v3-turbo`, about 1.6 GB, Apple GPU) plus the existing forced aligner (`align/`) | `edit_video` change `captions` with no lines means auto | yes | CREATOR-58, CREATOR-59 |
| Generated bridge between two shots ("Make a transition") | Video Studio between two clips; film assembly option | LTX-2.5 already installed, first and last frame guides (`end_frame`); the transition LoRA enters through our LoRA library only after a prompt-only bench | `edit_video` change `bridge` | yes | CREATOR-60 |
| Studio transition and look controls | Video Studio seam menu (all 20 kinds) and a look chooser with a preview sheet | ffmpeg `xfade`, `film_look`, `frame` ops (have) | `edit_video` (have) | yes (export) | CREATOR-61, CREATOR-62 |
| Loop made and checked | Video > Create "Loop" chip | LTX with `end_frame` equal to the start; seam SSIM from the clip check | `generate_video` arg `loop` | yes | CREATOR-22 with CREATOR-10 |

Captions method (Phosphene's, carried): the script words are known (the clip's request holds the quoted lines, and the creation record keeps them); Whisper hears the clip with word times; the script is matched to the heard words and snapped by forced alignment; 42 characters a row, 1.0 s minimum cue, 0.35 s hold, 0.08 s lead; the existing `captions` op burns them with a 2 px outline added to the style, and `.srt` and `.vtt` are stored next to the clip and fill the Player's captions list (CAPTION-01, VIDEO-LD-05). Lines Whisper cannot hear (sung under loud music) keep the script timing from the alignment. The Whisper pin exists for the music sung-words check (MUSIC-GEN-15); the row checks it is the MLX build, and its Settings, AI and models line already lists size and licence.

Bridge method (CreatorOS's, carried): the last frame of clip A and the first frame of clip B are the two guides; nine effect sentences (morph, smoke, ink, light burst, zoom through, whip pan, wind vortex, water, melt) written in our wording as video templates; 3 to 5 s; then A, bridge, B are joined with a cut or a 0.3 s dissolve. A bridge takes the strictest lock and audience of the two clips (section 7.3). Bench first with the prompt alone, then with the LoRA.

## 5. Reference video: what we keep, change and fix

Built by another session (IVY) and live on main: FILM-REAL-07, -09, -10, -11 (the reference sheet made from the person's own photos: people and objects cut out on white, a face close-up, a drawn side view, places as panels, 768x448), REFVIDEO-01 (a video from attached pictures through the Ingredients adapter, 8 s, Another take reuses the sheet), REFVIDEO-STEPS-01 (two steps with their own progress on the chat card), REFVIDEO-PARTS-01 (face finder and Ingredients listed in the wizard and Settings), REFVIDEO-FIRSTFRAME-01 (63c643138: a real person's face starts from a first picture). Code: `lib/videos/referenceVideo.ts`, `referenceSheets.ts`, `referenceSheetCheck.ts`, `referenceFirstFrame.ts`, `lib/films/sheetMaker.ts`, `films/referenceSheet.ts`, `films/fidelity.ts`, `lib/likeness/faces.ts`; doc `docs/dev/reference-video.md`. No backlog row exists for these; this note gives them rows (CREATOR-07 to CREATOR-12, CREATOR-40).

### 5.1 Keep

- Two routes chosen in code before any work (`decideReferenceRoute`): a photographed real face goes to the first-picture route; objects, places and invented or cartoon characters take the sheet route. Measured 2026-11-12: the Ingredients adapter holds hair, glasses and clothes but not a real person's face (SFace cosine 0.02 to 0.22 against about 0.36 for the same person); a face in frame 0 does stay.
- One sheet builder (`films/sheetMaker.ts`, 768x448, the "Reference sheet:" text). No second one is built anywhere in this plan: every feature that needs a person's or object's look calls it through the cast record (section 6).
- The SFace gate on the first picture (`FACE_GATE` 0.5), the missing-model refusal (no silent downgrade), two steps with Stop in both, the "waiting for free room" line, restart keeps the first picture, the recipe saved for Another take, the cut-out and edit code loaded only on demand (VISION-02c).
- Age, surface and lock gates on the output, the CSAM check failing closed.

### 5.2 Change

- The input is a cast member, not loose pictures (section 6). The sheet is built once per cast member, stored with it and reused by every feature. Loose pictures still work: they become a one-off cast member.
- The saved recipe (`VideoRequest.reference`) becomes one creation record (section 7) with `parent_id` for Another take and a pointer from the file's provenance note. The recipe gains the cast ids it never had.
- The face check moves out of the reference route into the shared clip check (4.2) and runs on every clip that has a cast member.
- Another take, Re-shoot and Next shot (CREATOR-23) all start from the creation record, so a clip made by any feature reopens the same way.

### 5.3 Fix: the four shortcomings from the real run

1. The first picture is a collage (each person's cut-out pasted over the place; seated people standing on grass; a dark sliver left from the cut-out), because the picture editor changed faces and the face gate rejected the composed picture, so the code fell back to the plain paste (`how: "pasted"`). The fix keeps faces exact and makes the paste natural, in two slices.
   - CREATOR-07, clean cut-outs and placement, no model and no edit (sharp only, in `referenceFirstFrame.ts` or a new `firstPictureCompose.ts`): erode each cut-out's alpha by 1 to 2 px at the 768 working scale and replace edge colours with the colour just inside (removes the dark sliver); match each person's overall colour and contrast to the plate by a gentle shift in Lab (strength about 0.4, a start value, benched), which changes colour and not structure, so the face match stays; draw a soft contact shadow (a blurred dark ellipse at about 25 percent under the feet or the seat edge); place by pose. The vision model that already reads each picture's role (`pictures/roles.ts`) also answers the pose (standing, seated, cut off below the waist) and, for a seated person, a box on the place picture where a seated person fits (Qwen3-VL returns a box as JSON, schema-checked by the engine's native structured output, rule 2). A standing person is placed on a floor line at about 55 percent of the frame height; a seated person is placed in the seat box or, with no seat, cropped at the lower edge of a table or the frame, never as a full figure on open ground. No word list: the model answers, the code places.
   - CREATOR-08, harmony without changing faces: run the existing composition edit (`films/engines.ts` `submitComposition`, Klein) on the CREATOR-07 picture with a mask that is a ring of about 24 px around each cut-out's outline plus the contact zone, and never the face boxes (YuNet boxes grown by 30 percent). After the edit, each person's own face region is pasted back with a 12 px feather, so face pixels are the photo's own. The SFace gate then runs as before (`FACE_GATE` 0.5); with the face pasted back it measures the seam, and a gross failure still falls back to the CREATOR-07 picture, never to the old plain paste. If the Qwen-Image-Edit-2511 bench (CREATOR-43) passes, it replaces Klein in this step: it takes three references natively and is the composer CreatorOS uses for people in scenes. Evidence and exit: one two-person scene and one seated pair, judged by eye next to the old collage, face scores recorded, both on the Studio.
2. The clip could only be made at 512x256. The Stack measured admissions at 640x320 (5 s, 32.4 GB), 768x448 (5 s, 45.8 GB) and the Ingredients route at 768x448 (32.3 GB), under a 64 GB per-clip cap; the chat model holds 30 to 38 GB; and Home already has Reduced chat (TIER-STACK-03, `reducedChatLease.ts`: chat steps down to the Reduced model while a bigger job runs, and the Stack frees chat's host caches first, then restarts chat at a smaller window, never below 32768 tokens, `DESIGN-chat-memory-yields-to-generators-2026-10-27.md`) and the Max chat lease (TIER-HOME-05). So the first-picture clip should ask for Boost (768x448, 5 s) and Max when the person holds it, declare its tier on the job like every other Boost or Max job so the household queue and the Stack admission handle it, and show "Waiting for memory" in Activity instead of a smaller size. What is not known: which refusal fired in the real run (the per-clip cap, free memory, or Home's own `planFirstFrameClip` choosing Standard). CREATOR-11 starts with one check that decides: repeat the run and read the Stack's reason line. Exit: a 768x448 first-picture clip made on the Studio with chat idle and with chat loaded; the Activity line read; sizes checked with ffprobe.
3. One person's face match dipped mid-clip (0.32 to 0.55 against a same-person line of about 0.36). Fixes, in order of cost: CREATOR-10 measures every clip with the shared check (two samples a second, not six frames), and when the median or the n/4 rule trips it makes one automatic re-take with a new seed and keeps the better take (4.2); on Max it can re-take only from the first low timestamp (`retake_from_seconds`, Stack V route) instead of the whole clip. CREATOR-12 benches an end picture: the first picture (or a second composed picture of the same people) as `end_image`, so frame 0 and the last frame both hold the face (CreatorOS does start and end frames; the Stack route supports `end_image`; VIDEO-INPUTS-03 is the open bench). A shorter default for people clips (4 s) is a one-line option the bench decides. The optional identity LoRA (CREATOR-46, CREATOR-47) improves the first picture, which then holds the face.
4. The Ingredients sheet route scored only 0.02 to 0.22 for a real face. Keep the route for what it does well. CREATOR-12 adds the fallback: when a sheet-route clip has a real face (a cast member marked `real`, or a face the finder sees in a source picture) and the measured median is low, make one automatic first-picture take and say so on the card; the first-picture route stays the default for real faces, as `decideReferenceRoute` already does for photographed people.

Compared with the two projects, what each does better for this job: CreatorOS has the face check, the re-shoot rule, start and end frames, a Qwen-Image-Edit composer with up to six references and an identity LoRA path. Phosphene has references up to three, "Edit this picture", takes, and sending a take back in as the next reference (carried by CREATOR-15 and the Library). IVY's work already does better than both on one point: the face gate happens before the clip is paid for, and the route is chosen before any work starts. That stays.

Slices for this section, in order: CREATOR-07, -08, -09, -10, -11, -12, then -40 (the reference and cast slots in the Create panel and the shot cards, after the kit parts).

## 6. Cast: companions, synths and characters

### 6.1 What exists (read from code and notes, 2026-11-13)

Four stored records and one transient one describe a being that can appear in a picture, video or film. They are linked in one direction only.

| Record | Where | What it holds for a look |
|---|---|---|
| Synth (the being) | `lib/synths.ts`; spec `synth.schema.json` | persona (name, backstory, voice id, `look_prompt`), `based_on` (none, household_member, real_person, `minor`), `subject_id`; the folder holds the rest picture and sheet views (`companionLook.ts`) and the pack (`companionPack.ts`, spec `companion-pack.schema.json`) |
| Saved subject | `lib/mediaSubjects.ts`; table `mediaSubjects` (`db/schema.ts`); spec `media-subject.schema.json` | `kind` character, prop or place, `look` words, up to 8 reference pictures, a sheet (`mediaSubjectSheet.ts`), `real`, `sharedWith`. The spec also has `voice`, `trained_style_id`, `synth_id`; the Home table has none of the three |
| Production cast | `lib/mediaProductions.ts`; spec `media-production` | `{subject_id, role, wardrobe_variant_ids, voice_choice, notes, synth_id, part}` |
| Film plan cast | `lib/films/plan.ts` | `{name, kind, locked (400 chars), reveal_last}`; transient; `ensureSubject` matches a saved subject by name |
| Talent cast member | `lib/talent/types.ts` | audio only |

Evidence of the gaps: a synth reaches pictures and films only if `ensureSubject` made its subject, and that is called from `talent/shows.ts` only; `ensureSubject` does not write `synth_id` back; `make_film`'s `characters` argument is plain text hints and a synth's name is never resolved to a synth; `generate_image` and `generate_video` take media-subject names only (at most 3); the chat composer's `@` list is companions and sends `mention_companion_id` to make that persona answer, with nothing connecting it to `subjects`; a subject's locked sentence exists only per film plan; per-subject LoRA is in the spec and not in code (`character-consistency-research-2026-11-04.md`); the Images > Characters page and the Create cast pickers are stubs. Film cast is stored without `synth_id`, so the existing credits route finds only shows and bands built through talent.

### 6.2 The one cast record

Decision: a cast member is not a new record. It is a synth or a saved subject seen through one function. The saved subject (`media-subject`) is the look store and the one id every made item stores; a synth always has one, linked both ways (`synth.subject_id` and `media-subject.synth_id`). The talent note already rules "one synth has one name, one backstory, one voice and one life whatever it is assigned to" and keeps the two look stores unmerged "the link makes them one person"; this note finishes that link and adds nothing beside it. A prop or a place is a subject with no synth.

- Spec, additive, in `commons/spec` first (CREATOR-01): `media-subject` gains `locked_description` (a sentence of colours, markings, outfit and what is never true, 400 characters, the film plan's `locked` field made permanent). The fields `synth_id`, `voice` and `trained_style_id` already exist in the spec.
- Home (CREATOR-04): the table gains the three columns the spec has plus the new one; `ensureSubject` writes `synth_id` back, and is called the first time a synth is cast anywhere, not only by shows; one function `resolveCast(actor, ids or names)` returns, for each cast member, the subject, the synth if any, the sheet file, the locked sentence, the pack look (medium: photo or stylised, from the rest picture), the voice and the audience; every tool and page calls it and nothing else. `GET /api/cast` lists what the viewer may use: their own synths and subjects, shared ones, and household members under the rulings below.
- Personality and voice are read through the link when used, never copied: the film planner reads the synth's tagline and backstory to write a shot in character; a spoken line uses the synth's voice (6.5).

### 6.3 How the look stays the same

One ladder, used by every feature, strongest first:

1. The reference sheet, built once per cast member by the one sheet builder (CREATOR-06, replaces PRODUCTION-VIDEO-02's separate turnaround sheet) from the member's pictures: a synth feeds in its rest picture and approved sheet views, a household member their own photos, an invented character its generated portrait. Stored as the subject's sheet reference. The sheet is how the look is captured; the cast member is what the person picks.
2. The locked sentence in every shot prompt (CREATOR-04 stores it; PRODUCTION-VIDEO-02's idea).
3. The route: photographed real face or a household member, first picture then clip; stylised, bot, clay or cartoon, sheet route (Ingredients). The choice reads the rest picture's medium from the pack, so a companion with a pack never needs a guess.
4. An optional identity LoRA trained from the sheet and its 12 varied images (CreatorOS's character flow), kept as a `Lora` record (VIDEO-LORA-12) and named by `trained_style_id`, applied to pictures and first pictures (CREATOR-46, -47; Stack trainer). Real children: off by default, per child, a parent or admin switches it on, every output counts as a known minor for the CSAM check (`character-consistency-research-2026-11-04.md`, decision 2).
5. The face check per take with the automatic re-take (4.2).

### 6.4 How a person picks cast

| Where | Today | Plan |
|---|---|---|
| Chat | Composer `@` lists companions; sends `mention_companion_id`; `generate_image` and `generate_video` take `subjects` names (max 3); `make_film` takes `characters` text | One `@` list of cast (synths, subjects, allowed household members). The composer sends the chosen mentions as structured `mentions` beside `mention_companion_id` (the persona that answers is unchanged). A media tool takes `cast` (ids, up to 6; `subjects` stays as an alias). The model chooses the tool and may fill `cast` from the structured mentions; no regex on the text (rule 1). The tool validates every id with `resolveCast` and the viewer's access, one plain refusal line each (CREATOR-05) |
| Images > Create, Video > Create, shot cards, Film | stubs, or a name field | Kit `prompt_bar` cast chips from `GET /api/cast`, a cast shelf with the kit `media_shelf` as shipped, `@` in the prompt field (CREATOR-39 in `commons`, CREATOR-15, -40, -25 in Home) |
| A synth's page, Library | none | "Use in a picture", "Use in a video", "Use in a film" open the Create page with the cast member in place (a hand-off fills the form and starts nothing, the Phosphene rule) |

At most 6 cast in a film (the plan's own cap), 3 on a still or a clip prompt chip row, and the engine's reference limit decides the rest: a still takes 2 references (Klein) so each extra member is a sheet panel, not a reference; Qwen-Image-Edit-2511 (CREATOR-43) raises it to 6.

### 6.5 Voices for cast in talking clips

- Today: `generate_video` `voices` (clean or full) only adds a wording sentence for the model's own sound; `voiceForSpeech({actor, companionVoice: persona.voice_id})` is used by the talent shows; film narration uses the person's household voice; `CastRole.voice_choice` is always null; TALENT-09 and TALENT-12 (a film cast entry speaks in the synth's voice) are unbuilt.
- Plan: a spoken line for a cast member goes through the speech normalizer and the synth's voice (`voiceForSpeech`) to a voice clip, and the clip is made with the voice clip as an input to the talking route (CREATOR-26 typed line first through LTX's native speech; CREATOR-51 the audio-driven route, VIDEO-INPUTS-05 and the lip-sync bench). Until the audio route is benched, a talking clip says the line in quotes and the synth's voice is dubbed on afterwards by voice change (CREATOR-56). Films: TALENT-12 gets `cast[].synth_id` from the film plan so each speaker uses its own voice.
- Minors: "What a minor never gets is the clone, not the synth" (talent note, section 2.2): a voice clone of a minor is never made; a synth that is a minor speaks in a preset voice.

### 6.6 Real household members as cast: the rulings that stand (quoted, nothing new)

- `adult-content-model-decides-2026-10-26.md`: "Adults may use likenesses of household members, including family members, without a Home confirmation step." And: "For an adult, Home code blocks content only to prevent child sexual abuse material (CSAM)." And: "Children and teens keep their age-specific content filters, tool and surface access rules, and finished-media checks."
- `likeness-consent-2026-10-17.md`, "The lines that stay": "Nothing sexual involving a minor or a minor-looking person." and "A child's and a teen's lanes keep their age filters and the no-real-people rules."
- Setting `generation.household_likeness` (default true): "Anyone in the home may make things with or of any household member. Turn it off to stop that." Setting `synths.of_me` (person scope, default on, a parent sets it for a child): "Allows your likeness and public facts in a character."
- `talent-2026-11-07.md` section 2.2: "Only an adult makes a real-person synth"; teens and children get one under `synths.real_people` (a child is `ask` by default and never `all`); "When the member is under 18, the synth's context and the CSAM check carry 'this being is a minor', so sexual output about it is a CSAM candidate and a check that cannot run fails closed."
- Code today that already enforces it: `mediaSubjects.ts` refuses a `real` subject to a child or teen ("Real-person subjects are not available for this profile yet."); `videos/tool.ts` refuses real or non-character subjects for kids.

`resolveCast` applies exactly these: a household member or real person is a subject with `real: true` and, for a household member, `based_on.kind: household_member` with the `minor` flag; no new consent step, prompt or word list is added; the minor flag reaches the CSAM check on every output that includes the member.

### 6.7 Every feature takes people one way (cross-reference)

| Feature (source) | How cast enters | Slice |
|---|---|---|
| Reference-to-video, sheet route (IVY, REFVIDEO-01) | `resolveCast` gives each member's stored sheet; up to two sheets go to the adapter | CREATOR-06, CREATOR-40 |
| First-picture route (IVY, REFVIDEO-FIRSTFRAME-01) | the member's own photos and face vector come from the stored sheet and subject, not from loose pictures | CREATOR-04, -07, -08 |
| Pictures with references, up to 3 (Phosphene) | cast chips and `@` fill the references; a member is one reference (its sheet), so three members fit in a still | CREATOR-15 |
| Edit this picture, takes, send a take back as a reference (Phosphene) | the Library and Studio hand a picture to Create with the cast already on it; a take keeps its creation record's cast | CREATOR-15, CREATOR-02 |
| Photo with references, try-on, product, moodboard, photo dump (CreatorOS) | a template's person slot is a cast slot | CREATOR-14 |
| Character creation, 12 images, identity LoRA (CreatorOS) | the maker produces a subject (and a synth when asked); the LoRA is the subject's `trained_style_id` | CREATOR-19, -46, -47 |
| Movie Studio shot card, four takes (CreatorOS) | the card's subject line is cast chips; each take stores the same cast | CREATOR-20, -25 |
| Brief to reel (CreatorOS) and `make_film` | the planner receives resolved cast (name, locked sentence, persona), `characters` is replaced by `cast`; film cast stores `synth_id` | CREATOR-04, -05, -24 |
| Talking avatar (CreatorOS) | the member's picture and voice | CREATOR-26, -51 |
| Carousel (CreatorOS) | the anchor is a cast member's sheet and rest picture | CREATOR-16 |
| Re-shoot, Next shot, Another angle (CreatorOS) | the creation record's cast is reused as it was | CREATOR-23, -50 |
| Swap, Dance, Retouch a person (CreatorOS) | the replacement person is a cast member | CREATOR-48, -49, -57 |
| Picture Studio "change in words" reference slot | the slot accepts a cast chip (its sheet) as well as a picture | CREATOR-17 |
| Long take and productions | production cast already holds `subject_id` and `synth_id`; the film runner now fills `synth_id` | CREATOR-04, -27 |

## 7. One stored shape for what a made item was made from, and credits

### 7.1 What is kept today (read from code)

There is no cast or "made from" field on a Library file. What exists is a JSON note in the file's `attachments.provenance`, written as `<writer>:{json}` (`lib/libraryProvenance.ts`: picture-gen, image-edit, video-gen, video-edit, video-poster, music-gen, voiceover, show), and the job rows.

- Pictures: `picture_jobs` row with prompt, `request` (`PictureRequest`: size, seed, loras by id, `source_file_id`, audience, adultLock, tier, `edit`, `subject_ids`); the file note carries `subjects`. The prompt is not on the note; a temporary chat keeps no row. LoRA strength is lost.
- Videos: `video_jobs` row; `VideoRequest` (`lib/videos/jobs.ts`: size, seconds, seed, loras by id, `source_file_id`, `end_file_id`, `production_id`, `shot_id`, `create`, `reference`, `edit`). `ReferenceRecipe` holds sheet file ids, panels, prompt and the first-picture notes, with no cast id. The file note has seed, model, size, quality and no prompt. Another take keeps no pointer back to the source job.
- Films: `film_runs.plan_json` (the plan, deleted with the run) and the production's cast and shots; clip and still notes carry `shot`.
- Long takes: a production with the parameters in `summary` and the parts as shots.
- Songs: the spec `generation-provenance` record (kind, model, engine, seed, parent, tier), prompt and lyrics deliberately left out.
- Shows: the only note with `synth_ids`.
- Studio plans: `studioPlan.ts`, used at export; saved projects (VIDEO-LD-03b) are not built, and the design says a plan with a locked or adult-only source is never saved.
- Stack: `video/provenance.ts` keeps only hashes of generated pictures for 30 days.

Several shapes, partly overlapping, none with cast, sources and prompt together. Spec `generation-provenance` says pictures and videos "may adopt it later".

### 7.2 The one shape: `creation-record` (spec first, CREATOR-01)

Additive record in `commons/spec`, built on `generation-provenance` by reference (one definition of model, engine, seed, made_at and tier). Architect verdict before the spec lands. It is stored in Home (CREATOR-02), one per made item, written by one function at the place each writer already writes its provenance note.

```
creation-record
  id, version, made_at, kind: picture | video | film | reel | song | sound | show
  file_ids[]            the made files (clip, poster, 5.1 sibling, finished cut)
  job_ids[]             picture_jobs, video_jobs, music_jobs, media_edit rows
  production_id?, shot_id?        the existing production and shot
  recipe                tool and page that made it, and the route (text, picture, sheet, first_frame, edit, film ...)
  words                 what the person wrote and the composed prompt (private)
  plan?                 the shot plan or film plan (inline up to 12 shots, else the film_run id)
  cast[]                { subject_id, synth_id?, role, look { sheet_file_id?, locked_description?, pack_id?, lora_id?, strength? }, voice? }
  sources[]             { file_id, role: start | end | reference | sheet | edit_source | mask | audio | clip }
  generation            the generation-provenance block (models with licence, engine, seed, tier)
  settings              size, seconds, quality, styles with strength, camera or shot card, takes, loop, route
  checks                what the clip check and the face check measured
  parent_id?            the record this one was made from: another take, re-shoot, next shot, edit
  audience, made_audience, lock       copied by the same function as the file note
```

Home stores it in one table `creations` (JSON body, one row per made item), with `creation_cast(creation_id, subject_id, synth_id)` as an index written in the same transaction by the same function and rebuildable from the records; nothing else writes it. The file's existing provenance note gains one pointer `creation:<id>` and keeps working; old items are back-filled best effort from the job rows (T2: a migration). The job rows stay what they are for running a job. Reading: `GET /api/creations/by-file/:fileId` for the maker. Reopening: an editor, Another take, Re-shoot and Next shot read the record and start a new job from `recipe`, `sources`, `cast`, `settings` with a new seed and `parent_id` set; a Studio plan still refers to its source clips by file id. The "how it was made" panel (4.5) is a view of this record. IVY's saved sheet and prompt are the first writer (CREATOR-02 moves `ReferenceRecipe` into it).

### 7.3 Locks and audiences

- The record's `audience`, `made_audience` and `lock` are the maximum over its sources, written by the same function as the file note (`lib/adultLock.ts` `newItemMark`, `markFields`); it is read through `lockState`, `canReadFileAudience` and `lockedFilterSql`. A viewer who cannot open the file cannot read the record. A locked or adult-only record is never returned by any list, panel or credits call to a minor, a shared screen, an unknown viewer or an adult without the unlock, and never named in a count.
- Words and plan are private to the person who made the item; someone the item is shared with sees cast, models, date and the checks.
- VIDEO-LD-03b stands: a saved Studio plan with a locked or adult-only source is never saved. The creation record of a locked item lives in the same lock domain as the item's job row today (it holds nothing the job row does not), is deleted when the item is purged (`libraryTrash` companions rule) and follows the item into Trash.
- A new item made from a source takes the maximum lock of its sources and its `parent_id` source; Another take on a locked item needs the unlock like any use of it.

### 7.4 Credits on a synth's profile page

What exists: the profile page (`frontend/src/shell/pages/CompanionsPage.tsx`, titled Synths; tabs Activity, Tasks, About) already has a Credits section in About with Shows, Films and Bands, from `GET /api/talent/synths/:id/credits` (`routes/talent.ts`), which scans productions for `cast[].synth_id`. It covers no picture, standalone clip, reference video, long take or song; film cast carries no `synth_id` so a film made by `make_film` is not found; and the route does no lock filtering of its own (it relies on `queryItems`). Rolling credits inside a finished film (`lib/films/engines.ts`, the `credits` option of `edit_video`) come from the plan's text, not from stored cast. So there is a partial credits list and no filmography.

Plan (CREATOR-03, right after the store): the one list is the `creation_cast` index. The Credits section stays on the existing About tab and is fed by an extended route that reads the index joined to the Library's visibility functions: every picture, video, film, reel and song the synth appears in, with role, date and a thumbnail, opening the item, grouped by kind. It uses the kit `media_shelf` or list Element as shipped, no new Element, no Home CSS. The same function reads for the viewer: only items they can open, only synths they can see; a test proves a locked film and an adult-only picture are absent for a minor and for an adult without the unlock, including the counts. The film's rolling credits read the same stored cast link (role, the synth's display name) instead of the plan text. Shows and bands keep their entries (productions and made artists) merged into the same list by the same viewer filter, so there is still one list.

## 8. Left out, and the rule that leaves it out

| CreatorOS function | Why it is not carried | Rule |
|---|---|---|
| Nudity scanner (NudeNet on every render) and quarantine | A content classifier on adult output. Home keeps the CSAM check, the child and teen floors and the finished-item checks | RULES.md rule 0 and rule 10; `adult-content-model-decides-2026-10-26.md` |
| SFW word blocklist, the T0 floor, childhood word lists | A word rule decides content | RULES.md rule 1 ("The model decides, not a word rule"), rule 0 |
| "No person in a photo" guard and the "no real person" stance on visitor photos | A real-person or likeness restriction on adults | `adult-content-model-decides-2026-10-26.md`; `likeness-consent-2026-10-17.md`; the child and teen lanes keep their rules |
| Public demo mode, owner key, rate limits, quota badge, visitors | Home is a household hub, not a public site | Org CLAUDE.md "The products"; `docs/PRIVACY.md` |
| Outside notifications (a push URL) | An outbound call to a third party | `docs/PRIVACY.md` (zero phone-home); Home's Notifications bell (S6) already carries it |
| Google Fonts, GitHub star banner, one-click update from GitHub, workflow addresses | Outbound calls from the page or the app | `docs/PRIVACY.md`; `docs/RELEASES-AND-DEPENDENCIES.md` (downloads by the Stack from pinned revisions only) |
| ComfyUI, workflow editor and import, the 262 official workflows, the Extensions store, third-party node packs, "download this render as a ComfyUI workflow", recipe editing | An outside runner and untested components | RULES.md rule 11; `docs/RELEASES-AND-DEPENDENCIES.md`; the signed catalog is Home's equivalent. Home's provenance record (section 7) replaces the workflow download |
| Ollama prompt rewriter and vision calls | An outside runner | RULES.md rule 11 (the household chat model and the Stack's Qwen3-VL do it) |
| Kokoro voices | Rejected by the owner's ear, 2026-09-04 | owner ruling (`ROLE_CANDIDATES`) |
| Wan 14B for core generation | Rejected on quality, 2026-11-01 | owner ruling; Wan-Animate is a fallback for Swap only, with Jesse's yes |
| Creator page | Brand page for another project | Org products |
| From Phosphene: fixed palette and fonts, the Ideogram layout canvas, its video timeline, MCP, Pro tier, analytics | Recorded in the Phosphene note | no fixed colours (2026-10-19); the Video Studio exists |

Its look (dark only, one iridescent gradient accent, a near-black palette with luminance levels instead of borders, uppercase gradient section titles) is recorded, not copied. Every colour here comes from theme tokens; the one accent rule that carries over is restraint, as in the Phosphene note.

## 9. Model proposals (all "proposed, not benched" unless stated)

Any model and licence may be downloaded (owner, 2026-11-13). Each one gets a Stack pin, a bench row on the Studio, and a line in the setup wizard and in Settings, AI and models with its true size, licence and readiness before any button exists.

| Model | Job | Size | Licence | Why | State |
|---|---|---|---|---|---|
| Qwen-Image-Edit-2511 | 3 to 6 reference pictures, natural composition of people into a scene, outpaint, restore, angles | about 20 GB at 8 bit | Apache-2.0 | CreatorOS's composer for references and relight; a mflux path is reported and unverified | proposed |
| Multiple-angles LoRA for Qwen-Image-Edit-2511 | 8 camera angles on a photo | small (adapter) | to confirm before install | CreatorOS's Multi-Angle; Klein words first | proposed |
| Depth Anything V2 Small | Depth map | about 100 MB | Apache-2.0 (the Base and Large depth models are CC-BY-NC, avoid; LOCAL-BENCH-01 note) | Small and fast; one image-tools op | proposed |
| FLUX.2 Klein 4B LoRA training (mflux) | Identity LoRA from a sheet and 12 images | training adds minutes of GPU and about the pack size in memory | Apache-2.0 | mflux trains FLUX.1; the Klein path is unverified; fallback ai-toolkit (MIT) on MPS, CUDA-centric | proposed |
| SeedVR2 3B or 7B | Picture and clip restore and upscale, faces | 7 to 16 GB | Apache-2.0 | Better than frame-by-frame Real-ESRGAN; built for CUDA, an MPS port is unverified | proposed |
| GFPGAN v1.4 | Face repair in Restore | about 350 MB | Apache-2.0 | Small, PyTorch with MPS | proposed |
| TripoSR, then TRELLIS.2 | Photo to 3D object (GLB) | about 1.7 GB; 4B | MIT; MIT | TripoSR is small and has an MPS report; TRELLIS.2 needs CUDA extensions, a Mac port unverified. Hunyuan3D-2.1 (Tencent licence, regional limits) is the third choice | proposed |
| LTX IC-LoRA family on Max: Clean-Plate, Ripple, pose, depth and edge control, Layout-to-Render, talking-head, transition, camera control, effects | Remove people, edit by words, change background, place object, sketch to video, copy motion, dance, 3D scene, AI transition, talking head | 0.5 to 2 GB each; Max peak about 81 GB | LTX-2.x Community Licence; some adapters carry their own (OpenRAIL), to confirm each | One install-and-wire pattern on the route the Stack already serves for Colorizer and Ingredients | proposed |
| CrossView-Warp IC-LoRA plus MoGe-2 ViT-L | Another angle on a clip | about 1.3 GB plus the adapter | Apache-2.0; MIT | The warp step is ComfyUI code and needs a small port | proposed |
| MuseTalk 1.5, LatentSync 1.6, InfiniteTalk | Lip sync and dubbing from a voice clip | under 2 GB; 18 GB; Wan 2.1 base | MIT; Apache-2.0 code with OpenRAIL++ weights; Apache-2.0 | MuseTalk is fast; InfiniteTalk's Wan base is fine for dubbing, the Wan ruling is about generation | benches in LOCAL-BENCH-02 |
| RIFE 4.25 through rife-mlx | Smooth motion | 23 MB | MIT | Benched in LOCAL-BENCH-01, not built | benched, not shipped |
| Stable Audio 3 small sfx | Sound effects | to confirm | Stability Community Licence | About 1 s a clip against ACE-Step's 3 s in CreatorOS; MUSIC-GEN-11 already names it | proposed |
| MMAudio or HunyuanVideo-Foley | Sound for a clip | to confirm | to confirm | Fallback if LTX-2.5 video to audio does not pass the VIDEO-INPUTS-04 bench | proposed |
| Chatterbox VC | Voice changer for speech | same family as the installed Turbo | MIT | Same family as the voice we run | proposed |
| Wan2.2-Animate-14B | Swap and Mix characters, only if the LTX route fails | about 34 GB bf16 | Apache-2.0 | Speed on Apple Silicon unknown; needs Jesse's yes because of the Wan ruling | fallback |
| YuNet and SFace | Face finder and face match | 0.23 MB and 38.7 MB | MIT, Apache-2.0 | Already installed (REFVIDEO-PARTS-01) | in use |

Models we already run are not repeated: Klein, Z-Image-Turbo, ERNIE-Image, Qwen-Image, LTX-2.5 q8 and bf16, FastWan2.2 (the Quick slot), Real-ESRGAN, SAM 2.1, LivePortrait, ACE-Step, Chatterbox Turbo, Pocket TTS, Fish Audio Drama, Qwen3-VL.

## 10. Build order

Home work on engines we already run first, then the kit, then new Stack models. Each slice is at most about six files; a row that would exceed that splits at pickup. Stack slices are marked. Each row's full text is in `docs/BACKLOG.md`, section "CreatorOS port".

A. Foundations (they are dependencies of most of what follows)
1. CREATOR-01 (spec, commons): the `creation-record` and the `media-subject` locked sentence.
2. CREATOR-02 (Home): the creation store, its writers for pictures, clips, reference videos, long takes and films, the lock rules, the back-fill.
3. CREATOR-03 (Home): Credits on the synth profile page and the film's rolling credits from the stored cast link.
4. CREATOR-04 (Home): the one cast record: link both ways, locked sentence, `resolveCast`, `GET /api/cast`.
5. CREATOR-05 (Home): `cast` on the picture, clip and film tools and the `@` mentions in chat.
6. CREATOR-06 (Home): the one look capture, a stored sheet for any cast member.

B. Reference video (section 5)
7. CREATOR-07: clean cut-outs and natural placement for the first picture.
8. CREATOR-08: harmony without changing faces.
9. CREATOR-09 (Stack): the whole-clip check series op, no model.
10. CREATOR-10: the shared clip check, face match per take, automatic re-take.
11. CREATOR-11: room for full-size reference clips.
12. CREATOR-12: end picture anchor and the route fallback.

C. Pictures
13. CREATOR-13: picture presets as data (looks, relights, formats, angles).
14. CREATOR-14: reference templates with cast slots.
15. CREATOR-15: the Images Create page.
16. CREATOR-16: carousel.
17. CREATOR-17: Studio operations: expand, restore, angle, coverage, next shot.
18. CREATOR-18: the "how it was made" panel.
19. CREATOR-19: the Characters page.

D. Video, film and the rest of Home
20. CREATOR-20: shot-card builder, vocabulary, four takes.
21. CREATOR-21: camera and effect presets as Styles.
22. CREATOR-22: loop made with an end picture and the loop check.
23. CREATOR-23: Re-shoot, Next shot and Extend on a clip.
24. CREATOR-24: reel formats and presets in the film planner.
25. CREATOR-25: film shot cards, takes per shot, redo with a new motion, the Film entry.
26. CREATOR-26: the Talking avatar page.
27. CREATOR-27: the One take page.
28. CREATOR-28: Social check.
29. CREATOR-29: masters and output formats.
30. CREATOR-30: Library review.
31. CREATOR-31: phone capture.
32. CREATOR-32: MCP face over Home's tools.
33. CREATOR-58 (Stack, no new model) then CREATOR-59 (Home): auto captions timed to the speech.
34. CREATOR-60: generated bridge transitions.
35. In progress elsewhere, not planned again: CREATOR-IP-01 to CREATOR-IP-07 (section 4.6).

E. Kit (`commons`, then Home pins)
36. CREATOR-33, -34, -35: the editor frame in three parts.
37. CREATOR-36: picture and video editors move onto the frame.
38. CREATOR-37: `TrackStudio` audio kind.
39. CREATOR-38: Music Studio moves onto it, follows the theme.
40. CREATOR-39: `prompt_bar` shot-card chips, cast `@`, reference slot with a cast chip, takes.
41. CREATOR-40: reference and cast slots in the Create panel and the film shot cards (Home).
42. CREATOR-41: 3D viewer Element.
43. CREATOR-61 (kit) then CREATOR-62 (Home): Studio seam menu with 20 kinds and the look chooser with a preview sheet.

F. Stack (new models and ops; each "Stack then Home")
44. CREATOR-42 (Stack): job grouping by model.
45. CREATOR-43: Qwen-Image-Edit-2511.
46. CREATOR-44: Depth Anything V2 Small.
47. CREATOR-45: stabilize and master profiles (ffmpeg ops).
48. CREATOR-46, -47: identity LoRA trainer, then Train from the sheet.
49. CREATOR-48: IC-LoRA edits: remove, retouch by words, change background, place object.
50. CREATOR-49: IC-LoRA motion: sketch, copy motion, dance, 3D scene.
51. CREATOR-50: another angle.
52. CREATOR-51: voice-driven talking and dubbing.
53. CREATOR-52: SeedVR2 and face repair.
54. CREATOR-53: RIFE smooth motion.
55. CREATOR-54: sound models.
56. CREATOR-55: Image to 3D.
57. CREATOR-56: Chatterbox VC.
58. CREATOR-57: Swap characters (fallback model, needs Jesse's yes).

## 11. Open points and what is not known

- Which refusal stopped the first-picture clip above 512x256 (cap, free memory or Home's level choice): CREATOR-11's first check decides.
- Whether Klein's mask edit plus pasted-back faces looks natural enough, or Qwen-Image-Edit-2511 is needed for step 08: the bench decides.
- Whether mflux can train FLUX.2 Klein 4B, whether SeedVR2, TRELLIS.2 and the CrossView-Warp pieces run on MPS, and whether LTX video LoRA training exists on MLX: unknown, each is a bench.
- The licence of CreatorOS's dance clips and of several adapters: unchecked; the plan makes its own dance set and confirms each adapter's licence at pin time.
- The architect has not ruled on this note. The spec change (creation record, fragment template kind, subject locked sentence) and the `@` mention behaviour need a verdict before CREATOR-01 and CREATOR-05 start.
- Not decided here and not asked: nothing in this note changes `RULES.md`.
