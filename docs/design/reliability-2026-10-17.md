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
  come and gone. A person's turn always wins: a canary request in flight is aborted when a real turn starts.
- **A canary failure that is the canary's fault** (a tool the model legitimately declined): needs 2 in a row, and the Repairs
  text says what was tried so an admin can judge it. The search canary uses a short fixed set of generic phrases, none with household data.
- **Search service blocks us.** The search canary goes through the one search limiter like any search, sends a fixed generic
  phrase with no identifier and no household data, and goes quiet for 24 hours on the first 429 or captcha (not only after a
  few). It is skipped while the search health already reports trouble. It is traffic the person did not ask for, so it is
  covered by Keep the AI warm (off stops it), gets its own row on the privacy page in the same commit as the code, and is
  listed there with its limit of 3 a day (PRIVACY.md, THIRD-PARTY-SERVICES.md).
- **Restart loop.** The canary asks for one restart per incident and never again until `chat_hello` has passed once.
- **Home restarts mid-suite.** Results are in process; the post-start suite refills them.

## Rollout and tests

1. This note and the architect verdict (docs only).
2. Checks, identity, results, runner and the Status row behind `Keep the AI warm` and `MAIPAI_CANARY`.
3. First week: record first-token time cold against warm, then fix the intervals from the numbers.

Tests, all hermetic with a scripted engine (no live service): a chat engine that never calls tools, an engine that is down, a
slow engine, a search that is blocked, the 2 in a row flapping guard, the no-residue snapshot, schedule and jitter, no checks
during an install, a job or low memory, and the search quota.

## Supersedes

Nothing. It adds a layer and a schedule beside CHAT-PAUSE-01 and SELFHEAL-01 and changes none of their behaviour.
