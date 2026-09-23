import { describe, expect, test } from "bun:test";
import { stateFromProbe } from "@/lib/homeSupervisorRoles";
import type { EngineHealth } from "@/lib/sidecars";

// A pure mapping, tested directly against fabricated EngineHealth values
// (the deterministic, offline-by-default kind of test the shared
// enginesRoutes.test.ts route test can't cheaply cover - "starting" only
// occurs during a real, timing-dependent spawn in flight, not something
// a per-commit test should trigger for real). This is the exact mapping
// a code review found incomplete once already (VOICE-LIVE-01b, "starting"
// falling through to "ready" and disagreeing with GET /api/health's own
// "starting up" badge) - each EngineHealthKind gets its own row here so a
// third gap can't ship unnoticed the same way.
function health(kind: EngineHealth["kind"], alive: boolean | null = null): EngineHealth {
  return { kind, pid: null, alive };
}

describe("homeSupervisorRoles stateFromProbe()", () => {
  test("a spawn actually in flight (starting, alive still null) is not ready", () => {
    expect(stateFromProbe(health("starting")).state).toBe("loaded");
  });

  test("a manually-stopped engine is offline, not ready", () => {
    expect(stateFromProbe(health("stopped")).state).toBe("offline");
  });

  test("a crash-looping engine (restarting) is offline", () => {
    expect(stateFromProbe(health("restarting")).state).toBe("offline");
  });

  test("an engine that gave up (failed) is offline", () => {
    expect(stateFromProbe(health("failed")).state).toBe("offline");
  });

  test("a probe that came back false is offline even with an otherwise fine kind", () => {
    expect(stateFromProbe(health("stub", false)).state).toBe("offline");
  });

  test("never asked this boot (alive null, no spawn in flight) reads ready - the guaranteed stub tier", () => {
    expect(stateFromProbe(health("none")).state).toBe("ready");
    expect(stateFromProbe(health("stub")).state).toBe("ready");
  });

  test("a confirmed-answering engine reads ready", () => {
    expect(stateFromProbe(health("url", true)).state).toBe("ready");
  });
});
