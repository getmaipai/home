import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { readAiSettings } from "@/lib/aiChoicesState";
import { getMemoryAnswerGb, getSetupState } from "@/lib/setupState";
import type { StackClient, StackInstallPlan } from "@/lib/stack/client";
import { owner } from "./support/testAuth";
import { TestClient } from "./client";
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
    const client = new TestClient();
    const response = await client.post("/api/setup/install", {});
    expect(response.status).toBe(202);
    const state = getSetupState();
    expect(state.steps.find((s) => s.id === "plan")?.status).toBe("done");
    expect(state.plan.tier).toBe("minimal");
    expect(state.plan.roles).toEqual(["engines.chat.choice"]);
  });

  test("POST /api/setup/install refuses when no level fits", async () => {
    __setStackClientForTests(stack(async () => plan({ level: null, tier: null, models: [], memory_source: "unknown" })));
    const client = new TestClient();
    const response = await client.post("/api/setup/install", {});
    expect(response.status).toBe(409);
    expect(Object.keys(await response.json() as object).sort()).toEqual(["error", "next"]);
  });

  test("POST /api/setup/install refuses when the disk is too small", async () => {
    __setStackClientForTests(stack(async () => plan({ free_disk_bytes: 5 * 1024 ** 3 })));
    const client = new TestClient();
    const response = await client.post("/api/setup/install", {});
    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toMatch(/^This computer needs about \d+ GB free for the minimal setup; it has 5\.0 GB\. Free up space, or choose a smaller plan\.$/);
  });

  test("GET /api/setup/plan carries the job cards built from the disk plan, or none without one", async () => {
    __setStackClientForTests(stack(async () => plan()));
    const { client } = await owner();
    const body = await (await client.get("/api/setup/plan")).json() as { wording: { disk?: unknown }; choices?: { cards: Array<{ id: string }> } | null };
    if (body.wording.disk) expect(body.choices?.cards.map((card) => card.id)).toContain("chat");
    else expect(body.choices ?? null).toBeNull();
  });

  test("POST /api/setup/install saves the card choices it was sent, and refuses a key that is not one", async () => {
    __setStackClientForTests(stack(async () => plan()));
    const client = new TestClient();
    const refused = await client.post("/api/setup/install", { settings: { "auth.secret": "x" } });
    expect(refused.status).toBe(409);
    expect((await refused.json() as { error: string }).error).toMatch(/auth\.secret is not a choice setup can save/);
    expect(getSetupState().steps.find((s) => s.id === "plan")?.status).not.toBe("done");
    const before = readAiSettings();
    expect(before.musicEnabled).toBe(true);
    expect(before.videoQuality).toBe("quick");
    const saved = await client.post("/api/setup/install", { settings: { "generation.music.enabled": false, "generation.video_quality": "detailed" } });
    expect(saved.status).toBe(202);
    const after = readAiSettings();
    expect(after.musicEnabled).toBe(false);
    expect(after.videoQuality).toBe("detailed");
  });

  test("POST /api/setup/install is closed once Home has an owner", async () => {
    __setStackClientForTests(stack(async () => plan()));
    const { client } = await owner();
    expect((await client.post("/api/setup/install", {})).status).toBe(409);
  });

  test("POST /api/install/start and GET /api/install/plan work for the owner and need sign in", async () => {
    __setStackClientForTests(stack(async () => plan()));
    expect((await (await import("@/app")).app.request("/api/install/plan")).status).toBe(401);
    const { client } = await owner();
    expect((await client.get("/api/install/plan?vram_gb=16")).status).toBe(200);
    expect((await client.post("/api/install/start", {})).status).toBe(202);
  });

  test("GET /api/install needs sign in and answers an empty install", async () => {
    __setStackClientForTests(stack(async () => plan()));
    expect((await (await import("@/app")).app.request("/api/install")).status).toBe(401);
    const { client } = await owner();
    const body = await (await client.get("/api/install")).json() as { state: string };
    expect(body.state).toBe("none");
  });
  test("POST /api/install/retry keeps the memory answer: sent now, then reused by a retry with no body", async () => {
    const asked: Array<number | undefined> = [];
    __setStackClientForTests({
      installPlan: async (query?: { vramGb?: number }) => { asked.push(query?.vramGb); return plan({ models: [{ ...model, installed: false }] }); },
      modelCatalog: async () => ({ models: [] }), pullModel: async () => ({}), jobs: async () => [], models: async () => [],
    } as unknown as StackClient);
    const { client } = await owner();
    expect((await client.post("/api/install/retry", { vram_gb: 24 })).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getMemoryAnswerGb()).toBe(24);
    expect((await client.post("/api/install/retry", {})).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toEqual([24, 24]);
  });

  test("the memory answer typed on the plan screen is saved, and a setup step write keeps it", async () => {
    __setStackClientForTests(stack(async () => plan()));
    const { client } = await owner();
    expect((await client.post("/api/install/start", { vram_gb: 32 })).status).toBe(202);
    expect(getMemoryAnswerGb()).toBe(32);
    await client.post("/api/setup/welcome", { status: "done" });
    expect(getMemoryAnswerGb()).toBe(32);
  });
});
