// IMGTOOLS-03/04: the picture editor's routes. Additive, signed-in, per
// person; every picture is read through the conversation reader and written
// only into a conversation the person owns (lib/imageEdit.ts). The Stack is
// only ever called from there.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { ImageEditError, applyPreview, cancelEdit, editErrorFrom, editToolsStatus, listVersions, pollEdit, readPicture, readPreview, saveUploadedVersion } from "@/lib/imageEdit";
import { runPictureEdit, getMediaOpJob } from "@/lib/mediaOps/registry";
import { runPictureWords } from "@/lib/mediaOps/words";

export const imageEditRoutes = apiRouter();

const ToolState = z.object({ enabled: z.boolean(), reason: z.string().optional() });
const VersionSchema = z.object({ id: z.string(), url: z.string(), label: z.string(), created_at: z.string(), op: z.string(), width: z.number().nullable(), height: z.number().nullable(), media_type: z.string(), source: z.string().nullable(), source_sha256: z.string().nullable() });
const PreviewSchema = z.object({ token: z.string(), url: z.string(), width: z.number(), height: z.number(), operation: z.string(), engine: z.string().nullable(), model: z.string().nullable(), ms: z.number().nullable(), transparent: z.boolean() });
const ProgressSchema = z.union([
  z.object({ state: z.literal("done"), preview: PreviewSchema }),
  z.object({ state: z.enum(["queued", "running"]), job: z.string(), percent: z.number().nullable(), label: z.string() }),
  z.object({ state: z.enum(["failed", "cancelled"]), error: z.string(), code: z.string() }),
]);
const refusals = errorResponses({ 400: "Bad request", 401: "Not signed in", 403: "Pictures are off for this profile, or the chat is not theirs", 404: "Picture unavailable", 409: "Cancelled", 413: "Picture too large", 422: "The edit cannot be done", 502: "The editing tools failed", 503: "The editing tools are not available" });

function fail(c: { json: (body: unknown, status: never) => Response }, error: unknown): Response {
  const mapped = error instanceof ImageEditError ? error : editErrorFrom(error);
  return c.json({ error: mapped.message, code: mapped.code }, mapped.status as never);
}

const statusRoute = createRoute({
  method: "get", path: "/status", tags: ["Image editor"], summary: "Which editing tools work right now, and why a tool is off", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ state: z.enum(["ready", "preparing", "not_installed", "unavailable", "off"]), note: z.string().nullable(), tools: z.object({ markup: ToolState, comment: ToolState, remove_background: ToolState, erase: ToolState, resize: ToolState }), limits: z.record(z.string(), z.number()) }) } }, description: "Additive. Read from the engine's image tools status and the person's picture setting." }, ...errorResponses({ 401: "Not signed in" }) },
});
imageEditRoutes.openapi(statusRoute, async (c) => c.json(await editToolsStatus(c.get("person")), 200));

const pictureQuery = z.object({ conversation_id: z.string().min(1).max(80) });
const pictureParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });

const versionsRoute = createRoute({
  method: "get", path: "/pictures/{id}/versions", tags: ["Image editor"], summary: "Every version of a picture, oldest first", middleware: [requireAuth] as const,
  request: { params: pictureParams, query: pictureQuery },
  responses: { 200: { content: { "application/json": { schema: z.object({ versions: z.array(VersionSchema) }) } }, description: "The original and each saved edit." }, ...refusals },
});
imageEditRoutes.openapi(versionsRoute, (c) => {
  const { id } = c.req.valid("param");
  try { return c.json({ versions: listVersions(c.get("person"), c.req.valid("query").conversation_id, id) }, 200); } catch (error) { return fail(c, error) as never; }
});

