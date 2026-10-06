// HOME-STACK-02b: the one setting (engines.stack.url) that decides
// whether Home's model calls go through a MaiPai Stack instead of its
// Home's former local speech recognizer) - empty, the
// default, means nothing here changes. Centralizes the three things
// every rewired call site (llm.ts, tts.ts, stt.ts, routes/voice.ts's
// hf-token route) needs identically: reading the setting, one cached
// client per URL, and mapping a StackError the same way everywhere
// (never inventing a cause the Stack itself didn't state).
import { getHouseholdSettingValue } from "@/lib/settings";
import { createStackClient, type StackClient } from "@/lib/stack/client";
import { FAILURE_COPY, stackRefusalKind, type FailureKind } from "@/lib/failureCopy";
import { StackError, type StackErrorKind } from "@/lib/stack/errors";
import { redactCredentials } from "@/lib/memoryContentPolicy";
import { hostLabel, type EngineIdentity } from "@/lib/engineIdentity";
import { getChatEngineIdentity } from "@/lib/llmSupervisor";
import { raiseIssue, resolveIssue } from "@/lib/issues";

const ISSUE_SOURCE = "stack";

/** Empty (unset) means "no Stack configured" - the default, and the
 * state every household is in until HOME-STACK-01's installer (or a
 * hand-run Stack) sets this. A stored value that isn't even a
 * loopback-shaped URL fails safe to "not configured" too, rather than
 * letting every model call hard-fail against garbage: found live by
 * safety.test.ts's own "every real settings key, stressed to its most
 * permissive value" sweep, which sets this text key to a plain
 * non-URL string and expects chat (and crisis safety) to keep working
 * regardless - the same fail-safe posture createStackClient()'s own
 * isLoopback() guard already takes, just checked one step earlier so a
 * bad value degrades to Home's own supervisors instead of throwing out
 * of every call site that asks for a client. */
export function getStackUrl(): string | null {
  const raw = getHouseholdSettingValue("engines.stack.url");
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  // hostLabel() itself never throws (a parse failure reads as
  // "external"), so a plain non-URL string like a stress-test's
  // "stress-test-value" reads as not-loopback here, same as it would.
  return hostLabel(trimmed) === "local" ? trimmed : null;
}

export function isStackConfigured(): boolean {
  return testClient !== null || getStackUrl() !== null;
}

export type StackRole = "chat" | "embeddings" | "stt" | "tts";
export const STACK_ROLES: readonly StackRole[] = ["chat", "embeddings", "stt", "tts"];

export function isStackRoleEnabled(_role: StackRole): boolean {
  return isStackConfigured();
}

/** Kept for the additive computer-memory API; all roles belong to Stack. */
export function getHomeOwnedRoles(): StackRole[] {
  return [];
}

let cachedClient: StackClient | null = null;
let cachedUrl: string | null = null;
let testClient: StackClient | null = null;
let defaultTestClient: StackClient | null = null;

/** Lazily builds (and reuses) one client per URL - a URL change (a rare
 * admin action, never mid-turn) invalidates the cache the same way a
 * generation bump invalidates llmSupervisor.ts's own cached backend. */
export function getStackClient(): StackClient {
  if (testClient) return testClient;
  const url = getStackUrl();
  if (!url) throw new Error("no MaiPai Stack is configured (engines.stack.url is empty)");
  if (!cachedClient || cachedUrl !== url) {
    cachedClient = createStackClient({ baseUrl: url });
    cachedUrl = url;
  }
  return cachedClient;
}

/** Test-only: the scripted client every rewired module's own tests
 * inject, the same `__set*ForTests` shape llmSupervisor.ts/stt.ts
 * already use. */
export function __setStackClientForTests(client: StackClient | null): void {
  testClient = client;
  cachedClient = null;
  cachedUrl = null;
}

/** Set once by the test preload. Resetting per-test Stack observations
 * restores this client so ordinary tests continue through the shared
 * scripted Stack. Tests for an unconfigured Stack clear it explicitly. */
export function __setDefaultStackClientForTests(client: StackClient): void {
  defaultTestClient = client;
  __setStackClientForTests(client);
}

