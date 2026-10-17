// IMGGEN-SET-01: the admin side of pictures: the picture models, the household's style (LoRA) library, and who may
// use what. Owner and admin only. The Stack keeps the files and refuses what must never be added (a style that puts
// a minor in a sexual context, or a real person's likeness: `lora_refused`); Home keeps the household's switch on each
// style and decides who may use which (policy.ts). A newly added style starts switched off until the admin has read
// its fingerprint and licence on the confirmation step and turns it on.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { allAdapters, dropAdapterCache, forgetAdapterPref, setAdapterEnabled } from "@/lib/pictures/adapters";
import { addLoraFile, addLoraUrl, getStackJob, imageStatus, installPictureModel, patchLora, removeLora, StackPicturesError } from "@/lib/pictures/stack";
import { adultAdaptersAllowed, householdAllowsAdults, householdPictureQuality } from "@/lib/pictures/policy";
import { detailedReady } from "@/lib/pictures/quality";
import { dropPictureStatusCache } from "@/lib/pictures/ready";
import { db } from "@/db";
import { pictureAdapterPrefs, people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { declareStyleSubject, forgetStyleSubject, getStyleSubject } from "@/lib/likeness/adapters";
import { checkStyleSubject, LOOKS_LIKE_REQUIRED_LINE, notifyStyleAdded, stackLikenessFields } from "@/lib/likeness/importStyle";

export const picturesAdminRoutes = apiRouter();

const AdapterSchema = z.object({
  id: z.string(), name: z.string(), base_model: z.string(), classification: z.enum(["all-ages", "adult-only"]), classification_note: z.string().nullable(),
  licence: z.string(), licence_known: z.boolean(), source_url: z.string().nullable(), bytes: z.number(), sha256: z.string(), trigger_words: z.array(z.string()), added_at: z.string(),
  enabled: z.boolean(), needs_confirmation: z.boolean(),
  looks_like: z.object({ id: z.string(), name: z.string() }).nullable().describe("LIKENESS-01: the household adult this style looks like, or null for nobody."),
});
const OverviewSchema = z.object({
  stack: z.enum(["ok", "unreachable"]),
  engine: z.object({
    state: z.string(), available: z.boolean(), reason: z.string().nullable(), default_model: z.string().nullable(), edit_ready: z.boolean(),
    models: z.array(z.object({ id: z.string(), label: z.string(), installed: z.boolean(), available: z.boolean(), licence: z.string(), edit: z.boolean(), peak_gb: z.number().nullable(), remaining_bytes: z.number() })),
    remaining_bytes: z.number(),
  }),
  adapters: z.array(AdapterSchema),
  bands: z.array(z.object({ band: z.enum(["children", "teens", "adults"]), label: z.string(), on: z.boolean(), locked: z.boolean(), note: z.string() })),
  adult_adapters: z.enum(["allowed", "restricted"]),
  quality: z.enum(["quick", "detailed"]).describe("The household's Picture quality setting."),
  detailed_ready: z.boolean().describe("Whether Detailed pictures can be made now (the model is installed and this computer can run it)."),
});
const refusals = errorResponses({ 400: "Bad request", 401: "Not signed in", 403: "Admins only", 404: "No such style or job", 409: "Already added", 413: "Too big", 422: "That cannot be added", 502: "The picture engine refused it", 503: "The picture engine is not available" });

const BAND_NOTES = {
  children: "Children cannot make pictures. This stays off until pictures have a safety check on the finished picture, which is not built yet.",
  teens: "Teens cannot make pictures. This stays off until pictures have a safety check on the finished picture, which is not built yet.",
  adultsOn: "Adults can ask chat for pictures on their own screen.",
  adultsOff: "Adults cannot make pictures while this is off.",
};

const WELL_KNOWN_FREE = /^(apache|mit|cc0|bsd)/i;

function present(a: Awaited<ReturnType<typeof allAdapters>>[number], pendingIds: Set<string>) {
  const licence = (a.licence ?? "").trim();
  return {
    id: a.id, name: a.name, base_model: a.base_model, classification: a.classification, classification_note: a.classification_note ?? null,
    licence: licence || "No licence stated", licence_known: licence !== "" && licence.toLowerCase() !== "unknown", source_url: a.source_url ?? null, bytes: a.bytes, sha256: a.sha256,
    trigger_words: a.trigger_words, added_at: a.added_at, enabled: a.enabled, needs_confirmation: pendingIds.has(a.id), looks_like: lookedLikeView("picture", a.id, a.likeness_subject ?? null),
  };
}

/** Whom a style looks like, by name, for the admin's list (a household fact, shown to the admins who manage the library). */
export function lookedLikeView(medium: "picture" | "video", adapterId: string, stackSubject: string | null): { id: string; name: string } | null {
  const record = getStyleSubject(medium, adapterId);
  const id = record ? record.subjectPersonId : stackSubject;
  if (!id) return null;
  const person = db.select().from(people).where(eq(people.id, id)).get();
  return { id, name: person ? (person.nickname?.trim() || person.displayName) : "Someone who left" };
}

function pendingIds(): Set<string> {
  return new Set(db.select().from(pictureAdapterPrefs).all().filter((row) => !row.enabled && (row.updatedBy ?? "").startsWith("added:")).map((row) => row.adapterId));
}

function stackFailure(c: { json: (body: unknown, status: never) => Response }, error: unknown): Response {
  if (error instanceof StackPicturesError) {
    const status = error.status === 403 ? 403 : error.status === 409 ? 409 : error.status === 413 ? 413 : error.status === 422 ? 422 : error.status === 404 ? 404 : error.status === 503 ? 503 : 502;
    return c.json({ error: error.message, code: error.code }, status as never);
  }
  return c.json({ error: "The picture engine could not do that. Try again.", code: "failed" }, 502 as never);
}

const overviewRoute = createRoute({
  method: "get", path: "/", tags: ["Pictures admin"], summary: "The picture models, the style library and the household's picture switches", middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: OverviewSchema } }, description: "Additive." }, ...refusals },
});
picturesAdminRoutes.openapi(overviewRoute, async (c) => {
  const status = await imageStatus();
  let adapters: Awaited<ReturnType<typeof allAdapters>> = [];
  try { dropAdapterCache(); adapters = await allAdapters(); } catch { adapters = []; }
  const pending = pendingIds();
  const adultsOn = householdAllowsAdults();
  return c.json({
    stack: status ? "ok" as const : "unreachable" as const,
    engine: {
      state: status?.state ?? "unsupported", available: status?.available ?? false,
      reason: status ? status.reason : "The picture engine isn't answering. Check that the engine is running, then reload this page.",
      default_model: status?.default_model ?? null, edit_ready: Boolean(status?.edit?.generative),
      models: (status?.models ?? []).map((m) => ({ id: m.id, label: m.label ?? m.id, installed: m.installed, available: m.available ?? true, licence: m.licence ?? "", edit: Boolean(m.edit), peak_gb: m.peak_gb ?? null, remaining_bytes: m.install?.remaining_bytes ?? 0 })),
      remaining_bytes: status?.install?.remaining_bytes ?? 0,
    },
    adapters: adapters.map((a) => present(a, pending)),
    bands: [
      { band: "children" as const, label: "Children", on: false, locked: true, note: BAND_NOTES.children },
      { band: "teens" as const, label: "Teens", on: false, locked: true, note: BAND_NOTES.teens },
      { band: "adults" as const, label: "Adults", on: adultsOn, locked: false, note: adultsOn ? BAND_NOTES.adultsOn : BAND_NOTES.adultsOff },
    ],
    adult_adapters: adultAdaptersAllowed() ? "allowed" as const : "restricted" as const,
    quality: householdPictureQuality(),
    detailed_ready: detailedReady(status),
  }, 200);
});

