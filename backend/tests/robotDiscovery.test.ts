import { describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { discoverRobots, type AdvertisedService, type RobotBrowserHost } from "@/lib/robotDiscovery";

// Gate lane: discoverRobots() against a fake browser host, so the gate proves
// the browse window, TXT reading and the never-throws posture without the
// machine's network. The real multicast round trip is the bench test
// tests/robotDiscovery.mdns.test.ts (GATE-FAST-01, 2026-10-16).
function fakeHost(services: AdvertisedService[], opts: { failFind?: boolean } = {}) {
  const calls = { stop: 0, destroy: 0, type: "" };
  const host: RobotBrowserHost = {
    find({ type }) {
      calls.type = type;
      if (opts.failFind) throw new Error("multicast filtered");
      return {
        on(_event, handler) {
          for (const s of services) setTimeout(() => handler(s), 5);
          return this;
        },
        stop() {
          calls.stop += 1;
        },
      };
    },
    destroy() {
      calls.destroy += 1;
    },
  };
  return { host, calls };
}

const advertised = (port: number, txt: Record<string, string>): AdvertisedService => ({
  fqdn: `fixture-${port}._reachy-mini._tcp.local`,
  name: `reachy-mini-test-fixture-${port}`,
  host: "reachy-mini.local",
  port,
  addresses: ["192.0.2.10"],
  txt,
});

describe("discoverRobots()", () => {
  test("browses _reachy-mini._tcp and reads the daemon's TXT fields", async () => {
    const { host, calls } = fakeHost([
      advertised(48793, { version: "1.11.0", robot_name: "reachy_mini", model: "wireless", unit_id: "test-unit-1" }),
    ]);
    const robots = await discoverRobots(50, { createHost: () => host });
    expect(calls.type).toBe("reachy-mini");
    expect(robots).toHaveLength(1);
    expect(robots[0]).toMatchObject({ name: "reachy_mini", host: "reachy-mini.local", port: 48793, addresses: ["192.0.2.10"], model: "wireless", daemonVersion: "1.11.0", unitId: "test-unit-1" });
    expect(calls.stop).toBe(1);
    expect(calls.destroy).toBe(1);
  });

  test("an absent unit_id (the simulator's own case) reads as null, and the name falls back to the service name", async () => {
    const { host } = fakeHost([advertised(48794, { version: "1.11.0", model: "wireless" })]);
    const robots = await discoverRobots(50, { createHost: () => host });
    expect(robots[0]!.unitId).toBeNull();
    expect(robots[0]!.name).toBe("reachy-mini-test-fixture-48794");
  });

  test("the same robot announced twice is one row (keyed by fqdn)", async () => {
    const twice = advertised(48795, { robot_name: "reachy_mini" });
    const { host } = fakeHost([twice, twice]);
    expect(await discoverRobots(50, { createHost: () => host })).toHaveLength(1);
  });

  test("a browser failure is an empty list, never an error, and the host is still destroyed", async () => {
    const { host, calls } = fakeHost([], { failFind: true });
    expect(await discoverRobots(50, { createHost: () => host })).toEqual([]);
    expect(calls.destroy).toBe(1);
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
