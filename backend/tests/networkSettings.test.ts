import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { websocket } from "hono/bun";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getHouseholdSettingValue } from "@/lib/settings";
import { __setHubRestartSchedulerForTests } from "@/lib/hubRestart";
import { canBindHubPort, configuredHubPort, configuredLanExposure, HUB_PORT_IN_USE_MESSAGE } from "@/lib/networkSettings";
import { startHomeListeners, type HomeListenerSet } from "@/lib/homeListeners";
import { listHubEndpoints } from "@/lib/hubEndpoints";
import { startupUrls } from "@/lib/startupUrls";

let listeners: HomeListenerSet | null = null;
let restartCount = 0;
const originalLanExposure = process.env.MAIPAI_LAN_EXPOSURE;

beforeEach(() => { delete process.env.MAIPAI_LAN_EXPOSURE; resetDb(); restartCount = 0; __setHubRestartSchedulerForTests(() => { restartCount++; }); });
afterEach(() => {
  if (originalLanExposure === undefined) delete process.env.MAIPAI_LAN_EXPOSURE;
  else process.env.MAIPAI_LAN_EXPOSURE = originalLanExposure;
  listeners?.stop(); listeners = null; __setHubRestartSchedulerForTests();
});

async function ownerAndChild() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const childResponse = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
  const child = (await childResponse.json()) as { id: string };
  const childClient = new TestClient();
  await childClient.post("/api/auth/select", { personId: child.id });
  return { owner, childClient };
}

describe("Network and access settings", () => {
  test("LAN exposure environment override takes precedence over the household setting", async () => {
    const { owner } = await ownerAndChild();
    const saved = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "network.lan_exposure", value: "loopback" },
    });
    expect(saved.status).toBe(200);

    process.env.MAIPAI_LAN_EXPOSURE = "loopback";
    expect(configuredLanExposure()).toBe("loopback");
    process.env.MAIPAI_LAN_EXPOSURE = "lan";
    expect(configuredLanExposure()).toBe("lan");
    delete process.env.MAIPAI_LAN_EXPOSURE;
    expect(configuredLanExposure()).toBe("loopback");
    process.env.MAIPAI_LAN_EXPOSURE = "unexpected";
    expect(configuredLanExposure()).toBe("loopback");
  });

  test("a non-admin cannot change it", async () => {
    const { childClient } = await ownerAndChild();
    const response = await childClient.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "network.lan_exposure", value: "loopback" },
    });
    expect(response.status).toBe(403);
  });

  test("a port in use is refused with a next step", async () => {
    const { owner } = await ownerAndChild();
    const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    try {
      const occupiedPort = occupied.port!;
      expect(occupiedPort).not.toBe(configuredHubPort());
      expect(canBindHubPort(occupiedPort, "lan")).toBe(false);
      const response = await owner.request("/api/settings", {
        method: "PUT",
        body: { scope: "household", key: "network.hub_port", value: occupiedPort },
      });
      expect(response.status).toBe(400);
      const payload = await response.json() as { error: string };
      expect(payload.error).toBe(HUB_PORT_IN_USE_MESSAGE);
      expect(HUB_PORT_IN_USE_MESSAGE.split(".").filter(Boolean)).toHaveLength(2);
      const rows = await (await owner.get("/api/settings?scope=household")).json() as Array<{ key: string; value: unknown }>;
      expect(rows.find((row) => row.key === "network.hub_port")?.value).toBe(3000);
    } finally {
      occupied.stop(true);
    }
  });

  test("exposure off keeps loopback-only binding", async () => {
    const { owner } = await ownerAndChild();
    const saved = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "network.lan_exposure", value: "loopback" },
    });
    expect(saved.status).toBe(200);
    expect(await listHubEndpoints()).toEqual([]);
    expect(startupUrls(3000, false)).toEqual(["http://localhost:3000"]);
    listeners = startHomeListeners({
      port: 0,
      fetch: () => new Response("ok"),
      websocket,
      exposure: configuredLanExposure(),
      networkAddresses: ["192.0.2.99"],
    });
    expect(listeners.servers.map((server) => server.hostname).sort()).toEqual(["127.0.0.1", "::1"]);
  });

  test("values persist and reload", async () => {
    const { owner } = await ownerAndChild();
    const available = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    const port = available.port!;
    available.stop(true);
    const response = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "network.lan_exposure", value: "loopback" },
    });
    expect(response.status).toBe(200);
    const portWrite = await owner.request("/api/settings", {
      method: "PUT",
      body: { scope: "household", key: "network.hub_port", value: port },
    });
    expect(portWrite.status).toBe(200);
    const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get();
    expect(ownerRow).toBeTruthy();
    expect(getHouseholdSettingValue("network.lan_exposure")).toBe("loopback");
    expect(getHouseholdSettingValue("network.hub_port")).toBe(port);
    expect(configuredHubPort()).toBe(port);
    expect(restartCount).toBe(2);
    const read = await owner.get("/api/settings?scope=household");
    const rows = await read.json() as Array<{ key: string; value: unknown }>;
    expect(rows.find((row) => row.key === "network.lan_exposure")?.value).toBe("loopback");
    expect(rows.find((row) => row.key === "network.hub_port")?.value).toBe(port);
  });
});
