# Notifications, sounds, asks and approvals across surfaces (2026-10-17)

This note decides one thing and the parts that hang off it: an ask (a confirmation, an approval or a package's question)
is one spec record that any surface shows and any allowed surface answers once, through one answer path, and the web
shell learns about asks, notifications and judged memory from one per-person event feed instead of polls. It covers five
backlog rows: MEM-PUSH-01 (the memory chip's poll retired in favour of push), NOTIFY-SOUND-01,
BRAKES-02 (the cross-surface ask: Telegram and robot halves, child and teen gates), PKG-ASK-01 (ask continuation for
packages) and PKG-RESULT-01 (`ask`, `confirm`, `end_conversation` from a result; the `confirm` half landed). Design note only; no
code. The architect gate applies.

## 1. What exists today (from code, 2026-10-17)

| Piece | Code | What it does | Gap |
|---|---|---|---|
| Declared notification types | `backend/src/lib/notificationTypes.ts` | `id`, `level`, `audience` (`person`, `household`, `adults`, `admins`), template, `configurable`, `privacy`, `toast`; `approvals.requested` (time_sensitive, adults) among them | No `parents_of_child` audience (`adults` stands in); no `actions[]` |
| Delivery | `backend/src/lib/notifications.ts` `trigger()`, `deliver()`, `quietHours()` | Channels `in_app` (always), `telegram` (opt-in per type and a linked chat id), `robot` (`time_sensitive` only, `notify` device command with `form: "waiting"` when private); `time_sensitive` held in `notification_holds` through quiet hours; `immediate` never held | `passive` digest not built; no web push transport |
| Web shell | `frontend/src/shell/NotificationBell.tsx` | `useNotificationsQuery` polls `GET /api/notifications` every 15 s; `NotificationToaster` toasts new rows with `toast: true`; rows are text plus Dismiss; history at `/notifications` | Poll, not push; a row carries no action |
| Memory chip | `frontend/src/apps/chat/chatMemoryState.ts` | `useMemoryStatusPoll` polls `GET /api/conversations/:id/turns` every 5 s while a turn is `pending`, stalls at 10 min | A second store for state `memory.updated` and `memory.judge_failed` already deliver; `not_saved` has no event at all (Jesse, 2026-09-13: silent) |
| Pending ask | `backend/src/lib/conversationHistory.ts:1234` `PendingAsk` on `conversations.pending_ask` | Kinds `confirm`, `ask`, `lookup`, `who`, `relay`; single shot, one conversation, cleared on the next turn; `turnId` set only for `confirm` | Not a record; one surface (the thread); `ask` kind never written by anything |
| Confirm | `backend/src/lib/turnMachine/machine.ts:349` `parkAsk`, `nodes/policy.ts` `confirm_needed`; `turnNext.ts:361` `resumesAsk()`, `:468` `ask_answer {turn_id, approved}` | A consequential package or tool parks "Go ahead and ...?"; a tapped kit `ApprovalCard` (ED-006, APPROVE-CARD-02) or a consent word resumes it as `preConfirmed` | A minor's confirm that needs a parent is refused with `parent_required` (`turnNext.ts:479`), never routed; `pendingAskMigration.ts` says so |
| Approvals | `backend/src/lib/approvals.ts`, `routes/approvals.ts` | Hub-internal table, kinds `install_package` and `browse_url`; `requestApproval` fires `approvals.requested` to adults; `decideApproval` refuses self-decide and a second decision | Not a spec record; not the same thing as a parked confirm |
| Robot answer | `turnNext.ts:452` `ask_answer {offer_id, approved}`, `robotOffers.ts` (INITIATIVE-01) | A spoken consent word, speaker named as the offer's person, gates re-checked; "not now" snoozes 30 min | Offers only; an ask has no spoken path |
| Robot channel | `routes/devices.ts` `GET /api/devices/me/events` (WebSocket, robot session only), `lib/deviceCommands.ts` | Durable commands replayed by `Last-Event-Id`, acked, kept 24 h | The web has no sibling; `browser-notifications-2026-09-30.md` assumed one |
| Telegram | `backend/src/lib/telegramChannel.ts`, `lib/privacy.ts:142` | Outbound `sendMessage` only, household bot token, rate limited, on the privacy page | Inbound is GATEWAY-01 (assistant-layer plan, slice 11, last) |
| Sounds | `frontend/src/lib/vision/faceCaptureSounds.ts`, `ui.enrollment_sounds` | FACE-02M's Web Audio tones, injected `AudioContext`, tested against a fake | No cue outside enrollment; `@maipai/ui` has no audio helper |
| Activity | `frontend/src/apps/chat/chatActivity.ts`, `shell/runningNow.ts` (ACTIVITY-01e) | The calm card above the composer picks one `waiting` row with `approve`, `deny`, `open` | Reads jobs, not asks |
| Spec | `result.schema.json` (`ask {prompt, expects}`, `confirm`, `end_conversation`), `grant.schema.json`, `robot-offer.schema.json`, `presence-states.json` | Shapes exist for a package's question and for a robot offer | No `Ask` record; `ask` has no options; a grant has no conversation scope |

## 2. Purpose and audience

The job: when MaiPai needs a person's word, it asks once, wherever they are, waits as long as it takes, and the first
answer anywhere settles it everywhere.

| Viewer | Sees | Does not see |
|---|---|---|
| Owner or admin | Their own asks (card in the thread, Needs-you card above the composer, bell row, `/activity` later); a child's asks that need a parent, as a summary with Allow and Deny; household notices; sounds switch for themselves and for each child | Another adult's or a teen's asks; any person's chat text next to an ask in a log |
| Adult member | Their own asks on every surface; a child's parent-asks the same as an admin (the existing `adults` audience); their own sounds switch | Another adult's asks; the Telegram settings of anyone else |
| Teen | Their own asks in their own thread and bell; a parent decides the ones BRAKES-01 policy routes to a parent | "Always allow in this chat" unless BRAKES-01 policy grants it; no Telegram; no spoken robot answering |
| Child | "Asked a parent" in their own thread (CHAR-01's `asking` wording); the parent's answer as the action running or "skipped" | The ask's Allow and Deny controls; "Always allow"; any outside messenger; the robot's spoken ask window; the sounds switch (a parent sets it) |
| Guest or anonymous speaker | Nothing: an anonymous speaker's confirm is refused today (`anonymous_speaker`) and stays refused | Everything above |
| Robot (shared, spoken) | Speaks an adult's own simple ask only when speaker evidence names that adult; otherwise says nothing and the ask waits on screen | A child's or teen's ask, ever; a complex ask; any ask text while quiet hours hold |
| TV or shared screen | A count of the signed-in person's waiting asks, no content (`privacy`) | Ask content |

Rule 0 holds throughout: a child's or teen's ask goes to a parent through the existing `approvals.requested` audience and
the parent's own, already consented channels; nothing here adds a channel for a minor, a model-free consent word stays
the only spoken yes, and no setting below loosens a gate. The `decidePendingAsk()` outcomes (`ask_self`, `ask_parent`,
`deny` with its reasons) are the authority on who answers; this note routes them, it does not re-decide them.

## 3. Flow and screens

**Where an ask lives.** One record (section 4), written by the hub when `policy.ts` parks a confirm, when `requestApproval()`
files an approval, or when a package result carries `ask`. Every surface reads the same record by id:

| Surface | Shows | Answers through | State |
|---|---|---|---|
| Thread (chat) | Kit `ApprovalCard` at the ask's turn: `request`, `running`, `done`, `denied` (label "Skipped"); "Waiting since" from `waiting_since`; the Cmd/Ctrl+Enter hint (`allowHint`) approves the focused simple ask | `ask_answer {ask_id, approved}` on `POST /api/turn/stream` (additive beside today's `turn_id`) | Answered anywhere: the card re-renders from the feed within one event |
| Needs-you card (ACTIVITY-01e, above the composer) | The oldest open ask of the signed-in person not already on screen; a parent's queue of child asks | `POST /api/asks/:id/answer` | Complex asks (a diff, a file list, more than one target) show "Open" only |
| Bell and `/notifications` | A `asks.waiting` row (new declared type, section 4) for an ask parked while the person was away, and `approvals.requested` for a parent | The row opens the thread at the card | Dismissing the row never answers the ask |
| `/activity` (ACTIVITY-01, later) | Every ask of the person with how long it has waited | The same route | Not built; out of scope here |
| Telegram (adults, opt-in) | One message: the template line plus the action summary; "Open MaiPai to answer." | None today (outbound only); after GATEWAY-01, `POST /api/asks/:id/answer` with `surface: "telegram"`, the adult's own simple asks only | A child's parent-ask carries the summary and the child's first name, as `approvals.requested` already does; never the child's words |
| Robot (adults, simple asks) | Speaks the ask's `prompt` once at a natural moment; "go ahead" and "not now" through the robot's turn with `ask_answer {ask_id, approved}`; speaker evidence must name the ask's owner, else the robot stays silent | The same hub function as every surface | "Not now" leaves the ask open; the robot does not repeat it |

**The answer path, one function.** `answerAsk(actor, askId, answer, surface)` in `backend/src/lib/asks.ts`: checks the actor
may answer (owner when `decided_by: self`; any adult other than the owner when `decided_by: parent`, the `approvals.ts:105`
self-decide refusal kept as is); re-runs `decidePendingAsk()` against the actor's current band and the household's current
settings (GATE-01's rule); writes the answer once (a second answer, from any surface, returns the first and changes nothing);
publishes the `ask` event; then resumes. Resume for `confirm` is today's `preConfirmed` continuation turn, started as the
ask's owner on the ask's conversation, so the result lands in the thread whatever surface answered. A denial writes a tool
outcome `status: "skipped"`, the card reads "Skipped", and the model is told only that the person declined and the action did
not run, so the answer continues in its own words. A denial is the person's choice, not a tool failure or a policy refusal, so
rule 6's failure kinds and the fixed policy replies do not apply. Resume for `question` re-enters the
recipe at the paused step with the answer bound (section 4). An ask never expires; `waiting_since` is shown in words
("waiting 2 days").

**Package questions (PKG-ASK-01 and PKG-RESULT-01).** A recipe `ask` step returns `PluginResult.ask {prompt, expects, options?}`. The
hub writes an `Ask` of kind `question` with the paused step and bindings in `resume`, and replies with the prompt. The next
turn in that conversation is read model-free: a tapped option, an exact option label or its number, or free text when
`expects` names one, answers it; an exact cancel command clears it; anything else marks it `abandoned` and routes normally
(the `who` kind's own rule, kept). Options draw as the kit `question-flow` Element (one step, `selectionMode: single`); a
free-text question is the composer itself. `end_conversation: true` on a result closes any open question of that
conversation and nothing else. Trivia's `recipe.json` is the first caller: an `ask` step for the question, a resumed step
that compares the answer. A question is never consequential: it runs no tool and needs no parent, so a child's trivia
question stays the child's; a question's prompt and options pass the child's output floor like any reply (rule 10).

**Push instead of polls (MEM-PUSH-01).** One per-person feed, `GET /api/me/events` (`text/event-stream`, session cookie,
`Last-Event-Id` replay for 24 h with the exact rule `deviceCommands.ts:92` uses), published by one module
`backend/src/lib/eventFeed.ts` that `deliver()`, `answerAsk()`, the memory judge and CHAR-01's presence resolver call. MEM-FEED-02
(the memory note's later push transport) rides this feed as a further event; it adds no second stream. Events:
`notification` (a `NotificationDeliveryView`), `ask` (the `Ask` record, viewer-filtered), `memory` (`{turn_id, status, memory_ids}`
with status `saved`, `not_saved` or `failed`), `presence` (CHAR-01). The `memory` event is turn state, not a notice: it makes
no bell row, no toast and no history entry, which keeps the 2026-09-13 ruling (`not_saved` stays silent) and still tells
the chip "nothing happened, stop showing pending". The bell subscribes to the feed and keeps `useNotificationsQuery` as a
fallback at 60 s only while the feed is disconnected. `useMemoryStatusPoll`, `pollOnce` and `markStalled` are deleted once
the chip reads the feed; the `stalled` state becomes "the feed is down" and the chip's Refresh calls
`refreshTurnMemoryStatus` as today. The robot keeps its WebSocket; same publisher, two transports.

**Sounds (NOTIFY-SOUND-01).** Three cues: an ask arrived, a routine finished, a routine failed. The hub decides whether a
cue is due (the person's `ui.companion.sounds`, their resolved quiet hours through the existing `quietHours()`, once per ask
or run id) and puts `cue: "ask" | "done" | "failed"` on the feed event; the client plays what it is told and never
re-derives quiet hours. Cues are synthesized tones (FACE-02M's module, lifted into `commons` `core` as `cues.ts` so Go can
reuse it; `faceCaptureSounds.ts` becomes a caller), under 400 ms, played once per event id per device per hub start. A tone
has no words, so the rule 6 review against the child floor records "no speech" in `dev.md` and no licence is needed. Off by
default for everyone; a parent sets a child's switch; `immediate` items (a safety alarm) have their own alarm and get no cue.

**States and copy (dad test).**

- Empty Needs-you: the card is not drawn. Empty bell: "Nothing pending." (as today).
- Loading: the card's kit `Skeleton`; never a spinner over the thread.
- Feed failed or offline: the bell falls back to the 60 s poll; the card shows the last known state; a tap that cannot reach
  the hub says "MaiPai can't be reached right now. Your answer wasn't saved. Try again when you're back on the home network."
- Answered elsewhere first: "Already answered by Nadia on the phone." on the card, controls gone.
- Not allowed: "That one needs a grown-up. A parent has been asked." (child); "That confirmation can't be answered here."
  stays for the other `deny` reasons, unchanged from `turnNext.ts:482`.
- Denied: the card reads "Skipped" and the reply continues in the model's words.
- Incognito on: a temporary conversation never writes an ask (`setPendingAsk` is a no-op for `temporary` today and stays so);
  the composer says "Not available in a temporary chat." when a package would need a confirm, the existing line.
- Telegram message: "Oliver is asking to install Trivia. Open MaiPai to answer." The settings help under the switch says what
  it sends (section 5).

## 4. Records and settings (spec first)

Shared shapes change in `commons/spec` first, then the hub, then the robot. All changes are additive.

| Name | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `Ask` record, `commons/spec/schemas/ask.schema.json` (new) | object | | spec record | `id` (`ask-` prefix), `person_id` (owner, whose action), `kind` (`confirm`, `approval`, `question`), `conversation_id?`, `turn_id?`, `prompt` (shown; already floor-checked at the band), `summary` (one line from a fixed per-kind template, as `summarizeApproval()` writes; the only text an outside channel ever carries), `complexity` (`simple`, `complex`), `decided_by` (`self`, `parent`), `options?` (`[{id, label}]`, question only), `expects?` (question only), `resume?` (`{package_id, step, bindings}`, question only), `capabilities[]`, `consequential`, `waiting_since`, `answer` (`null` or `{value, by_person_id, surface, at}` with `value` one of `approved`, `denied`, `abandoned`, an option id or text), `provenance`, `hlc`, `created_at`, `updated_at`, `deleted_at` (principle 3) |
| `answer.surface` vocabulary | enum | | spec | `chat`, `needs_you`, `bell`, `activity`, `telegram`, `robot`, `go` |
| `result.schema.json` `ask.options[]` | `[{id, label}]` | none | spec | A recipe's choices; `expects` stays for free text |
| `grant.schema.json` `conversation_id?` | string | none | spec | A grant valid in one conversation ("Always allow in this chat"); absent means the person-wide grant it is today |
| `ui.companion.sounds` | boolean | `false` | person | Short cues for an ask and a finished or failed routine. `lives_in: person.notifications`; a child's value is written by a parent (`self_service: false` for the child band) |
| `notifications.asks.waiting.telegram` | boolean | `false` | person | Telegram me when one of my own asks is waiting (adults only; the key is hidden below the adult band through `band_default`) |
| Declared type `asks.waiting` | notification | | hub `notificationTypes.ts` | `time_sensitive`, audience `person`, configurable, toast true, `privacy: true`; fires for an ask parked while the owner has no open thread on it, once per ask |
| Turn wire `ask_answer` | `{ask_id, approved}` | | hub `wire.ts`, additive beside `{turn_id, approved}` and `{offer_id, approved}` | The thread's and the robot's answer; `turn_id` keeps working for cards drawn before this lands |
| Tool outcome `status: "skipped"` | enum value | | hub `wire.ts` | A denied action; the transcript shows it as skipped |
| `conversations.pending_ask` | unchanged column | | hub | For `confirm` and `question` it holds only `{kind, ask_id}`; `lookup` and `who` keep their full single-shot shape (they are conversational, not asks) |
| `GET /api/me/events` | SSE | | hub route | Events `notification`, `ask`, `memory`, `presence`; `Last-Event-Id` replay 24 h |
| `POST /api/asks/:id/answer` | `{value, surface}` | | hub route | The one answer path; `GET /api/asks?open=1` lists the viewer's own and, for an adult, the parent-asks |

The existing `approvals` table migrates into `asks` with `kind: approval` (ids kept, `decided_by: parent`); `routes/approvals.ts`
stays as a thin alias for one release, then goes (rule 12: ported before deleted). `PendingAsk.kind: "ask"` and `"relay"`, never
written today, are removed in the same change. AGE-01's relay to an adult (rule 12's port list) rides
`OpenQuestionRow.kind: "relay"`, not this kind, so nothing on the port list is lost.

## 5. Privacy and offline

- **Outbound connections.** Telegram is the only one, unchanged: `api.telegram.org`, the household's own bot token. It sends
  the rendered template line and the ask's `summary` (tool or package name and its one target), never the prompt and never
  anything a person typed. Nothing is ever sent to a child or teen. A parent's message about a child's or teen's ask carries
  only the template line, the minor's first name and the summary. Controlled per type by `notifications.<type>.telegram` and the
  person's own linked chat id; a child or teen has no chat id field. The privacy page row (`lib/privacy.ts:142`) gains the
  words "and, for an ask, the one-line action summary". GATEWAY-01 inbound is a separate PRIVACY verdict, not this note.
- **No network.** The feed reconnects and replays; an ask waits for as long as it takes; an answer typed while offline is not
  saved and the card says so. A robot with no hub cannot answer and does not pretend to.
- **Logs and admin pages (rule 6a).** The admin's delivery log keeps type id, channel, count and timing; an `ask` event in a
  log is a typed event with no prompt, summary or person id. An admin sees a child's ask only as the parent-ask the audience
  rule already gives them, on their own surfaces, never a teen's or another adult's.
- **Shared screens.** `asks.waiting` is `privacy: true`: a TV or a robot carries a count or `form: "waiting"`, never content;
  the robot speaks an ask only through the gate in section 3.
- **Backups.** The `asks` table is a spec record and travels with the household backup; delivery rows travel as today;
  nothing in a backup carries Telegram's bot token beyond the secrets store's own rule.

## 6. Kit Elements and parts

Chat surfaces: `ApprovalCard` (`src/elements/approval-card.tsx`, states `request`, `running`, `done`, `denied`, `statusLabels`
for "Skipped", `allowHint`, `onAlwaysAllow` shown only when section 3 allows it) and `question-flow` (`src/elements/question-flow.tsx`,
not yet implemented in Home; this is its first use) through `TOOL_BINDINGS` renders in `elementBindings.ts`, no className, no
wrapper. Everything else: the kit's shadcn/ui set, `Badge` for counts, `Item` rows in the bell, `Skeleton`; the sounds switch
is a registry boolean drawn by the settings renderer (S4, S5). Nothing new is drawn by Home.

**Reuse check.** Looked at first: the kit `ApprovalCard` (fits, ED-006); `question-flow` (fits one-step choices); the kit
`background-inbox` for the Needs-you list (ACTIVITY-01's part, not needed for the card); Hono's `streamSSE` for the feed (shipped,
used for the turn stream's sibling in `routes/openai.ts`); `deviceCommands.ts`'s replay rule, extracted into one shared function that the robot WebSocket and the web feed both
call (one implementation); FACE-02M's tone module for cues; the existing `quietHours()` and `trigger()`. Considered and rejected:
Web Push through a browser maker (off-LAN, ENGINE-AVAIL-06b, Jesse's call); a sound library (three tones are not worth one);
a second ask table beside `approvals` (one record, principle 1); inline Telegram buttons (inbound is GATEWAY-01). Hand-built:
`asks.ts` (the answer path and the gate re-check) and `eventFeed.ts` (the publisher), because no shipped part holds a household
ask or fans one record out to five surfaces.

## 7. Rule check

- **Rule 0**: a minor's ask goes to a parent through `decidePendingAsk()`'s `ask_parent`, the parent's existing channels and
  consent; the robot never speaks a minor's ask; no setting here reaches a gate. No conflict.
- **Rule 1**: the spoken and typed yes stay the exact consent words (`AFFIRMATIVE_RE`); options match by exact label or number;
  no learned component in the consent path. No conflict.
- **Rule 6**: a denial is told to the model as "declined, did not run", which is neither a tool failure nor a policy refusal; the answer continues in its own words; a tone has no words. No conflict.
- **Rule 6a**: no prompt, summary or person id next to an activity in any log; the delivery log keeps type, channel, count. No conflict.
- **Rule 9 and 9b**: `ApprovalCard` and `question-flow` as they ship, bound through `TOOL_BINDINGS`; shadcn parts elsewhere;
  no className, no wrapper; the sounds helper is not a UI part. No conflict.
- **Rule 10**: an ask's prompt and a question's options pass the person's output floor before they are stored (`question`
  prompts come from a package and run through `refusePackageReplyIfUnsafe`); the robot speaks only a floor-checked prompt. No conflict.
- **Rule 12**: `pending_ask` keeps `lookup` and `who`; `approvals` is ported into `asks` before the alias is removed; the parent
  notifier stays on the port list and is the `approvals.requested` path here. No conflict.
- **S1, S2**: the bell stays in the rail's profile menu; the Needs-you card is the chat's own (ACTIVITY-01e); no app draws a
  second notifications control. No conflict.
- **S4, S5**: both new keys are registry keys with spec copy; no page writes a help line. No conflict.
- **Platform principle 3**: `Ask` carries id, provenance and `hlc` from the first write. Principle 1: one record replaces
  `approvals` plus `pending_ask`'s confirm. No conflict. No NEEDS-RULE-CHANGE.

## 8. Slices

| Id | Size | Order | After | Exit check |
|---|---|---|---|---|
| BRAKES-02a: the `Ask` record, `ask.options`, `grant.conversation_id`, the two keys and the `asks.waiting` type (commons, then the pin bump) | S | 1 | nothing | spec conformance fixtures for the three kinds; `check.sh` in commons; `docs/PINNING.md` steps in Home |
| MEM-PUSH-01a: the per-person feed `GET /api/me/events` and `eventFeed.ts`; the bell subscribes with the 60 s fallback | S | 2 | BRAKES-02a | a delivery reaches an open tab within 1 s; a reconnect with `Last-Event-Id` replays exactly the missed rows; a child's feed never carries an admin's row |
| BRAKES-02b: `asks.ts`, `POST /api/asks/:id/answer`, `ask_answer {ask_id}`, parent routing of `ask_parent`, denial as skipped, "waiting since", Cmd+Enter, the `approvals` port | M | 3 | MEM-PUSH-01a; BRAKES-01 for `tool_action` asks (works for today's consequential-package confirm without it) | the table test: five surfaces answer one ask id, the first wins, the rest read it; a denied call shows "Skipped" and the transcript carries the model's own words; a child's ask reaches a parent's card and bell and never the robot; an ask 24 h old is answerable |
| MEM-PUSH-01b: the chip reads the feed; `useMemoryStatusPoll`, `pollOnce`, `markStalled` deleted; tests re-pointed | S | 4 | MEM-PUSH-01a | `chatMemoryChip.test.tsx` and `chatMemoryState.test.ts` pass on feed events; a `not_saved` turn clears pending with no bell row |
| NOTIFY-SOUND-01: the three cues, `cue` on the event, `cues.ts` in `core`, the switch, a parent sets a child's | S | 5 | MEM-PUSH-01a; BRAKES-02a | a cue plays once per ask id, never twice, never inside quiet hours; the child's switch is refused for the child's own write; the enrollment sounds still pass their tests |
| PKG-RESULT-01a: the `question` kind from `PluginResult.ask`, the paused `resume`, the model-free answer reader, `end_conversation` | M | 6 | BRAKES-02b | `ask-disambiguate.json` runs end to end; an abandoned question routes the next turn normally; a tapped option answers without a model call |
| PKG-ASK-01: trivia split into an `ask` step and a resumed compare step; `question-flow` wired | S | 7 | PKG-RESULT-01a | trivia asks, waits, scores; `bun run elements:status` gains `question-flow` |
| BRAKES-02c: "Always allow in this chat" as a grant row with `conversation_id`, shown as a chip, never offered to a child, teen per BRAKES-01 | S | 8 | BRAKES-01; BRAKES-02b | the same tool in the same chat never re-asks; a child's card has no such control; the chip removes the grant |
| BRAKES-02d: the robot half: the spoken ask through `ask_answer {ask_id}`, speaker evidence, simple adult asks only; bot `conversation/offer.py` reuses OFFER-01's accept and decline sets | S | 9 | OFFER-01; BRAKES-02b | a robot without speaker evidence stays silent; "not now" leaves the ask open; the bot gate passes |
| BRAKES-02e: Telegram outbound summary for `asks.waiting` and the privacy row wording; inbound answering filed under GATEWAY-01 | S | 10 | BRAKES-02b | the message carries the template line and summary only; a child's ask produces no Telegram message to the child and the parent's carries no child text |

## 9. Legacy verdicts

Nothing borrowed from legacy. The mirror `legacy-backups/home-legacy.git` is not present in this worktree or the main
checkout, so the pre-rebuild notification, approval and sound code was not consulted; every part here is built from the
rebuilt hub's own code named in section 1.

## 10. Supersedes

- NOTIFY-SOUND-01's "the sound files are ours (licence recorded in `dev.md`)": replaced by synthesized tones with no files and
  no licence (decision 1); the row's acceptance changes to match.
- `docs/plans/browser-notifications-2026-09-30.md` slice 06a's "the shell subscribes to the existing notification event
  stream": no web stream existed (the only feed was the robot's WebSocket); MEM-PUSH-01a creates it and 06a subscribes to this one.
- MEM-PUSH-01's open question ("some OTHER way to know nothing happened"): answered by the `memory` feed event.
- BRAKES-02's "Telegram for adults" as an answering surface: narrowed to outbound until GATEWAY-01 lands; the answer route is
  ready for it.
- `pendingAskMigration.ts`'s "this slice has not shipped parent routing yet": BRAKES-02b ships it.
- `approvals.ts`'s header "not a spec 3.1 record": the `Ask` record is one; the self-decide rule it describes is kept.
- The `PendingAsk` kinds `ask` and `relay` (never written): removed. The `confirm` kind becomes a pointer to the record.
- Nothing in `RULES.md`.

## 11. Decisions for Jesse

1. Cues are synthesized tones (FACE-02M's way, no files, no licence) rather than recorded sound files; recommended until he
   hears them and asks for real recordings.
2. A parent's Telegram message about a child's ask keeps the child's first name and the action summary, as
   `approvals.requested` already sends today ("Oliver is asking to install Trivia"); recommended, the alternative is a bare
   "Someone needs your OK in MaiPai".
3. Sounds default off for everyone, a parent turns a child's on; recommended, as the backlog row says, and noted here only
   because it is a product default he may want on for adults.
