import { describe, expect, test } from "bun:test";
import { statusSummary } from "@/shell/statusSummary";
import type { HealthStatus } from "@/lib/api";

function health(overrides: Partial<HealthStatus> = {}): HealthStatus {
  return {
    brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60,
    engines: {
      chat: { kind: "selection", pid: null, alive: true },
      embed: { kind: "spawned", pid: null, alive: true },
      background: { kind: "spawned", pid: null, alive: true },
      voice: { kind: "spawned", pid: null, alive: true },
    },
    sidecars: [],
    ...overrides,
  };
}

describe("statusSummary", () => {
  test("missing health stays online", () => {
    expect(statusSummary(undefined)).toEqual({ level: "online", text: "All good", problems: [] });
  });

  test("maintenance is shown only when every problem is inside a maintenance window", () => {
    const ready = health();
    const down = { ...ready, engines: { ...ready.engines, voice: { kind: "stopped" as const, pid: null, alive: null } } };
    expect(statusSummary(down, ["voice"])).toEqual({ level: "maintenance", text: "Maintenance", problems: [] });
    expect(statusSummary(down, ["voice"]).level).toBe("maintenance");
    expect(statusSummary({ ...down, engines: { ...down.engines, chat: { kind: "stopped", pid: null, alive: null } } }, ["voice"]).level).toBe("offline");
  });

  test("any unavailable engine makes the status offline and names it", () => {
    const result = statusSummary(health({ engines: { ...health().engines, embed: { kind: "stopped", pid: null, alive: null } } }));
    expect(result).toEqual({ level: "offline", text: "Something is down", problems: ["Understanding"] });
  });

  test("starting engines and unhealthy sidecars make status degraded", () => {
    const result = statusSummary(health({
      engines: { ...health().engines, voice: { kind: "restarting", pid: null, alive: null } },
      sidecars: [
        { id: "kiwix-serve", status: "unhealthy", baseUrl: null },
        { id: "searxng", status: "crashed", baseUrl: null },
      ],
    }));
    expect(result).toEqual({ level: "degraded", text: "Degraded", problems: ["Voice", "Library", "Search"] });
  });

  test("unavailable wins over degraded states and all problem labels are plain names", () => {
    const ready = health();
    const result = statusSummary(health({
      engines: { ...ready.engines, chat: { kind: "failed", pid: null, alive: null }, background: { kind: "starting", pid: null, alive: null } },
      sidecars: [{ id: "searxng", status: "unhealthy", baseUrl: null }],
    }));
    expect(result).toEqual({ level: "offline", text: "Something is down", problems: ["Brain", "Memory", "Search"] });
  });
});
