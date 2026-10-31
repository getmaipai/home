import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { readMicDevicePreference, writeMicDevicePreference } from "@/lib/voice/micDevicePreference";

/** `MediaDeviceInfo.label` is empty until mic permission has been
 * granted at least once (browsers refuse to leak hardware names before
 * that) - the honest fallback name every OS does the same thing for. */
function micLabel(device: MediaDeviceInfo, index: number): string {
  return device.label || `Microphone ${index + 1}`;
}

/** The microphones the browser reports, refreshed on `devicechange` -
 * `enumerateDevices()` itself needs no permission prompt to call, only
 * to return real labels (see `micLabel` above). `navigator.mediaDevices`
 * itself is `undefined` in an insecure context (a review, 2026-09-23: a
 * self-hosted hub reached over plain-HTTP LAN, a plausible way to open
 * it, not just a test environment) - guarded here rather than letting
 * this section throw on mount. */
function useAudioInputDevices(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (typeof navigator.mediaDevices?.enumerateDevices !== "function") return;
    let cancelled = false;
    const refresh = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => {
          if (!cancelled) setDevices(all.filter((d) => d.kind === "audioinput"));
        })
        .catch(() => {
          if (!cancelled) setDevices([]);
        });
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, []);
  return devices;
}

/** VOICE-LIVE-03b: moved here from the composer's chevron (owner's
 * ruling, 2026-09-23: voice controls belong in Settings, not on the
 * prompt bar) - the same code paths, a second control in this same
 * section rather than a section of its own, since it's the same
 * "who's listening/speaking for this person" concern the voice list
 * above already is. `RESP-04 (f)`'s own ruling ("a control with fewer
 * than two selectable entries renders nothing at all, never a disabled
 * trigger") applies here too - a single mic is the common household
 * case (one laptop, no external input) and there is nothing real to
 * choose between. Writes the per-browser preference
 * (`micDevicePreference.ts`) the dictation adapter reads on its own
 * next session - it never re-opens an already-live stream. */
export function MicrophoneSection() {
  const devices = useAudioInputDevices();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(readMicDevicePreference());
  }, []);
  if (devices.length < 2) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-base font-medium">Microphone</h3>
      <p className="text-base text-muted-foreground">The microphone choice is remembered on this device only.</p>
      <ul className="flex flex-col divide-y divide-[var(--border)]">
        {devices.map((device, index) => {
          const active = selected === device.deviceId;
          return (
            <li key={device.deviceId} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-base">{micLabel(device, index)}</span>
              <Button
                variant={active ? "default" : "secondary"}
                disabled={active}
                onClick={() => {
                  writeMicDevicePreference(device.deviceId);
                  setSelected(device.deviceId);
                }}
              >
                {active ? "In use" : "Use this microphone"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
