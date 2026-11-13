# Talker-first spoken replies for adults (TALKER-FIRST-01, design note, 2026-11-12)

Owner decision (2026-11-12, wizard): design talker-first for adults only. Same day the owner approved measuring spoken
latency from the end of the person's speech, with a 1.3 s target (handled in its own item, not here). This note designs; it
builds nothing. (est.) marks an estimate. Line numbers are from `main` at 489650bf6.

Sources read: `docs/design/RULES.md` (rules 0, 1, 2, 3, 4, 6a, 8, 9, 10, 12, 13, 14, S6),
`docs/design/full-duplex-speed-2026-11-11.md` (worktree `home-swift-falcon-fable-speed`), `instant-mode-2026-10-17.md`
section 7 (INSTANT-05), the 2026-11-11 research note "The fastest spoken conversation" (Part 1 ConvFill, Part 3), and the code
cited below.

## Supersedes

- `backend/src/lib/quickReaction.ts:1-4` and `backend/src/wire.ts:589-599`, the rule that the small model's words are
  "spoken, never stored in the thread", **for talker-first turns only**. On a talker-first turn the opener is reply text: it
  goes out as `delta`, passes the output gate and is stored as released text (rule 9). `spoken_cue` itself keeps its meaning
  (never stored, never shown) for every other turn.
- `instant-mode-2026-10-17.md` section 7, INSTANT-05 ("the 4B does not answer spoken turns"), **narrowed, not reversed**: the
  4B still never answers, never decides a tool and never states a fact. It writes at most one short opening sentence with no
  content, which the main model then continues.
- The VOICE-OPENER-01 / VOICE-QUICK-01 cue on talker-first turns (`backend/src/routes/turn.ts:724-759`): when the setting is
  on and the turn is eligible, the opener takes the place of the quick `ACK`/`REACT` cue and the fixed bridge phrase. The
  "Still on it" cue (`turn.ts:765-772`) and the tool-start cue (`turn.ts:680-689`) stay.
- Research note Part 3 item 11 ("ConvFill-style talker-first", owner decision): this note is its design.
- `full-duplex-speed-2026-11-11.md` section 2 item 7 (the 4B opener spoken as a cue): replaced by the stored opener on
  talker-first turns only; it stays for every other turn.
- RULES.md rule 9's named gap "sentence-gated speech scheduling with the spoken cue" is **extended** by a new named gap
  (proposed below); the existing gap's wording is unchanged.

## Reuse check

- **The quick reaction** (`quickReaction.ts:84-106`): same judge role (Qwen3 4B), same `completeBackground` runner, same
  per-person recent list (`recent`, line 12) to vary wording, same shape-check style (`cleanReaction`, line 57; `echoes`,
  line 51). The opener is a new form on this one function, not a second small-model client.
- **`spoken_cue` and its scheduling** (`turn.ts:617-772`, `chatModelAdapter.ts:600-616`): kept for minors, robots, the
  fallback when no opener is ready, and the long-wait cues. Talker turns set the same `cueSpoken` flag (`turn.ts:738`) so no
  second cue plays.
- **The one stream gate** (`turnNext.ts:1211-1226`, `StreamGate` in `nodes/outputGate.ts:225`): the opener is pushed into
  the same gate the model's deltas go through, so the same placer, queue, released-text record and refusal path apply. No
  second release path.
- **The assistant message as prior words** (`messages.ts:309-314`, `continuationMessages`): the continuation shape is the
  precedent, but its trailing user "Continue" instruction and its no-tools rule (`model.ts:786`, `model.ts:936`) are wrong
  for a live turn (rule 1). Talker-first uses the engine's own assistant prefill instead (mechanism section).
- **`SentenceSpeechScheduler`** and `splitReadyChunks` (`frontend/src/lib/sentenceChunker.ts:55`): unchanged. An opener that
  ends in `.` or `!` is a whole sentence under `SENTENCE_BOUNDARY` (line 17) and is sent to speech at once as the first chunk.
