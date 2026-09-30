import { describe, expect, test } from "bun:test";
import { fitNotFoundWording, fitWording } from "@/lib/fitWording";
import { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import { makePlan } from "./fixtures/fitPlanFixtures";

describe("fit wording", () => {
  test("words all four verdicts", () => {
    expect(fitWording(makePlan("yes")).headline).toBe("Runs well on this computer");
    expect(fitWording(makePlan("slow")).detail).toBe("It fits only by using the processor, so answers will be slower.");
    expect(fitWording(makePlan("no")).headline).toBe("Won't fit");
    expect(fitWording(makePlan("unknown")).detail).toBe("Nobody has measured a model like this on a computer like yours yet.");
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
