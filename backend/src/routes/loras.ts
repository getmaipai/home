// VIDEO-LORA-03 (docs/dev/loras.md, docs/design/video-loras-2026-11-02.md sections 4 and 7): the household's LoRA library over the `Lora` records.
//   GET   /api/loras                 owner or admin: every style they may read (adult-only ones are one locked tile until their unlock proof is valid)
//   GET   /api/loras/available       anyone signed in: the styles THEY may use, for the Create and Edit pickers (a minor, a guest and a shared screen get nothing)
//   PATCH /api/loras/{id}            owner or admin: name, description, kind, availability, strength, trigger words, add-ins, base
//   POST  /api/loras/{id}/nsfw       owner or admin: mark adult-only (always allowed)
//   POST  /api/loras/{id}/all-ages   owner or admin: mark all-ages (the explicit click; a source can only raise)
//   POST  /api/loras/{id}/confirm    owner or admin: they have read the fingerprint and licence
//   POST  /api/loras/{id}/remove     owner or admin: to the 30-day trash;  POST .../restore brings it back
// Every read goes through lib/loras/access.ts (`readLoras`, `readLora`); a hidden or locked style answers an id route exactly like a missing one.
import { createRoute, z } from "@hono/zod-openapi";
import { getCookie } from "hono/cookie";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { consumeTicket, sessionKeyOf } from "@/lib/adultLock";
import { loraUsable, untestedLine, readLora, readLoras, type LoraSurface } from "@/lib/loras/access";
import { confirmLora, markAdultOnly, markAllAges, needsConfirmation, patchLora, removeLora, restoreLora } from "@/lib/loras/admin";
import { LoraWriteError, type Lora } from "@/lib/loras/store";
import { syncLoras } from "@/lib/loras/sync";
import { requestProof } from "@/lib/adultLock";
import { loraAllowsSuggesting } from "@maipai/spec/records/ts/validate.js";
import { suggestStyles } from "@/lib/loras/suggest";

export const lorasRoutes = apiRouter();

const NOT_HERE_LINE = "That style isn't in the library.";

/** A person's own written screen is a human browser session; a paired device (a TV, a robot) or a token is a shared surface. */
function surfaceOf(c: Parameters<Parameters<typeof lorasRoutes.openapi>[1]>[0]): LoraSurface {
  return sessionKeyOf(getCookie(c, "session")) ? "own_written" : "shared";
}

const Strength = z.object({ default: z.number(), min: z.number(), max: z.number() });
const AdminLoraSchema = z.object({
  id: z.string(), name: z.string(), kind: z.enum(["style", "character", "motion", "other"]), description: z.string(), media: z.enum(["video", "picture"]),
  base_model: z.string(), compatible_with: z.array(z.string()), usable: z.boolean(),
  base_note: z.string().nullable().describe("LTXD-18B: for an LTX-2.3 style that is not offered (untested on 2.5, or a test found no effect), the one plain line the library shows; else null."),
  tested_on_25: z.enum(["tested", "no_effect"]).nullable(),
  allow_suggesting: z.boolean(),
  trigger_words: z.array(z.string()), trigger_position: z.enum(["start", "end"]), positive_addins: z.array(z.string()), negative_addins: z.array(z.string()), avoid_as_positive: z.array(z.string()),
  strength: Strength, audience: z.enum(["all-ages", "adult-only"]), availability: z.object({ who: z.enum(["admins", "adults", "people"]), people: z.array(z.string()) }),
  needs_confirmation: z.boolean(), adult_check: z.enum(["normal", "unknown", "adult"]).describe("What the source said about age, once: evidence only; `audience` is the decision."), licence: z.object({ id: z.string().nullable(), commercial_use: z.string() }),
  file: z.object({ sha256: z.string(), bytes: z.number(), rank: z.number().nullable() }), source: z.object({ site: z.string(), url: z.string().nullable() }),
  preview_file_id: z.string().nullable(), added_at: z.string(), removed_at: z.string().nullable(), trash_until: z.string().nullable(),
});
const PersonLoraSchema = z.object({
  id: z.string(), name: z.string(), kind: z.enum(["style", "character", "motion", "other"]), description: z.string(), base_model: z.string(), usable: z.boolean(),
  trigger_words: z.array(z.string()), trigger_position: z.enum(["start", "end"]), positive_addins: z.array(z.string()), strength: Strength, preview_file_id: z.string().nullable(),
});
const Locked = z.object({ locked: z.boolean().describe("One tile for every locked style: no names, no count.") });

