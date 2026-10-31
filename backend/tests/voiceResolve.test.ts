import { describe, expect, test } from "bun:test";
import { resolveVoice, voiceMatchesLanguage } from "@/lib/voiceResolve";

const offered = [{ id: "chatterbox-turbo-voice-default" }];
const pocket = [{ id: "pocket-tts-voice-alba" }, { id: "pocket-tts-voice-javert" }];

describe("resolveVoice (VOICE-PICK-01)", () => {
  test("matches language primary subtags", () => {
    expect(voiceMatchesLanguage("es", "es-MX")).toBe(true);
    expect(voiceMatchesLanguage("es", "en")).toBe(false);
    expect(voiceMatchesLanguage("es", "")).toBe(false);
  });
  test("default and empty send nothing", () => {
    expect(resolveVoice("default", offered)).toEqual({ voiceUrl: undefined, unavailable: false });
    expect(resolveVoice("", offered)).toEqual({ voiceUrl: undefined, unavailable: false });
  });
  test("a name the engine does not offer is set aside and flagged", () => {
    expect(resolveVoice("javert", offered)).toEqual({ voiceUrl: undefined, unavailable: true });
  });
  test("a name the engine offers is sent", () => {
    expect(resolveVoice("javert", pocket)).toEqual({ voiceUrl: "javert", unavailable: false });
  });
  test("an unreadable list sends the saved value as before; addresses pass through", () => {
    expect(resolveVoice("javert", null).voiceUrl).toBe("javert");
    expect(resolveVoice("hf://kyutai/tts-voices/a.wav", offered).voiceUrl).toBe("hf://kyutai/tts-voices/a.wav");
  });
});
