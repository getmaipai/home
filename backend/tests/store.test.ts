import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as tar from "tar";
import { db } from "@/db";
import { packageInstalls, packageStatus, storeIndexState } from "@/db/schema";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";
import { resolvePackageDir, getActiveInstall } from "@/lib/packageResolve";
import { install, rollback, uninstall, setChannel } from "@/lib/store";
import type { RootMetadata, TargetsMetadata, TimestampMetadata, TargetEntry } from "@/lib/storeIndex";
import { makeKeyPair, sign, type KeyPair } from "./support/tufFixtures";

// Builds a REAL packed tarball too (tests/support/tufFixtures.ts's own
// buildFixtureIndex() only builds signed metadata, no actual package
// content) - install() unpacks a real tar file, so this test needs one.

let indexDir: string;
let signer: KeyPair;

beforeEach(() => {
  indexDir = mkdtempSync(join(tmpdir(), "maipai-store-test-index-"));
  signer = makeKeyPair();
});

afterEach(() => {
  rmSync(indexDir, { recursive: true, force: true });
  db.delete(packageInstalls).run();
  db.delete(packageStatus).run();
  db.delete(storeIndexState).run();
});

/** Packs a REAL package directory (weather's own real bundled files -
 * a complete, valid manifest+recipe+tests, so this test never has to
 * hand-construct one) into `indexDir`, builds a signed index around it
 * under the given `id`, and returns everything install() needs. Passing
 * a different `id` than weather's own real manifest.id (a genuinely new
 * package) or the same id ("weather" - an update to a bundled default,
 * this step's own acceptance scenario) are both real, tested cases. */
async function buildInstallableFixture(
  opts: { id: string; version?: string; permissions?: string[]; sourcePackageId?: string; pathPrefix?: string; dir?: string } = {
    id: "weather",
  },
): Promise<{
  targetPath: string;
}> {
  const dir = opts.dir ?? indexDir;
  const version = opts.version ?? "0.1.0";
  const sourceDir = join(PACKAGES_DIR, opts.sourcePackageId ?? "weather");
  const stagingSrc = mkdtempSync(join(tmpdir(), "maipai-store-test-src-"));
  cpSync(sourceDir, stagingSrc, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(stagingSrc, "manifest.json"), "utf-8"));
  manifest.id = opts.id;
  manifest.version = version;
  writeFileSync(join(stagingSrc, "manifest.json"), JSON.stringify(manifest));

  const targetPath = `${opts.pathPrefix ?? "plugins/utilities"}/${opts.id}/${version}`;
  const tarballName = `${targetPath.replace(/\//g, "_")}.tgz`;
  const files = readdirSync(stagingSrc, { recursive: true } as never)
    .map(String)
    .filter((f) => statSync(join(stagingSrc, f)).isFile());
  await tar.create({ file: join(dir, tarballName), cwd: stagingSrc, gzip: true, portable: true, noMtime: true }, files);
  rmSync(stagingSrc, { recursive: true, force: true });

  const tarballBytes = readFileSync(join(dir, tarballName));
  const entry: TargetEntry = {
    length: tarballBytes.length,
    hashes: { sha256: createHash("sha256").update(tarballBytes).digest("hex") },
    custom: {
      source_commit: "test",
      signer: "primary",
      min_app: "0.1.0",
      requires: [],
      permissions: opts.permissions ?? ["net:api.open-meteo.com"],
      channel: "stable",
    },
  };

  const rootMeta: RootMetadata = {
    type: "root",
    version: 1,
    expires: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    keys: { [signer.keyid]: { keytype: "ed25519", public: signer.publicKeyPem } },
    roles: {
      root: { keyids: [signer.keyid], threshold: 1 },
      targets: { keyids: [signer.keyid], threshold: 1 },
      timestamp: { keyids: [signer.keyid], threshold: 1 },
    },
  };
  const root = sign(rootMeta, [signer]);

  const targetsMeta: TargetsMetadata = { type: "targets", version: 1, expires: new Date(Date.now() + 365 * 86_400_000).toISOString(), targets: { [targetPath]: entry } };
  const targetsEnvelope = sign(targetsMeta, [signer]);
  const targetsBytes = Buffer.from(JSON.stringify(targetsEnvelope));

  const timestampMeta: TimestampMetadata = {
    type: "timestamp",
    version: 1,
    expires: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    meta: { "targets.json": { length: targetsBytes.length, hashes: { sha256: createHash("sha256").update(targetsBytes).digest("hex") } } },
  };
  const timestamp = sign(timestampMeta, [signer]);

  writeFileSync(join(dir, "root.json"), JSON.stringify(root));
  writeFileSync(join(dir, "targets.json"), targetsBytes);
  writeFileSync(join(dir, "timestamp.json"), JSON.stringify(timestamp));

  return { targetPath };
}

