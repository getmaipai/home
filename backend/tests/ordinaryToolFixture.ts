import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { __resetOrdinaryToolSetForTests } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";

/** Give a routing test the ordinary tools its scripted model reply expects.
 * The synthetic, private fixture turns use the same stored Tier 2 usage that
 * routingStats() reads in production; resetDb() clears them between tests. */
export function offerOrdinaryTools(actor: PersonRow, pluginIds: readonly string[]): void {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const safety: TurnValue["safety"] = {
    flagged: false,
    categories: [],
    action: "allow",
    notify_parent: false,
    matched_signals: [],
    checked_at: new Date().toISOString(),
  };
  for (const pluginId of pluginIds) {
    const turnId = `fixture-tool-usage-${pluginId}-${crypto.randomUUID()}`;
    logTurn(actor, "chat", "fixture ordinary tool use", {
      reply: { text: "Done." },
      source: "plugin",
      plugin_id: pluginId,
      safety,
      conversation_id: conversation.value.id,
      turn_id: turnId,
      routing: { tier: "tool", score: 0 },
    });
  }
  __resetOrdinaryToolSetForTests();
}
