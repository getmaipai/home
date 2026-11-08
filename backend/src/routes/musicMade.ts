import { createRoute, z } from "@hono/zod-openapi";
import { SongStyle } from "@maipai/spec/gen/ts/song-style.js";
import { MadeArtist } from "@maipai/spec/gen/ts/made-artist.js";
import { apiRouter, errorResponses, idParamSchema, respond } from "@/lib/openapi";
import { requireAuth, requireRoleOrGrant } from "@/middleware/auth";
import { MadeAlbum } from "@maipai/spec/gen/ts/made-album.js";
import { BAND_ACTION_NAMES, runBandAction } from "@/lib/music/bandActions";
import { ALBUM_ACTION_NAMES, runAlbumAction, syncAlbumTracks } from "@/lib/music/album";
import { STYLE_ACTION_NAMES, runStyleAction, styleBlock } from "@/lib/music/styleCard";
import { bandBlockFromRecord } from "@/lib/music/band";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { albumBlock } from "@/lib/music/album";
import { createMade, deleteMade, getMade, listMade, listRevisions, restoreRevision, updateMade, type MadeKind, type StoreResult } from "@/lib/music/madeRecords";
import { laneOf } from "@/lib/pictures/lane";
import { routeAudience } from "@/lib/pictures/audience";
const ADULT_MUSIC_ONLY_LINE = "You can change only your own song from this chat.";
const adultMadeMiddleware = [requireAuth, async (c: import("hono").Context, next: () => Promise<void>) => {
  if (laneOf(routeAudience(c.get("person"))) !== "adult") return c.json({ error: ADULT_MUSIC_ONLY_LINE }, 403);
  await next();
}];

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
    method: "post", path: "/", tags: [tag], summary: `Save a ${noun}`, middleware: kind === "song_style" ? [requireAuth] : adultMadeMiddleware,
    request: { body: { content: { "application/json": { schema: CreateBody } } } },
    responses: { 201: { content: { "application/json": { schema: record } }, description: `The new ${noun}.` }, ...errorResponses({ 400: "A field is missing or not valid, or the text is not allowed for a child or teen", 401: "Sign in first", 403: `A child's ${noun}s are made by a parent`, 404: "Person, file or library item not found" }) },
  });
  const one = createRoute({
    method: "get", path: "/{id}", tags: [tag], summary: `One ${noun}`, middleware: [requireAuth] as const, request: { params: idParamSchema("id", idExample) },
    responses: { 200: { content: { "application/json": { schema: record } }, description: `The ${noun}.` }, ...errorResponses({ 401: "Sign in first", 404: `${noun} not found` }) },
  });
  const patch = createRoute({
    method: "patch", path: "/{id}", tags: [tag], summary: `Change a ${noun}`, middleware: kind === "song_style" ? [requireAuth] : adultMadeMiddleware,
    request: { params: idParamSchema("id", idExample), body: { content: { "application/json": { schema: Body } } } },
    responses: { 200: { content: { "application/json": { schema: record } }, description: `The changed ${noun}.` }, ...errorResponses({ 400: "Nothing to change, or a field is not valid", 401: "Sign in first", 403: `You can see it, not change it`, 404: `${noun} not found` }) },
  });
  const del = createRoute({
    method: "delete", path: "/{id}", tags: [tag], summary: `Delete a ${noun}`, middleware: kind === "song_style" ? [requireAuth] : adultMadeMiddleware, request: { params: idParamSchema("id", idExample) },
    responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true), id: z.string() }) } }, description: "Deleted. The record stays marked deleted so a syncing client drops it." }, ...errorResponses({ 401: "Sign in first", 403: "You can see it, not delete it", 404: `${noun} not found` }) },
  });

  const revisions = createRoute({
    method: "get", path: "/{id}/revisions", tags: [tag], summary: `Earlier versions of a ${noun}`, middleware: [requireAuth] as const, request: { params: idParamSchema("id", idExample) },
    responses: { 200: { content: { "application/json": { schema: z.array(z.object({ id: z.string(), reason: z.enum(["edit", "remake"]), created_at: z.string(), provenance: z.string(), record: z.record(z.string(), z.unknown()) })) } }, description: "The earlier versions, newest first. An edit or a remake keeps the version it replaces." }, ...errorResponses({ 401: "Sign in first", 403: "You can see it, not its earlier versions", 404: `${noun} not found` }) },
  });
  const restore = createRoute({
    method: "post", path: "/{id}/revisions/{revision}/restore", tags: [tag], summary: `Put an earlier version of a ${noun} back`, middleware: [requireAuth] as const,
    request: { params: z.object({ id: z.string().describe(`The ${noun}'s id.`).openapi({ example: idExample }), revision: z.string().describe("A revision id from the list.").openapi({ example: "mrev-example123" }) }) },
    responses: { 200: { content: { "application/json": { schema: record } }, description: `The ${noun} as it was. The version replaced is kept too.` }, ...errorResponses({ 400: "That version cannot be put back", 401: "Sign in first", 403: "You can see it, not change it", 404: "Not found" }) },
  });

  const card = createRoute({
    method: "get", path: "/{id}/card", tags: [tag], summary: `The ${noun}'s card as it is now`, middleware: [requireAuth] as const,
    request: { params: idParamSchema("id", idExample), query: z.object({ conversation_id: z.string().optional(), turn_id: z.string().optional() }) },
    responses: { 200: { content: { "application/json": { schema: z.object({ block: z.record(z.string(), z.unknown()).describe("The answer block the chat and the Music app draw: its props are the card's props. Pictures and finished songs are filled in."), cover_state: z.enum(["ready", "pending", "no_engine"]).optional().describe("Albums only. ready: the cover is on the card. pending: a cover may still arrive. no_engine: none will, because no picture engine is set up.") }) } }, description: `The ${noun}'s card. Someone who is not its owner gets it read-only. An album with no cover also says whether one can still come: cover_state is no_engine when no picture engine is set up.` }, ...errorResponses({ 401: "Sign in first", 404: `${noun} not found` }) },
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
    // An album lists the songs made for it that have finished since it was last read.
    if (kind === "made_album") syncAlbumTracks(c.get("person"), c.req.valid("param").id);
    const r = getMade(kind, c.get("person"), c.req.valid("param").id);
    return r.ok ? c.json(r.value as never, 200) : c.json(fail(r), 404);
  });
  router.openapi(card, async (c) => {
    const actor = c.get("person");
    if (kind === "made_album") syncAlbumTracks(actor, c.req.valid("param").id);
    const r = getMade(kind, actor, c.req.valid("param").id);
    if (!r.ok) return c.json(fail(r), 404);
    const q = c.req.valid("query");
    const where = { conversationId: q.conversation_id ?? null, turnId: q.turn_id ?? null };
    const rec = r.value as unknown as { owner_person_id: string | null };
    const block = (kind === "made_artist" ? bandBlockFromRecord(r.value as never, where) : kind === "made_album" ? albumBlock(actor, r.value as never, where) : styleBlock(r.value as never, where)) as { props: Record<string, unknown> };
    if ((kind !== "song_style" || rec.owner_person_id !== null) && rec.owner_person_id !== actor.id) block.props = { ...block.props, editable: false, actions: kind === "made_album" ? ["play_all"] : kind === "song_style" ? ["make_song"] : [] };
    const coverState: "ready" | "pending" | "no_engine" | undefined = kind === "made_album" ? (block.props.cover ? "ready" : (await pictureEngineReady()) ? "pending" : "no_engine") : undefined;
    return c.json({ block: block as Record<string, unknown>, ...(coverState ? { cover_state: coverState } : {}) }, 200);
  });
  router.openapi(patch, (c) => {
    const r = updateMade(kind, c.get("person"), c.req.valid("param").id, c.req.valid("json"));
    return r.ok ? c.json(r.value as never, 200) : c.json(fail(r), r.status as 400 | 403 | 404);
  });
  router.openapi(del, (c) => {
    const r = deleteMade(kind, c.get("person"), c.req.valid("param").id);
    return r.ok ? c.json({ ok: true as const, id: r.value.id }, 200) : c.json(fail(r), r.status as 403 | 404);
  });
  router.openapi(revisions, (c) => {
    const r = listRevisions(kind, c.get("person"), c.req.valid("param").id);
    return r.ok ? c.json(r.value as never, 200) : c.json(fail(r), r.status as 403 | 404);
  });
  router.openapi(restore, (c) => {
    const p = c.req.valid("param");
    const r = restoreRevision(kind, c.get("person"), p.id, p.revision);
    return r.ok ? c.json(r.value as never, 200) : c.json(fail(r), r.status as 400 | 403 | 404);
  });
  return router;
}

