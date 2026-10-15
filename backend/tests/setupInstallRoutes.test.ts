import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { getSetupState } from "@/lib/setupState";
import type { StackClient, StackInstallPlan } from "@/lib/stack/client";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

const model = { id: "qwen3-1.7b-q8-0", role: "chat", url: "https://example.com/m.gguf", sha256: "a".repeat(64), licence: "Apache-2.0", revision: "r1", approx_bytes: 100, starter: true, installed: true };
const plan = (over: Partial<StackInstallPlan> = {}): StackInstallPlan => ({
  level: "minimal", tier: "p16", label: "x", memory_gb: 16, memory_source: "unified", models: [model],
  total_bytes: 100, remaining_bytes: 0, free_disk_bytes: 10 ** 12, fits_disk: true, ...over,
});
const stack = (installPlan: () => Promise<StackInstallPlan>) =>
  ({ installPlan, jobs: async () => [], models: async () => [], pullModel: async () => ({}) }) as unknown as StackClient;

describe("setup install routes", () => {
  beforeEach(() => { resetDb(); resetInstallStatusCache(); });
  afterEach(() => __resetStackEngineForTests());

  test("GET /api/setup/plan words the Stack's plan", async () => {
    __setStackClientForTests(stack(async () => plan()));
    const { client } = await owner();
    const body = await (await client.get("/api/setup/plan")).json() as { plan: StackInstallPlan; wording: { level: string } };
    expect(body.plan.tier).toBe("p16");
    expect(body.wording.level).toBe("minimal");
  });

  test("GET /api/setup/plan with an unreachable Stack still answers", async () => {
    __setStackClientForTests(stack(async () => { throw new Error("offline"); }));
    const { client } = await owner();
    const response = await client.get("/api/setup/plan");
    expect(response.status).toBe(200);
    expect((await response.json() as { plan: unknown }).plan).toBeNull();
  });

  test("POST /api/setup/install records the plan step and starts", async () => {
    __setStackClientForTests(stack(async () => plan()));
    const { client } = await owner();
    const response = await client.post("/api/setup/install", {});
    expect(response.status).toBe(202);
    const state = getSetupState();
    expect(state.steps.find((s) => s.id === "plan")?.status).toBe("done");
    expect(state.plan.tier).toBe("minimal");
    expect(state.plan.roles).toEqual(["engines.chat.choice"]);
  });

  test("POST /api/setup/install refuses when no level fits", async () => {
    __setStackClientForTests(stack(async () => plan({ level: null, tier: null, models: [], memory_source: "unknown" })));
    const { client } = await owner();
    const response = await client.post("/api/setup/install", {});
    expect(response.status).toBe(409);
    expect(Object.keys(await response.json() as object).sort()).toEqual(["error", "next"]);
  });

  test("POST /api/setup/install refuses when the disk is too small", async () => {
    __setStackClientForTests(stack(async () => plan({ fits_disk: false })));
    const { client } = await owner();
    expect((await client.post("/api/setup/install", {})).status).toBe(409);
  });

  test("GET /api/install needs sign in and answers an empty install", async () => {
    __setStackClientForTests(stack(async () => plan()));
    expect((await (await import("@/app")).app.request("/api/install")).status).toBe(401);
    const { client } = await owner();
    const body = await (await client.get("/api/install")).json() as { state: string };
    expect(body.state).toBe("none");
  });
});
