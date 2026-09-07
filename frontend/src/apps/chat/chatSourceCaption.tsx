import { useAuiState } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Fix B4 (docs/dev.md's "Chat reliability: the 2026-09-07 incident and the
// five fixes"): rendered per assistant message (thread.aui.tsx), the same
// "read straight off the rendered message's own metadata" shape
// chatMemoryChip.tsx's MemoryUpdatedChip already uses - source/pluginId/
// commandId are attached by chatHistoryAdapter.ts (reload) and
// chatModelAdapter.ts (a live reply), both from the exact same TurnValue
// field names (backend/src/wire.ts). Shows nothing for source: "model" -
// only a reply that didn't come from the model itself gets a caption.
type Source = "plugin" | "plugin_error" | "command";

function isCaptionedSource(source: unknown): source is Source {
  return source === "plugin" || source === "plugin_error" || source === "command";
}

export function ChatSourceCaption() {
  const source = useAuiState((s) => s.message.metadata?.custom?.source as string | undefined);
  const pluginId = useAuiState((s) => s.message.metadata?.custom?.pluginId as string | undefined);
  const commandId = useAuiState((s) => s.message.metadata?.custom?.commandId as string | undefined);
  const captioned = isCaptionedSource(source);

  // react-query dedupes an identical queryKey across every message that
  // mounts this component, so a thread with many plugin-answered turns
  // still fetches each list exactly once - the same api.plugins() call
  // chatSuggestionAdapter.ts already makes, just shared here instead of
  // re-fetched per bubble.
  const pluginsQuery = useQuery({
    queryKey: ["chat-source-caption", "plugins"],
    queryFn: () => api.plugins(),
    enabled: captioned && source !== "command" && !!pluginId,
    staleTime: 5 * 60 * 1000,
  });
  const commandsQuery = useQuery({
    queryKey: ["chat-source-caption", "commands"],
    queryFn: () => api.commands(),
    enabled: captioned && source === "command" && !!commandId,
    staleTime: 5 * 60 * 1000,
  });

  if (!captioned) return null;

  // A code review (2026-09-07) found `pluginId` isn't always one real
  // package id: attemptTier2Tools() (turnEngine.ts) joins two tools'
  // ids with "+" ("currency+weather") when a turn answers via both, and
  // no manifest's own id ever equals that compound string - a plain
  // `find()` silently returned nothing and the whole caption vanished
  // for exactly the multi-tool case Tier 2 exists to produce. Split on
  // the same "+" and resolve each id independently, the same shape
  // conversationHistory.ts's own pluginDisplayName() uses for the B3
  // window note.
  const label =
    source === "command"
      ? commandsQuery.data?.find((c) => c.id === commandId)?.trigger
      : pluginId && pluginsQuery.data
        ? pluginId
            .split("+")
            .map((id) => pluginsQuery.data!.find((m) => m.id === id)?.display ?? id)
            .join(" + ")
        : undefined;
  if (!label) return null;

  return <div className="mt-1 text-xs text-muted-foreground">via {label}</div>;
}
