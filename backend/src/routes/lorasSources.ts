// VIDEO-LORA-07 (docs/dev/lora-sources.md, design sections 5, 15): the style browser's routes. Owner or admin only; a minor, a guest and a non-admin adult get 403.
//   POST /api/loras/browse                          search Hugging Face (and Civitai when on); adult and unknown hits are ONE locked flag unless the caller holds an unlock proof AND asked for adult results
//   GET  /api/loras/browse/{source}/{id}            one hit with its file facts (404 for a hit the caller may not see)
//   GET  /api/loras/browse/{source}/{id}/preview    its picture, fetched once by the hub (404 like a missing file when locked)
//   POST /api/loras/install                         licence step confirmed, then a Stack download job
//   GET  /api/loras/install                         the running and finished downloads (no names)
//   GET  /api/loras/sources, PUT /sources/civitai, POST /sources/civitai-key(/remove), POST /sources/huggingface-token(/remove)   the two credentials: write only, never returned
import { createRoute, z } from "@hono/zod-openapi";
import { getCookie } from "hono/cookie";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { requestProof, sessionKeyOf, unlockedFor } from "@/lib/adultLock";
import { readLora } from "@/lib/loras/access";
import { confirmItemOf, INSTALL_KIND, INSTALL_TITLE, reconcileLoraInstalls, startLoraInstall } from "@/lib/loras/install";
import {
  browseHits, civitaiEnabled, civitaiKey, CIVITAI_ENABLED_KEY, CIVITAI_KEY_KEY, fetchHit, hitKey, HF_TOKEN_KEY, huggingFaceToken, installedAs, previewOf, SourceError, type Hit, type LoraSite,
} from "@/lib/loras/source";
import { listLoraRecords } from "@/lib/loras/store";
import { setHouseholdSettingValue } from "@/lib/settings";
import { MAX_INSTALL_BYTES } from "@/lib/loras/source";
import { BASE_UNSTATED_LINE, NOT_LTX_LINE } from "@/lib/loras/install";
import { ALL_BASE_IDS, baseWords, BROWSE_BASES, isSupportedBase, mediaOfBase, supportedBaseChoices, supportedBaseIds, type AnyBaseId, type Media } from "@/lib/loras/baseFamilies";
import { videoEngineStatus } from "@/lib/videos/ready";
import { pictureEngineStatus } from "@/lib/pictures/ready";
import type { PersonRow } from "@/types";

export const lorasSourceRoutes = apiRouter();
const NOT_FOUND = { error: "That style isn't there any more." };
const INSTALL_BASE_IDS = [...ALL_BASE_IDS] as [AnyBaseId, ...AnyBaseId[]];

type Ctx = Parameters<Parameters<typeof lorasSourceRoutes.openapi>[1]>[0];
const sessionOf = (c: Ctx): string | null => sessionKeyOf(getCookie(c, "session"));

/** The lock tile of the browser: exactly this, never a field of the hit. */
const LOCKED = { locked: true } as const;

/** Whether this caller may see adult and unknown hits at all: their own screen and a live proof. */
function mayReveal(c: Ctx, admin: PersonRow): boolean { return sessionOf(c) !== null && unlockedFor(admin, requestProof()); }

const mb = (bytes: number): string => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);
const LICENCE_WORDS = { open: "open licence", non_commercial: "no-selling licence", custom: "custom licence", unknown: "licence not stated" } as const;

