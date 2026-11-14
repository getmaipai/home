
import { activeTransition, observeModeChange, transitionNotice } from "@/lib/chatTransitions";
import * as canaryResults from "@/lib/canary/results";
import { stackReducedChat } from "@/lib/reducedChat";
import { warmupInFlight } from "@/lib/stackWarmup";
import { musicEngineStatus, musicStatusReady } from "@/lib/music/ready";
import { readCapabilities } from "@/lib/memoryRoom";
import { identifyReadiness } from "@/lib/music/identify";
import { libraryFingerprintProgress } from "@/lib/music/fingerprintStore";
import { findFpcalc } from "@/lib/music/identifyAudio";
import { lastIdentifyOutcome } from "@/lib/music/identifyLast";
import { __bumpStackEpochForTests, getStackClient, isStackConfigured, stackEpoch, stackRefusal } from "@/lib/stackEngine";
import { getHomeSupervisorRoles } from "@/lib/homeSupervisorRoles";
import type { EngineHealthEntry, IdentifyHealthEntry } from "@/wire";
import type { ChatRoleContext } from "@maipai/spec/stack/ts/role-context.js";

export type HealthRole = "chat" | "embed" | "background" | "voice" | MakingRole;
/** ENGINE-STATUS-MEDIA-01: picture and video making, read the same way so a control can be disabled before a person presses it. */
/** COMPOSER-03 (ONE-COMPOSER-2026-11-13, condition 7): music and voices are read the same way, so the one composer can disable its Song and Voices modes before a press. */
export type MakingRole = "image" | "video" | "music" | "voices";
/** THIN-1C (fixes part of getmaipai/home#203): `detail`, present only
 * when the Stack itself refused the role (a 503 with its reason), is
 * that reason in the household's wording - the same line the chat reply
 * carries. `reason` stays the short code the consumers switch on. */
import { maintenanceActive } from "@/lib/maintenanceFlag";
export type RoleHealth = { availability: "ready" | "starting" | "unavailable"; reason: string | null; /** CHAT-PAUSE-01: why it is unavailable, when known. */ cause?: "restarting" | "memory" | "never_fits" | "not_installed" | "mode_change" | "reduced_swap" | "tier_reduced" | "gpu" | "upgrading"; detail?: string; contextLength?: number; slots?: number; contextPerSlot?: number; contextScope?: "total" | "per_slot"; /** VISION-02d: the model the Stack's chat role runs (or would start). */ modelId?: string; pictureTokensMax?: number };
let roleHealthForTests: Partial<Record<HealthRole, RoleHealth>> = {};
export function __setRoleHealthForTests(value: Partial<Record<HealthRole, RoleHealth>>): void { roleHealthForTests = value; cachedHealth.clear(); __bumpStackEpochForTests(); }

const cachedHealth = new Map<HealthRole, { at: number; health: RoleHealth }>();
/** Read-only generation metadata. Never refreshes on the first-word path. */
export function cachedRoleHealth(role: HealthRole): RoleHealth | undefined {
  const cached = cachedHealth.get(role);
  return roleHealthForTests[role] ?? (cached && Date.now() - cached.at < 30_000 ? cached.health : undefined);
}
/** AUDIT-PERF-01: one read of the Stack's role list and coding mode shared for 2 s by every caller (the six role rows, the call
 * check, chat-capabilities), so a health snapshot costs one `roles()` request, not four to six. A failed read is not kept. */
const SHARED_READ_MS = 2_000;
type Shared<T> = { at: number; epoch: number; read: Promise<T> };
function shared<T>(slot: Shared<T> | null, read: () => Promise<T>, set: (next: Shared<T> | null) => void): Promise<T> {
  if (slot && slot.epoch === stackEpoch() && Date.now() - slot.at < SHARED_READ_MS) return slot.read;
  const entry: Shared<T> = { at: Date.now(), epoch: stackEpoch(), read: read() };
  set(entry);
  entry.read.catch(() => { if (slotIs(entry)) set(null); });
  return entry.read;
}
let rolesSlot: Shared<Awaited<ReturnType<ReturnType<typeof getStackClient>["roles"]>>> | null = null;
let codingSlot: Shared<Awaited<ReturnType<ReturnType<typeof getStackClient>["getCodingMode"]>>> | null = null;
function slotIs(entry: Shared<unknown>): boolean { return rolesSlot === entry || codingSlot === entry; }
/** The Stack's role list, shared for 2 s. Throws as `roles()` does. */
export function sharedStackRoles() { return shared(rolesSlot, () => getStackClient().roles(), (next) => { rolesSlot = next; }); }
/** The Stack's coding mode, shared for 2 s. Throws as `getCodingMode()` does. */
export function sharedCodingMode() { return shared(codingSlot, () => getStackClient().getCodingMode(), (next) => { codingSlot = next; }); }
export function __resetSharedStackReadsForTests(): void { rolesSlot = null; codingSlot = null; }

