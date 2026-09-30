import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { NextStatusPage } from "@/next/pages/NextStatusPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-abc123", display_name: "Nova", nickname: null, role,
    avatar_seed: "person-abc123", source: "hub", local_only: false,
    created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null,
    hlc: "1788000000000:0:test", hasSecret: true,
  } as Roster;
}

function mockHealth() {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    paths.push(url.split("?")[0] ?? "");
    if (url.includes("/api/health")) return Promise.resolve(Response.json({
      brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60,
      engines: {
        chat: { kind: "selection", pid: null, alive: true },
        embed: { kind: "spawned", pid: null, alive: true },
        background: { kind: "spawned", pid: null, alive: true },
        voice: { kind: "spawned", pid: null, alive: true },
      },
      sidecars: [],
    }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { paths, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("NextStatusPage", () => {
  test("an admin sees the overall line, four engine rows, and Restart controls", async () => {
    const { restore } = mockHealth();
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("admin")} />);
      await view.findByText("Brain");
      expect(view.getAllByText("Everything is running.").length).toBeGreaterThan(0);
      for (const label of ["Brain", "Understanding", "Memory", "Voice"]) expect(view.getByText(label)).toBeTruthy();
      expect(view.getAllByRole("button", { name: "Restart" })).toHaveLength(4);
      expect(view.getByText("All good")).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("a member sees the same rows and overall line without admin routes or buttons", async () => {
    const { paths, restore } = mockHealth();
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      await view.findByText("Brain");
      expect(view.getAllByText("Everything is running.").length).toBeGreaterThan(0);
      for (const label of ["Brain", "Understanding", "Memory", "Voice"]) expect(view.getByText(label)).toBeTruthy();
      expect(view.queryByRole("button", { name: "Restart" })).toBeNull();
      expect(paths).toEqual(["/api/health"]);
    } finally {
      restore();
    }
  });
});
