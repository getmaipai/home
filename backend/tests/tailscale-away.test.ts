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
  test("reads the listed engine peer and classifies its route from Tailscale status fields", () => {
    const direct = interpretTailscaleStatusJson(JSON.stringify({ BackendState: "Running", Self: { UserID: 1 }, User: { "1": { ID: 1 } }, Peer: { key: { DNSName: "engine.example.com.", HostName: "engine", TailscaleIPs: ["100.64.0.20"], Online: true, CurAddr: "192.0.2.20:41641", Relay: "" } } }));
    expect(direct.peers).toEqual([{ dnsName: "engine.example.com", hostName: "engine", ips: ["100.64.0.20"], online: true, path: "direct" }]);
    const relay = interpretTailscaleStatusJson(JSON.stringify({ BackendState: "Running", Peer: { key: { DNSName: "engine.example.com.", TailscaleIPs: ["100.64.0.20"], Online: true, CurAddr: "", Relay: "nyc" } } }));
    expect(relay.peers?.[0]?.path).toBe("relay");
    const offline = interpretTailscaleStatusJson(JSON.stringify({ BackendState: "Running", Peer: { key: { DNSName: "engine.example.com.", TailscaleIPs: ["100.64.0.20"], Online: false } } }));
    expect(offline.peers?.[0]).toMatchObject({ online: false, path: null });
    expect(interpretTailscaleStatusJson(JSON.stringify({ BackendState: "Stopped" })).peers).toEqual([]);
  });
});
