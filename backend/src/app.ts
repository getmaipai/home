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
import { pluginsRoutes } from "@/routes/plugins";
import { commandsRoutes } from "@/routes/commands";
import { notificationsRoutes } from "@/routes/notifications";
import { schedulerRoutes } from "@/routes/scheduler";
import { llmRoutes } from "@/routes/llm";
import { ttsRoutes } from "@/routes/tts";
import { turnRoutes } from "@/routes/turn";
import { conversationsRoutes } from "@/routes/conversations";
import { backupsRoutes } from "@/routes/backups";
import { hostRoutes } from "@/routes/host";
import { voiceRoutes } from "@/routes/voice";
import { sttRoutes, sttStatusRoutes } from "@/routes/stt";
import { privacyRoutes } from "@/routes/privacy";
import { repairsRoutes } from "@/routes/repairs";
import { setupRoutes } from "@/routes/setup";
import { devicesRoutes } from "@/routes/devices";
import { deviceAuthRoutes } from "@/routes/deviceAuth";
import { quickConnectRoutes } from "@/routes/quickConnect";
import { passkeysRoutes } from "@/routes/passkeys";
import { authSessionsRoutes } from "@/routes/authSessions";
import { totpRoutes } from "@/routes/totp";
import { entitiesRoutes } from "@/routes/entities";
import { relationshipsRoutes } from "@/routes/relationships";
import { grantsRoutes } from "@/routes/grants";
import { approvalsRoutes } from "@/routes/approvals";
import { openaiRoutes } from "@/routes/openai";
import { storeRoutes } from "@/routes/store";
import { listsRoutes } from "@/routes/lists";
import { requireAuth } from "@/middleware/auth";
import { listSidecars } from "@/lib/sidecars";

// Session F, step 4: every route file converts to @hono/zod-openapi
// through lib/openapi.ts's apiRouter() - app.ts's own top-level instance
// is the root every session's `.route()`-mounted sub-router aggregates
// into, so it has to be the OpenAPIHono variant too for /api/docs to see
// anything. An UNCONVERTED sub-router (plain Hono, everything not yet
// converted) mounts onto this exactly the same way it always did -
// OpenAPIHono only adds the `.openapi()` method and the document
// generation, it doesn't require every mounted router to use it.
export const app = apiRouter();

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
const HealthResponseSchema = z.object({
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
app.openapi(healthRoute, (c) => c.json({ sidecars: listSidecars() }, 200));

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
app.route("/api/plugins", pluginsRoutes);
app.route("/api/commands", commandsRoutes);
app.route("/api/notifications", notificationsRoutes);
app.route("/api/scheduler", schedulerRoutes);
app.route("/api/llm", llmRoutes);
app.route("/api/tts", ttsRoutes);
app.route("/api/turn", turnRoutes);
app.route("/api/conversations", conversationsRoutes);
app.route("/api/backups", backupsRoutes);
app.route("/api/host", hostRoutes);
app.route("/api/voice", voiceRoutes);
app.route("/api/voice", sttStatusRoutes);
app.route("/api/stt", sttRoutes);
app.route("/api/privacy", privacyRoutes);
app.route("/api/repairs", repairsRoutes);
app.route("/api/setup", setupRoutes);
app.route("/api/devices", devicesRoutes);
app.route("/api/auth/devices", deviceAuthRoutes);
app.route("/api/auth/quick-connect", quickConnectRoutes);
app.route("/api/auth/passkeys", passkeysRoutes);
app.route("/api/auth/sessions", authSessionsRoutes);
app.route("/api/auth/totp", totpRoutes);
app.route("/api/entities", entitiesRoutes);
app.route("/api/lists", listsRoutes);
app.route("/api/relationships", relationshipsRoutes);
app.route("/api/grants", grantsRoutes);
app.route("/api/approvals", approvalsRoutes);
app.route("/api/store", storeRoutes);
// Root-mounted, not under /api: OpenAI's own wire contract names this
// exact path (session-c-brain-and-voice.md step 8), which a client
// integrating against it expects verbatim.
app.route("/", openaiRoutes);

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
