// CODE-STACK-01 H2: the coding settings the Stack must know, pushed from Home's household settings to the Stack's own keys.
// Home's setting is the one the admin edits; the Stack key is what the engine launch and the governor read. Values are
// clamped to the Stack's declared range, so a value Home stores is always one the Stack accepts (Home's keep-warm allows
// 0 where the Stack's floor is 1 minute).
//
// How it reaches the Stack: PUT /stack/v1/settings stores the values (a setting that needs a restart becomes pending),
// then POST /stack/v1/settings/apply promotes pending values only when every pending value in the Stack is one of
// these keys, so an admin's other staged Stack settings are never promoted by a coding change. The coding engine loads on
// demand, so promoted values apply at its next load. A push that cannot reach the Stack is retried on the next change and at
// the next Home start; it never fails the settings save.
import { getHouseholdSettingValue } from "@/lib/settings";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";

const clamp = (min: number, max: number, fallback: number) => (value: unknown): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
};

/** Home key, the Stack key it feeds, and how a stored value becomes the Stack's. */
export const CODING_STACK_MAP: ReadonlyArray<{ home: string; stack: string; value: (stored: unknown) => unknown }> = [
  { home: "coding.keep_warm_minutes", stack: "stack.engines.coding.keep_warm_minutes", value: clamp(1, 1440, 15) },
  { home: "coding.thinking_budget_ceiling", stack: "stack.engines.coding.thinking_budget_ceiling", value: clamp(0, 32768, 2000) },
  { home: "coding.yield_to_chat", stack: "stack.engines.coding.yield_to_chat", value: (stored) => stored !== false },
  { home: "coding.engine", stack: "stack.engines.coding.engine", value: (stored) => (stored === "splash" || stored === "llama-server" ? stored : "auto") },
  { home: "coding.splash_cache_gb", stack: "stack.engines.coding.splash_cache_gb", value: clamp(0, 64, 8) },
];

export function isCodingStackKey(key: string): boolean { return CODING_STACK_MAP.some((entry) => entry.home === key); }

/** The Stack values for the given Home keys (all of them when none are named), read from the household settings. */
export function codingStackValues(homeKeys?: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(CODING_STACK_MAP.filter((entry) => !homeKeys || homeKeys.includes(entry.home)).map((entry) => [entry.stack, entry.value(getHouseholdSettingValue(entry.home))]));
}

let clientForTests: Pick<StackClient, "updateSettings" | "promotePendingSettings"> | null = null;
export function __setCodingSyncClientForTests(client: typeof clientForTests): void { clientForTests = client; }

export type CodingPush = { pushed: string[]; promoted: boolean } | { pushed: []; promoted: false; skipped: "no_stack" | "unreachable" };

/** Pushes the named Home keys (all when none are named). Never throws. */
export async function pushCodingSettings(homeKeys?: readonly string[]): Promise<CodingPush> {
  if (!clientForTests && !isStackConfigured()) return { pushed: [], promoted: false, skipped: "no_stack" };
  const values = codingStackValues(homeKeys);
  if (Object.keys(values).length === 0) return { pushed: [], promoted: false, skipped: "no_stack" };
  try {
    const client = clientForTests ?? getStackClient();
    if (!client.updateSettings) return { pushed: [], promoted: false, skipped: "unreachable" };
    const after = await client.updateSettings(values);
    const mine = new Set(CODING_STACK_MAP.map((entry) => entry.stack));
    const pending = after.settings.filter((setting) => setting.pending !== null && setting.pending !== undefined).map((setting) => setting.key);
    let promoted = false;
    if (pending.length > 0 && pending.every((key) => mine.has(key)) && client.promotePendingSettings) { await client.promotePendingSettings(); promoted = true; }
    return { pushed: Object.keys(values), promoted };
  } catch {
    console.warn("[coding] The coding settings could not reach the engine. They are saved in Home and are sent again on the next change or restart.");
    return { pushed: [], promoted: false, skipped: "unreachable" };
  }
}
