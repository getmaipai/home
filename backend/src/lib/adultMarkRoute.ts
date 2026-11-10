import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { getVideoJobByFileFor, getVideoJobFor } from "@/lib/videos/jobs";
import { setItemLock, NOT_READY_LINE, TEMPORARY_LINE } from "@/lib/adultMarks";
import { sessionKeyOf } from "@/lib/adultLock";
import type { PersonRow } from "@/types";
import { isOwnerOrAdmin } from "@/lib/access";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";
import { eq } from "drizzle-orm";

/** Shared body for the chat video and schema driven Videos actions. */
export function adultMarkJobBody(c: Context, actor: PersonRow, body: { id: string; action: "clear" | "mark"; ticket?: string }) {
  const byJobId = getVideoJobFor(actor, body.id);
  const job = byJobId ?? getVideoJobByFileFor(actor, body.id);
  if (!job && body.action === "mark" && isOwnerOrAdmin(actor)) {
    const row = db.select({ files: videoJobs.files, state: videoJobs.state }).from(videoJobs).where(eq(videoJobs.id, body.id)).get();
    try {
      const fileId = row?.state === "done" ? (JSON.parse(row.files) as Array<{ id?: string }>)[0]?.id : undefined;
      if (fileId) return setItemLock({ actor, fileId, action: body.action, ticket: body.ticket ?? null, ticketItem: body.id, sessionKey: sessionKeyOf(getCookie(c, "session")) });
    } catch { /* missing or malformed file list is indistinguishable from no clip */ }
  }
  if (!job) return { ok: false as const, status: 404 as const, error: "That video isn't available any more." };
  if (job.temporary) return { ok: false as const, status: 409 as const, error: TEMPORARY_LINE };
  if (job.state !== "done" || !job.files[0]) return { ok: false as const, status: 409 as const, error: NOT_READY_LINE };
  const fileId = byJobId ? job.files[0].id : body.id;
  return setItemLock({ actor, fileId, action: body.action, ticket: body.ticket ?? null, ticketItem: body.id, sessionKey: sessionKeyOf(getCookie(c, "session")) });
}
