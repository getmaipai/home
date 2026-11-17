import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countsByFile, scanSource, scanTree } from "./ageComparisons.scan";

const repoRoot = join(import.meta.dir, "../..");
const allowPath = join(import.meta.dir, "ageComparisons.allow.json");
const NEW_COMPARISON = "a new age comparison; call audienceBand, speakerAgeBand or effectiveBand, or put the check in the audience, filter, access or privacy module";
const SHRINK_ONLY = "the allowlist only shrinks: lower or remove this row in the same change that removed the comparison";

describe("age comparison build check", () => {
  test("the shrink-only allowlist exactly matches current source", () => {
    const matches = scanTree(repoRoot);
    const current = countsByFile(matches);
    if (process.env.MAIPAI_WRITE_AGE_ALLOWLIST === "1") {
      writeFileSync(allowPath, `${JSON.stringify(current, null, 2)}\n`);
      console.log(`Wrote age comparison allowlist: ${Object.keys(current).length} files, ${Object.values(current).reduce((sum, n) => sum + n, 0)} matches`);
      return;
    }
    const baseline = JSON.parse(readFileSync(allowPath, "utf8")) as Record<string, number>;
    const failures: string[] = [];
    const seen: Record<string, number> = {};
    for (const item of matches) {
      const index = seen[item.file] ?? 0;
      seen[item.file] = index + 1;
      if (index >= (baseline[item.file] ?? 0)) failures.push(`${item.file}:${item.line}: ${NEW_COMPARISON}\n  ${item.text}`);
    }
    for (const [file, count] of Object.entries(baseline)) {
      if (!existsSync(join(repoRoot, file)) || (current[file] ?? 0) < count) failures.push(`${file}: ${SHRINK_ONLY}`);
    }
    expect(failures).toEqual([]);
  });

  test("the scanner reports a comparison in unapproved source", () => {
    const result = scanSource("backend/src/lib/fixture.ts", 'if (person.role === "child") return;');
    expect(result).toHaveLength(1);
    expect(result[0]?.line).toBe(1);
  });
});
