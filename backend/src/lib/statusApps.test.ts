import { describe, expect, test } from "bun:test";
import { appResponse, buildAppHistory, deriveAppState, unionRequiredDowntime, type StatusApp } from "@/lib/statusApps";
import { __resetInternetProbeForTests, classifyInternetFailures, probeInternet } from "@/lib/internetProbe";

describe("app status derivation", () => {
  test.each([
    ["operational", [{ required: true, state: "operational" }, { required: false, state: "operational" }], "operational"],
    ["required down", [{ required: true, state: "down" }], "down"],
    ["optional down", [{ required: true, state: "operational" }, { required: false, state: "down" }], "degraded"],
    ["optional internet down", [{ required: true, state: "operational" }, { required: false, state: "down", kind: "internet" }], "degraded"],
    ["required degraded", [{ required: true, state: "degraded" }], "degraded"],
    ["internet failure", [{ required: true, state: "down", kind: "internet" }], "waiting_for_internet"],
    ["internet masks dependent failure", [{ required: true, state: "down", kind: "internet" }, { required: true, state: "down" }], "waiting_for_internet"],
  ] as const)("%s", (_name, needs, expected) => {
    expect(deriveAppState(needs as never)).toBe(expected);
  });

  test("required downtime is the union of component outage intervals", () => {
    expect(unionRequiredDowntime([
      [[0, 20], [40, 60]],
      [[10, 30], [55, 70]],
    ])).toEqual([[0, 30], [40, 70]]);
  });

  test("daily uptime subtracts the union, not the sum, of required outages", () => {
    const needs = [
      { kind: "engine", id: "chat", name: "AI", purpose: "Chat", required: true },
      { kind: "engine", id: "understanding", name: "Understanding", purpose: "Context", required: true },
    ] as const;
    const events = [
      { component: "chat", state: "operational", at: "2026-09-10T00:00:00Z" },
      { component: "chat", state: "outage", at: "2026-09-10T00:02:00Z" },
      { component: "chat", state: "operational", at: "2026-09-10T00:08:00Z" },
      { component: "embed", state: "operational", at: "2026-09-10T00:00:00Z" },
      { component: "embed", state: "outage", at: "2026-09-10T00:04:00Z" },
      { component: "embed", state: "operational", at: "2026-09-10T00:10:00Z" },
    ];
    const result = buildAppHistory(needs as never, events, new Date("2026-09-10T00:10:00Z"));
    expect(result.history.at(-1)?.uptime).toBe(20);
  });

  test("planned maintenance time does not count as app downtime", () => {
    const needs = [
      { kind: "engine", id: "chat", name: "AI", purpose: "Chat", required: true },
      { kind: "engine", id: "understanding", name: "Understanding", purpose: "Context", required: true },
    ] as const;
    const events = [
      { component: "chat", state: "maintenance", at: "2026-09-10T00:00:00Z" },
      { component: "embed", state: "operational", at: "2026-09-10T00:00:00Z" },
      { component: "embed", state: "outage", at: "2026-09-10T00:02:00Z" },
      { component: "embed", state: "operational", at: "2026-09-10T00:08:00Z" },
      { component: "chat", state: "operational", at: "2026-09-10T00:10:00Z" },
    ];
    const result = buildAppHistory(needs as never, events, new Date("2026-09-10T00:10:00Z"));
    expect(result.history.at(-1)).toMatchObject({ state: "operational", uptime: 100 });
  });

  test("internet failure masks dependent component state and hides needs from members", () => {
    const app: StatusApp = { id: "videos", name: "Videos", needs: [
      { kind: "internet", id: "internet", name: "Internet", purpose: "Reach outside", required: true },
      { kind: "service", id: "youtube", name: "YouTube", purpose: "Play videos", required: true },
    ] };
    const events = [
      { component: "internet", state: "outage", at: "2026-09-10T00:00:00Z" },
      { component: "service:youtube", state: "outage", at: "2026-09-10T00:00:00Z" },
    ];
    const member = appResponse(app, events, false, new Date("2026-09-10T00:01:00Z"));
    expect(member.state).toBe("waiting_for_internet");
    expect(member.reason).toBe("Videos is waiting for the internet.");
    expect("needs" in member).toBe(false);
    const admin = appResponse(app, events, true, new Date("2026-09-10T00:01:00Z"));
    expect(admin.needs?.map((need) => need.state)).toEqual(["down", "waiting"]);
  });
});

test("internet probe state needs three consecutive failures for down", () => {
  expect(classifyInternetFailures(0)).toBe("operational");
  expect(classifyInternetFailures(1)).toBe("degraded");
  expect(classifyInternetFailures(2)).toBe("degraded");
  expect(classifyInternetFailures(3)).toBe("down");
});

test("probe runs both injected endpoints and uses three consecutive combined failures", async () => {
  __resetInternetProbeForTests();
  let dnsCalls = 0;
  let tcpCalls = 0;
  const settings = { enabled: true, dnsName: "example.com", tcpAddress: "1.1.1.1", tcpPort: 443 };
  const both = { resolve: async () => { dnsCalls++; }, connect: async () => { tcpCalls++; } };
  expect(await probeInternet(settings, both)).toBe("operational");
  const failedDns = { ...both, resolve: async () => { dnsCalls++; throw new Error("dns failed"); } };
  expect(await probeInternet(settings, failedDns)).toBe("degraded");
  expect(await probeInternet(settings, failedDns)).toBe("degraded");
  expect(await probeInternet(settings, failedDns)).toBe("down");
  expect([dnsCalls, tcpCalls]).toEqual([4, 4]);
});
