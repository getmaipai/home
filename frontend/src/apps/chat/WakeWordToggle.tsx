import { useEffect, useRef, useState } from "react";
import { startMicCapture, type MicCaptureHandle } from "@/lib/voice/mic-capture";
import { WakeWordLoop } from "@/lib/voice/wake-word-loop";
import { onWakeDetected, type WakeDetectedEvent } from "@/lib/voice/wake-word-events";
import { loadInstalledWakewords, DEFAULT_WAKE_WORD_MODEL_ID } from "@/lib/voice/wake-word-models";

interface WakeWordToggleProps {
  onWakeDetected: (event: WakeDetectedEvent) => void;
}

// Phase 1 of the wake-word plan (docs/dev.md, 2026-09-04): "infrastructure
// proof, no custom model yet" - mic capture feeding onnxruntime-web
// running openWakeWord's own stock "hey jarvis" detector, wired to a real
// wake event. Deliberately the wrong phrase, on purpose: proves the
// mechanism (nothing anywhere in this codebase has ever captured a
// microphone before this) with zero training-data risk, since nothing is
// trained yet. A MaiPai-trained "hey maipai" detector is a later phase,
// gated on real household recordings for validation this session cannot
// fabricate.
export function WakeWordToggle({ onWakeDetected: onWake }: WakeWordToggleProps) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<"idle" | "starting" | "listening" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const micRef = useRef<MicCaptureHandle | null>(null);
  const loopRef = useRef<WakeWordLoop | null>(null);
  // Guards every async continuation below against a superseded toggle:
  // starting mic capture and loading the model registry both await real
  // work, so a rapid on/off/on could otherwise let a stale "started"
  // continuation from the FIRST enable install itself after a later
  // disable already ran cleanup - the same class of stale-continuation
  // bug ChatPage.tsx's own playRequestIdRef guards against for "Listen".
  const requestIdRef = useRef(0);

  useEffect(() => {
    // A code review (2026-09-04) found this didn't bump requestIdRef,
    // unlike stop() below: an in-flight start() (awaiting
    // loadInstalledWakewords()/startMicCapture(), both real awaits) that
    // resolves AFTER unmount saw its own requestId still matching
    // requestIdRef.current, so it happily installed a live mic stream on
    // a dead component instance - nothing left mounted to ever stop it.
    // Bumping it here closes the exact same race stop() already guards
    // against, just triggered by navigating away instead of a second
    // click.
    return () => {
      requestIdRef.current++;
      micRef.current?.stop();
      loopRef.current?.setEnabled(false);
    };
  }, []);

  useEffect(() => {
    // logActivation() in the ported event bus already logs every fire;
    // this just forwards it to the caller (ChatPage's banner).
    return onWakeDetected(onWake);
  }, [onWake]);

  async function stop() {
    requestIdRef.current++;
    micRef.current?.stop();
    micRef.current = null;
    loopRef.current?.setEnabled(false);
    loopRef.current = null;
    setEnabled(false);
    setStatus("idle");
  }

  async function start() {
    const requestId = ++requestIdRef.current;
    setEnabled(true);
    setStatus("starting");
    setError(null);
    try {
      await loadInstalledWakewords();
      if (requestId !== requestIdRef.current) return; // superseded mid-load
      const loop = new WakeWordLoop({ modelId: DEFAULT_WAKE_WORD_MODEL_ID });
      loop.setEnabled(true);
      loop.onError = (err) => {
        if (requestId !== requestIdRef.current) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Wake-word inference failed.");
      };
      const mic = await startMicCapture({ onFrame: (frame) => loop.pushFrame(frame) });
      if (requestId !== requestIdRef.current) {
        mic.stop();
        loop.setEnabled(false);
        return;
      }
      micRef.current = mic;
      loopRef.current = loop;
      setStatus("listening");
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setEnabled(false);
      setStatus("error");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was denied."
          : err instanceof Error
            ? err.message
            : "Could not start the microphone.",
      );
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => (enabled ? stop() : start())}
        aria-pressed={enabled}
        className={`rounded-full px-3 py-1 text-sm transition-colors ${
          enabled
            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
        }`}
      >
        {status === "listening"
          ? 'Wake word: listening for "hey jarvis"'
          : status === "starting"
            ? "Wake word: starting…"
            : "Wake word (experimental)"}
      </button>
      {error ? <span className="text-sm text-[hsl(var(--destructive))]">{error}</span> : null}
    </div>
  );
}
