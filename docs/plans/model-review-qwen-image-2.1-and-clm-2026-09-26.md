# Two model cards reviewed: Qwen-Image-2.1 and CLM-v0.1-8B (2026-09-26)

Web research and a read of our own design only. No installs, no runs, no
code. Asked by Jesse: review the two cards and fold them into the design
where they fit. Both were checked against the primary source (the model
card, the licence file and the config files on Hugging Face, and the
CLM GitHub README), not against a summary.

## The two-paragraph answer

Qwen-Image-2.1 cannot ship, and stays in the bakeoff (owner's ruling,
2026-09-26, below). It is licensed under the Qwen Research License
Agreement (released 2026-09-20), which grants use "for non-commercial
purposes only" and defines non-commercial as "for research or
evaluation purposes only"; a commercial licence is by separate request
to Qwen. A family drawing pictures in Home is neither research nor
evaluation, and a Catalog package that ships it would be distributing
it for exactly that, so it is off the ship list on every tier, a
harder no than the CC BY-NC voices and the YuE2 weights this design
already declined. Measuring it is the one use the licence names, and
it is the strongest open image model of its size this month, so it is
the yardstick row of the image bakeoff: the row FLUX.2 Klein 4B
(Apache-2.0) and Qwen-Image-Edit-2511 (Apache-2.0) are measured
against, on the same prompts and the same machines, so the shipping
pick is chosen knowing what it gives up. The ecosystem is unusually
complete for a week-old model (native ComfyUI with an int8 repack,
day-0 stable-diffusion.cpp, mflux and mlx-serve on Apple silicon, a
six-step distillation, LoRA training in ai-toolkit and
DiffSynth-Studio, a Civitai category already filling), and that is
recorded below because it is what the bakeoff row is built from and
what a relicensed release would inherit on day one.

CLM-v0.1-8B is in, as a bench candidate on the path the design already
laid for this class of model, not as a pin. It is the second open
reproduction of the typed-decision ("System One") model that the
Stack's jev note rejected as hosted-only and the harness record then
picked Laya up for: Apache-2.0 weights on an Apache-2.0 Qwen3-8B
encoder, a state head and an action head (about 20M trainable
parameters each) trained with a contrastive loss, returning a typed
choice, score or boolean with a calibrated probability, or a ranking
over any candidate set, with no text generation. It differs from Laya
in the three ways that matter for us: it reads 2,048 tokens instead of
512, it has no option ceiling because it ranks candidates by embedding
distance and caches the candidates' embeddings (the router's fixed
package set is exactly that shape), and its card claims a usable
zero-shot where Laya's is below the majority-class baseline. It also
costs an 8B encoder resident, which tier 1 cannot hold beside the chat
model. So: it joins ROUTER-RLCD-01's bench beside the RLCD 1.5B and
Laya, on the same rows and the same three numbers, with one extra
question first (whether the encoder can be the chat engine's own
Qwen3-8B weights served with last-token pooling, or must be a second
process); LOOKUP-HEAD-01's shadow seat may take its zero-shot boolean
only if that bench shows the calibration the card claims, on our rows;
the `rerank` role gets it as its first named candidate. Adoption stays
on RULES-AND-LEARNED-COMPONENTS.md's path: a calibration study on our
labels, shadow mode beside the rule, never the safety, consent or
privacy path.

## Subject 1: Qwen-Image-2.1

**What it is.** A unified text-to-image and image-editing model from
Qwen, updated on Hugging Face 2026-09-21. Verified on the card: "7B
parameters in its visual generation component (32 Single-Stream DiT
layers)", native transparent (RGBA) generation, editing with up to 10
reference images, local edits by circles, painted annotations or
masks, identity preservation for people and products, and improved
typography. Output sizes up to 2048 by 2048 with seven fixed aspect
ratios. The card's only published inference path is diffusers from
git (`QwenImage21Pipeline`, transformers 5.17 or newer, torch 2.4 or
newer, CUDA in every example, CPU offload as the one memory option).
No benchmarks, no release date and no language list on the card.

