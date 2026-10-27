import { useQuery } from "@tanstack/react-query";
import { CompanionAvatar } from "@maipai/ui/src/elements/companion-avatar";
import { Avatar as SeededAvatar } from "@maipai/ui/src/primitives/Avatar";
import { api } from "@/lib/api";
import { useCompanionPresence } from "@/apps/chat/useCompanionPresence";

const SPOKEN = { connecting: "connecting", listening: "listening", thinking: "thinking", speaking: "speaking" } as const;

/** The character on the voice call screen: the companion's animated clips when it has them, else its seeded face. It follows the same real signals as Chat (the one presence hook); the sentence below is for screen readers. */
export function VoiceStage({ conversationId, mode }: { conversationId: string | null; mode: keyof typeof SPOKEN }) {
  const conversation = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => api.conversation(conversationId!), enabled: Boolean(conversationId) });
  const companionId = conversation.data?.companion_id ?? null;
  const presence = useCompanionPresence(companionId);
  return (
    <>
      {presence
        ? <CompanionAvatar name={presence.name} clips={presence.clips} wanted={presence.wanted} once={presence.once} size="xl" onFail={presence.onFail} />
        : <SeededAvatar name="Your companion" seed={companionId ?? "default"} size="profile" />}
      <span className="sr-only" aria-live="polite">{presence?.name ?? "Your companion"} is {SPOKEN[mode]}</span>
    </>
  );
}
