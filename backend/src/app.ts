import "@/lib/addedModels";
import { libraryRoutes } from "@/routes/library";
import { musicRoutes } from "@/routes/music";
import { serveStatic } from "hono/bun";
import { apiReference } from "@scalar/hono-api-reference";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { auth } from "@/routes/auth";
import { peopleRoutes } from "@/routes/people";
import { safetyRoutes } from "@/routes/safety";
import { memoryRoutes } from "@/routes/memory";
import { settingsRoutes } from "@/routes/settings";
import { operatorRoutes } from "@/routes/operator";
import { appsRoutes } from "@/routes/apps";
import { pluginsRoutes } from "@/routes/plugins";
import { mediaAppRoutes } from "@/routes/mediaApps";
import { toursRoutes } from "@/routes/tours";
import { commandsRoutes } from "@/routes/commands";
import { notificationsRoutes } from "@/routes/notifications";
import { jobsRoutes } from "@/routes/jobs";
import { schedulerRoutes } from "@/routes/scheduler";
import { llmRoutes } from "@/routes/llm";
import { ttsRoutes } from "@/routes/tts";
import { turnRoutes } from "@/routes/turn";
import { turnBareRoutes } from "@/routes/turnBare";
import { conversationsRoutes } from "@/routes/conversations";
import { chatFoldersRoutes } from "@/routes/chatFolders";
import { artifactsRoutes } from "@/routes/artifacts";
import { projectsRoutes } from "@/routes/projects";
import { backupsRoutes } from "@/routes/backups";
import { hostRoutes } from "@/routes/host";
import { engineRolesRoutes } from "@/routes/engineRoles";
import { statusBoardRoutes } from "@/routes/statusBoard";
import { canaryRoutes } from "@/routes/canary";
import { statusAppsRoutes } from "@/routes/statusApps";
import { performanceAppsRoutes } from "@/routes/performanceApps";
import { voiceRoutes } from "@/routes/voice";
import { visionRoutes } from "@/routes/vision";
import { sttRoutes, sttStatusRoutes } from "@/routes/stt";
import { privacyRoutes } from "@/routes/privacy";
import { repairsRoutes } from "@/routes/repairs";
import { enginesRoutes } from "@/routes/engines";
import { engineLinkRoutes } from "@/routes/engineLink";
import { fitPlanRoutes } from "@/routes/fitPlan";
import { computerMemoryRoutes } from "@/routes/computerMemory";
import { performanceRoutes } from "@/routes/performance";
import { turnErrorDetailRoutes } from "@/routes/turnErrorDetail";
import { turnTraceRoutes } from "@/routes/turnTrace";
import { devUiRoutes } from "@/routes/devUi";
import { setupRoutes } from "@/routes/setup";
import { installRoutes } from "@/routes/install";
import { componentsRoutes } from "@/routes/components";
import { aiChoicesRoutes } from "@/routes/aiChoices";
import { stackCodingRoutes } from "@/routes/stackCoding";
import { installGate } from "@/middleware/installGate";
import { chatPauseGate } from "@/middleware/chatPauseGate";
import { setupChecklistRoutes } from "@/routes/setupChecklist";
import { tailscaleRoutes } from "@/routes/tailscale";
import { devicesRoutes } from "@/routes/devices";
import { deviceAuthRoutes } from "@/routes/deviceAuth";
import { quickConnectRoutes } from "@/routes/quickConnect";
import { robotHostRoutes } from "@/routes/robotHosts";
import { passkeysRoutes } from "@/routes/passkeys";
import { authSessionsRoutes } from "@/routes/authSessions";
import { totpRoutes } from "@/routes/totp";
import { entitiesRoutes } from "@/routes/entities";
import { placesRoutes } from "@/routes/places";
import { relationshipsRoutes } from "@/routes/relationships";
import { grantsRoutes } from "@/routes/grants";
import { biometricPrintsRoutes } from "@/routes/biometricPrints";
import { approvalsRoutes } from "@/routes/approvals";
import { searchRoutes } from "@/routes/search";
import { libraryRetentionRoutes } from "@/routes/libraryRetention";
import { storageRoutes } from "@/routes/storage";
import { filesRoutes, sharesRoutes } from "@/routes/files";
import { imageEditRoutes } from "@/routes/imageEdit";
import { picturesRoutes } from "@/routes/pictures";
import { picturesAdminRoutes } from "@/routes/picturesAdmin";
import { videosRoutes } from "@/routes/videos";
import { trashRoutes } from "@/routes/trash";
import { offlineRoutes } from "@/routes/offline";
import { mediaOfflineRoutes } from "@/routes/mediaOffline";
import { mediaHomeRoutes } from "@/routes/mediaHome";
import { companionsRoutes } from "@/routes/companions";
import { mediaSearchRoutes } from "@/routes/mediaSearch";
import { mediaRoutes } from "@/routes/media";
import { continueRoutes } from "@/routes/continue";
import { attachmentsRoutes } from "@/routes/attachments";
import { updatesRoutes } from "@/routes/updates";
import { openaiRoutes } from "@/routes/openai";
import { codeGatewayRoutes } from "@/routes/codeGateway";
import { storeRoutes } from "@/routes/store";
import { listsRoutes } from "@/routes/lists";
import { alarmsRoutes } from "@/routes/alarms";
import { worldPlacesRoutes } from "@/routes/worldPlaces";
import { quickTimersRoutes } from "@/routes/quickTimers";
import { comingUpRoutes } from "@/routes/comingUp";
import { widgetsRoutes } from "@/routes/widgets";
import { faviconRoutes } from "@/routes/favicon";
import { answerImageRoutes } from "@/routes/answerImage";
import { referenceRoutes } from "@/routes/reference";
import { dashboardRoutes } from "@/routes/dashboard";
import { requireAuth } from "@/middleware/auth";
import { pageCsp } from "@/middleware/pageCsp";
import { collectHealth } from "@/lib/healthSnapshot";
import { slowRequestMiddleware } from "@/lib/perfWatch";

