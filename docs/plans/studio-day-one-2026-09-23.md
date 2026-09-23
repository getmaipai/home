# Studio day one: the prework, the runbook, and the Studio as a lane (2026-09-23)

For Jesse. The owner questions are numbered at the end.

## Why this exists

A month of lead time is prework time. Everything that can be staged,
scripted and dry-run now is done now, so the day the Studio arrives it
downloads nothing large, runs an ordered runbook whose every step has a
check, and evaluates its own configuration by itself. And the Studio's
own model is a lane, not only a product: once it serves the household,
it also takes the S and M coding items, the benches and second reviews
that today spend the Claude subscription, with the lessons of the
laptop's lane designed out rather than repeated.

## 1. Staged now, so day one downloads nothing large

The Stack fetches engines and models by pinned URL and sha256
(`stack/backend/src/lib/download.ts`) into its own store
(`data/models` with a manifest per model and a Hugging Face cache
layout). The staging kit is that store's contents, built on this Mac
onto an external drive, verified by the same code path, and copied into
place on day one.

| Item | Form | Size | Note |
|---|---|---|---|
| llama-server b10797, macOS arm64 | the pinned archive (`engineCatalog.ts`) | small | already under `data/engines` on this Mac |
| Qwen3.8-27B | GGUF at Q6 for llama-server, the official repository at a pinned revision | about 22 GB `(?)` | MEASURE-02's first Studio candidate |
| Qwen3.6-35B-A3B | GGUF at Q6, pinned | about 29 GB `(?)` | the second candidate |
| Qwen3.8-27B-Splash | Splash's package (4-bit, with its DFlash 2 draft and the vision encoder) | 17.4 GB | Splash ships 4-bit only; both quantizations are measured (decision 4) |
| Qwen3.6-35B-A3B-Splash | the same | 20.9 GB | |
| Qwen3.8-27B and Qwen3.6-35B-A3B, MLX format | the MLX-community conversions at pinned revisions, for oMLX and mlx-serve | about 15 and 20 GB at 4-bit `(?)` | the engine set is measured, not assumed |
| Splash itself | `brew install incoai/tap/splash` | small | Homebrew needs the network on day one; the one allowed download, small, and its formula revision recorded |
| Bun, uv, sherpa-onnx assets, the embedder, the judge 4B, Pocket TTS | the pins the installer and the Stack already carry | a few GB | already on this Mac; copied, not re-fetched |