const installRoute = createRoute({
  method: "post", path: "/models/install", tags: ["Pictures admin"], summary: "Install a picture model", middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ family: z.string().max(60).optional() }) } } } },
  responses: { 202: { content: { "application/json": { schema: z.object({ job: z.string(), family: z.string() }) } }, description: "The install job; poll GET /jobs/{id}." }, ...refusals },
});
picturesAdminRoutes.openapi(installRoute, async (c) => {
  try {
    const started = await installPictureModel(c.req.valid("json").family);
    dropPictureStatusCache();
    return c.json({ job: started.job, family: started.family }, 202);
  } catch (error) { return stackFailure(c, error) as never; }
});

const jobParams = z.object({ id: z.string().min(1).max(120).openapi({ param: { name: "id", in: "path" } }) });
const jobRoute = createRoute({
  method: "get", path: "/jobs/{id}", tags: ["Pictures admin"], summary: "Progress of a model install or a style fetch", middleware: [requireRole("owner", "admin")] as const,
  request: { params: jobParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ state: z.enum(["running", "done", "failed"]), percent: z.number(), label: z.string(), error: z.string().nullable(), code: z.string().nullable(), adapter: AdapterSchema.nullable() }) } }, description: "A finished style fetch carries the new style, switched off until confirmed." }, ...refusals },
});
picturesAdminRoutes.openapi(jobRoute, async (c) => {
  const adminId = c.get("person").id;
  try {
    const job = await getStackJob(c.req.valid("param").id);
    if (job.state === "done") {
      dropPictureStatusCache();
      const lora = job.result?.lora;
      let adapter = null;
      if (lora) {
        const declaredBy = pendingNobody.get(c.req.valid("param").id);
        if (declaredBy && !getStyleSubject("picture", lora.id)) declareStyleSubject({ adapterId: lora.id, medium: "picture", subjectPersonId: null, classification: lora.classification, declaredBy });
        pendingNobody.delete(c.req.valid("param").id);
        if (!db.select().from(pictureAdapterPrefs).all().some((p) => p.adapterId === lora.id)) setAdapterEnabled(lora.id, false, `added:${adminId}`);
        dropAdapterCache();
        const found = (await allAdapters()).find((a) => a.id === lora.id);
        adapter = found ? present(found, pendingIds()) : null;
      }
      return c.json({ state: "done" as const, percent: 100, label: "Done", error: null, code: null, adapter }, 200);
    }
    if (job.state === "failed" || job.state === "cancelled") {
      const reason = (job.reason ?? "").trim();
      const code = /^[a-z_]+(?=[:\s]|$)/.exec(reason)?.[0] ?? null;
      return c.json({ state: "failed" as const, percent: 0, label: "Failed", error: reason.replace(/^[a-z_]+[:\s]+/, "") || "The picture engine could not finish this. Try again.", code, adapter: null }, 200);
    }
    return c.json({ state: "running" as const, percent: Math.max(0, Math.min(99, Math.round(job.percent ?? 0))), label: job.status || "Working", error: null, code: null, adapter: null }, 200);
  } catch (error) { return stackFailure(c, error) as never; }
});

