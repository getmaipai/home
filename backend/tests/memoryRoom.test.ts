import { describe, expect, test } from "bun:test";
import { capabilityView, cannotRunJobs, readCapabilities, readReclaim, runReclaim } from "@/lib/memoryRoom";

describe("reclaim", () => {
  test("counts idle models and bytes without ids", async () => {
    const view = await readReclaim({ list: async () => ({ items: [{ id: "a", kind: "jit", bytes: 5 }, { id: "b", kind: "image", bytes: 7 }], total_bytes: 12, held_for_grace_bytes: 0 }) });
    expect(view).toEqual({ available: true, models: 2, bytes: 12 });
  });
  test("an older Stack reads as not available", async () => {
    expect(await readReclaim({ list: async () => undefined })).toEqual({ available: false, models: 0, bytes: 0 });
    expect(await runReclaim({ run: async () => undefined })).toEqual({ available: false, unloaded: 0, freed_bytes: 0 });
  });
  test("run reports what the Stack unloaded", async () => {
    expect(await runReclaim({ run: async () => ({ unloaded: 2, freed_bytes: 12 }) })).toEqual({ available: true, unloaded: 2, freed_bytes: 12 });
  });
});

describe("capability table", () => {
  const raw = { machine_class: "p128", total_bytes: 1, rows: [
    { category: "video" as const, tier: "standard" as const, fits_ever: true, needs_bytes: 20, cap_bytes: 45, model: "m" },
    { category: "video" as const, tier: "max" as const, fits_ever: false, needs_bytes: 80, cap_bytes: 72, model: null },
    { category: "chat" as const, tier: "standard" as const, fits_ever: true, needs_bytes: 10, cap_bytes: 45, model: "c" },
  ] };
  test("one row per category with cells only for tiers the Stack lists, in plain order", () => {
    const view = capabilityView(raw);
    expect(view.rows.map((row) => row.label)).toEqual(["Chat", "Videos"]);
    expect(view.rows[1]!.cells).toEqual([{ tier: "standard", fits: true, needs_bytes: 20 }, { tier: "max", fits: false, needs_bytes: 80 }]);
  });
  test("an older Stack reads as not available", async () => {
    expect((await readCapabilities(async () => undefined)).available).toBe(false);
  });
  test("cannotRunJobs lists only categories where no listed tier fits", () => {
    const none = { machine_class: "p16", total_bytes: 1, rows: [
      { category: "video" as const, tier: "standard" as const, fits_ever: false, needs_bytes: 20, cap_bytes: 9, model: null },
      { category: "video" as const, tier: "max" as const, fits_ever: false, needs_bytes: 80, cap_bytes: 9, model: null },
      { category: "image" as const, tier: "standard" as const, fits_ever: true, needs_bytes: 8, cap_bytes: 9, model: "i" },
      { category: "chat" as const, tier: "standard" as const, fits_ever: false, needs_bytes: 10, cap_bytes: 9, model: null },
    ] };
    expect(cannotRunJobs(capabilityView(none))).toEqual(["videos"]);
    expect(cannotRunJobs(capabilityView(undefined))).toEqual([]);
  });
});
