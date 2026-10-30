// What the `alarm` package does when a person says "wake me at 6:30", "cancel my alarm" or "what alarms do I have".
// A repeating alarm ("on weekdays") becomes an alarm record, the same row the Clock app edits. A one-time alarm stays a
// plain scheduled job, as before. List and cancel see both.
import { createAlarm, deleteAlarm, listAlarms } from "@/lib/alarms";
import { parseAlarmRequest } from "@/lib/reminderParsing";
import { cancelJob, listJobs, scheduleCoreJob } from "@/lib/scheduler";
import type { PersonRow } from "@/types";

export interface AlarmChatResult {
  task: string;
  schedule_task?: string;
  when_text: string;
  action: string;
}

type Mapped = { kind: "record" | "job"; id: string; label: string; minutes: number | null; line: string };

const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function daysPhrase(days: number[]): string {
  if (days.length === 7) return "every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return "weekdays";
  if (days.length === 2 && days.includes(6) && days.includes(7)) return "weekends";
  return days.map((day) => DAY_SHORT[day]).join(", ");
}

function clockText(time: string): string {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

function whenText(date: Date): string {
  return date.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}

function jobLabel(inputs: string): string {
  try {
    const task = (JSON.parse(inputs) as { task?: unknown }).task;
    return typeof task === "string" ? task : "";
  } catch {
    return "";
  }
}

function pendingAlarms(actor: PersonRow): Mapped[] {
  const records: Mapped[] = listAlarms(actor).map((alarm) => ({
    kind: "record",
    id: alarm.id,
    label: alarm.label || alarm.tag,
    minutes: Number(alarm.time.slice(0, 2)) * 60 + Number(alarm.time.slice(3)),
    line: `Alarm: ${alarm.label || alarm.tag || "Alarm"} (${alarm.days.length ? daysPhrase(alarm.days) : "once"} at ${clockText(alarm.time)}${alarm.enabled ? "" : ", off"})`,
  }));
  const jobs: Mapped[] = listJobs(actor)
    .filter((row) => row.personId === actor.id && row.kind === "core" && row.status === "pending")
    .filter((row) => row.job === "reminders.fire" || (row.job === "alarms.fire" && !jobHasRecord(row.inputs)))
    .map((row) => {
      const when = new Date(row.nextRunAt);
      return {
        kind: "job" as const,
        id: row.id,
        label: jobLabel(row.inputs),
        minutes: when.getHours() * 60 + when.getMinutes(),
        line: `${row.job === "alarms.fire" ? "Alarm" : "Reminder"}: ${jobLabel(row.inputs)} (${whenText(when)})`,
      };
    });
  return [...records, ...jobs];
}

function jobHasRecord(inputs: string): boolean {
  try {
    return typeof (JSON.parse(inputs) as { alarmId?: unknown }).alarmId === "string";
  } catch {
    return false;
  }
}

/** "6:30", "6 pm", "6:30 am" in a cancel request, as minutes after midnight, or null. */
function clockMinutes(query: string): number | null {
  const match = query.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (match[3]) hour = (hour % 12) + (/p/i.test(match[3]) ? 12 : 0);
  return hour * 60 + minute;
}

function listAlarmsAnswer(actor: PersonRow): AlarmChatResult {
  const entries = pendingAlarms(actor);
  return {
    task: entries.length ? entries.map((entry) => entry.line).join("\n") : "You have no pending alarms or reminders.",
    when_text: "",
    action: "list",
  };
}

function cancelAlarmAnswer(actor: PersonRow, query: string): AlarmChatResult {
  const wanted = query.toLocaleLowerCase();
  const minutes = clockMinutes(query);
  const matches = pendingAlarms(actor).filter((entry) => {
    if (wanted.length > 0 && entry.label.toLocaleLowerCase().includes(wanted)) return true;
    return minutes !== null && entry.minutes === minutes;
  });
  if (matches.length === 0) return { task: "There is nothing matching that to cancel.", when_text: "", action: "cancel" };
  if (matches.length > 1) {
    return { task: `I found more than one match. Which one should I cancel?\n${matches.map((entry) => entry.line).join("\n")}`, when_text: "", action: "cancel" };
  }
  const target = matches[0]!;
  const done = target.kind === "record" ? deleteAlarm(actor, target.id) : cancelJob(actor, target.id);
  if (!done.ok) return { task: "There is nothing matching that to cancel.", when_text: "", action: "cancel" };
  const noun = target.line.startsWith("Reminder") ? "Reminder" : "Alarm";
  return { task: `${noun} cancelled: ${target.label || "Alarm"}.`, when_text: "", action: "cancel" };
}

function setAlarmAnswer(actor: PersonRow, request: string): AlarmChatResult {
  const parsed = parseAlarmRequest(request);
  if (parsed.days.length > 0) {
    const at = new Date(parsed.when);
    const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    const label = parsed.task === "Alarm" ? "" : parsed.task;
    const made = createAlarm(actor, { time, days: parsed.days, label });
    if (!made.ok) return { task: "I couldn't set that alarm. Please try again.", when_text: "", action: "set" };
    const when = `${daysPhrase(parsed.days)} at ${clockText(time)}`;
    return { task: `Okay, alarm set: ${parsed.task} (${when}).`, schedule_task: parsed.task, when_text: when, action: "set" };
  }
  const scheduled = scheduleCoreJob(actor, "alarms.fire", parsed.when, { task: parsed.task });
  if (!scheduled.ok) return { task: "I couldn't set that alarm. Please try again.", when_text: "", action: "set" };
  return { task: `Okay, alarm set: ${parsed.task} (${parsed.when_text}).`, schedule_task: parsed.task, when_text: parsed.when_text, action: "set" };
}

export function handleAlarmChat(actor: PersonRow, text: string): AlarmChatResult {
  const parsedAction = text.match(/^(set|cancel|list)\s*(.*)$/i);
  const action = parsedAction?.[1]?.toLowerCase() ?? "set";
  const rest = (parsedAction?.[2] ?? text).trim();
  if (action === "list") return listAlarmsAnswer(actor);
  if (action === "cancel") return cancelAlarmAnswer(actor, rest.replace(/^(to|about)\s+/i, ""));
  return setAlarmAnswer(actor, rest);
}
