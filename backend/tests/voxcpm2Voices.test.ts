// VOICE-VOXCPM2-01: the voice engine choice (admin only, kept by the Stack) and clip voices on VoxCPM2:
// they are still offered, and the clip's own words travel to the Stack as `voice_text` when Home has them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { clonedVoices } from "@/db/schema";
import { clonedVoicesDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { synthesizeSpeech } from "@/lib/tts";
import { __setClonedVoiceTranscriberForTests } from "@/lib/clonedVoiceTranscript";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, IDENTITY_HEADERS, type StackFixture } from "./stackFixture";

let fixture: StackFixture | undefined;
let engine = "voxcpm2";
let inEffect = "auto";
let pending: string | null = null;
let stackSettingsPut: Array<Record<string, unknown>> = [];
let speechForms: Array<Record<string, string>> = [];
const stackVoice = (id: string, voiceEngine: string) => ({ id, name: id, description: "A voice", language: "en", country: "US", gender: "female", source: "preset", engine: voiceEngine, onDisk: true, licence: null, revision: "r1" });
const settingsBody = () => ({ sections: [], settings: [{ key: "stack.voice.engine", scope: "device", selector: "select", default: "auto", label: "Voice engine", level: "basic", lives_in: "stack", honoured_by: ["home"], needs_restart: true, in_effect: inEffect, pending }] });

beforeEach(() => {
  resetDb();
  if (existsSync(clonedVoicesDir)) for (const f of readdirSync(clonedVoicesDir)) rmSync(join(clonedVoicesDir, f), { force: true });
  engine = "voxcpm2"; inEffect = "auto"; pending = null; stackSettingsPut = []; speechForms = [];
  __setClonedVoiceTranscriberForTests(async () => "hello there");
  fixture = startStackFixture({
    "GET /stack/v1/voices": () => Response.json({ voices: [stackVoice("voxcpm2-default", engine)] }),
    "GET /stack/v1/settings": () => Response.json(settingsBody()),
    "PUT /stack/v1/settings": async (req) => {
      const values = (await req.json()) as Record<string, unknown>;
      stackSettingsPut.push(values);
      pending = String(values["stack.voice.engine"]);
      return Response.json(settingsBody());
    },
    "POST /stack/v1/settings/apply": () => { inEffect = pending ?? inEffect; pending = null; return Response.json(settingsBody()); },
    "POST /v1/audio/speech": async (req) => {
      const form = await req.formData();
      speechForms.push(Object.fromEntries([...form.entries()].map(([name, value]) => [name, String(value)])));
      return new Response(new Uint8Array(2048), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } });
    },
  });
  setHouseholdSettingValue("engines.stack.url", fixture.url);
  __setStackClientForTests(fixture.client);
});
afterEach(() => { fixture?.stop(); fixture = undefined; __setClonedVoiceTranscriberForTests(null); __resetStackEngineForTests(); });

const wav = () => new File([new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])], "clip.wav", { type: "audio/wav" });
async function household() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const created = (await (await owner.post("/api/people", { displayName: "Bramble", role: "adult", secret: "0000" })).json()) as { id: string };
  const adult = new TestClient();
  expect((await adult.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" })).status).toBe(200);
  return { owner, adult };
}
async function makeVoice(client: TestClient): Promise<{ id: string }> {
  const form = new FormData();
  form.set("label", "Cutey");
  form.set("file", wav());
  const res = await client.postForm("/api/voice/cloned", form);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}
const listed = async (client: TestClient) => ((await (await client.get("/api/voice/voices")).json()) as { voices: Array<{ id: string; engine?: string }> }).voices;

describe("clip voices on VoxCPM2", () => {
  test("a clip voice is offered beside either VoxCPM2 size and labelled with that engine, and not beside Pocket", async () => {
    const h = await household();
    const made = await makeVoice(h.owner);
    for (const live of ["voxcpm2", "voxcpm2-reduced"]) {
      engine = live;
      expect((await listed(h.adult)).find((v) => v.id === made.id)?.engine).toBe(live);
    }
    engine = "pocket";
    expect((await listed(h.adult)).some((v) => v.id === made.id)).toBe(false);
  });
  test("the stored clip words go to the Stack as voice_text; a voice without words sends none", async () => {
    const h = await household();
    const made = await makeVoice(h.owner);
    await Bun.sleep(20);
    expect((await synthesizeSpeech("Hi", made.id)).ok).toBe(true);
    expect(speechForms.at(-1)).toMatchObject({ voice_text: "hello there" });
    db.update(clonedVoices).set({ transcript: null }).where(eq(clonedVoices.id, made.id)).run();
    __setClonedVoiceTranscriberForTests(async () => { throw new Error("no listener"); });
    expect((await synthesizeSpeech("Hi", made.id)).ok).toBe(true);
    expect(speechForms.at(-1)!.voice_text).toBeUndefined();
    expect(speechForms.at(-1)!.voice_url).toContain(`/cloned/${made.id}/file`);
  });
  test("a voice made before words were stored gets them filled in on first use", async () => {
    const h = await household();
    const made = await makeVoice(h.owner);
    await Bun.sleep(20);
    db.update(clonedVoices).set({ transcript: null }).where(eq(clonedVoices.id, made.id)).run();
    __setClonedVoiceTranscriberForTests(async () => "filled in later");
    expect((await synthesizeSpeech("Hi", made.id)).ok).toBe(true);
    expect(speechForms.at(-1)!.voice_text).toBeUndefined();
    await Bun.sleep(30);
    expect(db.select().from(clonedVoices).where(eq(clonedVoices.id, made.id)).get()?.transcript).toBe("filled in later");
    expect((await synthesizeSpeech("Hi again", made.id)).ok).toBe(true);
    expect(speechForms.at(-1)).toMatchObject({ voice_text: "filled in later" });
  });
});
