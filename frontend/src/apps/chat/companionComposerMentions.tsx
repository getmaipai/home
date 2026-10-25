import { ComposerPrimitive, unstable_defaultDirectiveFormatter } from "@assistant-ui/react";
import { ComposerMentions } from "@maipai/ui/src/elements/composer-mentions.aui";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useContext } from "react";
import { WakeWordPersonContext, DraftConversationContext } from "@/apps/chat/chatThreadContexts";
import { useCompanionShells } from "@/lib/companionShells";
import type { ReactNode } from "react";

export function CompanionComposerMentions({ children }: { children: ReactNode }) {
  const person = useContext(WakeWordPersonContext);
  const conversationId = useContext(DraftConversationContext);
  const shells = useCompanionShells();
  const settings = useQuery({ queryKey: ["settingsValues", `person:${person?.id ?? ""}`], queryFn: () => api.settingsValues(`person:${person!.id}`), enabled: Boolean(person?.id), retry: false });
  const currentConversation = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => api.conversation(conversationId!), enabled: Boolean(conversationId), retry: false });
  const companions = useQuery({ queryKey: ["companions"], queryFn: api.companions, retry: false });
  const selected = settings.data?.find((entry) => entry.key === "persona.active_id")?.value;
  const currentId = currentConversation.data?.companion_id ?? (typeof selected === "string" ? selected : companions.data?.default_id);
  const allowed = companions.data?.allowed === true;
  const mentions = allowed ? (companions.data?.companions ?? []).filter((card) => card.status === "ready" && card.id !== currentId && !card.is_default).map((card) => ({ id: card.id, type: "person" as const, label: card.name })) : [];

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      {children}
      {shells && mentions.length ? <ComposerMentions items={mentions} formatter={unstable_defaultDirectiveFormatter} /> : null}
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