const STACK_ROLE_ID: Partial<Record<HealthRole, string>> = { embed: "embed", background: "judge", voice: "tts", voices: "tts" };
/** The role name each Stack call site passes to stackFailureResult()
 * (llm.ts, tts.ts, stt.ts) - what a remembered refusal is keyed by,
 * which is not always the Stack's own role id above (the background
 * worker calls the "judge" role under the name "background"). */
export const STACK_REFUSAL_KEY: Record<HealthRole, string> = { chat: "chat", embed: "embed", background: "background", voice: "tts", image: "image", video: "video", music: "music", voices: "tts" };
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
/** GPU-HEALTH-01: the graphics compiler check failed twice in a row and has not passed since. Pictures and video wait on it; chat only when its own hello check
 * also fails (an engine that already compiled may keep answering while the compiler hangs). */
export function gpuCompilerFault(): boolean {
  const gpu = canaryResults.lastReal("gpu_metal");
  return gpu?.status === "fail" && canaryResults.failuresInARow("gpu_metal") >= canaryResults.RAISE_AFTER;
}
function chatBlockedByGpu(): boolean { return gpuCompilerFault() && canaryResults.lastReal("chat_hello")?.status === "fail"; }
const GPU_HEALTH: RoleHealth = { availability: "unavailable", reason: "gpu_compiler", cause: "gpu" };

/** `fresh: true` reads the Stack's role list now instead of the 2 s shared copy, keeping every other rule (a remembered
 * refusal still counts): for classifying a failure the moment after a stream dropped. */
export async function roleHealth(role: HealthRole, opts: { live?: boolean; fresh?: boolean } = {}): Promise<RoleHealth> {
  if (roleHealthForTests[role]) return roleHealthForTests[role]!;
  if (role === "chat" && chatBlockedByGpu()) return GPU_HEALTH;
  // HOST-LAUNCH-03: a fresh maintenance flag (a whole-machine development lease or an upgrade) reads as one short reason on the existing chat row.
  if (role === "chat" && maintenanceActive()) return { availability: "unavailable", reason: "maintenance", cause: "upgrading" };
  if (!isStackConfigured()) return { availability: "unavailable", reason: "stack_unreachable", cause: "restarting" };
  if (role === "image" || role === "video" || role === "music" || role === "voices") return makingHealth(role);
  // The Reduced swap is running (a no-op renewal answers in milliseconds, so only a swap that lasts shows): chat cannot answer until it ends.
  const swap = role === "chat" ? activeTransition() : null;
  if (swap && Date.now() - swap.startedAt > 1500) return { availability: "starting", reason: null, cause: "reduced_swap" };
  if (role === "chat" && await stackReducedChat()) {
    // TIER-WIRE-03: the Stack's own `reduced_chat` decides, not Home's flag. TIER-HOME-03: simpler, not unavailable. Chat answers, so this stays "ready" and never holds Send.
    return { availability: "ready", reason: null, cause: "tier_reduced" };
  }
  if (role === "chat") {
    try {
      const mode = await sharedCodingMode();
      const sinceMs = observeModeChange(mode.state === "switching");
      if (sinceMs !== null) return { availability: "starting", reason: null, cause: "mode_change", detail: transitionNotice("mode_change", sinceMs).adult };
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
    const { roles } = opts.live || opts.fresh ? await getStackClient().roles() : await sharedStackRoles();
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
    safe(async () => (await sharedStackRoles()).roles, null),
    safe(async () => (await getStackClient().memory?.())?.watchdog?.generation_paused === true, false),
    safe(async () => { const mode = await sharedCodingMode(); return mode.mode === "coding" || mode.state === "switching"; }, false),
  ]).then(([roles, paused, coding]) => ({ roles, paused, coding }));
  makingInputs = { at: Date.now(), read };
  return read;
}
export function __resetMakingHealthForTests(): void { makingInputs = null; __resetSharedStackReadsForTests(); }

/** ENGINE-STATUS-MEDIA-01 (RULES.md S6): whether a picture or a clip can be started now. Not installed outranks every passing
 * state; then a remembered Stack refusal (the same rule chat follows), then coding mode, then the memory watchdog pausing generation,
 * then the role's own state. A role that is installed but idle reads ready: a job waits for the engine to load. No raw Stack reason
 * reaches the row; the household line is chosen from `cause` in failureCopy.ts. */
