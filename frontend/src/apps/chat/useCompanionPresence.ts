import { useState } from "react";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import type { CompanionClips, StateId } from "@maipai/ui/src/elements/companion-avatar-machine";
import { useCompanionAvatar } from "@/apps/chat/useCompanionAvatar";
import { useCompanionSignals, type CompanionWanted } from "@/apps/chat/useCompanionSignals";
import { useChatActivity } from "@/apps/chat/chatActivity";
import { useContext } from "react";
import { useAuiState } from "@assistant-ui/react";
import { CompanionSpeechContext, WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

const HIDDEN_KEY = "maipai.companion.avatar.hidden";
function readHidden(): boolean { try { return localStorage.getItem(HIDDEN_KEY) === "true"; } catch { return false; } }
function saveHidden(value: boolean) { try { if (value) localStorage.setItem(HIDDEN_KEY, "true"); else localStorage.removeItem(HIDDEN_KEY); } catch { /* UI state still works when storage is blocked. */ } }

/** What the chat passes to the kit's CompanionAvatar, or null when nothing should be drawn (no ready animated companion, still loading, or its clips failed). */
export function useCompanionPresence() {
  const { avatar, clips, loading } = useCompanionAvatar();
  const person = useContext(WakeWordPersonContext);
  const speech = useContext(CompanionSpeechContext);
  const activity = useChatActivity();
  const messages = useAuiState((state) => state.thread.messages);
  const running = useAuiState((state) => state.thread.isRunning);
  const dictating = useAuiState((state) => state.composer.dictation != null);
  const [hidden, setHiddenState] = useState(readHidden);
  const [failed, setFailed] = useState(false);
  const desktop = useBreakpoint().tier !== "phone";
  const signals = useCompanionSignals({
    personId: person?.id ?? "unknown",
    messages: messages as never,
    running,
    jobRunning: activity.conversationRunning,
    jobWaiting: activity.conversationWaiting,
    runningJobIds: activity.conversationRunningIds,
    doneJobIds: activity.conversationDoneIds,
    isSpeaking: speech.isSpeaking,
    listening: dictating || speech.liveVoiceListening,
  });
  if (!avatar || !clips || loading || failed) return null;
  return {
    name: avatar.name,
    clips: clips as CompanionClips,
    wanted: signals.wanted as CompanionWanted,
    once: signals.once as { state: StateId; nonce: number } | null,
    size: (desktop ? "lg" : "md") as "lg" | "md",
    hidden,
    onHiddenChange: (value: boolean) => { saveHidden(value); setHiddenState(value); },
    onFail: () => setFailed(true),
  };
}