/** One fixed-template line built from fields (never a model), and why Install is disabled when it is. */
function lineAndReason(hit: Hit, admin: PersonRow, browsed: Media = "video"): { line: string; reason: string | null; installed: { id: string; name: string } | null } {
  // A hit's media is the one its base belongs to; a hit with no known base takes the media being browsed.
  const media = mediaOfBase(hit.base_model) ?? browsed;
  const parts = [`Made for ${hit.base_unstated ? "LTX 2 (version not stated)" : baseWords(hit.base_model)}`];
  if (hit.bytes !== null) parts.push(mb(hit.bytes));
  parts.push(LICENCE_WORDS[hit.licence_class]);
  if (hit.downloads > 0) parts.push(`${hit.downloads.toLocaleString("en-US")} downloads`);
  let reason: string | null = null;
  const have = installedAs(hit, listLoraRecords(), mediaOfBase(hit.base_model) ?? browsed);
  let installed: { id: string; name: string } | null = null;
  if (have) {
    const seen = readLora(admin, have.lora.id, "own_written");
    if (seen && seen.state === "open") { installed = { id: seen.lora.id, name: seen.lora.name }; reason = `Already installed as ${seen.lora.name}`; } else reason = "Already installed";
  } else if (hit.base_unstated) reason = BASE_UNSTATED_LINE.replace(/\.$/, "");
  else if (!isSupportedBase(hit.base_model, media)) reason = NOT_LTX_LINE(hit.base_label, media).replace(/\.$/, "");
  else if (hit.bytes !== null && hit.bytes > MAX_INSTALL_BYTES) reason = "File is over 4 GB";
  else if (hit.gated) reason = "Asks you to accept terms on Hugging Face first";
  return { line: parts.join(", "), reason, installed };
}

/** What the style does: the maker's own words when the source has them, else one fixed sentence built from the fields (never a model). */
function summaryOf(hit: Hit): string {
  if (hit.summary) return hit.summary;
  // No "made for" sentence: the base is a label over the picture. Without the maker's words, say what we do know: the maker's tags and trigger words.
  const tags = (hit.tags ?? []).filter((t) => !/^(lora|style|character|concept|base model)$/i.test(t)).slice(0, 4);
  const use = hit.trigger_words.length ? `Say ${hit.trigger_words.slice(0, 2).map((w) => `"${w}"`).join(" or ")} in your prompt to use it.` : "";
  const about = tags.length ? `Tagged ${tags.join(", ")}.` : "";
  return [about, use].filter(Boolean).join(" ") || "The maker wrote no description.";
}

/** The bases this install can use styles for, as dropdown choices: the one list the Made for filter is built from. */
const baseChoices = (media: Media) => supportedBaseChoices(media);

function view(hit: Hit, admin: PersonRow, browsed: Media = "video") {
  const { line, reason, installed } = lineAndReason(hit, admin, browsed);
  return {
    key: hitKey(hit), site: hit.site, remote_id: hit.remote_id, version_id: hit.version_id, title: hit.title, creator: hit.creator, page_url: hit.page_url,
    preview: hit.preview_url ? `/api/loras/browse/${hit.site}/${encodeURIComponent(hit.remote_id)}/preview${hit.version_id && hit.site === "civitai" ? `?version=${encodeURIComponent(hit.version_id)}` : ""}` : null,
    base_label: hit.base_label, base_model: hit.base_model, base_unstated: hit.base_unstated, kind: hit.kind, bytes: hit.bytes, sha256: hit.sha256, licence: { id: hit.licence_id, class: hit.licence_class, commercial_use: hit.commercial_use },
    downloads: hit.downloads, rating: hit.rating, created_at: hit.created_at, trigger_words: hit.trigger_words, also_on: hit.also_on, gated: hit.gated,
    adult_check: hit.adult_check.state, installed, reason, line, confirm_item: confirmItemOf(hit), summary: summaryOf(hit),
  };
}
const HitView = z.object({}).passthrough();

function sourceFailure(error: unknown): { body: { error: string; code: string }; status: 400 | 403 | 404 | 429 | 502 | 503 } {
  // A missing hit and a locked one answer the same body (no code), so an id cannot be probed.
  if (error instanceof SourceError) return { body: error.code === "not_found" ? { ...NOT_FOUND } as { error: string; code: string } : { error: error.message, code: error.code }, status: error.status };
  throw error;
}

// ---- browse -------------------------------------------------------------------------------------------------------------------------------------