- **Settings registry** (`backend/src/settings/aiKeys.ts:119`, `chat.search_assist` as the pattern: off / shadow / on),
  `voiceTiming.ts`, `bun run voice:latency`, the CHAT-AB-01 bench (`backend/scripts/bench/chat-ab-01.ts`), the typed log
  registry (rule 6a).
- Searched for an existing opener or talker path: `rg -i "talker|convfill|opener|prefill"` over `backend/src`,
  `frontend/src`, `docs/BACKLOG.md` and the Stack: none beyond VOICE-OPENER-01 (the cue) and THIN-7C (continuation). No new
  model, store, status surface or wire event type.

## 1. Mechanism

### 1a. What the 4B writes

One line, one of three forms (an extension of the quick reaction's REACT / ACK / NONE):

- `OPEN: <sentence>`: a lead-in sentence of one to six words, ending in `.` or `!`, in the companion's register, that commits
  to nothing: "Okay, so.", "Ooh, good one.", "Right, let me think.", "Hmm, fair question."
- `REACT: <sentence>`: the existing reaction to shared news ("Oh no, I'm sorry."), used only when the person shared news, as
  today.
- `NONE`: no opener (a greeting, a plain okay, an unfinished sentence, or the model is unsure). The turn then runs exactly as
  today.

Why a whole sentence and not a clause that the 27B finishes mid-sentence: (1) a complete sentence is a complete intonation
unit, so the TTS seam between the 4B's utterance and the 27B's first sentence is a normal sentence break, not a cut inside
one; (2) the spoken gate is per sentence (`gateGrainFor`, `outputGate.ts:210-213`), so a whole sentence is released at once
with no gate change; a dangling clause would be held until the 27B ended the sentence and the saving would vanish; (3) a
content-free sentence cannot contradict the answer. The cost is honest: the opener carries no information; its value is the
first sound and the conversational feel, and the note measures it that way (section 4).

The 4B's input, kept small and stable (about 300 to 400 tokens, est.): the opener instructions (a fixed system prefix that
the 4B's own slot caches), the companion's one-line voice summary from the persona record, the last assistant reply
cut to 160 characters (as `quickReaction` already sends, `turn.ts:724`), the recent openers to avoid, and the utterance cut to
400 characters. It does not get the turn signal: the 4B picks OPEN, REACT or NONE from the words, as `quickReaction` does
today, so rule 1's list of signal uses needs no change. It does **not** get the volatile context message (memory, window, clock, documents): that
would cost about 800 more 4B prefill tokens per turn (0.15 to 0.3 s, est.) and would give it names and facts it must not say.

Sampling comes from the 4B's catalog record (rule 3; today `quickReaction.ts:95` hard-codes `temperature: 0.9`, and slice 2
moves it to the record); thinking off; `max_tokens` 18 with an exact ceiling (as `quickReaction.ts:95`);
deadline 400 ms (est., tuned in shadow).

### 1b. Shape checks on the opener (Home's own text, before it is offered to the gate)

Deterministic checks on what the 4B wrote, never on the person's words: one to six words; ends in `.` or `!`; no `?`; no
digit, number word, date or time word; no capitalised word after the first (no names, no places); no word from the person's
utterance other than function words (no echo; stricter than `echoes()`, which allows 40% overlap); no yes/no/agreement or
refusal stance ("yes", "no", "sure", "of course", "can't", "won't"); no action or tool claim ("check", "look up", "search",
"set", "remind", "play", "I'll", "let me get"); not one of the person's last four openers. A failed check means no opener;
the turn runs as today. These are not content blocks on a reply: the 27B's answer is never touched, and rule 10's adult
content rule is unaffected (Home drops its own filler, as `THINKING_SOUND` at `quickReaction.ts:26` already does). The
architect's reading (2026-11-12): this is technical validation of Home's own optional filler, a non-content protection rule 0
keeps, on three conditions: the checks stay form-only (no content-category word is ever added); a failed check only means no
opener, never a refusal line and never a change to the 27B's text; the person's utterance is read only as the echo
comparison set.

### 1c. How the 27B continues: options and recommendation

