import { beforeEach, describe, expect, test } from "bun:test";
import { getTailscaleStatus, interpretTailscaleStatusJson } from "@/lib/tailscale";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

test("pre-owner status and enable are available only through setup-local checks", async () => {
  const local = new TestClient();
  expect((await local.get("/api/tailscale/status")).status).toBe(200);
  const tsHost = new TestClient();
  expect((await tsHost.get("/api/tailscale/status", { host: "hub.example.ts.net" })).status).toBe(403);
  const remote = new TestClient("192.0.2.40");
  expect((await remote.get("/api/tailscale/status")).status).toBe(403);
  expect((await local.post("/api/tailscale/enable", {})).status).toBe(400);
});

test("after owner creation, status and enable require an owner/admin session", async () => {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  expect((await new TestClient().get("/api/tailscale/status")).status).toBe(401);
  expect((await owner.get("/api/tailscale/status")).status).toBe(200);
  const nonLoopbackWithOwnerSession = new TestClient("192.0.2.40");
  // The session cookie is host-independent; a network peer still needs a valid owner session.
  expect((await nonLoopbackWithOwnerSession.get("/api/tailscale/status")).status).toBe(401);
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
