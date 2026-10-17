import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { startStackFixture, type StackFixture } from "./stackFixture";

const voice = (id: string, onDisk = true, source = "preset") => ({ id, name: id, description: "A voice", language: "en", country: "US", gender: "female", source, onDisk, licence: null, revision: "r1" });
let fixture: StackFixture | undefined;

beforeEach(() => resetDb());
afterEach(() => { fixture?.stop(); fixture = undefined; __resetStackEngineForTests(); });

async function ownerClient() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}

function setupStack(voices = [voice("preset-1")], preview?: () => Response) {
  let renders = 0;
  const cached = new Map<string, string>();
  fixture = startStackFixture({
    "GET /stack/v1/voices": () => Response.json({ voices }),
    "POST /stack/v1/voices/preset-1/preview": () => {
      let wav = cached.get("preset-1");
      if (!wav) { renders++; wav = "RIFF-scripted-preview"; cached.set("preset-1", wav); }
      return preview?.() ?? new Response(wav, { headers: { "content-type": "audio/wav" } });
    },
    "POST /stack/v1/voices/community/preview": () => new Response("community-wav", { headers: { "content-type": "audio/wav" } }),
  });
  __setStackClientForTests(fixture.client);
  return { renderCount: () => renders, cached };
}

describe("POST /api/voice/voices/:id/preview", () => {
  test("preview of a voice on disk streams the Stack's WAV and sends a day-long private cache header", async () => {
    setupStack();
    const owner = await ownerClient();
    const response = await owner.post("/api/voice/voices/preset-1/preview");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(await response.text()).toBe("RIFF-scripted-preview");
    expect(fixture!.calls).toEqual(["GET /stack/v1/voices", "POST /stack/v1/voices/preset-1/preview"]);
  });

  test("preview of an unknown voice id answers 404 with the next step", async () => {
    setupStack();
    const owner = await ownerClient();
    const response = await owner.post("/api/voice/voices/missing/preview");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe("That voice is not on this home's list. Reload the page to see the current voices.");
    expect(fixture!.calls).toEqual(["GET /stack/v1/voices"]);
  });

  test("preview with the Stack down gives admins the Settings step and adults a person to ask", async () => {
    setupStack([voice("preset-1")], () => Response.json({ error: "raw token setting and outside host", reason: "offline" }, { status: 503 }));
    const owner = await ownerClient();
    const adultResponse = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adultId = (await adultResponse.json() as { id: string }).id;
    const adult = new TestClient(); await adult.post("/api/auth/verify-secret", { personId: adultId, secret: "0000" });
    const ownerResult = await owner.post("/api/voice/voices/preset-1/preview");
    const adultResult = await adult.post("/api/voice/voices/preset-1/preview");
    expect(ownerResult.status).toBe(503);
    expect(((await ownerResult.json()) as { error: string }).error).toContain("Open Settings, then Engines");
    expect(adultResult.status).toBe(503);
    const adultBody = (await adultResult.json()) as { error: string };
    expect(adultBody.error).toContain("Ask the person who manages Home");
    expect(JSON.stringify(adultBody)).not.toContain("raw token");
  });

  test("a Stack cloning refusal gets Home's safe Settings copy", async () => {
    setupStack([voice("preset-1")], () => Response.json({ error: "raw token setting and outside host", reason: "voice-cloning-unavailable" }, { status: 409 }));
    const owner = await ownerClient();
    const response = await owner.post("/api/voice/voices/preset-1/preview");
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Open Settings, then Engines");
    expect(body.error).not.toContain("raw token");
    expect(body.error).not.toContain("outside host");
  });

  test("an uninstalled voice can only be downloaded by an owner or admin", async () => {
    setupStack([voice("preset-1", false)]);
    const owner = await ownerClient();
    const adultResult = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = new TestClient(); await adult.post("/api/auth/verify-secret", { personId: (await adultResult.json() as { id: string }).id, secret: "0000" });
    const response = await adult.post("/api/voice/voices/preset-1/preview");
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe("This voice is not on this home yet. Ask the person who manages Home to add it.");
    expect(fixture!.calls).toEqual(["GET /stack/v1/voices"]);
  });

  test("an owner downloads an uninstalled preset through the Stack preview endpoint", async () => {
    setupStack([voice("preset-1", false)]);
    const owner = await ownerClient();
    const response = await owner.post("/api/voice/voices/preset-1/preview");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("RIFF-scripted-preview");
    expect(fixture!.calls).toEqual(["GET /stack/v1/voices", "POST /stack/v1/voices/preset-1/preview"]);
  });

  test("a child cannot preview a non-preset voice", async () => {
    setupStack([voice("community", true, "community")]);
    const owner = await ownerClient();
    const childResponse = await owner.post("/api/people", { displayName: "Robin", role: "child" });
    const child = new TestClient(); await child.post("/api/auth/select", { personId: (await childResponse.json() as { id: string }).id });
    const response = await child.post("/api/voice/voices/community/preview");
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toContain("Ask the person who manages Home");
    expect(fixture!.calls).toEqual(["GET /stack/v1/voices"]);
  });

  test("a signed-out caller gets 401", async () => {
    setupStack();
    expect((await new TestClient().post("/api/voice/voices/preset-1/preview")).status).toBe(401);
    expect(fixture!.calls).toEqual([]);
  });

  test("the route only uses voices and voicePreview, and a second preview comes from the Stack cache", async () => {
    const cache = setupStack();
    const owner = await ownerClient();
    const first = await owner.post("/api/voice/voices/preset-1/preview");
    const firstBytes = await first.text();
    const second = await owner.post("/api/voice/voices/preset-1/preview");
    expect(await second.text()).toBe(firstBytes);
    expect(cache.renderCount()).toBe(1);
    expect(fixture!.calls).toEqual([
      "GET /stack/v1/voices", "POST /stack/v1/voices/preset-1/preview",
      "GET /stack/v1/voices", "POST /stack/v1/voices/preset-1/preview",
    ]);
    expect(await Bun.file("/Users/jessetorres/Developer/github.com/getmaipai/stack/backend/src/routes/voices.ts").text()).toContain('join(dataDir, "voice-previews")');
  });

  test("the Home handler has no model-download or fetch-to-disk imports", () => {
    const source = readFileSync(new URL("../src/routes/voice.ts", import.meta.url), "utf8");
    const previewHandler = source.slice(source.indexOf("voiceRoutes.openapi(voicePreviewRoute"), source.indexOf("// What the browser pipeline"));
    expect(previewHandler).not.toMatch(/pullModel|installCatalogModel|downloadUrl|fetchToDisk|fetch\s*\(/i);
  });
});
