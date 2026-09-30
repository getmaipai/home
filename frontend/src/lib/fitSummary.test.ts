import { describe, expect, test } from "bun:test";
import { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import { summarizeFits, type FitSummaryItem } from "@/lib/fitSummary";

const plan = StackFitPlan.parse({ schema: 1, model: "example", context_tokens: 8192, kv_cache_type: "f16", roles: [{ role: "chat", choice: "q4", peak: { low: 4 * 1024 ** 3, high: 5 * 1024 ** 3, source: "estimated", as_of: "2026-09-30" } }], total: { low: 5 * 1024 ** 3, high: 9 * 1024 ** 3, source: "estimated", as_of: "2026-09-30" }, cap: { low: 15 * 1024 ** 3, high: 16 * 1024 ** 3, source: "measured", as_of: "2026-09-30" }, margin: { low: 6 * 1024 ** 3, high: 11 * 1024 ** 3, source: "measured", as_of: "2026-09-30" }, paths: [{ path: "unified", fits: true, verdict: "yes" }], verdict: "yes", bottleneck: "memory" });
const item = (name: string, headline = "Runs well on this computer", selectedPlan: ReturnType<typeof StackFitPlan.parse> | null = plan): FitSummaryItem => ({ name, wording: { verdict: "yes", headline, detail: "About 5 GB." }, plan: selectedPlan });

describe("summarizeFits", () => {
  test("summarizes one item and reuses its plan memory wording", () => {
    expect(summarizeFits([item("org/model")], { memoryGb: 24, usableGb: 16 })).toBe("What my computer can run\nMemory for models: 16 GB\n\norg/model: Runs well on this computer (needs about 5 to 9 GB)\n\nChecked with MaiPai Home.");
  });

  test("summarizes three items in their given order", () => {
    const result = summarizeFits([item("first"), item("second", "Won't fit"), item("third")], { memoryGb: 24, usableGb: 16 });
    expect(result).toContain("first: Runs well on this computer");
    expect(result).toContain("second: Won't fit");
    expect(result).toContain("third: Runs well on this computer");
  });

  test("omits memory needs for a plan-null item", () => {
    expect(summarizeFits([item("unknown", "Can't check", null)], { memoryGb: null, usableGb: null })).toBe("What my computer can run\n\nunknown: Can't check\n\nChecked with MaiPai Home.");
  });

  test("keeps a colon in a name and uses only the supplied wording", () => {
    expect(summarizeFits([item("Milo: sample")], { memoryGb: null, usableGb: null })).toContain("Milo: sample: Runs well on this computer");
  });

  test("is deterministic and contains no em dash or extra machine details", () => {
    const items = [item("Milo"), item("Nora")];
    const computer = { memoryGb: 24, usableGb: 16 };
    const first = summarizeFits(items, computer);
    expect(summarizeFits(items, computer)).toBe(first);
    expect(first).not.toContain("—");
    expect(first).toContain("Milo:");
    expect(first).toContain("Nora:");
    expect(first).not.toContain("24 GB");
  });
});
