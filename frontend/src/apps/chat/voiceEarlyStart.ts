import type { VoiceMode } from "@maipai/ui/src/elements/voice-conversation";

export interface VoiceEarlyStartInput {
  mode: VoiceMode;
  muted: boolean;
  overlapPaused: boolean;
  replySpeaking: boolean;
}

export type VoiceEarlyStartBlocker =
  | "muted"
  | "refused_overlap_paused"
  | "refused_mode_speaking"
  | "refused_mode_thinking"
  | "refused_mode_connecting"
  | "refused_reply_speaking";

export type VoiceEarlyStartDecision = { allow: true } | { allow: false; blocker: VoiceEarlyStartBlocker };

export function decideVoiceEarlyStart(input: VoiceEarlyStartInput): VoiceEarlyStartDecision {
  if (input.muted) return { allow: false, blocker: "muted" };
  if (input.overlapPaused) return { allow: false, blocker: "refused_overlap_paused" };
  if (input.mode === "speaking") return { allow: false, blocker: "refused_mode_speaking" };
  if (input.mode === "thinking") return { allow: false, blocker: "refused_mode_thinking" };
  if (input.mode === "connecting") return { allow: false, blocker: "refused_mode_connecting" };
  if (input.replySpeaking) return { allow: false, blocker: "refused_reply_speaking" };
  return { allow: true };
}
