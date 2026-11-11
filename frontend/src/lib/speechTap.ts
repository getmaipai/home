// PACK-06b: a one-way tap on the reply voice. SentenceSpeechScheduler publishes what it speaks (the text and the very samples it
// schedules) so a companion pack can move its mouth with the words. Nothing is copied or published unless someone subscribed.
// Dialog text is passed through to subscribers only; it is never logged (RULES 6a).
export type SpeechSource = {
  /** Seconds since the first sample of this reply played: the audio clock minus the output latency, frozen while paused. */
  speechClock(): number;
};
export type SpeechTapEvent =
  | { type: "sentence"; source: SpeechSource; sentence: number; text: string }
  /** One decoded buffer as scheduled: `at` is where it starts on the reply's own timeline (seconds), `rate` the effective samples per second after any playback speed. */
  | { type: "audio"; source: SpeechSource; sentence: number; samples: Float32Array; rate: number; at: number }
  | { type: "sentenceEnd"; source: SpeechSource; sentence: number }
  /** The reply was cut off or finished: the mouth should settle at once. */
  | { type: "stop"; source: SpeechSource };

type Listener = (event: SpeechTapEvent) => void;
const listeners = new Set<Listener>();

export function subscribeSpeechTap(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const speechTapActive = (): boolean => listeners.size > 0;
export function publishSpeechTap(event: SpeechTapEvent): void {
  for (const listener of [...listeners]) listener(event);
}
