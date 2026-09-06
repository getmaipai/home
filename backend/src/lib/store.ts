// The store host (session-d-packages-and-store.md step 6): fetches and
// verifies the catalog's signed index (lib/storeIndex.ts), unpacks a
// package into `data/packages/<id>/versions/<version>/`
// (lib/paths.ts's `installedPackageVersionDir`), runs its smoke test
// before treating it as reachable, and tracks the active install so
// `lib/packageResolve.ts` can point every loader at it. Rollback,
// uninstall, and channel changes all operate on that same
// `package_installs` row - nothing here ever re-downloads to roll back,
// since an older version's own files are never deleted until a NEWER
// install replaces them.
import { existsSync, mkdirSync, readFileSync, rmSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import * as tar from "tar";
import { db } from "@/db";
import { packageInstalls, storeIndexState } from "@/db/schema";
import { dataDir, installedPackageVersionDir, installStagingDir, isValidPackageId } from "@/lib/paths";
import { getActiveInstall } from "@/lib/packageResolve";
import { runSmoke } from "@/lib/smoke";
import { killLiveProcessForInstallChange } from "@/lib/denoHost";
import {
  fetchRawIndex,
  verifyIndex,
  verifyTargetHash,
  type IndexSource,
  type TrustConfig,
  type LastSeenVersions,
  type VerifiedIndex,
} from "@/lib/storeIndex";

// `status` on the failure branch (matching lib/commands.ts's own
// CommandOpResult and lib/plugins.ts's PluginOpResult) - a real gap
// found by code review: without it, every StoreResult failure collapsed
// to a single HTTP status at the route layer regardless of whether the
// package simply doesn't exist (404, routes/repairs.ts's own convention
// for "no such issue") or a real request problem (400). The function
// that actually knows which case it hit is the one that should say so.
export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: string; status: 400 | 404 };

// Serializes every install()/rollback()/uninstall() call for the SAME
// package id - a real gap found by code review: two concurrent installs
// of the same id (a double-click, a client retry racing a scheduled
// update) both read `getActiveInstall()` before either writes, both
// extract into the identical staging directory, and can each observe or
// clobber the other's in-flight state. The same shared-promise-per-key
// shape `lib/denoHost.ts`'s own `startingProcesses` map already uses for
// the identical class of problem (two concurrent calls for one cold
// Tier 1 package).
const packageLocks = new Map<string, Promise<unknown>>();

async function withPackageLock<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = packageLocks.get(id) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  // Swallow rejection in the CHAIN (not the returned promise) so one
  // failed operation doesn't permanently wedge every later call for the
  // same id behind a rejected promise.
  packageLocks.set(
    id,
    run.catch(() => undefined),
  );
  return run;
}

// A manifest's own declared version, read out of an UNPACKED tarball
// before it's trusted for anything - matches the version format
// manifest.schema.json itself requires (spec/schemas/manifest.schema.json's
// own `version` pattern). A real gap found by code review: an earlier
// version used `manifest.version` completely unvalidated to build a
// filesystem path (`installedPackageVersionDir(id, manifest.version)`),
// so a manifest whose version field read "../../../etc/cron.d" would
// flow straight through `path.resolve`'s own `..` collapsing into a
// write outside `data/packages/` entirely - contingent only on a
// malicious catalog entry passing hash verification, no signature break
// needed.
const SAFE_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/** The tarball's own filename for a given target path - `plugins/
 * utilities/weather/0.1.0` becomes `plugins_utilities_weather_0.1.0.tgz`,
 * the identical convention catalog's own tools/src/build-index.ts uses
 * when it writes tarballs next to the index. A wire contract both sides
 * have to agree on independently (there is no shared module between the
 * two repos, the same reason storeIndex.ts's own types are a hand-
 * written twin of catalog's), not a shared function. */
function tarballFileNameFor(targetPath: string): string {
  return `${targetPath.replace(/\//g, "_")}.tgz`;
}

function loadLastSeenVersions(): LastSeenVersions {
  const rows = db.select().from(storeIndexState).all();
  const seen: LastSeenVersions = {};
  for (const row of rows) {
    if (row.role === "root") seen.root = row.version;
    else if (row.role === "targets") seen.targets = row.version;
    else if (row.role === "timestamp") seen.timestamp = row.version;
  }
  return seen;
}

