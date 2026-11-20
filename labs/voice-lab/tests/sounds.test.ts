import { expect, test } from "bun:test";
import { availableTags, pickSound, loadSounds, soundVoice } from "../src/sounds";

test("the casual voice has real recordings for every tag the prompt offers, and mood variants share them", () => {
  expect(soundVoice("casual_mild_happy")).toBe("casual");
  const tags = availableTags("casual");
  for (const tag of ["laugh", "chuckle", "sigh", "breath", "cough", "clear throat", "gasp"]) expect(tags).toContain(tag);
});
test("every offered tag really yields audible, level-matched audio, and a voice with no recordings yields nothing", () => {
  for (const tag of availableTags("casual")) {
    const pcm = pickSound("casual", tag, 0.08)!;
    expect(pcm).not.toBeNull();
    expect(pcm.length).toBeGreaterThan(24000 * 0.15);
    let sum = 0; for (const v of pcm) sum += (v / 32768) ** 2; const rms = Math.sqrt(sum / pcm.length);
    expect(rms).toBeGreaterThan(0.004); expect(rms).toBeLessThan(0.4);
  }
  expect(availableTags("no_such_voice")).toEqual([]);
  expect(pickSound("no_such_voice", "laugh", 0.08)).toBeNull();
  expect(Object.keys(loadSounds("me"))).toEqual([]);
});
