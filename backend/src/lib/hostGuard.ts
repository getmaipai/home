import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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

/** HOST-GUARD-07: the guard's memory probe (memory.json). Admin surfaces only: its summary uses memory words, which people never see. */
export const HostGuardMemorySchema = z.object({
  version: z.literal(1), checked_at: z.number().finite(), pressure: z.number().finite(), dev_shed: z.boolean(), notice: z.string(),
  summary: z.string(), last_restart_at: z.number().finite(), last_restart_result: z.string(),
});
export type HostGuardMemory = z.infer<typeof HostGuardMemorySchema>;

export function hostGuardMemoryFromJson(value: unknown, now = Date.now()): HostGuardMemory | null {
  const parsed = HostGuardMemorySchema.safeParse(value);
  if (!parsed.success || parsed.data.checked_at < Math.floor(now / 1000) - 300) return null;
  return parsed.data;
}

export function readHostGuardMemory(now = Date.now()): HostGuardMemory | null {
  if (process.platform !== "darwin") return null;
  try { return hostGuardMemoryFromJson(JSON.parse(readFileSync(join(hostGuardStateDir(), "memory.json"), "utf8")), now); } catch { return null; }
}

/** Adds the memory line to the admin status row when it matters: pressure, paused development work, or a repair in the last hour. */
export function withHostGuardMemory(view: HostGuardView, memory: HostGuardMemory | null, now = Date.now()): HostGuardView {
  if (!memory) return view;
  const recentRepair = memory.last_restart_at > 0 && memory.last_restart_at >= Math.floor(now / 1000) - 3600;
  if (memory.pressure < 2 && !memory.dev_shed && !recentRepair) return view;
  const repair = recentRepair
    ? ` The self-check restarted the Mac's file-event service ${Math.max(1, Math.round((now / 1000 - memory.last_restart_at) / 60))} min ago (${memory.last_restart_result}).`
    : "";
  return { ...view, text: `${view.text} ${memory.summary}.${repair}` };
}

export function hostGuardInstalled(): boolean {
  if (process.platform !== "darwin") return false;
  try { readFileSync(join(hostGuardStateDir(), "config.json"), "utf8"); return true; } catch { return false; }
}

/**
 * DEV-REAPER-01: the dev launcher's orphan reaper (scripts/jobs/job.ts `reap`) writes dev-reaper.json when it stops development servers
 * nobody owns any more. It rides the same admin Status row as the self-check (RULES S6: no new banner); family members never see it.
 */
export const DevReaperSchema = z.object({ version: z.literal(1), ts: z.number().finite(), waiting: z.number().finite(), stopped: z.array(z.object({ ts: z.number().finite(), worktree: z.string() })) });
export type DevReaper = z.infer<typeof DevReaperSchema>;
export const devReaperFile = () => join(process.env.MAIPAI_JOBS_DIR ?? join(homedir(), ".local", "state", "maipai", "jobs"), "dev-reaper.json");

export function readDevReaper(): DevReaper | null {
  try { return DevReaperSchema.parse(JSON.parse(readFileSync(devReaperFile(), "utf8"))); } catch { return null; }
}

/** Adds one sentence to the admin row when unused development servers were stopped in the last hour. */
export function withDevReaper(view: HostGuardView, report: DevReaper | null, now = Date.now()): HostGuardView {
  if (!report) return view;
  const recent = report.stopped.filter((s) => s.ts >= Math.floor(now / 1000) - 3600);
  if (!recent.length) return view;
  const n = recent.length;
  return { ...view, text: `${view.text} ${n} unused development ${n === 1 ? "server was" : "servers were"} stopped in the last hour to keep this Mac free for the family.` };
}
