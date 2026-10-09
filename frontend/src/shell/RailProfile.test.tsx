import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Roster } from "@/lib/api";
import type { Role } from "@/lib/api";
import { RailProfile } from "@/shell/RailProfile";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

afterEach(cleanup);

const degradedChat = [{
  id: "chat", name: "Chat", state: "degraded", paused: true, reason: "Chat isn't working right now.",
  needs: [{ kind: "engine", id: "chat", name: "Brain", state: "degraded", purpose: "Chat model", required: true }], history: [], uptimePercent: 100,
}];

function person(role: Role, age_band: "child" | "teen" | "adult" = role === "child" ? "child" : role === "teen" ? "teen" : "adult"): Roster {
  return { id: `person-${role}`, display_name: "Juniper", nickname: null, role, avatar_seed: "x", source: "hub", local_only: false, created_at: "", updated_at: "", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1:0:t", hasSecret: false, age_band } as unknown as Roster;
}

function renderProfile(role: Roster["role"]) {
  return renderWithQueryClient(
    <MemoryRouter>
      <RailProfile person={person(role)} incognito={false} onIncognitoChange={() => {}} onSignedOut={() => {}} />
    </MemoryRouter>,
  );
}

// RAIL-01 keeps CHAT-CALM-ERRORS-01d's rule for a child: while something
// is paused or down they see no status (they cannot fix it), now in the
// profile menu and on the avatar's attention dot instead of a header pill.
describe("RailProfile status by age", () => {
  test.each([["child", false], ["adult", true]] as const)("a %s sees a degraded system status: %s", async (role, shown) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/status/apps")) return Promise.resolve(Response.json(degradedChat));
      if (url.includes("/api/notifications")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    }) as unknown as typeof fetch;
    try {
      const view = renderProfile(role);
      await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(([url]) => String(url).includes("/api/status/apps"))).toBe(true));
      if (shown) await waitFor(() => expect(view.container.querySelector('[data-slot="rail-profile-dot"]')).not.toBeNull());
      else await new Promise((resolve) => setTimeout(resolve, 300));
      expect(view.container.querySelector('[data-slot="rail-profile-dot"]') !== null).toBe(shown);
      fireEvent.click(view.getByRole("button", { name: /Open profile menu for Juniper/ }));
      await view.findByRole("menuitem", { name: /Settings/ });
      expect(view.queryByRole("menuitem", { name: /System status/ }) !== null).toBe(shown);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("RailProfile Home settings entry", () => {
  test.each([["owner", "adult", true], ["admin", "adult", true], ["adult", "adult", false], ["teen", "teen", false], ["child", "child", false], ["guest", "adult", false], ["owner", "child", false], ["admin", "teen", false]] as const)("role=%s band=%s visible=%s", async (role, band, shown) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/notifications")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/status/apps")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><RailProfile person={person(role, band)} incognito={false} onIncognitoChange={() => {}} onSignedOut={() => {}} /></MemoryRouter>);
      fireEvent.click(view.getByRole("button", { name: /Open profile menu for Juniper/ }));
      if (shown) expect(await view.findByRole("menuitem", { name: "Home settings" })).toBeTruthy();
      else {
        await view.findByRole("menuitem", { name: /Settings/ });
        expect(view.queryByRole("menuitem", { name: "Home settings" })).toBeNull();
      }
    } finally { globalThis.fetch = originalFetch; }
  });
});

// RAIL-01 review: Log out ends the session through the existing route,
// empties the shared query cache so the next person on this browser never
// sees this person's cached answers, and stays signed in when it fails.
describe("RailProfile log out", () => {
  test.each([[true], [false]] as const)("logout succeeding=%s", async (ok) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/auth/logout")) return Promise.resolve(ok ? Response.json({ success: true }) : new Response("{}", { status: 500 }));
      if (url.includes("/api/notifications")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/status/apps")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    }) as unknown as typeof fetch;
    const signedOut: number[] = [];
    try {
      const view = renderWithQueryClient(
        <MemoryRouter>
          <RailProfile person={person("adult")} incognito={false} onIncognitoChange={() => {}} onSignedOut={() => signedOut.push(1)} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(view.queryClient.getQueryData<unknown[]>(["notifications"])).toEqual([]));
      fireEvent.click(view.getByRole("button", { name: /Open profile menu for Juniper/ }));
      fireEvent.click(await view.findByRole("menuitem", { name: /Log out/ }));
      if (ok) {
        await waitFor(() => expect(signedOut).toEqual([1]));
        expect(view.queryClient.getQueryData<unknown[]>(["notifications"])).toBeUndefined();
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(signedOut).toEqual([]);
        expect(view.queryClient.getQueryData<unknown[]>(["notifications"])).toEqual([]);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
