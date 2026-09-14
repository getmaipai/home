# GPU card layout: the 16 GB eGPU (2026-09-14)

The coordinator's analysis of how the hub's engines fit once the
laptop's eGPU RTX 3070 8 GB is replaced by an RTX 5060 Ti 16 GB, with
the internal RTX 2070 Super 8 GB staying. Decided the same evening: the
16 GB card is the purchase, a 24 GB card is off the table. Priorities,
in order: chat, image generation, coding, everything else. Reconciled
with an outside review (Codex, three passes) the same evening; where
the two disagreed, the disagreement and the position are recorded
here.

Nothing below is measured on the new card. Every figure is derived
from the 2026-09-14 trial of the same coding model on the current two
cards (homelab docs, `services/local-llm.md`, "Trial: Qwen3.8-27B") or
from the publisher's own numbers, and each is marked as such. The
measurement lane at the end turns them into facts.

## The budget

| Engine | VRAM | Source of the figure |
|---|---|---|
| Chat: Qwen3-8B Q4_K_M, 24k context, two unified slots | ~6.7 GB | today's 32k config measures 7.3 GB; 8k less of q8 KV at ~74 KB/token |
| Judge: Qwen3-4B Q4_K_M, 8k | ~3.1 GB | 2.5 GB weights + 0.6 GB KV |
| Embed: nomic-embed-text v1.5 | ~0.4 GB | 84 MB weights + a CUDA context |
| Image: FLUX.2 Klein 4B, or Juggernaut XL | 7.5 to 13 GB | catalog estimate vs the publisher's quote; unmeasured full-pipeline peak |
| Video: Wan 2.2 TI2V-5B fp8 | ~7.5 GB | the maintained ComfyUI workflow targets 8 GB with offloading |
| Coder: Qwen3.8-27B GSQ-RCO IQ3_S with the MTP head, 64k q8 KV | ~15.4 GB | 12.15 GB file (11.8 GB plus the MTP head); the trial's IQ3_XXS served 12.6 GB total at 32k, so ~2.2 GB of KV, buffers, and draft state at 32k; the model's full-attention KV is ~2.1 GB at 64k |
| Everything resident | ~33 GB | sum |

Two consequences follow from the table. The coder at 64k owns a 16 GB
card outright; nothing else fits beside it. And everything at once
needs about 33 GB, which no single card supplies, so a swap policy is
part of the design whichever card is bought. A 24 GB card would not
have removed the swap either (coder plus judge plus image is 26 GB);
it would have bought about twice the coder's decode speed. The 16 GB
Blackwell card brings native fp8, which the fp8 image and video
entries use and which Ampere and Turing lack.

All three cards involved (RTX 2070 Super, RTX 3070, RTX 5060 Ti) have
448 GB/s of memory bandwidth, so moving chat to the 2070 Super costs
no decode speed. Turing processes prompts more slowly, so the cold
first turn is one of the measurements.

## Layout A: chat on the internal card, the 16 GB card as the work card

The layout to install first.

| Engine | Placement | Policy |
|---|---|---|
| Chat, Qwen3-8B | 2070 Super | always loaded; 24k context, two slots; under the card's 7.0 GB ceiling |
| Judge, Qwen3-4B | CPU | always available; the hub's default placement; a queue with bounded threads |
| Embed, nomic | CPU | always available; recall never waits on the work card |
| STT, VAD, wake word, TTS | CPU | always available; their CPU time is protected ahead of the judge |
| Image, video | 5060 Ti | on demand, one at a time |
| Coder, the 27B | 5060 Ti | loaded during coding; 32k until 64k is validated |

The 16 GB card is exclusive to one heavy job at a time. The eviction
order is the priority list: an image or video request unloads the
coder after its in-flight request finishes, and the engine host reloads
the coder the moment the generation job ends rather than on the next
coding request. A swap costs tens of seconds (the file loads at drive
speed) plus a prompt reprocess for the coding session. Pausing an
engine frees nothing; only unloading does.

The judge and the embedder were first placed beside the generation
engine on the work card. The outside review's placement on CPU is
better and is adopted: it leaves the whole card to the generation
pipeline (Klein's publisher quote is 13 GB, which would not have fit
beside a 3.5 GB judge), and it stops recall from depending on a card
that unloads and reloads. Both placements are conditional on the
measured latency (below); if the embedder is too slow on CPU it moves
beside chat on the 2070 Super at 16k context.

Where the review and the coordinator differ: the review starts chat at
8k context and one slot; this plan starts at 24k with two unified
slots, because today's 32k config measures 7.3 GB and unified slots
cost no extra VRAM. The bench decides.

What layout A gives up: images interrupt coding, and chat runs on the
older card. What it keeps: chat lives on the internal card and
survives the eGPU being undocked or failing.

## Layout B: the coder as the chat model

The question was why not use the 27B for chat too, since it is larger
and already loaded. VRAM is not the reason. The 27B's KV cache costs
about 34 KB per token, so a chat slot inside the coder's context pool
is under 0.3 GB. The reasons are these.

1. **Chat cannot live on the card that gets unloaded.** If the coder
   is also chat, an image job kills chat, or images never run. The
   27B and an image pipeline do not fit together in 16 GB. The escape
   is to move image and video to the 2070 Super, which is what layout
   B does.
