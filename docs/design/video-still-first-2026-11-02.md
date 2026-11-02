# Videos Create: still first, then render; photo, clip and voice inputs (design draft, 2026-11-02)

Status (2026-11-02): proposed; architect ruling pending. No code. Item: VIDEO-INPUTS-01. Adds a confirm step before a render and the input
slots Start frame, End frame, Voice clip and Source clip to the Create flow of [video-create-2026-11-01.md](video-create-2026-11-01.md),
[video-create-ui-2026-11-02.md](video-create-ui-2026-11-02.md), [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md) and
[video-chat-2026-11-02.md](video-chat-2026-11-02.md). Rule S7 (chat parity for every Create item) is only proposed
(branch `wt/fair-heron-music-chat-cards-note`, not in RULES.md on main); this note follows it as a plan, as the Create note does.

Owner request (Jesse, 2026-11-02): the Create page should take clips, photos and, ideally, a voice clip. His idea: show a fast first
picture and have the person confirm it before Home spends 1 to 4.5 minutes rendering.

## Supersedes and amends

Nothing approved is deleted. Each line names the passage and what it says after this note.

- [video-create-2026-11-01.md](video-create-2026-11-01.md) section 4 ("Continuity default", Start and End frame): a Start frame can now also
  be a picture the Stack just made for this clip (section 2 here). The frame is not new; the Stack reaching it is (section 3). Section 3
  item 2 ("End frame appears only when its bench passes") stands; its bench is VIDEO-EVAL-03, run through the CLI first (section 4 here).
  Section 9 bench rows 1 and 2 are answered in part by the Calico clip (section 4 here). VIDEO-EVAL-03 ("later-frame picture anchors on Detailed", LTX-2.3) is retargeted to LTX-2.5 by bench 2 here, and VIDEO-EVAL-04 (extend versus direct generation) is run on LTX-2.5 by bench 5 here; both rows get that edit in the same commit. Section 10 slice V6 (Extend, End frame) is split:
  End frame moves to VIDEO-INPUTS-03, Extend and `retake` to VIDEO-INPUTS-06, and VIDEO-CREATE-01 keeps V1 to V5 and V7.
