import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextModelsPage } from "@/next/pages/NextModelsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role,
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  } as Roster;
}

describe("NextModelsPage", () => {
  test("a non-admin sees the denial and does not fetch model information", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock((_input: RequestInfo | URL) => Promise.resolve(Response.json({})));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextModelsPage person={makePerson("adult")} />);
      await waitFor(() => expect(view.getByText("Only an owner or admin can manage AI models.")).toBeTruthy());
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/health"))).toBe(false);
      expect(view.queryByRole("button", { name: "Restart" })).toBeNull();
      expect(view.queryByText("Brain")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("an admin sees the real ModelsSection and detected hardware", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/host/hardware")) {
        return Promise.resolve(Response.json({ platform: "darwin", totalRamGb: 24, cpuCount: 14, isAppleSilicon: true, unifiedMemoryGb: 24, cudaDevices: [] }));
      }
      if (url.includes("/api/host/models?role=")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/host/models/selection")) return Promise.resolve(Response.json({ modelId: null }));
      if (url.includes("/api/host/engine/status")) return Promise.resolve(Response.json({ kind: "none", modelId: null, pid: null, startedAt: null }));
      if (url.includes("/api/health")) {
        return Promise.resolve(Response.json({
          brain: "selection",
          voice: "spawned",
          ok: true,
          engines: {
            chat: { kind: "selection", pid: 4242, alive: true },
            embed: { kind: "spawned", pid: 4243, alive: true },
            background: { kind: "spawned", pid: 4244, alive: true },
            voice: { kind: "spawned", pid: 4245, alive: true },
          },
          uptimeSeconds: 60,
          sidecars: [],
        }));
      }
      return Promise.resolve(Response.json({}));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextModelsPage person={makePerson("admin")} />);
      await waitFor(() => expect(view.getByText("This computer: Apple Silicon, 24 GB memory.")).toBeTruthy());
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/host/hardware"), expect.anything());
      await waitFor(() => {
        for (const label of ["Brain", "Understanding", "Memory", "Voice"]) {
          expect(view.getByText(label)).toBeTruthy();
        }
        expect(view.getAllByRole("button", { name: "Restart" })).toHaveLength(4);
      });
      expect(view.getByText("This computer: Apple Silicon, 24 GB memory.")).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
