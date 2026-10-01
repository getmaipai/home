import { probeBackgroundEngine } from "@/lib/backgroundSupervisor";
import { probeEmbedEngine } from "@/lib/embedSupervisor";
import { chatAvailabilityState, probeChatEngine } from "@/lib/llmSupervisor";
import { getTtsBackendKind, probeTtsEngine } from "@/lib/ttsSupervisor";
import { getStackClient, isStackRoleEnabled, type StackRole } from "@/lib/stackEngine";
import type { EngineHealthEntry } from "@/wire";

export type HealthRole = "chat" | "embed" | "background" | "voice";
export type RoleHealth = { availability: "ready" | "starting" | "unavailable"; reason: string | null };
let roleHealthForTests: Partial<Record<HealthRole, RoleHealth>> = {};
export function __setRoleHealthForTests(value: Partial<Record<HealthRole, RoleHealth>>): void { roleHealthForTests = value; }

const stackRole: Partial<Record<HealthRole, StackRole>> = {
  chat: "chat", embed: "embeddings", voice: "tts",
};
const STACK_IDLE_REASON = "No request through the public route in the last hour.";

export async function localRoleHealthEntry(role: HealthRole): Promise<EngineHealthEntry> {
  if (role === "chat") return await probeChatEngine();
  if (role === "embed") return await probeEmbedEngine();
  if (role === "background") return await probeBackgroundEngine();
  return { kind: getTtsBackendKind(), pid: null, alive: null };
}

/** The single source for per-role runtime health. Stack-owned roles use
 * the Stack's role list; other roles use Home's supervisors. */
export async function roleHealth(role: HealthRole): Promise<RoleHealth> {
  if (roleHealthForTests[role]) return roleHealthForTests[role]!;
  const routed = stackRole[role];
  if (routed && isStackRoleEnabled(routed)) {
    try {
      const { roles } = await getStackClient().roles();
      const row = roles.find((item) => item.id === (routed === "embeddings" ? "embed" : routed));
      if (!row) return { availability: "unavailable", reason: "stack_unreachable" };
      const state = row.state.state;
      // Stack's installed state is a selected, available role with no live
      // process. JIT/resident roles start on their next real request, so
      // this is idle-by-design rather than a status-page degradation.
      if (state === "ready" || state === "installed") return { availability: "ready", reason: null };
      if (state === "loaded") {
        // Stack also uses loaded when a ready role has simply had no public
        // request in an hour. Only a loaded state without this idle reason
        // represents an active load that has not become ready yet.
        if (row.state.reason === STACK_IDLE_REASON) return { availability: "ready", reason: null };
        return { availability: "starting", reason: null };
      }
      return { availability: "unavailable", reason: row.state.reason ?? row.reason ?? "failed_start" };
    } catch {
      return { availability: "unavailable", reason: "stack_unreachable" };
    }
  }
  if (role === "chat" && process.env.MAIPAI_LLAMA_SERVER_URL) return chatAvailabilityState();
  const engine = role === "chat" ? await probeChatEngine() : role === "embed" ? await probeEmbedEngine() : role === "background" ? await probeBackgroundEngine() : await probeTtsEngine();
  if (engine.availability === "unavailable") return { availability: "unavailable", reason: engine.reason ?? "failed_start" };
  if (engine.kind === "starting" || engine.kind === "restarting") return { availability: "starting", reason: null };
  if (["blocked", "failed", "stalled", "stopped"].includes(engine.kind) || (["url", "override", "selection", "spawned"].includes(engine.kind) && engine.alive === false))
    return { availability: "unavailable", reason: "failed_start" };
  return { availability: "ready", reason: null };
}

export function roleHealthEntry(role: HealthRole, local: EngineHealthEntry, state: RoleHealth): EngineHealthEntry {
  const routed = stackRole[role];
  const stackOwned = routed !== undefined && isStackRoleEnabled(routed);
  if (!stackOwned) return { ...local, availability: state.availability, reason: state.reason as EngineHealthEntry["reason"] };
  if (state.reason === "stack_unreachable") return { ...local, kind: "failed", alive: false, availability: "unavailable", reason: "failed_start" };
  if (state.availability === "unavailable") return { ...local, kind: "failed", alive: false, availability: "unavailable", reason: "failed_start" };
  if (state.availability === "starting") return { ...local, kind: "starting", alive: true, availability: "starting", reason: null };
  return { ...local, alive: true, availability: "ready", reason: null };
}
