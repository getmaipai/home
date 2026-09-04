// Typed event bus for wake-word detections (2026-09-04, phase 1 of the
// wake-word plan in docs/dev.md). Ported from `home-legacy.git`'s own
// `frontend/src/lib/voice/wake-word-events.ts`, narrowed to what phase 1
// actually has: no barge-in, follow-up-VAD, or manual activation exist in
// this codebase yet (those need the rest of the voice sidecar, Hub v0.3),
// so this only ever emits the one real origin - a trained ONNX detector
// firing.
export interface WakeDetectedEvent {
  modelId: string;
  score: number;
  threshold: number;
  frameIndex: number;
  timestamp: number;
}

type Listener = (event: WakeDetectedEvent) => void;

const listeners: Set<Listener> = new Set();

export function onWakeDetected(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWakeDetected(event: WakeDetectedEvent): void {
  console.info(`[wakeword] detected "${event.modelId}" (score ${event.score.toFixed(2)} >= ${event.threshold.toFixed(2)})`);
  for (const l of listeners) l(event);
}
