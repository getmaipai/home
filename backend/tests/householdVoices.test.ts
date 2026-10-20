// VOICES-04: a voice made from a clip, end to end through the routes: who may make one, what the Stack is asked,
// what a person of each age sees, and what a saved choice (a person's or a robot's) sends to the speech engine.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { clonedVoicesDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { synthesizeSpeech } from "@/lib/tts";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, IDENTITY_HEADERS, type StackFixture } from "./stackFixture";

let fixture: StackFixture | undefined;
let speechForms: Array<Record<string, string>> = [];
let speechReply: () => Response = () => new Response(new Uint8Array(2048), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } });
const stackVoice = (id: string) => ({ id, name: id, description: "A voice", language: "en", country: "US", gender: "female", source: "preset", engine: "chatterbox-turbo", onDisk: true, licence: null, revision: "r1" });

beforeEach(() => {
  resetDb();
  if (existsSync(clonedVoicesDir)) for (const f of readdirSync(clonedVoicesDir)) rmSync(join(clonedVoicesDir, f), { force: true });
  speechForms = [];
  speechReply = () => new Response(new Uint8Array(2048), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } });
  fixture = startStackFixture({
    "GET /stack/v1/voices": () => Response.json({ voices: [stackVoice("chatterbox-turbo-voice-default")] }),
    "POST /v1/audio/speech": async (req) => {
      const form = await req.formData();
      speechForms.push(Object.fromEntries([...form.entries()].map(([name, value]) => [name, String(value)])));
      return speechReply();
    },
  });
  setHouseholdSettingValue("engines.stack.url", fixture.url);
  __setStackClientForTests(fixture.client);
});
afterEach(() => { fixture?.stop(); fixture = undefined; __resetStackEngineForTests(); });