function saveLastSeenVersions(index: VerifiedIndex): void {
  const now = new Date().toISOString();
  for (const [role, version] of [
    ["root", index.root.version],
    ["targets", index.targets.version],
    ["timestamp", index.timestamp.version],
  ] as const) {
    db.insert(storeIndexState)
      .values({ role, version, updatedAt: now })
      .onConflictDoUpdate({ target: storeIndexState.role, set: { version, updatedAt: now } })
      .run();
  }
}

/** Fetches and verifies the index from `source`, refusing the entire
 * tamper suite (docs/PACKAGES.md) against this hub's OWN persisted
 * rollback state - never a fresh, trusting-everything check. Exported
 * on its own so a caller (a future `catalog.check` daily core job, or a
 * store UI listing what's installable) can preview the index without
 * installing anything. */
export async function fetchVerifiedIndex(source: IndexSource, trust: TrustConfig): Promise<StoreResult<VerifiedIndex>> {
  const raw = await fetchRawIndex(source);
  const result = verifyIndex(raw, trust, loadLastSeenVersions());
  if (!result.ok) return { ok: false, error: result.error, status: 400 };
  saveLastSeenVersions(result.index);
  return { ok: true, value: result.index };
}

export interface InstallOptions {
  id: string;
  targetPath: string;
  source: IndexSource;
  trust: TrustConfig;
  /** Required to proceed when the new version's permissions are not a
   * subset of the currently-installed version's own - the two-call
   * permission-prompt flow (docs/plans/session-d-packages-and-store.md
   * step 6): a caller previews with `confirmed` omitted, sees
   * `requiresConfirmation` if the permission set is growing, shows the
   * household the diff, and calls again with `confirmed: true`. A fresh
   * install (no previous version at all) never needs this - there is
   * nothing to compare against, and the household already sees the
   * package's own permissions before choosing to install it at all. */
  confirmed?: boolean;
}

export interface InstallOutcome {
  version: string;
  previousVersion: string | null;
  smokeOk: boolean;
  smokeMessage: string;
}

export type InstallResult =
  | { ok: true; value: InstallOutcome }
  | { ok: false; error: string; requiresConfirmation?: { newPermissions: string[] } };

/** Installs (or updates) one package from a verified index: downloads
 * its tarball, checks its hash against the index (the first of
 * docs/PACKAGES.md's "verify every package twice"), unpacks it to a
 * staging directory and checks the unpacked manifest's own `id` AND
 * `version` match what was asked for (the second verify - manifest
 * identity), then makes it the active install and runs its smoke test.
 * A smoke failure does NOT undo the install (docs/PACKAGES.md: "a
 * failure leaves it installed but disabled with a Repairs item") -
 * `lib/smoke.ts`'s own `runSmoke()` already raises that Repairs item and
 * flips `package_status`; this function's job ends at "the right files
 * are in place and tracked," not at "and it's healthy."
 *
 * Serialized per package id (`withPackageLock`): two concurrent installs
 * of the same id used to race on the same staging directory and both
 * read the pre-install state before either wrote it, corrupting
 * `previousVersion` and risking a half-extracted staging directory. */
export async function install(opts: InstallOptions): Promise<InstallResult> {
  // SEC-2-class guard (found by a code review pass over this merge,
  // 2026-09-06): `opts.id` is `routes/store.ts`'s own raw `:id` route
  // param, un-decoded and unchecked the same way SEC-2 found for
  // `PACKAGES_DIR` readers elsewhere - it flows straight into
  // `installStagingDir()`/`installedPackageVersionDir()` below, which
  // build real filesystem paths and, worse, `rmSync` them. Checked here
  // rather than only at the route layer, matching lib/plugins.ts's,
  // lib/skills.ts's, lib/smoke.ts's, and lib/denoHost.ts's own posture:
  // the lib function that actually builds the path is what validates it.
  if (!isValidPackageId(opts.id)) return { ok: false, error: `${opts.id} is not a valid package id` };
  return withPackageLock(opts.id, () => installLocked(opts));
}

