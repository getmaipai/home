# Workload isolation: chat and voice always win (2026-10-18)

Jesse's question (2026-10-18), after a video job ran on the live Stack while his chat turn was in flight and the turn then hit a
timer: "We cannot have chats and other things from one user mixing with another. Don't we have boundaries? Do we need a design?"

Backlog rows: ISOLATION-01 to -06 (not started, queued after MUSIC-GEN). Related: the reliability note's
[prevention table](reliability-2026-10-17.md#prevention-ranked), items 4 (Home credential) and 7 (admission priorities), which
this note measures and sharpens; it does not replace them. Video, picture and music designs:
[video](video-generation-2026-10-17.md), [image engine](image-engine-2026-10-17.md), [music](music-generation-2026-10-17.md).

## Answer

Yes, a design is needed, and the gap is narrower than "no boundaries". The boundaries that exist protect **memory** and **who
sees whose job**. Nothing protects **speed**: the Stack has no idea a chat turn is in flight, so a video, a picture or a second
person's chat takes GPU time from the turn that is streaming. Measured on this Mac Studio (below), a video decode cuts chat to
45 percent of its speed for the 2 to 4 minutes it runs, and the denoise step cuts it to 25 percent. A 1500-token reply that takes
62 s alone takes 130 to 250 s beside a clip, which is how a turn crosses a 60 s timer. The chat model itself was never starved of
memory and no deadline in `budget.ts` (first token 90 s) was reached by the slowdown alone.

The fix needs no worker changes: the Stack already proxies every chat and voice request, so it can pause the one running heavy
worker (SIGSTOP) for exactly the time a chat or voice request is in flight, and resume it (SIGCONT) after. Measured: with the
video worker stopped mid-decode, chat returned to baseline (1.63 s first token, 24 tokens/s) on all three turns, and the clip
moved again 1.7 s after the resume.

## 1. What is protected today, and what is not

Evidence is the code at Stack `e7d7849` and Home `96d25e53`, and the measurements in section 2.

### Inventory

| Boundary | What it does | Where |
|---|---|---|
| One heavy job at a time, household wide | The governor admits one `generator` kind item at a time across picture, video and music (`canAdmit`: `generatorBusy`). A second heavy job waits in the governor queue (max 4) | Stack `lib/governor.ts` |
| One job in flight per role, FIFO | `image`, `video`, `music` each have a queue and one in flight; a submit past 4 waiting is `429 queue_full` for everyone | Stack `lib/jobs.ts` (`queues`, `inFlight`), `*_QUEUE_MAX = 4` |
| Admission by peak memory | A job starts only if its peak (video 44.1 GB measured, music 33 GB declared) fits under the model budget and free memory minus the tier margin (20 GB on p128) stays above zero; a job that can never fit is refused with numbers; a wait longer than 180 s fails as `no_memory`. Seen live: a clip sat "waiting for memory (1 ahead): needs about 41.1 GB, 58.6 GB available" because other processes held memory | `governor.ts`, `jobs.ts` `admitJob`, `memoryState.ts` |
| Memory watchdog ladder | WARN: refuse new heavy work, cancel queued heavy jobs, stop idle picture, video, music and tool workers and the idle voice engine. CRITICAL: cancel the running heavy job (video first), evict the judge role, restart chat only after 60 s of critical. It acts on memory, never on speed | `lib/memoryWatchdog.ts` |
| Kernel pressure abort | At kernel `critical` the governor aborts a running generator | `governor.ts` poll |
| Resident models stay | chat, coding, judge, router, embed, stt, tts are `resident`; image, video, music, vision are `jit` and are evicted when idle (10 min) or under pressure | `roles.ts`, governor |
| Job ownership in Home | A video job row carries `personId`, conversation and turn. Only the owner reads it (`getVideoJobFor`, "a parent included"); pictures are filtered by actor the same way; cancel is the owner's. A job belongs to a person and a conversation, not to a device | Home `lib/videos/jobs.ts`, `lib/pictures/jobs.ts` |
| Per-person caps | One video at a time per person (`already_making`). A child has a daily limit (20 pictures, 5 videos by default) and a lane that forces Quick | Home `activeVideoJobsFor`, `lib/pictures/lane.ts` |
| Background text work yields to a turn | `turnActiveWithin()` (the turn lease) gates the memory judge, the canary, the shelf poller and news prefetch while a turn is in flight | Home `lib/turnActivity.ts` and its four callers |
| Media lane | ffmpeg, probes and fetches run niced, one at a time | Stack `media/run.ts` |

### What is NOT protected

1. **Chat speed against any heavy job.** No signal, priority or yield exists between a chat request and a running video, picture
   or music worker. The turn lease gates only the judge, canary, shelf and news work; `lib/videos` and `lib/pictures` never ask
   it. The workers run at default CPU priority (only the media lane is niced), and Metal has no per-process GPU priority for
   MLX, so the OS time-slices them.
2. **A job already running when a turn starts.** Nothing can slow or stop it short of the memory watchdog's cancel, which fires
   on memory, not on a waiting person.
3. **Voice** (tts, stt) has the same exposure as chat. The watchdog also unloads idle voice at WARN.
4. **Two people's chats against each other.** Both reach one llama-server. Measured: they run in parallel (section 2d), each at
   about 80 percent speed and 0.4 to 1.4 s slower to first token. This is tolerable, but there is no fairness or cap.
5. **Fairness across people for heavy jobs.** The Stack queue is FIFO per role and has no notion of a person. Home limits one
   video per person but a second `generate` picture is not blocked by `busy` (it blocks only edits), and nothing limits a person
   across kinds (a video, plus pictures, plus later a song). Four jobs of one kind from any mix of people fill the Stack's queue,
   and the fifth person gets "a full line". An adult has no daily cap. The queued job card says "It will start in a minute"
   whatever the queue holds (a clip takes 140 s alone).
6. **Who may submit to the Stack at all.** `app.ts`: "loopback is the whole authentication". Any process of any user on this
   Mac can POST a job or DELETE someone's job, and a job id is the only handle. Checked on the scratch Stack (same binary as
   live): a request with `Host: evil.example` is answered normally (no Host check, so DNS rebinding from a web page is
   possible), and a CORS preflight gets a bare 404 (so a plain cross-origin POST from a page is blocked, GET is not).
   Reliability item 4 proposes a Home credential but leaves `/v1/*` generation calls open; those are exactly the calls that
   start jobs, so slice ISOLATION-04 closes them too.