export const songStylesRoutes = makeRouter("song_style", SongStyle, "Music styles", "song style", "sstyle-example123", "title, style, seed, shared_to");
export const madeArtistsRoutes = makeRouter("made_artist", MadeArtist, "Music bands", "band", "mband-example123", "name, backstory, genres, members, portrait_file_id, logo_file_id, style, seed, shared_to");
export const madeAlbumsRoutes = makeRouter("made_album", MadeAlbum, "Music albums", "album", "malbum-example123", "title, made_artist_id, song_style_id, blurb, look, cover_file_id, cover_seed, track_media_ids, style, seed, shared_to");

/** What a card's Edit button sends, per kind. Only the changed fields are present. */
const BandPatch = z.object({ name: z.string().max(120), backstory: z.string().max(4000), look: z.string().max(1000), sound: z.string().max(1000), genres: z.array(z.string().max(40)).max(8) }).partial();
const AlbumPatch = z.object({ title: z.string().min(1).max(120), blurb: z.string().max(1000), look: z.string().max(1000), sound: z.string().max(1000), genres: z.array(z.string().max(40)).max(8), track_ids: z.array(z.string()).max(100) }).partial();
const StylePatch = z.object({ title: z.string().min(1).max(120), sound: z.string().min(1).max(1000), genres: z.array(z.string().max(40)).max(8), instrumental: z.boolean(), bpm: z.number().int().min(30).max(300).nullable(), key: z.string().max(20).nullable(), length_s: z.number().int().min(5).max(600).nullable() }).partial();
const where = { conversation_id: z.string().nullable().optional().describe("For a new picture: the chat the card is in."), turn_id: z.string().nullable().optional().describe("For a new picture: the turn the card is in.") };

