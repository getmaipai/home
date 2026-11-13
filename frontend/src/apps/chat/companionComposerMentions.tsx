import { ComposerPrimitive, unstable_defaultDirectiveFormatter } from "@assistant-ui/react";
import { ComposerMentions } from "@maipai/ui/src/elements/composer-mentions.aui";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useContext } from "react";
import { WakeWordPersonContext, DraftConversationContext } from "@/apps/chat/chatThreadContexts";
import { useCompanionShells } from "@/lib/companionShells";
import { castMentionItems } from "@/apps/chat/castMentions";
import type { ReactNode } from "react";

export function CompanionComposerMentions({ children }: { children: ReactNode }) {
  const person = useContext(WakeWordPersonContext);
  const conversationId = useContext(DraftConversationContext);
  const shells = useCompanionShells();
  const settings = useQuery({ queryKey: ["settings-values", `person:${person?.id ?? ""}`], queryFn: () => api.settingsValues(`person:${person!.id}`), enabled: Boolean(person?.id), retry: false });
  const currentConversation = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => api.conversation(conversationId!), enabled: Boolean(conversationId), retry: false });
  const companions = useQuery({ queryKey: ["companions"], queryFn: api.companions, retry: false });
  const selected = (Array.isArray(settings.data) ? settings.data : []).find((entry) => entry.key === "persona.active_id")?.value;
  const currentId = currentConversation.data?.companion_id ?? (typeof selected === "string" ? selected : companions.data?.default_id);
  const allowed = companions.data?.allowed === true;
  const companionItems = allowed ? (companions.data?.companions ?? []).filter((card) => card.status === "ready" && card.id !== currentId && !card.is_default).map((card) => ({ id: card.id, type: "person" as const, label: card.name, description: "Companion" })) : [];
  // CREATOR-05: cast items (a distinct type) from the viewer's own cast list, which the server already filtered by band.
  const cast = useQuery({ queryKey: ["cast"], queryFn: api.cast, enabled: Boolean(person?.id), retry: false });
  const castItems = castMentionItems(cast.data?.cast);
  const mentions = [...(shells ? companionItems : []), ...castItems];

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      {children}
      {mentions.length ? <ComposerMentions items={mentions} formatter={unstable_defaultDirectiveFormatter} /> : null}
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
