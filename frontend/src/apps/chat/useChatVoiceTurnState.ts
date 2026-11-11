import { useCallback, useRef, useState } from "react";
import type { AskAnswerArm } from "@/apps/chat/chatAsk";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

/** STT-SMARTTURN-01: the ids of a turn begun privately on the edge partial, handed to the one send that confirms it. */
export interface SpeculationIds { turnId: string; resumeToken: string; conversationId: string }

/** Shared single-send and scheduler signals used by Chat and the ambient side chat. */
export function useChatVoiceTurnState() {
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const liveVoiceActiveRef = useRef(false);
  const pendingSpeechRef = useRef(false);
  const pendingSpeculationRef = useRef<SpeculationIds | null>(null);
  const activeTurnRef = useRef<{ turnId: string; heardVisibleEnd: () => number } | null>(null);
  const askAnswerRef = useRef<AskAnswerArm | undefined>(undefined);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingEndedAt, setSpeakingEndedAt] = useState(0);
  const [speechFailed, setSpeechFailed] = useState(0);
  const onSpeakingChange = useCallback((speaking: boolean) => {
    setIsSpeaking(speaking);
    if (!speaking) setSpeakingEndedAt((n) => n + 1);
  }, []);
  const onSpeechError = useCallback(() => setSpeechFailed((n) => n + 1), []);
  return { turnSchedulerRef, liveVoiceActiveRef, pendingSpeechRef, pendingSpeculationRef, activeTurnRef, askAnswerRef, isSpeaking, speakingEndedAt, speechFailed, onSpeakingChange, onSpeechError };
}