function trust() {
  return { rootPublicKeysPem: [signer.publicKeyPem] };
}

describe("install", () => {
  test("installing a genuinely new id makes it resolve to the store copy, and passes smoke", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-store-widget" });
    const result = await install({ id: "test-store-widget", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe("0.1.0");
    expect(result.value.previousVersion).toBeNull();
    expect(result.value.smokeOk).toBe(true);

    const dir = resolvePackageDir("test-store-widget");
    expect(dir).toBe(installedPackageVersionDir("test-store-widget", "0.1.0"));
    expect(existsSync(join(dir, "manifest.json"))).toBe(true);
  });

  test("installing over an ALREADY-bundled id (weather) overrides bundled resolution - this step's own acceptance case", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "weather", version: "0.2.0" });
    const bundledDir = join(PACKAGES_DIR, "weather");
    expect(resolvePackageDir("weather")).toBe(bundledDir);

    const result = await install({ id: "weather", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(result.ok).toBe(true);

    expect(resolvePackageDir("weather")).toBe(installedPackageVersionDir("weather", "0.2.0"));
    expect(resolvePackageDir("weather")).not.toBe(bundledDir);
  });

  test("refuses to install when the tarball's bytes do not match the index's own hash - the bad-hash tamper case", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-store-badhash" });
    const tarballName = `${targetPath.replace(/\//g, "_")}.tgz`;
    writeFileSync(join(indexDir, tarballName), "corrupted, not a real tarball");
    const result = await install({ id: "test-store-badhash", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not match the index");
  });

  test("refuses when root.json does not verify against the trusted key - the unknown-signer tamper case", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-store-untrusted" });
    const impostorKey = makeKeyPair();
    const result = await install({
      id: "test-store-untrusted",
      targetPath,
      source: { kind: "dir", dir: indexDir },
      trust: { rootPublicKeysPem: [impostorKey.publicKeyPem] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unknown signer");
  });

  test("refuses when the target path is not in the index at all", async () => {
    await buildInstallableFixture({ id: "test-store-missing" });
    const result = await install({
      id: "test-store-missing",
      targetPath: "plugins/utilities/test-store-missing/9.9.9",
      source: { kind: "dir", dir: indexDir },
      trust: trust(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no such target");
  });

  test("refuses an update that adds permissions until confirmed - demoted to notify, not silently applied", async () => {
    const first = await buildInstallableFixture({ id: "test-store-permcheck", version: "1.0.0", permissions: ["net:a.example"] });
    const firstInstall = await install({ id: "test-store-permcheck", targetPath: first.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(firstInstall.ok).toBe(true);

    const second = await buildInstallableFixture({
      id: "test-store-permcheck",
      version: "2.0.0",
      permissions: ["net:a.example", "net:b.example"],
    });
    const unconfirmed = await install({ id: "test-store-permcheck", targetPath: second.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) expect(unconfirmed.requiresConfirmation?.newPermissions).toEqual(["net:b.example"]);
    // Refused BEFORE anything changed on disk or in the DB.
    expect(getActiveInstall("test-store-permcheck")?.version).toBe("1.0.0");

    const confirmed = await install({
      id: "test-store-permcheck",
      targetPath: second.targetPath,
      source: { kind: "dir", dir: indexDir },
      trust: trust(),
      confirmed: true,
    });
    expect(confirmed.ok).toBe(true);
    expect(getActiveInstall("test-store-permcheck")?.version).toBe("2.0.0");
  });

  test("an update that only keeps or narrows permissions never needs confirmation", async () => {
    const first = await buildInstallableFixture({ id: "test-store-permshrink", version: "1.0.0", permissions: ["net:a.example", "net:b.example"] });
    await install({ id: "test-store-permshrink", targetPath: first.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });

    const second = await buildInstallableFixture({ id: "test-store-permshrink", version: "2.0.0", permissions: ["net:a.example"] });
    const result = await install({ id: "test-store-permshrink", targetPath: second.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(result.ok).toBe(true);
  });

  test("refuses a manifest whose version is not a safe semver-shaped string - the path-traversal case", async () => {
    // A hand-built tarball whose manifest.json declares a malicious
    // version, packed and indexed the same way buildInstallableFixture()
    // does but WITHOUT going through its own path/id derivation (which
    // would itself refuse to build a path containing "..") - the point
    // is that install() itself must refuse this, not that the fixture
    // builder happens to make it hard to construct.
    const maliciousVersion = "../../../etc/cron.d";
    const targetPath = "plugins/utilities/test-store-badversion/1.0.0"; // the ADVERTISED, well-formed version
    const srcDir = mkdtempSync(join(tmpdir(), "maipai-store-test-malicious-src-"));
    cpSync(join(PACKAGES_DIR, "weather"), srcDir, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(srcDir, "manifest.json"), "utf-8"));
    manifest.id = "test-store-badversion";
    manifest.version = maliciousVersion; // what's ACTUALLY inside the tarball
    writeFileSync(join(srcDir, "manifest.json"), JSON.stringify(manifest));

    const tarballName = `${targetPath.replace(/\//g, "_")}.tgz`;
    const files = readdirSync(srcDir, { recursive: true } as never)
      .map(String)
      .filter((f) => statSync(join(srcDir, f)).isFile());
    await tar.create({ file: join(indexDir, tarballName), cwd: srcDir, gzip: true, portable: true, noMtime: true }, files);
    rmSync(srcDir, { recursive: true, force: true });

    const tarballBytes = readFileSync(join(indexDir, tarballName));
    const entry: TargetEntry = {
      length: tarballBytes.length,
      hashes: { sha256: createHash("sha256").update(tarballBytes).digest("hex") },
      custom: { source_commit: "test", signer: "primary", min_app: "0.1.0", requires: [], permissions: [], channel: "stable" },
    };
    const rootMeta: RootMetadata = {
      type: "root",
      version: 1,
      expires: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      keys: { [signer.keyid]: { keytype: "ed25519", public: signer.publicKeyPem } },
      roles: {
        root: { keyids: [signer.keyid], threshold: 1 },
        targets: { keyids: [signer.keyid], threshold: 1 },
        timestamp: { keyids: [signer.keyid], threshold: 1 },
      },
    };
    const root = sign(rootMeta, [signer]);
    const targetsMeta: TargetsMetadata = { type: "targets", version: 1, expires: rootMeta.expires, targets: { [targetPath]: entry } };
    const targetsEnvelope = sign(targetsMeta, [signer]);
    const targetsBytes = Buffer.from(JSON.stringify(targetsEnvelope));
    const timestampMeta: TimestampMetadata = {
      type: "timestamp",
      version: 1,
      expires: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      meta: { "targets.json": { length: targetsBytes.length, hashes: { sha256: createHash("sha256").update(targetsBytes).digest("hex") } } },
    };
    const timestamp = sign(timestampMeta, [signer]);
    writeFileSync(join(indexDir, "root.json"), JSON.stringify(root));
    writeFileSync(join(indexDir, "targets.json"), targetsBytes);
    writeFileSync(join(indexDir, "timestamp.json"), JSON.stringify(timestamp));

    const result = await install({ id: "test-store-badversion", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid version|does not end with/);
    // Refused before ever becoming an active install.
    expect(getActiveInstall("test-store-badversion")).toBeNull();
  });

  test("installing a real skill-kind package makes it discoverable through lib/skills.ts", async () => {
    const { listSkillIds, loadSkill } = await import("@/lib/skills");
    const { targetPath } = await buildInstallableFixture({
      id: "test-store-skill",
      sourcePackageId: "storytime-style",
      pathPrefix: "skills/family",
    });
    const result = await install({ id: "test-store-skill", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(result.ok).toBe(true);
    expect(listSkillIds()).toContain("test-store-skill");
    expect(loadSkill("test-store-skill")?.manifest.id).toBe("test-store-skill");
  });

  test("two concurrent installs of the same id never corrupt previousVersion (the per-id lock)", async () => {
    const first = await buildInstallableFixture({ id: "test-store-concurrent", version: "1.0.0" });
    await install({ id: "test-store-concurrent", targetPath: first.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });

    // Two SEPARATE index directories: buildInstallableFixture() writes a
    // single-target root/targets/timestamp each call (overwriting the
    // previous one in the same dir), so two concurrent installs sharing
    // one dir would race on those files too - orthogonal to the actual
    // thing under test here (the per-PACKAGE lock inside store.ts).
    const dir2 = mkdtempSync(join(tmpdir(), "maipai-store-test-index2-"));
    const dir3 = mkdtempSync(join(tmpdir(), "maipai-store-test-index3-"));
    try {
      const second = await buildInstallableFixture({ id: "test-store-concurrent", version: "2.0.0", dir: dir2 });
      const third = await buildInstallableFixture({ id: "test-store-concurrent", version: "3.0.0", dir: dir3 });
      const [a, b] = await Promise.all([
        install({ id: "test-store-concurrent", targetPath: second.targetPath, source: { kind: "dir", dir: dir2 }, trust: trust() }),
        install({ id: "test-store-concurrent", targetPath: third.targetPath, source: { kind: "dir", dir: dir3 }, trust: trust() }),
      ]);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
      rmSync(dir3, { recursive: true, force: true });
    }

    // withPackageLock() registers itself synchronously the moment
    // install() is called, so the two synchronous calls inside the array
    // literal above lock in order: the 2.0.0 install runs first, the
    // 3.0.0 install runs second and correctly sees 2.0.0 (not the
    // original 1.0.0, superseded before this race even started) as its
    // own previous version - the lock forces a real sequential order,
    // never an interleaving where both read the pre-race state before
    // either writes (which is what would have produced "1.0.0" here
    // instead, the bug this test exists to catch).
    const active = getActiveInstall("test-store-concurrent");
    expect(active?.version).toBe("3.0.0");
    expect(active?.previousVersion).toBe("2.0.0");
  });
});

describe("rollback", () => {
  test("rolls back to the immediately previous version without re-downloading", async () => {
    const first = await buildInstallableFixture({ id: "test-store-rollback", version: "1.0.0" });
    const firstInstall = await install({ id: "test-store-rollback", targetPath: first.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(firstInstall.ok).toBe(true);

    const second = await buildInstallableFixture({ id: "test-store-rollback", version: "2.0.0" });
    const secondInstall = await install({ id: "test-store-rollback", targetPath: second.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(secondInstall.ok).toBe(true);
    expect(resolvePackageDir("test-store-rollback")).toBe(installedPackageVersionDir("test-store-rollback", "2.0.0"));

    const back = await rollback("test-store-rollback");
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.version).toBe("1.0.0");
    expect(resolvePackageDir("test-store-rollback")).toBe(installedPackageVersionDir("test-store-rollback", "1.0.0"));
  });

  test("refuses to roll back a package with no previous version", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-store-no-history" });
    await install({ id: "test-store-no-history", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    const back = await rollback("test-store-no-history");
    expect(back.ok).toBe(false);
  });

  test("refuses to roll back a package that was never installed", async () => {
    const back = await rollback("never-installed-at-all");
    expect(back.ok).toBe(false);
  });
});

describe("uninstall", () => {
  test("removes the active install and its files, falling back to bundled if one exists", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "weather", version: "0.2.0" });
    await install({ id: "weather", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    const versionDir = installedPackageVersionDir("weather", "0.2.0");
    expect(existsSync(versionDir)).toBe(true);

    const result = await uninstall("weather");
    expect(result.ok).toBe(true);
    expect(getActiveInstall("weather")).toBeNull();
    expect(existsSync(versionDir)).toBe(false);
    expect(resolvePackageDir("weather")).toBe(join(PACKAGES_DIR, "weather"));
  });

  test("refuses to uninstall a package with no active install", async () => {
    expect((await uninstall("never-installed-at-all")).ok).toBe(false);
  });

  // A real gap found by code review: an earlier version deleted the
  // WHOLE data/packages/<id>/ parent, which also holds a Tier 1
  // package's own persistent state (lib/paths.ts's tier1PackageDataDir).
  // Uninstalling a store update over a bundled package must leave that
  // state alone - the bundled copy keeps running right after, and
  // nothing about ITS data should vanish just because the update was
  // removed.
  test("leaves a Tier 1 package's own writable state alone - only the store's own version files are removed", async () => {
    const { tier1PackageDataDir } = await import("@/lib/paths");
    const stateDir = tier1PackageDataDir("weather");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "some-state.db"), "real Tier 1 state, not a store artifact");

    const { targetPath } = await buildInstallableFixture({ id: "weather", version: "0.2.0" });
    await install({ id: "weather", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    await uninstall("weather");

    expect(existsSync(join(stateDir, "some-state.db"))).toBe(true);
  });
});

describe("setChannel", () => {
  test("updates the channel on an active install", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-store-channel" });
    await install({ id: "test-store-channel", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(setChannel("test-store-channel", "beta").ok).toBe(true);
    expect(getActiveInstall("test-store-channel")?.channel).toBe("beta");
  });

  test("refuses on a package with no active install", () => {
    expect(setChannel("never-installed-at-all", "beta").ok).toBe(false);
  });
});
