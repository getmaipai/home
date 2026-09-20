// HOME-STACK-02b: the one setting (engines.stack.url) that decides
// whether Home's model calls go through a MaiPai Stack instead of its
// own built-in supervisors (llmSupervisor.ts, embedSupervisor.ts,
// ttsSupervisor.ts, stt.ts's in-process recognizer) - empty, the
// default, means nothing here changes. Centralizes the three things
// every rewired call site (llm.ts, tts.ts, stt.ts, routes/voice.ts's
// hf-token route) needs identically: reading the setting, one cached
// client per URL, and mapping a StackError the same way everywhere
// (never inventing a cause the Stack itself didn't state).
import { getHouseholdSettingValue } from "@/lib/settings";
import { createStackClient, type StackClient } from "@/lib/stack/client";
import { StackError, type StackErrorKind } from "@/lib/stack/errors";
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
  return getStackUrl() !== null;
}

let cachedClient: StackClient | null = null;
let cachedUrl: string | null = null;
let testClient: StackClient | null = null;

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

export function __resetStackEngineForTests(): void {
  testClient = null;
  cachedClient = null;
  cachedUrl = null;
  stackChatIdentity = null;
}

let stackChatIdentity: EngineIdentity | null = null;

/** Set after every Stack chat reply (success or a failure that still
 * carried headers) so turnEngine.ts's [turn] line and TurnStats read the
 * engine the Stack actually used, not a probe of a process Home never
 * spawned. */
export function recordStackChatIdentity(identity: EngineIdentity | null): void {
  stackChatIdentity = identity;
}

/** turnEngine.ts's one call site for "whichever chat identity is live
 * right now" - the Stack's, when configured, else llmSupervisor.ts's own
 * probe of the engine it spawned. Neither side needs to know about the
 * other. */
export function getActiveChatEngineIdentity(): EngineIdentity | null {
  if (isStackConfigured()) return stackChatIdentity;
  return getChatEngineIdentity();
}

/** The companion's own voice for the one case the brief calls out by
 * name: the Stack answering "the role is down" carries no cause worth
 * repeating to a person mid-conversation (the real offline_reason goes
 * to Repairs, below, not the chat reply) - every other StackError kind
 * keeps its own stated reason, which is real information a household
 * member or a log line can act on. */
const OFFLINE_COMPANION_LINE = "I can't think right now.";

interface StackFailureResult {
  ok: false;
  status: 503;
  code: "unavailable";
  error: string;
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
  if (err instanceof StackError) {
    if (REPAIRS_WORTHY.has(err.kind)) {
      reportStackOffline(err.offline_reason, role, err.message);
      // The companion line is chat's own voice, spoken back to whoever
      // just tried to talk to it - embed/tts/stt fail silently to a
      // person (memory, speech, an internal call), so they keep the
      // plain "unavailable" wording every other failure kind already
      // gets; the real reason still goes to Repairs either way.
      return { ok: false, status: 503, code: "unavailable", error: role === "chat" ? OFFLINE_COMPANION_LINE : `${role} model unavailable: the Stack is offline` };
    }
    resolveStackOffline(role);
    return { ok: false, status: 503, code: "unavailable", error: `${role} model unavailable: ${err.message}` };
  }
  return { ok: false, status: 503, code: "unavailable", error: `${role} model unavailable: ${(err as Error).message}` };
}

/** The same mapping for a caller (stt.ts) whose own contract throws
 * rather than returning an OpResult - still raises the identical
 * Repairs entry, then rethrows unchanged so the caller's existing
 * catch/handling is untouched. */
export function reportStackFailure(err: unknown, role: string): void {
  if (err instanceof StackError && REPAIRS_WORTHY.has(err.kind)) {
    reportStackOffline(err.offline_reason, role, err.message);
    return;
  }
  resolveStackOffline(role);
}

/** `fallback` covers "unreachable" (the socket refused - StackError
 * carries no offline_reason of its own for that kind, since nothing
 * ever answered to give one) so the Repairs entry still says something
 * real rather than the generic "did not say why". */
export function reportStackOffline(offline_reason: string | undefined, role: string, fallback?: string): void {
  void raiseIssue({
    source: ISSUE_SOURCE,
    key: `offline.${role}`,
    severity: "error",
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
  resolveIssue(ISSUE_SOURCE, `offline.${role}`);
}
