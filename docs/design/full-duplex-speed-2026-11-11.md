# Full duplex for Home: current code, the planned rows, and Bobby (2026-11-11, consulting design)

Read for this: `RULES.md`, the 2026-10-24 design, the DUPLEX, STT-SMARTTURN-01 and CHAT-TYPEAHEAD-01 rows, `sttSession.ts`,
`routes/stt.ts`, `routes/tts.ts`, `routes/turn.ts`, `sentenceSpeechScheduler.ts`, `liveVoiceSession.tsx`,
`tier-evaluations-2026-10-30.md`, and the VOICE-LATENCY-01 commit (`voiceTiming.ts`: `stt_ms`, `turn_start_ms`, `first_token_ms`,
`first_sentence_ms`, `first_audio_ms`, `first_playback_ms`). (est.) marks an estimate. Bobby's numbers are one 15-turn call
reported by a friend: a target, not evidence about Home.

## Supersedes

This note replaces, for build order and mechanism, the following (the 2026-10-24 note stays as the evidence base):
- Section 3b of `full-duplex-voice-2026-10-24.md` (cached continuer clips for adults and the "model never writes these sounds" line) and section 7 (the slices).
- DUPLEX-02, split into build items 1, 3 and the echo guard of item 6; DUPLEX-03, reworked as item 6; DUPLEX-07, reduced to item 8; DUPLEX-NOISE-01, merged into item 6; DUPLEX-01, trimmed to what the spec still lacks.
- STT-SMARTTURN-01, cut to the speculative start only (its endpointer half is DUPLEX-02's).
- CHAT-TYPEAHEAD-01's voice half, which this note is the design note for (answers 2 to 6 below).
- SPEECH-STYLE-05 (BACKLOG.md:2973) depended on DUPLEX-07's closed clip list. Decision: the closed clip list stays for children and teens (rule 10 argument below), so SPEECH-STYLE-05 keeps that list and is re-pointed to item 8's minors path.

## Reuse check

Every stage reuses what exists: Silero VAD and `SttSession` partials, Smart Turn in the Stack (`/v1/audio/endpoint`), llama-server's prompt cache, the resident Qwen3 4B judge and `quickReaction.ts`, the turn route's existing cancel, `spoken_cue` variants and `callSounds.ts`, `voiceTiming.ts` and `bun run voice:latency`. Proven sources: Pipecat, LiveKit (preemptive generation, turn detector), Bobby's measured chain (one call, a target only). No new model, store or status surface.

## Conditions the architect required (2026-11-11)

- **Rule 10 and the continuers (item 8).** The 4B path may write continuers for adults only, and each one passes the same band output floor as any reply plus the shape checks in `quickReaction.ts`, with `cueSuppressed` covering crisis, consent and refusal turns. Children and teens keep the closed clip list (one constant, a per-band floor test). A test proves a minor never gets a model-written continuer.
- **Rule 1.** The 4B end-of-turn check decides only whether a turn is complete, never whether to search or use a tool. Its shadow output is a number with no text (rule 6a).
- **Speculative start (item 4).** Confirm only when the final transcript equals the partial the run started on; otherwise discard. If it cannot be built on the route's cancel, it is a named rule 9 gap for Jesse first.
- **Cache fill (item 2), the missing CHAT-TYPEAHEAD-01 answers.** (2) Measure first whether the engine and its slots keep the cache across requests; stop if prompt reading is under about 300 ms. (3) A cache fill yields at once to a real turn and never holds a slot. (6) It sits behind a setting, off by default until measured.

## 1. Side by side

Stage by stage. A = current code. B = the planned rows. C = Bobby.

| Stage | A: current Home | B: planned rows | C: Bobby |
|---|---|---|---|
| Mic to hub | Browser frames over a WebSocket; Silero per 32 ms chunk on the hub (31 checks/s). Browser frame size unknown. | Same, Silero 0.7/0.15 s/0.2 s | 20 ms slices; a tiny model checks 30x/s |
| End of turn | 0.75 s silence timer. Smart Turn is in the Stack (`/v1/audio/endpoint`) behind `stack.engines.stt.smart_turn`, off: 0.4 s silence, ask, hold up to 0.8 s more, 250 ms timeout. | DUPLEX-02: score six candidates on TurnBench; winner replaces the timer, timer stays as fallback | A stop decision from the tiny model (his own number not given; the chain is 1.3 s) |
| Transcribe | Whole-utterance WAV re-decoded every 1.5 s of speech and once at the first silent frame; `finalize` reuses that partial if no voice followed. Parakeet v2 int8: about 150 ms for a 2.5 s clip under load. The edge partial is skipped when Smart Turn is on (`if (!this.cfg.endpointing)`). | DUPLEX-02: per-VAD-segment decode, 1.0 s preroll, 0.3 s tail pad | Whisper runs during the pause; text ready about 300 ms after the stop |
| Done and route | None: the final goes to the turn route; the main model decides tools with `tool_choice: auto` (rule 1). | STT-SMARTTURN-01: speculative start, side-effect free until confirmed | A 4B answers "done?" and picks a lane (80B chat, or calendar and budget tools) in about 0.1 s |
| First words | Prefix prewarm on call open and at boot; first token 0.7 to 1.3 s warm, 3 to 4 s cold (chat log 2026-10-30); tier bench 0.05 to 0.11 s short, 0.6 to 1.0 s after 4k tokens of history. | CHAT-TYPEAHEAD-01: cache fill on the draft; not pickup-ready | 80B first words about 0.6 s, started early, kept warm; about 100 words/s |
| First sound | Qwen3 4B quick reaction (`REACT` when ready, 0.5 to 0.6 s; `ACK` at 0.7 s if no first word); fixed cue at 1.5 s only if the 4B failed. The reply waits for a sentence (`splitReadyChunks`; a clause-first rule is not confirmed). | DUPLEX-07: cached continuer and acknowledgement clips | The persona's voice clone speaks the first phrase at about 0.3 s |
| Speech | Chatterbox per sentence, streamed: first byte 250 ms; Nano first audio 0.22 s default voice, 0.65 s cloned; 60 to 250 ms buffers, gapless. | Unchanged | About 2.5 words/s, mouth moving along |
| Tool turns | Tool-start cue only for a package that usually runs over 2.5 s; "Still on it" after 3 s. | Unchanged | Five soft ticks while working |

Full-duplex ability:

| Ability | A | B | C |
|---|---|---|---|
| Listen while speaking | Yes (the socket stays open; `played_ms` every 250 ms) | Yes | Yes |
| Pause on voice | 400 ms arm, 150 ms, then a 700 ms confirm, or a 2-word partial; partials come every 1.5 s, so the pause lands 0.85 to 1.25 s after the voice starts (est.). The client ignores the server's `reply_pause` (2026-10-30). | 150 ms, then first voiced frame | "Talk over it any time"; threshold and false-stop rate unknown |
| Stop | Only on the final: 0.75 s silence plus decode, so 1.5 to 2.5 s after the person starts (est.) | Final decides; faster partials | Unknown |
| Person's backchannel | Frozen reaction list plus up to 4 reaction words, question mark rule | Easy Turn class measured as replacement | Unknown |
| Echo | Browser `echoCancellation` (Chrome on macOS clean, 2026-10-24); Home's own quick reaction caught by text; no general guard | Smith-Waterman text guard, 300 s window | The phone's canceller (assumed) |
| Resume | Exact (`AudioContext.suspend`); 1.2 s false-interruption window | 0.4 s, 1.5 s cap | Unknown |
| Heard prefix | Stored reply equals the heard prefix | DUPLEX-06 adds the unheard remainder | Unknown |
| Home's own continuers | 4B reactions in a pause (8 words, 0.4 s pause, 8 s gap, 40%) | DUPLEX-07 cached clips | Not described |

Speech-end to first sound, warm, today (est.): 0.75 silence + 0.0 to 0.5 decode + 0.7 to 1.3 first token + 0.3 to 0.8 first
sentence + 0.25 to 0.65 first audio, so 2.0 to 4.0 s for the answer, about 1.4 s for the 4B opener. That sits at rule 13's 3 s
bar. Bobby: 1.3 s. The gap is three waits in series that he overlaps: end of turn, transcribe, first token.

## 2. The target pipeline

The principle: every wait that can overlap the person's own pause does. Nothing changes what is said, who hears it or which
gates run (rule 0; section 5 of the 2026-10-24 design). Per stage, the best mechanism and its source:

1. **Mic and VAD: keep.** Silero per 32 ms chunk already matches Bobby's 30 checks/s. One check: if `mic-capture.ts` batches
   more than 40 ms per frame, the first voiced frame is late by that much (unknown; measure).
2. **End of turn: a decision at the first silent frame, not a timer.** Bobby's tiny model and Pipecat's Smart Turn do the same
   job. Smart Turn is already in the Stack (rule 11 satisfied) and unmeasured. Run DUPLEX-02's measurement, plus one candidate
   that costs no new model: the resident Qwen3 4B judge reads the edge partial and answers "complete or not" in shadow (LiveKit's
   turn detector is a small text model over the transcript; ours is an existing model with a new prompt, so the owner's "no new
   model" answer holds). TurnBench's development split scores both; the winner turns on with the timer as fallback. Target:
   finalize at 0.3 s of silence on "complete", hold to 1.2 s on "not". Honest risk: Smart Turn's median decision latency on
   TurnBench is about 1 s, slower than our timer; if it loses, the timer stays and the saving comes from steps 3 to 5.
3. **Transcribe during the pause: adopt, mostly built.** The edge partial at the first silent frame plus reuse at finalize is
   Bobby's trick already. Two fixes: run the edge partial when Smart Turn is on too (today it is skipped), and decode per VAD
   segment with preroll and tail pad (local-voice, DUPLEX-02) so a 20 s story is not re-decoded whole every 1.5 s.
4. **Prompt cache fill on the partial: adopt** (CHAT-TYPEAHEAD-01's voice half; source: llama-server's prompt cache, mafdet as
   reference only). On each partial, send prefix plus partial as a cache fill with no tokens generated. It can never be wrong
   (prefix reuse equals a cold run) and attacks the 0.7 to 1.3 s first token directly. Same gates as a sent message, never
   logged or stored, dropped on close.
5. **Speculative start: adapt** (LiveKit preemptive generation; STT-SMARTTURN-01 keeps ownership). Start the turn on the edge
   partial at the first silent frame, held privately until the end of turn confirms: no release, no speech, no memory write,
   no tool execution (a proposed call is parked, search included, since a child's search path and the request budget belong to
   the confirmed turn). More speech discards it through the turn route's existing cancel; skip utterances over 10 s (LiveKit's
   guard). No new `turnMachine` stage; if it cannot be built on the route and its cancel, it is a rule 9 named gap for Jesse.
6. **Lane router: reject.** Bobby's 4B picks chat or a tool lane from the words. Rule 1: no classifier reads open-ended
   wording to decide a tool; the model decides with `tool_choice: auto`. The cost is measured, not dropped: on a tool turn the
   first sound waits for the main model to emit the call plus the tool's run. If `voice:latency` shows tool turns over rule
   13's 3 s bar once steps 2 to 5 land, report it to Jesse with rule 1 named and the measured gap; the only allowed shape would
   be the existing shadow signal (a score logged, no turn changed).
7. **First phrase fast: already ours, tune it.** Chatterbox streams at 0.22 to 0.65 s first audio and the 4B opener speaks at
   0.5 to 0.6 s; Bobby's voice clone at 0.3 s is the same idea. One open fix: confirm `splitReadyChunks` releases a clause (a
   comma or about six words) first; if it waits for a full stop, `first_sentence_ms` carries 0.3 to 0.8 s that need not exist.
