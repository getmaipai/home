import { describe, expect, test } from "bun:test";
import { getTailscaleStatus, interpretTailscaleStatusJson } from "@/lib/tailscale";

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
      Self: { DNSName: "hub.example-tailnet.ts.net.", TailscaleIPs: ["100.64.1.2"] },
    });
    expect(interpretTailscaleStatusJson(json)).toEqual({
      state: "running",
      dnsName: "hub.example-tailnet.ts.net",
      ips: ["100.64.1.2"],
    });
  });

  test("a stopped backend reports stopped with no addresses", () => {
    const json = JSON.stringify({ BackendState: "Stopped" });
    expect(interpretTailscaleStatusJson(json)).toEqual({ state: "stopped", dnsName: null, ips: [] });
  });

  test("a running backend with no Self block still reports running, with empty addresses", () => {
    const json = JSON.stringify({ BackendState: "Running" });
    expect(interpretTailscaleStatusJson(json)).toEqual({ state: "running", dnsName: null, ips: [] });
  });
});
