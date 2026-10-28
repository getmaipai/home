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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { notificationDeliveries } from "@/db/schema";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { trigger as realTrigger } from "@/lib/notifications";
import { installRoot } from "@/lib/localStackService";
import { DEFAULT_STACK_PORT } from "@/lib/ports";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { dropStackClientCache, getStackClient, getStackUrl, isStackConfigured } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import type { StackSelfHeal, StackSelfHealEvent } from "@/lib/stack/types";

export const UNREACHABLE_NOTICE_MS = 2 * 60_000;
export const UNREACHABLE_GAVE_UP_MS = 6 * 60_000;
export const HEAL_NOTICE_PER_ROLE_MS = 10 * 60_000;
export const PORT_PROBE_AFTER_MS = 60_000;
const LOCAL_PREFIX = "http://127.0.0.1:";
const ISSUE_KEY = "unreachable";
const ROLE_WORDS: Record<string, string> = { chat: "Chat", embed: "Memory search", judge: "Safety check", router: "Router", stt: "Speech to text", tts: "Voice", vision: "Picture reading", image: "Picture" };
const roleWord = (role: string): string => ROLE_WORDS[role] ?? `The ${role}`;

let unreachableSince: number | null = null;
let stage: 0 | 1 | 2 = 0;
let latest: StackSelfHeal | null = null;
const lastRoleNotice = new Map<string, number>();
let trigger: (typeId: string, vars: Record<string, string>) => Promise<void> = realTrigger;
export function __setNotifierForTests(fn: typeof trigger | null): void { trigger = fn ?? realTrigger; }

/** Which local port a MaiPai Stack answers on, or null. A Stack is told apart
 * from any other service by its /healthz body (ok plus a contract number). */
export type StackPortProbe = (port: number) => Promise<boolean>;
const realProbe: StackPortProbe = async (port) => {
  if (process.env.NODE_ENV === "test") return false;
  try {
    const res = await fetch(`${LOCAL_PREFIX}${port}/healthz`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { ok?: unknown; contract?: unknown };
    return body.ok === true && typeof body.contract === "number";
  } catch { return false; }
};
let probe: StackPortProbe = realProbe;
export function __setStackPortProbeForTests(fn: StackPortProbe | null): void { probe = fn ?? realProbe; }

function recordedStackPort(): number | null {
  try {
    const port = Number(readFileSync(join(installRoot(), "stack", ".port"), "utf8").trim());
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch { return null; }
}

function configuredLocalPort(): number | null {
  const raw = getHouseholdSettingValue("engines.stack.url");
  if (typeof raw !== "string" || !raw.trim().startsWith(LOCAL_PREFIX)) return null;
  const port = Number(new URL(raw.trim()).port);
  return Number.isInteger(port) && port > 0 ? port : null;
}

/** GUARD (2026-10-28): the installer once moved the Stack to 8771 while Home
 * still pointed at 8770, so chat was down with a healthy Stack running. When
 * Home's own local address does not answer, look for a Stack on the port the
 * installer recorded and the few above the default. Exactly one answer on a
 * different port repoints the setting; anything else is left for Repairs.
 * Never touches a remote Stack or an address the household typed in. */
async function healStackPort(): Promise<boolean> {
  if (getHouseholdSettingValue("engines.stack.where") === "another_computer") return false;
  const configured = configuredLocalPort();
  if (configured === null) return false;
  const candidates = [...new Set([recordedStackPort(), ...Array.from({ length: 11 }, (_, i) => DEFAULT_STACK_PORT + i)].filter((p): p is number => p !== null && p !== configured))];
  const answering: number[] = [];
  for (const port of candidates) if (await probe(port)) answering.push(port);
  if (answering.length !== 1) {
    if (answering.length > 1) console.error(`[self-heal] more than one Stack answers (${answering.join(", ")}); not changing engines.stack.url from port ${configured}.`);
    return false;
  }
  const url = `${LOCAL_PREFIX}${answering[0]}`;
  const result = setHouseholdSettingValue("engines.stack.url", url);
  if (!result.ok) { console.error(`[self-heal] could not repoint engines.stack.url to ${url}: ${result.error}`); return false; }
  console.error(`[self-heal] the Stack answers on port ${answering[0]}, not ${configured}; engines.stack.url repointed to ${url}.`);
  dropStackClientCache();
  await trigger("stack.restarting", { text: `The AI was running on a different port than Home expected. Home found it at ${url} and reconnected.` });
  return true;
}

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
  if (down >= PORT_PROBE_AFTER_MS && stage < 1 && (await healStackPort())) { unreachableSince = null; return; }
  const tried = getStackUrl() ?? "its saved address";
  if (down >= UNREACHABLE_NOTICE_MS && stage < 1) {
    stage = 1;
    dropStackClientCache();
    await raiseIssue({ source: "stack", key: ISSUE_KEY, severity: "warning", title: "The AI stopped and is restarting itself", detail: `The Stack has not answered at ${tried} for 2 minutes. Its service restarts it by itself; nothing is needed yet.`, notifyOnEscalation: true });
    await trigger("stack.restarting", { text: "The AI stopped and is restarting itself." });
  }
  if (down >= UNREACHABLE_GAVE_UP_MS && stage < 2) {
    stage = 2;
    dropStackClientCache();
    await raiseIssue({ source: "stack", key: ISSUE_KEY, severity: "error", title: "The AI could not restart itself: open Repairs", detail: `The Stack has not answered at ${tried} for 6 minutes, and no Stack was found on a nearby port. Restart the computer's AI service from the Engines page. If that does not help, the service may be installed but not loaded: on the computer it runs on, run the Stack's start command or restart the computer.`, notifyOnEscalation: true });
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
