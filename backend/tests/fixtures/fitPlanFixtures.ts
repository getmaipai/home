import { StackFitPlan, type StackFitPlan as StackFitPlanType } from "@maipai/spec/gen/ts/stack-fit-plan.js";

const GiB = 1024 ** 3;
const asOf = "2026-09-30";
const measured = (low: number, high: number) => ({ low, high, source: "measured" as const, as_of: asOf });
const estimated = (low: number, high: number) => ({ low, high, source: "estimated" as const, as_of: asOf });
const unknown = { low: null, high: null, source: "unknown" as const, as_of: asOf };

export function makePlan(
  kind: "yes" | "no" | "slow" | "unknown",
  overrides: Partial<StackFitPlanType> = {},
): StackFitPlanType {
  const common = {
    schema: 1 as const,
    model: "atlas-test",
    context_tokens: 4096,
    kv_cache_type: "f16" as const,
    roles: [{ role: "chat" as const, choice: "atlas-test", peak: estimated(2 * GiB, 3 * GiB) }],
    total: estimated(2 * GiB, 3 * GiB),
    cap: measured(16 * GiB, 16 * GiB),
    margin: measured(4 * GiB, 4 * GiB),
    paths: [{ path: "unified" as const, fits: true, verdict: "yes" as const }],
    verdict: "yes" as const,
    bottleneck: "memory" as const,
  };
  let plan: StackFitPlanType;
  switch (kind) {
    case "yes":
      plan = common;
      break;
    case "no":
      plan = { ...common, paths: [{ path: "unified", fits: false, verdict: "no", shortfall: estimated(5 * GiB, 6 * GiB) }], verdict: "no" };
      break;
    case "slow":
      plan = {
        ...common,
        paths: [{ path: "gpu", fits: false, verdict: "no" }, { path: "cpu", fits: true, verdict: "slow" }],
        verdict: "slow",
      };
      break;
    case "unknown":
      plan = {
        ...common,
        roles: [{ role: "chat", choice: "atlas-test", peak: unknown }],
        total: unknown,
        cap: unknown,
        margin: unknown,
        paths: [{ path: "unified", fits: false, verdict: "unknown" }],
        verdict: "unknown",
        bottleneck: "unknown",
      };
      break;
  }
  return StackFitPlan.parse({ ...plan, ...overrides });
}
