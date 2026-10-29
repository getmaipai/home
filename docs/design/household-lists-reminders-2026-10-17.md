# Lists, reminders and timers: the Household app (2026-10-17)

Design note, written in the 2026-10-17 design audit. The hub already ships four bundled plugins (`list-add`, `list-view`,
`remind`, `timer`), a `list` spec record, `backend/src/lib/lists.ts`, `backend/src/lib/scheduler.ts` and `reminderParsing.ts`,
and `GENUI-05` draws a `todo_list` and a `schedule_card` in chat. What is missing is the place a person goes to see and change
these outside a chat turn, and the one decision that keeps it from being "a glorified reminder app" (the backlog's own words,
Feature parity section). This note decides that. Rules in [RULES.md](RULES.md) govern; nothing here asks for a rule change.

## Purpose

One app, **Household**, where the shopping list, every person's to-do lists, the reminders and the running timers live. Chat
stays the main way in ("add milk", "remind me at six", "ten-minute timer"); the app is where the family reads the list in the
store, ticks things off, and sees what is coming. Nothing here is a second planner: one standing shopping list and one standing
to-do list per household (the spec record says so), a person's own custom lists, reminders and timers as the scheduler's jobs.

## Users and gates

| Person | Sees | May do |
|---|---|---|
| Child | the household shopping list, their own to-do and custom lists, their own reminders and timers | add and tick items; set a reminder or timer for themselves; never a reminder for someone else; never delete a household list |
| Teen | the same, plus their own private lists an admin never opens (SETTINGS-DECISION-TEEN-LIMITS) | the same as an adult on their own records |
| Adult | household lists, their own lists, reminders they set for themselves or for a child they are a parent of | everything on those; delete a household list only with a confirm that names what it holds |
| Admin | the above; no view into any other person's own lists, a child's included (NO-CROSS-USER-VISIBILITY-01) | nothing extra: lists are not an admin surface |

Rule 0 holds: the plugins keep `min_role: child` for lists and timers; a reminder set for another person is a `consequential`
call and passes the policy checks like any tool call. Quiet hours (NOTIFICATIONS.md) hold a reminder's `time_sensitive`
notification; a timer's `timer.done` is `immediate` on the device that set it only.

## Screens and IA

Household is an app on the rail (S1) that emulates Apple Reminders' layout (S2): a left column of lists, a main column of items.

1. **Lists** (`/household`): the left column groups Shopping, To-do, My lists, and Shared with me; a count per list. The
   main column shows the selected list's items with a checkbox each, done items under a fold, a one-line composer at the
   bottom ("Add an item"). Shopping ticks sort to the bottom and clear with one "Clear done" action.
2. **Coming up** (`/household/coming-up`): reminders and timers for the signed-in person as one timeline (today, tomorrow,
   later), each row with the time in words, the text, and Done / Snooze (15 minutes, an hour, tomorrow morning). A running
   timer shows a live countdown; a parent sees the reminders they set, including ones they set for a child, marked with the
   child's name; a child's own reminders are the child's alone.
3. **A list's details** (a sheet on the phone, the right pane on a desktop): rename, household or mine, who may edit, delete.
4. **Phone**: the drawer per S1; the list column becomes the first screen and a list opens as the second; the composer stays
   at the bottom.

What a person cannot do here: no nested lists, no priorities, no tags, no recurring reminders in slice 1 (a recurring one is
a routine, ROUTINES-01, and the row says so when they try).

## Data and spec records (spec first)

- `list` (`commons/spec/schemas/list.schema.json`, exists): `kind` shopping | todo | custom, `scope` household | person,
  items with `id`, `text`, `done`, `due_at`, `hlc`. **Addition, spec first:** an optional `shared_with: person_id[]` on a
  `person`-scoped custom list, so Shared with me has a source; default empty. `lists.ts` already finds-or-creates the two
  standing lists; no second store.
