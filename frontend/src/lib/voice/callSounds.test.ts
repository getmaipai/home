import { afterEach, describe, expect, test } from "bun:test";
import { CALL_SOUNDS, playCallSound, setCallSoundContextFactory } from "@/lib/voice/callSounds";
import { WAKE_CUES } from "@/lib/voice/wakeCue";

afterEach(() => setCallSoundContextFactory(null));

function recordingContext() {
  const played: Array<{ type: string; from: number; to: number; start: number }> = [];
  const ctx = {
    currentTime: 1,
    destination: {},
    resume: async () => {},
    close: async () => {},
    createOscillator: () => {
      const osc = { type: "sine", from: 0, to: 0, frequency: { setValueAtTime: (v: number) => { osc.from = v; }, exponentialRampToValueAtTime: (v: number) => { osc.to = v; } }, connect: () => {}, start: (t: number) => { played.push({ type: osc.type, from: osc.from, to: osc.to, start: t }); }, stop: () => {}, onended: null as (() => void) | null };
      return osc;
    },
    createGain: () => ({ gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }),
  };
  return { ctx, played };
}

describe("call sounds", () => {
  test("starting a call climbs in three notes, hanging up steps down in two", () => {
    const start = recordingContext();
    setCallSoundContextFactory(() => start.ctx);
    playCallSound("start");
    expect(start.played).toHaveLength(3);
    expect(start.played[2]!.from).toBeGreaterThan(start.played[0]!.from);
    const end = recordingContext();
    setCallSoundContextFactory(() => end.ctx);
    playCallSound("end");
    expect(end.played).toHaveLength(2);
    expect(end.played[1]!.to).toBeLessThan(end.played[0]!.from);
  });

  test("notes play one after another, not at once", () => {
    const run = recordingContext();
    setCallSoundContextFactory(() => run.ctx);
    playCallSound("start");
    const starts = run.played.map((n) => n.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(starts.length);
  });

  test("the two sounds, and the wake chimes, are all different from one another", () => {
    const shape = (name: string) => JSON.stringify((CALL_SOUNDS as Record<string, unknown>)[name]);
    expect(shape("start")).not.toBe(shape("end"));
    const callPitches = new Set([...CALL_SOUNDS.start, ...CALL_SOUNDS.end].map((b) => b.from));
    for (const cue of Object.values(WAKE_CUES)) for (const note of cue.notes) expect(callPitches.has(note)).toBe(false);
  });

  test("a browser with no audio stays silent", () => {
    setCallSoundContextFactory(() => { throw new Error("blocked"); });
    expect(() => playCallSound("start")).not.toThrow();
  });
});