export function __hasInjectedStackClientForTests(): boolean {
  return testClient !== null;
}

export function __resetStackEngineForTests(): void {
  testClient = defaultTestClient;
  cachedClient = null;
  cachedUrl = null;
  stackChatIdentity = null;
  refusals.clear();
  downSince.clear();
}

// THIN-1C (docs/design/RULES.md rule 6; fixes part of getmaipai/home#203):
// the Stack's own reason for refusing a role - the `offline_reason` on
// its 503 body ("The current memory budget cannot admit the request...
// The chat engine waited 15 s for memory and gave up.") - used to reach
// only Repairs. The chat reply said "Sorry, I couldn't do that." and the
// health row said chat was fine, because the role list still showed the
// engine as installed and ready on demand: nothing in Home remembered
// that the Stack had just said no. This is that memory, per role: set on
// every 503 refusal, read by roleHealth() (the health row, the status
// page and the model node's outage check; the turn's own precheck asks
// the Stack live instead, so a retry is real) and by turnNext.ts's
// engine-unavailable line, cleared by the next call the Stack serves
// (resolveStackOffline) or by age. The age limit is what keeps the
// health row honest: a refusal older than this is forgotten, so a
// machine that freed its memory is never shown offline for longer than
// this. 30 s is twice the wait the Stack itself gives the engine before
// refusing (the body above: 15 s).
export const STACK_REFUSAL_TTL_MS = 30_000;

export interface StackRefusal {
  /** The Stack's own words, as its 503 body stated them (Repairs shows
   * these); undefined when the body carried no offline_reason. */
  offline_reason: string | undefined;
  /** CHAT-CALM-ERRORS-01b: the role state the body stated, and the kind
   * Home reads from it (failureCopy.ts's stackRefusalKind). */
  state: string | undefined;
  kind: FailureKind;
  /** The same reason in the household's wording - the one line the
   * chat reply and the health row both carry. */
  household: string;
  /** The raw facts of the refusal, for an admin's details only. */
  facts: StackFailureFacts;
  at: number;
}

const refusals = new Map<string, StackRefusal>();

/** The household's wording for a refusal, decided from the Stack's own
 * stated state and reason - never a cause the Stack did not give. One
 * fixed line per kind (failureCopy.ts): a stopped engine says so, the
 * memory refusal #203 reports says the computer is low on memory, an
 * engine still loading says to give it a moment. The check reads the
 * engine's own diagnostic, never a household member's words (the same
 * footing nodes/model.ts's "could not reach" check already stands on). */
export function householdStackRefusalLine(offline_reason: string | undefined, state?: string): string {
  return FAILURE_COPY[stackRefusalKind(state, offline_reason)].adult;
}

/** CHAT-CALM-ERRORS-01b (design section 10): the raw facts of a failed
 * Stack call, kept beside the household line for an admin. Never shown to
 * anyone else (turnErrorDetail.ts strips them) and never in a message the
 * model reads. */
export interface StackFailureFacts {
  /** The Stack's own `error` (or the client's message when nothing answered). */
  stack_error: string;
  http_status?: number;
  state?: string;
  offline_reason?: string;
  /** The response text, credentials redacted, at most RAW_BODY_MAX characters, as-is when it is not JSON. */
  raw_body?: string;
  engine_id?: string;
  model_id?: string;
}

export const RAW_BODY_MAX = 2_000;

/** A body or message trimmed and redacted for an admin's eyes (C8). */
export function boundedRawBody(text: string): string {
  return redactCredentials(text).slice(0, RAW_BODY_MAX);
}

export function stackFailureFacts(err: unknown): StackFailureFacts {
  if (err instanceof StackError) {
    return {
      stack_error: boundedRawBody(err.message),
      ...(err.status !== undefined ? { http_status: err.status } : {}),
      ...(err.state ? { state: err.state } : {}),
      ...(err.offline_reason ? { offline_reason: boundedRawBody(err.offline_reason) } : {}),
      ...(err.body ? { raw_body: boundedRawBody(err.body) } : {}),
      ...(err.engine ? { engine_id: err.engine } : {}),
      ...(err.model ? { model_id: err.model } : {}),
    };
  }
  return { stack_error: boundedRawBody(err instanceof Error ? err.message : String(err)) };
}

