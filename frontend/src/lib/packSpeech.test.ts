import { describe, expect, test } from "bun:test";
import { PackSpeechBuilder } from "@/lib/packSpeech";

const RATE = 24_000;
/** Speech-like samples: loud bursts of about 150 ms with quiet gaps, so the envelope has words in it. */
function voice(seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < out.length; i++) { const t = i / RATE; out[i] = (Math.sin(t * 2 * Math.PI * 180) * (Math.sin(t * 2 * Math.PI * 3) > -0.2 ? 0.4 : 0.02)); }
  return out;
}
const phones = (word: string) => (word === "hello" ? ["HH", "AH", "L", "OW"] : null);

describe("PackSpeechBuilder", () => {
  test("gives provisional cues at the first audio and final cues once the sentence is complete", () => {
    let now = 0;
    const builder = new PackSpeechBuilder({ phonesFor: () => phones, clock: () => now });
    expect(builder.build()).toBeUndefined();
    builder.sentence(0, "Hello there friend.");
    expect(builder.build()).toBeUndefined();
    const audio = voice(1.2);
    expect(builder.audio(0, audio.slice(0, 6000), RATE, 0)).toBe(true);
    const provisional = builder.build()!;
    expect(provisional.cues.length).toBeGreaterThan(3);
    expect(provisional.joinAt).toBeUndefined();
    expect(builder.audio(0, audio.slice(6000), RATE, 0)).toBe(false);
    now = 0.3;
    builder.end(0);
    const final = builder.build()!;
    expect(final.joinAt).toBeCloseTo(0.3, 5);
    expect(final.cues[final.cues.length - 1]!.t1).toBeGreaterThan(0.8);
    expect(final.cues.every((cue) => cue.t1 >= cue.t0)).toBe(true);
    expect(final.loudness.length).toBeGreaterThan(100);
    expect(final.text).toBe("Hello there friend.");
  });

  test("puts a second sentence after the first on one timeline and keeps the clock monotone", () => {
    let now = 0;
    const builder = new PackSpeechBuilder({ phonesFor: () => phones, clock: () => now });
    builder.sentence(0, "Hello."); builder.sentence(1, "Hello again.");
    builder.audio(0, voice(0.8), RATE, 0); builder.end(0);
    builder.audio(1, voice(1), RATE, 0.8); builder.end(1);
    const speech = builder.build()!;
    const starts = speech.cues.map((cue) => cue.t0);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(speech.cues.some((cue) => cue.t0 >= 0.8)).toBe(true);
    const readings: number[] = [];
    for (const t of [0, 0.2, 0.9, 1.7]) { now = t; readings.push(speech.clock()); }
    expect(readings).toEqual([...readings].sort((a, b) => a - b));
  });

  test("a companion's own emotion wins over the guess from the words, and tags become events", () => {
    const builder = new PackSpeechBuilder({ phonesFor: () => phones, clock: () => 0, emotion: "sad" });
    builder.sentence(0, "I am furious [laugh] right now");
    builder.audio(0, voice(2), RATE, 0); builder.end(0);
    const speech = builder.build()!;
    expect(speech.emotion).toBe("sad");
    expect(speech.events.length).toBe(1);
    expect(speech.text).not.toContain("[laugh]");
    const guessed = new PackSpeechBuilder({ phonesFor: () => phones, clock: () => 0 });
    guessed.sentence(0, "Look out, run!"); guessed.audio(0, voice(1), RATE, 0);
    expect(guessed.build()!.emotion).toBe("alarmed");
  });

  test("remakes cues from the same samples when the dictionary arrives late", () => {
    let known: typeof phones = () => null;
    const builder = new PackSpeechBuilder({ phonesFor: () => known, clock: () => 0 });
    builder.sentence(0, "hello"); builder.audio(0, voice(0.8), RATE, 0); builder.end(0);
    const before = builder.build()!.cues.map((cue) => cue.p).join(" ");
    known = phones; builder.rebuild();
    expect(builder.build()!.cues.map((cue) => cue.p).join(" ")).not.toBe(before);
  });
});
