// The install after (and during) setup: what is downloading, what has
// landed, and a retry. The wizard reads the same summary through
// `GET /api/setup/install` before an owner exists.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { autoInstallOnUpgrade, acceptLicences, installRecommendedExtras, licenceOverview } from "@/lib/licenceFlow";
import { syncLicenceIssue } from "@/lib/licenceRepair";
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
  background: z.object({
    state: z.enum(["running", "stalled"]), label: z.string(), percent: z.number().int().min(0).max(100), completedBytes: z.number(), totalBytes: z.number(),
    bytesPerSecond: z.number().nullable(), etaSeconds: z.number().nullable(), count: z.number().int(),
  }).nullable().openapi({ description: "Parts installed later from Settings (Models and storage) that are still downloading. Never gates chat or voice." }),
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
    gets: z.array(z.string()), needsMemoryAnswer: z.boolean(), sizeLine: z.string().nullable(), diskLine: z.string().nullable(), disk: z.unknown().nullable(),
  }) }) } }, description: "The Stack's plan and Home's words for it." } },
});
installRoutes.openapi(planRoute, async (c) => c.json(await previewPlan(c.req.valid("query").vram_gb), 200));

const startRoute = createRoute({
  method: "post", path: "/start", tags: ["Install"], summary: "Download the plan's AI models (change or add the AI)",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ vram_gb: z.number().int().min(1).max(512).optional(), accepted_licences: z.array(z.string().max(120)).max(8).optional().openapi({ description: "Ids of the licence notices the person read and accepted for licensed rows (Detailed video). A licensed row left on without its accept is refused." }), components: z.array(z.string()).optional().openapi({ description: "The disk plan rows to install; omitted means the plan's defaults." }) }).strict() } } } },
  responses: {
    202: { content: { "application/json": { schema: z.object({ started: z.literal(true), models: z.number() }) } }, description: "The downloads started in the background." },
    ...errorResponses({ 403: "Only an owner or admin may do this", 409: "There is nothing the AI can install on this computer" }),
  },
});
installRoutes.openapi(startRoute, async (c) => {
  if (!isOwnerOrAdmin(c.get("person"))) return c.json({ error: "Only an owner or admin can change the AI." }, 403);
  const body = c.req.valid("json");
  const result = await beginInstall(body.vram_gb, false, body.components, body.accepted_licences);
  if (!result.ok) return c.json({ error: result.error, next: result.next }, 409);
  return c.json({ started: true as const, models: result.models }, 202);
});

// LICENCE-ACK-01: the household's licence acknowledgement for installs that never saw the wizard item (the one admin prompt),
// and the one button that installs the recommended extras after it. Owner and admin only.
const licenceBody = z.object({ stack: z.enum(["ok", "unreachable"]), terms_version: z.string(), acknowledged: z.unknown().nullable(), needs_prompt: z.boolean(), licences: z.array(z.unknown()), extras: z.unknown().nullable() });
const licencesRoute = createRoute({
  method: "get", path: "/licences", tags: ["Install"], summary: "The licences of the AI parts Home installs, and whether the household accepted them",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: licenceBody } }, description: "Each licensed part with its terms, the household acknowledgement, and whether to show the one admin prompt." }, ...errorResponses({ 403: "Only an owner or admin may do this" }) },
});
installRoutes.openapi(licencesRoute, async (c) => {
  if (!isOwnerOrAdmin(c.get("person"))) return c.json({ error: "Only an owner or admin can see the licences." }, 403);
  await syncLicenceIssue().catch(() => undefined);
  return c.json(await licenceOverview(), 200);
});
const acceptRoute = createRoute({
  method: "post", path: "/licences/accept", tags: ["Install"], summary: "Accept the licences of the AI parts Home installs, once for the household",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ accepted: z.literal(true), auto_install: z.boolean() }) } }, description: "Recorded. When the household policy install.recommended_auto_on_upgrade is on, the recommended extras start too." }, ...errorResponses({ 403: "Only an owner or admin may do this", 409: "Home could not read the licence list" }) },
});
installRoutes.openapi(acceptRoute, async (c) => {
  const person = c.get("person");
  if (!isOwnerOrAdmin(person)) return c.json({ error: "Only an owner or admin can accept the licences." }, 403);
  const result = await acceptLicences(person.id);
  if (!result.ok) return c.json({ error: result.error, next: result.next }, 409);
  await syncLicenceIssue().catch(() => undefined);
  let auto = false;
  if (autoInstallOnUpgrade()) auto = (await installRecommendedExtras()).ok;
  return c.json({ accepted: true as const, auto_install: auto }, 200);
});
const extrasRoute = createRoute({
  method: "post", path: "/licences/install-extras", tags: ["Install"], summary: "Install the recommended extras (after the licences are accepted)",
  middleware: [requireAuth] as const,
  responses: { 202: { content: { "application/json": { schema: z.object({ started: z.literal(true), models: z.number() }) } }, description: "The downloads started; the install strip shows progress." }, ...errorResponses({ 403: "Only an owner or admin may do this", 409: "Not accepted yet, no room, or the engine is not ready (the message says which)" }) },
});
installRoutes.openapi(extrasRoute, async (c) => {
  if (!isOwnerOrAdmin(c.get("person"))) return c.json({ error: "Only an owner or admin can install the extras." }, 403);
  const result = await installRecommendedExtras();
  if (!result.ok) return c.json({ error: result.error, next: result.next }, 409);
  return c.json({ started: true as const, models: result.models }, 202);
});