async function installLocked(opts: InstallOptions): Promise<InstallResult> {
  const indexResult = await fetchVerifiedIndex(opts.source, opts.trust);
  if (!indexResult.ok) return indexResult;
  const index = indexResult.value;

  const entry = index.targets.targets[opts.targetPath];
  if (!entry) return { ok: false, error: `no such target in the index: ${opts.targetPath}` };

  // The permission-escalation check (docs/plans/session-d-packages-and-
  // store.md step 6's own acceptance line: "a permission-changing update
  // demoted to notify") runs BEFORE any download - a real gap found by
  // code review: an earlier version wrote the new permission set
  // straight into package_installs on every install with no comparison
  // against what was already granted, so an update that quietly widened
  // (say) `net:api.open-meteo.com` to `net:*` took effect immediately
  // with no household visibility at all.
  const previous = getActiveInstall(opts.id);
  if (previous) {
    const newPermissions = entry.custom.permissions.filter((p) => !previous.permissions.includes(p));
    if (newPermissions.length > 0 && !opts.confirmed) {
      return {
        ok: false,
        error: `${opts.id}: this update adds permissions (${newPermissions.join(", ")}) - confirm before installing`,
        requiresConfirmation: { newPermissions },
      };
    }
  }

  const tarballBytes = await readTarball(opts.source, opts.targetPath);
  if (!verifyTargetHash(entry, tarballBytes)) {
    return { ok: false, error: `${opts.targetPath}: tarball does not match the index's own hash - refusing to install` };
  }

  const staging = installStagingDir(opts.id);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const tarballPath = join(staging, "download.tgz");
  await Bun.write(tarballPath, tarballBytes);
  await tar.extract({ file: tarballPath, cwd: staging });
  rmSync(tarballPath);

  let manifest: { id: string; version: string };
  try {
    manifest = JSON.parse(readFileSync(join(staging, "manifest.json"), "utf-8"));
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: `unpacked package has no readable manifest.json: ${(err as Error).message}` };
  }
  if (manifest.id !== opts.id) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: `manifest identity mismatch: asked to install ${opts.id}, unpacked manifest declares ${manifest.id}` };
  }
  // Version identity, not just id: an unvalidated manifest.version used
  // directly to build a filesystem path (installedPackageVersionDir) is
  // a real path-traversal write, a second gap the same code review
  // found - a manifest declaring version "../../../etc/cron.d" would
  // otherwise flow straight through path.resolve's own ".." collapsing.
  // Requiring it to both match the safe version pattern AND equal the
  // target path's own version segment closes this from two directions
  // at once: no traversal characters can ever reach the path, and the
  // unpacked content can never silently claim a different version than
  // the one just hash-verified.
  if (!SAFE_VERSION_RE.test(manifest.version)) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: `unpacked manifest has an invalid version: ${JSON.stringify(manifest.version)}` };
  }
  if (!opts.targetPath.endsWith(`/${manifest.version}`)) {
    rmSync(staging, { recursive: true, force: true });
    return {
      ok: false,
      error: `manifest identity mismatch: target path ${opts.targetPath} does not end with unpacked version ${manifest.version}`,
    };
  }

  const versionDir = installedPackageVersionDir(opts.id, manifest.version);
  rmSync(versionDir, { recursive: true, force: true });
  mkdirSync(resolve(versionDir, ".."), { recursive: true });
  renameSync(staging, versionDir);

  // A reinstall of the SAME version (a retry, an admin "repair install")
  // must never overwrite a real previousVersion with itself - a third
  // gap the same review found: previous?.version ?? null was written
  // unconditionally, so re-running install() for the already-active
  // version silently destroyed the real rollback target, and a
  // subsequent rollback() would "succeed" by pointing version back at
  // itself, a no-op reported as success.
  const previousVersionToRecord = previous && previous.version !== manifest.version ? previous.version : (previous?.previousVersion ?? null);

  const now = new Date().toISOString();
  db.insert(packageInstalls)
    .values({
      packageId: opts.id,
      version: manifest.version,
      previousVersion: previousVersionToRecord,
      channel: entry.custom.channel,
      sourceCommit: entry.custom.source_commit,
      permissions: JSON.stringify(entry.custom.permissions),
      installedAt: now,
    })
    .onConflictDoUpdate({
      target: packageInstalls.packageId,
      set: {
        version: manifest.version,
        previousVersion: previousVersionToRecord,
        channel: entry.custom.channel,
        sourceCommit: entry.custom.source_commit,
        permissions: JSON.stringify(entry.custom.permissions),
        installedAt: now,
      },
    })
    .run();

  // A live sandbox process for the OLD version must not keep running
  // against files this call just replaced - see
  // killLiveProcessForInstallChange()'s own doc comment. Killed before
  // the smoke check below so that check (the first real caller after
  // install) lazily respawns fresh against the version just installed,
  // never a stale handle to the one before it.
  await killLiveProcessForInstallChange(opts.id);

  const smoke = await runSmoke(opts.id);
  return {
    ok: true,
    value: { version: manifest.version, previousVersion: previousVersionToRecord, smokeOk: smoke.ok, smokeMessage: smoke.message },
  };
}

