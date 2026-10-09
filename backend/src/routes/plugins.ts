import { join } from "node:path";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { speakerAgeBand } from "@/lib/ageBand";
import { answerImagesAllowed } from "@/lib/answerImages/turn";
import { resolveTurnBudgetWithStack, withTurnToolGates } from "@/lib/turnMachine/budget";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { START_PROJECT_TOOL_ID } from "@/lib/projects/tool";
import { getProjectType } from "@/lib/projects/projectTypes";
import { PACKAGES_DIR } from "@/lib/paths";
import { isDirectory } from "@/lib/bundledPackages";
import type { PersonRow } from "@/types";
import { requireAuth, requireRole } from "@/middleware/auth";
import { listInstalledManifests, listPackageIds, loadManifestOnly, meetsMinRole, runPlugin } from "@/lib/plugins";
import { routingStats } from "@/lib/conversationHistory";
import { allPackageStatuses, getPackageStatus, runSmoke } from "@/lib/smoke";
import { refusePackageReplyIfUnsafe } from "@/lib/safety";

export const pluginsRoutes = apiRouter();

// No store yet (session-d step 6), so `latest_version` and `channel`
// have nothing real to report against: every bundled package is pinned
// to its own manifest version on the "stable" channel until the store
// exists to say otherwise.
pluginsRoutes.get("/", requireAuth, async (c) => {
  const statuses = allPackageStatuses();
  const actor = c.get("person");
  const manifests = listInstalledManifests().filter((manifest) => meetsMinRole(actor.role, manifest.min_role));
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

// SKILLS-PAGE-01: the Customize page's Skills tab. A skill here is an
// installed package of kind plugin (a tool the model can call), skill
// (plain instructions) or project (a background project type), read from
// its manifest alone, so a handler, SKILL.md or plan.json package is
// listed too (GET / above lists only recipe packages). `origin` says
// whether it ships with Home (its directory is in backend/packages/, even
// when the store has since updated it) or was added to this home from the
// catalog. `used_in_chat` is the same offered set the asking person's
// written chat turn builds (resolveTurnBudgetWithStack for their band, then
// withTurnToolGates), only for a package its smoke test has not disabled,
// and for a project type only when that type is registered.
const SKILL_KINDS = new Set(["plugin", "skill", "project"]);

const SkillRow = z.object({
  id: z.string(),
  kind: z.enum(["plugin", "skill", "project"]),
  name: z.string().describe("The package's display name."),
  description: z.string().describe("What it does, in one line."),
  origin: z.enum(["bundled", "store"]).describe("bundled: ships with Home. store: added to this home from the catalog."),
  status: z.enum(["enabled", "disabled"]).describe("disabled: its last smoke test failed."),
  used_in_chat: z.boolean().describe("Offered in the asking person's written chat today."),
});

const skillsRoute = createRoute({
  method: "get",
  path: "/skills",
  tags: ["Packages"],
  summary: "List the skills this person's chat can use",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(SkillRow) } }, description: "Installed plugin, skill and project packages at or below the person's role." },
    ...errorResponses({ 401: "Sign in first" }),
  },
});

/** The tool ids a written, non-temporary chat of `actor` is offered today. */
export async function writtenChatToolIds(actor: PersonRow): Promise<Set<string>> {
  const band = speakerAgeBand(actor, new Date());
  const budget = withTurnToolGates(
    await resolveTurnBudgetWithStack(undefined, band),
    answerImagesAllowed({ actor, band, surfaceClass: "written", spoken: false, temporary: false, bare: false, ephemeral: false }),
  );
  return new Set(budget.tools_offered.filter((id) => toolSpecFor(id) !== null));
}

pluginsRoutes.openapi(skillsRoute, async (c) => {
  const actor = c.get("person");
  const statuses = allPackageStatuses();
  const offered = await writtenChatToolIds(actor);
  const rows = listPackageIds()
    .map((id) => loadManifestOnly(id))
    .flatMap((loaded) => (loaded.ok ? [loaded.value] : []))
    .filter((manifest) => SKILL_KINDS.has(manifest.kind) && meetsMinRole(actor.role, manifest.min_role))
    .map((manifest) => {
      const status = statuses.get(manifest.id)?.status ?? "enabled";
      const offeredHere = manifest.kind === "project" ? offered.has(START_PROJECT_TOOL_ID) && getProjectType(manifest.id) !== undefined : offered.has(manifest.id);
      return {
        id: manifest.id,
        kind: manifest.kind as "plugin" | "skill" | "project",
        name: typeof manifest.display === "string" && manifest.display.trim() ? manifest.display : manifest.id,
        description: manifest.description,
        origin: isDirectory(join(PACKAGES_DIR, manifest.id)) ? ("bundled" as const) : ("store" as const),
        status,
        used_in_chat: status === "enabled" && offeredHere,
      };
    });
  return c.json(rows, 200);
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
  const result = await runPlugin(id, actor, body, { personInitiated: true });
  if (result.ok) {
    // CHAT-02: the one output boundary. A package answer reaches a
    // person through this route the same as through chat, so it meets
    // the identical evaluator first; a refusal returns the canned
    // refusal shape, never the package text.
    const refused = refusePackageReplyIfUnsafe(actor, result.value);
    if (refused) return c.json(refused, 200);
  }
  if (!result.ok) {
    // Fix B (docs/dev.md's "Chat reliability" B2): a code review
    // (2026-09-07) found this route was the one caller that dropped
    // `fallback_reply` on a genuine 502 - chat (the retired turn engine) and
    // widgets.ts both already speak the manifest's own honest fallback
    // text for the identical failure; a direct test-run of a package
    // should see the same thing, not just the raw internal error string.
    // #86: the fallback reply is package text too (the manifest's own
    // honest line, or a handler's typed report) and meets the same
    // boundary as a successful answer before it leaves.
    if (result.status === 502) {
      const fallback = refusePackageReplyIfUnsafe(actor, result.fallback_reply) ?? result.fallback_reply;
      return c.json({ error: result.error, fallback_reply: fallback }, result.status);
    }
    return c.json({ error: result.error }, result.status);
  }
  return c.json(result.value);
});

// Owner/admin only: forces a re-check outside the daily job, e.g. right
// after fixing whatever a Repairs item points at.
pluginsRoutes.post("/:id/smoke", requireRole("owner", "admin"), async (c) => {
  const result = await runSmoke(c.req.param("id"));
  return c.json(result);
});