const wav = (name = "clip.wav") => new File([new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])], name, { type: "audio/wav" });
async function household() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const make = async (displayName: string, role: string) => {
    const created = (await (await owner.post("/api/people", { displayName, role, secret: "0000" })).json()) as { id: string };
    const client = new TestClient();
    expect((await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" })).status).toBe(200);
    return { client, id: created.id };
  };
  return { owner, admin: await make("Marlow", "admin"), adult: await make("Bramble", "adult"), teen: await make("Nova", "teen"), child: await make("Poppy", "child") };
}
async function makeVoice(client: TestClient, fields: Record<string, string> = {}, file: File = wav()): Promise<Response> {
  const form = new FormData();
  form.set("label", fields.label ?? "Cutey");
  form.set("file", file);
  for (const [name, value] of Object.entries(fields)) if (name !== "label") form.set(name, value);
  return client.postForm("/api/voice/cloned", form);
}

describe("making a voice", () => {
  test("a member, teen and child are refused with 403 and nothing is stored; an admin and the owner can", async () => {
    const h = await household();
    for (const who of [h.adult, h.teen, h.child]) {
      const res = await makeVoice(who.client);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("Only an owner or an admin can make a voice.");
    }
    expect(((await (await h.owner.get("/api/voice/cloned")).json()) as { voices: unknown[] }).voices).toHaveLength(0);
    expect((await makeVoice(h.admin.client, { label: "By admin" })).status).toBe(201);
    expect((await makeVoice(h.owner, { label: "By owner" })).status).toBe(201);
  });

  test("temperature and pitch are stored, returned, and sent to the Stack with the first render; the voice is usable at once", async () => {
    const h = await household();
    const res = await makeVoice(h.owner, { temperature: "1.05", pitch_semitones: "-1" });
    expect(res.status).toBe(201);
    const made = (await res.json()) as { id: string; temperature: number; pitchSemitones: number };
    expect(made).toMatchObject({ temperature: 1.05, pitchSemitones: -1 });
    expect(made.id).toMatch(/^voice-[a-z0-9]+$/);
    expect(speechForms.at(-1)).toMatchObject({ voice_url: expect.stringContaining(`/api/voice/cloned/${made.id}/file`), temperature: "1.05", pitch_semitones: "-1" });
    // Previewing serves the first render from memory: the Stack is not asked again.
    const before = speechForms.length;
    const preview = await h.owner.post(`/api/voice/voices/${made.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("audio/wav");
    expect(speechForms).toHaveLength(before);
  });

  test("out-of-range values are refused with the plain message and no voice is kept", async () => {
    const h = await household();
    const hot = await makeVoice(h.owner, { temperature: "2.5" });
    expect(hot.status).toBe(400);
    expect(((await hot.json()) as { error: string }).error).toBe("The sampling temperature must be a number from 0.1 to 2.0.");
    const high = await makeVoice(h.owner, { pitch_semitones: "13" });
    expect(high.status).toBe(400);
    expect(((await high.json()) as { error: string }).error).toBe("The pitch offset must be a number from -12 to 12 semitones.");
    expect(((await (await h.owner.get("/api/voice/cloned")).json()) as { voices: unknown[] }).voices).toHaveLength(0);
  });

  test("a recording the engine refuses (too short) is not kept and the engine's words reach the person", async () => {
    const h = await household();
    speechReply = () => Response.json({ detail: "The reference recording must be 6 to 30 seconds long; this one is 4.0 seconds." }, { status: 400 });
    const res = await makeVoice(h.owner);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("6 to 30 seconds");
    expect(((await (await h.owner.get("/api/voice/cloned")).json()) as { voices: unknown[] }).voices).toHaveLength(0);
  });

  test("a recording in a format the engine cannot read is refused before it is stored", async () => {
    const h = await household();
    const res = await makeVoice(h.owner, {}, new File([new Uint8Array([1, 2, 3])], "clip.webm", { type: "audio/webm" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("WAV, MP3 or FLAC");
  });

  test("a Stack that is down does not undo the voice", async () => {
    const h = await household();
    speechReply = () => new Response("down", { status: 503 });
    expect((await makeVoice(h.owner)).status).toBe(201);
  });
});

describe("who sees and picks a voice made at home", () => {
  test("adults list it beside the Stack's voices; a teen and a child never see it, preview it or pick it", async () => {
    const h = await household();
    const made = (await (await makeVoice(h.owner)).json()) as { id: string };
    const ids = async (client: TestClient) => ((await (await client.get("/api/voice/voices")).json()) as { voices: Array<{ id: string }> }).voices.map((v) => v.id);
    expect(await ids(h.owner)).toContain(made.id);
    expect(await ids(h.adult.client)).toContain(made.id);
    expect(await ids(h.teen.client)).not.toContain(made.id);
    expect(await ids(h.child.client)).not.toContain(made.id);
    for (const who of [h.teen, h.child]) {
      expect((await who.client.post(`/api/voice/voices/${made.id}/preview`)).status).toBe(403);
      expect((await who.client.post(`/api/voice/cloned/${made.id}/select`, {})).status).toBe(403);
    }
    expect((await h.adult.client.post(`/api/voice/cloned/${made.id}/select`, {})).status).toBe(200);
  });

  test("a voice made at home is accepted as a robot's voice and as a person's, and a parent cannot give one to a child", async () => {
    const h = await household();
    const made = (await (await makeVoice(h.owner)).json()) as { id: string };
    const own = await h.owner.put("/api/settings", { scope: `person:${(await (await h.owner.get("/api/auth/me")).json() as { id: string }).id}`, key: "tts.voice_id", value: made.id });
    expect(own.status).toBe(200);
    const forChild = await h.owner.put("/api/settings", { scope: `person:${h.child.id}`, key: "tts.voice_id", value: made.id });
    expect([400, 403]).toContain(forChild.status);
  });
});

describe("speaking with a saved choice", () => {
  test("a saved household voice sends its clip address, temperature and pitch; a voice without them sends neither; the engine default sends no voice", async () => {
    const h = await household();
    const cutey = (await (await makeVoice(h.owner, { label: "Cutey", temperature: "1.05", pitch_semitones: "-1" })).json()) as { id: string };
    const plain = (await (await makeVoice(h.owner, { label: "Plain" })).json()) as { id: string };
    speechForms = [];
    expect((await synthesizeSpeech("Soooo hi", cutey.id)).ok).toBe(true);
    expect(speechForms.at(-1)).toMatchObject({ text: "Soooo hi", temperature: "1.05", pitch_semitones: "-1" });
    expect(speechForms.at(-1)!.voice_url).toContain(`/cloned/${cutey.id}/file`);
    expect((await synthesizeSpeech("hello", plain.id)).ok).toBe(true);
    expect(speechForms.at(-1)!.temperature).toBeUndefined();
    expect(speechForms.at(-1)!.pitch_semitones).toBeUndefined();
    expect((await synthesizeSpeech("hello", "default")).ok).toBe(true);
    expect(speechForms.at(-1)!.voice_url).toBeUndefined();
  });

  test("a zero pitch offset is sent as no shift at all", async () => {
    const h = await household();
    const flat = (await (await makeVoice(h.owner, { pitch_semitones: "0" })).json()) as { id: string };
    speechForms = [];
    await synthesizeSpeech("hello", flat.id);
    expect(speechForms.at(-1)!.pitch_semitones).toBeUndefined();
  });
});

describe("a robot's voice (robot.voice.id)", () => {
  test("a voice made at home can be chosen for a robot; the robot then speaks it for an adult, and a child gets the default", async () => {
    const h = await household();
    const made = (await (await makeVoice(h.owner, { label: "Cutey", temperature: "1.05" })).json()) as { id: string };
    const sage = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const { deviceId } = issueDeviceToken(sage.id, "robot", "Riff");
    const set = await h.owner.put("/api/settings", { scope: `device:${deviceId}`, key: "robot.voice.id", value: made.id });
    expect(set.status).toBe(200);
    expect(voiceForSpeech({ actor: sage, deviceId })).toBe(made.id);
    const poppy = db.select().from(people).where(eq(people.id, h.child.id)).get()!;
    expect(voiceForSpeech({ actor: poppy, deviceId })).not.toBe(made.id);
    // The speech seam turns the saved id into the clip address and the voice's own temperature.
    speechForms = [];
    await synthesizeSpeech("Hi", voiceForSpeech({ actor: sage, deviceId }));
    expect(speechForms.at(-1)).toMatchObject({ temperature: "1.05" });
  });

  test("a child whose own saved voice is a voice made at home still speaks the engine default", async () => {
    const h = await household();
    const made = (await (await makeVoice(h.owner)).json()) as { id: string };
    const { setPersonTtsVoiceUnchecked } = await import("@/lib/settings");
    const poppy = db.select().from(people).where(eq(people.id, h.child.id)).get()!;
    setPersonTtsVoiceUnchecked(poppy, made.id);
    expect(voiceForSpeech({ actor: poppy })).toBe("default");
  });
});
