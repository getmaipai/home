import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { deviceCommands, people, settingsValues } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { invalidateScopeCache, setHouseholdSettingValue } from "@/lib/settings";
import { nextHlc } from "@/lib/hlc";
import {
  LIVE_VIEW_ATTACH_GRACE_MS, LIVE_VIEW_MAX_MS, getLiveView, liveViewAdmits, liveViewStream, pushLiveFrame, resetLiveViewsForTests, startLiveView, sweepLiveViews,
} from "@/lib/liveView";

beforeEach(() => { resetDb(); setHouseholdSettingValue("home.robots.enabled", true); resetLiveViewsForTests(); });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);

async function household() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const add = async (displayName: string, role: string) => {
    const res = await owner.post("/api/people", role === "adult" ? { displayName, role, secret: "correcthorse2" } : { displayName, role });
    expect(res.status).toBe(201);
    const id = (await res.json() as { id: string }).id;
    return db.select().from(people).where(eq(people.id, id)).get()!;
  };
  const adult = await add("Iris", "adult");
  const teen = await add("Tempo", "teen");
  const child = await add("Rin", "child");
  const { token, deviceId } = issueDeviceToken(ownerRow.id, "robot", "Reachy Mini");
  storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
  const robot = new TestClient();
  expect((await robot.post("/api/auth/devices/redeem", { token })).status).toBe(200);
  return { owner, ownerRow, adult, teen, child, deviceId, robot };
}

const kinds = (deviceId: string) => db.select().from(deviceCommands).all().filter((r) => r.deviceId === deviceId).map((r) => r.kind);
const enable = (who: string[] = []) => {
  setHouseholdSettingValue("robot.live_view.enabled", true);
  // Raw rows, so the "even when named" cases can hold a teen or child that the settings write itself refuses.
  db.delete(settingsValues).where(eq(settingsValues.key, "robot.live_view.who")).run();
  db.insert(settingsValues).values({ scope: "household", key: "robot.live_view.who", value: JSON.stringify(who), hlc: nextHlc(), source: "user", updatedAt: new Date().toISOString(), setBy: null }).run();
  invalidateScopeCache("household");
};

