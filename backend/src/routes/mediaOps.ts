// IMG-OPS-02: the generic media-operation routes. What a person may run on a kind of file (GET /api/media-ops), running one on a Library picture by
// file id (POST /api/media-ops/{id}), and following the result: poll or stop a slow job, look at the preview, apply it as a NEW Library picture, list a
// picture's versions. The rules live in lib/mediaOps (the registry's gates on every call) and lib/imageEdit.ts (owner only, not in Trash, not locked).
// Additive beside /api/image-edit, which keeps serving a picture in a chat.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { ImageEditError, LIBRARY_SOURCE, applyPreview, cancelEdit, editErrorFrom, listVersions, loadSource, readPicture, readPreview, type EditProgress } from "@/lib/imageEdit";
import { getMediaOpJob, listMediaOps } from "@/lib/mediaOps/registry";
import { MediaOpRequest, startLibraryOp } from "@/lib/mediaOps/http";
import { runPictureWords } from "@/lib/mediaOps/words";
import type { PersonRow } from "@/types";

export const mediaOpsRoutes = apiRouter();

const VersionSchema = z.object({ id: z.string(), url: z.string(), label: z.string(), created_at: z.string(), op: z.string(), width: z.number().nullable(), height: z.number().nullable(), media_type: z.string(), source: z.string().nullable(), source_sha256: z.string().nullable() });
const PreviewSchema = z.object({ token: z.string(), url: z.string(), width: z.number(), height: z.number(), operation: z.string(), engine: z.string().nullable(), model: z.string().nullable(), ms: z.number().nullable(), transparent: z.boolean() });
const ProgressSchema = z.union([
  z.object({ state: z.literal("done"), preview: PreviewSchema }),
  z.object({ state: z.enum(["queued", "running"]), job: z.string(), percent: z.number().nullable(), label: z.string() }),
  z.object({ state: z.enum(["failed", "cancelled"]), error: z.string(), code: z.string() }),
]);
const OperationSchema = z.object({
  id: z.string().describe("Pass this to POST /api/media-ops/{id}."),
  label: z.string(), summary: z.string(),
  input: z.enum(["picture", "video", "audio"]), output: z.enum(["picture", "video", "audio", "data"]),
  controls: z.array(z.record(z.string(), z.unknown())).describe("What to draw for each argument: a mask, a number (min and max), a choice (options) or words."),
  params: z.record(z.string(), z.unknown()).describe("The arguments as a JSON Schema, for building the call."),
  levels: z.array(z.object({ id: z.string(), label: z.string(), summary: z.string(), eta: z.string(), enabled: z.boolean(), reason: z.string().optional() })).optional().describe("Operations with levels (Make clearer): each level's one-line description, time estimate and whether it can run now, with the reason when it cannot."),
  enabled: z.boolean(), reason: z.string().optional().describe("When not enabled: one plain line saying why and what to do."),
});
const refusals = errorResponses({ 400: "Bad request", 401: "Not signed in", 403: "Pictures are off for this profile", 404: "Picture unavailable", 409: "Cancelled", 413: "Picture too large", 422: "The edit cannot be done", 423: "The picture is locked", 502: "The editing tools failed", 503: "The editing tools are not available" });

function fail(c: { json: (body: unknown, status: never) => Response }, error: unknown): Response {
  const mapped = error instanceof ImageEditError ? error : editErrorFrom(error);
  return c.json({ error: mapped.message, code: mapped.code }, mapped.status as never);
}

