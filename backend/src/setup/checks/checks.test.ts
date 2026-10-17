import { describe, expect, test } from "bun:test";
import { isSupportedInstallPlatform } from "@/lib/installPreflight";
import { checkNvidiaSysmemFallback } from "./nvidiaSysmemFallback";
import { interpretTailscaleStatusJson } from "@/lib/tailscale";
import { runSetupChecks, webSearchNeedsSetup } from "./checks";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "../../../tests/reset-db";

describe("setup check row helpers", () => {
  test("web search discovery is amber and does not choose its candidate", async () => {
    const candidatesOut: Array<{ url: string; status: "pass" | "fail" }> = [];
    const rows = await runSetupChecks({
      health: async () => ({ ok: true }), hardware: async () => ({ hardware: { platform: "darwin", arch: "arm64" }, proposed: { level: "Minimal" } }), catalog: async () => ({ models: [] }),
      modelDisk: async () => ({ status: "green" }), hubDisk: async () => ({ status: "green" }), homeNetwork: async () => true,
      searchCandidates: async () => [{ url: "http://127.0.0.1:8080", status: "pass" }], candidatesOut, stackSearchState: () => "ready",
    });
    expect(rows.find((row) => row.id === "web-search")?.state).toBe("amber");
    expect(candidatesOut).toEqual([{ url: "http://127.0.0.1:8080", status: "pass" }]);
    expect(getHouseholdSettingValue("search.searxng_url")).toBe("");
  });
  test("web search row fixtures cover green and amber, and never red", async () => {
    resetDb();
    const common = { health: async () => ({ ok: true }), hardware: async () => ({ hardware: { platform: "darwin", arch: "arm64" }, proposed: { level: "Minimal" } }), catalog: async () => ({ models: [] }), modelDisk: async () => ({ status: "green" as const }), hubDisk: async () => ({ status: "green" as const }), homeNetwork: async () => true };
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:8080");
    const green = await runSetupChecks({ ...common, configuredSearchStatus: async () => "pass" });
    expect(green.find((row) => row.id === "web-search")?.state).toBe("green");
    const unhealthy = await runSetupChecks({ ...common, configuredSearchStatus: async () => "fail" });
    expect(unhealthy.find((row) => row.id === "web-search")?.state).toBe("amber");
    setHouseholdSettingValue("search.searxng_url", "");
    const ready = await runSetupChecks({ ...common, stackSearchState: () => "ready", searchCandidates: async () => [{ url: "http://127.0.0.1:8888", status: "pass" }] });
    expect(ready.find((row) => row.id === "web-search")?.state).toBe("amber");
    const noStack = await runSetupChecks({ ...common, stackSearchState: () => "absent" });
    expect(noStack.find((row) => row.id === "web-search")?.text).toContain("isn't ready yet");
    const installing = await runSetupChecks({ ...common, stackSearchState: () => "installing" });
    expect(installing.find((row) => row.id === "web-search")?.text).toBe("Web search is still installing...");
    const candidate = await runSetupChecks({ ...common, searchCandidates: async () => [{ url: "http://127.0.0.1:8080", status: "fail" }] });
    expect(candidate.find((row) => row.id === "web-search")?.state).toBe("amber");
    expect([ready, noStack, installing, candidate].flatMap((rows) => rows.filter((row) => row.id === "web-search")).every((row) => row.state !== "red")).toBe(true);
  });
  test("the Web search screen is offered unless the row is green or the Stack is still installing search", async () => {
    resetDb();
    const common = { health: async () => ({ ok: true }), hardware: async () => ({ hardware: { platform: "darwin", arch: "arm64" }, proposed: { level: "Minimal" } }), catalog: async () => ({ models: [] }), modelDisk: async () => ({ status: "green" as const }), hubDisk: async () => ({ status: "green" as const }), homeNetwork: async () => true };
    expect(webSearchNeedsSetup(await runSetupChecks({ ...common, stackSearchState: () => "absent" }))).toBe(true);
    expect(webSearchNeedsSetup(await runSetupChecks({ ...common, stackSearchState: () => "installing" }))).toBe(false);
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:8080");
    expect(webSearchNeedsSetup(await runSetupChecks({ ...common, configuredSearchStatus: async () => "pass" }))).toBe(false);
    expect(webSearchNeedsSetup(await runSetupChecks({ ...common, configuredSearchStatus: async () => "fail" }))).toBe(true);
    setHouseholdSettingValue("search.searxng_url", "");
  });
  test("synthetic Tailscale states produce matching peer and route rows", async () => {
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    const status = (state: string, peer?: Record<string, unknown>) => ({ state: state as "running" | "stopped" | "not_installed", dnsName: null, ips: [], installed: state !== "not_installed", signedIn: state === "running", httpsEnabled: false, machineName: null, peers: peer ? interpretTailscaleStatusJson(JSON.stringify({ BackendState: "Running", Peer: { engine: peer } })).peers : [] });
    const setup = async (tailscale: ReturnType<typeof status>, allowed = true) => runSetupChecks({
      health: async () => ({ ok: true }), hardware: async () => ({ hardware: { platform: "darwin", arch: "arm64" }, proposed: { level: "Minimal" } }),
      catalog: async () => ({ models: [] }), modelDisk: async () => ({ status: "green" }), hubDisk: async () => ({ status: "green" }),
      tailscale: async () => tailscale, tailnetAllowed: () => allowed, engineHost: () => "100.64.0.20", link: () => ({ state: "ready", slow: false }),
    });
    const peer = { DNSName: "engine.example.com.", HostName: "engine", TailscaleIPs: ["100.64.0.20"], Online: true, CurAddr: "192.0.2.20:41641", Relay: "" };
    const direct = await setup(status("running", peer));
    expect(direct.find((row) => row.id === "tailnet-peer")?.state).toBe("green");
    expect(direct.find((row) => row.id === "tailnet-route")?.state).toBe("green");
    const relay = await setup(status("running", { ...peer, CurAddr: "", Relay: "nyc" }));
    expect(relay.find((row) => row.id === "tailnet-route")?.text).toContain("Tailscale relay");
    const offline = await setup(status("running", { ...peer, Online: false }));
    expect(offline.find((row) => row.id === "tailnet-peer")?.text).toContain("Open Tailscale on it");
    expect((await setup(status("not_installed"))).find((row) => row.id === "tailnet-peer")?.state).toBe("amber");
    expect((await setup(status("stopped"))).find((row) => row.id === "tailnet-peer")?.state).toBe("amber");
    expect((await setup(status("running", peer), false)).find((row) => row.id === "tailnet-allow")?.actionLabel).toBe("Allow");
  });
  test("Computer row is red when the platform is unsupported; there is no separate System row", async () => {
    resetDb();
    const common = { catalog: async () => ({ models: [] }), modelDisk: async () => ({ status: "green" as const }), hubDisk: async () => ({ status: "green" as const }), homeNetwork: async () => true };
    const down = await runSetupChecks({ ...common, health: async () => ({ ok: false }), hardware: async () => { throw new Error("down"); }, localHardware: () => ({ platform: "darwin", arch: "arm64", totalMemory: 16e9 }) });
    expect(down.find((row) => row.id === "engine")?.state).toBe("red");
    expect(down.find((row) => row.id === "system")).toBeUndefined();
    const intel = await runSetupChecks({ ...common, health: async () => ({ ok: true }), hardware: async () => ({ hardware: { platform: "darwin", arch: "x64" }, proposed: { level: "Minimal" } }) });
    expect(intel.find((row) => row.id === "memory")?.state).toBe("red");
  });
  test("before the engine is installed there is no engine row and the computer is judged by its own facts", async () => {
    resetDb();
    const common = { preInstall: true, catalog: async () => { throw new Error("no engine"); }, modelDisk: async () => ({ status: "green" as const }), hubDisk: async () => ({ status: "green" as const }), homeNetwork: async () => true, hostReach: async () => true };
    const ok = await runSetupChecks({ ...common, localHardware: () => ({ platform: "darwin", arch: "arm64", totalMemory: 16e9 }) });
    expect(ok.find((row) => row.id === "engine")).toBeUndefined();
    expect(ok.find((row) => row.id === "memory")?.state).toBe("green");
    expect(ok.find((row) => row.id === "download-host")?.state).toBe("green");
    const small = await runSetupChecks({ ...common, localHardware: () => ({ platform: "darwin", arch: "arm64", totalMemory: 2e9 }) });
    expect(small.find((row) => row.id === "memory")?.state).toBe("red");
  });
  test("engine row uses plain words for This computer and says what to do when it fails", async () => {
    resetDb();
    setHouseholdSettingValue("engines.stack.where", "this_computer");
    const common = { catalog: async () => ({ models: [] }), modelDisk: async () => ({ status: "green" as const }), hubDisk: async () => ({ status: "green" as const }), homeNetwork: async () => true, hardware: async () => ({ hardware: { platform: "darwin", arch: "arm64" }, proposed: { level: "Minimal" } }) };
    const up = await runSetupChecks({ ...common, health: async () => ({ ok: true }) });
    expect(up.find((row) => row.id === "engine")?.text).toBe("The AI engine on this computer is answering.");
    const noAddress = await runSetupChecks({ ...common, health: async () => ({ ok: false }) });
    const bare = noAddress.find((row) => row.id === "engine")!;
    expect(bare.text).toContain("isn't answering");
    expect(bare.text).toContain("Start it");
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    const withAddress = (await runSetupChecks({ ...common, health: async () => ({ ok: false }) })).find((row) => row.id === "engine")!;
    expect(withAddress.text).toContain("http://127.0.0.1:8770");
    for (const rows of [up, noAddress]) for (const row of rows) { expect(row.text).not.toMatch(/\bStack\b|engine computer|\u2014/); }
    expect(withAddress.text).not.toMatch(/\bStack\b|engine computer|\u2014/);
    const memory = noAddress.find((row) => row.id === "memory")!;
    expect(memory.text).not.toMatch(/engine computer/);
    setHouseholdSettingValue("engines.stack.url", "");
  });
  test("the shared installer platform rule accepts supported hosts and refuses Intel macOS", () => {
    expect(isSupportedInstallPlatform("darwin", "arm64")).toBe(true);
    expect(isSupportedInstallPlatform("linux", "x64")).toBe(true);
    expect(isSupportedInstallPlatform("darwin", "x64")).toBe(false);
    expect(isSupportedInstallPlatform("freebsd", "x64")).toBe(false);
  });

  test("NVIDIA check fixtures represent green, amber and idle", async () => {
    await expect(checkNvidiaSysmemFallback({ hasNvidiaGpu: async () => true, isSysmemFallbackEnabled: async () => false })).resolves.toEqual({ status: "green" });
    await expect(checkNvidiaSysmemFallback({ hasNvidiaGpu: async () => true, isSysmemFallbackEnabled: async () => true })).resolves.toMatchObject({ status: "amber" });
    await expect(checkNvidiaSysmemFallback({ hasNvidiaGpu: async () => { throw new Error("unreadable"); }, isSysmemFallbackEnabled: async () => false })).resolves.toEqual({ status: "idle" });
  });
});
