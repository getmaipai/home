# Memory lifecycle, review, sync and preferences (2026-10-17)

This note decides how a memory record moves through its life after the judge writes it: the overnight tidy, the review
queue a person works through, the change feed a client or the robot pulls, the gates on who may write a household memory and
on a memory heard from an unconfirmed speaker, a reranker over recall, and the explicit, inspectable preferences a person
holds. It covers seven backlog rows: MEM-TIDY-01, MEM-REVIEW-02, EVAL-04 (the memory reranker), the memory change feed for
clients (no id in the backlog; called MEM-FEED-01 here), PI-MEM-00 (household memory writes refused with placeholder lines),
speaker-gated memory writes (no id; called MEM-SPEAKER-01 here) and PREF-01. Design note only, no code. Every record here is
the spec shape with id, provenance and clock stamp (principle 3); the robot holds its own records and a pairing is a transfer,
never a translation (principle 2). A person's memories are theirs alone: no admin reads another person's memory text
(RULES.md rule 6a; NO-CROSS-USER-VISIBILITY-01, owner 2026-10-07).

## 1. What exists today (from code, 2026-10-17)

| Piece | Where | State |
|---|---|---|
| The record | `commons/spec/schemas/memory-record.schema.json` | `status` is `active, superseded, archived`; `source` is free text provenance; `hlc`; `deleted_at` tombstones wipe `text`; `fact_confidence`, `confidence_evidence`, `conflicts_with`, `retrieval_feedback` declared with no writer (CRED-01, REVIEW-01); no `created_by` yet (MEM-PROV-01) |
| The store | `backend/src/lib/memory.ts` | `remember`, `list`, `recall`, `archive`, `supersede`, `forget`, `forgetByIds`, `exportPerson`, `setChildDisclosure`, `runMaintenance` (episodic decay at 0.995 per hour, archive under 0.1 after 30 days, 200 episodic per scope, `state` expires in 7 days; durable never touched; no purge); `supersedeInFavorOfExisting` for merges; every write stamps `nextHlc()` |
| Read gates | `memory.ts:51` `canRead`, `access.ts:62` `canAccessPerson` | A person reads their own; a household record by `sensitive` and `child_disclosure`; an owner or admin may read a child's person records through the list route. That last branch is the one NO-CROSS-USER-VISIBILITY-01 removes |
| Write gates | `memory.ts:110` `assertCanWrite` | Household scope open to every member (the gap MEM-HOUSE-01 closes) |
| The judge | `backend/src/lib/memoryJudge.ts` | Extraction on the background engine, `memory_dedupe` asks the model only in the 0.60 to 0.92 band, SUPERSEDE with `contradiction` closes `valid_to`; `judge_status` per turn; gated by `turnActivity.ts` so it never runs beside a live turn |
| The package writer | `backend/src/lib/packageHost.ts:1916` | `HOUSEHOLD_REMEMBER_MINOR_REFUSAL` and `HOUSEHOLD_REMEMBER_ADULT_REFUSAL`: a household `remember` from a package or the command is refused with "not available yet" and nothing is saved; every tool write lands in the speaker's own scope |
| Routes | `backend/src/routes/memory.ts` | `POST /`, `GET /` (with `as_of`), `POST /recall`, `GET /export`, `POST /forget`, `POST /batch-forget`, `POST /maintenance/run` (admin), `/:id/archive`, `/:id/audience`, `/:id/supersede`; no cursor, no `status` filter, no `since` |
| The page | `frontend/src/apps/memory/PersonMemories.tsx`, `PeopleAndThings.tsx`, `/memory` (category Personal) | A list with selection and batch forget (UI.md's batch rule), the audience control on household records; no review section, no record view, no history |
| Clocks and sync | `backend/src/lib/hlc.ts` (`@maipai/core` clock, `HLC_BEARING_TABLES`), `conversationHistory.ts:1917` (`?since=<turn id>`) | Every memory table carries `hlc`; no memory change feed; `memory_embeddings` never sync by design |
| Scheduling | `backend/src/lib/scheduler.ts` (`ensureCoreJob`, `runDueJobs`, priority sort), `summaryRefresh.ts` | No quiet-hours policy in the scheduler; `household.quiet_hours.from/to` and `person.quiet_hours.from/to` exist in `keys.json`; QUIET-HOURS-01 (notifications) not built |
| Speaker evidence | `turnContext.ts:45` `effectiveBand`, `turnMachine/speaker.ts` | `SpeakerEvidence` has `level` (`unknown`, `confirmed`, more) and `basis`; an unidentified robot speaker is the child band and reaches no memory (`touchesMemory`) |
| Reranking | `backend/src/lib/stack/types.ts:118` | The Stack declares a `rerank` role and wire; nothing in Home calls it for memory |
| Settings | `commons/spec/schemas/setting-value.schema.json` | `source` (`user, default, package, sync`), `set_by`, `hlc`; no reason or review link; `vocab/setting-reasons.json` words the subtitle; no `chat.*` preference keys, `ease.*` is the model to copy |
| Records that decide things already | [household-memory-permissions](../plans/household-memory-permissions-2026-09-26.md) (`created_by`, admin-published household scope, proposals, "Suggested for the household"), [context-compaction](../plans/context-compaction-2026-10-05.md) (the rolling summary and its fold), [assistant-layer](../plans/assistant-layer-2026-10-04.md) slice 4 (MEM-EDIT-01: record view, history, chips), [privacy-mode](../plans/privacy-mode-2026-09-24.md) (Incognito writes and reads no memory) | Cited, not re-decided |

The legacy mirrors (`legacy-backups/*-legacy.git`) are not present in this worktree or on this machine; legacy facts below are
what the backlog rows record about `dream_cycle.py` and Row-Bot.

## 2. Purpose and audience

The job: a memory the hub keeps is one the person can see, fix, confirm or throw away, and it stays tidy without anyone
inventing a fact or reading anyone else's.

| Viewer | Sees and does | Does not see |
|---|---|---|
| Adult member | Their own records, their Review list (keep, edit, remove, undo a tidy), their own tidy journal, their preferences, each value's reason stored with it | Any other person's record, queue, journal or preference |
| Owner or admin | As an adult member, plus: "Suggested for the household" (proposals other people chose to offer the household, with the proposer's name), "Tidy now" with a preview of their own changes in full and everyone else's as counts, the household tidy switch | Another person's record text, queue or journal; a teen's or child's count is never a line of text |
| Teen | As an adult member for their own records; household records by `child_disclosure`; may propose a household memory, which waits for an adult | Parental or admin controls; no model or mode choice |
| Child | Their own records and Review list in child-level wording ("Keep this?", "Was this you?"); household records with `child_ok`; the preference keys with a `band_default` of child | Anything an adult set for them that is not self-service; nothing here widens what a child may hear |
| Guest | Nothing: a guest has no memory page and the judge writes no guest memories | |
| Robot and TV | The robot holds the records of the people enrolled on it and pulls the change feed as each of them; the TV shows no memory | A shared screen never lists a person's memories |

Rule 0 holds throughout: `needs_review` records reach no prompt; a child's or teen's household read keeps `child_disclosure`;
an unconfirmed speaker's fact is quarantined, never injected; the tidy never touches crisis, consent or age state and never
writes to a record under 24 hours old. Nothing here loosens a child or teen protection.

## 3. Screens and flow

**Where.** The Memories app at `/memory` (rail entry "Memories", category Personal, S1). Three sections as kit `Tabs`: All,
Review (with a count `Badge`), Tidy journal. The record view (MEM-EDIT-01) opens from any row. Preferences are not here: they
are ordinary settings in the one kit `SettingsShell` (S4), group "How MaiPai talks to you" under the Chat area, drawn by the
generic renderer with spec copy (S5).

**Review.** One list, the kit `data-table` in selection mode, grouped by reason with the reason as a plain line:
"MaiPai was not sure" (`low_confidence`), "This disagrees with something you said earlier" (`contradiction`, both records
shown side by side), "Was this you?" (`speaker_unconfirmed`, robot turns only), "Tidied overnight" (`tidy_merge`: the merged
line and the two it replaced). Row actions: Keep, Edit, Remove; a tidied row has Keep and Undo. Batch Keep and batch Remove
follow UI.md's batch rule (the kit's selection mode, one `AlertDialog` naming the number, per-item results when some are
refused). A household-scale fact the judge extracts from a person's own turn stays a live personal record and shows in that
person's own Review list as "Share with the household?" with Share or Keep it mine. Admins get "Suggested for the household"
(MEM-HOUSE-01's section): only facts people chose to offer, each with the offerer's name because offering is their own act,
when, and Publish or Leave personal. Nothing reaches that list without the person's tap. Copy: Keep "Kept. MaiPai will use this from now on."; Remove "Removed. It is in your
archive for 30 days if you change your mind."; Undo "Put back the two original memories."

**Tidy journal.** One row per run: "Last night: merged 3, let 2 old links fade, removed 1, refreshed 4 summaries", each a
link into the affected records; "Nothing to tidy" for an empty run; "Stopped early: you started chatting" or "Stopped at the
end of quiet hours" when the run yielded. Admins have "Tidy now": a preview `Dialog` listing their own changes in full and
"Also: 7 changes for 3 other people" as counts, then Run.

**In chat (PI-MEM-00).** An adult who says "remember for the whole house that bins go out Tuesday" gets the `approval-card`
Element in the reply with the exact text and Confirm or Not now; nothing is published until Confirm. A child or teen gets
"I will ask an adult before the whole house remembers that" and the proposal waits in the adults' Suggested list; the child's
own assistant does not use it until it is published. A decline on either path forgets the proposal outright (the same
tombstone as Forget), so nothing readable remains.

**States.** Empty All: "Nothing remembered yet. Chat with MaiPai and the things worth keeping show up here." Empty Review:
"Nothing to look at." Loading: kit `Skeleton` rows. Failed: kit destructive `Alert`: "Could not load your memories. Check the
hub is running, then try again." with Try again. Offline: the page serves from the last read with "as of 7:10"; actions are
disabled with "Reconnect to keep or remove". Incognito on: the page opens but every write action is disabled with "Incognito
is on. Turn it off to change memories" (reads are the person's own, so they stay; privacy-mode record). Tidy with no
background engine: the run is skipped and the journal row says "Skipped: the background engine was off"; nothing merges
without the judge.

## 4. Records and settings (spec first)

All changes are additive, land in `commons/spec` first, then the hub, then the robot.

| Name | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `MemoryRecord.status` | enum gains `needs_review` | | record | Written by the judge, the speaker gate and the household proposal path; a record in this status reaches no prompt, no recall result and no export of "what MaiPai knows", until kept |
| `MemoryRecord.review_reason` | enum or null: `low_confidence`, `contradiction`, `speaker_unconfirmed`, `tidy_merge`, `household_proposal` | null | record | Why the record is in the Review list; cleared by Keep, Undo, Share, Keep it mine or Publish. A `tidy_merge` record is `active` (it is used) and listed for a look; `household_proposal` on a judge-extracted record likewise sits on an `active` personal record (used by that person, offered to admins only on Share); on a tool-initiated `remember` for the household it sits on a `needs_review` record; every other reason sits on a `needs_review` record |
| `MemoryRecord.reviewed_by`, `reviewed_at` | person id or null, date-time or null | null | record | Who kept, removed or undid it, and when; the record's own history (MEM-EDIT-01) reads these |
| `MemoryRecord.source` (description only) | the reserved forms `tidy_merge:<journal id>`, `speaker:<turn id>`, `proposal:<turn id>` | | record | Provenance stays free text; the schema description names these forms so hub and robot read them the same way. Decay and prune create no record and carry no source |
| `MemoryRecord.proposed_scope` | `household` or null | null | record | MEM-HOUSE-01's marker, unchanged; this note only adds `household_proposal` as its review reason |
| `tidy-journal.schema.json` (new, `records/`) | `{id: tj<seq>-<device6>, person, started_at, ended_at, window: {from, to}, stopped: completed, quiet_hours_ended, turn_started, engine_off; counts: {merged, decayed, pruned, refreshed}; changes: [{kind: tidy_merge, tidy_decay, tidy_prune, tidy_refresh; record_ids; replaced_ids; undo_until; undone_at}]; hlc}` | | one per person per run | The person's own readable journal and the 30-day undo store in one record. A run writes one journal per person it touched; a household-scope change goes on the admin who ran it or, overnight, on the owner |
| `GET /api/memory/changes?since=<cursor>&limit=<n>` | `{changes: MemoryRecord[], next_cursor, has_more}`, n capped at 100 | | wire, additive | The change feed. The cursor is opaque base64url of `hlc|id`; order is `compareHlc` then `id`, so two records with one clock stamp are never skipped. Tombstones come as the spec record with `text: "[forgotten]"` and `deleted_at` set; `needs_review` records are included (they are the caller's own). The first read with no cursor is the full authorized set and returns the cursor to continue from. The caller's projection is `list()` with `selfOnly: true`: own records plus household records by audience; no foreign person's record ever appears |
| `GET /api/memories?status=review` | the Review list | | wire, additive | Also `?since=<ISO>` for LEARNED-01 (filed, not here). The bare `GET /` keeps its array shape |
| `POST /api/memory/:id/keep`, `/:id/undo-tidy`, `POST /api/memory/batch-keep`, `batch-remove` | `{outcomes: [{id, ok, reason?}]}` | | wire, additive | Remove is `archive()` with the reason kept, restorable for 30 days; Undo restores `replaced_ids` to `active` and archives the merged record; a forgotten original is never resurrected |
| `POST /api/memory/tidy/preview`, `POST /api/memory/tidy/run` | a `tidy-journal` shape per person, others' as counts | | wire, admin | "Tidy now"; `POST /maintenance/run` is folded into `tidy/run` and removed once the tidy lands (one definition) |
| `memory.tidy` | boolean | true | household | "Tidy memories overnight during quiet hours." Only an admin sets it; a person cannot opt out, because the tidy never invents or deletes a fact and every change is reversible from their own journal |
| `memory.rerank` | select `off`, `shadow`, `on` | `shadow` | household, `expert` | EVAL-04: the Stack's `rerank` role over recall's top candidates on written turns. `shadow` logs the would-be order as numbers and changes nothing; `on` only after the bench row improves (section 7, rule 13) |
| `chat.reply_length` | select `default`, `brief`, `full` | `default` | person, self-service, layers band, household, person | "How much MaiPai says: the usual, keep it brief, or spell things out." `default` adds no instruction (rule 5); `brief` and `full` add one register line with no number in it |
| `chat.directness` | select `default`, `direct`, `gentle` | `default` | person, self-service | "Straight answers, or a softer way of putting things." |
| `chat.register` | select `default`, `casual`, `formal` | `default` | person, self-service | "Casual or formal wording." |
| `chat.follow_up_questions` | select `default`, `welcome`, `rarely` | `default` | person, self-service | "Whether MaiPai may end with a question for you." |
| `companion.preferred.web`, `companion.preferred.robot`, `companion.preferred.tv` | text (a companion package id) or empty | empty | person, self-service; a child's is `band_default` to the household companion and not self-service | "Which companion answers you here." Read by companion resolution (rule 14) |
| `SettingValue.reason` | enum `chosen`, `accepted_proposal`, `set_by_admin`, `imported` or absent | absent | setting row | PREF-01's provenance beside the existing `set_by` and `hlc`: why the value is what it is, stored for history and backup and never drawn as a row subtitle (S5). `accepted_proposal` carries `review_id` |
| `SettingValue.review_id` | string or null | null | setting row | The `TurnReview` id (REVIEW-01) whose proposal the person accepted; null otherwise |
| `vocab/setting-reasons.json` | unchanged | | copy | `SettingValue.reason` and `review_id` are stored provenance only, carried by backups and read by REVIEW-01's history of the accepted proposal; the settings row shows only the setting's description, and a reason subtitle appears only when the setting is disabled for the reader (S5). Choosing `default` again clears the override and its reason; there is no reset button |

Per-wake-word companions and per-task source preferences (also named by PREF-01) wait for a wake-word vocab on the robot and a
task vocab for search; they are PREF-01b below, not designed here.

**The tidy, phase by phase** (`backend/src/lib/memory/tidy.ts`, a scheduled caller of what exists). Runs as a core job
registered with `ensureCoreJob("memory.tidy", ...)`, inside `household.quiet_hours.from` to `to`, on the background engine;
never starts while `turnActiveWithin()` is true and yields between batches of 50 when a turn starts; stops at the end of the
window and writes `stopped`. Skips every record under 24 hours old, every pinned record, and the fields crisis, consent and
age state live in (they are not memory records, so the tidy's queries never touch their tables).
1. Merge: `similarByVector` pairs of the same `category` and `scope`; cosine at or above 0.98 merges with no model call;
   0.93 to 0.98 asks the judge's existing `memory_dedupe` decision; two records whose `subject_id` are both set and differ
   never merge. The merge is `supersedeInFavorOfExisting` plus a merged record with `source: tidy_merge:<journal id>` and
   `review_reason: tidy_merge`. A pair undone in the last 7 days (read from the journals) is never proposed again.
2. Decay: `relationships` rows with `source: inferred` older than 90 days lose 10 percent of `confidence` per run; below 0.3
   they are archived (`status`), never deleted.
3. Prune: `runMaintenance()`'s own episodic decay and caps, called, not copied; the journal records its count.
4. Refresh: rolling summaries whose fold is due (`scheduleSummaryRefresh`, context-compaction record), per conversation, on
   the same boundary rule 4 states.
5. Journal: one `tidy-journal` per person touched; counts per phase; `undo_until` 30 days out.
Thresholds (0.93, 0.98, 90 days, 10 percent, 0.3, 50) are starting values from the backlog's `dream_cycle.py` notes and are
re-measured on CHAT-AB-01's two memory scripts before the switch defaults on (rule 13).

**The speaker gate (MEM-SPEAKER-01).** On a robot turn whose `SpeakerEvidence` names the signed-in person at a level below
`confirmed` (the voice-ID levels land with the robot's own slice; the face print's `confirmed` exists today), the judge writes
the person's records with `status: needs_review`, `review_reason: speaker_unconfirmed`, `source: speaker:<turn id>`. "Was this
you?" in their Review list keeps or forgets it. An `unknown` speaker still writes nothing (today's rule).

**The reranker (EVAL-04).** `recall()` takes its top 30 by the hybrid score; in `on` mode the Stack's `rerank` role reorders
them and the top 8 are injected; budget 100 ms on the background engine's slot, measured per turn; over budget, the
unreranked order is used and a typed `memory.rerank_skipped` event is logged (a count, no text). Never on a spoken turn
(the 3 s first-word bar), never on a safety, consent or privacy path.

**Preferences in the turn.** On a written turn only, the composer reads the four `chat.*` keys through the existing settings resolution (user override
over global default over user default) and adds at most one register line per key to the stable prefix, with no word count
and nothing for `default`; a spoken turn (robot, pod, phone, or any client that flags the turn as spoken) and a glance
surface read none of them and keep their own shape and limits (rules 0 and 5). A child's `band_default` for `chat.reply_length` is `brief` (their own limit stands, rule 5), and
`chat.follow_up_questions` for a child is `welcome`. REVIEW-01, when built, files a proposal as a notification with Accept
and No thanks; silence is never consent and an unanswered proposal expires in 14 days.

## 5. Privacy and offline

- **Outbound connections: none.** The tidy, the judge, the reranker and the feed run on the household's own Stack engines and
  the hub's database. No setting here opens a network path.
- **No network:** everything in this note works with the hub alone. A robot without the hub keeps its own records, runs its
  own tidy on its own model at idle (principle 2, bot slice after the spec lands) and reconciles on the next pairing through
  the feed: records by `hlc` last-writer-wins per field, `confidence_evidence` as a set union (already in the schema),
  tombstones win over any text. Embeddings never travel; the receiver re-embeds in its own `embedding_space`.
- **What an admin sees:** their own records, queue, journal and preferences; household records; proposals a person chose to
  offer the household (that person's own act); counts for everyone else. Never another person's text, title, record id next
  to an activity, or a hash of one (rule 6a). The tidy's log events are typed registry events with counts and durations
  (`log-events.schema.json`), no record id and no text. The "Tidy now" preview shows others' changes as "7 changes for 3
  people", never which three.
- **Children and teens:** a child's Review list and journal are the child's, in child wording; an admin's count line is the
  only trace. This changes the wording of MEM-TIDY-01 ("own and child changes are shown") and MEM-REVIEW-02 ("an admin
  reviews a child's queue"), both written before the owner's 2026-10-07 ruling (section 10).
- **The feed is a read of one's own.** A device session acting for an enrolled person gets that person's projection and no
  other; a session with no person (an unpaired robot, a TV) gets 403 "Sign in as a member to read memories."
- **A backup carries** every memory record in every status, the tidy journals, the settings rows with their reason and
  review id, and no embeddings (rebuilt on restore). An export excludes `needs_review` and tombstoned records; MEM-EXPORT-01's
  exclusion list gains `needs_review`.
- **Incognito** writes nothing and reads nothing from memory (privacy-mode record); a temporary turn never produces a
  `needs_review` record, a proposal or a journal change.

## 6. Kit Elements and parts

Chat surfaces (rule 9): the household confirmation is the `approval-card` Element (`elements-adoption.json`, verdict
wire-now), fed the proposal text and the Confirm and Not now handlers; the "you told me" chips are MEM-EDIT-01's
`memory-chips` Element, unchanged. Everything else (rule 9b) is the kit's shadcn/ui set and dashboard blocks: `Tabs`,
`Badge`, the dashboard `data-table` with its checkbox selection, `AlertDialog` for a batch, `Dialog` for the tidy preview,
`Item` rows for a record's history (not the chat `timeline` Element: `/memory` is not a chat surface), `Collapsible` for
the two originals under a merge, `RelativeTime`, `Skeleton`, destructive `Alert`, `Select` and `Switch` through the generic
settings renderer. No className overrides, no wrappers; the page passes data, handlers and copy.

**Reuse check.** Looked at first: the judge's `memory_dedupe` path and `similarByVector` (the tidy calls them); `runMaintenance`
(phase 3 is a call); `scheduleSummaryRefresh` (phase 4); `supersedeInFavorOfExisting` and `supersede` (merge and undo);
`forgetByIds`' per-item outcome shape (every batch route copies it); `listConversationTurns`' `since` contract and
`compareHlc` (the cursor); the Stack's `rerank` role (no reranker is shipped in Home); `setting-value`'s `set_by` and `hlc`
(provenance extends them, no parallel store); `setting-reasons.json` (unchanged; disabled-state subtitles only); `approval-card`, `data-table`.
Considered and not taken: a separate quarantine scope for unconfirmed speakers (a second mechanism beside `needs_review`,
principle 1); a rejection table for undone merges (the journal already holds `undone_at`); a `/changes` push from the robot
(the row names push transport as out of scope; filed as MEM-FEED-02 when the bot half starts); mem0 or Letta style stores
(a second store and a translation, principle 3). Hand-built code is limited to `tidy.ts`'s scheduling and phase order, the
cursor encoder, and the review routes, because no shipped part schedules, journals or pages a store this shape.

## 7. Rule check

0. Age and surface gates: `needs_review` never reaches a prompt; `child_disclosure` unchanged; a child's `band_default`
   preferences are not self-service; an unknown robot speaker writes nothing. No conflict.
1. The model decides, not a word rule; memory is injected context, never a tool: recall stays injected, the reranker only
   reorders what is injected, and `remember` is a write by an exact command or a package, not a read tool. No conflict.
2. The engine's native feature is the implementation: the reranker is the Stack's `rerank` role, no Home scorer. No conflict.
4. The window and the rolling summary: phase 4 calls the existing fold on its boundary; the summary passes the person's
   output floor and holds no crisis, consent or age state, as the rule says. No conflict.
5. No length cap on adult written chat: `chat.reply_length` adds no instruction at `default` and never a number; PREF-01's
   backlog effect "`maxWords`" is dropped (section 10). Measured at the default per rule 13. No conflict.
6a. Logs and admin visibility: journal is per person; admin sees counts; log events are typed. No conflict.
9, 9b. Shipped parts, no overrides, no wrappers: section 6. No conflict.
13. Measured, not argued: tidy thresholds and the reranker promote only on CHAT-AB-01 memory rows. No conflict.
14. Companion voice is a per-request mechanism: `companion.preferred.*` picks the adapter per request. No conflict.
S4, S5. Preferences are registry keys drawn by `SettingsShell` with spec copy; a reason subtitle shows only when a key is disabled for the reader, so `chosen` and `accepted_proposal` are stored, not drawn. No conflict.
Platform principle 1 (one mechanism): one status, one queue, one journal; `POST /maintenance/run` retires into `tidy/run`.
No NEEDS-RULE-CHANGE.

## 8. Slices

| Id | Size | Order | Depends on | Exit check |
|---|---|---|---|---|
| MEM-REVIEW-02a (spec) | S | 1 | none | `commons/spec`: `needs_review`, `review_reason`, `reviewed_by`, `reviewed_at`, the `source` forms, `tidy-journal.schema.json`, `memory.tidy`, `memory.rerank`; round-trip fixtures; new tag |
| MEM-REVIEW-02 | S | 2 | 02a, MEM-EDIT-01 | The judge writes `needs_review` on low confidence and contradiction; the Review tab with keep, edit, remove, batch; a kept record is injected on the next turn and a `needs_review` one is not (test); batch partial refusals reported |
| PI-MEM-00 | S | 3 | 02a, MEM-PROV-01, MEM-HOUSE-01 | `packageHost.ts`'s two refusal strings deleted; an adult's household write stored only after `approval-card` Confirm; a minor's only after Publish from Suggested; a decline leaves a tombstone and no text; no reviewer in the household refuses with "No adult can review this yet" |
| MEM-FEED-01 | M | 4 | 02a | `GET /api/memory/changes`: a create, correction and forget each appear once across paged reads; identical-clock records are not skipped; a foreign person's change never appears; tombstones carry no text; existing `GET /` unchanged |
| MEM-TIDY-01 | M | 5 | 02a, MEM-REVIEW-02, QUIET-HOURS-01 for the window (until then the window is read straight from the two keys) | The fixture household: ten planted duplicates merge, three false pairs do not, four stale inferred links decay and the lowest is archived; an undone merge is not re-proposed within 7 days; the run never starts beside a live turn and stops at the window's end; the journal names four counts; "Tidy now" preview shows others as counts only |
| MEM-SPEAKER-01 | S | 6 | 02a, the robot's speaker levels | A fact at a level below `confirmed` lands as `needs_review` with `speaker_unconfirmed` and is not injected; "Was this you?" keeps or forgets it |
| EVAL-04 | S | 7 | MEM-04 bench rows showing misses | `shadow` logs order changes as numbers; `on` only with the memory rows improved at 3 repeats; a turn over 100 ms falls back and counts |
| PREF-01a (spec) | S | 8 | none | The four `chat.*` keys, three `companion.preferred.*` keys, `SettingValue.reason` and `review_id`, no new vocab reasons; new tag |
| PREF-01 | M | 9 | PREF-01a, SETTINGS-LOOK-01's row anatomy | The settings group renders with each key's description and no reason subtitle while the key is enabled; `reason` and `review_id` are written and round-trip; choosing `default` clears the override and reason; the composer adds one line per non-default key and none at default; CHAT-AB-01 adult rows unchanged at defaults |
| PREF-01b | S | later | REVIEW-01, the robot wake-word vocab, a search task vocab | Proposals from repeated behavior with Accept and No thanks; per-wake-word and per-task keys |

## 9. Legacy verdicts

- The overnight dream cycle (`dream_cycle.py`, five phases): **redesigned.** Same five phases and starting thresholds, but
  every change is journaled and reversible for 30 days, nothing is hard-deleted, the busy check is the hub's own
  `turnActivity`, and the merge reuses the judge's dedupe instead of a second scorer.
- Row-Bot's busy check: **merged into MEM-TIDY-01** as `turnActiveWithin()`; no new flag.
- Legacy's purge of archived rows after a fixed number of days: **dropped**; the store never hard-deletes outside Forget
  (already the rule in `runMaintenance`).
- Legacy's hidden per-person adaptation (no inspectable profile): **redesigned** as PREF-01's visible settings whose reason is stored with each value.
- Legacy's memory review page (a flat list, no queue): **redesigned** as the Review tab with reasons and batch actions.

## 10. Supersedes

- MEM-EXPORT-01's exclusion list (the security and data lifecycle note): it gains `needs_review` records beside tombstoned
  and archived ones.
- MEM-REVIEW-02's "an admin reviews a child's queue" and MEM-TIDY-01's "own and child changes are shown": the viewer alone
  sees text; a child's queue and journal are the child's (NO-CROSS-USER-VISIBILITY-01, rule 6a). MEM-EDIT-01's "an admin
  sees a child's memories" falls the same way when that row is built; this note does not edit it.
- MEM-TIDY-01's "the tidy's merges wait in a Review list" read as "not used until kept": a merge is `active` and listed for a
  look with Undo; only judge, speaker and proposal records are `needs_review`.
- The household-memory-permissions record's "no approval workflow states on `status`" (its out-of-scope paragraph):
  `needs_review` is added for the judge's own doubt, the speaker gate and the tool-initiated proposal. A judge-extracted
  household-scale fact stays a live personal record. It appears only in that person's own Review list as "Share with the
  household?" (`review_reason: household_proposal` on an `active` record). It reaches the admins' Suggested list only when
  the person taps Share.
- The household-memory-permissions record's judge-marker proposals listed to admins without the person's offer, and its
  "who said it" on the admin section (rule 6a): the admin list shows only offered facts, with the offerer's name as their
  own act.
- PI-MEM-00's "stored only after an adult approves" and MEM-HOUSE-01's "stored immediately as personal": reconciled as
  section 3 says (judge-extracted facts stay personal and live; an explicit `remember` for the household is a
  `needs_review` proposal).
- PREF-01's acceptance effect "`maxWords`" (rule 5) and its "reset in one click" (SETTINGS-LOOK-01 removes reset controls;
  choosing `default` is the reset).
- `POST /api/memory/maintenance/run`: retired into `POST /api/memory/tidy/run` when MEM-TIDY-01 lands.
- The two placeholder refusal lines in `packageHost.ts:1916` and `:1917`: deleted by PI-MEM-00.
- Nothing in RULES.md.

## 11. Decisions for Jesse

1. The household memory permissions record of 2026-09-26 (MEM-PROV-01, MEM-HOUSE-01) is still marked "awaiting Jesse's read";
   PI-MEM-00 here builds on it. Recommendation: accept it with this note's change (proposals reach admins only on the
   person's own Share, and `needs_review` is added), not as written.
2. Parents lose the view of a child's memory list and review queue (the backlog rows assumed it; this note follows your
   2026-10-07 ruling). Recommendation: confirm; a parent who needs to see asks the child or uses the child's passcode, as for chats.
3. The robot pulls the feed per enrolled person with that person's own consent at enrollment, rather than one device-wide
   read of everyone's records. Recommendation: per person.
