
import { warmupInFlight } from "@/lib/stackWarmup";
import { getStackClient, isStackConfigured, stackRefusal } from "@/lib/stackEngine";
import type { EngineHealthEntry } from "@/wire";
import type { ChatRoleContext } from "@maipai/spec/stack/ts/role-context.js";

export type HealthRole = "chat" | "embed" | "background" | "voice" | MakingRole;
/** ENGINE-STATUS-MEDIA-01: picture and video making, read the same way so a control can be disabled before a person presses it. */
export type MakingRole = "image" | "video";
export const MAKING_ROLES: readonly MakingRole[] = ["image", "video"];
/** THIN-1C (fixes part of getmaipai/home#203): `detail`, present only
 * when the Stack itself refused the role (a 503 with its reason), is
 * that reason in the household's wording - the same line the chat reply
 * carries. `reason` stays the short code the consumers switch on. */
export type RoleHealth = { availability: "ready" | "starting" | "unavailable"; reason: string | null; /** CHAT-PAUSE-01: why it is unavailable, when known. */ cause?: "restarting" | "memory" | "not_installed" | "mode_change"; detail?: string; contextLength?: number; slots?: number; contextPerSlot?: number; contextScope?: "total" | "per_slot"; /** VISION-02d: the model the Stack's chat role runs (or would start). */ modelId?: string; pictureTokensMax?: number };
let roleHealthForTests: Partial<Record<HealthRole, RoleHealth>> = {};
export function __setRoleHealthForTests(value: Partial<Record<HealthRole, RoleHealth>>): void { roleHealthForTests = value; cachedHealth.clear(); }

const cachedHealth = new Map<HealthRole, { at: number; health: RoleHealth }>();
/** Read-only generation metadata. Never refreshes on the first-word path. */
export function cachedRoleHealth(role: HealthRole): RoleHealth | undefined {
  const cached = cachedHealth.get(role);
  return roleHealthForTests[role] ?? (cached && Date.now() - cached.at < 30_000 ? cached.health : undefined);
}
const STACK_ROLE_ID: Partial<Record<HealthRole, string>> = { embed: "embed", background: "judge", voice: "tts" };
/** The role name each Stack call site passes to stackFailureResult()
 * (llm.ts, tts.ts, stt.ts) - what a remembered refusal is keyed by,
 * which is not always the Stack's own role id above (the background
 * worker calls the "judge" role under the name "background"). */
export const STACK_REFUSAL_KEY: Record<HealthRole, string> = { chat: "chat", embed: "embed", background: "background", voice: "tts", image: "image", video: "video" };
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
  if (!isStackConfigured()) return { availability: "unavailable", reason: "stack_unreachable", cause: "restarting" };
  if (role === "image" || role === "video") return makingHealth(role);
  if (role === "chat") {
    try {
      const mode = await getStackClient().getCodingMode();
      if (mode.state === "switching") return { availability: "starting", reason: null, cause: "mode_change", detail: "Home is getting ready for a big job. Chat will be back in about a minute." };
    } catch { /* Older or unreachable Stack; role health below remains authoritative. */ }
  }
  // THIN-1C: the Stack's own recent refusal of this role outranks what
  // its role list says - during #203's incident the list still showed
  // chat as installed (ready on demand) while every request was being
  // refused for lack of memory, so the health row read "ready". The
  // refusal is forgotten once the Stack serves a call again, or after
  // STACK_REFUSAL_TTL_MS (stackEngine.ts), so this never pins a role
  // offline after the machine has recovered.
  const refusal = opts.live ? null : stackRefusal(STACK_REFUSAL_KEY[role]);
  if (refusal) return { availability: "unavailable", reason: "stack_refused", detail: refusal.household, ...(/memory/i.test(refusal.household) ? { cause: "memory" as const } : {}) };
  try {
    const id = STACK_ROLE_ID[role] ?? role;
    const { roles } = await getStackClient().roles();
    const row = roles.find((item) => item.id === id);
    if (!row) return { availability: "unavailable", reason: "stack_unreachable", cause: "restarting" };
    const state = row.state.state;
    const status = { ...(row.picture_tokens_max ? { pictureTokensMax: row.picture_tokens_max } : {}), ...chatContextStatus(row), ...(row.model?.id ? { modelId: row.model.id } : {}) };
    cachedHealth.set(role, { at: Date.now(), health: { availability: "ready", reason: null, ...status } });
    // The Stack says a warm-up is still running: the role reads `installed`
    // until it flips to `loaded`, but a message sent now would wait out the
    // load, so Send is held ("starting") until the warm-up finishes.
    if (role === "chat" && state === "installed" && warmupInFlight()) return { availability: "starting", reason: null, ...status };
    if (state === "ready" || state === "installed") return { availability: "ready", reason: null, ...status };
    if (state === "loaded") return { availability: row.state.reason === STACK_IDLE_REASON ? "ready" : "starting", reason: null, ...status };
    return { availability: "unavailable", reason: row.state.reason ?? row.reason ?? "failed_start", ...(row.plain_reason ? { detail: row.plain_reason } : {}), ...(state === "notInstalled" ? { cause: "not_installed" as const } : /memory/i.test(row.state.reason ?? "") ? { cause: "memory" as const } : {}) };
  } catch {
    return { availability: "unavailable", reason: "stack_unreachable", cause: "restarting" };
  }
}

/** One read of the Stack's role list, memory watchdog and mode for both making roles, shared by the image and video rows of one
 * health snapshot (the same requests the chat row already makes, plus the memory read), so a health poll costs one round. */