7. **The Stack does not know people, by design** (Stack AGENTS.md: "the moment something needs to know who is asking, it belongs
   to Home"). So per-person rules live in Home; the Stack gets only a priority rule that needs no identity.

## 2. Measurements

Machine: Mac Studio, M5 Max, 128 GB. A scratch Stack (the live binary at `/usr/local/maipai-home/stack`, its own data dir, port
18870, a read-only copy of `stack.db`, models and engines linked from the live store). It ran the same chat model and flags as
live (`muse-glimmer-30b-q4-k-xl`, llama-server b10797, 131072 context, q8 KV, `--reasoning off`). Nothing was sent to the live
Stack except read-only GETs. Each scenario held `/private/tmp/claude-501/bench.lock` for its run only. The chat request: an
870-token prompt with a fresh nonce at the front (no prompt cache hit), `max_tokens` 100, temperature 0, streamed; first token
is the first streamed delta; tokens per second is llama-server's own `predicted_per_second`. Other sessions were using the
machine, so absolute numbers carry some noise; the baseline repeated within 4 percent. Method: a bun script that submits the
job, polls the job phase, and runs chat turns back to back, tagging each with the phase it started in.

| Scenario | First token | Tokens/s | Of baseline |
|---|---|---|---|
| **Baseline**, chat alone (5 runs) | 1.63 s | 24.2 | 100 percent |
| (a) video, loading and denoise (about 12 to 17 s per clip) | 2.0 to 3.9 s | 6.0 to 13.3 | 25 to 55 percent |
| (a) video, decode (125 s alone, 33 turns) | median 2.39 s (1.84 to 2.72) | median 11.3 (10.3 to 21.6) | 47 percent |
| (b) picture 1024x1024, 4 steps, 4 pictures (5 turns) | 2.7 to 3.2 s | 7.7 to 12.2 | 32 to 50 percent |
| (c) music | not installed on this machine (11.5 GB download); not measured | | |
| (d) a second chat turn at the same time (4 runs, B starts 1.2 s after A) | A 3.0 s, B 2.0 s | A 19.9, B 18.8 | about 80 percent each |
| Video decode with the worker **stopped** (3 turns) | 1.63 s | 24.0 to 24.2 | 100 percent |

The cost goes both ways. The same clip took 140 s alone, 196 s with a chat turn running back to back, and 258 s on the first
(cold) run. Pictures are short: four took 31 s alone and 27 to 37 s beside chat (inside the noise). Prefill is hit as hard as
decode: the 870-token prompt took 1.5 s alone and 2.1 s (decode) to 3.2 s (denoise) beside a clip.

What this says:

- The harm is real and large for a long reply, mild for a short one. At the worst measured 6 tokens/s a 100-token answer takes
  17 s; a 1500-token adult reply takes 250 s.
- The video worker's decode phase is the long exposure (125 s of a 140 s job, 4 minutes when shared). Picture exposure is short
  (about 7 s per picture) but repeated.
- Two chats in parallel are fine. llama-server batches them (aggregate 38.7 tokens/s against 24.2 for one); the Home comment
  that the engine runs one slot and serializes every request is not true of this build with the Stack's flags. The Stack reports
  `slots: 1`; the engine behaved as several. Worth one line of follow-up in ISOLATION-06, not a design change.
- The worker can be stopped and resumed without losing work: a stopped worker held its 44 GB, the chat ran at full speed, the
  job finished correctly after 18 s stopped, and progress moved 1.7 s after the resume.

## 3. Design

### The policy, in plain rules

1. **Chat and voice are interactive and always win.** Interactive means any request through `chat`, `coding`, `vision`, `router`
   (the turn pipeline), `stt` and `tts`.
2. **Heavy background work** (video, music, pictures, image tools, and the memory judge and canary prewarm that already yield
   through the turn lease) runs only while no interactive request is in flight.
3. **Yield, do not cancel.** When an interactive request starts, the running heavy worker is paused; when the last one ends
   (plus a 4 s tail so the gaps between the rounds of one turn do not flap it), the worker resumes. Cancel is for memory
   (the watchdog) or for the person, never for a chat.
4. **A heavy job may start at any time.** A job that has not started yet waits in the queue; one that is running is paused, not
   refused. The person sees the existing job card say why.
5. **One heavy job at a time per household** (as today) **and one per person across all kinds** (new, Home).
6. **Fair order across people.** The next heavy job comes from the person who has waited longest without one running
   (round robin), not strict first come first served.
7. **Only Home may start or stop a job.**

### Options measured against the data

| Option | Verdict | Why |
|---|---|---|
| Serialize: hold a heavy job in the queue while a chat is in flight | Needed, not enough | Protects a turn that starts after the job is queued. Does nothing for the incident (a job already running). Keep as the start rule of rule 4. |
| Cap concurrency (one heavy per household, one per person) | Keep and extend | Already true per household. A person cap across kinds is a Home change (fairness). Does not protect chat: the single running job is what slowed it. |
| Time windows (heavy work only at night) | Reject as a default | Families make a clip at 5 pm. A pause rule gives the same protection without a schedule. An optional "Detailed video only 1 am to 6 am" setting can come later. |
| Yield points inside the workers | Feasible, not needed | The workers read stdin only between jobs, so they would need a reader thread plus a flag checked in `progress_tqdm` (video), the mflux step callback (picture) and the ACE-Step progress callback (music), plus the tile loop of the decode. Three workers to change and test, and loading and encoding phases are not covered. |
| Pause the worker process (SIGSTOP, SIGCONT) | **Recommended** | Measured: chat back to baseline, resume in 1.7 s, no worker change, covers every phase of every kind. The worker keeps its memory, so the governor and the watchdog accounting do not change. |
| A chat-active signal from Home | Optional second source | The Stack sees every request itself (`supervisor` already tracks `busy` per role), so it needs no header. A Home hint (`X-MaiPai-Turn: active`, from the turn lease) would also cover the seconds between model rounds of a tool turn; add only if the 4 s tail proves too short in the bench. |
| Refuse to start a heavy job within N s of a chat | Replace | The tail in rule 3 does this for running jobs; for a job that is waiting it is rule 4's start rule. |
| Fair queueing across people | Recommended, in Home | The Stack stays person-blind. Home holds the household heavy queue and hands the Stack one job at a time (or two), choosing round robin by person. |

### How the pause works

- The Stack counts interactive requests in flight (increment when the proxy forwards a chat, embed-for-turn, stt or tts request,
  decrement when the stream ends or aborts). Embeddings that Home sends for memory are not interactive; the role route knows
  which role was addressed.
- A `HeavyGate` in `lib/jobs.ts` holds the running generator's worker handle (the three engine classes already own the child
  process: `videoGen`, `imageGen`, `musicGen`). When the count goes from 0 to 1 it sends SIGSTOP to the worker's pid; when it
  returns to 0 for 4 s it sends SIGCONT.
