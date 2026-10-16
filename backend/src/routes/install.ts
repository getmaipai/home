// The install after (and during) setup: what is downloading, what has
// landed, and a retry. The wizard reads the same summary through
// `GET /api/setup/install` before an owner exists.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { isOwnerOrAdmin } from "@/lib/access";
import { getInstallStatus, resetInstallStatusCache } from "@/lib/installStatus";
import { startSetupDownloads } from "@/setup/checks/setupDownloads";
import { beginInstall, engineNeedsInstall, ensureEngineInstalling, previewPlan } from "@/lib/installActions";
import { getStackClient } from "@/lib/stackEngine";
import { setMemoryAnswerGb } from "@/lib/setupState";

export const InstallStatusSchema = z.object({
  state: z.enum(["none", "installing_engine", "engine_failed", "downloading", "starter_ready", "stalled", "out_of_space", "failed", "ready"]),
  chatReady: z.boolean(),
  complete: z.boolean(),
  percent: z.number().int().min(0).max(100),
  completedBytes: z.number(),
  totalBytes: z.number(),
  bytesPerSecond: z.number().nullable(),
  etaSeconds: z.number().nullable(),
  problem: z.string().nullable(),
  stage: z.string().nullable(),
  stageLabel: z.string().nullable(),
  items: z.array(z.object({
    id: z.string(), model: z.string(), role: z.string().nullable(), label: z.string(),
    state: z.string(), completedBytes: z.number(), totalBytes: z.number(), reason: z.string().nullable(),
  })),
});

export const installRoutes = apiRouter();

const statusRoute = createRoute({
  method: "get", path: "/", tags: ["Install"], summary: "What the AI install is doing now",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: InstallStatusSchema } }, description: "The install summary, from the Stack's download jobs." } },
});
installRoutes.openapi(statusRoute, async (c) => c.json(await getInstallStatus(), 200));

const retryRoute = createRoute({
  method: "post", path: "/retry", tags: ["Install"], summary: "Start the missing downloads again",
  middleware: [requireAuth] as const,
  // The memory answer is optional: a retry without one reuses the number saved
  // when the plan was chosen (a Mac reads its unified memory and needs none).
  request: { body: { required: false, content: { "application/json": { schema: z.object({ vram_gb: z.number().int().min(1).max(512).optional() }).strict() } } } },
  responses: {
    202: { content: { "application/json": { schema: z.object({ started: z.literal(true) }) } }, description: "The downloads were started again." },
    ...errorResponses({ 403: "Only an owner or admin may do this", 409: "The AI engine install could not be started" }),
  },
});
installRoutes.openapi(retryRoute, (c) => {
  if (!isOwnerOrAdmin(c.get("person"))) return c.json({ error: "Only an owner or admin can restart the install." }, 403);
  const body = c.req.valid("json" as never) as { vram_gb?: number } | undefined;
  if (body?.vram_gb) setMemoryAnswerGb(body.vram_gb);
  resetInstallStatusCache();
  // No Stack yet: Try again means install the engine first. The model
  // downloads start by themselves once it answers.
  if (engineNeedsInstall()) {
    const result = ensureEngineInstalling();
    if (result.cannotStart) return c.json({ error: result.error, next: result.next }, 409);
    return c.json({ started: true as const }, 202);
  }
  // startSetupDownloads falls back to the saved memory answer when none is given.
  void startSetupDownloads(getStackClient(), body?.vram_gb ? { vramGb: body.vram_gb } : {}).catch(() => {});
  return c.json({ started: true as const }, 202);
});

const planQuery = z.object({ vram_gb: z.coerce.number().int().min(1).max(512).optional() });
const planRoute = createRoute({
  method: "get", path: "/plan", tags: ["Install"], summary: "What Home would install on the AI computer now",
  middleware: [requireAuth] as const, request: { query: planQuery },
  responses: { 200: { content: { "application/json": { schema: z.object({ plan: z.unknown().nullable(), wording: z.object({
    level: z.enum(["recommended", "moderate", "minimal", "below_minimum", "unknown"]), headline: z.string(), detail: z.string(),
    gets: z.array(z.string()), needsMemoryAnswer: z.boolean(), sizeLine: z.string().nullable(), diskLine: z.string().nullable(),
  }) }) } }, description: "The Stack's plan and Home's words for it." } },
});
installRoutes.openapi(planRoute, async (c) => c.json(await previewPlan(c.req.valid("query").vram_gb), 200));

const startRoute = createRoute({
  method: "post", path: "/start", tags: ["Install"], summary: "Download the plan's AI models (change or add the AI)",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ vram_gb: z.number().int().min(1).max(512).optional() }).strict() } } } },
  responses: {
    202: { content: { "application/json": { schema: z.object({ started: z.literal(true), models: z.number() }) } }, description: "The downloads started in the background." },
    ...errorResponses({ 403: "Only an owner or admin may do this", 409: "There is nothing the AI can install on this computer" }),
  },
});
installRoutes.openapi(startRoute, async (c) => {
  if (!isOwnerOrAdmin(c.get("person"))) return c.json({ error: "Only an owner or admin can change the AI." }, 403);
  const result = await beginInstall(c.req.valid("json").vram_gb, false);
  if (!result.ok) return c.json({ error: result.error, next: result.next }, 409);
  return c.json({ started: true as const, models: result.models }, 202);
});