const pictureRoute = createRoute({
  method: "get", path: "/pictures/{id}", tags: ["Image editor"], summary: "The bytes of a picture or an edited version", middleware: [requireAuth] as const,
  request: { params: pictureParams, query: pictureQuery },
  responses: { 200: { content: { "image/png": { schema: z.string() } }, description: "The picture, as stored (a JPEG upload or a PNG edit)." }, ...refusals },
});
imageEditRoutes.openapi(pictureRoute, (c) => {
  try {
    const { bytes, mediaType } = readPicture(c.get("person"), c.req.valid("query").conversation_id, c.req.valid("param").id);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": mediaType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } }) as never;
  } catch (error) { return fail(c, error) as never; }
});

const editForm = z.object({
  conversation_id: z.string().min(1).max(80),
  operation: z.enum(["remove_background", "depth", "erase", "upscale", "resize", "crop", "adjust", "blur_background", "rotate", "flip"]),
  mask: z.any().optional(),
  scale: z.string().optional(), width: z.string().optional(), height: z.string().optional(), factor: z.string().optional(),
  x: z.string().optional().describe("crop: left edge, 0 to 1 of the width."), y: z.string().optional().describe("crop: top edge, 0 to 1 of the height."),
  aspect: z.enum(["1:1", "4:3", "3:2", "16:9", "9:16"]).optional().describe("crop: a centred crop of this shape (instead of x, y, width and height, which are 0 to 1 here)."),
  brightness: z.string().optional(), contrast: z.string().optional(), saturation: z.string().optional(), warmth: z.string().optional(), auto: z.string().optional().describe("adjust: true for auto tone."),
  radius: z.string().optional().describe("blur_background: blur strength, 1 to 40."), degrees: z.string().optional().describe("rotate: 90, 180 or 270 clockwise."), direction: z.enum(["horizontal", "vertical"]).optional().describe("flip: horizontal or vertical."),
});
const editRoute = createRoute({
  method: "post", path: "/pictures/{id}/edit", tags: ["Image editor"], summary: "Run an editing tool on a picture the person has", middleware: [requireAuth] as const,
  request: { params: pictureParams, body: { content: { "multipart/form-data": { schema: editForm } } } },
  responses: { 200: { content: { "application/json": { schema: ProgressSchema } }, description: "Done (a preview to apply), or running with a job to poll." }, ...refusals },
});
const LOCAL = ["crop", "adjust", "blur_background", "rotate", "flip"] as const;
type LOCAL_OPERATIONS = typeof LOCAL[number];
function wholeNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ImageEditError(422, `Use a whole number from ${min} to ${max}.`, "bad_size");
  return n;
}
imageEditRoutes.openapi(editRoute, async (c) => {
  const actor = c.get("person");
  try {
    const form = await c.req.parseBody();
    const operation = String(form.operation ?? "") as "remove_background" | "depth" | "erase" | "upscale" | "resize" | LOCAL_OPERATIONS;
    if (!["remove_background", "depth", "erase", "upscale", "resize", ...LOCAL].includes(operation)) throw new ImageEditError(400, "Pick a tool to run.", "bad_operation");
    if ((LOCAL as readonly string[]).includes(operation)) {
      // Crop, adjust, blur, rotate and flip run in Home on the registry's own argument rules (fractions, not pixels: a crop's width and height are 0 to 1).
      const number = (name: string) => (form[name] === undefined || form[name] === "" ? {} : { [name]: Number(form[name]) });
      const text = (name: string) => (typeof form[name] === "string" && form[name] !== "" ? { [name]: form[name] } : {});
      const local = { ...number("x"), ...number("y"), ...number("width"), ...number("height"), ...text("aspect"), ...number("brightness"), ...number("contrast"), ...number("saturation"), ...number("warmth"), ...(form.auto === undefined ? {} : { auto: form.auto === "true" }), ...number("radius"), ...number("degrees"), ...text("direction") };
      const started = await runPictureEdit(actor, operation, { source: { kind: "picture", via: "chat", id: c.req.valid("param").id, conversationId: String(form.conversation_id ?? "") }, args: local }, c.req.raw.signal);
      return c.json("job" in started ? started.job : started.file, 200) as never;
    }
    const mask = form.mask instanceof File ? new Uint8Array(await form.mask.arrayBuffer()) : undefined;
    if (mask && mask.byteLength > 20 * 1024 * 1024) throw new ImageEditError(413, "The painted area is too big. Paint a smaller area.", "too_large");
    const scale = wholeNumber(form.scale, 2, 4);
    if (scale !== undefined && scale !== 2 && scale !== 4) throw new ImageEditError(422, "Upscale by 2 or 4.", "bad_scale");
    const width = wholeNumber(form.width, 1, 8000);
    const height = wholeNumber(form.height, 1, 8000);
    if (operation === "resize" && (width === undefined || height === undefined)) throw new ImageEditError(422, "Give a width and a height to resize to.", "size_required");
    if (operation === "upscale" && scale === undefined) throw new ImageEditError(422, "Upscale by 2 or 4.", "bad_scale");
    const args = { ...(mask ? { mask } : {}), ...(scale !== undefined ? { scale } : {}), ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) };
    const result = await runPictureEdit(actor, operation, { source: { kind: "picture", via: "chat", id: c.req.valid("param").id, conversationId: String(form.conversation_id ?? "") }, args }, c.req.raw.signal);
    return c.json("job" in result ? result.job : result.file, 200) as never;
  } catch (error) { return fail(c, error) as never; }
});

