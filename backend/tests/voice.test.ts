import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { clonedVoicesDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, offlineResponse, type StackFixture } from "./stackFixture";

function resetClonedVoicesDir(): void {
  if (!existsSync(clonedVoicesDir)) return;
  for (const f of readdirSync(clonedVoicesDir)) rmSync(join(clonedVoicesDir, f), { force: true });
}

beforeEach(() => {
  resetDb();
  resetClonedVoicesDir();
});

afterEach(() => {
  __resetStackEngineForTests();
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
    const unavailable = startStackFixture({
      "POST /stack/v1/settings/apply": () => offlineResponse("tts", "the test Stack is unavailable"),
    });
    __setStackClientForTests(unavailable.client);
    try {
      const owner = await ownerClient();
      const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
      const adult = (await adultRes.json()) as { id: string };
      const adultClient = new TestClient();
      await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

      const res = await adultClient.post("/api/voice/hf-token", { token: "hf_x" });
      expect(res.status).toBe(503);
    } finally {
      unavailable.stop();
    }
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

  test("requires the Stack when no speech service is configured", async () => {
    const unavailable = startStackFixture({
      "POST /stack/v1/settings/apply": () => offlineResponse("tts", "the test Stack is unavailable"),
    });
    __setStackClientForTests(unavailable.client);
    try {
      const owner = await ownerClient();
      expect((await owner.post("/api/voice/hf-token", { token: "hf_realtoken123" })).status).toBe(503);
    } finally {
      unavailable.stop();
    }
  });
});

describe("POST /api/voice/hf-token/remove", () => {
  test("requires sign-in", async () => {
    const res = await new TestClient().post("/api/voice/hf-token/remove");
    expect(res.status).toBe(401);
  });

  test("a non-admin adult is refused", async () => {
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const res = await adultClient.post("/api/voice/hf-token/remove");
    expect(res.status).toBe(503);
  });

  test("requires the Stack to remove its token", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/voice/hf-token/remove");
    expect(res.status).toBe(503);
  });
});

// HOME-STACK-02b: engines.stack.url set moves the hf-token write to the
// Stack's own stack.engines.tts.hf_token setting instead of Home's
// household voice.hf_token key.
describe("hf-token routes, with a configured Stack", () => {
  let fixture: StackFixture;

  afterEach(() => {
    fixture?.stop();
  });

  test("POST /api/voice/hf-token writes to the Stack, not Home's own household setting", async () => {
    const receivedValues: { body: Record<string, unknown> | null } = { body: null };
    fixture = startStackFixture({
      "POST /stack/v1/settings/apply": async (req) => {
        receivedValues.body = (await req.json()) as Record<string, unknown>;
        return Response.json({ sections: [], settings: [] });
      },
    });
    const owner = await ownerClient();
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const res = await owner.post("/api/voice/hf-token", { token: "hf_realtoken123" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; isSet: boolean; value: unknown };
    expect(body.key).toBe("voice.hf_token");
    expect(body.isSet).toBe(true);
    expect(body.value).toBeNull(); // secret: never echoed back
    expect(receivedValues.body).toEqual({ "stack.engines.tts.hf_token": "hf_realtoken123" });
  });

  test("POST /api/voice/hf-token still refuses a non-admin adult", async () => {
    fixture = startStackFixture({ "POST /stack/v1/settings/apply": async () => Response.json({ sections: [], settings: [] }) });
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const res = await adultClient.post("/api/voice/hf-token", { token: "hf_x" });
    expect(res.status).toBe(403);
  });

  test("POST /api/voice/hf-token/remove clears the Stack's setting", async () => {
    const receivedValues: { body: Record<string, unknown> | null } = { body: null };
    fixture = startStackFixture({
      "POST /stack/v1/settings/apply": async (req) => {
        receivedValues.body = (await req.json()) as Record<string, unknown>;
        return Response.json({ sections: [], settings: [] });
      },
    });
    const owner = await ownerClient();
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const res = await owner.post("/api/voice/hf-token/remove");
    expect(res.status).toBe(200);
    expect(receivedValues.body).toEqual({ "stack.engines.tts.hf_token": "" });
  });

  test("a scripted Stack failure answers with the Stack's own status, no household write attempted", async () => {
    fixture = startStackFixture({ "POST /stack/v1/settings/apply": async () => offlineResponse("tts", "the tts engine is not running") });
    const owner = await ownerClient();
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const res = await owner.post("/api/voice/hf-token", { token: "hf_x" });
    expect(res.status).toBe(503);
  });
});

function wavFile(name = "sample.wav"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "audio/wav" });
}

