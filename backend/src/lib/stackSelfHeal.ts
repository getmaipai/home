// ROBUST-01 (Home half). The Stack restarts an engine that stops on its
// own (stack/backend/src/lib/selfHeal.ts). This watcher is how the
// household finds out, through mechanisms that already exist and no new
// banner:
//  - "The AI stopped and is restarting itself" (one admin Notification, a
//    warning in Repairs) when the Stack has not answered for 2 minutes;
//    "The AI could not restart itself: open Repairs" (the same Repairs
//    item turned into an error, which notifies the admins once) when it
//    is still gone after 6. Home cannot restart launchd safely, so the
//    one safe thing it owns is dropping its cached connection so a dead
//    keep-alive is never reused; the LaunchAgent restarts the Stack.
//  - one admin Notification when the Stack restarted an engine ("Chat
//    engine crashed and was restarted at 14:48; it was back in 12
//    seconds"), once per incident and once per engine per 10 minutes.
//  - crash counts per day for the Status page (engineCrashSummary).
// Engines the Stack gave up on already appear as the Stack's own Repairs
// item (stackHealthSync.ts) with the Restart engine fix and the log lines.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveries } from "@/db/schema";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { trigger as realTrigger } from "@/lib/notifications";
import { dropStackClientCache, getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import type { StackSelfHeal, StackSelfHealEvent } from "@/lib/stack/types";

export const UNREACHABLE_NOTICE_MS = 2 * 60_000;
export const UNREACHABLE_GAVE_UP_MS = 6 * 60_000;
export const HEAL_NOTICE_PER_ROLE_MS = 10 * 60_000;
const ISSUE_KEY = "unreachable";
const ROLE_WORDS: Record<string, string> = { chat: "Chat", embed: "Memory search", judge: "Safety check", router: "Router", stt: "Speech to text", tts: "Voice", vision: "Picture reading", image: "Picture" };
const roleWord = (role: string): string => ROLE_WORDS[role] ?? `The ${role}`;

let unreachableSince: number | null = null;
let stage: 0 | 1 | 2 = 0;
let latest: StackSelfHeal | null = null;
const lastRoleNotice = new Map<string, number>();
let trigger: (typeId: string, vars: Record<string, string>) => Promise<void> = realTrigger;
export function __setNotifierForTests(fn: typeof trigger | null): void { trigger = fn ?? realTrigger; }

function clock(at: string): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function healNoticeText(event: StackSelfHealEvent): string {
  const took = event.seconds === undefined ? "" : event.seconds >= 90 ? `${Math.round(event.seconds / 60)} minutes` : `${event.seconds} seconds`;
  return `${roleWord(event.role)} engine crashed and was restarted at ${clock(event.crashedAt ?? event.at)}${took ? `; it was back in ${took}` : ""}.`;
}

function alreadyNotified(text: string): boolean {
  return db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).where(and(eq(notificationDeliveries.typeId, "stack.engine_healed"), eq(notificationDeliveries.text, text))).limit(1).all().length > 0;
}

async function noticeHeals(events: StackSelfHealEvent[], now: number): Promise<void> {
  for (const event of events) {
    if (event.kind !== "healed") continue;
    // Only recent news: a Home that was off for a day does not replay it.
    if (now - Date.parse(event.at) > 60 * 60_000) continue;
    const text = healNoticeText(event);
    if (alreadyNotified(text)) continue;
    const last = lastRoleNotice.get(event.role);
    // A flapping engine is one notice, not five; the Status page still counts each.
    if (last !== undefined && now - last < HEAL_NOTICE_PER_ROLE_MS) continue;
    lastRoleNotice.set(event.role, now);
    await trigger("stack.engine_healed", { text });
  }
}

async function noticeUnreachable(now: number): Promise<void> {
  if (unreachableSince === null) return;
  const down = now - unreachableSince;
  if (down >= UNREACHABLE_NOTICE_MS && stage < 1) {
    stage = 1;
    dropStackClientCache();
    await raiseIssue({ source: "stack", key: ISSUE_KEY, severity: "warning", title: "The AI stopped and is restarting itself", detail: "The Stack has not answered for 2 minutes. Its service restarts it by itself; nothing is needed yet.", notifyOnEscalation: true });
    await trigger("stack.restarting", { text: "The AI stopped and is restarting itself." });
  }
  if (down >= UNREACHABLE_GAVE_UP_MS && stage < 2) {
    stage = 2;
    dropStackClientCache();
    await raiseIssue({ source: "stack", key: ISSUE_KEY, severity: "error", title: "The AI could not restart itself: open Repairs", detail: "The Stack has not answered for 6 minutes. Restart the computer's AI service from the Engines page, or restart the computer it runs on.", notifyOnEscalation: true });
  }
}

/** One look at the Stack: reachability, then the self-heal record. */
export async function pollStackSelfHeal(now = Date.now()): Promise<void> {
  if (!isStackConfigured()) return;
  let client;
  try { client = getStackClient(); } catch { client = null; }
  let reachable = false;
  if (client) {
    try { await client.health(); reachable = true; } catch (error) { reachable = error instanceof StackError && error.kind !== "unreachable" && error.kind !== "timeout"; }
  }
  if (!reachable) {
    unreachableSince ??= now;
    await noticeUnreachable(now);
    return;
  }
  if (unreachableSince !== null) {
    unreachableSince = null;
    if (stage > 0) resolveIssue("stack", ISSUE_KEY);
    stage = 0;
  }
  if (!client?.selfHeal) return;
  try {
    latest = await client.selfHeal();
    await noticeHeals(latest.events, now);
  } catch (error) {
    // An older Stack without the route: nothing to report.
    if (!(error instanceof StackError)) console.error(`[self-heal] ${(error as Error).message}`);
  }
}

/** Crashes since local midnight, and per day, for the Status page. */
export function engineCrashSummary(now = new Date()): { count: number; healed: number; gave_up: number; line: string; days: Array<{ day: string; crashes: number; healed: number; gave_up: number }> } {
  const days = (latest?.crashesByDay ?? []).map((d) => ({ day: d.day, crashes: d.crashes, healed: d.healed, gave_up: d.gaveUp }));
  const today = days.find((d) => d.day === now.toISOString().slice(0, 10));
  const count = today?.crashes ?? 0;
  const healed = today?.healed ?? 0;
  const gave = today?.gave_up ?? 0;
  const line = count === 0 ? "No engine has crashed today." : `${count === 1 ? "An engine crashed once" : `Engines crashed ${count} times`} today; the Stack restarted ${healed === count ? (count === 1 ? "it" : "all of them") : `${healed} of them`}${gave > 0 ? ` and gave up on ${gave}` : ""}.`;
  return { count, healed, gave_up: gave, line, days };
}

export function startStackSelfHealWatch(intervalMs = 30_000): () => void {
  const timer = setInterval(() => { void pollStackSelfHeal().catch((error: Error) => console.error(`[self-heal] ${error.message}`)); }, intervalMs);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

export function __resetStackSelfHealForTests(): void { unreachableSince = null; stage = 0; latest = null; lastRoleNotice.clear(); }
