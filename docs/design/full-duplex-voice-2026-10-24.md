# Full-duplex conversation on Home's own brain, voices and filters (2026-10-24, third design)

Owner's request (Jesse, 2026-10-24): "I just want the capability of full duplex, but we need our brain, our voices, our filters,
etc." A true full-duplex conversation, listening while speaking and handling interruptions naturally, in the app and on robots like
StackChan. The words stay the turn engine's, the age band and output gate stay in front of every spoken sentence, the voice stays the
household, companion or robot voice. This replaces two earlier versions of this note (a plain listening layer, then a duplex model as
the voice); both are in git history. Design only; nothing here is built.

Architect verdict: not yet run. Needs one before any slice is built. No rule change is asked for.

## Answer

1. **Full duplex is a behavior, built around the cascade Home already has.** The duplex models that exist (Moshi, PersonaPlex, MiniCPM-o,
   NemotronLabs VoiceChat) combine hearing, thinking and speaking in one network, which would replace the brain, the voices and the
   filters. Home keeps those three and adds what makes those models feel alive: continuous hearing, backchannels, pausing and
   resuming, early starts and clean repairs.
2. **Eight capabilities** (section 2) make up the behavior. Each is testable on its own and works the same in the app and on the robot.
3. **A "conductor" decides the timing.** It is a small decision component that hears both sides and decides: yield, duck, hold,
   backchannel, take the turn. It starts as a rule-based classifier on the existing voice activity and transcripts. A full-duplex
   model can replace it only as a conductor (its listening and timing outputs used, its audio and words discarded), and only if the
   bench (section 5) shows it beats the classifier. Words and voice never come from it.
4. **The robot needs one firmware change:** keep sending cleaned microphone audio while it speaks (section 4).

## 1. What exists today (read 2026-10-24)

- Listening: `GET /api/stt/stream` (16 kHz mono in; `ready`, `vad`, `partial`, `final`, `no_speech`, `error` out). `SttSession`
  runs Silero VAD with the legacy hub's tuned numbers. Smart Turn endpointing is a queued row (STT-SMARTTURN-01). The robot uses the
  same route.
- Speaking: `sentenceSpeechScheduler` plays Chatterbox sentences one by one. `stop()` records `heardVisibleEnd()` and
  `cancelTurn(turnId, heard)` stores only the heard part.
- App barge-in exists behind `voiceBargeIn` (400 ms arm delay, any speech stops the reply, no echo reference).
- Robot: no barge-in. In the Speaking state the microphone stream is off; only the wake word can abort (firmware patch 049 adds an
  on-unit stop word). `robot.barge_in.open_mic` is a device setting with no behavior behind it.
- Written down, never built: VOICE-LOOP-01 (0.6 s confirm, backchannels never stop, duck 0.35 without echo cancellation and 0.75 with,
  0.25 s playout slices, 0.7 s re-arm grace, self-echo at 0.8 overlap) and dev.md item 12 (fillers only when a tool will take over a
  second; barge-in cancels inference and reconciles history with what was heard).

## 2. The eight capabilities

1. **Hearing while speaking.** The microphone stays open during playback. The client marks what it is playing and when; the hub keeps
   that audio as the echo reference. Browser: platform echo cancellation. Robot: its audio front end (section 4).
2. **Telling the sounds apart.** While Home speaks, what it hears is one of: a *stop* (a stop phrase, or a sentence of four words or
   more), a *backchannel* ("mm-hm", "yeah", a laugh, a cough), a *take-over* (a new thought started over Home), or *background* (a
   second voice, TV, noise). Each has its own response (items 3 and 4).
3. **Yielding fast.** On a stop or take-over, audio stops within 300 ms. Playback runs in 0.25 s slices so a stop never waits on a long
   buffer. Unplayed sentences are dropped and the heard prefix is stored.
4. **Backchannel without losing the floor.** On a backchannel Home ducks to 0.35 for its length and carries on. It never becomes a
   turn.
5. **Pause and resume, not only cancel.** A stop that is a question about the reply ("wait, which one?") holds the generated reply
   instead of discarding it. After the person's turn is answered, Home may return to it ("as I was saying") from the sentence it was
   in. A take-over discards it. The turn engine gets the heard prefix as context, as written chat does today.
6. **Home can listen back.** While the person speaks a long thought, Home may give a short backchannel in the speaking voice ("mm-hm",
   "I see", "go on") at a natural pause, not on every pause. These are a closed list per voice, rendered ahead of time by the same
   voice engine, so each one is that voice, and each passes the output gate once at install (a closed list needs no live check).
   Never for a child's or teen's account beyond "mm-hm"; never while the person is mid-word.
7. **Starting early.** The turn begins from the streaming transcript before the person has certainly finished (speculative start, the
   STT-SMARTTURN-01 reopen window). If they keep talking, the in-flight turn is cancelled or replaced (dev.md item 11) and nothing
   was spoken. The first sentence is held until the end of turn is confirmed, so no half-formed answer is ever heard.
8. **Clean repair.** If the person cuts in during a lookup, the turn engine cancels the lookup and folds the new speech into the same
   question. A short acknowledgement ("one sec") is spoken only when a tool is predicted to take over a second (dev.md item 12), in the
   companion's register and through the gate, like any reply.

All eight act on audio timing. None of them changes what is said: every spoken sentence is a sentence the turn engine released after
the age band and output gate (rule 0), in the voice chosen for the person, companion or robot (rule 14). A child's or teen's spoken
turn keeps its own limits.

## 3. The conductor

- **Inputs:** the person's voice activity and partial transcripts, the playback marker, what Home is saying and which sentence it is in,
  the turn state (thinking, speaking, waiting), the person's band.
