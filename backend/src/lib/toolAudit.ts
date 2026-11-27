import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { toolAudit } from "@/db/schema";
import { newConversationTurnId } from "@/lib/id";

export type ToolAuditDecision = "do" | "ask" | "answered_yes" | "answered_no" | "never" | "undo" | "intent" | "result";
export function recordToolAudit(input: { personId: string; tool: string; action: string; decision: ToolAuditDecision; band: string; count?: number }): void {
  try {
    db.insert(toolAudit).values({ id: newConversationTurnId(), personId: input.personId, tool: input.tool, action: input.action, decision: input.decision, band: input.band, count: input.count ?? 1, at: new Date().toISOString() }).run();
  } catch {
    // An audit failure never changes whether a tool call or answer proceeds.
  }
}

/** TOOL-INTENT-LINE-01: "about to run X" before a tool that changes something. Tool name and step id only; never arguments or a hash of them (rule 6a). */
export function recordToolIntent(input: { personId: string; tool: string; stepId: string; band: string }): void {
  // Not recordToolAudit: that swallows errors, and a tool must never run with no intent row.
  db.insert(toolAudit).values({ id: newConversationTurnId(), personId: input.personId, tool: input.tool, action: `step:${input.stepId}`, decision: "intent", band: input.band, count: 1, at: new Date().toISOString() }).run();
}

/** The matching "it finished" row, written whether the tool succeeded or failed; only a missing row means the outcome is unknown. */
export function recordToolResult(input: { personId: string; tool: string; stepId: string; band: string }): void {
  recordToolAudit({ personId: input.personId, tool: input.tool, action: `step:${input.stepId}`, decision: "result", band: input.band });
}

/** True when an intent row exists for this step and no result row followed it: the process stopped mid-tool, so it may or may not have happened. */
export function toolOutcomeUnknown(personId: string, tool: string, stepId: string): boolean {
  const where = (decision: string) => and(eq(toolAudit.personId, personId), eq(toolAudit.tool, tool), eq(toolAudit.action, `step:${stepId}`), eq(toolAudit.decision, decision));
  const intent = db.select({ id: toolAudit.id }).from(toolAudit).where(where("intent")).limit(1).get();
  if (!intent) return false;
  return !db.select({ id: toolAudit.id }).from(toolAudit).where(where("result")).limit(1).get();
}

export function listOwnToolAudit(personId: string, limit: number) {
  return db.select().from(toolAudit).where(eq(toolAudit.personId, personId)).orderBy(desc(toolAudit.at)).limit(Math.max(0, Math.floor(limit))).all();
}

export function toolAuditCounts(): Array<{ tool: string; action: string; decision: string; count: number }> {
  return db.select({ tool: toolAudit.tool, action: toolAudit.action, decision: toolAudit.decision, count: sql<number>`sum(${toolAudit.count})` }).from(toolAudit).groupBy(toolAudit.tool, toolAudit.action, toolAudit.decision).all();
}