let makingInputs: { at: number; read: Promise<MakingInputs> } | null = null;
type MakingInputs = { roles: Awaited<ReturnType<ReturnType<typeof getStackClient>["roles"]>>["roles"] | null; paused: boolean; coding: boolean };
function readMakingInputs(): Promise<MakingInputs> {
  if (makingInputs && Date.now() - makingInputs.at < 1_000) return makingInputs.read;
  const safe = async <T,>(read: () => Promise<T>, fallback: T): Promise<T> => { try { return await read(); } catch { return fallback; } };
  const read = Promise.all([
    safe(async () => (await getStackClient().roles()).roles, null),
    safe(async () => (await getStackClient().memory?.())?.watchdog?.generation_paused === true, false),
    safe(async () => { const mode = await getStackClient().getCodingMode(); return mode.mode === "coding" || mode.state === "switching"; }, false),
  ]).then(([roles, paused, coding]) => ({ roles, paused, coding }));
  makingInputs = { at: Date.now(), read };
  return read;
}
export function __resetMakingHealthForTests(): void { makingInputs = null; }

/** ENGINE-STATUS-MEDIA-01 (RULES.md S6): whether a picture or a clip can be started now. Not installed outranks every passing
 * state; then a remembered Stack refusal (the same rule chat follows), then coding mode, then the memory watchdog pausing generation,
 * then the role's own state. A role that is installed but idle reads ready: a job waits for the engine to load. No raw Stack reason
 * reaches the row; the household line is chosen from `cause` in failureCopy.ts. */
async function makingHealth(role: MakingRole): Promise<RoleHealth> {
  const { roles, paused, coding } = await readMakingInputs();
  if (!roles) return { availability: "starting", reason: "stack_unreachable", cause: "restarting" };
  const row = roles.find((item) => item.id === role);
  if (!row || row.state.state === "notInstalled") return { availability: "unavailable", reason: "not_installed", cause: "not_installed" };
  const refusal = stackRefusal(STACK_REFUSAL_KEY[role]);
  if (refusal) return refusal.kind === "memory" ? { availability: "unavailable", reason: "stack_refused", cause: "memory" } : { availability: "starting", reason: "stack_refused", cause: "restarting" };
  if (coding) return { availability: "unavailable", reason: null, cause: "mode_change" };
  if (paused) return { availability: "unavailable", reason: null, cause: "memory" };
  if (row.state.state === "offline") return { availability: "unavailable", reason: "failed_start", ...(/memory/i.test(row.state.reason ?? "") ? { cause: "memory" as const } : {}) };
  return { availability: "ready", reason: null };
}

/** Resolve llama-server's launched context to the actual per-request window.
 * Only Stack's explicit per-slot value is used to size the turn window. */
export function chatContextStatus(row: ChatRoleContext) {
  const slots = Number.isInteger(row.slots) && row.slots! > 0 ? row.slots! : undefined;
  const perSlot = Number.isInteger(row.context_per_slot) && row.context_per_slot! > 0 ? row.context_per_slot! : undefined;
  return {
    ...(Number.isInteger(row.context_length) && row.context_length! > 0 ? { contextLength: row.context_length! } : {}),
    ...(slots ? { slots } : {}),
    ...(perSlot ? { contextPerSlot: perSlot, contextScope: "per_slot" as const } : {}),
  };
}

export const MINIMUM_CHAT_WINDOW_TOKENS = 2048;

let chatWindowContextForTests: number | undefined;
export function __setChatWindowContextForTests(value?: number): void { chatWindowContextForTests = value; }

/** STATUS-STACK-01 is the shared source for both the turn window and status view. */
export async function chatWindowContext(): Promise<{ tokens: number; slots: number | null; reported: boolean; modelId?: string }> {
  if (chatWindowContextForTests !== undefined) return { tokens: chatWindowContextForTests, slots: null, reported: true };
  const health = await roleHealth("chat", { live: true });
  const model = health.modelId ? { modelId: health.modelId } : {};
  if (health.contextPerSlot) return { tokens: health.contextPerSlot, slots: health.slots ?? null, reported: true, ...model };
  return { tokens: MINIMUM_CHAT_WINDOW_TOKENS, slots: health.slots ?? null, reported: false, ...model };
}


export function roleHealthEntry(role: HealthRole, local: EngineHealthEntry, state: RoleHealth): EngineHealthEntry {
  // THIN-1C: `detail` rides along only when the state carries one (a
  // remembered Stack refusal, already in household wording) - a raw
  // role-list reason ("model crashed") never reaches the wire here, the
  // same as before.
  if (role === "image" || role === "video") {
    // ENGINE-STATUS-MEDIA-01: a making row carries availability and cause only; its words come from failureCopy.ts's makingNotice.
    if (state.availability === "ready") return { ...local, alive: true, availability: "ready", reason: null };
    return { ...local, kind: state.availability === "starting" ? "starting" : "failed", alive: state.availability === "starting", availability: state.availability, reason: state.cause === "not_installed" ? "not_installed" : state.availability === "starting" ? null : "failed_start", ...(state.cause ? { cause: state.cause } : {}) };
  }
  const context = role === "chat" ? { context_length: state.contextLength ?? null, context_slots: state.slots ?? null, context_per_slot: state.contextPerSlot ?? null, context_scope: state.contextScope ?? null } : {};
  if (state.reason === "stack_unreachable" || state.availability === "unavailable") return { ...local, ...context, kind: "failed", alive: false, availability: "unavailable", reason: "failed_start", ...(state.detail !== undefined ? { detail: state.detail } : {}), ...(state.cause ? { cause: state.cause } : {}) };
  if (state.availability === "starting") return { ...local, ...context, kind: "starting", alive: true, availability: "starting", reason: null, ...(state.cause ? { cause: state.cause } : {}), ...(state.detail ? { detail: state.detail } : {}) };
  return { ...local, ...context, alive: true, availability: "ready", reason: null };
}
