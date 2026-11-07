import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { privacyConnections } from "@/lib/privacy";
import { VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";
import { toolOfferLabel, resolveTurnBudget, withTurnToolGates } from "@/lib/turnMachine/budget";
import { loadManifestOnly } from "@/lib/plugins";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { resetDb } from "../reset-db";

beforeEach(() => resetDb());

describe("uptime offer", () => {
  test("registered as a conditional virtual tool and as a bundled package with the same gate", () => {
    const entry = VIRTUAL_TOOL_REGISTRY.find((tool) => tool.id === "uptime")!;
    expect(entry.offer).toEqual({ mode: "conditional", gate: "uptimeAllowed", bench_row: "uptime-tool", priority: 4 });
    const manifest = loadManifestOnly("uptime");
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.offer).toEqual(entry.offer);
      expect(toolOfferLabel(manifest.value, "enabled")).toBe("not offered: uptimeAllowed");
    }
  });

  test("offered only when the gate passes, and dropped right after house when the offer set passes the cap", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    expect(withTurnToolGates(base, false).tools_offered).not.toContain("uptime");
    const offered = withTurnToolGates(base, false, false, false, false, false, false, false, false, null, false, false, false, false, false, true);
    expect(offered.tools_offered).toContain("uptime");
    const capped = withTurnToolGates({ ...base, max_tools: base.tools_offered.length + 1 }, false, false, false, false, false, false, false, false, null, false, false, false, false, true, true);
    expect(capped.tools_offered).not.toContain("house");
    expect(capped.tools_offered).toContain("uptime");
    const tight = withTurnToolGates({ ...base, max_tools: base.tools_offered.length }, false, false, false, false, false, false, false, false, null, false, false, false, false, false, true);
    expect(tight.tools_offered).not.toContain("uptime");
  });

  test("the tool spec is withheld until the turn is allowed it", () => {
    expect(toolSpecFor("uptime")).toBeNull();
  });
});

describe("uptime privacy row", () => {
  test("no row without an instance; one LAN-only row with one", () => {
    expect(privacyConnections().find((row) => row.id === "platform:uptime-kuma")).toBeUndefined();
    const stamp = "2026-11-06T00:00:00.000Z";
    db.insert(integrations).values({ id: "integ-kuma", type: "uptime_kuma", instance: "main", label: "Main", address: "http://192.168.1.20:3001", credentialRef: "", options: "{}", enabled: true, deletedAt: null, provenance: "admin", createdAt: stamp, updatedAt: stamp, hlc: "1:0:testnode" }).run();
    const row = privacyConnections().find((item) => item.id === "platform:uptime-kuma");
    expect(row?.destination).toContain("LAN");
    expect(row?.what).toContain("Uptime Kuma is told nothing about who asked");
    expect(row?.what).toContain("never phones home");
    expect(row?.direction).toBe("outbound");
  });
});
