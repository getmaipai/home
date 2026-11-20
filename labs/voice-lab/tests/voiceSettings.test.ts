import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { voiceSettings, setVoiceSettings, defaultSettings } from "../src/voiceSettings";
import { buildPrompt } from "../src/prompt";

const store = () => { const d = mkdtempSync(join(tmpdir(), "vs-")); mkdirSync(join(d, "casual")); writeFileSync(join(d, "casual", "meta.json"), JSON.stringify({ seconds: 26 })); mkdirSync(join(d, "bruno")); writeFileSync(join(d, "bruno", "meta.json"), JSON.stringify({})); return d; };
test("a voice with no settings gets the lab defaults; mood variants share the base voice's settings", () => {
  const d = store(); expect(voiceSettings("casual", d)).toEqual(defaultSettings()); expect(voiceSettings("casual_mild_sad", d)).toEqual(defaultSettings());
  setVoiceSettings("casual", { stumble: "heavy", moodStrength: "full" }, d);
  expect(voiceSettings("casual_mild_sad", d)).toEqual({ stumble: "heavy", moodStrength: "full" });
  expect(voiceSettings("bruno", d)).toEqual(defaultSettings());
  expect(JSON.parse(readFileSync(join(d, "casual", "meta.json"), "utf8")).seconds).toBe(26); // the rest of the voice's record is kept
});
test("bad values and unknown voices are refused; the stumble level reaches the prompt", () => {
  const d = store(); expect(() => setVoiceSettings("casual", { stumble: "wild" }, d)).toThrow(); expect(() => setVoiceSettings("../x", { stumble: "none" }, d)).toThrow();
  expect(buildPrompt([], "none")).toContain("clean, fluent sentences"); expect(buildPrompt([], "heavy")).toContain("stumbles a lot");
});