/** A refusal names no engine (the Stack's 503 sends "none" for both
 * identity headers), so a chat failure names the engine and model that
 * last answered chat, when one has (recordStackChatIdentity()). */
function withLastChatIdentity(facts: StackFailureFacts): StackFailureFacts {
  const last = stackChatIdentity;
  if (!last) return facts;
  return {
    ...facts,
    ...(!facts.engine_id && last.build ? { engine_id: `${last.host} ${last.build}` } : {}),
    ...(!facts.model_id && last.model ? { model_id: last.model } : {}),
  };
}

function rememberStackRefusal(role: string, err: StackError): void {
  const kind = stackRefusalKind(err.state, err.offline_reason);
  const facts = role === "chat" ? withLastChatIdentity(stackFailureFacts(err)) : stackFailureFacts(err);
  refusals.set(role, { offline_reason: err.offline_reason, state: err.state, kind, household: FAILURE_COPY[kind].adult, facts, at: Date.now() });
}

/** The Stack's most recent refusal of this role, if it is younger than
 * STACK_REFUSAL_TTL_MS and no call has been served since; null
 * otherwise. Keyed by the role name the Stack call sites use ("chat",
 * "embed", "background", "tts", "stt"). */
export function stackRefusal(role: string, now = Date.now()): StackRefusal | null {
  const refusal = refusals.get(role);
  if (!refusal) return null;
  if (now - refusal.at > STACK_REFUSAL_TTL_MS) {
    refusals.delete(role);
    return null;
  }
  return refusal;
}

let stackChatIdentity: EngineIdentity | null = null;

/** Set after every Stack chat reply (success or a failure that still
 * carried headers) so the retired turn engine's [turn] line and TurnStats read the
 * engine the Stack actually used, not a probe of a process Home never
 * spawned. */
export function recordStackChatIdentity(identity: EngineIdentity | null): void {
  stackChatIdentity = identity;
}

/** the retired turn engine's one call site for "whichever chat identity is live
 * right now" - the Stack's, when configured, else llmSupervisor.ts's own
 * probe of the engine it spawned. Neither side needs to know about the
 * other. */
export function getActiveChatEngineIdentity(): EngineIdentity | null {
  if (isStackRoleEnabled("chat")) return stackChatIdentity;
  return getChatEngineIdentity();
}

/** The companion's own voice for the one case the brief calls out by
 * name: the Stack answering "the role is down" carries no cause worth
 * repeating to a person mid-conversation (the real offline_reason goes
 * to Repairs, below, not the chat reply) - every other StackError kind
 * keeps its own stated reason, which is real information a household
 * member or a log line can act on. */
export const OFFLINE_COMPANION_LINE = "I can't think right now.";

export interface StackFailureResult {
  ok: false;
  status: 503;
  code: "unavailable";
  error: string;
  /** CHAT-CALM-ERRORS-01b: the raw facts beside the person's line, for the generation record. */
  facts?: StackFailureFacts;
}

/** A code review caught this only covering "offline" (a scripted 503):
 * "unreachable" (errors.ts's own comment - "the socket refused: the
 * Stack is not running") is the SAME real-world condition a household
 * would want a Repairs entry for, arguably the more common one (the
 * whole Stack down, not just one role reporting itself offline) - it
 * just carries no offline_reason of its own since nothing answered to
 * give one. */
const REPAIRS_WORTHY: ReadonlySet<StackErrorKind> = new Set(["offline", "unreachable"]);

/** One mapping, reused by llm.ts (chat, judge, embed), tts.ts and
 * stt.ts: "the Stack didn't answer" (a scripted 503, or the socket
 * refusing entirely) raises (or refreshes) a Repairs entry and answers
 * with the companion line below; 409/400/499/504/unexpected all keep
 * the Stack's own stated message, folded into the one
 * 503/"unavailable" shape every caller here already returns for "the
 * model didn't answer" - Home never invents a different cause than the
 * one the Stack gave. */
