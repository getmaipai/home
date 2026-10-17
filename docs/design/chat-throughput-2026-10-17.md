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

## DFlash draft, measured (CHAT-TPS-02, 2026-10-17)

**Result: 1.26x to 1.88x at the Stack's own flags, 1.55x on average across five prompt kinds. Worth shipping.**

Draft file, from the model card (`meta-models/Muse-Glimmer-30B-GGUF`, revision `70bf1b61ac09f91b24d39038091b41c582bc5d7a`):
`dflash-Muse-Glimmer-30B-Q4_K_M.gguf`, 1,631,208,128 bytes, sha256
`b2e808bf656086fe86bd0d0bd990f01d33e377537a07c02d45371517c8b264ef` (the Hugging Face file listing's value; the downloaded file
matched it). The card documents only `-md <file> -ngld 99`; `llama-server --help` on the live b10797 build adds
`--spec-type draft-dflash` and `--spec-draft-n-max N` (default 3). Both are needed: `-md` alone is not the DFlash path.

Method: a separate llama-server on port 18998 with the Stack's exact launch flags (the Q4_K_XL file, `-fa on -ngl all --reasoning off
-ub 1024 --jinja --chat-template-kwargs {"reasoning_strength":"low"} --cache-reuse 256 -ctk q8_0 -ctv q8_0`), seed 7, temperature 1.0,
top_p 0.95, top_k 64, 200 generated tokens per run, 3 runs per prompt, streamed through `/v1/chat/completions`. Tokens/s is the
engine's `predicted_per_second`. The bench lock was held; the live Stack and chat were not touched.

| Prompt | No draft, 128k ctx | With draft, 128k | Speedup | Acceptance | With draft, 16k ctx (no draft) |
|---|---:|---:|---:|---:|---:|
| short chat | 25.9 | 32.6 | 1.26x | 42% | 30.4 (25.9) |
| code | 26.0 | 42.1 | 1.62x | 64% | 41.7 (25.6) |
| long explanation | 25.8 | 32.6 | 1.26x | 42% | 32.4 (25.3) |
| tool-call JSON | 25.5 | 47.0 | 1.84x | 77% | 47.2 (25.1) |
| reasoning-heavy | 25.9 | 46.4 | 1.79x | 77% | 47.0 (25.9) |

Time to first token (short prompts): 505 to 521 ms with the draft against 549 to 563 ms without. No penalty; prompt processing is
unchanged. Memory: resident size of the server was 20.05 GB without and 22.23 GB with the draft at 128k (+2.2 GB), and 19.27 against
21.44 GB at 16k (+2.2 GB); the file is 1.6 GB, the rest is the draft's own context. A 16k context changes speed by under 3%.

Draft length (`--spec-draft-n-max`), 16k context, tokens/s for chat / code / explain / JSON / reasoning:

| n-max | chat | code | explain | JSON | reasoning |
|---:|---:|---:|---:|---:|---:|
| 3 (default) | 30.4 | 41.7 | 32.4 | 47.2 | 47.0 |
| 6 | 20.9 | 33.1 | 23.1 | 34.5 | 34.4 |
| 16 (the drafter's block size) | 11.8 | 22.4 | 11.6 | 33.7 | 22.8 |

Longer drafts are slower: acceptance falls (42% to 24% to 10% on chat) and every rejected token is verified for nothing. Keep the
default of 3. Lower values (1 and 2) were not run.

Honest limits of these numbers:

- **Variance is small by construction.** A fixed seed makes each prompt's three runs near-identical (spread under 1 tok/s, one
  outlier run at 25.9 against 32.7 for the same prompt, likely another process on the GPU). The real variance is across prompts and
  sampling seeds, which these runs do not sample; expect each figure to move by a few tokens/s in daily use.
- **Runs are 200 tokens.** All 200 were the model's reasoning text (the stream's `reasoning_content`), so the table measures the
  thinking phase. Final-answer prose was not isolated. The code and JSON rows are structured text and gain most; open prose gains
  least (1.26x). A chat that is mostly prose should expect the low end.
- **"Same output" holds in distribution, not byte for byte.** At temperature 0 with the same seed, 1 of 5 prompts matched exactly
  (code). The other four diverged after 170 to 690 characters (about 40 to 170 tokens). That is floating-point difference between
  one-token and batched verification on the GPU, not a changed distribution, but it means "identical answers" cannot be a test
  gate. Gate on quality benches (search, tool, reasoning) with the draft against without, not on string equality.
- Acceptance at temperature 0 was within 2 points of temperature 1 (44% to 76% at 0 against 42% to 77% at 1.0), so the sampling
  temperature Muse uses does not hurt the draft.
- b10797 is enough. The newer Metal few-row kernels (b11404+) were not tried; no pin bump is needed to ship.

### Quality check with and without the draft (2026-10-17)

The same three benches against a separate llama-server on port 18998 (Stack flags, 32k context, `--seed` 1, 2, 3 per run, restarted per
run; lock held; live Stack untouched), draft against no draft, three seeds each:

| Bench | No draft (seeds 1, 2, 3) | Draft (seeds 1, 2, 3) | Verdict |
|---|---|---|---|
| Tool calling: `tool-calling.ts`, 2 repeats, corpus rows plus the budget-offered pass (58 runs per seed) | 43, 42, 43 correct (128/174, 73.6%) | 43, 41, 45 correct (129/174, 74.1%) | Same. Corpus false calls 0 in every run; budget-pass false calls 2 in every run. |
| Search decision: `search-recency-02.ts`, plain arm, 4 stable and 4 recency adult rows | stable 50, 50, 50%; recency 50, 100, 75% | stable 100, 50, 75%; recency 75, 100, 25% | Inside the bench's noise (4 rows per cell, 25 points per row). Pooled over 24 row runs: 15/24 (62.5%) against 17/24 (70.8%). No signal either way. |
| Reasoning: 20 short arithmetic and logic questions, own scorer, temperature 1.0, 1,500 token cap | 20/20 each seed; 2,639, 2,546, 2,734 tokens | 20/20 each seed; 2,558, 2,518, 2,700 tokens | Same answers; the draft does not change how long the model reasons. |

Reading: quality holds within the benches' noise. Seeds differ per run, so each cell is also an independent sample of the model's own
sampling variance, which is the wider of the two spreads (the tool bench moves by 2 to 4 correct between seeds in both arms). The
search bench is the weak instrument here: 8 rows cannot see a few points, and the three seeds only bound a large loss. Speculative decoding
is lossless in distribution, and nothing here contradicts that. The reasoning set is at its ceiling (20/20) so it can only catch a
collapse, which did not occur. Not run: the 120-row KS-BENCH-01 set (hours at 26 tok/s) and ARCH-MEASURE-01's 50-repeat budget pass.

### Combined with the Muse projector: no gain (2026-10-17)

The Stack launches Muse with its projector (VISION-03a), so the draft was tested together with it: the Stack's exact generated flags
(`--mmproj <file> --spec-type draft-dflash -md <file> -ngld 99 --image-max-tokens 2560 -ctk q8_0 -ctv q8_0`, `--cache-reuse` omitted
as the Stack does with a projector), scratch port, Q4_K_XL, 131072 context, three runs per cell.

| Launch | Text prompt tok/s | Picture + text tok/s | Acceptance | Resident |
|---|---:|---:|---:|---:|
| Projector, no draft | 26.0, 26.1, 25.8 | 25.7, 25.9, 25.9 | n/a | 21.6 GB |
| Projector + draft | 23.7, 17.7, 22.7 | 23.2, 23.1, 21.3 | 46% and 49% | 23.8 GB |
| Draft, no projector (control, same hour) | 34.6, 30.3, 35.2 | not applicable | about 42% | about 22.2 GB |

The combination starts, answers a picture request, and speculation engages (acceptance matches the no-projector run), but it is
**slower than no draft** (about 22 against 26 tok/s) while the same draft without the projector runs at 30 to 35. The cause inside
llama.cpp is not identified (the projector turns off chunk reuse and changes the slot path; I did not bisect it). The memory fits
the p128 budget either way (23.8 GB resident).

**Consequence: the draft cannot ship while Muse loads the projector on b10797.** The Stack change (stack branch `dflash-draft`,
commit `f0fe28d`: pin, install plan, launch flags, memory counting, tests) is complete but is not pushed. Choices for Jesse:
(a) keep pictures, no draft (today); (b) run the draft and leave the projector out of chat (about 1.3x to 1.8x faster, no picture
reading); (c) retest the combination on a newer llama.cpp build (the Metal few-row kernels, b11404 and later) before choosing.
Recommended: (a) now and (c) at the next engine pin bump; (b) only if Jesse prefers speed over pictures.

### How to ship it (CHAT-TPS-02 plan)

1. **Pin the draft in the model record**, the same way the projector is pinned (VISION-03b): `draft: { url, revision, sha256,
   bytes }` with the repo, revision and sha256 above and 1,631,208,128 bytes. The install downloads it once and verifies the sha256;
   a mismatch fails the install with the file name and the expected hash.
2. **The Stack passes the flags per tier**: `--spec-type draft-dflash -md <file> -ngld 99`, and leaves `--spec-draft-n-max` at its
   default of 3. Nothing else in the launch changes.
3. **Memory plan counts +2.2 GB** for the draft (not the 1.6 GB file size). At p128 and p64 it fits with room (the Studio has 76% free with all roles loaded). At
   p32 memory is tight (the chat process alone peaks near 21.4 GB), so the draft is on only when the fit plan shows at least 3 GB
   spare after the other roles; otherwise it is dropped and chat runs at normal speed. p16 does not use it: the drafter is made
   for Muse Glimmer, and the p16 chat model is a different one.
4. **Keep-warm:** the draft loads and unloads with the chat process (it is part of the same launch), so keep-warm needs no change
   beyond the memory number.
5. **Thinking tokens and tool calls behave the same:** the drafter only proposes tokens; the main model accepts or replaces each,
   so reasoning, tool-call JSON and stop tokens come from the main model's distribution. Structured output gains most (JSON 1.84x).
6. **Verification before the catalog change: done above** (equal within noise). Still to run before the installed Stack changes:
   the draft together with the Muse projector in one launch (the projector file was not on disk for this run), and the p32 Q4_K_M
   file with the draft (only the Q4_K_XL file was tested). Architect verdict first, since the record shape and `engineArgs.ts` change.

**Not done:** the installed Stack was not changed. The approval needed is to add the pinned draft to the Muse Glimmer 30B record (p32
and larger) and the flags to `engineArgs.ts`; see the CHAT-TPS-02 row.

## Rules check

- Local only: DFlash is a file the install downloads once like any model; nothing is sent out at run time.
- Age and surface gates, tool failure handling, the turn: untouched. Speculative decoding does not change output.
- "Engine's native features are the implementation": `draft-dflash` is the engine's own.
- Model change: not proposed here; row CHAT-TPS-04 sends it to vetting.
- Architect gate: no `architect` agent is installed in this checkout (no `.claude/agents`), so no verdict was run. No `RULES.md`
  line is touched and no new design rule is proposed. Verdict: pending, to be ruled on when CHAT-TPS-02 is picked up.

## Backlog

CHAT-TPS-01 to 04 in `docs/BACKLOG.md`, "Chat throughput (owner, 2026-10-17)".
