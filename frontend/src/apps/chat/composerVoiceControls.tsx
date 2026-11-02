"use client";

// VOICE-LIVE-03b (owner's live read of 7d3f83d7 on 8787, 2026-09-23):
// "ChatGPT has character voice selection in Settings, not out on the
// prompt bar." The composer's trailing slot (SHELL-02 slice 6,
// HANDSFREE-01 (b)) drops the chevron's voice-and-microphone menu
// entirely - both moved into Settings' own VoiceCatalogSection.tsx,
// the same code paths, one control surface for a person-scope choice
// instead of two. What stays here is only the waveform trigger, now a
// filled pill (the kit's shipped `variant="default" size="icon"`
// Button - `rounded-full bg-primary`, already the kit's own accessible
// 48px minimum touch target, the closest shipped composition to the
// owner's 44px ask without fighting that floor) carrying lucide's
// `audio-waveform` icon (commons ui-v0.5.37) instead of the `VoiceOrb`
// glyph, matching ChatGPT's own voice-entry affordance. Opens the real
// live voice session (VOICE-LIVE-02, `liveVoiceSession.tsx`, already
// landed) through `voiceSessionContext.tsx`'s `open`/`setOpen`.
import { TooltipIconButton } from "@maipai/ui/src/elements/tooltip-icon-button";
import { getIcon } from "@maipai/ui/src/icons";
import { useHealthQuery } from "@/apps/chat/useChatAvailability";
import { useVoiceSession } from "@/apps/chat/voiceSessionContext";

/** Shared readiness gate for the composer waveform and the chat header Call action. */
export function useVoiceCallReady(disabled = false, engineDown?: string): boolean {
  // The health row every signed-in person can read (not the admin-only Engines overview): listening and speaking can both take a call.
  const ready = useHealthQuery().data?.voice_call_ready === true;
  return !disabled && engineDown === undefined && ready;
}

const AudioWaveformIcon = getIcon("audio-waveform");

// VOICE-LIVE-05 follow-up (Jesse's own live read, 2026-09-23): the pill
// read too large beside the composer's own Dictate/Send buttons
// (thread.aui.tsx's ComposerAction, both `size-7 rounded-full`). Visual
// size matches them exactly now. On-look (owner, 2026-11-01): idle controls
// are quiet (`ghost`, like Dictate); the filled look (`default`, Send's own)
// shows only while a call is open, with aria-pressed saying the same. The kit's `elements/tooltip-icon-button` has no touch-target
// floor of its own, so the 48px hit area (docs/UI.md) is the
// `before:-inset-3` pseudo-element passed through className.
function WaveformButton({ onClick, engineDown, on, busy }: { onClick: () => void; engineDown?: string | undefined; on: boolean; busy: boolean }) {
  return (
    <TooltipIconButton
      tooltip={engineDown === undefined ? "Start a voice conversation" : `Start a voice conversation. ${engineDown}`}
      disabled={engineDown !== undefined || busy}
      type="button"
      variant={on ? "default" : "ghost"}
      size="icon"
      aria-pressed={on}
      className="relative size-7 rounded-full before:absolute before:-inset-3 before:content-['']"
      aria-label={engineDown === undefined ? "Start a voice conversation" : `Start a voice conversation. ${engineDown}`}
      onClick={onClick}
    >
      <AudioWaveformIcon className="size-4" />
    </TooltipIconButton>
  );
}

/** Renders only when both `stt` and `tts` roles are installed, loaded or ready (HANDSFREE-01's
 * own acceptance: "voice and glance have no controls" without them) -
 * absent, not disabled, the same posture Create image and the composer
 * Attach's other role-gated rows already take. */
export function ComposerVoiceControls({ disabled = false, engineDown }: { disabled?: boolean; engineDown?: string | undefined }) {
  // VOICE-LIVE-02: `null` here (no VoiceSessionProvider in this tree)
  // means this component was mounted somewhere other than ChatPage's
  // own composer - the waveform still renders (readyRole alone still
  // gates it), but presses nothing, the same "absent, not a crash"
  // posture the rest of this file already takes for a role that isn't
  // ready.
  const session = useVoiceSession();
  // A running written turn dims the button, it never removes it: a long Thinking or Max answer would otherwise
  // make the icon vanish and come back (owner, 2026-11-01).
  if (!useVoiceCallReady(false, engineDown)) return null;
  return <WaveformButton onClick={() => session?.setOpen(true)} engineDown={engineDown} on={session?.open === true} busy={disabled} />;
}
