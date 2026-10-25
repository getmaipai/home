# Full-duplex conversation on Home's own brain, voices and filters (2026-10-24, fourth design)

Owner's request (Jesse, 2026-10-24): "I just want the capability of full duplex, but we need our brain, our voices, our filters,
etc." Listening while speaking and handling interruptions naturally, in the app and on robots like StackChan. The words stay the
turn engine's, the age band and output gate stay in front of every spoken sentence, the voice stays the household, companion or
robot voice. He doubted that duplex can be done in software without a duplex model and asked for a check with Fable first; the
findings are folded in below. Three earlier versions are in git history. Design only; nothing here is built.

Architect verdict: not yet run. Needs one before any slice is built. No rule change is asked for.

## Answer

1. **Yes, in software, without a new generative model.** Duplex behavior on a cascade is real and shipped: Kyutai's Unmute is its own
   speech-to-text with end-of-turn detection, any text model, and its own streaming voice; LiveKit Agents and Pipecat do the same with
   voice activity, an end-of-turn model and cancelable playback. What makes those feel natural is **timing logic**, not a model that
   speaks. That is what is built here, with Home's brain, voices and filters unchanged.
2. **Pause first, decide second.** The first version of this note said "duck and keep talking". Production systems do not: talking
   over a person at lower volume reads as rude and they miss words. People pause, then resume or stop. The design pauses within about
   200 ms of sustained voice, then resumes from the same sentence if it was a backchannel or stops if it was an interruption.
3. **End-to-end duplex models (Moshi, PersonaPlex, NemotronLabs VoiceChat, MiniCPM-o) are not used, not even as a timing signal.**
   They decide timing together with their own speech; fed Home's voice and words they are out of their training distribution. The
   right learned component is a small voice-activity-projection model (version 2), and the duplex models serve only as a "feel"
   reference in the bench.
4. **The robot is the hard part.** The unit must make the pause decision itself and its echo cancellation is unproven for speech to
   the hub; a spike on the unit comes first.

## 1. What exists today (read 2026-10-24)

- Listening: `GET /api/stt/stream` (16 kHz mono in; `ready`, `vad`, `partial`, `final`, `no_speech`, `error` out). `SttSession` runs
  Silero VAD with the legacy hub's tuned numbers and **re-sends the whole utterance as a WAV every 1.5 s** for partials, so the first
  partial lands 1.5 s plus model time after onset. Smart Turn endpointing is queued (STT-SMARTTURN-01).
- Speaking: `sentenceSpeechScheduler` plays Chatterbox sentences one by one; `stop()` records `heardVisibleEnd()` and
  `cancelTurn(turnId, heard)` stores only the heard part.
- App barge-in exists behind `voiceBargeIn` (400 ms arm delay, any speech stops the reply, no echo reference).
- Robot: in the Speaking state the microphone stream is off; only the wake word can abort (firmware patch 049 adds an on-unit stop
  word). `robot.barge_in.open_mic` is a device setting with no behavior behind it.
- Written down, never built: VOICE-LOOP-01 (0.6 s confirm, backchannels never stop, 0.25 s playout slices, 0.7 s re-arm grace) and
  dev.md item 12 (fillers only when a tool will take over a second; barge-in cancels inference and reconciles history).

## 2. The capabilities

1. **Hearing while speaking.** The microphone stays open during playback with the echo removed (sections 4 and 5 say how, per
   surface). Where it cannot be removed (no working echo cancellation, a Bluetooth speaker), Home falls back to pause-only: it
   still hears the voice onset but does not try to transcribe over its own playback.
2. **Pause first.** On sustained voice activity (about 200 ms) over Home's speech, playback fades out in 50 ms and holds. Playback
   runs in 0.25 s slices, so the hold never waits on a long buffer. The mute decision is local to the surface (browser, unit), the
   hub is told after.
