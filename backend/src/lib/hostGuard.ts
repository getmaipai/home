import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const HostGuardStatusSchema = z.object({
  version: z.literal(1), owner: z.string(), checked_at: z.number().finite(), mode: z.enum(["off", "dry", "live"]),
  lookup: z.enum(["ok", "fail", "-", "skipped"]), spawn: z.enum(["ok", "fail", "-", "skipped"]),
  metal: z.enum(["ok", "fail", "skipped", "-"]), hard_fails: z.number().finite(), metal_fails: z.number().finite(), uptime_s: z.number().finite(), note: z.string(),
});
export type HostGuardStatus = z.infer<typeof HostGuardStatusSchema>;
export type HostGuardView = { state: "ok" | "watching" | "failing" | "stale" | "off" | "dry"; title: string; text: string; fix?: { label: string } };
let stateDirOverride: string | undefined;
export const hostGuardStateDir = () => stateDirOverride ?? process.env.MAIPAI_HOST_GUARD_STATE_DIR ?? "/var/db/maipai-host-guard";
export function __setHostGuardStateDirForTests(path: string | null): void { stateDirOverride = path ?? undefined; }

export function readHostGuardStatus(now = Date.now()): HostGuardStatus | null {
  if (process.platform !== "darwin") return null;
  try {
    const parsed = HostGuardStatusSchema.parse(JSON.parse(readFileSync(join(hostGuardStateDir(), "status.json"), "utf8")));
    if (parsed.checked_at < Math.floor(now / 1000) - 300) return null;
    return parsed;
  } catch { return null; }
}

export function hostGuardStatusFromJson(value: unknown, now = Date.now()): HostGuardStatus | null {
  const parsed = HostGuardStatusSchema.safeParse(value);
  if (!parsed.success || parsed.data.checked_at < Math.floor(now / 1000) - 300) return null;
  return parsed.data;
}

export function hostGuardView(status: HostGuardStatus | null): HostGuardView {
  const act = (live: string) => status?.mode === "dry" ? "It is only watching, so it will not restart the Mac. An admin can turn on recovery in Settings." : live;
  if (!status) return { state: "stale", title: "This Mac's self-check", text: "The self-check has not reported recently. Ask an admin to check Settings." };
  if (status.mode === "off") return { state: "off", title: "This Mac's self-check", text: "The Mac's self-check is turned off. An admin can turn it on in Settings." };
  if (status.lookup === "fail") return { state: "failing", title: "This Mac's self-check", text: "The Mac cannot look up its account. " + act("The guard will restart the Mac if this keeps happening.") };
  if (status.spawn === "fail") return { state: "failing", title: "This Mac's self-check", text: "The Mac cannot start a service for its account. " + act("The guard will restart the Mac if this keeps happening.") };
  if (status.metal === "fail") return { state: "failing", title: "This Mac's self-check", text: "The graphics compiler is not answering. " + act("The guard will restart the Mac when it is safe.") };
  if (status.mode === "dry") return { state: "dry", title: "This Mac's self-check", text: "The self-check is watching this Mac but cannot restart it. An admin can turn on recovery in Settings." };
  if (status.lookup === "-" || status.lookup === "skipped" || status.spawn === "-" || status.spawn === "skipped" || status.metal === "skipped") return { state: "watching", title: "This Mac's self-check", text: "The self-check is waiting for a probe it can run. It will check again shortly." };
  return { state: "ok", title: "This Mac's self-check", text: "The Mac's account lookup, service start and graphics check are working." };
}

export function hostGuardStatusView(status: HostGuardStatus | null, installed: boolean): HostGuardView {
  if (status) return hostGuardView(status);
  return installed
    ? { state: "stale", title: "This Mac's self-check", text: "The self-check has not reported recently. The guard will check again when it runs." }
    : { state: "off", title: "This Mac's self-check", text: "The Mac's self-check is not installed. Ask an admin to check Settings." };
}

export function hostGuardInstalled(): boolean {
  if (process.platform !== "darwin") return false;
  try { readFileSync(join(hostGuardStateDir(), "config.json"), "utf8"); return true; } catch { return false; }
}
