import { writingFormatsFor } from "@/lib/writingFormats";
import { join } from "node:path";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, refuseWith } from "@/lib/openapi";
import { speakerAgeBand } from "@/lib/ageBand";
import { roleHealth } from "@/lib/roleHealth";
import { VOICEOVER_TOOL_ID, CHANGE_VOICE_TOOL_ID, MAKE_INSPIRED_VOICE_TOOL_ID } from "@/lib/voiceTools";
import { mayUseClipVoices } from "@/lib/access";
import { answerImagesAllowed } from "@/lib/answerImages/turn";
import { resolveTurnBudgetWithStack, toolOfferLabel, withTurnToolGates } from "@/lib/turnMachine/budget";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { START_PROJECT_TOOL_ID } from "@/lib/projects/tool";
import { getProjectType } from "@/lib/projects/projectTypes";
import { PACKAGES_DIR } from "@/lib/paths";
import { isDirectory } from "@/lib/bundledPackages";
import type { PersonRow } from "@/types";
import { requireAuth, requireRole } from "@/middleware/auth";
import { missingRequired, unavailableCapabilities } from "@/lib/capabilities";
import { listInstalledManifests, listPackageIds, loadManifestOnly, meetsMinRole, runPlugin } from "@/lib/plugins";
import { routingStats } from "@/lib/conversationHistory";
import { allPackageStatuses, getPackageStatus, runSmoke } from "@/lib/smoke";
import { refusePackageReplyIfUnsafe } from "@/lib/safety";
import { filterAnswerBlocks } from "@/lib/answerBlocks";
import { appAssetAllowed, appRunAllowed, getAppData, getAppPage, manifestForViewer, warmAppPage } from "@/lib/apps";
import { assetResponse, cleanAssetPath, packageAssetFile } from "@/lib/packageAssets";
import { newsRoutes } from "./newsRoutes";
import { houseAnyConnected } from "@/lib/house/connection";
import { peekHouseRegistries, warmHouseRegistries } from "@/lib/house/cache";
import { visibleHouseEntities, houseToolSpec } from "@/lib/house/tool";
import { uptimeAllowed } from "@/lib/uptime/tool";
import { giteaAllowed } from "@/lib/gitea/tool";
import { plexAllowed } from "@/lib/plex/tool";
import { immichAllowed } from "@/lib/immich/tool";
import { effectivePermissions } from "@/lib/permissions";
import { getHouseholdSettingValue } from "@/lib/settings";

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
      ...manifestForViewer(actor, manifest),
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
  offer_label: z.string().nullable().describe("Why an unoffered tool is not available, when its offer is off, not measured, or disabled."),
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
  // VOICE-V1/V2: the same gate a real written turn applies to voiceover and change_voice (adult, not a guest, voice engine ready).
  const voiceoverOk = band === "adult" && actor.role !== "guest" && (await roleHealth("voice").then((h) => h.availability === "ready", () => false));
  const inspiredVoiceOk = mayUseClipVoices(actor);
  const registry = peekHouseRegistries();
  let houseContext: { visible: import("@/lib/house/registry").HouseEntity[]; areas: import("@/lib/house/registry").HouseArea[] } | undefined;
  const houseEligible = actor.role !== "guest" && getHouseholdSettingValue("tools.house.mode") !== "never" && houseAnyConnected();
  let houseOk = false;
  if (houseEligible && registry) {
    const visible = visibleHouseEntities({ actor: { id: actor.id, role: actor.role as import("@/lib/house/access").HouseActor["role"], band: band === "child" || band === "teen" ? band : "adult" }, permissions: effectivePermissions(actor.id), entities: registry.entities });
    houseOk = visible.length > 0;
    if (houseOk) houseContext = { visible, areas: registry.areas };
  } else if (houseEligible) warmHouseRegistries();
  const uptimeOk = uptimeAllowed({ actor, band, surfaceClass: "written", spoken: false, bare: false });
  const giteaOk = giteaAllowed({ actor, band, surfaceClass: "written", spoken: false, bare: false });
  const plexOk = plexAllowed({ actor, band, surfaceClass: "written", spoken: false, bare: false });
  const immichOk = immichAllowed({ actor, band, surfaceClass: "written", spoken: false, bare: false });
  const budget = withTurnToolGates(
    await resolveTurnBudgetWithStack(undefined, band),
    answerImagesAllowed({ actor, band, surfaceClass: "written", spoken: false, temporary: false, bare: false, ephemeral: false }),
    false, false, false, false, false, false, false, null,
    // WRITING-FORMATS-03: the same gate a real written turn applies, so the list matches what the chat sends.
    writingFormatsFor(actor.role).length > 0,
    false, voiceoverOk, false, houseOk,
    uptimeOk,
    inspiredVoiceOk,
    giteaOk,
    immichOk,
    plexOk,
  );
  return new Set(budget.tools_offered.filter((id) => id === "house" ? Boolean(houseOk && houseContext && houseToolSpec(houseContext)) : id === "uptime" ? uptimeOk : id === "gitea" ? giteaOk : id === "plex" ? plexOk : id === "immich" ? immichOk : (id === VOICEOVER_TOOL_ID || id === CHANGE_VOICE_TOOL_ID ? voiceoverOk : id === MAKE_INSPIRED_VOICE_TOOL_ID ? inspiredVoiceOk : toolSpecFor(id) !== null)));
}