// Session F, step 4: every route file converts to @hono/zod-openapi
// through lib/openapi.ts's apiRouter() - app.ts's own top-level instance
// is the root every session's `.route()`-mounted sub-router aggregates
// into, so it has to be the OpenAPIHono variant too for /api/docs to see
// anything. An UNCONVERTED sub-router (plain Hono, everything not yet
// converted) mounts onto this exactly the same way it always did -
// OpenAPIHono only adds the `.openapi()` method and the document
// generation, it doesn't require every mounted router to use it.
export const app = apiRouter();
app.use("*", slowRequestMiddleware);

// Session F, step 2: real sidecar reporting, per the wave-2 contract
// ("F to E: health, repairs, updates..."). gpu/disk/last_backup/
// certificate/models/link are the rest of that contract's shape - they
// land with steps 3 (guards), 5 (trust), 8 (backups), 9 (storage), 10
// (models) and Wave 3 (link) respectively; adding them now as guessed
// placeholders would be a shape E has to revisit twice instead of once,
// so this only returns what's real today. requireAuth, not a role gate:
// unlike Repairs (owner/admin, remedial actions), Health is informational
// and every signed-in household member can see it.
const SidecarStatusSchema = z.enum(["stopped", "starting", "running", "unhealthy", "crashed"]);
// One engine as the Health page sees it (2026-09-07, "why didn't our
// health page show bad health when these are down" - Jesse): `kind` is
// what the supervisor is configured to run, `alive` is a real probe of
// the process behind it - true/false when something is supposed to be
// up, null when there is nothing to probe (not started yet, starting,
// stopped). `brain`/`voice` below stay exactly what they were (a kind
// label; the chat page's ready-to-send gate reads them) - additive, per
// the org's API compatibility rule.
const ENGINE_HEALTH_KINDS = ["url", "override", "selection", "stub", "stopped", "starting", "stalled", "none", "spawned", "restarting", "failed", "blocked"] as const;
const EngineHealthSchema = z.object({
  kind: z.enum(ENGINE_HEALTH_KINDS),
  pid: z.number().nullable(),
  alive: z.boolean().nullable(),
  availability: z.enum(["ready", "starting", "unavailable"]).optional(),
  reason: z.enum(["stopped", "crashed", "blocked_port", "not_installed", "failed_start"]).nullable().optional(),
  // THIN-1C (#203): the Stack's own stated reason for refusing the role,
  // in household wording; only present after such a refusal.
  detail: z.string().nullable().optional(),
  // CHAT-CALM-ERRORS-01d: the composer line per band while chat cannot
  // answer (failureCopy.ts); absent when the engine is ready.
  notice: z.object({ adult: z.string(), teen: z.string(), child: z.string(), repairs_link: z.string().nullable() }).nullable().optional(),
  // CHAT-PAUSE-01 and ENGINE-STATUS-MEDIA-01: why the role is not ready, when Home knows.
  cause: z.enum(["restarting", "memory", "not_installed", "paused_by_admin", "mode_change", "offline"]).nullable().optional(),
});
const HealthResponseSchema = z.object({
  brain: z.string(),
  voice: z.string(),
  /** False when any engine that should be up is not answering, or any
   * registered sidecar is unhealthy/crashed. The Health page's headline. */
  ok: z.boolean(),
  // ENGINE-STATUS-MEDIA-01: `image` and `video` say whether a picture or a clip can be started now; they never change `ok`.
  engines: z.object({ chat: EngineHealthSchema, embed: EngineHealthSchema, background: EngineHealthSchema, voice: EngineHealthSchema, image: EngineHealthSchema.optional(), video: EngineHealthSchema.optional() }),
  // Settings -> Household -> Health (2026-09-07): the plainest single
  // signal of "is the app actually up," next to which that page puts the
  // restart control (routes/host.ts's POST /api/host/restart).
  uptimeSeconds: z.number(),
  sidecars: z.array(
    z.object({
      id: z.string(),
      status: SidecarStatusSchema,
      baseUrl: z.string().nullable(),
    }),
  ),
});

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  tags: ["Health"],
  summary: "Every registered sidecar's live status",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: { "application/json": { schema: HealthResponseSchema } },
      description: "Sidecar statuses. gpu/disk/last_backup/certificate/models/link land in later steps.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
