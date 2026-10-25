# Companion speech style: how often each companion hesitates, and with which words (2026-10-25)

Owner's request (Jesse, 2026-10-25): control the rate and the types of disfluency per companion. An English professor probably has none; a
valley girl has a lot, mostly "like", "no way" and "get out"; a kid might say "um". Design only; nothing here is built.

Architect verdict: not yet run. Needs one before any slice is built.

## Answer

1. **One master list of speech sounds, and each companion gets a speech style that picks from it: a rate plus its chosen sounds.** The words
   named below ("like", "no way", "get out", "um") are examples, not the list. The master list is a curated, versioned data file with
   every sound Home knows how to say (section 2a); a companion picks entries from it and sets how often, and a household may add its own
   custom entries, which are checked when they are saved.
   Each style has a rate and a vocabulary. The vocabulary has three kinds of sound: fillers
   ("um", "like", "you know", "well"), interjections ("no way", "get out", "oh my gosh", "seriously?") and nonverbal tags (the six the
   voice engine honors: laugh, chuckle, cough, sigh, clear throat, gasp). A companion with no style (the professor, a news anchor)
   speaks exactly as written.
2. **It extends REG-02, it does not replace it.** The household setting `voice.hesitations` (off, light, natural) stays the master: a
   household that turns it off turns it off for every companion, and a household at "light" caps a "lively" companion at "light". A
   companion without a style keeps today's behavior.
3. **It only ever touches what is spoken.** The typed reply, the stored reply and the heard prefix never carry a filler or an
   interjection that this style added (the written register of `filler_density` is separate, section 1). The speech normalizer (dates, numbers, units) runs on the text first, and the style is applied to the normalized
   spoken text only.
4. **Adults only, as today.** A child or teen listener never gets a cue, whatever the companion is (REG-02, owner ruling 2026-10-06,
   chat rule 0). A kid-character companion therefore says "um" to an adult and nothing to a child.

## 1. What exists today (read 2026-10-25)

- **`Persona.filler_density` (`none`, `light`, `frequent`) already exists** on the companion manifest in `@maipai/spec`, shown in the Companions
  app as the "Casual chatter" dial (`companionsApp.ts`). `persona.ts` turns it into prompt prose (`FILLER_FRAGMENT`): the model is asked to write
  "honestly,", "I mean," or "like" into the reply text itself, so it appears on every surface, typed or spoken. That is the **written
  register** and it stays exactly as it is. This note adds the **spoken-only sounds** (a "hmm", a laugh, an interjection) placed after
  the output gate, in the speech text only. The boundary: `filler_density` is words in the reply; `speech_style` is sounds added to what is
  spoken. They do not double: an inline filler is never added to a sentence that already contains that filler, and a companion whose
  `filler_density` is `frequent` and whose `speech_style` lists "like" gets no second "like" in the same sentence.

- `backend/src/lib/voiceCues.ts` (REG-02): the composer, never the model, decides where a spoken reply gets a cue. Two presets,
  `light` (one per reply, three replies between cues, a 60% chance) and `natural` (two per reply, one reply between, 90%, an opener
  filler 40%). Insertion only at sentence boundaries, never in a protected sentence (a number, a link, an instruction step, safety
  wording), never on a safety, refusal, crisis, alarm, timer or tool line. One tag per cue, from the six the engine advertises. A filler
  is "Hmm," or "Well," only. Triggers are fixed word patterns (humor, surprise, weariness).
- `backend/src/routes/tts.ts` applies it per sentence for a spoken turn (`turn_id`); `voice.hesitations` is a household setting.
- A companion's voice is already a household setting per companion (`companion.voice.<id>`, DYNAMIC-COMPANION design), and the
  speech normalizer is the shared library in `commons/spec/voice`. Register (brevity, hedging, contractions) is a prompt concern
  (the legacy corpus study); the mechanical sounds are not.
- Measured 2026-10-25: at the default "light" level eleven test sentences produced no cue; one laugh appeared on a sentence with a
  humor word on the second reply. That is what the preset is for, and it is why a lively companion needs more than the household
  presets give.

## 2. The speech style

A companion definition (the package manifest of a catalog companion, and the bundled set) gains an optional `speech_style`:

| Field | Meaning |
|---|---|
| `rate` | `none`, `sparse`, `light`, `natural`, `lively`. Maps to the knobs below. Missing means today's household level. |
| `fillers` | Up to eight entries `{ text, weight, where }`. `where` is `start` (opens a sentence: "Um,", "Well,") or `inline` (inside a sentence at a clause boundary: "like,", "you know,"). |
| `interjections` | Up to eight entries `{ text, on }`. `on` is the situation it answers: `surprise`, `agreement`, `humor`, `sympathy`, `excitement`. Each is a whole short utterance placed before or after a sentence ("No way", "Get out"). |
| `tags` | A subset of the six engine tags this companion may use, in order of preference. |

Rates, as numbers the planner already has (a new `lively`, and a `sparse` between none and light):

