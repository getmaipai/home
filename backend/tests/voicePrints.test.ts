import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { dataDir } from "@/lib/paths";
import { encodeWav } from "@/lib/sttSession";
import { db } from "@/db";
import { biometricPrints } from "@/db/schema";

const vector = Array.from({ length: 192 }, (_, i) => i / 192);
let calls = 0;
let modelId = "nemo-titanet-small-v1";
let dim = 192;
let fail = false;

function filesUnder(path: string): string[] {
  try { return readdirSync(path).flatMap((name) => { const item = join(path, name); return statSync(item).isDirectory() ? filesUnder(item) : [item]; }); } catch { return []; }
}
function audio(seconds: number): File {
  return new File([encodeWav(new Float32Array(seconds * 16_000).fill(0.1), 16_000)], "sample.wav", { type: "audio/wav" });
}
function fakeStack() {
  return { speakerEmbedding: async () => { calls++; if (fail) throw new Error("offline"); return { data: { model_id: modelId, dim, embedding: vector }, identity: null }; } } as never;
}
async function setup(): Promise<TestClient> {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}
async function person(owner: TestClient, name: string, role: string, secret?: string): Promise<string> {
  return ((await owner.post("/api/people", { displayName: name, role, secret })).json() as Promise<{ id: string }> ).then((x) => x.id);
}
async function session(id: string, secret?: string): Promise<TestClient> {
  const client = new TestClient();
  await client.post(secret ? "/api/auth/verify-secret" : "/api/auth/select", secret ? { personId: id, secret } : { personId: id });
  return client;
}
async function enroll(client: TestClient, id: string, sample = audio(2)) {
  const form = new FormData(); form.set("person_id", id); form.set("audio", sample);
  return client.postForm("/api/voice-prints/enroll", form);
}

beforeEach(() => {
  resetDb(); calls = 0; modelId = "nemo-titanet-small-v1"; dim = 192; fail = false;
  __setStackClientForTests(fakeStack()); setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
});
afterEach(() => { __resetStackEngineForTests(); __setStackClientForTests(null); });

describe("voice print routes", () => {
  test("requires auth", async () => { expect((await new TestClient().get("/api/voice-prints?person_id=x")).status).toBe(401); });
  test("adult and teen self-enrol; child and guest are refused before Stack", async () => {
    const owner = await setup();
    const adultId = await person(owner, "Marlow", "adult", "adultpin1");
    const adult = await session(adultId, "adultpin1");
    expect((await enroll(adult, adultId)).status).toBe(201);
    const teenId = await person(owner, "River", "teen");
    expect((await enroll(await session(teenId), teenId)).status).toBe(201);
    const childId = await person(owner, "Nova", "child");
    const before = calls;
    expect((await enroll(await session(childId), childId)).status).toBe(403);
    expect(calls).toBe(before);
    const guestId = await person(owner, "Guest", "guest");
    expect((await enroll(await session(guestId), guestId)).status).toBe(403);
    expect(calls).toBe(before);
  });
  test("one adult cannot enrol another person's voice", async () => {
    const owner = await setup(); const a = await person(owner, "Marlow", "adult", "adultpin1"); const b = await person(owner, "River", "adult", "adultpin2");
    expect((await enroll(await session(a, "adultpin1"), b)).status).toBe(403);
  });
  test("lists only voice prints and protects another person's list; deletes one and all", async () => {
    const owner = await setup(); const a = await person(owner, "Marlow", "adult", "adultpin1"); const b = await person(owner, "River", "adult", "adultpin2");
    const aClient = await session(a, "adultpin1"); const bClient = await session(b, "adultpin2");
    const one = await enroll(aClient, a); const first = await one.json() as { id: string };
    const second = await enroll(aClient, a); const secondPrint = await second.json() as { id: string };
    expect((await bClient.get(`/api/voice-prints?person_id=${a}`)).status).toBe(403);
    const listed = await (await aClient.get(`/api/voice-prints?person_id=${a}`)).json() as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(2); expect(listed.every((p) => p.modality === "voice" && !("embedding" in p))).toBe(true);
    expect((await aClient.request(`/api/voice-prints/${first.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await aClient.request(`/api/voice-prints?person_id=${a}`, { method: "DELETE" })).status).toBe(200);
    expect(await (await aClient.get(`/api/voice-prints?person_id=${a}`)).json()).toEqual([]);
    expect(secondPrint.id).not.toBe(first.id);
  });
  test("bad model, dimension, unavailable Stack and invalid durations store nothing", async () => {
    const owner = await setup(); const a = await person(owner, "Marlow", "adult", "adultpin1"); const client = await session(a, "adultpin1");
    modelId = "wrong"; expect((await enroll(client, a)).status).toBe(503);
    modelId = "nemo-titanet-small-v1"; dim = 191; expect((await enroll(client, a)).status).toBe(503);
    dim = 192; fail = true; expect((await enroll(client, a)).status).toBe(503); fail = false;
    expect((await enroll(client, a, audio(0.5))).status).toBe(400);
    expect((await enroll(client, a, audio(16))).status).toBe(400);
    expect(db.select().from(biometricPrints).all()).toHaveLength(0);
  });
  test("audio never lands in temp/data and logs contain neither audio nor embeddings", async () => {
    const owner = await setup(); const a = await person(owner, "Marlow", "adult", "adultpin1");
    const before = new Set([...filesUnder(tmpdir()), ...filesUnder(dataDir)]);
    const oldLog = console.log; const oldError = console.error; const logs: string[] = [];
    console.log = (...args) => logs.push(args.join(" ")); console.error = (...args) => logs.push(args.join(" "));
    try { expect((await enroll(await session(a, "adultpin1"), a)).status).toBe(201); } finally { console.log = oldLog; console.error = oldError; }
    const after = [...filesUnder(tmpdir()), ...filesUnder(dataDir)].filter((file) => !before.has(file));
    expect(after).toEqual([]); expect(logs.join(" ")).not.toContain(vector.join(",")); expect(logs.join(" ")).not.toContain("sample.wav");
  });
});
