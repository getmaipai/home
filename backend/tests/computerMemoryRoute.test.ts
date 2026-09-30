import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

const value = { totalMemoryBytes: 32 * 1024 ** 3, capBytes: 16 * 1024 ** 3, freeMemoryBytes: 20 * 1024 ** 3, availablePercent: 80, pressure: "normal" as const, memoryReadingDegraded: false, loaded: [{ id: "chat", kind: "resident" as const, peakBytes: 5 * 1024 ** 3, measured: true, lastUsedAt: "2026-09-30T00:00:00Z", idleTtlSeconds: 60, pinned: false, pid: 1 }], queue: [] };
describe("GET /api/computer-memory", () => {
  beforeEach(() => resetDb());
  afterEach(() => __resetStackEngineForTests());
  test("returns available memory figures", async () => {
    __setStackClientForTests({ budget: async () => value } as unknown as StackClient);
    const { client } = await owner();
    expect(await (await client.get("/api/computer-memory")).json()).toEqual({ available: true, memory: { usableGb: 16, usedGb: 5, freeGb: 11, pressure: "normal", pressureText: "Plenty of room right now.", loaded: [{ id: "chat", label: "Chat", gb: 5 }] } });
  });
  test("reports unavailable when the Stack throws", async () => {
    __setStackClientForTests({ budget: async () => { throw new Error("offline"); } } as unknown as StackClient);
    const { client } = await owner();
    expect(await (await client.get("/api/computer-memory")).json()).toEqual({ available: false });
  });
  test("requires sign in", async () => {
    __setStackClientForTests({ budget: async () => value } as unknown as StackClient);
    const response = await (await import("@/app")).app.request("/api/computer-memory");
    expect(response.status).toBe(401);
  });
});