pluginsRoutes.openapi(skillsRoute, async (c) => {
  const actor = c.get("person");
  const statuses = allPackageStatuses();
  const unavailable = unavailableCapabilities();
  const offered = await writtenChatToolIds(actor);
  const rows = listPackageIds()
    .map((id) => loadManifestOnly(id))
    .flatMap((loaded) => (loaded.ok ? [loaded.value] : []))
    .filter((manifest) => SKILL_KINDS.has(manifest.kind) && meetsMinRole(actor.role, manifest.min_role) && missingRequired(manifest, unavailable).length === 0)
    .map((manifest) => {
      const status = statuses.get(manifest.id)?.status ?? "enabled";
      const offeredHere = manifest.kind === "project" ? offered.has(START_PROJECT_TOOL_ID) && getProjectType(manifest.id) !== undefined : offered.has(manifest.id);
      const usedInChat = status === "enabled" && offeredHere;
      return {
        id: manifest.id,
        kind: manifest.kind as "plugin" | "skill" | "project",
        name: typeof manifest.display === "string" && manifest.display.trim() ? manifest.display : manifest.id,
        description: manifest.description,
        origin: isDirectory(join(PACKAGES_DIR, manifest.id)) ? ("bundled" as const) : ("store" as const),
        status,
        used_in_chat: usedInChat,
        offer_label: toolOfferLabel(manifest, status, usedInChat),
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
  // NEWS-00 review: a package app's recipe serves every page's data, so a viewer below any raised page cannot run it directly. Checked
  // first so a disabled package does not confirm its existence to a viewer who may not use it.
  if (!appRunAllowed(c.get("person"), id)) return c.json({ error: "no such package" }, 404);
  if (getPackageStatus(id).status === "disabled") {
    return c.json({ error: `${id} is disabled (failed its last smoke test)` }, 403);
  }
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await runPlugin(id, actor, body);
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
    return refuseWith(c, result);
  }
  // GENUI-05: a package's blocks leave through the same filter a turn applies
  // (manifest allowlist, spec check, this person's age band, the output floor);
  // what fails is dropped, never the reply.
  const { blocks: rawBlocks, ...rest } = result.value as typeof result.value & { blocks?: unknown };
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return c.json(rest);
  const loaded = loadManifestOnly(id);
  const blocks = filterAnswerBlocks(rawBlocks, id, loaded.ok ? loaded.value.returns_blocks ?? [] : [], speakerAgeBand(actor, new Date()), actor);
  return c.json(blocks.length > 0 ? { ...rest, blocks } : rest);
});

// NEWS-02: the News app's own data, action and picture routes. Registered before the generic `/:id/data/:dataId` below so
// `/news/...` reaches them; they apply the same app gate and the owning page's floor (lib/apps.ts).
pluginsRoutes.route("/news", newsRoutes);

// VIDEO-CREATE-02 (U3): a package app's own picture and loop files (lib/packageAssets.ts). The same gate as its pages: a package the person may
// not use, a file no page lets them see and a name that does not resolve are all the same plain 404.
pluginsRoutes.get("/:id/assets/*", requireAuth, (c) => {
  const id = c.req.param("id");
  const marker = `/${id}/assets/`;
  const at = c.req.path.indexOf(marker);
  const rel = at < 0 ? null : cleanAssetPath(c.req.path.slice(at + marker.length));
  const asset = rel ? packageAssetFile(id, rel) : null;
  if (!rel || !asset || !appAssetAllowed(c.get("person"), id, rel)) return c.json({ error: "no such file" }, 404);
  return assetResponse(asset, { range: c.req.header("range"), ifNoneMatch: c.req.header("if-none-match") }) as never;
});

// APP-KIND-03: a package app's page document and its data. Both apply the one gate in lib/apps.ts
// (appVisibleTo); a package the person may not use is a 404, so its existence does not leak.
pluginsRoutes.get("/:id/pages/:pageId", requireAuth, async (c) => {
  await warmAppPage(c.req.param("id"), c.req.param("pageId"));
  const result = getAppPage(c.get("person"), c.req.param("id"), c.req.param("pageId"));
  return result.ok ? c.json(result.value as Record<string, unknown>, 200) : refuseWith(c, result);
});

pluginsRoutes.post("/:id/data/:dataId", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await getAppData(c.get("person"), c.req.param("id"), c.req.param("dataId"), body);
  if (result.ok) return c.json(result.value, 200);
  // `code` mirrors `kind` so the kit page (ApiError.code) can say the reason in the page's own words (WEATHER-FIX-01).
  return c.json(result.kind ? { error: result.error, kind: result.kind, code: result.kind } : { error: result.error }, result.status as 400);
});

// Owner/admin only: forces a re-check outside the daily job, e.g. right
// after fixing whatever a Repairs item points at.
pluginsRoutes.post("/:id/smoke", requireRole("owner", "admin"), async (c) => {
  const result = await runSmoke(c.req.param("id"));
  return c.json(result);
});
