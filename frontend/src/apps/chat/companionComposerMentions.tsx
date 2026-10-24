import { ComposerPrimitive, unstable_defaultDirectiveFormatter } from "@assistant-ui/react";
import { ComposerMentions } from "@maipai/ui/src/elements/composer-mentions.aui";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ReactNode } from "react";

export function CompanionComposerMentions({ children }: { children: ReactNode }) {
  const toast = useToast();
  const companions = useQuery({ queryKey: ["companions"], queryFn: api.companions, retry: false });
  const mentions = (companions.data?.companions ?? []).filter((card) => card.status === "ready").map((card) => ({ id: card.id, type: "person" as const, label: card.name }));

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      {children}
      <ComposerMentions items={mentions} formatter={unstable_defaultDirectiveFormatter} onInserted={() => toast.push("Coming soon: asking another companion one question")} />
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