| Option | How | Cache and state | Verdict |
|---|---|---|---|
| A. Assistant prefill (recommended) | The 27B request ends with `{ role: "assistant", content: opener }` and the engine continues that open assistant turn (llama-server's default prefill of a trailing assistant message; Splash to be proven, slice 0). Tools still offered, `tool_choice: "auto"`. | The stable prefix (system plus tools, the 2,848 cached tokens) is untouched. The opener's 5 to 10 tokens land in the volatile tail that is re-read every turn anyway (about 800 tokens), so about +10 ms of prefill (est.). The stored reply equals what the model saw, so the next turn's history renders the same as any reply (rule 4 holds). Splash resumes only from published states at prefix boundaries; the prefill sits after the last one, so no resume is lost and none is gained. | Engine-native (rule 2), keeps tools (rule 1), one request. |
| B. Continuation messages (`continuationMessages`, `messages.ts:309`) | Opener as an assistant message, then the user "Continue the incomplete answer above" instruction. | Same tail cost. | Rejected: it is the THIN-7C shape, which offers no tool (`model.ts:786`), so a search or tool turn would be decided by Home, not the model (rule 1); and an extra user turn reads oddly in history. |
| C. Told, not prefilled | A line in the volatile message: "You have already said aloud: '<opener>'. Continue without repeating it." | Same tail cost; works with thinking on. | Fallback only, if slice 0 shows Splash cannot prefill. Adherence is weaker (repeats, double openers); measure in shadow before using. |
| D. Parallel, splice | 27B starts at once with no opener; Home trims overlap. | No cost. | Rejected: Home would rewrite model output (rule 2) and the seam is unbounded. |

**Timing (option A).** The 4B call starts right after the safety node passes (`nodes/safety.ts:25-60`, route `commands`),
in parallel with the context node (0.13 to 1.4 s measured). The 4B needs 0.1 to 0.3 s idle (70 to 230 ms measured for a few
words, `quickReaction.ts:2`), so the opener is nearly always ready before the model node builds its request
(`model.ts:943-944`). If it is not ready then, the model node waits at most 150 ms (est.) and otherwise drops talker-first
for this turn (no opener, today's cue path). The 27B's first token is therefore not delayed in the common case.

**Thinking.** A trailing assistant prefill closes the think block before the opener in Qwen-family templates, so a talker turn
sends `enable_thinking: false` (`llm.ts:474`). If adult spoken turns run with thinking on today, this is a reply-quality change
and the A/B (section 4) carries it; slice 0 records which is live.

**Rule 8.** Whether a model can be prefilled is a proven template feature, so it becomes a catalog field
(`assistant_prefill: true`, measured by slice 0), never a check on one model id. A model without it gets no talker-first.

### 1d. One stored reply

The opener is pushed into the turn's one `StreamGate` (`turnNext.ts:1211`) before the model node's first delta, and only after
it passed the shape checks. The gate checks it as a sentence (spoken grain) with no new drop branch inside the gate, releases
it through the placer to the queue, and it goes to the client as the first `delta`. The engine returns only new tokens after a
prefill. Home adds no separator and trims nothing (rule 2): the released text is the opener plus the engine's text, byte for
byte. Slice 0 records whether the engine's first token carries its own leading space; if not, the opener's trailing space is
part of the prefill text, so the model saw exactly what is stored. The stored reply is the concatenation of released text, opener included (rule 9 unchanged). The
phrasing round after a tool call (`model.ts:952`, PHRASE-01) reuses `state.messages` byte for byte, so the assistant
`tool_calls` message carries the opener as its content: the model knows it already said it.

### 1e. Cancel and interruption

- **Cancel:** the 4B call takes the session's abort signal (`turn.ts:553`, `session.controller.signal`); the route's existing
  cancel stops both calls. A speculative run (STT-SMARTTURN-01, held private) holds its opener with the rest and releases it
  only on confirm; a discarded run discards it, and nothing is logged but counts (rule 6a).
- **Interruption:** the heard prefix rule (rule 9) applies unchanged. Barge-in during the opener stores the part heard; the
  27B call is cancelled as today.
- **Engine failure after the opener:** the opener stays released (released text is never retracted, rule 10) and the turn
  follows the existing engine-unavailable path (`turnNext.ts:1240-1250`): the opener, then the outage line.

### 1f. When the 27B disagrees, refuses, calls a tool, or searches

- **Disagrees:** the opener has no stance, so there is nothing to disagree with. A topic sentence ("About Saturday.") is out of
  scope for the first build because it can misframe; the shadow (section 4) may test it later.
- **Refuses:** the refusal passes through (rule 10): "Okay, so. I can't help with that one." Awkward, not harmful; the shadow
  counts the rate.
- **Tool or search:** the 27B decides with `tool_choice: "auto"` after the opener, exactly as without it (rule 1). The opener
  never claims an action (shape check). The tool-start cue for slow packages and "Still on it" stay; the quick `ACK` does not
  also play (`cueSpoken` set). A search turn's first sound gains the most: today it waits for the call, the fetch and the
  phrasing round.
- **Crisis, consent, refusal and repair turns:** no opener. Talker-first starts only after the input safety node returns
  `commands`, never when `cueSuppressed` (`turnNext.ts:1280`), crisis, temporary-mode or grounding refusals apply, and never on
  bare, continuation or research turns (`model.ts:786`, `isResearchStyle`).

## 2. Safety

- **Rule 0, who gets it.** Only an identified adult (`turnAgeBand`, `turnMachine/speaker.ts:23`, returns `adult` from the
  signed-in person or confirmed speaker evidence) on a spoken turn of their own `chat` (voice and call) or `phone` surface.
  Never a child or teen; never an unknown speaker (the child band); never `robot`, `pod`, `tv`, `overlay` or any shared
  surface; never written chat. A test per band and surface proves a minor and a robot never get an opener.
- **Rule 10, gate before release.** The opener passes the same `StreamGate` as any reply sentence: for an adult that is the CSAM
  check and the crisis and self-harm floors (`outputGate.ts`, `safety.ts`), plus the non-content credential and private-data
  checks. A refused opener is dropped before release and the turn runs as today; the gate's refusal path is not triggered by a
  dropped opener (it never reached the gate's release).
- **What the 4B must not say:** commitments, yes or no, refusals, names, places, numbers, dates, times, medical, legal,
  financial or any factual claim, action claims, questions, and the person's own words (no echo, so a phone on speaker never
  repeats what was said). Section 1b enforces the machine-checkable half; the instructions carry the rest; the shadow measures
  what slips.
- **Rule 9 named gap: needed.** The opener is custom chat-path code (a second model's text entering the one stream). The
  stored-reply part of rule 9 is satisfied without change. Proposed wording below.
- **Rule 14: satisfied without change.** The opener and every 27B sentence are separate TTS requests already (one per sentence
  today), each in the companion's one voice, chosen per request by the scheduler. No second voice, no prompt prose about voice.
- **Rule 0's "nothing here changes how a spoken turn is shaped":** read with the owner's decision, an adult opener does change
  the shape of a spoken turn. The note asks for an explicit sentence in rule 0 rather than reading around it (proposed below).

## 3. Latency model (end of speech to first sound; all estimates, none measured)

Inputs (measured, from the brief): final transcript about 0.75 s after speech end; today's cue arrives 1.5 to 2 s after the
final; 27B first sentence 1.4 to 2.9 s after the final; first TTS chunk 0.25 to 1.4 s; first sound today 3.0 to 3.7 s.

| Path | Idle machine (est.) | Loaded machine (est.) |
|---|---|---|
| Today, first sound (cue or answer) | 3.0 to 3.7 s (measured) | up to 4.8 s |
| Today, first answer sentence heard | 2.4 to 4.1 s plus TTS, about 2.7 to 5.0 s | |
| Talker-first: 0.75 final + 0.05 safety + 0.1 to 0.3 4B + 0.25 to 0.4 TTS | **1.2 to 1.5 s** | 2.0 to 2.9 s (4B and TTS slowed by the 27B prefill) |
| Talker-first plus the speculative start (opener ready inside the pause, released on confirm) | **0.9 to 1.1 s** | 1.6 to 2.4 s |
| First content sentence heard, talker-first | today's value, +0.1 to 0.3 s (TTS and 4B on the same chip as the 27B prefill) | +0.2 to 0.5 s |

Saving on first sound: about 1.5 to 2.3 s idle, 1.0 to 2.0 s loaded (est.). It reaches the 1.3 s target on an idle machine
without the speculative start, and under it with it. It does nothing for the first content sentence and costs it a little.

**GPU cost.** The 4B writes about 10 tokens (0.05 to 0.15 s of GPU) while the context node runs, so mostly before the 27B
prefill starts. The opener's TTS (Chatterbox on the GPU) overlaps the 27B prefill of about 800 tokens; running two jobs on the
chip halves throughput while they overlap (CHAT-TPS-01), so the 27B first token may slip 0.1 to 0.3 s (est.). This is the main
cost and the A/B bounds it.

**Failure modes.**
1. A first sentence the 27B would not have said: "Ooh, good one." before bad news or a refusal. Measured in shadow
   (compatibility share) and the A/B (seam rate).
2. Double speaking: "Okay, so. Sure! So..." when the 27B adds its own opener after the prefill. Measured (double-opener rate). <!-- prose-lint: allow -->
3. Prosody seams: two utterances with a reset between them. Mitigated by the whole-sentence rule; judged by ear on 10 turns.
4. History drift: every stored reply now starts with a short opener, and the 27B copies the pattern into written replies or
   repeats the same opener. Mitigated by the recent-openers list and `NONE`; measured by rule 3's repetition measure on spoken
   companion turns and a written-turn opener count.
5. Cost of the volatile context: if a later change gives the 4B the volatile message, +0.15 to 0.3 s and a name-leak path.
   Kept out by design (condition 4).

## 4. Measurement and exit numbers

1. **Prefill spike (slice 0).** Splash 1.6.1 and llama-server: a trailing assistant message continues in place (no new turn,
   no repeated opener) with tools offered and thinking off, on 20 prompts; `prompt_n`, `cache_n` and `prompt_ms` with and
   without the prefill. Exit: continues on 20 of 20, extra prompt time under 30 ms. Fails: stop and report; option C is only
   built after its own shadow.
2. **Shadow (`chat.talker_first = shadow`).** The opener is written and checked but never released, spoken or stored. Bench
   side (CHAT-AB-01 spoken fresh set, bench texts only): the 27B runs with and without the prefill; a judge labels each pair
   compatible, awkward or contradicting, and flags a double opener. Live side (rule 6a): only numbers are logged per turn
   (opener latency, shape pass, gate pass, `NONE` share, and a compatibility label from the 4B judge run after the reply, off
   the critical path; no text). Exit to `on`: compatible at least 90% on the bench set (paired, 3 repeats), contradicting at
   most 2%, double opener at most 5%, shape pass at least 70% of eligible turns, 4B p50 at most 300 ms during a 27B prefill.
3. **A/B (a new CHAT-AB-01 row, rule 13).** Adult spoken turns, talker-first on vs off, 3 repeats, paired 95% intervals,
   end-of-speech stamps (the owner's new measure), with the opener's first sound and the first content sentence stamped
   separately (an optional `opener: true` on the first `delta`, so `voiceTiming.ts` can tell them apart; the research note's
   measurement flag 2). Bar: first sound median at least 0.8 s earlier; first content sentence median at most 0.3 s later;
   reply quality not worse (pairwise judge, interval excludes a loss); tool-decision recall and false searches not worse
   (rule 3); repetition on spoken companion turns not worse (rule 3); seam or double-opener rate at most 5%; the child, teen and
   robot rows unchanged and showing no opener.
4. **Kill switch.** `chat.talker_first`: household, admin only, `off` | `shadow` | `on`, default `off`, in `aiKeys.ts` beside
   `chat.search_assist` (spec first). `off` removes every talker effect, including the 4B call.

## 5. What changes

- **`spoken_cue` path: extended, not replaced.** On an eligible turn with the setting `on` and an opener ready, the opener goes
  out as reply text and `cueSpoken` is set, so the quick reaction, `ACK` and the bridge phrase do not play. Every other turn
  keeps the cue path as it is. `spoken_cue` keeps its "never stored" meaning.
- **Stored reply:** opener plus the 27B's text, the heard prefix on interruption (rule 9 as written).
- **Wire:** no new event type. The opener is a `delta`. One optional additive field, `opener?: true`, on that `delta` for
  timing only (rule 9: additions only). Robots, satellites and Go never receive an opener and ignore the field.
- **Frontend:** no speech change (the scheduler already speaks a whole first sentence at once); `voiceTiming.ts` reads the field.

### Build slices (dependency order; each 1 to 6 files, a test that can fail)

| # | Slice | Files (about) | Owner | Exit |
|---|---|---|---|---|
| 0 | TALKER-FIRST-00 prefill spike: Splash and llama-server continue a trailing assistant message with tools offered; cache numbers | `backend/scripts/bench/talkerPrefill.ts` (1) | Codex | Section 4 item 1 |
| 1 | Spec: `chat.talker_first` key and the catalog field `assistant_prefill`; commons tag; Home pin | commons `spec` settings and model record, `aiKeys.ts` (3) | Codex | Spec tests; key in the registry, default off |
| 2 | Opener writer: the `OPEN` form on `quickReaction`, shape checks of section 1b, recent list | `quickReaction.ts`, its test (2) | Codex | Fail-first tests: digits, names, echo, action words, `?` and stance words are refused; a good opener passes |
| 3 | Eligibility and start: `talkerEligible()` (band, surface, setting, catalog field, not crisis, cue-suppressed, bare, continuation or research); start the 4B after safety; wait cap | `turnNext.ts`, new `turnMachine/talker.ts`, tests (3) | Codex (high) | A child, teen, unknown speaker, robot and written turn never start the 4B |
| 4 | Shadow: run, check and drop the opener; post-turn compatibility label; typed log event, numbers only | `talker.ts`, the log event registry, tests (3) | Codex | No text in the log line; nothing released or stored |
| 5 | Bench: CHAT-AB-01 talker row and the prefill compatibility pass; `voiceTiming.ts` split stamps | `chat-ab-01.ts`, `labels.ts`, `voiceTiming.ts` (3) | Codex | The row prints both first-sound numbers |
| 6 | Release (`on`): prefill in the model node and the phrasing round, opener into the gate first, `cueSpoken`, optional `opener` field | `model.ts`, `messages.ts`, `turnNext.ts`, `routes/turn.ts`, `wire.ts`, tests (5) | Codex (high), Claude review | Stored reply equals released text with the opener; heard-prefix test; a tool turn keeps `tool_choice: "auto"` |

Slices 4 and 5 can run in parallel after 3. Slice 6 is built after the shadow exit numbers are met, and the setting goes to `on`
only after the A/B bar.

## 6. Proposed rule edits for the owner

Owner's ruling (2026-11-12, Jesse in the wizard: "Yes, add both lines"): edits 1 and 2 are applied to `RULES.md` as worded
below; edit 3 is not needed; edit 4 is not added.

1. **Rule 9, named gaps:** after "the prose tool-call fallback," add: "the talker-first opener (an identified adult's spoken turn
   on their own chat or phone surface may open with one short content-free sentence the resident small model writes; it passes
   the same output gate, is stored as released text, and the main model continues it by the engine's own assistant prefill
   with its tools still offered; owner-approved 2026-11-12, TALKER-FIRST-01),".
2. **Rule 0:** after "Where a rule below would do either, this rule wins." add: "The one exception is the talker-first opener of
   rule 9, for an identified adult only; it never reaches a child, a teen, an unknown speaker, a robot or a shared surface."
3. **Rule 1: no edit needed.** Talker suppression rides `cueSuppressed`, which is spoken-cue suppression, and the 4B gets no
   signal input (section 1a). If a later change feeds the signal's act to the 4B, add "and the talker-first opener's act" to
   the rule's list of signal uses first.
4. **Rule 13 (optional, not needed for the build):** add to the spoken rows: "A talker-first row reports the first sound and the first content sentence separately;
   the opener alone never counts as meeting the spoken bar's content row." (The bar itself is the owner's separate 1.3 s
   change.)

## Conditions this design keeps (for the architect and every slice)

1. Adults only, identified, own chat or phone surface, spoken; tests per band and surface.
2. The opener passes the one `StreamGate`; no second release path; released text never retracted.
3. The 27B keeps `tool_choice: "auto"` and its full tool set on talker turns; the opener never claims an action.
4. The 4B never receives the volatile context message, memory or documents.
5. Logs carry numbers only (rule 6a); bench texts stay in the bench.
6. Setting default `off`; `shadow` before `on`; `on` only after the CHAT-AB-01 bar.
7. No new wire event type, store, model or status surface (S6).
8. The 4B's sampling comes from its catalog record (rule 3).
9. Home adds no separator and trims nothing between the opener and the engine's text (rule 2).
10. Shape checks stay form-only; a failed check only means no opener.

## Architect verdict (2026-11-12)

NEEDS-RULE-CHANGE (maipai:architect, record `data-scratch/architect/TALKER-FIRST-01.verdict`). Edits 1 (rule 9) and 2 (rule
0) are required before slice 6 (release). Rule 1 needs no edit once the 4B gets no signal input (done in section 1a); edit 4
is optional. Rules 2, 4, 6a, 8, 12, 14 and S6 fit; not a duplicate. Slices 0 to 5 release and store nothing and fit the
existing spoken-cue gap; to start them before the owner rules they need their own item and verdict. Conditions 8 to 10 and
the section 1b reading are the architect's. After the owner applied edits 1 and 2 the same day, the note was ruled again
against the edited `RULES.md` (result in the same record).

## Spike result and decision (TALKER-FIRST-00, 2026-11-12)

`cd backend && bun run scripts/bench/talkerPrefill.ts --n 20` (through Home's own Stack client, since the Stack answers only
Home; `--engine llama=<url>` still takes a raw engine). Splash 1.6.1, the 27B chat model, the 10 base tools, thinking off,
opener "Okay, so.":

| engine | N | continued | repeated opener | leading space | tool calls plain vs prefilled | extra prompt tokens |
|---|---|---|---|---|---|---|
| splash | 20 | 20 of 20 | 0 | 0 of 20 | 4 of 20 vs 1 of 20 | 13 (median) |

Section 4 item 1 passes: the engine continues the open assistant turn every time, never repeats the opener, and the prefill
costs 13 prompt tokens (the prompt-time column is not comparable: the prefilled run followed the plain one on a warm cache).

**Not built (decision 2026-11-12, from the numbers).** Two reasons. (1) The prefill changed the tool decision: four prompts
that called a tool plain (r1-train, r2-quarters, r4-tank, q2-kilimanjaro) did not with the opener, and one (w1-story) did only
with it. Section 4 item 3's bar ("tool-decision recall and false searches not worse", rule 3) fails at the spike, before any
shadow. (2) The measured path makes the opener's gain small: with the speculative start on, first sound is 1.40 s median
(`speculative-start-2026-11-11.md`, "Measured"), and a content-free opener would move only the 0.21 s the confirmed run spends
to its first sentence, at the cost of the 27B's first content sentence slipping 0.1 to 0.3 s (section 3) and the seam and
double-opener risks of section 3. Revisit only if the speculative start plus a warm prompt cache cannot hold the 1.3 s bar
through the browser, and then only after the tool-decision change is understood (a different opener, or option C, may not
shift it). Nothing of slices 1 to 6 exists in code; the settings key is not registered.

## What I am not sure about

- Whether Splash honours a trailing assistant message with tools offered (slice 0 decides).
- Whether adult spoken turns run with thinking on today; if yes, thinking off on talker turns is a quality change the A/B must
  carry.
- How much the opener's TTS slows the 27B prefill on the shared chip (the A/B's first-content number decides).
- Whether content-free openers feel natural turn after turn, or wear thin (Jesse's ear plus the repetition measure).
