// STACK-LORAS-01 slice 4 (docs/plans/stack-owns-loras-2026-11-25.md): `/api/loras/stack/*`, Home's pass-through for the shared Styles page (`@maipai/ui`
// `StackLorasPage`). The Stack holds the library, the sources and the installs; this stores nothing and sends nothing outbound itself. In front of every call
// stand Home's own gates: an adult owner or admin, on a screen of their own for anything that shows a style, and the Adult lock for any adult-only one.
//   GET    /stack                       the library as this person may read it: an adult-only style is ONE locked tile (no name, id or count) until their unlock proof is valid
//   PATCH  /stack/{id}                  name, words, strength, audience (lowering carries the adult-lock ticket the Stack then uses up through Home)
//   DELETE /stack/{id}[?purge=true]     to the 30-day trash, or for good
//   POST   /stack/{id}/restore, /move   back from the trash; to another drive (a job)
//   POST   /stack/install               download from Hugging Face or Civitai (needs the one licence accept at the Stack)
//   GET    /stack/sources, PUT /stack/sources/{site}/key, GET /stack/sources/{site}/search   the two sources, their keys (write only), browsing
//   GET    /stack/{id}/preview, GET /stack/jobs/{id}
// An id route answers 404 for a hidden, locked or missing style alike. A Stack that cannot be read answers 503 with the Stack's sentence and shows nothing.
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { requestProof, sessionKeyOf, unlockedFor } from "@/lib/adultLock";
import { isOwnerOrAdmin } from "@/lib/access";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { loraAccess, readLora, type LoraSurface } from "@/lib/loras/access";
import { callStack, getLoraRecord, listStackViews, LorasStackError, refreshLoras, stackPreview, type StackLoraView } from "@/lib/loras/stackLibrary";
import { lowerToAllAges, markAdultOnly, patchLoraOnStack, purgeLora, removeLora, restoreLora, NOT_HERE_LINE } from "@/lib/loras/stackAdmin";
import type { PersonRow } from "@/types";

export const lorasSourceRoutes = apiRouter();

const NOT_ADULT_LINE = "Only an adult owner or admin can change styles.";
const OWN_SCREEN_LINE = "Open Styles on your own screen to see or change them.";
const Any = z.record(z.string(), z.unknown());
const idParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const siteParams = z.object({ site: z.enum(["huggingface", "civitai"]).openapi({ param: { name: "site", in: "path" } }) });
const refusals = errorResponses({ 401: "Not signed in", 403: "Adult owners and admins only", 404: "No such style", 409: "Not allowed right now", 422: "A value is not allowed", 429: "Too many searches", 503: "The engine is not answering" });
const ok = (description: string) => ({ 200: { content: { "application/json": { schema: Any } }, description }, ...refusals });
const body = <T extends z.ZodTypeAny>(schema: T) => ({ required: true as const, content: { "application/json": { schema } } });

type Ctx = Context;
const person = (c: Ctx): PersonRow => c.get("person") as PersonRow;
/** A person's own written screen is a human browser session; a paired device (a TV, a robot) or a token is a shared surface. */
const surfaceOf = (c: Ctx): LoraSurface => (sessionKeyOf(getCookie(c, "session")) ? "own_written" : "shared");
const refuse = (c: Ctx, error: unknown): Response => {
  if (error instanceof LorasStackError) {
    const status = ([400, 401, 403, 404, 409, 422, 429] as const).find((s) => s === error.status) ?? 503;
    return c.json({ error: error.message, code: error.code }, status as never);
  }
  throw error;
};
const denied = (c: Ctx): Response | null => (laneOfPerson(person(c)) === "adult" ? null : c.json({ error: NOT_ADULT_LINE, code: "adult_only" }, 403));
const notHere = (c: Ctx): Response => c.json({ error: NOT_HERE_LINE, code: "unknown_lora" }, 404);

/** Everything but the spec record Home sent on import: that is Home's own copy of the shape, not for a page. */
const outward = (view: StackLoraView): Omit<StackLoraView, "home"> => { const { home: _home, ...rest } = view; return rest; };

/** The style as this admin may act on it now, or false (missing, hidden and locked answer alike). Reads the library first. */
async function actable(c: Ctx, id: string): Promise<boolean> {
  await refreshLoras();
  const found = readLora(person(c), id, surfaceOf(c));
  return found !== null && found.state === "open";
}
const viewAfter = (id: string): Omit<StackLoraView, "home"> | null => { const view = listStackViews().find((v) => v.id === id); return view ? outward(view) : null; };

