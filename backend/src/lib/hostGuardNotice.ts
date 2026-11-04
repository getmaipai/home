import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { trigger as realTrigger } from "@/lib/notifications";
import { hostGuardStateDir } from "@/lib/hostGuard";

const MARKER_KEY = "__host_guard.last_notified_reboot";
let trigger = realTrigger;
export function __setHostGuardNotifierForTests(value: typeof trigger | null): void { trigger = value ?? realTrigger; }
export function __resetHostGuardNoticeForTests(): void { trigger = realTrigger; }

export function notifyHostGuardRestart(): void {
  if (process.platform !== "darwin") return;
  let record: string;
  try { record = readFileSync(join(hostGuardStateDir(), "last-reboot.txt"), "utf8").trim(); } catch { return; }
  if (!record) return;
  const timestamp = record.split("\n", 1)[0]!.split(/\s+/).slice(0, 2).join(" ");
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(timestamp);
  if (!match) return;
  const prior = db.select({ value: settingsValues.value }).from(settingsValues).where(and(eq(settingsValues.scope, "system"), eq(settingsValues.key, MARKER_KEY))).get()?.value;
  if (prior === JSON.stringify(timestamp)) return;
  const text = "The Mac restarted itself because the system stopped answering. You do not need to do anything. Open Status for details.";
  trackBackgroundWork(trigger("host-guard-restarted", { text }).then(() => {
    const values = { value: JSON.stringify(timestamp), hlc: nextHlc(), source: "system", setBy: null, updatedAt: new Date().toISOString() };
    db.insert(settingsValues).values({ scope: "system", key: MARKER_KEY, ...values }).onConflictDoUpdate({ target: [settingsValues.scope, settingsValues.key], set: values }).run();
  }).catch((error) => console.error(`[host-guard] restart notice failed: ${(error as Error).message}`)));
}
