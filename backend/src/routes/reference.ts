// KS-02: the page a library source card opens, `/api/reference/<book>/<path>`.
// It serves Home's own extract of the article (title, lead, facts, licence and
// snapshot lines) as a small static page, never the library's raw HTML: no
// script, no outside request, nothing a page could do on its own. It reads
// through readReferencePage, so the book must be on the asker's closed list
// and a minor's floor applies exactly as it does to a search.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { readReferencePage } from "@/lib/retrieval/referenceReader";
import type { ReferenceRow } from "@/lib/retrieval/minorFloor";
import { licenceLabel } from "@/lib/retrieval/referenceSources";
import { readableBooks } from "@/lib/retrieval/referenceSources";
import { kiwixBaseUrl } from "@/lib/kiwixSidecar";
import { extractArticle, extractFullArticle, cutAtSentence, deriveDescription } from "@/lib/retrieval/extractArticle";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { getPersonSettingValue } from "@/lib/settings";
import { extractArticleImages } from "@/lib/retrieval/articleImages";
import { sourceForBook } from "@/lib/retrieval/referenceSources";
import { installed, libraryRequest } from "@/lib/kiwixClient";
import { searchReference } from "@/lib/referenceSearch";
import { addReferenceSave, listReferenceSaves, removeReferenceSave } from "@/lib/reference/saves";
import { ReferenceSave } from "@maipai/spec/gen/ts/reference-save.js";
import { referenceKeyPoints } from "@/lib/reference/keyPoints";
import { articlePayloadFor, loadArticleFor, readArticleImage } from "@/lib/reference/article";

export const referenceRoutes = apiRouter();

