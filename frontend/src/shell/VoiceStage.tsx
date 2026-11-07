import { i18n } from "@lingui/core";
import { useQuery } from "@tanstack/react-query";
import { CompanionAvatar } from "@maipai/ui/src/elements/companion-avatar";
import { Avatar as SeededAvatar } from "@maipai/ui/src/primitives/Avatar";
import { api } from "@/lib/api";
import { useCompanionPresence } from "@/apps/chat/useCompanionPresence";

type SpokenMode = "connecting" | "listening" | "thinking" | "speaking";
const spokenLine = (name: string, mode: SpokenMode) => ({
  connecting: i18n._({ id: "{name} is connecting", message: "{name} is connecting", values: { name } }),
  listening: i18n._({ id: "{name} is listening", message: "{name} is listening", values: { name } }),
  thinking: i18n._({ id: "{name} is thinking", message: "{name} is thinking", values: { name } }),
  speaking: i18n._({ id: "{name} is speaking", message: "{name} is speaking", values: { name } }),
})[mode];

/** The character on the voice call screen: the companion's animated clips when it has them, else its seeded face. It follows the same real signals as Chat (the one presence hook); the sentence below is for screen readers. */
export function VoiceStage({ conversationId, mode }: { conversationId: string | null; mode: SpokenMode }) {
  const conversation = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => api.conversation(conversationId!), enabled: Boolean(conversationId) });
  const companionId = conversation.data?.companion_id ?? null;
  const presence = useCompanionPresence(companionId);
  return (
    <>
      {presence
        ? <CompanionAvatar name={presence.name} clips={presence.clips} wanted={presence.wanted} once={presence.once} size="xl" onFail={presence.onFail} />
        : <SeededAvatar name="Your companion" seed={companionId ?? "default"} size="profile" />}
      <span className="sr-only" aria-live="polite">{spokenLine(presence?.name ?? i18n._({ id: "Your companion", message: "Your companion" }), mode)}</span>
    </>
  );
}
