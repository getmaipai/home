// Module state in lib/pictures/ageCheck.ts must not leak from one test to the next (and so from one file to another: bun runs
// every file in one process). tests/preload.ts restores the suite default after every test; this proves it, in order.
// A test that clears the runner seam must not leave the next test reaching the real model path.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { __ageCheckStateForTests, __setAgeCheckRunnerForTests, __setAgeDeadlineForTests, __setAgeVisionForTests, checkImages } from "@/lib/pictures/ageCheck";

describe("ageCheck module state is restored after every test", () => {
  test("first, leave every seam dirty", () => {
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: false as const, why: "timeout" as const })));
    __setAgeVisionForTests(async () => "x");
    __setAgeDeadlineForTests(5);
    expect(__ageCheckStateForTests()).toMatchObject({ runner: true, vision: true, deadlineMs: 5 });
  });
  test("then the next test sees the suite default: a runner that finds nobody, no vision seam, the normal deadline", async () => {
    expect(__ageCheckStateForTests()).toEqual({ runner: true, vision: false, deadlineMs: 20_000, notified: false });
    const [check] = await checkImages([new Uint8Array([1])], "picture");
    expect(check).toMatchObject({ ok: true, verdict: { label: "none", is_nude_or_sexual: false } });
  });
  test("no test file sets the runner seam to null (that sends the next file to the real model)", () => {
    const here = join(import.meta.dir);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.test\.tsx?$/.test(entry.name) && entry.name !== "ageCheckStateReset.test.ts" && /__setAgeCheckRunnerForTests\(\s*null\s*\)/.test(readFileSync(path, "utf8"))) offenders.push(entry.name);
      }
    };
    walk(here);
    // ageCheck.test.ts and pictureReader.test.ts set null inside a test to reach the real path; the preload afterEach restores it: allowed there only.
    expect(offenders.filter((n) => n !== "ageCheck.test.ts" && n !== "pictureReader.test.ts")).toEqual([]);
  });
});
