import { beforeEach, describe, expect, test, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import {
  SCENE_TTL_MS, MIN_FRAME_INTERVAL_MS, __resetRobotVisionForTests, __setCaptionForTests, acceptFrame, cleanCaption, robotVisionMode, sceneContextLine, sceneFor,
} from "@/lib/robotVision";
import { contextToMessages } from "@/lib/turnMachine/messages";
import type { PersonRow } from "@/types";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
const CAPTION = "A tidy living room with a sofa and one person standing near a window.";

beforeEach(() => {
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
