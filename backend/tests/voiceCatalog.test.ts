import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { getVoiceCatalog, isVoiceCatalogPath, __resetVoiceCatalogForTests } from "@/lib/voiceCatalog";

// A real local HTTP server (not a mocked fetch), the same "prove the real
// mechanism" standard this repo's other download/fetch modules already
// hold to: fetchFullCatalog()'s `Link`-header pagination is real logic
// worth exercising against genuine HTTP responses, not just asserted from
// reading the code. Three real pages, matching the real upstream shape
// confirmed live (2026-09-04): a `Link: <...>; rel="next"` header on
// every page but the last.
function makeFixtureServer() {
  const pages = [
    [
      { type: "file", path: "vctk/p1.wav" },
      { type: "directory", path: "vctk" }, // directories must be filtered out
      { type: "file", path: "notes.md" }, // non-voice extensions must be filtered out
    ],
    [{ type: "file", path: "expresso/e1.safetensors" }],
    [{ type: "file", path: "ears/p10/clip.mp3" }],
  ];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const page = Number(url.searchParams.get("page") ?? "0");
      const isLast = page >= pages.length - 1;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (!isLast) {
        headers["link"] = `<http://127.0.0.1:${server.port}/tree?page=${page + 1}>; rel="next"`;
      }
      return new Response(JSON.stringify(pages[page] ?? []), { headers });
    },
  });
  return server;
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetVoiceCatalogForTests();
});

describe("lib/voiceCatalog.ts getVoiceCatalog()", () => {
  test("follows real Link-header pagination across all pages and filters non-voice entries", async () => {
    const server = makeFixtureServer();
    const original = process.env.MAIPAI_VOICE_CATALOG_URL;
    process.env.MAIPAI_VOICE_CATALOG_URL = `http://127.0.0.1:${server.port}/tree?page=0`;
    try {
      const entries = await getVoiceCatalog();
      expect(entries.map((e) => e.path).sort()).toEqual(
        ["ears/p10/clip.mp3", "expresso/e1.safetensors", "vctk/p1.wav"].sort(),
      );
      // Directories and non-voice files (notes.md) were real entries in
      // the fixture response - never silently smuggled through.
      expect(entries.some((e) => e.path === "vctk")).toBe(false);
      expect(entries.some((e) => e.path === "notes.md")).toBe(false);
    } finally {
      server.stop(true);
      if (original === undefined) delete process.env.MAIPAI_VOICE_CATALOG_URL;
      else process.env.MAIPAI_VOICE_CATALOG_URL = original;
    }
  });

  test("groups each entry under its top-level collection", async () => {
    const server = makeFixtureServer();
    const original = process.env.MAIPAI_VOICE_CATALOG_URL;
    process.env.MAIPAI_VOICE_CATALOG_URL = `http://127.0.0.1:${server.port}/tree?page=0`;
    try {
      const entries = await getVoiceCatalog();
      const ears = entries.find((e) => e.path === "ears/p10/clip.mp3");
      expect(ears?.collection).toBe("ears");
    } finally {
      server.stop(true);
      if (original === undefined) delete process.env.MAIPAI_VOICE_CATALOG_URL;
      else process.env.MAIPAI_VOICE_CATALOG_URL = original;
    }
  });

  test("a second call within the cache window never refetches", async () => {
    let requestCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        requestCount++;
        return new Response(JSON.stringify([{ type: "file", path: "vctk/p1.wav" }]), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    const original = process.env.MAIPAI_VOICE_CATALOG_URL;
    process.env.MAIPAI_VOICE_CATALOG_URL = `http://127.0.0.1:${server.port}/tree`;
    try {
      await getVoiceCatalog();
      const firstCount = requestCount;
      await getVoiceCatalog();
      expect(requestCount).toBe(firstCount); // cached, no new requests
    } finally {
      server.stop(true);
      if (original === undefined) delete process.env.MAIPAI_VOICE_CATALOG_URL;
      else process.env.MAIPAI_VOICE_CATALOG_URL = original;
    }
  });
});

describe("isVoiceCatalogPath", () => {
  test("true for a real entry, false for anything else", () => {
    const entries = [{ path: "vctk/p1.wav", collection: "vctk" }];
    expect(isVoiceCatalogPath(entries, "vctk/p1.wav")).toBe(true);
    expect(isVoiceCatalogPath(entries, "vctk/does-not-exist.wav")).toBe(false);
    expect(isVoiceCatalogPath(entries, "../../etc/passwd")).toBe(false);
  });
});

describe("GET /api/voice/catalog", () => {
  test("requires a signed-in person", async () => {
    const res = await new TestClient().get("/api/voice/catalog");
    expect(res.status).toBe(401);
  });

  test("returns the real fetched catalog", async () => {
    const server = makeFixtureServer();
    const original = process.env.MAIPAI_VOICE_CATALOG_URL;
    process.env.MAIPAI_VOICE_CATALOG_URL = `http://127.0.0.1:${server.port}/tree?page=0`;
    try {
      const owner = new TestClient();
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
      const res = await owner.get("/api/voice/catalog");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: { path: string }[] };
      expect(body.entries.some((e) => e.path === "vctk/p1.wav")).toBe(true);
    } finally {
      server.stop(true);
      if (original === undefined) delete process.env.MAIPAI_VOICE_CATALOG_URL;
      else process.env.MAIPAI_VOICE_CATALOG_URL = original;
    }
  });
});