const REFUSAL = "That article is not available. It may not be in this home's offline library, or the library may be switched off. Go back and search again, or ask an adult to check the library in Settings.";
const param = (name: string, max: number) => z.string().min(1).max(max).openapi({ param: { name, in: "path" } });
const booksResponse = z.array(z.object({ id: z.string(), source_label: z.string(), language: z.string().nullable(), size_bytes: z.number().nullable(), snapshot_date: z.string().nullable(), licence: z.string(), article_count: z.number().optional() }));
const suggestResponse = z.array(z.object({ title: z.string(), book: z.string(), path: z.string() }));
const searchResponse = z.array(z.object({ title: z.string(), snippet: z.string(), book: z.string(), path: z.string() }));
const articleResponse = z.object({ title: z.string(), book: z.string(), path: z.string(), source_label: z.string(), licence: z.string(), snapshot_date: z.string().nullable(), blocks: z.array(z.record(z.string(), z.unknown())), toc: z.array(z.object({ id: z.string(), title: z.string(), level: z.number() })), infobox: z.object({ title: z.string().optional(), rows: z.array(z.object({ label: z.string(), value: z.string() })), image: z.object({ src: z.string(), alt: z.string() }).optional() }).optional(), description: z.string().optional(), summary: z.string().optional(), hatnote: z.string().optional(), profile: z.enum(["wikipedia", "generic"]).optional(), lead_image: z.object({ src: z.string(), alt: z.string() }).optional(), lead: z.string().optional(), reading_minutes: z.number().int().optional(), kicker: z.string().optional(), quick_fact: z.string().optional(), badge: z.string().optional(), related: z.array(z.object({ book: z.string(), path: z.string(), title: z.string(), thumbnail: z.object({ src: z.string(), alt: z.string() }).optional() })).optional() });
const BOOKS_ROUTE = createRoute({ method: "get", path: "/books", tags: ["Sources"], summary: "Books available in the offline library", middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: booksResponse } }, description: "Readable installed books." }, ...errorResponses({ 401: "Not signed in" }) } });
const SUGGEST_ROUTE = createRoute({ method: "get", path: "/suggest", tags: ["Sources"], summary: "Suggest offline article titles", middleware: [requireAuth] as const, request: { query: z.object({ book: z.string().min(1).max(200), q: z.string().min(1).max(200) }) }, responses: { 200: { content: { "application/json": { schema: suggestResponse } }, description: "Title suggestions." }, ...errorResponses({ 401: "Not signed in" }) } });
const SEARCH_ROUTE = createRoute({ method: "get", path: "/search", tags: ["Sources"], summary: "Search installed offline articles", middleware: [requireAuth] as const, request: { query: z.object({ q: z.string().min(1).max(200), book: z.string().max(200).optional() }) }, responses: { 200: { headers: z.object({ "X-Total-Results": z.string().openapi({ description: "Total sidecar matches for adults; returned hit count for children and teens." }) }), content: { "application/json": { schema: searchResponse } }, description: "Search hits." }, ...errorResponses({ 401: "Not signed in" }) } });
const ARTICLE_ROUTE = createRoute({ method: "get", path: "/article/{book}/{path}", tags: ["Sources"], summary: "Read a cleaned offline article", middleware: [requireAuth] as const, request: { params: z.object({ book: param("book", 200), path: param("path", 500) }) }, responses: { 200: { content: { "application/json": { schema: articleResponse } }, description: "Closed article blocks." }, 404: { content: { "text/plain": { schema: z.string() } }, description: "Article not available." }, ...errorResponses({ 401: "Not signed in" }) } });
const previewResponse = z.object({ title: z.string(), summary: z.string(), description: z.string().optional(), kicker: z.string().optional(), lead: z.string().optional(), thumbnail: z.object({ src: z.string(), alt: z.string() }).optional() });
const PREVIEW_ROUTE = createRoute({ method: "get", path: "/preview/{book}/{path}", tags: ["Sources"], summary: "Preview an offline article", middleware: [requireAuth] as const, request: { params: z.object({ book: param("book", 200), path: param("path", 500) }) }, responses: { 200: { content: { "application/json": { schema: previewResponse } }, description: "Article preview." }, 404: { content: { "text/plain": { schema: z.string() } }, description: "Article not available." }, ...errorResponses({ 401: "Not signed in" }) } });
const keyPointsResponse = z.object({ key_points: z.object({ text: z.string(), band: z.enum(["child", "teen", "adult"]) }).nullable() });
const KEY_POINTS_ROUTE = createRoute({ method: "post", path: "/key-points/{book}/{path}", tags: ["Sources"], summary: "Key points of an offline article (null while they are being written)", middleware: [requireAuth] as const, request: { params: z.object({ book: param("book", 200), path: param("path", 500) }) }, responses: { 200: { content: { "application/json": { schema: keyPointsResponse } }, description: "Key points, or null while they are written." }, ...errorResponses({ 401: "Not signed in" }) } });
const RANDOM_ROUTE = createRoute({ method: "get", path: "/random/{book}", tags: ["Sources"], summary: "Choose a random offline article", middleware: [requireAuth] as const, request: { params: z.object({ book: param("book", 200) }) }, responses: { 200: { content: { "application/json": { schema: z.object({ title: z.string(), book: z.string(), path: z.string() }) } }, description: "Random readable article." }, 404: { content: { "text/plain": { schema: z.string() } }, description: "Article not available." }, ...errorResponses({ 401: "Not signed in" }) } });
const MEDIA_ROUTE = createRoute({ method: "get", path: "/media/{book}/{path}", tags: ["Sources"], summary: "Read an allowed offline article image", middleware: [requireAuth] as const, request: { params: z.object({ book: param("book", 200), path: param("path", 1000) }) }, responses: { 200: { description: "Image bytes." }, 404: { description: "Image not available." }, ...errorResponses({ 401: "Not signed in" }) } });
const referenceSaveSchema = z.object({ id: z.string(), person_id: z.string(), book: z.string(), path: z.string(), title: z.string(), saved_at: z.string(), offline: z.boolean(), hlc: z.string(), provenance: z.string() });
const savesResponse = z.object({ saves: z.array(referenceSaveSchema) });
const SAVES_ROUTE = createRoute({ method: "get", path: "/saves", tags: ["Sources"], summary: "List saved offline articles", middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: savesResponse } }, description: "Articles the person saved and may read today." }, ...errorResponses({ 401: "Not signed in" }) } });
const ADD_SAVE_ROUTE = createRoute({ method: "post", path: "/saves", tags: ["Sources"], summary: "Save an offline article", middleware: [requireAuth] as const, request: { body: { content: { "application/json": { schema: z.object({ book: z.string().min(1).max(200), path: z.string().min(1).max(500) }) } } } }, responses: { 200: { content: { "application/json": { schema: z.unknown() } }, description: "Saved article." }, 404: { content: { "text/plain": { schema: z.string() } }, description: "Article not available." }, ...errorResponses({ 401: "Not signed in" }) } });
const DELETE_SAVE_ROUTE = createRoute({ method: "delete", path: "/saves/{id}", tags: ["Sources"], summary: "Remove a saved offline article", middleware: [requireAuth] as const, request: { params: z.object({ id: param("id", 100) }) }, responses: { 200: { content: { "application/json": { schema: z.object({ removed: z.literal(true) }) } }, description: "Saved article removed." }, 404: { content: { "text/plain": { schema: z.string() } }, description: "Saved article not available." }, ...errorResponses({ 401: "Not signed in" }) } });

