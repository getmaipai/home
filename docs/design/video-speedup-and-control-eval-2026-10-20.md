# Video: faster decode, longer clips and picture anchors, an evaluation plan (2026-10-20)

Status: **evaluation plan only. Nothing here is scheduled, built or approved to run.** It records what to measure later, in what
order, and what result would change the shipped design. It follows [video-generation-2026-10-17.md](video-generation-2026-10-17.md)
(the shipped Quick and Detailed kinds) and does not change it. The architect has not ruled. Owner approval is needed before any
row below starts, and before any download.

Source: two research passes written by ChatGPT (pasted by Jesse, 2026-10-20) about the `dgrauet/ltx-2-mlx` project, TAEW2.2 and LightVAE
decoders, LTX-2.3 extend and keyframe operations, and Wan2.2 image conditioning. Section 1 is the review of that pass against what
Home already has. Sections 2 to 5 are the plan.

## 1. Review of the pasted plan

### What holds

- **The decoder is the right first target.** Quick spends about 115 s of its 130 s in the Wan2.2 VAE decode (section 4 of the video
  note, row VIDEO-GEN-11). Any decoder that is several times faster is worth more than any sampler change.
- **Keep the existing text-to-video paths unchanged** and add two small operations beside them. Save seeds, model revision, source
  pictures and the parent clip with every result. Both are already how Home treats generated media (record with provenance from first
  boot).
- **Offline and licence rules stay in force:** pin and pre-download every file, read each checkpoint's licence on its own, test with
  the network off.
- **Marked as unverified by the pass itself:** the "70 to 110 seconds saved" figure and every Apple Silicon quality number. We agree
  and carry that into the pass bars below.

### What is stale, wrong or missing for this repo

1. **Picture to video on Detailed already exists.** VIDEO-LTX-02 closed 2026-10-17: frame 0 is the picture, the hero speaks, 70 s
   cold. The pass presents anchors as new. The new part is only anchors at later frames, keyframe interpolation and extend.
2. **A second runtime is the wrong default.** The pass says to install `ltx-2-mlx`. Home runs `mlx-video` at a pinned commit with a
   Stack worker that already carries two fixes the stock code needs (the NaN attention mask and the encoder built from the weights'
   shapes). A second package means a second dependency set (mlx-vlm, transformers), a second worker and a second licence read, which
   breaks "one definition, one place" (platform principle 1). First question for every LTX row: does the pinned `mlx-video` already
   expose the operation? If not, port the operation's logic into the existing worker; install the second package only inside the
   scratch bench environment, never in the Stack.
3. **The keyframe pipeline is not the distilled path.** The pass notes the documented keyframe pipeline uses the dev model with
   guidance plus a refine pass. The Stack pins only the distilled folder (47.1 GB, 8 steps). The dev weights are a separate, larger
   download and the sampler is many more passes, so "keyframe" may cost several times Detailed's 42 s. The pass never prices this. It
   is the main reason keyframe interpolation is last in the order below.
4. **Extend is beta, and the distilled extend is experimental** (the pass says so). It also does not say extend is faster, and Home's
   measured direct 10 s clip is 79 to 81 s. Two added latent frames are about 16 output frames (0.67 s at 24 fps), so reaching 10 s
   takes many hops, each with its own text encode, load and decode. Total time per finished second could be worse than direct.
5. **Speech and sound at joins.** Home measured that spoken words are reliable only to about 5 s (VIDEO-LTX-03). A clip built from hops
   may repair that (each hop is short) or break it (the voice and room tone change at every seam). The pass says only "check audio
   continuity".
6. **Safety is missing.** Anchor pictures are user pictures: they go through the likeness rules (LIKENESS-01), the age and surface
   gates and the finished-clip check. Every hop is a new generation and needs the check, not only the final file. The model's own
   disclosure markings must survive the cut and re-encode (the LTX licence forbids removing them). Teens and children stay Quick-only.
7. **Frame arithmetic.** The pass counts on a clean 8k+1 grid. Home's measured clips come back a few frames short (117 for 121 asked).
   Seams and anchor indices must be checked against the real frame count, not the requested one.
8. **Not evidence:** the pasted example photos (film stills and stock-site images) illustrate nothing about our models. The shell
   commands are the pass's own illustration; flags are unverified until `--help` of the pinned revision is read.