const BrowseBody = z.object({
  source: z.enum(["huggingface", "civitai", "both"]).default("huggingface"), q: z.string().max(200).default(""), media: z.enum(["video", "picture"]).default("video"),
  kind: z.enum(["any", "style", "character"]).default("any"), base: z.enum(["default", ...BROWSE_BASES.video, ...BROWSE_BASES.picture, "all"]).default("all"),
  installed: z.enum(["any", "not_installed", "installed"]).default("any"), sort: z.enum(["downloads", "rating", "newest"]).default("downloads"),
  cursor: z.string().max(2000).nullable().default(null), adult: z.boolean().default(false),
}).superRefine((body, ctx) => {
  if (body.base !== "default" && body.base !== "all" && !(BROWSE_BASES[body.media] as readonly string[]).includes(body.base)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["base"], message: `That base is not available for ${body.media}.` });
  }
});
const browseRoute = createRoute({
  method: "post", path: "/browse", tags: ["LoRAs"], summary: "Search the style sources (owner or admin)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: BrowseBody } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ items: z.array(HitView), locked: z.boolean().describe("One tile for every hit that is adult or unknown: no title, picture, id or count."), next_cursor: z.string().nullable(), notes: z.array(z.string()), bases: z.array(z.object({ id: z.string(), label: z.string() })) }) } }, description: "Adult and unknown hits are not in `items`." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only, or Civitai is off", 429: "Too many searches this hour", 502: "The source did not answer", 503: "The source asked us to slow down" }) },
});
lorasSourceRoutes.openapi(browseRoute, async (c) => {
  const admin = c.get("person");
  const body = c.req.valid("json");
  if (body.media === "video") await videoEngineStatus(); else await pictureEngineStatus();
  const reveal = mayReveal(c, admin) && body.adult;
  const notes: string[] = [];
  if (supportedBaseIds(body.media).length === 0) {
    notes.push(body.media === "video" ? "This computer has no video model that can use styles yet." : "This computer has no picture model that can use styles yet.");
    return c.json({ items: [], locked: false, next_cursor: null, notes, bases: [] }, 200);
  }
  let source = body.source;
  if (source === "both" && !civitaiEnabled()) { source = "huggingface"; notes.push("Civitai is off, so only Hugging Face was searched."); }
  try {
    const browsed = await browseHits({ source, q: body.q, kind: body.kind, media: body.media, base: body.base, sort: body.sort, cursor: body.cursor, nsfw: reveal });
    const records = listLoraRecords();
    // Filter on the full hit, THEN redact: what is locked is decided once, from the classified hit, and the filter never changes what a caller sees of it.
    const wanted = browsed.hits.filter((h) => (body.installed === "any" ? true : (installedAs(h, records, body.media) !== null) === (body.installed === "installed")));
    const shown = wanted.filter((h) => h.adult_check.state === "normal" || reveal);
    const locked = wanted.length > shown.length;
    return c.json({ items: shown.map((h) => view(h, admin, body.media)), locked, next_cursor: browsed.next, notes, bases: baseChoices(body.media) }, 200);
  } catch (error) { const f = sourceFailure(error); return c.json(f.body, f.status) as never; }
});

async function visibleHit(c: Ctx, site: LoraSite, id: string, version: string | null): Promise<Hit | null> {
  const hit = await fetchHit(site, id, version);
  const admin = c.get("person");
  return hit.adult_check.state === "normal" || mayReveal(c, admin) ? hit : null;
}
const hitParams = z.object({ source: z.enum(["huggingface", "civitai"]).openapi({ param: { name: "source", in: "path" } }), id: z.string().min(1).max(200).openapi({ param: { name: "id", in: "path" } }) });
const versionQuery = z.object({ version: z.string().max(40).optional() });