const unavailable = (c: any) => { c.header("Content-Type", "text/plain; charset=utf-8"); c.header("X-Content-Type-Options", "nosniff"); return c.body(REFUSAL, 404); };
function snapshotDate(value: string): string | null { return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null; }
async function dateFor(base: string, book: string): Promise<string | null> { try { const r = await libraryRequest(base, `/raw/${encodeURIComponent(book)}/meta/Date`); return r.ok ? snapshotDate(await r.text()) : null; } catch { return null; } }
function bookRows(xml: string, band: ReturnType<typeof speakerAgeBand>) {
  const installedIds = [...new Set([...xml.matchAll(/href="\/content\/([^"/?#]+)"/g)].map((m) => decodeURIComponent(m[1]!)))];
  return readableBooks(installedIds, band).books;
}

referenceRoutes.openapi(BOOKS_ROUTE, async (c) => {
  const base = kiwixBaseUrl(); if (!base) return c.json([], 200);
  try {
    const res = await libraryRequest(base, "/catalog/v2/entries?count=200"); if (!res.ok) return c.json([], 200);
    const xml = await res.text(); const rows = bookRows(xml, speakerAgeBand(c.get("person"), new Date()));
    const result = await Promise.all(rows.map(async ({ book, source }) => {
      const block = new RegExp(`<entry[^>]*>([\\s\\S]*?<title>${book.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}</title>[\\s\\S]*?)</entry>`).exec(xml)?.[1] ?? "";
      const field = (name: string) => new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "i").exec(block)?.[1] ?? null;
      const size = Number(field("size")); const count = Number(field("articleCount"));
      return { id: book, source_label: source.label, language: field("language"), size_bytes: Number.isFinite(size) && size > 0 ? size : null, snapshot_date: await dateFor(base, book), licence: licenceLabel(source.licence), ...(Number.isFinite(count) && count >= 0 ? { article_count: count } : {}) };
    }));
    return c.json(result, 200);
  } catch { return c.json([], 200); }
});

referenceRoutes.openapi(SUGGEST_ROUTE, async (c) => {
  const { book, q } = c.req.valid("query"); const band = speakerAgeBand(c.get("person"), new Date()); const base = kiwixBaseUrl();
  if (!base) return c.json([], 200);
  try {
    const names = await installed(base); const rb = readableBooks(names, band).books.find((x) => x.book === book); if (!rb) return c.json([], 200);
    const res = await libraryRequest(base, `/suggest?content=${encodeURIComponent(book)}&term=${encodeURIComponent(q)}&count=10`); if (!res.ok) return c.json([], 200);
    const data: unknown = await res.json(); if (!Array.isArray(data)) return c.json([], 200);
    const suggestions = data.filter((x: any) => x?.kind === "path" && typeof x.label === "string" && typeof x.path === "string" && x.path && !x.path.split("/").includes("..")).filter((x: any) => band === "adult" || !tripsMinorFloor(x.label)).slice(0, 10).map((x: any) => ({ title: typeof x.value === "string" && x.value.length > 0 ? x.value : String(x.label).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/<[^>]+>/g, ""), book, path: x.path }));
    return c.json(suggestions, 200);
  } catch { return c.json([], 200); }
});

referenceRoutes.openapi(SEARCH_ROUTE, async (c) => {
  const { q, book } = c.req.valid("query");
  const { hits, total } = await searchReference(c.get("person"), q, book);
  c.header("X-Total-Results", String(total));
  return c.json(hits, 200);
});

async function loadArticle(c: any, book: string, path: string) {
  return loadArticleFor(c.get("person"), book, path);
}

referenceRoutes.openapi(ARTICLE_ROUTE, async (c) => {
  const { book, path } = c.req.valid("param"); const result = await loadArticle(c, book, path);
  if (!result) return unavailable(c); if ("redirect" in result) return c.redirect(result.redirect!, 302);
  c.header("Cache-Control", "private, max-age=600"); c.header("X-Content-Type-Options", "nosniff");
  return c.json(await articlePayloadFor(c.get("person"), result), 200);
});

referenceRoutes.openapi(KEY_POINTS_ROUTE, async (c) => {
  const { book, path } = c.req.valid("param");
  c.header("Cache-Control", "no-store");
  return c.json({ key_points: await referenceKeyPoints(c.get("person"), book, path) }, 200);
});

referenceRoutes.openapi(PREVIEW_ROUTE, async (c) => {
  const { book, path } = c.req.valid("param"); const result = await loadArticle(c, book, path);
  if (!result || "redirect" in result || !result.full.summary) return unavailable(c);
  return c.json({ title: result.title, summary: result.full.summary, ...((result.full.description ?? (result.lead ? deriveDescription(result.lead) : undefined)) ? { description: result.full.description ?? deriveDescription(result.lead!) } : {}), ...(result.kicker ? { kicker: result.kicker } : {}), ...(result.lead ? { lead: result.lead } : {}), ...(result.lead_image ? { thumbnail: result.lead_image } : {}) }, 200);
});

referenceRoutes.openapi(RANDOM_ROUTE, async (c) => {
  const { book } = c.req.valid("param"); const person = c.get("person"); const band = speakerAgeBand(person, new Date()); const base = kiwixBaseUrl();
  if (!base) return unavailable(c);
  try {
    const names = await installed(base); if (!readableBooks(names, band).books.some((row) => row.book === book)) return unavailable(c);
    for (let attempt = 0; attempt < (band === "adult" ? 1 : 5); attempt++) {
      const res = await libraryRequest(base, `/random?content=${encodeURIComponent(book)}`, { redirect: "manual" }); const location = res.headers.get("location");
      if (!location) continue;
      const pathMatch = new URL(location, base).pathname.match(/^\/content\/[^/]+\/(.+)$/); if (!pathMatch) continue;
      const path = pathMatch[1]!.split("/").map(decodeURIComponent).join("/");
      const article = await loadArticle(c, book, path); if (!article || "redirect" in article) continue;
      return c.json({ title: article.title, book, path }, 200);
    }
  } catch { return unavailable(c); }
  return unavailable(c);
});

referenceRoutes.openapi(MEDIA_ROUTE, async (c) => {
  const { book, path } = c.req.valid("param"); const person = c.get("person"); const band = speakerAgeBand(person, new Date()); const base = kiwixBaseUrl();
  const image = await readArticleImage(person, book, path);
  if (!base || !image) return unavailable(c);
  c.header("Content-Type", image.type); c.header("X-Content-Type-Options", "nosniff"); c.header("Content-Security-Policy", "default-src 'none'; sandbox"); c.header("Cross-Origin-Resource-Policy", "same-origin"); c.header("Cache-Control", "private, max-age=600");
  return c.body(image.bytes, 200);
});

referenceRoutes.openapi(SAVES_ROUTE, async (c) => {
  const person = c.get("person"); const band = speakerAgeBand(person, new Date()); const base = kiwixBaseUrl();
  if (!base) return c.json({ saves: [] }, 200);
  try {
    const names = await installed(base); const allowed = new Set(readableBooks(names, band).books.map((row) => row.book));
    const saves = listReferenceSaves(person.id).filter((save) => allowed.has(save.book));
    return c.json({ saves: saves.map((save) => ReferenceSave.parse(save)) }, 200);
  } catch { return c.json({ saves: [] }, 200); }
});

referenceRoutes.openapi(ADD_SAVE_ROUTE, async (c) => {
  const { book, path } = c.req.valid("json"); const result = await loadArticle(c, book, path);
  if (!result || "redirect" in result) return unavailable(c);
  const record = addReferenceSave(c.get("person").id, { book, path, title: result.title });
  return c.json(ReferenceSave.parse(record), 200);
});

referenceRoutes.openapi(DELETE_SAVE_ROUTE, (c) => {
  const { id } = c.req.valid("param");
  return removeReferenceSave(c.get("person").id, id) ? c.json({ removed: true }, 200) : unavailable(c);
});
import { applyReference, controlReferenceJob, getReferenceState, planReference, type PresetId, type Selection, installOneReference, removeOneReference, listReferenceCatalog, referenceDisk } from "@/lib/referencePresetEngine";
import { requireRole } from "@/middleware/auth";


const SelectionSchema = z.array(z.object({ source: z.string().min(1).max(80), flavour: z.enum(["mini", "maxi", "nopic", "default"]) }).strict()).max(20);
const PlanBody = z.object({ preset: z.enum(["minimum", "moderate", "full", "custom"]), selection: SelectionSchema.optional(), location: z.string().max(1024).optional() }).strict();
const PlanResponse = z.object({ preset: z.string(), sets: z.array(z.object({ id: z.string(), source: z.string(), flavour: z.string(), name: z.string(), snapshotDate: z.string().nullable(), sizeBytes: z.number(), sha256: z.string(), installed: z.boolean(), child: z.boolean(), wikipedia: z.boolean() })), totalBytes: z.number(), freeBytes: z.number(), freeAfterInstallBytes: z.number(), requiredFreeBytes: z.number(), refusal: z.string().nullable(), swapHeadroomBytes: z.number(), estimatedSeconds: z.number().nullable(), warnings: z.array(z.string()), settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) });
const JobSchema = z.object({ id: z.string(), setId: z.string(), state: z.enum(["queued", "waiting_window", "downloading", "paused", "done", "failed", "cancelled"]), completedBytes: z.number(), totalBytes: z.number(), message: z.string().nullable() });
const PresetBody = z.object({ preset: z.enum(["minimum", "moderate", "full", "custom"]), selection: SelectionSchema.optional() }).strict();
const planPresetRoute = createRoute({ method: "post", path: "/plan", tags: ["Reference library"], summary: "Plan reference set downloads", middleware: [requireRole("owner", "admin")] as const, request: { body: { content: { "application/json": { schema: PlanBody } }, required: true } }, responses: { 200: { content: { "application/json": { schema: PlanResponse } }, description: "Resolved catalog sizes and disk impact." }, ...errorResponses({ 400: "Invalid selection or catalog failure", 401: "Not signed in", 403: "Owner or admin only" }) } });
referenceRoutes.openapi(planPresetRoute, async (c) => { const body = c.req.valid("json"); try { return c.json(await planReference(body.preset as PresetId | "custom", body.selection as Selection | undefined, body.location), 200); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The reference plan could not be built." }, 400); } });
const applyPresetRoute = createRoute({ method: "post", path: "/apply", tags: ["Reference library"], summary: "Apply a reference preset or custom selection", middleware: [requireRole("owner", "admin")] as const, request: { body: { content: { "application/json": { schema: PresetBody } }, required: true } }, responses: { 200: { content: { "application/json": { schema: z.object({ jobs: z.array(JobSchema), idempotent: z.boolean() }) } }, description: "Settings saved and background downloads queued." }, ...errorResponses({ 400: "Selection refused or invalid", 401: "Not signed in", 403: "Owner or admin only" }) } });
referenceRoutes.openapi(applyPresetRoute, async (c) => { const body = c.req.valid("json"); try { return c.json(await applyReference(body.preset as PresetId | "custom", body.selection as Selection | undefined), 200); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The reference selection could not be applied." }, 400); } });
const stateRoute = createRoute({ method: "get", path: "/state", tags: ["Reference library"], summary: "Get installed sets and download progress", middleware: [requireRole("owner", "admin")] as const, responses: { 200: { content: { "application/json": { schema: z.object({ installed: z.array(z.object({ id: z.string(), name: z.string(), book: z.string(), language: z.string(), flavour: z.string(), snapshotDate: z.string().nullable() })), jobs: z.array(JobSchema), matchesPresets: z.array(z.string()) }) } }, description: "Current reference library state." }, ...errorResponses({ 401: "Not signed in", 403: "Owner or admin only" }) } });
referenceRoutes.openapi(stateRoute, (c) => c.json(getReferenceState(), 200));
const catalogRoute = createRoute({ method: "get", path: "/catalog", tags: ["Reference library"], summary: "List reference sets offered by Kiwix", middleware: [requireRole("owner", "admin")] as const, responses: { 200: { content: { "application/json": { schema: z.array(z.object({ id: z.string(), source: z.string(), flavour: z.string(), name: z.string(), language: z.string(), sizeBytes: z.number(), snapshotDate: z.string().nullable(), installed: z.boolean(), child: z.boolean(), wikipedia: z.boolean(), bands: z.array(z.string()), available: z.boolean(), message: z.string().nullable() })) } }, description: "Resolved reference set catalogue." }, ...errorResponses({ 401: "Not signed in", 403: "Owner or admin only" }) } });
referenceRoutes.openapi(catalogRoute, async (c) => c.json(await listReferenceCatalog(), 200));
const diskRoute = createRoute({ method: "get", path: "/disk", tags: ["Reference library"], summary: "Drive size, free space and the room offline books take", middleware: [requireRole("owner", "admin")] as const, responses: { 200: { content: { "application/json": { schema: z.object({ totalBytes: z.number(), freeBytes: z.number(), booksBytes: z.number() }) } }, description: "Where the offline books live: the drive's size, what is free, and what the installed books use." }, ...errorResponses({ 401: "Not signed in", 403: "Owner or admin only" }) } });
referenceRoutes.openapi(diskRoute, (c) => c.json(referenceDisk(), 200));
const setId = z.string().regex(/^[a-z-]+:(mini|maxi|nopic|default)$/).openapi({ param: { name: "id", in: "path" } });
const installSetRoute = createRoute({ method: "post", path: "/sets/{id}/install", tags: ["Reference library"], summary: "Install one reference set", middleware: [requireRole("owner", "admin")] as const, request: { params: z.object({ id: setId }) }, responses: { 202: { content: { "application/json": { schema: JobSchema } }, description: "Download queued." }, ...errorResponses({ 400: "Install refused or invalid", 401: "Not signed in", 403: "Owner or admin only" }) } });
referenceRoutes.openapi(installSetRoute, async (c) => { const [source, flavour] = c.req.valid("param").id.split(":"); try { return c.json(await installOneReference(source!, flavour!), 202); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The set could not be installed." }, 400); } });
const removeSetRoute = createRoute({ method: "post", path: "/sets/{id}/remove", tags: ["Reference library"], summary: "Remove one installed reference set", middleware: [requireRole("owner", "admin")] as const, request: { params: z.object({ id: setId }) }, responses: { 200: { content: { "application/json": { schema: z.object({ removed: z.boolean(), freedBytes: z.number() }) } }, description: "Installed set removed." }, ...errorResponses({ 400: "Invalid set", 401: "Not signed in", 403: "Owner or admin only" }) } });
referenceRoutes.openapi(removeSetRoute, async (c) => { try { return c.json(await removeOneReference(c.req.valid("param").id), 200); } catch (error) { return c.json({ error: error instanceof Error ? error.message : "The set could not be removed." }, 400); } });
const jobControlRoute = createRoute({ method: "post", path: "/jobs/{id}/{action}", tags: ["Reference library"], summary: "Pause, resume, or cancel a reference download", middleware: [requireRole("owner", "admin")] as const, request: { params: z.object({ id: z.string().min(1).max(80), action: z.enum(["pause", "resume", "cancel"]) }) }, responses: { 200: { content: { "application/json": { schema: JobSchema } }, description: "Download job updated." }, ...errorResponses({ 401: "Not signed in", 403: "Owner or admin only", 404: "Job not found" }) } });
referenceRoutes.openapi(jobControlRoute, (c) => { const { id, action } = c.req.valid("param"); const job = controlReferenceJob(id, action); return job ? c.json(job, 200) : c.json({ error: "Job not found" }, 404); });

const getRoute = createRoute({
  method: "get",
  path: "/{book}/{path}",
  tags: ["Sources"],
  summary: "A cited article from the home's offline library",
  middleware: [requireAuth] as const,
  request: {
    params: z.object({
      book: z.string().min(1).max(200).openapi({ param: { name: "book", in: "path" } }),
      path: z.string().min(1).max(500).openapi({ param: { name: "path", in: "path" } }),
    }),
  },
  responses: {
    200: { content: { "text/html": { schema: z.string() } }, description: "The article as a static page." },
    404: { description: "That article is not in the library, or is not available to this person." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderReferencePage(row: ReferenceRow): string {
  const licence = licenceLabel(row.licence);
  const body = row.disambiguation
    ? `<p>Several articles share this name:</p><ul>${row.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`
    : `${row.lead
        .split(/\n{2,}/)
        .map((p) => `<p>${esc(p)}</p>`)
        .join("")}${row.infobox.length > 0 ? `<dl>${row.infobox.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join("")}</dl>` : ""}`;
  const when = row.snapshotDate ? `, offline copy from ${esc(row.snapshotDate)}` : ", offline copy";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(row.title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}footer{margin-top:2rem;font-size:.875rem;opacity:.7}</style></head><body><h1>${esc(row.title)}</h1>${body}<footer>${esc(row.sourceLabel)}, ${licence}${when}.</footer></body></html>`;
}

referenceRoutes.openapi(getRoute, async (c) => {
  const { book, path } = c.req.valid("param");
  const band = speakerAgeBand(c.get("person"), new Date());
  let row: ReferenceRow | null = null;
  try {
    row = await readReferencePage({ book, path, band });
  } catch {
    row = null;
  }
  if (!row) {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body("That article is not available. It may not be in this home's offline library, or the library may be switched off. Go back and search again, or ask an adult to check the library in Settings.", 404);
  }
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "private, max-age=3600");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  return c.body(renderReferencePage(row), 200);
});
