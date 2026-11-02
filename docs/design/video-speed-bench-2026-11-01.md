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

Second MiniMax clip, run after the capability work (`mm-jake-768x448-5s.mp4`, prompt "Adventure Time cartoon, Jake the Dog and BMO in the Tree Fort, Jake yells DAISY! in a deep goofy voice"): 202 s total, 35.4 s per step, 12.7 GB peak footprint, 124 frames with stereo sound (mean -22.2 dB, peak -6.5 dB).
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
| BMO and Finn shouting "DEAN!" and "DAISY!" (`ltx-bmo-finn`, 8 s) | Adventure Time look and Tree Fort are right; two Finns appear (white hat, blue shirt) and no BMO, only a small teal block held between them; mouths open and shouting; audio present (mean -28.3 dB). Words not verifiable (no transcript) |
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
| `ltx-bmo-finn` (bf16, 8 s) | BMO "DEAN!", Finn "DAISY!", alternating | "game you" | wrong |
| `ltx-spongebob-patrick`, `-2`, `-3` (bf16, made by the videos session) | Dean and Daisy shouted | "Oh, Daisy! Daisy! Daisy! Daisy! Daisy!"; "Daisy Daisy Daisy"; "Dean. Dean. Daisy. Dean. Daisy." | the third has the alternation; the first two only Daisy |
| `ltx-bmo-jake` | made by the videos session | "Pain a little bad, through that now! The end." | not scored (prompt not in my files) |
| `ltx25-calico` (LTX 2.5, separate runtime, videos session) | made by the videos session | "Trade in your Mac Studio for two Collico Critters!" | clear words; spelling of the brand is Whisper's |
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
Every prompt ends with the same two-line dialogue in separate turns (Dean: "Daisy, dinner is ready." then Daisy: "Coming, Dad!", one voice at a time, no laugh track, no music); for Smurfs, Voltron and SpongeBob the father and daughter were made characters of that world (Papa Smurf and Smurfette, a pilot father and daughter, Mr. Krabs and Pearl).
Wall time includes loading and the streamed text encoder. Frames were opened (`minimax-<slug>-sheet.png`). Whisper transcripts are `minimax-<slug>.txt`. **Voice likeness to a character is not judged here: I cannot hear. Owner verdict on the first MiniMax speech clip (Jake and BMO): the words were gibberish until the last "DAISY!" and the voices did not sound like the characters' normal voices; the LTX-2.3 clips did.** Word accuracy below is from Whisper only.
I do not judge whether a real person's face matches a named person; where a real person was named I describe the picture and leave the likeness to the owner.

| Clip (`minimax-<slug>.mp4`) | Wall | Per step | Peak | Picture (opened frames) | Whisper transcript against the two lines |
|---|---:|---:|---:|---|---|
| goldengirls | 182 s | 30.2 s | 13.4 GB | not the Golden Girls and not Raymond: a generic bright kitchen, three women and a white-bearded man eating cheesecake; sharp, cinematic | both lines exact |
| raymond | 196 s | 31.9 s | 13.0 GB | a very convincing 2000s multi-camera sitcom kitchen with a father standing, two girls and an older woman seated | both lines, plus an invented sentence between them |
| chucknorris | 188 s | 30.9 s | 12.6 GB | muscular blond man in a white tee on a desert road beside a little girl; no kick (the dialogue replaced the action) | both lines, small wording changes ("dinner's ready", "Coming, Dad.") |
| willsmith | 202 s | 32.9 s | 13.1 GB | middle-aged man with a grey goatee in a dark suit walking a city street with a girl, smiling; likeness left to the owner | both lines exact |
| terminator | 204 s | 33.0 s | 12.6 GB | man with a glowing red cybernetic eye in armour walking out of a burning vehicle: clearly the Terminator character look, a young girl enters at the end | both lines, small wording changes |
| vader | 207 s | 33.2 s | 12.6 GB | excellent: detailed Vader in a Death Star style corridor, a girl in a pink dress, red saber ignites; the best character match of the set | both lines exact |
| smurfs | 192 s | 32.1 s | 13.2 GB | modern 3D Smurfs (not the classic 2D look): Smurfette, a white-bearded Smurf, a red-hatted Smurf behind, mushroom village | "Hey Zeezy, dinner is ready. Coming, Dad!" (name misheard) |
| voltron | 187 s | 31.2 s | 13.1 GB | an 80s anime super robot in red and gold with a drawn sword, a boy pilot and an orange-haired girl in the cockpit; a Voltron-like show look but not Voltron | "Daisy, dinner is ready. It's coming, Dad." |
| spongebob | 199 s | 32.5 s | 12.6 GB | show-accurate: SpongeBob, Mr. Krabs and a blonde girl at the Krusty Krab sign (lettering slightly garbled), a pot steaming | both lines exact |
| jake-bmo (earlier) | 202 s | 35.4 s | 12.7 GB | Jake and a proper blue BMO with face and limbs in the Tree Fort | "...DAISY!" at the end only; owner: gibberish before it, voices not the characters' |

Reading, judged separately (a matching transcript says nothing about picture, voice quality or voice likeness, and a clip is not good because Whisper matched the words):
- **Words:** Whisper heard both lines in 8 of 9 clips; this only says the words were spoken clearly enough to transcribe.
- **Picture (my opened-frame reading):** sharp and detailed on Vader, SpongeBob, Raymond and Terminator; "Golden Girls" is not recognisable; Smurfs in a newer 3D look; Voltron is a different robot.
- **Voice quality and likeness:** not judged by me (I cannot hear). Owner: the Jake and BMO voices were not the characters' and the speech was gibberish until the last word; the Golden Girls clip is "awful" despite word-perfect Whisper lines.
- **Cost:** 182 to 207 s a clip against LTX bf16's 62 to 100 s, at 12.6 to 13.4 GB against 40.4 GB.

### Owner-judged on the MiniMax clips (2026-11-02)

| Clip | Owner verdict |
|---|---|
| `minimax-jake-bmo` | gibberish until the final "DAISY!"; voices not the characters' normal voices (LTX-2.3 clips sounded like the characters) |
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
| goldengirls, `--block-cache` | 21.1 s | 146 s | 13.0 GB | same layout; faces mushier, colours more saturated, more banding on the table cloth | "Hey, hey, hey, dinner is ready. Coming down!" (words changed) |
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


## Not run, and why

Wan base bf16 at 20 steps (weights not approved); `realesrgan-mlx` pixel upscale (not approved); stage-1-only LTX picture for the upscale pair (needs engine edits); LTX speech check; more than one
seed per setting; 1440p and the refiner (no MLX path); `taew2_1` (does not fit the 5B VAE).
