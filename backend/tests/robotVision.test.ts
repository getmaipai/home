import { registerActiveChatLease } from "../src/lib/chatLease";
import { beforeEach, describe, expect, test, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { getDeviceSettingValue, setHouseholdSettingValue, setValue } from "@/lib/settings";
import {
  SCENE_TTL_MS, MIN_FRAME_INTERVAL_MS, SCENE_FRAME_INTERVAL_MS, __resetRobotVisionForTests, __setCaptionForTests, __setLookForTests, acceptFrame, cleanCaption, robotVisionMode, sceneContextLine, sceneFor,
} from "@/lib/robotVision";
import { startStackFixture } from "./stackFixture";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { acquireTurnLease, __resetTurnActivityForTests } from "@/lib/turnActivity";
import { contextToMessages } from "@/lib/turnMachine/messages";
import type { PersonRow } from "@/types";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
const CAPTION = "A tidy living room with a sofa and one person standing near a window.";

beforeEach(() => {
  __setLookForTests(null);
  resetDb();
  setHouseholdSettingValue("home.robots.enabled", true);
  __resetRobotVisionForTests();
  __setCaptionForTests(async () => CAPTION);
});

async function household() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  const { token, deviceId } = issueDeviceToken(ownerRow.id, "robot", "StackChan");
  storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
  const robot = new TestClient();
  expect((await robot.post("/api/auth/devices/redeem", { token })).status).toBe(200);
  return { owner, ownerRow, deviceId, robot };
}
const setVision = (row: PersonRow, deviceId: string, value: string) => expect(setValue(row, `device:${deviceId}`, "robot.vision", value).ok).toBe(true);

describe("robot.vision setting", () => {
  test("defaults to continual; on_demand and none are chosen per robot", async () => {
    const { ownerRow, deviceId } = await household();
    expect(robotVisionMode(deviceId)).toBe("continual");
    setVision(ownerRow, deviceId, "on_demand");
    expect(robotVisionMode(deviceId)).toBe("on_demand");
    setVision(ownerRow, deviceId, "none");
    expect(robotVisionMode(deviceId)).toBe("none");
  });
});

describe("robot.volume and robot.brightness", () => {
  test("defaults are 70 and 100 per robot, set by an admin, and refuse values outside the range", async () => {
    const { ownerRow, deviceId } = await household();
    const read = (key: string) => getDeviceSettingValue(deviceId, key);
    expect(read("robot.volume")).toBe(70);
    expect(read("robot.brightness")).toBe(100);
    expect(setValue(ownerRow, `device:${deviceId}`, "robot.volume", 55).ok).toBe(true);
    expect(setValue(ownerRow, `device:${deviceId}`, "robot.brightness", 40).ok).toBe(true);
    expect(read("robot.volume")).toBe(55);
    expect(read("robot.brightness")).toBe(40);
    expect(setValue(ownerRow, `device:${deviceId}`, "robot.volume", 5).ok).toBe(false);
    expect(setValue(ownerRow, `device:${deviceId}`, "robot.brightness", 101).ok).toBe(false);
  });
});