**What it weighs.** From the repository's own blob sizes: text encoder
17.5 GB (`Qwen3VLForConditionalGeneration`, 36 layers, hidden size
4096, the 8B-class Qwen3-VL), transformer 14.2 GB, VAE 1.4 GB, 33.1 GB
in all at bf16. For comparison, FLUX.2 Klein 4B is 23.7 GB in the
same accounting (8.0 GB text encoder, 7.8 GB transformer) and is
built for 8 GB cards; Qwen-Image-Edit-2511 is 57.7 GB (40.9 GB
transformer). The community's 8 GB path for 2.1 is a Q4 GGUF of the
transformer (about 4.6 GB) through ComfyUI-GGUF with the text encoder
offloaded to system memory and 16 GB or more of RAM, from re-quantized
uploads by individual accounts (`Abiray/Qwen-Image-2.1-GGUF`,
`AlperKTS/Qwen-Image-2.1-GGUF` and others, as of this reading). Those
are the same class of low-provenance fork the jev-and-yue note refused
for YuE2's MLX ports: not pinnable by URL, revision and sha256 with
confidence, and never a Stack pin.

**The licence, quoted.** `LICENSE` in the repository, "Qwen RESEARCH
LICENSE AGREEMENT Release Date: September 20, 2026":

> "Non-Commercial" shall mean for research or evaluation purposes
> only.

> You are granted a non-exclusive, worldwide, non-transferable and
> royalty-free limited license ... FOR NON-COMMERCIAL PURPOSES ONLY.

> You shall not use the Materials for any commercial purpose without
> obtaining a separate commercial license from us.

Distribution requires a Notice file carrying Qwen's attribution line.
This is a change for the family: Qwen-Image (2025-08), Qwen-Image-Edit,
Edit-2509 and Edit-2511 are all Apache-2.0 on their cards (checked
2026-09-26 through the Hugging Face API). A `Qwen/Qwen-Image-2.0`
repository does not resolve on Hugging Face at all as of this reading.

**Verdict.** Off the ship list on every tier, on licence first and
weight second; in the bakeoff as the evaluation-only yardstick row
(next section). Recorded in `docs/BACKLOG.md` on IMAGE-01 and as
IMAGE-BENCH-01, and the "Pictures, quality" row of
`hub-on-apple-silicon-2026-09-17.md` now names the Apache-2.0 members
of the family explicitly instead of "full Qwen-Image", which a reader
today would take to mean 2.1.

**What is worth taking.** The capability list is the best short
statement of what a finished edit shape should offer, and the image
role's job API should be written to it when IMAGE-02 grows edits:
reference images (a count, with the consent rule per referenced
person that the sizing bar already states), a mask or a marked region
as the edit target, an RGBA output flag, and "keep everything else"
as the default. FLUX.2 Klein and Edit-2511 cover the same shape at
Apache-2.0. Revisit 2.1 as a ship pin only if Qwen relicenses it, as
it did not for this release; the bakeoff numbers are what make that
revisit a one-line decision instead of a new research pass.

One more note for the record: the "uncensored" and "heretic" GGUF
derivatives that surfaced in the same search (four of the fifteen
most-downloaded 2.1 repositories on Hugging Face as of this reading)
are out on their own terms, before any licence question. SAFETY.md's
generation invariants are non-removable architecture, and a
checkpoint whose purpose is removing them has no seat in the Catalog
or the bakeoff.

### Owner's ruling, 2026-09-26: keep it in the bakeoff

Jesse, on reading the verdict above: "i still want the image model in
the bakeoff for performance". That is inside the licence (evaluation
is the one use it grants) and inside the org's own rule that a
sizing-bar cell marked `(?)` is a hypothesis until measured. So the
bakeoff carries it as a row that can never become a pin, and the
ecosystem below is what that row is built from. Everything here was
verified on the primary source named; sizes are the repositories' own
blob sizes through the Hugging Face API, 2026-09-26.

