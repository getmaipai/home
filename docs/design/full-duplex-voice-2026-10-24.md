# Full-duplex voice: listen while speaking, in the app and on the robot (2026-10-24)

Owner's request (Jesse, 2026-10-24): design full duplex, where Home keeps listening while it speaks, handles interruptions naturally
and carries on, for local chats and for robots like StackChan. He forwarded an outside recommendation (MiniCPM-o 4.5, Kyutai Moshi,
NVIDIA PersonaPlex) and said to change models if a different one fits better. Design only; nothing here is built.

Architect verdict: not yet run. Needs one before any slice is built. No rule change is asked for (section 2 shows why that is the point).

## Answer

1. **Build duplex as a layer over the turn engine, not as a new model that talks.** Every full-duplex speech model found is a
   monolithic brain-and-voice: it decides the words and speaks them in its own voice. Home cannot let that happen. Rule 0 (age and
   surface gates outrank everything) and the output gate act on text before it is spoken; rule 14 picks the companion voice per
   request; the household and robot voices are Chatterbox clones chosen by ear (`bot` StackChan voice note); search, memory and
   tools belong to the turn engine; and the stored reply is the heard prefix (RULES.md chat turn, the voice reply the person interrupts; `heardVisibleEnd`). A model that speaks
   from its own head skips all of that.
2. **What the layer does** (section 3): keeps the microphone open while speaking with the echo removed, sorts what it hears during
   playback into stop, backchannel, take over or background, stops speech in under 300 ms, and commits only what was heard.
   This works on every surface that speaks, with the models Home already runs.
3. **Models stay in play as a measured option, not the plan** (section 4). A bench decides whether any of them earns a place as the
   turn-taking controller (listening and timing only, its audio output unused) or, if Jesse rules it, an adult-only free-talk mode.
   Of the outside list, MiniCPM-o 4.5 and Moshi stay; PersonaPlex stays with a licence check; **NemotronLabs VoiceChat 11B** is added
   because it is newer than the list and was built for tool calls.
4. **The robot needs one firmware change, and nothing else is on the unit.** StackChan sends no microphone audio while it speaks
   today; its audio front end already has echo cancellation with a playback reference, so the change is to keep streaming that
   cleaned audio (section 5).

## 1. What exists today (read 2026-10-24)

- **Listening:** `GET /api/stt/stream` (WebSocket, 16 kHz mono float32 frames in; `ready`, `vad`, `partial`, `final`, `no_speech`,
  `error` out). `SttSession` does Silero VAD with the legacy hub's tuned numbers; Smart Turn endpointing is a queued row
  (STT-SMARTTURN-01). The robot uses the same route.
- **Speaking:** `sentenceSpeechScheduler` plays a reply sentence by sentence. `stop()` records `heardVisibleEnd()`, and
  `cancelTurn(turnId, heard)` stores only the heard part.
- **Barge-in in the app:** `liveVoiceSession.tsx` interrupts on the server's `vad speaking:true` after a 400 ms arm delay, behind
  `voiceBargeIn`. It has no echo reference, so it relies on the browser's echo cancellation and the arm delay. Any speech stops the
  reply, a cough or an "mm-hm" included.
- **Barge-in on the robot:** none. While speaking, the unit turns voice processing off and arms only its wake word; a detection
  aborts speech. The on-unit stop word is firmware patch 049 (`stackchan-spoken-stop-2026-10-21`). `robot.barge_in.open_mic` is a
  device setting that exists, with no duplex behind it.
- **Written down, never built:** VOICE-LOOP-01 (0.6 s confirm, stop phrases bypass, backchannels never stop, duck 0.35 without
  echo cancellation and 0.75 with, 0.25 s playout slices, 0.7 s re-arm grace, self-echo at 0.8 overlap) and dev.md item 12
  (fillers only when a tool is predicted to take over a second, barge-in cancels inference and reconciles history).

## 2. Why not make a duplex model the voice

