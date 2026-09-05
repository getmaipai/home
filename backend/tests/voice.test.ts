import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { getTtsBackendKind, getTtsClient, __resetTtsSupervisorForTests } from "@/lib/ttsSupervisor";

beforeEach(() => {
  resetDb();
});

afterEach(() => {
  __resetTtsSupervisorForTests();
});

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

describe("POST /api/voice/hf-token", () => {
  test("requires sign-in", async () => {
    const res = await new TestClient().post("/api/voice/hf-token", { token: "hf_x" });
    expect(res.status).toBe(401);
  });

  test("a non-admin adult is refused: voice.hf_token is a household setting", async () => {
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });

    const res = await adultClient.post("/api/voice/hf-token", { token: "hf_x" });
    expect(res.status).toBe(403);
  });

  test("rejects a missing token", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/voice/hf-token", {});
    expect(res.status).toBe(400);
  });

  test("rejects a whitespace-only token", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/voice/hf-token", { token: "   " });
    expect(res.status).toBe(400);
  });

  test("saves the token and clears the already-running tts backend's cache", async () => {
    const owner = await ownerClient();
    // Establish a running (stub, in tests) backend first, the way a real
    // household's process would already be spawned before they ever visit
    // Settings to paste a token.
    await getTtsClient();
    expect(getTtsBackendKind()).toBe("stub");

    const res = await owner.post("/api/voice/hf-token", { token: "hf_realtoken123" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSet: boolean };
    expect(body.isSet).toBe(true);

    // restartTtsBackend() cleared the cache: the next getTtsClient() call
    // re-resolves from scratch rather than reusing the pre-save instance.
    expect(getTtsBackendKind()).toBe("none");
  });
});

describe("POST /api/voice/hf-token/remove", () => {
  test("requires sign-in", async () => {
    const res = await new TestClient().post("/api/voice/hf-token/remove");
    expect(res.status).toBe(401);
  });

  test("a non-admin adult is refused", async () => {
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });

    const res = await adultClient.post("/api/voice/hf-token/remove");
    expect(res.status).toBe(403);
  });

  test("removes a saved token and clears the already-running tts backend's cache", async () => {
    const owner = await ownerClient();
    const saveRes = await owner.post("/api/voice/hf-token", { token: "hf_realtoken123" });
    expect(saveRes.status).toBe(200);

    await getTtsClient();
    expect(getTtsBackendKind()).toBe("stub");

    const res = await owner.post("/api/voice/hf-token/remove");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSet: boolean };
    expect(body.isSet).toBe(false);

    expect(getTtsBackendKind()).toBe("none");
  });
});
