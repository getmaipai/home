// Step 10: "the updates projection" (plan 4.15/2.4) - one check a day
// against GitHub's own public release API for `getmaipai/home`, "listed
// on the privacy page as the only periodic outbound call" (lib/
// privacy.ts's own header already documents there being none - this is
// that one exception, and adding it here without a matching row there
// would violate the org's own "adding an outbound endpoint updates the
// privacy page in the same commit" rule).
//
// Scoped to the APP only. The plan's full projection also names
// packages (D's store), models (the catalogue), and sidecars (pinned
// with the app) - none of those have anything real to check against
// yet: no package catalog is live (getmaipai/catalog is a separate,
// not-yet-consuming repo), lib/modelCatalog.ts is a static, hand-
// maintained list with no "latest version" concept of its own, and
// sidecars are declared as "pinned with the app" (i.e. they follow
// whatever the app's own release settles on, not tracked separately).
// Building a projection for data sources that don't exist yet would be
// exactly the kind of speculative code CLAUDE.md's own "don't design
// for hypothetical future requirements" warns against - documented as
// deferred in docs/BACKLOG.md, not silently skipped.
//
// lib/selfUpdate.ts (verify, back up, stage into releases/<version>,
// swap, restart, health-check-or-roll-back) is NOT built here either:
// it needs a real service to restart under (step 11, not built yet - no
// release has ever been cut, so `main`'s own `releases/` layout has
// never existed on a real machine either) and cross-cutting "never
// during a conversation/generation/download/playback" checks into
// turnEngine.ts, packageHost.ts and voice playback - all other
// sessions' files. Attempting it now would be unverifiable by
// construction (nothing real to restart, nothing real to roll back to)
// and risks stepping on infrastructure step 11 hasn't decided the shape
// of yet.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUpdateState } from "@/db/schema";
import { trigger } from "@/lib/notifications";
import { tryConsume } from "@/lib/rateLimiter";

const STATE_ROW_ID = "app";
const GITHUB_API_URL = "https://api.github.com/repos/getmaipai/home/releases/latest";

// "Every integration gets a rate limiter at its single choke point"
// (CLAUDE.md > Third-party services). One check a day from the core job
// is well within this on its own; the real target is POST /api/updates/
// check (routes/updates.ts), which any owner/admin (or a backups.run
// grant holder) could otherwise call in a tight loop with no cooldown.
// A small burst allowance (checking a few times in a row while testing
// a setting) with a slow refill - GitHub's own unauthenticated limit is
// 60/hour, and a household has no reason to come remotely close to it.
const GITHUB_RATE_LIMIT = { capacity: 5, refillPerSecond: 1 / 3600 };
const FETCH_TIMEOUT_MS = 5_000;

// Bumped by the release skill at cut time (getmaipai/.github's own
// tooling, a separate repo) - 0.1.0 until then, the same placeholder
// every package.json in this monorepo already carries. Read fresh on
// every check rather than cached at module load, so a test (or a real
// release process) that changes it takes effect without a restart.
function installedVersion(): string {
  return (globalThis as { __MAIPAI_INSTALLED_VERSION__?: string }).__MAIPAI_INSTALLED_VERSION__ ?? "0.1.0";
}

export interface UpdateAsset {
  name: string;
  url: string;
  /** GitHub's own release-asset digest, when it provides one
   * ("sha256:<hex>") - null when it doesn't, never computed by this
   * hub itself (that would mean downloading the whole asset just to
   * check for an update, defeating the point of a lightweight check). */
  digest: string | null;
}

export interface UpdateProjection {
  installed: string;
  latest: string | null;
  summary: string | null;
  url: string | null;
  assets: UpdateAsset[];
  /** No other channel exists yet - GitHub Releases has no beta/nightly
   * concept this project uses today. */
  channel: "stable";
  /** No download/apply mechanism exists yet (lib/selfUpdate.ts, not
   * built - see this file's own header) - always null. */
  progress: null;
  /** Nothing this hub can name is required before an update could apply
   * today, since nothing applies updates yet. */
  needs: string[];
  blockedBy: string | null;
  checkedAt: string | null;
  error: string | null;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}
interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  assets: GitHubReleaseAsset[];
}

interface StoredState {
  checkedAt: string | null;
  latestVersion: string | null;
  latestUrl: string | null;
  latestSummary: string | null;
  error: string | null;
  notifiedVersion?: string | null;
  assetsJson?: string | null;
}

interface UpsertFields {
  checkedAt: string;
  latestVersion: string | null;
  latestUrl: string | null;
  latestSummary: string | null;
  error: string | null;
  /** Issue #40: persisted alongside the rest of the checked state so
   * cachedUpdateProjection() (every GET /api/updates/) can read them
   * back, instead of only ever existing in the transient projection
   * built for the immediate POST /api/updates/check response. */
  assets: UpdateAsset[];
}

/** The one write path for `app_update_state` - a code review (2026-09-06)
 * found the success/404/catch branches of checkForAppUpdate() each
 * hand-rolling a near-identical upsert, three copies that would have to
 * be kept in sync by hand (and one already was, missing this field,
 * until the review caught it). `notifiedVersion` is read-modify-write
 * (never overwritten by this function itself) so a plain state update
 * never has to know or re-supply whether a notification already fired. */
function upsertState(fields: UpsertFields): void {
  const { assets, ...rest } = fields;
  const values = { ...rest, assetsJson: JSON.stringify(assets) };
  db.insert(appUpdateState)
    .values({ id: STATE_ROW_ID, ...values })
    .onConflictDoUpdate({ target: appUpdateState.id, set: values })
    .run();
}

function currentNotifiedVersion(): string | null {
  return db.select({ v: appUpdateState.notifiedVersion }).from(appUpdateState).where(eq(appUpdateState.id, STATE_ROW_ID)).get()?.v ?? null;
}

function markNotified(version: string): void {
  db.update(appUpdateState).set({ notifiedVersion: version }).where(eq(appUpdateState.id, STATE_ROW_ID)).run();
}

// Fully anchored (`$` at the end, not just `^v?` at the start): a code
// review (2026-09-06) found the original, end-unanchored regex parsing
// "v0.2.0-rc.1" identically to a clean "v0.2.0", silently ignoring the
// prerelease suffix. GitHub's own releases/latest endpoint already
// excludes prereleases and drafts by default, but if a maintainer ever
// marks one manually (or that default ever changes), this makes a
// prerelease tag fail to parse - `isNewerVersion()` already treats an
// unparseable tag as "not newer," so a prerelease is simply never
// offered as an update, never miscompared as an equal-or-newer stable
// one.
function parseSemver(tag: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `latest` is genuinely newer than `installed` - never a
 * string comparison ("0.9.0" < "0.10.0" lexicographically fails). Ties
 * or an unparseable tag are "not newer": a malformed release tag must
 * never be treated as an update worth notifying about. */
export function isNewerVersion(installed: string, latest: string): boolean {
  const a = parseSemver(installed);
  const b = parseSemver(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i]! > a[i]!) return true;
    if (b[i]! < a[i]!) return false;
  }
  return false;
}

/** The real check: one GET against GitHub's public release API,
 * cached in `app_update_state` so a route reads a fast, already-known
 * answer rather than hitting GitHub on every page load. Never throws -
 * a network failure or a 404 (no release published yet, true today)
 * is recorded as `error` and surfaced in the projection, not thrown
 * past the scheduled job that calls this unattended. Rate-limited and
 * time-bounded: see this file's own top-of-file comments for both. */