2. **The hub's provenance rule.** The hub pins publisher-official
   artifacts at fixed revisions. Qwen publishes `Qwen/Qwen3.8-27B`
   and `Qwen/Qwen3.8-27B-FP8` and no GGUF (checked on Hugging Face
   2026-09-14). The ISTA-DASLab file is a third-party quantization,
   which the rule forbids as a catalog pin. That is fine for a
   developer's coding tool and not for the household's chat model
   unless the rule is changed; a named lab's quantization at a pinned
   hash would be a defensible exception, and the change is the
   owner's call.
3. **Coding prompts slow family chat.** Prompt processing on one card
   is serialized; the server interleaves slots in 512-token chunks, so
   a 50k coding prompt costs a chat turn seconds rather than a minute,
   but every coding session slows everyone's first token. The MTP
   draft with two slots is unverified; the trial ran one slot.
4. **The chat program's baselines are on the 8B.** Every three-run
   acceptance and the EVAL-07 baseline would restart on a new model.
   That argues against switching mid-program, not against switching.

In favor: the 27B was the step change in the coding trial, and the
chat gaps that remain are largely model-limited (world knowledge,
compound requests). It deserves a measured test, not a reasoned no.

Layout B, if the test wins it:

| Engine | Placement | Policy |
|---|---|---|
| Chat and coding, the 27B | 5060 Ti | always loaded; two slots; never unloads for images |
| Image, video | 2070 Super | on demand; Klein 4B and Wan 2.2 5B are documented for 8 GB-class cards with offloading; the internal card has no Thunderbolt penalty; Turing has no native fp8, so slower |
| Judge, embed, speech | CPU | as in layout A |

Its costs: slower image generation on the older card, which also
holds the display; slower chat during coding sessions; chat is down
whenever the eGPU is; the provenance decision.

**Two chat engines with switching is rejected.** The outside review's
third pass proposed the 27B as chat when loaded and the 8B on the
2070 Super otherwise. That is two implementations of the one thing
the family talks to. Every guard, tool set size, composer rule, and
seeded acceptance run is calibrated per model, so each future item
would prove itself twice, forever, and the companion's voice and
judgment would change whenever someone asked for a picture. One chat
model, chosen by the bench.

## Warm-up, and what cannot be hidden

Three delays exist, and pre-warming covers two. The model load (tens
of seconds) happens only at boot under layout B, and under layout A it
belongs to the coder, which the engine host reloads eagerly. The
prompt prefix (persona, tools, the fixed block) is rendered into the
engine's cache at boot already (ROUTE-02) and again after any restart.
The per-turn cost cannot be pre-warmed: after the person stops
talking, the engine still processes their new words and decodes the
first sentence, and on the 27B that is about three times the 8B's work
per token, a few hundred milliseconds on top of today's 836 ms median.
That number decides whether the family feels the larger model. A
later chat-program item can hide part of it by processing the
transcript while the person is still finishing the sentence.

## Image and video models

The catalog picks were made on 2026-09-04 (dev.md, the legacy review
table): FLUX.2 Klein 4B as the image default, Wan 2.2 TI2V-5B fp8 for
video, Juggernaut XL kept as the large-LoRA-library alternative
offered in the wizard, ComfyUI as the sidecar engine. The outside
review's research confirms them and adds four inputs for the image
engine's design note when that item is built:

- Z-Image-Turbo (6B, Apache-2.0) is the side-by-side challenger for
  photoreal output and text in images.
- MiniMax H3 is never a catalog default: its open-weight terms exclude
  US, EU, UK, and South Korean use without a separate grant, and its
  optimized package still relies on tens of GB of system RAM through
  offloading.
- SANA-Video 2.0 (text-to-video only, no first-frame conditioning) and
  LTX-2.5 are benchmark candidates, not picks.
- Catalog VRAM figures must be measured full-pipeline peaks on this
  card, not publisher numbers. Prefer pipelines that fit the card over
  ones that fit by offloading: offloading moves weights over the
  Thunderbolt link every step and leans on system RAM, and the
  laptop's RAM is not generous.

## The measurement lane (when the card is installed)

One coder session, one lane, engines held for it:

1. The coder alone on the 16 GB card: `-c 32768`, then `-c 65536`,
   VRAM read from `nvidia-smi`, decode and prompt speed at 5k and 25k
   with MTP on. Fallback if 64k does not fit: 49152.
2. Chat at `-c 24576 --parallel 2 --kv-unified` on the 2070 Super with
   the display attached: VRAM under 7.0 GB, cold and warm first-token
   times against the recorded 836 ms median.
3. Judge on CPU: memory-write latency per turn. Embed on CPU:
   per-query latency. Each with a stated threshold before the run.
4. The 27B as chat: the 28-conversation fixture, EVAL-07's baseline
   questions, and the first-spoken-response rows, two slots and MTP on
   the 16 GB card. The comparison against the 8B's recorded runs
   decides between layouts A and B.
5. Klein and Wan through ComfyUI on the 16 GB card: peak VRAM, system
   RAM, and total time including load, per the catalog's definition
   of a fit.

Physical checks before the card goes in: the enclosure's supply covers
the card's 180 W, the card is two slots wide, and the laptop's driver
is current enough for Blackwell. All three are expected to pass and
none is measured.

## Follow-ups this creates

- A design note in `docs/dev.md` for the engine host's work-card
  policy (which on-demand engine holds the 16 GB card, eviction in
  priority order after the in-flight request, eager reload), then its
  BACKLOG items. Written once the card is in and the lane has run.
- The homelab laptop page gets the chosen layout when the engines
  move, in the same change.
- If layout B wins: the provenance decision, and the retirement of the
  8B from chat.