const addRoute = createRoute({
  method: "post", path: "/adapters", tags: ["Pictures admin"], summary: "Add a style (LoRA) by Hugging Face link, file, or a path on this computer", middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "multipart/form-data": { schema: z.object({
    name: z.string().min(1).max(80), url: z.string().max(600).optional(), file: z.any().optional(), path: z.string().max(1000).optional(),
    licence: z.string().max(200).optional(), licence_acknowledged: z.enum(["true", "false"]).optional(),
    all_ages: z.enum(["yes", "no", "unsure"]).optional(), trigger_words: z.string().max(400).optional(),
    looks_like: z.string().max(80).optional().describe("LIKENESS-01: 'nobody', or the id of the household adult the style looks like (they must have agreed, or be the one adding it)."),
    not_real_person: z.enum(["true", "false"]).optional().describe("Older clients: the same as looks_like 'nobody'."),
  }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.union([z.object({ job: z.string() }), z.object({ adapter: AdapterSchema })]) } }, description: "A file is added at once (switched off until confirmed); a link starts a job to poll at GET /jobs/{id}." }, ...refusals },
});
picturesAdminRoutes.openapi(addRoute, async (c) => {
  const adminId = c.get("person").id;
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  if (!name) return c.json({ error: "Give the style a name.", code: "bad_name" }, 422) as never;
  const lookedLike = String(form.looks_like ?? "").trim() || (String(form.not_real_person ?? "") === "true" ? "nobody" : "");
  const subjectCheck = checkStyleSubject(lookedLike, c.get("person"));
  if (!subjectCheck.ok) return c.json({ error: subjectCheck.line || LOOKS_LIKE_REQUIRED_LINE, code: subjectCheck.code }, subjectCheck.status) as never;
  const licenceText = String(form.licence ?? "").trim();
  const ack = String(form.licence_acknowledged ?? "") === "true";
  if (!WELL_KNOWN_FREE.test(licenceText) && !ack) return c.json({ error: "Read the licence and tick the box to say you have. A style with no licence stated or an unusual one needs that before it is added.", code: "licence_acknowledgement_required" }, 422) as never;
  // Uncertain means adult-only: only a plain "yes, all ages" makes it all-ages.
  // A style of a person is always adult-only.
  const classification = subjectCheck.kind === "person" ? "adult-only" as const : String(form.all_ages ?? "") === "yes" ? "all-ages" as const : "adult-only" as const;
  const trigger = String(form.trigger_words ?? "").split(",").map((w) => w.trim()).filter(Boolean).slice(0, 12);
  try {
    const file = form.file;
    const path = String(form.path ?? "").trim();
    // A file arrives as a form part; a path names a file the admin already saved on this computer (most community styles are over the
    // 128 MB a form can carry). Either way the Stack reads it and runs the same checks.
    if (path && !(file instanceof File && file.size > 0) && (!path.startsWith("/") || !path.toLowerCase().endsWith(".safetensors"))) return c.json({ error: "Type the full path of the .safetensors file, starting with /, for example /Users/you/Downloads/style.safetensors.", code: "bad_path" }, 422) as never;
    // A style of a person is proved against the bytes of the file the admin chose here; a path on disk is not that.
    if (path && !(file instanceof File && file.size > 0) && subjectCheck.kind === "person") return c.json({ error: "A style that looks like a person has to be added by choosing the file here, not by its path.", code: "likeness_file_required" }, 422) as never;
    if ((file instanceof File && file.size > 0) || path) {
      const stack = new FormData();
      if (file instanceof File && file.size > 0) stack.append("file", file, file.name || "style.safetensors");
      else stack.append("path", path);
      stack.append("name", name);
      stack.append("licence", licenceText || "unknown");
      stack.append("licence_acknowledged", ack ? "true" : "false");
      stack.append("classification", classification);
      stack.append("trigger_words", JSON.stringify(trigger));
      stack.append("added_by", adminId);
      if (subjectCheck.kind === "person" && file instanceof File) {
        const fields = await stackLikenessFields(subjectCheck, c.get("person"), new Uint8Array(await file.arrayBuffer()));
        if ("error" in fields) return c.json({ error: fields.error, code: "likeness_engine" }, 503) as never;
        stack.append("likeness_subject", fields.likeness_subject);
        stack.append("likeness_proof", fields.likeness_proof);
      }
      const lora = await addLoraFile(stack);
      declareStyleSubject({ adapterId: lora.id, medium: "picture", subjectPersonId: subjectCheck.kind === "person" ? subjectCheck.subject.id : null, classification: lora.classification, declaredBy: adminId });
      if (subjectCheck.kind === "person") await notifyStyleAdded(subjectCheck.subject.id, c.get("person"), "picture");
      setAdapterEnabled(lora.id, false, `added:${adminId}`);
      dropAdapterCache();
      const found = (await allAdapters()).find((a) => a.id === lora.id);
      return c.json({ adapter: present(found ?? { ...lora, enabled: false }, pendingIds()) }, 200) as never;
    }
    const url = String(form.url ?? "").trim();
    if (!url) return c.json({ error: "Paste a Hugging Face link to the .safetensors file, choose the file, or type where it is saved on this computer.", code: "source_required" }, 422) as never;
    // A style of a person is added from the file itself: its proof is bound to the file's hash, and a link's bytes can change.
    if (subjectCheck.kind === "person") return c.json({ error: "A style that looks like a person has to be added as a file, not from a link. Download it, then choose the file.", code: "likeness_file_required" }, 422) as never;
    const started = await addLoraUrl({ url, name, ...(licenceText ? { licence: licenceText } : {}), licence_acknowledged: ack, classification, trigger_words: trigger, added_by: adminId });
    pendingNobody.set(started.job, adminId);
    return c.json({ job: started.job }, 200) as never;
  } catch (error) { return stackFailure(c, error) as never; }
});

