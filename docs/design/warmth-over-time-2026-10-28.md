# Warmth over time: open threads, the gap since last time, part of day (NAT-07, 2026-10-28)

Owner's go-ahead (Jesse, 2026-10-28, "Write NAT-07"). Parent: [natural-speech-register-2026-10-27.md](natural-speech-register-2026-10-27.md)
section 3.8. Design only; nothing here is built.

Architect verdict: APPROVED 2026-10-28 on the third ruling (record `data-scratch/architect/NAT-07.r3.verdict`). First ruling REJECTED 2026-10-28 (record `data-scratch/architect/NAT-07.verdict`): no Supersedes section, no reuse check, the
offer stamp left open, a `sensitive` tag that clashes with the spec's, an event-expiry gap and a settings-key clash. This text answers all of them.

## Supersedes

- **`MEMORY_TRUST_REMINDER`** (`backend/src/lib/memoryFraming.ts`, "never bring up a person, pet or detail from it just because you know it")
  stays word for word. The opening item is its own labelled block, never under `MEMORY_SECTION_HEADER`, so the two never sit in one
  block. The reminder governs memory the model recalls; the opening item is a single typed offer the model may take or skip.
- **MEMORY-RELEVANCE-01**: "a record reaches the model when the question calls for it" becomes "or once, at the opening of a
  conversation, as one thread". `forceInclude` and recall ranking are unchanged. A thread record offered in the opening item is not
  also placed in the memory block.
- **CUR-01** (`docs/BACKLOG.md`, a dated `goal` or `event` fading the day after): the read for this item reaches back 1 to 14 days
  after the date. Only this read changes. Recall is untouched; the maintenance archive, the person's Archive, an edit's retire and forget keep their meaning and each now also writes `archived_reason` (section 2.2).
- **Settings**: a new person key, named in 2.3. It does not reuse `person.robot.follow_up` (robot listening) and states how it meets
  PREF-01's `chat.follow_up_questions`.

## Reuse check (done 2026-10-28)

| Need | Existing part | Verdict |
|---|---|---|
| Hold one open thread | MEM-06 `event`, `goal`, `project` records | Reused; no new store. |
| Ask once, then clear | The open-question queue (`open_questions`: `subject_id`, `pending` to `asked`, `asked_at`, expiry, retention) | Reused for the offer stamp: one new `kind`. A `last_offered_at` on the memory record would duplicate its lifecycle. Turn-row metadata would leave a record id beside an activity that can reach traces (rule 6a). |
| Mood after a rough week | MEM-06 `state` with `valid_to` and `STATE_EXPIRY_DAYS` | Reused; read only while in range. |
| Part of day | `dayPartOf` in `almanacCompute.ts` | Reused. |
| Greeting test | `isBareSocialTurn` in `guards.ts` | Only as the existing whole-utterance greeting check (2.1). |
| Withhold sensitive subjects | `vocab/life-events.json` classes `adult_to_tell`, the spec memory-record `sensitive` field | Reused as the deterministic floor (2.3). |
| Close the thread | The memory judge's supersede path | Reused; nothing new. |

## Answer

A companion that remembers "the interview was Tuesday" and asks how it went is warm. A companion that mentions the daughter during
a weather question is the bug fixed on 2026-10-27 (`MEMORY_TRUST_REMINDER`, v0.2.151). Both are the same memory; the difference is
when it surfaces. So warmth over time is not a recall change. It is one narrow, typed, once-only exception to "memory is background":
on the first turn of a conversation that opens after a gap, the model is offered at most one open thread and may ask about it or
skip it.

Four things the parent note bundled under NAT-07 reduce to one small mechanism plus one deferred item:

| Parent item | Verdict |
|---|---|
| Open threads ("how'd the interview go?") | **Build.** Needs no new store: a dated `event`, `goal` or `project` record (MEM-06 commissive clauses already write these) whose date has passed. |
| Relationship arc ("it's been a few weeks") | **Build, as one typed field** on the same opening item: the length of the gap, in four buckets. |
| Short-lived mood tier (3 to 7 days) | **Already built.** MEM-06 writes a `state` record with `valid_to` 24 hours (moderate) or 7 days (high) after the turn. The gap is only that nothing offers it at a conversation's start, so it joins the same opening item. |
| Part-of-day line | **Build, as one typed field** on the same opening item (four buckets). `dayPartOf` exists in `almanacCompute.ts`; the prompt clock is day-granular for cache (CHAT-CLOCK-01), so part of day cannot ride the stable prefix. |
| Relational memory (shared jokes, familiar topics) | **Deferred, not designed here.** It invites the false shared experience the guards exist to stop. Reopen only after the bench shows the four items above are not enough. |

## 1. Where Home stands (read 2026-10-28)

