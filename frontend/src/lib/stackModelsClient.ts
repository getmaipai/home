// STACK-MODELS-HOME-01: Home's `StackClient` for the shared AI and models page (`@maipai/ui` `StackModelsPage`). Each method is one call to Home's
// forwarder (`/api/ai/stack/*`, backend/src/routes/aiStack.ts), which checks who is asking and passes the call to the Stack unchanged. No logic here:
// a refusal becomes a `StackClientError` carrying the Stack's own sentence so the page can show it as it is. Home has no event relay for the Stack
// yet, so there is no `subscribe`; the page asks again every 2 seconds while a model downloads.
import { ApiError, requestJson } from "@/lib/api";
import { StackClientError } from "@maipai/ui/src/stack/StackClient";
import type { StackClient } from "@maipai/ui/src/stack/StackClient";

const BASE = "/api/ai/stack";
const json = (method: "POST" | "PUT", body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try { return await requestJson<T>(`${BASE}${path}`, { timeoutMs: 120_000, ...init }); }
  catch (error) {
    if (error instanceof ApiError) throw new StackClientError(error.message, error.code ?? null);
    throw error;
  }
}
const part = (id: string) => encodeURIComponent(id);

export function createHomeStackClient(): StackClient {
  return {
    readChoices: () => call("/choices"),
    setRoleEnabled: async (role, enabled) => { await call("/settings", json("PUT", { [`stack.roles.${role}.enabled`]: enabled })); },
    setRolePriorities: async (priorities) => { await call("/settings", json("PUT", Object.fromEntries(Object.entries(priorities).map(([role, value]) => [`stack.roles.${role}.priority`, value])))); },
    chooseModel: (category, level, body) => call(`/choices/${part(category)}/${part(level)}`, json("PUT", body)),
    setOrder: (category, body) => call(`/choices/${part(category)}/order`, json("PUT", body)),
    recommended: (dryRun) => call("/choices/recommended", json("POST", { dry_run: dryRun })),
    installModel: (id) => call(`/parts/${part(id)}/install`, json("POST", {})),
    removeModel: (id) => call(`/parts/${part(id)}`, { method: "DELETE" }),
    readUnused: () => call("/choices/unused"),
    removeUnused: (body) => call("/choices/unused/remove", json("POST", body)),
    addModel: (body) => call("/choices/add-model", json("POST", body)),
  };
}