export function stackFailureResult(err: unknown, role: string): StackFailureResult {
  const facts = role === "chat" ? withLastChatIdentity(stackFailureFacts(err)) : stackFailureFacts(err);
  if (err instanceof StackError) {
    if (REPAIRS_WORTHY.has(err.kind)) {
      // THIN-1C: a 503 is the Stack itself saying no, with its reason;
      // remembered so the health row and the chat reply can carry it.
      // "unreachable" is not remembered: nothing answered, and
      // roleHealth() already reads that case live from the socket.
      if (err.kind === "offline") rememberStackRefusal(role, err);
      reportStackOffline(err.offline_reason, role, err.message, err.kind === "offline" ? err.state : undefined);
      // The companion line is chat's own voice, spoken back to whoever
      // just tried to talk to it - embed/tts/stt fail silently to a
      // person (memory, speech, an internal call), so they keep the
      // plain "unavailable" wording every other failure kind already
      // gets; the real reason still goes to Repairs either way.
      return { ok: false, status: 503, code: "unavailable", error: role === "chat" ? OFFLINE_COMPANION_LINE : `${role} model unavailable: the Stack is offline`, facts };
    }
    resolveStackOffline(role);
    const detail = role === "chat" && err.body ? ` (${boundedRawBody(err.body)})` : "";
    return { ok: false, status: 503, code: "unavailable", error: `${role} model unavailable: ${err.message}${detail}`, facts };
  }
  return { ok: false, status: 503, code: "unavailable", error: `${role} model unavailable: ${(err as Error).message}`, facts };
}

/** The same mapping for a caller (stt.ts) whose own contract throws
 * rather than returning an OpResult - still raises the identical
 * Repairs entry, then rethrows unchanged so the caller's existing
 * catch/handling is untouched. */
export function reportStackFailure(err: unknown, role: string): void {
  if (err instanceof StackError && REPAIRS_WORTHY.has(err.kind)) {
    if (err.kind === "offline") rememberStackRefusal(role, err);
    reportStackOffline(err.offline_reason, role, err.message, err.kind === "offline" ? err.state : undefined);
    return;
  }
  resolveStackOffline(role);
}

/** `fallback` covers "unreachable" (the socket refused - StackError
 * carries no offline_reason of its own for that kind, since nothing
 * ever answered to give one) so the Repairs entry still says something
 * real rather than the generic "did not say why".
 *
 * CHAT-CALM-ERRORS-01b (design section 6): a role the Stack reports as
 * stopped (`installed`) or still loading (`loaded`) is recoverable, so the
 * entry is a warning; it becomes an error once the role has stayed down
 * past STACK_RECOVERY_WINDOW_MS, and at once for any other state or for
 * a Stack that did not answer at all. */
export const STACK_RECOVERY_WINDOW_MS = 2 * 60_000;
const RECOVERABLE_STATES: ReadonlySet<string> = new Set(["installed", "loaded"]);
const downSince = new Map<string, number>();

export function reportStackOffline(offline_reason: string | undefined, role: string, fallback?: string, state?: string, now = Date.now()): void {
  const since = downSince.get(role) ?? now;
  downSince.set(role, since);
  const recoverable = state !== undefined && RECOVERABLE_STATES.has(state) && now - since < STACK_RECOVERY_WINDOW_MS;
  void raiseIssue({
    source: ISSUE_SOURCE,
    key: `offline.${role}`,
    severity: recoverable ? "warning" : "error",
    title: "MaiPai Stack is offline",
    detail: offline_reason ?? fallback ?? "the Stack did not say why",
  });
}

/** Called on every non-offline outcome (a real success, or a failure of
 * a different kind) - the same "a fresh success clears a prior fault"
 * posture llmSupervisor.ts's own resolveIssue("chat-engine", "spawn")
 * call already takes, scoped per role so one role's outage never masks
 * or clears another's. */
export function resolveStackOffline(role: string): void {
  refusals.delete(role);
  downSince.delete(role);
  resolveIssue(ISSUE_SOURCE, `offline.${role}`);
}
