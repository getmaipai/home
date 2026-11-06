// H2 (tools-ecosystem-design-2026-10-03.md section 4): cover the 64-character
// namespaced tool id and reversible mapping contract.
import { describe, expect, test } from "bun:test";
import { createNameMap, MAX_TOOL_NAME } from "@/lib/mcp/nameMap";

describe("name map", () => {
  test("a short name is server__tool and round trips", () => {
    const map = createNameMap();
    const wire = map.toWire("homeassistant", "HassTurnOn");
    expect(wire).toBe("homeassistant__HassTurnOn");
    expect(map.fromWire(wire)).toEqual({ server: "homeassistant", tool: "HassTurnOn" });
  });

  test("a long name is cut to 64 characters and still round trips", () => {
    const map = createNameMap();
    const tool = "get_transcript_for_a_video_with_an_extremely_long_descriptive_name_that_goes_on";
    const wire = map.toWire("youtube", tool);
    expect(wire.length).toBeLessThanOrEqual(MAX_TOOL_NAME);
    expect(wire.startsWith("youtube__get_transcript")).toBe(true);
    expect(wire).toMatch(/_[a-f0-9]{8,}$/);
    expect(map.fromWire(wire)).toEqual({ server: "youtube", tool });
  });

  test("two servers with the same tool name do not collide", () => {
    const map = createNameMap();
    const a = map.toWire("server-one", "list");
    const b = map.toWire("server-two", "list");
    expect(a).not.toBe(b);
    expect(map.fromWire(a)).toEqual({ server: "server-one", tool: "list" });
    expect(map.fromWire(b)).toEqual({ server: "server-two", tool: "list" });
  });

  test("characters a model API rejects are replaced and still reversible", () => {
    const map = createNameMap();
    const wire = map.toWire("cal", "list events.v2");
    expect(wire).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(map.fromWire(wire)).toEqual({ server: "cal", tool: "list events.v2" });
  });

  test("the same pair always gives the same wire name; unknown names give undefined", () => {
    const map = createNameMap();
    expect(map.toWire("a", "b")).toBe(map.toWire("a", "b"));
    expect(map.fromWire("nope__nothing")).toBeUndefined();
    expect(map.fromWire("")).toBeUndefined();
  });

  test("a different pair that sanitises to the same text gets its own name", () => {
    const map = createNameMap();
    const a = map.toWire("s", "a b");
    const b = map.toWire("s", "a.b");
    expect(a).not.toBe(b);
    expect(map.fromWire(a)?.tool).toBe("a b");
    expect(map.fromWire(b)?.tool).toBe("a.b");
  });
});
