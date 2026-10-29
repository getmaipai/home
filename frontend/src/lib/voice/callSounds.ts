// VOICE-SOUNDS-01: the two sounds around a call with a companion. Starting the call is a bright, bubbly climb
// ("bloop, bloop, ding"); hanging up is a soft, sleepy two-step down ("bip, boop"). They differ in shape, timbre and
// register from each other and from the wake chime (wakeCue.ts: two plain sine notes), so each is recognisable with
// the screen off. Synthesized with Web Audio, no file; a browser that blocks audio stays silent, the overlay is the
// real signal.
export type CallSound = "start" | "end";

interface Blip { from: number; to: number; ms: number; gap: number; type: "sine" | "triangle"; peak: number }

// Pitches are a C major arpeggio going up and a dropping fifth going down; `from` to `to` is the glide inside one note.
export const CALL_SOUNDS: Record<CallSound, readonly Blip[]> = {
  start: [
    { from: 392, to: 523, ms: 90, gap: 25, type: "triangle", peak: 0.09 },
    { from: 523, to: 659, ms: 90, gap: 25, type: "triangle", peak: 0.09 },
    { from: 784, to: 1047, ms: 190, gap: 0, type: "sine", peak: 0.08 },
  ],
  end: [
    { from: 587, to: 440, ms: 130, gap: 45, type: "triangle", peak: 0.07 },
    { from: 392, to: 262, ms: 220, gap: 0, type: "triangle", peak: 0.06 },
  ],
};

interface SoundContext {
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): { type: string; frequency: { setValueAtTime(v: number, t: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown }; connect(n: unknown): unknown; start(t: number): unknown; stop(t: number): unknown; onended: (() => void) | null };
  createGain(): { gain: { setValueAtTime(v: number, t: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown }; connect(n: unknown): unknown };
}

let contextFactory: (() => SoundContext) | null = null;
/** Test seam: build the AudioContext through this when set; null restores the real one. */
export function setCallSoundContextFactory(next: (() => SoundContext) | null): void { contextFactory = next; }

function makeContext(): SoundContext | null {
  if (contextFactory) return contextFactory();
  const g = globalThis as unknown as { AudioContext?: new () => SoundContext; webkitAudioContext?: new () => SoundContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

export function playCallSound(sound: CallSound): void {
  try {
    const ctx = makeContext();
    if (!ctx) return;
    void ctx.resume().catch(() => undefined);
    const blips = CALL_SOUNDS[sound];
    let at = ctx.currentTime;
    blips.forEach((blip, i) => {
      const sec = blip.ms / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = blip.type;
      osc.frequency.setValueAtTime(blip.from, at);
      osc.frequency.exponentialRampToValueAtTime(blip.to, at + sec * 0.8);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(blip.peak, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + sec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (i === blips.length - 1) osc.onended = () => void ctx.close().catch(() => undefined);
      osc.start(at);
      osc.stop(at + sec);
      at += sec + blip.gap / 1000;
    });
  } catch {
    // Silent is fine.
  }
}