async function readTarball(source: IndexSource, targetPath: string): Promise<Buffer> {
  const name = tarballFileNameFor(targetPath);
  if (source.kind === "dir") return readFileSync(join(source.dir, name));
  const res = await fetch(`${source.baseUrl.replace(/\/$/, "")}/${name}`);
  if (!res.ok) throw new Error(`fetching ${name} from ${source.baseUrl} failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Rolls a store-installed package back to its immediately previous
 * version - single-step, matching docs/PACKAGES.md's own "rollback to
 * THE previous version" (not a full history stack). The previous
 * version's files are still on disk (install() never deletes them), so
 * this never re-downloads anything. Serialized per package id, the same
 * reason install() is: racing a rollback against an in-flight install
 * for the same id could read a `previousVersion` that the install is
 * about to overwrite. */
export async function rollback(id: string): Promise<StoreResult<{ version: string }>> {
  if (!isValidPackageId(id)) return { ok: false, error: `${id} is not a valid package id`, status: 400 };
  return withPackageLock(id, async () => {
    const active = getActiveInstall(id);
    if (!active) return { ok: false, error: `${id} has no active store install to roll back`, status: 404 };
    if (!active.previousVersion) return { ok: false, error: `${id} has no previous version recorded to roll back to`, status: 400 };
    if (!existsSync(installedPackageVersionDir(id, active.previousVersion))) {
      return { ok: false, error: `${id}'s previous version (${active.previousVersion}) is no longer on disk`, status: 400 };
    }

    db.update(packageInstalls)
      .set({ version: active.previousVersion, previousVersion: null, installedAt: new Date().toISOString() })
      .where(eq(packageInstalls.packageId, id))
      .run();
    // The now-active version's own files just changed under whatever
    // sandbox process might still be running the OLD one - see
    // killLiveProcessForInstallChange()'s own doc comment.
    await killLiveProcessForInstallChange(id);

    return { ok: true, value: { version: active.previousVersion } };
  });
}

/** Removes a package's store install: the DB row (so
 * `lib/packageResolve.ts` falls back to a bundled copy if one exists, or
 * the package simply stops resolving at all if it was a genuinely new
 * community package) and every installed version's own SOURCE files
 * (`versions/` and any leftover `.staging/`) - never the `state/`
 * subdirectory a Tier 1 process keeps alongside them
 * (`lib/paths.ts`'s `tier1PackageDataDir`). A real gap found by code
 * review: an earlier version deleted the WHOLE `data/packages/<id>/`
 * parent, so uninstalling a store update over a bundled package (this
 * step's own "weather installed from the local index" case) silently
 * wiped that package's persistent Tier 1 state even though the bundled
 * copy keeps running right afterward. Serialized per package id like
 * install()/rollback() above. */
export async function uninstall(id: string): Promise<StoreResult<true>> {
  if (!isValidPackageId(id)) return { ok: false, error: `${id} is not a valid package id`, status: 400 };
  return withPackageLock(id, async () => {
    const active = getActiveInstall(id);
    if (!active) return { ok: false, error: `${id} has no active store install to remove`, status: 404 };
    db.delete(packageInstalls).where(eq(packageInstalls.packageId, id)).run();
    rmSync(resolve(dataDir, "packages", id, "versions"), { recursive: true, force: true });
    rmSync(installStagingDir(id), { recursive: true, force: true });
    // The files a live sandbox process might be running just disappeared
    // (or the package fell back to its bundled copy) - see
    // killLiveProcessForInstallChange()'s own doc comment.
    await killLiveProcessForInstallChange(id);
    return { ok: true, value: true };
  });
}

export function setChannel(id: string, channel: "stable" | "beta"): StoreResult<true> {
  if (!isValidPackageId(id)) return { ok: false, error: `${id} is not a valid package id`, status: 400 };
  const active = getActiveInstall(id);
  if (!active) return { ok: false, error: `${id} has no active store install to set a channel on`, status: 404 };
  db.update(packageInstalls).set({ channel }).where(eq(packageInstalls.packageId, id)).run();
  return { ok: true, value: true };
}