/** The operations this person may run on this kind of file; with `file_id`, as they stand for that one picture (a locked or not-yours picture is refused the way a run would be). */
export async function describeOperations(actor: PersonRow, query: { input?: "picture"; file_id?: string }) {
  const operations = await listMediaOps(actor, { input: query.input ?? "picture" });
  let blocked: ImageEditError | null = null;
  if (query.file_id) {
    try { loadSource(actor, LIBRARY_SOURCE, query.file_id, false); }
    catch (error) { const mapped = error instanceof ImageEditError ? error : editErrorFrom(error); if (mapped.status === 404) throw mapped; blocked = mapped; }
  }
  return {
    operations: operations.map((operation) => ({
      id: operation.id, label: operation.label, summary: operation.summary, input: operation.input, output: operation.output,
      controls: operation.controls.map((control) => ({ ...control })),
      params: z.toJSONSchema(operation.args, { unrepresentable: "any", io: "input" }) as Record<string, unknown>,
      ...("levels" in operation && operation.levels ? { levels: operation.levels.map((level) => ({ ...level, ...(blocked ? { enabled: false, reason: blocked.message } : {}) })) } : {}),
      enabled: blocked ? false : operation.enabled,
      ...(blocked ? { reason: blocked.message } : operation.reason ? { reason: operation.reason } : {}),
    })),
    note: operations.length === 0 ? "Picture editing is off for this profile. A parent can turn pictures on in settings." : null,
  };
}

const listRoute = createRoute({
  method: "get", path: "/", tags: ["Media operations"], summary: "The operations this person may run on a kind of file, each with its arguments and, when off, why", middleware: [requireAuth] as const,
  request: { query: z.object({ input: z.enum(["picture"]).optional().describe("The kind of file. Pictures today."), file_id: z.string().min(1).max(80).optional().describe("A Library picture: the list then says what can run on that one.") }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ operations: z.array(OperationSchema), note: z.string().nullable() }) } }, description: "Additive. Built from the operation registry for the signed-in person's age, picture settings and the editing tools' state. An empty list with a note means the profile has no picture editing." }, ...refusals },
});
mediaOpsRoutes.openapi(listRoute, async (c) => {
  try { return c.json(await describeOperations(c.get("person"), c.req.valid("query")), 200) as never; } catch (error) { return fail(c, error) as never; }
});

const fileParams = z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" } }) });
const versionsRoute = createRoute({
  method: "get", path: "/files/{id}/versions", tags: ["Media operations"], summary: "Every version of a Library picture, oldest first", middleware: [requireAuth] as const,
  request: { params: fileParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ versions: z.array(VersionSchema) }) } }, description: "The original and each edit saved from it. To undo an edit, open the version before it; nothing is removed." }, ...refusals },
});
mediaOpsRoutes.openapi(versionsRoute, (c) => {
  try { return c.json({ versions: listVersions(c.get("person"), LIBRARY_SOURCE, c.req.valid("param").id) }, 200); } catch (error) { return fail(c, error) as never; }
});

const contentRoute = createRoute({
  method: "get", path: "/files/{id}/content", tags: ["Media operations"], summary: "The bytes of a Library picture or one of its edited versions", middleware: [requireAuth] as const,
  request: { params: fileParams },
  responses: { 200: { content: { "image/png": { schema: z.string() } }, description: "The picture as stored (owner only; a locked or trashed picture is refused)." }, ...refusals },
});
mediaOpsRoutes.openapi(contentRoute, (c) => {
  try {
    const { bytes, mediaType } = readPicture(c.get("person"), LIBRARY_SOURCE, c.req.valid("param").id);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": mediaType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } }) as never;
  } catch (error) { return fail(c, error) as never; }
});

const wordsRoute = createRoute({
  method: "post", path: "/words", tags: ["Media operations"], summary: "Say what to change in words; the model picks the operation and Home runs it on a Library picture", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ file_id: z.string().min(1).max(80), prompt: z.string().min(1).max(2000), mask: z.string().max(14_000_000).nullable().optional().describe("A painted area as a base64 PNG; only that area can differ."), references: z.array(z.string().min(1).max(80)).max(2).optional().describe("Other Library pictures the change draws on.") }) } } } },
  responses: { 200: { content: { "application/json": { schema: ProgressSchema } }, description: "Running with a job to poll at GET /api/media-ops/jobs/{job}, or done with a preview to apply." }, ...refusals },
});
mediaOpsRoutes.openapi(wordsRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const result = await runPictureWords(c.get("person"), { source: { kind: "picture", via: "file", id: body.file_id }, prompt: body.prompt, mask: body.mask, references: body.references }, c.req.raw.signal);
    return c.json((("job" in result ? result.job : result.file) as EditProgress) as never, 200);
  } catch (error) { return fail(c, error) as never; }
});

