import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as tar from "tar";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";
import { resolvePackageDir, getActiveInstall } from "@/lib/packageResolve";
import { install, rollback, uninstall, setChannel } from "@/lib/store";
import type { RootMetadata, TargetsMetadata, TimestampMetadata, TargetEntry } from "@/lib/storeIndex";
import { makeKeyPair, sign, type KeyPair } from "./support/tufFixtures";
import { owner, teen, child } from "./support/testAuth";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { TestClient } from "./client";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { reconcileCapabilities, packagesLosingCapability, removalConfirmation } from "@/lib/capabilityReconcile";
import { tier1PackageDataDir } from "@/lib/paths";
import { settingsValues, people, conversationTurns } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { createAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";

// Builds a REAL packed tarball too (tests/support/tufFixtures.ts's own
// buildFixtureIndex() only builds signed metadata, no actual package
// content) - install() unpacks a real tar file, so this test needs one.

let indexDir: string;
let signer: KeyPair;

// resetDb() alone clears packageInstalls/packageStatus/storeIndexState
// (plus people/sessions, which the route tests below need clean too) -
// a real gap found by code review: an earlier version ALSO hand-deleted
// those three tables in its own afterEach, which was fully redundant
// with resetDb() and masked that the owner()/teen()-based tests
// actually depend on resetDb() running before each test (dropping it
// would silently break every route test here with a confusing 409 from
// a stale /api/auth/setup, not an obvious failure pointing at this
// file).
beforeEach(() => {
  resetDb();
  indexDir = mkdtempSync(join(tmpdir(), "maipai-store-test-index-"));
  signer = makeKeyPair();
});

afterEach(() => {
  rmSync(indexDir, { recursive: true, force: true });
});

/** Packs a REAL package directory (weather's own real bundled files -
 * a complete, valid manifest+recipe+tests, so this test never has to
 * hand-construct one) into `indexDir`, builds a signed index around it
 * under the given `id`, and returns everything install() needs. Passing
 * a different `id` than weather's own real manifest.id (a genuinely new
 * package) or the same id ("weather" - an update to a bundled default,
 * this step's own acceptance scenario) are both real, tested cases. */
async function buildInstallableFixture(
  opts: { id: string; version?: string; permissions?: string[]; requires?: string[]; sourcePackageId?: string; pathPrefix?: string; dir?: string; mutateManifest?: (manifest: Record<string, unknown>) => void; files?: Record<string, string> } = {
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
  // The copied package's app pages and settings area name its own id (WEATHER-APP-01); a renamed copy is not an app.
  if (manifest.contributes) { delete manifest.contributes.pages; delete manifest.contributes.settings_area; }
  if (opts.requires) manifest.requires = opts.requires;
  opts.mutateManifest?.(manifest);
  writeFileSync(join(stagingSrc, "manifest.json"), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    mkdirSync(join(stagingSrc, name, ".."), { recursive: true });
    writeFileSync(join(stagingSrc, name), content);
  }

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

describe("install, app pages (APP-KIND-03)", () => {
  const indexDoc = JSON.stringify({ type: "page", id: "x", title: "X", body: [{ type: "empty_state", icon: "inbox", text: "Nothing." }] });
  const withPages = (pages: unknown[]) => (m: Record<string, unknown>) => { m.contributes = { pages }; };
  const page = { id: "index", label: "X", nav: true, kind: "schema", module: "index" };

  test("a package whose pages conform installs", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-app-ok", mutateManifest: withPages([page]), files: { "pages/index.json": indexDoc } });
    const result = await install({ id: "test-app-ok", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(result.ok).toBe(true);
  });

  test("a kind: web page, a missing page file and a missing index are refused and nothing becomes active", async () => {
    const cases: Array<[string, Parameters<typeof buildInstallableFixture>[0]]> = [
      ["test-app-web", { id: "test-app-web", mutateManifest: withPages([{ ...page, kind: "web" }]), files: { "pages/index.json": indexDoc } }],
      ["test-app-nofile", { id: "test-app-nofile", mutateManifest: withPages([page]) }],
      ["test-app-noindex", { id: "test-app-noindex", mutateManifest: withPages([{ ...page, id: "front" }]), files: { "pages/index.json": indexDoc } }],
    ];
    for (const [id, fixture] of cases) {
      const { targetPath } = await buildInstallableFixture(fixture);
      const result = await install({ id, targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("app pages were refused");
      expect(getActiveInstall(id)).toBeNull();
    }
  });
});

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

  test("CAP-GATE-01: refuses a package whose required capability the allocation has off, and installs it once on", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-store-needs-image", requires: ["image"] });
    const args = { id: "test-store-needs-image", targetPath, source: { kind: "dir" as const, dir: indexDir }, trust: trust() };
    setHouseholdSettingValue("engines.image.choice", "off");
    const refused = await install(args);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("Pictures is off");
    expect(getActiveInstall("test-store-needs-image")).toBeNull();
    setHouseholdSettingValue("engines.image.choice", "auto");
    expect((await install(args)).ok).toBe(true);
  });

  test("CAP-GATE-01: turning a role off names and removes the store packages that require it, and leaves the rest", async () => {
    for (const [id, requires] of [["test-store-reconcile-image", ["image"]], ["test-store-reconcile-plain", undefined]] as const) {
      const { targetPath } = await buildInstallableFixture({ id, requires: requires ? [...requires] : undefined });
      const done = await install({ id, targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
      expect(done.ok).toBe(true);
    }
    expect(packagesLosingCapability()).toEqual([]);
    setHouseholdSettingValue("engines.image.choice", "off");
    const losers = packagesLosingCapability();
    expect(losers.map((l) => l.id)).toEqual(["test-store-reconcile-image"]);
    expect(removalConfirmation(losers)).toContain("The following will be uninstalled and users will lose access");
    expect(await reconcileCapabilities()).toEqual(["test-store-reconcile-image"]);
    expect(getActiveInstall("test-store-reconcile-image")).toBeNull();
    expect(getActiveInstall("test-store-reconcile-plain")).not.toBeNull();
  });

  test("CAP-GATE-01: the settings save names the packages first and removes them only once confirmed", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-store-route-image", requires: ["image"] });
    expect((await install({ id: "test-store-route-image", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() })).ok).toBe(true);
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const off = { scope: "household", key: "engines.image.choice", value: "off" };
    const first = await owner.request("/api/settings", { method: "PUT", body: off });
    expect(first.status).toBe(400);
    expect(((await first.json()) as { error: string }).error).toContain("uninstalled and users will lose access");
    expect(getActiveInstall("test-store-route-image")).not.toBeNull();
    const second = await owner.request("/api/settings", { method: "PUT", body: { ...off, confirmRemoval: true } });
    expect(second.status).toBe(200);
    expect(getActiveInstall("test-store-route-image")).toBeNull();
  });

  test.each([
    { role: "tts", requires: ["tts"] as string[], id: "test-store-route-voice" },
    { role: "vision", requires: ["vision"] as string[], id: "test-store-route-photos" },
  ])("turning off $role asks before removing a dependent package, and saves plainly without one", async ({ role, requires, id }) => {
    const { targetPath } = await buildInstallableFixture({ id, requires });
    expect((await install({ id, targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() })).ok).toBe(true);
    const { client } = await owner();
    const key = role === "tts" ? "engines.tts.choice" : "engines.vision.choice";
    const off = { scope: "household", key, value: "off" };
    const first = await client.request("/api/settings", { method: "PUT", body: off });
    expect(first.status).toBe(400);
    expect(((await first.json()) as { error: string }).error).toContain("users will lose access");
    expect(getActiveInstall(id)).not.toBeNull();
    const second = await client.request("/api/settings", { method: "PUT", body: { ...off, confirmRemoval: true } });
    expect(second.status).toBe(200);
    expect(getActiveInstall(id)).toBeNull();

    const plain = await client.request("/api/settings", { method: "PUT", body: { ...off, key: key === "engines.tts.choice" ? "engines.stt.choice" : "engines.image.choice" } });
    expect(plain.status).toBe(200);
  });

  test("CAP-GATE-01: a tool whose package needs a capability that is off is not offered to the model", async () => {
    const { targetPath } = await buildInstallableFixture({ id: "test-store-tool-image", requires: ["image"] });
    expect((await install({ id: "test-store-tool-image", targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() })).ok).toBe(true);
    expect(toolSpecFor("test-store-tool-image")).not.toBeNull();
    setHouseholdSettingValue("engines.image.choice", "off");
    expect(toolSpecFor("test-store-tool-image")).toBeNull();
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

  test("keeps package settings and state through uninstall and reinstall", async () => {
    const id = "test-store-retained-data";
    const first = await buildInstallableFixture({ id, version: "1.0.0" });
    expect((await install({ id, targetPath: first.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() })).ok).toBe(true);

    const stateDir = tier1PackageDataDir(id);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "settings.json"), JSON.stringify({ theme: "warm" }));
    writeFileSync(join(stateDir, "state.json"), JSON.stringify({ count: 7 }));
    db.insert(settingsValues).values({ scope: "household", key: `package.${id}.theme`, value: JSON.stringify("warm"), hlc: nextHlc(), source: "test", updatedAt: new Date().toISOString() }).run();

    expect((await uninstall(id)).ok).toBe(true);
    const second = await buildInstallableFixture({ id, version: "1.0.0" });
    expect((await install({ id, targetPath: second.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() })).ok).toBe(true);

    expect(db.select().from(settingsValues).where(eq(settingsValues.key, `package.${id}.theme`)).get()?.value).toBe(JSON.stringify("warm"));
    expect(JSON.parse(readFileSync(join(stateDir, "settings.json"), "utf-8"))).toEqual({ theme: "warm" });
    expect(JSON.parse(readFileSync(join(stateDir, "state.json"), "utf-8"))).toEqual({ count: 7 });
  });

  test("keeps a package-created media record visible in Library and owner-scoped Files after uninstall", async () => {
    const id = "test-store-media-retained";
    const { targetPath } = await buildInstallableFixture({ id });
    expect((await install({ id, targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() })).ok).toBe(true);
    const { client, row } = await owner();
    const conversation = resolveOrCreateConversation(row, "chat");
    if (!conversation.ok) throw new Error(conversation.error);
    const turnId = newConversationTurnId();
    db.insert(conversationTurns).values({ id: turnId, personId: row.id, surface: "chat", conversationId: conversation.value.id, userText: "make a picture", replyText: "done", source: "model", safetyAction: "allow", createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
    const record = createAttachment(row, { conversationId: conversation.value.id, turnId, mediaType: "image/png", bytes: new TextEncoder().encode("package-picture"), provenance: `package:${id}` });
    if (!record.ok) throw new Error(record.error);

    expect((await uninstall(id)).ok).toBe(true);
    for (const path of ["/api/files", `/api/files?owner=${row.id}`]) {
      const response = await client.get(path);
      expect(response.status).toBe(200);
      const rows = await response.json() as { file: { id: string }; owner_person_id: string }[];
      expect(rows.some((file) => file.file.id === record.value.id && file.owner_person_id === row.id)).toBe(true);
    }
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

describe("SEC-2-class guard: every store operation rejects a malformed/traversal id before touching disk", () => {
  const traversalId = "../../data/keys";

  test("install rejects it", async () => {
    const result = await install({ id: traversalId, targetPath: "x", source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(result.ok).toBe(false);
  });

  test("rollback rejects it", async () => {
    const result = await rollback(traversalId);
    expect(result.ok).toBe(false);
  });

  test("uninstall rejects it", async () => {
    const result = await uninstall(traversalId);
    expect(result.ok).toBe(false);
  });

  test("setChannel rejects it", () => {
    expect(setChannel(traversalId, "beta").ok).toBe(false);
  });
});

describe("the /api/store routes", () => {
  test("child and teen profiles cannot uninstall and get the next step", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    const childProfile = await child(client);
    for (const profile of [teenClient, childProfile.client]) {
      const response = await profile.post("/api/store/installs/weather/uninstall", {});
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe("Only a household owner or admin can uninstall packages. Ask one of them to do it.");
    }
  });

  test("every route requires owner/admin, not just any signed-in person", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    expect((await teenClient.get("/api/store/installs/weather")).status).toBe(403);
    expect((await teenClient.post("/api/store/installs/weather", {})).status).toBe(403);
    expect((await teenClient.post("/api/store/installs/weather/rollback", {})).status).toBe(403);
    expect((await teenClient.post("/api/store/installs/weather/uninstall", {})).status).toBe(403);
    expect((await teenClient.post("/api/store/installs/weather/channel", { channel: "beta" })).status).toBe(403);
  });

  // A real gap found by code review: every StoreResult failure used to
  // collapse to 400 at the route layer, even "this package has no
  // active install at all" - routes/repairs.ts's own convention (and
  // this route's OpenAPI schema) says that's a 404, not a 400.
  test("rollback/uninstall/channel on a package with no active install are 404, not 400", async () => {
    const { client } = await owner();
    expect((await client.post("/api/store/installs/never-installed-at-all/rollback", {})).status).toBe(404);
    expect((await client.post("/api/store/installs/never-installed-at-all/uninstall", {})).status).toBe(404);
    expect((await client.post("/api/store/installs/never-installed-at-all/channel", { channel: "beta" })).status).toBe(404);
  });

  test("GET returns null for a package with no active install", async () => {
    const { client } = await owner();
    const res = await client.get("/api/store/installs/weather");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  test("POST install installs a real package and GET then reports it", async () => {
    const { client } = await owner();
    const { targetPath } = await buildInstallableFixture({ id: "test-store-route", version: "1.0.0" });
    const res = await client.post("/api/store/installs/test-store-route", {
      targetPath,
      source: { kind: "dir", dir: indexDir },
      trust: trust(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; smokeOk: boolean };
    expect(body.version).toBe("1.0.0");
    expect(body.smokeOk).toBe(true);

    const getRes = await client.get("/api/store/installs/test-store-route");
    const getBody = (await getRes.json()) as { id: string; version: string };
    expect(getBody.id).toBe("test-store-route");
    expect(getBody.version).toBe("1.0.0");
  });

  test("POST install returns 409 with the permission diff when an update needs confirmation", async () => {
    const { client } = await owner();
    const first = await buildInstallableFixture({ id: "test-store-route-perm", version: "1.0.0", permissions: ["net:a.example"] });
    await client.post("/api/store/installs/test-store-route-perm", { targetPath: first.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });

    const second = await buildInstallableFixture({ id: "test-store-route-perm", version: "2.0.0", permissions: ["net:a.example", "net:b.example"] });
    const res = await client.post("/api/store/installs/test-store-route-perm", { targetPath: second.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { requiresConfirmation: { newPermissions: string[] } };
    expect(body.requiresConfirmation.newPermissions).toEqual(["net:b.example"]);
  });

  test("POST rollback, uninstall, and channel all work through the route", async () => {
    const { client } = await owner();
    const first = await buildInstallableFixture({ id: "test-store-route-lifecycle", version: "1.0.0" });
    await client.post("/api/store/installs/test-store-route-lifecycle", { targetPath: first.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });
    const second = await buildInstallableFixture({ id: "test-store-route-lifecycle", version: "2.0.0" });
    await client.post("/api/store/installs/test-store-route-lifecycle", { targetPath: second.targetPath, source: { kind: "dir", dir: indexDir }, trust: trust() });

    const channelRes = await client.post("/api/store/installs/test-store-route-lifecycle/channel", { channel: "beta" });
    expect(channelRes.status).toBe(200);
    expect(getActiveInstall("test-store-route-lifecycle")?.channel).toBe("beta");

    const rollbackRes = await client.post("/api/store/installs/test-store-route-lifecycle/rollback", {});
    expect(rollbackRes.status).toBe(200);
    expect((await rollbackRes.json()) as { version: string }).toEqual({ version: "1.0.0" });

    const preview = await client.get("/api/store/installs/test-store-route-lifecycle/uninstall-preview");
    expect(preview.status).toBe(200);
    const previewBody = await preview.json() as { confirmation: string };
    expect(previewBody.confirmation).toContain("The following will be uninstalled and users will lose access");
    expect(previewBody.confirmation).toContain("Your pictures stay in Library.");

    const uninstallRes = await client.post("/api/store/installs/test-store-route-lifecycle/uninstall", {});
    expect(uninstallRes.status).toBe(200);
    expect((await uninstallRes.json() as { confirmation: string }).confirmation).toBe(previewBody.confirmation);
    expect(getActiveInstall("test-store-route-lifecycle")).toBeNull();
  });
});
