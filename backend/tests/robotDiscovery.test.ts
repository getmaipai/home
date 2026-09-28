import { describe, expect, test } from "bun:test";
import { Bonjour } from "bonjour-service";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { discoverRobots } from "@/lib/robotDiscovery";

// Same posture as tests/mdns.test.ts: a real mDNS advertise/browse round
// trip on loopback, the only way to actually prove discoverRobots() reads
// the daemon's own TXT fields rather than the shape of a mocked object.
//
// The published *name* must never be a real daemon's own default
// ("reachy_mini"): bonjour-service probes for name collisions before
// publishing and silently refuses a duplicate, and a real simulator
// happened to be running on this exact machine under that exact name
// while this test was first written, which made every fixture here
// find nothing at all. `port` alone is unique per test and is what the
// assertions key on; the TXT payload can still claim `robot_name:
// "reachy_mini"` (real daemons all do) without a service-name collision.
async function advertiseFakeRobot(
  uniqueServiceName: string,
  port: number,
  txt: Record<string, string>,
): Promise<Bonjour> {
  const bonjour = new Bonjour();
  bonjour.publish({ name: uniqueServiceName, type: "reachy-mini", port, txt });
  return bonjour;
}

describe("discoverRobots()", () => {
  test("finds a real advertised robot with its TXT fields", async () => {
    const bonjour = await advertiseFakeRobot("reachy-mini-test-fixture-1", 48793, {
      version: "1.11.0",
      robot_name: "reachy_mini",
      ws_path: "/ws/sdk",
      model: "wireless",
      manufacturer: "Pollen Robotics",
      unit_id: "test-unit-1",
    });
    try {
      const robots = await discoverRobots(3000);
      const found = robots.find((r) => r.port === 48793);
      expect(found).toBeDefined();
      expect(found!.name).toBe("reachy_mini");
      expect(found!.model).toBe("wireless");
      expect(found!.daemonVersion).toBe("1.11.0");
      expect(found!.unitId).toBe("test-unit-1");
    } finally {
      await new Promise<void>((resolve) => bonjour.unpublishAll(() => resolve()));
      bonjour.destroy();
    }
  }, 10_000);

  test("an absent unit_id (the simulator's own case) reads as null, not a crash", async () => {
    const bonjour = await advertiseFakeRobot("reachy-mini-test-fixture-2", 48794, {
      version: "1.11.0",
      robot_name: "reachy_mini",
      model: "wireless",
    });
    try {
      const robots = await discoverRobots(3000);
      const found = robots.find((r) => r.port === 48794);
      expect(found).toBeDefined();
      expect(found!.unitId).toBeNull();
    } finally {
      await new Promise<void>((resolve) => bonjour.unpublishAll(() => resolve()));
      bonjour.destroy();
    }
  }, 10_000);

  test("no robot on the network is an empty list, never an error", async () => {
    const robots = await discoverRobots(200);
    expect(Array.isArray(robots)).toBe(true);
  });
});

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

describe("GET /api/devices/discover-robots", () => {
  test("requires auth", async () => {
    resetDb();
    const anon = new TestClient();
    const res = await anon.get("/api/devices/discover-robots");
    expect(res.status).toBe(401);
  });

  test("a non-admin adult is refused: pairing new hardware is an admin action", async () => {
    resetDb();
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const res = await adultClient.get("/api/devices/discover-robots");
    expect(res.status).toBe(403);
  });

  test("an owner gets an array back", async () => {
    resetDb();
    const client = await ownerClient();
    const res = await client.get("/api/devices/discover-robots");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
