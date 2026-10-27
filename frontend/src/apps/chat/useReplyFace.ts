import { useContext, useMemo } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { ThreadComponents } from "@maipai/ui/src/elements/thread.aui";
import { api } from "@/lib/api";
import { useCompanionStills, useReplyCompanionClips } from "@/apps/chat/useCompanionAvatar";
import { CompanionSpeechContext } from "@/apps/chat/chatThreadContexts";

// A malformed key from an old row must never crash the thread: fall back to no portrait.
function safePortrait(key: string): string | undefined {
  try { return api.companionPortrait(key); } catch { return undefined; }
}

export function useReplyFace(): NonNullable<ThreadComponents["replyFace"]> {
  const messages = useAuiState((state) => state.thread.messages);
  const speech = useContext(CompanionSpeechContext);
  const speakers = messages.filter((message) => message.role === "assistant").map((message) => message.metadata.custom?.answered_by as { companion_id: string; name: string; look?: string | null; portrait?: string | null; via?: string } | undefined).filter((speaker): speaker is NonNullable<typeof speaker> => Boolean(speaker));
  const ids = [...new Set(speakers.map((speaker) => speaker.companion_id))];
  const stills = useCompanionStills(ids);
  const clipsById = useReplyCompanionClips(ids);
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null;
  return useMemo(() => ({
    portrait: (speaker) => speaker.portrait
      ? safePortrait(speaker.portrait)
      : speaker.look ? api.companionLookImage(speaker.companion_id, speaker.look) : stills[speaker.companion_id],
    clips: (speaker) => clipsById[speaker.companion_id],
    speakingMessageId: speech.isSpeaking ? lastAssistantId : null,
    joinedLabel: (name) => `${name} joined for one question`,
  }), [clipsById, lastAssistantId, speech.isSpeaking, stills]);
}