// The explicit `200` matters, not just style: omitting it left @hono/
// zod-openapi unable to tell which of the route's declared response
// schemas (200 vs 401) this call was for, and it type-checked the
// response body against BOTH - a real error caught while converting
// routes/repairs.ts to the identical pattern, fixed here too.
app.openapi(healthRoute, async (c) => c.json(await collectHealth(), 200));

// /api/docs: the Scalar API reference reading the generated document
// below. docs/api/ (a script check.sh runs and diffs, per this step's
// own plan text) is generated FROM this same document, never hand-
// written - see scripts/gen-api-docs.ts.
app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: { title: "MaiPai Home API", version: "0.1.0" },
});
app.get("/api/docs", apiReference({ url: "/api/openapi.json" }));

app.route("/api/auth", auth);
app.route("/api/people", peopleRoutes);
app.route("/api/safety", safetyRoutes);
app.route("/api/memory", memoryRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/operator", operatorRoutes);
app.route("/api/apps", appsRoutes);
// MEDIA-VIDEOS-01: each media app's own data and action routes come first; any other package falls through to the generic ones.
for (const { id, routes } of mediaAppRoutes) app.route(`/api/plugins/${id}`, routes);
app.route("/api/plugins", pluginsRoutes);
app.route("/api/tours", toursRoutes);
app.route("/api/commands", commandsRoutes);
app.route("/api/notifications", notificationsRoutes);
app.route("/api/jobs", jobsRoutes);
app.route("/api/scheduler", schedulerRoutes);
// Needs-the-AI routes wait for the install (setup page B, install strip).
app.use("/api/llm/chat", chatPauseGate);
app.use("/api/turn/*", chatPauseGate);
app.use("/v1/chat/completions", chatPauseGate);
app.use("/api/llm/*", installGate("chat"));
app.use("/api/turn/*", installGate("chat"));
app.use("/api/tts/*", installGate("all", undefined, ["tts"]));
app.use("/api/stt/*", installGate("all", undefined, ["stt"]));
app.use("/api/vision/*", installGate("all", undefined, ["vision", "chat"]));
app.use("/api/answer-image/*", installGate("all", undefined, ["chat", "vision"]));
app.route("/api/llm", llmRoutes);
app.route("/api/tts", ttsRoutes);
app.route("/api/turn", turnRoutes);
app.route("/api/turn/bare", turnBareRoutes);
app.route("/api/turn-error-detail", turnErrorDetailRoutes);
app.route("/api/admin/turns", turnTraceRoutes);
app.route("/api/conversations", conversationsRoutes);
app.route("/api/chat-folders", chatFoldersRoutes);
app.route("/api/artifacts", artifactsRoutes);
app.route("/api/projects", projectsRoutes);
app.route("/api/backups", backupsRoutes);
app.route("/api/host", hostRoutes);
app.route("/api/host/engines", engineRolesRoutes);
app.route("/api/status", statusBoardRoutes);
app.route("/api/health-checks", canaryRoutes);
app.route("/api/status", statusAppsRoutes);
app.route("/api/performance", performanceAppsRoutes);
app.route("/api/voice", voiceRoutes);
app.route("/api/vision", visionRoutes);
app.route("/api/voice", sttStatusRoutes);
app.route("/api/stt", sttRoutes);
app.route("/api/privacy", privacyRoutes);
app.route("/api/repairs", repairsRoutes);
app.route("/api/engines", enginesRoutes);
app.route("/api/engine-link", engineLinkRoutes);
app.route("/api/fit-plan", fitPlanRoutes);
app.route("/api/computer-memory", computerMemoryRoutes);
app.route("/api/performance", performanceRoutes);
app.route("/api/dev/ui-fixtures", devUiRoutes);
app.route("/api/setup", setupRoutes);
app.route("/api/install", installRoutes);
app.route("/api/components", componentsRoutes);
app.route("/api/ai", aiChoicesRoutes);
app.route("/api/coding-setup", stackCodingRoutes);
// Public API name introduced with coding mode. Keep the earlier settings
// path mounted for clients already using /api/coding-setup.
app.route("/api/coding", stackCodingRoutes);
app.route("/api/setup-checklist", setupChecklistRoutes);
app.route("/api/tailscale", tailscaleRoutes);
app.route("/api/devices", devicesRoutes);
app.route("/api/auth/devices", deviceAuthRoutes);
app.route("/api/auth/quick-connect", quickConnectRoutes);
app.route("/api/robots", robotHostRoutes);
app.route("/api/auth/passkeys", passkeysRoutes);
app.route("/api/auth/sessions", authSessionsRoutes);
app.route("/api/auth/totp", totpRoutes);
app.route("/api/entities", entitiesRoutes);
app.route("/api/places", placesRoutes);
app.route("/api/lists", listsRoutes);
app.route("/api/alarms", alarmsRoutes);
app.route("/api/world-places", worldPlacesRoutes);
app.route("/api/quick-timers", quickTimersRoutes);
app.route("/api/coming-up", comingUpRoutes);
app.route("/api/widgets", widgetsRoutes);
app.route("/api/favicon", faviconRoutes);
app.route("/api/answer-image", answerImageRoutes);
app.route("/api/reference", referenceRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/relationships", relationshipsRoutes);
app.route("/api/grants", grantsRoutes);
app.route("/api/biometric-prints", biometricPrintsRoutes);
app.route("/api/approvals", approvalsRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/store", storeRoutes);
app.route("/api/storage", storageRoutes);
app.route("/api/library/retention", libraryRetentionRoutes);
app.route("/api/files", filesRoutes);
app.route("/api/library", libraryRoutes);
app.route("/api/attachments", attachmentsRoutes);
app.route("/api/image-edit", imageEditRoutes);
app.route("/api/pictures/admin", picturesAdminRoutes);
app.route("/api/pictures", picturesRoutes);
app.route("/api/videos", videosRoutes);
app.route("/api/media/home", mediaHomeRoutes);
app.route("/api/companions", companionsRoutes);
app.route("/api/media/search", mediaSearchRoutes);
app.route("/api/media/offline", mediaOfflineRoutes);
app.route("/api/offline", offlineRoutes);
app.route("/api/media", mediaRoutes);
app.route("/api/trash", trashRoutes);
app.route("/api/continue", continueRoutes);
app.route("/api/music", musicRoutes);
app.route("/api/shares", sharesRoutes);
app.route("/api/updates", updatesRoutes);
// Root-mounted, not under /api: OpenAI's own wire contract names this
// exact path (session-c-brain-and-voice.md step 8), which a client
// integrating against it expects verbatim.
app.route("/", openaiRoutes);
// CODE-API-01: the coding gateway, under its own prefix so the turn door above is untouched. Personal `code` keys only.
app.route("/code/v1", codeGatewayRoutes);

// Serving the built frontend from this same process (docs/dev.md, the
// shell/kit/Chat slice): a self-hosted single-process hub, no reverse
// proxy required for local use. Mounted last, after every /api/* route,
// so it can never shadow one. Dev mode uses the Vite dev server's own
// proxy instead (frontend/vite.config.ts), so this repo works with or
// without dist/ - including gaining it after the process already
// started (a deploy script that boots the backend before `bun run
// build` finishes the frontend): both handlers below check the
// filesystem per request rather than gating on an existsSync() read
// once at import time, which a code review (2026-09-04) found would
// otherwise 404 forever once the frontend was actually ready.
const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "..", "frontend", "dist");
const indexPath = join(distDir, "index.html");

// PI-RENDER-01: the app page and its assets carry the Content-Security-Policy.
app.use("/*", pageCsp);
app.use("/*", serveStatic({ root: distDir }));

// SPA fallback: any GET that isn't an API route and didn't match a
// static file is a client-side route (none exist yet with one page, but
// this is the real fallback shape rather than a 404 the moment a second
// page and a router land). index.html's content is cached after the
// first successful read rather than re-read from disk on every request:
// it never changes between builds, and a fresh deploy restarts this
// process anyway (getmaipai/.github/CLAUDE.md > Releases).
let cachedIndexHtml: string | null = null;
app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.notFound();
  if (cachedIndexHtml === null) {
    if (!existsSync(indexPath)) return c.notFound();
    cachedIndexHtml = await Bun.file(indexPath).text();
  }
  return c.html(cachedIndexHtml);
});