- **Outputs:** one of `continue`, `duck`, `hold`, `yield`, `take_turn`, `backchannel(kind)`, with a reason, as events on the
  existing wire (additive, spec first).
- **Version 1: rules.** Silero VAD, partials, a stop-phrase list, a backchannel list, Smart Turn for end of turn, and the numbers in
  section 1. No new model.
- **Version 2, only if the bench says so: a duplex model as the conductor.** Feed it the same audio, discard its speech, read its
  turn-taking signals. The candidates and what is known (checked 2026-10-24):

| Model | What the conductor would use | Unconfirmed |
|---|---|---|
| [NemotronLabs VoiceChat 11B](https://arxiv.org/abs/2609.21967) | Pause handling, takeover after interruptions, 93% resume after backchannels (its paper); streaming user transcription head ([arXiv 2609.15759](https://arxiv.org/abs/2609.15759)); 4-bit MLX build in [mlx-audio](https://github.com/Blaizzy/mlx-audio) | Licence (OpenMDW 1.1 on the card; coverage disagrees on research-only); how to read signals without its speech |
| [PersonaPlex 7B](https://github.com/mu-hashmi/personaplex-mlx) | Moshi-family timing, community MLX port | Weights under the NVIDIA Open Model License (commercial terms to check, Jesse may sell) |
| [Moshi 7B](https://github.com/kyutai-labs/moshi) | Official MLX int4 and int8, about 200 ms, weights CC-BY 4.0 | Whether its state is readable apart from speech |
| [MiniCPM-o 4.5](https://huggingface.co/openbmb/MiniCPM-o-4_5) | Apache 2.0 per two secondary sources, full-duplex on Macs through the `llama.cpp-omni` fork | A fork, not mainline; vision must stay off (a picture is looked at once and dropped) |

  Memory is not the constraint (the Studio has 128 GB); the rank in resources is: chat first, images, video, then everything else.
  A conductor model runs only during a live voice session, on a free seat, and the rule-based conductor takes over when none is free.
- **Why a model might still win:** it can learn that "yeah, but..." is a take-over and "yeah." is not, and that a long pause after
  "um" is not the end of a turn. That is what the classifier is weakest at. The bench measures it instead of assuming it.

## 4. Robots (StackChan first)

- **Today:** the Speaking state turns voice processing off and sends nothing.
- **Change (bot repo, its own design note):** keep the front end's echo cancellation on in the Speaking state, using the playback
  reference the CoreS3 codec already provides, and stream the cleaned microphone audio to `/api/stt/stream` as in listening. Unit memory
  is tight (internal RAM minimum seen 12.5 KB), so it is measured on the unit first and ships only above the figure the spoken-stop
  note sets. The host also holds the played audio for the overlap check.
- **The robot's face** shows that it heard the person (the existing state path; no new status screen).
- **Ladder:** hub reachable, full duplex; otherwise the wake word and the on-unit stop word as now (principle 2). A robot never
  loosens a gate to answer faster.
- **Setting:** `robot.barge_in.open_mic` stays the one device switch; add the value `duplex`, spec first.
- **Voice unchanged:** the robot keeps its chosen Chatterbox voice; backchannels are rendered in it.

## 5. The bench (DUPLEX-BENCH-01)

The same scripted calls (40 adult turns, 10 interruptions, 10 backchannels, 10 noisy-room or second-voice cases, 10 slow lookups
with a cut-in) in the app and on the robot, once with the rule conductor and once per model conductor. Run on the Studio when chat is
idle.

| Measure | Pass |
|---|---|
| Real interruption to silence | at most 300 ms |
| Backchannels wrongly stopping speech | under 5% |
| Take-overs wrongly treated as backchannels | under 5% |
| Pause-for-thought wrongly ending the person's turn | under 5% |
| Own echo taken for the person (robot speaker, 1 m) | 0 in 50 lines |
| Held reply resumed correctly after a clarifying stop | 9 of 10 |
| Speculative starts cancelled with nothing spoken | 100% |
| Words spoken not released by the turn engine | 0 |
| Added delay on a normal turn | none over today's |

The rule conductor ships first. A model replaces it only by passing every row and beating the rules on the three timing rows.

## 6. Slices

1. **DUPLEX-01 (S, spec first):** playback marker, conductor events and the `duplex` device value in the voice spec; pin bump.
2. **DUPLEX-02 (M):** hearing while speaking and the rule conductor in `SttSession`, with fixture audio per case and a failing test
   for every wrong stop.
3. **DUPLEX-03 (M):** the app side: 0.25 s slices, duck, yield, heard prefix, hold and resume; `voiceBargeIn` becomes the duplex level.
4. **DUPLEX-04 (M):** speculative start and clean repair in the turn engine (with STT-SMARTTURN-01).
5. **DUPLEX-05 (M, `bot`):** the Speaking-state audio stream; unit memory measured first.
6. **DUPLEX-06 (S):** listening-back backchannels, rendered per voice, adults first.
7. **DUPLEX-BENCH-01 (M):** section 5; the model conductor is built only after it, as DUPLEX-07.
Order: 01, 02, 03 and 04, then the bench with 05, then 06. Codex first for 02 to 04 (decided and testable).

## 7. Legacy verdicts (rule 8)

- Legacy barge-in numbers (VOICE-LOOP-01): **kept as the starting values**, re-measured by the bench.
- Legacy browser hands-free thresholds (`useHandsFree.ts`): **dropped**; the server voice activity already decides.
- Legacy "listen only after the reply ends": **dropped** once DUPLEX-03 lands.
