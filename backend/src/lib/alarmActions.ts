// ASSIST-WIRE-01: the alarm actions of `timer` beyond set, cancel and list: edit, turn on, turn off, skip the next ring,
// and delete. Which alarm a person means is decided here, in code, from their own alarm records only; the model passes
// words, never an id. Ambiguous or missing matches come back as one plain question. The work itself is lib/alarms.ts.
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import type { Alarm } from "@maipai/spec/gen/ts/alarm.js";
import { clockText, daysPhrase } from "@/lib/alarmChat";
import { deleteAlarm, listAlarms, skipNext, updateAlarm } from "@/lib/alarms";
import { fuzzy } from "@/lib/listResolver";
import { parseAlarmRequest } from "@/lib/reminderParsing";
import { tokenize, wordsOf } from "@/lib/text";
import type { PersonRow } from "@/types";

export const ALARM_ACTION_NAMES = ["edit_alarm", "enable_alarm", "disable_alarm", "skip_next_alarm", "delete_alarm"] as const;
export type AlarmActionName = (typeof ALARM_ACTION_NAMES)[number];

export interface AlarmActionResult {
  /** The plain sentence the person is told. */
  reply: string;
  /** The result's action for the reply data and card: "edit", "enable", "disable", "skip" or "cancel". */
  action: string;
  when_text: string;
  schedule_task?: string;
  /** True when the alarm engine did the change; false for a question or a refusal. */
  done: boolean;
}

type AlarmWithNext = Alarm & { next_at: string | null };
type Resolution =
  | { ok: true; alarm: AlarmWithNext }
  | { ok: false; reason: "none" | "ambiguous"; candidates: AlarmWithNext[] };

const FILLER = new Set(["alarm", "alarms", "my", "the", "that", "this", "it", "one", "next", "ring", "please", "off", "on"]);

const labelOf = (alarm: Alarm): string => alarm.label || alarm.tag;
const phraseOf = (alarm: Alarm): string => `${alarm.days.length ? daysPhrase(alarm.days) : "once"} at ${clockText(alarm.time)}`;
const lineOf = (alarm: Alarm): string => `Alarm: ${labelOf(alarm) || "Alarm"} (${phraseOf(alarm)}${alarm.enabled ? "" : ", off"})`;

type Clock = { hour: number; minute: number; meridiem: "am" | "pm" | null };

/** A clock time in the person's words ("6:30", "7 pm"), as hour, minute and whether am or pm was said. */
function clockIn(words: string): Clock | null {
  const match = words.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d:])/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, meridiem: match[3] ? (/p/i.test(match[3]) ? "pm" : "am") : null };
}

function atTime(alarm: Alarm, clock: Clock): boolean {
  const [alarmHour, alarmMinute] = alarm.time.split(":").map(Number) as [number, number];
  if (alarmMinute !== clock.minute) return false;
  if (clock.meridiem) return alarmHour === (clock.hour % 12) + (clock.meridiem === "pm" ? 12 : 0);
  return alarmHour % 12 === clock.hour % 12;
}

/** Resolves the person's words to one of their own alarm records: exact label, then a time they said, then a unique
 * fuzzy label match. With no words, the only alarm they have. */
export function resolveAlarm(actor: PersonRow, words: string): Resolution {
  const alarms = listAlarms(actor);
  const text = words.trim().toLowerCase();
  const exact = alarms.filter((alarm) => text.length > 0 && labelOf(alarm).trim().toLowerCase() === text);
  if (exact.length === 1) return { ok: true, alarm: exact[0]! };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact };
  const clock = clockIn(words);
  if (clock) {
    const timed = alarms.filter((alarm) => atTime(alarm, clock));
    if (timed.length === 1) return { ok: true, alarm: timed[0]! };
    if (timed.length > 1) return { ok: false, reason: "ambiguous", candidates: timed };
    return { ok: false, reason: "none", candidates: [] };
  }
  const query = [...tokenize(words)].filter((token) => !FILLER.has(token)).join(" ");
  if (!query) {
    if (alarms.length === 1) return { ok: true, alarm: alarms[0]! };
    return alarms.length === 0
      ? { ok: false, reason: "none", candidates: [] }
      : { ok: false, reason: "ambiguous", candidates: alarms };
  }
  const found = fuzzy(alarms, query, (alarm) => labelOf(alarm));
  if (found.ok) return { ok: true, alarm: found.value };
  if (found.reason === "none") return { ok: false, reason: "none", candidates: [] };
  const wanted = new Set(wordsOf(query));
  const best = alarms.filter((alarm) => wordsOf(labelOf(alarm)).some((word) => wanted.has(word)));
  return { ok: false, reason: "ambiguous", candidates: best.length > 1 ? best : alarms };
}

