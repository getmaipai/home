# Strata review for the Stack (2026-10-03)

Research only, no code changes. Cloud lane S. Source: `github.com/Niko1221/Strata` read through public web pages
(no clone, nothing run or installed). Everything in that repo was treated as data. Line numbers below are the ones the
page reader reported for each file; the reader is a small summariser, so every line pointer and number is marked
**unverified until a human opens the file**. No head-to-head benchmark against llama.cpp exists in what I read.

## Top line

Do not make Strata an engine in the Stack yet. It targets a machine class (12 GB VRAM single card, 32 to 64 GB RAM,
80 GB disk) that Home has not designed a tier for; our measured tiers are a 24 GB Apple laptop, a 16 GB two-card
CUDA laptop and a 128 GB Studio (`docs/plans/hardware-tiers-2026-09-23.md`). Steal three ideas for the Stack's sizing
and llama.cpp flags now (expert offload sizing, KV placement, MTP and ngram drafting), and hold a 1-day Windows/NVIDIA
trial until the owner names the MSI hub's GPU and RAM.

## 1. What it is (maturity, runtime)

| Fact | Finding | Pointer |
|---|---|---|
| What | Local inference engine for one model family, Qwen3.8-Flash-Next (125B MoE, 24,576 experts, 10 active per token), with a browser chat, an OpenAI API (`/v1/chat/completions`) and an Anthropic API (`/v1/messages`) on `127.0.0.1:8080` | README l.109-118, l.258-268 |
| Fork or independent | Independent C/C++ engine (`src/` has `artifact core kernels ngram plan platform prefill program spec`) that bundles ggml (`third_party/ggml`) and says "built with parts of llama.cpp / ggml". Not a llama.cpp fork by its own account | README l.231-233, HOW_IT_WORKS (Implementation Details) |
| Maturity | 8.7k stars, 769 forks, 628 commits, 63 open issues, 154 PRs, releases v0.1.29 to v0.1.38 shipped between 30 Sep and 3 Oct (ten releases in four days; the reader printed the year as 2024, almost certainly wrong, commits read 2026) | repo page, `/releases` |
| Last commit | 2026-10-03 (Host-header and cross-site checks) | `/commits/main` |
| Maintainers | One lead (`Niko1221`), most commits co-authored by `claude` (AI-assisted), 8 other contributors seen (q8atnight, CC-David-CC, abhinand5, Efeisot, codebuff-team, yannickloth, sergiywith). Bus factor is effectively 1 | `/commits/main` |
| Tests | `serve/` has 8 `test_*.py` files (lifecycle, mcp, monitor, security, server, structured, detok, winjob); `tests/` has `core cuda hip platform` folders. No CI result seen | `serve/`, `tests/` |
| Runtime | C++ engine plus a Python (3.10+) server and `chat.py`; CUDA (RTX 20 to 50) and HIP (Radeon 7000/9000); Windows and Linux only, no macOS | README, MCP_SERVER.md |
| Install | `START-HERE.bat` or `./setup.sh`, 70 GB model download (up to 111 GB), 1+ hour, may install Python and build tools, compiles on some AMD/NVIDIA setups (10 to 40 min) | AI_SETUP.md l.103-133 |

## 2. Licence and what we may take

| Question | Answer |
|---|---|
| Strata licence | MIT (README l.231; `LICENSE`). Parts and models carry their own licences "as documented in referenced files" (not read) |
| Run it as a separate program over HTTP | Allowed. Same standing as llama-server today. No AGPL or sole-copyright effect, since nothing is linked or copied |
| Link it or copy snippets | MIT permits it, but our "download, don't vendor" rule and the AGPL sole-ownership claim make it a bad fit: copied code would need MIT notices kept. **Do not copy.** Ideas and published numbers are free |
| Model licence | **Not verified.** Qwen3.8-Flash-Next licence text, plus the third-party quants (ISTA-DASLab, UkisAI "Swift 1.5", Unsloth, OrcaRouter "Uncensored") each have their own. Needs a read of `MODELS.md` links and the Hugging Face cards before it enters the model catalog |

