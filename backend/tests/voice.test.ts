import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { getTtsBackendKind, getTtsClient, __resetTtsSupervisorForTests } from "@/lib/ttsSupervisor";
import { clonedVoicesDir } from "@/lib/paths";

function resetClonedVoicesDir(): void {
  if (!existsSync(clonedVoicesDir)) return;
  for (const f of readdirSync(clonedVoicesDir)) rmSync(join(clonedVoicesDir, f), { force: true });
}

beforeEach(() => {
  resetDb();
  resetClonedVoicesDir();
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

function wavFile(name = "sample.wav"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "audio/wav" });
}

describe("cloned voices", () => {
  test("GET /api/voice/cloned requires sign-in", async () => {
    const res = await new TestClient().get("/api/voice/cloned");
    expect(res.status).toBe(401);
  });

  test("uploads, lists household-wide, selects, and deletes a real cloned voice", async () => {
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });

    const form = new FormData();
    form.set("label", "Dad's voice");
    form.set("file", wavFile());
    const uploadRes = await owner.postForm("/api/voice/cloned", form);
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as { id: string; label: string; creatorName: string };
    expect(uploaded.label).toBe("Dad's voice");
    expect(uploaded.creatorName).toBe("Sage");

    // Household-wide: the adult who didn't upload it can still see it.
    const listRes = await adultClient.get("/api/voice/cloned");
    const { voices } = (await listRes.json()) as { voices: { id: string }[] };
    expect(voices.map((v) => v.id)).toContain(uploaded.id);

    // Selecting sets the SELECTING person's own tts.voice_id, not the
    // creator's.
    const selectRes = await adultClient.post(`/api/voice/cloned/${uploaded.id}/select`, {});
    expect(selectRes.status).toBe(200);
    const selected = (await selectRes.json()) as { value: string };
    expect(selected.value).toMatch(new RegExp(`/api/voice/cloned/${uploaded.id}/file$`));

    // The file-serving route is real and unauthenticated - exactly what
    // a separate pocket-tts process fetching by plain URL needs.
    const fileRes = await new TestClient().get(`/api/voice/cloned/${uploaded.id}/file`);
    expect(fileRes.status).toBe(200);
    // Bun's own multipart parser reports "sample.wav" as "audio/x-wav",
    // not the "audio/wav" the File() constructor was given - both are
    // real wav mime types EXTENSION_BY_MIME already treats identically.
    expect(fileRes.headers.get("content-type")).toMatch(/^audio\/(x-)?wav$/);

    // The adult (not the creator) can't delete it...
    const forbiddenDelete = await adultClient.post(`/api/voice/cloned/${uploaded.id}/delete`, {});
    expect(forbiddenDelete.status).toBe(403);
    // ...but the owner (also not the creator here, but owner/admin) can.
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
