import { describe, expect, test } from "bun:test";
import { registerWakeWordModels, listWakeWordModels, getWakeWordModel } from "@/lib/voice/wake-word-models";

// A code review (2026-09-04) found an earlier version kept a parallel
// ENTRIES array alongside the REGISTRY map, only ever pushing a NEW id
// into it - re-registering an id already present updated the map but
// left the array (and so listWakeWordModels()) returning the old, stale
// object forever. Uses a throwaway id per test (module state persists
// across the whole file) so tests can't contaminate each other.
describe("wake-word-models.ts registerWakeWordModels()", () => {
  test("re-registering an existing id replaces it everywhere, not just in getWakeWordModel", () => {
    const id = "test-detector-replace";
    registerWakeWordModels([{ id, displayName: "First label", assetPath: "/a.onnx", defaultThreshold: 0.5 }]);
    registerWakeWordModels([{ id, displayName: "Second label", assetPath: "/b.onnx", defaultThreshold: 0.6 }]);

    expect(getWakeWordModel(id).displayName).toBe("Second label");
    const listed = listWakeWordModels().find((e) => e.id === id);
    expect(listed?.displayName).toBe("Second label");
    expect(listed?.assetPath).toBe("/b.onnx");
  });

  test("listWakeWordModels() never returns two entries for the same id", () => {
    const id = "test-detector-no-dupe";
    registerWakeWordModels([{ id, displayName: "A", assetPath: "/a.onnx", defaultThreshold: 0.5 }]);
    registerWakeWordModels([{ id, displayName: "B", assetPath: "/b.onnx", defaultThreshold: 0.5 }]);
    registerWakeWordModels([{ id, displayName: "C", assetPath: "/c.onnx", defaultThreshold: 0.5 }]);

    const matches = listWakeWordModels().filter((e) => e.id === id);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.displayName).toBe("C");
  });
});