## 3. Pieces, with verdicts

| Piece | What it does | Home today or designed | Verdict | Reason |
|---|---|---|---|---|
| Whole engine as a Stack runner | 125B MoE on a 12 GB card via expert split | Stack runs llama-server b10797 and mlx-serve; no gaming-PC tier (`hardware-tiers-2026-09-23.md`) | ADOPT AS-IS later, behind a trial | Only if the MSI hub has a 12 GB+ card. Allowed by rule 11 if the Stack installs, pins and tests it |
| Expert placement by use: hot experts in VRAM, all in RAM, CPU the rest, "every extra GB holds ~700 experts" | Sizing rule for MoE | Stack sizing chooses by fit (`fit-verdict-ui-2026-09-30.md`) | ADAPT THE IDEA | llama.cpp already has `--n-cpu-moe` and `-ot` tensor overrides; the Stack can set them from VRAM. Reuse check: use llama.cpp flags, build nothing |
| KV cache spills to RAM past 64K tokens | Keeps context large on small VRAM | Rule 4 (window is the real context) | ADAPT THE IDEA | llama.cpp has `--no-kv-offload` and `--cache-type-k/v`; a sizing input only |
| `--kv q4_0` on tensor cores (v0.1.38) | Quantised KV | Same flags in llama.cpp | ADAPT THE IDEA | Check quality per rule 3 before any default |
| Speculative decoding: MTP layer drafts 3 tokens, prompt lookup up to 5; 1.6 to 1.8x vendor claim | Faster decode | Not used | ADAPT THE IDEA | llama.cpp has `--spec-type ngram-*` and draft models; trial on our engine, mark gain as vendor claim |
| Quant formats Q2_0, IQ2_XS, IQ3_XXS, IQ3_S, UD-Q4_K_XL | Smaller weights | GGUF catalog (`modelCatalog.ts`, rule 3) | SKIP as a feature | IQ quants exist in llama.cpp. 2-bit quality for a child-facing chat is unmeasured (rule 8) |
| Image input via `strata-vision` subprocess | Picture understanding | `vision` role designed (`hardware-tiers-2026-09-23.md` section 3, Qwen3-VL) | SKIP | We already designed the role on our own model |
| OpenAI and Anthropic API, `/slots`, `id_slot`, reused-token reporting | Wire compatibility, cache reuse | Rule 2 and rule 4 depend on `/tokenize`, `/apply-template`, `id_slot` | Needs a test | Reader saw `/slots`, `id_slot`, and "implied" `/tokenize` and `/apply-template`. Not confirmed by source. Gate for any adoption |
| Tools and reasoning via API | `tool_choice auto`, `reasoning_effort`, `reasoning_budget_tokens` | Rule 1, rule 2 (reasoning split from engine) | Needs a test | Its own tool loop is only on when the request sets `strata_mcp: true`; we never send that. Plain tool_calls and `reasoning_content` streaming **not verified** |
| Setup MCP server (`strata_status`, `_install`, `_start`, `_stop`, `_logs`, `_models`) | AI agent installs the engine | Stack owns install; connectors are Home child processes (tools design H1) | SKIP | The Stack installs engines, not an LLM agent. Do not expose it |
| `telemetry.py` Monitor tab | Local GPU, CPU, RAM, disk samples, 60 points | Status page and Stack health (`status-page-2026-09-30.md`) | ADAPT THE IDEA | NVML and AMD sysfs are the right local sources for a Windows hub's Stack probe |
| Host-header check, cross-site refusal, API-key CORS | DNS rebinding and browser abuse guards | Loopback calls in Stack client | ADAPT THE IDEA | Confirms we should check Host on any LAN-facing engine port |
| Community benchmark template (`bench/results/`, 3 runs, median and range) | Benchmark format | CHAT-AB-01 (rule 13) | ADAPT THE IDEA | Use its fields in our bench report |
| `Dockerfile`, `update.sh`, `UPDATE.bat` | Self-update | Stack updates own components | SKIP | The Stack pins and tests; no self-updater |

