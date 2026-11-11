import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetVoiceCatalogForTests, type VoiceCatalogEntry } from "@/lib/voiceCatalog";
import { buildVoiceLibrary, searchVoiceLibrary } from "@/lib/voiceLibrary";

const entries: VoiceCatalogEntry[] = [
  { path: "vctk/p225_023.wav", collection: "vctk" },
  { path: "vctk/p225_023_enhanced.wav", collection: "vctk" },
  { path: "vctk/p226_023.wav", collection: "vctk" },
  { path: "vctk/p280_023.wav", collection: "vctk" },
  { path: "expresso/p225_023.wav", collection: "expresso" },
];

function catalogServer(paths = entries.map((e) => e.path)) {
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response(JSON.stringify(paths.map((path) => ({ type: "file", path }))), { headers: { "content-type": "application/json" } });
  } });
}

beforeEach(() => { resetDb(); __resetRateLimiterForTests(); __resetVoiceCatalogForTests(); });
afterEach(() => { delete process.env.MAIPAI_VOICE_CATALOG_URL; delete process.env.MAIPAI_VOICE_SAMPLE_BASE; __resetVoiceCatalogForTests(); });

describe("voice library builder", () => {
  test("prefers enhanced, skips absent and excluded collections, and emits plain unique names", () => {
    const voices = buildVoiceLibrary(entries);
    expect(voices).toHaveLength(3); // p225, p226, p280; expresso is never included
    const p225 = voices.find((v) => v.id.includes("p225"))!;
    expect(p225.quality).toBe("best");
    expect(p225.id).toBe("vctk/p225_023_enhanced.wav");
    expect(voices.every((v) => !/p\d+|\.wav/i.test(`${v.name} ${v.detail}`))).toBe(true);
    expect(new Set(voices.map((v) => v.name)).size).toBe(voices.length);
    expect(voices.find((v) => v.id.includes("p280"))?.name).toContain("accent not recorded");
    expect(voices.find((v) => v.id.includes("p225"))?.country).toBe("GB");
    expect(voices.find((v) => v.id.includes("p226"))?.countryName).toBe("England");
  });

  test("search and filters combine case-insensitively", () => {
    const voices = buildVoiceLibrary(entries);
    expect(searchVoiceLibrary(voices, { q: "ENGLAND", gender: "man" })).toHaveLength(1);
    expect(searchVoiceLibrary(voices, { language: "en", country: "GB", quality: "best" })).toHaveLength(1);
    expect(searchVoiceLibrary(voices, { q: "accent not recorded", country: "GB" })).toHaveLength(0);
  });
});

describe("voice library routes", () => {
  test("requires owner or admin and returns the catalog-backed library", async () => {
    const server = catalogServer();
    process.env.MAIPAI_VOICE_CATALOG_URL = `http://127.0.0.1:${server.port}/tree`;
    try {
      const owner = new TestClient();
      const setup = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
      expect(setup.status).toBe(201);
      const add = await owner.post("/api/people", { displayName: "Alex", role: "adult", secret: "alexsecret1" });
      expect(add.status).toBe(201);
      const member = new TestClient();
      await member.post("/api/auth/verify-secret", { personId: (await add.json() as { id: string }).id, secret: "alexsecret1" });
      expect((await member.get("/api/voice/library")).status).toBe(403);
      const res = await owner.get("/api/voice/library");
      expect(res.status).toBe(200);
      expect((await res.json() as { voices: unknown[] }).voices.length).toBe(3);
      expect(setup.status).toBe(201);
    } finally { server.stop(true); }
  });

  test("rejects non-VCTK and uncatalogued paths, then streams a real catalog sample", async () => {
    const cat = catalogServer();
    const sample = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
      return new Response(`sample:${new URL(req.url).pathname}`, { headers: { "content-type": "audio/wav" } });
    } });
    process.env.MAIPAI_VOICE_CATALOG_URL = `http://127.0.0.1:${cat.port}/tree`;
    process.env.MAIPAI_VOICE_SAMPLE_BASE = `http://127.0.0.1:${sample.port}/resolve/main`;
    try {
      const owner = new TestClient();
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
      expect((await owner.get("/api/voice/library/sample?path=expresso%2Fclip.wav")).status).toBe(400);
      expect((await owner.get("/api/voice/library/sample?path=vctk%2Fp999_023.wav")).status).toBe(404);
      const path = "vctk/p225_023.wav";
      const res = await owner.get(`/api/voice/library/sample?path=${encodeURIComponent(path)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/wav");
      expect(await res.text()).toContain("/resolve/main/vctk/p225_023.wav");
    } finally { cat.stop(true); sample.stop(true); }
  });
});