3. **Decide from what the sound is**, not from word counts: how long it lasted, its energy contour, whether it matches a short
   phrase list ("mm-hm", "yeah", "okay", a laugh or cough) or a stop list ("stop", "wait", "no", the robot's name plus stop), and
   whether it **continues past the pause** (a backchannel ends within about 500 ms; an interruption keeps going). Outcomes:
   *backchannel* (resume from the same sentence), *stop or take-over* (drop the unplayed sentences, store the heard prefix, the
   new speech is the next turn), *background* (a second voice or noise: resume).
4. **A fast overlap path.** While Home is paused, a small buffer holding only the overlapping sound is transcribed with a short
   interval (about 0.4 s) for stop-phrase spotting, not the 1.5 s whole-utterance partials. Smart Turn v3 (an audio-only end-of-turn
   model that runs on the CPU) is pulled into this plan from STT-SMARTTURN-01.
5. **Hold and resume.** A stop that is a question about the reply ("wait, which one?") holds the generated reply instead of
   discarding it; after the person's turn is answered Home may return to it from the sentence it was in. A take-over discards it. The
   turn engine gets the heard prefix as context, as written chat does today.
6. **Starting early, only when idle.** The turn can begin from the streaming transcript before the person has certainly finished, but
   only when the local chat model is idle (it is shared with the family). If they keep talking the in-flight turn is cancelled or
   replaced (dev.md item 11) and nothing was spoken: the first sentence is held until end of turn is confirmed.
7. **Clean repair.** If the person cuts in during a lookup, the turn engine cancels the lookup and folds the new speech into the same
   question. A short acknowledgement ("one sec") is spoken only when a tool is predicted to take over a second (dev.md item 12), in
   the companion's register and through the gate.
8. **Listening-back sounds, last and off by default.** A closed list per voice ("mm-hm", "I see") rendered ahead of time by the same
   voice engine, played at a natural pause in a long thought, adults only. Built last because they create the robot's own
   double-talk problem and can misfire on the pause rules.

None of these changes what is said: every spoken sentence is a sentence the turn engine released after the age band and output
gate (rule 0), in the voice chosen for the person, companion or robot (rule 14). A child's or teen's spoken turn keeps its own limits.

## 3. The timing decision, and the one learned model that may help

- **Version 1: rules**, as in capabilities 2 to 4. Silero voice activity, the phrase lists, continuation past the pause, Smart Turn
  for end of turn, the fast overlap path. No generative model.
- **Version 2, only if the bench says rules fall short: a voice-activity-projection model.** This is a small research model family
  (Skantze group; real-time versions run on a CPU with both speakers' audio as input) that predicts turn shifts and backchannel
  windows, which is the signal needed. Its licence and weights are unchecked; that is the first task of the version 2 row.
- **Why not a duplex speech model as the timing signal.** Moshi-family models treat their own generated audio as the "self"
  channel and decide timing together with their own words; given Home's voice and words that state is wrong, and the timing read
  would be a 7B voice detector coupled to a discarded answer, competing with chat for the same GPU (resource order: chat first).
  MiniCPM-o has the same coupling (moderate confidence). There is no supported path for injecting text into these models either.
  They stay in the bench as the reference for how a natural conversation feels, run beside Home, never inside it.
  Facts checked 2026-10-24: [NemotronLabs VoiceChat 11B](https://arxiv.org/abs/2609.21967) (licence OpenMDW 1.1 on its card,
  coverage disagrees on research-only), [PersonaPlex 7B](https://github.com/mu-hashmi/personaplex-mlx) (NVIDIA Open Model License),
  [Moshi 7B](https://github.com/kyutai-labs/moshi) (weights CC-BY 4.0), [MiniCPM-o 4.5](https://huggingface.co/openbmb/MiniCPM-o-4_5)
  (Apache 2.0 per two secondary sources, `llama.cpp-omni` fork).

## 4. The app (browser)

- Capture requests `echoCancellation`, and the session reads `getSettings()` to confirm it is on; if it is off, or the output is a
  Bluetooth speaker (latency defeats echo cancellation), the session runs pause-only with no listening over playback.
- Playback should go through a path the browser's echo canceller can use as its reference (to verify per browser; Safari with
  WebAudio is unreliable, and macOS voice processing already lowers system output, so a Home-side fade is not stacked on top).
- Pause, fade and resume are done in the browser; `liveVoiceSession` keeps `voiceBargeIn` as the level switch and gains the duplex
  level.

## 5. Robots (StackChan first)

- **Today:** the Speaking state turns voice processing off and sends nothing.
- **Mute decision on the unit.** Voice activity on the front end's output stops or fades the amplifier locally; the hub is told
  after. A hub round trip over Wi-Fi cannot meet the 200 ms pause, and the unit's playout buffer must be kept at 150 ms or less.
- **Echo is the unknown.** The front end's echo cancellation is tuned for the wake word; its double-talk handling may mangle the
  person's speech, so its output may be good enough for voice detection but not for transcription. Plan: transcribe the person's
  speech from audio after the pause, when Home is silent. A 1 W speaker at 1 m can clip and a linear canceller cannot remove clipping
  distortion, so duplex mode caps the speaker level. Hub-side cancellation against audio sent over Wi-Fi is not attempted; the hub
  only compares text overlap.
- **Spike first (DUPLEX-05):** on the unit, measure with the front end, echo cancellation, the WebSocket and playback all running:
  internal RAM minimum (12.5 KB seen), CPU, pause latency, false-trigger rate from its own speech at the capped level. Nothing in the
  hub is frozen until the spike reports.
- **Ladder:** hub reachable, duplex; otherwise the wake word and on-unit stop word as now (principle 2). A robot never loosens a gate
  to answer faster. Voice unchanged: its chosen Chatterbox voice. Setting: `robot.barge_in.open_mic` gains the value `duplex`, spec first.

## 6. The bench (DUPLEX-BENCH-01)

A reproducible rig: recorded interruptions, backchannels and second voices played at timed offsets through a second speaker beside
the unit and into the browser mic; reported as median and 95th percentile. Run when chat is idle.

| Measure | Pass |
|---|---|
| Sustained voice to playback faded out | median at most 250 ms, 95th at most 400 ms |
| Backchannels wrongly stopping speech | under 5% |
| Interruptions wrongly treated as backchannels | under 5% |
| Person's pause-for-thought wrongly ending their turn | under 5% |
| Home's own speech taken for the person (robot, capped level) | under 2% of lines |
| Held reply resumed correctly after a clarifying stop | 9 of 10 |
| Speculative starts cancelled with nothing spoken | 100% |
| Words spoken that the turn engine did not release | 0 |
| Home talking over the person (Home starts while they are still speaking) | under 2% |
| Delay on a normal turn against today's | measured with the same rig; no worse at the median |

The duplex models are run beside the rig for a subjective feel comparison only, and are not part of the pass.

## 7. Slices

1. **DUPLEX-01 (S, spec first):** playback marker, pause, resume and stop events and the `duplex` device value in the voice spec; pin bump.
2. **DUPLEX-05 (M, `bot`), the spike, first:** the on-unit measurement above; it decides whether the robot gets duplex or pause-only.
3. **DUPLEX-02 (M):** the fast overlap path, the rule decision and Smart Turn in `SttSession`, with fixture audio per case and a
   failing test for every wrong stop.
4. **DUPLEX-03 (M):** the browser side: slices, fade, pause, resume, heard prefix, hold; the echo check; `voiceBargeIn` becomes the duplex level.
5. **DUPLEX-04 (M):** early start and clean repair in the turn engine, idle-only.
6. **DUPLEX-BENCH-01 (M):** section 6, then DUPLEX-07 (the voice-activity-projection model) only if rules fall short.
7. **DUPLEX-06 (S):** listening-back sounds, last, off by default.
Order: 01 and the spike, then 02 and 03, then 04, then the bench, then 06. Codex first for 02 to 04 once the spike reports.

## 8. Legacy verdicts (rule 8)

- Legacy barge-in numbers (VOICE-LOOP-01): **kept as starting values**, re-measured by the bench.
- Legacy browser hands-free thresholds (`useHandsFree.ts`): **dropped**; the server voice activity already decides.
- Legacy "listen only after the reply ends": **dropped** once DUPLEX-03 lands.
- The earlier "duck and keep talking", "four words means stop" and "duplex model as the timing signal" ideas: **dropped** after the Fable review.