describe("LIVE-VIEW-01 who may watch", () => {
  test("off by default, even for the owner", async () => {
    const { owner, ownerRow, deviceId } = await household();
    expect(liveViewAdmits(ownerRow)).toMatchObject({ ok: false, status: 403 });
    expect((await owner.post(`/api/devices/${deviceId}/live-view`)).status).toBe(403);
    expect(kinds(deviceId)).not.toContain("live_view_start");
  });

  test("an admin opens it once enabled, and the robot is told 5 fps at 640x360", async () => {
    const { owner, deviceId } = await household();
    enable();
    const res = await owner.post(`/api/devices/${deviceId}/live-view`);
    expect(res.status).toBe(200);
    const body = await res.json() as { view_id: string; stream: string };
    expect(body.stream).toBe(`/api/devices/live-view/${body.view_id}`);
    const command = db.select().from(deviceCommands).all().find((r) => r.kind === "live_view_start")!;
    expect(JSON.parse(command.payload)).toEqual({ view_id: body.view_id, fps: 5, size: "640x360" });
  });

  test("an adult admits only when named; a teen and a child never, even when named", async () => {
    const { adult, teen, child } = await household();
    enable([]);
    expect(liveViewAdmits(adult)).toMatchObject({ ok: false, status: 403 });
    enable([adult.id, teen.id, child.id]);
    expect(liveViewAdmits(adult)).toEqual({ ok: true });
    expect(liveViewAdmits(teen)).toMatchObject({ ok: false, status: 403 });
    expect(liveViewAdmits(child)).toMatchObject({ ok: false, status: 403 });
  });

  test("a named adult cannot open a robot that is not theirs", async () => {
    const { adult, deviceId } = await household();
    enable([adult.id]);
    expect(startLiveView(adult, deviceId)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("LIVE-VIEW-01 the settings list", () => {
  test("naming an adult works; naming a teen or a child is refused at the write", async () => {
    const { adult, teen, child } = await household();
    expect(setHouseholdSettingValue("robot.live_view.who", [adult.id]).ok).toBe(true);
    expect(setHouseholdSettingValue("robot.live_view.who", [teen.id])).toMatchObject({ ok: false, status: 400 });
    expect(setHouseholdSettingValue("robot.live_view.who", [child.id])).toMatchObject({ ok: false, status: 400 });
  });
});

describe("LIVE-VIEW-01 the stream", () => {
  test("only the robot told to stream may post a JPEG; the viewer receives it; closing the page stops the view", async () => {
    const { owner, ownerRow, deviceId, robot } = await household();
    enable();
    const { view_id } = await (await owner.post(`/api/devices/${deviceId}/live-view`)).json() as { view_id: string };
    expect((await robot.postBytes(`/api/devices/me/stream/${view_id}`, new TextEncoder().encode("not a jpeg"), "image/jpeg")).status).toBe(400);
    expect((await robot.postBytes(`/api/devices/me/stream/view-nope`, JPEG, "image/jpeg")).status).toBe(404);
    expect((await owner.postBytes(`/api/devices/me/stream/${view_id}`, JPEG, "image/jpeg")).status).toBeGreaterThanOrEqual(401);
    const stranger = issueDeviceToken(ownerRow.id, "robot", "Other");
    expect(pushLiveFrame(stranger.deviceId, view_id, JPEG)).toBe("unknown_view");

    const res = await owner.get(`/api/devices/live-view/${view_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("multipart/x-mixed-replace");
    const reader = res.body!.getReader();
    expect((await robot.postBytes(`/api/devices/me/stream/${view_id}`, JPEG, "image/jpeg")).status).toBe(204);
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain("image/jpeg");
    await reader.cancel();
    expect(getLiveView(view_id)).toBeUndefined();
    expect(kinds(deviceId)).toContain("live_view_stop");
  });

  test("another person cannot watch someone else's view, and a view nobody opens is dropped after the grace", async () => {
    const { owner, ownerRow, deviceId } = await household();
    enable();
    const started = startLiveView(ownerRow, deviceId);
    if (!started.ok) throw new Error("expected a view");
    const intruder = new TestClient();
    expect((await intruder.get(`/api/devices/live-view/${started.viewId}`)).status).toBe(401);
    void owner;
    const now = Date.now();
    expect(sweepLiveViews(new Date(now + LIVE_VIEW_ATTACH_GRACE_MS - 1000))).toEqual([]);
    expect(sweepLiveViews(new Date(now + LIVE_VIEW_ATTACH_GRACE_MS + 1000))).toEqual([started.viewId]);
    expect(kinds(deviceId)).toContain("live_view_stop");
  });

  test("a watched view stops at 10 minutes, and the viewer route is refused once live view is turned off", async () => {
    const { owner, ownerRow, deviceId } = await household();
    enable();
    const started = startLiveView(ownerRow, deviceId);
    if (!started.ok) throw new Error("expected a view");
    void liveViewStream(getLiveView(started.viewId)!);
    const now = Date.now();
    expect(sweepLiveViews(new Date(now + LIVE_VIEW_MAX_MS - 1000))).toEqual([]);
    expect(sweepLiveViews(new Date(now + LIVE_VIEW_MAX_MS + 1000))).toEqual([started.viewId]);

    const again = startLiveView(ownerRow, deviceId);
    if (!again.ok) throw new Error("expected a view");
    setHouseholdSettingValue("robot.live_view.enabled", false);
    expect((await owner.get(`/api/devices/live-view/${again.viewId}`)).status).toBe(403);
    expect(getLiveView(again.viewId)).toBeUndefined();
    expect(pushLiveFrame(deviceId, again.viewId, JPEG)).toBe("unknown_view");
  });

  test("frames are never written to any table", async () => {
    const { ownerRow, deviceId } = await household();
    enable();
    const started = startLiveView(ownerRow, deviceId);
    if (!started.ok) throw new Error("expected a view");
    expect(pushLiveFrame(deviceId, started.viewId, JPEG)).toBe("ok");
    const dump = JSON.stringify(db.select().from(deviceCommands).all());
    expect(dump).not.toContain("/9j/"); // a JPEG's base64 start
  });
});
