// WAKEUX-2026-10-27: the two cues around a wake word. A rising two-note
// chime says "heard you"; a falling one says the call closed without a
// request (a false fire or silence). Synthesized with Web Audio like
// faceCaptureSounds.ts: two short tones are not worth a file or a library.
// A browser that blocks audio, or has none, stays silent: the call overlay
// is the real signal and the cue only adds to it.
export type WakeCue = "heard" | "closed";

// Modest on purpose: the loudest note is 0.1 of full scale.
export const WAKE_CUES = {
  heard: { notes: [660, 880], gain: 0.1 },
  closed: { notes: [660, 440], gain: 0.06 },
} as const;
export const WAKE_NOTE_MS = 120;

interface CueContext {
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): { type: string; frequency: { value: number }; connect(n: unknown): unknown; start(t: number): unknown; stop(t: number): unknown; onended: (() => void) | null };
  createGain(): { gain: { setValueAtTime(v: number, t: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown }; connect(n: unknown): unknown };
}

let contextFactory: (() => CueContext) | null = null;
/** Test seam: build the AudioContext through this when set; null restores the real one. */
export function setWakeCueContextFactory(next: (() => CueContext) | null): void {
  contextFactory = next;
}

function makeContext(): CueContext | null {
  if (contextFactory) return contextFactory();
  const g = globalThis as unknown as { AudioContext?: new () => CueContext; webkitAudioContext?: new () => CueContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

let lastWakeCueAt = 0;
/** Milliseconds since a wake cue last played, so the call sounds (callSounds.ts) do not stack on top of one. */
export function msSinceWakeCue(now = Date.now()): number { return now - lastWakeCueAt; }

export function playWakeCue(cue: WakeCue): void {
  lastWakeCueAt = Date.now();
  try {
    const ctx = makeContext();
    if (!ctx) return;
    void ctx.resume().catch(() => undefined);
    const { notes, gain: peak } = WAKE_CUES[cue];
    const noteSec = WAKE_NOTE_MS / 1000;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * noteSec;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(peak, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + noteSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (i === notes.length - 1) osc.onended = () => void ctx.close().catch(() => undefined);
      osc.start(start);
      osc.stop(start + noteSec);
    });
  } catch {
    // Silent is fine.
  }
}
