// ASSIST-REMIND-01: the alarm and reminder-cancel phrases reach `timer` and `remind` as a structured `action`, which
// plugins.ts folds into the op text as a private prefix ("alarm:set:", "reminder:cancel:"). The host reads that prefix
// and runs the alarm engine (alarmChat.ts). The prefix is the host's own signal: a person's or a model's expression that
// starts with one is neutralized before it can look like a call, so no wording can reach the engine around the brake.

/** Structured action to private op-text prefix, per tool. */
const FOLDS: Record<string, Record<string, string>> = {
  timer: { set_alarm: "alarm:set:", cancel_alarm: "alarm:cancel:", list_alarms: "alarm:list:" },
  remind: {
    cancel_reminder: "reminder:cancel:",
    list_reminders: "reminder:list:",
    delete_reminder: "reminder:delete:",
    show_reminders: "reminder:show:",
    edit_reminder: "reminder:edit:",
    snooze_reminder: "reminder:snooze:",
    complete_reminder: "reminder:complete:",
  },
};

/** The private prefix for a structured alarm or reminder action on this tool, or null for anything else. */
export function alarmFoldFor(tool: string, action: unknown): string | null {
  if (typeof action !== "string") return null;
  const folds = FOLDS[tool];
  return folds && Object.hasOwn(folds, action) ? folds[action]! : null;
}

/** Whether this call is an alarm action on `timer` or a reminder-cancel or list action on `remind`. Such a call is refused
 * for an unidentified speaker, because the alarm engine answers for the signed-in person. */
export function isAlarmActionCall(tool: string, args: Record<string, unknown> | undefined): boolean {
  return alarmFoldFor(tool, args?.action) !== null;
}

/** Stops an expression that starts with a reserved prefix from being read as a host call. */
export function neutralizeReservedPrefix(expression: unknown): unknown {
  return typeof expression === "string" ? expression.replace(/^(\s*)(alarm|reminder):/i, "$1$2 ") : expression;
}

/** What a reminder action says beyond which reminder it means. */
export interface ReminderPayload {
  /** The person's words for the reminder (its task text, or "that"). */
  reminder: string;
  /** Snooze: minutes to move it later. */
  minutes?: number;
  /** Edit: the new task text. */
  task?: string;
  /** Edit: the new time, in the person's words. */
  when?: string;
}

/** The op text after the private prefix: the plain words when only a name is given, else a JSON object. */
export function reminderPayloadText(inputs: Record<string, unknown>): string {
  const words = typeof inputs.reminder === "string" && inputs.reminder.trim() ? inputs.reminder : String(inputs.expression ?? "");
  const minutes = typeof inputs.minutes === "number" && Number.isFinite(inputs.minutes) ? Math.round(inputs.minutes) : undefined;
  const task = typeof inputs.task === "string" && inputs.task.trim() ? inputs.task.trim() : undefined;
  const when = typeof inputs.when === "string" && inputs.when.trim() ? inputs.when.trim() : undefined;
  if (minutes === undefined && task === undefined && when === undefined) return words;
  const payload: ReminderPayload = { reminder: words, ...(minutes !== undefined ? { minutes } : {}), ...(task ? { task } : {}), ...(when ? { when } : {}) };
  return JSON.stringify(payload);
}

/** Reads the op text after a reminder prefix back into a payload; anything that is not the JSON shape is plain words. */
export function parseReminderPayload(rest: string): ReminderPayload {
  if (rest.startsWith("{")) {
    try {
      const parsed = JSON.parse(rest) as Partial<ReminderPayload>;
      if (typeof parsed.reminder === "string") {
        return {
          reminder: parsed.reminder,
          ...(typeof parsed.minutes === "number" ? { minutes: parsed.minutes } : {}),
          ...(typeof parsed.task === "string" ? { task: parsed.task } : {}),
          ...(typeof parsed.when === "string" ? { when: parsed.when } : {}),
        };
      }
    } catch {
      // Plain words that happen to start with a brace.
    }
  }
  return { reminder: rest };
}

export interface AlarmCall {
  /** The audit action name, e.g. "set_alarm". */
  action: string;
  /** What alarmChat.ts takes: the verb, then the rest of the phrase. */
  chatText: string;
  /** The op text after the prefix, untouched. */
  rest: string;
}

/** Reads a folded op text back into a call for this tool, or null when the text is not one (a plain timer or reminder). */
export function parseAlarmCall(tool: string, text: string): AlarmCall | null {
  const folds = FOLDS[tool];
  if (!folds) return null;
  for (const [action, prefix] of Object.entries(folds)) {
    if (text.startsWith(prefix)) {
      const verb = prefix.split(":")[1]!;
      const rest = text.slice(prefix.length).trim();
      return { action, chatText: `${verb} ${rest}`.trim(), rest };
    }
  }
  return null;
}
