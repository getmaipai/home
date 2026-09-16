import { describe, expect, test, beforeEach } from "bun:test";
import { getActiveInstall, listInstalledPackageIds, resolvePackageDir } from "@/lib/packageResolve";
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";
import { resetDb } from "./reset-db";
import { join } from "node:path";

beforeEach(() => resetDb());

describe("getActiveInstall", () => {
  test("returns null for a package that was never installed", () => {
    expect(getActiveInstall("never-installed")).toBeNull();
  });

  test("returns the install row for an installed package", () => {
    db.insert(packageInstalls)
      .values({
        packageId: "test-pkg",
        version: "1.2.3",
        previousVersion: "1.0.0",
        channel: "stable",
        sourceCommit: "abc123",
        permissions: '["net:a.example"]',
        installedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();

    const active = getActiveInstall("test-pkg");
    expect(active).not.toBeNull();
    expect(active?.version).toBe("1.2.3");
    expect(active?.previousVersion).toBe("1.0.0");
    expect(active?.channel).toBe("stable");
    expect(active?.sourceCommit).toBe("abc123");
    expect(active?.permissions).toEqual(["net:a.example"]);
    expect(active?.installedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("handles an install with no previous version", () => {
    db.insert(packageInstalls)
      .values({
        packageId: "new-pkg",
        version: "0.1.0",
        previousVersion: null,
        channel: "beta",
        sourceCommit: "def456",
        permissions: "[]",
        installedAt: "2026-06-15T12:00:00.000Z",
      })
      .run();

    const active = getActiveInstall("new-pkg");
    expect(active).not.toBeNull();
    expect(active?.version).toBe("0.1.0");
    expect(active?.previousVersion).toBeNull();
    expect(active?.channel).toBe("beta");
    expect(active?.permissions).toEqual([]);
  });
});

describe("listInstalledPackageIds", () => {
  test("returns empty when nothing is installed", () => {
    expect(listInstalledPackageIds()).toEqual([]);
  });

  test("returns all installed package ids", () => {
    db.insert(packageInstalls)
      .values({
        packageId: "pkg-a",
        version: "1.0.0",
        previousVersion: null,
        channel: "stable",
        sourceCommit: "aaa",
        permissions: "[]",
        installedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    db.insert(packageInstalls)
      .values({
        packageId: "pkg-b",
        version: "2.0.0",
        previousVersion: null,
        channel: "stable",
        sourceCommit: "bbb",
        permissions: "[]",
        installedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();

    const ids = listInstalledPackageIds();
    expect(ids).toContain("pkg-a");
    expect(ids).toContain("pkg-b");
    expect(ids.length).toBe(2);
  });
});

describe("resolvePackageDir", () => {
  test("returns the bundled path for a package with no store install", () => {
    expect(resolvePackageDir("weather")).toBe(join(PACKAGES_DIR, "weather"));
  });

  test("returns the store install version dir for an installed package", () => {
    db.insert(packageInstalls)
      .values({
        packageId: "test-pkg",
        version: "1.2.3",
        previousVersion: null,
        channel: "stable",
        sourceCommit: "abc123",
        permissions: "[]",
        installedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();

    expect(resolvePackageDir("test-pkg")).toBe(installedPackageVersionDir("test-pkg", "1.2.3"));
    expect(resolvePackageDir("test-pkg")).not.toBe(join(PACKAGES_DIR, "test-pkg"));
  });
});