describe("the frame route", () => {
  test("a robot's picture is described, dropped, and the answer carries no description", async () => {
    const { robot, deviceId } = await household();
    const res = await robot.postBytes("/api/devices/me/vision?people=1&light=dim", JPEG, "image/jpeg");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({ ok: true, expires_in_s: SCENE_TTL_MS / 1000 });
    expect(JSON.stringify(body)).not.toContain("sofa");
    expect(sceneFor(deviceId)).toMatchObject({ caption: CAPTION, people: 1, brightness: "dim" });
  });

  test("a person's session, no session, and a bad type are refused; nothing is kept", async () => {
    const { owner, robot, deviceId } = await household();
    expect((await owner.postBytes("/api/devices/me/vision", JPEG, "image/jpeg")).status).toBeGreaterThanOrEqual(401);
    expect((await new TestClient().postBytes("/api/devices/me/vision", JPEG, "image/jpeg")).status).toBe(401);
    expect((await robot.postBytes("/api/devices/me/vision", new TextEncoder().encode("not a jpeg"), "image/jpeg")).status).toBe(415);
    expect(sceneFor(deviceId)).toBeNull();
  });

  test("none refuses every picture and keeps nothing; on_demand takes only an ask", async () => {
    const { ownerRow, robot, deviceId } = await household();
    setVision(ownerRow, deviceId, "none");
    expect((await robot.postBytes("/api/devices/me/vision", JPEG, "image/jpeg")).status).toBe(403);
    expect((await robot.postBytes("/api/devices/me/vision?purpose=ask", JPEG, "image/jpeg")).status).toBe(403);
    expect(sceneFor(deviceId)).toBeNull();
    setVision(ownerRow, deviceId, "on_demand");
    expect((await robot.postBytes("/api/devices/me/vision?purpose=scene", JPEG, "image/jpeg")).status).toBe(403);
    expect((await robot.postBytes("/api/devices/me/vision?purpose=ask", JPEG, "image/jpeg")).status).toBe(200);
    expect(sceneFor(deviceId)?.caption).toBe(CAPTION);
  });

  test("too big and too fast are refused", async () => {
    const { robot, deviceId } = await household();
    const big = new Uint8Array(600 * 1024); big[0] = 0xff; big[1] = 0xd8;
    expect((await robot.postBytes("/api/devices/me/vision", big, "image/jpeg")).status).toBe(413);
    expect((await robot.postBytes("/api/devices/me/vision", JPEG, "image/jpeg")).status).toBe(200);
    expect((await robot.postBytes("/api/devices/me/vision", JPEG, "image/jpeg")).status).toBe(429);
    expect(sceneFor(deviceId)).not.toBeNull();
  });

  test("no description or picture bytes reach the logs", async () => {
    const { robot } = await household();
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((k) => spyOn(console, k).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
    try {
      await robot.postBytes("/api/devices/me/vision", JPEG, "image/jpeg");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(lines.join("\n")).not.toContain("sofa");
  });
});

describe("the scene is short-lived and only a robot turn reads it", () => {
  test("it expires and is deleted; none hides it", async () => {
    const { ownerRow, deviceId } = await household();
    const t0 = 1_000_000;
    const first = await acceptFrame({ deviceId, bytes: JPEG, people: 2, brightness: "bright", purpose: "scene", now: t0 });
    expect(first.ok).toBe(true);
    expect(sceneContextLine(deviceId, t0 + 5000)).toContain(CAPTION);
    expect(sceneContextLine(deviceId, t0 + 5000)).toContain("5 seconds ago");
    expect(sceneFor(deviceId, t0 + SCENE_TTL_MS - 1)).not.toBeNull();
    expect(sceneFor(deviceId, t0 + SCENE_TTL_MS + 1)).toBeNull();
    expect(sceneContextLine(deviceId, t0 + SCENE_TTL_MS + 1)).toBeNull();
    await acceptFrame({ deviceId, bytes: JPEG, people: 0, brightness: "dark", purpose: "scene", now: t0 + SCENE_TTL_MS + MIN_FRAME_INTERVAL_MS });
    setVision(ownerRow, deviceId, "none");
    expect(sceneContextLine(deviceId, t0 + SCENE_TTL_MS + MIN_FRAME_INTERVAL_MS + 1)).toBeNull();
  });

  test("the prompt carries the look as data and the guidance outside the data wrapper", () => {
    const messages = contextToMessages(
      [{ id: "robot-scene", text: `Looked 3 seconds ago (it may be out of date): ${CAPTION}\nLight: dim. People in view: 1.`, source: "camera", subjects: [], disclosure: "child_ok" }],
      "can you see me?",
      { id: "t", name: "T" } as never,
      { moves: {}, playfulness: "allowed", max_sentences: 2, max_words: 30, age_band: "adult", vocabulary_level: "standard", explanation_style: "concrete", trusted_adult_move: "none", content_disclosure: "full", react_move: null } as never,
      { clauses: [] } as never,
      "spoken",
    );
    const last = messages[messages.length - 1]!.content;
    expect(last).toContain("<untrusted_data>");
    expect(last).toContain(CAPTION);
    expect(last).toContain("never name or identify anyone from how they look");
    expect(last.indexOf("About the camera look above")).toBeGreaterThan(last.indexOf("</untrusted_data>"));
  });

  test("a caption is plain one-line text", () => {
    expect(cleanCaption('  "A room"\n\n* with *a* [lamp]  ')).toBe("A room with a lamp");
    expect(cleanCaption("word ".repeat(80)).split(" ").length).toBeLessThanOrEqual(30);
  });
});

describe("ROBOT-VISION-BUSY-01: a look never competes with real work", () => {
  const frame = (deviceId: string, purpose: "scene" | "ask", now: number) => acceptFrame({ deviceId, bytes: JPEG, people: null, brightness: "bright", purpose, now });

  test("background pictures wait 30 s apart, asked pictures 4 s", async () => {
    const { deviceId } = await household();
    expect((await frame(deviceId, "scene", 1_000_000)).ok).toBe(true);
    const early = await frame(deviceId, "scene", 1_000_000 + SCENE_FRAME_INTERVAL_MS - 1);
    expect(early.ok === false && early.code).toBe("too_fast");
    expect((await frame(deviceId, "scene", 1_000_000 + SCENE_FRAME_INTERVAL_MS)).ok).toBe(true);
    expect((await frame(deviceId, "ask", 2_000_000)).ok).toBe(true);
    expect((await frame(deviceId, "ask", 2_000_000 + MIN_FRAME_INTERVAL_MS)).ok).toBe(true);
  });

  test("a running chat turn turns a background look away without touching the model, and an asked look still works", async () => {
    const { deviceId } = await household();
    let calls = 0;
    __setCaptionForTests(async () => { calls++; return CAPTION; });
    const lease = acquireTurnLease();
    try {
      const busy = await frame(deviceId, "scene", 1_000_000);
      expect(busy.ok === false && busy.status).toBe(503);
      expect(busy.ok === false && busy.code).toBe("busy");
      expect(calls).toBe(0);
      expect((await frame(deviceId, "ask", 1_000_001)).ok).toBe(true);
    } finally {
      lease.release();
      __resetTurnActivityForTests();
    }
    expect((await frame(deviceId, "scene", 1_000_000 + SCENE_FRAME_INTERVAL_MS)).ok).toBe(true);
  });

  test("The Max chat lease refuses every look, asked or background, without touching the model", async () => {
    const { deviceId } = await household();
    let calls = 0;
    __setCaptionForTests(async () => { calls++; return CAPTION; });
    registerActiveChatLease({ snapshot: () => ({ state: "held" }) } as never);
    try {
      for (const purpose of ["scene", "ask"] as const) {
        const out = await frame(deviceId, purpose, 1_000_000);
        expect(out.ok === false && out.code).toBe("busy");
      }
      expect(calls).toBe(0);
    } finally { registerActiveChatLease(null); }
  });

  test("only one picture is described at a time per robot; a second is dropped, not queued", async () => {
    const { deviceId } = await household();
    let release: () => void = () => {};
    let calls = 0;
    __setCaptionForTests(() => { calls++; return new Promise((resolve) => { release = () => resolve(CAPTION); }); });
    const first = frame(deviceId, "ask", 1_000_000);
    for (let waited = 0; calls === 0 && waited < 200; waited++) await new Promise((r) => setTimeout(r, 10));
    const second = await frame(deviceId, "ask", 1_000_000 + MIN_FRAME_INTERVAL_MS);
    expect(second.ok === false && second.code).toBe("busy");
    release();
    expect((await first).ok).toBe(true);
    expect(calls).toBe(1);
  });
});

describe("LOOK-01: the Stack's Look names what is in the picture, and Home keeps it 90 seconds", () => {
  const frame = (deviceId: string, purpose: "scene" | "ask", now: number) => acceptFrame({ deviceId, bytes: JPEG, people: null, brightness: "unknown", purpose, now });
  const look = (objects: { label: string; count: number; attributes?: Record<string, string>; uncertain?: boolean }[], over: Record<string, unknown> = {}) => async () => ({
    objects: objects.map((o) => ({ label: o.label, count: o.count, score: 0.9, uncertain: o.uncertain ?? false, ...(o.attributes ? { attributes: o.attributes } : {}) })),
    scene: { light: "bright" as const, tags: [{ label: "living room", score: 0.8 }], colours: ["blue", "white"], ...over },
    cost: { ms: 14, tier: "fast" as const },
  });

  test("a background look is kept as labels, counts, colours and light, and reads as one short camera line", async () => {
    const { deviceId } = await household();
    __setLookForTests(look([{ label: "person", count: 1 }, { label: "chair", count: 3 }, { label: "tv", count: 1 }], { room_type: "living room" }));
    expect((await frame(deviceId, "scene", 1_000_000)).ok).toBe(true);
    const line = sceneContextLine(deviceId, 1_012_000)!;
    expect(line).toContain("Looked 12 seconds ago");
    expect(line).toContain("a person");
    expect(line).toContain("3 chairs");
    expect(line).toContain("a tv");
    expect(line).toContain("room: living room");
    expect(line).toContain("colours: blue, white");
    expect(line).toContain("Light: bright");
  });

  test("a kind of thing is kept for 90 s after it was last seen, not after the picture it came from", async () => {
    const { deviceId } = await household();
    __setLookForTests(look([{ label: "chair", count: 2 }, { label: "tv", count: 1 }]));
    await frame(deviceId, "scene", 1_000_000);
    __setLookForTests(look([{ label: "tv", count: 1 }]));
    await frame(deviceId, "scene", 1_000_000 + SCENE_FRAME_INTERVAL_MS);
    const mid = sceneContextLine(deviceId, 1_000_000 + SCENE_FRAME_INTERVAL_MS + 10_000)!;
    expect(mid).toContain("2 chairs");
    const late = sceneContextLine(deviceId, 1_000_000 + SCENE_TTL_MS + 1_000)!;
    expect(late).not.toContain("chair");
    expect(late).toContain("a tv");
  });

  test("an asked look keeps details, flags a guess, and never keeps a detail for a person", async () => {
    const { deviceId } = await household();
    let asked = null as string | null;
    __setLookForTests(async (_bytes, detail) => {
      asked = detail;
      return look([
        { label: "car", count: 1, attributes: { colour: "blue", make: "Tesla", model: "Model 3" }, uncertain: true },
        { label: "person", count: 1, attributes: { colour: "red", kind: "tall man" } },
      ])();
    });
    expect((await frame(deviceId, "ask", 1_000_000)).ok).toBe(true);
    expect(asked).toBe("detailed");
    const line = sceneContextLine(deviceId, 1_001_000)!;
    expect(line).toContain("a blue Tesla Model 3 car (a guess)");
    expect(line).toContain("a person");
    expect(line).not.toContain("red");
    expect(line).not.toContain("tall");
    __setLookForTests(async (_bytes, detail) => { asked = detail; return look([{ label: "chair", count: 1 }])(); });
    await frame(deviceId, "scene", 2_000_000);
    expect(asked).toBe("fast");
  });

  test("when Look cannot answer, the one-sentence caption is the fallback; with neither, the robot is told", async () => {
    const { deviceId } = await household();
    __setLookForTests(async () => null);
    expect((await frame(deviceId, "scene", 1_000_000)).ok).toBe(true);
    expect(sceneContextLine(deviceId, 1_001_000)).toContain(CAPTION);
    __setCaptionForTests(async () => null);
    const none = await frame(deviceId, "scene", 1_000_000 + SCENE_FRAME_INTERVAL_MS);
    expect(none.ok === false && none.code).toBe("no_vision");
  });

  test("no label, tag or detail reaches a log, and the route answer carries none", async () => {
    const { robot, deviceId } = await household();
    __setLookForTests(look([{ label: "zebra-print sofa", count: 1, attributes: { make: "Acmeco" } }], { room_type: "attic" }));
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((k) => spyOn(console, k).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
    let body = "";
    try {
      const response = await robot.postBytes("/api/devices/me/vision", JPEG, "image/jpeg");
      body = await response.text();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    for (const word of ["zebra-print", "Acmeco", "attic", "living room"]) {
      expect(lines.join("\n")).not.toContain(word);
      expect(body).not.toContain(word);
    }
    expect(sceneContextLine(deviceId)).toContain("zebra-print sofa");
  });
});

describe("LOOK-01: Home calls the Stack's Look route", () => {
  const frame = (deviceId: string, purpose: "scene" | "ask", now: number) => acceptFrame({ deviceId, bytes: JPEG, people: null, brightness: "unknown", purpose, now });
  const reply = {
    objects: [
      { label: "couch", count: 1, score: 0.8, box: [0.1, 0.1, 0.5, 0.5], uncertain: false },
      { label: "lamp", count: 1, score: 0.7, box: [0.6, 0.1, 0.8, 0.4], uncertain: false, stale: true },
    ],
    scene: { light: "dim", colours: ["green"], tags: [{ label: "living room", score: 0.7 }] },
    cost: { ms: 14, tier: "fast" },
    expires_in_s: 90,
  };

  test("a background picture goes up as a fast look keyed by the robot, and the reply is read, not trusted", async () => {
    const { deviceId } = await household();
    let seen = null as { source: string; detail: string; image: number } | null;
    const stack = startStackFixture({
      "POST /v1/images/looks": async (req) => {
        const form = await req.formData();
        seen = { source: String(form.get("source")), detail: String(form.get("detail")), image: (form.get("image") as unknown as { size: number }).size };
        return Response.json(reply);
      },
    });
    __setStackClientForTests(stack.client);
    try {
      expect((await frame(deviceId, "scene", 1_000_000)).ok).toBe(true);
    } finally {
      stack.stop();
    }
    expect(seen).toEqual({ source: deviceId, detail: "fast", image: JPEG.byteLength });
    const line = sceneContextLine(deviceId, 1_002_000)!;
    expect(line).toContain("a couch");
    expect(line).not.toContain("lamp");
    expect(line).toContain("colours: green");
    expect(line).toContain("Light: dim");
  });

  test("detail_unavailable, no memory, too many looks and a down Stack all fall back to the caption, with nothing logged", async () => {
    const { deviceId } = await household();
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((k) => spyOn(console, k).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
    try {
      let at = 1_000_000;
      for (const [status, code] of [[422, "detail_unavailable"], [503, "no_memory"], [429, "too_fast"], [500, "failed"]] as const) {
        const stack = startStackFixture({ "POST /v1/images/looks": () => Response.json({ error: "a sofa-shaped secret", code }, { status }) });
        __setStackClientForTests(stack.client);
        try {
          const purpose = status === 422 ? "ask" : "scene";
          expect((await frame(deviceId, purpose, at)).ok).toBe(true);
        } finally {
          stack.stop();
        }
        expect(sceneContextLine(deviceId, at + 1_000)).toContain(CAPTION);
        at += SCENE_FRAME_INTERVAL_MS + 1_000;
      }
      const down = startStackFixture({});
      __setStackClientForTests(down.client);
      down.stop();
      expect((await frame(deviceId, "scene", at)).ok).toBe(true);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(lines.join("\n")).not.toContain("sofa-shaped");
  });
});
