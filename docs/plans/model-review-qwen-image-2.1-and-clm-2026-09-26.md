# Two model cards reviewed: Qwen-Image-2.1 and CLM-v0.1-8B (2026-09-26)

Web research and a read of our own design only. No installs, no runs, no
code. Asked by Jesse: review the two cards and fold them into the design
where they fit. Both were checked against the primary source (the model
card, the licence file and the config files on Hugging Face, and the
CLM GitHub README), not against a summary.

## The two-paragraph answer

Qwen-Image-2.1 is out, on its licence alone. It ships under the Qwen
Research License Agreement (released 2026-09-20), which grants use "for
non-commercial purposes only" and defines non-commercial as "for
research or evaluation purposes only"; a commercial licence is by
separate request to Qwen. A family drawing pictures in Home is neither
research nor evaluation, and a Catalog package that ships it would be
distributing it for exactly that. That is a harder no than the CC BY-NC
voices and the YuE2 weights this design already declined ("fine for a
household's own use, wrong choice for a shipped default"). The
hardware would have said no on tiers 1 and 2 anyway: it is a 7B
diffusion transformer with an 8B-class Qwen3-VL text encoder, about
33 GB at bf16, and the 8 GB path exists only through unofficial GGUF
re-quantizations with the encoder pushed to system memory. The image
role keeps FLUX.2 Klein 4B (Apache-2.0) as its instant and everyday
pick and Qwen-Image-Edit-2511 (Apache-2.0, December 2025) as the
editing pick this family still offers; the 2.1 card's capability list
becomes the yardstick the edit shape is written against, nothing more.

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

**Verdict.** Dropped for the image role on every tier, on licence
first and weight second. Recorded in `docs/BACKLOG.md` on IMAGE-01 so
it is not re-asked, and the "Pictures, quality" row of
`hub-on-apple-silicon-2026-09-17.md` now names the Apache-2.0 members
of the family explicitly instead of "full Qwen-Image", which a reader
today would take to mean 2.1.

**What is worth taking.** The capability list is the best short
statement of what a finished edit shape should offer, and the image
role's job API should be written to it when IMAGE-02 grows edits:
reference images (a count, with the consent rule per referenced
person that the sizing bar already states), a mask or a marked region
as the edit target, an RGBA output flag, and "keep everything else"
as the default. None of that needs this model; FLUX.2 Klein and
Edit-2511 cover the same shape at Apache-2.0. Revisit 2.1 only if
Qwen relicenses it, as it did not for this release.

One more note for the record: the "uncensored" GGUF derivatives that
surfaced in the same search are out on their own terms, before any
licence question. SAFETY.md's generation invariants are non-removable
architecture, and a checkpoint whose purpose is removing them has no
seat in the Catalog.

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
Community 8 GB path for Qwen-Image-2.1: the ComfyUI GGUF write-ups at
comfyui-wiki.com and kombitz.com (2026-09-20) and the two GGUF
re-quantization repositories named above, cited for the memory
figures only.
