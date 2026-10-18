// COMPONENTS-01: Settings, Engines and AI, Models and storage. The Stack's installable parts as rows (size,
// state, what uses it), with Install and Uninstall. Owner and admin only: a child, a teen or a plain adult never
// installs or removes anything. The Stack decides what cannot be removed (the chat model chat is using, the only
// chat model, a part Home needs on this computer, anything in use) and says why in a sentence; Home passes it on.
// A household LoRA is also removed from Home's own switches so no dangling preference stays behind.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { installStackComponent, listStackComponents, StackComponentError, uninstallStackComponent } from "@/lib/stackComponents";
import { licenceCovered } from "@/lib/licenceAcceptance";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { dropPictureStatusCache } from "@/lib/pictures/ready";
import { dropAdapterCache, forgetAdapterPref } from "@/lib/pictures/adapters";
import { dropVideoAdapterCache, forgetVideoAdapterPref } from "@/lib/videos/adapters";
import { dropVideoStatusCache } from "@/lib/videos/ready";
import { dropMusicStatusCache } from "@/lib/music/ready";

export const componentsRoutes = apiRouter();

const ComponentSchema = z.object({
  id: z.string(), label: z.string(), summary: z.string(), group: z.enum(["chat", "voice", "pictures", "video", "music", "tools", "loras"]), kind: z.enum(["model", "lora"]),
  state: z.enum(["installed", "installing", "notInstalled", "failed"]),
  size_bytes: z.number().nullable(), download_bytes: z.number(), full_bytes: z.number(), required_free_bytes: z.number(),
  plan_need: z.enum(["required", "recommended", "optional"]).nullable(), requirement: z.enum(["required", "optional", "unsupported"]), requirement_reason: z.string().nullable(),
  last_used_at: z.string().nullable(), used_by: z.array(z.string()), depends_on: z.array(z.string()),
  job: z.string().nullable(), percent: z.number().nullable(), failure: z.string().nullable(),
  licence: z.object({ id: z.string(), name: z.string(), url: z.string(), summary: z.array(z.string()), accepted_at: z.string().nullable(), covered: z.boolean().optional() }).nullable().optional().describe("A licence with terms of its own (the Detailed video model). An admin accepts it once before the first install: send its `id` as `accepted_licence` with the install."),
  can_install: z.boolean(), install_block: z.string().nullable(), can_uninstall: z.boolean(), uninstall_block: z.string().nullable(),
});
const ListSchema = z.object({
  stack: z.enum(["ok", "unreachable"]), message: z.string().nullable(),
  tier: z.string().nullable(), free_disk_bytes: z.number().nullable(), disk_margin_bytes: z.number(), installed_bytes: z.number(), components: z.array(ComponentSchema),
});
const idParams = z.object({ id: z.string().min(1).max(200) });
const refusals = errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "No such component", 409: "It cannot be installed or removed right now (the message says why)", 503: "The engine is not answering" });

function failure(c: { json: (body: unknown, status: never) => Response }, error: unknown): Response {
  if (error instanceof StackComponentError) {
    const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 503;
    return c.json({ error: error.message, code: error.code }, status as never);
  }
  throw error;
}

const listRoute = createRoute({
  method: "get", path: "/", tags: ["Components"], summary: "Every installable part of the AI, its size and state", middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: ListSchema } }, description: "The Stack's component list. With the engine unreachable the list is empty and `message` says what to do." }, ...refusals },
});
componentsRoutes.openapi(listRoute, async (c) => {
  try {
    const list = await listStackComponents();
    // LICENCE-ACK-01: a licence the household's acknowledgement covers is information, not a gate.
    const components = list.components.map((part) => part.licence ? { ...part, licence: { ...part.licence, covered: licenceCovered(part.licence.id) } } : part);
    return c.json({ stack: "ok" as const, message: null, ...list, components }, 200);
  } catch (error) {
    if (error instanceof StackComponentError) return c.json({ stack: "unreachable" as const, message: error.message, tier: null, free_disk_bytes: null, disk_margin_bytes: 0, installed_bytes: 0, components: [] }, 200);
    throw error;
  }
});

const installRoute = createRoute({
  method: "post", path: "/{id}/install", tags: ["Components"], summary: "Download and set up a part (progress on the install strip)", middleware: [requireRole("owner", "admin")] as const,
  request: { params: idParams, body: { required: false, content: { "application/json": { schema: z.object({ accepted_licence: z.string().max(120).optional().describe("The id of the licence notice the admin read and accepted (the component's `licence.id`). Needed once, for a part that has one.") }) } } } },
  responses: { 202: { content: { "application/json": { schema: z.object({ job: z.string(), component: z.string() }) } }, description: "Started, or already running." }, 200: { content: { "application/json": { schema: z.object({ job: z.null(), component: z.string() }) } }, description: "Already installed." }, ...refusals },
});
componentsRoutes.openapi(installRoute, async (c) => {
  try {
    const consent = (await c.req.json().catch(() => ({}))) as { accepted_licence?: unknown };
    const person = c.get("person") as { id?: string } | undefined;
    const started = await installStackComponent(c.req.valid("param").id, typeof consent.accepted_licence === "string" ? { acceptedLicence: consent.accepted_licence, ...(person?.id ? { acceptedBy: person.id } : {}) } : {});
    resetInstallStatusCache();
    return started.job ? c.json({ job: started.job, component: started.component }, 202) : c.json({ job: null, component: started.component }, 200);
  } catch (error) { return failure(c, error) as never; }
});

const removeRoute = createRoute({
  method: "delete", path: "/{id}", tags: ["Components"], summary: "Remove a part and free its space", middleware: [requireRole("owner", "admin")] as const,
  request: { params: idParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ component: z.string(), freed_bytes: z.number(), removed: z.boolean() }) } }, description: "Removed, with the bytes freed." }, ...refusals },
});
componentsRoutes.openapi(removeRoute, async (c) => {
  const { id } = c.req.valid("param");
  try {
    const removed = await uninstallStackComponent(id);
    // A style leaves Home's household switches with its file.
    const lora = /^lora\.(picture|video)\.(.+)$/.exec(id);
    if (lora && removed.removed) {
      if (lora[1] === "picture") { forgetAdapterPref(lora[2]!); dropAdapterCache(); } else { forgetVideoAdapterPref(lora[2]!); dropVideoAdapterCache(); }
    }
    // Picture and video readiness are read from the Stack; the next read sees the part gone.
    dropPictureStatusCache();
    dropVideoStatusCache();
    dropMusicStatusCache();
    resetInstallStatusCache();
    return c.json(removed, 200);
  } catch (error) { return failure(c, error) as never; }
});
