import { describe, expect, test } from "bun:test";
import { interpretTailscaleStatusJson } from "@/lib/tailscale";

describe("Tailscale status fixtures", () => {
  test("reports installed signed-in machine and HTTPS-ready DNS name", () => {
    expect(interpretTailscaleStatusJson(JSON.stringify({
      BackendState: "Running", CertDomains: ["tail1234.ts.net"], Self: { DNSName: "plain-hub.tail1234.ts.net.", HostName: "plain-hub", UserID: 27, TailscaleIPs: ["100.64.0.2"] },
      User: { "27": { ID: 27, LoginName: "owner@example.test" } },
    }))).toMatchObject({ installed: true, signedIn: true, httpsEnabled: true, machineName: "plain-hub", dnsName: "plain-hub.tail1234.ts.net" });
  });
  test("does not report sign-in or certificate readiness when stopped", () => {
    expect(interpretTailscaleStatusJson(JSON.stringify({ BackendState: "Stopped" }))).toMatchObject({ installed: true, signedIn: false, httpsEnabled: false });
  });
});
