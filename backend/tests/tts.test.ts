import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { synthesizeSpeech } from "@/lib/tts";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { listIssues } from "@/lib/issues";
import { startStackFixture, IDENTITY_HEADERS, offlineResponse, type StackFixture } from "./stackFixture";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __setStackClientForTests(null);
});

afterEach(() => {
  __resetStackEngineForTests();
});

describe("lib/tts.ts synthesizeSpeech()", () => {
  test("requires the Stack", async () => {
    const result = await synthesizeSpeech("good morning");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
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

  test("returns 400 with a code for empty text", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/tts", { text: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_input");
  });

  describe("resolving the signed-in person's own tts.voice_id through the Stack", () => {
    let fixture: StackFixture;
    let receivedVoiceUrls: (string | null)[] = [];

    beforeEach(() => {
      receivedVoiceUrls = [];
      fixture = startStackFixture({
        "POST /v1/audio/speech": async (req) => {
          const form = await req.formData();
          receivedVoiceUrls.push((form.get("voice_url") as string | null) ?? null);
          return new Response(new Uint8Array(44), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } });
        },
      });
      setHouseholdSettingValue("engines.stack.url", fixture.url);
      __setStackClientForTests(fixture.client);
    });

    afterEach(() => {
      fixture.stop();
      __resetStackEngineForTests();
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

  test("configured Stack serves speech regardless of the retired switch", async () => {
    let calls = 0;
    fixture = startStackFixture({ "POST /v1/audio/speech": async () => { calls++; return new Response(new Uint8Array(44)); } });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    const result = await synthesizeSpeech("good morning");
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
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
