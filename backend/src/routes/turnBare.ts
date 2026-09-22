// ADMIN-COMPARE-01: "Compare with the bare model" - an owner/admin's own
// diagnostic for telling whether a dumb reply is the model or the rest of
// the pipeline (routing, packages, persona, guards). Re-sends the same
// user message with the same conversation history to the chat role, one
// plain system prompt, thinking on, no routing, no packages, no persona,
// no guards - the minor safety pass is the one exception, and it is not
// a removable gate here either (docs/SAFETY.md: "no admin setting...
// may disable or weaken" it), so it runs unconditionally on every bare
// completion, age-banded off the ORIGINAL turn's own speaker, not the
// admin doing the comparing. Nothing from this route is ever persisted
// as a turn.
import { eq } from "drizzle-orm";
import { requireAuth } from "@/middleware/auth";
import { isOwnerOrAdmin } from "@/lib/access";
import { db } from "@/db";
import { conversations, conversationTurns, people } from "@/db/schema";
import { buildConversationWindow, toConversationRecord } from "@/lib/conversationHistory";
import { startBareCompletion } from "@/lib/bareCompletion";
import { StreamSafetyRefusal } from "@/lib/turnEngine";
import { resolvePersona, composePersonaPrompt } from "@/lib/persona";
import { getPersonSettingValue } from "@/lib/settings";
import { feedThinkSplit, flushThinkSplit, newThinkSplitState } from "@/lib/wellFormed";
import { apiRouter } from "@/lib/openapi";
import type { BareCompareEvent, BareCompareTrace, TurnStats } from "@/wire";

export const turnBareRoutes = apiRouter();

const encoder = new TextEncoder();
function ndjsonLine(event: BareCompareEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStats(raw: string | null): TurnStats | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TurnStats;
  } catch {
    return null;
  }
}

turnBareRoutes.post("/", requireAuth, async (c) => {
  const actor = c.get("person");
  if (!isOwnerOrAdmin(actor)) {
    return c.json({ error: "only owner or admin may compare with the bare model" }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { conversation_id?: string; turn_id?: string };
  const conversationId = body.conversation_id;
  const turnId = body.turn_id;
  if (!conversationId || !turnId) {
    return c.json({ error: "conversation_id and turn_id are required", code: "invalid_input" }, 400);
  }

  const conversationRow = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!conversationRow || conversationRow.status === "deleted") {
    return c.json({ error: "conversation not found" }, 404);
  }
  const turnRow = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  if (!turnRow || turnRow.conversationId !== conversationId) {
    return c.json({ error: "turn not found" }, 404);
  }
  // The original turn's own speaker, not the admin doing the comparing -
  // the safety pass below is age-banded off them (a bare reply shown in
  // a child's conversation still has to be safe for the child to read),
  // and the persona trace line reflects their own household member.
  const speakerRow = db.select().from(people).where(eq(people.id, turnRow.personId)).get();
  if (!speakerRow) {
    return c.json({ error: "turn not found" }, 404);
  }

  const conversation = toConversationRecord(conversationRow);
  // beforeCreatedAt: "the same conversation history" means history as it
  // stood AT this turn, not history as it stands now - excludeTurnId
  // alone only drops the named row by id, leaving every turn logged
  // since it (if this isn't the conversation's newest) right in the
  // window alongside it.
  const window = buildConversationWindow(conversation, { excludeTurnId: turnId, beforeCreatedAt: turnRow.createdAt });
  // startBareCompletion() already runs gateOutputSafety() internally,
  // age-banded off `speakerRow` (the original turn's own speaker, not
  // the admin doing the comparing) - the same call this route made
  // inline before the extraction, now the one place either bare-mode
  // caller can get it from.
  const started = await startBareCompletion(window.messages, turnRow.userText, speakerRow, turnId);
  if (!started.ok) {
    return c.json({ error: started.error, code: started.code }, started.status);
  }

  const trace: BareCompareTrace = {
    rung: turnRow.rung,
    rules: parseJsonArray(turnRow.rules),
    routing_tier: turnRow.routingTier,
    routing_score: turnRow.routingScore,
    guard_reason: turnRow.guardReason,
    source: turnRow.source,
    plugin_id: turnRow.pluginId,
    command_id: turnRow.commandId,
    stats: parseStats(turnRow.stats),
    persona_fragments: composePersonaPrompt(resolvePersona(getPersonSettingValue(speakerRow, "persona.active_id"))),
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(ndjsonLine({ type: "trace", trace }));
      const thinkState = newThinkSplitState();
      try {
        // The minor safety pass already ran, inside startBareCompletion()
        // - unconditional, never gated on bare mode itself, age-banded
        // off the original speaker. `started.tokens` is that gated
        // stream, not raw model output.
        for await (const chunk of started.tokens) {
          for (const span of feedThinkSplit(thinkState, chunk)) {
            controller.enqueue(ndjsonLine(span.reasoning ? { type: "reasoning", text: span.text } : { type: "delta", text: span.text }));
          }
        }
        for (const span of flushThinkSplit(thinkState)) {
          controller.enqueue(ndjsonLine(span.reasoning ? { type: "reasoning", text: span.text } : { type: "delta", text: span.text }));
        }
        controller.enqueue(ndjsonLine({ type: "done" }));
      } catch (err) {
        if (err instanceof StreamSafetyRefusal) {
          controller.enqueue(ndjsonLine({ type: "refused" }));
        } else {
          console.error("[turn/bare] generation failed", err);
          controller.enqueue(ndjsonLine({ type: "done" }));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
});