// MUSIC-LIKE-01: the band card's buttons. The card sends the band id and, for a new picture, the chat turn it was made in.
const BandAction = createRoute({
  method: "post", path: "/{id}/action", tags: ["Music bands"], summary: "Keep, remake or discard a band", middleware: adultMadeMiddleware,
  request: {
    params: idParamSchema("id", "mband-example123"),
    body: { content: { "application/json": { schema: z.object({
      action: z.enum(BAND_ACTION_NAMES).describe("keep saves the band's finished single to Music. remake discards the band and returns the song to make a new one from. remake_portrait and remake_logo start a new picture. discard deletes the band."),
      conversation_id: z.string().nullable().optional().describe("For remake_portrait and remake_logo: the chat the band card is in."),
      turn_id: z.string().nullable().optional().describe("For remake_portrait and remake_logo: the turn the band card is in."),
      patch: BandPatch.optional().describe("For edit: only the fields that changed. The earlier version is kept."),
    }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ action: z.enum(BAND_ACTION_NAMES), done: z.string().describe("One plain sentence for the person."), media_id: z.string().nullable().optional().describe("keep: the saved track, when its single is ready."), seed_media_id: z.string().nullable().optional().describe("remake: the song to make the new band from."), pending: z.boolean().optional().describe("keep: the single is not finished yet."), band: z.record(z.string(), z.unknown()).optional().describe("edit: the band's card as it is now.") }) } }, description: "Done." },
    ...errorResponses({ 400: "That action cannot run for this band", 401: "Sign in first", 403: "Only the band's owner can do that", 404: "Band not found" }),
  },
});
madeArtistsRoutes.openapi(BandAction, async (c) => {
  const body = c.req.valid("json");
  const r = await runBandAction(c.get("person"), c.req.valid("param").id, body.action, { conversationId: body.conversation_id ?? null, turnId: body.turn_id ?? null }, body.patch);
  if (!r.ok) return respond(c, r);
  const { mediaId, seedMediaId, ...rest } = r.value;
  return c.json({ ...rest, ...(mediaId !== undefined ? { media_id: mediaId } : {}), ...(seedMediaId !== undefined ? { seed_media_id: seedMediaId } : {}) }, 200);
});

