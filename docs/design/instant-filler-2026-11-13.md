# Instant contextual filler from pre-rendered clips (INSTANT-FILLER-01, design note, 2026-11-13)

Owner ask (Jesse, 2026-11-13): "Why can't we get immediate speech. Even our 4B filler seems delayed. We should quickly process
what the user is asking and say the correct filler immediately, followed by the actual response." This note designs; it builds
nothing. (est.) marks an estimate. Adults only, as the clip pool is today.

## Why filler feels late (measured on the live hub, 2026-11-13)

- Home's own work before the voice engine is called: about 1 ms prep plus 20 ms resolve per request.
- The voice engine (Chatterbox turbo through the Stack) needs 0.7 to 1.4 s to its first audio byte, idle or busy (median 0.70 s,
  p90 1.3 s over 140 turns). No idle-cold effect: 0.70 s under a 20 s gap, 0.77 to 0.83 s after longer gaps. Any filler that is
  synthesized after the person stops cannot start sooner than that.
- The quick cue (VOICE-QUICK-01: the 4B writes REACT or ACK in 70 to 230 ms, then `/api/tts`) is synthesized, so it plays about
  1.5 to 1.7 s after the turn starts.
- The acknowledgement clips (DUPLEX-07 section 3b, TALK-OVER-01) are rendered ahead of time and play about 0.4 s after the edge
  partial (trace `clip_play ms=408`). That path is already immediate. It is one fixed group, not matched to the question.

So the fix is not a faster voice. It is choosing among clips that already exist as audio in the browser.

## Supersedes and leaves alone

- **Supersedes**: `ACKNOWLEDGEMENT_CLIPS` as a flat list (`backend/src/lib/replyVariation.ts:131`). It becomes grouped; its
  four entries are the `backchannel` group. `docs/design/talk-over-2026-11-12.md` section 2 item 2's "never the same clip twice
  in a row" becomes "a not-recently-used clip of the chosen group".
- **Leaves alone**: the protected overlap window, "a clip always plays to its end", one clip per utterance, every talk-over gate,
  the skip of the run's quick cue on a clip turn, and `clip_*` timing fields. This note changes only which clip is picked.
- **Relation to `talker-first-2026-11-12.md`**: talker-first has the 4B write an opener that goes through TTS, so it stays
  TTS-bound and cannot give the first sound sooner than 0.7 s. This note gives the first sound; talker-first (not built) gives
  the first words. If both exist, a turn whose clip played skips the opener (the rule talk-over already states: one sound).
  Nothing here blocks or changes TALKER-FIRST-00 or 01.
- `/api/turn/react` (VOICE-QUICK-02: a TTS reaction at a mid-sentence pause, called from `liveVoiceSession.tsx:673`, three
  second gap, random chance) is untouched. A turn that plays a filler clip never also gets that reaction.

## Reuse check

- Searched `rg -i "filler|ackClip|ACKNOWLEDGEMENT_CLIPS|renderAckClips|playAckClip|reactTurn|quickReaction"` over `backend/src`,
  `frontend/src`, `docs/BACKLOG.md`, `docs/design`: the pool, renderer, player, 4B judge, timing record and trace all exist.
- Chooser: `backend/src/lib/quickReaction.ts` (same 4B judge role, `completeBackground`, per-person recent list, deadline
  constant). A new function `chooseFillerGroup` on it, not a second small-model client.
- Route: a new `POST /api/turn/filler` beside `/react` in `routes/turn.ts` (same `requireAuth`, same age-band guard). Not
  `/react`: its 3 s gap, 400 character cut and text-or-null reply are wrong for a group id on every stable partial.
- Pool and render: `ackClip.ts` (`renderAckClips`, trim, `playAckClip` at `liveVoiceSession.tsx:245`). Grants:
  `talkOver.ts` `talkOverDecision`. Timing: `voiceTiming.ts` and `bun run voice:latency --trace`.
- No new model, store, setting key, status surface or wire event type.

## 1. Mechanism

