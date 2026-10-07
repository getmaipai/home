"use client";

// VOICE-LIVE-02: composerVoiceControls.tsx's own waveform button is
// mounted through the shipped kit's `ComposerExtraEnd` slot
// (VOICE-LIVE-01) - a stable, zero-prop `ComponentType`, the same shape
// `ComposerExtra`/`ComposerThinkingControl` already establish (a
// rendered element is a fresh identity every render; a bare component
// reference is not - chatHeaderData.tsx's own header comment explains
// why this matters). A zero-prop component can't receive the
// `open`/`onOpenChange` state ChatPage.tsx owns directly, so this
// context carries exactly that one pair - nothing else. ChatPage calls
// `useLiveVoiceSession` with the runtime composer, refs and speaking
// state, then renders the kit Dialog and VoiceConversation there.
import { createContext, useContext } from "react";

interface VoiceSessionContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

export const VoiceSessionProvider = VoiceSessionContext.Provider;

/** `null` outside a ChatPage-shaped tree - the same "absent, not a
 * crash" posture every other optional composer piece here takes
 * (composerVoiceControls.tsx's own `readyRole` gate, for one). */
export function useVoiceSession(): VoiceSessionContextValue | null {
  return useContext(VoiceSessionContext);
}
