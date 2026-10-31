// ASSIST-BENCH-01: the action names the bench expects, per tool. One definition: the list actions come from
// lib/listActions.ts; the reminder and alarm actions that exist today (alarmCalls.ts) are listed with the ones the
// design note adds (section 2), and a test checks the two groups against alarmFoldFor.
import { LIST_ACTIONS } from "@/lib/listActions";

/** Reminder actions. `cancel_reminder` and `list_reminders` exist in alarmCalls.ts; the rest are ASSIST-REMIND-01. */
export const REMINDER_ACTIONS = ["create_reminder", "edit_reminder", "snooze_reminder", "complete_reminder", "cancel_reminder", "list_reminders"] as const;

/** Alarm actions on `timer`. `set_alarm`, `cancel_alarm` and `list_alarms` exist in alarmCalls.ts; the rest are ASSIST-REMIND-01. */
export const ALARM_ACTIONS = ["set_alarm", "edit_alarm", "enable_alarm", "disable_alarm", "skip_next_alarm", "cancel_alarm", "delete_alarm", "list_alarms"] as const;

/** The actions that already fold into the op text today. */
export const EXISTING_FOLDS = {
  remind: ["cancel_reminder", "list_reminders"],
  timer: ["set_alarm", "cancel_alarm", "list_alarms"],
} as const;

export const ACTIONS_BY_TOOL: Record<"remind" | "timer", readonly string[]> = {
  remind: [...LIST_ACTIONS, ...REMINDER_ACTIONS],
  timer: [...ALARM_ACTIONS],
};

/** What a call with no `action` means: a plain reminder on `remind`, a plain timer on `timer`. */
export const DEFAULT_ACTION: Record<"remind" | "timer", string> = { remind: "create_reminder", timer: "start_timer" };
