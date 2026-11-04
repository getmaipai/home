# Video speed and quality bench (2026-11-01)

Measurement only. No engine code, pin or live-install file was changed. Question from the owner: can our own Stack components match the
speed and quality of a ComfyUI video (MiniMax-H3 plus a 6-step add-on, a 2x latent upscale and a refiner; claimed 1440p in about 440 s on a 16 GB
CUDA card). Rule 11 rules ComfyUI out, so each lever is tried in our own runtime.

## Setup

- Mac Studio, Apple M5 Max, 128 GB, macOS 27. The live hub stayed up, so one-minute load was 12 to 17 the whole time. Every figure below
  carries that load: the Wan decode here (214 s) is slower than the 112 to 140 s in `video-generation-2026-10-17.md` section 4.
- Engine: a scratch copy of the pinned mlx-video `87db56a` engine (`~/video-bench/engine`); the live install was only read (weights). Each run held the
  machine gate lock at normal priority (the `heavy` wrapper runs at background priority and doubled the first decode, so it was not used for timings).
- Clips: 121 frames, 24 fps. Wan 832x480, prompt "ginger cat asleep on a kitchen table ... gentle camera push in", seed 7. LTX 768x448, same prompt (seed 7) and a
  rainy neon street (seed 8). Peak is `mx.get_peak_memory` in the process (MiniMax: whole-process footprint from `time -l`).
- Downloads (scratch, owner-approved): TAEHV decoders (github.com/madebyollin/taehv, MIT) 87 MB; Wan 5B q8 `Anes1032/Wan2.2-TI2V-5B-mlx-q8` model file 5.4 GB;
  `dgrauet/ltx-2.3-mlx-q4` and `-q8` transformer files 11.3 and 20.6 GB (plus unused extras); MiniMax-H3 set below, 109 GB.
- Drivers are in `docs/design/video-speed-bench-2026-11-01/`.

> Owner: Wan rejected on quality (2026-11-01). Sections 1 and 2 are history; the LTX sections and the tier verdict below carry the decision.

## 1. Tiny Wan decoder (VIDEO-GEN-11, VIDEO-EVAL-01)

`taew2_2` (the file made for the Wan 2.2 5B VAE: 48 latent channels, 16x spatial, 4x temporal) fits our latents. `taew2_1` is the 16-channel Wan 2.1 VAE and does
not fit the 5B model. The reference code is PyTorch and the owner declined a torch install, so the decoder was ported to MLX (about 130 lines, `taehv_mlx.py`,
weights read straight from the `.pth`). The decoder takes the latents the diffusion model emits, before the VAE's own mean/std step.

| Decoder (121 frames, 832x480, same latent) | Decode | Peak | PSNR against the original decoder (mean, worst frame) |
|---|---:|---:|---:|
| Original Wan2.2 VAE, aggressive tiling (as shipped) | 213.6 s | 25.6 GB (whole clip) | reference |
| `taew2_2`, fp16 | 0.58 s | 7.4 GB | 32.2, 30.8 dB |
| `taew2_2_super`, fp16 | 0.71 s | 10.5 GB | 33.1, 31.3 dB |
| `taew2_2`, fp32 | 3.73 s | 13.9 GB | 32.2, 30.8 dB |

Opened frames 0, 60 and 120 side by side (original left, tiny right): same layout, colour, lighting and pose. The tiny decode is slightly softer in
fur, curtain and window-glass texture; no new artefacts, flicker or colour shift seen. A clip is then about 24 s (load, text, 3 steps) plus under 1 s of
decode plus the mp4 save, against 238 s here (130 to 140 s unloaded). Pass bars: decode 30 s or less (met by 50x), clip 60 s or less (met).
**Verdict: adopt `taew2_2_super`** as Quick's decoder. It needs an MLX port in the Stack (new row; the port here is a working starting point), the weights
(41 MB, MIT) pinned, and the original decoder kept as the fallback. Not tested: 61-frame clips, picture-to-video, prompts other than the cat.

## 2. Wan 5B: FastWan 3-step bf16 against q8, q4 and 20-step

The Anes1032 build is the base Wan2.2 model (not the FastWan DMD distillation), so it was run as a base model (20 steps, guidance 5). FastWan q8 and q4 were made
here from the shipped FastWan weights with the same recipe (group 64, attention and feed-forward linears). Times exclude decode (the tiny decoder follows).

