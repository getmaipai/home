import { useCallback, useEffect, useState } from "react";
import type { Roster } from "@/lib/api";
import { useDeviceWakeWordSetting } from "@/apps/chat/useDeviceWakeWordSetting";
import { useWakeWord, type UseWakeWordOptions } from "@/apps/chat/useWakeWord";
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

/** WAKEUX-02: this device's wake word. `onWake` runs after the rising chime (Chat opens the call in place; any other page opens Chat with it).
 * `active` false (the shell hook while Chat is showing) neither listens nor reacts. `voiceOpen` pauses listening while a call owns the microphone. `indicator` is non-null exactly while the mic is open:
 * the caller renders it as the kit launcher's listening state (RULES S2), one per page. */
export function useWakeWordListening({ person, onWake, voiceOpen = false, active = true, runtime }: { person: Roster; onWake: () => void; voiceOpen?: boolean; active?: boolean; runtime?: WakeWordRuntime }) {
  const setting = useDeviceWakeWordSetting(person);
  const persistEnabled = setting.setEnabled;
  const tabHidden = useTabHidden();
  const onWakeDetected = useCallback(() => {
    // The wake event bus is global: only the active site (Chat's own, or the shell's off Chat) reacts.
    if (!active) return;
    playWakeCue("heard");
    onWake();
  }, [active, onWake]);
  const { enabled, status, start, stop } = useWakeWord({ onWakeDetected, ...runtime });

  useEffect(() => {
    if (!setting.adult || !setting.available || !setting.enabled || tabHidden || !active) {
      if (enabled) void stop();
      return;
    }
    // The explicit live voice session owns its own microphone. Pause the
    // local detector while it is open, then resume this device's opt-in.
    if (voiceOpen) {
      if (enabled) void stop();
      return;
    }
    if (!enabled && status === "idle") void start();
  }, [setting.adult, setting.available, setting.enabled, tabHidden, active, voiceOpen, enabled, status, start, stop]);

  const turnOff = useCallback(() => {
    void stop();
    void persistEnabled(false);
  }, [persistEnabled, stop]);

  if (!setting.adult || !setting.available || (!active || (status !== "starting" && status !== "listening"))) return { indicator: null };
  return { indicator: { listening: status === "listening" ? "Listening for Hey Jarvis" : "Starting the microphone", onTurnOff: turnOff } };
}
