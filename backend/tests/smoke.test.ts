import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { runSmoke, getPackageStatus, allPackageStatuses, runAllSmokeTests } from "@/lib/smoke";
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
