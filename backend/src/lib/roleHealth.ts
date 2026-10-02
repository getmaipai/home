
import { getStackClient, isStackConfigured, stackRefusal } from "@/lib/stackEngine";
import type { EngineHealthEntry } from "@/wire";

export type HealthRole = "chat" | "embed" | "background" | "voice";
/** THIN-1C (fixes part of getmaipai/home#203): `detail`, present only
 * when the Stack itself refused the role (a 503 with its reason), is
 * that reason in the household's wording - the same line the chat reply
 * carries. `reason` stays the short code the consumers switch on. */
export type RoleHealth = { availability: "ready" | "starting" | "unavailable"; reason: string | null; detail?: string };
let roleHealthForTests: Partial<Record<HealthRole, RoleHealth>> = {};
export function __setRoleHealthForTests(value: Partial<Record<HealthRole, RoleHealth>>): void { roleHealthForTests = value; }

const STACK_ROLE_ID: Partial<Record<HealthRole, string>> = { embed: "embed", background: "judge", voice: "tts" };
/** The role name each Stack call site passes to stackFailureResult()
 * (llm.ts, tts.ts, stt.ts) - what a remembered refusal is keyed by,
 * which is not always the Stack's own role id above (the background
 * worker calls the "judge" role under the name "background"). */
const STACK_REFUSAL_KEY: Record<HealthRole, string> = { chat: "chat", embed: "embed", background: "background", voice: "tts" };
const STACK_IDLE_REASON = "No request through the public route in the last hour.";

export async function localRoleHealthEntry(role: HealthRole): Promise<EngineHealthEntry> {
  if (role === "chat") return { kind: "none", pid: null, alive: null };
  return { kind: "none", pid: null, alive: null };
}

/** `live: true` asks the Stack alone and ignores a remembered refusal -
 * for the turn's own precheck (turnNext.ts's beginTurn), so a person who
 * was told "try again in a moment" and does gets a real answer from the
 * Stack, never Home repeating a refusal from memory while the machine
 * may already have room. Every other reader (the health row, the status
 * page, the model node classifying a failed generation) takes the
 * default and sees the refusal. */
export async function roleHealth(role: HealthRole, opts: { live?: boolean } = {}): Promise<RoleHealth> {
  if (roleHealthForTests[role]) return roleHealthForTests[role]!;
  if (!isStackConfigured()) return { availability: "unavailable", reason: "stack_unreachable" };
  // THIN-1C: the Stack's own recent refusal of this role outranks what
  // its role list says - during #203's incident the list still showed
  // chat as installed (ready on demand) while every request was being
  // refused for lack of memory, so the health row read "ready". The
  // refusal is forgotten once the Stack serves a call again, or after
  // STACK_REFUSAL_TTL_MS (stackEngine.ts), so this never pins a role
  // offline after the machine has recovered.
  const refusal = opts.live ? null : stackRefusal(STACK_REFUSAL_KEY[role]);
  if (refusal) return { availability: "unavailable", reason: "stack_refused", detail: refusal.household };
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
  // THIN-1C: `detail` rides along only when the state carries one (a
  // remembered Stack refusal, already in household wording) - a raw
  // role-list reason ("model crashed") never reaches the wire here, the
  // same as before.
  if (state.reason === "stack_unreachable" || state.availability === "unavailable") return { ...local, kind: "failed", alive: false, availability: "unavailable", reason: "failed_start", ...(state.detail !== undefined ? { detail: state.detail } : {}) };
  if (state.availability === "starting") return { ...local, kind: "starting", alive: true, availability: "starting", reason: null };
  return { ...local, alive: true, availability: "ready", reason: null };
}