async function makingHealth(role: MakingRole): Promise<RoleHealth> {
  const { roles, paused, coding } = await readMakingInputs();
  if (!roles) return { availability: "starting", reason: "stack_unreachable", cause: "restarting" };
  // Music has its own status read (lib/music/ready.ts, kept for 20 s, and a ready answer for 5 minutes after a failed read); voices is the Stack's speaking role.
  const row = role === "music" ? undefined : roles.find((item) => item.id === (role === "voices" ? "tts" : role));
  if (role === "music") {
    const status = await musicEngineStatus();
    if (status === null) return { availability: "starting", reason: "stack_unreachable", cause: "restarting" };
    if (!musicStatusReady(status)) return { availability: "unavailable", reason: "not_installed", cause: "not_installed" };
  } else if (!row || row.state.state === "notInstalled") return { availability: "unavailable", reason: "not_installed", cause: "not_installed" };
  if (role === "video") {
    const capabilities = await readCapabilities();
    const max = capabilities.rows.find((item) => item.category === "video")?.cells.find((cell) => cell.tier === "max");
    if (max?.fits === false) return { availability: "unavailable", reason: "never_fits", cause: "never_fits" };
  }
  const refusal = stackRefusal(STACK_REFUSAL_KEY[role]);
  if (refusal) return refusal.kind === "memory" ? { availability: "unavailable", reason: "stack_refused", cause: "memory" } : { availability: "starting", reason: "stack_refused", cause: "restarting" };
  const generates = role !== "voices";
  if ((role === "image" || role === "video") && gpuCompilerFault()) return GPU_HEALTH;
  if (generates && coding) return { availability: "unavailable", reason: null, cause: "mode_change" };
  if (generates && paused) return { availability: "unavailable", reason: null, cause: "memory" };
  if (row && row.state.state === "offline") return { availability: "unavailable", reason: "failed_start", ...(/memory/i.test(row.state.reason ?? "") ? { cause: "memory" as const } : {}) };
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
  if (role === "image" || role === "video" || role === "music" || role === "voices") {
    // ENGINE-STATUS-MEDIA-01: a making row carries availability and cause only; its words come from failureCopy.ts's makingNotice.
    if (state.availability === "ready") return { ...local, alive: true, availability: "ready", reason: null };
    return { ...local, kind: state.availability === "starting" ? "starting" : "failed", alive: state.availability === "starting", availability: state.availability, reason: state.cause === "not_installed" ? "not_installed" : state.availability === "starting" ? null : "failed_start", ...(state.cause ? { cause: state.cause } : {}) };
  }
  const context = role === "chat" ? { context_length: state.contextLength ?? null, context_slots: state.slots ?? null, context_per_slot: state.contextPerSlot ?? null, context_scope: state.contextScope ?? null } : {};
  if (state.reason === "stack_unreachable" || state.availability === "unavailable") return { ...local, ...context, kind: "failed", alive: false, availability: "unavailable", reason: "failed_start", ...(state.detail !== undefined ? { detail: state.detail } : {}), ...(state.cause ? { cause: state.cause } : {}) };
  if (state.availability === "starting") return { ...local, ...context, kind: "starting", alive: true, availability: "starting", reason: null, ...(state.cause ? { cause: state.cause } : {}), ...(state.detail ? { detail: state.detail } : {}) };
  return { ...local, ...context, alive: true, availability: "ready", reason: null, ...(state.cause === "tier_reduced" ? { cause: "tier_reduced" as const } : {}) };
}

/** A live voice call needs listening (`stt`) and speaking (`tts`). The same test the admin Engines overview used on the client:
 * each role is installed, loaded or ready. Served in the health snapshot so every person's chat can decide whether to show the call
 * button, without the admin-only Engines routes. A Stack that does not answer reads false. */
export async function voiceCallReady(): Promise<boolean> {
  try {
    const roles = isStackConfigured() ? (await sharedStackRoles()).roles : await getHomeSupervisorRoles();
    const usable = (id: string) => roles.some((row) => row.id === id && ["installed", "loaded", "ready"].includes(row.state.state));
    return usable("stt") && usable("tts");
  } catch {
    return false;
  }
}

/** MUSIC-ID-01: the song-naming row, read the same way as the others and served through healthSnapshot.ts. One reading of `identifyReadiness()`; no client recomputes it. */
export function identifyHealthEntry(): IdentifyHealthEntry {
  const readiness = identifyReadiness();
  const progress = libraryFingerprintProgress();
  const identifyLine = findFpcalc() && progress.done < progress.total ? `${readiness.line} Learning your music library: ${progress.done.toLocaleString("en-US")} of ${progress.total.toLocaleString("en-US")} songs.` : readiness.line;
  const ready = readiness.state === "ready";
  const last = lastIdentifyOutcome();
  let line: string | null = null;
  const sourceName = last?.matchSource === "library" ? "your library" : last?.matchSource === "shazam" ? "Shazam" : last?.matchSource === "home" ? "a song made at home" : "AcoustID";
  if (last?.status === "matched") line = `Matched a song from ${sourceName}.`;
  else if (last?.status === "no_match") line = "Heard a clip but found no match.";
  else if (last?.status === "needs_confirm") line = "Waiting for permission to search for the song.";
  else if (last?.status === "rate_limited") line = "Waited: one clip a minute per robot.";
  else if (last?.status === "bad_input") line = "The song clip could not be read.";
  else if (last?.reason === "too_big" || last?.reason === "too_long") line = "The clip was too long or too big.";
  else if (last?.status === "not_ready") line = readiness.line;
  else if (last?.status === "failed") line = last.reason === "too_long" || last.reason === "too_big" ? "The clip was too long or too big." : "Could not name the song from that clip.";
  return { kind: ready ? "none" : "failed", pid: null, alive: ready, availability: ready ? "ready" : "unavailable", reason: ready ? null : "not_installed", identify_state: readiness.state, identify_line: identifyLine, identify_last: last && line ? { at: last.at, status: last.status, line } : null };
}
