import { useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuiState } from "@assistant-ui/react";
import type { ThreadComponents } from "@maipai/ui/src/elements/thread.aui";
import { api } from "@/lib/api";
import { companionImageUrl } from "@/apps/chat/companionImage";
import { useCompanionStills, useReplyCompanionClips } from "@/apps/chat/useCompanionAvatar";
import { CompanionSpeechContext } from "@/apps/chat/chatThreadContexts";

export function useReplyFace(): NonNullable<ThreadComponents["replyFace"]> {
  const messages = useAuiState((state) => state.thread.messages);
  const speech = useContext(CompanionSpeechContext);
  const speakers = messages.filter((message) => message.role === "assistant").map((message) => message.metadata.custom?.answered_by as { companion_id: string; name: string; look?: string | null; portrait?: string | null; via?: string } | undefined).filter((speaker): speaker is NonNullable<typeof speaker> => Boolean(speaker));
  const ids = [...new Set(speakers.map((speaker) => speaker.companion_id))];
  const stills = useCompanionStills(ids);
  // The same query the chat page and the directory use (one key, one fetch): its cards carry each companion's portrait key.
  const companionList = useQuery({ queryKey: ["companions"], queryFn: api.companions, retry: false });
  const companions = useMemo(() => companionList.data?.companions ?? [], [companionList.data?.companions]);
  const clipsById = useReplyCompanionClips(ids);
  const lastAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null;
  return useMemo(() => ({
    // This turn's own retained portrait, else the companion's current portrait, else its still, else nothing (the kit draws the seeded face).
    portrait: (speaker) => companionImageUrl(speaker.portrait ?? companions.find(({ id }) => id === speaker.companion_id)?.portrait, stills[speaker.companion_id]),
    clips: (speaker) => clipsById[speaker.companion_id],
    speakingMessageId: speech.isSpeaking ? lastAssistantId : null,
    joinedLabel: (name) => `${name} joined for one question`,
  }), [clipsById, companions, lastAssistantId, speech.isSpeaking, stills]);
}
