import type { SoundContextLike } from "@/lib/vision/faceCaptureSounds";

// FACE-02M: an AudioContext stand-in that records every oscillator started.
export interface Started {
  type: string;
  freq: number;
  start: number;
  stop: number | null;
  peak: number;
  disconnected: boolean;
}

export class FakeContext implements SoundContextLike {
  state: "suspended" | "running" | "closed";
  currentTime = 0;
  destination = {};
  started: Started[] = [];
  created = 0;
  closed = false;
  private ended: Array<{ osc: FakeOsc; rec: Started }> = [];
  constructor(state: "suspended" | "running", private stubborn = false) {
    this.state = state;
  }
  resume() {
    if (!this.stubborn) this.state = "running";
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
  createGain() {
    this.created += 1;
    const g = {
      peak: 0,
      gain: {
        value: 0,
        setValueAtTime: () => {},
        linearRampToValueAtTime: (v: number) => {
          g.peak = Math.max(g.peak, v);
        },
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
      disconnect: () => {
        g.disconnected = true;
      },
      disconnected: false,
    };
    return g;
  }
  createOscillator() {
    this.created += 1;
    const osc: FakeOsc = {
      type: "sine",
      frequency: { value: 0 },
      onended: null,
      connect: (node: unknown) => {
        rec.gainNode = node as ReturnType<FakeContext["createGain"]>;
      },
      disconnect: () => {
        rec.disconnected = true;
      },
      start: (when: number) => {
        rec.start = when;
      },
      stop: (when: number) => {
        rec.stop = when;
        this.ended.push({ osc, rec });
      },
    };
    const rec: Started & { gainNode?: ReturnType<FakeContext["createGain"]> } = {
      type: "sine",
      freq: 0,
      start: -1,
      stop: null,
      peak: 0,
      disconnected: false,
    };
    Object.defineProperty(rec, "freq", { get: () => osc.frequency.value });
    Object.defineProperty(rec, "type", { get: () => osc.type });
    Object.defineProperty(rec, "peak", { get: () => rec.gainNode?.peak ?? 0 });
    this.started.push(rec);
    return osc;
  }
  /** Fire onended for every oscillator that has been told to stop. */
  finishAll() {
    for (const { osc } of this.ended) osc.onended?.();
    this.ended = [];
  }
}
interface FakeOsc {
  type: string;
  frequency: { value: number };
  onended: (() => void) | null;
  connect: (n: unknown) => void;
  disconnect: () => void;
  start: (w: number) => void;
  stop: (w: number) => void;
}

