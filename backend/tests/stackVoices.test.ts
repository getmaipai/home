import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { offlineResponse, startStackFixture, type StackFixture } from "./stackFixture";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";

let fixture: StackFixture | undefined;

beforeEach(() => resetDb());
afterEach(() => {
  fixture?.stop();
  fixture = undefined;
  __resetStackEngineForTests();
});

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}

async function fixtureFor(rows: unknown[] | Response): Promise<void> {
  fixture = startStackFixture({ "GET /stack/v1/voices": () => rows instanceof Response ? rows : Response.json({ voices: rows }) });
}

async function requestWithFixture(client: TestClient): Promise<Response> {
  if (!fixture) throw new Error("Stack fixture is not set");
  expect(setHouseholdSettingValue("engines.stack.url", fixture.url).ok).toBe(true);
  __setStackClientForTests(fixture.client);
  const res = await client.get("/api/voice/voices");
  return res;
}

describe("GET /api/voice/voices", () => {
  test("a voice with no metadata still lists with unknown values instead of being dropped", async () => {
    await fixtureFor([{ id: "v-1", name: "Plain" }]);
    const res = await requestWithFixture(await ownerClient());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voices: [{ id: "v-1", name: "Plain", description: "unknown", language: "unknown", country: "unknown", gender: "unknown", source: "unknown", onDisk: false, licence: null, revision: "unknown" }] });
  });

  test("the list is generic over the voice engine: two engines in one scripted list come back in the same rows with no change", async () => {
    await fixtureFor([{ id: "v-a", name: "A", engine: "engine-a" }, { id: "v-b", name: "B", engine: "engine-b" }]);
    const res = await requestWithFixture(await ownerClient());
    const body = await res.json() as { voices: Array<{ id: string; engine?: string }> };
    expect(body.voices.map(({ id, engine }) => [id, engine])).toEqual([["v-a", "engine-a"], ["v-b", "engine-b"]]);
  });

  test("a signed-in child can read the voices list but a signed-out caller gets 401", async () => {
    await fixtureFor([{ id: "v-1", name: "Plain" }]);
    const owner = await ownerClient();
    const childRes = await owner.post("/api/people", { displayName: "Pip", role: "child", secret: "1234" });
    const child = await childRes.json() as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/verify-secret", { personId: child.id, secret: "1234" });
    expect((await requestWithFixture(childClient)).status).toBe(200);
    expect((await new TestClient().get("/api/voice/voices")).status).toBe(401);
  });

  test("a row with no id is skipped and the rest still list", async () => {
    await fixtureFor([{ id: "v-1", name: "One" }, { name: "No id" }, { id: "v-3", name: "Three" }]);
    const res = await requestWithFixture(await ownerClient());
    const body = await res.json() as { voices: Array<{ id: string }> };
    expect(body.voices.map(({ id }) => id)).toEqual(["v-1", "v-3"]);
  });

  test("with the Stack down the route answers with a plain-words error and the picker data call does not throw", async () => {
    await fixtureFor(offlineResponse("tts", "the test Stack is unavailable"));
    const owner = await ownerClient();
    const ownerRes = await requestWithFixture(owner);
    expect(ownerRes.status).toBe(503);
    expect((await ownerRes.json() as { error: string }).error).toContain("Open Settings, then Engines, and start it");
    const childRes = await owner.post("/api/people", { displayName: "Pip", role: "child", secret: "1234" });
    const child = await childRes.json() as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/verify-secret", { personId: child.id, secret: "1234" });
    const response = await requestWithFixture(childClient);
    expect(response.status).toBe(503);
    expect((await response.json() as { error: string }).error).toContain("Ask the person who manages Home to start it");
  });
});
