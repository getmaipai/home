import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { errorBaselineProblems, errorFindings, type ErrorBaseline } from "./errorLints";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = fileURLToPath(new URL("./error-lint-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as ErrorBaseline;

describe("raw error display lint (PRO-LOOK-ERRORS-01)", () => {
  test("finds the three counted categories", () => {
    const found = errorFindings(SRC, {
      "fixture.tsx": `toast.error(error.message); const x = <p className="text-sm text-destructive">{error.message}</p>; setProblem(error instanceof Error ? error.message : "fixed");`,
    });
    expect(Object.fromEntries(found.map(({ category, count }) => [category, count]))).toEqual({ toastError: 1, destructiveClass: 1, rawErrorMessage: 2 });
  });

  test("reports growth, new files and stale entries", () => {
    const findings = errorFindings(SRC, { "new.tsx": `toast.error(error.message);` });
    expect(errorBaselineProblems(findings, { toastError: { "new.tsx": 0, "old.tsx": 1 } })).toEqual([
      "toastError new.tsx: grew from 0 to 1; fix the new raw error display",
      "toastError old.tsx: baseline is stale (1, measured 0); lower the baseline number",
    ]);
    expect(errorBaselineProblems(errorFindings(SRC, { "fresh.tsx": `toast.error("failed");` }), {})).toHaveLength(1);
  });

  test("the real source tree matches the shrink-only baseline", () => {
    const problems = errorBaselineProblems(errorFindings(SRC), baseline);
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