Two facts checked on 2026-09-23: Splash requires "Apple M3 or newer,
macOS 26.4 or later, Homebrew, and 36 GB of unified memory" (its
README); this Mac reports macOS 27.0, and the Studio ships with 26.4
(decision 1), so the floor is met on day one. Splash's README documents downloading models on first
run and says nothing about pre-downloading a package or running
offline; its packages go to the Hugging Face cache, so the staging kit
pre-seeds that cache and the dry run proves whether `splash serve`
honours it without a network (if it does not, the two Splash packages
are the day's only large download, and the record says so).

`scripts/studio/stage.sh`: fetches each item by its pinned URL, verifies
its sha256 through the Stack's own download code, writes the store
layout and a `STAGE.md` with every hash and size; `stage.sh --verify`
re-hashes the drive. Row: `STUDIO-STAGE-01` (M).

## 2. The runbook, unboxing to the acceptance workload

Target: under two hours of wall time from power-on to the tier
acceptance workload's report, most of it copying. Every scriptable step
is dry-run on this Mac now (`scripts/install.sh --dry-run` exists; the
rest gain the same flag).

| Step | Command | Check |
|---|---|---|
| 1. macOS and account | Settings: the household's own account, FileVault on, automatic login off, sleep never for the desktop | `sw_vers` reads 26.4 (decision 1); `sysctl hw.memsize` reads 128 GB |
| 2. Homebrew, Bun, uv | the installer's own `ensure_bun`; `brew install incoai/tap/splash` | `bun --version` matches the pin; `splash --version` |
| 3. Copy the staging kit | `scripts/studio/stage.sh --install /Volumes/<drive>` | `stage.sh --verify` green on the copy |
| 4. Install Home and the Stack | `bash scripts/install.sh` (the tagged release, the Stack at `STACK_TAG`) | the launchd services up; `curl localhost:3000/health` and the Stack's health both ok |
| 5. The Stack sizes the machine | automatic at start | the hardware route proposes `p128`; the components inventory lists every staged model as present, nothing to download |
| 6. Restore the household | the backup restore per BACKUPS.md from this Mac's latest backup | the people, memories and conversations present; the restore's own verification passes |
| 7. Offline proof | `OFFLINE-TEST-01`'s test against the running hub | one full turn with egress denied; the websearch turn fails honestly |
| 8. The engine contract | `ENGINE-CONTRACT-01`'s suite against llama-server and against Splash | both tables written; a failure names the engine and the check |
| 9. The evaluation run | `scripts/studio/evaluate.sh` (section 3) | the tables in `data-bench/<timestamp>/` and the summary rows into dev.md |
| 10. The acceptance workload | part of step 9 | the tier 3 limits declared once from the numbers |
| 11. The switch | Home's roles pointed at the Studio's engines from this Mac (section 5), then Home itself moves | the family chats on the Studio; this Mac's hub stopped |

Row: `STUDIO-RUNBOOK-01` (M): the runbook as a checked document plus the
`--dry-run` flags, every scriptable step run on this Mac and its output
recorded.

## 3. The Studio evaluates its own configuration

One scripted run, `scripts/studio/evaluate.sh`, chains what already
exists and writes tables, so a Claude session reads tables and never
babysits: the Stack's Studio bench protocol (`stack/scripts/bench/
studio-bench.sh`, STACK-74: load time, first token, tokens per second,
footprint per pinned model); ENGINE-CONTRACT-01's suite per engine, and the engine set is four:
llama-server at b10797, oMLX, mlx-serve and Splash at their pinned
revisions (the 2026-09-17 survey adopted oMLX as the MLX language-engine
candidate measured on the same bench, and the Stack's chat engine setting
already names mlx-serve), each through the same contract suite, the same
MEASURE-02 rows and the same acceptance workload; ENGINE-SPLASH-01's
comparison on the two candidates; MEASURE-02's rows for each candidate
(tool-calling at ten repeats, the inverse miss, query rewrite, latency
cold and warm at 32K with the effective rate, the end-to-end search
success centrepiece), llama-server run with the model's MTP head on; STUDIO-ACCEPT-01's workload
(two conversations with speech, a photo turn, a picture job). Each
bench already writes a report; the script runs them in order on a
scratch data directory, collects the summary rows into one
`report.md` in the protocol's own shape, and appends the summary rows to
dev.md "Measured so far". The verdict on the Studio's chat model and
engine is then a reading of tables: the candidate and engine that pass
the contract suite, clear the tool-calling bars, and give the best first
useful answer under the workload, with the budget record filled from the
numbers, never by a headline claim (Inco's own table puts oMLX at about
half Splash's decode speed on the 27B; that is Inco's number, a claim to
measure). An engine that loses on chat keeps the role it is best at:
oMLX its SSD prefix cache for long companion contexts, mlx-serve the
media roles. Row: `STUDIO-EVAL-01` (M).

**What the hands-on review adds (the owner's saved transcript,
`data-scratch/splash/transcript-qwen38-27b-2x-faster-on-mac.txt`, a
hands-on video review read 2026-09-23; every number in it is a claim to
measure, never our record).** Four things change the evaluation and one
changes the staging. (1) The reviewer's reading of Inco's own
methodology: Splash's headline "2x" is speculative decoding (its DFlash 2
draft, about 1.2 GB, proposing about seven tokens a step with three to
four surviving) measured against oMLX without a draft model on a
draft-friendly coding workload with reasoning on; the memory-bandwidth
ceiling (about 20 tokens per second for a 15 GB model on 307 GB per
second) is what a draft beats. So the baseline we compare Splash against
is llama-server at our pin with Qwen3.8-27B's own multi-token-prediction
head turned on (the model ships it; the laptop's lane already runs MTP
on; the review cites community gains of 23 to 30 percent), at draft
depth two and three, never plain autoregressive decoding, or we repeat
the comparison the review takes apart. (2) Prefill dominates: the
reviewer cites Inco's own 96 seconds to first token on a cold 32,000-token
prompt (oMLX 317 s) against 282 milliseconds warm, and an effective rate
across the whole response of about 9 tokens per second cold against 53
warm. The evaluation therefore measures every candidate cold and warm at
32K, reports the effective rate from send to last token, and the
acceptance workload's "first useful answer" is recorded cold and warm;
this is the same finding as LAT-00 to LAT-03 on the 8B, and it is why
the stable tool set and the prefix cache matter more than decode. (3)
A concurrency claim to test, 16 concurrent 32K requests on 48 GB where
general policies held nine, against the workload's two conversations
with speech. (4) A failure mode to test: Splash prints a memory report
and refuses to boot when the model will not fit, which is a second
admission beside the Stack's governor; the evaluation records what each
says on the same machine and the design keeps one authority (the
governor admits, Splash's report is logged as the engine's reason). And
for staging: the reviewer confirms the package is proprietary (4-bit
weights, the vision encoder and the draft in one 17.4 GB file that only
Splash loads), so the GGUF cannot be reused and both forms are staged on
purpose; and the reviewer's "one config line" for Claude Code, Codex and
OpenCode is a claim `splash claude` proves on day one, as above. The
pinned execution configuration gains the speculative-decoding settings
(draft model or MTP head, draft depth) beside the thinking settings.

## 4. The Studio as a coding lane

What the laptop's lane taught (Session C: one OpenCode session driven
over its HTTP API by the coordinator, S briefs in their own worktree,
commit only, never push): the 27B did S items at about Sonnet's output
and twice the time; a step cap kept firing on the items that needed
reading before writing; a shared session's context bled between briefs;
the eGPU dropped off its bus. The Studio's lane keeps what worked and
designs the rest out:

- **The clients.** OpenCode against the Studio's engine, and Claude Code
  through Splash's Anthropic Messages endpoint. Verified in Splash's
  README on 2026-09-23: "Splash speaks OpenAI Chat Completions
  (`/v1/chat/completions`), OpenAI Responses (`/v1/responses`), and
  Anthropic Messages (`/v1/messages`)", and its launcher line
  `splash opencode    # or: splash claude / splash codex / splash hermes`.
  The README never names "Claude Code" and never documents a base-URL
  setting, so `splash claude` is proven on day one before anything is
  routed to it, and OpenCode is the lane until it is.
- **No step cap; a wall-clock budget and a done contract.** The cap
  fired because reading a large file consumed steps that were never the
  work. A brief carries a wall-clock budget (three times a reference
  run) and the reporting contract (ready, done, blocked, question); the
  driver stops a run at the budget, never at a count, and a run that
  ends without a done report is a blocked report, never a retry.
- **A fresh session and a fresh worktree per brief**, created by the
  driver at the base the coordinator names, deleted after the report is
  read; no session is ever reused between briefs, so nothing bleeds.
- **The tool set is the brief's**: read, edit, the named test commands,
  `git add <file>` and `git commit`; never push, never a second repo,
  never an install.
- **What moves to the lane:** S and M coding items with a precise brief,
  second reviews of a lane's diff (a review from a different model than
  the one that wrote it), the benches and their reruns, docs
  regeneration. **What stays on the subscription:** design records and
  verdicts, diagnosis of a hard problem, anything spanning subsystems,
  the reading of done reports against acceptance, and the first review
  of a safety, consent or privacy change.
