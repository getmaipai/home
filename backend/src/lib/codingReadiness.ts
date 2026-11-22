// CODE-FIX-02: whether a Code turn can run right now, as one reason code and one plain sentence with the next step. It is the existing ready check (lib/codeReady.ts:
// settings, engine, coding model, work folder, sandbox system, the sandbox exec and snapshot routes, the gateway) plus the coding concern's live state (lib/roleHealth.ts,
// worded by lib/failureCopy.ts `codingNotice`), so there is no second health system. Read-only; a probe is shared for 5 s so the Status row, the New session page and a
// session start do not each ask the Stack. A model that is installed but not in memory is NOT a failure (the engine loads it on the first message); an engine that is
// loading is "starting", not a refusal. Counts and codes only (rule 6a): the sentence names no path of a person's work.
import { codeReady, type CodeReady, type CodeReadyId } from "@/lib/codeReady";
import { codingConcern, type CodingConcern } from "@/lib/roleHealth";
import { codingNotice, type CodingCause } from "@/lib/failureCopy";

export type CodingReadinessReason = "ready" | CodeReadyId | CodingCause;
export interface CodingReadiness {
  ready: boolean;
  reason: CodingReadinessReason;
  /** The detail for an owner or admin: what is missing and what to do. Null when ready. */
  sentence: string | null;
  /** The line for everyone else: Code is not ready and who to ask. Null when ready. */
  plain: string | null;
}

const PLAIN = "Code is not ready. Ask an admin to check it in Settings, Coding.";
const READY: CodingReadiness = { ready: true, reason: "ready", sentence: null, plain: null };

export type CodingReadinessProbe = () => Promise<CodingReadiness>;

/** The pure rule: the first missing piece of the ready check, else the coding concern when it says the engine cannot take a message, else ready. */
export function readinessFrom(ready: Pick<CodeReady, "ready" | "first_missing">, concern: Pick<CodingConcern, "availability" | "cause">): CodingReadiness {
  if (!ready.ready && ready.first_missing) return { ready: false, reason: ready.first_missing.id, sentence: `Code is not ready. ${ready.first_missing.say}`, plain: PLAIN };
  if (concern.availability === "unavailable" && concern.cause) return { ready: false, reason: concern.cause, sentence: `Code is not ready. ${codingNotice(concern.cause)}`, plain: PLAIN };
  return READY;
}
async function probe(): Promise<CodingReadiness> {
  const ready = await codeReady();
  return readinessFrom(ready, ready.ready ? await codingConcern() : { availability: "ready" });
}

let override: CodingReadinessProbe | null = null;
let cached: { at: number; value: Promise<CodingReadiness> } | null = null;
const SHARED_MS = 5_000;

/** The one readiness answer, shared for 5 s. `fresh` skips the share (a session start asks fresh so a just-fixed home starts at once). */
export function codingReadiness(opts: { fresh?: boolean } = {}): Promise<CodingReadiness> {
  if (override) return override();
  const now = Date.now();
  if (!opts.fresh && cached && now - cached.at < SHARED_MS) return cached.value;
  const value = probe().catch((): CodingReadiness => ({ ready: false, reason: "engine", sentence: "Code is not ready. Home could not check the engine. Open this page again in a minute.", plain: PLAIN }));
  cached = { at: now, value };
  return value;
}

/** What a person is told when a session cannot start: the admin's detail, or the plain line. */
export const readinessLineFor = (readiness: CodingReadiness, canFix: boolean): string => (canFix ? readiness.sentence : readiness.plain) ?? PLAIN;

export function __setCodingReadinessForTests(next: CodingReadinessProbe | null): void { override = next; cached = null; }
export const __READY_FOR_TESTS: CodingReadinessProbe = async () => READY;
