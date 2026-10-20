import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { synthesizeSpeech } from "@/lib/tts";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { __setTtsTagsForTests } from "@/lib/ttsCapabilities";
import { __setOfferedVoicesForTests } from "@/lib/voiceResolve";
import { renderClipBundle } from "@/lib/robotClips";
import type { StackVoice } from "@/lib/stack/types";
import { turnAllowsVoiceCues } from "@/routes/turn";
import { listIssues } from "@/lib/issues";
import { startStackFixture, IDENTITY_HEADERS, offlineResponse, type StackFixture } from "./stackFixture";
import { issueDeviceToken } from "@/lib/deviceTokens";

beforeEach(() => {
  __setTtsTagsForTests(null);
  resetDb();
  setHouseholdSettingValue("home.robots.enabled", true);
  __resetThrottleForTests();
  __setStackClientForTests(null);
});

afterEach(() => {
  __resetStackEngineForTests();
});

describe("lib/tts.ts synthesizeSpeech()", () => {
  test("tts answers 503 with problem plus next step when the Stack is down", async () => {
    const result = await synthesizeSpeech("good morning");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.code).toBe("unavailable");
      expect(result.error).toBe("Home can't speak right now because its voice engine is not running. Read the reply on screen and try again in a minute. If it keeps happening, an owner or admin can check Repairs.");
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

    test("sends no voice (the engine's own default) when the person never chose one", async () => {
      const owner = new TestClient();
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

      const res = await owner.post("/api/tts", { text: "hi" });
      expect(res.status).toBe(200);
      expect(receivedVoiceUrls).toEqual([null]);
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

    afterEach(() => __setOfferedVoicesForTests(undefined));

    async function pairedRobot(personId: string) {
      const minted = issueDeviceToken(personId, "robot", "Voice robot", ["speaker", "no_vendor_login"]);
      const robot = new TestClient();
      expect((await robot.post("/api/auth/devices/redeem", { token: minted.token })).status).toBe(200);
      return { robot, deviceId: minted.deviceId };
    }

    async function setRobotVoice(owner: TestClient, deviceId: string, voice: string) {
      const listed = ["mira", "community-voice", "vera", "alba"].map((name): StackVoice => ({ id: `pocket-tts-voice-${name}`, name, description: "", language: "en", country: "", gender: "unknown", source: "preset", engine: "pocket", onDisk: true, licence: null, revision: "test" }));
      fixture.client.voices = async () => listed;
      __setOfferedVoicesForTests(listed);
      const result = await owner.put("/api/settings", { scope: `device:${deviceId}`, key: "robot.voice.id", value: voice });
      expect(result.status).toBe(200);
      // A voice change re-renders the robot's clips; let that finish so only the turn's synthesis is counted.
      await renderClipBundle(deviceId).catch(() => null);
      receivedVoiceUrls = [];
    }

    test("a robot's listed device voice is sent to speech synthesis", async () => {
      const owner = new TestClient();
      const { person } = (await (await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json()) as { person: { id: string } };
      const { robot, deviceId } = await pairedRobot(person.id);
      await setRobotVoice(owner, deviceId, "mira");
      expect((await robot.post("/api/tts", { text: "hi" })).status).toBe(200);
      expect(receivedVoiceUrls).toEqual(["mira"]);
    });

    test("robot voice default keeps the person's selected voice", async () => {
      const owner = new TestClient();
      const { person } = (await (await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json()) as { person: { id: string } };
      await owner.put("/api/settings", { scope: `person:${person.id}`, key: "tts.voice_id", value: "vera" });
      const { robot, deviceId } = await pairedRobot(person.id);
      await setRobotVoice(owner, deviceId, "default");
      expect((await robot.post("/api/tts", { text: "hi" })).status).toBe(200);
      expect(receivedVoiceUrls).toEqual(["vera"]);
    });

    test("a child's robot ignores a non-preset device voice", async () => {
      const owner = new TestClient();
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
      const { id: childId } = (await (await owner.post("/api/people", { displayName: "Bramble", role: "child" })).json()) as { id: string };
      await owner.put("/api/settings", { scope: `person:${childId}`, key: "tts.voice_id", value: "alba" });
      const { robot, deviceId } = await pairedRobot(childId);
      await setRobotVoice(owner, deviceId, "community-voice");
      expect((await robot.post("/api/tts", { text: "hi" })).status).toBe(200);
      expect(receivedVoiceUrls).toEqual(["alba"]);
    });

    test.each(["child", "teen"] as const)("a %s robot speaks with a full Stack preset id", async (role) => {
      const owner = new TestClient();
      await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
      const { id } = (await (await owner.post("/api/people", { displayName: `Profile ${role}`, role })).json()) as { id: string };
      const { robot, deviceId } = await pairedRobot(id);
      fixture.client.voices = async () => [{ id: "pocket-tts-voice-alba", name: "Alba", description: "", language: "en", country: "", gender: "unknown", source: "preset", engine: "pocket", onDisk: true, licence: null, revision: "test" }];
      __setOfferedVoicesForTests([{ id: "pocket-tts-voice-alba", name: "Alba", description: "", language: "en", country: "", gender: "unknown", source: "preset", engine: "pocket", onDisk: true, licence: null, revision: "test" }]);
      await owner.put("/api/settings", { scope: `device:${deviceId}`, key: "robot.voice.id", value: "pocket-tts-voice-alba" });
      await renderClipBundle(deviceId).catch(() => null);
      receivedVoiceUrls = [];
      expect((await robot.post("/api/tts", { text: "hi" })).status).toBe(200);
      expect(receivedVoiceUrls).toEqual(["pocket-tts-voice-alba"]);
    });

    test("a person session does not use a robot's voice setting", async () => {
      const owner = new TestClient();
      const { person } = (await (await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json()) as { person: { id: string } };
      await owner.put("/api/settings", { scope: `person:${person.id}`, key: "tts.voice_id", value: "vera" });
      expect((await owner.post("/api/tts", { text: "hi" })).status).toBe(200);
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
      await owner.request("/api/settings", {
        method: "PUT",
        body: { scope: `person:${childId}`, key: "tts.voice_id", value: "alba" },
      });

      await owner.post("/api/tts", { text: "hi" });
      await childClient.post("/api/tts", { text: "hi" });
      expect(receivedVoiceUrls).toEqual(["estelle", "alba"]);
    });

    // VOICE-PICK-01: the live bug. Javert was saved while Pocket spoke; Chatterbox offers one voice.
    describe("a saved voice the engine in use does not offer", () => {
      const chatterbox = [{ id: "chatterbox-turbo-voice-default", name: "Chatterbox default", description: "unknown", language: "en", country: "unknown", gender: "unknown", source: "preset", engine: "chatterbox-turbo", onDisk: true, licence: null, revision: "r" }] as StackVoice[];
      afterEach(() => __setOfferedVoicesForTests(undefined));
      async function ownerWithVoice(value: string) {
        const owner = new TestClient();
        const { person } = (await (await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).json()) as { person: { id: string } };
        const put = await owner.request("/api/settings", { method: "PUT", body: { scope: `person:${person.id}`, key: "tts.voice_id", value } });
        expect(put.status).toBe(200);
        return owner;
      }
      test("javert is not sent to Chatterbox; the next reply is spoken with the engine default", async () => {
        __setOfferedVoicesForTests(chatterbox);
        const owner = await ownerWithVoice("javert");
        expect((await owner.post("/api/tts", { text: "hi" })).status).toBe(200);
        expect(receivedVoiceUrls).toEqual([null]);
      });
      test("choosing the default voice saves and is spoken as the engine default", async () => {
        __setOfferedVoicesForTests(chatterbox);
        const owner = await ownerWithVoice("default");
        await owner.post("/api/tts", { text: "hi" });
        expect(receivedVoiceUrls).toEqual([null]);
      });
      test("a voice the engine offers is still sent by name", async () => {
        __setOfferedVoicesForTests([{ ...chatterbox[0]!, id: "pocket-tts-voice-javert", engine: "pocket" }]);
        const owner = await ownerWithVoice("javert");
        await owner.post("/api/tts", { text: "hi" });
        expect(receivedVoiceUrls).toEqual(["javert"]);
      });
      test("a reference voice id the Stack offers can be saved and is sent; an address cannot be saved", async () => {
        __setOfferedVoicesForTests([...chatterbox, { ...chatterbox[0]!, id: "chatterbox-ref-nova" }]);
        const owner = await ownerWithVoice("chatterbox-ref-nova");
        await owner.post("/api/tts", { text: "hi" });
        expect(receivedVoiceUrls).toEqual(["chatterbox-ref-nova"]);
        const bad = await owner.request("/api/settings", { method: "PUT", body: { scope: "person:x", key: "tts.voice_id", value: "http://192.0.2.1/x.wav" } });
        expect(bad.status).not.toBe(200);
      });
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
    __setStackClientForTests(fixture.client);
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
      expect(result.error).toBe("Home can't speak right now because its voice engine is not running. Read the reply on screen and try again in a minute. If it keeps happening, an owner or admin can check Repairs.");
    }
    const issue = listIssues().find((i) => i.source === "stack" && i.key === "offline.tts");
    expect(issue?.detail).toBe("the tts engine process is not running");
  });
});

// REG-02: tags reach only an engine that honors them, and the speech route never invents a cue without a spoken model turn.
describe("REG-02 spoken cues", () => {
  let fixture: StackFixture;
  let receivedText: string[] = [];

  beforeEach(() => {
    receivedText = [];
    fixture = startStackFixture({
      "POST /v1/audio/speech": async (req) => {
        receivedText.push(String((await req.formData()).get("text")));
        return new Response(new Uint8Array(44), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } });
      },
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);
  });
  afterEach(() => { fixture.stop(); __setTtsTagsForTests(null); });

  test("regression: an engine with no tags never receives [laugh]", async () => {
    __setTtsTagsForTests([]);
    await synthesizeSpeech("That was funny [laugh] indeed.", "alba");
    expect(receivedText).toEqual(["That was funny indeed."]);
  });

  test("an engine that honors laugh receives it, and an unlisted tag is dropped", async () => {
    __setTtsTagsForTests(["laugh"]);
    await synthesizeSpeech("That was funny [laugh] indeed [burp].", "alba");
    expect(receivedText).toEqual(["That was funny [laugh] indeed."]);
  });

  test("a turn id that is not a live spoken turn of this person allows no cue", () => {
    expect(turnAllowsVoiceCues("no-such-turn", "someone")).toBe(false);
  });

  test("POST /api/tts leaves the text untouched when the turn is not a live spoken turn", async () => {
    __setTtsTagsForTests(["laugh"]);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const line = "That joke was honestly pretty funny.";
    const res = await owner.post("/api/tts", { text: line, turn_id: "no-such-turn", generation: 0 });
    expect(res.status).toBe(200);
    expect(receivedText).toEqual([line]);
  });

  test("voice.hesitations defaults to light and takes off, light, natural only", () => {
    expect(getHouseholdSettingValue("voice.hesitations")).toBe("light");
    expect(setHouseholdSettingValue("voice.hesitations", "natural").ok).toBe(true);
    expect(setHouseholdSettingValue("voice.hesitations", "loud").ok).toBe(false);
  });
});
