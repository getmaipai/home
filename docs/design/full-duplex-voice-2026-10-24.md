# Full-duplex conversation from proven patterns only (2026-10-24, fifth design)

Owner's request (Jesse, 2026-10-24): the capability of full duplex with Home's own brain, voices and filters, in the app and on robots
like StackChan; then, after a review: "research more and only build on an existing proven pattern." This version keeps a mechanism only
if someone ships it (or Home's own firmware or code already does) and names the source. Everything else moved to "Not in this design".
Four earlier versions are in git history. Design only; nothing here is built.

Architect verdict: see `data-scratch/architect/DUPLEX-DESIGN-2026-10-24.verdict`. No rule change is needed, including for children (Answer, item 6).

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
   (already in) and Smart Turn v3.2, or whichever end-of-turn model wins the DUPLEX-02 TurnBench scoring (one pinned version).
6. **Who gets it: everyone, children first in importance.** Jesse, 2026-10-24, in chat: "kids need full duplex because kids interrupt a
   lot and dont wait their turn." This matches his 2026-10-14 ruling (natural full duplex for adults, teens and children). Duplex
   changes when audio plays and stops, never what is said, so every age and surface gate, the child output gate and the spoken-turn
   limits are untouched. It supersedes the CHAT-PARITY-05 backlog clause that child profiles do not enable a continuous microphone
   (a backlog clause, not a RULES.md rule). The microphone is open only inside a voice session the child or a parent started, and
   nothing it hears while Home talks is kept beyond the turn it becomes. The architect's ruling: the rulebook has no
   continuous-microphone protection (the only such clause is CHAT-PARITY-05's, a backlog clause Jesse has superseded); duplex changes when
   audio plays, not what is said, and nothing heard is kept beyond its turn, so rule 0 is not engaged and no rule change is needed.
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
| A sound is paused on quickly and resumed if it was not speech (a cough or bump pauses briefly and resumes) | LiveKit `interruption.min_duration` 0.5 s was the first value; `local-voice` pauses on the first voiced frame and resumes after 0.4 s, which is the shipped choice (section 3c) | [LiveKit tuning](https://docs.livekit.io/agents/logic/turns/tuning.md) | The pause threshold. A minimum word count is not used; a question or real statement stops the reply and a bare reaction does not (section 3, item 3) |
| Learned filter for "uh-huh" versus a real interruption | LiveKit adaptive mode (hosted model, LiveKit Cloud only); Pipecat Krisp (commercial) | [LiveKit adaptive](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling.md) | Not used: both are hosted or commercial. Rules first. |
| Do not react to the first moments of a reply | Home's existing 400 ms arm delay (`BARGE_IN_ARM_DELAY_MS`) | `liveVoiceSession.tsx` | Kept as the one start rule (LiveKit's 1.0 s cooldown is not adopted) |
| Resume the interrupted speech when no transcript follows within a timeout (2.0 s), no regeneration | LiveKit `resume_false_interruption`, `false_interruption_timeout` 2.0 s; needs pausable audio output, and one forum report saw no difference with it on or off | [LiveKit tuning](https://docs.livekit.io/agents/logic/turns/tuning.md), [forum](https://community.livekit.io/t/with-the-new-adaptive-interruption-feature-im-seeing-the-same-agent-interruption-behaviour-resume-false-interruption-true-or-false/776) | Pause and resume (DUPLEX-03); the bench checks it |
| End of turn from audio, not a silence timer | Pipecat default Smart Turn v3 (BSD-2, 8 MB on CPU; 10 to 100 ms is its inference time, not its decision latency, which TurnBench measures at about 1 s; up to 8 s of 16 kHz audio, 23 languages); Kyutai STT predicts "done talking" | [smart-turn](https://github.com/pipecat-ai/smart-turn), [Pipecat](https://docs.pipecat.ai/server/utilities/turn-management/user-turn-strategies), [Kyutai](https://kyutai.org/stt) | DUPLEX-02 (pulls STT-SMARTTURN-01 forward) |
| Start the text model on the transcript before the turn is confirmed; text-to-speech not started early; skip for long utterances (10 s); at most 3 retries | LiveKit preemptive generation | LiveKit tuning page | Not in this design: early start is STT-SMARTTURN-01's speculative start, with its guard |
| Cancel in-flight tool calls on interruption | Pipecat | Pipecat page | Cancelling a tool on interruption uses the turn route's existing cancel (DUPLEX-03) |
| Hybrid controller: fast voice onset, reversible playback, speculative generation held privately | Voice-Light research prototype (36 turns, median 758 ms from endpoint to first audio; its learned end-of-turn model recalled 12.5% of turn ends, Silero timing 95.6%, so it kept the hybrid) | [arXiv 2609.20995](https://arxiv.org/abs/2609.20995) | Evidence for rules over a learned model; not a shipped product |
| Make Web Audio output reach Chrome's echo canceller: route it through a local pair of `RTCPeerConnection`s into an `<audio>` element | Mozilla Hubs (reported), guidance in Atmoky's docs; Chrome treats this as not a bug | [Atmoky](https://docs.atmoky.com/known-issues), [W3C list](https://lists.w3.org/Archives/Public/public-webrtc-logs/2019Apr/0334.html) | Browser echo, only if step zero shows it is needed |
| Delay microphone audio a few seconds after the stream opens so the canceller can settle | A developer report (one anecdote) | [dev.to](https://dev.to/hamedhajiloo/how-i-fixed-a-web-audio-echo-problem-with-a-5-second-delay-384h) | Not used: desktop Chrome measured clean (DUPLEX-00); it comes back per browser only if a measurement shows echo at stream start |
| Full-duplex AEC mode for the robot's chip | Espressif ESP-SR documents AEC modes for speech recognition, full-duplex dialogue and VoIP, and recommends `AEC_MODE_FD_LOW_COST` for full duplex | [ESP-SR AEC](https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/acoustic_echo_cancellation/README.html) | Robot spike |

## 3. Browser app and PWA

This section applies to every age band's session, with the band's gates and limits unchanged. The interrupted turn runs through the same turn engine, gate and memory as any other spoken turn. Children interrupt more and wait less, so the bench measures children's speech separately (section 7, DUPLEX-BENCH-01).

1. **Step zero, before any code (DUPLEX-00, S):** play a reply through the current Web Audio path with `echoCancellation: true` on
   desktop Chrome, Safari and Firefox, and Android Chrome, and measure how much of Home's own voice reaches the microphone (record the
   microphone track). This decides whether the loopback workaround below is needed. Nothing else in this section assumes the answer.
   **Measured 2026-10-24 (Jesse, Chrome 155 on a MacBook Pro, built-in speakers, loud volume, `bun run duplex:echo`):** echo with echo
   cancellation on is below the room noise for both Web Audio (-6.6 dB average, -4.8 dB worst 100 ms) and the loopback (-5.1 and -3.4);
   the control with cancellation off is 31.3 dB, so the test could hear the speaker; talking over Home, his voice averages 19.1 dB and
   peaks at 38.2 dB over the room, so it is not removed with the echo. Result for desktop Chrome on macOS: no loopback needed.
   Safari, Firefox, Android Chrome and iPhone are not yet measured.
2. **If a browser does not cancel Web Audio output (not Chrome on macOS, measured above):** play replies through the local `RTCPeerConnection` loopback into an `<audio>`
   element (the Mozilla Hubs pattern), on Chromium only.
3. **A real interruption stops Home and is answered in context; a bare reaction does not (Jesse, 2026-10-24: "dont follow me, do whats
   right").** Jesse's first ask was that anything he says over Home stops it and gets an answer in context of what Home said and its
   memories. When the evidence was checked, a pure reaction ("mm-hm", "oh wow", "no way") is not a new turn: Full-Duplex-Bench v1.5
   scores a user backchannel as "should keep talking" and calls stopping on short cues over-eager, LiveKit's adaptive mode ignores
   "uh-huh, okay, right", and Retell and Pipecat treat them as continuers. So: voice over Home's reply pauses playback after 150 ms in the browser
   now (local-voice's Silero start window), and on the first voiced frame once DUPLEX-02's `reply_pause` event lands; a cough or a bump
   pauses briefly and resumes. Once transcribed, a **question, a request, a stop
   word, or anything that is not a reaction** stops the reply: the heard prefix is stored as what Home said, the person's words are the
   next turn, and the turn engine answers them with the conversation so far and the person's memories, exactly as a typed message
   would be ("did he really do that", "wait, tell me about the dog"). A **reaction** is one of a fixed list of whole phrases matched exactly
   after normalising ("mm hm", "yeah", "okay", "oh wow", "no way", "i see", "got it", and so on; every other phrase containing "no" or
   "not", such as "no no no" or "not really", is a real interruption, which matters most for a child). A reaction's words are dropped:
   never stored, never sent; only a count is kept (rule 6a), and the list carries the marker `rule: duplexReaction` naming this note
   (the rule-budget lint). It resumes playback from the same
   sentence, as does noise with no words or no words within 2.0 s of the sound ending. The vocabulary is a starting list judged by
   ear, and a learned end-of-turn model with a backchannel class (Easy Turn) is measured in DUPLEX-02 as its replacement. The first
   400 ms after Home starts speaking starts no pause, and a final transcript that lands in it still counts.
4. **Pause, then the transcript decides.** Playback pauses with `AudioContext.suspend()` (so what is heard stays exact), and either
   resumes (noise or a reaction) or stops (a real interruption). The unspoken remainder of the reply is a follow-up item (DUPLEX-06): pass it to the next turn as
   background so Home can pick the story back up after a real interruption (a question like "did he really do that"), instead of only knowing what was heard. A bare reaction resumes playback and never becomes a turn, so it never needs the remainder.
5. **Smart Turn v3.2 is the starting end-of-turn model, to be measured before it is locked in.** An independent benchmark ranks it 17th of 25 on [TurnBench](https://turnbench.sesame.com) (recall 0.752, false positives 0.047, median decision latency 1017 ms; VAP scores 0.845 at 368 ms) and TurnSense reports its English F1 near 71/64 against 94/94 for TEN-Turn. DUPLEX-02 therefore scores Smart Turn, VAP, TurnSense, TEN-Turn, Easy Turn (which adds a backchannel class) and Kyutai STT (its model predicts when the person is done speaking alongside the transcript; [Kyutai](https://kyutai.org/stt)) on TurnBench's development split first, keeps whichever wins, and keeps the existing silence timer as the fallback. It decides when the person has finished, replacing the silence timer, with the existing Silero VAD in front, and
   keeping STT-SMARTTURN-01's own parameters: an 800 ms reopen window, the Silero hysteresis it names, and the flag
   `stack.engines.stt.smart_turn`, off until measured.
   **What a winner must pass before Home adopts it:** its licence is checked and compatible with AGPL-3.0 (VAP stays a measurement-only
   candidate until its licence is checked); it is fetched at a pinned version and URL with a verified checksum
   (RELEASES-AND-DEPENDENCIES.md); and it runs as a Stack component, since rule 11 says Home talks to the engines the Stack installs,
   pins and tests, and to nothing else.
6. **iPhone and iPad:** the open WebKit bugs [326286](https://bugs.webkit.org/show_bug.cgi?id=326286) (playback crackles with the
   microphone open and echo cancellation on; filed as an iOS 26.2 to 27 regression) and
   [311451](https://bugs.webkit.org/show_bug.cgi?id=311451) (audio degrades once the microphone is on) mean the iPhone PWA runs
   **pause-only until it is measured**: the person can stop Home by speaking after Home finishes its sentence or with the on-screen
   control, and headphones are the supported way to talk over it. No fix or home-screen difference was found in the sources.
7. **Android Chrome:** the same as desktop, measured on a real device.

## 3d. After every interruption: what to do with the rest (researched 2026-10-25)

Jesse, 2026-10-25: people do not only let the other person speak; they decide whether to continue where they left off, do something
else, or drop it. No study gives one validated decision tree, so this one is built from what is well supported and marked where it is
our own inference. Sources (peer-reviewed unless noted): Ström and Seneff, "Intelligent barge-in", ICSLP 2000
([paper](https://www.isca-archive.org/icslp_2000/strom00_icslp.pdf)); Crook et al., handling user interruptions in an embodied agent,
AAMAS workshop 2010, continue / abort / replan, a design proposal with no evaluation
([paper](https://www.csc.kth.se/~jboye/publications/aamas2010_interruptions.pdf)); Villing, resumption after interruption in
multi-tasking dialogue, ACL 2010 ([paper](https://aclanthology.org/P10-1082.pdf)); Yang, Heeman and Kun, interruptions and resumptions in
multi-tasking dialogues, Computational Linguistics 2011 ([paper](https://aclanthology.org/J11-1004.pdf)); Gervits and Scheutz, LREC 2018
([paper](https://hrilab.tufts.edu/publications/gervits2018lrec.pdf)); preprints: IHBench, post-interruption recovery in voice agents
([arXiv 2606.19595](https://arxiv.org/html/2606.19595)), interruption handling for conversational robots
([arXiv 2501.01568](https://arxiv.org/html/2501.01568v1)), SpokenUS ([arXiv 2603.16783](https://arxiv.org/html/2603.16783)), and the ICML 2026
ContinuityBench abstract (read only as an abstract). Three factors are well supported: the interrupter's act decides continue, answer
and resume, replan or drop; how long the detour ran decides whether to recap (Villing: up to 4 turns, non-redundant resumption outnumbered
redundant about 2 to 1; above about 10 turns almost all resumptions were redundant, repeating a keyword); and whether the interjection changes
the plan's assumptions decides whether to replan.

**The tree Home follows, by the interrupter's act (the step order is our inference; each step names its evidence):**

1. **Noise, a remark to someone else, a sound with no words** (Ström and Seneff; the side remark is our inference): resume from the same
   place at once. Built: the server's `reply_pause` / `reply_resume` and the browser's pause.
2. **A plain backchannel or agreement** ("mm-hm", "oh wow"; IHBench, Crook, arXiv 2501.01568): continue from the exact cut, with no
   acknowledgement and no restart. Built: the reaction list resumes playback and never becomes a turn.
3. **A stop, goodbye or turning the subject down** (arXiv 2501.01568, Crook "abort", IHBench pushback): drop the rest, answer, and do not
   finish the cut sentence. Built: guidance case STOP.
4. **Skip ahead** (IHBench, SpokenUS): give only the point or the next step; never re-explain what was skipped. Case SKIP.
5. **A correction or new facts** (Crook "replan", IHBench): accept it, give a new and shorter answer to what is still unsaid. Case FIX.
6. **A question about what was being said** (arXiv 2501.01568: held the floor in 14 of 22 cases, yielded in 4; answer, then return to the
   original thought): answer in one short sentence, then carry on from where the person stopped hearing it, in the assistant's own
   words. Case ABOUT.
7. **Something unrelated** (IHBench "handle it, then return without blending"; the offer is our inference, no study tested offers): answer
   only that, then say in one statement that the interrupted reply can be finished. Case OTHER.
8. **Resume sized to the detour** (Villing, Yang): after a short detour, continue bare; after a long one, a keyword or one-line recap, never
   the whole thing; high-memory content (steps, directions) restates the last point. Today the unheard part is read by the next turn only
   (section 3b DUPLEX-06), so a long detour is not tracked; that is a measured gap, not a decision.
9. **A long gap, or doubt that the person still wants it**: offer, do not resume (our inference).

**Limits on where it applies (architect, 2026-10-25):** the unheard part and its guidance ride on **spoken turns only** (an adult who cuts in by voice and then types gets nothing, so written chat never receives length instructions: rule 5), and **never on a crisis, safety or repair turn** (the same turns the spoken cue is suppressed on; a person who has just said something hard is not offered the rest of a story: rule 0). A turn that may not carry it also ends it.

**What the first real use found, and the fixes (2026-10-25, from Jesse's own session):** (1) A partial transcript is a guess, so it
never cancels a reply any more; it only keeps the pause from timing out, and the **final** transcript decides. Before, a partial of
background TV words cancelled the reply for good, the final then came back empty or as a reaction, and Home stayed silent. (2) A pause the
server had stopped managing (voice confirmed) now still sends `reply_resume` when the utterance turns out to hold no speech. (3) A
reaction is also any run of up to four words that only ever react ("oh yeah", "uh, nice", "yeah right"; the set holds no "no", "not",
"stop", "wait", "but" or question word), and a reaction word said as a question ("really?", "seriously?") is a real question, decided
by the transcript's own question mark, so Home answers it and carries on. (4) A final that lands in the first 400 ms of a reply is no longer
dropped. **The reaction rule is frozen as of this commit** (the org's rule: three phrasings in a week is a classifier, not a fourth regex): it went from an exact list to a letter collapse to a word set plus the question-mark rule in one day. A further miss becomes a label for DUPLEX-02's measurement of an end-of-turn model with a backchannel class (Easy Turn), recorded again with the demo voices and never taken from household transcripts; the next addition to the list is refused. Words like "is", "that" and "it" are not in the set, so a question the transcriber left without a question mark ("is it true", "that is it") still stops the reply. Sources for "really?" being a request to confirm and carry on: the clarification and confirmation cases in section 3d.

**How it is built:** steps 1 and 2 are client and server timing (no model). Steps 3 to 7 are one guidance block outside the data wrapper
(`messages.ts`), written as five labelled cases the model picks from, because a single sentence was ignored and a numbered list with a
literal example ("anyway") made the model resume every time. **Measured on the local chat model (two runs, five cases, 2026-10-25):** the
question case answered and resumed in 2 of 2, stop dropped the story in 2 of 2, the correction replanned in 2 of 2, skip-ahead gave the
point in 2 of 2 (once with a stray "anyway"), and the unrelated question answered and then resumed rather than offering in 3 of 4. A
small model follows the branch it is shown most clearly, so DUPLEX-BENCH-01 scores recovery with IHBench's three tests (returns to the
right place, addresses the interjection, never repeats what was heard) before the guidance is called done. Failure modes the research
names, to test for: restarting the interrupted sentence after a backchannel (GPT-family models 7 to 31%, best Gemini 2.5 68% on
IHBench's filler test), re-reading the cut sentence, and losing the thread over a long conversation.

## 3b. Home answers back: continuers and acknowledgements

Jesse, 2026-10-24: part of what makes ChatGPT's voice feel real is that it says "umm, ok, yeah" while it is being talked to and when it is
interrupted. Shipped examples: Retell AI has a backchannel setting with a word list and a frequency
([docs](https://docs.retellai.com/build/interaction-configuration)); Vapi describes backchanneling with customizable cues (a support
answer, no official doc found); the community Pipecat Backchannel processor plays short continuers ("mhm", "yeah", "right") on pauses
the turn model reads as incomplete, with clips recorded once from the bot's own voice and cached
([docs](https://docs.pipecat.ai/api-reference/server/extensions/pipecat-backchannel.md); community-maintained, not officially
supported); and Voice-Light plays "bridge speech" while work runs ([arXiv 2609.20995](https://arxiv.org/abs/2609.20995)). LiveKit
has none yet.

1. **Closed list, rendered by Home's own voice.** Clips are recorded once through the voice engine, cached on disk and played with no model
   call, as the Pipecat processor does (grouped by function: continuer, agreement, hesitation, surprise, at least two clips per group or
   it repeats itself; played at volume 0.6, below the voice's normal level; not written into the conversation). Retell's default words
   for English are "okay", "uh-huh", "mhmm", "yah", and its docs advise testing words with the chosen voice first, since some voices
   say certain words badly; Home does the same per voice by ear. The model never writes these sounds.
2. **Listening-back (continuers), starting from the shipped defaults.** From the Pipecat processor: eligible only after 0.7 s of the
   person's speech, only in a pause of at least 0.2 s that the end-of-turn model reads as incomplete, at least 2.5 s between two, and a
   0.8 chance at an eligible pause (Retell's default frequency is also 0.8; both stay below 1.0 so it does not sound mechanical).
   Human speech supports the timing: backchannels average about 178 ms after a pause in a published study, run at roughly 6 to 9 per
   minute in task dialogue, and stay acceptable within about 1.5 s before to 2 s after the ideal moment
   ([TalkTive](https://arxiv.org/pdf/2202.08216), [Frontiers](https://public-pages-files-2025.frontiersin.org/journals/communication/articles/10.3389/fcomm.2025.1655049/epub)).
   Jesse tunes the values by ear on the dev copy. Cost to measure first: the Pipecat page says a second voice detector and end-of-turn
   check roughly double that inference while the person speaks.
3. **Acknowledgement on interruption: our extension, built on the shipped `spoken_cue`.** No product ships this exact thing. The
   closest precedents are Voice-Light's "bridge speech" while tool calls run ([arXiv 2609.20995](https://arxiv.org/abs/2609.20995)),
   and Home's own `spoken_cue`, which already plays a short fixed sound ahead of a reply, is never stored and is skipped on repair turns
   (`backend/src/routes/turn.ts`, `backend/src/lib/replyVariation.ts` `THINKING_CUE_VARIANTS`). The acknowledgement therefore **is a
   `spoken_cue`**: a second fixed pool beside `THINKING_CUE_VARIANTS`, rotated the same way with banned phrases, passed through
   `normalizeForSpeech`, and given an interruption-turn delay. Rule 9 names the spoken cue as an allowed gap, so no new chat-path
   code path is added. The delay is the open number: Home's own record said `SPOKEN_CUE_DELAY_MS` was 2500 (changed to 1000 on 2026-10-29 after a spoken turn's first token measured 2.1 to 3.3 s with no quick lane; the end-of-speech silence went 0.8 to 0.6 s and the false-interruption resume window 2.0 to 1.2 s in the same change) and cites
   [arXiv 2507.22352](https://arxiv.org/abs/2507.22352) that fillers hurt at sub-second waits, while people backchannel about 178 ms
   after a pause. So the interruption-turn delay starts at the existing cue value, a shorter value is only tried against the bench's
   new acknowledgement-timing row (rule 13) and by Jesse's ear, and the item is dropped if it does not feel better. OpenAI's
   GPT-Live system card describes full duplex and gives no timing or backchannel numbers, so there is no ChatGPT figure to copy.
   **Continuers** are an additive cue event on the same cue path, decided on the hub in `SttSession` (where Smart Turn runs) so the
   browser and the robot share one rule; both events are added to DUPLEX-01.
4. **Why the fixed clips pass the gates.**
   - **Rule 10:** the list is one code constant that nothing (a model, companion, package or setting) can add to; banned phrases only
     remove entries. A person reviews each entry against the child floor when it is written, and a unit test runs the output floor over
     every entry for every age band. Rule 10's exemption is for rule 6 clips that play when no model can speak, which these are not (they play while a model speaks), so the per-band unit test over every entry is the check before release that rule 10 asks for. The second reason is rule 9's named gap, sentence-gated speech scheduling with the spoken cue, which the shipped cue pool already uses the same way.
   - **Context check:** a clip never affirms a disclosure. No continuer plays unless the partial transcript so far has passed the
     deterministic input floor, and no acknowledgement plays on a crisis, consent, refusal or repair turn (`cueSuppressed` in
     `backend/src/lib/turnMachine/turnNext.ts`, which covers repair only today, is extended to those).
   - **Rule 0 and REG-02:** `backend/src/lib/voiceCues.ts` keeps its rule that a child or teen never gets a cue inside the reply's speech
     text and is unchanged; these clips play outside the reply text, exactly as the shipped spoken cue already does for every band.
   - **Rules 5 and 9:** the clips are never stored, never in history, never counted in the heard prefix, and never count toward or extend
     the band's spoken limits.
   - **Rule 14:** each clip is rendered in the voice resolved for that request; the cache is keyed by voice id, engine and companion; if
     no clip exists for that voice, nothing plays and no default voice is used.
5. **Quiet when it should be, and the switch.** Never over the person's voice, never in the first 400 ms of a reply. One person-scope key
   in group `person.voice`, shown on Your settings P4 "Voice and robot", declared in the commons spec first (`spec/settings/keys.json`),
   named apart from the household `voice.hesitations` key (sounds inside the reply). A child may turn it off; a robot's unknown speaker
   gets the default. These clips are not system status, so no new status surface (S6).
6. **Reuse check.** The Pipecat Backchannel processor is Python, community-maintained and owns its own pipeline, so it is copied for its
   numbers and not adopted; Home's `spoken_cue` and `SttSession` are what is reused.

## 3c. What `local-voice` does, read from its source, and what Home takes

[local-voice](https://github.com/mthomas100/local-voice) (MIT; one developer's working prototype on an M5 Max 128 GB; its numbers are
developer-reported) is the closest working implementation of this design. It cannot run unchanged beside Home (it needs the author's GPU
hold-gate and the Pi agent, and its voice port 8770 is the Stack's), so Home ports the algorithms, not the code. Its source was read
file by file (`orchestrator/local_voice/bargein.py`, `echo_guard.py`, `turn_start.py`, `turn_end.py`, `services/stt.py`,
`tools/bargein_bench.py`, `tools/turn_end_bench.py`). The facts that matter:

1. **Pause on the first speech frame, decide afterwards.** One 32 ms Silero frame at confidence 0.5 (and volume 0.5) while audio is
   playing pauses the reply. If the VAD has not confirmed within 0.4 s and no speech was heard in the last 0.1 s, it resumes; at most
   1.5 s of pause; at most 2 unconfirmed pauses in any 10 s. Confirmation is the Silero VAD at confidence 0.7 and start 0.15 s, which
   interrupts: queued audio is dropped, the generation counter changes so a chunk waiting at the gate is discarded. Measured: pause at a
   median 72 ms after speech starts, interrupt at about 275 ms; with real models audio stopped 238 to 267 ms after speech start.
   Their bench (110 synthetic interruptions, 260 ESC-50 sounds): a 0.15 s start gives 24 false interruptions in 260, 0.1 s gives 37,
   0.064 s gives 43.
2. **Heard text is reconciled by time.** The client reports `played_ms`; the server maps it to words (proportional inside a partly played
   sentence, 2.6 words per second for a sentence still streaming) and the next prompt starts with a note that the user heard only that
   much of the last reply. Home already stores the heard prefix; what it lacks is telling the model. DUPLEX-06 does that only through the composer's existing
   labelled-background mechanism (the way robot vision R3's look rides into a turn as labelled background data), adds no turnMachine
   stage and no new prompt code, and counts its tokens in the window budget (rule 4); if it cannot be built that way it is a new named
   gap for Jesse, not a quiet addition.
3. **The echo guard is a text check, not audio.** Smith-Waterman alignment (+2 equal word, -1 gap or mismatch) between the transcript and
   every sentence spoken in the last 300 s (sentences under 30 s apart joined): echo if at least 3 words align and at least 60% of the
   heard words are covered; a 1 or 2 word fragment is echo if all its words are in the last 3 sentences. In Home it runs only on a transcript that overlaps a playing reply or its 1.0 s tail (never on a person quoting Home a minute later),
   drops the 1 to 2 word fragment rule (a short transcript goes to the reaction rule, so mistakes fall toward stopping), carries the marker
   `rule: duplexEchoGuard (docs/design/full-duplex-voice-2026-10-24.md)` and a counts-only counter, never stores or logs a dropped echo
   (rule 6a), and keeps its window of spoken sentences in that session's memory only. Tests: a child's "no", "stop" and "no no no" after
   Home said those words still stop the reply; a quote of Home after the reply ended is not dropped; a 3-word echo is dropped. "busy" lasts
   1.0 s after the bot stops. Their own caveat: never run with the real recogniser through real laptop
   speakers; a one-word interruption that the bot itself just said ("no") resumes instead of stopping.
4. **A word-hold decides after the pause.** Echo resumes the reply; a transcript made only of backchannel words or a fragment resumes it
   and is dropped; any other words start the turn and interrupt; no words for 1.5 s while the VAD still hears speech interrupts; after the
   VAD stops, 0.6 s with no final transcript resumes; a pending yes/no question is never held.
5. **Turn end:** Silero 0.7 / start 0.15 s / stop 0.2 s / volume 0.5; Smart Turn v3.2 at each VAD stop with a 2.0 s silence fallback;
   a "dangling" last word (article, conjunction, object preposition, filler) holds a COMPLETE verdict until the fallback, except a
   question; punctuation-based holds were measured harmful (mid-sentence cut-offs rose from 31 to 37-44 of 80) and are off.
6. **Streaming speech-to-text is mostly a fast final.** Partials come about once a second (the encoder chunk); the final lands 53 ms
   after the audio ends. The recipe: one session per VAD segment, 1.0 s of preroll, 0.3 s of zero padding at the end (it fixed dropped
   last words), a segment with no words is decoded again with the next. A fast model makes a 0.5 s
   interim cycle cheap (Parakeet v2 on CPU: about 150 ms for a 2.5 s clip, measured 2026-10-25 under heavy load; the 23 ms
   figure did not reproduce, see parakeet-stt-tier-2026-10-25.md).
7. **Bench method:** `bargein_bench` scores each 20 ms frame once, then replays the VAD state machine for each setting; interruptions are
   macOS `say` phrases in several voices, controls are ESC-50 clips scaled to the median interruption level plus noise and backchannels
   (ESC-50 is CC BY-NC: local measurement only). `turn_end_bench` splices 0.8 and 1.5 s pauses at word boundaries into finished requests.
8. **Fragile or untested in their code:** it depends on Pipecat 1.12 internals and private mlx-audio queues; the echo guard, the dangling
   hold and the word-hold have only model-free tests; TTS grouping is unmeasured.

What this changes in Home: the pause threshold moves from 500 ms of voice to 150 ms in the browser now, then the first voiced frame once DUPLEX-02 lands (it sends a
`reply_pause` event from `SttSession`; the browser suspends its `AudioContext`, so the pause is client-side because Home's client
buffers far more than their 40 ms); the 2.0 s false-interruption wait becomes 0.4 s with a 1.5 s cap once words arrive fast enough
(until DUPLEX-02's segment-level transcription lands, the dev copy keeps 2.0 s); the text echo guard is ported into `SttSession` and also
protects the robot and any browser without echo cancellation; the interrupted-reply note is added to the next turn (DUPLEX-06).

## 4. Robots (StackChan first)

Duplex applies to a robot at any band the admin set, with that band's gates and limits unchanged (rule 0: an unknown speaker gets the child result, and it gets duplex too).

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
chosen for the person, companion or robot (rule 14). All of the above act on when audio plays or stops, never on what is said, with one exception: the fixed continuer and acknowledgement clips of section 3b, gated when written and played outside the reply text. A
child's or teen's spoken turn keeps its own limits.

## 6. Not in this design (no shipped example found)

- Duplex speech models (Moshi, PersonaPlex, NemotronLabs VoiceChat, MiniCPM-o) as the voice, the timing signal or a conductor.
- A 200 ms fade-and-pause threshold; hub-side echo cancellation against audio sent over Wi-Fi; a speaker level cap; resuming a held
  reply after a clarifying question.
- Duplex on iPhone with the speaker (until the WebKit bugs are measured).
Each can come back as its own item if someone ships it or a measurement of ours shows it works.

## 7. Slices

1. **DUPLEX-00 (S):** step zero, the echo measurement per browser and device.
2. **DUPLEX-01 (S, spec first):** playback marker, the server events `reply_pause` and `reply_resume`, the client message `played_ms {reply_id, ms}`, the stop event, the continuer cue event, the acknowledgement cue variant; the `duplex` value on `robot.barge_in.open_mic`; pin bump.
3. **DUPLEX-02 (M):** (also: first-frame `reply_pause` / `reply_resume` events from `SttSession` with local-voice's 0.4 s, 1.5 s and 2-per-10-s limits; the Smith-Waterman text echo guard with its 300 s window; per-VAD-segment transcription with 1.0 s preroll and 0.3 s tail pad; section 3c) Smart Turn v3 in `SttSession` and the settings in section 3.
4. **DUPLEX-03 (M):** pause, resume, stop and heard prefix in the browser player; the echo check; the loopback only if DUPLEX-00 says so.
5. **DUPLEX-04 is removed from this design.** Early start is STT-SMARTTURN-01's speculative turn start and is a latency feature, not
   duplex. It is built on the existing turn route and its cancel, with no new `turnMachine` code (that would be a rule 9 named gap,
   which only Jesse adds). Its guard applies: a speculative start is side-effect free until committed (no memory write, no tool with
   effects), and nothing is released, spoken or stored until the turn is confirmed (rules 9 and 10). Cancelling an in-flight tool on
   interruption uses the same existing cancel.
6. **DUPLEX-05 (M, `bot`):** the robot spike.
7. **DUPLEX-BENCH-01 (M):** built on existing benchmarks, not invented rows, run for local measurement only (their data is CC BY-NC or unlicensed, so it is never shipped; the report records each dataset's licence, a set with no licence is not used until its licence is known, and CC BY-NC sets are flagged to Jesse once before the first run, per LICENSING.md): [Full-Duplex-Bench v1](https://arxiv.org/html/2503.04721) (pause handling, backchannel frequency and JSD against human timing, takeover, latency), [v1.5](https://arxiv.org/html/2507.23159) (four overlap cases, user interruption, user backchannel, talking to others, background speech, scored as Respond or Resume, with stop and response latency), [SID-bench](https://github.com/xkx-hub/SID-bench)'s Average Penalty Time for false and late stops, [v3](https://arxiv.org/abs/2604.04847)'s self-corrections ("no wait, Tuesday"), and the [TurnBench](https://turnbench.sesame.com) development split for end-of-turn. Home's own rows stay, plus two safety rows: transcription errors (what was heard against what was said, on adult and children's speech) and speech that deviates from the approved text (the words the voice engine spoke against the sentence the turn engine released), both expected to be zero off-script words; and: children's speech (demo voices or a parent's consent, in `data-scratch`), robot echo, Home talking over the person, and the acknowledgement-timing row. The v1.5 user-backchannel row (a user "mm-hm" should keep the agent talking) is in the pass bar, since the reaction rule of section 3 item 3 is built to satisfy it.
8. **DUPLEX-08 (design first, not built):** other voices. "A real interruption stops the reply" also fires on a TV or a sibling talking to someone else; Full-Duplex-Bench v1.5 scores those as Resume. FireRedChat ([arXiv 2509.06502](https://arxiv.org/html/2509.06502)) cuts false barge-ins to 10.2% (LiveKit 33.4%, TEN 78.1%) with a personalized VAD keyed to the target speaker's voiceprint. It reuses the existing biometric print store (`backend/src/lib/biometricPrints.ts`, FACE-01, which already holds voice prints encrypted at rest) and FACE-CONSENT-02's consent rule (a parent enrols a child, a teen confirms in their own session, a guest is never enrolled); no new store (platform principle 1). Rule 0: a voiceprint match used to ignore other voices is never speaker evidence for memory or account access; an unenrolled or unknown speaker keeps today's behavior, where any voice pauses the reply. The first deliverable is the consent design on the existing print store, architect-ruled, before any code.
9. **DUPLEX-07 (M):** section 3b: the fixed clip list rendered per voice as a second cue pool, continuers at incomplete pauses, the acknowledgement as a `spoken_cue` with an interruption-turn delay, the spec-first on/off key; plus an acknowledgement-timing row in DUPLEX-BENCH-01.
Order: 00 and 01, then 02 and 03, 05 in parallel, 07 after 02 (it needs the end-of-turn model), then the bench. Codex first for 02 and 03.

## 8. Legacy verdicts (rule 8)

- VOICE-LOOP-01 numbers: for the browser, the 0.6 s confirm, the stop-phrase bypass and "backchannels never stop" are **replaced** by section 3's reaction rule (a reaction resumes, a question or stop word interrupts); for the robot, duck, re-arm grace and self-echo are **kept** until its spike reports.
- Legacy `useHandsFree.ts` thresholds: **dropped**. Legacy "listen only after the reply ends": **dropped** once DUPLEX-03 lands.

## Supersedes

- `voiceBargeIn`'s rule in `liveVoiceSession.tsx` that any speech after a 400 ms arm delay stops the reply: **replaced** by section 3 (a 150 ms pause, then the transcript decides; a real interruption stops the reply, a bare reaction does not).
- The silence-timer end of turn in `sttSession.ts`: **replaced as the primary end of turn** by Smart Turn v3.2 or the DUPLEX-02 TurnBench winner (section 3), and **kept as the fallback**.
- STT-SMARTTURN-01: its endpointer half (Smart Turn v3.2, the 800 ms reopen window, the Silero hysteresis and the off-until-measured flag) **moves** to DUPLEX-02; its speculative start stays in the STT-SMARTTURN-01 backlog row, which keeps one owner for it.
- VOICE-LOOP-01's barge-in numbers: 0.6 s confirm is **replaced** by a 150 ms pause (local-voice's Silero start window, re-measured); "stop phrases bypass" and "backchannels never stop" are **replaced** by section 3's reaction rule (a reaction resumes, a question or stop word interrupts); duck 0.35 and 0.75, the 0.7 s re-arm grace and the self-echo at 0.8 overlap are **dropped** for the browser (pause replaces duck; the bench measures the rest) and **kept** for the robot until its spike reports.
- "Listen only after the reply ends": **dropped** once DUPLEX-03 lands.
- CHAT-PARITY-05's clause that child profiles do not enable a continuous microphone: **superseded** by this design on Jesse's word (2026-10-14 ruling, restated 2026-10-24 in chat). The row is edited when the first slice lands.
- Section 6's former exclusion "Home saying mm-hm while the person talks": **removed**; section 3b is its replacement.
- `SPOKEN_CUE_DELAY_MS` (2500): **replaced** on interruption turns by the delay section 3b names, tested on the bench.
- The first DUPLEX-03 cut already on `origin/main` (commit 3cce4e9e8, "any words stop the reply"): **replaced** by the reaction rule of section 3, item 3.

## Prefix prewarm (VOICE-PREWARM-01, 2026-10-29)

A spoken turn's first token took 2.1 to 3.3 s when the engine had to read the system message and tool block again, and 0.6 s when that prefix was still cached. Home keeps each person's last real prefix in memory (`lib/prefixPrewarm.ts`, recorded where the generation request is built) and the voice overlay calls `POST /api/turn/prewarm` when it opens: one request with that prefix and a one-token answer, at most once every 20 s per person and surface class. A person with no recorded prefix is left to the boot warm-up. Not yet measured on the live hub (a concurrent ship took it down).

## Second filler (VOICE-FILLER-02, 2026-10-29)

A spoken turn whose first word is still missing 3 s after the first bridge phrase ("One sec.") gets one more short phrase from a separate pool ("Still on it.", "Almost there.", "Bear with me.", "Just a bit longer."), never the same one twice in a row, then waits in silence. Written turns and turns with the cue suppressed get none. `STILL_CUE_GAP_MS` in `routes/turn.ts`.

## Quick lane (VOICE-QUICK-01, 2026-10-29)

Jesse's report: the fixed "One sec." came on every turn and the call felt like a walkie-talkie. Research read the same day: Inworld ships a small filler model that runs in parallel and speaks only when the main model's first token is late (with a hard deadline so it cannot add delay), ConvFill (arXiv 2511.07397) found fillers that fit the conversation beat generic ones, and DDTSR (arXiv 2602.23266) uses a small model for content-free openers while the large one reasons (waiting 548 ms against 1003 ms). Home does the same with the small model it already runs: the Qwen3 4B judge role writes a one to four word reaction to what the person just said (`lib/quickReaction.ts`), in the mood they said it, with no fixed list, no answer, no advice and no facts; it can say NONE, avoids its last four reactions, passes the person's topic block, and is dropped if it echoes the person's words or runs over four words. If the main model has no first word after 0.7 s the reaction is spoken (measured: "Ouch, that sounds tough." for sore feet, "I'm so sorry." for a death, "That's great news!" for a job); if the small model has nothing, the old bridge phrase is the fallback. The 4B still does not answer anything (INSTANT-05, 2026-10-17: it invented forecasts and scores). Reactions while the person is still talking, and playing on softly over a soft interjection, are the next two slices. <!-- prose-lint: allow -->

## Reactions while the person talks, and a softer yield (VOICE-QUICK-02 and 03, 2026-10-29)

Jesse's report: Home stops dead the moment he speaks and never makes a sound behind him. Two changes, both in `liveVoiceSession.tsx`. (1) In a pause of 0.4 s or more inside a longer stretch of speech (at least six words so far, at least five seconds since the last one, left out 3 times in 10), the voice session asks `POST /api/turn/react` for a reaction; the same small model that writes the turn-start reaction (`lib/quickReaction.ts`) may answer or say nothing, and the reaction is spoken only if the person has not started again, no final transcript has landed and Home is not speaking. The server also refuses a second request inside 3 s. (2) On the first voiced frame while Home speaks, the voice now ducks to a quarter of its volume and keeps going; if the sound is still there 0.6 s later it is speech and the voice pauses as before, and a cough or a soft "mm-hm" that ends sooner gets full volume back. Not yet heard on a real call; echo of Home's own ducked voice into the microphone is the thing to listen for.

## Call sounds (VOICE-SOUNDS-01, 2026-10-29)

Starting a call with a companion plays a short bright climb (three notes, triangle and sine, 392 to 1047 Hz); hanging up plays a soft two-step down (587 to 262 Hz). They differ from each other and from the wake chime (two plain sine notes at 660, 880 and 440 Hz); a wake cue that played in the last 3 s stands in for either. Synthesized with Web Audio in `lib/voice/callSounds.ts`, played from `liveVoiceSession.tsx` when the overlay opens and closes.

## Cold first turn and early cut-offs (2026-10-29)

Read from the live chat log: the first spoken turn after a hub restart took 3.0 s to the first word (later turns 0.9 to 1.3 s), because the prefix prewarm remembers prompts in memory and a restart empties it. The hub now warms the shared start of the default spoken prompt (tools block and persona text) about 5 s after it starts, retrying every 20 s while the Stack loads (`warmSpokenPrefixAtBoot`). The same log showed fragments ("I didn't", "Who's") sent as whole turns after the 0.6 s end-of-speech silence, so it is 0.75 s again; the end-of-turn model that would decide better is still unmeasured on real speech.

## The small model chooses the delivery (VOICE-DELIVERY-01, 2026-10-29)

Jesse's report: he never heard laughs, sighs or emotion. Cause: the cue routine (REG-02) only fired when keywords like "funny", "joke" or "wow" appeared in the reply, at most once per turn, three turns apart, 60 percent of the time. Now the Qwen3 4B judge role, already running, chooses (`lib/deliveryChoice.ts`): for an adult, from the second sentence of a spoken reply on (never the first, which would delay the first sound), it answers "sigh after", "gasp before" or "none" from the tags the speech engine advertises, using what the person just said and the sentence; a deadline of 250 ms and a miss falls back to the old rules. The planner keeps its gates (child and teen never, no number, link, instruction or safety line) and allows two a turn with no cooldown, since the model already decides how often. The turn-start and mid-talk quick reactions may begin with one sound from the same list for an adult. Tried on the real 4B: "Sounds like a rough day" gave "sigh after", "that one cracks me up" gave "laugh after", "Sure, I can help" gave "none". Expressiveness (Chatterbox's exaggeration) is not sent anywhere; the Stack speech route accepts only a sampling temperature and a pitch offset, so that needs a Stack change.

## Cues that fit, and a call that does not reopen an old thread (2026-10-30)

Read from the chat log after a live call: first words took 0.7 to 1.2 s on a warm turn, yet a 0.7 s cue fired on nearly every turn and the answer then waited behind the cue's audio, so the cue made the reply later. The small model also said NONE or timed out often, and the fixed "One sec." family covered for it, so it sounded constant; its reactions ("I know", "Great") were guessed from one line with no context. Changes: the cue waits 1.5 s, so a normal answer gets none; when the small model chooses NONE nothing is said (the fixed phrase is only for a model that failed or was slow); the tool-start cue needs a package that usually takes over 2.5 s; the reaction prompt says NONE for greetings, requests, questions, plain acknowledgments and unfinished sentences and sees the assistant's previous reply for context (tried on the real 4B: NONE for "set an alarm", "hello", "okay", "tell me a story"; "I'm so sorry." for a death, "That's great!" for a new job, "cool!" for a coyote); a named sound ("sigh") becomes the tag or nothing; mid-talk reactions need 8 words, wait 8 s between and fire 4 times in 10. A spoken turn with no conversation id now starts a new conversation when the latest open one has been idle for 30 minutes (`SPOKEN_IDLE_NEW_CONVERSATION_MS`), so a call does not bring up what was said an hour ago; a chat the client names by id still continues as before.