const AlbumAction = createRoute({
  method: "post", path: "/{id}/action", tags: ["Music albums"], summary: "Keep, change, remake the cover of or discard an album", middleware: adultMadeMiddleware,
  request: {
    params: idParamSchema("id", "malbum-example123"),
    body: { content: { "application/json": { schema: z.object({
      action: z.enum(ALBUM_ACTION_NAMES).describe("keep and play_all return the album's first song. edit changes the fields in patch and keeps the earlier version. remake_cover starts a new cover. discard deletes the album; its songs stay."),
      ...where, patch: AlbumPatch.optional().describe("For edit: only the fields that changed. track_ids is the full new order; songs left out leave the album, not the library."),
    }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ action: z.enum(ALBUM_ACTION_NAMES), done: z.string().describe("One plain sentence for the person."), media_id: z.string().nullable().optional(), album: z.record(z.string(), z.unknown()).optional().describe("The album's card as it is now.") }) } }, description: "Done." },
    ...errorResponses({ 400: "That action cannot run for this album", 401: "Sign in first", 403: "Only the album's owner can do that", 404: "Album not found", 503: "A new cover needs a picture engine and none is set up" }),
  },
});
madeAlbumsRoutes.openapi(AlbumAction, async (c) => {
  const body = c.req.valid("json");
  const r = await runAlbumAction(c.get("person"), c.req.valid("param").id, body.action, { patch: body.patch, conversationId: body.conversation_id ?? null, turnId: body.turn_id ?? null });
  if (!r.ok) return respond(c, r);
  const { media_id, ...rest } = r.value;
  return c.json({ ...rest, ...(media_id !== undefined ? { media_id } : {}) }, 200);
});

const StyleAction = createRoute({
  method: "post", path: "/{id}/action", tags: ["Music styles"], summary: "Save, change or discard a song style", middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "sstyle-example123"),
    body: { content: { "application/json": { schema: z.object({
      action: z.enum(STYLE_ACTION_NAMES).describe("save and make_song return the style's card. edit changes the fields in patch and keeps the earlier version. discard deletes the style."),
      ...where, patch: StylePatch.optional().describe("For edit: only the fields that changed."),
    }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ action: z.enum(STYLE_ACTION_NAMES), done: z.string().describe("One plain sentence for the person."), style: z.record(z.string(), z.unknown()).optional().describe("The style's card as it is now.") }) } }, description: "Done." },
    ...errorResponses({ 400: "That action cannot run for this style", 401: "Sign in first", 403: "Only the style's owner can do that; a starter style is nobody's to change", 404: "Style not found" }),
  },
});
songStylesRoutes.openapi(StyleAction, (c) => {
  const body = c.req.valid("json");
  const r = runStyleAction(c.get("person"), c.req.valid("param").id, body.action, { patch: body.patch, conversationId: body.conversation_id ?? null, turnId: body.turn_id ?? null });
  return respond(c, r);
});