const jobParams = z.object({ job: z.string().min(1).max(120).openapi({ param: { name: "job", in: "path" } }) });
const jobRoute = createRoute({
  method: "get", path: "/jobs/{job}", tags: ["Media operations"], summary: "Progress of a running operation", middleware: [requireAuth] as const,
  request: { params: jobParams },
  responses: { 200: { content: { "application/json": { schema: ProgressSchema } }, description: "Running with a percent, or done with a preview, or failed." }, ...refusals },
});
mediaOpsRoutes.openapi(jobRoute, async (c) => {
  try { return c.json(await getMediaOpJob(c.get("person"), c.req.valid("param").job), 200) as never; } catch (error) { return fail(c, error) as never; }
});
const cancelRoute = createRoute({
  method: "delete", path: "/jobs/{job}", tags: ["Media operations"], summary: "Stop a running operation", middleware: [requireAuth] as const,
  request: { params: jobParams },
  responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Stopped, or it had already finished." }, ...errorResponses({ 401: "Not signed in" }) },
});
mediaOpsRoutes.openapi(cancelRoute, async (c) => { await cancelEdit(c.get("person"), c.req.valid("param").job); return c.json({ ok: true as const }, 200); });

const previewParams = z.object({ token: z.string().min(1).max(80).openapi({ param: { name: "token", in: "path" } }) });
const previewRoute = createRoute({
  method: "get", path: "/previews/{token}", tags: ["Media operations"], summary: "The picture an operation produced, before it is saved", middleware: [requireAuth] as const,
  request: { params: previewParams },
  responses: { 200: { content: { "image/png": { schema: z.string() } }, description: "Held in memory about ten minutes." }, ...refusals },
});
mediaOpsRoutes.openapi(previewRoute, (c) => {
  try {
    const preview = readPreview(c.get("person"), c.req.valid("param").token);
    return new Response(new Uint8Array(preview.png), { headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } }) as never;
  } catch (error) { return fail(c, error) as never; }
});
const applyRoute = createRoute({
  method: "post", path: "/previews/{token}/apply", tags: ["Media operations"], summary: "Save a previewed result as a new Library picture linked to its source", middleware: [requireAuth] as const,
  request: { params: previewParams, body: { required: false, content: { "application/json": { schema: z.object({ label: z.string().max(80).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ version: VersionSchema }) } }, description: "The new picture (kept, no chat, same or stricter audience and adult-only flags as its source); the source is never changed." }, ...refusals },
});
mediaOpsRoutes.openapi(applyRoute, async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { label?: unknown };
    return c.json({ version: await applyPreview(c.get("person"), c.req.valid("param").token, typeof body.label === "string" ? body.label : undefined) }, 200) as never;
  } catch (error) { return fail(c, error) as never; }
});

// Last: the run itself. `id` is an operation id such as picture.crop (the path above never has a dot-free single segment with a verb of its own).
const runRoute = createRoute({
  method: "post", path: "/{id}", tags: ["Media operations"], summary: "Run an operation on a Library picture", middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string().min(1).max(80).openapi({ param: { name: "id", in: "path" }, description: "An operation id from GET /api/media-ops, such as picture.crop." }) }), body: { content: { "application/json": { schema: MediaOpRequest } } } },
  responses: { 200: { content: { "application/json": { schema: ProgressSchema } }, description: "Done (a preview to look at, then POST /previews/{token}/apply), or running with a job to poll at GET /jobs/{job}. Nothing is saved until it is applied." }, ...refusals },
});
mediaOpsRoutes.openapi(runRoute, async (c) => {
  const started = await startLibraryOp(c.get("person"), c.req.valid("param").id, c.req.valid("json"), c.req.raw.signal);
  return (started.ok ? c.json(started.progress as never, 200) : c.json({ error: started.error, code: started.code }, started.status as never)) as never;
});