lorasSourceRoutes.openapi(createRoute({
  method: "get", path: "/stack", tags: ["LoRAs"], summary: "The Stack's styles as this person may read them", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { query: z.object({ removed: z.enum(["true", "false"]).optional() }) },
  responses: ok("An adult-only style the person may not open is one `{ locked: true }` tile."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  if (!(await refreshLoras())) return c.json({ error: "The engine isn't answering, so styles can't be shown. Check that the engine is running, then try again.", code: "unreachable" }, 503) as never;
  const trash = c.req.valid("query").removed === "true";
  const who = person(c);
  const surface = surfaceOf(c);
  const loras: Array<Omit<StackLoraView, "home"> | { locked: true }> = [];
  let locked = false;
  for (const view of listStackViews()) {
    if ((view.removed_at !== null) !== trash) continue;
    const lora = getLoraRecord(view.id);
    if (!lora) continue;
    const access = loraAccess(who, lora, surface);
    if (access === "open") loras.push(outward(view));
    else if (access === "locked") locked = true;
  }
  if (locked) loras.push({ locked: true });
  return c.json({ loras, trash_days: 30 }, 200) as never;
});

lorasSourceRoutes.openapi(createRoute({
  method: "patch", path: "/stack/{id}", tags: ["LoRAs"], summary: "Edit a style (lowering to all-ages carries the adult-lock ticket)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: idParams, body: body(z.object({ name: z.string().trim().min(1).max(80).optional(), classification: z.enum(["all-ages", "adult-only"]).optional(), strength_default: z.number().min(0).max(2).optional(), trigger_words: z.array(z.string().trim().min(1).max(80)).max(12).optional(), source_url: z.string().max(2048).nullable().optional(), ticket: z.string().max(200).optional() })) },
  responses: ok("The style as it stands."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  const { id } = c.req.valid("param");
  if (!(await actable(c, id))) return notHere(c) as never;
  const patch = c.req.valid("json");
  const admin = person(c);
  try {
    const { classification, ticket, strength_default, ...rest } = patch;
    if (Object.keys(rest).length > 0 || strength_default !== undefined) await patchLoraOnStack(admin, id, { ...rest, ...(strength_default !== undefined ? { strength: { default: strength_default } } : {}) });
    if (classification === "adult-only") await markAdultOnly(admin, id);
    if (classification === "all-ages") await lowerToAllAges(admin, id, sessionKeyOf(getCookie(c, "session")), ticket);
    await refreshLoras(true);
    const view = viewAfter(id);
    return view ? c.json(view, 200) as never : notHere(c) as never;
  } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({
  method: "delete", path: "/stack/{id}", tags: ["LoRAs"], summary: "Move a style to the 30-day trash, or delete it for good with purge=true", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: idParams, query: z.object({ purge: z.enum(["true", "false"]).optional() }) }, responses: ok("Done."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  const { id } = c.req.valid("param");
  if (!(await actable(c, id))) return notHere(c) as never;
  const purge = c.req.valid("query").purge === "true";
  try { if (purge) await purgeLora(person(c), id); else await removeLora(person(c), id); return c.json({ ok: true, purged: purge }, 200) as never; } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({
  method: "post", path: "/stack/{id}/restore", tags: ["LoRAs"], summary: "Bring a style back from the trash", middleware: [requireAuth, requireRole("owner", "admin")] as const, request: { params: idParams }, responses: ok("Restored."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  const { id } = c.req.valid("param");
  if (!(await actable(c, id))) return notHere(c) as never;
  try { await restoreLora(person(c), id); const view = viewAfter(id); return view ? c.json(view, 200) as never : notHere(c) as never; } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({
  method: "post", path: "/stack/{id}/move", tags: ["LoRAs"], summary: "Move a style's file to another drive (a Stack job)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: idParams, body: body(z.object({ disk_id: z.string().min(1).max(120) })) }, responses: ok("A `lora.move` job started."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  const { id } = c.req.valid("param");
  if (!(await actable(c, id))) return notHere(c) as never;
  try { const out = await callStack("POST", `/stack/v1/loras/${encodeURIComponent(id)}/move`, c.req.valid("json")); return c.json(out.body as never, 202 as never) as never; } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({
  method: "post", path: "/stack/install", tags: ["LoRAs"], summary: "Download a style from Hugging Face or Civitai (a Stack job)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { body: body(z.object({ media: z.enum(["picture", "video"]), source: z.enum(["huggingface", "civitai"]), url: z.string().min(1).max(2048), name: z.string().trim().min(1).max(80), licence: z.string().max(200).optional(), audience: z.enum(["all-ages", "adult-only"]).optional(), strength_default: z.number().min(0).max(2).optional(), trigger_words: z.array(z.string().max(80)).max(12).optional(), disk_id: z.string().max(120).nullable().optional(), sha256: z.string().max(64).optional(), source_url: z.string().max(2048).optional(), base_model: z.string().max(80).nullable().optional() })) },
  responses: ok("A download job started."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  if (surfaceOf(c) !== "own_written") return c.json({ error: OWN_SCREEN_LINE, code: "own_screen" }, 403) as never;
  try {
    // The adder is the signed-in admin, never a value from the page. An uncertain audience is the Stack's to decide; a person's explicit choice rides along.
    const out = await callStack("POST", "/stack/v1/loras/install", { ...c.req.valid("json"), added_by: person(c).id });
    return c.json(out.body as never, 202 as never) as never;
  } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({ method: "get", path: "/stack/sources", tags: ["LoRAs"], summary: "The two sources and whether a key is saved (never the key)", middleware: [requireAuth, requireRole("owner", "admin")] as const, responses: ok("Sources.") }), async (c) => {
  const no = denied(c); if (no) return no as never;
  try { return c.json((await callStack("GET", "/stack/v1/loras/sources")).body as never, 200) as never; } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({
  method: "put", path: "/stack/sources/{site}/key", tags: ["LoRAs"], summary: "Save a Hugging Face token or Civitai key at the Stack (null removes it)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: siteParams, body: body(z.object({ key: z.string().max(400).nullable() })) }, responses: ok("Saved. The key is never returned."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  try { return c.json((await callStack("PUT", `/stack/v1/loras/sources/${c.req.valid("param").site}/key`, c.req.valid("json"))).body as never, 200) as never; } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({
  method: "get", path: "/stack/sources/{site}/search", tags: ["LoRAs"], summary: "Search a source (an adult hit is shown only with the Adult lock open)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: siteParams, query: z.object({ q: z.string().max(200) }) }, responses: ok("Hits."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  try {
    const out = await callStack("GET", `/stack/v1/loras/sources/${c.req.valid("param").site}/search?q=${encodeURIComponent(c.req.valid("query").q)}`);
    const hits = ((out.body as { hits?: Array<{ audience_hint?: string }> }).hits ?? []);
    // An adult-leaning hit (and one the source did not say anything about) is listed only on the person's own screen with a live unlock proof.
    const reveal = surfaceOf(c) === "own_written" && unlockedFor(person(c), requestProof());
    return c.json({ hits: hits.filter((hit) => hit.audience_hint === "all-ages" || reveal) } as never, 200) as never;
  } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({
  method: "get", path: "/stack/jobs/{id}", tags: ["LoRAs"], summary: "Progress of a style install or move", middleware: [requireAuth, requireRole("owner", "admin")] as const, request: { params: z.object({ id: z.string().min(1).max(120).openapi({ param: { name: "id", in: "path" } }) }) }, responses: ok("The job's state and progress."),
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  try {
    const job = (await callStack("GET", `/stack/v1/jobs/${encodeURIComponent(c.req.valid("param").id)}`)).body as Record<string, unknown>;
    return c.json({ id: job.id, state: job.state, percent: job.percent, status: job.status, reason: job.reason ?? null } as never, 200) as never;
  } catch (error) { return refuse(c, error) as never; }
});

lorasSourceRoutes.openapi(createRoute({
  method: "get", path: "/stack/{id}/preview", tags: ["LoRAs"], summary: "A style's preview picture (404 for a hidden, locked or missing style)", middleware: [requireAuth, requireRole("owner", "admin")] as const, request: { params: idParams },
  responses: { 200: { content: { "image/png": { schema: z.string().openapi({ format: "binary" }) } }, description: "The picture." }, ...refusals },
}), async (c) => {
  const no = denied(c); if (no) return no as never;
  const { id } = c.req.valid("param");
  if (!(await actable(c, id)) || !isOwnerOrAdmin(person(c))) return notHere(c) as never;
  const picture = await stackPreview(id);
  if (!picture) return notHere(c) as never;
  return new Response(picture.bytes, { status: 200, headers: { "content-type": picture.contentType, "cache-control": "private, max-age=60" } }) as never;
});