const detailRoute = createRoute({
  method: "get", path: "/browse/{source}/{id}", tags: ["LoRAs"], summary: "One style from a source, with its file facts", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: hitParams, query: versionQuery },
  responses: { 200: { content: { "application/json": { schema: HitView } }, description: "A hit the caller may see." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only, or Civitai is off", 404: "Not there, or locked", 502: "The source did not answer", 503: "Slow down" }) },
});
lorasSourceRoutes.openapi(detailRoute, async (c) => {
  const { source, id } = c.req.valid("param");
  try {
    const hit = await visibleHit(c, source, id, c.req.valid("query").version ?? null);
    return hit ? c.json(view(hit, c.get("person")), 200) : (c.json(NOT_FOUND, 404) as never);
  } catch (error) { const f = sourceFailure(error); return c.json(f.body, f.status) as never; }
});

const previewRoute = createRoute({
  method: "get", path: "/browse/{source}/{id}/preview", tags: ["LoRAs"], summary: "A style's picture, fetched once by the hub", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { params: hitParams, query: versionQuery },
  responses: { 200: { content: { "image/*": { schema: z.string() } }, description: "The picture." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only", 404: "Not there, or locked", 502: "The source did not answer", 503: "Slow down" }) },
});
lorasSourceRoutes.openapi(previewRoute, async (c) => {
  const { source, id } = c.req.valid("param");
  try {
    const hit = await visibleHit(c, source, id, c.req.valid("query").version ?? null);
    const picture = hit ? await previewOf(hitKey(hit)) : null;
    if (!picture) return c.json(NOT_FOUND, 404) as never;
    return new Response(picture.bytes, { status: 200, headers: { "content-type": picture.type, "cache-control": "no-store" } }) as never;
  } catch (error) { const f = sourceFailure(error); return c.json(f.body, f.status) as never; }
});

// ---- install ------------------------------------------------------------------------------------------------------------------------------------

const InstallBody = z.object({
  source: z.enum(["huggingface", "civitai"]), remote_id: z.string().max(200).optional(), version_id: z.string().max(200).nullable().optional(), url: z.string().max(2048).optional(), file: z.string().max(500).nullable().optional(),
  name: z.string().trim().max(80).optional(), kind: z.enum(["style", "character"]).optional(), audience: z.enum(["all-ages", "adult-only"]), licence_confirmed: z.boolean(),
  media: z.enum(["video", "picture"]).default("video"), base_model: z.enum(INSTALL_BASE_IDS).optional(), confirm_ticket: z.string().max(200).optional(), as_separate: z.boolean().optional(),
});
const installRoute = createRoute({
  method: "post", path: "/install", tags: ["LoRAs"], summary: "Download a style into the library (an admin's click, after the licence step)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: InstallBody } } } },
  responses: {
    202: { content: { "application/json": { schema: z.object({ job: z.string() }) } }, description: "A download job started; it shows in the job list as \"Downloading a style\"." },
    ...errorResponses({ 401: "Not signed in", 403: "Admins only, own screen only, Civitai off, or an unlock is needed to choose All ages", 404: "Not there", 409: "Already installed (duplicate) or the source changed the file (changed_file)", 422: "The licence step is missing, or the style cannot be used here", 429: "Slow down", 502: "The source did not answer", 503: "Another download is running, or the source is busy" }),
  },
});
lorasSourceRoutes.openapi(installRoute, async (c) => {
  const body = c.req.valid("json");
  if (body.media === "video") await videoEngineStatus(); else await pictureEngineStatus();
  if (body.base_model && mediaOfBase(body.base_model) !== body.media) return c.json({ error: `That base is not available for ${body.media}.` }, 400) as never;
  const result = await startLoraInstall({ admin: c.get("person"), sessionKey: sessionOf(c), proof: requestProof() }, body);
  if (result.ok) return c.json({ job: result.job }, 202);
  return c.json({ error: result.error, code: result.code, ...(result.existing_id ? { existing_id: result.existing_id } : {}) }, result.status) as never;
});

const installsRoute = createRoute({
  method: "get", path: "/install", tags: ["LoRAs"], summary: "Style downloads, running and finished (no names)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ items: z.array(z.object({ job: z.string(), state: z.string(), title: z.string(), percent: z.number().nullable() })) }) } }, description: "Names are never listed, so an adult-only style is not named." }, ...errorResponses({ 401: "Not signed in", 403: "Admins only" }) },
});
lorasSourceRoutes.openapi(installsRoute, async (c) => {
  await reconcileLoraInstalls();
  const rows = db.select().from(jobs).where(and(eq(jobs.kind, INSTALL_KIND), inArray(jobs.state, ["queued", "running", "done", "failed", "cancelled"]))).all();
  return c.json({ items: rows.map((r) => ({ job: r.id.replace(/^lora-install:/, ""), state: r.state, title: INSTALL_TITLE, percent: (() => { try { const p = (JSON.parse(r.progress ?? "{}") as { percent?: number }).percent; return typeof p === "number" ? p : null; } catch { return null; } })() })) }, 200);
});

// ---- the two credentials ------------------------------------------------------------------------------------------------------------------------

const SourcesState = z.object({ huggingface: z.object({ on: z.literal(true), token_saved: z.boolean() }), civitai: z.object({ on: z.boolean(), key_saved: z.boolean() }) });
const sourcesState = () => ({ huggingface: { on: true as const, token_saved: huggingFaceToken() !== null }, civitai: { on: civitaiEnabled(), key_saved: civitaiKey() !== null } });
const CRED_ERRORS = errorResponses({ 400: "Not saved", 401: "Not signed in", 403: "Admins only" });
const stateOk = { 200: { content: { "application/json": { schema: SourcesState } }, description: "Which sources are on and whether a key is saved. The key itself is never returned." } } as const;

const sourcesRoute = createRoute({ method: "get", path: "/sources", tags: ["LoRAs"], summary: "Where styles come from", middleware: [requireAuth, requireRole("owner", "admin")] as const, responses: { ...stateOk, ...errorResponses({ 401: "Not signed in", 403: "Admins only" }) } });
lorasSourceRoutes.openapi(sourcesRoute, (c) => (c.json(sourcesState(), 200) as never));

function write(key: string, value: unknown): string | null {
  const r = setHouseholdSettingValue(key, value);
  return r.ok ? null : r.error;
}
const switchRoute = createRoute({
  method: "put", path: "/sources/civitai", tags: ["LoRAs"], summary: "Turn Civitai on or off (off by default)", middleware: [requireAuth, requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ on: z.boolean() }) } } } }, responses: { ...stateOk, ...CRED_ERRORS },
});
lorasSourceRoutes.openapi(switchRoute, (c) => { const e = write(CIVITAI_ENABLED_KEY, c.req.valid("json").on); return e ? (c.json({ error: e }, 400) as never) : (c.json(sourcesState(), 200) as never); });

