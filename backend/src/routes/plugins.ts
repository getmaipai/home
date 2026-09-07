import { Hono } from "hono";
import { requireAuth, requireRole } from "@/middleware/auth";
import { listPackageIds, loadPackage, runPlugin } from "@/lib/plugins";
import { routingStats } from "@/lib/conversationHistory";
import { allPackageStatuses, getPackageStatus, runSmoke } from "@/lib/smoke";
import type { AppEnv } from "@/types";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";

export const pluginsRoutes = new Hono<AppEnv>();

// No store yet (session-d step 6), so `latest_version` and `channel`
// have nothing real to report against: every bundled package is pinned
// to its own manifest version on the "stable" channel until the store
// exists to say otherwise.
pluginsRoutes.get("/", requireAuth, async (c) => {
  const statuses = allPackageStatuses();
  const manifests = listPackageIds()
    .map((id) => loadPackage(id))
    .filter((r) => r.ok)
    .map((r) => (r as { ok: true; value: { manifest: PackageManifest } }).value.manifest);
  const rows = manifests.map((manifest) => {
    const status = statuses.get(manifest.id);
    return {
      ...manifest,
      installed_version: manifest.version,
      latest_version: manifest.version,
      channel: "stable" as const,
      status: status?.status ?? "enabled",
      smoke: {
        last_run_at: status?.lastSmokeAt ?? null,
        ok: status?.smokeOk ?? null,
        message: status?.smokeMessage ?? null,
      },
    };
  });
  return c.json(rows);
});

// Owner/admin only: aggregate counts across every household member's
// turns, the same "systems metric, not personal history" gate
// hostRoutes.get("/hardware"|"/models") already use for the identical
// reason - unlike GET / above (any signed-in person can see what
// plugins exist), this is the plan's own routing-quality measurement
// (4.5: "count fall-throughs... and decide on tier 2 from the eval
// number"), not something a household member browses casually.
pluginsRoutes.get("/stats", requireRole("owner", "admin"), async (c) => {
  return c.json(routingStats());
});

pluginsRoutes.post("/:id/run", requireAuth, async (c) => {
  const id = c.req.param("id");
  // A package a failed smoke test disabled (docs/PACKAGES.md's bronze
  // bar) stays installed but must not run - checked at the route layer,
  // not inside lib/plugins.ts's runPlugin(), so this file can import
  // lib/smoke.ts without smoke.ts's own import of lib/plugins.ts closing
  // a cycle (see lib/smoke.ts's header).
  if (getPackageStatus(id).status === "disabled") {
    return c.json({ error: `${id} is disabled (failed its last smoke test)` }, 403);
  }
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await runPlugin(id, actor, body);
  if (!result.ok) {
    // Fix B (docs/dev.md's "Chat reliability" B2): a code review
    // (2026-09-07) found this route was the one caller that dropped
    // `fallback_reply` on a genuine 502 - chat (turnEngine.ts) and
    // widgets.ts both already speak the manifest's own honest fallback
    // text for the identical failure; a direct test-run of a package
    // should see the same thing, not just the raw internal error string.
    return c.json(result.status === 502 ? { error: result.error, fallback_reply: result.fallback_reply } : { error: result.error }, result.status);
  }
  return c.json(result.value);
});

// Owner/admin only: forces a re-check outside the daily job, e.g. right
// after fixing whatever a Repairs item points at.
pluginsRoutes.post("/:id/smoke", requireRole("owner", "admin"), async (c) => {
  const result = await runSmoke(c.req.param("id"));
  return c.json(result);
});
