import { createContext, useContext } from "react";
import { api, type MemoryRecord } from "@/lib/api";
import { addMemoryId, clearMemoryIds } from "@/apps/chat/chatMemoryState";

// The current household member's own person id, for "remember this"'s
// scope:"person" write (below) - the chat action bar (chatActionBar.tsx)
// renders inside thread.aui.tsx, a vendored component with no notion of
// who's signed in, so ChatPage.tsx provides it once via context rather
// than threading a prop through every layer assistant-ui owns.
export const ChatActorContext = createContext<string | null>(null);

export function useChatActorId(): string {
  const id = useContext(ChatActorContext);
  if (!id) throw new Error("ChatActorContext.Provider is missing an actor id");
  return id;
}

// backend/src/lib/memory.ts's remember() defaults for a one-click "remember
// this" from a chat message, decided 2026-09-05 (checked against
// memory-record.schema.json and the maintenance job's own decay rules,
// not guessed): `category: "fact"` is the schema's catch-all for text
// nothing classified, deliberately not "state" (the maintenance job
// hard-expires state records after 7 days regardless of tier - the one
// outcome an explicit save must never produce). `tier: "durable"`, since
// episodic/observation tiers decay and cap at 200/scope, and a person
// choosing to save something is asking for the opposite of that.
// `scope: "person"`: session-a-intelligence.md's contract says GET
// /api/conversations lists "the actor's conversations" - chat here is a
// private thread per household member, not something the rest of the
// household has already seen, so defaulting to household scope would
// silently widen a private exchange's visibility. `importance: 0.6`:
// above passively-inferred fixtures (~0.2-0.4) since an explicit click is
// a stronger signal, short of claiming top-tier significance (that's
// `pinned`, a separate, stronger action nothing here sets). `pinned`/
// `sensitive` always false: neither can be inferred from a plain click.
//
// CHAT-20: the memory id this creates is written straight into
// chatMemoryState.ts's own store (`addMemoryId`) - the same one the chip
// and the turns-endpoint poll read and write, rather than a separate
// localStorage-backed map (session-a-intelligence.md's real per-turn
// `memory_ids` has since landed on GET /:id/turns, which is what made
// that stopgap obsolete: a reload now shows the exact same real data
// this store was only ever approximating between reloads).
export async function rememberMessage(params: {
  text: string;
  turnId: string;
  conversationId: string;
  actorId: string;
}): Promise<MemoryRecord> {
  const record = await api.remember({
    text: params.text,
    category: "fact",
    tier: "durable",
    scope: "person",
    person: params.actorId,
    source: params.turnId,
    importance: 0.6,
  });
  addMemoryId(params.turnId, params.conversationId, record.id);
  return record;
}

export async function forgetMessage(turnId: string, memoryIds: readonly string[]): Promise<void> {
  if (memoryIds.length === 0) return;
  await Promise.all(memoryIds.map((id) => api.archiveMemory(id)));
  clearMemoryIds(turnId);
}