8. **Ticks while a tool works: adapt as a cue, not a status surface.** S6 forbids a new status signal; rule 9 names the spoken
   cue as the gap. A short synthesized tick (Web Audio, like `callSounds.ts`) becomes a `spoken_cue` variant in place of "Still
   on it" once a tool passes 2.5 s. Word fillers hurt at short waits (arXiv 2507.22352); a soft sound at a long wait is Bobby's
   finding by ear. Taste item for Jesse, low in the order.
9. **Mouth sync: adopt, owned by the talking-companions session (corrected 2026-11-11 at Jesse's request; the first draft
   wrongly rejected it as "not a latency item").** The pack player already builds mouth cues in the browser from the sentence
   text plus the decoded samples (`frontend/src/lib/speechTap.ts`: sentence text, samples with start time, sentence end, stop),
   and draws against `speechClock()` from `SentenceSpeechScheduler` (audio clock minus output latency, frozen while the audio
   context is suspended). Measured on demo fixtures only: mean lag under 30 ms, p95 under 120 ms; a real device is unmeasured.
   No wait before the first mouth movement: a text-only draft exists when the first buffer is scheduled and the real alignment
   swaps in later. Contract this design must keep: (a) every change to the scheduler (clause-first release, fast-partial
   barge-in) keeps publishing `speechTap` events and keeps `speechClock()` frozen on suspend; (b) `stop` clears the mouth
   (75 ms fade, gone in about 90 ms); (c) on a pause for a cough or "mm-hm" the mouth should close over about 150 ms, not hold
   its last shape (their open item; test on a real device); (d) `played_ms` (every 250 ms) stays a correction signal, never
   the mouth clock. One-time cost to measure: the CMU pronouncing dictionary (`GET /api/speech/cmu`, about 4.7 MB raw) is
   fetched on the first pack-synth utterance; until then unknown words use letter shapes. Add a mouth-lag row to the
   DUPLEX-BENCH-01 run on a real device with Atlas.
