import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { FeatureAccess, PersonFeatures } from "@/apps/settings/FeatureAccess";
import type { PersonRosterEntry } from "@/lib/api";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

const person = (id: string, name: string, role: string, age_band: string) => ({ id, display_name: name, role, age_band, nickname: null, avatar_seed: id, source: "hub", local_only: false, created_at: "", updated_at: "", deleted_at: null, enabled: true, guest_expires_at: null, controls: null, memorialized_at: null, hlc: "1:0:x" });
const roster = [person("p-sage", "Sage", "owner", "adult"), person("p-marlow", "Marlow", "teen", "teen")];
const feature = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, min_role: "child", role_allows: true, effective: true, grant: null, ...over });

function stub(rows: Record<string, unknown[]>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/api/people")) return Promise.resolve(Response.json(roster));
    const match = /\/api\/people\/([^/]+)\/features$/.exec(url);
    if (match) return Promise.resolve(Response.json({ features: rows[decodeURIComponent(match[1]!)] ?? [] }));
    if (url.endsWith("/api/grants") && method === "POST") return Promise.resolve(Response.json({ id: "grant-new" }, { status: 201 }));
    if (url.includes("/api/grants/") && method === "DELETE") return Promise.resolve(Response.json({ id: "grant-old" }));
    if (url.includes("/api/settings")) return Promise.resolve(Response.json({}));
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("FeatureAccess", () => {
  test("shows a person's features from the route, Coding first; Denied posts a deny and the row refetches", async () => {
    const server = stub({ "p-sage": [feature("weather", "Weather")] });
    try {
      const view = renderWithQueryClient(<PersonFeatures person={roster[0] as unknown as PersonRosterEntry} />);
      expect(await view.findByText("Weather")).toBeTruthy();
      fireEvent.click(await view.findByRole("radio", { name: "Denied" }));
      await waitFor(() => expect(server.calls.some((c) => c.method === "POST" && c.url.endsWith("/api/grants") && JSON.stringify(c.body) === JSON.stringify({ person: "p-sage", action: "use:weather", effect: "deny" }))).toBe(true));
      await waitFor(() => expect(server.calls.filter((c) => c.url.endsWith("/api/people/p-sage/features")).length).toBeGreaterThanOrEqual(2));
    } finally { server.restore(); }
  });

  test("going back to Allowed by role revokes the grant and posts nothing", async () => {
    const server = stub({ "p-sage": [feature("weather", "Weather", { effective: false, grant: { id: "grant-old", effect: "deny" } })] });
    try {
      const view = renderWithQueryClient(<PersonFeatures person={roster[0] as unknown as PersonRosterEntry} />);
      fireEvent.click(await view.findByRole("radio", { name: "Allowed by role" }));
      await waitFor(() => expect(server.calls.some((c) => c.method === "DELETE" && c.url.endsWith("/api/grants/grant-old"))).toBe(true));
      expect(server.calls.some((c) => c.method === "POST")).toBe(false);
    } finally { server.restore(); }
  });

  test("Allowed is not offered to a teen below a feature's age floor, but Coding is, with a confirmation first", async () => {
    const server = stub({ "p-sage": [], "p-marlow": [feature("code", "Coding", { min_role: "adult", role_allows: false, effective: false, allow_for_minors: true }), feature("news", "News", { min_role: "adult", role_allows: false, effective: false })] });
    try {
      const view = renderWithQueryClient(<PersonFeatures person={roster[1] as unknown as PersonRosterEntry} />);
      expect(await view.findByText("News")).toBeTruthy();
      const allowed = view.getAllByRole("radio", { name: "Allowed" }) as HTMLButtonElement[];
      expect(allowed.map((button) => button.disabled)).toEqual([false, true]);
      fireEvent.click(allowed[0]!);
      expect(await view.findByText("Let Marlow use Coding?")).toBeTruthy();
      expect(server.calls.some((c) => c.method === "POST")).toBe(false);
      fireEvent.click(view.getByRole("button", { name: "Allow Coding" }));
      await waitFor(() => expect(server.calls.some((c) => c.method === "POST" && c.url.endsWith("/api/grants") && (c.body as { action: string }).action === "use:code")).toBe(true));
      await waitFor(() => expect(server.calls.some((c) => c.method === "PUT" || (c.url.includes("/api/settings") && c.method !== "GET"))).toBe(true));
    } finally { server.restore(); }
  });

  test("the Coding-only list shows each person who has a Coding row and skips the rest", async () => {
    const server = stub({ "p-sage": [feature("code", "Coding", { min_role: "adult", allow_for_minors: true })], "p-marlow": [] });
    try {
      const view = renderWithQueryClient(<FeatureAccess viewer={{ id: "p-sage", role: "owner" }} feature="code" />);
      expect(await view.findByText("Who can use Coding")).toBeTruthy();
      expect(await view.findByText("Sage")).toBeTruthy();
      expect(view.queryByText("Marlow")).toBeNull();
    } finally { server.restore(); }
  });

  test("the section is absent for a viewer who is not an owner or admin, and fetches nothing", async () => {
    const server = stub({});
    try {
      const view = renderWithQueryClient(<FeatureAccess viewer={{ id: "p-adult", role: "adult" }} feature="code" />);
      expect(view.queryByTestId("feature-access")).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.calls).toHaveLength(0);
    } finally { server.restore(); }
  });
});
