# Speculative start: the spoken turn begins on the edge partial, held privately (2026-11-11, design note for STT-SMARTTURN-01)

Read for this: `RULES.md` (rules 0, 1, 6a, 9, 10, 13), `full-duplex-speed-2026-11-11.md` (section 2 item 5, build item 4,
section 7.5 of the consulting note), `sttSession.ts`, `routes/turn.ts` (the resume session, the cancel route),
`turnMachine/turnNext.ts` (`startStream`), `nodes/tool.ts`, `liveVoiceSession.tsx`, `chatModelAdapter.ts`. (est.) marks an estimate.

## Supersedes

STT-SMARTTURN-01's "speculative turn start" half (BACKLOG.md): this note is its design. Its endpointer half stays with DUPLEX-02.
Nothing in `full-duplex-speed-2026-11-11.md` changes; this note builds its item 4 as that note describes it.

## Reuse check

Searched `grep -rn "speculat\|preempt\|held privately\|resume_token" backend/src frontend/src`. The mechanism already exists in
pieces: the turn route's resume session holds every event of a turn in memory and replays it to a client that reconnects with
`resume_token` (`routes/turn.ts`, `streamResponse`, `shouldDeliver`); the cancel route aborts a generation
(`routes/turn.ts`, `cancelTurnRoute`); the STT session produces the edge partial at the first silent frame and the final reuses
it when no voice followed (`sttSession.ts`); the turn lease (`turnActivity.ts`) keeps one turn per person. No new store, status
surface, model or stage. Sources: LiveKit's preemptive generation and the Voice-Light hybrid controller (arXiv 2609.20995), both
cited in the 2026-10-24 design.

## The gap it closes

Measured on the live hub (section 9 of the consulting note): `stt_ms` median 750 ms is the 0.75 s silence timer itself. The
model does not start until the final lands, so the timer sits in series before the first token. Starting the turn on the edge
partial moves the timer, and the final's decode, off the first-sound path on every confirmed run.

## Mechanism

1. **Start.** At the first silent frame the STT session sends the edge partial as it does today. The voice session (an adult
   speaker on the chat or phone surface, confirmed identity) sends `POST /api/turn/stream` with `speculative: true` and that
   text. The server runs the ordinary turn (every gate, the same tools offered, the same band) but the resume session starts
   **held**: no subscriber, nothing written to the wire, the response is the ids alone (`turn_id`, `resume_token`,
   `conversation_id`). The person's words are not shown in the chat until confirmed.
2. **Held means private.** While held: (a) no delta, cue or status reaches the client, so nothing is spoken; (b) the turn is
   not stored: `logResult` in `startStream` waits for the confirmation; (c) a proposed tool call is parked: the tool node waits
   for the confirmation before running any package (search included: a child's search path and the request budget belong to
   the confirmed turn); (d) recalled memories are not bumped as used until confirmed.
3. **Confirm.** When the final lands and equals the partial the run started on (exact text after trimming whitespace; the STT
   session reuses the edge partial when no voice followed, so a clean end is byte-identical), the client sends its normal turn
   request with `resume_token`, `turn_id`, `conversation_id`, `resume_from: 0` and `confirm: true`. The server marks the session
   confirmed (storage, tool execution and memory bumps proceed), stamps `stt_ms`, and streams the held events in order from the
   first. The chat shows the person's words at that moment, as today.
4. **Discard.** When the final differs, or more speech follows, or the session closes, the client calls the cancel route with
   `discard: true`: the generation is aborted, the session is dropped, nothing is stored, nothing is spoken, no heard prefix is
   applied, and the real final goes through the normal path. Counts only are kept (rule 6a): started, confirmed, discarded.
