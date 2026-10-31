# The companion manages lists, reminders and alarms with tools (2026-10-31, rev 7)

Owner ask: fixed phrases ("add * to the shopping list") cannot cover how people talk. "Create a new list", "add that to my list", "change my list to include", "copy my list but", "reorder my list", "move those from list A to B" must work in any wording, by chat and by voice. Built on [agentic-actions-design-2026-10-29](agentic-actions-design-2026-10-29.md) (approved; sections 3.3, 3.4, 3.8 and 7 step 1 say `remind`, `timer` and `list-add` are reused with an effect class, receipt and Undo added). Rev 7 fixes the architect's rev 6 rulings (kit `Confirmation` block for the receipt, Supersedes rows for BRAKES-01 and CHAT-CARDS-09, one definition throughout, no ordering cycle, no dead-end card for a child). Rev 6 (owner choice 2026-10-31: the smallest path, no CHAT-CARDS series) replaces the dependency on CHAT-CARDS-09 and BRAKES-01 with four Home-only slices, section 4a. Rev 5 answered four architect rejections: it extends the packages that exist, adds no second tool, and keeps the base offered set at ten (rule 1) by folding each new capability into the tool of the app that already owns it (REMINDERS-01: Reminders holds lists and reminders; CLOCK-01: Clock holds alarms and timers).

## 1. What exists (read from the code, 2026-10-30)

| Piece | State |
|---|---|
| `backend/packages/remind` | `offer.mode: base`: the model already decides reminders today. Args are a single expression. |
| `backend/packages/alarm` | one tool with `action` in `set, cancel, list` and an `expression`; `offer.mode: off` awaiting a CHAT-AB-01 row; reached only by closed patterns. ALARM-01 already says later actions are added as actions, not new tools. |
| `backend/packages/list-add`, `list-view` | closed patterns only (`add * to the shopping list`, `what's on my shopping list`); shopping list only. |
| `backend/src/lib/lists.ts` | the operations: create, update, delete, add, edit, remove, clear, clear done. No move, copy or reorder. `listLists` returns every person's lists to an owner or admin (line 76). |
| Ask card | BUILT (APPROVE-CARD-01/02): `policy.ts` parks `confirm_needed`, `machine.ts` stores `pendingAsk`, `chatToolUis.tsx` draws the kit `ApprovalCard`, `turnNext.ts` `resumesAsk` resumes on a tap, a typed or spoken yes; minors go through `decidePendingAsk`. Gap: it fires only when `manifest.consequential` is true; `remind` and `timer` are not. |
| Receipt | the kit `Confirmation` Element (sentence, `undo` prop, `onUndo`) and the spec `confirmation` answer-block kind with optional Undo (CHAT-CARDS-05 spec) ship; `answer-block.tsx` draws it and routes Undo as `onAction(block.id, "undo")`; nothing returns it yet. `remind` and `timer` return `schedule_card` today. The kit `ApprovalCard` has no Undo slot. There is no per-tool do/ask/never setting and no audit table. |
| Fuzzy matching | `backend/src/lib/text.ts` and `askNames.ts`. |

## 2. Design

