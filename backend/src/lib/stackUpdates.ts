// HOME-STACK-05: the Stack's own engine/model update state and its
// maintenance actions, read through 02b's same engines.stack.url gate -
// callers check isStackConfigured() first (routes/updates.ts, the
// scheduler), so every function here assumes a client is real to call.
import { getStackClient, stackFailureResult } from "@/lib/stackEngine";
import type { StackUpdatesState, StackEngineApplyResult, StackEngineRollbackResult, StackStorageSweepResult, StackCheckRun } from "@/lib/stack/types";

export type StackOpResult<T> = { ok: true; value: T } | { ok: false; status: 503; code: "unavailable"; error: string };

export async function getStackUpdatesState(): Promise<StackOpResult<StackUpdatesState>> {
  try {
    return { ok: true, value: await getStackClient().updates() };
  } catch (err) {
    return stackFailureResult(err, "updates");
  }
}

export async function checkStackUpdates(): Promise<StackOpResult<StackUpdatesState>> {
  try {
    return { ok: true, value: await getStackClient().checkUpdates() };
  } catch (err) {
    return stackFailureResult(err, "updates");
  }
}

export async function applyStackEngineUpdate(name: string): Promise<StackOpResult<StackEngineApplyResult>> {
  try {
    return { ok: true, value: await getStackClient().applyEngineUpdate(name) };
  } catch (err) {
    return stackFailureResult(err, "updates");
  }
}

export async function rollbackStackEngine(name: string, tag: string): Promise<StackOpResult<StackEngineRollbackResult>> {
  try {
    return { ok: true, value: await getStackClient().rollbackEngine(name, tag) };
  } catch (err) {
    return stackFailureResult(err, "updates");
  }
}

/** POST /stack/v1/storage/sweep - the housekeeping the Stack does not
 * schedule for itself (stack/docs/integrations.md); Home's own daily
 * job is what actually calls this, gated on stack.updates.enabled. */
export async function sweepStackStorage(): Promise<StackOpResult<StackStorageSweepResult>> {
  try {
    return { ok: true, value: await getStackClient().sweepStorage() };
  } catch (err) {
    return stackFailureResult(err, "updates");
  }
}

/** POST /stack/v1/check - the readiness check, run now. Same gate: the
 * Stack has no schedule of its own for this either. */
export async function runStackReadinessCheck(): Promise<StackOpResult<StackCheckRun>> {
  try {
    return { ok: true, value: await getStackClient().runCheck() };
  } catch (err) {
    return stackFailureResult(err, "updates");
  }
}

/** The one Stack-side setting this item reads: stack.updates.enabled,
 * a StackSetting (not a Home key - lives_in: "stack", per platform
 * plan 3.2), read through client.settings() rather than mirrored into
 * Home's own registry, since the Stack is that setting's one owner. */
export async function stackUpdatesEnabled(): Promise<boolean> {
  try {
    const { settings } = await getStackClient().settings();
    const setting = settings.find((s) => s.key === "stack.updates.enabled");
    return setting ? Boolean(setting.in_effect) : false;
  } catch {
    return false;
  }
}
