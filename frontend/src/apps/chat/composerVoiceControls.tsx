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
import { useQuery } from "@tanstack/react-query";
import { TooltipIconButton } from "@maipai/ui/src/assistant-ui/tooltip-icon-button";
import { getIcon } from "@maipai/ui/src/icons";
import { readyRole } from "@/apps/chat/engineRoles";
import { useVoiceSession } from "@/apps/chat/voiceSessionContext";
import { api, type EnginesOverview } from "@/lib/api";

const AudioWaveformIcon = getIcon("audio-waveform");

// VOICE-LIVE-05 follow-up (Jesse's own live read, 2026-09-23): the pill
// read too large beside the composer's own Dictate/Send buttons
// (thread.aui.tsx's ComposerAction, both `size-7 rounded-full`). Visual
// size matches them exactly now - `variant="default"` is Send's own
// filled look, the one this control keeps as its "start a call"
// affordance. Two real TooltipIconButton components exist in the kit,
// found reading thread.aui.tsx's own import (checked, not assumed):
// `elements/tooltip-icon-button.tsx`, the vendored/assistant-ui-shaped
// one Dictate and Send actually use, no touch-target floor at all; and
// `assistant-ui/tooltip-icon-button.tsx`, MaiPai's own enhanced copy
// (a `before:-inset-3` pseudo-element keeping a real 48px+ touch target
// regardless of the visual size override, docs/UI.md's own rule) -
// used here on purpose, the same one `liveVoiceSession.tsx`'s own gear
// already uses, since this button is Home's own composition (injected
// through ComposerExtraEnd), never inside the vendored Element itself.
// No accessibility floor forbids the visual match; this control is
// simply safer than its un-augmented vendored neighbors already are.
function WaveformButton({ onClick }: { onClick: () => void }) {
  return (
    <TooltipIconButton
      tooltip="Start a voice conversation"
      type="button"
      variant="default"
      size="icon"
      className="size-7 rounded-full"
      aria-label="Start a voice conversation"
      onClick={onClick}
    >
      <AudioWaveformIcon className="size-4" />
    </TooltipIconButton>
  );
}

/** Renders only when both `stt` and `tts` roles are ready (HANDSFREE-01's
 * own acceptance: "voice and glance have no controls" without them) -
 * absent, not disabled, the same posture Create image and the composer
 * Attach's other role-gated rows already take. */
export function ComposerVoiceControls() {
  const enginesQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines() });
  const overview = enginesQuery.data;
  // VOICE-LIVE-02: `null` here (no VoiceSessionProvider in this tree)
  // means this component was mounted somewhere other than NextChatPage's
  // own composer - the waveform still renders (readyRole alone still
  // gates it), but presses nothing, the same "absent, not a crash"
  // posture the rest of this file already takes for a role that isn't
  // ready.
  const session = useVoiceSession();
  if (!readyRole(overview, "stt") || !readyRole(overview, "tts")) return null;
  return <WaveformButton onClick={() => session?.setOpen(true)} />;
}
