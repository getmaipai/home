import { afterEach, describe, expect, test } from "bun:test";
import { playWakeCue, setWakeCueContextFactory, WAKE_CUES } from "@/lib/voice/wakeCue";

afterEach(() => setWakeCueContextFactory(null));

function fakeContext() {
  const freqs: number[] = [];
  let closed = false;
  const ctx = {
    currentTime: 0,
    destination: {},
    resume: async () => {},
    close: async () => { closed = true; },
    createOscillator: () => {
      const osc = { type: "", frequency: { value: 0 }, connect: () => {}, start: () => { freqs.push(osc.frequency.value); }, stop: () => { osc.onended?.(); }, onended: null as (() => void) | null };
      return osc;
    },
    createGain: () => ({ gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }),
  };
  return { ctx, freqs, isClosed: () => closed };
}

describe("WAKEUX wake cues", () => {
  test("the heard cue rises and the closed cue falls", () => {
    for (const cue of ["heard", "closed"] as const) {
      const f = fakeContext();
      setWakeCueContextFactory(() => f.ctx);
      playWakeCue(cue);
      expect(f.freqs).toEqual([...WAKE_CUES[cue].notes]);
      expect(f.isClosed()).toBe(true);
    }
    expect(WAKE_CUES.heard.notes[1]).toBeGreaterThan(WAKE_CUES.heard.notes[0]);
    expect(WAKE_CUES.closed.notes[1]).toBeLessThan(WAKE_CUES.closed.notes[0]);
  });

  test("a browser without audio stays silent", () => {
    setWakeCueContextFactory(() => { throw new Error("blocked"); });
    expect(() => playWakeCue("heard")).not.toThrow();
  });
});
