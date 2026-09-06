import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb } from "./reset-db";
import { runSmoke, runDenoTestSmoke, getPackageStatus, allPackageStatuses, runAllSmokeTests } from "@/lib/smoke";
import { listIssues } from "@/lib/issues";

beforeEach(() => {
  resetDb();
});

describe("runSmoke, recipe_fixture kind", () => {
  test("a real bundled package's own smoke fixture passes and leaves it enabled", async () => {
    const result = await runSmoke("weather");
    expect(result.ok).toBe(true);
    expect(getPackageStatus("weather").status).toBe("enabled");
    expect(getPackageStatus("weather").smokeOk).toBe(true);
  });

  test("every D-owned bundled plugin's own smoke fixture passes", async () => {
    for (const id of ["define", "joke", "trivia"]) {
      const result = await runSmoke(id);
      expect(result.ok).toBe(true);
    }
  });
});

describe("runSmoke, static kind", () => {
  test("a skill package with no host to run passes by loading", async () => {
    const result = await runSmoke("storytime-style");
    expect(result.ok).toBe(true);
    expect(getPackageStatus("storytime-style").status).toBe("enabled");
  });
});

// SEC-2 (code review, 2026-09-06): POST /:id/smoke used to pass the raw
// route param straight to join(PACKAGES_DIR, id, ...) with no shape
// check, so an owner/admin could point a real `deno test`/recipe-fixture
// run at any directory a traversal id resolved to.
describe("runSmoke rejects a malformed/traversal id", () => {
  test("fails without reading anything off disk for that id", async () => {
    const result = await runSmoke("../../data/packages/weather");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not a valid package id");
  });
});

describe("a failing smoke test", () => {
  test("disables the package and raises an issue", async () => {
    const result = await runSmoke("no-such-package");
    expect(result.ok).toBe(false);
    expect(getPackageStatus("no-such-package").status).toBe("disabled");

    const issues = listIssues({ includeResolved: true });
    const issue = issues.find((i) => i.source === "packages" && i.key === "no-such-package");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(issue?.resolved_at).toBeNull();
  });

  test("a later passing run resolves the issue and re-enables it", async () => {
    await runSmoke("no-such-package");
    expect(getPackageStatus("no-such-package").status).toBe("disabled");

    // weather's own fixture always passes; used here only to prove
    // recordResult's ok path calls resolveIssue for that same key.
    await runSmoke("weather");
    const issues = listIssues({ includeResolved: true });
    const weatherIssue = issues.find((i) => i.source === "packages" && i.key === "weather");
    // weather never failed, so it never had an issue in the first place -
    // this just proves a passing run doesn't itself raise one.
    expect(weatherIssue).toBeUndefined();
  });
});

describe("allPackageStatuses / getPackageStatus", () => {
  test("a package never smoke-tested reads as enabled with no history", () => {
    const status = getPackageStatus("never-checked");
    expect(status).toEqual({ status: "enabled", lastSmokeAt: null, smokeOk: null, smokeMessage: null });
  });

  test("reflects every row after a full pass", async () => {
    await runSmoke("weather");
    const all = allPackageStatuses();
    expect(all.get("weather")?.status).toBe("enabled");
  });
});

describe("a package with no smoke entry declared yet", () => {
  test("is not disabled - a build-time bronze gap, not a runtime failure", async () => {
    // remember/recall are C's packages (session-d-packages-and-store.md's
    // ownership map) and don't declare a smoke entry yet. This session's
    // own smoke infrastructure must never disable a package it doesn't
    // own just because that package hasn't reached bronze yet.
    const result = await runSmoke("remember");
    expect(result.ok).toBe(true);
    expect(getPackageStatus("remember").status).toBe("enabled");
  });
});

describe("runAllSmokeTests", () => {
  test("runs every bundled package and counts only real failures", async () => {
    const { ran, failed } = await runAllSmokeTests();
    expect(ran).toBeGreaterThanOrEqual(7); // define, joke, trivia, weather, storytime-style, remember, recall at minimum
    expect(failed).toBe(0);
  });
});

// COR-2 (code review, 2026-09-06): runDenoTestSmoke had no timeout at
// all - a Tier 1 package's own deno_test hanging used to hang whichever
// caller awaited it (boot, the daily packages.smoke core job) forever.
// A real disposable temp directory, never a bundled package under
// PACKAGES_DIR - the same posture denoHost.test.ts's own real-spawn
// permission tests take, for the identical reason (its own header
// explains why: never mistaken for one of the bronze-completeness
// suite's own bundled packages).
describe("runDenoTestSmoke timeout (COR-2)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "maipai-smoke-denotest-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("a hanging deno test is killed and reported as a timeout, not left running forever", async () => {
    // A real, long timer, not an eternally-unresolved bare Promise: Deno's
    // own sanitizers fail an unresolved-with-nothing-pending promise
    // almost instantly on their own ("Promise resolution is still
    // pending but the event loop has already resolved") - not the kind
    // of hang this fix is for. A live timer keeps the event loop
    // genuinely busy, the same shape a real stuck test (an infinite
    // loop, a network call that never answers) would have.
    writeFileSync(
      join(tempDir, "hangs.test.ts"),
      `Deno.test("hangs", () => new Promise((resolve) => setTimeout(resolve, 30_000)));`,
    );
    const result = await runDenoTestSmoke(tempDir, 200);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("timed out");
  }, 15_000);

  test("a fast-passing deno test is unaffected by the timeout", async () => {
    writeFileSync(join(tempDir, "passes.test.ts"), `Deno.test("passes", () => {});`);
    const result = await runDenoTestSmoke(tempDir, 30_000);
    expect(result.ok).toBe(true);
  }, 15_000);
});
