# Full-duplex conversation from proven patterns only (2026-10-24, fifth design)

Owner's request (Jesse, 2026-10-24): the capability of full duplex with Home's own brain, voices and filters, in the app and on robots
like StackChan; then, after a review: "research more and only build on an existing proven pattern." This version keeps a mechanism only
if someone ships it (or Home's own firmware or code already does) and names the source. Everything else moved to "Not in this design".
Four earlier versions are in git history. Design only; nothing here is built.

Architect verdict: not yet run. Needs one before any slice is built. No rule change is asked for.

## Answer

1. **Duplex behavior on a cascade (listen, think, speak) is shipped practice.** Pipecat, LiveKit Agents and Kyutai's Unmute do it; OpenAI's
   Realtime API uses the same stop-and-truncate contract. Home keeps its brain, voices and gate because the words still come from the
   turn engine and only the timing logic changes.
2. **Browser first, using the settings those systems document.** Section 3. The one open risk is echo: Chrome's canceller is reported to
   use only WebRTC or media-element audio as its reference, and Home plays replies through Web Audio. The proven workaround is a local
   WebRTC loopback (used by Mozilla Hubs). Step zero measures whether Home needs it.
3. **iPhone and iPad PWA: pause-only until measured.** Open WebKit bugs describe crackling and degraded audio with the microphone open.
4. **Robot: turn on what the firmware already has, then measure.** Section 4.
5. **No new model is trained or hosted** (owner's answer, 2026-10-24: rules only). Two existing small components are adopted: Silero
   (already in) and Smart Turn v3.2 (one pinned version, as STT-SMARTTURN-01 names it).
6. **Who gets it.** Adults first. Jesse ruled on 2026-10-14 that he wants natural full duplex for everyone, adults, teens and children,
   and that it needs a RULES.md change by his word (filed then as VOICE-DUPLEX-01, an id that is not in the repo). CHAT-PARITY-05 still
   says child profiles do not enable a continuous microphone. Teens and children stay on the current path until Jesse gives that
   word for this design; the Supersedes section below names the clause that then changes.
7. **Reuse check (why not adopt Pipecat or LiveKit Agents as the controller).** Both are Python pipeline frameworks that own the
   whole turn (STT, model, TTS, transport) and LiveKit's best interruption model is hosted. Home's turn engine, gate, voices and
   package host already own those steps; a second controller would be a second definition of the turn (platform principle 1). Their
   settings and behaviors are copied, not their code.

## 1. What exists in Home today (read 2026-10-24)

- `GET /api/stt/stream` with Silero VAD in `SttSession`; partials re-send the whole utterance every 1.5 s. `sentenceSpeechScheduler`
  plays Chatterbox sentences with `heardVisibleEnd()` and `cancelTurn(turnId, heard)`. `voiceBargeIn` (400 ms arm delay, any speech
  stops the reply) in `liveVoiceSession.tsx`. Smart Turn is a queued row (STT-SMARTTURN-01).
- Robot: the bridge already accepts microphone uplink while the reply speaks when the session reports `features.aec: true`
  (`bot/docs/dev/stackchan-service.md`, "Duplex and barge-in"), counts `abort_to_silence_ms` and `first_audio_ms`, and the firmware has
  a realtime listening mode (`kListeningModeRealtime`, seen in firmware patch 014). The doc says no physical AEC quality or latency has
  been verified.

## 2. The proven patterns this design copies

| Pattern | Who ships it | Source | Used here |
|---|---|---|---|
| Stop playback and cancel in-flight text generation and speech synthesis when the person speaks; flush audio generated but not yet played | Pipecat | [interruptions](https://docs.pipecat.ai/pipecat/fundamentals/interruptions) | Interruption path (DUPLEX-03) |
| The saved context holds only the text actually spoken | Pipecat (output synced with playback); OpenAI Realtime (client stops, then sends `conversation.item.truncate` with `audio_end_ms`; community reports it can lag when the server sends audio faster than playback) | Pipecat page above; [thread](https://community.openai.com/t/realtime-api-interruptions-dont-properly-trim-the-transcript/1000703) | Home already does this (`heardVisibleEnd`, `cancelTurn`); keep it |
| Ignore short acknowledgements: minimum speech of 0.5 s, optional minimum words (Pipecat example: 3) | LiveKit `interruption.min_duration` 0.5 s, `min_words`; Pipecat `MinWordsUserTurnStartStrategy` | [LiveKit tuning](https://docs.livekit.io/agents/logic/turns/tuning.md), Pipecat page | First backchannel rule (version 1) |
| Learned filter for "uh-huh" versus a real interruption | LiveKit adaptive mode (hosted model, LiveKit Cloud only); Pipecat Krisp (commercial) | [LiveKit adaptive](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling.md) | Not used: both are hosted or commercial. Rules first. |
| For the first second after the agent starts speaking, use plain voice detection so real barge-ins get through | LiveKit turn-boundary cooldown (1.0 s) | LiveKit adaptive page | Same rule |
| Resume the interrupted speech when no transcript follows within a timeout (2.0 s), no regeneration | LiveKit `resume_false_interruption`, `false_interruption_timeout` 2.0 s; needs pausable audio output, and one forum report saw no difference with it on or off | [LiveKit tuning](https://docs.livekit.io/agents/logic/turns/tuning.md), [forum](https://community.livekit.io/t/with-the-new-adaptive-interruption-feature-im-seeing-the-same-agent-interruption-behaviour-resume-false-interruption-true-or-false/776) | Pause and resume (DUPLEX-03); the bench checks it |
| End of turn from audio, not a silence timer | Pipecat default Smart Turn v3 (BSD-2, 8 MB on CPU, 10 to 100 ms, up to 8 s of 16 kHz audio, 23 languages); Kyutai STT predicts "done talking" | [smart-turn](https://github.com/pipecat-ai/smart-turn), [Pipecat](https://docs.pipecat.ai/server/utilities/turn-management/user-turn-strategies), [Kyutai](https://kyutai.org/stt) | DUPLEX-02 (pulls STT-SMARTTURN-01 forward) |
| Start the text model on the transcript before the turn is confirmed; text-to-speech not started early; skip for long utterances (10 s); at most 3 retries | LiveKit preemptive generation | LiveKit tuning page | Early start (DUPLEX-04), only when the chat model is idle |
| Cancel in-flight tool calls on interruption | Pipecat | Pipecat page | Clean repair (DUPLEX-04) |
| Hybrid controller: fast voice onset, reversible playback, speculative generation held privately | Voice-Light research prototype (36 turns, median 758 ms from endpoint to first audio; its learned end-of-turn model recalled 12.5% of turn ends, Silero timing 95.6%, so it kept the hybrid) | [arXiv 2609.20995](https://arxiv.org/abs/2609.20995) | Evidence for rules over a learned model; not a shipped product |
| Make Web Audio output reach Chrome's echo canceller: route it through a local pair of `RTCPeerConnection`s into an `<audio>` element | Mozilla Hubs (reported), guidance in Atmoky's docs; Chrome treats this as not a bug | [Atmoky](https://docs.atmoky.com/known-issues), [W3C list](https://lists.w3.org/Archives/Public/public-webrtc-logs/2019Apr/0334.html) | Browser echo, only if step zero shows it is needed |
| Delay microphone audio a few seconds after the stream opens so the canceller can settle | A developer report (one anecdote) | [dev.to](https://dev.to/hamedhajiloo/how-i-fixed-a-web-audio-echo-problem-with-a-5-second-delay-384h) | Do not allow interruptions for the first seconds; the bench measures it |
| Full-duplex AEC mode for the robot's chip | Espressif ESP-SR documents AEC modes for speech recognition, full-duplex dialogue and VoIP, and recommends `AEC_MODE_FD_LOW_COST` for full duplex | [ESP-SR AEC](https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/acoustic_echo_cancellation/README.html) | Robot spike |

## 3. Browser app and PWA

1. **Step zero, before any code (DUPLEX-00, S):** play a reply through the current Web Audio path with `echoCancellation: true` on
   desktop Chrome, Safari and Firefox, and Android Chrome, and measure how much of Home's own voice reaches the microphone (record the
   microphone track). This decides whether the loopback workaround below is needed. Nothing else in this section assumes the answer.
2. **If Chrome does not cancel Web Audio output:** play replies through the local `RTCPeerConnection` loopback into an `<audio>`
   element (the Mozilla Hubs pattern), on Chromium only.
3. **Settings copied from LiveKit and Pipecat, as starting values:** speech must last 0.5 s over Home's voice before it counts; during
   the first 1.0 s after Home starts speaking, plain voice detection decides; stop words and a minimum of three words bypass the 0.5 s
   (Pipecat's example value; the stop-word bypass is Home's own VOICE-LOOP-01 behavior, already tuned on the robot). A sound that stays
   under 0.5 s with no transcript for 2.0 s is a false interruption and playback resumes from where it was.
4. **Pause, then decide.** On detection, playback pauses (pausable output is a LiveKit requirement; the browser player must support
   it). If the person kept talking, drop the unplayed sentences, store the heard prefix (already built) and take the new speech as
   the next turn. If not, resume.
5. **Smart Turn v3.2 decides when the person has finished**, replacing the silence timer, with the existing Silero VAD in front, and
   keeping STT-SMARTTURN-01's own parameters: an 800 ms reopen window, the Silero hysteresis it names, and the flag
   `stack.engines.stt.smart_turn`, off until measured.
6. **iPhone and iPad:** the open WebKit bugs [326286](https://bugs.webkit.org/show_bug.cgi?id=326286) (playback crackles with the
   microphone open and echo cancellation on; filed as an iOS 26.2 to 27 regression) and
   [311451](https://bugs.webkit.org/show_bug.cgi?id=311451) (audio degrades once the microphone is on) mean the iPhone PWA runs
   **pause-only until it is measured**: the person can stop Home by speaking after Home finishes its sentence or with the on-screen
   control, and headphones are the supported way to talk over it. No fix or home-screen difference was found in the sources.
7. **Android Chrome:** the same as desktop, measured on a real device.

## 4. Robots (StackChan first)

- **What is proven:** the unit's firmware is xiaozhi-esp32 (MIT) and has a realtime listening mode; Espressif documents a full-duplex
  AEC mode for the chip; the bridge already takes uplink during speech when the session reports AEC and measures abort-to-silence.
- **What is not proven:** that the unit's echo cancellation is good enough for the person's speech while its own speaker is on. The
  repo's docs say so themselves.
- **Spike (DUPLEX-05, M):** enable the realtime listening mode with the full-duplex AEC mode on one unit, report `features.aec`, and
  record: internal RAM minimum (12.5 KB seen), abort-to-silence, and how often its own speech is taken for the person. The existing
  on-unit stop word (patch 049) stays as the fallback.
- **Ladder:** hub reachable and the spike passed, duplex; otherwise the wake word and stop word as now (principle 2). A robot never
  loosens a gate to answer faster. Voice unchanged: its chosen Chatterbox voice.

## 4b. Privacy and what is recorded

- The loopback uses no STUN or TURN servers (`iceServers: []`) and only local candidates, so it adds no outbound connection (PRIVACY.md).
- DUPLEX-00's microphone recordings and the bench's audio stay in `data-scratch` with the demo voice, never in git. Robot and bench
  logs carry counts and timings only, never transcripts (rule 6a).
- Pause, resume and stop show through the shipped `voice-conversation.tsx` Element's states and props. Any new state is a `commons`
  kit prop first (rule 9c); Home adds no wrapper and no `className`.

## 5. Gates and voices

Unchanged. Every spoken sentence is a sentence the turn engine released after the age band and output gate (rule 0), in the voice
chosen for the person, companion or robot (rule 14). All of the above act on when audio plays or stops, never on what is said. A
child's or teen's spoken turn keeps its own limits.

## 6. Not in this design (no shipped example found)

- Duplex speech models (Moshi, PersonaPlex, NemotronLabs VoiceChat, MiniCPM-o) as the voice, the timing signal or a conductor.
- A voice-activity-projection model (research only; licence unchecked).
- Home saying "mm-hm" or "go on" while the person talks.
- A 200 ms fade-and-pause threshold; hub-side echo cancellation against audio sent over Wi-Fi; a speaker level cap; resuming a held
  reply after a clarifying question.
- Duplex on iPhone with the speaker (until the WebKit bugs are measured).
Each can come back as its own item if someone ships it or a measurement of ours shows it works.

## 7. Slices

1. **DUPLEX-00 (S):** step zero, the echo measurement per browser and device.
2. **DUPLEX-01 (S, spec first):** playback marker, pause, resume and stop events; the `duplex` value on `robot.barge_in.open_mic`; pin bump.
3. **DUPLEX-02 (M):** Smart Turn v3 in `SttSession` and the settings in section 3.
4. **DUPLEX-03 (M):** pause, resume, stop and heard prefix in the browser player; the echo check; the loopback only if DUPLEX-00 says so.
5. **DUPLEX-04 is removed from this design.** Early start is STT-SMARTTURN-01's speculative turn start and is a latency feature, not
   duplex. It is built on the existing turn route and its cancel, with no new `turnMachine` code (that would be a rule 9 named gap,
   which only Jesse adds). Its guard applies: a speculative start is side-effect free until committed (no memory write, no tool with
   effects), and nothing is released, spoken or stored until the turn is confirmed (rules 9 and 10). Cancelling an in-flight tool on
   interruption uses the same existing cancel.
6. **DUPLEX-05 (M, `bot`):** the robot spike.
7. **DUPLEX-BENCH-01 (M):** a recorded rig: interruptions, "mm-hm" and second voices played at timed offsets into the browser and beside the unit; median and 95th percentile of stop time, wrong stops, wrong resumes, own speech taken for the person, and Home talking over the person.
Order: 00 and 01, then 02 and 03, 05 in parallel, then the bench. Codex first for 02 and 03.

## 8. Legacy verdicts (rule 8)

- VOICE-LOOP-01 numbers: **kept** where section 3 names them (stop-word bypass), re-measured by the bench.
- Legacy `useHandsFree.ts` thresholds: **dropped**. Legacy "listen only after the reply ends": **dropped** once DUPLEX-03 lands.

## Supersedes

- `voiceBargeIn`'s rule in `liveVoiceSession.tsx` that any speech after a 400 ms arm delay stops the reply: **replaced** by section 3 (0.5 s of speech, a 1.0 s cooldown, pause then decide).
- The silence-timer end of turn in `sttSession.ts`: **replaced** by Smart Turn v3.2 (section 3).
- STT-SMARTTURN-01: **absorbed** into DUPLEX-02; its 800 ms reopen window, Silero hysteresis and off-until-measured flag are kept; its speculative start stays its own item (see DUPLEX-04 above).
- VOICE-LOOP-01's barge-in numbers: 0.6 s confirm is **replaced** by 0.5 s (LiveKit's default, re-measured); "stop phrases bypass" and "backchannels never stop" are **kept**; duck 0.35 and 0.75, the 0.7 s re-arm grace and the self-echo at 0.8 overlap are **dropped** for the browser (pause replaces duck; the bench measures the rest) and **kept** for the robot until its spike reports.
- "Listen only after the reply ends": **dropped** once DUPLEX-03 lands.
- CHAT-PARITY-05's clause that child profiles do not enable a continuous microphone: **unchanged** by this design; it changes only if Jesse gives his word to extend duplex to children (2026-10-14 ruling), by his rule change.
