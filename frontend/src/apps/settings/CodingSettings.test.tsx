import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CodingKeysSettings } from "@/apps/settings/CodingSettings";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

function mockKeys(keys: unknown[] = []) {
  const original = globalThis.fetch;
  const key = { id: "key_abcd1234", person_id: "person-abcdef", name: "Laptop", scopes: ["code"], created_at: "2026-10-01T00:00:00.000Z", expires_at: "2027-01-01T00:00:00.000Z", revoked_at: null, status: "active", suspended_reason: null, last_used_at: null, last_used_from: null, limits: { requests_per_minute: 60 }, hint: "ABCD", provenance: "Settings", hlc: "1:0:node123" };
  const create = mock((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(Response.json({ key, secret: "maipai_key_abcd1234_SECRET_ONCE" })));
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/settings/coding-access")) return Promise.resolve(Response.json({ allowed: true, can_create: true }));
    if (url.endsWith("/api/settings/api-keys") && init?.method === "POST") return create(input, init);
    if (url.endsWith("/api/settings/api-keys")) return Promise.resolve(Response.json({ keys }));
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, create };
}

describe("Coding keys settings", () => {
  test("the dialog shows one key, hides setup lines until opened, copies the key, and drops it when closed", async () => {
    const server = mockKeys();
    const originalClipboard = navigator.clipboard;
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
    try {
      const view = renderWithQueryClient(<CodingKeysSettings person={{ id: "person-abcdef", role: "adult" }} />);
      fireEvent.click(await view.findByRole("button", { name: "Create key" }));
      fireEvent.change(view.getByLabelText("Name"), { target: { value: "Work laptop" } });
      fireEvent.click(view.getByRole("button", { name: "Create key" }));
      const key = await view.findByDisplayValue("maipai_key_abcd1234_SECRET_ONCE");
      expect(view.getAllByDisplayValue("maipai_key_abcd1234_SECRET_ONCE")).toHaveLength(1);
      expect(view.getByText("This is the only key. The tool lines below use this same key.")).toBeTruthy();
      expect(view.queryByRole("textbox", { name: "Claude Code setup line" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Setup lines for your tool" }));
      expect(view.getByDisplayValue(/ANTHROPIC_BASE_URL=.*\/code\/v1/)).toBeTruthy();
      expect(view.getByText("Claude Code · same key")).toBeTruthy();
      fireEvent.click(view.getAllByRole("button", { name: "Copy" })[0]!);
      await waitFor(() => expect(copied).toBe("maipai_key_abcd1234_SECRET_ONCE"));
      fireEvent.click(view.getByRole("button", { name: "Done" }));
      expect(view.queryByDisplayValue("maipai_key_abcd1234_SECRET_ONCE")).toBeNull();
      expect(view.queryByText("maipai_key_abcd1234_SECRET_ONCE")).toBeNull();
      expect(key).toBeTruthy();
    } finally { server.restore(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard }); }
  });

  test("the keys list explains why a suspended key is not working", async () => {
    const server = mockKeys([{ id: "key_abcd1234", person_id: "person-abcdef", name: "Laptop", scopes: ["code"], created_at: "2026-10-01T00:00:00.000Z", expires_at: "2027-01-01T00:00:00.000Z", revoked_at: null, status: "suspended", suspended_reason: "An admin paused Coding.", last_used_at: null, last_used_from: null, limits: { requests_per_minute: 60 }, hint: "ABCD", provenance: "Settings", hlc: "1:0:node123" }]);
    try {
      const view = renderWithQueryClient(<CodingKeysSettings person={{ id: "person-abcdef", role: "adult" }} />);
      expect(await view.findByText("An admin paused Coding.")).toBeTruthy();
    } finally { server.restore(); }
  });
});
