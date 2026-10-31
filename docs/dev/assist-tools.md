---
title: Assistant tools for lists, reminders and alarms
description: How a spoken or typed list, reminder or alarm request reaches the engines, and how the model path will be switched on.
---

Design: `docs/plans/assistant-tools-lists-reminders-alarms-2026-10-30.md`. User page: `docs/user/lists-reminders-alarms.md`.

## Three layers

1. **Pattern floor.** Closed phrases in `backend/packages/remind/manifest.json` and `backend/packages/timer/manifest.json` (`routing.patterns`). They work without the model, so the engine-down path keeps working. This is all that is live for lists, reminders and alarms today.
2. **Folded prefixes.** A structured `action` is folded into the op text as a private prefix: `alarm:set:`, `alarm:cancel:`, `alarm:list:`, `reminder:cancel:`, `reminder:list:` (table `FOLDS` in `backend/src/lib/alarmCalls.ts`; list prefixes `list:add_items:` and `list:show_list:` in `remindInputs` in `backend/src/lib/plugins.ts`). The host reads the prefix back (`parseAlarmCall`) and runs the engine. The prefix is the host's own signal, so model or person text that starts with one is neutralized (`neutralizeReservedPrefix`, and the `list:` strip in `remindInputs`; `timerInputs` does the same for timer). Without that, wording alone could reach an engine and skip the brake and audit.
3. **Engines.** Lists: `backend/src/lib/lists.ts`. Alarms: `backend/src/lib/alarms.ts`, chat entry `backend/src/lib/alarmChat.ts`. Reminders: `backend/src/lib/reminderParsing.ts` and `scheduler.ts`. Receipts: `backend/src/lib/packageBlocks.ts` ("Reminder set for ...").

## Brake, audit, undo

Every write goes in this order:

1. `brakeFor` in `backend/src/lib/toolBrake.ts`, called from `backend/src/lib/turnMachine/nodes/policy.ts`. It returns do, ask or never from structured arguments (never from wording): the household setting, a delete or clear, more than 5 items (`BULK_THRESHOLD`), the age band, and whether the run read outside content. Ask reuses the `confirm_needed` card path.
2. `recordToolAudit` in `backend/src/lib/toolAudit.ts`: one row per decision, counts only, no list names or items.
3. `recordUndo` in `backend/src/lib/toolUndo.ts`: stores an inverse for reversible actions, valid 10 minutes. The route is `/api/tool-undo` (`backend/src/routes/toolUndo.ts`, mounted in `backend/src/app.ts`); `runUndo` checks owner, expiry and use.

Settings keys `tools.remind.mode`, `tools.timer.mode` and `tools.lists.mode` are in `backend/src/settings/toolBrakeKeys.ts` (labels Reminder actions, Timer actions, List actions; default do).

## Turning on the model path

The model-chosen actions (free wording, move, copy, reorder, undo) are built but not offered. They turn on only when ASSIST-BENCH-01 passes: the CHAT-AB-01 tool-decision bench (`backend/scripts/bench/chat-ab-01.ts`) over about 120 utterances with paired 95% intervals on each chat model. The bench row flips the offer; the docs "Coming next" section moves into the main page in the same commit. Check `docs/BACKLOG.md` for the item's state before editing either page.
