import { describe, expect, test } from "bun:test";
import { fitNoStackWording, fitNotFoundWording, fitWording } from "@/lib/fitWording";
import { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import { makePlan } from "./fixtures/fitPlanFixtures";

describe("fit wording", () => {
  test("words all four verdicts", () => {
    expect(fitWording(makePlan("yes")).headline).toBe("Runs well on this computer");
    expect(fitWording(makePlan("slow")).detail).toBe("It fits only by using the processor, so answers will be slower.");
    expect(fitWording(makePlan("no")).headline).toBe("Won't fit");
    expect(fitWording(makePlan("unknown")).detail).toBe("Nobody has measured a model like this on a computer like yours yet.");
  });

  test("states the known file size and cap for an unmeasured model family", () => {
    const plan = makePlan("unknown", { model_file_bytes: 11_771_546_784, cap: { low: 16 * 1024 ** 3, high: 16 * 1024 ** 3, source: "measured", as_of: "2026-09-30" } });
    expect(fitWording(plan).headline).toBe("Can't tell yet");
    expect(fitWording(plan).detail).toBe("The model file is about 11 GB, and this computer can give 16 GB to models. How much more memory it needs while running is not known for this model family yet.");
  });

  test("rounds an unmeasured model file size up to one decimal", () => {
    const plan = makePlan("unknown", { model_file_bytes: Math.round(4.2 * 1024 ** 3), cap: { low: 16 * 1024 ** 3, high: 16 * 1024 ** 3, source: "measured", as_of: "2026-09-30" } });
    expect(fitWording(plan).detail).toContain("The model file is about 4.2 GB,");
  });

  test("keeps the old unknown detail when file size is absent", () => {
    expect(fitWording(makePlan("unknown")).detail).toBe("Nobody has measured a model like this on a computer like yours yet.");
  });

  test("keeps the old unknown detail when the memory cap is unknown", () => {
    const plan = makePlan("unknown", { model_file_bytes: 11_771_546_784, cap: { low: null, high: null, source: "unknown", as_of: "2026-09-30" } });
    expect(fitWording(plan).detail).toBe("Nobody has measured a model like this on a computer like yours yet.");
  });

  test("does not change yes wording when the plan includes a model file size", () => {
    const plan = makePlan("yes", { model_file_bytes: 11_771_546_784 });
    expect(fitWording(plan).detail).toBe("About 3 GB of the 16 GB this computer can give to models.");
  });

  test("uses the largest reported shortfall", () => {
    const GiB = 1024 ** 3;
    const plan = makePlan("no", { paths: [
      { path: "unified", fits: false, verdict: "no", shortfall: { low: 2 * GiB, high: 3 * GiB, source: "estimated", as_of: "2026-09-30" } },
      { path: "gpu", fits: false, verdict: "no", shortfall: { low: 5 * GiB, high: 6 * GiB, source: "estimated", as_of: "2026-09-30" } },
    ] });
    expect(fitWording(plan).detail).toBe(`Needs about ${Math.max(1, Math.ceil(6 * GiB / 1024 ** 3))} GB more memory.`);
  });

  test("words the yes memory figures and falls back for null figures", () => {
    const GiB = 1024 ** 3;
    const plan = makePlan("yes");
    expect(fitWording(plan).detail).toBe(`About ${Math.max(1, Math.ceil(3 * GiB / 1024 ** 3))} GB of the ${Math.floor(16 * GiB / 1024 ** 3)} GB this computer can give to models.`);
    const nullPlan = StackFitPlan.parse({ ...plan, total: { low: null, high: null, source: "unknown", as_of: plan.total.as_of } });
    expect(fitWording(nullPlan).detail).toBe("There is room for it.");
  });

  test("words a model the Stack could not find", () => {
    expect(fitNotFoundWording()).toEqual({ verdict: "unknown", headline: "Can't find that model", detail: "Check the link and try again." });
  });

  test("words when no Stack is set up", () => {
    expect(fitNoStackWording()).toEqual({ verdict: "unknown", headline: "Needs the MaiPai Stack", detail: "Checking a model's size uses the MaiPai Stack, which is not set up on this computer yet." });
  });

  test("does not throw for an empty paths list", () => {
    const plan = { ...makePlan("no"), paths: [] } as unknown as StackFitPlan;
    expect(() => fitWording(plan)).not.toThrow();
    expect(fitWording(plan).detail).toBe("There is not enough memory for it here.");
  });

  test("all fixture kinds pass the generated schema", () => {
    for (const kind of ["yes", "no", "slow", "unknown"] as const) {
      expect(StackFitPlan.parse(makePlan(kind)).verdict).toBe(kind);
    }
  });
});
