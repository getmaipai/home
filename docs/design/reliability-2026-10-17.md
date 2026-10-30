# Reliability: watchdog, self-heal, health checks, canaries and prewarm (2026-10-17)

Jesse's question: why can he find in a minute that something is broken when the app does not know? The chat engine was dead for
1.5 hours unnoticed, chat answered "is cloudflare down right now" with "I won't guess" without searching, Conversation mode said
only "one sec", and picture and video sat paused for low memory unnoticed. He also asked for prewarming, because a canary that
sends a real request essentially warms the engine. This note is the one design for all of it. Backlog rows: CANARY-01 (checks,
schedule, identity, results, prewarm; this note's owner), SELFHEAL-01 (restart, backoff, circuit breaker, LaunchAgent, Home
watcher; the self-heal agent's).

## Answer

Six layers, each with one detection signal, one action and one place the person sees it, all through mechanisms that already
exist (Repairs items, the Status page, Notifications, the chat pause line). No new banner, no new status UI (rule S6; memory
note "Reuse status mechanisms"). The behavioural canary is the layer that was missing: every other layer checks that a process
is alive, none checks that the product still does what it promises.

## The layers

```
launchd (KeepAlive)            process dead            restart the Stack             Status: Stack down / back
  > Stack supervisor self-heal   engine exit / offline   classify, back off, restart   Repairs: "engine keeps stopping"
    > engine and role health     role state, memory      gate (install, update, GPU)  chat pause line, Status dots
      > behavioural canaries     wrong behaviour         one restart request, Repairs Repairs item per check, one Notification
        > Home-side watcher      Stack unreachable 2 min one admin Notification       Status: crash counts
          > admin surfaces       (all of the above)      Run checks now, Keep warm    Status row "Last checked ..."
```

| Layer | Detects | Acts | Person sees (existing mechanism) | Owner |
|---|---|---|---|---|
| 1 launchd watchdog | Stack process exit, non-zero | restarts it (KeepAlive SuccessfulExit=false, 30 s throttle) | Status page, chat pause line "restarting" | SELFHEAL-01 |
| 2 Stack supervisor self-heal | engine process exit; role offline with no process (20 s sweep) | classify cause, back off 2, 10, 30, 120 s, circuit opens on the 5th failure in 30 min or at once when retry cannot help | Repairs `engine.crashed.<role>`; open circuit: "The <role> engine keeps stopping" with Restart engine and the last 20 log lines | SELFHEAL-01 |
| 3 engine and role health | role state, memory level, identity | gate: waits while an install, engine update, GPU job, pause or memory level not normal is in force | chat pause line (CHAT-PAUSE-01), Status component dots | existing |
| 4 behavioural canaries | the product does the wrong thing with a live process | Repairs item per check after 2 failures in a row; one restart request for a dead chat with a live process | Repairs item with a plain cause and fix; one admin Notification per incident | CANARY-01 |
| 5 Home-side watcher | Stack unreachable more than 2 minutes | one admin Notification | Status crash counts | SELFHEAL-01 |
| 6 admin surfaces | everything above | Run checks now; Keep the AI warm switch | Status row "Last checked 3 minutes ago: chat, tools, search, voice, pictures" with pass or fail dots | CANARY-01 |

### Who owns what (agreed with the self-heal agent, 2026-10-17)

- SELFHEAL-01 owns restart, backoff, the circuit breaker, the crash classifier, `lib/selfHeal.ts`, the LaunchAgent and the Home
  watchers. The canary never calls `restartRole` (it resets the breaker). A failed `chat_hello` with a live process calls
  `requestEngineRestart(role, reason)` once per incident: it recycles the process, counts as one failure and goes through the
  same gate and backoff. It returns false when self-heal is off, the circuit is open or a retry is pending; the canary then
  only raises its Repairs item.
- CANARY-01 owns the checks, the schedule, the system identity, results, the Status row and prewarm.
- One periodic synthetic request source: the canary scheduler below. Self-heal adds none; its "healed" test (identity plus a
  one-token request) is event driven, not periodic.

## The canary suite

Runs the real pipeline (`runTurnNextStream` and the wire event generator `streamTurnEvents`, the same code the chat route
runs) as a built-in system identity, and asserts behaviour, never wording.

| Check | Assertion |
|---|---|
| `chat_hello` | "hi" answers with non-empty text; first token and total time recorded |
| `chat_tool_weather` | a `weather` tool call happens, the tool returns, spoken text follows |
| `chat_search_trigger` | "is cloudflare down right now" makes a `websearch` tool call before the answer, and an answer follows |
| `chat_picture_read` | a built-in tiny picture (a solid colour) is described; skipped when the chat role reads no pictures |
| `embed` | embedding returns a vector |
| `stt_tts_loopback` | TTS says a fixed phrase, STT hears it, at least 60 percent of the words match |
| `spoken_turn` | a `spoken: true` turn yields real answer text, not only a `spoken_cue` (the "one sec" regression) |
| `image_tiny` | one step, 256 px picture; on demand or daily; only under the GPU lock and with memory not low |
| `gpu_metal` | GPU-HEALTH-01: the Stack compiles one tiny shader (`GET /stack/v1/engines/gpu-health`) every 15 minutes, even with Keep the AI warm off (it wakes nothing). A failure asks the Stack, once per incident (retried on the next failure when load or a blocker held it back), to restart its own chat, image and video engines through the self-heal path; the second in a row raises the Repairs item "Pictures, video and chat are paused" (restart the Mac when nobody is using it) and sets the `gpu` cause on the image and video health rows, and on chat only while its own `chat_hello` also fails; a pass clears both |
| `video_tiny` | on demand only; follow-up row, not in the first build |

Dependent checks skip (not fail) when `chat_hello` fails because the engine is down, so one cause raises one Repairs item.

### Identity and privacy

A synthetic adult "health" actor that is not a row in `people`. Turns run with `temporary: true`: nothing is written to
conversations, memory, history, feed, search history, recent places or notifications (the temporary path keeps its turns in
process memory, and the canary discards its session after every check). Prompts are generic and contain no names. The fetch
cache is neither read nor written in a temporary turn, so the search canary is a real single-shot search, which is why it is
rationed. A test snapshots every table before and after a run and fails on any difference. Usage statistics and the family's
analytics read stored turns, so a turn that is never stored is excluded by construction. Results keep no text: a check keeps
pass or fail, duration, first-token time and a plain cause code (rule 6a).

### Results and Repairs

Per check: last result, duration and the last 50 results (in process, refilled by the post-start suite after a restart). A
check raises or clears one Repairs item (`source: canary`, `key: <check id>`) after 2 failures in a row (flapping guard) with a
plain cause and fix, for example "Chat is up but did not search the web when asked: it answered from memory. Check Settings,
Web search, then run the checks again." `raiseIssue` fires the single admin Notification per incident and `resolveIssue` the
recovery one, so no new notification type is needed.

## Prewarm

### What the machine showed (live Stack, read only, one request at a time)

Test: a streamed chat request with a 2.9k token system prompt and one tool, `max_tokens` 24, to the running Stack. The prompt
cache is real: the repeat request reported 2,890 of 2,892 prompt tokens cached, and a new question after the same prefix 2,048
cached (the cache works in blocks). Times:

| Request | Prompt cached | First token | Total |
|---|---|---|---|
| First use of a new prefix | 0 | 4.3 s | 5.7 s |
| Same prefix, repeated | 2,890 | 4.6 s | 6.0 s |
| Same prefix, new question | 2,048 | 3.2 s | 4.7 s |
| Earlier run (no reasoning events counted) | 0 then 2,890 | not measured | 6.8 s then 2.7 s |
| After 11 minutes idle, quiet machine, same prefix | 2,890 | 0.42 s | 1.7 s |
| Same, repeated and with a new question | 2,890 and 2,894 | 0.42 s and 0.42 s | 1.7 s and 1.7 s |

Reading: the cache saves prompt work (the earlier run shows 6.8 s to 2.7 s total), but in this run the first token barely moved
because the model streams reasoning first and another session was using the same engine (the engine process sat at about 76
percent CPU). So prefix warmth is real but it is not what makes a reply take 7 seconds: queueing behind other work and the
reasoning phase are. The decision therefore keeps the prefix warm cheaply and does not chase more. A clean cold-versus-warm
number needs a quiet machine; the canary records first-token time on every `chat_hello`, so the real distribution (cold after
idle against warm) arrives in the first week and decides whether the interval changes.

Cold after 11 minutes idle: the prefix was still cached (2,890 of 2,892 tokens) and the first token took 0.42 s, against 3.2 to
4.6 s a few minutes earlier while other sessions were using the engine. So the seven seconds Jesse saw is contention and the
reasoning phase, not a cold cache; the cache survived 11 minutes of idle. Prewarm's value is keeping the prefix from being
evicted by other prefixes (the judge, other callers), not defeating an idle timeout.

### Decisions

1. **Chat engine: keep the prefix warm.** `chat_hello` sends "hi" with the production system prompt prefix and tool list (the
   real pipeline builds it), so the Stack's prefix cache holds the exact bytes the next real turn starts with. Interval 10
   minutes (the cache lived through 11 idle minutes), about 50 generated tokens per call; the light tick that also runs `embed`
   stays at 5 minutes and the interval is tuned from the first week of recorded first-token times.
2. **TTS and STT: warm by the 30 minute loopback.** It keeps both models loaded and measures first-use load time. No extra call.
3. **Embed: warm by the 5 minute `embed` check** (a few tokens).
4. **Picture and video workers: never resident for warmth.** They take the memory the chat model needs. They are touched only
   by `image_tiny` (daily, low priority, GPU lock, memory not low) and by a prewarm when a person opens the picture or video
   composer, and only after a measurement shows it saves seconds. That measurement is a follow-up row (CANARY-02) and nothing
   ships for it until it exists.
5. **Setting "Keep the AI warm", default on.** Off stops the 5 minute and 30 minute probes and the prewarm, keeps the
   post-start suite (its search check excluded), the manual run and the daily picture check; the search canary runs only when it is on. Declared ahead of spec in `scripts/settings-ahead-of-spec.json`,
   then added to the spec on the next pin.

### Budget

| Probe | Rate | Tokens per hour (generated, capped) | GPU decode at 26 tokens per second |
|---|---|---|---|
| `chat_hello` (capped at 48 tokens) | 6 to 12 per hour | about 290 to 580 | about 11 to 22 s |
| `embed` | 12 per hour | about 60 input | negligible |
| weather, `spoken_turn` | 2 each per hour | about 400 | about 15 s |
| TTS and STT loopback | 2 per hour | one short phrase | about 4 s |
| search canary | 3 per day, jittered | about 1,100 per call incl. page text | about 3 s per call |

About 1,100 generated tokens an hour in total, under 1 percent of one hour of GPU decode, and zero while a person is in a
conversation. The engine is already resident, so this adds no memory and almost no watts above idle; the cost that matters is
the 5 minute wake-up preventing deep idle, which is why the switch exists.

Never during: low memory (role cause `memory`), an install or engine update, a GPU job, a paused chat, or a person mid
conversation (a turn started or finished in the last 30 seconds), except the post-start suite.

## One shared schedule

One scheduler tick (60 s) in Home decides all synthetic work, so checks, prewarm and self-heal do not stack:

- A single-flight lock: one synthetic request in flight at a time, and none while self-heal reports a restart pending or
  running or its gate closed.
- Order by priority when several are due: `chat_hello`, `embed`, weather and `spoken_turn`, loopback, search, picture.
- After any restart or heal: the full suite once, spaced 5 seconds apart, search only if its daily quota remains.
- The GPU checks take the shared lock (`mkdir /private/tmp/claude-501/bench.lock`, never wait: skip if held).

## Failure modes

- **The canary is the load.** Hard caps in code (tokens per call, 3 searches a day, single flight). If `chat_hello` takes more
  than 3 times its trailing median, or the engine reports a queue, the tick backs off to 15 minutes until a person's turn has
  come and gone. A person's turn always wins: scheduled checks start only when nobody has chatted for 30 seconds, and a started check is short and capped.
- **A canary failure that is the canary's fault** (a tool the model legitimately declined): needs 2 in a row, and the Repairs
  text says what was tried so an admin can judge it. The search canary uses a short fixed set of generic phrases, none with household data.
- **Search service blocks us.** The search canary goes through the one search limiter like any search, sends a fixed generic
  phrase with no identifier and no household data, and goes quiet for 24 hours on the first 429 or captcha (not only after a
  few). It is skipped while the search health already reports trouble. It is traffic the person did not ask for, so it is
  covered by Keep the AI warm (off stops it), gets its own row on the privacy page in the same commit as the code, and is
  listed there with its limit of 3 a day (PRIVACY.md, THIRD-PARTY-SERVICES.md).
- **Restart loop.** The canary asks for one restart per incident and never again until `chat_hello` has passed once. It asks only for a dead engine (role not ready) or a hung one (no token at all at three hellos in a row, 120 s deadline), never for a slow one; never under load above twice the core count, low memory or a self-heal blocker; at most once in 30 minutes, kept on disk; through the Stack's `POST /stack/v1/engines/self-heal/restart`, which never resets the breaker. An older Stack has no route, so nothing restarts.
- **Home restarts mid-suite.** Results are in process; the post-start suite refills them.

## Rollout and tests

1. This note and the architect verdict (docs only).
2. Checks, identity, results, runner and the Status row behind `Keep the AI warm` and `MAIPAI_CANARY`.
3. First week: record first-token time cold against warm, then fix the intervals from the numbers.

Tests, all hermetic with a scripted engine (no live service): a chat engine that never calls tools, an engine that is down, a
slow engine, a search that is blocked, the 2 in a row flapping guard, the no-residue snapshot, schedule and jitter, no checks
during an install, a job or low memory, and the search quota.

## Root causes seen 2026-10-17 and prevention

Jesse, 2026-10-17: "Besides healing, you need to figure out why we get into this state and prevent it." Healing (the layers
above) worked every time: each outage below ended in 2 to 15 seconds. This section names what caused each outage, from the
Stack log (`stack/data/logs/stack.log`), the macOS unified log, the live hub database and the agent transcripts, and ranks the
prevention. Times are UTC. The hub log (`hub.log`) is root-only and was not read.

### The turn that showed "cancelled" (01:19:52Z)

A hidden 60 second timer cancelled it, not an engine. `RESUME_TTL_MS = 60_000` (`backend/src/routes/turn.ts:61`) is meant to
keep a finished turn's replay buffer for a reconnecting client, but its `setTimeout` is armed when the turn starts
(`turn.ts:1054`) and aborts the turn if it is not finished (`controller.abort()`, `turn.ts:1060`). It is never re-armed or cleared.
Every turn that runs longer than 60 s is cut: the row shows `total_time_ms` 60316, no generation record, and the stream sends
`turn_cancelled`. That is a wall-clock cap on an adult written reply, which RULES.md rule 5 (DEADLINE-02) forbids, and it sits
under the real first-token limit (90 s, `turnMachine/budget.ts:18`). The reply was slow because the chat engine, restarted at
00:49 with a cold cache, shared the GPU with a 125 s video generation on the live Stack (01:19:17Z to 01:21:22Z) while the
machine load average was 10. No Home `video_jobs` row exists for that job: a dev Home or a script pointed at the live Stack
submitted it ("Cancelled by Home." on two more such jobs at 01:23).

### Every unexpected stop, with its cause

| When (UTC) | What stopped | Cause | Evidence |
|---|---|---|---|
| 05:51 to 21:52, 25 times | all five roles, the Stack itself ("The Stack is stopping.") | Agents restarting the live Stack: `launchctl kickstart -k gui/501/com.maipai.stack`, `launchctl bootstrap`, and `sudo maipai-install vX` (rollout smoke) | Stack log, 26 stop sequences; the matching Bash calls in agent transcripts at 05:20, 05:51, 05:54, 05:56, 06:13, 06:51, 14:01:52 (install v0.2.9), 14:41:45 (install v0.2.12), 17:40:06, 21:52. Fourteen of the 25 have no matching command that I could find |
| 14:48:13 | chat and embed (reloaded 14:49:37 and 14:50:10) | A chat-pause test agent ran `pkill -f "bun src/index.ts" -u 501 --parent 1` | agent transcript 14:48:13Z; Stack log shows the reloads 84 s later. The Stack log has no `engine.exit` or self-heal line for it, so the match rests on the timing alone |
| 19:00:55 | embed and judge (exit 0 after 68 s and 66 s), then chat "failed" and healed 19:01:24 | Probably `pkill -f "bun run src/index.ts" -n` run by a release agent at 19:00:53.7Z | Stack log lines 989 to 1006; the 2 s match is strong, the mechanism for `-n` is not proven |
| 00:27:49 | chat ("Stopped by Home.", back 00:28:02) | `POST /stack/v1/engines/omlx/stop` from the coordinator session, the intended switch back to llama-server; the route stops the whole chat role | transcript 00:27:48.9Z; Stack log `role.state chat installed ... Stopped by Home.` at 00:27:49.062 |
| 00:49:51 | stt, embed, judge, chat, all `exitCode 0`, `cause unknown`, healed in 2 to 11 s | `pkill -f "src/index.ts" -u 501` run by a kidsettings subagent at 00:49:48.862Z | macOS log: `launchd ... spotlightknowledged.updater exited due to SIGTERM \| sent by pkill[3633]` at 20:49:49.017 local; the dev llama-server 6172 died 108 ms later; Stack log lines 1140 to 1163 |
| 14:50, 15:12, 15:38, 16:23, 17:40, 21:54, 23:36, 23:39 | memory `critical`: the voice engine unloaded, the judge evicted, video generation cancelled (21:54, 23:36) | Other programs held more than 30 GB (the Stack's own engines hold about 35 GB of 128 GB). Largest holders: a bun test process at 43.9 GB (`wt/home-keen-falcon-news-02b/backend`, 16:23), a python image-edit process at 29.4 GB (scratchpad `edit`, 15:38), four Vite dev servers at 8.5, 4.9, 3.8 and 1.3 GB (17:40), a musicland worktree stack at 6.2 GB (21:54, 23:36). Kernel level 4 with 19 GB of swap at 15:12 | `memory.dev-load` events in the Stack log, each listing pid, GB and cwd. At 16:23:15 and 16:23:52 the coordinator session also restarted the 17 GB MLX chat engine (`POST engines/omlx/restart`), landing exactly on the critical event; at 17:40:06 an agent ran `launchctl kickstart` and critical followed in 38 s |
| 12:17 onward, still running | about 12 `bun ... data-test/run-*/engines/pocket-tts` and 5 `nodeshim ... e.js` processes | Test runs that exited without stopping their children | `ps` start times 12:17 to 19:45 local; they hold memory and ports for hours |

No row is a real engine crash. Every engine exit was a signal or a stop from outside the Stack. The canary did not misfire: the
Stack log has no `engine.restart_requested_by_canary` line, and no `requested_by_canary` self-heal event exists.

### The mechanism of the two mass kills

macOS `pkill` takes every operand after the first as another pattern. `pkill -f "src/index.ts" -u 501` is therefore three
patterns, `src/index.ts`, `-u` and `501`, matched with `-f` against the full command line. `-u` is a substring of
llama-server's `-ub` flag, `--user-data-dir` (Claude and Chrome helpers) and the Spotlight updater's own `-u`; `501` is in every `/private/tmp/claude-501/...` path. Reproduced read-only on 2026-10-18: `pgrep -f
"src/index.ts" -u 501` matched 52 processes including all three live llama-servers, while `pgrep -u 501 -f "src/index.ts"`
matched 3. Option order is the whole difference. The Stack's supervisor sees only `exit 0, no signal requested`, so it cannot tell
this from a clean stop and records `cause unknown`.

### Why Home's own tests are not the cause

`backend/tests/preload.ts` gives every Home test a scripted Stack fixture (`stackFixture`), and the Home tests that mention
`127.0.0.1:8770` only store the URL as a setting value. The live-port callers are ad hoc: dev Homes whose
`engines.stack.url` was set to `http://127.0.0.1:8770` (08:22, 08:24, 15:38), a release smoke script with
`STACK = "http://127.0.0.1:8770"` (21:05, including `POST /stack/v1/engines/self-heal/restart`), and agents using `curl -X
POST` against `:8770` for installs, `settings/apply`, `engines/*/restart` and `engines/*/stop`. The Stack has no authentication
for any of these: `stack/backend/src/app.ts` says "loopback is the whole authentication".

### Prevention, ranked

| # | Prevention | Stops | Cost | Where |
|---|---|---|---|---|
| 1 | Remove the 60 s turn timer: arm `RESUME_TTL_MS` only when the turn reaches a terminal state, and clear it on a fresh subscriber. A turn is never aborted by a wall clock the rules do not give it | The "cancelled" turn | S | `backend/src/routes/turn.ts:61,1054` |
| 2 | Engines ignore stray signals. Start each engine child through `sh -c 'trap "" TERM INT HUP; exec ...'` (ignored signals survive `exec`), and let the supervisor stop it with SIGKILL after a drain (llama-server and the speech worker hold no state to flush). A stray `pkill` then does nothing | Both mass kills, any future `pkill` or `kill` | S | `stack/backend/src/lib/supervisor.ts` (spawn and `stopRole`) |
| 3 | An agent guard, as a hook beside `origin-guard.sh`: deny `pkill` or `killall` with `-f` or with an operand after the first, `launchctl kickstart\|bootout\|bootstrap` on `com.maipai.*`, `sudo maipai-install` and any non-GET call to `:8770` or `:3000` unless the command carries `ALLOW_LIVE=1`; the denial names the rule and the safe form (`pkill -u 501 -f pattern`, or a pid file) | Agent kills, restarts and installs on the live machine | S | `.github` `standards/bin/live-guard.sh`, the shared plugin hooks |
| 4 | The Stack's mutating routes need a Home credential: a random token the installer writes to a 0600 file in the Stack data directory and into Home's credential store; Home sends it as a header; GETs, `/healthz` and `/v1/*` generation calls stay open. Covers engine stop, start, restart, `settings` PUT and apply, components install and uninstall, updates, job cancel | A stray test, script or dev Home changing the live Stack over HTTP | M | `stack/backend/src/app.ts` (middleware), `routes/engines.ts:232`, `settings.ts`, `components.ts`, `updates.ts`, `jobs.ts`; Home `lib/stack/` client; `docs/CREDENTIALS.md` |
| 5 | Dev Homes and scripts refuse the live port: Home's `stackUrl()` (`lib/ports.ts:20`) throws by name when the process data directory is not the live one and the URL resolves to 8770, unless `MAIPAI_ALLOW_LIVE_STACK=1`; `scripts/gate/shardTests.ts:247` and the proof scripts default to a stub | Dev Homes and smoke scripts reaching the live Stack | S | `backend/src/lib/ports.ts`, `lib/stackEngine.ts`, `scripts/gate/shardTests.ts` |
| 6 | A turn that loses its engine mid-stream is retried once after the engine is back, instead of showing "cancelled": on `engine_unavailable` or "stream ended before the engine finished", wait for the role to be `ready` (the self-heal window is 2 to 15 s), then run the model node once more with the same context; the second failure shows the existing calm error | Visible failures during any heal | M | `backend/src/lib/turnMachine/nodes/model.ts` (`runOneGeneration`), `turnNext.ts:1055` |
| 7 | Admission priorities in the memory governor: chat > voice > memory judge > picture and video. Never unload voice or the judge while a conversation was active in the last 5 minutes; a video or picture job waits (queued, Status shows why) while a chat request is in flight or the level is `warn` or worse, and the governor cancels a job only after pausing it fails | Voice and judge eviction, video starving chat | M | `stack/backend/src/lib/memoryWatchdog.ts`, `lib/supervisor.ts`, the job queue in `routes/jobs.ts` |
| 8 | Name an outside stop: an `engine.exit` with exit code 0, no signal and no supervisor request, on two or more roles within 5 s, is recorded as `external_stop` (not `unknown`), does not count toward the circuit breaker, and raises one Repairs item "Something outside MaiPai stopped the engines" with the time; three `unknown` exits for one role in 30 minutes raise "engine keeps stopping" | Silent repeated exits | S | `stack/backend/src/lib/selfHeal.ts`, `supervisor.ts` exit classifier; Home Repairs mapping |
| 9 | Dev-load discipline: the governor already reports `memory.dev-load`; add a reaper in `scripts/wt.sh` that lists, and after an hour kills, processes whose cwd is under `wt/*` or a scratchpad and that hold more than 12 GB or were left by a finished test run (`data-test/run-*`); the Stack test harness kills its children on exit through a process group | Memory `critical` from agent processes; leaked test processes | S | `.github` `standards/bin/wt.sh` (`reap`), `stack/backend/tests` harness |

Order of work: 1, 2 and 3 together stop every failure seen tonight at low cost. 4 and 5 close the HTTP path. 6 is what Jesse
sees when something still goes wrong. 7 to 9 reduce the memory pressure behind the critical events.

Items 1 and 6 are Home. Items 2, 4, 7, 8 are the Stack repo. Items 3, 9 are `.github`. Item 5 is Home plus its scripts.

## Supersedes

Nothing. It adds a layer and a schedule beside CHAT-PAUSE-01 and SELFHEAL-01 and changes none of their behaviour.