- `memoryJudge.ts` already extracts `goal`, `project` and dated `event` records from commissive clauses (`COMMISSIVE_SHAPE`), and
  `state` records with an expiry from emotional clauses. A supersede closes a record when a later turn changes it.
- Recall is relevance-gated (MEMORY-RELEVANCE-01): a record reaches the model when the question calls for it. Nothing today offers a
  record because time passed.
- The open-question queue (`queueOpenQuestion`) asks Home to confirm a fact (who is this person). It is for the record's accuracy,
  not for the relationship.
- The 2026-10-27 fix tells the model to use a fact only when it changes or completes the answer. Any thread offer must sit beside
  that line without contradicting it, which sets the gates below.

## 2. Design

### 2.1 The opening item (one typed item, one place)

A pure function `conversationOpening(person, now, turns, records)` returns `null` or a small typed object:

```
{ since_last: "same_day" | "few_days" | "few_weeks" | "months",
  day_part: "morning" | "afternoon" | "evening" | "night",
  thread?: { record_id, kind: "event" | "goal" | "project", subject, when },
  mood?: { record_id, state, valid_until } }
```

Eligibility ("no task question") comes from a typed turn-signal field, spec first, not from a regex. It renders as one short labelled block in the volatile tail of the request, beside the clock item and never in the stable prefix
(rule 4: the prefix cache must not change between turns). The label says the block is optional context to use only if it fits a
greeting. The model decides whether to use any of it (rule 1). No word rule reads the reply and nothing rewrites it.

When it exists: only on the first turn of a conversation, and only if the typed turn-signal field says the turn carries no task (a greeting or bare social turn; the existing whole-utterance check `isBareSocialTurn` in `guards.ts` may fill the field). A turn that asks for a fact, a search or an action gets no opening item, so the weather
question stays a weather answer. After one turn the item is gone.

### 2.2 Which thread

At most one. The candidate is a person-scope record of kind `event`, `goal` or `project` that:

1. belongs to the speaker (speaker evidence alone, rule 0), never household scope;
2. has an end date, held in the record's typed `valid_to`, that passed 1 to 14 days ago, or is a goal or project created in the last 14 days
   with no later record on the same subject (not superseded). The date is never read from the record text (that would be a word rule);
3. was never offered before (see 2.4);
4. is not in a withheld category (see 2.3).

The newest qualifying record wins. Nothing qualifies, no thread field.

A dated event is archived by `runMaintenance` once its `valid_to` passes (status `archived`, `expired_at` set), and current reads
exclude it. Five paths archive a record for a reason (the end date, decay, the person's own Archive, retiring a fact when a turn is edited,
and the forget tombstone), and none records why. Any other archive writer (the state expiry, person deletion) leaves `archived_reason` null, so its record is never offered. This note adds one optional typed field on the memory record, spec first and
additive, `archived_reason` (`end_date`, `decay`, `person`, `edit`, `forgotten`), written by each path. The thread read takes only
records with `archived_reason = end_date`, `deleted_at` null, `expired_at` within the last 14 days, and no later record superseding
them. A forgotten, person-archived, decayed or edit-retired record is never offered. The read also skips any record whose source turn was itself replaced by an edit (`conversation_turns.supersedes`). Records archived before the field exists carry
no reason and are never offered. It is a bounded, person-scope, speaker-only read used by the opening item and nowhere else. A
`state` past its `valid_to` or past `STATE_EXPIRY_DAYS` is never offered as a mood.

### 2.3 Gates

- **Rule 0.** A child never receives a thread or mood (a parent's controls own a child's memory). A teen's thread is offered only to
  that teen in that teen's own conversation, never in a shared surface; the teen's settings stay private. An adult gets threads by
  default if the per-person key below is on.
- **Shared and ambient surfaces.** A shared chat, a robot with more than one person present, or a speaker not identified gets no
  opening item at all.
