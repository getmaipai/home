import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { VoicesPage } from "@/shell/pages/VoicesPage";
import { CommandsPage } from "@/shell/pages/CommandsPage";
import { DevicesPage } from "@/shell/pages/DevicesPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(): Roster {
  return {
    id: "person-abc123", display_name: "Nova", nickname: null, role: "child",
    avatar_seed: "person-abc123", source: "hub", local_only: false,
    created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null,
    hlc: "1788000000000:0:test", hasSecret: true,
  } as Roster;
}

function mockApi() {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/voices/catalog")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/voices/cloned")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/settings")) return Promise.resolve(Response.json({ settings: [] }));
    if (url.includes("/api/commands")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/devices")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/auth/sessions")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

describe("Next personal management pages", () => {
  test("a child can reach the real Voices sections", async () => {
    const restore = mockApi();
    try {
      renderWithQueryClient(<VoicesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Cloned voices"));
      expect(document.body.textContent).toContain("Voices");
      expect(document.body.textContent).toContain("More voices");
    } finally { restore(); }
  });

  test("a child can reach the real Commands section", async () => {
    const restore = mockApi();
    try {
      renderWithQueryClient(<CommandsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Commands"));
      expect(document.body.textContent).toContain("No commands");
    } finally { restore(); }
  });

  test("a child can reach the real Devices section", async () => {
    const restore = mockApi();
    try {
      renderWithQueryClient(<DevicesPage />);
      await waitFor(() => expect(document.body.textContent).toContain("Signed-in sessions"));
      expect(document.body.textContent).toContain("Devices");
    } finally { restore(); }
  });
});