export function adminLoraView(l: Lora): z.infer<typeof AdminLoraSchema> {
  return {
    id: l.id, name: l.name, kind: l.kind, description: l.description, media: l.media, base_model: l.base_model, compatible_with: l.compatible_with, usable: loraUsable(l), base_note: untestedLine(l), tested_on_25: l.tested_on_25 ?? null, allow_suggesting: loraAllowsSuggesting(l),
    trigger_words: l.trigger_words, trigger_position: l.trigger_position, positive_addins: l.positive_addins, negative_addins: l.negative_addins, avoid_as_positive: l.avoid_as_positive,
    strength: l.strength, audience: l.audience, availability: l.availability, needs_confirmation: needsConfirmation(l), adult_check: l.adult_check?.state ?? "unknown", licence: { id: l.licence.id, commercial_use: l.licence.commercial_use },
    file: { sha256: l.file.sha256, bytes: l.file.bytes, rank: l.file.rank }, source: { site: l.source.site, url: l.source.url },
    preview_file_id: l.preview?.file_id ?? null, added_at: l.added_at, removed_at: l.removed_at, trash_until: l.trash_until,
  };
}
export function personLoraView(l: Lora): z.infer<typeof PersonLoraSchema> {
  return { id: l.id, name: l.name, kind: l.kind, description: l.description, base_model: l.base_model, usable: loraUsable(l), trigger_words: l.trigger_words, trigger_position: l.trigger_position, positive_addins: l.positive_addins, strength: l.strength, preview_file_id: l.preview?.file_id ?? null };
}

const idParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });

const listRoute = createRoute({
  method: "get", path: "/", tags: ["LoRAs"], summary: "The household's styles an owner or admin may read now", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { query: z.object({ removed: z.enum(["true", "false"]).optional(), media: z.enum(["video", "picture"]).optional() }) },
  responses: { 200: { content: { "application/json": { schema: Locked.extend({ items: z.array(AdminLoraSchema) }) } }, description: "Adult-only styles are one locked tile until the Adult lock is open." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only" }) },
});
lorasRoutes.openapi(listRoute, async (c) => {
  await syncLoras();
  const query = c.req.valid("query");
  const list = readLoras(c.get("person"), surfaceOf(c), { removed: query.removed === "true", ...(query.media ? { media: query.media } : {}) });
  return c.json({ items: list.items.map(adminLoraView), locked: list.locked }, 200);
});

const availableRoute = createRoute({
  method: "get", path: "/available", tags: ["LoRAs"], summary: "The styles this person may use in Create and Edit", middleware: [requireAuth] as const,
  request: { query: z.object({ media: z.enum(["video", "picture"]).optional() }) },
  responses: { 200: { content: { "application/json": { schema: Locked.extend({ items: z.array(PersonLoraSchema) }) } }, description: "Empty for a child, a teen, a guest or a shared screen." }, ...errorResponses({ 401: "Not signed in" }) },
});

const SuggestBody = z.object({ media: z.enum(["picture", "video"]), text: z.string().max(2000) });
const SuggestItem = z.object({ id: z.string(), name: z.string(), kind: z.enum(["style", "character", "motion", "other"]) });
const suggestRoute = createRoute({
  method: "post", path: "/suggest", tags: ["LoRAs"], summary: "Suggest styles from this person's prompt", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: SuggestBody } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ items: z.array(SuggestItem) }) } }, description: "Visible matching styles, with no locked style count." }, ...errorResponses({ 401: "Not signed in" }) },
});
lorasRoutes.openapi(suggestRoute, async (c) => {
  const { media, text } = c.req.valid("json");
  const result = suggestStyles({ person: c.get("person"), media, text, surface: surfaceOf(c), proof: requestProof() });
  return c.json({ items: result.items.map(({ id, name, kind }) => ({ id, name, kind })) }, 200);
});
lorasRoutes.openapi(availableRoute, async (c) => {
  await syncLoras();
  const { media } = c.req.valid("query");
  const list = readLoras(c.get("person"), surfaceOf(c), media ? { media } : {});
  return c.json({ items: list.items.map(personLoraView), locked: list.locked }, 200);
});

const Words = z.array(z.string().trim().min(1).max(120)).max(8);
const PatchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(140).optional(), kind: z.enum(["style", "character", "motion", "other"]).optional(),
  allow_suggesting: z.boolean().optional(),
  availability: z.object({ who: z.enum(["admins", "adults", "people"]), people: z.array(z.string().min(1).max(80)).max(64).optional() }).optional(),
  strength: z.object({ default: z.number().min(0).max(2).optional(), min: z.number().min(0).max(2).optional(), max: z.number().min(0).max(2).optional() }).optional(),
  trigger_words: z.array(z.string().trim().min(1).max(80)).max(12).optional(), trigger_position: z.enum(["start", "end"]).optional(),
  positive_addins: Words.optional(), negative_addins: Words.optional(), avoid_as_positive: Words.optional(),
  base_model: z.enum(["ltx-2.3", "ltx-2.5", "wan2.2-ti2v-5b", "unknown"]).optional(),
});

