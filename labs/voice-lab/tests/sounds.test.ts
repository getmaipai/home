import { expect, test } from "bun:test";
import { availableTags, pickSound, loadSounds, soundVoice, refusedSounds } from "../src/sounds";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the casual voice is offered only sounds that exist for it, and mood variants share them", () => {
  expect(soundVoice("casual_mild_happy")).toBe("casual");
  const tags = availableTags("casual");
  for (const tag of ["laugh", "sigh", "breath"]) expect(tags).toContain(tag);
  for (const tag of ["cough", "clear throat"]) expect(tags).not.toContain(tag); // no same-speaker recording, so not offered
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

import { buildPrompt } from "../src/prompt";
test("the prompt offers exactly the sound tags the voice can make: no tag without a sound", () => {
  const prompt = buildPrompt();
  const line = prompt.split("\n").find((l) => l.startsWith("Sounds you can make:"))!;
  const offered = [...line.split(". ")[0]!.matchAll(/\[([a-z ]+)\]/g)].map((m) => m[1]!);
  expect(offered.sort()).toEqual(availableTags("casual").sort());
  expect(buildPrompt([])).not.toContain("Sounds you can make");
});

test("a sound from another speaker is refused: every library entry must carry the voice's own speaker", () => {
  expect(refusedSounds("casual")).toEqual([]);
  const d = mkdtempSync(join(tmpdir(), "snd-")); mkdirSync(join(d, "v"));
  writeFileSync(join(d, "v", "speaker.json"), JSON.stringify({ speaker: "ex02" }));
  const wav = new Uint8Array(44 + 24000); writeFileSync(join(d, "v", "laugh_1.wav"), wav); writeFileSync(join(d, "v", "laugh_2.wav"), wav); writeFileSync(join(d, "v", "laugh_3.wav"), wav);
  writeFileSync(join(d, "v", "index.json"), JSON.stringify({ "laugh_1.wav": { kind: "laugh", seconds: 0.5, level_vs_speech: 1, speaker: "ex02" }, "laugh_2.wav": { kind: "laugh", seconds: 0.5, level_vs_speech: 1, speaker: "other" }, "laugh_3.wav": { kind: "laugh", seconds: 0.5, level_vs_speech: 1 } }));
  expect(Object.values(loadSounds("v", d)).flat().map((x) => x.file)).toEqual(["laugh_1.wav"]);
  expect(refusedSounds("v", d).sort()).toEqual(["laugh_2.wav", "laugh_3.wav"]);
});
