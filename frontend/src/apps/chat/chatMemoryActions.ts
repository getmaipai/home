import { createContext, useContext } from "react";
import { create } from "zustand";
import { api, type MemoryRecord } from "@/lib/api";

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

// Memory ids "remember this" (below) just created, keyed by turn id, so
// "forget this" on the SAME message can archive them without a real
// memory_ids field on the message yet (session-a-intelligence.md's
// contract adds `GET /:id/turns`' per-turn `memory_ids: string[]`, not
// merged) - GET /api/memory also has no "by source" filter to check
// this against the server instead. A store, not a plain Map: "forget
// this" (a separate component instance from "remember this", both mounted
// per message) needs to notice the id land the moment the save succeeds,
// not just on its own next unrelated re-render.
//
// Persisted to localStorage, not just in-memory: a code review
// (2026-09-05) found a plain in-memory store lost this the moment the
// page reloaded (which chatHistoryAdapter.ts's own load() does on every
// mount), even though the memory record itself is still real and saved -
// "remember this" would silently create a SECOND record for a message
// already remembered in an earlier page load, and "forget this" would
// look permanently unavailable for a memory that in fact still exists.
// Per-browser, not per-household (the real fix once Session A's per-turn
// memory_ids lands): acceptable given there is no cheaper alternative
// today, and wrong only in the narrow case of the same person remembering
// the same message from two different browsers before either reloads.
const STORAGE_KEY = "maipai.chat.rememberedByTurnId";

function loadPersistedRememberedIds(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistRememberedIds(byTurnId: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byTurnId));
  } catch {
    // Private browsing, disabled storage, or a full quota: the click
    // still saved a real memory record server-side just now: only this
    // purely-local "already saved" tracking is lost, and only until the
    // next successful write.
  }
}

const useRememberedStore = create<{ byTurnId: Record<string, string> }>(() => ({
  byTurnId: loadPersistedRememberedIds(),
}));

function setRemembered(turnId: string, memoryId: string): void {
  useRememberedStore.setState((s) => {
    const byTurnId = { ...s.byTurnId, [turnId]: memoryId };
    persistRememberedIds(byTurnId);
    return { byTurnId };
  });
}

function clearRemembered(turnId: string): void {
  useRememberedStore.setState((s) => {
    const byTurnId = { ...s.byTurnId };
    delete byTurnId[turnId];
    persistRememberedIds(byTurnId);
    return { byTurnId };
  });
}

export function useRememberedMemoryId(turnId: string | undefined): string | undefined {
  return useRememberedStore((s) => (turnId ? s.byTurnId[turnId] : undefined));
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
export async function rememberMessage(params: {
  text: string;
  turnId: string;
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
  setRemembered(params.turnId, record.id);
  return record;
}

export async function forgetMessage(turnId: string): Promise<void> {
  const memoryId = useRememberedStore.getState().byTurnId[turnId];
  if (!memoryId) return;
  await api.archiveMemory(memoryId);
  clearRemembered(turnId);
}