Relation to others: `backchannel` is the pool's default group (DUPLEX-07's mid-speech continuers and this note's late or
unmatched case draw from it, one constant). SPEECH-STYLE-05's companion filler list maps onto the same groups: a companion's
own words replace a group's clips, same gates, same ids. Slice a also updates the `voice.talk_over` copy (`does`, the gentle
option, `help`, in `voiceKeys.ts`; spec first if the commons spec carries it) because it promises only "mm-hm".

**1a. Pool v2** (one constant, `ACKNOWLEDGEMENT_CLIPS` becomes `ACKNOWLEDGEMENT_GROUPS`, 16 clips, each 1 to 4 words):

| Group | Clips |
|---|---|
| backchannel (default, late, none) | Mm-hm. / Okay. / Hmm. / Right. |
| thinking | Hmm, let me think. / Okay, so. / Let's see. |
| request | Sure. / Alright. / Got it. |
| question | Good question. / Hmm, good one. |
| good_news | Oh nice! / That's great! |
| bad_news | Oh no. / Oh, I'm sorry. |

Every clip is content-free: no fact, answer, advice, time or promise. "Of course." and "On it." are dropped from the suggested
list because they promise the action and the model may decline or a tool may fail (rule 6); "Sure." stays and is an open taste
question. A test runs `evaluateSafety` (the output floor) over every clip for every age band; a second test fails on any clip over
four words, a digit, a `?`, or a name. Spoken only, never stored, never shown.

**1b. Chooser.** The client asks for a group on stable partials, not only the edge, so the answer is back before the edge: when a
partial has at least three words and has not changed for 200 ms, and none is in flight, it posts `{ said }` (cut to 160
characters) to `/api/turn/filler`, at most one call per 600 ms (est.), only while the pool is ready, no turn is in flight and the
talk-over grant is on. The newest answer is kept with the text it was for. At the edge partial: a fresh answer is used at once;
if none is back, wait at most 150 ms, then play from `backchannel`. The clip never waits longer.