- **The driver** is the coordinator's existing OpenCode HTTP driver,
  pointed at the Studio, with the budget and the fresh-session rule
  added. Row: `STUDIO-LANE-01` (M). The model is decided by
STUDIO-EVAL-01's numbers between the 27B and the 35B-A3B (decision 3).

## 5. The Studio beside this Mac during the move, and the rollback

The Stack's URL tier already lets a role point at an engine that is
already running elsewhere. Day one, before Home moves: this Mac's Home
points its `chat`, `embed` and `judge` roles at the Studio's engines
over the LAN (in-house, the privacy page's row unchanged), and the
family uses the Studio's model from the hub they already have. When the
runbook's step 11 moves Home itself, the Studio's hub restores from this
Mac's last backup and this Mac's hub is stopped, not deleted. Rollback
at any point: repoint the URLs back to this Mac's engines, or start this
Mac's hub again on its own data directory, which was never touched. The
laptop stays as the tier 2 bench machine and the lane until
STUDIO-LANE-01 takes over (decision 2). Row: `STUDIO-MOVE-01` (S).

## Rows (a new area, "Studio day one (2026-09-23)")

| Row | Size | What it is |
|---|---|---|
| `STUDIO-STAGE-01` | M | the staging kit and `stage.sh` (fetch, verify, `STAGE.md`), the Splash cache pre-seed proven or recorded as not possible |
| `STUDIO-RUNBOOK-01` | M | the eleven steps with commands and checks, the `--dry-run` flags, every scriptable step run on this Mac now |
| `STUDIO-EVAL-01` | M | `evaluate.sh` chaining the Stack bench, the contract suite, ENGINE-SPLASH-01, MEASURE-02 and the workload into one report |
| `STUDIO-LANE-01` | M | the lane driver on the Studio: fresh session and worktree per brief, wall-clock budget, done contract, the tool set, `splash claude` proven |
| `STUDIO-MOVE-01` | S | the URL-tier switch first, then the move and the rollback |

## Decisions (owner, 2026-09-23)

1. The Studio ships with macOS 26.4, so Splash's floor is met on day one
   and the staging row carries no macOS contingency.
2. The Linux laptop is kept as the tier 2 bench machine. This reverses
   the 2026-09-17 decision to sell it after the move. Its role: the tier
   2 limits (the 16 GB CUDA reference point), FLOOR-ACCEPT-01's stand-in
   only until an 8 GB machine is on the bench, and the Session C lane
   until STUDIO-LANE-01 takes over.
3. The coding lane's model is decided by STUDIO-EVAL-01's numbers
   between the 27B and the 35B-A3B.
4. Both quantizations are measured, Splash's 4-bit package and
   llama-server at Q6, and the numbers decide.