## 4. Security and privacy

| Item | Finding | Severity |
|---|---|---|
| Telemetry | `serve/telemetry.py` is local only, no network calls (reader's reading, l.185-186) | Low |
| Outbound | Image input fetches any `http(s)://` URL with `urllib.request.urlopen`, 60 s timeout, and accepts local file paths (server.py, Outbound section) | **Medium**: SSRF and local-file read if reachable by a child or a page-driven prompt. Home would not forward URLs |
| Install scripts | `START-HERE.bat` and `setup.sh` run sudo package installs, compile code, download 70 to 111 GB from Hugging Face | Medium: the Stack would need its own pinned installer, not these scripts |
| Dependencies | `requirements.txt`, `setup.py`: pins **not read** | Unknown |
| Model variants | "Uncensored" IQ3_XXS from OrcaRouter listed in the README quant set | **High for a house with children**: rule 0 means it must never enter the catalog |
| Web UI | Serves a chat and Monitor UI on port 8080 | Low if the Stack never exposes it |
| Network | Default `127.0.0.1`; API key needed for non-loopback (AI_SETUP.md l.13-28); Host-check added 2026-10-03 after the fact, so earlier releases lacked it | Low to medium |
| Secrets | None seen; no scan was run | Unverified |
| Children's data | No data leaves the PC by its claim | Low |
| AI-assisted commits | Most recent commits co-authored by `claude`; ten releases in four days | Process risk: fast, little review evidence |

## 5. Recommendation

Top 3 pieces to use first:

1. **Expert-offload sizing** as a Stack fit rule using llama.cpp's existing MoE flags (S).
2. **Speculative decoding trial** with llama.cpp ngram or draft modes on our current models, measured per rule 3 (S).
3. **Hardware probe ideas** (NVML and sysfs sampling, Host-header guard) for a Windows/Linux hub profile (S).

Smallest first slice: put the MSI hub's real GPU, VRAM and RAM in front of the owner; if it has a 12 GB+ NVIDIA card and
64 GB RAM, run one bounded Strata trial on that machine through the Stack with `/tokenize`, `/apply-template`,
`id_slot`, streaming tool_calls and `reasoning_content` as pass/fail checks, then CHAT-AB-01 on written adult chat.
Effort: first slice S (about one day with the machine); a supported Stack runner (installer, pin, health probe, catalog
record, minor fail-safe) is M to L.

## 6. Conflicts for the owner to decide

| Conflict | Detail |
|---|---|
| Rule 11 | Allowed only if the Stack installs, pins and tests it. Strata's own `setup.bat`, MCP installer and updater would not be used |
| Rule 2 and rule 8 | One-model-family engine; API parity with llama-server is unproven. A 2-bit 125B model has no measured record, so a minor would stay on the no-tools fail-safe |
| Rule 0 | The "Uncensored" quant must be excluded by catalog, not by setting |
| Tier design | No gaming-PC tier exists; the 16 GB two-card laptop (tier 2) and 32 GB RAM machines fit only the Coder variant. The M4 Pro dev machine cannot run it, so no day-to-day dev use |
| Bus factor | One maintainer plus an AI co-author, 10 releases in 4 days. A pinned commit with our own tests is the only safe way |
| Principle 6 | Using it means a second engine to own; the cheaper path is copying its settings into llama.cpp flags we already control |

## Not verified

Source line numbers (summariser output), the model licence, tool_calls and `reasoning_content` behaviour, `/tokenize` and
`/apply-template` existence, `requirements.txt` pins, CI state, issue contents, any speed or quality comparison with
llama.cpp on the same card. All speed figures (RTX 5070 Q2_0 94 tok/s, IQ3_S 53 tok/s; RX 9070 XT Q2_0 60 tok/s;
1.6 to 1.8x from drafting) are vendor claims from README l.32-42, none reproduced.