9. **RIFE-MLX exists** (`xocialize/rife-mlx`, found by the second pass and read 2026-10-20; an earlier search in this session had
   missed it). It is a three-star, six-commit single-maintainer project, so its numbers are claims until measured here (E6).

## 2. Questions, in the order to ask them

| # | Question | Why this order |
|---|---|---|
| E1 | How much faster is a tiny Wan2.2 decoder, and is the picture good enough? | Biggest measured cost; no model change |
| E2 | Does the pinned `mlx-video` already do a 2x upscale that makes 480p Quick clips sharper cheaply? | Cheap; removes pressure for 720p |
| E3 | Do anchors at later frames on Detailed hold identity and composition? | Uses the shipped model; no new download |
| E4 | Is extend a better way to a 10 to 15 s clip than a direct 10 s clip? | Needs E3's method; decides "longer" |
| E5 | Is the dev-model keyframe pipeline affordable? | Needs new weights; only if E3 and E4 leave a gap |
| E6 | Does RIFE-MLX double the frame rate cheaply and cleanly? | Candidate found 2026-10-20; cheap to try |

Watchlist, not experiments: Kandinsky 6.0 Video and its super-resolution repo (`kandinskylab/kandinsky-6`, `-sr`) advertise synced
audio, but the pass says the published quick start needs an NVIDIA GPU (unverified by us; the 2026-10-17 note found no MLX port and
VIDEO-GEN-10 owns it).

Out of scope on purpose: LTX-2.5 (VIDEO-LTX-05 owns it), Wan2.2 A14B and Lightning LoRAs (VIDEO-GEN-10 owns them; revisit only if E1
makes a 14B profile worth timing), Kandinsky (no MLX port found).

## 3. Common method for every experiment

- **Where:** the Studio, under the machine GPU lock, with the live Stack running, so numbers are upper bounds like the 2026-10-17
  ones. Scratch environment under `data-scratch/`, never the Stack's `video-gen` environment. `HF_HUB_OFFLINE=1`; the privacy check
  must show zero outbound requests during a run.
- **Downloads and installs:** each file needs Jesse's yes in the moment, with name, source and size stated first. The bench sessions
  do not install into the Stack and do not update the live hub.
- **Inputs:** the same five prompts and seed 1 used on 2026-10-17 (dog, robot, clouds, coffee, boat), so numbers compare. For anchors,
  pictures are generated locally from persona-roster characters (the image role), never a household member.
- **Record per run:** wall time by stage, MLX peak and process peak footprint, resident chat set size, the exact commit and file
  hashes, the command line. Quality is judged by opening five keyframes per clip and reading them, plus for seams the ten frames
  around each seam. A claim without opened frames is not accepted.
- **Pass bars are set before the run.** A result that misses the bar is reported with its numbers and the row stays open or closes
  as "not worth it". Nobody tunes the bar afterwards.
- **Sound** is judged by the Stack's speech-to-text on the track plus a loudness and waveform look at each seam.

## 4. Experiments

### E1. Tiny decoder for Wan2.2 (the first run)