describe("POST /api/voice/catalog/select", () => {
  test("requires a signed-in person", async () => {
    const res = await new TestClient().post("/api/voice/catalog/select", { path: "vctk/p1.wav" });
    expect(res.status).toBe(401);
  });

  test("rejects a path that isn't a real catalog entry", async () => {
    const server = makeFixtureServer();
    const original = process.env.MAIPAI_VOICE_CATALOG_URL;
    process.env.MAIPAI_VOICE_CATALOG_URL = `http://127.0.0.1:${server.port}/tree?page=0`;
    try {
      const owner = new TestClient();
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
      const res = await owner.post("/api/voice/catalog/select", { path: "not/a/real/file.wav" });
      expect(res.status).toBe(400);
    } finally {
      server.stop(true);
      if (original === undefined) delete process.env.MAIPAI_VOICE_CATALOG_URL;
      else process.env.MAIPAI_VOICE_CATALOG_URL = original;
    }
  });

  test("a real catalog pick is written to the signed-in person's own tts.voice_id", async () => {
    const server = makeFixtureServer();
    const original = process.env.MAIPAI_VOICE_CATALOG_URL;
    process.env.MAIPAI_VOICE_CATALOG_URL = `http://127.0.0.1:${server.port}/tree?page=0`;
    try {
      const owner = new TestClient();
      const { person } = (await (
        await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })
      ).json()) as { person: { id: string } };

      const select = await owner.post("/api/voice/catalog/select", { path: "vctk/p1.wav" });
      expect(select.status).toBe(200);

      const settings = await owner.get(`/api/settings?scope=person:${person.id}`);
      const body = (await settings.json()) as Array<{ key: string; value: unknown }>;
      const voice = body.find((s) => s.key === "tts.voice_id");
      expect(voice?.value).toBe("hf://kyutai/tts-voices/vctk/p1.wav");
    } finally {
      server.stop(true);
      if (original === undefined) delete process.env.MAIPAI_VOICE_CATALOG_URL;
      else process.env.MAIPAI_VOICE_CATALOG_URL = original;
    }
  });

  // The whole point of the escape hatch: the generic PUT /api/settings
  // route must still reject this exact same value for tts.voice_id,
  // proving the bypass is real (routes/voice.ts's dedicated path) and
  // not an accidental widening of the key's normal validation.
  test("the same value is still rejected through the generic settings PUT route", async () => {
    const owner = new TestClient();
    const { person } = (await (
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })
    ).json()) as { person: { id: string } };
    const res = await owner.request("/api/settings", {
      method: "PUT",
      body: {
        scope: `person:${person.id}`,
        key: "tts.voice_id",
        value: "hf://kyutai/tts-voices/vctk/p1.wav",
      },
    });
    expect(res.status).toBe(400);
  });
});
