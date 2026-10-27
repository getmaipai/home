import { useCallback, useEffect, useState } from "react";
import type { Roster } from "@/lib/api";
import { useDeviceWakeWordSetting } from "@/apps/chat/useDeviceWakeWordSetting";
import { useVoiceSession } from "@/apps/chat/voiceSessionContext";
import { useWakeWord, type UseWakeWordOptions } from "@/apps/chat/useWakeWord";
import { WakeWordIndicator } from "@/apps/chat/WakeWordIndicator";
import { playWakeCue } from "@/lib/voice/wakeCue";

type WakeWordRuntime = Pick<UseWakeWordOptions, "startCapture" | "loadModels" | "createLoop">;

// WAKEUX-2026-10-27: a hidden tab stops listening (the browser throttles it and
// the mic light would burn for nothing); it resumes when the tab shows again.
function useTabHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return hidden;
}

export function WakeWordController({ person, runtime }: { person: Roster; runtime?: WakeWordRuntime }) {
  const setting = useDeviceWakeWordSetting(person);
  const persistEnabled = setting.setEnabled;
  const voiceSession = useVoiceSession();
  const openFromWake = voiceSession?.openFromWake;
  const setVoiceOpen = voiceSession?.setOpen;
  const tabHidden = useTabHidden();
  const onWakeDetected = useCallback(() => {
    playWakeCue("heard");
    if (openFromWake) openFromWake();
    else setVoiceOpen?.(true);
  }, [openFromWake, setVoiceOpen]);
  const { enabled, status, start, stop } = useWakeWord({ onWakeDetected, ...runtime });

  useEffect(() => {
    if (!setting.adult || !setting.available || !setting.enabled || tabHidden) {
      if (enabled) void stop();
      return;
    }
    // The explicit live voice session owns its own microphone. Pause the
    // local detector while it is open, then resume this device's opt-in.
    if (voiceSession?.open) {
      if (enabled) void stop();
      return;
    }
    if (!enabled && status === "idle") void start();
  }, [setting.adult, setting.available, setting.enabled, tabHidden, voiceSession?.open, enabled, status, start, stop]);

  const turnOff = useCallback(() => {
    void stop();
    void persistEnabled(false);
  }, [persistEnabled, stop]);

  if (!setting.adult || !setting.available) return null;
  return <WakeWordIndicator status={status} onTurnOff={turnOff} />;
}