**ComfyUI, native.** Day-0 support (2026-09-20) in ComfyUI itself, no
custom node: a Qwen Image 2.1 subgraph node that holds the prompt
conditioning and its own sampler, a resolution selector, and a "Qwen
Image 2.1 Cache" node that keeps the text and reference prefix across
steps (the model's prefix KV cache). The templates are in the built-in
gallery. Editing takes 1 to 16 reference images as `<image1>` to
`<image16>` in the prompt, output following the first reference's
aspect ratio; the VAE carries four channels, so RGBA falls out of the
same graph. Default settings 25 steps, cfg 1.0, Euler, simple
scheduler. `docs.comfy.org/tutorials/image/qwen/qwen-image-2-1`. The
weights are the Comfy-Org repack (`Comfy-Org/Qwen-Image-2.1`, 3.6M
downloads, the model's own licence), single files per component:

| File | Size | Note |
|---|---|---|
| `qwen_image_2.1_bf16.safetensors` | 14.2 GB | the transformer, full precision |
| `qwen_image_2.1_int8_convrot.safetensors` | 7.3 GB | the transformer, int8 with rotation, the template default |
| `qwen3vl_8b_bf16.safetensors` | 17.5 GB | the text encoder |
| `qwen3vl_8b_int8_convrot.safetensors` | 9.4 GB | the encoder, int8, the template default |
| `qwen3vl_8b_w4a8.safetensors` | 6.3 GB | the encoder, 4-bit weights |
| `qwen_image_2.1_vae_bf16.safetensors` | 0.7 GB | the RGBA VAE |
| `qwen3.5_9b_qwen_image_2.1_pe_t2i` and `pe_i2i` (int8) | 9.5 GB each | the optional prompt-rewriting models, same licence |

The int8 pair is 16.7 GB of weights, the bf16 pair 31.7 GB, before
activations; the tutorial gives no VRAM figure and no timing. Comfy
tested nothing under 8 GB in writing, and ComfyUI's own low-VRAM path
is the same CPU offload of the encoder the community write-ups use.

**GGUF and the 8 GB card.** Three GGUF sets exist. `unsloth/
Qwen-Image-2.1-GGUF` (170k downloads, the model's licence, base
declared): the transformer from Q2_K 2.5 GB through Q4_K_M 4.2 GB, Q6_K
6.3 GB and Q8_0 7.6 GB, plus F16. `leejet/Qwen-Image-2.1-GGUF` (69k;
leejet is stable-diffusion.cpp's author): Q4_0 and Q4_K 4.2 GB, Q8_0
7.7 GB. Both load through ComfyUI-GGUF. The published 8 GB recipe is
Q4_K_M or the int8 transformer on the card, the encoder in system
memory (16 GB or more), and `--lowvram`; nobody has published a 3070
time. For the bakeoff, unsloth's set is the one to pin for the 3070
row (pinnable by revision and sha256, a declared base, a named
organization), leejet's the cross-check; the individual-account
re-quantizations from the first pass are dropped.

**stable-diffusion.cpp.** Day-0 support 2026-09-20 (MIT; CPU, CUDA,
Vulkan, Metal, OpenCL, SYCL), and it already runs FLUX.2 Klein
(2026-01-18), Qwen Image and Qwen-Image-Edit. That makes one engine
able to serve every row of the bakeoff on both machines, which matters
more for the Stack than for this model: STACK-13b built ComfyUI as the
managed image engine and measured it, and a single-binary engine with
a Metal backend and no Python is the shape the Stack prefers
everywhere else. Whether it displaces ComfyUI is a Stack question
(STACK-14's bench), not this note's; the bakeoff records both paths
where both exist.

**Distillation.** No Lightning release from lightx2v exists for 2.1 as
of this reading (the repository name resolves to nothing public). The
few-step path is `Viggle/Qwen-Image-2.1-viggle-turbo` (102k
downloads): a DMD2-distilled student shipped as a LoRA adapter (rank
128 at 0.7 GB, rank 256 at 1.4 GB) for 5 or 6 transformer passes
instead of 40, "about 5 times faster" end to end, with its own ComfyUI
nodes and workflows, under the same research licence. Its card's own
caveats: small dense text is weaker at 6 steps (8 recommended), and
multi-reference composition, face swaps and identity-preserving edits
may underperform the base. The bakeoff measures the base model at 25
and 40 steps and the turbo adapter at 6, as three rows, because the
"instant" and "everyday" bars are different sizing cells. Nunchaku's
official organization has no 2.1 release; the one SVDQuant NVFP4 file
(`catplusplus`, 4.4 GB) needs Blackwell, Ada or Hopper, and the 3070
is Ampere, so it is out of the bakeoff on hardware.

**LoRA, training.** `ostris/ai-toolkit` lists `Qwen/Qwen-Image-2.1`
under both its image and its edit trainers ("one model for both; it
edits when your dataset has control images"); a community walkthrough
trains a character LoRA on 12 GB. ModelScope's DiffSynth-Studio is the
official training path Qwen's README names. `musubi-tuner` and
`sd-scripts` did not support 2.1 as of 2026-09-21. **LoRA, community.**
Civitai opened a "Qwen 2.1" base-model category within days and it
already holds checkpoints (the int8 and an INT4 W4A8 repack), LoRAs (a
"fix" LoRA for two weak layers, an any-side outpaint LoRA) and
workflows; `WarmBloodAban/Qwen-Image-2.1-LoRAs` collects more on
Hugging Face. A week in, that is a smaller library than FLUX.2 Klein's
and a fraction of Qwen-Image 1.0's, but growing at Qwen-Image 1.0's
early pace. Every LoRA trained on 2.1 is a derivative under the
research licence, so the LoRA library is as unshippable as the base;
that is the practical cost of the licence, more than the base weights
themselves.

**Apple silicon.** No official path (Qwen documents CUDA, AMD and
FlagOS only). `mflux` (MIT) added 2.1 the day after release:
text-to-image and image-to-image at `-q 8` or `-q 4`, the encoder kept
in bf16, editing "not ported", RGBA in an open pull request; on an M5
Max at bf16, 1024 by 1024 runs about 78 s at 40 steps (about 1.8 s a
step plus 8 s fixed). The `mlx-community/Qwen-Image-2.1-mflux-q4` pack
is 9.6 GB. **`mlx-serve`** (the Stack's own spawned-engine candidate,
`stack/docs/plans/field-survey-2026-09-17.md`) merged 2.1 as its
fourth image backend on 2026-09-21 (PR 477): its own packs at 8-bit
(17.6 GB on disk, `ddalcu/Qwen-Image-2.1-MLX-Serve-8bit`) and 4-bit
(10.7 GB), text-to-image and image-to-image with real
classifier-free guidance, served at `POST /v1/images/generations`,
which is the Stack's job API shape already; no edit, no LoRA, no RGBA.
Its measured numbers are the only ones on a small Mac: an M1 Pro with
32 GB ran 8-bit 1024 by 1024 at 40 steps in 985 s (23 s a step, 13 GB
peak) and 4-bit 512 by 512 at 20 steps in 118 s. The modelfit survey's
tiers agree: 16 and 24 GB "not viable today", 32 GB runs slowly, 64 GB
usable. So the Mac Studio row is real and the M4 Pro dev machine row
is likely a refusal by the governor, which is itself a bakeoff result
worth one line.

**The bakeoff row, as designed.** One item, IMAGE-BENCH-01 in
`docs/BACKLOG.md`, the same protocol as STACK-14 (engine build, model
file and revision, a sanitized hardware line, time and peak footprint
per row), with one fixed prompt set (the roster's demo household,
never the family: a portrait, a typographic sign, a product on white,
a two-reference composition, a masked local edit, an RGBA sticker)
judged on the same rubric across rows. Rows: SD 1.5 (the pin STACK-13b
proved, the floor), FLUX.2 Klein 4B at its shipped steps, Qwen-Image-
Edit-2511 for the edit prompts, and Qwen-Image-2.1 at 25 and 40 steps
plus the turbo adapter at 6, each row on the 3070 through ComfyUI (the
GGUF or int8 files above) and on the Studio through mlx-serve and
stable-diffusion.cpp where each supports the row. The 2.1 rows are
marked evaluation-only in the table and the weights are removed from
the machine when the bench ends, so no later session mistakes a cached
file for a pin. Out of scope: LoRA training, the prompt-rewriting
models, any "uncensored" derivative, and a ship decision, which the
licence has already made.

## Subject 2: CLM-v0.1-8B

**What it is.** A Contrastive Language Model from the Contrastive-LM
group (Kwok, Kang, Suresh, Saad-Falcon, Pavone, Ré, Mirhoseini; the
card's citation is a 2026 Notion blog, the code at
github.com/Contrastive-LM/CLM). Updated on Hugging Face 2026-09-24,
434 downloads at the time of reading. Verified on the card: "two small
projection heads (a state head and an action head) on top of a frozen
Qwen3-8B encoder trained with a bidirectional InfoNCE loss"; trained
on about 60M Nemotron question-answer pairs, 30M synthetic hard
negatives and 1M agentic trajectories. The repository holds one
weights file, `CLM_v0.1-8B.pt` (about 75 MB, the heads only, a torch
pickle); the encoder is `Qwen/Qwen3-8B` itself, pulled separately.
Licence: "The CLM-8B weights are released under the Apache 2.0
License. The base encoder Qwen3-8B is also Apache 2.0." English only.

**How it is asked.** Two shapes, both verified in the card's own
code. `system_one(state, questions)` takes a state (text) and typed
questions: `Noul` (a yes-or-no), `Choice` (named criteria, returns a
choice and a probability per option), `Score` (an ordered scale).
`Engine.rank(state, candidates)` ranks free-form candidates and
returns a probability per candidate, "relative to that set". States
and actions are embedded separately, so a fixed candidate set is
embedded once and each decision is one state forward pass plus dot
products; the card's "13 times faster than Jev with about 1k
candidates" is that caching.

**How it is served.** The published path is a vLLM pooling server for
the encoder (`vllm serve Qwen/Qwen3-8B --runner pooling
--max-model-len 2048`) and `clm-serve` for the heads and a playground
on port 8700, which fetches the `.pt` into `~/.cache/clm/`. The heads
"require Qwen3-8B last-token-pooled embeddings" (the card's own
limitation): the encoder is locked to that model and that pooling.
The README says the heads run on GPU when torch sees one, else CPU.

**Claims, and what they are worth here.** Zero-shot "on par with Jev
on computer-use, gaming and tool-calling tasks, with up to 9 times
lower latency"; as a fine-tuned verifier, 81.6 percent on DeepSWE and
87.6 percent on Terminal-Bench 2.1. The latency figure is against
Jev's hosted API, not against a 421M encoder on a Mac; the verifier
numbers are from fine-tuned heads the card says are not this
checkpoint ("Verifier results need fine-tuning"). The one claim that
would change our order of work is the zero-shot one, and only our own
rows can check it. The card also announces a multimodal CLM-35B for
early October; that is the size the Studio could hold and tier 1
never will.

**Against the design as it stands.**

| Question | Laya (harness record, 2026-09-26) | CLM-v0.1-8B |
|---|---|---|
| Licence and provenance | Apache-2.0 per announcement, card to confirm | Apache-2.0 on the card, encoder Apache-2.0 |
| Encoder | ModernBERT-large, 421M, about 808 MB | Qwen3-8B, frozen, 16 GB bf16, about 8.7 GB at Q8 (?), plus 75 MB of heads |
| Window | 512 tokens (English checkpoint) | 2,048 tokens (`--max-model-len`, raisable at memory cost) |
| Option set | degrades past about 20 options | open set, ranked by embedding distance, candidates cached |
| Zero-shot | 0.362 against a 0.461 majority baseline, fine-tune or nothing | claimed usable on tool-calling; unverified on our rows |
| Fits tier 1 (24 GB Mac, 8 GB card) | yes, CPU in tens of ms | only if the encoder is the chat engine's own Qwen3-8B weights; a second 8B does not fit beside chat |
| Fits the Studio | yes | yes |
| Serving | PyTorch or ONNX or MLX, a small process | vLLM pooling (CUDA, Linux) as published; the Stack would need llama-server or MLX embeddings with last-token pooling to reproduce it, unproven |
| Weights format | safetensors | a torch pickle (`.pt`); the Stack loads with `weights_only=True` or converts to safetensors at install, never a bare `torch.load` |

The encoder question is the whole cost story on tier 1. Home's tier 1
chat model is already a Qwen3-8B instruct GGUF at Q4 (ARCH-MEASURE-01),
the same model the heads were trained against, quantized. If the chat
engine can serve last-token-pooled embeddings from the weights it
already holds, the decision layer costs the heads (75 MB, CPU) and one
prefill per decision, with no second resident model; if it cannot, or
if a Q4 encoder's embeddings drift far enough from bf16 that the heads
mis-rank, CLM is a Studio-only candidate. Neither is known. The bench
verifies it in the installed source and by measurement (the cosine
between the quantized engine's pooled embedding and the reference
encoder's on the same rows, then the rankings themselves), per the
org rule that a claim about what a library does is verified in the
installed source, never assumed.

**Verdict.** A candidate, on three items that already exist, none of
them new:

1. **ROUTER-RLCD-01** (the router bench) gains CLM-8B as its third
   candidate, same corpus, same three numbers (route accuracy,
   per-decision latency, calibration of the probability on our rows),
   with the encoder question above answered before its row is
   measured. The router is the slot its shape fits best: a fixed set
   of package routes, embedded once, ranked per turn, with the
   probability read as an admission threshold.
2. **LOOKUP-HEAD-01** (the lookup decider) may seat CLM's zero-shot
   `Noul` in shadow mode ahead of any fine-tune only if the router
   bench shows its probabilities mean something on our rows; Track 3's
   verdict stands otherwise (a decider that reproduces the interim
   rule's decision logs cost and no signal). The labelled set is
   still the lever, and CLM's cheap head fine-tune (the heads only,
   the encoder frozen) is a second recipe for the same rows once they
   exist.
3. **The `rerank` role** in the Stack's role table has no named
   candidate today. `Engine.rank` is that role's wire shape exactly
   (a query, candidates, a score each), so CLM-8B is its first named
   candidate, for memory recall's relevance floor (MEMORY-RELEVANCE-01)
   and best-of-N over tool calls later, benched when a consumer asks
   for it and not before.

Rules that carry: fetched by the Stack's provenance-gated store,
pinned by revision and sha256, never `clm-serve`'s own cache; the
`contrastive-lm` package through the uv pattern the Stack already uses
for Python engines; a learned component never in the safety, consent
or privacy path; adoption only after a calibration study on our own
labels and a shadow run beside the rule; nothing leaves the house (the
endpoint list in PRIVACY.md unchanged).

## Sources

Read 2026-09-26. Hugging Face: `Qwen/Qwen-Image-2.1` (card, `LICENSE`,
`model_index.json`, `text_encoder/config.json`, blob sizes through the
API), `Contrastive-LM/CLM-v0.1-8B` (card, file list), the cards of
`Qwen/Qwen-Image`, `Qwen/Qwen-Image-Edit-2511`, `Qwen/Qwen3-8B` and
`black-forest-labs/FLUX.2-klein-4B` for their licence fields.
GitHub: `Contrastive-LM/CLM` README (serving, pooling, head size).
For the ecosystem section: `docs.comfy.org/tutorials/image/qwen/
qwen-image-2-1`, `blog.comfy.org` (2026-09-21), `Comfy-Org/Qwen-Image-2.1`,
`unsloth/Qwen-Image-2.1-GGUF`, `leejet/Qwen-Image-2.1-GGUF`,
`Viggle/Qwen-Image-2.1-viggle-turbo`, `catplusplus/nunchaku-qwen-image-2.1`,
`mlx-community/Qwen-Image-2.1-mflux-q4`, `ddalcu/Qwen-Image-2.1-MLX-Serve-8bit`
(all Hugging Face, sizes through the API), `QwenLM/Qwen-Image-2.1`,
`ostris/ai-toolkit`, `leejet/stable-diffusion.cpp`, `filipstrand/mflux`
and `ddalcu/mlx-serve` pull request 477 (GitHub), the modelfit.io Mac
survey (2026-09-25), the Civitai "Qwen 2.1" category, and the ComfyUI
GGUF write-ups at comfyui-wiki.com and kombitz.com (2026-09-20) for the
8 GB recipe.
