// CREATOR-02/18: the maker sees the full record; a person with Library access sees its public fields. Hidden files answer "not found" and locked files return only the lock tile.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { fileLockState, lockedView } from "@/lib/adultLock";
import { backfillCreationForFile } from "@/lib/creations/backfill";
import { creationOfFile, readCreationByFile, updateCreationReview } from "@/lib/creations/store";
import { attachments } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { canAccessFile } from "@/lib/access";

export const creationsRoutes = apiRouter();
creationsRoutes.use("*", requireAuth);

const CreationReadSchema = z.object({ id: z.string(), kind: z.string(), file_ids: z.array(z.string()), recipe: z.object({ tool: z.string(), route: z.string() }).nullable(), words: z.unknown().optional(), plan: z.unknown().optional(), cast: z.array(z.unknown()), sources: z.array(z.unknown()), generation: z.unknown().nullable().optional(), settings: z.record(z.string(), z.unknown()), checks: z.unknown().nullable().optional() }).passthrough();
const byFileRoute = createRoute({ method: "get", path: "/by-file/{fileId}", tags: ["Creations"], summary: "Read how a picture was made", middleware: [requireAuth] as const,
  request: { params: z.object({ fileId: z.string().min(1).max(120).openapi({ param: { name: "fileId", in: "path" } }) }) },
  responses: { 200: { description: "The creation record, with private fields only for its maker", content: { "application/json": { schema: CreationReadSchema } } }, 404: { description: "File is not visible", content: { "text/plain": { schema: z.string() } } }, 423: { description: "The file is locked", content: { "application/json": { schema: z.object({ locked: z.literal(true), making: z.boolean(), code: z.literal("locked") }) } } }, ...errorResponses({ 401: "Not signed in" }) },
});
creationsRoutes.openapi(byFileRoute, (c) => {
  const actor = c.get("person");
  const fileId = c.req.param("fileId");
  const read = readCreationByFile(actor, fileId, undefined, backfillCreationForFile);
  if (read.state === "locked") return c.json({ ...lockedView(), code: "locked" as const }, 423);
  if (read.state === "none") {
    const file = db.select({ id: attachments.id, owner: attachments.ownerPersonId, provenance: attachments.provenance }).from(attachments).where(and(eq(attachments.id, fileId), isNull(attachments.deletedAt))).get();
    if (!file || !canAccessFile(actor, file.owner, fileId) || fileLockState(actor, fileId) !== "open") return c.text("Not found", 404);
    const shared = creationOfFile(file.owner, fileId);
    if (!shared) return c.text("Not found", 404);
    const { words: _words, plan: _plan, ...safe } = shared;
    return c.json(safe, 200);
  }
  return c.json(read.creation, 200);
});

creationsRoutes.post("/by-file/:fileId/review", async (c) => {
  const read = readCreationByFile(c.get("person"), c.req.param("fileId"));
  if (read.state === "locked") return c.json({ ...lockedView(), code: "locked" }, 423);
  if (read.state === "none") return c.json({ error: "There is no record of how that was made. Open the item from your Library and try again.", code: "not_found" }, 404);
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !["kept", "rejected", "pending"].includes((body as { review?: unknown }).review as string)) {
    return c.json({ error: "Review must be kept, rejected, or pending." }, 400);
  }
  const updated = updateCreationReview(c.get("person").id, c.req.param("fileId"), { review: (body as { review: "kept" | "rejected" | "pending" }).review });
  if (!updated) return c.json({ error: "The review could not be saved. Open the item from your Library and try again." }, 404);
  return c.json({ review: updated.review }, 200);
});
