import { describe, expect, test } from "bun:test";
import { runEngineLinkDoctor, type EngineLinkDoctorDependencies } from "../scripts/engine-link-doctor";

function deps(failHop?: number, tailnet: "off" | "disconnected" | "connected" = "connected"): EngineLinkDoctorDependencies {
  return {
    settings: () => ({ selected: true, host: "engine.home", sshPort: 22, localPort: 8771, allowTailnet: tailnet !== "off" }),
    resolve: async () => [tailnet === "off" ? "100.70.0.2" : tailnet === "disconnected" ? "100.70.0.2" : "192.168.1.20"],
    portOpen: async () => failHop !== 3,
    allowed: async (address) => !address.startsWith("100.") || tailnet === "connected",
    tailscale: async () => tailnet === "connected",
    keyFiles: () => ({ privateKey: true, knownHosts: true }),
    hostKey: async () => failHop !== 4,
    authenticate: async () => failHop !== 5,
    forward: async () => failHop !== 6,
    health: async () => ({ ok: failHop !== 7, version: "1" }),
    roles: async () => [{ id: "chat", state: { state: failHop === 8 ? "offline" : "ready" } }],
    gpu: async () => failHop !== 9,
    completion: async () => { if (failHop === 10) throw new Error("scripted"); return 123; },
  };
}

describe("engine-link doctor", () => {
  test("reports each scripted failure with that hop's fix", async () => {
    for (const failed of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const hops = await runEngineLinkDoctor(deps(failed));
      expect(hops).toHaveLength(10);
      expect(hops[failed - 1]!.pass).toBe(false);
      expect(hops[failed - 1]!.fix.length).toBeGreaterThan(0);
    }
  });

  test("hop 2 names the home path when it resolves", async () => {
    const hops = await runEngineLinkDoctor(deps());
    expect(hops[1]).toMatchObject({ pass: true, detail: "path home" });
  });

  test("hop 2 gives the tailnet flag fix when off", async () => {
    const hops = await runEngineLinkDoctor(deps(undefined, "off"));
    expect(hops[1]).toMatchObject({ pass: false, detail: "tailnet address rejected", fix: "Enable away access or use the home address." });
  });

  test("hop 2 reports disconnected Tailscale when the flag is on", async () => {
    const hops = await runEngineLinkDoctor(deps(undefined, "disconnected"));
    expect(hops[1]).toMatchObject({ pass: false, detail: "Tailscale is not connected on this computer", fix: "Connect Tailscale on this computer." });
  });
});