const jobParams = z.object({ job: z.string().min(1).max(120).openapi({ param: { name: "job", in: "path" } }) });
const jobRoute = createRoute({
  method: "get", path: "/jobs/{job}", tags: ["Image editor"], summary: "Progress of a running edit", middleware: [requireAuth] as const,
  request: { params: jobParams },
  responses: { 200: { content: { "application/json": { schema: ProgressSchema } }, description: "Running with a percent, or done with a preview, or failed." }, ...refusals },
});
imageEditRoutes.openapi(jobRoute, async (c) => {
  try { return c.json(await getMediaOpJob(c.get("person"), c.req.valid("param").job), 200) as never; } catch (error) { return fail(c, error) as never; }
});
const cancelRoute = createRoute({
  method: "delete", path: "/jobs/{job}", tags: ["Image editor"], summary: "Stop a running edit", middleware: [requireAuth] as const,
  request: { params: jobParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Stopped, or it had already finished." }, ...errorResponses({ 401: "Not signed in" }) },
});
imageEditRoutes.openapi(cancelRoute, async (c) => { await cancelEdit(c.get("person"), c.req.valid("param").job); return c.json({ ok: true as const }, 200); });

const previewParams = z.object({ token: z.string().min(1).max(80).openapi({ param: { name: "token", in: "path" } }) });
const previewRoute = createRoute({
  method: "get", path: "/previews/{token}", tags: ["Image editor"], summary: "The PNG an edit produced, before it is applied", middleware: [requireAuth] as const,
  request: { params: previewParams },
  responses: { 200: { content: { "image/png": { schema: z.string() } }, description: "Held in memory about ten minutes." }, ...refusals },
});
imageEditRoutes.openapi(previewRoute, (c) => {
  try {
    const preview = readPreview(c.get("person"), c.req.valid("param").token);
    return new Response(new Uint8Array(preview.png), { headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } }) as never;
  } catch (error) { return fail(c, error) as never; }
});
const applyRoute = createRoute({
  method: "post", path: "/previews/{token}/apply", tags: ["Image editor"], summary: "Save a previewed edit as a new version", middleware: [requireAuth] as const,
  request: { params: previewParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ version: VersionSchema }) } }, description: "The new version; nothing earlier is changed." }, ...refusals },
});
imageEditRoutes.openapi(applyRoute, async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { label?: unknown };
    return c.json({ version: await applyPreview(c.get("person"), c.req.valid("param").token, typeof body.label === "string" ? body.label : undefined) }, 200) as never;
  } catch (error) { return fail(c, error) as never; }
});

