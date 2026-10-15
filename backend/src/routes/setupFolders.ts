// WIZ-STORAGE-02: the setup wizard's folder picker endpoints. Mounted by
// routes/setup.ts BEFORE its `/{step}` catch-all. Access: before an owner
// exists, loopback only (setupLocalOnly on the parent router, SETUP-LOCAL-ONLY-01);
// after, the signed-in owner; refused once setup is complete.
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { apiRouter } from "@/lib/openapi";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resolveHumanSession } from "@/middleware/auth";
import { getSetupState } from "@/lib/setupState";
import { createFolder, listFolder, validateProposedPath } from "@/lib/folderBrowse";
import { checkPlacement } from "@/lib/placement";

export const setupFolderRoutes = apiRouter();

const ErrorBody = z.object({ error: z.string() });
const errs = {
  400: { content: { "application/json": { schema: ErrorBody } }, description: "The request cannot be used as sent." },
  401: { content: { "application/json": { schema: ErrorBody } }, description: "Owner sign-in required." },
  403: { content: { "application/json": { schema: ErrorBody } }, description: "Not allowed here." },
  404: { content: { "application/json": { schema: ErrorBody } }, description: "The folder is gone." },
  409: { content: { "application/json": { schema: ErrorBody } }, description: "Setup is finished, or the name is taken." },
} as const;

/** Returns a refusal response, or null when the caller may use the picker. */
function accessRefusal(c: Context): Response | null {
  if (getSetupState().completed_at) {
    return c.json({ error: "Setup is finished, so this screen is closed. Change where Home keeps its files in Settings, under Storage." }, 409);
  }
  const anyone = db.select({ id: people.id }).from(people).limit(1).get();
  if (!anyone) return null; // loopback already enforced by setupLocalOnly
  const token = getCookie(c, "session");
  const person = token ? resolveHumanSession(token) : null;
  if (!person) return c.json({ error: "Sign in as the owner to choose folders. Open Home and sign in with the owner account." }, 401);
  if (person.role !== "owner") return c.json({ error: "Only the owner can choose folders. Sign in with the owner account." }, 403);
  return null;
}

const FolderRowSchema = z.object({ name: z.string(), path: z.string(), writable: z.boolean() });

const listRoute = createRoute({
  method: "get", path: "/folders", tags: ["Setup"], summary: "List the subfolders of a folder on this computer",
  request: { query: z.object({ path: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({
      path: z.string(), parent: z.string().nullable(), freeBytes: z.number().nullable(), writable: z.boolean(), folders: z.array(FolderRowSchema),
    }) } }, description: "Subfolders only, never file names." },
    ...errs,
  },
});
setupFolderRoutes.openapi(listRoute, (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const result = listFolder(c.req.valid("query").path);
  return result.ok ? c.json(result.value, 200) : (c.json({ error: result.error }, result.status) as never);
});

const createRouteDef = createRoute({
  method: "post", path: "/folders", tags: ["Setup"], summary: "Create one new folder inside a listed folder",
  request: { body: { content: { "application/json": { schema: z.object({ parent: z.string(), name: z.string() }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: FolderRowSchema } }, description: "The new folder." }, ...errs },
});
setupFolderRoutes.openapi(createRouteDef, (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const { parent, name } = c.req.valid("json");
  const result = createFolder(parent, name);
  return result.ok ? c.json(result.value, 200) : (c.json({ error: result.error }, result.status) as never);
});

const PlacementRowSchema = z.object({ class: z.string(), kind: z.enum(["refusal", "warning", "unknown"]), id: z.string(), text: z.string(), fix: z.string() });
const checkRoute = createRoute({
  method: "post", path: "/storage/check", tags: ["Setup"], summary: "Check a proposed storage layout",
  request: { body: { content: { "application/json": { schema: z.object({ models: z.string().optional(), records: z.string() }).strict() } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ rows: z.array(PlacementRowSchema) }) } }, description: "checkPlacement's rows, unchanged." }, ...errs },
});
setupFolderRoutes.openapi(checkRoute, async (c) => {
  const refusal = accessRefusal(c);
  if (refusal) return refusal as never;
  const { models, records } = c.req.valid("json");
  for (const path of [records, ...(models ? [models] : [])]) {
    const problem = validateProposedPath(path);
    if (problem) return c.json({ error: problem }, 400) as never;
  }
  const rows = await checkPlacement({ records, ...(models ? { models } : {}) });
  return c.json({ rows }, 200);
});
