
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { EngineHealthEntry } from "@/wire";

export type HealthRole = "chat" | "embed" | "background" | "voice";
export type RoleHealth = { availability: "ready" | "starting" | "unavailable"; reason: string | null };
let roleHealthForTests: Partial<Record<HealthRole, RoleHealth>> = {};
export function __setRoleHealthForTests(value: Partial<Record<HealthRole, RoleHealth>>): void { roleHealthForTests = value; }

const STACK_ROLE_ID: Partial<Record<HealthRole, string>> = { embed: "embed", background: "judge", voice: "tts" };
const STACK_IDLE_REASON = "No request through the public route in the last hour.";

export async function localRoleHealthEntry(role: HealthRole): Promise<EngineHealthEntry> {
  if (role === "chat") return { kind: "none", pid: null, alive: null };
  return { kind: "none", pid: null, alive: null };
}

export async function roleHealth(role: HealthRole): Promise<RoleHealth> {
  if (roleHealthForTests[role]) return roleHealthForTests[role]!;
  if (!isStackConfigured()) return { availability: "unavailable", reason: "stack_unreachable" };
  try {
    const id = STACK_ROLE_ID[role] ?? role;
    const { roles } = await getStackClient().roles();
    const row = roles.find((item) => item.id === id);
    if (!row) return { availability: "unavailable", reason: "stack_unreachable" };
    const state = row.state.state;
    if (state === "ready" || state === "installed") return { availability: "ready", reason: null };
    if (state === "loaded") return row.state.reason === STACK_IDLE_REASON ? { availability: "ready", reason: null } : { availability: "starting", reason: null };
    return { availability: "unavailable", reason: row.state.reason ?? row.reason ?? "failed_start" };
  } catch {
    return { availability: "unavailable", reason: "stack_unreachable" };
  }
}

export function roleHealthEntry(role: HealthRole, local: EngineHealthEntry, state: RoleHealth): EngineHealthEntry {

  if (state.reason === "stack_unreachable" || state.availability === "unavailable") return { ...local, kind: "failed", alive: false, availability: "unavailable", reason: "failed_start" };
  if (state.availability === "starting") return { ...local, kind: "starting", alive: true, availability: "starting", reason: null };
  return { ...local, alive: true, availability: "ready", reason: null };
}