5. **Guards.** Adults only, confirmed identity, chat and phone surfaces (a robot speaker and any minor never speculate: rule 0,
   the age and surface gates outrank). Not on a crisis, consent, repair or hub-target turn (`cueSuppressed`'s own inputs), not
   with a pending ask, not when a turn is already active for the person, not on an utterance over 10 s or over 40 words
   (LiveKit's guard), and only while the voice session is open. A speculative request that fails any check is refused with
   400 and the client falls back to the normal send; a failed or refused run never fails the real turn (rule 6 shape).
6. **Gates unchanged.** The speculative run is the real turn's pipeline for the person's band (section 2 item 12 of the speed
   design). Rule 1: tools are offered as today with `tool_choice: auto`; parking only delays execution. Rule 10: the output
   gate runs as today; released text is held, never retracted (a discarded run released nothing).

## Rule 9 named gap

Rule 9 lists the named gaps for custom code in the chat path. This note names one more: **the held resume session**, a turn
whose events are kept private until a confirmation, with storage and tool execution parked behind it. It reuses the existing
resume session and cancel route; the only new states are `held` and `confirmed` on the session and a confirmation promise the
tool node and `startStream` await. No new `turnMachine` stage. Jesse added it to rule 9's named gaps on 2026-11-11 ("Yes, add
the line", the wizard); the rule's entry is the authority for this note's scope, and the architect's verdict record
(`data-scratch/architect/STT-SMARTTURN-01.verdict`, APPROVED 2026-11-11) holds the eight conditions the build keeps.

## Build (one slice, S to M)

- `routes/turn.ts`: `speculative: true` on the stream route creates a held session and answers with the ids; `confirm: true`
  on a resume marks it confirmed and streams; `discard: true` on cancel drops it unstored. Counts-only counters.
- `turnMachine/turnNext.ts`: `startStream` awaits the confirmation before `logResult`; a discarded run releases the lease and
  logs nothing. `nodes/tool.ts`: wait for the confirmation before executing a proposal; abort ends the wait.
- `liveVoiceSession.tsx`: start on the edge partial (the first partial after `vad speaking: false`), confirm or discard on the
  final, fall back on any error. `chatModelAdapter.ts`: the resume body carries `confirm: true`.
- Tests: a confirmed run stores one row and speaks; a discarded run stores nothing, bumps nothing, ran no tool, spoke nothing;
  a minor's or robot's speculative request is refused; a parked tool runs only after confirmation.

## Exit number

`bun run voice:latency`, 20 real adult turns on the dev hub: speech end to first sound median under 1.5 s; discarded runs
under 20 percent of turns; confirmed `first_token_ms` not worse than the prewarm's alone. Measured before and after in the
landing note.

## Measured (2026-11-12)

Method: `cd backend && bun run scripts/bench/voice-first-sound.ts --api <dev hub> --turns 6 --speculative on|off`. It
drives the hub's real voice path without a browser: Home speaks a short question, the audio streams to `WS /api/stt/stream`
in real time, the final starts the spoken turn, the first sentence (the browser's own first-chunk rule) goes to `POST /api/tts`,
and the first sound is the end of speech to the first audio bytes. The last sentence is spoken too, so CONVO-PREWARM-02 runs
between turns as in the browser. A browser adds about 0.1 to 0.2 s (decode and audio start) on top. Mac Studio, Splash 1.6.1,
the 27B chat model, load 40 to 60 percent of cores, six short questions, one conversation per run, prompt cache warm.

| | first sound, median | p90 | STT final | request to first sentence | TTS first bytes | confirmed |
|---|---|---|---|---|---|---|
| Speculative start off | 2.26 s | 3.26 s | 0.82 s | 1.00 s (engine first token 0.82 s) | 0.43 s | |
| Speculative start on | **1.40 s** | 4.30 s (one slow first chunk; five of six under 1.5 s) | 0.82 s | 0.21 s after the confirm | 0.38 s | 6 of 6 |

The speculative start saves about 0.85 s at the median (the silence timer and the final's decode leave the first-sound path).
Cold runs are slower on both sides: with no prewarm the engine re-reads the whole prompt (`cache_n` 0, first token 2.5 to 3 s,
first sound 4.3 s). The engine keeps the states of whole earlier requests, not arbitrary shared prefixes, so a turn is fast
only when the prewarm that CONVO-PREWARM-02 or the session-open prewarm published before it succeeded.

**Client gap found and fixed the same day.** The hub sends the edge partial at its first silent frame and `vad speaking: false`
only at finalize, after it. The client armed its "next partial is the edge" flag on `vad speaking: false`, so on a clean end
no partial ever followed and the held run never started in the browser (the server-side measurement above had bypassed the
client). Now the hub marks that partial `edge: true` (`sttSession.ts`, an additive wire field older clients ignore; `SttSessionEvent`)
and the client starts the held run on it (`liveVoiceSession.tsx`); the armed flag stays for an older hub. Tests:
`backend/tests/sttSession.test.ts` (the edge partial carries the flag, a cadence partial does not) and
`frontend/src/apps/chat/liveVoiceSession.test.tsx` (a marked partial starts the held run, a cadence partial does not).

**Default.** `voice.speculative_start` stays off. Turning it on is one household setting (admin). Before that, the exit
numbers above should be repeated through the browser (20 real turns, `bun run voice:latency`), since the client path has not
yet been exercised with a microphone after the fix, and a wrong guess costs engine time: a discarded run leaves the next real
turn behind it (seen as first-token 2.9 to 4.9 s on refused runs during the bench).

## The conversation warm was lost to the fold (CONVO-PREWARM-03, 2026-11-12)

**What the engine does** (`backend/scripts/bench/engine-resume-probe.ts` against the live Splash 1.6.1 and the 27B hybrid,
fresh system fillers per case, counts only): a request resumes only from the end of an earlier request (its prompt rounded down
to a 32-token block, minus the template's generation tail) or from a 4,096-token checkpoint. A request that shares a prefix with
an earlier one but diverges before that one's end resumes nothing: `cache_n` 0 whether the divergence is at the start of the
last message, one message earlier, or mid-message (S1 to S3); a request that extends an earlier one exactly resumes at its end
(S4 3,584 of 3,629; S6: the warm's end). Idle time (12 s), six other requests in between, and concurrent requests do not evict
(P1 to P4, Q1 to Q7). This corrects the 2026-10-28 reading in `splash-chat-01-2026-10-28.md` ("Splash reuses a diverging
prefix"): that B diverged at A's end, which is the one place a resume works.

**So a warm counts only when its whole prompt is a byte-for-byte prefix of the next turn's.** The post-turn warm
(CONVO-PREWARM-02) ran about a second after the reply, but the idle fold (`summaryRefresh.ts`, 20 s after the turn) then
rewrote the summary line in the system message and moved the window anchor, so the next turn's prompt diverged from the warm
right after the stable prefix. On the live hub every spoken turn of the day resumed from the session-open warm instead
(`cache_n` exactly 2,048 on each warm turn, the size of that warm's prompt; 2,062 to 2,113 tokens recorded) and read the whole
window again: first token 0.9 to 2.2 s warm, 2.5 to 2.8 s cold. The same shape on a dev hub replayed from dumped requests:
turn A cold, the warm (sharing 2,464 tokens with A) `cache_n` 0, the next turn `cache_n` 2,464 from the warm's end.

**Fix** (`prefixPrewarm.ts`, `conversationHistory.ts`, `routes/turn.ts`): the warm keeps its window builder per conversation;
a stored fold calls `onConversationFolded`, and `rewarmConversation` builds the window again and warms when it changed (never
while a turn runs; a new utterance still aborts a warm). The turn's first request reports whether it extended the last warm
(`prewarm` on the generation record: `warmed`, `hit`, `first_diff` as a part label, no text; `prewarm_hit` on the turn stats
and the voice timing record; `bun run voice:latency` prints "turns that extended their conversation warm: n of m warmed").
Tests: `tests/prefixPrewarm.test.ts` (a changed window names the part that differs; a fold warms again from the kept builder and
only when the window changed; never beside a turn), `tests/conversationHistory.test.ts` (a stored fold notifies).

**Measured after the fix** (dev hub on the shared Stack, Splash 1.6.1, load 50 to 75 percent of cores, speculative start off,
`--turns 11 --gap 8`, two runs; the Stack's speech roles were restarted by another session during the second run, so 10 warm
turns count): every warm turn extended its warm (10 of 10, `cache_n` growing with the warm's end: 2,656 to 3,136 of 3,112 to
3,657), engine first token median 0.84 s, p90 1.01 s (0.77 to 1.01 s); first sound after the person stops talking median
2.38 s, p90 2.69 s (1.98 to 3.05 s; STT final 0.79 s, TTS first bytes 0.29 to 0.62 s). Before, on this bench, a warm turn
missed its warm in two of two runs at turn 2 (`cache_n` 0, first token 2.8 to 3.0 s) and hit on later turns; the live hub's
misses above are the fold case, which this bench's short conversation never reaches (the unit test covers it).

**What still stands between 2.4 s and the 1.5 s goal:** the volatile tail the engine must read every turn (the memory block, the
plan line, the clock and the words: about 450 to 550 tokens, 0.5 s of the 0.84 s first token), the STT final (0.8 s) and the
TTS first bytes (0.3 to 0.6 s). Only the speculative start overlaps the STT final (1.40 s measured above). It stays off: the
20-turn browser-path trial this note asks for (wrong-guess rate and the cost of a wrong guess) has not been run, and a
headless run cannot exercise the microphone path.

**Known one-turn miss, not fixed here:** a durable fact the memory judge stores after a turn changes the profile card in the
stable system message; the next turn then reads cold once (`first_diff` "message 0 (system)") and its own warm records the
new prefix. Rebuilding the system message outside a turn would duplicate the context node, so the miss is measured, not
hidden.

## Risks

A speculative run still generating holds the engine while the real turn starts after a discard (measured by the discard
rate and the discarded run's `prompt_ms`); the edge partial can be a mid-sentence pause (the 10 s and 40-word guards and the
discard path bound it); GPU share with TTS of the previous reply (the conversation prewarm already runs there).

## The warms are bounded (CONVO-PREWARM-04, 2026-11-12)

**What happened.** The chat engine keeps the state of every request it served (a warm, a bench turn, a discarded speculative run)
until its memory budget is full, and no idle time evicts one (the resume probe above). On the live hub, 35 minutes after a restart,
the Splash chat process held 61.2 GB, the whole budget the Stack had given it; the Stack's ledger counted 35 GB for chat, and a song
and a clip waited for memory that was never free. Three distinct 2,627-token prompts grew the process by about 0.33 GB each. The
post-turn warm and the warm after every fold (CONVO-PREWARM-03) ran for every conversation warmed since the hub started, up to 64,
each leaving one more state behind.

**Fix.** The Stack's side (SPLASH-MEM-01 in `stack/docs/dev.md`): the engine's budget is the model's need plus the headroom
setting, and the ledger counts that whole budget for chat, so other jobs never plan on it. Home's side (`prefixPrewarm.ts`): the
household keeps at most 8 conversations warm (the oldest is dropped when a newer one is warmed; a fold of a dropped conversation
sends nothing), and a conversation is warmed again after a fold only within 30 minutes of its last warm; older ones are dropped
and left to their next turn, which warms them again. One warm per conversation stays in flight (unchanged). Tests:
`backend/tests/prefixPrewarm.test.ts` (the ninth conversation drops the first; a 31-minute-old warm is not repeated).
