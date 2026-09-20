import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetTtsSupervisorForTests } from "@/lib/ttsSupervisor";
import { synthesizeSpeech } from "@/lib/tts";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { listIssues } from "@/lib/issues";
import { startStackFixture, IDENTITY_HEADERS, offlineResponse, type StackFixture } from "./stackFixture";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetTtsSupervisorForTests();
  __resetStackEngineForTests();
});

describe("lib/tts.ts synthesizeSpeech()", () => {
  test("returns a real WAV stream from the stub backend (no real engine in tests)", async () => {
    const result = await synthesizeSpeech("good morning");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contentType).toBe("audio/wav");
      const audio = new Uint8Array(await new Response(result.value.stream).arrayBuffer());
      expect(audio.byteLength).toBeGreaterThan(44); // header + some samples
    }
  });

  test("rejects an empty string", async () => {
    const result = await synthesizeSpeech("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  test("rejects a whitespace-only string", async () => {
    const result = await synthesizeSpeech("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  test("rejects text past the length cap", async () => {
    const result = await synthesizeSpeech("a".repeat(4_001));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });
});

describe("POST /api/tts", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/tts", { text: "hi" });
    expect(res.status).toBe(401);
  });

  test("returns real audio/wav bytes for a signed-in person", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/tts", { text: "good morning" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 4)).toString("ascii")).toBe("RIFF");
  });

  test("returns 400 with a code for empty text", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/tts", { text: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_input");
  });

  // A code review-adjacent gap this feature could otherwise hide: a test
  // only checking "the route returns 200 audio/wav" would pass even if
  // the route never looked at the signed-in person's own tts.voice_id
  // setting at all. `MAIPAI_TTS_URL` pointed at a one-off fixture (real
  // HTTP, not a mock of ttsSupervisor.ts) that records exactly what
  // `voice_url` it received proves this route actually resolves and
  // forwards the person's real choice, not just that a request succeeds.
  describe("resolving the signed-in person's own tts.voice_id", () => {
    let fixtureServer: ReturnType<typeof Bun.serve> | undefined;
    let receivedVoiceUrls: (string | null)[] = [];
    let originalTtsUrl: string | undefined;

    beforeEach(() => {
      receivedVoiceUrls = [];
      fixtureServer = Bun.serve({
        port: 0,
        fetch: async (req) => {
          const url = new URL(req.url);
          if (url.pathname === "/health") return Response.json({ status: "healthy" });
          const form = await req.formData();
          receivedVoiceUrls.push((form.get("voice_url") as string | null) ?? null);
          return new Response(new Uint8Array(44), { headers: { "content-type": "audio/wav" } });
        },
      });
      originalTtsUrl = process.env.MAIPAI_TTS_URL;
      process.env.MAIPAI_TTS_URL = `http://127.0.0.1:${fixtureServer.port}`;
      __resetTtsSupervisorForTests();
    });

    afterEach(() => {
      fixtureServer?.stop(true);
      if (originalTtsUrl === undefined) delete process.env.MAIPAI_TTS_URL;
      else process.env.MAIPAI_TTS_URL = originalTtsUrl;
      __resetTtsSupervisorForTests();
    });

    test("sends the registry default (alba) when the person never chose a voice", async () => {
      const owner = new TestClient();
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

      const res = await owner.post("/api/tts", { text: "hi" });
      expect(res.status).toBe(200);
      expect(receivedVoiceUrls).toEqual(["alba"]);
    });

    test("sends the person's own chosen voice, not the default", async () => {
      const owner = new TestClient();
      const { person } = (await (
        await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })
      ).json()) as { person: { id: string } };
      await owner.request("/api/settings", {
        method: "PUT",
        body: { scope: `person:${person.id}`, key: "tts.voice_id", value: "vera" },
      });

      const res = await owner.post("/api/tts", { text: "hi" });
      expect(res.status).toBe(200);
      expect(receivedVoiceUrls).toEqual(["vera"]);
    });

    test("two people each hear replies in their own chosen voice", async () => {
      const owner = new TestClient();
      const { person: ownerPerson } = (await (
        await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })
      ).json()) as { person: { id: string } };
      const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
      const { id: childId } = (await created.json()) as { id: string };
      const childClient = new TestClient();
      await childClient.post("/api/auth/select", { personId: childId });

      await owner.request("/api/settings", {
        method: "PUT",
        body: { scope: `person:${ownerPerson.id}`, key: "tts.voice_id", value: "estelle" },
      });
      await childClient.request("/api/settings", {
        method: "PUT",
        body: { scope: `person:${childId}`, key: "tts.voice_id", value: "jean" },
      });

      await owner.post("/api/tts", { text: "hi" });
      await childClient.post("/api/tts", { text: "hi" });
      expect(receivedVoiceUrls).toEqual(["estelle", "jean"]);
    });
  });
});

// HOME-STACK-02b: engines.stack.url set routes synthesizeSpeech() through
// the Stack's /v1/audio/speech (spec/voice's own form) instead of the
// locally-spawned Pocket TTS process.
describe("lib/tts.ts routed through a configured Stack", () => {
  let fixture: StackFixture;

  afterEach(() => {
    fixture?.stop();
  });

  test("streams the Stack's audio and forwards text/voice_url", async () => {
    const received: { text: string | null; voiceUrl: string | null } = { text: null, voiceUrl: null };
    fixture = startStackFixture({
      "POST /v1/audio/speech": async (req) => {
        const form = await req.formData();
        received.text = form.get("text") as string | null;
        received.voiceUrl = form.get("voice_url") as string | null;
        return new Response(new Uint8Array(44), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } });
      },
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const result = await synthesizeSpeech("good morning", "alba");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contentType).toBe("audio/wav");
      const audio = new Uint8Array(await new Response(result.value.stream).arrayBuffer());
      expect(audio.byteLength).toBe(44);
    }
    expect(received).toEqual({ text: "good morning", voiceUrl: "alba" });
  });

  test("a scripted 503 maps to unavailable and raises a Repairs entry carrying offline_reason", async () => {
    fixture = startStackFixture({
      "POST /v1/audio/speech": async () => offlineResponse("tts", "the tts engine process is not running"),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const result = await synthesizeSpeech("good morning");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.code).toBe("unavailable");
    }
    const issue = listIssues().find((i) => i.source === "stack" && i.key === "offline.tts");
    expect(issue?.detail).toBe("the tts engine process is not running");
  });
});