| Run (seed 7) | Frames | Time without decode | Peak | Weights file |
|---|---:|---:|---:|---:|
| FastWan bf16, 3 steps (today's Quick) | 121 | 24.0 s | 25.6 GB | about 10.8 GB |
| FastWan q8, 3 steps | 121 | 17.3 s | 25.4 GB | 5.4 GB |
| FastWan q4, 3 steps | 121 | 16.6 s | 25.5 GB | about 3 GB |
| FastWan q8, 3 steps | 61 | 10.9 s | 25.4 GB | 5.4 GB |
| Wan base q8, 20 steps, guidance 5 | 121 | 186.0 s | 25.6 GB | 5.4 GB |

Peak did not move with weight size or frame count, so it is set by something other than the transformer (cause not isolated; the text encoder load is the suspect).
That means **q8 does not by itself give VIDEO-GEN-09 a smaller footprint** (61 frames q8 peaked at 25.4 GB, as 121 frames bf16 did).

Quality, one frame from each clip (tiny decoder, frame 60; same seed, so the content differs because weights differ): bf16 sharp, one cat, clean; q8 coherent
but a second cat head appears beside the cat; q4 softer, one cat, no artefacts seen; base q8 at 20 steps blurrier fur and a smeared pose, worse than 3-step FastWan.
One clip per setting, so the q8 artefact may be seed luck.
**Verdicts:** 20-step base: skip (8x slower, worse). q8: needs-more (saves 7 s, no memory gain, one artefact in one clip; test 4 seeds). q4: needs-more (same, softer). Not run:
base bf16 at 20 steps (no bf16 base weights downloaded), because it only separates quantisation from distillation.

## 3. LTX-2.3 distilled: bf16 against q8 and q4 (121 frames, 768x448, with sound)

The pinned LTX loader has no quantised path; the bench patches the model load (scratch only, `bench_ltx.py`) to read the dgrauet files. Clip 1 includes loading from a cold file cache.

| Build | Clip | Wall | Load | Peak | Frames (decode) stage |
|---|---|---:|---:|---:|---:|
| bf16 (today's Boost) | kitchen | 72.2 s | 20.0 s | 40.4 GB | 22.1 s |
| bf16 | street | 62.4 s | 13.1 s | 40.4 GB | 19.7 s |
| q8 | kitchen | 62.7 s | 16.6 s | 33.8 GB | 20.1 s |
| q8 | street | 71.2 s | 19.5 s | 33.8 GB | 20.0 s |
| q4 | kitchen | 48.5 s | 5.4 s | 33.8 GB | 17.8 s |
| q4 | street | 48.6 s | 4.9 s | 33.8 GB | 17.3 s |

Per-step time is the same in all three (about 1.2 s at half size, 4.6 to 5 s at full size), so quantisation saved load time and 6.6 GB, not step time. Peak is the
same for q4 and q8, so a floor outside the transformer (the Gemma encoder phase) is likely. Sound was produced; speech was not transcribed (VIDEO-LTX-03 stays open).
Quality pairs (frames 60 and 116, bf16 left, quantised right; same seed, different composition): q8 kitchen has two cats where bf16 has one; q8 street and both q4 clips are
sharp, single subject, correct neon and wet-street look. The licence's same-terms rule for quantised derivatives applies (`resource-tiers-2026-10-27.md` section 5.3).
**Verdicts:** q4: adopt as the Boost build (needs a loader patch in the worker, the licence text shipped with it, and a speech check first). q8: skip (slower than q4, same peak, one duplicate subject).

## 4. LTX 2x upscale on and off (VIDEO-EVAL-02, partly)

The distilled pipeline always runs two stages, so "off" is not selectable without engine edits. Timeline of the bf16 clips (kitchen, street): 8 half-size steps about 8.2 s;
upscaler plus 3 full-size steps 14.5 to 14.7 s of the 22.9 s motion time (63 percent), 23 percent of the 62 to 72 s clip. q4 and q8 match within 1 s. The quality pair (half-size output
against two-stage) was **not run**. The other half of VIDEO-EVAL-02, a pixel upscaler on Wan Quick clips, was **not run**: it needs `realesrgan-mlx`, which was not approved for download,
and the LTX latent upscaler cannot take pixel clips. **Verdict: keep as is for Boost; needs-more for Quick.**

## 5. MiniMax-H3 (last, as ordered)

Set up as the community did: Argus MLX port (github.com/Argus-AiTeam/minimax-h3-mac, Apache-2.0) run in our engine's Python (mlx 0.32.4, no new package), calibrated INT8 DiT
(`water1234/MiniMax-H3-MLX-Argus-Calibrated-INT8`, 37.8 GB), the upstream BF16 text encoder, video VAE and audio VAE (`MiniMaxAI/MiniMax-H3` FL2VA folder, 66.7 + 10.4 + 0.6 GB), and the
LightX2V 4-step 768p Turbo LoRA (`lightx2v/Minimax-h3-Turbo`, 1.4 GB). Total download 109 GB. 768x448, 124 frames, 5.17 s with stereo sound, seed 7, 4 denoiser steps, no stream-blocks.

| Stage | Time |
|---|---:|
| Denoiser steps 1 to 4 | 41.8, 40.4, 39.7, 34.8 s (39.2 s mean) |
| Whole run (text encoder, steps, both VAE decodes, mux) | 239 s |
| Peak memory footprint | 14.8 GB (max resident 5.3 GB) |

This is far under the community figures (23 min on an M4 Pro, 8.8 min per step at a 768 short edge on an M3 Ultra) because the canvas is 768x448 (12,873 tokens), the DiT is INT8 and the chip is newer.
Two earlier attempts ended in a muxing error (no ffmpeg path given) after the same steps; their step times were 37.7 to 49.7 s, so the figure is repeatable. One clip only.
Quality, frames 0, 60 and 120: a single ginger cat asleep on a table beside lemons, golden window light, a smooth push-in as asked, plausible shadows and detail, no duplicate subject or flicker seen.
It is the best picture of the clips in this bench, with sound, in a quarter of the memory of Boost. The model was trained for a 768 short edge, so 768x448 is below its design size; larger canvases and the
speech were not tried. **Verdict: needs-more, leaning adopt as a Max-tier video candidate** (4.0 min for 5 s, 14.8 GB): check licence terms (MiniMax-H3 community licence), sound and speech, a 5-prompt
set, 1536x864, and a 2-stage latent upscale. Not run: BF16 DiT, the 8-step Turbo, the 2x latent upscaler and refiner the video used (no MLX path found).

Second MiniMax clip, run after the capability work (`mm-jake-768x448-5s.mp4`, prompt "Adventure Time cartoon, Jake the Dog and BMO in the Tree Fort, Jake yells DAISY! in a deep goofy voice"): 202 s total, 35.4 s per step, 12.7 GB peak footprint, 124 frames with stereo sound (mean -22.2 dB, peak -6.5 dB). <!-- prose-lint: allow -->
Opened frames (`mm-jake-sheet.png`): both characters are right, Jake with his green backpack and a blue BMO with face, arms and legs in a Tree Fort setting, mouths animated, Jake's mouth wide open in the last frame; a better character match than any LTX clip for BMO. Whisper heard "prison", so the shouted word is not confirmed intelligible; the owner must listen.
Both runs had Low Power Mode off; `pmset` shows no High Power Mode entry. Step times stayed between 34 and 42 s, so no throttling mid-run. The 608x352 fallback was not needed (under 10 minutes). `h3.c` was not tried (needs an owner yes first). The 109 GB MiniMax download is still in `~/video-bench/mm/models`; deleting it needs the owner's yes.

## Ranked verdict

1. Tiny Wan decoder `taew2_2_super`: adopt. Quick drops from about 240 s (130 to 140 s unloaded) to about 25 s; the largest single gain measured.
2. LTX q4 build for Boost: adopt after a speech check. 48.5 s against 62 to 72 s, 33.8 GB against 40.4 GB.
3. MiniMax-H3 INT8 plus Turbo: needs-more, promising. 239 s, 14.8 GB, best picture, with sound.
4. FastWan q8 and q4: needs-more. 7 s faster, no memory change.
5. LTX q8, Wan base 20-step: skip.
6. Upscale on/off: partly measured, no change proposed.

None of these reach "1440p in 440 s"; the ladder here is 480p in 25 s (Quick, silent), 768x448 with sound in 49 s (Boost) and 4 min (MiniMax-H3).

## Capability panel (2026-11-02)

What the models make from named people, icons, repeat characters, speech and sound effects. No prompt was softened. Nothing was downloaded. Every clip is in
`~/video-bench/capability/` (mp4 with sound for LTX, silent for Wan) with `<name>-sheet.png` (frames 0, 40, 80, 114) beside it; LTX clips also have `<name>-spec.png` (audio spectrogram).
LTX = Boost bf16, 768x448, 121 frames, seed 7, 68 to 101 s per clip under load (peak 40.4 GB). Wan = Quick FastWan 3-step with the tiny decoder, 832x480, seed 7, 22 to 42 s per clip.
"Recognisable" is my reading of opened frames, one clip per prompt: yes, partial (right cues, wrong design) or no (generic lookalike).

**Audio limit, stated plainly:** I cannot hear. The only local speech-to-text with MLX weights (whisper-large-v3-turbo) lacked its tokenizer files and fetching them was outside this task, so no transcript exists.
Audio is judged from loudness (`volumedetect`) and spectrograms only. "Matches" below means the sound's shape fits the prompt; **Jesse should listen to the speech and sound clips before relying on any audio line.**

| Prompt | Model | Recognisable | What the opened frames show | Audio |
|---|---|---|---|---|
| Golden Girls, four older women, cheesecake, sitcom light | LTX | no | four women of mixed ages at a sitcom-style kitchen table, one white-haired; not the cast; very sitcom-like set and light | present, -31 dB mean; not checked for talking |
| same | Wan | no | three older women (pink, blue, lilac) eating cake; generic; only three, not four | silent |
| Chuck Norris roundhouse kick, desert road | LTX | no | bald blond man in a black vest throws a high kick, a man in a hat walks by; no resemblance claimed | present |
| same | Wan | no | shirtless dark-haired man high-kicking on a desert road; kick pose correct | silent |
| Will Smith walking, talking to camera | LTX | no | white man, short grey hair, navy suit, walking down a city street, mouth moving; no likeness | present |
| same | Wan | no (cannot confirm a likeness) | Black man in an olive coat and tie, speaking to camera on a brick street | silent |
| Terminator (T-800) out of a burning wreck, red eye | LTX | partial | switched to a cartoon style: dark-red armoured humanoid, red glowing eyes and chest lights, fire behind; not a chrome endoskeleton | present |
| same | Wan | partial to yes | chrome skeletal robot, red eyes, standing before a burning vehicle: the closest T-800 look of all clips | silent |
| Darth Vader on a bridge igniting a red lightsaber | LTX | yes | helmet, cape, chest box on a suspension bridge; red blade ignites during the clip | present |
| same | Wan | yes | Vader in dark red light with a lit red saber already held, bridge | silent |
| Smurfs dancing in mushroom village | LTX | yes | classic cartoon look: blue Smurfs, white hats, Smurfette, mushroom houses; little dancing, mostly gesturing | present |
| same | Wan | partial | three blue 3D-style figures with red and white hats; wrong style, right idea | silent |
| Voltron forming and drawing sword | LTX | no | generic grey and yellow cartoon robot draws a sword, a boy in a red jacket beside it; not Voltron, no forming | present |
| same | Wan | no | a blue and red robot with a blue-white blade that resembles Optimus Prime, not Voltron | silent |
| SpongeBob cooking in the Krusty Krab kitchen | LTX | yes (SpongeBob); the second character is a Patrick and Mr. Krabs mix | show-accurate style, a spatula, a galley kitchen | present |
| same | Wan | yes | SpongeBob cooking at a stove in a purple kitchen; not the Krusty Krab | silent |

Reading: named real people come out as generic lookalikes in both models. Fictional icons split: Vader, SpongeBob and the Smurfs are recognisable on LTX, the Terminator is better on Wan, Voltron fails on both.
Composition from the prompt is good (kick, saber, spatula); fine action ("forming", "dancing", "igniting") is weaker.

### Owner-judged (2026-11-01, Jesse watched the first eight LTX clips)

| Prompt | Owner verdict |
|---|---|
| "Golden Girls" | recognisable show, wrong show: it produced the cast of Everybody Loves Raymond |
| SpongeBob | pretty good |
| Smurfs | almost perfect |
| Darth Vader | a little odd |
| Terminator, Voltron, Chuck Norris, Will Smith | all wrong |

**Owner: Wan rejected on quality (2026-11-01).** Every Wan Quick clip above and in sections 1 and 2 is kept as history only; no further Wan work. The Wan tiny-decoder numbers stay valid as measurements.

### Picture-to-video and the new prompts (LTX bf16, all with sound)

| Clip | Result |
|---|---|
| Terminator from a reference picture (`ltx-terminator-i2v-bf16`, 768x448, 117 s, 42.8 GB) | yes, a clear gain: a chrome skeletal robot with a red eye walks out of flames and wreckage, the T-800 look the text-only clip (a cartoon) never reached. The reference was the only local stand-in, a frame Wan made; the model keeps its look and adds motion and sound |
| Voltron, Chuck Norris, Will Smith from a picture | **not run**: no local picture of any of them exists and nothing was downloaded; a stand-in made by the same model would test motion, not likeness |
| BMO and Finn shouting "DEAN!" and "DAISY!" (`ltx-bmo-finn`, 8 s) | Adventure Time look and Tree Fort are right; two Finns appear (white hat, blue shirt) and no BMO, only a small teal block held between them; mouths open and shouting; audio present (mean -28.3 dB). Words not verifiable (no transcript) | <!-- prose-lint: allow -->
| Marie Barone, "Poor naive Sarkis. I kinda feel bad for him." (`ltx-marie-sarkis`, 8 s) | the set, light and framing match a 2000s multi-camera sitcom kitchen; an older woman with short white hair in a floral shirt shakes her head and looks down. Audio present (mean -31.6 dB); the line is unverified, and no likeness to a specific person is claimed |

## LTX tier verdict (q4 against q8 against bf16)

The quality pairs opened (same prompt and seed, bf16 first): Vader, Smurfs, SpongeBob, Golden Girls (q4) and Vader, SpongeBob, Smurfs (q8). Sheets: `pair-<name>-bf16-q4.png`, `ltx-<name>-q8-sheet.png`.
Seeds give different compositions per build, so these are quality samples, not pixel comparisons.

| Prompt | q4 against bf16 | q8 |
|---|---|---|
| Vader | q4 is the better clip: night bridge, the helmet, cape and chest panel read as Vader, the saber ignites on cue (bf16 was the "a little odd" one) | clean cinematic night, silhouette then saber, no flaw seen |
| SpongeBob | q4 cleaner: SpongeBob and a correct Mr. Krabs (bf16 gave a Patrick and Krabs mix) | clean, SpongeBob cooking beside Patrick, a bottle pours into a pot |
| Smurfs | q4 has Papa Smurf and Brainy as well; as good as bf16 | clean, no flaw seen |
| Golden Girls | same Raymond-style cast and kitchen, one extra man standing; no loss | not run |

Numbers (section 3 and these runs): q4 33.8 GB and 48.5 s (warm, light load); q8 33.8 GB and 62 to 71 s; bf16 40.4 GB and 62 to 72 s. Under load the capability clips took 55 to 78 s on q4, 66 s on q8 and 68 to 101 s on bf16.
No flaw seen on q4 or q8 beyond the single duplicate cat in the q8 benchmark clip, and bf16 had its own odd Vader and a mixed-up SpongeBob scene. Seven pairs, one seed each, and no speech check, so this is a lean, not a proof.

Pick per slot:
- **Lowest tier and default: q4.** Least memory (33.8 GB), fastest (about 49 s a 5 s clip), no quality loss I could find in the opened pairs.
- **A higher tier with spare memory: still q4.** bf16 costs 6.6 GB and 15 to 25 percent more time and did not look better. Keep bf16 only as the reference build for bench comparisons, not as a tier.
- **q8: drop.** Same peak as q4, slower, no visible gain.
- Before pinning q4: a speech check (VIDEO-LTX-03), the derivative licence text shipped with it, and a worker patch for the quantised load (`bench_ltx.py` shows the 15 lines).

### Character consistency (LTX; same woman in a red coat with short grey hair)

| Run | Consistent | Notes (frames opened) |
|---|---|---|
| Text-only, three shots (park, cafe, train station): `cons-text-*` | partial | red coat and short grey hair hold in all three; the coat's cut, the handbag and the apparent age change; faces cannot be compared (distant in two shots, close-up in one) |
| Each shot started from the same reference picture (a cafe frame): `cons-ref-*` | yes for identity, no for the prompt | all three clips keep the same face, coat and room, but ignore the new scene: the "park" and "station" clips stay in the cafe and barely move (a passer-by or a bus crosses the window). The picture pins the person and also the place |

So a reference picture gives sameness at the price of controlling the scene; text-only follows the scene but drifts. Not tried: a reference with a face plus a changed background, or picture anchors at the end of a clip (VIDEO-EVAL-03).

### Speech and sound effects (LTX only; Wan Quick makes no sound)

| Prompt | Audio inspected | Matches |
|---|---|---|
| man in a dark corridor says "We leave at dawn, and we do not look back." seed 7 (`speech-a1`) | voiced bursts with harmonic structure, mean -37.6 dB; man speaks to camera, mouth and face steady | unverified by ear; speech-like |
| same prompt, seed 8 (`speech-a2`) | similar voiced bursts, mean -33.3 dB | unverified; same voice across runs not testable without listening |
| door slam (`sfx-door`) | two sharp broadband impacts and one at the end, peak -8.9 dB; the clip shows a woman opening and closing a door (anime style) | partial to yes |
| rain on a window (`sfx-rain`) | very faint noise, mean -46.9 dB, no clear rain texture | partial to no |
| car passing (`sfx-car`) | loud steady broadband noise, peak -2.7 dB, no rise and fall for a pass; the picture shows a wet street and cyclists, no prominent car | partial |

Wan Quick is silent by design; no audio stream is written.

## Audio transcripts and the audio verdict (2026-11-02)

Whisper large-v3 turbo (MLX, offline; tokenizer files fetched on the owner's yes, about 3 MB) transcribed every clip with sound; transcripts sit beside each clip as `<name>.txt` in `~/video-bench/capability/`.
Whisper only reads words. On laughter, music, rain, traffic and ambience it prints filler ("Thank you.", "You", "."), so those lines are **not** evidence about the sound; they are listed only where words were asked for.

| Clip | Asked | Heard (Whisper) | Verdict |
|---|---|---|---|
| `speech-a1` (bf16, seed 7) | "We leave at dawn, and we do not look back." | "We leave at dawn and we do not look back." | exact |
| `speech-a2` (bf16, seed 8) | same | "We leave at dawn and we do not look back." | exact; voice identity across the two runs not judged (no ear) |
| `ltx-marie-sarkis` (bf16) | "Poor naive Sarkis. I kinda feel bad for him." | "Poor naive Snarkers. I'm a little mad friend." | right rhythm, words partly wrong |
| `ltx-marie-sarkis-q8` | same | "Poor naive Sarkis. I kind of feel bad for him." | right |
| `ltx-marie-sarkis-q4` | same | "Poor Naive Sarkis. I kind of feel bad for him." | right |
| `ltx-bmo-finn` (bf16, 8 s) | BMO "DEAN!", Finn "DAISY!", alternating | "game you" | wrong | <!-- prose-lint: allow -->
| `ltx-spongebob-patrick`, `-2`, `-3` (bf16, made by the videos session) | Dean and Daisy shouted | "Oh, Daisy! Daisy! Daisy! Daisy! Daisy!"; "Daisy Daisy Daisy"; "Dean. Dean. Daisy. Dean. Daisy." | the third has the alternation; the first two only Daisy | <!-- prose-lint: allow -->
| `ltx-bmo-jake` | made by the videos session | "Pain a little bad, through that now! The end." | not scored (prompt not in my files) | <!-- prose-lint: allow -->
| `ltx25-calico` (LTX 2.5, separate runtime, videos session) | made by the videos session | "Trade in your Mac Studio for two Collico Critters!" | clear words; spelling of the brand is Whisper's | <!-- prose-lint: allow -->
| `ltx-goldengirls` (bf16), `-q4`, `-q8` | laughter, no words asked | "Thank you." / "Golden girl." / n/a | filler; no evidence |
| `ltx-spongebob` (bf16), `-q4`, `-q8` | no dialogue asked | "Oh, oh, oh, ..." / "Please don't leave you with Hey" / "And it's a good sign." | q4 and q8 invented words; bf16 made laughter, matching what the owner heard |

### Owner-judged audio (2026-11-01 and 2026-11-02)

- Golden Girls, same prompt and seed: bf16 laugh track "perfect", q4 laugh track "sounds awful"; the bf16 Marie clip "sounded fine".
- SpongeBob, no dialogue in the prompt: bf16 had Patrick laughing, background music and effects (good); q8 had gibberish words.
- Vader: bf16 live-action daytime, q8 animated night; q4 also changed the picture style. The earlier picture-only reading above ("q4 looks better") did not weigh sound or style fidelity and is withdrawn.

### Measured sound, bf16 against q8 against q4 (48 kHz mono, no clipping in any clip)

| Clip | build | mean level | quiet-floor level | brightest 50 ms | share above 8 kHz |
|---|---|---:|---:|---:|---:|
| Golden Girls | bf16 / q8 / q4 | -27.0 / -26.1 / -25.8 dB | -42.3 / -42.1 / -40.5 dB | -23.0 / -18.6 / -19.3 dB | 0 |
| Marie | bf16 / q8 / q4 | -31.8 / -30.7 / -30.7 dB | -44.6 / -50.5 / -50.9 dB | -24.1 / -21.5 / -22.8 dB | 0.1 percent |
| Rain on a window | bf16 / q8 / q4 | -47.9 / -47.5 / -45.6 dB | -50.7 / -49.6 / -47.5 dB | -44.6 / -44.8 / -43.4 dB | 0.02 to 0.04 percent |
| SpongeBob | bf16 / q8 / q4 | -25.8 / -15.7 / -17.7 dB | -30.5 / -18.7 / -24.5 dB | -19.4 / -12.2 / -13.1 dB | 0.4 / 0.3 / 0.2 percent |

What the numbers show: on Golden Girls the three spectrograms (`gg-audio-spectrograms-bf16-q8-q4.png`) match in structure, but q8 and q4 carry much stronger low-frequency energy and wider bursts in the first quarter of the clip, and q4's quiet floor is 1.8 dB higher; there is no hiss
(nothing above 8 kHz) and no clipping, so the "awful" laughter is not explained by noise or distortion in these numbers. On SpongeBob the quantised builds are 8 to 10 dB louder with a quiet floor 6 to 12 dB higher: they added sound the bf16 clip did not have, which fits the owner hearing invented words. Rain is near silent on all three (peak -45 dB), no build makes a convincing rain bed.
I cannot hear, so the owner's ears outrank this table. The q8 Golden Girls clip (`ltx-goldengirls-q8.mp4`) and the q8 and q4 Marie and rain clips are in the folder for listening; the owner has not yet heard q8.

### Owner verdict on the Golden Girls laugh track (same prompt, seed 7; 2026-11-02)

bf16: "perfect". q8: "a mix of laugh track and muffled static". q4: "awful". Owner's audio order: **bf16 > q8 > q4**.

Measured on the same three clips (ffmpeg `ebur128` and a spectral-flatness pass over 100 Hz to 12 kHz; flatness near 0 is tonal, higher is more noise-like):

| Build | Integrated loudness | Loudness range | True peak | Flatness, whole clip | Flatness, first quarter | Flatness, rest |
|---|---:|---:|---:|---:|---:|---:|
| bf16 | -21.9 LUFS | 1.5 LU | -10.8 dBFS | 0.0045 | 0.0124 | 0.0019 |
| q8 | -22.0 LUFS | 0.5 LU | -11.2 dBFS | 0.0155 | 0.0490 | 0.0045 |
| q4 | -21.7 LUFS | 0.7 LU | -9.6 dBFS | 0.0112 | 0.0307 | 0.0047 |

Where the numbers agree with his ears: q8 is the most noise-like by a wide margin (3.4 times bf16 over the clip, 4 times in the first quarter), which fits "muffled static"; q4 is also noisier than bf16 (2.5 times). Loudness is the same in all three, so it is not a level difference.
Where they do not: flatness puts q8 as noisier than q4, while the owner heard q4 as worse; "awful" in q4 may be the laughter's character rather than static, and these measures do not capture that. Both quantised clips have a loudness range one third to one half of bf16's (0.5 and 0.7 against 1.5 LU), a flatter, less lively track.

### Verdict for sound (replaces the pick-per-slot list above for any clip with audio)

- **bf16 for anything with sound.** Two owner reports (q4 laughter awful, q8 invented words) and the louder, higher-floor quantised tracks all point one way. bf16 stays Boost unless the owner listens to q8 and finds it equal.
- **Audio order, owner: bf16 > q8 > q4.** q8 had muffled static on Golden Girls and gibberish words on SpongeBob; q4 had an awful laugh track. Quantised builds only for silent or low-audio use.
- **Quantised builds only where silent or low-audio use is accepted.** In that use q4 stays the cheaper pick (33.8 GB, about 49 s). Note the one result in q4's favour: the Marie line came out right on both quantised builds and wrong on bf16 in this seed; one seed does not outweigh the owner's listening.

## MiniMax-H3 on the owner's use cases, with dialogue (2026-11-02)

Argus INT8 DiT plus Turbo 4-step LoRA, 768x448, 124 frames (5.17 s) with stereo sound, seed 7, 4 denoiser steps, run one at a time under the gate lock, Low Power Mode off. Visual prompts are the same as the earlier `ltx-<slug>` clips plus a new Raymond prompt.
Every prompt ends with the same two-line dialogue in separate turns (Dean: "Daisy, dinner is ready." then Daisy: "Coming, Dad!", one voice at a time, no laugh track, no music); for Smurfs, Voltron and SpongeBob the father and daughter were made characters of that world (Papa Smurf and Smurfette, a pilot father and daughter, Mr. Krabs and Pearl). <!-- prose-lint: allow -->
Wall time includes loading and the streamed text encoder. Frames were opened (`minimax-<slug>-sheet.png`). Whisper transcripts are `minimax-<slug>.txt`. **Voice likeness to a character is not judged here: I cannot hear. Owner verdict on the first MiniMax speech clip (Jake and BMO): the words were gibberish until the last "DAISY!" and the voices did not sound like the characters' normal voices; the LTX-2.3 clips did.** Word accuracy below is from Whisper only. <!-- prose-lint: allow -->
I do not judge whether a real person's face matches a named person; where a real person was named I describe the picture and leave the likeness to the owner.

| Clip (`minimax-<slug>.mp4`) | Wall | Per step | Peak | Picture (opened frames) | Whisper transcript against the two lines |
|---|---:|---:|---:|---|---|
| goldengirls | 182 s | 30.2 s | 13.4 GB | not the Golden Girls and not Raymond: a generic bright kitchen, three women and a white-bearded man eating cheesecake; sharp, cinematic | both lines exact |
| raymond | 196 s | 31.9 s | 13.0 GB | a very convincing 2000s multi-camera sitcom kitchen with a father standing, two girls and an older woman seated | both lines, plus an invented sentence between them |
| chucknorris | 188 s | 30.9 s | 12.6 GB | muscular blond man in a white tee on a desert road beside a little girl; no kick (the dialogue replaced the action) | both lines, small wording changes ("dinner's ready", "Coming, Dad.") |
| willsmith | 202 s | 32.9 s | 13.1 GB | middle-aged man with a grey goatee in a dark suit walking a city street with a girl, smiling; likeness left to the owner | both lines exact |
| terminator | 204 s | 33.0 s | 12.6 GB | man with a glowing red cybernetic eye in armour walking out of a burning vehicle: clearly the Terminator character look, a young girl enters at the end | both lines, small wording changes |
| vader | 207 s | 33.2 s | 12.6 GB | excellent: detailed Vader in a Death Star style corridor, a girl in a pink dress, red saber ignites; the best character match of the set | both lines exact |
| smurfs | 192 s | 32.1 s | 13.2 GB | modern 3D Smurfs (not the classic 2D look): Smurfette, a white-bearded Smurf, a red-hatted Smurf behind, mushroom village | "Hey Zeezy, dinner is ready. Coming, Dad!" (name misheard) | <!-- prose-lint: allow -->
| voltron | 187 s | 31.2 s | 13.1 GB | an 80s anime super robot in red and gold with a drawn sword, a boy pilot and an orange-haired girl in the cockpit; a Voltron-like show look but not Voltron | "Daisy, dinner is ready. It's coming, Dad." |
| spongebob | 199 s | 32.5 s | 12.6 GB | show-accurate: SpongeBob, Mr. Krabs and a blonde girl at the Krusty Krab sign (lettering slightly garbled), a pot steaming | both lines exact |
| jake-bmo (earlier) | 202 s | 35.4 s | 12.7 GB | Jake and a proper blue BMO with face and limbs in the Tree Fort | "...DAISY!" at the end only; owner: gibberish before it, voices not the characters' | <!-- prose-lint: allow -->

Reading, judged separately (a matching transcript says nothing about picture, voice quality or voice likeness, and a clip is not good because Whisper matched the words):
- **Words:** Whisper heard both lines in 8 of 9 clips; this only says the words were spoken clearly enough to transcribe.
- **Picture (my opened-frame reading):** sharp and detailed on Vader, SpongeBob, Raymond and Terminator; "Golden Girls" is not recognisable; Smurfs in a newer 3D look; Voltron is a different robot.
- **Voice quality and likeness:** not judged by me (I cannot hear). Owner: the Jake and BMO voices were not the characters' and the speech was gibberish until the last word; the Golden Girls clip is "awful" despite word-perfect Whisper lines.
- **Cost:** 182 to 207 s a clip against LTX bf16's 62 to 100 s, at 12.6 to 13.4 GB against 40.4 GB.

### Owner-judged on the MiniMax clips (2026-11-02)

| Clip | Owner verdict |
|---|---|
| `minimax-jake-bmo` | gibberish until the final "DAISY!"; voices not the characters' normal voices (LTX-2.3 clips sounded like the characters) | <!-- prose-lint: allow -->
| `minimax-goldengirls` | "awful", despite word-perfect lines |
| `minimax-willsmith` | looked pretty good; colour and vibrancy far too intense |
| `minimax-chucknorris` | looked good but is not him |
| all clips naming a real person | nobody got a real person right |

### Saturation, with a rerun asking for natural colour (`minimax-willsmith-natural`, same seed and dialogue, wording appended: "natural realistic colour grading, muted neutral colours, true-to-life skin tones, soft contrast, not oversaturated")

| Clip | Mean HSV saturation | 95th percentile | `signalstats` SATAVG |
|---|---:|---:|---:|
| `ltx-willsmith` (LTX-2.3 bf16) | 19.4 percent | 53.3 percent | 7.7 |
| `minimax-willsmith` | 27.4 percent | 60.1 percent | 8.9 |
| `minimax-willsmith-natural` | 28.3 percent | 58.3 percent | 9.1 |

By the numbers MiniMax is about 40 percent more saturated than LTX on the same prompt, which fits the owner's eyes. The natural-grading wording did **not** lower the measured saturation (28.3 against 27.4 percent); in the opened frames it changed the clothing colours (the girl's pink top became a grey hoodie) and the street looks slightly cooler, but the metric sees no reduction, so prompt wording alone is not a reliable fix. The rerun took 192 s, 12.8 GB, and Whisper heard both lines ("Daisy, dinner is ready. Coming, Dad."). A colour-grade pass after generation is the untested alternative.

### Block cache (approximate residual caching) on top of Turbo

| Clip, seed 7 | Per step | Wall | Peak | Picture | Whisper |
|---|---:|---:|---:|---|---|
| goldengirls, no cache | 30.2 s | 182 s | 13.4 GB | clean | both lines exact |
| goldengirls, `--block-cache` | 21.1 s | 146 s | 13.0 GB | same layout; faces mushier, colours more saturated, more banding on the table cloth | "Hey, hey, hey, dinner is ready. Coming down!" (words changed) | <!-- prose-lint: allow -->
| smurfs, no cache | 32.1 s | 192 s | 13.2 GB | clean | name misheard, otherwise both lines |
| smurfs, `--block-cache` | 19.2 s | 140 s | 13.2 GB | same layout; slightly posterised, small details softer | "FOX 3" (speech lost) |

Block cache saves 27 to 40 percent of step time and 20 to 27 percent of the clip, but it costs visible picture detail and, more importantly, the speech. **Verdict: do not use it for clips with dialogue; at most a "draft" speed mode for silent pictures, which is not what these clips are for.** One seed per case.

## Clip inventory (all clips in `~/video-bench/clips/`)

**Every finished clip is an `.mp4` in `~/video-bench/clips/` (flat, the file names below).** Sheets (`-sheet.png`), wavs, transcripts (`.txt`), spectrograms and logs stay in `~/video-bench/capability/`; any clip path elsewhere in this record means the same file name in `clips/`. All have sound unless marked silent.

| File name pattern | Model and build | Settings |
|---|---|---|
| `ltx-<slug>.mp4` for goldengirls, chucknorris, willsmith, terminator, vader, smurfs, voltron, spongebob | LTX-2.3 distilled bf16, mlx-video 87db56a | 768x448, 121 frames, seed 7, 5 s |
| `ltx-<slug>-q4.mp4`, `-q8.mp4` (goldengirls, smurfs, spongebob, vader; also marie-sarkis, sfx-rain) | LTX-2.3 distilled, dgrauet q4 or q8 transformer, same loader patch | as above; marie-sarkis 193 frames |
| `ltx-terminator-i2v-bf16.mp4` | LTX-2.3 bf16 picture-to-video from `ref-terminator.png` (a Wan frame) | 768x448, 121 frames, seed 7 |
| `ltx-bmo-finn.mp4`, `ltx-marie-sarkis.mp4` | LTX-2.3 bf16 | 768x448, 193 frames (8 s), seed 7 |
| `cons-text-park|cafe|station.mp4`, `cons-ref-park|cafe|station.mp4` | LTX-2.3 bf16, text-only and picture-to-video from `ref-woman.png` | 768x448, 121 frames, seed 7 |
| `speech-a1.mp4`, `speech-a2.mp4` | LTX-2.3 bf16 | seeds 7 and 8 |
| `sfx-door.mp4`, `sfx-rain.mp4`, `sfx-car.mp4`; `sfx-rain-q4.mp4`, `-q8.mp4` | LTX-2.3 bf16 (and q4, q8 for rain) | seed 7 |
| `wan-<slug>.mp4` (8 clips, silent) | Wan2.2 FastWan 3-step bf16, tiny `taew2_2_super` decoder; **owner: Wan rejected** | 832x480, 121 frames, seed 7 |
| `minimax-<slug>.mp4` (cat-768x448, jake-bmo, goldengirls, raymond, chucknorris, willsmith, terminator, vader, smurfs, voltron, spongebob) | MiniMax-H3, Argus INT8 DiT, Turbo 4-step | 768x448, 124 frames, seed 7, no block cache |
| `minimax-goldengirls-blockcache.mp4`, `minimax-smurfs-blockcache.mp4` | same plus `--block-cache` | same |
| `ltx-bmo-jake.mp4`, `ltx-gamer-crabs.mp4`, `ltx-spongebob-patrick*.mp4`, `ltx25-*.mp4` | made by the videos app session with my driver and its own LTX-2.5 runtime; settings are in that session's notes, not in my files | not recorded here |


## Two other H3 runners against the Argus baseline (2026-11-02)

Same prompt for all three: the Golden Girls prompt with the Dean and Daisy dialogue (`minimax-goldengirls`), seed 7, 768x448, 124 frames (5.17 s), one run each, one at a time under the gate lock, Low Power Mode off. Clips: `~/video-bench/clips/minimax-goldengirls.mp4`, `minimax-goldengirls-solattn.mp4`, `minimax-goldengirls-h3c.mp4`.

| Runner | Weights used | Steps | Wall | Per step | Peak | Words (Whisper) | Picture (opened frames) |
|---|---|---|---:|---:|---:|---|---|
| Argus MLX (baseline) | Argus INT8 DiT, lightx2v Turbo LoRA | 4 | 182 s | 30.2 s | 13.4 GB | both lines exact | four older people at a table, saturated colour, sharp |
| MLX + Sol-Attn (`yshenaw/ComfyUI-MiniMax-H3-MLX-SolAttn`, commit 55bb7ddd0) | plain 8-bit DiT built locally from the BF16 download, larryvrh Turbo LoRA | 4 | 184 s | 25.4 s | 56.5 GB | both lines exact | very close to the baseline: same four people and table, colour as saturated |
| `h3.c` (`antirez/h3.c`, commit 8974cc055) | BF16 transformer straight from the upstream folder, no LoRA | 20, 45 layers, reuse 2, token reduction, int8 fc2 | 162 s | 11 DiT evaluations, 97 s in total | 20.1 GB | "Days. Get his dinners ready. Yeah. He's coming. Coming, Dad." (words partly wrong, extra words) | four older people at a round table, warmer and flatter light, a tidy kitchen; not the Golden Girls in any of the three |

Mean HSV saturation of the three clips: 54.2 (Argus), 55.7 (Sol-Attn), 52.4 percent (h3.c): no meaningful difference, so the owner's "too vibrant" note applies to all three.

Findings:
- **Sol-Attn is not a win on this machine.** Its step is 16 percent faster (25.4 against 30.2 s) but the whole clip takes the same 184 s, and it needs 56.5 GB against 13.4 GB because it stages the text encoder at 26 GB and holds the DiT resident. It cannot load the Argus INT8 build (8 quantised tensors differ) or the lightx2v LoRA (key names differ); it needed its own 8-bit build (44 GB of disk, made from the existing BF16 download with its `build_quant.py`) and a 0.78 GB LoRA download (`larryvrh/MiniMax-H3-Turbo-Lora`, owner yes). The runner wrote PNG frames and a wav but no mp4 (no ffmpeg on its path); I muxed them with the Stack's ffmpeg, H.264 and AAC, no other change.
- **h3.c is fastest and smallest to run (162 s)**, a plain C and Metal program that builds in seconds with `make`, reads the BF16 upstream folder with no conversion, and needs no Python. Its price is quality control: it has no Turbo LoRA option, so it runs 20 steps with approximations (45 of 50 blocks, reused steps, paired tokens), and the speech came out partly wrong. The 162 s includes a 57 s video decode that is not part of the DiT.
- **None of the three is better than the others on picture or colour.** For this prompt the baseline Argus run has the best words; h3.c is the fastest; Sol-Attn is neither faster nor lighter.
- The first h3.c run also ended without a clip because ffmpeg and ffprobe were not on its PATH (about 188 s lost); the clip above is the rerun.

Verdict: **skip Sol-Attn; h3.c is worth a closer look** (needs-more: try its 6-step and 8-step settings, a Turbo-style LoRA if the author adds one, and a speech-focused check) while the Argus INT8 + Turbo run stays the reference at 182 s and 13.4 GB.


## PipeNetwork's own port and quantised builds (2026-11-02)

`PipeNetwork/minimax-h3-mlx` (Apache-2.0, commit b2f7e4d2b), run in the engine's Python with the upstream FL2VA folder for the text encoder and VAEs, with its published 8-bit and 6-bit DiT builds (`pipenetwork/MiniMax-H3-MLX-8bit` 35.3 GB and `-6bit` 30.3 GB, fetched on the owner's yes into `~/video-bench/mm/models-pipenet/`). Same Golden Girls and Dean/Daisy prompt, seed 7, 768x448, 124 frames, text-to-video only.
Its `generate.py` has no Turbo LoRA option (and no sigma-shift or ffmpeg flags), so this is the base model on the fewest steps it allows for the comparison: 5 sigma points, 4 forwards. One run each, gate lock held, ffmpeg from the Stack's copy on the path.

| Build | Wall | Steps (first, then the rest) | Peak footprint | Words (Whisper) | Picture (opened frames) |
|---|---:|---|---:|---|---|
| Argus INT8 + Turbo, baseline | 182 s | 30.2 s mean | 13.4 GB | both lines exact | four older people, bright kitchen |
| PipeNetwork 8-bit, no LoRA | 434 s | 93.7, then 25.5, 21.6, 21.5 s | 113.1 GB | "Easy dinner is ready. Coming, Dad!" | coherent: a man and three women eating cheesecake at a patterned tablecloth; darker, with an odd quilted-leather wall; no flicker seen | <!-- prose-lint: allow -->
| PipeNetwork 6-bit, no LoRA | 323 s | 60.8, then 20.2, 34.8, 24.4 s | 113.0 GB | "Daisy, dinner is ready. Coming, Dad." | the same layout and cast, candles on the shelf, same quilted wall; coherent |

Reading:
- **The steps are fast once warm** (about 21 to 25 s against the baseline's 30 s) because the DiT stays resident, but the first step pays 61 to 94 s of loading and the AdaLN cache build takes 12 to 40 s, so the whole clip is 323 to 434 s, 1.8 to 2.4 times the baseline.
- **Peak memory is 113 GB for both builds**, near the machine's total: the port keeps a 50 GB text encoder, the DiT and the VAEs live together. That is not safe beside the live hub; it ran only because nothing else heavy was running. The Argus runner stays at 13.4 GB by streaming.
- **No LoRA means no speed gain from Turbo:** four forwards without the distillation LoRA still gave a clean picture here, but the colour balance and background differ from the Turbo clips, and one seed cannot say more.
- 8-bit against 6-bit: 6-bit is 25 percent faster and sounded better in this one pair; both are coherent.

Verdict: **skip as a runner** (slower and 8 times the memory of Argus INT8 + Turbo). Argus remains the reference at 182 s and 13.4 GB, with h3.c (162 s, 20.1 GB) as the one faster candidate to study. PipeNetwork's builds are useful only as a check that the picture holds at 6 and 8 bits; a Turbo LoRA loader for this port was not found.


## H3 parked (owner decision 2026-11-02)

**MiniMax-H3 is parked.** Reasons, with numbers from this record: the best Mac runner (Argus INT8 + Turbo 4-step) takes 182 s for a 5 s 768x448 clip at 13.4 GB; the faster candidates do not beat it (Sol-Attn 184 s and 56.5 GB, PipeNetwork 8-bit 434 s and 6-bit 323 s at 113 GB, h3.c 162 s with partly wrong speech); the owner judged the first MiniMax speech clips as gibberish with voices not the characters' and the Golden Girls clip "awful"; the Argus path supports only text-to-video in its low-memory mode (the videos session had to use another mode for picture-to-video, and reported crashes with pictures); no fast picture-capable Mac runner exists. The 109 GB set and the other builds stay in scratch.
**What would reopen it:** a Mac runner that does picture-to-video and keeps a 5 s 768x448 clip with sound under about 90 s and under 40 GB, with voices judged acceptable by the owner. Until then the video ladder is LTX.

## LTX-2.5 q8 Standard ladder, with sound (2026-11-02)

Runtime: the `dgrauet/ltx-2-mlx` fork in `~/video-bench/ltx25-runtime`, `ltx-2-mlx generate --distilled` (8 stage-1 steps, then 3 refine steps), MrMofer LTX-2.5 q8 weights, seed 7, 24 fps, one run per cell, one at a time under the gate lock at normal priority, load 12 to 16 from the live hub. Every run is a fresh process, so each includes loading Gemma (3 to 6.5 s) and the weights; a warm worker would save most of that.
Memory, one method for every run: **`/usr/bin/time -l` "peak memory footprint" for the whole process** (the tool prints no memory counter of its own). Maximum resident was 22.2 to 22.5 GB in every run. Time: **"tool" is the time the tool prints; "process" is `/usr/bin/time` real time**; stage times come from the tool's own log (text encoder, prompt encoding, decode and mux). Clips: `~/video-bench/clips/ltx25-std-<size>-<slug>.mp4` (97-frame ones carry `-f97`).

| Size, frames | Prompt | Tool | Process | Peak footprint | Gemma load + prompt encode | Decode and mux | Loudness | Quiet floor |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 512x288, 121 | Marie | 51.9 s | 53.1 s | 25.3 GB | 6.5 + 5.4 s (cold first run) | 5.6 s | -19.7 LUFS | -81.7 dB |
| 512x288, 121 | Smurfs | 27.0 s | 28.0 s | 25.2 GB | 3.4 + 1.2 s | 5.6 s | -12.2 | -17.8 |
| 512x288, 121 | rain | 30.5 s | 31.6 s | 25.3 GB | 3.2 + 1.3 s | 5.3 s | -46.6 | -55.5 |
| 512x288, 97 | Marie | 41.1 s | 42.1 s | 24.3 GB | 4.0 + 2.4 s | 6.4 s | -24.3 | -73.3 |
| 512x288, 97 | Smurfs | 29.2 s | 30.0 s | 24.3 GB | 3.1 + 2.4 s | 4.5 s | -51.9 | -68.7 |
| 512x288, 97 | rain | 30.3 s | 31.1 s | 24.3 GB | 3.3 + 1.4 s | 3.8 s | -55.1 | -66.5 |
| 640x352, 121 | Marie | 41.6 s | 42.7 s | 32.4 GB | 3.1 + 1.2 s | 10.5 s | -16.8 | -74.1 |
| 640x352, 121 | Smurfs | 48.7 s | 49.8 s | 32.4 GB | 3.5 + 2.1 s | 7.7 s | -38.4 | -48.5 |
| 640x352, 121 | rain | 42.0 s | 43.0 s | 32.5 GB | 3.3 + 1.5 s | 7.6 s | -51.6 | -60.8 |
| 768x448, 121 | Marie | 74.2 s | 75.1 s | 45.8 GB | 3.5 + 1.2 s | 15.2 s | -21.8 | -57.4 |
| 768x448, 121 | Smurfs | 70.8 s | 71.9 s | 45.9 GB | 3.3 + 2.5 s | 12.0 s | -10.2 | -16.6 |
| 768x448, 121 | rain | 63.5 s | 64.5 s | 45.8 GB | 3.7 + 2.8 s | 11.8 s | -55.1 | -61.3 |

The three refine steps take 7 to 12 s at 512x288 (Smurfs 7, rain 10, Marie 11), 12 to 18 s at 640x352 and 21 to 32 s at 768x448 (stage 1 and the rest are the remainder). Dialogue clips (Marie) run longer than the same size without speech, by 10 to 25 s in these runs, and the first run paid cold-cache costs. The SpongeBob and Patrick turn-by-turn prompt was not run: its exact text was not available to me.

**Words (Whisper):** the Marie line came out exact in all four Marie clips (512x288 at 121 and 97 frames, 640x352 and 768x448): "Poor naive Sarkis. I kind of feel bad for him." The Smurfs and rain clips have no words asked; Whisper's filler there is not evidence.
**Picture (frames opened at 512x288 and 768x448; the 640x352 and 97-frame clips were not opened):**
- Marie: a convincing multi-camera sitcom kitchen with an older white-haired woman, sharp even at 512x288; at 768x448 she wears a red plaid shirt, speaks to the plate and the kitchen detail is richer.
- **Smurfs: not Smurfs at either size.** LTX-2.5 draws live-action village dancers in straw hats and bright costumes in front of thatched huts; the IP knowledge LTX-2.3 had is gone.
- Rain: a man in profile beside a rainy window with a candle; the rain on the glass is faint.
**Sound:** Marie has speech at -17 to -24 LUFS. The Smurfs clips range from -10 LUFS (loud, likely music or crowd) to -52 LUFS (nearly silent in the 97-frame and 640 runs): the sound is inconsistent from run to run. The rain clips sit at -47 to -55 LUFS with a quiet floor of -55 to -67 dB: close to silence, no convincing rain bed. I did not listen; owner to judge.

**Against the Wan FastWan Quick floor** (`capability/wan.log`, 8 clips, 832x480, silent, tiny decoder, no mux): 22.3 to 42.1 s, median 25.0 s. LTX-2.5 q8 with sound is within about 2x of that floor at 512x288 (27 to 52 s per process, warm runs 27 to 31 s) and at 640x352 (42 to 49 s, 1.7 to 2.0 times the median); 768x448 (64 to 74 s) is 2.5 to 3 times it. So **sound plus video at Wan's speed is reachable at 512x288, and at about twice Wan's time at 640x352**, with 25 to 32 GB peak against Wan's 25.5 GB at 832x480. The price is smaller pictures (512x288 and 640x352 against 832x480).


### SpongeBob and Patrick turn by turn, and LTX-2.3 against LTX-2.5 for cartoon recall (2026-11-02)

Prompt: the videos session's turn-by-turn SpongeBob and Patrick prompt (DEAN! then DAISY!, alternating, one voice at a time), seed 7, 121 frames. <!-- prose-lint: allow -->

| Model | Size | Tool time | Peak | Whisper | Picture (opened frames) |
|---|---|---:|---:|---|---|
| LTX-2.5 q8 `--distilled` | 512x288 | 26.6 s | 25.4 GB footprint | "Deanne! Daisy! Deanne! Daisy! Daisy!" | show-accurate SpongeBob and Patrick, speaker's mouth moves, the other's is closed | <!-- prose-lint: allow -->
| LTX-2.5 q8 | 640x352 | 37.4 s | 32.5 GB | "Deanne! Daisy! Deanne! Daisy!" | same, plain sea background | <!-- prose-lint: allow -->
| LTX-2.5 q8 | 768x448 | 58.7 s | 45.9 GB | "Deanne! Daisy! Deanne! Daisy!" | same, with the pineapple house | <!-- prose-lint: allow -->
| LTX-2.3 bf16 | 512x320 | 42.7 s | 40.0 GB (MLX counter) | "T helemaal" | show-accurate, pineapple house |
| LTX-2.3 bf16 | 640x384 | 48.7 s | 40.1 GB (MLX counter) | garbled | show-accurate, house door |

Smurfs (plain prompt, no dialogue): LTX-2.3 bf16 at 512x320 and 640x384 (49.1 s and 48.3 s, 40.0 and 40.1 GB MLX counter) gives the classic Smurfs: blue Smurfs in white hats, mushroom houses, 80s cartoon look. LTX-2.5 q8 gives live-action village dancers at 512x288 and 768x448. **Cartoon recall of Smurfs is a 2.3 strength; the speech turn order is a 2.5 strength; SpongeBob and Patrick look right on both.** 2.3 cannot run 512x288 or 640x352 (half size must be a multiple of 32), so the nearest valid heights 320 and 384 were used. Loudness: 2.5 SpongeBob about -13 LUFS, 2.3 about -21 LUFS. I did not listen for voice likeness.

## LTX-2.5 q8 Max ladder under the 64 GB cap (2026-11-02)

Cap (owner, 2026-11-02): one Max clip may use at most 64 GB on top of the live hub's 28 GB. MrMofer LTX-2.5 q8 `--distilled`, the Marie line, 121 frames, seed 7, one run at a time under the gate lock. Three measures per run, reported side by side: **MLX peak** (the tool's own counter, read in-process at exit), **footprint** (`/usr/bin/time -l` "peak memory footprint" for the whole process: what the operating system charges) and **rss** (resident set sampled every 2 s with `ps` on the recorded process).
Cap rule used: **the footprint**, because it is what the machine pays and what protects the hub; the MLX counter alone would pass every run.

| Size | Mode | Time | MLX peak | Footprint | rss max | Cap | Whisper |
|---|---|---:|---:|---:|---:|---|---|
| 768x448 | resident | 55.0 s | 22.7 GB | 45.8 GB | 17.7 GB | pass | exact |
| 1024x576 | resident | 101.0 s | 23.5 GB | 68.6 GB | 15.0 GB | **FAILED-CAP** | exact |
| 1024x576 | `--low-ram` | 82.6 s | 22.3 GB | 69.2 GB | 10.7 GB | **FAILED-CAP** | exact |
| 1024x576 | resident, MLX cache limit 4.41 GB | 89.2 s | 23.5 GB | 69.0 GB | 21.0 GB | **FAILED-CAP** | not transcribed |
| 1280x704 | resident | 168.3 s | 33.3 GB | 97.4 GB | 20.9 GB | **FAILED-CAP** | exact |
| 1280x704 | `--low-ram` | 140.6 s | 33.3 GB | 97.9 GB | 8.5 GB | **FAILED-CAP** | "Poor Naive Sarkis..." (case only) |
| 1280x704 | resident, cache limit 4.41 GB | 157.0 s | 33.3 GB | 97.4 GB | 20.0 GB | **FAILED-CAP** | not transcribed |
| 1280x704 | `--low-ram`, cache limit 4.41 GB | 139.0 s | 33.3 GB | 98.0 GB | 10.3 GB | **FAILED-CAP** | not transcribed |

What the three measures say: the MLX counter (22 to 33 GB) and the rss (8 to 21 GB) are far below the footprint (46 to 98 GB), and neither `--low-ram` nor a 4.41 GB MLX cache limit changed the footprint (it lowered the rss, which shows the weights were streamed). The gap grows with picture size (23 GB at 768x448, 45 GB at 1024x576, 64 GB at 1280x704), so the extra memory is tied to the picture, not to the weights; its cause was not isolated (candidates: decode-stage buffers outside MLX's counter, or compressed memory). Until it is explained the footprint is the number to trust.
Pictures (opened frames, resident runs): all three sizes are sharp sitcom frames with the line exact; the larger sizes show finer set detail (tiles, curtains, fabric) and cleaner faces. Loudness stays at -20 to -23 LUFS at every size. **1024x576 at 69 GB and 1280x704 at 97 GB are not recommended: FAILED-CAP.** 768x448 at 55 s and 45.8 GB is the largest size that passes.

The official dgrauet packs were first tried in the fork and did not load (see the length ladder for the runs in the newer runtime). Original note: they do not load in the `ltx25-runtime` fork ("Missing 4 parameters: text_embedding_projection.audio and video aggregate embed") and need the newer runtime in `ltx25-new`, which the videos session reserved; I asked whether I may run its venv read-only and have no answer yet. The dev two-stage and `--two-stages-hq` modes were not run: they need the 38 GB dev transformer plus 8.9 GB LoRA, which the owner has not approved downloading.

## Normal at 10 s, the footprint cause, and length up to 20 s (2026-11-02)

### Normal: LTX-2.5 q8, 512x288, 10 s (241 frames), with sound

Fork runtime, MrMofer q8 `--distilled`, seed 7, one at a time under the gate. Clips are named `ltx25-max-normal-512x288-f241-<slug>.mp4` in `~/video-bench/clips/` (the "max" prefix is the helper script's, not a tier).

| Prompt | Tool time | MLX peak | Footprint | rss max | Loudness | Whisper |
|---|---:|---:|---:|---:|---:|---|
| SpongeBob and Patrick, three turns each (`sb10`) | 42.9 s | 22.45 GB | 39.4 GB | 20.0 GB | -10.7 LUFS | "Dan! Daisy. Dan! Daisy. Dan! Daisy! Daisy!" (three turns, right order, one extra Daisy) | <!-- prose-lint: allow -->
| Papa Smurf and Smurfette, four lines (`smurfs10`) | 43.4 s | 22.45 GB | 39.4 GB | 20.0 GB | -17.0 LUFS | "Smurfette, dinner is ready. Coming, Papa. Hurry, the soup is hot. I am hungry." plus the instruction "Never both talking at once." spoken aloud |

10 s costs about 1.7 times the 5 s clip's time (43 against 27 to 31 s) and 14 GB more footprint (39.4 against 25.3 GB). Frames: the Smurfs clip is clean across the 10 s; the SpongeBob clip shows the pineapple house merged into SpongeBob's head like a hat and one smeared eye.
**Correction to the Smurfs finding above:** with the characters named in the prompt (Papa Smurf with the red hat and white beard, Smurfette the blonde Smurf in a white dress) LTX-2.5 q8 draws the classic Smurfs. The earlier live-action dancers came from the vague prompt "the Smurfs dancing in their mushroom village", not from lost knowledge. Name the characters.

### What the extra footprint is

Footprint (the OS charge) is far above the MLX counter and the resident set at larger pictures in the fork runtime. Tests at 1024x576 (q8, Marie, fork): `LTX2_VAE_DECODE_BUDGET_GB` 2 and 16 (the fork's default is 8): 90.2 and 89.1 s, footprint 69.2 GB in both; `LTX2_DIT_EVAL_EVERY=1`: 91.0 s, 69.05 GB; both together: 89.6 s, 69.2 GB; MLX peak 23.47 GB in every run. **None of the knobs moves the footprint.**
`footprint -p` sampled every 2 s (1024x576, q8): 8.4 GB while loading, 40 GB through the denoise, then **62 GB, almost all of it the "IOAccelerator (graphics)" category** (1,374 Metal regions), reached late in the run; CPU heap (Malloc) was under 0.6 GB. So the excess is GPU memory the MLX counter does not see. The newer runtime (next section) does not show it at 1024x576.

### Length ladder, official dgrauet packs in the newer runtime (`ltx25-new`, read-only)

768x448, the four-line Smurfs prompt, seed 7, `--distilled`, one at a time under the gate. MLX peak / footprint / rss max in GB.

| Pack | Length (frames) | Mode | Time | MLX peak | Footprint | rss max | Cap (64 GB, footprint) |
|---|---|---|---:|---:|---:|---:|---|
| bf16 | 10 s (241) | resident | 114.9 s | 62.9 | 45.2 | 31.3 | pass |
| bf16 | 10 s | `--low-ram` | 147.1 s | 62.9 | 33.4 | 27.8 | pass |
| bf16 | 15 s (361) | resident | 188.6 s | 22.4 | 47.5 | 25.7 | pass |
| bf16 | 15 s | `--low-ram` | 218.9 s | 22.4 | 32.6 | 28.1 | pass |
| bf16 | 20 s (481) | resident | 285.2 s | 22.4 | 49.8 | 22.2 | pass |
| bf16 | 20 s | `--low-ram` | 334.4 s | 22.4 | 32.6 | 24.4 | pass |
| q8 | 10 s | resident | 125.1 s | 62.9 | 44.7 | 19.4 | pass |
| q8 | 20 s | resident | 315.4 s | 22.4 | 31.4 | 20.3 | pass |
| bf16 | 10 s at 1024x576 | resident | 272.0 s | 37.2 | 48.6 | 20.6 | pass |
| bf16 | 10 s at 1024x576 | `--low-ram` | 324.5 s | 37.2 | 32.5 | 7.0 | pass |

- **Growth with length:** footprint rises about 2.3 GB per extra 5 s (45.2, 47.5, 49.8 GB), linear. Time rises a little faster than linear (115, 189, 285 s: +74 s, then +96 s per 5 s), as attention grows with sequence length. No length up to 20 s at 768x448 reaches the cap; the 15 s and 20 s clips took 3.1 and 4.8 minutes. The MLX counter reads 62.9 GB at 241 frames and 22.4 GB at 361 and 481: it appears to cover a different phase in different runs, so the footprint is the number used.
- **`--low-ram`** lowers the footprint by 12 to 17 GB and costs 15 to 30 percent more time; the clip is the same (identical transcript).
- **q8 against bf16** in the official packs: 9 to 11 percent slower, and no memory gain at 10 s (44.7 against 45.2 GB footprint); at 20 s the footprint is 18 GB lower (31.4 against 49.8). No speed reason to use q8.
- **1024x576 at 10 s passes the cap in the newer runtime** (48.6 GB resident, 32.5 GB with `--low-ram`), where the fork's q8 had 69 GB at 5 s: the footprint blow-up is a property of the fork, not of the size. Time is 272 s (4.5 minutes).
- **Speech across length:** Whisper hears the same four lines, in order, at 10, 15 and 20 s, bf16 and q8, resident and `--low-ram`; the lines do not spread out, the clip gains silent or ambient tails (loudness falls from -11.5 to -14.8 to -15.9 LUFS), so the second line survives but a 20 s clip is not 20 s of dialogue. At 1024x576, 10 s: all four lines, -14.1 LUFS.
- **Drift:** 10 s and 15 s frames are clean. The last frame of the 20 s bf16 clip shows Smurfette's body smeared and deformed (late-clip degradation); the 1024x576 10 s clip is clean at its end.
- Clips: `ltx25-max-new-<bf16|bf16-lowram|q8>-768x448-f<241|361|481>-smurfs10.mp4` and `ltx25-max-new-bf16[-lowram]-1024x576-f241-smurfs10.mp4` in `~/video-bench/clips/`.


## The ungated mirror `mlx-community/ltx-2.5-mlx` as a pinnable Max pack (2026-11-02)

The official dgrauet packs are gated on Hugging Face, so the Stack cannot pin them for households. The mirror `huggingface.co/mlx-community/ltx-2.5-mlx` is not gated. Downloaded on the owner's yes (distilled set only, 66 GB on disk) into `~/video-bench/models-25/mlxc-bf16`: `transformer-distilled.safetensors` 38.0 GB, `gemma4-12b-ltx-v1/model.safetensors` 23.8 GB with its tokenizer and config files, `connector.safetensors` 6.3 GB, `spatial_upscaler_x2_v1_1.safetensors` 1.0 GB, `temporal_upscaler_x2_v1_0.safetensors`, `vae_decoder`, `vae_encoder`, `vocoder`, `audio_vae`, `duration_head`, `LICENSE.md` and `ltx-acceptable-use-policy-snapshot-2026-08-12.pdf`. Left out: `transformer-dev.safetensors` (38 GB), `vae_decoder_pruna` and `vae_diffusion_decoder` (my first download command briefly fetched the last two, 1.5 GB, because the exclude flags were given in a form the tool read as file names; they were deleted).

**It needs `--gemma <pack>/gemma4-12b-ltx-v1`.** Without that flag the runtime (`dgrauet/ltx-2-mlx` 0.18.0, the `ltx25-new` venv) loads without an error but ignores the prompt: at 768x448 and 1024x576 the Smurfs prompt produced an unrelated drama scene with garbled speech ("Holy suar, it's smar..."), loudness -25 to -28 LUFS, and a 512x288 Marie test gave a man in a hat and "And all the song is owned." With the flag the pack matches the dgrauet pack:

| Run (Smurfs four lines, 10 s, seed 7, official runtime) | Time | MLX peak | Footprint | rss max | Loudness | Whisper | Picture |
|---|---:|---:|---:|---:|---:|---|---|
| dgrauet bf16, 768x448 | 114.9 s | 62.9 GB | 45.2 GB | 31.3 GB | -11.5 LUFS | all four lines | clean Smurfs |
| mirror, no `--gemma`, 768x448 | 114.0 s | 62.9 GB | 45.2 GB | 11.3 GB | -24.6 | garbled | prompt ignored |
| **mirror with `--gemma`, 768x448** | 104.3 s | 62.9 GB | 45.3 GB | 30.9 GB | -13.0 | all four lines | clean Smurfs |
| dgrauet bf16, 1024x576 | 272.0 s | 37.2 GB | 48.6 GB | 20.6 GB | -14.1 | all four lines | clean |
| mirror, no `--gemma`, 1024x576 | 187.0 s | 37.2 GB | 48.6 GB | 35.6 GB | -27.7 | garbled | prompt ignored |
| **mirror with `--gemma`, 1024x576** | 191.5 s | 37.2 GB | 48.6 GB | 28.2 GB | -14.0 | all four lines | clean Smurfs |
| Marie line 512x288, 5 s: dgrauet / mirror with `--gemma` | 26.5 s / 27.3 s | | 41.8 GB / 41.8 GB | | | both exact | both the sitcom kitchen |

Footprint and MLX peak are identical between the packs; the time differences (104 against 115 s, 191 against 272 s) are load noise from the shared machine, not the pack. Output is not bit-identical (different conversions), but the same prompt gives the same kind of result and the same speech.
**What the Stack must pin:** runtime `dgrauet/ltx-2-mlx` 0.18.0 plus this pack, and always pass `--gemma <pack>/gemma4-12b-ltx-v1`, because the failure without it is silent. A startup self-check is advisable: one short clip whose transcript must contain a known line.
**Licence:** `LICENSE.md` is the LTX-2.x Community License Agreement dated August 11, 2026; its text matches Lightricks' `LICENSE-2_x` on GitHub to 99.7 percent after stripping formatting (the rest is markdown, not terms). The acceptable-use PDF (snapshot 2026-08-12) is shipped with it; I did not compare its text with an official copy. The licence's derivative-build clause applies to this conversion, so the licence files travel with the pack.
Clips: `ltx25-max-new-mlxcg-768x448-f241-smurfs10.mp4`, `ltx25-max-new-mlxcg-1024x576-f241-smurfs10.mp4` (with the flag) and `ltx25-max-new-mlxc-*` (without it, the failure case), in `~/video-bench/clips/`.


## Not run, and why

Wan base bf16 at 20 steps (weights not approved); `realesrgan-mlx` pixel upscale (not approved); stage-1-only LTX picture for the upscale pair (needs engine edits); LTX speech check; more than one
seed per setting; 1440p and the refiner (no MLX path); `taew2_1` (does not fit the 5B VAE).
