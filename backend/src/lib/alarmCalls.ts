// ASSIST-REMIND-01: the alarm and reminder-cancel phrases reach `timer` and `remind` as a structured `action`, which
// plugins.ts folds into the op text as a private prefix ("alarm:set:", "reminder:cancel:"). The host reads that prefix
// and runs the alarm engine (alarmChat.ts). The prefix is the host's own signal: a person's or a model's expression that
// starts with one is neutralized before it can look like a call, so no wording can reach the engine around the brake.

import { z } from "zod";
import { LIST_ACTIONS, type ListAction } from "@/lib/listActions";

/** Structured action to private op-text prefix, per tool. */
const FOLDS: Record<string, Record<string, string>> = {
  timer: {
    list_timers: "timer:list:",
    set_alarm: "alarm:set:",
    cancel_alarm: "alarm:cancel:",
    list_alarms: "alarm:list:",
    edit_alarm: "alarm:edit:",
    enable_alarm: "alarm:enable:",
    disable_alarm: "alarm:disable:",
    skip_next_alarm: "alarm:skip:",
    delete_alarm: "alarm:delete:",
  },
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

/** Whether this call is an alarm action on `timer`, a reminder action on `remind`, or one of the list actions on `remind`.
 * Such a call is refused for an unidentified speaker, because these engines answer for the signed-in person. */
export function isAlarmActionCall(tool: string, args: Record<string, unknown> | undefined): boolean {
  if (alarmFoldFor(tool, args?.action) !== null) return true;
  return tool === "remind" && isListAction(args?.action);
}

const LIST_ACTION_NAMES: ReadonlySet<string> = new Set(LIST_ACTIONS);

/** Whether `action` is one of the list actions `remind` runs through the list engine. */
export function isListAction(action: unknown): action is ListAction {
  return typeof action === "string" && LIST_ACTION_NAMES.has(action);
}

/** The private prefix of a structured list call. The old closed-pattern prefix is `list:`; this one is different on
 * purpose, so text a person says after "add" can never be read as a structured call. */
export const LIST_CALL_PREFIX = "lists:";

/** Longest list name, item or word the payload accepts, and the most items in one call. */
export const LIST_WORDS_MAX = 200;
export const LIST_ITEMS_MAX = 50;

const listWords = z.string().trim().min(1).max(LIST_WORDS_MAX);
const listWordsArray = z.array(listWords).max(LIST_ITEMS_MAX);

/** What a structured list call carries after its prefix. Unknown fields are rejected; sizes are bounded. */
export const ListPayload = z.object({
  list: listWords.optional(),
  to_list: listWords.optional(),
  items: listWordsArray.optional(),
  name: listWords.optional(),
  exclude: listWordsArray.optional(),
  order: listWordsArray.optional(),
}).strict();
export type ListPayloadT = z.infer<typeof ListPayload>;

function wordsOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function wordsArrayOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

/** Whether a `remind` call is exactly the shape the shopping-list closed patterns and the widget build: the plain
 * `list:` fold keeps their reply byte-identical. */
export function isShoppingPatternCall(inputs: Record<string, unknown>): boolean {
  const expression = wordsOf(inputs.expression);
  if (!expression) return false;
  const others = ["to_list", "name", "exclude", "order"].some((key) => inputs[key] !== undefined);
  if (others) return false;
  const list = wordsOf(inputs.list);
  if (list !== undefined && list !== "shopping") return false;
  const items = wordsArrayOf(inputs.items);
  if (inputs.action === "add_items") return items === undefined || (items.length === 1 && items[0] === expression);
  return inputs.action === "show_list" && items === undefined && expression === "shopping list";
}

const LIST_FROM_EXPRESSION = new Set<string>(["delete_list", "show_list", "find_list", "clear_done"]);
const NAME_FROM_EXPRESSION = new Set<string>(["create_list", "rename_list", "copy_list"]);
const ITEMS_FROM_EXPRESSION = new Set<string>(["add_items", "remove_items", "check_items", "uncheck_items"]);

/** The op text after a structured list prefix: a JSON object of the call's own fields. Built only here, from the call's
 * validated arguments. The expression stands in for the one field an action needs when the model left it out. */
export function listCallText(action: string, inputs: Record<string, unknown>): string {
  const expression = wordsOf(inputs.expression);
  const payload: Record<string, unknown> = {};
  const list = wordsOf(inputs.list) ?? (LIST_FROM_EXPRESSION.has(action) ? expression : undefined);
  const name = wordsOf(inputs.name) ?? (NAME_FROM_EXPRESSION.has(action) ? expression : undefined);
  const items = wordsArrayOf(inputs.items) ?? (ITEMS_FROM_EXPRESSION.has(action) && expression ? [expression] : undefined);
  const toList = wordsOf(inputs.to_list);
  const exclude = wordsArrayOf(inputs.exclude);
  const order = wordsArrayOf(inputs.order);
  if (list) payload.list = list;
  if (toList) payload.to_list = toList;
  if (items) payload.items = items;
  if (name) payload.name = name;
  if (exclude) payload.exclude = exclude;
  if (order) payload.order = order;
  return `${LIST_CALL_PREFIX}${action}:${JSON.stringify(payload)}`;
}

export type ListCall =
  | { ok: true; action: ListAction; payload: ListPayloadT }
  | { ok: false; reply: string };

/** Reads an op text back into a structured list call, or null when the text is not one. */
export function parseListCall(text: string): ListCall | null {
  const match = /^lists:([a-z_]+):([\s\S]*)$/.exec(text);
  if (!match || !isListAction(match[1])) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[2]!);
  } catch {
    return { ok: false, reply: "I couldn't read that list request." };
  }
  const parsed = ListPayload.safeParse(raw);
  if (parsed.success) return { ok: true, action: match[1], payload: parsed.data };
  const tooMany = parsed.error.issues.some((issue) => issue.code === "too_big" && (issue as { origin?: string }).origin === "array");
  return {
    ok: false,
    reply: tooMany
      ? `That is too many at once. Please give me ${LIST_ITEMS_MAX} items or fewer.`
      : "I couldn't read that list request.",
  };
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
