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
| Qwen3.8-27B-Splash | Splash's package (4-bit, with its DFlash 2 draft and the vision encoder) | 17.4 GB | Splash ships 4-bit only; question 4 |
| Qwen3.6-35B-A3B-Splash | the same | 20.9 GB | |
| Splash itself | `brew install incoai/tap/splash` | small | Homebrew needs the network on day one; the one allowed download, small, and its formula revision recorded |
| Bun, uv, sherpa-onnx assets, the embedder, the judge 4B, Pocket TTS | the pins the installer and the Stack already carry | a few GB | already on this Mac; copied, not re-fetched |

Two facts checked on 2026-09-23: Splash requires "Apple M3 or newer,
macOS 26.4 or later, Homebrew, and 36 GB of unified memory" (its
README); this Mac reports macOS 27.0, and the Studio's shipped version
is question 1. Splash's README documents downloading models on first
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
| 1. macOS and account | Settings: the household's own account, FileVault on, automatic login off, sleep never for the desktop | `sw_vers` at or above 26.4; `sysctl hw.memsize` reads 128 GB |
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
footprint per pinned model); ENGINE-CONTRACT-01's suite per engine
(llama-server at b10797, Splash at its formula revision); ENGINE-SPLASH-01's
comparison on the two candidates; MEASURE-02's rows for each candidate
(tool-calling at ten repeats, the inverse miss, query rewrite, latency,
the end-to-end search success centrepiece); STUDIO-ACCEPT-01's workload
(two conversations with speech, a photo turn, a picture job). Each
bench already writes a report; the script runs them in order on a
scratch data directory, collects the summary rows into one
`report.md` in the protocol's own shape, and appends the summary rows to
dev.md "Measured so far". The verdict on the Studio's chat model and
engine is then a reading of tables: the candidate that passes the
contract suite, clears the tool-calling bars, and gives the best first
useful answer under the workload, with its budget record filled from the
numbers. Row: `STUDIO-EVAL-01` (M).

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
  added. Row: `STUDIO-LANE-01` (M). The model is question 3.

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
laptop's role is question 2. Row: `STUDIO-MOVE-01` (S).

## Rows (a new area, "Studio day one (2026-09-23)")

| Row | Size | What it is |
|---|---|---|
| `STUDIO-STAGE-01` | M | the staging kit and `stage.sh` (fetch, verify, `STAGE.md`), the Splash cache pre-seed proven or recorded as not possible |
| `STUDIO-RUNBOOK-01` | M | the eleven steps with commands and checks, the `--dry-run` flags, every scriptable step run on this Mac now |
| `STUDIO-EVAL-01` | M | `evaluate.sh` chaining the Stack bench, the contract suite, ENGINE-SPLASH-01, MEASURE-02 and the workload into one report |
| `STUDIO-LANE-01` | M | the lane driver on the Studio: fresh session and worktree per brief, wall-clock budget, done contract, the tool set, `splash claude` proven |
| `STUDIO-MOVE-01` | S | the URL-tier switch first, then the move and the rollback |

## Questions for Jesse

1. Which macOS version the Studio arrives with; Splash needs 26.4 or
   later, and an update before step 2 is the alternative.
2. The Linux laptop: kept as the tier 2 bench machine (the 16 GB CUDA
   reference point needs one), or sold after the move as decided on
   2026-09-17.
3. The coding lane's model: the 27B (Sonnet-class on S items, measured)
   or the 35B-A3B (faster per token, unmeasured on coding), decided by
   STUDIO-EVAL-01's numbers or by you now.
4. Splash packages are 4-bit only while MEASURE-02 names Q6 for
   llama-server: measure both and let the numbers decide (my
   recommendation), or standardize on one quantization.
