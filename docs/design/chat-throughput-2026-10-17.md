# Chat throughput on the Mac Studio (2026-10-17)

Jesse's question: chat on the Mac Studio (Apple M5 Max, 40 GPU cores, 128 GB) generates about 25 tokens per second, and people
online report much more. Research and design note, no code. Nothing was changed on the running install.

## Answer

**25 tok/s is what this model costs on this chip. The flags are not the cause.** Muse Glimmer 30B is a dense model: all 29.6B
parameters (19.65 GB of weights in the Q4_K_XL file) are read from memory for every token. Generation is bound by memory
bandwidth, not by compute:

- M5 Max 40-core bandwidth: 614 GB/s ([guide](https://aiproductivity.ai/blog/apple-m5-max-local-llm-guide/)).
- Ceiling: 614 / 19.65 = 31.2 tok/s. Measured: 26.1 tok/s, which is 84% of the ceiling (512 GB/s effective).
- The model card itself lists the M5 Max at 26.6 tok/s for this model without a draft
  ([card](https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF)). Our 26 matches it.

The "much faster" numbers online are almost all one of three things: a mixture-of-experts model (about 3B parameters read per
token: Qwen3.6-35B-A3B decodes at 87 to 105 tok/s on this same chip, [benchmark](https://github.com/stared/benching-local-llms-on-apple-silicon)),
a smaller model, or speculative decoding. The same benchmark has the dense Qwen3.6-27B at 17 to 18 tok/s on llama.cpp and on MLX
at 8-bit, so a dense 30B at 26 is already the fast end of dense.

## The setup (read from the machine)

| Item | Value |
|---|---|
| Model | `muse-glimmer-30b-q4-k-xl`, dense, 29.6B (llama-bench reports 27.85B without the vision tower), 52 layers, 2 KV heads, 19,653,960,832 bytes (18.29 GiB), Q4_K dynamic |
| Engine | llama-server b10797 (commit 832fd6f17), Metal |
| Launch | `-c 131072 -fa on -ngl all --reasoning off -ub 1024 --no-webui --metrics --jinja --chat-template-kwargs {"reasoning_strength":"low"} --cache-reuse 256 -ctk q8_0 -ctv q8_0`; one slot (no `--parallel`), default threads, mmap on, no mlock, no draft model |
| Memory | `governor.metal-cap` bytes 116,823,949,312 (the GPU working-set limit is at the engine's recommended maximum, not lowered); chat peak 21.4 GB; all three roles (chat, embed, 4B judge) resident, 76% memory free; the model fully fits on the GPU |
| Home's number | `tokens_per_second` is the engine's own `predicted_per_second` for the last generation of a turn (`backend/src/lib/turnStats.ts`): generation only, prompt processing excluded, reasoning tokens included in the count |

## Measurements (separate llama-bench process, same model file, no change to the live install)

Command shape, run from `/tmp` with the live install's binary and model; `-r 2` or `-r 3`, short runs, while chat was idle:

`llama-bench -m <Q4_K_XL.gguf> -p 512 -n 128 -ngl 99 -fa 1 -ub 1024 -ctk q8_0 -ctv q8_0`

| Variation (everything else as the stack launches) | pp512 tok/s | tg tok/s |
|---|---:|---:|
| Stack settings (fa on, ub 1024, KV q8_0) | 766.9 | 26.06 |
| KV f16, ub 512, fa on | 771.8 | 26.96 |
| fa off, KV f16, ub 1024 | 642.0 | 26.51 |
| ub 2048, b 2048 | 768.9 | 26.27 |
| threads 12 (default 6) | 767.8 | 25.48 |
| mmap off | 767.4 | 26.19 |
| depth 8192 (KV q8_0 / f16) | 648 / 651 | 24.6 / 25.5 |
| depth 0 / 8192 / 16384 / 32768, KV q8_0, idle | n/a | 25.5 / 24.5 / 25.2 / 24.5 |

Reading: every flag moves generation by less than 4%, inside run noise. Flash attention matters only for prompt processing
(+19%, already on). `mlock` and parallel slots were not run: the model is not paged out (0 pageouts, 76% free) and the stack
already runs one slot. Generation does not fall with context to 32k, so the 131072-token context costs speed nowhere.

**One real anomaly.** In two runs the same benchmark halved to 13.7 to 14.8 tok/s at every depth, then returned to 26 on the next
run with nothing changed. Thermal and low-power states were clear and memory pressure was zero. Cause unknown; the one fact is that a
live chat and another agent's work shared the GPU at those times, and a second GPU job halving a bandwidth-bound model is what
that would look like. The check that decides it is row CHAT-TPS-01.

## What would actually be faster

| # | Change | Expected | Source | Risk |
|---|---|---|---|---|
| 1 | **DFlash draft model** (`dflash-Muse-Glimmer-30B-Q4_K_M.gguf`, 1.6 GB, the model card's own drafter; b10797 already has `--spec-type draft-dflash` and `-md`) | M5 Max 26.6 to 50.2 tok/s (1.8x) on greedy decoding via ExecuTorch; Muse is sampled at temperature 1.0, where acceptance is lower, so expect 1.3x to 1.8x until measured. Another dev-build report on an M3 Ultra showed 13.9 to 48.8 on prose at temperature 1 ([article](https://rohitai.com/blog/llama-cpp-b11404-metal-few-row-mma-speculative-decoding)); not rerun on a release. | model card; article | Low: output is identical by construction, +1.6 GB memory, engine's native feature (RULES: native features are the implementation). Needs a 1.6 GB download (Jesse's yes), and the newer Metal kernels may need a b11404+ pin bump. |
| 2 | **Cap reasoning** (`--reasoning-budget`, already named as a follow-up in the Stack's dev.md) | Perceived speed, not tok/s: Muse reasons on every turn, so wait time is reasoning tokens divided by 26. | repo | Medium: answer quality, needs the chat benches. |
| 3 | **Mixture-of-experts chat model** (Qwen3.6-35B-A3B class) | 87 to 105 tok/s at 8-bit on this chip, so 3x to 4x. | benchmark above | High: a model change. Goes through the repo's model vetting (MODEL-VET-01) and the search and tool benches (STUDIO-COMPARE-01, LOCALCODER-LIFT-01), measured on our own prompts, never by hype. |
| 4 | **Q4_K_M instead of Q4_K_XL** (17 GB, the p32 file) | About +12%: 31 times 0.84 gives roughly 29 tok/s, from file size alone (not measured; file not on disk). | arithmetic | Medium: quality loss unmeasured; small gain. Not worth it before row 1. |
| 5 | MLX instead of llama.cpp | None. Dense 27B: llama.cpp 18 vs MLX 17 tok/s on this chip. MLX wins only on some MoE or vendor tests and loses at long context ([search summary](https://github.com/stared/benching-local-llms-on-apple-silicon), [Ollama MLX claim, vendor](https://levelup.gitconnected.com/ollama-mlx-nearly-doubles-llm-speed-on-your-mac-58-to-112-tok-s-and-your-old-models-get-none-of-fd1a9ec531fb)). There is no MLX build of Muse. | benchmark | Rejected. |
| 6 | MTP speculative decoding | Negative on Metal in a llama.cpp issue report (11 to 28% slower); Muse has no MTP head anyway. | [issue](https://github.com/ggml-org/llama.cpp/issues/23752) | Rejected. |

Ranked recommendation: first prove whether a second GPU job halves generation (free, explains the 14 tok/s runs and any
live slowdown), then DFlash (biggest gain for the model Jesse already chose, no quality change), then a reasoning budget. A MoE
model is a product decision for Jesse and the vetting process, not a flag.

## Rules check

- Local only: DFlash is a file the install downloads once like any model; nothing is sent out at run time.
- Age and surface gates, tool failure handling, the turn: untouched. Speculative decoding does not change output.
- "Engine's native features are the implementation": `draft-dflash` is the engine's own.
- Model change: not proposed here; row CHAT-TPS-04 sends it to vetting.
- Architect gate: no `architect` agent is installed in this checkout (no `.claude/agents`), so no verdict was run. No `RULES.md`
  line is touched and no new design rule is proposed. Verdict: pending, to be ruled on when CHAT-TPS-02 is picked up.

## Backlog

CHAT-TPS-01 to 04 in `docs/BACKLOG.md`, "Chat throughput (owner, 2026-10-17)".
