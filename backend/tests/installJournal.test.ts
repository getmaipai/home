import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginInstall,
  decideRecovery,
  finishInstall,
  journalPath,
  markInstallStep,
  readOpenJournals,
  recoverInterruptedInstalls,
  type InstallJournal,
} from "../src/lib/installJournal";

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "install-journal-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function input(overrides: Partial<Omit<InstallJournal, "step" | "startedAt">> = {}) {
  return {
    packageId: "demo",
    version: "2.0.0",
    previousVersion: "1.0.0",
    stagingDir: "/packages/.demo-staging",
    versionDir: "/packages/demo/2.0.0",
    ...overrides,
  };
}

function journal(overrides: Partial<InstallJournal> = {}): InstallJournal {
  return {
    ...input(),
    step: "started",
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("install journal", () => {
  test("begin, mark and finish round trip with atomic writes", () => {
    const root = tempRoot();
    beginInstall(root, input(), () => "now");
    const path = journalPath(root, "demo");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ...input(), step: "started", startedAt: "now" });
    markInstallStep(root, "demo", "staged");
    expect(JSON.parse(readFileSync(path, "utf8")).step).toBe("staged");
    markInstallStep(root, "demo", "swapped");
    expect(JSON.parse(readFileSync(path, "utf8")).step).toBe("swapped");
    finishInstall(root, "demo");
    expect(existsSync(path)).toBe(false);
    expect(readdirNames(root)).toEqual([]);
  });

  test("rejects unsafe package ids and missing journals", () => {
    expect(() => journalPath(tempRoot(), "../demo")).toThrow();
    expect(() => journalPath(tempRoot(), "a/b")).toThrow();
    expect(() => journalPath(tempRoot(), "a\\b")).toThrow();
    expect(() => markInstallStep(tempRoot(), "missing", "staged")).toThrow();
  });

  test("reports malformed files and leaves them in place", () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    const corrupt = join(root, "bad.json");
    writeFileSync(corrupt, "{");
    const result = readOpenJournals(root);
    expect(result.journals).toEqual([]);
    expect(result.corrupt).toEqual([corrupt]);
    const recovered = recoverInterruptedInstalls(root, fakeDeps());
    expect(recovered.corrupt).toEqual([corrupt]);
    expect(existsSync(corrupt)).toBe(true);
  });

  test("decides every recovery branch", () => {
    expect(decideRecovery(journal({ step: "committed" }), state())).toEqual([
      { do: "drop-journal", why: "install is committed" },
    ]);
    expect(decideRecovery(journal(), state({ activeVersion: "1.0.0", stagingExists: true }))).toEqual([
      { do: "remove-staging", path: "/packages/.demo-staging", why: "remove interrupted staging directory" },
      { do: "remove-version-dir", path: "/packages/demo/2.0.0", why: "remove orphan version directory" },
      { do: "keep-active", why: "leave the current active version untouched" },
      { do: "drop-journal", why: "recovery decision recorded" },
    ]);
    expect(decideRecovery(journal({ step: "swapped" }), state({ activeVersion: "2.0.0", versionDirHasManifest: false }))).toEqual([
      { do: "flag-repair-needed", why: "active version directory has no manifest" },
      { do: "drop-journal", why: "recovery decision recorded" },
    ]);
    expect(decideRecovery(journal(), state({ activeVersion: "2.0.0", versionDirHasManifest: true, stagingExists: true }))).toEqual([
      { do: "remove-staging", path: "/packages/.demo-staging", why: "remove interrupted staging directory" },
      { do: "keep-active", why: "active version directory is intact" },
      { do: "drop-journal", why: "recovery decision recorded" },
    ]);
    expect(decideRecovery(journal(), state({ activeVersion: "2.0.0", versionDirHasManifest: false }))[0]).toEqual({
      do: "flag-repair-needed", why: "active version directory has no manifest",
    });
  });

  test("recovers staging and orphan dirs, protects active dirs and is idempotent", () => {
    const root = tempRoot();
    const orphan = input({ packageId: "orphan" });
    const repair = input({ packageId: "repair", stagingDir: "/packages/.repair-staging", versionDir: "/packages/repair/2.0.0" });
    beginInstall(root, orphan, () => "now");
    beginInstall(root, repair, () => "now");
    const removed: string[] = [];
    const deps = fakeDeps({
      active: new Map([["orphan", "1.0.0"], ["repair", "2.0.0"]]),
      manifests: new Set(["/packages/repair/2.0.0"]),
      existing: new Set([orphan.stagingDir, orphan.versionDir, repair.stagingDir, repair.versionDir]),
      removed,
    });
    const result = recoverInterruptedInstalls(root, deps);
    expect(removed).toEqual([repair.stagingDir, orphan.stagingDir, orphan.versionDir]);
    expect(removed).not.toContain(repair.versionDir);
    expect(result.handled).toHaveLength(2);
    expect(result.repairNeeded).toEqual([]);
    expect(recoverInterruptedInstalls(root, deps).handled).toEqual([]);
  });

  test("flags active repair with missing manifest without deleting its directory", () => {
    const root = tempRoot();
    const repair = input({ packageId: "repair", stagingDir: "/packages/.repair-staging", versionDir: "/packages/repair/2.0.0" });
    beginInstall(root, repair, () => "now");
    const removed: string[] = [];
    const result = recoverInterruptedInstalls(root, fakeDeps({
      active: new Map([["repair", "2.0.0"]]), existing: new Set([repair.versionDir]), removed,
    }));
    expect(result.repairNeeded).toEqual(["repair"]);
    expect(removed).toEqual([]);
    expect(existsSync(journalPath(root, "repair"))).toBe(false);
  });
});

function readdirNames(root: string): string[] {
  return readdirSync(root);
}
function state(overrides: Partial<{ activeVersion: string | null; versionDirHasManifest: boolean; stagingExists: boolean }> = {}) {
  return { activeVersion: null, versionDirHasManifest: false, stagingExists: false, ...overrides };
}
function fakeDeps(options: {
  active?: Map<string, string | null>;
  manifests?: Set<string>;
  existing?: Set<string>;
  removed?: string[];
} = {}) {
  return {
    activeVersionOf: (id: string) => options.active?.get(id) ?? null,
    dirHasManifest: (dir: string) => options.manifests?.has(dir) ?? false,
    exists: (path: string) => options.existing?.has(path) ?? false,
    remove: (path: string) => { options.removed?.push(path); options.existing?.delete(path); },
  };
}
