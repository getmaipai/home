// ASSIST-REMIND-01: the alarm and reminder-cancel phrases reach `timer` and `remind` as a structured `action`, which
// plugins.ts folds into the op text as a private prefix ("alarm:set:", "reminder:cancel:"). The host reads that prefix
// and runs the alarm engine (alarmChat.ts). The prefix is the host's own signal: a person's or a model's expression that
// starts with one is neutralized before it can look like a call, so no wording can reach the engine around the brake.

/** Structured action to private op-text prefix, per tool. */
const FOLDS: Record<string, Record<string, string>> = {
  timer: { set_alarm: "alarm:set:", cancel_alarm: "alarm:cancel:", list_alarms: "alarm:list:" },
  remind: { cancel_reminder: "reminder:cancel:", list_reminders: "reminder:list:" },
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

export interface AlarmCall {
  /** The audit action name, e.g. "set_alarm". */
  action: string;
  /** What alarmChat.ts takes: the verb, then the rest of the phrase. */
  chatText: string;
}

/** Reads a folded op text back into a call for this tool, or null when the text is not one (a plain timer or reminder). */
export function parseAlarmCall(tool: string, text: string): AlarmCall | null {
  const folds = FOLDS[tool];
  if (!folds) return null;
  for (const [action, prefix] of Object.entries(folds)) {
    if (text.startsWith(prefix)) {
      const verb = prefix.split(":")[1]!;
      return { action, chatText: `${verb} ${text.slice(prefix.length).trim()}`.trim() };
    }
  }
  return null;
}
