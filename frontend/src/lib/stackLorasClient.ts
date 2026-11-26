// STACK-LORAS-01 slice 4: Home's `StackClient` for the shared Styles page (`@maipai/ui` `StackLorasPage`). Each style call is one call to Home's pass-through
// (`/api/loras/stack/*`, backend/src/routes/lorasSources.ts), which checks who is asking, shows an adult-only style only as one locked tile unless the Adult lock
// is open, and passes the rest to the Stack unchanged. Drives and licences come from the same forwarder the AI and models page uses (`stackModelsClient.ts`).
// No logic here: a refusal becomes a `StackClientError` carrying the Stack's own sentence so the page can show it as it is.
import { ApiError, requestJson } from "@/lib/api";
import { StackClientError } from "@maipai/ui/src/stack/StackClient";
import type { StackClient, StackLorasClient } from "@maipai/ui/src/stack/StackClient";
import { createHomeStackClient } from "@/lib/stackModelsClient";

export const LORAS_BASE = "/api/loras/stack";
const send = (method: "PATCH" | "POST" | "PUT", body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const part = (value: string) => encodeURIComponent(value);

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try { return await requestJson<T>(`${LORAS_BASE}${path}`, { timeoutMs: 60_000, ...init }); }
  catch (error) {
    if (error instanceof ApiError) throw new StackClientError(error.message, error.code ?? null);
    throw error;
  }
}

export function createHomeLorasClient(): StackClient {
  const loras: StackLorasClient = {
    list: (options) => call(options?.removed ? "?removed=true" : ""),
    patch: (id, body) => call(`/${part(id)}`, send("PATCH", body)),
    remove: (id, purge) => call(`/${part(id)}${purge ? "?purge=true" : ""}`, { method: "DELETE" }),
    restore: (id) => call(`/${part(id)}/restore`, send("POST", {})),
    move: (id, diskId) => call(`/${part(id)}/move`, send("POST", { disk_id: diskId })),
    install: (body) => call("/install", send("POST", body)),
    sources: () => call("/sources"),
    setKey: (site, key) => call(`/sources/${site}/key`, send("PUT", { key })),
    search: (site, query) => call(`/sources/${site}/search?q=${part(query)}`),
    job: (id) => call(`/jobs/${part(id)}`),
    previewUrl: (id) => `${LORAS_BASE}/${part(id)}/preview`,
  };
  return { ...createHomeStackClient(), loras };
}