- Reminders and timers are `scheduled_jobs` rows (`scheduler.ts`, `kind: plugin`, `job: remind | timer`). **Addition, spec
  first:** the `scheduled-task` record SCHED-02 already plans; this app reads the same rows and adds nothing. A snooze is a
  reschedule of the same job id (one record), never a copy.
- Notifications: `remind.due` and `timer.done` exist and are declared by the packages; the app's Done and Snooze round-trip
  through the existing notification actions (NOTIFICATIONS.md, actions round-trip once).
- Provenance: a list item carries `source: chat | app | package` (exists on the record as `source`); the app writes `app`.

## Offline and privacy

Everything is local; the app works with no network and no model. No outbound connection, so no privacy-page row. A parent is
notified only about reminders the parent set; a child's own reminder never notifies anyone but the child (rule 6a,
NO-CROSS-USER-VISIBILITY-01).

## Kit Elements and parts (rule 9b)

Non-chat surface, so shadcn parts from `@maipai/ui/src/ui/*` only: `sidebar` (the list column, as the kit's app-section
sidebar), `checkbox`, `input` (the composer), `sheet` (details on the phone), `dialog` (delete confirm), `badge` (counts),
`tabs` (Lists / Coming up on the phone), the kit `data-table` for Coming up. In chat the existing `todo_list` and
`schedule_card` answer blocks stay (GENUI-05). No new kit part is needed; nothing is drawn by hand. Reuse check: Apple
Reminders and Google Keep are the shapes copied; the kit's `sidebar` and `checkbox` already do the job, so no library is added.

## Slices

1. **HOUSEHOLD-01 (S):** the app on the rail, `/household` with the Shopping and To-do lists on `GET /api/lists`, add, tick,
   clear done. Exit: a child ticks milk on a phone and the list in chat shows it ticked.
2. **HOUSEHOLD-02 (S):** custom lists, rename, delete with confirm, `shared_with` (spec first, pin bump).
3. **HOUSEHOLD-03 (S):** Coming up: reminders and timers from `GET /api/jobs`, Done and Snooze through the notification
   actions, the live countdown.
4. **HOUSEHOLD-04 (S):** the phone layout per S1 and S3's widths; the screenshot pair at 1440 and 390.

## Legacy verdicts (rule 8, one line each)

- Legacy "Lists" page with per-list colours and icons: **dropped**; the kind badge is enough and colour is a token, not data.
- Legacy "Reminders" with recurrence rules: **merged** into routines (ROUTINES-01); a reminder is one-shot.
- Legacy shared-list push between household members: **rebuilt** as `shared_with` on the spec record, no second sync path.
- Legacy timer page with a full-screen clock: **redesigned** as the Coming up countdown row; a full-screen timer is a pod or
  TV surface for Go, not a hub page.

## Supersedes

Nothing at first (2026-10-17). It gives the four bundled plugins and GENUI-05 a home; it changes no chat behaviour, no plugin, no gate.

**Owner ruling, 2026-10-29: the one Household app is split in two, as Apple does.** **Reminders** (`/reminders`, rail name
"Reminders") holds the Shopping and To-do lists and a "Coming up" tab of the person's pending reminders. **Clock** (`/clock`,
rail name "Clock") holds alarms and timers, each with Done and Snooze and a live timer countdown. `/household` and
`/household/coming-up` redirect to `/reminders`. The users and gates table, the data and spec records, the kit parts and the
offline and privacy sections above are unchanged; only the app boundary and its names move. The old "Household" app name and
the single "Coming up" timeline that mixed alarms with lists are replaced by this split (HOUSEHOLD-01 and HOUSEHOLD-03 built them;
REMINDERS-01 and CLOCK-01 move them).

## Architect verdict

See the record `DESIGN-HOUSEHOLD-2026-10-17` in `data-scratch/architect/` (rules 0, 6a, 9b, S1, S2, S3).
First round REJECTED (a parent's view of a child's reminders); this revision removes it.