function credentialRoutes(path: string, label: string, key: string, field: "key" | "token") {
  const save = createRoute({
    method: "post", path, tags: ["LoRAs"], summary: `Save the ${label} (write only)`, middleware: [requireAuth, requireRole("owner", "admin")] as const,
    request: { body: { content: { "application/json": { schema: z.object({ [field]: z.string().trim().min(8).max(512) }) } } } }, responses: { ...stateOk, ...CRED_ERRORS },
  });
  lorasSourceRoutes.openapi(save as never, (async (c: Ctx & { req: { valid: (k: string) => unknown } }) => {
    const value = (c.req.valid("json") as Record<string, string>)[field]!;
    const e = write(key, value);
    return e ? c.json({ error: e }, 400) : (c.json(sourcesState(), 200) as never);
  }) as never);
  const remove = createRoute({ method: "post", path: `${path}/remove`, tags: ["LoRAs"], summary: `Remove the saved ${label}`, middleware: [requireAuth, requireRole("owner", "admin")] as const, responses: { ...stateOk, ...CRED_ERRORS } });
  lorasSourceRoutes.openapi(remove, (c) => { const e = write(key, ""); return e ? (c.json({ error: e }, 400) as never) : (c.json(sourcesState(), 200) as never); });
}
credentialRoutes("/sources/civitai-key", "Civitai key", CIVITAI_KEY_KEY, "key");
credentialRoutes("/sources/huggingface-token", "Hugging Face token", HF_TOKEN_KEY, "token");