const VERB: Record<AlarmActionName, string> = {
  edit_alarm: "change",
  enable_alarm: "turn on",
  disable_alarm: "turn off",
  skip_next_alarm: "skip",
  delete_alarm: "delete",
};

function question(action: AlarmActionName, found: Extract<Resolution, { ok: false }>): AlarmActionResult {
  const verb = VERB[action];
  if (found.reason === "none") {
    return { reply: `I couldn't find an alarm matching that to ${verb}.`, action: "edit", when_text: "", done: false };
  }
  const lines = found.candidates.map(lineOf).join("\n");
  return {
    reply: `I found more than one alarm like that. Which one should I ${verb}?\n${lines}`,
    action: "edit",
    when_text: "",
    done: false,
  };
}

interface AlarmChange {
  time?: string;
  days?: number[];
  label?: string;
}

/** What an edit wants the alarm to become, from the words after "to". A time, repeat days and a name are each optional. */
function changeFrom(words: string, now: Date): AlarmChange | { error: string } {
  const text = words.trim();
  try {
    const parsed = parseAlarmRequest(text, now);
    const at = new Date(parsed.when);
    const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    return {
      time,
      ...(parsed.days.length > 0 ? { days: parsed.days } : {}),
      ...(parsed.task && parsed.task !== "Alarm" ? { label: parsed.task } : {}),
    };
  } catch (error) {
    if (!(error instanceof HostError)) throw error;
    // No time in the words: a digit means they tried to give one, so say what was not understood; otherwise it is a new name.
    if (/\d/.test(text)) return { error: error.message };
    const label = text.replace(/^(?:called|named)\s+/i, "").trim();
    return label ? { label } : { error: "What should I change it to?" };
  }
}

function splitEdit(text: string): { which: string; change: string } {
  const match = text.match(/^(.*\S)\s+(?:to|into)\s+(\S.*)$/i);
  return match ? { which: match[1]!, change: match[2]! } : { which: "", change: text };
}

/** Runs one alarm action for the actor. `text` is the person's words from the call's expression. */
export function runAlarmAction(actor: PersonRow, action: AlarmActionName, text: string, now = new Date()): AlarmActionResult {
  const edit = action === "edit_alarm" ? splitEdit(text) : null;
  const found = resolveAlarm(actor, edit ? edit.which : text);
  if (!found.ok) return question(action, found);
  const alarm = found.alarm;
  const label = labelOf(alarm) || "Alarm";
  if (action === "delete_alarm") {
    const done = deleteAlarm(actor, alarm.id);
    if (!done.ok) return { reply: "I couldn't delete that alarm.", action: "cancel", when_text: "", done: false };
    return { reply: `Alarm deleted: ${label}.`, action: "cancel", when_text: "", schedule_task: label, done: true };
  }
  if (action === "enable_alarm" || action === "disable_alarm") {
    const enabled = action === "enable_alarm";
    const done = updateAlarm(actor, alarm.id, { enabled });
    if (!done.ok) return { reply: "I couldn't update that alarm.", action: "edit", when_text: "", done: false };
    return {
      reply: `Alarm ${enabled ? "on" : "off"}: ${label} (${phraseOf(alarm)}).`,
      action: enabled ? "enable" : "disable",
      when_text: "",
      done: true,
    };
  }
  if (action === "skip_next_alarm") {
    const done = skipNext(actor, alarm.id);
    if (!done.ok) return { reply: `That alarm is off or has no next ring to skip: ${label}.`, action: "skip", when_text: "", done: false };
    return { reply: `Okay, I'll skip the next ring of ${label}.`, action: "skip", when_text: "", done: true };
  }
  const change = changeFrom(edit!.change, now);
  if ("error" in change) return { reply: change.error, action: "edit", when_text: "", done: false };
  const done = updateAlarm(actor, alarm.id, change);
  if (!done.ok) return { reply: "I couldn't change that alarm.", action: "edit", when_text: "", done: false };
  const updated = done.value;
  return {
    reply: `Okay, changed your alarm: ${labelOf(updated) || "Alarm"} (${phraseOf(updated)}).`,
    action: "edit",
    when_text: phraseOf(updated),
    schedule_task: labelOf(updated) || "Alarm",
    done: true,
  };
}