export async function checkForAppUpdate(): Promise<UpdateProjection> {
  const now = new Date().toISOString();

  if (!tryConsume("updates:github-release-check", GITHUB_RATE_LIMIT)) {
    const message = "checked too recently - try again later";
    return projectionFromState({ checkedAt: now, latestVersion: null, latestUrl: null, latestSummary: null, error: message });
  }

  try {
    const res = await fetch(GITHUB_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // A 404 here means "no release has been published yet" (true for
      // this project today), not a real error - recorded the same way,
      // since a household's own projection has nothing to show either
      // way, but the wording should say "checked, nothing published"
      // rather than imply something broke.
      const message = res.status === 404 ? "no release has been published yet" : `GitHub returned ${res.status}`;
      upsertState({ checkedAt: now, latestVersion: null, latestUrl: null, latestSummary: null, error: message, assets: [] });
      return cachedUpdateProjection();
    }
    const release = (await res.json()) as GitHubRelease;
    const assets: UpdateAsset[] = release.assets.map((a) => ({ name: a.name, url: a.browser_download_url, digest: a.digest ?? null }));
    upsertState({ checkedAt: now, latestVersion: release.tag_name, latestUrl: release.html_url, latestSummary: release.body, error: null, assets });
    // Issue #40: this used to build its own transient projection here
    // (never persisting `assets`), so it was the ONLY caller that ever
    // saw them - every later GET /api/updates/ (cachedUpdateProjection())
    // read the just-upserted row back with no assets column to read them
    // from, and got assets: [] regardless of what the real release had.
    // Reading the row that was just written, the same way every other
    // caller does, means there is exactly one place that turns a stored
    // state row into a projection.
    const projection = cachedUpdateProjection();
    // Fires once per genuine transition to a new version, never once
    // per check - a code review (2026-09-06) found the original version
    // re-notifying every single day forever for the same still-
    // unapplied release, since nothing here ever advances
    // installedVersion() (self-update isn't built). The same "notify on
    // open, not on every recheck" discipline lib/issues.ts's
    // raiseIssue() already applies to Repairs items.
    if (projection.latest && isNewerVersion(projection.installed, projection.latest) && currentNotifiedVersion() !== projection.latest) {
      await trigger("updates.available", { version: projection.latest });
      markNotified(projection.latest);
    }
    return projection;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    upsertState({ checkedAt: now, latestVersion: null, latestUrl: null, latestSummary: null, error: message, assets: [] });
    return cachedUpdateProjection();
  }
}

function projectionFromState(state: StoredState): UpdateProjection {
  const installed = installedVersion();
  const latest = state.latestVersion;
  const needsUpdate = latest !== null && isNewerVersion(installed, latest);
  // Issue #40: state.assetsJson round-trips exactly what upsertState()
  // wrote (this hub's own JSON.stringify of UpdateAsset[]) - a parse
  // failure here would mean the row was corrupted some other way, never
  // a real-world input to defend against, but this file's own discipline
  // is "never throw past the scheduled job or route that calls this."
  let assets: UpdateAsset[] = [];
  if (state.assetsJson) {
    try {
      assets = JSON.parse(state.assetsJson) as UpdateAsset[];
    } catch {
      assets = [];
    }
  }
  return {
    installed,
    latest,
    summary: state.latestSummary,
    url: state.latestUrl,
    assets,
    channel: "stable",
    progress: null,
    needs: [],
    // Nothing can actually apply an update yet (lib/selfUpdate.ts isn't
    // built), so a real update being available is itself the block -
    // never null when one exists, so a future UI never implies a
    // ready-to-click "update now" button that would do nothing.
    blockedBy: needsUpdate ? "self-update is not built yet - update by hand from the GitHub release" : null,
    checkedAt: state.checkedAt,
    error: state.error,
  };
}

/** Reads the cached last check without hitting GitHub - what a route
 * should call; the daily core job is the only caller of
 * checkForAppUpdate() itself. */
export function cachedUpdateProjection(): UpdateProjection {
  const row = db.select().from(appUpdateState).where(eq(appUpdateState.id, STATE_ROW_ID)).get();
  if (!row) {
    return projectionFromState({ checkedAt: null, latestVersion: null, latestUrl: null, latestSummary: null, error: null });
  }
  return projectionFromState(row);
}