- [video-create-ui-2026-11-02.md](video-create-ui-2026-11-02.md) section 1 (Reference slots: "picture, character, place" and "a filled slot
  is the first frame"): the slots become Start frame, End frame, Voice clip and Source clip, and Character and Place stay as in the Create
  note's V4. The `references` list on `prompt_bar` (its `kind` is `picture` today, see `backend/packages/videos/pages/make-video.json`) gains
  `audio` and `video` kinds, additive, spec first. Section 1's "Make: one button" gains the confirm step below; the button label stays Make.
  Section 4 ("No new chat tool") stands for tools and changes for arguments: `generate_video` gains `preview`, `draft` (the pending request's id), `end_frame`, `voice_clip`
  and `source_clip`. Slice U3 is unchanged except that it builds the stage's confirm state (VIDEO-INPUTS-02).
- [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md) section 2 and 3 are not changed. Its open item 3 ("Real people: ... a voice made
  from a recording ... untested") is narrowed: a voice clip can drive a clip through `a2v` (section 3 here), which is a different feature
  from a household voice made from a recording, and is still untested.
- [video-chat-2026-11-02.md](video-chat-2026-11-02.md) section 2 table: `generate_video`'s argument list gains the five arguments above, and the
  `continue` row's need ("Stack picture-to-video from a frame") is met by VIDEO-INPUTS-01. Section 6's note "the Stack's LTX-2.5 refuses a
  picture start" is the missing piece this note closes, and `retake` (its C6) is benched in VIDEO-INPUTS-04 before C6 starts.
- Stack code that says otherwise changes with VIDEO-INPUTS-01: `qualities.ltx25.image_to_video` is false today and the route
  `videoGenerations.ts` answers 422 `reference_unsupported` ("This video model starts from words, not from a picture").
- [video-generation-2026-10-17.md](video-generation-2026-10-17.md) (reference pictures, VIDEO-GEN-12, `image_source`) is not changed; this note
  works inside it (section 5 here).

## 1. What exists (read 2026-11-02)

- Home accepts a start picture today: `generate_video` takes `from_picture` (a picture made here, or a photo attached to the message), screened
  by `screenInputImage` and `loadUploadedPhoto` in `backend/src/lib/videos/tool.ts` and `jobs.ts`; the Create page has a `start_frame`
  reference slot on the `prompt_bar` (`make-video.json`) and `loadLibraryPicture` reads a Library picture for it. A child gets no photos
  (`CHILD_NO_PHOTOS_LINE`).
- The Stack takes a start picture on Wan Quick and LTX-2.3 Detailed (`imageToVideo: true`). LTX-2.5 (`ltx25`, `ltx25max`) has `imageToVideo: false`;
  `ltx25_worker.py` `generate()` raises "this video model starts from words, not from a picture" when `request["image"]` is set. The
  worker and the 422 are on Stack `origin/main` (830f97a). `ltx25max` is not: it exists only as uncommitted LTX25-MAX-01 work in the
  worktree `wt/stack-fair-tiger-ltx25-max-pin`, so VIDEO-INPUTS-01 starts on main for `ltx25` and its `ltx25max` half waits for that landing.
- Contact sheets (`*-sheet.png` beside the clips in `~/video-bench/clips`) are an ffmpeg tile of frames made after a clip has finished, to
  judge it by eye. They are not a preview and not fast, and they are not part of the product flow (decision 1).
- The picture engine Home uses for pictures is the Stack image engine on the Standard picture slot: ERNIE-Image-Turbo 8B when installed, FLUX.2
  Klein 4B as the fallback and as the edit model ([resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) section 5.2;
  [image-model-bakeoff-2026-10-25.md](image-model-bakeoff-2026-10-25.md)). Boost is Z-Image-Turbo and Max is Qwen-Image 20B, Max holders only.

## 2. Decisions

1. **Contact sheets are not a preview.** Nothing in Create, chat or the Stack builds one for the person.
2. **Still first is a picture made by the picture engine, not a cheap video frame.** Flow: prompt (with Look, Camera, Level, Length) goes to
   the Stack image engine, which makes one still at the clip's true size; the person sees it and chooses one of three actions:
   **Make the video from this**, **Another still**, **Edit words**. Make starts the render with that still as the start frame (LTX-2.5
   `generate --image PATH`, frame 0, binding `replace`). Another still is a new picture job with a new seed. Edit words reopens the prompt
   with the words kept and makes a new still when sent. No video job, no memory held for video and no time estimate for the clip is spent
   until Make.
3. **What a still costs (measured numbers only; none measured at clip size).** The bake-off timed 1024 by 1024 pictures, one process each,
   including model load, on a loaded machine: Klein 4B 16.9 s (4.0 s on a quiet machine, 12 s warm), ERNIE-Image-Turbo 33 to 44 s, Z-Image-Turbo
   46 s; Qwen-Image 20B 181 to 212 s. A still at the clip's size (for Standard the true 512x256) is smaller than 1024 by 1024 and should be
   faster: to measure (VIDEO-INPUTS-02 exit). "A still in seconds" holds for Klein on a warm machine and does not hold for ERNIE: the Standard
   clip itself is about 43 s (video-tiers section 3), so an ERNIE still costs about as much as the Standard clip.
4. **So the confirm step defaults on for Boost and Max and off for Standard.** Boost clips are 42 to 74 s for 5 s and Max is longer, so a
   rejected still saves a render; on Standard the still is about the price of the clip. A person setting (`video.still_first`, a new key, spec first: `auto`,
   `always`, `never`; default `auto`, which means Boost and Max) and a chip on the prompt bar ("Picture first", same behaviour as the Voices
   toggle) decide, and the chip shows the measured still time and the clip time the way the Length control does. The default is a
   proposal that VIDEO-INPUTS-02's measurement can change; the owner may set `always`.
5. **When the confirm step is skipped.** It is skipped when the person already gave a Start frame (a picture exists), when the setting is
   `never`, and in chat when the person said to make it now. In chat the model decides, never a word rule (rule 1): `generate_video` takes
   `preview` (`ask` or `skip`); the engine default follows decision 4; the model sends `skip` when the person asked for no confirmation
   ("just make it", "no preview"). No regex reads the sentence. Bench row 10 of the Create note measures offer and false offers for `preview` and `draft` before they join the set.
6. **Chat parity (S7).** The still arrives as a chat card: the same kit Element as the Create stage's picture with the same three buttons
   (rule 9: no Home `*Card`; a missing prop or variant is a `commons` change first, with a `UI-DECISIONS.md` row). The card's buttons call the same
   Home functions as the Create buttons. A person who answers in words ("yes", "make it", "change the sky") is read by the model, which
   calls `generate_video` with `draft` set to the draft's id, or asks for a new still.
7. **The draft.** A pending request (prompt and choices, the still's file id, the person) is one record; it holds no clip. In a temporary
   chat it lives in memory only (as `video_jobs` do, two hours); otherwise it lasts 24 hours (proposed) and the still stays the person's own
   Library file until they delete it. Make on an expired draft says so in plain words and offers a new still.
8. **Same policy before any video starts.** The still is an ordinary picture job under the person's lane: `generate_image`'s audience,
   lane, input screening and finished-picture check (`lib/pictures/*`, `finishedCheck.ts`) all run, and a withheld still never becomes a start
   frame. Then the video job runs its own checks (the finished-clip check, `ageCheck.ts`). Adults: the model decides content and Home blocks
   only CSAM candidates, with an unrun check failing closed (rules 0 and 10). Children and teens keep their floors.
9. **Minors keep their lane (rule 8).** This note gives a child or teen no tier choice, no new input and no new lane: Create stays adult-only,
   in chat a child's and a teen's `generate_video` stays Wan Quick and silent as in video-tiers decision 1, `preview`, `draft`, `end_frame`,
   `voice_clip` and `source_clip` are ignored for them with the plain line, a child still gets no photos, and a child's pictures and clips
   still count against their daily limits. A confirm step for the teen picture lane is a later, separate owner decision.
10. **Status and the queue.** The still is an image job at image priority (chat first, then images, then video); its progress is the "One
    job's progress" row and the controls follow the "Pictures and video are not ready" row (S6, `useMakingAvailability`). No new
    status surface. A person who walks away after Make has the same Creations entry as today.

## 3. Inputs and the runtime commands

Read from the ltx-2-mlx 0.18.0 CLI (`~/video-bench/ltx25-new/src`, `packages/ltx-pipelines-mlx/src/ltx_pipelines_mlx/cli.py`). That is the
runtime the Stack pins only for Max (uncommitted `ltx25-max-gen`). Standard and Boost run the fork MrMoferFRAN/ltx-2-mlx 5795228 (0.14.15),
whose `--image` form is `PATH [FRAME_IDX STRENGTH [CRF]]`: no `last` keyword and no `BINDING` argument, so an end frame there is a frame index
or the separate `keyframe` command. The fork has `a2v`, `retake`, `extend` and lipdub. The worker uses only the runtime pinned for its tier
(rule 11), and any syntax below that exists only in 0.18.0 needs a Stack pin change first. The table's syntax is 0.18.0's; the fork's
differences are rechecked in VIDEO-INPUTS-01 and -04.

| Input in Create | Runtime command | CLI status | What we have verified |
|---|---|---|---|
| Start frame (a still made here or a photo) | `generate --image PATH [FRAME_IDX STRENGTH [BINDING]]`; frame 0 replaces the first latent | not marked beta | verified: photo keyframes on LTX-2.5 through the CLI only, the Calico clip (`~/video-bench/clips/ltx25-calico*.mp4`) |
| End frame | the same flag, repeatable, with `FRAME_IDX` `last` (or negative); both ends allowed | not marked beta | the CLI describes it; no clip of ours uses an end frame (VIDEO-EVAL-03) |
| Voice clip | `a2v --audio file.wav --prompt ...` (`--audio-start`, `--distilled` for the two-stage form) | beta; `--distilled` and `--dfr` experimental | nothing run by us |
| Voice clip plus a source video | `lipdub --reference-video V --lora PATH STRENGTH` | experimental; needs a lip-dub IC-LoRA | nothing run by us |
| Source clip, lengthen | `extend --video V --extend-frames N` (`--image` needs `--distilled`) | beta | nothing run by us |
| Source clip, redo a range | `retake --video V --start S --end E` | beta | nothing run by us |

The Stack worker (`ltx25_worker.py`, with `ltx25.ts`) passes no image to the engine today and the route returns 422 for `image`. That is a
missing piece of our wiring, not a limit of the model: the same model made the Calico clip from a photo through the CLI.

Owner-judged findings that shape the inputs (video-tiers section 1 and 4): cartoons work; real people from words fail (no model reproduced a
named person's look or voice); a reference picture keeps a look; icon voices fail (the model's voice is not the character's), which is
why a voice clip is wanted. None of these is a measurement of a2v.

## 4. Bench first, one sample per test

Before any control offers an input, one measured real clip of it on the Studio, judged by the owner by eye and ear, recorded in
`video-speed-bench-2026-11-01.md` style (seconds, footprint measured the one way video-tiers sets, true output size from ffprobe):

1. Start frame through the Stack worker on Standard (after VIDEO-INPUTS-01), compared with the Calico CLI clip.
2. End frame: one clip with `--image PATH 0` and `--image PATH last`, both allowed (VIDEO-EVAL-03 retargeted to LTX-2.5).
3. `a2v`: one voice clip of 5 to 10 s plus a prompt, plain and `--distilled`; does the picture follow the speech, and does the voice stay?
4. `lipdub`: one clip; blocked unless a lip-dub IC-LoRA is available under rule 11 (a Stack-owned, pinned component).
5. `extend` and `retake`: one clip each, five to ten seconds, with the seam judged; the `extend` half is VIDEO-EVAL-04 run on LTX-2.5.

A result that fails keeps its control out of the page and the tool (a missing control, never a disabled one that cannot work).

## 5. Safety, consent, storage, privacy

- **Audience floor.** Every input is adult, own written screen, household video on, engine ready (`videoEligible`); the gates run in the
  tool, not the card. Rules 0 and 10 govern content: adults are blocked only for CSAM candidates; a photo or clip is screened at the input
  (`screenInputImage` for pictures; a clip's frames through the same keyframe path as `ageCheck.ts`) and the output gets the finished-clip
  check. A possible minor in nude or sexual media is withheld.
- **A photo or clip of a real person.** [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md) applies as its current text says:
  no per-person agreement and no consent prompt for an adult; the lines that stay are no sexual media of a minor or minor-looking person, the
  adult audience gate, and the child and teen lanes' no-real-people rules. The Stack's provenance rule for reference pictures
  ([video-generation section 12](video-generation-2026-10-17.md), VIDEO-GEN-12) stays: a still the Stack image engine made carries
  `image_source: generated` with no new proof; an uploaded photo goes as `household_photo` with Home's signed proof, bound to the
  picture's sha256. Whether the Stack still enforces that for LTX-2.5 is rechecked in VIDEO-INPUTS-01 before the slot opens.
- **A voice clip of a real person.** It is an audio file of someone's voice; the same likeness note governs it: no consent prompt for an adult,
  the CSAM line on the output, no use on a minor's screen. Whether a voice clip needs a signed proof like a photo is not decided here
  (the likeness note covers pictures); VIDEO-INPUTS-05 settles it with the Stack, and it adds no content rule of Home's own.
  Home-made household voices ([household-voices-2026-10-20.md](household-voices-2026-10-20.md), 6 to 30 s recordings) stay a separate
  feature; a Voice clip is one-off audio for one clip and creates no household voice.
- **Storage and retention.** An uploaded photo, voice clip or source clip is the person's own Library file (the existing attachment path:
  owner only, Trash, hard delete by the person); a clip made here is already one. In a temporary chat the upload is memory only for the
  chat's life. Home sends stored bytes to the Stack unchanged, and the Stack deletes its working copy when the job ends, as it does for
  pictures today (video-generation section 10). No clip, voice or still is logged or copied (rule 6a: logs carry counts and timings only).
- **Privacy.** Nothing leaves the Mac: every command above runs in the Stack's local runtime; no model, tokenizer or helper is fetched at
  run time (the packs are gated downloads the owner accepted, video-tiers open item 1, fetched at install, never at run time). Each new worker input path asserts zero outbound
  connections, as the Create note's V7 requires.
- **Errors say what to do.** An unsupported or refused input gets one plain line with the next step (STYLE.md), never the engine's text.

## 6. Work, in order

Stack first (the Home controls wait for the matching Stack capability, and the Stack reports it in `qualities`).

| Id | Size | Slice | Done when |
|---|---|---|---|
| VIDEO-INPUTS-01 | M, Stack | Picture start on LTX-2.5: `ltx25_worker.py` passes `--image` semantics (frame 0 `replace`, optional `last` end frame), `ltx25.ts` carries the argument, `qualities.ltx25.image_to_video` (and `ltx25max`) true, the 422 route test changes, the provenance rule rechecked | one clip started from a Stack-made still and one from an uploaded photo through the worker, sized and timed the same way as the Calico run; a test fails if `image` is dropped |
| VIDEO-INPUTS-02 | M, commons then Home | Still first: `prompt_bar` Picture-first chip and the stage's confirm state (three actions), draft record, `video.still_first` setting, `generate_video` `preview` and `draft` arguments and the chat still card (S7), the picture-policy-before-video test | on a Boost request in Create and in chat the person sees a still, picks each action once, and a render starts only on Make; the still time at clip size (ERNIE and Klein, one picture each, decision 3) is recorded; previewed on desktop and phone |
| VIDEO-INPUTS-03 | S, Home | Start frame and End frame slots on `references`, `end_frame` argument (End frame only if bench 2 passes) | a clip with both ends made from Create and from chat |
| VIDEO-INPUTS-04 | S, bench | Benches 2 to 5 of section 4, one clip each, owner judges | numbers and verdicts recorded; each passed input is named for slice 05 or 06 |
| VIDEO-INPUTS-05 | M, Stack then Home | Voice clip: `a2v` in the worker, `audio` reference kind in spec then ui, upload to the Library, `voice_clip` argument, the voice-proof question settled | a clip whose speech follows an uploaded voice clip, made from Create and chat |
| VIDEO-INPUTS-06 | M, Stack then Home | Source clip: `extend` and `retake` (and `lipdub` only if its bench and an owned LoRA exist), `video` reference kind, `source_clip` argument; feeds `edit_video` `continue` and `retake` of VIDEO-CHAT-01 | each passed command makes one new version and keeps the old |

Rows 05 and 06 start only after their part of 04 passed. Reuse check (org principle 6): the still is an existing picture job, the slots are
the existing `references` list, the confirm buttons reuse the Create stage's action row, the upload and storage are the Library's, the
chat card is the kit's picture Element; no second queue, store or status surface is added.

## 7. Open points

None block 01. For the owner when 02 lands: whether `auto` should include Standard once the measured still at clip size is known, and
whether the teen picture lane gets a confirm step (decision 9).
