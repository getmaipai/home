import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, installedPackageVersionDir, installStagingDir } from "@/lib/paths";
import { getActiveInstall } from "@/lib/packageResolve";
import { beginInstall, markInstallStep } from "@/lib/installJournal";
import { recoverInterruptedPackageInstalls } from "@/lib/store";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";

const id = "journal-fixture";
const root = join(dataDir, "install-journal");
const manifest = (dir: string) => writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id, version: "1.0.0" }));

beforeEach(() => { resetDb(); rmSync(join(dataDir, "packages", id), { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true }); });
afterEach(() => { rmSync(join(dataDir, "packages", id), { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });

describe("package install journal recovery", () => {
  test("an active version survives a killed mid-upgrade and orphan files are removed", () => {
    const oldDir = installedPackageVersionDir(id, "1.0.0");
    const nextDir = installedPackageVersionDir(id, "2.0.0");
    const staging = installStagingDir(id);
    mkdirSync(oldDir, { recursive: true }); manifest(oldDir);
    mkdirSync(nextDir, { recursive: true }); manifest(nextDir);
    mkdirSync(staging, { recursive: true });
    db.insert(packageInstalls).values({ packageId: id, version: "1.0.0", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: new Date().toISOString() }).run();
    beginInstall(root, { packageId: id, version: "2.0.0", previousVersion: "1.0.0", stagingDir: staging, versionDir: nextDir });
    markInstallStep(root, id, "swapped");

    const recovered = recoverInterruptedPackageInstalls();
    expect(recovered.handled).toBe(1);
    expect(getActiveInstall(id)?.version).toBe("1.0.0");
    expect(existsSync(join(oldDir, "manifest.json"))).toBe(true);
    expect(existsSync(nextDir)).toBe(false);
    expect(existsSync(staging)).toBe(false);
  });

  test("an interrupted repair reports damage and leaves active files untouched", () => {
    const activeDir = installedPackageVersionDir(id, "1.0.0");
    mkdirSync(activeDir, { recursive: true });
    const staging = installStagingDir(id);
    mkdirSync(staging, { recursive: true });
    db.insert(packageInstalls).values({ packageId: id, version: "1.0.0", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: new Date().toISOString() }).run();
    beginInstall(root, { packageId: id, version: "1.0.0", previousVersion: null, stagingDir: staging, versionDir: activeDir });
    markInstallStep(root, id, "staged");

    const recovered = recoverInterruptedPackageInstalls();
    expect(recovered.repairNeeded).toEqual([id]);
    expect(existsSync(activeDir)).toBe(true);
    expect(existsSync(staging)).toBe(false);
  });
});