10. **Barge-in: pause from the partial, stop from the final, with faster partials.** Keep Jesse's 2026-10-30 ruling (no fade,
    pause only on real speech) and the frozen reaction rule. The win comes from step 3: with per-segment decode a two-word
    partial lands about 0.3 s after the person's first pause instead of up to 1.5 s, so pause and stop move earlier without
    lowering any threshold. Then the text echo guard (local-voice), needed for the PWA speaker and the robot.
11. **Home's own continuers: one mechanism for adults, the closed clip list for children and teens (rule 10).** Home already has the 4B reaction in the person's pauses (VOICE-QUICK-02).
    DUPLEX-07 would add a clip-based second one for the same moment: two definitions of one thing (platform principle 1).
    Merge for adults: keep the 4B path (each continuer passes the band output floor and the `quickReaction.ts` shape checks);
    minors keep the closed clip list. Take the 4B path's numbers, take Pipecat's numbers (0.7 s of speech first, 0.2 s pause, 2.5 s between, 0.8 chance, volume 0.6)
    as starting values, keep only the acknowledgement-on-cut-in as a `spoken_cue`.
12. **Gates.** Every band gets the same timing; a child keeps thinking off, the output floor and the spoken limits; an unknown
    robot speaker is the child band. A speculative run uses its band's exact pipeline. Nothing heard during a discarded run is
    kept (rule 6a, counts only).

