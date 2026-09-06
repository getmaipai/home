// Step 7: the approval queue ("Ask to Install, Ask to Browse" - this
// step's own plan text). Hub-internal, not a spec 3.1 record (the
// `approvals` table's own comment in db/schema.ts): there is nothing
// here another household's hub or the robot needs to read the same way
// a Person or a Grant is, so it never went through spec/schemas/.
//
// A request is made by the person it is about (never on someone else's
// behalf - the whole point is that THEY don't have the grant to just do
// the thing), decided once by an adult, and kept forever in whichever
// state it landed in: "resolved but visible", the same shape GitHub
// issues already use elsewhere in this org's own workflow.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvals } from "@/db/schema";
import { newApprovalId } from "@/lib/id";
import { trigger } from "@/lib/notifications";
import type { OpResult } from "@/lib/entities";

export type ApprovalRow = typeof approvals.$inferSelect;

// A closed, small list on purpose (same reasoning grant-actions.json and
// relationship-types.json give for their own closed vocabularies): a
// free-text `kind` would let any client invent a request type nothing
// downstream knows how to render, summarize, or act on once approved.
// Extend this list (and summarize() below) when a package actually needs
// a new kind of ask.
const KNOWN_KINDS = ["install_package", "browse_url"] as const;
export type ApprovalKind = (typeof KNOWN_KINDS)[number];

export interface ApprovalView {
  id: string;
  kind: string;
  personId: string;
  details: Record<string, unknown>;
  status: "pending" | "approved" | "denied";
  decidedByPersonId: string | null;
  decidedAt: string | null;
  createdAt: string;
}

function toView(row: ApprovalRow): ApprovalView {
  return {
    id: row.id,
    kind: row.kind,
    personId: row.personId,
    details: JSON.parse(row.details) as Record<string, unknown>,
    status: row.status as ApprovalView["status"],
    decidedByPersonId: row.decidedByPersonId,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

function summarize(kind: string, details: Record<string, unknown>): string {
  if (kind === "install_package") return `install "${String(details.packageName ?? details.id ?? "a package")}"`;
  if (kind === "browse_url") return `browse ${String(details.url ?? "a website")}`;
  return kind;
}

export async function requestApproval(
  actor: { id: string; displayName: string },
  kind: string,
  details: Record<string, unknown>,
): Promise<OpResult<ApprovalView>> {
  if (!(KNOWN_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, status: 400, error: `unknown approval kind: ${kind} (must be one of ${KNOWN_KINDS.join(", ")})` };
  }
  const now = new Date().toISOString();
  const row: ApprovalRow = {
    id: newApprovalId(),
    kind,
    personId: actor.id,
    details: JSON.stringify(details),
    status: "pending",
    decidedByPersonId: null,
    decidedAt: null,
    createdAt: now,
  };
  db.insert(approvals).values(row).run();
  // "its declared notification type to the parent audience" (this
  // step's own plan text) - notificationTypes.ts's approvals.requested,
  // audience: "adults", already reaches every adult+ in the house.
  await trigger("approvals.requested", { displayName: actor.displayName, summary: summarize(kind, details) });
  return { ok: true, status: 201, value: toView(row) };
}

export function listApprovals(status?: string): ApprovalView[] {
  const rows = db
    .select()
    .from(approvals)
    .all()
    .filter((r) => (status ? r.status === status : true))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return rows.map(toView);
}

export function decideApproval(actor: { id: string }, id: string, decision: "approved" | "denied"): OpResult<ApprovalView> {
  const row = db.select().from(approvals).where(eq(approvals.id, id)).get();
  if (!row) return { ok: false, status: 404, error: "no such approval" };
  // A code review (2026-09-06) found nothing stopping the same person
  // who filed the request from deciding it themselves - defeating this
  // file's own "decided by a grown-up" premise the moment the requester
  // is an adult (routes/approvals.ts's decide routes are open to any
  // adult, not just owner/admin).
  if (row.personId === actor.id) return { ok: false, status: 403, error: "you cannot decide your own request" };
  // A decision is final - see this file's own header ("resolved but
  // visible"). Re-deciding an already-decided request would let a second
  // adult silently overturn the first one's call with no record of that
  // having happened.
  if (row.status !== "pending") return { ok: false, status: 400, error: `already ${row.status}` };

  const now = new Date().toISOString();
  db.update(approvals).set({ status: decision, decidedByPersonId: actor.id, decidedAt: now }).where(eq(approvals.id, id)).run();
  return { ok: true, status: 200, value: toView({ ...row, status: decision, decidedByPersonId: actor.id, decidedAt: now }) };
}
