import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { issues, people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { ROBOT_ASSETS, robotAssetPath } from "@/lib/robotAssets";

beforeEach(() => resetDb());
afterEach(() => rmSync(robotAssetPath(ROBOT_ASSETS[0]!.id).replace(/\/[^/]+$/, ""), { recursive: true, force: true }));

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const personId = db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!.id;
  return { owner, personId };
}

async function robotFor(personId: string) {
  const { token, deviceId } = issueDeviceToken(personId, "robot", "Reachy");
  storeRobotCredential(deviceId, "test-host", "pollen", "test-password");
  const robot = new TestClient();
  await robot.post("/api/auth/devices/redeem", { token });
  return robot;
}

describe("ROBOT-ASSETS-01", () => {
  test("the robot manifest is pinned to every spec entry and leaves optional moves out", async () => {
    const { owner, personId } = await household();
    expect((await new TestClient().get("/api/devices/me/assets")).status).toBe(401);
    expect((await owner.get("/api/devices/me/assets")).status).toBe(403);
    expect((await owner.get(`/api/devices/me/assets/${ROBOT_ASSETS[0]!.id}`)).status).toBe(403);
    const robot = await robotFor(personId);
    const response = await robot.get("/api/devices/me/assets");
    expect(response.status).toBe(200);
    const body = await response.json() as { assets: { id: string; sha256: string; licence: string; kind: string }[] };
    expect(body.assets.map((asset) => asset.id).sort()).toEqual(ROBOT_ASSETS.map((asset) => asset.id).sort());
    expect(body.assets.every((asset) => asset.sha256.length === 64 && asset.licence.length > 0)).toBe(true);
    expect(body.assets.some((asset) => asset.kind === "moves")).toBe(false);
  });

  test("a corrupt pinned file is refused and creates a Repair", async () => {
    const { personId } = await household();
    const robot = await robotFor(personId);
    const asset = ROBOT_ASSETS[0]!;
    mkdirSync(robotAssetPath(asset.id).replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(robotAssetPath(asset.id), "tampered");
    const response = await robot.get(`/api/devices/me/assets/${asset.id}`);
    expect(response.status).toBe(503);
    const issue = db.select().from(issues).where(eq(issues.key, `asset:${asset.id}`)).get();
    expect(issue?.source).toBe("robot-asset");
  });

  test("asset ETag is its verified SHA-256", async () => {
    const { personId } = await household();
    const robot = await robotFor(personId);
    const asset = ROBOT_ASSETS[0]!;
    const contents = Buffer.from("verified fixture");
    const original = { ...asset };
    const fixture = { ...asset, sha256: createHash("sha256").update(contents).digest("hex"), bytes: contents.length };
    try {
      Object.assign(asset, fixture);
      mkdirSync(robotAssetPath(asset.id).replace(/\/[^/]+$/, ""), { recursive: true });
      writeFileSync(robotAssetPath(asset.id), contents);
      const response = await robot.get(`/api/devices/me/assets/${asset.id}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(`"${fixture.sha256}"`);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(contents);
    } finally {
      Object.assign(asset, original);
    }
  });
});
