import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { devices, people } from "@/db/schema";
import { __resetNowPlayingForTests, reportNowPlaying, robotsFor, titleAllowedFor } from "@/lib/music/nowPlaying";
import type { PersonRow } from "@/types";

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

function addPerson(id: string, role: "adult" | "child" | "teen"): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, nickname: null, bio: null, accent: null, role, birthdate: null, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" } as never).run();
  return db.select().from(people).all().find((row) => row.id === id) as unknown as PersonRow;
}
function addRobot(id: string, personId: string): void {
  const now = new Date().toISOString();
  db.insert(devices).values({ id, kind: "robot", name: id, personId, createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
}

describe("now playing keeps a person's listening to their own robots", () => {
  test("an adult with no robot of their own reaches no one, and never the household's other robots", () => {
    const adult = addPerson("person-adult-np", "adult");
    const child = addPerson("person-child-np", "child");
    addRobot("robot-child-np", child.id);
    expect(robotsFor(adult)).toEqual([]);
    expect(robotsFor(child)).toEqual(["robot-child-np"]);
    expect(reportNowPlaying(adult, { state: "playing", title: "Anything" })).toEqual({ ok: true, pushed: 0 });
  });
  test("a title the client supplies is never used: an unknown song id shows nothing and keeps no context", () => {
    const adult = addPerson("person-adult-np2", "adult");
    addRobot("robot-adult-np2", adult.id);
    const out = reportNowPlaying(adult, { state: "playing", song_id: "no-such-song", title: "Client Made Up", artist: "Nobody" });
    expect(out).toEqual({ ok: true, pushed: 0 });
  });
  test("face text for a child or teen passes the output floor and fails closed", () => {
    const child = addPerson("person-child-np3", "child");
    const adult = addPerson("person-adult-np3", "adult");
    expect(titleAllowedFor(adult, "Sunny Day")).toBe(true);
    expect(titleAllowedFor(child, "Sunny Day")).toBe(true);
    expect(titleAllowedFor(child, "how to kill myself")).toBe(false);
  });
});
