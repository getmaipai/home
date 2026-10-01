import { describe, expect, test } from "bun:test";
import { StackFitPlan, type StackFitPlan as Plan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import { describeFitPlan, describeHomeOwnedRoles } from "@/lib/fitPanel";

const measured = (low: number, high: number) => ({ low: Math.round(low), high: Math.round(high), source: "measured" as const, as_of: "2026-09-30" });
const unknownFigure = () => ({ low: null, high: null, source: "unknown" as const, as_of: "2026-09-30" });

describe("describeHomeOwnedRoles", () => {
  test("describes an empty list", () => expect(describeHomeOwnedRoles([])).toBe(""));
  test("describes one role", () => expect(describeHomeOwnedRoles(["chat"])).toBe("chat"));
  test("joins two roles with and", () => expect(describeHomeOwnedRoles(["chat", "embeddings"])).toBe("chat and search"));
  test("joins four roles in the given order", () => expect(describeHomeOwnedRoles(["chat", "embeddings", "stt", "tts"])).toBe("chat, search, listening and speaking"));
});
function plan(verdict: Plan["verdict"]): Plan {
  return StackFitPlan.parse({
    schema: 1, model: "example", context_tokens: 8192, kv_cache_type: "f16",
    roles: [{ role: "chat", choice: "example-q4", peak: measured(4 * 1024 ** 3, 5 * 1024 ** 3) }],
    total: measured(5 * 1024 ** 3, 8 * 1024 ** 3), cap: measured(16 * 1024 ** 3, 16 * 1024 ** 3), margin: measured(0, 0),
    paths: [{ path: "unified", fits: verdict === "yes", verdict: verdict === "slow" ? "no" : verdict, ...(verdict === "no" ? { shortfall: measured(5 * 1024 ** 3, 6 * 1024 ** 3) } : {}) }],
    verdict, bottleneck: "memory",
  });
}

describe("describeFitPlan", () => {
  test("puts the known model file first without an estimate source or date", () => {
    const source = plan("unknown");
    source.model_file_bytes = 11_771_546_784;
    const row = describeFitPlan(source).rows[0]!;
    expect(row).toEqual({ label: "Model file", value: "about 11 GB" });
  });
  test("omits the model file row when its size is unknown", () => {
    expect(describeFitPlan(plan("unknown")).rows[0]?.label).toBe("Memory it needs");
  });
  test("lays out each valid verdict without changing plan numbers", () => {
    for (const verdict of ["yes", "slow", "no", "unknown"] as const) {
      const source = plan(verdict);
      const result = describeFitPlan(source);
      expect(result.rows[0]?.value).toBe("about 5 to 8 GB");
      expect(result.rows[1]?.value).toBe("about 16 GB");
      expect(result.rows.find((row) => row.label === "Chat")?.value).toBe("about 4 to 5 GB");
      expect(result.rows[0]?.source).toBe(source.total.source);
      expect(result.rows[0]?.asOf).toBe(source.total.as_of);
    }
  });
  test("says a no plan does not fit even when a listed CPU path fits", () => {
    const source = plan("no");
    source.paths = [{ path: "cpu", fits: true, verdict: "yes" }];
    expect(describeFitPlan(source).rows.find((row) => row.label === "How it would run")?.value).toBe("It does not fit here");
  });
  test("says the run path is not known for an unknown plan", () => {
    expect(describeFitPlan(plan("unknown")).rows.find((row) => row.label === "How it would run")?.value).toBe("Not known yet");
  });
  test("reports unknown figures without inventing values", () => {
    const source = plan("unknown");
    source.total = unknownFigure();
    source.cap = unknownFigure();
    expect(describeFitPlan(source).rows.slice(0, 2).map((row) => row.value)).toEqual(["Not known yet", "Not known yet"]);
  });
  test("collapses a range when both endpoints round to the same tenth", () => {
    const source = plan("yes");
    source.total = { low: Math.round(5.01 * 1024 ** 3), high: Math.round(5.09 * 1024 ** 3), source: "measured", as_of: "2026-09-30" };
    expect(describeFitPlan(source).rows[0]?.value).toBe("about 5.1 GB");
  });
  test("offers the shortfall remedy only when the plan says no", () => {
    expect(describeFitPlan(plan("no")).remedy).toBe("It needs about 6 GB more memory. A smaller version of this model, or a shorter conversation memory, would help.");
  });
  test("offers a faster model remedy for a slow plan", () => {
    expect(describeFitPlan(plan("slow")).remedy).toBe("A smaller version of this model would run faster.");
  });
  test("has no remedy for yes or unknown plans", () => {
    expect(describeFitPlan(plan("yes")).remedy).toBeNull();
    expect(describeFitPlan(plan("unknown")).remedy).toBeNull();
  });
});
