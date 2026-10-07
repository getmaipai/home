import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

describe("GET /api/host/hardware", () => {
  test("requires sign-in", async () => {
    const res = await new TestClient().get("/api/host/hardware");
    expect(res.status).toBe(401);
  });

  test("a non-admin adult is refused: this is host-level, not personal, data", async () => {
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const res = await adultClient.get("/api/host/hardware");
    expect(res.status).toBe(403);
  });

  test("owner sees real detected hardware, not a stub shape", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/host/hardware");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalRamGb: number; cpuCount: number; cudaDevices: unknown[] };
    expect(body.totalRamGb).toBeGreaterThan(0);
    expect(body.cpuCount).toBeGreaterThan(0);
    expect(Array.isArray(body.cudaDevices)).toBe(true);
  });
});

describe("GET /api/host/models", () => {
  test("requires a valid role query param", async () => {
    const owner = await ownerClient();
    const missing = await owner.get("/api/host/models");
    expect(missing.status).toBe(400);
    const bad = await owner.get("/api/host/models?role=not-a-role");
    expect(bad.status).toBe(400);
  });

  test("chat role returns the real catalog entry with fit info against this machine", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/host/models?role=chat");
    expect(res.status).toBe(200);
    const fits = (await res.json()) as Array<{ model: { id: string }; fits: boolean }>;
    expect(fits.some((f) => f.model.id === "qwen3-8b-instruct-q4-k-m")).toBe(true);
  });

  test("image role returns entries marked not implemented, for pros/cons display only", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/host/models?role=image");
    const fits = (await res.json()) as Array<{ model: { implemented: boolean } }>;
    expect(fits.length).toBeGreaterThan(0);
    expect(fits.every((f) => f.model.implemented === false)).toBe(true);
  });
});

describe("GET /api/host/chat-models", () => {
  test("returns the compact parent-facing shape without host diagnostics", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/host/chat-models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Array<{ id: string; label: string }>; selectedModel: unknown; canSelect: boolean };
    expect(body.canSelect).toBe(false);
    expect(body.models.every((model) => Object.keys(model).sort().join(",") === "id,label")).toBe(true);
  });

  test("a child receives a calm empty shape with no model name", async () => {
    const owner = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });

    const res = await childClient.get("/api/host/chat-models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: [], selectedModel: null, canSelect: false });
  });

  test("an adult member can see the current model without host diagnostics or selection", async () => {
    const owner = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await created.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    __setStackClientForTests({ roles: async () => ({ roles: [{ id: "chat", state: { state: "ready", since: "" }, model: { id: "model-a" }, models: [{ id: "model-a", name: "Model A" }, { id: "model-b", name: "Model B" }] }] }) } as never);
    try {
      const res = await adultClient.get("/api/host/chat-models");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [{ id: "model-a", label: "Model A" }, { id: "model-b", label: "Model B" }],
        selectedModel: { id: "model-a", label: "Model A", available: true },
        canSelect: false,
      });
    } finally {
      __resetStackEngineForTests();
      setHouseholdSettingValue("engines.stack.url", "");
    }
  });

  test("a teen receives the same calm empty shape as a child", async () => {
    const owner = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Sprout", role: "teen" });
    const teen = (await created.json()) as { id: string };
    const teenClient = new TestClient();
    await teenClient.post("/api/auth/select", { personId: teen.id });

    const res = await teenClient.get("/api/host/chat-models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: [], selectedModel: null, canSelect: false });
  });
});

describe("GET /api/host/chat-capabilities (VISION-02c, 02d)", () => {
  test("follows the Stack's chat row and the model's record, never a model id", async () => {
    const { __setChatPictureCapabilityForTests } = await import("@/lib/chatPictures");
    const { __setStackClientForTests } = await import("@/lib/stackEngine");
    const owner = await ownerClient();
    __setStackClientForTests({ roles: async () => ({ roles: [{ id: "chat", state: { state: "ready", since: "" }, model: { id: "qwen3-vl-8b-instruct-q4-k-m", imageInput: true }, picture_tokens_max: 2560, models: [{ id: "qwen3-vl-8b-instruct-q4-k-m", name: "vl" }, { id: "qwen3-8b-instruct-q4-k-m", name: "text" }] }] }) } as never);
    __setChatPictureCapabilityForTests({ imageParts: true, pictureTokensMax: 2560 });
    try {
      const res = await owner.get("/api/host/chat-capabilities");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ image_parts: true, thinking: "none", thinking_modes: { "qwen3-vl-8b-instruct-q4-k-m": "none", "qwen3-8b-instruct-q4-k-m": "switchable" } });
      __setChatPictureCapabilityForTests({ imageParts: false, pictureTokensMax: null });
      expect(((await (await owner.get("/api/host/chat-capabilities")).json()) as { image_parts: boolean }).image_parts).toBe(false);
    } finally {
      __setChatPictureCapabilityForTests(null);
      __setStackClientForTests(null);
    }
  });

  test("a child's thinking control reads none, whatever the model", async () => {
    const owner = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });
    const body = (await (await childClient.get("/api/host/chat-capabilities")).json()) as { image_parts: boolean; thinking: string };
    expect(body.thinking).toBe("none");
    expect(body.image_parts).toBe(false);
  });
});

describe("POST /api/host/models/:id/select", () => {
  test("returns 409 because model changes belong to the MaiPai Stack", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/host/models/qwen3-8b-instruct-q4-k-m/select", {});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Model changes are made through the MaiPai Stack." });
    expect(getHouseholdSettingValue("chat.model_id")).toBe("");
  });
});

describe("POST /api/host/engine/{stop,restart}", () => {
  test("refuses Home-owned chat engine controls", async () => {
    const owner = await ownerClient();
    for (const action of ["stop", "restart"] as const) {
      const res = await owner.post(`/api/host/engine/${action}`, {});
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Model changes are made through the MaiPai Stack." });
    }
  });
});

describe("GET /api/host/engine/status", () => {
  test("reports the configured scripted Stack chat role", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/host/engine/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { kind: string; modelId: string | null; pid: number | null; startedAt: string | null; name: string | null; state: string };
    expect(body.kind).toBe("url");
    expect(body.modelId).toBeNull();
    expect(body.pid).toBeNull();
    expect(body.startedAt).toBeNull();
    expect(body.name).toBeNull();
    expect(body.state).toBe("ready");
  });
});

// Only the role gate is exercised here, the same shape as GET /api/host/
// hardware above: an owner's real call schedules process.exit() (host.ts's
// own comment explains why a non-zero code is required for systemd/WinSW
// to actually restart, not just stop, the service), which would kill this
// test run rather than the hub - the same reason POST /api/host/engine/
// restart and /engine/stop, the two other routes that reach past this
// process's own boundary, have no success-path test either.
describe("POST /api/host/restart", () => {
  test("requires sign-in", async () => {
    const res = await new TestClient().post("/api/host/restart", {});
    expect(res.status).toBe(401);
  });

  test("a non-admin adult is refused: restarting the whole hub is host-level, not personal", async () => {
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const res = await adultClient.post("/api/host/restart", {});
    expect(res.status).toBe(403);
  });
});