## 3. Build order

Each item is S or M, has a fail-first test and a number from `bun run voice:latency` (20 real warm turns on the dev hub against
the live Stack, median and p95) or the bench. Order is by expected win.

| # | Item | Size | Acceptance test | Exit number |
|---|---|---|---|---|
| 0 | VOICE-LATENCY-01 baseline: land, record 20 turns | S, in flight | The report prints all six stages | The baseline table; expected 2.0 to 4.0 s (est.) |
| 1 | Edge transcribe always (DUPLEX-02 part): edge partial with Smart Turn on; per-segment decode with preroll and tail pad | S | A 12 s fixture decodes the last segment only; the final after a 3 s utterance equals the edge partial | `stt_ms` median under 100 ms after the end-of-turn decision |
| 2 | Cache fill on the partial (CHAT-TYPEAHEAD-01 voice half; this note is its design note, architect verdict still needed) | S | A partial triggers one fill request with no tokens; a child's partial takes the child prefix; nothing stored | `first_token_ms` median under 0.4 s at 4k history (from 0.7 to 1.3) |
| 3 | End-of-turn measurement (DUPLEX-02 part): Smart Turn and the 4B text check on TurnBench dev split, shadow on the dev hub | M | Fail-first "um" fixture: a 600 ms mid-sentence pause does not end the turn with the winner on | Median decision under 0.5 s after the last word, false ends under 5% on the fixture set; else the timer stays |
| 4 | Speculative start (STT-SMARTTURN-01) | M | A reopened turn discards the run, no memory row, no tool ran, nothing spoken; a confirmed run releases at once | Speech end to first sound median under 1.5 s; discarded runs under 20% of turns; confirmed `first_token_ms` not worse than item 2's |
| 5 | First chunk is a clause | S | A reply starting "Well, the thing is, ..." speaks "Well," first | `first_sentence_ms` minus `first_token_ms` median under 0.3 s |
| 6 | Barge-in on fast partials (DUPLEX-03 rework) plus the text echo guard (DUPLEX-02 part); DUPLEX-NOISE-01 folds in as its noise row | M | Noise fixture resumes; "mm-hm" resumes; a question stops and becomes a turn; a 3-word echo is dropped; a child's "no" after Home said "no" still stops | Pause median under 0.5 s from voice start; stop median under 1.0 s; false stops on the ESC-50 control set at or under local-voice's 24 of 260 |
| 7 | DUPLEX-06 remainder to the next turn | S | As the row states | IHBench three tests on the five cases, 2 of 2 each |
| 8 | Continuers merged into the quick-reaction path for adults, clip list for minors; acknowledgement cue (DUPLEX-07, reduced) | S | Long thought with a pause gets one continuer, none over the person's voice; a child or teen never gets a model-written continuer | Full-Duplex-Bench v1 backchannel timing row; Jesse's ear |
| 9 | DUPLEX-00 remaining browsers; DUPLEX-05 robot spike in parallel | S, M | As the rows state | Echo table per browser; unit numbers |
| 10 | DUPLEX-BENCH-01 | M | As the row states | The recorded bench, rerun after each item above |