| Rate | Cues per reply | Sentences between | Replies between | Chance | Opener filler | Inline filler per sentence |
|---|---|---|---|---|---|---|
| `none` | 0 | | | | | 0 |
| `sparse` | 1 | 4 | 5 | 40% | 10% | 0 |
| `light` (today) | 1 | 3 | 3 | 60% | 20% | 0 |
| `natural` (today) | 2 | 3 | 1 | 90% | 40% | 0 to 1 only for a companion that lists inline fillers |
| `lively` | 4 | 1 | 0 | 90% | 50% | up to 1, never two sentences in a row |

Examples (authoring defaults, judged by ear per voice before they ship):

| Companion | Rate | Fillers | Interjections | Tags |
|---|---|---|---|---|
| English professor | `none` | none | none | none |
| Valley girl | `lively` | "like," inline (weight 6), "you know," inline (2), "oh my gosh," start (2) | "No way" and "Get out" on surprise, "Seriously?" on surprise, "Totally" on agreement | laugh, gasp, sigh |
| Kid character | `natural` | "um," start and inline (6), "uh," (2), "like," inline (1) | "Whoa" on surprise, "Cool" on excitement | laugh |
| Grandfather | `light` | "well," start (4), "uh," (2) | "Is that so." on surprise | chuckle, cough, clear throat |
| Calm tutor | `sparse` | "hmm," start (1) | none | none |

## 2a. The master list, and custom sounds

The words in section 2 are examples. The real vocabulary is one master list that ships as spec data (`spec/voice/speech-sounds.json`, spec
first, versioned like the speech normalizer), so every companion, every voice and every household reads the same definition (principles
1 and 4). Each entry is plain data:

| Field | Meaning |
|---|---|
| `id` | Stable name (`like`, `um`, `uh`, `you-know`, `well`, `hmm`, `no-way`, `get-out`, `oh-my-gosh`, `seriously`, `totally`, `whoa`, `laugh`, `sigh`, ...). A companion refers to an entry by id and sets a weight. |
| `kind` | `filler`, `interjection` or `tag`. |
| `text` | What is handed to the speech engine (for a tag, the engine tag; for a filler or interjection, the spelling that reads best, which may differ from how it is written: "um" and "umm", "like,"). |
| `where` | For a filler, `start` or `inline` or both; for an interjection, `before` or `after` a sentence. |
| `on` | For an interjection, the situation it answers (surprise, agreement, humor, sympathy, excitement). |
| `voices` | Which voices say it well, from listening (a voice that says an entry badly, or an engine without the tag, skips it, never a mangled line). |
| `floor` | Reviewed against the child floor when added, and a unit test keeps every entry passing for every band. |

- **A companion's style is a list of ids with weights**, plus the rate. A companion author can write a very short style ("um, uh, like at
  a low weight, laugh") or a long one, and never has to spell a sound.
- **Custom sounds are allowed.** A household (an adult, in the Companions app form) may add its own filler or interjection for one
  companion, with the same fields. A custom entry is household data on that companion only: it is checked against the output floor for
  every band when the form is saved, refused with a plain reason if it fails, never logged, and never shared with another household
  unless it is added to the master list by a spec release. A custom entry cannot be a tag, since only the engine's own tags exist.
- **The master list grows by a spec release, not by a patch**: adding "get out" for everyone is a data change, reviewed once, with a
  listening pass on the shipped voices (SPEECH-STYLE-04).
- **No word list of household speech:** the list is authored data about what a character says, not a rule that reads what people say.

## 3. Where it is authored and who can change it

- **Authored by the companion's author**, as part of the character (package manifest, spec first). The bundled companions get their
  defaults here; a household-made companion fills the same form in the Companions app.
- **Household controls, no bigger than the master:** one household setting per companion beside its voice and its existing "Casual chatter"
  card (one card, not a second parallel control), `companion.speech_rate.<id>` (`default`, `none`, `sparse`, `light`, `natural`, `lively`), so a household can quiet a chatty companion
  or turn it up. The effective rate is never above `voice.hesitations` (master "off" is off for all; master "light" caps a lively
  companion at light). The vocabulary itself is the author's; the household changes the rate, not the words. A household-made companion's fillers and interjections are free text an adult types in the Companions app form: the same deterministic output floor for every band runs over each entry **when the form is saved**, an entry that fails is refused with a plain reason, and entries are never logged (rule 6a), as catalog companions are refused at install.
- A person's own settings page lists no per-companion words, so a minor has nothing to see or change.

## 4. How the words are placed

- **Sentence-edge sounds** (a start filler, an interjection, a tag) use the existing boundary rule and triggers. Interjections get their
  own trigger pattern per `on` category, from the same fixed patterns the tags use today (humor, surprise, agreement words), so "no way"
  follows a surprising sentence and not a flat one. Each new pattern (agreement, sympathy, excitement) reads Home's own reply, not the
  household's words, and still carries a `rule:` marker naming this note, a counts-only counter and a test case that fires it (the
  learned-components rule: no rule without a counter and a row).
