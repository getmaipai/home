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
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { readyRole } from "@/apps/chat/engineRoles";
import { useVoiceSession } from "@/apps/chat/voiceSessionContext";
import { api, type EnginesOverview } from "@/lib/api";

const AudioWaveformIcon = getIcon("audio-waveform");

function WaveformButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" size="icon" aria-label="Start a voice conversation" onClick={onClick}>
      <AudioWaveformIcon className="size-5" />
    </Button>
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