const saveRoute = createRoute({
  method: "post", path: "/pictures/{id}/versions", tags: ["Image editor"], summary: "Save a picture drawn in the browser (markup) as a new version", middleware: [requireAuth] as const,
  request: { params: pictureParams, body: { content: { "multipart/form-data": { schema: z.object({ conversation_id: z.string().min(1).max(80), image: z.any(), label: z.string().max(80).optional() }) } } } },
  responses: { 201: { content: { "application/json": { schema: z.object({ version: VersionSchema }) } }, description: "The new version." }, ...refusals },
});
imageEditRoutes.openapi(saveRoute, async (c) => {
  try {
    const form = await c.req.parseBody();
    if (!(form.image instanceof File) || form.image.size === 0) throw new ImageEditError(400, "There was no picture to save.", "bad_image");
    if (form.image.size > 40 * 1024 * 1024) throw new ImageEditError(413, "That picture is too big to save. Make it smaller first.", "too_large");
    const version = await saveUploadedVersion(c.get("person"), String(form.conversation_id ?? ""), c.req.valid("param").id, new Uint8Array(await form.image.arrayBuffer()), typeof form.label === "string" ? form.label : "Markup");
    return c.json({ version }, 201) as never;
  } catch (error) { return fail(c, error) as never; }
});

const commentRoute = createRoute({
  method: "post", path: "/pictures/{id}/comment", tags: ["Image editor"], summary: "Ask for a change in words; the pictures are changed in the pointed-at area and returns a preview to apply", middleware: [requireAuth] as const,
  request: { params: pictureParams, body: { content: { "application/json": { schema: z.object({ conversation_id: z.string().min(1).max(80), prompt: z.string().min(1).max(2000), region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().optional(), mask: z.string().max(14_000_000).nullable().optional().describe("IMGEDIT-01: a painted area as a base64 PNG (white is the part to change). Only that area can differ from the original."), reference_id: z.string().min(1).max(80).nullable().optional().describe("IMGEDIT-01: another picture of this chat the change draws on.") }) } } } },
  responses: { 200: { content: { "application/json": { schema: ProgressSchema } }, description: "Running with a job to poll at GET /jobs/{job}, then done with a preview to apply (POST /previews/{token}/apply). Nothing changes until it is applied." }, ...refusals },
});
imageEditRoutes.openapi(commentRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const result = await runPictureEdit(c.get("person"), "change", { source: { kind: "picture", via: "chat", id: c.req.valid("param").id, conversationId: body.conversation_id }, args: { prompt: body.prompt, region: body.region ?? null, maskPng: body.mask ? new Uint8Array(Buffer.from(body.mask, "base64")) : null, referenceId: body.reference_id ?? null } });
    return c.json("job" in result ? result.job : result.file, 200) as never;
  } catch (error) { return fail(c, error) as never; }
});

const wordsRoute = createRoute({
  method: "post", path: "/pictures/{id}/words", tags: ["Image editor"], summary: "Run a picture edit chosen by the model from words", middleware: [requireAuth] as const,
  request: { params: pictureParams, body: { content: { "application/json": { schema: z.object({ conversation_id: z.string().min(1).max(80), prompt: z.string().min(1).max(2000), mask: z.string().max(14_000_000).nullable().optional(), references: z.array(z.string().min(1).max(80)).max(2).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: ProgressSchema } }, description: "The model selected an operation and Home ran it through the media registry." }, ...refusals },
});
imageEditRoutes.openapi(wordsRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const result = await runPictureWords(c.get("person"), { source: { kind: "picture", via: "chat", id: c.req.valid("param").id, conversationId: body.conversation_id }, prompt: body.prompt, mask: body.mask, references: body.references }, c.req.raw.signal);
    return c.json("job" in result ? result.job : result.file, 200) as never;
  } catch (error) { return fail(c, error) as never; }
});