describe("cloned voices", () => {
  test("GET /api/voice/cloned requires sign-in", async () => {
    const res = await new TestClient().get("/api/voice/cloned");
    expect(res.status).toBe(401);
  });

  test("uploads, lists household-wide, selects, and deletes a cloned voice", async () => {
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const form = new FormData();
    form.set("label", "Dad's voice");
    form.set("file", wavFile());
    const uploadRes = await owner.postForm("/api/voice/cloned", form);
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as { id: string; label: string; creatorName: string };
    expect(uploaded.label).toBe("Dad's voice");
    expect(uploaded.creatorName).toBe("Sage");

    // Another person can select the shared recording for their own voice.
    const listRes = await adultClient.get("/api/voice/cloned");
    const { voices } = (await listRes.json()) as { voices: { id: string }[] };
    expect(voices.map((v) => v.id)).toContain(uploaded.id);

    // Selecting sets the SELECTING person's own tts.voice_id, not the
    // creator's.
    const selectRes = await adultClient.post(`/api/voice/cloned/${uploaded.id}/select`, {});
    expect(selectRes.status).toBe(200);
    const selected = (await selectRes.json()) as { value: string };
    expect(selected.value).toMatch(new RegExp(`/api/voice/cloned/${uploaded.id}/file$`));

    // The file-serving route is real and unauthenticated for the Stack's voice fetch.
    const fileRes = await new TestClient().get(`/api/voice/cloned/${uploaded.id}/file`);
    expect(fileRes.status).toBe(200);
    // Bun's own multipart parser reports "sample.wav" as "audio/x-wav",
    // not the "audio/wav" the File() constructor was given - both are
    // real wav mime types EXTENSION_BY_MIME already treats identically.
    expect(fileRes.headers.get("content-type")).toMatch(/^audio\/(x-)?wav$/);

    // The adult (not the creator) can't delete it...
    const forbiddenDelete = await adultClient.post(`/api/voice/cloned/${uploaded.id}/delete`, {});
    expect(forbiddenDelete.status).toBe(403);
    // ...but the creator can.
    const deleteRes = await owner.post(`/api/voice/cloned/${uploaded.id}/delete`, {});
    expect(deleteRes.status).toBe(200);

    const afterDelete = await new TestClient().get(`/api/voice/cloned/${uploaded.id}/file`);
    expect(afterDelete.status).toBe(404);
  });

  test("selecting an unknown id 404s rather than trusting the request", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/voice/cloned/voice-doesnotexist/select", {});
    expect(res.status).toBe(404);
  });

  test("a made-up file id 404s, never resolving to an arbitrary path", async () => {
    const res = await new TestClient().get("/api/voice/cloned/voice-neverissued/file");
    expect(res.status).toBe(404);
  });

  test("upload rejects a missing file", async () => {
    const owner = await ownerClient();
    const form = new FormData();
    form.set("label", "Dad's voice");
    const res = await owner.postForm("/api/voice/cloned", form);
    expect(res.status).toBe(400);
  });

  // A code review (2026-09-04) found the route buffered the whole
  // upload into memory (parseBody + file.arrayBuffer()) before
  // saveClonedVoice()'s own 20MB check ever ran. bodyLimit rejects it
  // as bytes arrive instead - this drives a real oversized body through
  // the route (not a mock) to prove the rejection actually happens, at
  // 413, before the handler's own logic runs at all.
  test("an oversized upload is rejected by the body-size limit, not buffered first", async () => {
    const owner = await ownerClient();
    const form = new FormData();
    form.set("label", "Too big");
    form.set("file", new File([new Uint8Array(21 * 1024 * 1024)], "big.wav", { type: "audio/wav" }));
    const res = await owner.postForm("/api/voice/cloned", form);
    expect(res.status).toBe(413);
  }, 20_000);
});

describe("household voice catalog routes", () => {
  test("catalog browsing requires owner or admin, including on the server", async () => {
    const owner = await ownerClient();
    const adminRes = await owner.post("/api/people", { displayName: "Marlow", role: "admin", secret: "0000" });
    const admin = (await adminRes.json()) as { id: string };
    const adultRes = await owner.post("/api/people", { displayName: "Bramble", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const teenRes = await owner.post("/api/people", { displayName: "Nova", role: "teen", secret: "0000" });
    const teen = (await teenRes.json()) as { id: string };
    const childRes = await owner.post("/api/people", { displayName: "Poppy", role: "child", secret: "0000" });
    const child = (await childRes.json()) as { id: string };
    const clientFor = async (personId: string) => {
      const client = new TestClient();
      expect((await client.post("/api/auth/verify-secret", { personId, secret: "0000" })).status).toBe(200);
      return client;
    };
    const adminClient = await clientFor(admin.id);
    const adultClient = await clientFor(adult.id);
    const teenClient = await clientFor(teen.id);
    const childClient = await clientFor(child.id);
    // Get/select are exercised only far enough to confirm the server gate; no catalog network is needed.
    expect((await adminClient.get("/api/voice/catalog")).status).toBe(503);
    expect((await owner.get("/api/voice/catalog")).status).toBe(503);
    for (const member of [adultClient, teenClient, childClient]) {
      expect((await member.get("/api/voice/catalog")).status).toBe(403);
      expect((await member.post("/api/voice/catalog/select", { path: "en/example.wav" })).status).toBe(403);
    }
    expect((await adminClient.post("/api/voice/catalog/select", { path: "en/example.wav" })).status).toBe(503);
  });
});
