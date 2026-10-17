# Chat engine comparison: llama.cpp, oMLX and Rapid-MLX (2026-10-17)

Jesse (owner, asleep, delegated 2026-10-17): "benchmark llama.cpp vs oMLX vs Rapid-MLX, whichever wins on performance,
reliability, etc., cut us over to that." Benchmarked for real on the Mac Studio (Apple M5 Max, 128 GB), same model, three
engines, with the live Stack untouched (separate processes on other ports, GPU lock held for every run). This note is the decision,
the evidence and the rollout. It supersedes row 5 of [chat-throughput-2026-10-17.md](chat-throughput-2026-10-17.md) ("MLX instead
of llama.cpp: rejected; there is no MLX build of Muse"): that row was wrong on its premise, `mlx-community` hosts Muse Glimmer 30B in
4, 5, 6 and 8 bits since 2026-08-10.

Status: decided and built on the Stack side 2026-10-17 (Stack main `8226ef8` and `b17b34b`, row ENGINE-MLX-01); the live Studio runs
it after the Home release that pins that Stack. The real engine was exercised through the Stack's own supervisor and public route on
the Mac (environment from the hashed file, model hash check, completion with reasoning and timings, stream, tool call, json_schema,
picture, token count, SIGKILL, clean stop).

## Decision

**Cut the chat role over to oMLX 0.7.0 on Apple Silicon at the tiers whose memory fits it (p64 and p128), with llama-server kept
installed as the automatic fallback and the rollback, and as the engine everywhere else (Linux, Intel, p16, p32).** The embed role
and the 4B judge stay on llama-server (chat-only cutover).

Why oMLX and not Rapid-MLX, in one line each: the two MLX engines are equally fast (same MLX kernels), but Rapid-MLX loses the
prompt cache whenever another conversation runs in between, mis-parses a tool name ("convert<|message|>" in 3 of 120 sampled
calls, deterministic), and writes truncated reasoning into the visible `content` when a reply hits `max_tokens` (a leak path for a
minor's no-reasoning rule). oMLX matched llama-server on tool calls and system-message handling and showed none of these.

Why leave llama.cpp for it: the same model at the same size is **23 percent faster to generate and 36 to 42 percent faster at
prompt processing**, 2 GB smaller resident, and as stable. The costs, stated honestly: a Python runtime (about 0.9 GB of packages)
instead of one binary, one more third-party maintainer, a per-request overhead 0.15 s higher on a one-token prompt, a 4.5 s weight
load at the first request, and a 4-bit MLX weight format that measured 2.2 percent higher perplexity than Q4_K_XL (inside the
measurement error). None of those costs shows in a conversation; the speed does.

## What was compared

| Item | Value |
|---|---|
| Model | Muse Glimmer 30B (dense, 29.6B). llama.cpp: the live `Muse-Glimmer-30B-KQuant-Dynamic-Q4_K_XL.gguf`, 19.65 GB. MLX: `mlx-community/Muse-Glimmer-30B-4bit`, revision `3e7677d7a40d348a3daba263a2b1c0aa41910710`, 19.44 GB, affine 4-bit, group size 64 (the vision tower included), Apache-2.0 |
| llama.cpp | b10797 with the Stack's exact launch flags (`-c 131072 -fa on -ngl all -ub 1024 -ctk q8_0 -ctv q8_0 --jinja --chat-template-kwargs {"reasoning_strength":"low"}`) plus the shipped vision projector, as the Stack launches Muse today |
| oMLX | 0.7.0 (GitHub release wheel `omlx-0.7.0-cp312`, Apache-2.0), mlx 0.32.4, mlx-lm 0.32.2, mlx-vlm 0.7.8, all other packages from PyPI (the upstream git-pinned dependencies are not needed for chat, section "Install and supply chain") |
| Rapid-MLX | 0.16.2 (PyPI, Apache-2.0), mlx 0.32.4, mlx-lm 0.31.3, with its `muse` tool and reasoning parsers (auto-selected) |
| Requests | streamed `/v1/chat/completions`, Stack sampling (temperature 1.0, top_p 0.95, top_k 64), `reasoning_strength: low` sent per request to the MLX engines (llama.cpp has it pinned at launch) |
| Method | one engine at a time under the shared GPU lock, every run under 10 minutes, `HF_HUB_OFFLINE=1`, no analytics, the engines' own update checks off. Scripts and raw JSON: scratchpad `enginebench` of the session (not committed; the numbers below are copied from it) |

Contention note: other agents run image and video jobs on this GPU. The lock keeps them out during a run; one early llama.cpp run
still showed the known halving (a second GPU job; see CHAT-TPS-01), so every figure below is from a run with a normal 26 tok/s baseline.

## Scorecard

| | llama-server b10797 | oMLX 0.7.0 | Rapid-MLX 0.16.2 |
|---|---:|---:|---:|
| Generation, 128 / 512 tokens (tok/s, median of 3) | 26.1 / 25.6 | **32.5 / 31.6** | 31.6 / 31.2 |
| Prompt processing at 512 / 2k / 8k tokens (tok/s) | 713 / 661 / 653 | 722 / 890 / **924** | 668 / 886 / **928** |
| 16k-token prompt: time to first answer / tok/s | 26.6 s / 617 | **18.2 s / 901** | 18.0 s / 913 |
| One-token prompt, total request time | **0.10 s** | 0.25 s | 0.22 s |
| Ready after start / first request cold | **2.1 s** / 0.9 s | 4.1 s / 4.8 s (weights load at the first request) | 12.2 s / 1.1 s |
| Idle resident memory (process tree RSS) | 21.5 GB (128k context reserved) | **19.4 GB** | 19.6 GB |
| RSS after a 16k prompt | 23.9 GB | 19.9 GB | 19.7 GB |
| Idle for 60 s: CPU time used / sockets open | 0.13 s / listener only | 0.27 s / listener only | 0.19 s / listener only |
| 3-turn chat, 3.7k-token system prompt: turn 1 / 2 / 3 time to first token | 5.9 / 0.6 / 0.4 s | 4.2 / 0.5 / 0.6 s | 4.2 / 0.5 / 0.5 s |
| Same system prompt after an unrelated request in between | 1.8 s | 2.1 s (0.3 s when the SSD cache holds it from an earlier run) | 4.2 s (full re-read; `--hybrid-cache-entries 8` did not help) |
| 4 parallel requests: aggregate tok/s (each) | 41 (16.7) | 49 (18 to 26) | **55** (25.9) |
| 30 concurrent short requests: wall time, errors | 15.4 s, 0 | 13.5 s, 0 | **6.2 s**, 0 |
| 200 sequential requests: errors, RSS growth | 0, +6 MB | 0, +11 MB | 0, +1 MB |
| `kill -9` mid-request, restart, next request | ready 2.1 s, ok | ready 4.1 s, ok (first request 3.1 s) | ready 8.1 s, ok |
| SIGTERM to exit | 0.2 s | 1.0 s | 0.4 s |
| Tool calls, 40 rows (the corpus's multi-tool rows plus rows written for this bench, 9 of them must call nothing), greedy | **36** | 33 | 34 |
| Tool calls, 4 sampled runs at the Stack's sampling | **137 of 160** | 136 of 160 | 99 of 120 (3 runs) |
| Tool-name or content corruption seen | none | `math.math` 1 of 160 (namespace echo) | `convert<\|message\|>` 3 of 120; reasoning text in `content` on `max_tokens` |
| Reasoning check, 60 generated prompts (arithmetic, remainder, ordering) | 60 of 60 | 60 of 60 | 60 of 60 |
| Late and double system messages, tool round trip (JSON string and object arguments), stop, `max_tokens` | 6 of 6 | 6 of 6 | 6 of 6 |
| Picture (2,801 tokens / 4,161 tokens) time to first answer | 8.0 / 12.7 s | **5.5 / 7.1 s** | 5.7 / 7.4 s |
| Perplexity, 8k tokens of prose (2048 windows) | **14.86** | 15.19 (+2.2 percent; the estimate's own error is +/-0.5) | same weights |
| Speculative decoding | DFlash: 1.5x text only (not with the projector) | none for Muse: its DFlash path needs an unpinned fork and ran at 15.6 tok/s | DFlash works (39 tok/s) but single-user, no prompt cache: each turn re-reads the prompt |

Tool-call reading: the 40-row greedy gap (36 against 33 and 34) is noise. Sampled at the Stack's own settings the two are level
(137 and 136 of 160). Every miss in both is the same: a two-tool request where the model calls one tool at a time, plus one
"who won the game last night" row. The rows that differ between engines are the parser faults in the last-but-three row above.

Greedy output equivalence: 20 prompts at temperature 0, 450 tokens. No output is byte-identical to llama.cpp's (different weight
format), the two pairs read side by side answered the question equivalently, and the text similarity ratio is 0.33
on average, which is what two different quantizations of one model give. Perplexity and the 60 + 40 task rows are the quality
evidence; the repo's quality benches (`tool-calling.ts` route pass, `chat-ab-01`) have not been run against the MLX engine (they
need the cut-over Stack): row ENGINE-MLX-02.

## Feature parity with what the Stack ships

| Stack feature | oMLX | Notes |
|---|---|---|
| Vision attach (picture in chat) | yes | The MLX weights carry the vision tower; no projector file. Pictures read correctly (2,802 and 4,162 prompt tokens, same descriptions as llama.cpp). Picture size is bounded by `--max-image-side-length` (default 2048 px) instead of `--image-max-tokens 2560` |
| Tool calls (ATEM format) | yes | Parsed natively by mlx-lm; arguments as object or JSON string both round-trip |
| `reasoning_content` | yes | Streamed as `reasoning_content`; `completion_tokens_details.reasoning_tokens` is not reported (llama.cpp does not report it either) |
| Thinking control | yes | `chat_template_kwargs.reasoning_strength` low, medium, high changes the reasoning length the same way as on llama.cpp (the Stack sends the record's launch value with each request instead of at launch) |
| Sampling, seed, stop | yes | `top_k` 1 and a fixed seed reproduce; `stop` works |
| Keep-warm and warm-up events | yes | The Stack primes with a short request; weights load in 4.5 s at the first request; health says `loaded_count: 0` until then, so the post-load check does the loading |
| Memory governor admission | yes, by measurement | Resident size is a single process tree (19.4 GB, +0.5 GB at 16k); no context reservation, so the record carries a measured peak |
| Health route, graceful exit, port | yes | `/health` (JSON), SIGTERM exits in 1 s, `--host 127.0.0.1 --port N` |
| Prompt cache across turns | yes | In-session reuse on par with llama.cpp; plus a paged SSD cache that survives a restart (kept inside the Stack's data directory) |
| Parallel requests | yes | Continuous batching; slower than Rapid-MLX at 30 concurrent, faster than llama.cpp |
| `response_format` json_schema (follow-up suggestions, the memory and persona judges) | yes, with xgrammar (no torch needed) | 8 of 8 schema-valid replies, 2 to 3.5 s each; in the same harness llama-server b10797 returned prose in 8 of 8 (Muse reasons first and the grammar did not constrain the answer; worth its own check, it is how the live engine behaves today) |
| `/tokenize` and `/apply-template` (the Stack's `/v1/tokenize`) | no | Not on the engine. The Stack counts tokens with a one-token chat request (the engine's own template, exact `usage.prompt_tokens`), which the prefix cache makes cheap |
| `timings` object (tokens per second in turn stats) | no, but its `usage` carries `generation_tokens_per_second` | The Stack maps it into the stream's `timings` so Home's figure is unchanged |
| `usage.prompt_tokens_details.cached_tokens` | present, not reliable on short prompts | Cosmetic (the cache-reuse figure in chat details) |
| DFlash | no | llama.cpp's 1.5x does not combine with the projector the Stack now loads, so the shipped speed today is 26 tok/s |

## Rapid-MLX, in short

Equal raw speed, the best concurrency (55 tok/s at 4, 6.2 s for 30), a hashable PyPI install and Muse-aware parsers. Rejected for
the chat role on three measured faults: no prefix reuse across interleaved conversations (4.2 s against 0.3 to 2.1 s, and a household
alternates between people), the tool-name corruption, and truncated reasoning written into `content`. It also contacts
`rapidmlx.com` for a version check unless `RAPID_MLX_DISABLE_VERSION_CHECK=1` is set. It is the right next candidate if oMLX
stalls; the same environment pattern and the `muse` parsers would carry over.

## Maintenance, licence, privacy, supply chain

| | llama.cpp | oMLX | Rapid-MLX |
|---|---|---|---|
| Licence | MIT | Apache-2.0 | Apache-2.0 |
| Activity | huge, many maintainers | 22.9k stars, created 2026-02, pushed today, v0.7.0 on 2026-09-30, 649 open issues, one maintainer wrote 2,089 of about 2,400 commits | 4.0k stars, created 2026-02, pushed today, v0.16.2 on 2026-10-16 (a release every 3 days), 44 open issues, one maintainer wrote 2,401 commits |
| Dependency on MLX itself | none | mlx 0.32.x and mlx-lm (Apple's MIT projects, daily commits) | the same |
| Outbound calls found in the code | none | update check and model downloader exist in the admin panel only; none started; with no admin use the process held one listening socket and nothing else | version check to `rapidmlx.com` at start (off with an environment variable), opt-in support request |
| Web surface | `--no-webui` | an admin dashboard on the same port; the Stack sets a random `--api-key` per launch and binds loopback | none |
| Install | one signed-by-checksum binary archive | release wheel (sha256) plus 150 PyPI packages | PyPI wheels |

Install and supply chain for oMLX: its published metadata pins five dependencies to git commits (mlx-lm, mlx-vlm, mlx-audio,
mlx-embeddings and a fork named dflash-mlx), which cannot carry hashes. The chat path needs none of them: the release wheel
installed with `--no-deps` beside PyPI releases of mlx, mlx-lm and mlx-vlm imported and ran every test in this note (the "oMLX" column is that environment; the
git-pinned environment gave identical numbers). The Stack therefore builds its environment from one fully hashed requirements file
(`uv pip sync --require-hashes`, the same builder as Pocket TTS, Chatterbox and ComfyUI) with the oMLX wheel as a hashed URL line.
Upgrades are a new compiled file and a new pin; the previous environment stays for rollback. Features this loses (DFlash, which did not
work for Muse anyway) are not used.

Licences of the 150 transitive packages are not individually reviewed here; the Stack's components inventory
(`componentsDoc.ts`) lists them from the compiled file after the build, which is the existing check for the other engines.

Pictures: a solid-colour test at 16 and 32 pixels is answered "white" by both llama.cpp and oMLX (the model, not the engine); from 64 pixels up
both read the colour correctly, and real photos matched in description.

## What was not verified

- The repo's own quality benches against the MLX engine (row ENGINE-MLX-02, to run after the cut-over Stack is installed, never on the live one).
- 5-bit and 6-bit weights (22.9 and 26.4 GB): the 4-bit gap in perplexity is inside the error and the task rows tie, so they were not downloaded further.
- Qwen3-4B (judge) and nomic embeddings on MLX: out of scope, they stay on llama-server.
- Behaviour on battery and under thermal limits, and on a 64 GB Mac (the memory numbers scale from this 128 GB run; p64 admission is by the measured peak).
- DFlash with the vision projector on llama.cpp (taken from the earlier note, not rerun).
- Long-run (days) leak behaviour beyond the 200-request soak.

## Rollout and rollback

1. **Stack change (additive, `stack.engines.chat.engine`).** The existing setting (STACK-93, values `llama-server` and `mlx-serve`) gains
   `omlx` and `auto`. `auto` is the new default: oMLX when the machine is Apple Silicon at p64 or p128, the oMLX environment is built and
   the MLX weights are installed and verified; otherwise llama-server. Explicit values always win. (The coordinator's name
   `stack.chat.engine` was not used: the existing key is already stored on machines and renaming it would orphan it.)
2. **Models.** A second Muse record (`muse-glimmer-30b-mlx-4bit`, engine `omlx`) pins the 13 files by path, size and sha256 at revision
   `3e7677d7a40d348a3daba263a2b1c0aa41910710`. The GGUF stays installed and selected-by-engine, so fallback needs no download. The install
   plan adds the MLX record on p64 and p128; the Stack pulls declared parts for installed models at daemon start, so an upgraded Studio
   fetches the 19.4 GB in the background and keeps answering on llama-server until it is verified.
3. **Launch.** Supervised like every spawned engine: loopback, a random API key, offline, `--max-concurrent-requests`, a prompt cache under the engine's own state folder that is emptied at every launch (the engine's turn-to-turn reuse needs a disk cache; with `--no-cache` every turn re-read the 3.7k-token prompt in 4.2 s), the record's
   `reasoning_strength` sent with each request, health and post-load checks, keep-warm, the memory governor with the measured peak.
4. **Automatic fallback.** If the oMLX engine fails its start or post-load check twice in a row, the role starts llama-server for that
   process lifetime and raises a health row with one fix ("Use llama-server" / "Retry oMLX"). The setting is not rewritten.
5. **Rollback by one setting**: set `stack.engines.chat.engine` to `llama-server` and restart the chat engine; nothing is deleted. Removing the
   MLX record afterwards frees 19.4 GB.
6. **After the release lands on the Studio**: run the Studio bench protocol (`ENGINE-MLX-02`), compare tool-calling and chat-ab-01 scores with the
   llama-server row in the same session, and keep `auto` only if they match.

## What would change the answer

Back to llama-server everywhere if: ENGINE-MLX-02 shows a quality or tool-call regression on the repo's benches; oMLX's maintainer goes
quiet for a release cycle while mlx moves (the ABI pin would then strand us); or llama.cpp's Metal path closes the 23 percent gap
(a newer build than b10797 is measured faster in some reports; a b11404 pin is the first thing to retest). Move to Rapid-MLX if its
cache and parser faults are fixed upstream and oMLX stalls.

## CF-SEARCH-01: "is cloud flare down right now" answered "I won't guess" (2026-10-17)

Live report, Safari, v0.2.13, Muse Glimmer on oMLX. Search was offered and the model did call it. Replay through a scratch Home pointed at
the live Stack (reasoning text and generation records kept): the model wrote `{"expression":"Cloudflare outage status October 17 2026","scope":"web"}`;
`policy` refused it as `ungrounded_args` (the person typed "cloud flare", the query shares no exact word), and the fixed refusal line
"I don't actually have that in this conversation, so I won't guess." replaced the answer. That line is `policyRefusalLine` (GROUND-01), not the
picture prompt floor commits; no prompt change taught the model to refuse. A second failure in the same replay: about one search turn in five the
engine's tool parser dropped the call's opening tags and the person saw `<atem:parameter name="expression">...` as the reply with no search.

Fixes, none of which reads the person's words (rule 1):

1. Grounding treats "cloud flare" and "cloudflare" as one name, and one typo letter in a name of 6 or more letters as the same word (`policy.ts`).
2. `envelopeToolCall` recovers a call whose opening tags the engine dropped (a parameter block with `expression` is the search call) (`llm.ts`).
3. The date line in the stable prefix tells the model that news, scores, prices, outages, whether a service is up and who holds an office are looked up
   before answering, never answered from memory (`context.ts`).

Measured, 20 current-events prompts (outages, scores, prices, news, weather, "right now", "today", "latest"), one new conversation each,
exact production prompt and tools, Glimmer on oMLX, same ddgs. The model is not deterministic, so read these as rates, not exact counts.

| | before | after |
|---|---|---|
| Search or lookup executed | 10 of 20 | 14 of 20 |
| Refused as `ungrounded_args` ("I won't guess") | 2 | 1 |
| Raw call markup shown as the reply | 4 | 0 |
| Answered current state from memory, no call (election, "is the internet down") | 2 | 0 |
| Other: news shelf and weather answered by their own tools (designed); after, also one ambiguous "score of the game" that asked which game | 2 | 3 |

Still open: a query with no word in common with the person's (for example "sports results October 16 2026" for "who won last night") is refused
by design (rule 6 keeps ungrounded arguments as policy refusals), and a model-invented tool name gives the same line (2 of 20 after). Changing
either needs Jesse's ruling on rule 6 (proposed: search the person's own words instead).