/** A link install in flight: the answer was "Nobody", recorded when the job finishes and the style exists. */
const pendingNobody = new Map<string, string>();

const adapterParams = z.object({ id: z.string().min(1).max(60).openapi({ param: { name: "id", in: "path" } }) });
const patchRoute = createRoute({
  method: "patch", path: "/adapters/{id}", tags: ["Pictures admin"], summary: "Turn a style on or off for the household, or change its age setting", middleware: [requireRole("owner", "admin")] as const,
  request: { params: adapterParams, body: { content: { "application/json": { schema: z.object({ enabled: z.boolean().optional(), classification: z.enum(["all-ages", "adult-only"]).optional(), name: z.string().min(1).max(80).optional(), trigger_words: z.array(z.string().max(60)).max(12).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: AdapterSchema } }, description: "The style as it stands." }, ...refusals },
});
picturesAdminRoutes.openapi(patchRoute, async (c) => {
  const adminId = c.get("person").id;
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  try {
    if (body.classification !== undefined || body.name !== undefined || body.trigger_words !== undefined) {
      await patchLora(id, { ...(body.classification ? { classification: body.classification } : {}), ...(body.name ? { name: body.name } : {}), ...(body.trigger_words ? { trigger_words: body.trigger_words } : {}) });
    }
    if (body.enabled !== undefined) setAdapterEnabled(id, body.enabled, adminId);
    dropAdapterCache();
    const found = (await allAdapters()).find((a) => a.id === id);
    if (!found) return c.json({ error: "That style isn't in the library.", code: "unknown_lora" }, 404) as never;
    return c.json(present(found, pendingIds()), 200);
  } catch (error) { return stackFailure(c, error) as never; }
});

const removeRoute = createRoute({
  method: "delete", path: "/adapters/{id}", tags: ["Pictures admin"], summary: "Remove a style and its file", middleware: [requireRole("owner", "admin")] as const,
  request: { params: adapterParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Removed." }, ...refusals },
});
picturesAdminRoutes.openapi(removeRoute, async (c) => {
  const { id } = c.req.valid("param");
  try {
    await removeLora(id);
    forgetStyleSubject("picture", id);
    forgetAdapterPref(id);
    dropAdapterCache();
    return c.json({ ok: true as const }, 200);
  } catch (error) { return stackFailure(c, error) as never; }
});