Rows: keep DUPLEX-00, 05, 06, BENCH-01. Split DUPLEX-02 into items 1, 3 and 6's echo guard (the row bundles four jobs).
Rework DUPLEX-03 as item 6 and merge DUPLEX-NOISE-01 into it. Reduce DUPLEX-07 to item 8. Keep STT-SMARTTURN-01 as the
speculative start only (its endpointer half is already DUPLEX-02's). Pull CHAT-TYPEAHEAD-01's voice half forward as item 2.
DUPLEX-01: `reply_pause`, `reply_resume` and `played_ms` already run on the wire; check what the spec still lacks and trim the
row to that. DUPLEX-04 stays removed. Nothing is dropped outright.

## 4. Risks and unknowns, one measurement each

1. Smart Turn may decide slower than the 0.75 s timer (TurnBench: about 1 s). Measurement: item 3's median decision latency.
2. A speculative run still generating may hold the engine slot when the real turn starts. Measurement: confirmed
   `first_token_ms` with speculation on against off, 20 turns each.
3. Whole-utterance re-decode grows with length. Measurement: decode time against utterance length, 2 to 25 s, before and
   after item 1.
4. Echo on Safari, Firefox, Android and the iPhone PWA is unmeasured; the WebKit crackle bugs may force pause-only there.
   Measurement: DUPLEX-00's remaining rows.
5. Earlier pauses may bring back the 2026-10-30 oversensitivity. Measurement: item 6's false-stop count on the control set
   and DUPLEX-NOISE-01's repeat-question check.
6. Children's speech (short bursts, long thinking pauses, higher pitch) may break end of turn and the transcript.
   Measurement: the bench's children's rows with demo voices, end-of-turn errors and word errors counted separately.
7. One 4B judge serves the quick reaction, delivery choice and now completeness. Measurement: p95 queue wait on the judge
   route during a call.
8. Browser frame size may delay the first voiced frame by 50 to 100 ms (unknown). Measurement: frame length in
   `mic-capture.ts` and the time from first voiced sample to the `vad` event.

## 5. What I am not sure about

- Whether `splitReadyChunks` already releases a clause first; item 5 may be a check rather than a change.
- Whether `@maipai/spec` already declares `reply_pause`, `reply_resume` and `played_ms`; DUPLEX-01 may be mostly done.
- Bobby's stop detector: what it is, its threshold and its false-stop rate. His 1.3 s is one call; the 12.5 s the day before
  says his chain is sensitive to warmth, as ours is.
- Which chat model is live today and its warm first token on the Studio; the tier bench numbers come from four candidates on a
  loaded machine.
- Whether llama-server frees a slot fast enough on cancel for item 4 to pay off; item 4's exit number decides.
- Whether the 4B text completeness check is good enough to beat the timer; the TurnBench run decides, and if both candidates
  lose, a new end-of-turn model is a Jesse decision under the "no new model" answer.
