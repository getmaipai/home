import { useCallback, useEffect } from "react";
import type { Roster } from "@/lib/api";
import { useDeviceWakeWordSetting } from "@/apps/chat/useDeviceWakeWordSetting";
import { useVoiceSession } from "@/apps/chat/voiceSessionContext";
import { useWakeWord, type UseWakeWordOptions } from "@/apps/chat/useWakeWord";
import { WakeWordIndicator } from "@/apps/chat/WakeWordIndicator";

type WakeWordRuntime = Pick<UseWakeWordOptions, "startCapture" | "loadModels" | "createLoop">;

export function WakeWordController({ person, runtime }: { person: Roster; runtime?: WakeWordRuntime }) {
  const setting = useDeviceWakeWordSetting(person);
  const persistEnabled = setting.setEnabled;
  const voiceSession = useVoiceSession();
  const setVoiceOpen = voiceSession?.setOpen;
  const onWakeDetected = useCallback(() => setVoiceOpen?.(true), [setVoiceOpen]);
  const { enabled, status, start, stop } = useWakeWord({ onWakeDetected, ...runtime });

  useEffect(() => {
    if (!setting.adult || !setting.available || !setting.enabled) {
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
  }, [setting.adult, setting.available, setting.enabled, voiceSession?.open, enabled, status, start, stop]);

  const turnOff = useCallback(() => {
    void stop();
    void persistEnabled(false);
  }, [persistEnabled, stop]);

  if (!setting.adult || !setting.available) return null;
  return <WakeWordIndicator status={status} onTurnOff={turnOff} />;
}
