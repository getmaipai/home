import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { deviceCommands, devices, musicJobs, people, settingsValues } from "@/db/schema";
import { heardSongFor, __resetHeardSongsForTests } from "@/lib/music/heardSong";
import { __resetNowPlayingForTests, reportNowPlaying, robotsFor, titleAllowedFor } from "@/lib/music/nowPlaying";
import type { PersonRow } from "@/types";

async function owner() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}

beforeEach(() => { resetDb(); __resetNowPlayingForTests(); __resetHeardSongsForTests(); });

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

function setRobotBand(robotId: string, band: "child" | "teen" | "adult"): void {
  const now = new Date().toISOString();
  db.insert(settingsValues).values({ scope: `device:${robotId}`, key: "robot.controls", value: JSON.stringify(band), hlc: "1:0:test", source: "user", updatedAt: now, setBy: null }).run();
}
function addSong(person: PersonRow, id: string, title: string, adultOnly = false, adultLock: "on" | "off" = "on"): void {
  const now = new Date().toISOString();
  db.insert(musicJobs).values({ id, personId: person.id, task: "text2music", request: JSON.stringify({ title, ...(adultOnly ? { adultOnly, adultLock } : {}) }), state: "done", progress: 1, createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
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
    expect(titleAllowedFor(adult, "adult-robot", "Sunny Day")).toBe(true);
    expect(titleAllowedFor(child, "child-robot", "Sunny Day")).toBe(true);
    expect(titleAllowedFor(child, "child-robot", "how to kill myself")).toBe(false);
  });

  test("each robot gets its own stricter player and controls floor, and context stores only allowed robots", () => {
    const adult = addPerson("adult-per-robot", "adult");
    addRobot("child-per-robot", adult.id); addRobot("teen-per-robot", adult.id); addRobot("adult-per-robot-r", adult.id);
    setRobotBand("teen-per-robot", "teen"); setRobotBand("adult-per-robot-r", "adult");
    addSong(adult, "safe-song", "Sunny Day");
    const out = reportNowPlaying(adult, { state: "playing", song_id: "safe-song" });
    expect(out.pushed).toBe(0);
    expect(heardSongFor("child-per-robot")?.title).toBe("Sunny Day");
    expect(heardSongFor("teen-per-robot")?.title).toBe("Sunny Day");
    expect(heardSongFor("adult-per-robot-r")?.title).toBe("Sunny Day");
    expect(db.select().from(deviceCommands).all()).toHaveLength(0);
    addSong(adult, "unsafe-song", "how to kill myself");
    reportNowPlaying(adult, { state: "playing", song_id: "unsafe-song" });
    expect(heardSongFor("child-per-robot")?.title).not.toBe("how to kill myself");
    expect(heardSongFor("teen-per-robot")?.title).not.toBe("how to kill myself");
    expect(heardSongFor("adult-per-robot-r")?.title).toBe("how to kill myself");
  });

  test("an adult-only song never reaches a robot even when its lock is off", () => {
    const adult = addPerson("adult-only-person", "adult");
    addRobot("adult-only-robot", adult.id); setRobotBand("adult-only-robot", "adult");
    addSong(adult, "adult-only-song", "Private Track", true, "off");
    reportNowPlaying(adult, { state: "playing", song_id: "adult-only-song" });
    expect(heardSongFor("adult-only-robot")).toBeNull();
    expect(db.select().from(deviceCommands).all()).toHaveLength(0);
  });
});