- The job reports phase `paused: chat` (state stays `running`, `eta_seconds` unknown while paused). Home maps the phase to the
  card line "Waiting for chat to finish" through the existing job-card status (rule S6; no new banner).
- The job deadline (`VIDEO_DEADLINE_MS`, the worker handle's `deadlineMs`) must not run while paused: the deadline timer is
  paused and resumed with the process.
- Cancel while paused sends SIGCONT first, then the existing kill; the watchdog's cancel does the same. Shutdown sends SIGCONT
  before the quit message.
- A job whose chat never stops (a voice session all evening) stays paused. After 10 minutes paused the job card says "Still
  waiting; it continues when the chat is quiet" and the owner can cancel it. No duty-cycle rule in
  slice 1: the first goal is that chat is never slowed; any trade for the job is a later, measured decision.

### What a job that cannot start looks like

Queued with a reason and an estimate on the same card: "Waiting for chat to finish", "Waiting for memory", or "Next after
another video (about 2 minutes)". The estimate is the sum of the Stack's `eta_seconds` for the job ahead and a measured per-kind
typical time (video 140 s, picture 8 s per picture; music from its own bench). It replaces the fixed "in a minute" line.

### Who may submit

Reliability item 4 (a random token the installer writes into the Stack data directory and Home's credential store) becomes the
mechanism, with two changes made here: the token is required on every `POST` and `DELETE` including `/v1/*/generations` and
`/stack/v1/jobs` (not only the control routes), and the Stack rejects a `Host` header that is not `127.0.0.1:<port>` or
`localhost:<port>`, which closes DNS rebinding. Reads (`GET` status, health) stay open on loopback. The Stack stays person-blind;
Home maps its job to the person.

## 4. Implementation slices

| Row | Size | Repo | What | Tests |
|---|---|---|---|---|
| **ISOLATION-01** (highest) | M | Stack | Interactive request counter in the role proxy, the `HeavyGate` (pause, tail, resume), phase `paused: chat`, deadline excludes paused time, cancel and shutdown resume first | Unit with a scripted worker (a real child process: stopped state read from `ps`, resumed on the tail; cancel while paused; deadline not consumed; watchdog cancel while paused; counter returns to zero when a stream aborts). Bench acceptance: the section 2 harness, chat during video decode and during pictures at least 90 percent of baseline tokens/s |
| ISOLATION-02 | S | Stack | Start rule: a queued heavy job is not admitted while a chat request is in flight (it waits with reason `waiting for chat`); heavy worker load (a 44 GB page-in) does not start mid-turn | Governor and jobs tests: queued job admitted after the tail, never during a request |
| ISOLATION-03 | M | Home | Household heavy queue with one job per person across kinds, round robin by person, and the queue estimate; the card line "Waiting for chat to finish" and "Next after another video (about N minutes)" replace the fixed busy line | Home tests: two people interleave, one person cannot hold two, a child's daily cap still applies, estimates from the Stack's `eta_seconds` |
| ISOLATION-04 | M | Stack and Home | Home credential on every POST and DELETE (generation and control routes) and the Host check; extends reliability item 4 | Stack: a request without the token is 401 on every mutating route; Host `evil.example` is refused. Home: the client sends the token; the installer writes the 0600 file. Risky surface (credentials): full `check.sh`, `code-review` at medium |
| ISOLATION-05 | S | Home | Voice and the judge: never unload voice or the judge while a conversation was active in the last 5 minutes (reliability item 7, second half); judge and canary prewarm keep using the turn lease | Watchdog tests with a recent conversation |
| ISOLATION-06 | S | Stack | Keep the harness as `scripts/bench-isolation.ts` in the bench lane (`check.sh --bench`, on demand), with thresholds; record why the engine behaves as several slots while the Stack reports `slots: 1` | Bench lane only |

Order: 01 first (it protects the chat and needs nothing else), then 02, 03 and 04 in any order, 05 and 06 last. All after
MUSIC-GEN-03 and -06, because the music worker is the third kind that 01 must be proven on (pause a real ACE-Step run on the
Studio; music is not installed here, so it is unmeasured).

## 5. Risks

- **SIGSTOP of a worker with a GPU job in flight** was tested only on the video decode phase and for 18 s. Untested: the
  denoise phase, mflux, ACE-Step, and pauses of minutes. A Metal command buffer already submitted finishes on the GPU; a very
  long pause could trip the GPU watchdog on resume. Acceptance for 01 includes pause cycles of 5 s, 60 s and 10 min on each kind.
- **Starvation of a job** by constant chat. Accepted for slice 1 (chat wins); a visible state and the cancel button are the answer.
- **Stopped worker holds memory** (44 GB for video). A second heavy job is still refused; chat is unaffected. The watchdog's
  CRITICAL cancel must still work on a stopped process (SIGCONT, then kill).
- **Deadlines**: any timer that watches a worker (job deadline, "stalled" detection on missing progress) fires falsely during a
  pause unless it is paused with it. Tested explicitly.
- **Tool turns**: the gaps between the rounds of one turn can exceed the 4 s tail; the optional Home header covers them.
- **Platform**: SIGSTOP is POSIX, so the same rule works on the Linux robot hub; Windows has no equivalent in this form.
- **The measurements** came from a busy shared machine and one model; the harness is kept so the numbers can be redone.

## Architect verdict

Self-assessed, pending the `architect` agent's ruling: APPROVED. It adds no rule and breaks none (S6 status through the existing
job card, rule 5 no cap on adult chat is untouched, the Stack stays person-blind); the only governed edit is Home's job card
copy.