1. **One tool per app, extended, never duplicated, and the base set stays at ten.**
   - `remind` (base-offered today) gains an `action` argument: create (today's behavior), edit, complete, delete, snooze, show for reminders, and the list actions create_list, rename_list, delete_list, add_items, remove_items, check_items, uncheck_items, edit_item, move_items, copy_list, reorder, clear_done, show_list, find_list. It is the one tool of the Reminders app (REMINDERS-01). Its schema widens; the tool count does not.
   - `timer` (base-offered today) gains the alarm actions set_alarm, edit_alarm, enable_alarm, disable_alarm, skip_next_alarm, cancel_alarm, delete_alarm, list_alarms. It is the one tool of the Clock app (CLOCK-01). The separate `alarm` package is ported into `timer`, then deleted (rule 12); its alarm patterns move to `timer`'s routing as the floor; its reminder patterns (`cancel the reminder *`, `what reminders do I have`) move to `remind`, so each operation lives in exactly one tool.
   - `list-add` and `list-view` are ported into `remind`, then deleted. Their patterns move to `remind`'s routing as the engine-down floor and call the same functions in `lib/lists.ts`, so there is one definition of each operation.
   - Nothing is added to the base set, so rule 1's ten stays ten. The bench (section 5) measures whether the two wider schemas hold up; if they do not, the answer is a smaller action set or a rule change for Jesse, never a hidden extra tool.
2. **Names resolve in code.** The model passes words ("groceries", "that", "the milk"); a resolver maps them to ids using the fuzzy helpers in `text.ts` and `askNames.ts`, then "the list in the last tool result of this conversation" for "that" and "those". Zero or several matches return an error the model turns into one short question. The model never supplies an id it was not given.
3. **The resolver sees only what the speaker may see, whatever the role.** It filters to `list.person === actor.id` or `list.scope === "household"`. It does not call `listLists`, whose owner and admin reach would let an admin's "add that to my list" match a teen's private list (rule 6a, NO-CROSS-USER-VISIBILITY-01). A test pins this with an owner speaker and a teen's private list.
4. **Ask-first reuses the built ApprovalCard path (APPROVE-CARD-01/02, driven by the per-tool setting and `brakeFor` of section 4a); the receipt is the shipped spec `confirmation` block with `undo`, drawn by the existing `answer-block` binding, and Undo runs through ASSIST-UNDO-01.** No new commons block kind and no kit change (rule 9).
5. **Ask-first policy for adults (owner answer, 2026-10-30):** adds, check-offs, renames, reorders, copies, edits, reminders and alarms happen at once with Undo. The companion asks first only to delete a list, clear a list, or remove or move more than 5 items. Undo lasts 10 minutes; a deleted list keeps its row (`deleted_at`) until then.
6. **Minors (rule 0): no gate loosens.** The gate table of [household-lists-reminders-2026-10-17](../design/household-lists-reminders-2026-10-17.md) and agentic note line 267 stay as they are:
   - Child: on the household shopping list, add and tick (check, uncheck) only; never delete it. On the child's own lists, reminders and timers, every action. A child's own alarm acts at once and keeps ALARM-05 quiet-hours behavior. Any other action on a household list gets one plain line ("a parent can do that").
   - Teen: every action on their own records (the table's "the same as an adult on their own records"); on household lists, add and tick on the household shopping list only, anything else gets "a parent can do that".
   - Adult: everything; deleting a household list, clearing a list, or removing or moving more than 5 items asks first, and the card names what the list holds.
   - Spoken turns answer the card by voice ("yes" or "no" after the companion reads the one-line question). An unidentified speaker gets none of the NEW actions and none of the alarm actions (the existing `alarm` refusal moves to `timer`, section 3); today's `timer` start and `remind` create for such a speaker are unchanged, so the robot kitchen timer keeps working; rule 1's weather exception is untouched.
7. **Taint.** A run tainted by web search or outside content asks before any write (agentic note 3.4 item 2).
8. **Logs.** Action names, counts and timings only; never a list name, item or label (rule 6a).

## 3. Supersedes

| Superseded | Where | By |
|---|---|---|
| `list-add` and `list-view` as separate closed-pattern packages | `backend/packages/list-add`, `list-view` | list actions on `remind`, ported then deleted (rule 12) |
| The `alarm` package and its action set `set, cancel, list` | `backend/packages/alarm` | alarm actions on `timer`, ported then deleted |
| "closed patterns are the only path" for alarms and lists | ALARM-01, HOUSEHOLD-01 notes | patterns become the engine-down floor; the model path is primary once benched |
| The shopping-list-only wording of HOUSEHOLD-01's chat entry | `docs/design/household-lists-reminders-2026-10-17.md` | any of the person's lists |

No band gate changes, so there is no Supersedes row for one.

**Ports written down before any delete (rule 12).** Deleting `alarm`, `list-add` and `list-view` first moves, each with its tests:
- the `alarm.due` notification type with its id unchanged (`scheduler.ts`, `notifications.ts` `RINGS_THROUGH_QUIET_HOURS`, `notificationKeys.ts`, `settingsMinorSnapshot.ts`);
- permission `reminders:write` onto `timer` (`schedule_card` is a `returns_blocks` kind `timer` already has; the alarm card titles and cadence in `packageBlocks.ts` move with it); permissions `lists:write` and `lists:read` onto `remind`;
- the false-claim guard family "list" in `backend/src/lib/guards.ts` (`packages: ["list-add"]`) repointed to `remind`, with a test that a real "Added milk" reply is not rewritten;
- `list-view`'s dashboard widget `shopping` (`lib/widgets.ts`, served under the package id) and its `todo_list` block (`packageBlocks.ts`, the GENUI-05 capture in `packageHost.ts`) moved to `remind`, ids unchanged for stored data;
- every `manifest.id === "alarm"` branch moved to `timer` with its tests: the unknown-speaker refusal (`turnMachine/nodes/policy.ts`, `nodes/commands.ts` `ALARM_UNKNOWN_SPEAKER`), the pattern argument builder and fixed failure line (`ALARM_FAILED`), and the `handleAlarmChat` dispatch in `packageHost.ts`; a test pins that an unknown speaker cannot set an alarm through `timer`;
- the `list-view` and `list-add` entries in `frontend/src/dev/elements-plan.json` and `elements-adoption.json`, updated in the same change;
- the reminder patterns of `alarm` onto `remind` (above);
- CHAT-CARDS-09's `confirmation` row names `list-add` as a source; that open item is repointed to `remind` in the backlog (nothing built to move).

CHAT-CARDS-09 and BRAKES-01 stay open with narrowed scope (section 4a Supersedes); section 4a builds only the Home-side parts these tools need.

## 4a. The brake, audit, undo and setting slices (Home only)

Replaces the dependency on CHAT-CARDS-09 and BRAKES-01. These land before any new write action ships.

1. **ASSIST-BRAKE-01: brake core.** `backend/src/lib/toolBrake.ts` with `brakeFor(manifest, args, actor, band)` returning do, ask or never, called in `policy.ts` right before the existing `ask_self` branch so it reuses the `confirm_needed` entry, the card, the tap, the typed and spoken yes and the reload path unchanged. Ask applies to a delete or clear action, to more than 5 items removed or moved, and to a household-list delete, decided from structured arguments in code, never from wording (rule 1). A minor acts at once on their own records (a child never meets a card nobody can answer, since a minor's yes does not approve); a minor's household-list delete or clear is refused with "a parent can do that" (`parent_required`); an unknown speaker is still refused; no gate loosens (rule 0). The prompt names what is affected; logs carry action names only (rule 6a). `brakeFor` also takes the per-run taint flag (agentic note 3.4 item 2): a run that read web search or outside content asks before any write. Settings keys `tools.remind.mode` (reminder actions), `tools.timer.mode` (timer and alarm actions) and `tools.lists.mode` (the list actions, which live on `remind`) (default do; the thresholds still force ask) in `settings.ts` and `settingsAreas`; a parent edits a minor's.
2. **ASSIST-AUDIT-01: audit.** Table `tool_audit(id, person_id, tool, action, decision, band, count, at)` with a migration (and the schema-version bump); one row per do, ask answered, never and undo; no text, list names or items; person-scoped read; an admin sees counts that name no person and never a breakdown by band (one teen in a home would be named by it).
3. **ASSIST-UNDO-01: receipt with Undo.** `remind` and `timer` (and the list actions) return the spec `confirmation` block with `undo` beside the existing `schedule_card` or `todo_list` block; the existing `answer-block` binding draws it (no new part, rule 9). Home wires `onAction(id, "undo")` in `chatAnswerBlocks.tsx` to `POST /api/tool-undo/:id`. A table `tool_undo(id, person_id, turn_id, tool, action, inverse_json, expires_at, used_at)` is written only for reversible actions; a deleted list keeps its row through `deleted_at`. The route checks the actor owns the row, it is unexpired and unused, then runs the inverse. Undo lasts 10 minutes; after expiry or use the block shows no Undo. The block is returned by tools the model calls through ordinary `returns_blocks`.
4. **ASSIST-SETTINGS-01: settings row and the model `undo` action.** A do/ask/never row per tool in the settings page; an `undo` action on `remind` and `timer` that the model chooses (rule 1: no regex for "undo that"). The `undo` action is a new `remind`/`timer` action, so like the others it turns on only when ASSIST-BENCH-01 passes; its bench row lives there, not in this slice.

**Supersedes (one definition of the setting, ask and audit).** The `tools.<tool>.mode` keys, `toolBrake.ts` and `tool_audit` are the one definition of BRAKES-01's per-tool do/ask/never setting, ask and audit row, and of the assistant-layer design's `tool_rules` and "one audit table" decisions for these tools. BRAKES-01 is narrowed to what remains: the parent-routed `tool_action` approval kind, setup and Connect cards, background-turn limits, the recipient allow list and T4 taint; it extends these pieces and copies none. CHAT-CARDS-09's remind and list-add Undo are delivered by ASSIST-UNDO-01; its timer countdown, lights, locks and `remember` items stay open. Both backlog rows are edited in the same commit.

Parent-routed asks for minors (the `tool_action` approval kind of BRAKES-01) stay out of this path: minors are refused, not routed. The self-decide refusal in `approvals.ts` is untouched.

## 4. Order of work

1. **ASSIST-BRAKE-01, ASSIST-AUDIT-01, ASSIST-UNDO-01, ASSIST-SETTINGS-01** (section 4a), then **ASSIST-LISTS-01:** port `list-add` and `list-view` into `remind` (list actions, new `move`, `copy` and `reorder` operations in `lib/lists.ts`, resolver, tests), then delete the two packages and repoint their CHAT-CARDS-09 row.
2. **ASSIST-REMIND-01:** add the reminder actions to `remind`; port `alarm` into `timer` (actions, `alarm.due`, permissions, `schedule_card`, alarm patterns; reminder patterns to `remind`), then delete `alarm`.
3. **ASSIST-BENCH-01:** the bench row and offer switch (section 5).
4. **ASSIST-DOCS-01:** user docs.

## 5. Verification (rules 1, 3, 8, 13)

Widening the `remind` and `timer` schemas changes every turn's tool decision, so the row is the full CHAT-AB-01 tool-decision measurement, not a one-run check: a fresh set of about 120 utterances (about 40 each for lists, reminders, alarms, plus 20 negatives such as "what's a good grocery list for tacos"), split into a held-out half, at least 3 repeats, paired 95% intervals, on each chat model the household can run (rule 8, one record per model). Measured: correct tool and action, correct arguments, a clarifying question on ambiguity, no call on negatives, the 5-item threshold honored, and no regression on the existing websearch, child, spoken and companion-voice rows. The new `remind` and `timer` actions turn on only when the intervals clear the bar the bench report states; today's `remind` create and `timer` start keep their current offer throughout, and the alarm actions stay behind the patterns until then. Unit tests first for the resolver (exact, fuzzy, "that", ambiguous, none, an owner speaker never matching a teen's private list), each action's receipt and Undo, and the per-band asks.

## 6. Not verified

Nothing has been run against a model. The 5-item threshold, the 10-minute Undo and the teen household-list split are proposals the owner can change. Multi-step sentences ("create a Costco list and move the dairy items from groceries to it") depend on chaining calls inside the tool budget and are measured, not assumed. Whether one `remind` schema can carry reminder and list actions cleanly or the bench shows it confusing the model is measured in ASSIST-BENCH-01; the fallback is fewer actions, not another tool.