Hub side: `chooseFillerGroup(actorId, said)` asks the 4B for a group id or `NONE`, with the ids listed in a fixed
system prefix (the 4B's slot caches it), `max_tokens` 6, thinking off, sampling from its catalog record (rule 3), deadline
350 ms. The request carries a JSON-schema enum of the group ids plus NONE through `response_format` (rule 2: the engine's own constrained
output, as `memoryJudge` does; `llm.ts:153`), so there is no Home-side parse and no fallback parse. It never writes a word. If the deadline is missed, a form rule chooses: a question mark or a leading
wh-word or "can/could/would/do/does/is/are" gives `question`; a leading imperative verb from a short list gives `request`;
otherwise `backchannel`. The rule never picks `good_news` or `bad_news` (a wrong "Oh no." is worse than a plain "Mm-hm.").
`none` means `backchannel`. Rule 1 is not touched: this decides a sound, never a search or a tool, and the main model still reads
the whole turn.

Variety: per person, never the same clip within the last three, and the `question` group (a praise) at most once in four turns,
else `thinking`. For an adult only the CSAM detector and the crisis signal stop a clip (talk-over section 2 item 7): playing a clip depends on
the edge partial's own score, never on the stable partial the group was chosen from, so no clip follows a disclosure.

**1c. Playback.** Unchanged `playAckClip` and overlap window. The pool lookup takes a group id, picks a not-recently-used clip of
it, falls back to `backchannel`, then to nothing. The held answer follows the clip; the run's quick cue is skipped on a clip turn
(already the rule).

**1d. Rendering without fighting chat.** About 16 renders at about 1 s of engine time each. Order: `backchannel`, `request`,
`question`, `thinking`, `good_news`, `bad_news`. One at a time, started only after the grant, and only while no turn is in flight
and the person is not speaking or being answered (priority: chat first, resource-priority rule); a turn starting pauses the
queue after the current render and it resumes in the next idle gap. Each finished clip is stored in the browser Cache API under
`ack-clip/v1/<voice id>/<engine id>/<sha-256 of the normalized text>` (bytes only, nothing about a person; memory only when
Cache API is unavailable). A changed voice, engine or clip text is a different key, so the old entry is never read; entries not
in the current pool are deleted at ready. A second session with a warm cache decodes from disk and is ready in under a second
(est.). While the pool is partly ready the chooser still answers, and a missing group falls back to `backchannel`; a clip that
renders over `MAX_ACK_CLIP_MS` after trim is left out, as today.

**1e. Gating and setting.** No new key. On whenever `voice.talk_over` is `gentle` or `natural` and `talkOverDecision` grants
(adult, signed in, not a robot, speculative start on); Jesse's stored value is gentle, so it is on. A key would be spec-first
through `commons/spec` and slow this for no gain: `off` already turns every clip off. The `ready.talk_over` message gains an
additive `groups` map; `clips` stays as the `backchannel` list so an older client still works. Teens, children, unknown speakers
and the robot get no grant, so their path is exactly as today (cue as now, no pool v2). Rules: 0 (nothing reaches a minor or
robot), 1 (above), 2, 3, 6a, 9 (inside the named gap "sentence-gated speech scheduling with the spoken cue", as talk-over section 3 set for these clips; audio only, no UI), 10 (clips pass the floor for every
band; nothing about adult content is added), 14 (voice resolved by the existing speech route).

**1f. Logging (rule 6a).** One typed event `voice.filler` on the registry: group id, source, chooser ms, pool ready count. The
`said` body of `/api/turn/filler` is never logged or traced. A group (`bad_news`) is derived from the person's words, so
`filler_group` rides only on the turn-id timing row, never on a row with a person id or actor hash.

## 2. Measurement and acceptance

New fields on the voice timing record (`voiceTiming.ts`, all optional, counts and ids only): `filler_group` (the group id played),
`filler_source` (`model`, `rule`, `late` when the edge came before an answer and `backchannel` played, or `none`),
`filler_choose_ms` (request sent to answer received), `filler_pool_ready` (clips ready when the edge arrived). The clip's start
against the end of speech is the existing `clip_started_ms`; nothing new for it.

Target: `clip_started_ms` between 0 and 500 on at least 90 percent of turns where `filler_pool_ready` is 8 or more, on
`bun run voice:latency --trace` over a fixed spoken set, plus the chooser's agreement with a labelled set of 60 utterances
(group correct on at least 80 percent, `good_news` and `bad_news` never chosen for a plain question or request). A real call by
Jesse is the final check. Unproven until built: the chooser's p90 under a busy chat (the 4B shares the machine), whether partials
are stable early enough on real speech, how often the group sounds wrong, and whether sixteen clips sound like one voice.

## 3. Slices (each one to about six files, a test that can fail)

- **INSTANT-FILLER-01a**: pool groups and cache. `replyVariation.ts`, `talkOver.ts` (grant `groups`), `ackClip.ts` (group pool,
  Cache API, resume order), tests: floor over every clip and band, key changes with voice and text, a pool with two groups
  ready picks within the group.
- **INSTANT-FILLER-01b**: chooser. `quickReaction.ts` (`chooseFillerGroup`, rule fallback), `routes/turn.ts` (`/filler`), the
  log registry entry, tests: only listed ids pass, a stub 4B past 350 ms gives the rule, the rule never picks a news group.
- **INSTANT-FILLER-01c**: client wiring and timing. `liveVoiceSession.tsx` (partials, 150 ms wait, group pick),
  `voiceTiming.ts` and the report path, tests: edge with an answer plays that group, edge without plays `backchannel`, fields set.
- **INSTANT-FILLER-01d**: evidence. A labelled set in the bench, a `voice:latency` extension, the numbers added to section 2.

## 4. Risks

- A wrong group ("Oh no." on a joke): mitigated by `backchannel` fallback and the 4B-only news groups; judged in the bench.
- Praise repeated ("Good question." every time): the one-in-four cap.
- A chooser call on every stable partial adds 4B load while chat runs: the 600 ms gap, one in flight, and skipping while a turn
  runs; measured in slice d against first-token time.
- A clip over the person's own continued speech: unchanged, the talk-over window and its tuning decide it.
- A partly rendered pool sounds samey at first: the cache removes it from the second session on.