- **Withheld subjects.** Health, money owed, a relationship conflict, a death, and anything the person asked Home to forget never
  become a thread. The floor is deterministic and sits in the privacy path: only the kinds `event`, `goal` and `project`
  are eligible; any record in a `vocab/life-events.json` `adult_to_tell` class is withheld; any record the person set `sensitive`
  is withheld. The judge may add one withholding tag at extraction (`offer_withheld`, a new field with that one meaning, because the
  spec's existing `sensitive` means "withheld on shared surfaces" and setting it would change recall, which this note does not do).
  The judge's tag can only add withholding, never remove it, and its false-negative rate is measured in the bench. A mood tier is
  offered to the `care` move only, as "was rough last time".
- **Incognito and forget.** Incognito turns neither read nor stamp threads. Forget writes a tombstone (`deleted_at` set) and the thread read refuses any record with `deleted_at` or a reason other than `end_date`, so a forgotten record never comes back.
- **Setting.** One person-scope key, `chat.pick_up_threads` (on, off), default on for adults and off for teens, spec first, its
  copy through `describeSetting`. Relation to PREF-01's `chat.follow_up_questions` ("whether MaiPai may end with a question"): that key
  governs the end of a reply; this one governs the opening. When PREF-01 is `rarely`, a thread question still counts as the one
  question allowed in a reply, so the two never stack. The name avoids `follow_up`, which `person.robot.follow_up` already holds.
- **No invented history.** The block states only the record's own subject and date. It names nothing the record does not say, and the
  existing guard against claiming a shared experience stays in force.

### 2.4 Ask once

The offer stamp is a row in the open-question queue with a new additive `kind`, `thread` (spec first; today `who`, `clarify_fact`,
`relay`). Its `subject_id` is the memory record id and its `text` holds no record text. The row is written as `asked` when the turn
is stored, never in Incognito. `nextOpenQuestionInPlay` in `askNames.ts` filters the kind out, so it is never appended as a
who-question. The forget path (`memory.ts`, which does not touch `open_questions` today) deletes these rows with the record. A thread
offered and ignored is not offered again; it ages out at 14 days.

### 2.5 Closing the thread

The person's answer ("it went well, I got it") flows through the memory judge as any turn does. It supersedes the event with its
outcome, and the thread is closed by the existing supersede path. Nothing new is built for this; the bench checks that it happens.

### 2.6 What this does not do

No push, no notification, no message that Home starts on its own. The thread is raised only when the person speaks first. No change
to recall ranking, to `forceInclude`, or to the judge's thresholds. No new prompt prose for the companion's voice (rule 14): the
companion dials decide how the question sounds, the item only supplies the fact.

## 3. Gates for the build

- Rule 0, the child floor and the shared-surface rule have unit tests over the pure function (child, teen, shared chat, unidentified
  speaker, incognito).
- Rule 4: a test pins that the stable prefix is byte-identical with and without an opening item.
- Unit tests: a forgotten record is never offered; a person-archived record is never offered; a decayed or edit-retired record is never offered; a goal older than 14 days is never offered.
- Rule 4 test: turn 2's prefix (stable prefix plus turn 1's replayed exchange) is byte-identical whether or not turn 1 carried the item.
- Rule 6a: the bench prints bench-row ids and counts only, never memory or turn ids.
- Rule 13: this adds a prompt block to adult written chat, so CHAT-AB-01 (both 9-turn memory scripts and the spoken row's 3 s
  first-word bar) is rerun with the register rows before landing 07b.
- Rule 13: measurement lives in the register bench lane (`check.sh --bench`), never the gate. The pure function's tests are gate
  tests because they need no model.
- Learned components: the buckets are fixed thresholds on typed data (hours since the last turn, local hour). No classifier. The withholding floor is deterministic and reuses the `life-events.json` cue list (a regex over record text, as `childDisclosure.ts` does today); that is allowed because the adult-content rule bars word lists only where they block an adult's request or reply, and this one only withholds an unprompted offer; the judge's `offer_withheld` tag can only add to it.

## 4. Slices

1. **NAT-07a (S, first, fail-first):** bench rows. Five rows with seeded records and a backdated previous turn (the bench's
   `backdate` and prompt-clock seams): a greeting after an interview date (asked about: pass); the same record with a weather
   question as the opener (mentioned: fail, this is the 2026-10-27 regression); a second conversation the next day (not asked
   twice); a child and an incognito turn (never). All fail or ambiguous today for the first row.
2. **NAT-07b (M):** `conversationOpening`, its render in the volatile tail, the gates, the `chat.pick_up_threads` key, the `thread`
   open-question kind, the bounded archived-event read, the typed turn-signal field (all spec first, then hub), `archived_reason` written by the five paths above, the forget cleanup.
3. **NAT-07c (S):** the deterministic floor and the judge's `offer_withheld` tag (a new memory-record field, spec first), with an extraction test per withheld subject.
4. **NAT-07d (deferred):** relational memory.

Order: 07a, then 07c, then 07b. The register bench's NAT-01 to NAT-08 lane runs them against a real model.

## 5. For Jesse

One decision is his (privacy): whether `chat.pick_up_threads` defaults on for adults. Recommended on, because the signal is a person
you already told about the interview; it is off for teens and unavailable for children either way.

## 6. What I did not verify

- That the open-question queue's retention and expiry suit a 14-day thread; I read its record description and the architect's citation, not every path.
- The exact name of the typed turn-signal field; the note only fixes that it is typed and spec first.
- Any of this against a real model. The bench rows are written first so that the answer is measured, not argued.
