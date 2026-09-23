import { describe, expect, test } from "bun:test";
import { voiceDisplayName } from "@/lib/voice/voiceDisplayName";

describe("voiceDisplayName()", () => {
  test("a donated file with a content-hash segment reads as its plain name (the live finding, 2026-09-23)", () => {
    expect(voiceDisplayName("voice-donations/zerocool_enhanced.wav.1e68beda@240.safetensors")).toBe("zerocool enhanced");
  });

  test("a plain wav with underscores reads with spaces, no extension", () => {
    expect(voiceDisplayName("vctk/p228_023_enhanced.wav")).toBe("p228 023 enhanced");
  });

  test("a hyphenated name is left alone (only underscores become spaces)", () => {
    expect(voiceDisplayName("expresso/ex04-confused.wav")).toBe("ex04-confused");
  });

  test("no path segment at all still works on the bare file name", () => {
    expect(voiceDisplayName("nova.wav")).toBe("nova");
  });

  // A code review (2026-09-23): the hash-stripping pattern first matched
  // any trailing run of hex-valid letters, so a real word made only of
  // a-f letters (no digit) would have been silently deleted as if it
  // were a content hash.
  test("a real word that happens to be all hex letters is not mistaken for a hash", () => {
    expect(voiceDisplayName("someone.facade.wav")).toBe("someone.facade");
    expect(voiceDisplayName("decade_of_voices.wav")).toBe("decade of voices");
  });
});
