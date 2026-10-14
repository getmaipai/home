import { describe, expect, test } from "bun:test";
import { isSupportedInstallPlatform } from "@/lib/installPreflight";
import { checkNvidiaSysmemFallback } from "./nvidiaSysmemFallback";
import { interpretTailscaleStatusJson } from "@/lib/tailscale";
import { runSetupChecks } from "./checks";

describe("setup check row helpers", () => {
  test("synthetic Tailscale states produce matching peer and route rows", async () => {
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