- **Candidates:** the original Wan2.2 VAE (baseline), `taew2_2` and its "super" variant (`madebyollin/taehv`), and `lighttaew2_2`
  (LightTAE, distilled from `taew2_2`) from `lightx2v/Autoencoders`. That page (read 2026-10-20) lists Apache-2.0, all three Wan2.2
  files as Conv2D (except the official Causal Conv3D VAE), names Wan2.2-TI2V-5B as the backbone it was tested on, and gives decode
  times on an NVIDIA H100 for 81 frames: 3.13 s official against 0.089 s for either tiny decoder (about 35x), memory 12.3 GB against
  0.41 GB. Those are NVIDIA numbers only and prove nothing for Apple Silicon. The page gives no numeric quality score ("Close to
  Official" for LightTAE, "Average" for `taew2_2` are its words). It does not state the 48-channel latent of the 5B VAE, so confirm
  the latent shape matches FastWan's before any run. `lightvaew2_1` is Wan2.1 only and is not a candidate. Conv2D layers make an
  MLX port simpler than a 3D-convolution decoder would be.
- **Method:** save one denoised latent per prompt from the shipped FastWan 3-step run, then decode the same tensor with each
  candidate. Candidates are PyTorch today; bench them on MPS in the scratch environment first. The shipped Stack environment carries
  no torch (video note, section 3), so a winner needs an MLX port of the decoder (an 11M-parameter causal convolution network;
  estimate the port from the architecture before promising it).
- **Measure:** decode wall time and peak memory for 121 frames at 832 x 480; PSNR, SSIM and LPIPS against the original decode (state
  the tool used); opened keyframes on the dog and robot clips (motion and fine detail); a temporal check (flicker between adjacent
  frames).
- **Pass:** decode of 30 s or less, total clip 60 s or less, no visible new artefacts on four of five prompts, no flicker the eye
  catches at normal speed. **Kill:** quality visibly below the shipped look, or a port that needs a framework Home does not carry.
- **If it passes:** Quick becomes about a minute; 720p (decode 269 s today) is measured again; row VIDEO-GEN-11 closes.

### E2. Built-in 2x upscale on a finished Quick clip

- **Method:** run the pinned `mlx-video` upscale command (verify it exists at the pinned commit first) on the five Quick clips, with
  and without its optional refine pass. Second candidate: `xocialize/realesrgan-mlx` (BSD-3-Clause, MLX native, fp16, no torch at
  run time, tile flag to cap memory, an anime-video variant). Its page gives no speed numbers and shows 6 stars and 7 commits from one
  maintainer; the weights are the upstream Real-ESRGAN checkpoints, so read the upstream weight licence. It works on frames, so time
  the whole path: extract 121 frames, upscale each, re-encode, copy the audio. Weights load from a local folder
  (`--weights_dir`), not the hub, in the bench.
- **Measure:** added seconds, peak memory, opened keyframes against the 480p original and against the 720p direct clip.
- **Pass:** 40 s or less added, visibly sharper, no new identity drift. **Kill:** needs a prompt-driven refine that changes content.

### E3. Anchors at later frames on Detailed

- **Method:** 5 s and 10 s clips at 768 x 448 with pictures at frame 0 (shipped), the middle and the end, strengths 0.7 to 1.0.
  First check whether the pinned `mlx-video` accepts more than one anchor; if not, test `ltx-2-mlx` in the scratch environment to
  learn what is possible, then judge the cost of porting the conditioning into the worker.
- **Measure:** time against the 42 to 49 s (5 s) and 79 to 81 s (10 s) baselines; peak memory against the 46 GB admission figure;
  whether the middle and end frames resemble their anchors (open the frames at the anchor index and two either side); identity
  across the clip; whether the corridor line still comes out (speech check as in the video note, section 14.3).
- **Pass:** the end frame is recognisably the end picture in three of three clips, no time penalty above 25 percent, speech no worse
  than the same clip without anchors. **Kill:** anchors only work at frame 0, or they cost the sound.

### E4. Extend

- **Method:** make a 5 s Detailed clip, extend it to about 10 s and about 15 s with the distilled path, one hop at a time. Compare to
  the direct 10 s and 15 s clips (79 to 81 s and 110 s) with the same prompt and seed family. Repeat the subject, clothing, light
  and camera in each hop's prompt and describe only the change.
- **Measure:** seconds per finished second, including every text encode, load and decode; peak memory per hop; frame count actually
  gained per hop; the seam (ten frames around it, frame difference spike, identity drift); audio at the seam (loudness step, click,
  voice change); the speech transcript against the direct clip.
- **Pass:** the seam is not noticed by an observer on three of three clips, total time for 10 s is 120 s or less, speech is no worse
  than direct. **Kill:** identity drifts by the second hop, or total time is above direct generation with no quality gain.
- **Side result to record:** whether a short clip plus one extend beats a direct 10 s clip for spoken lines (VIDEO-LTX-03).

### E5. Keyframe interpolation (start and end picture, motion invented between)

- **Only if** E3 does not give end-composition control and the owner still wants it.
- **First measure the price:** size of the dev weights in the layout the runtime reads (the pass quotes bf16 and int8 sizes for
  2.3; verify), step count, and seconds for a 5 s clip. Then quality.
- **Pass:** 5 s clip in 180 s or less with identity held and the end picture reached. **Kill:** above 5 minutes, or a download the
  owner will not accept beside the 74 GB Detailed set (this one is a second LTX file set, so licence text is re-read).

### E6. Frame interpolation with RIFE-MLX

- **Candidate:** `xocialize/rife-mlx` (read 2026-10-20). MIT, inherited from Practical-RIFE; weights are RIFE 4.25 converted to
  safetensors (22.7 MB, fp32) and hosted at `mlx-community/RIFE-4.25`, with no separate weight licence stated (read upstream's).
  MLX native, no torch at run time. The page reports, on an M5 Max, 168 ms per inserted frame at 480p and 260 ms at 720p. A 121
  frame clip needs 120 inserted frames to reach 48 fps, so the model time is about 20 s at 480p and 31 s at 720p, before decoding
  and encoding the video. That is arithmetic from the page's number, not a measurement of ours. CLI: `rife-mlx -i in.mp4 -o out.mp4
  --multi 2`, described as keeping the audio. Weights download from the hub by default; the bench uses `--weights_dir`.
- **Maturity:** 3 stars, 6 commits, one maintainer, no last-commit date shown. Plan on owning a copy of the small model code if it
  passes.
- **Method:** double the five Quick clips and two Detailed clips (one with speech). Measure total seconds, peak memory, audio
  sync and level, and open the frames at fast motion (the dog's legs, the robot's hand) and at scene changes to see ghosting.
- **Pass:** 30 s or less added for a 5 s clip, no ghosting an observer notices at normal speed, audio untouched (same bytes or
  same samples). **Kill:** smeared fast motion, audio drift, or a 48 fps file the player and the messaging copy path cannot handle.
- **Open question for the owner, not for the bench:** whether 48 fps is wanted at all. Wan and LTX both make 24 fps; the gain is
  smoothness of pans and fast action.

## 5. If an experiment passes: the shape to build

Not a commitment; it is the constraint set so a later design does not start from scratch.

- **Stack API, additive.** Two fields or routes on the video job API: a list of anchors (`image`, `frame`, `strength`) and a
  `continue_from` clip id with a direction. Limits and support flags appear under `qualities.detailed` (as `image_to_video` does
  today); an older Stack answers `reference_unsupported`-style, never silently ignores. No new status UI: the existing job card,
  stages, preview and Stop carry it (owner rule on reusing status mechanisms).
- **Worker.** The operations live in the existing `ltx_worker.py` and share its single model load. No second package in the Stack
  environment. The memory governor admits each hop at the same 46 GB figure unless the measurement says otherwise.
- **Safety, all of it unchanged and applied per hop:** age and surface gates first; anchor pictures pass the likeness rules like any
  reference picture; each hop's prompt passes the minor-sexual line; the finished-clip check runs on every hop and on the joined file;
  the Detailed clip's sound track is stored untouched; markings from the model survive cutting (copy streams, never strip). An
  extended clip inherits the strictest audience of its parent and its anchors.
- **Provenance.** Each result records the parent clip, anchor picture hashes, seeds, model revision and the operation, so a good
  result can be reproduced and a bad one traced.
- **Chat and card.** The model sets anchors only when the person supplies pictures. "Make it longer" is a card action on a Detailed
  clip. Wording uses Quick and Detailed only; model names stay under Details.

## 6. What each result changes

| Result | Action |
|---|---|
| E1 passes | Port the decoder to MLX (new row), shrink Quick to about a minute, re-measure 720p, close VIDEO-GEN-11 |
| E1 passes only on PyTorch | Decide whether the Stack may carry torch for this one worker (owner question), else drop |
| E2 passes | Offer a "sharper" finish on Quick instead of a 720p profile |
| E3 passes | Anchors on Detailed: Stack field plus tool argument, as in section 5 |
| E4 passes | "Make it longer" on Detailed; may also repair spoken lines past 5 s (VIDEO-LTX-03) |
| E4 fails, E3 passes | Longer clips stay direct generation to 15 s; anchors only |
| E5 passes | Keyframe mode as a third, slow option under Detailed, with its own download and licence read |
| All fail | Record the numbers here and close the rows; the shipped design stands |

## 7. Backlog rows

Added to `docs/BACKLOG.md` after VIDEO-LTX-05: VIDEO-EVAL-01 (E1), VIDEO-EVAL-02 (E2), VIDEO-EVAL-03 (E3), VIDEO-EVAL-04 (E4),
VIDEO-EVAL-05 (E5), VIDEO-EVAL-06 (E6). All are bench rows, unscheduled, waiting on the owner.
