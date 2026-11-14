import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { __resetNowPlayingForTests } from "@/lib/music/nowPlaying";

async function owner() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}

beforeEach(() => { resetDb(); __resetNowPlayingForTests(); });

describe("POST /api/music/now-playing", () => {
  test("requires a signed-in person and validates its body", async () => {
    const anon = new TestClient();
    expect((await anon.post("/api/music/now-playing", { state: "playing" })).status).toBe(401);
    const client = await owner();
    expect((await client.post("/api/music/now-playing", { state: "paused" })).status).toBe(400);
    expect((await client.post("/api/music/now-playing", { state: "playing", year: 4000 })).status).toBe(400);
  });
  test("accepts playing and stopped reports without throwing", async () => {
    const client = await owner();
    const playing = await client.post("/api/music/now-playing", { state: "playing", key: "sound-demo", title: "demo sound" });
    expect(playing.status).toBe(200);
    expect(await playing.json()).toMatchObject({ ok: true, pushed: 0 });
    const stopped = await client.post("/api/music/now-playing", { state: "stopped" });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ ok: true, pushed: 0 });
  });
});
