import { createRoute, z } from "@hono/zod-openapi";
import { SongStyle } from "@maipai/spec/gen/ts/song-style.js";
import { MadeArtist } from "@maipai/spec/gen/ts/made-artist.js";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { BAND_ACTION_NAMES, runBandAction } from "@/lib/music/bandActions";
import { createMade, deleteMade, getMade, listMade, updateMade, type MadeKind, type StoreResult } from "@/lib/music/madeRecords";

// MUSIC-STUDIO-S2, MUSIC-LISTEN-C5: the saved song styles (/api/music/styles) and the bands the household made (/api/music/bands).
// Both are the spec records themselves (spec/schemas/song-style.schema.json and made-artist.schema.json); one factory builds both
// routers because the two differ only in the record shape and the id example. The rules for who may see and change a record live
// in lib/music/madeRecords.ts. Rule 6a: no handler logs a title, a name, a back story or the style words.

function makeRouter(kind: MadeKind, record: z.ZodTypeAny, tag: string, noun: string, idExample: string, writable: string) {
  const router = apiRouter();
  const Body = z.record(z.string(), z.unknown()).describe(`The ${noun}'s own fields: ${writable}. The server sets the id, owner, clock stamps and origin.`);
  const CreateBody = z.object({ person: z.string().nullable().optional().describe(`Whose ${noun}; defaults to you. A parent may make one for a child.`) }).catchall(z.unknown()).describe(Body.description ?? "");

  const list = createRoute({
    method: "get", path: "/", tags: [tag], summary: `List ${noun}s`, middleware: [requireAuth] as const,
    request: { query: z.object({ person: z.string().optional().describe("Whose; defaults to you. A parent may name a child."), scope: z.enum(["mine", "shared", "all"]).optional().describe("mine (default): the person's own. shared: others' shared with you, and starters. all: both.") }) },
    responses: { 200: { content: { "application/json": { schema: z.array(record) } }, description: `The live ${noun}s, newest change first.` }, ...errorResponses({ 401: "Sign in first", 404: "Person not found" }) },
  });
  const create = createRoute({
    method: "post", path: "/", tags: [tag], summary: `Save a ${noun}`, middleware: [requireAuth] as const,
    request: { body: { content: { "application/json": { schema: CreateBody } } } },
    responses: { 201: { content: { "application/json": { schema: record } }, description: `The new ${noun}.` }, ...errorResponses({ 400: "A field is missing or not valid, or the text is not allowed for a child or teen", 401: "Sign in first", 403: `A child's ${noun}s are made by a parent`, 404: "Person, file or library item not found" }) },
  });
  const one = createRoute({
    method: "get", path: "/{id}", tags: [tag], summary: `One ${noun}`, middleware: [requireAuth] as const, request: { params: idParamSchema("id", idExample) },
    responses: { 200: { content: { "application/json": { schema: record } }, description: `The ${noun}.` }, ...errorResponses({ 401: "Sign in first", 404: `${noun} not found` }) },
  });
  const patch = createRoute({
    method: "patch", path: "/{id}", tags: [tag], summary: `Change a ${noun}`, middleware: [requireAuth] as const,
    request: { params: idParamSchema("id", idExample), body: { content: { "application/json": { schema: Body } } } },
    responses: { 200: { content: { "application/json": { schema: record } }, description: `The changed ${noun}.` }, ...errorResponses({ 400: "Nothing to change, or a field is not valid", 401: "Sign in first", 403: `You can see it, not change it`, 404: `${noun} not found` }) },
  });
  const del = createRoute({
    method: "delete", path: "/{id}", tags: [tag], summary: `Delete a ${noun}`, middleware: [requireAuth] as const, request: { params: idParamSchema("id", idExample) },
    responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true), id: z.string() }) } }, description: "Deleted. The record stays marked deleted so a syncing client drops it." }, ...errorResponses({ 401: "Sign in first", 403: "You can see it, not delete it", 404: `${noun} not found` }) },
  });

  const fail = <T,>(r: Extract<StoreResult<T>, { ok: false }>) => ({ error: r.error });
  router.openapi(list, (c) => {
    const q = c.req.valid("query");
    const r = listMade(kind, c.get("person"), { person: q.person, scope: q.scope });
    return r.ok ? c.json(r.value as never, 200) : c.json(fail(r), 404);
  });
  router.openapi(create, (c) => {
    const { person, ...fields } = c.req.valid("json");
    const r = createMade(kind, c.get("person"), fields, person);
    return r.ok ? c.json(r.value as never, 201) : c.json(fail(r), r.status as 400 | 403 | 404);
  });
  router.openapi(one, (c) => {
    const r = getMade(kind, c.get("person"), c.req.valid("param").id);
    return r.ok ? c.json(r.value as never, 200) : c.json(fail(r), 404);
  });
  router.openapi(patch, (c) => {
    const r = updateMade(kind, c.get("person"), c.req.valid("param").id, c.req.valid("json"));
    return r.ok ? c.json(r.value as never, 200) : c.json(fail(r), r.status as 400 | 403 | 404);
  });
  router.openapi(del, (c) => {
    const r = deleteMade(kind, c.get("person"), c.req.valid("param").id);
    return r.ok ? c.json({ ok: true as const, id: r.value.id }, 200) : c.json(fail(r), r.status as 403 | 404);
  });
  return router;
}

export const songStylesRoutes = makeRouter("song_style", SongStyle, "Music styles", "song style", "sstyle-example123", "title, style, seed, shared_to");
export const madeArtistsRoutes = makeRouter("made_artist", MadeArtist, "Music bands", "band", "mband-example123", "name, backstory, genres, members, portrait_file_id, logo_file_id, style, seed, shared_to");

// MUSIC-LIKE-01: the band card's buttons. The card sends the band id and, for a new picture, the chat turn it was made in.
const BandAction = createRoute({
  method: "post", path: "/{id}/action", tags: ["Music bands"], summary: "Keep, remake or discard a band", middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "mband-example123"),
    body: { content: { "application/json": { schema: z.object({
      action: z.enum(BAND_ACTION_NAMES).describe("keep saves the band's finished single to Music. remake discards the band and returns the song to make a new one from. remake_portrait and remake_logo start a new picture. discard deletes the band."),
      conversation_id: z.string().nullable().optional().describe("For remake_portrait and remake_logo: the chat the band card is in."),
      turn_id: z.string().nullable().optional().describe("For remake_portrait and remake_logo: the turn the band card is in."),
    }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ action: z.enum(BAND_ACTION_NAMES), done: z.string().describe("One plain sentence for the person."), media_id: z.string().nullable().optional().describe("keep: the saved track, when its single is ready."), seed_media_id: z.string().nullable().optional().describe("remake: the song to make the new band from."), pending: z.boolean().optional().describe("keep: the single is not finished yet.") }) } }, description: "Done." },
    ...errorResponses({ 400: "That action cannot run for this band", 401: "Sign in first", 403: "Only the band's owner can do that", 404: "Band not found" }),
  },
});
madeArtistsRoutes.openapi(BandAction, async (c) => {
  const body = c.req.valid("json");
  const r = await runBandAction(c.get("person"), c.req.valid("param").id, body.action, { conversationId: body.conversation_id ?? null, turnId: body.turn_id ?? null });
  if (!r.ok) return c.json({ error: r.error }, r.status);
  const { mediaId, seedMediaId, ...rest } = r.value;
  return c.json({ ...rest, ...(mediaId !== undefined ? { media_id: mediaId } : {}), ...(seedMediaId !== undefined ? { seed_media_id: seedMediaId } : {}) }, 200);
});
