import { beforeEach, describe, expect, test } from "bun:test";
import { getTailscaleStatus, interpretTailscaleStatusJson } from "@/lib/tailscale";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { owner, teen } from "./support/testAuth";

beforeEach(() => resetDb());

test("away routes refuse anyone signed out, even before an owner exists", async () => {
  const local = new TestClient();
  expect((await local.get("/api/tailscale/status")).status).toBe(401);
  expect((await local.post("/api/tailscale/enable", {})).status).toBe(401);
});

test("away routes refuse a non-admin with a message that says who can do it", async () => {
  const household = await owner();
  const adult = await teen(household.client);
  const status = await adult.get("/api/tailscale/status");
  const enable = await adult.post("/api/tailscale/enable", {});
  expect(status.status).toBe(403);
  expect(enable.status).toBe(403);
  for (const response of [status, enable]) {
    const body = await response.json() as { error: string };
    expect(body.error).toContain("Only the owner or an admin");
    expect(body.error).toContain("Ask one of them.");
  }
});

test("owner sessions can read away status", async () => {
  const household = await owner();
  expect((await household.client.get("/api/tailscale/status")).status).toBe(200);
});

describe("getTailscaleStatus() (real query on this machine)", () => {
  test("never throws, and resolves to one of the declared states", async () => {
    const status = await getTailscaleStatus();
    expect(["not_installed", "stopped", "running"]).toContain(status.state);
  });
});

describe("interpretTailscaleStatusJson()", () => {
  test("a running backend with MagicDNS and tailnet IPs reports them", () => {
    const json = JSON.stringify({
      BackendState: "Running",
      CertDomains: ["example-tailnet.ts.net"],
      Self: { DNSName: "hub.example-tailnet.ts.net.", TailscaleIPs: ["100.64.1.2"] },
    });
    expect(interpretTailscaleStatusJson(json)).toEqual({
      state: "running",
      dnsName: "hub.example-tailnet.ts.net",
      ips: ["100.64.1.2"],
      installed: true,
      signedIn: false,
      httpsEnabled: true,
      machineName: "hub",
      peers: [],
    });
  });

  test("a stopped backend reports stopped with no addresses", () => {
    const json = JSON.stringify({ BackendState: "Stopped" });
    expect(interpretTailscaleStatusJson(json)).toEqual({ state: "stopped", dnsName: null, ips: [], installed: true, signedIn: false, httpsEnabled: false, machineName: null, peers: [] });
  });

  test("a running backend with no Self block still reports running, with empty addresses", () => {
    const json = JSON.stringify({ BackendState: "Running" });
    expect(interpretTailscaleStatusJson(json)).toEqual({ state: "running", dnsName: null, ips: [], installed: true, signedIn: false, httpsEnabled: false, machineName: null, peers: [] });
  });
});