- **Inline fillers are new and are the risky part.** One inline filler per sentence at most, only in a sentence of at least eight words,
  only at a clause boundary: right after a comma or a coordinating conjunction (and, but, so) and before the next clause, never in the
  first or last two words, never between a number and its unit, a name and its title, or in a protected sentence. The inserted text is
  `like,` or `you know,` with its commas, which the voice reads as a short beat. A seeded roll keeps tests and replays stable.
- **The order is fixed:** normalize numbers and dates first (so a digit never meets a filler), then place sentence-edge sounds, then
  inline fillers, then check the whole line against the protected rules once more.
- **Voice and tags:** a tag is kept only if the active engine advertises it (Pocket TTS advertises none, so a companion on that voice
  gets words but no laughter). Whether a voice says "like," well inline is judged by ear per voice (VOICES note): a voice that does not
  gets its inline fillers turned off, never a mangled line.

## 5. Gates

- **Rule 0 and REG-02:** listener band first. A child or teen listener gets no cue, no filler, no interjection, whatever the companion
  or the rate. No setting reopens it.
- **Rule 10:** every filler, interjection and tag is fixed text in the companion definition, reviewed against the child floor when it is
  written (a unit test runs the output floor over every entry for every band, as the continuers do), so no per-use gate is needed. A
  companion definition that fails the floor is refused at install, and a household-written entry is checked the same way when it is saved
  (rule 10's authoring-time exemption needs the words checked when they are written).
- **Rule 14:** the style is chosen per request from the companion resolved for that request, in the same place the voice is resolved;
  it is never prose in the prompt. A companion switch (COMPANIONS-MULTI-01) switches the style with the voice.
- **Rule 6a:** counts only (cues placed per rate, never the words or the transcript).
- **Not on safety lines:** the same blocked lines as today (safety, refusal, crisis, alarm, timer, tool status).
- **Characters, not real people:** a style describes a made-up character's habit. It names no real person and is not built from a
  household member's recorded speech.

## 6. Research behind the defaults (soft)

Evidence is thin and mostly from blog analyses and abstracts, so the table in section 2 is authoring guidance, not a rule:

- Filled pauses ("um", "uh") occur at roughly equal rates across age and sex; what differs is the form. "Um" is more common in younger
  speakers and in women at every age, "uh" rises with age and is more common in men
  ([Language Log, fillers by age and gender](https://languagelog.ldc.upenn.edu/nll/?p=13581)).
- Discourse markers ("like", "you know") are a separate factor from filled pauses and are more common among women, younger people and
  more conscientious people, from a factor analysis of five corpora (reported in the search result for this note; the paper was not
  read in full, so the claim is unconfirmed).
- Typically developing children use "um" two to three times more often than "uh" ([Language Log, UM/UH in children](https://languagelog.ldc.upenn.edu/nll/?p=25172)).
- Tottie (2011) found the opposite direction for total filled-pause counts (more in older people and men), so no single rate by group
  is claimed.

## 7. Slices

1. **SPEECH-STYLE-01 (S, spec first):** the master list `spec/voice/speech-sounds.json` (seeded with the examples above, floor-tested), `speech_style` (ids, weights and rate) on the companion manifest and the `companion.speech_rate.<id>` key family
   with the `companion.voice.<id>` family, absorbing COMPANION-VOICE-SPEC, with the floor test over every entry; spec tag, pin.
2. **SPEECH-STYLE-02 (M):** the planner: the `sparse` and `lively` rates, per-companion vocabulary, interjection triggers, the inline
   placement rules, the master cap. Tests for every gate in section 5 and for the inline rules on a fixture of sentences (numbers,
   names, lists, short sentences) so nothing lands inside a protected span.
3. **SPEECH-STYLE-03 (S):** the per-companion rate control in Settings and in the Companions app (kit parts only), and the author form that picks sounds from the master list and adds custom ones with the save-time floor check.
4. **SPEECH-STYLE-04 (M, by ear):** author the bundled companions' styles, render every preset sample through each shipped voice, and
   listen; a voice that says an inline filler badly turns inline off. Jesse judges the valley girl and the kid.
5. **SPEECH-STYLE-05 (S):** DUPLEX-07's continuers and acknowledgement clips come from the companion's own filler list when it has one
   ("mm-hm" for the professor's tutor, "oh my gosh" for the valley girl), rendered once per voice, same rules.
Order: 01, 02, 03, then 04 and 05.

## Supersedes

- `Persona.filler_density` and its "Casual chatter" card are **kept, unchanged**, as the written register (prompt prose). They are not merged into
  `speech_style`: merging would change a manifest field and needs its own ruling.

- `voice.hesitations` (off, light, natural) stays as the household master; it no longer is the only control. Nothing is removed.
- The fixed filler pair ("Hmm,", "Well,") in `voiceCues.ts` becomes the default list for a companion that has no style.
