import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { baselineProblems, typeFindings, type TypeBaseline } from "./typeLints";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = fileURLToPath(new URL("./type-lint-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as TypeBaseline;

describe("type, radius and icon lint (PRO-LOOK-LINT-01)", () => {
  test("finds all four categories", () => {
    const found = typeFindings(SRC, {
      "fixture.tsx": `const a = "text-xs text-[12.5px]";\nconst css = "font-size: 14px";\nconst r = "rounded-[3px]";\nconst c = "border-radius: 5px";\nimport { X } from "lucide-react";\nconst icon = <svg viewBox="0 0 1 1" />;`,
    });
    expect(Object.fromEntries(found.map(({ category, count }) => [category, count]))).toEqual({ fontSize: 3, radius: 2, iconImport: 1, inlineSvg: 1 });
  });

  test("ignores permitted full, token and variable forms", () => {
    const found = typeFindings(SRC, { "fixture.tsx": `const ok = "rounded-full rounded-[var(--radius-card)] text-[length:var(--font-size-hero)] rounded-none";` });
    expect(found).toEqual([]);
  });

  test("reports growth, new files and stale entries", () => {
    const findings = typeFindings(SRC, { "new.tsx": `const x = "text-xs text-sm";` });
    expect(baselineProblems(findings, { fontSize: { "new.tsx": 1, "old.tsx": 1 } })).toEqual([
      "fontSize new.tsx: grew from 1 to 2; replace the literal with a PRO-LOOK type-scale token class",
      "fontSize old.tsx: baseline is stale (1, measured 0); lower the baseline number",
    ]);
    expect(baselineProblems(typeFindings(SRC, { "fresh.tsx": `const x = "text-lg";` }), {})).toHaveLength(1);
  });

  test("the real source tree matches the shrink-only baseline", () => {
    const problems = baselineProblems(typeFindings(SRC), baseline);
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