const ACTION_ERRORS = errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "No such style", 409: "That file is already in the library", 422: "A value is not allowed" });

/** The style as an admin may act on it now, or null (missing, hidden, or locked: all the same answer). */
function actable(c: Parameters<Parameters<typeof lorasRoutes.openapi>[1]>[0], id: string): Lora | null {
  const found = readLora(c.get("person"), id, surfaceOf(c));
  return found && found.state === "open" ? found.lora : null;
}
function failure(error: unknown): { body: { error: string }; status: 409 | 422 } {
  if (error instanceof LoraWriteError) return { body: { error: error.message }, status: error.code === "duplicate_file" ? 409 : 422 };
  throw error;
}

const patchRoute = createRoute({
  method: "patch", path: "/{id}", tags: ["LoRAs"], summary: "Change a style's name, availability, strength, trigger words or add-ins", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: idParams, body: { content: { "application/json": { schema: PatchBody } } } },
  responses: { 200: { content: { "application/json": { schema: AdminLoraSchema } }, description: "Updated." }, ...ACTION_ERRORS },
});
lorasRoutes.openapi(patchRoute, async (c) => {
  const { id } = c.req.valid("param");
  await syncLoras();
  if (!actable(c, id)) return c.json({ error: NOT_HERE_LINE }, 404) as never;
  try {
    const patch = c.req.valid("json");
    const saved = patchLora(c.get("person"), id, { ...patch, ...(patch.availability ? { availability: { who: patch.availability.who, people: patch.availability.people ?? [] } } : {}) });
    return c.json(adminLoraView(saved), 200);
  } catch (error) { const f = failure(error); return c.json(f.body, f.status) as never; }
});

function actionRoute(path: string, summary: string, run: (c: Parameters<typeof actable>[0], id: string) => Promise<Lora> | Lora, body?: z.ZodTypeAny) {
  const route = createRoute({
    method: "post", path, tags: ["LoRAs"], summary, middleware: [requireAuth, requireRole("owner", "admin")] as const,
    request: { params: idParams, ...(body ? { body: { content: { "application/json": { schema: body } } } } : {}) },
    responses: { 200: { content: { "application/json": { schema: AdminLoraSchema } }, description: "Done." }, ...ACTION_ERRORS },
  });
  // The five actions share one handler shape; the route's own types are checked by the createRoute above.
  lorasRoutes.openapi(route as never, (async (c: Parameters<typeof actable>[0] & { req: { valid: (k: string) => unknown } }) => {
    const { id } = c.req.valid("param") as { id: string };
    await syncLoras();
    if (!actable(c, id)) return c.json({ error: NOT_HERE_LINE }, 404) as never;
    try { return c.json(adminLoraView(await run(c, id)), 200) as never; } catch (error) { const f = failure(error); return c.json(f.body, f.status) as never; }
  }) as never);
}

actionRoute("/{id}/nsfw", "Mark a style adult-only (always allowed for an admin)", (c, id) => markAdultOnly(c.get("person"), id));
/** Lowering a style the source called adult needs a fresh passcode ticket for this style (`POST /api/adult-lock/confirm { action: "unmark", item: <style id> }`, design 15.1). From `unknown` the unlock the admin already holds is enough. */
export const LOWER_ADULT_LINE = "This style was marked adult by its source. Enter your passcode again to make it all ages.";
actionRoute("/{id}/all-ages", "Mark a style all-ages (an admin's explicit choice; needs confirm: true, and a fresh ticket when the source said adult)", (c, id) => {
  const found = readLora(c.get("person"), id, surfaceOf(c));
  const body = c.req.valid("json" as never) as { ticket?: string };
  if (found && found.state === "open" && found.lora.audience === "adult-only" && found.lora.adult_check?.state === "adult"
    && !consumeTicket(body.ticket, c.get("person").id, sessionKeyOf(getCookie(c, "session")), id)) throw new LoraWriteError("invalid", LOWER_ADULT_LINE);
  return markAllAges(c.get("person"), id);
}, z.object({ confirm: z.literal(true), ticket: z.string().max(200).optional() }));
actionRoute("/{id}/confirm", "An admin has read the fingerprint and licence", (c, id) => confirmLora(c.get("person"), id));
actionRoute("/{id}/remove", "Remove a style to the 30-day trash", (c, id) => removeLora(c.get("person"), id));
actionRoute("/{id}/restore", "Bring a removed style back", (c, id) => restoreLora(c.get("person"), id));
