import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { conversations, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { speakerAgeBand } from "@/lib/ageBand";
import { loadManifestOnly } from "@/lib/plugins";
import { projectTypeForArgs, START_PROJECT_TOOL_ID } from "@/lib/projects/tool";
import type { PendingAsk } from "@/lib/conversationHistory";
import type { PersonRow } from "@/types";
import { decide } from "./decide";
import type { AgeBand } from "@/lib/ageBand";

/** Re-evaluate a stored confirmation against the actor's current policy. */
export function decidePendingAsk(
  ask: PendingAsk,
  actor: PersonRow,
  options: { now?: Date; band?: AgeBand; anonymous?: boolean } = {},
) {
  const now = options.now ?? new Date();
  const project = ask.packageId === START_PROJECT_TOOL_ID ? projectTypeForArgs(ask.args) : undefined;
  const loaded = !project && ask.packageId !== START_PROJECT_TOOL_ID ? loadManifestOnly(ask.packageId) : undefined;
  const manifest = loaded?.ok ? loaded.value : undefined;
  const capabilities = ask.capabilities?.length
    ? ask.capabilities
    : project
      ? ["artifact:write"]
      : manifest?.permissions?.length
        ? manifest.permissions
        : [`pending:${ask.packageId}`];
  return decide({
    who: { personId: actor.id, role: actor.role as import("@/middleware/auth").Role, band: options.band ?? speakerAgeBand(actor, now), anonymous: options.anonymous },
    what: {
      capabilities,
      consequential: ask.consequential ?? project?.consequential ?? manifest?.consequential ?? true,
      minRole: project?.minRole ?? manifest?.min_role,
    },
  });
}

/**
 * Boot-time, idempotent compatibility sweep for confirmations parked by
 * older builds. It only touches `confirm` asks; questions and lookups keep
 * their existing lifecycle. Adult self-confirmations and minor self asks
 * stay parked. A parent-required or denied ask is cleared without creating
 * an approval row, since this slice has not shipped parent routing yet.
 */
export function migratePendingAsksThroughGate(): number {
  const rows = db.select({
    conversationId: conversations.id,
    pendingAsk: conversations.pendingAsk,
    person: people,
  }).from(conversations).innerJoin(people, eq(conversations.personId, people.id))
    .where(and(isNotNull(conversations.pendingAsk), ne(conversations.mode, "temporary")))
    .all();
  let cleared = 0;
  for (const row of rows) {
    if (!row.pendingAsk) continue;
    let ask: PendingAsk;
    try {
      ask = JSON.parse(row.pendingAsk) as PendingAsk;
    } catch {
      continue;
    }
    if (ask.kind !== "confirm") continue;
    const decision = decidePendingAsk(ask, row.person);
    if (decision.kind !== "ask_parent" && decision.kind !== "deny") continue;
    const result = sqlite.query("UPDATE conversations SET pending_ask = NULL, updated_at = ?, hlc = ? WHERE id = ? AND pending_ask = ?")
      .run(new Date().toISOString(), nextHlc(), row.conversationId, row.pendingAsk);
    if (result.changes > 0) cleared++;
  }
  if (cleared > 0) console.info(`[gate] cleared ${cleared} legacy parent-required or denied confirmation(s)`);
  return cleared;
}
