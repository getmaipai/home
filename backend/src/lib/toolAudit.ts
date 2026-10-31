import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { toolAudit } from "@/db/schema";
import { newConversationTurnId } from "@/lib/id";

export type ToolAuditDecision = "do" | "ask" | "answered_yes" | "answered_no" | "never" | "undo";
export function recordToolAudit(input: { personId: string; tool: string; action: string; decision: ToolAuditDecision; band: string; count?: number }): void {
  try {
    db.insert(toolAudit).values({ id: newConversationTurnId(), personId: input.personId, tool: input.tool, action: input.action, decision: input.decision, band: input.band, count: input.count ?? 1, at: new Date().toISOString() }).run();
  } catch {
    // An audit failure never changes whether a tool call or answer proceeds.
  }
}

export function listOwnToolAudit(personId: string, limit: number) {
  return db.select().from(toolAudit).where(eq(toolAudit.personId, personId)).orderBy(desc(toolAudit.at)).limit(Math.max(0, Math.floor(limit))).all();
}

export function toolAuditCounts(): Array<{ tool: string; action: string; decision: string; count: number }> {
  return db.select({ tool: toolAudit.tool, action: toolAudit.action, decision: toolAudit.decision, count: sql<number>`sum(${toolAudit.count})` }).from(toolAudit).groupBy(toolAudit.tool, toolAudit.action, toolAudit.decision).all();
}
