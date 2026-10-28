# Natural speech register: how people really say it (2026-10-27)

Owner's request (Jesse, 2026-10-27): compare Home against Loki Doki's work on humanistic conversation and design how to improve. His
examples: people are rarely absolute ("it's probably going to rain", not "it's going to rain"), and rarely formal ("it's four
o'clock", not "it's 4 PM"). Design only; nothing here is built.

Architect verdict: APPROVED on the third ruling (2026-10-27, record `data-scratch/architect/NAT-2026-10-27.r3.verdict`, note text at
f8c338e1a; rulings one and two rejected, `.verdict` and `.r2.verdict`). Two points to settle in NAT-03 and NAT-06 before building:
"two agreeing `web` sources" must become a typed count, and `clock_style: loose` maps to `timeStyle: plain` with the looseness coming
from the plan.

## Supersedes

Nothing is replaced wholesale. NAT-03 replaces the two hedging sentences in `INFORMATION_HANDLING_POLICY` and its `_WRITTEN` twin with
one paragraph. NAT-02 changes the clock-time branch of `normalizeForSpeech` in `commons/spec`. NAT-06 adds fields beside
`speech_style` and folds the humor dial into REG-02 (below) instead of opening a second disfluency item.

## Reuse check (done 2026-10-27)

| Candidate | Finding |
|---|---|
| `Intl.DateTimeFormat` with `dayPeriod` | Gives "in the evening" for a time; it cannot drop the part of day when obvious or say "quarter to four". Used for the zone math, not the wording. |
| `Intl.RelativeTimeFormat`, `Intl.NumberFormat` | Produce "in 3 hours" and "about 30"; no spoken rounding ("low seventies"). Not a fit for `say`. |
| date-fns, humanize-duration | Duration and relative-date phrasing in written form; a new dependency for a narrow gain (RELEASES-AND-DEPENDENCIES). Rejected. |
| `backend/src/lib/timezones.ts` | `resolveZone(place)` maps a place name to a zone. Not the household clock. |
| `backend/src/lib/news/dayParts.ts` | `hubTimeZone()`, `localDayKey`, `dayGroupOf`: the household's zone already exists and is what `now` is built from. Answers the time-zone question. |

## Answer

1. **Loki Doki's design is `docs/internal/voice-naturalness.md` in `legacy-backups/home-legacy.git`**, plus
   `plans/companion-architecture-review.md` section 3.5 in the archived Loki Doki repo. The first holds a corpus study of real
   recorded speech that boils down to eight mechanics (section 1). Home ported the idea and about half of the mechanics.
2. **Home states the rules in prose and has no way to see whether they work.** Hedging and rounding are two sentences in
   `INFORMATION_HANDLING_POLICY`. The model gets raw numbers ("70%", "4:00 PM") and is asked to talk them down. The speech
   normalizer then turns any clock time that still carries "PM" into "four o'clock in the evening", the opposite of what Jesse wants.
   The bench that checks all this has nine rows and answers "ambiguous" on every machine without a real model.
3. **The fix is three moves, in this order:** measure first (a real-model bench that fails today), then shape the evidence the
   model sees (a spoken form beside each exact value, a certainty band beside each secondhand fact), then change the one mechanical
   piece (the time normalizer). No word list rewrites a model's reply; chat rule 1 and rule 3 stay intact.
4. **A formality and hedging dial per companion** (professor says "four P M", teenager says "like four") rides on the speech-style
   work (`docs/design/companion-speech-style-2026-10-25.md`) and is the last slice.

## 1. What Loki Doki worked out (read 2026-10-27)

The study pulled verbatim exchanges from real recorded conversation (Santa Barbara Corpus of Spoken American English, classic
conversation-analysis extracts) and scripted dialogue across home-assistant domains. Eight mechanics, each testable:

| # | Mechanic | Example |
|---|---|---|
| 1 | Rounding is the default, precision is marked | "like thirty bucks", "five, ten minutes", never "72.4 degrees" or "a 37% chance" |
| 2 | Hedges stack | "probably about seventy degrees I would imagine" |
| 3 | Secondhand information carries an evidential, always | "supposed to be nice", "they say", "the radio said" |
| 4 | Answers are elliptical and reuse the question's frame | "What time is it?" gets "Five o'clock." |
| 5 | Facts are corrected flat and fast; opinions are disagreed with softly | "No, it's Riff." vs "it's warm though" |
| 6 | A re-asked question gets a shorter answer, and staleness is marked | "Still nine fifty-one." |
| 7 | "I don't know" is a real answer, under five words | "Not sure, honestly. Probably the update." |
| 8 | Acknowledgments are tiny and varied | "Sure." "Mhm." "Okay." |

Its implementation split the work by layer: a spoken-style prompt policy, a **tool gist** (the weather tool returned a short
spoken summary, not the data dump), a persona-flavored confirmation rewrite (alarm and smart-home acks in the character's voice),
delay-gated "one sec" cues that never enter history, a mechanical speech-text stripper, and a probe script whose output a human
reads. Its own notes record what the probe caught: "48% chance of precipitation" recited with high, low and humidity; a flat
"It's not going to rain today" asserted twice; a weekday correction that recited the full date; news read as a bare headline.

## 2. Where Home stands

| Mechanic | Home today | Verdict |
|---|---|---|
| 1 Rounding | One sentence in `INFORMATION_HANDLING_POLICY` and its written twin in `persona.ts`. Corpus row `rounding_is_the_default`. | Prompt only. The model still receives exact values. |
| 2 Stacked hedges | Not stated anywhere. | Missing. |
| 3 Evidentials | "forecasts, predictions and guesses get hedged" (`persona.ts`). Corpus row `secondhand_gets_an_evidential`. | One source type (forecast) named. Memory, web and guess are not distinguished. |
| 4 Ellipsis | Corpus rows `time_as_fragment`, `yes_no_as_fragment`, `list_as_sentence`. The reply plan (`register.ts`) caps sentences per act. | Brevity is built; reusing the question's frame is only measured, not steered. |
| 5 Correction vs disagreement | Corpus row `flat_correction_no_hedge`; the "search again, never promise to look it up" line. | Half. Softened opinion disagreement has no row. |
| 6 Re-ask is shorter, "still" | Nothing found in `backend/src`. | Missing. |
| 7 Brief "I don't know" | Corpus row `brief_i_dont_know`. | Measured, not steered. |
| 8 Tiny acks | Corpus row `tiny_acknowledgment`; `voiceCues.ts` places spoken sounds. | Built for continuers; acks in the character's voice not verified. |

Home is ahead on structure. `register.ts` reads the person's act and emotion and decides which moves are allowed. The persona
carries few-shot lines per age band. The speech-style note covers fillers and interjections per companion. What Home lacks is
the study's fine grain and any proof the grain reaches the reply.

### Gaps, ranked by how much Jesse would hear them

**G1. Clock times (his "4 PM" example). The normalizer makes it worse.**
`commons/spec/voice/ts/normalizeForSpeech.ts` reads "4:00 pm" as "four o'clock in the evening" and "9:51 p.m." as "nine fifty-one
in the evening". Nobody says that unless the day is unclear. People drop the part of day when the listener can tell (the next
few hours, today) and keep it when they cannot ("six in the morning" for tomorrow). They also round ("quarter to four", "around
four", "four-ish") unless the exact minute matters (an appointment, an alarm, a closing time). The normalizer has no idea what
time it is now, so it cannot tell which case applies. The written form is just as stiff: the model is free to write "4:00 PM" in
a typed reply and nothing steers it to "4 o'clock" or "around four".

**G2. Absolute statements (his "it's going to rain" example).** Home tells the model to hedge forecasts, but the evidence it
gets is "precipitation 70%". A 70% is easy to turn into "there is a 70% chance of rain" (mechanic 1 violation) or "it will rain"
(mechanic 3 violation). One prompt sentence cannot fight the evidence it sits next to. Hedges never stack, never scale with the
certainty ("probably" at 70%, "might" at 30%, "pretty sure" at 90%), and are never chosen by where the fact came from.

**G3. Precision leaks from tools.** Weather, prices, distances, durations and counts arrive with full precision. Loki Doki's probe
caught the data dump; Home has a prompt line against it and no gist field. Home's `weather_card` and typed outcomes
(CHAT-15 carries `source` and `as_of`) are the natural place for one.

**G4. No memory of the last answer.** Asked twice, the hub gives the full answer twice. A person says "Still four o'clock." or
"Two minutes less than last time you asked." Mechanic 6 needs the previous answer and its subject in the turn state.

**G5. One register for everyone.** The professor, the valley girl and the grandfather all get the same rounding, the same hedge
words and the same clock reading. The speech-style note varies fillers; nothing varies formality. Jesse's two examples are
formality and hedging, which are dials, and the persona already has a `formality` dimension that the clock normalizer and the
hedge guidance ignore.

**G6. The bench cannot catch any of this.** `backend/scripts/bench/naturalness.ts` runs nine rows by regex, is outside the gate,
and on any machine without a real chat model every row reports "ambiguous" (its own header says so). It has no row for stacked
hedges, re-asks, softened disagreement, a clock time with a minute, a percentage, a price, a date, or news framing. Per the
competencies file's bench rule, a row must observe an effect, not wording; none of these rows do.

**G7. Warmth over time** (open threads, relationship arc, short-lived mood, part of day) is the separate gap listed in the
earlier comparison. It is its own slice here (NAT-07) because it needs memory work, not register work.

## 3. Design

### 3.1 Principles

1. **The model decides; the evidence and the instruction shape it.** No word list rewrites a reply (chat rules 1 to 3). The one
   deterministic piece is the speech normalizer, which already exists to turn text into sounds and is mechanical by nature.
2. **Give the model the spoken form, not just the exact value.** If the evidence carries "about seventy", "probably", "quarter to
   four", the model's easiest move is to use them. If it carries only 70%, 3:45 PM and 72.4, its easiest move is to repeat them.
3. **Exactness is marked, not default.** Money, medication, appointment times, alarm times, closing times, anything the person
   will act on to the minute or the cent, stay exact. A tool marks a value `exact: true`; everything else may round.
4. **Safety and age first.** Rule 0 outranks everything: hedging is never applied to a safety instruction, a crisis line, a
   refusal or a child's safety answer. A child's reply is plainer, not vaguer.
5. **Measured by effect on a real model**, one bench row per mechanic, run on the household's chat model, before and after.

### 3.2 NAT-01: a bench that fails today (S, spec corpus plus bench; do first)

Extend `spec/llm/naturalness-corpus.json` from 9 rows to about 30, and make the bench report a number per mechanic. New rows:

| Row | Utterance | Fails if the reply contains |
|---|---|---|
| clock_drop_meridiem | "when does the bus come" (arrives 4:10 PM, now 2:30 PM) | "4:10 PM", "p.m.", "in the evening" |
| clock_round | "what time is it" (3:47) | "3:47 PM", "The current time is" |
| clock_exact_marked | "what time is my appointment" (3:47 exact) | a rounded time |
| absolute_forecast | "is it going to rain" (70%) | "it will rain", "70%", "percent" |
| hedge_scales | the same at 30% and 90% | the same hedge word at both ends |
| hedge_stack | "how warm will it be" | one bare number with no approximator |
| evidential_memory | "what did I say Pippa's recital time was" (low-confidence memory) | a flat claim with no "I think" or "if I remember right" |
| reask_short | the same question twice in a row, spoken surface only | the second answer as long as the first |
| reask_changed | the same, value changed | no mention that it changed |
| price_round | "how much was that" ($29.97) | "$29.97" |
| price_exact | "how much do I owe" ($29.97 due) | a rounded amount |
| date_trim | "is today Tuesday" (no) | a full date |
| opinion_soft | "that movie was great, right" (adult disagrees with the evidence) | a flat "No" |
| news_framed | a headline | a bare headline with no "apparently" or "it says" |

Each row has a seeded evidence record, so the check reads the reply, and the same row also checks the evidence the model got
(that the shaping slices actually reached it). The bench runs against the local coder model through `local-lane` and against
the chat model, and prints a pass count per mechanic. **Baseline recorded before NAT-02 starts.** Acceptance for NAT-03 and
NAT-04 is a CHAT-AB-01 row each: the hedge and rounding rows must pass at least as often as the recorded baseline on the chat
model, and the A/B comparison against the pre-slice prompt must show no loss on the other mechanics.

### 3.3 NAT-02: clock times the way a person says them (S-M, spec first)

`normalizeForSpeech` gains an optional `now` and a `timeStyle` (`formal` keeps the part of day and says "four P M"; `plain` is the table
below; NAT-06's `clock_style` supplies it per companion). Rules, in order:

| Input | Situation | Spoken form |
|---|---|---|
| 4:00 pm | today, within the next 12 hours | "four o'clock" |
| 4:10 pm | same | "four ten" |
| 9:51 p.m. | now is 8:00 pm | "nine fifty-one" |
| 6:00 am | tomorrow | "six in the morning tomorrow" |
| 6:00 am | now is 9:00 pm, no day given | "six in the morning" (cannot be today, so say the part of day) |
| 12:00 pm / 12:00 am | any | "noon" / "midnight" (unchanged) |
| 3:45 | any | "three forty-five" |

The normalizer only pronounces; it never rounds or softens a minute, so it cannot change a fact. The part of day is dropped only
when the listener could not mistake it. `now` is the household's clock from `hubTimeZone()` (`news/dayParts.ts`), never the
server's; Loki Doki's own review flagged server-local time as wrong for remote clients. Rounding ("quarter to four", "like four")
is not done here; it is `say` in NAT-04, chosen by the model from evidence.

The written reply gets the same help from the evidence (3.5), not from rewriting: a time field arrives as
`{ exact: "15:47", say: "quarter to four" }`, and the model picks. CHAT-CLOCK-01's position and day granularity rules
still govern when a time or date opens a reply; `say` changes only how a time is worded, never whether it is stated.

### 3.4 NAT-03: an uncertainty ladder that scales and stacks (S-M)

Replace the two hedging sentences with one short paragraph in both policy twins, and give every secondhand fact a `certainty`.

| Certainty | Comes from | Typical words |
|---|---|---|
| sure | the household's own record, a live reading | no hedge ("It's 72 in the living room.") |
| likely | forecast at or above 60%, a retained outcome whose `OutcomeSource.kind` is `reference` (the offline library) | "probably", "looks like", "should be" |
| maybe | forecast 30 to 60%, a single `web` source (`OutcomeSource.kind` is `web`); two agreeing `web` sources count as likely | "might", "could", "maybe" |
| unlikely | forecast under 30% | "probably not", "doubt it" |
| recalled | a stored memory with low confidence or age | "if I remember right", "I think" |
| reported | a web page, a news item, something the person told it about someone else | "apparently", "it says", "they're saying" |

The paragraph states the principle (match the hedge to the certainty and the source, stack two when both apply: "probably around
seventy, I'd guess") and gives three before-and-after pairs. The word lists above are guidance for authors, not code that scans a
reply. A typed outcome (CHAT-15's `source`, `as_of`) gains `certainty`; the weather package maps its probability to the band
(spec first, then the package). Child and teen listeners get the sure and likely bands only for anything touching safety; a
safety instruction is never hedged. "Touching safety" is the turn's existing safety result,
not a reading of the person's words. No new field: it is `state.safety.flagged` (`SafetyResult` in `turnMachine/contract.ts`) on the
turn, and a listener under the age gate gets sure and likely bands only while it is true. A new "official source" type is not
added; if one is wanted later it goes into `commons/spec` first.

### 3.5 NAT-04: a spoken form beside every exact value (M)

Typed outcomes gain an optional `say` beside the exact value, built by the package that knows the unit. A time value keeps the
CHAT-CLOCK-01 position and day granularity rules; `say` for a time is wording only:

| Exact | `say` |
|---|---|
| 72.4 F | "low seventies" |
| 37% rain | the certainty band, not a number |
| $29.97 | "about thirty bucks" |
| 1.8 miles | "a couple miles" |
| 7 minutes | "five, ten minutes" |
| 17 items | "a bunch" or "seventeen" per `exact` |

`exact: true` suppresses `say`. The model sees both and the prompt says: use `say` unless the person asked for the exact value.
One shared rounding helper in `commons/core` serves every package, so a new package never writes its own (principle 4). The
catalog weather, price and distance packages adopt it one at a time; nothing breaks for a package that does not.

### 3.6 NAT-05: the same question twice (S-M)

The turn state keeps the last answer's subject, its evidence fingerprint and its `say` text. If the same subject is asked again
within a short window, the reply plan gains a move `echo`: unchanged evidence allows "Still X." or a shorter paraphrase; changed
evidence requires naming the change ("Seven minutes now, was ten."). The model decides, from the conversation, whether the person did not hear it; the shortening is allowed, never required. This reuses
the existing move table in `register.ts` and needs no new subsystem. Surface scope (rule 5): the shortening applies only on spoken turns and on child or teen chat, which keep their own limits. On adult
written chat `echo` may only require naming a change; no instruction shortens the answer. Constraints: `echo` is a reply-plan move chosen from typed
state (subject id, fingerprint, elapsed time), never from matching the person's words; it never applies on a child or teen
safety subject; the record holds ids and fingerprints, not reply text (rule 6a).

**As built (2026-10-28):** `backend/src/lib/echo.ts` keeps the record in memory per conversation and subject (package id plus bound arguments), with a 5 minute window. The ReplyPlan spec declares exactly eight moves ("no item may add a ninth"), so `echo` is not a plan move: a typed `repeat` note (`unchanged` or `changed`, seconds since, one instruction) rides in the tool evidence beside the fact, like the NAT-03 band. Shortening is suggested only on spoken turns and on child or teen chat; adult written chat only gets "say what changed" or "answer as completely as usual". A flagged safety turn gets no note.

### 3.7 NAT-06: formality and hedging as companion dials (S, after the speech-style slices)

Two persona fields, spec first, defaults leaving every current companion unchanged:

| Dial | Values | Effect |
|---|---|---|
| `clock_style` | formal, plain, loose | "four P M" / "four o'clock" / "like four" (read by the prompt as a per-request mechanism, not prompt prose; the normalizer never rounds) |
| `hedging` | low, medium, high | how often a hedge appears when certainty is below sure |

The English professor gets formal and low; the valley girl, loose and high; the grandfather, plain and medium. Per rule 14 these are per-request mechanisms (the dial value becomes a plan input, not a paragraph of persona text), and the
humor, disfluency and filler side is the same surface as REG-02, so NAT-06 extends REG-02 instead of opening a parallel item. This sits beside
`speech_style` in the same Companions app form and follows the same rule: the household changes the rate, the author owns the
words. The existing `formality` dimension is an input to the defaults so authors do not set three dials by hand.

**As built, NAT-06a (2026-10-28):** `spec-v0.1.262` adds `clock_style`, `hedging` and `social` {humor, warmth, initiative} to the companion block. `clock_style` formal keeps "4:00 PM" and plain or loose say "four o'clock" (the normalizer never rounds, so loose equals plain). `hedging` low or high rides in the certainty evidence only when a fact is below sure. `social` shapes the reply plan: low humor forbids playfulness, low warmth forbids `react`, high warmth allows `react` on inform and commissive turns, low initiative forbids `ask_back`, high initiative allows it; required care and age gates always win. The Companions editor shows the five dials beside the existing four; the API takes `humor`, `warmth` and `initiative` flat and stores them under `social`. **Deferred to NAT-06b:** the `wants_advice` signal (needs a TurnSignal spec change, classifier work and another tag).

**As built, NAT-06b (2026-10-28):** `spec-v0.1.264` adds an optional `wants_advice` (`yes` or `no`) to `TurnSignal`. `adviceOf` in `turnSignal.ts` reads only the person's own words ("I just need to vent", "I don't want advice" for no; "what should I do", "any advice" for yes; no wins), never tone, and leaves the field absent otherwise. In `planFor`, `no` forbids `say`, `pick`, `point` and `ask_back` (care stays required; a required `say` on a question survives) and the plan line says "do not give advice". `yes` on an emotional turn allows `say`, raises the cap to three sentences and sixty words, and the plan line says "then give the advice they asked for". Anger at the hub still wins. A trained head for the field is not built; the rule cues are the whole classifier.

### 3.8 NAT-07: warmth over time (M, separate design)

Designed in [warmth-over-time-2026-10-28.md](warmth-over-time-2026-10-28.md).

Open threads ("how'd the interview go?"), a relationship arc ("it's been a few weeks"), a short-lived mood tier (3 to 7 days),
and a part-of-day line. Backlog competencies B3 and F1 already name the first as missing; Loki Doki's review ranked it the best
warmth for the fewest tokens. It needs the memory judge and recall to change, so it gets its own design note after NAT-01 to
NAT-05 land and the bench shows what is still flat.

### 3.9 What the outside proposal adds (ChatGPT, pasted by Jesse 2026-10-27)

The proposal is a "Conversational Humanization Engine" of three subsystems: social intelligence (perceive emotion, intent, familiarity,
pick a move), a real-time dialogue controller (turn-taking, backchannels, interruptions), and a speech performance engine
(prosody, phrasing). Compared with Home, read 2026-10-27:

| Proposal | Home today | Verdict |
|---|---|---|
| Social perception state (emotion, confidence, intent, energy, recommended move) | `TurnSignal` already carries `expressed_emotion`, `emotion_confidence`, intensity and target; `register.ts` turns it into a reply plan of allowed and required moves (react, care, say, ask_back, close). | **Already built.** Same shape. Gap: no `wants_advice` versus `venting` field and no `familiarity`. |
| Real-time dialogue controller, full-duplex states, backchannels, repair | `docs/design/full-duplex-voice-2026-10-24.md`: end-of-turn model, barge-in, what to do with the rest after an interruption, continuers and acknowledgements, with research cited. | **Already designed in more depth.** Nothing to add; its slices (DUPLEX-*) own it. |
| Speech performance engine (prosody, pacing, emphasis) | Spoken-only sounds in `voiceCues.ts` and the speech-style note; prosody is limited by the TTS engine. | **Partly.** The proposal's "approved text before speech" boundary matches Home's rule. |
| Persistent personality parameters (humor, warmth, initiative, talkativeness, directness) | `Persona` has `formality`, `complexity`, `engagement` (brief, balanced, curious), `filler_density`, and `directness` in the plan. | **Gap:** no humor, warmth or initiative dial; talkativeness is the three-step `engagement`. |
| Four memory types (episodic, semantic, relational, active) with a relevance and intrusiveness policy | Episodes and facts exist; competencies B3 and F1 name the active follow-up as missing. | **Gap:** relational memory (shared jokes, familiar topics) and active threads. This is NAT-07. |
| Never invent a shared experience | Guards against claiming experience and false memory exist. | Built. |
| Measure with real conversations: turn latency, false interruptions, backchannel accuracy, repetition, blind ratings | Only the naturalness bench; latency measured in the duplex note. | **Gap:** no per-mechanic scoring of conversations. NAT-01 adds it for register; a recorded-conversation rating is added below. |

What is genuinely new and worth taking:

1. **Dials for humor, warmth and initiative** beside the existing ones, as baselines that the turn's signal can override (a joke
   is dropped when the person is upset; a quiet companion gives a longer answer to a hard question). One more persona field set,
   spec first, folded into NAT-06 as `social` (humor, warmth, initiative, each low, medium, high). Three steps, not percentages:
   a sub-step difference in a slider is not something a model or a listener can tell apart.
2. **The "wants advice or just venting" distinction** as one more `TurnSignal` field, which is what separates "Oh no, what happened
   now?" from a list of coping tips. Its only effect is on the reply plan (`care` and `ask_back` move choice). Spec first.
3. **A blind-listener rating**, with consent and only from the household's own opt-in recordings, as the last check on the whole
   stack, run by Jesse by ear rather than by script. It complements the bench; it does not replace it.

What is not taken: training separate perception and turn-taking models on a 210-hour annotated dataset (the duplex note already
picks off-the-shelf end-of-turn models and measures them), and percentage sliders.

### 3.10 What Dessa adds (audited 2026-10-28; Block's own claims and press clips only, no weights, paper or benchmark)

Dessa (Block, a speech-to-speech model with no text step) cannot be adopted: no weights, no license, and a text-free model would bypass
the age gates, memory and model choice that Home runs on text. What its clips show is a speaking style, and that is measurable here.
Jesse's transcription of it: "I'm", "yeah, it's pretty much what I say", "I, I like to", "yeah, yeah", "ah, I wish I was", "is like, ah, a
combination between English and German so it's kinda like a". Five mechanics, checked against what Home already designs:

| Dessa mechanic | Already in Home? | Verdict |
|---|---|---|
| Fillers and interjections ("ah", "like", "oh") | Yes: REG-02 `voiceCues.ts` and SPEECH-STYLE-01 to 05 (master list, rate, placement, adults only, spoken only) | Reuse. Add "ah" as a thinking-sound candidate to the master list; no new mechanism. |
| Backchannels and continuers while the person talks ("yeah", "got it") | Yes: `full-duplex-voice-2026-10-24.md` 3b and SPEECH-STYLE-05 | Reuse. Correction to the Dessa summary given 2026-10-28: this was already designed; nothing new here. |
| Contractions and casual wording ("I'm", "kinda", "yeah" as an opener, "pretty much") | Yes in the prompt: `FORMALITY_FRAGMENT` in `persona.ts` (spoken class) already asks casual companions for contractions and easygoing phrasing, neutral for contractions, formal for none; `COMPLEXITY_FRAGMENT` asks for everyday language. Not measured: the bench has no row for it | **Measure only, NAT-08.** |
| Restarts and repeats ("I, I like to", "yeah, yeah") | No: the master list has fillers, interjections and tags, not repeats | **Gap, NAT-09.** |
| Trailing off ("so it's kinda like a") | No | **Rejected.** An unfinished reply is an incomplete answer; Dessa can trail off because the other speaker can chime in (real full duplex). Home answers completely (rule 1). Revisit only with DUPLEX playback that can accept a cut-in. |

**NAT-08, measure the informal spoken register (S, bench only; architect 2026-10-28 rejected a new sentence under rule 14).** The
existing `FORMALITY_FRAGMENT` already asks for contractions, so adding a second sentence would copy it and put companion voice in
prompt prose. NAT-08 adds only the two fail-first rows to the NAT-01 corpus: the contraction rate on a casual-companion spoken turn
(expected high) and the rate on the formal professor (expected zero). If the casual row fails on the chat model, the fix goes through
the per-request mechanism, with `formality` as a plan input the way NAT-06 carried `clock_style` and `hedging`, and that fix gets its own
ruling and its own entry in `## Supersedes`. No output rewriting either way.

**NAT-09, restarts and repeats (S-M, after SPEECH-STYLE-02).** A new sound kind `repeat` in the master list (`spec/voice/speech-sounds.json`):
the composer doubles one word from a closed list of eligible function words (named in the `repeat` entry, floor-tested for every band like every master-list entry) at a clause start ("I, I like", "yeah, yeah") in the spoken text only, as REG-02 inserts a
cue. Gates: adults only; spoken only (typed, stored and heard-prefix text never carry it); never in numbers, names, steps, safety lines
or `exact` values; at most one per reply; and it only fires when the plan marks the turn as musing (a `say` or `react` move on
opinion, memory or explanation, or a NAT-03 certainty band below sure; the trigger reads typed plan fields only, never the reply's wording), because the research already recorded in
`persona.ts` says prompted hesitation in a confident answer lowers perceived confidence. The rate comes from the companion's
speech-style rate, so `none` (the professor) never repeats and `lively` does. This is the composer's insertion, not a rewrite of
the model's wording, the same standing as REG-02's cues; architect ruling NAT-09, 2026-10-28 (`data-scratch/architect/NAT-09.verdict`): approved on that reading. A repeat never doubles a filler or interjection the composer itself inserted, and per-voice `says_badly` is judged by ear in SPEECH-STYLE-04. A repeat carries a `rule:` marker, a
counts-only counter and a test row that fires it (the learned-components rule).

**Not changed by Dessa:** NAT-07 (warmth over time) is untouched; Dessa's emotion handling is audio-side and has no text analogue.
Audio-derived tags on the turn signal (laugh, sigh, raised voice) are recorded as a later idea behind DUPLEX-02's measurements, not a
slice: a spec change with no measurement behind it yet.

## 4. Gates

- **Rule 0 and the child floor:** a child or teen turn never receives hedged safety content; `say` forms for a child are plain
  ("a little over an hour"), not slang. A unit test runs the child floor over every `say` template.
- **Rule 6a:** the bench logs counts and pass rates, never reply text from a household turn. Bench rows use seeded fixtures only.
- **Learned components:** the certainty bands are fixed numeric thresholds on typed data, not a reader of the person's words, so
  they carry a threshold constant and a test row but no classifier. The architect confirms that reading.
- **Exactness list:** money owed, doses, alarms, appointments and closing times are `exact` in their packages; a package test
  keeps each of them exact.
- **API changes are additive:** `say`, `certainty` and `exact` are optional; old packages and old clients keep working.

## 5. Slices

1. **NAT-01 (S):** corpus to about 30 rows, bench prints a pass count per mechanic, baseline run on the chat model and on the
   local coder model. Reported before any other slice starts.
2. **NAT-02 (S-M):** spec: `now` and `timeStyle` in `normalizeForSpeech`, fixtures from the table in 3.3; pin; hub passes the
   household clock from `hubTimeZone()`.
3. **NAT-03 (S-M):** `certainty` on typed outcomes, the weather package maps it, the policy paragraph replaces two sentences in both
   twins.
4. **NAT-04 (M):** the shared rounding helper, `say` and `exact` on outcomes, weather, price and distance packages adopt.
5. **NAT-05 (S-M):** the `echo` move and the last-answer record in turn state.
6. **NAT-06 (S):** `clock_style`, `hedging` and `social` (humor, warmth, initiative) dials, the `wants_advice` signal field,
   Companions app control (kit parts only).
7. **NAT-07 (M):** warmth over time, designed in [warmth-over-time-2026-10-28.md](warmth-over-time-2026-10-28.md) (approved, not built).
8. **NAT-08 (S):** two bench rows for contractions, no new prompt sentence (section 3.10). Built 2026-10-28: `contraction_casual` (buddy) and `contraction_formal` (tutor), spoken surface, scored in `register.ts`; no real-model run yet.
9. **NAT-09 (S-M):** the `repeat` sound kind, after SPEECH-STYLE-02 (section 3.10).

Order: 01, then 02 and 03 in parallel (different repos), then 04, 05, 06, 08, then 07 and 09 (09 waits for SPEECH-STYLE-02). After each slice the bench is re-run and the pass
counts recorded in the BACKLOG item; a slice that does not move its rows is reverted.

## 6. What I did not verify

- Whether the persona-flavored confirmation rewrite (Loki Doki's `personaFlavorReply`) exists in `turnNext.ts`. A grep matched
  the file; I did not read the code.
- The text of chat rules 1 to 3 beyond the AGENTS.md summary; the architect should check that shaping the evidence stays on the
  allowed side of "no output rewriting".
- A real-model run of the current bench. Every statement about how the model behaves today rests on Loki Doki's recorded probe
  results and on reading the prompt, not on a fresh run.
