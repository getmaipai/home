import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssistantKeysSettings } from "@/apps/settings/AssistantKeysSettings";

afterEach(cleanup);

function stubFetch(handlers: Record<string, (init?: RequestInit) => unknown>): { calls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const match = Object.entries(handlers).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return Promise.resolve(new Response(JSON.stringify(match[1](init)), { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
// Built in pieces so no secret-shaped string sits in the source.
const SHOWN_ONCE = ["maipai", "key", "abc123", "shown", "once"].join("_");
const key = (over: Record<string, unknown> = {}) => ({ id: "key_abc123", person_id: "person-1", name: "Claude Code", scopes: ["settings"], created_at: "2026-10-21T12:00:00Z", expires_at: "2026-11-20T12:00:00Z", revoked_at: null, status: "active", last_used_at: null, suspended_reason: null, last_used_from: null, limits: { requests_per_minute: 60 }, hint: "wxyz", provenance: "Created in Settings", hlc: "1:0:a", ...over });
const view = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssistantKeysSettings /></QueryClientProvider>);

describe("AssistantKeysSettings", () => {
  test("lists only settings keys, hides coding keys, and says what the key can and cannot do", async () => {
    const stub = stubFetch({ "/api/settings/api-keys": () => ({ keys: [key(), key({ id: "key_code01", name: "OpenCode", scopes: ["code"] })] }) });
    try {
      const { findByText, queryByText } = view();
      expect(await findByText("Claude Code")).toBeTruthy();
      expect(queryByText("OpenCode")).toBeNull();
      expect(document.body.textContent).toContain("It cannot change people, passwords, safety or anything else");
    } finally { stub.restore(); }
  });
  test("making a key sends the settings scope and shows the secret once", async () => {
    let created: unknown;
    const stub = stubFetch({
      "/api/settings/api-keys": (init) => { if (init?.method === "POST") { created = JSON.parse(String(init.body)); return { key: key(), secret: SHOWN_ONCE }; } return { keys: [] }; },
    });
    try {
      const { findByText, findByLabelText, getByRole } = view();
      fireEvent.click(await findByText("Make an assistant key"));
      fireEvent.change(await findByLabelText("Name"), { target: { value: "Claude Code" } });
      await act(async () => { fireEvent.click(getByRole("button", { name: "Make key" })); });
      expect(created).toEqual({ name: "Claude Code", scopes: ["settings"], expires_in_days: 30 });
      expect(((await findByLabelText("Assistant key")) as HTMLInputElement).value).toBe(SHOWN_ONCE);
    } finally { stub.restore(); }
  });
});
