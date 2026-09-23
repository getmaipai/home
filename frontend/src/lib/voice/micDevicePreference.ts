// VOICE-LIVE-03: the composer's chosen microphone is a per-browser
// preference (the same class as a remembered tab), never a household
// setting - the dictation adapter and the live session read this to
// know which device to open, but nothing here ever reaches the server.
// Mirrors shellNextCache.ts's own shape exactly (a plain read/write
// function pair, not a hook; try/catch around both, since localStorage
// can throw in a private window) - the one existing per-browser-
// preference precedent in this frontend, not a second pattern invented
// for this.
const KEY = "maipai.chat.mic-device-id";

export function readMicDevicePreference(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeMicDevicePreference(deviceId: string): void {
  try {
    localStorage.setItem(KEY, deviceId);
  } catch {
    // Storage blocked (private window, etc.) - silently skip.
  }
}

/** A code review (2026-09-23) found a chosen device that later gets
 * unplugged permanently breaks dictation with no way to recover
 * through the UI: `mic-capture.ts`'s `{ exact: deviceId }` fails
 * loudly by design (never silently opens a different mic than the
 * one chosen), but once only one device remains, `MicrophoneGroup`
 * (RESP-04 f) stops rendering at all, so nothing lets the household
 * pick a different one or clear the stale id. `sttDictationAdapter.ts`
 * calls this on exactly that failure - reverting to "no preference"
 * (the browser's own default input, the behavior before this
 * preference existed) is not silently swapping to a different
 * specific microphone; it is dropping a preference that no longer
 * points at anything real. */
export function clearMicDevicePreference(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked - nothing to clear either way.
  }
}
