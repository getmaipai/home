// COMPANION-FACE-01: the companion a conversation speaks with, read from what the page already loaded (the companion list, the
// conversation record, the person's active companion setting). The chat adapter puts it on a reply from its first yield, so the
// waiting, thinking-words and tool-step states draw the same companion face a finished reply draws. Reads only the cache: no request.
import type { QueryClient } from "@tanstack/react-query";
import type { AnsweredBy } from "@maipai/home-backend/src/wire";
import type { CompanionList, Conversation } from "@/lib/api";

type SettingValue = { key: string; value: unknown };

export function selectedSpeakerFromCache(qc: QueryClient, personId: string, conversationId: string | undefined, tryCompanionId: string | undefined): AnsweredBy | undefined {
  const list = qc.getQueryData<CompanionList>(["companions"]);
  if (!list?.companions?.length) return undefined;
  const conversation = conversationId ? qc.getQueryData<Conversation>(["conversation", conversationId]) : undefined;
  const settings = qc.getQueryData<SettingValue[]>(["settingsValues", `person:${personId}`]);
  const active = Array.isArray(settings) ? settings.find((setting) => setting.key === "persona.active_id")?.value : undefined;
  const activeId = typeof active === "string" && list.companions.some(({ id }) => id === active) ? active : undefined;
  const id = tryCompanionId ?? conversation?.companion_id ?? activeId ?? list.default_id;
  const card = list.companions.find((companion) => companion.id === id);
  if (!card) return undefined;
  return { companion_id: card.id, name: card.name, look: null, via: "conversation", ...(card.portrait ? { portrait: card.portrait } : {}) };
}