| Home needs | A monolithic duplex model |
|---|---|
| The text passes the age band and output gate before anyone hears it (rule 0) | Speaks audio directly; there is no text to gate first |
| Companion voice by request, household voice, the robot's chosen clone | One built-in voice set (PersonaPlex 18 presets; Moshi one) |
| Search, memory, lists, tools through the turn engine | Own tool path at best (Nemotron), never ours |
| A child's or teen's spoken turn keeps its limits | No such limits to apply |
| Stored reply = what was heard | Not exposed |
| Robot complete without the hub (principle 2) | 7B to 11B, hub only |

Because of this the plan keeps the cascade (listen, think, speak) and makes it behave like a duplex conversation.

## 3. The duplex layer

One session, same for the app and the robot, additive on the existing wire (the API rule: additions only).

1. **Listen all the time.** The microphone stays open during playback. The client sends audio and a playback marker (what it is
   playing, when). The hub keeps the played audio as the echo reference. The browser uses its platform echo cancellation; the robot
   uses its front end (section 5). Whatever remains is checked against the reference by overlap (VOICE-LOOP-01's self-echo test).
2. **Sort what it hears while Home speaks.** A small overlap classifier on the existing VAD and partial transcripts, four outcomes:
   - **stop:** a stop phrase ("stop", "wait", "hang on", the robot's name plus stop) or a spoken sentence of four words or more.
     Playback stops within 300 ms, the unplayed part is dropped, the heard prefix is committed, and the new speech becomes the next turn.
   - **backchannel:** "mm-hm", "yeah", "okay", a laugh, a cough. Speech ducks to the 0.35 level for the length of it and carries on.
     Never stops, never becomes a turn.
   - **take over:** the person starts a full thought while Home is mid-sentence. Same as stop, plus the reply is not resumed.
   - **background:** a second voice, TV, or low-confidence noise. Ignored; the robot's face may show it heard something.
   Smart Turn (STT-SMARTTURN-01) decides when the person has finished, so a pause to think does not hand the turn back to Home.
3. **Resume or stay stopped.** After a stop that was a question about the reply ("wait, which one?"), the next reply may pick up
   from the heard prefix. After a take over it does not. The turn engine gets the heard prefix as context, as written chat does today.
4. **Fillers, narrowly.** Home speaks a short acknowledgement only when a tool is predicted to take over a second (dev.md item 12),
   in the companion's voice, passing the same gate as any reply. No filler on a plain answer.
5. **Gates unchanged.** The classifier decides when audio plays or stops, never what is said. A child's or teen's spoken turn keeps
   its limits; duplex adds no path that speaks unreleased text.

## 4. Model options and the bench

Facts below are from the model cards and papers as found 2026-10-24; anything marked "check" is not confirmed.

| Model | What it is | Mac path | Licence | Fit |
|---|---|---|---|---|
| [NemotronLabs VoiceChat 11B](https://arxiv.org/abs/2609.21967) | Released 2026-07-21. Nano v2 9B language model, streaming speech encoder, streaming TTS decoder, a separate tool-call output stream. 82.5% tool-selection F1, resumes after backchannels 93% of the time (paper). About 450 ms turn-taking (a review) | [mlx-audio](https://github.com/Blaizzy/mlx-audio) lists a 4-bit build; the official path is vLLM on large GPUs | OpenMDW 1.1 on the card; coverage disagrees on research-only (check) | Best at tools and at backchannels; own voice; hub only |
| [PersonaPlex 7B](https://github.com/mu-hashmi/personaplex-mlx) | NVIDIA, built on the Moshi design; text prompt sets the persona; 18 voice presets | Community MLX port, `-q 4`; its clients have no echo cancellation | Code MIT; weights NVIDIA Open Model License (check commercial terms, Jesse may sell) | Persona control; no tools |
| [Kyutai Moshi 7B](https://github.com/kyutai-labs/moshi) | The original; 160 ms theoretical, about 200 ms measured on a GPU | Official MLX, int4 and int8 | Weights CC-BY 4.0 | Fastest and most mature runtime; the card says nothing on persona or tools, so assume none (measure) |
| [MiniCPM-o 4.5](https://huggingface.co/openbmb/MiniCPM-o-4_5) | About 9B on Qwen3-8B with speech and vision; the strongest text brain of the four | `llama.cpp-omni`, a separate fork, 16 GB for Q4 or Q8 | Apache 2.0 (two secondary sources, check the card) | Official Mac story, English and Chinese; its camera stream would break the robot-vision rule (a picture is looked at once and dropped), so vision stays off |

The outside list was right on its three names. It missed Nemotron, and "official Mac deployment" for MiniCPM-o means the omni fork,
not mainline llama.cpp.

**Bench (DUPLEX-BENCH-01), run on the Studio when the chat model is idle** (resource order: chat, images, video, then everything else).
Same scripted conversations for the layer and for each model used as controller only, audio output discarded:

| Measure | Pass |
|---|---|
| Time from a real interruption to silence | at most 300 ms |
| Backchannels wrongly stopping speech | under 5% of 100 |
| Own echo mistaken for the person (robot speaker, 1 m) | 0 in 50 lines |
| Wrong takeovers by a second voice or TV | under 5% |
| End-of-turn delay against today's silence timer | no worse |
| Memory held beside the chat model | recorded, must not push chat out |

A model earns a place only if it beats the layer's own classifier on the first four and fits the fifth. The likely outcome is that
the layer passes alone and the models are not adopted; the bench exists so that is measured, not guessed.

## 5. The robot

- **Today:** speaking turns voice processing off and sends nothing; only the wake word can interrupt.
- **Change (bot repo, its own design note):** in the Speaking state keep the front end's echo cancellation on, using the playback
  reference the CoreS3 codec already provides, and stream the cleaned microphone audio to `/api/stt/stream` like in listening.
  Memory is tight (internal RAM minimum seen 12.5 KB), so the change is measured on the unit first and ships only if the minimum
  stays above the figure the spoken-stop note sets. The host additionally holds the played audio for the overlap check.
- **Ladder:** with a hub, full duplex; hub unreachable, the wake word and the on-unit stop word as now (principle 2). A robot never
  loosens a gate to answer faster.
- **Settings:** `robot.barge_in.open_mic` is the existing device switch; the new levels (off, stop only, full) are an additive
  value set on it, spec first, with no new status screen (the existing robot state shows "heard you" through its face).

## 6. Slices

1. **DUPLEX-01 (S, spec first):** playback marker and overlap events (`playback`, `overlap` with the four outcomes) in the voice
   spec, pin bump.
2. **DUPLEX-02 (M):** the overlap classifier in `SttSession`, fed by the playback reference, with fixture audio for each outcome
   and a real failure test for each wrong stop.
3. **DUPLEX-03 (M):** the app: duck, stop within 300 ms, heard-prefix commit, resume after a clarifying stop; `voiceBargeIn` becomes
   the duplex level.
4. **DUPLEX-04 (M, `bot`):** the Speaking-state audio stream with echo cancellation; unit memory measurement first.
5. **DUPLEX-05 (S):** narrow fillers for slow tools.
6. **DUPLEX-BENCH-01 (M):** section 4, the one place a model can join.
Order: 01, 02, 03, bench in parallel with 04, then 05. Codex first for 02 and 03 (decided and testable); the bench is run here.

## 7. Legacy verdicts (rule 8)

- Legacy barge-in numbers (VOICE-LOOP-01): **kept as starting values**, re-measured by the bench.
- Legacy browser hands-free thresholds (`useHandsFree.ts`): **dropped**; the server VAD already decides.
- Legacy "listen only after the reply ends": **dropped** once DUPLEX-03 lands.

## Open for the owner

One decision: whether to ever allow a free-talk mode where an adult talks to a duplex model directly with its own voice and no
output gate. That would break rule 0's text gate and needs a rule change, so this design does not assume it. Default: no.
