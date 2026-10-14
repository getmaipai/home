import { describe, expect, test } from "bun:test";
import { toVoiceRow, distinctFilterValues, applyVoiceFilters, presetNameForVoice } from "@/lib/voice/voiceBrowserRows";
import type { StackVoice } from "@/lib/api";

const voice = (id: string, extra: Partial<StackVoice> = {}): StackVoice => ({ id, name: id, description: "unknown", language: "unknown", country: "unknown", gender: "unknown", source: "unknown", onDisk: false, licence: null, revision: "", ...extra });

describe("voice browser row helpers", () => {
  test("keeps unknown metadata and maps country and language as plain text", () => {
    expect(toVoiceRow(voice("x"))).toMatchObject({ description: "unknown", languageCountry: "unknown / unknown", gender: "unknown" });
  });
  test("builds distinct filter values and applies all filters together", () => {
    const rows = [voice("a", { language: "en", country: "US", gender: "female", source: "preset" }), voice("b", { language: "fr", country: "FR", gender: "male", source: "community" })].map(toVoiceRow);
    expect(distinctFilterValues(rows).language).toEqual(["en", "fr"]);
    expect(applyVoiceFilters(rows, { language: "en", country: "__all", gender: "__all", source: "__all" })).toHaveLength(1);
    expect(applyVoiceFilters(rows, { language: "en", country: "US", gender: "__all", source: "preset" })).toHaveLength(1);
  });
  test("maps Stack ids using the resolved setting options", () => {
    expect(presetNameForVoice("engine-a-voice-alba", ["alba", "mira"])).toBe("alba");
    expect(presetNameForVoice("other", ["alba", "mira"])).toBeNull();
  });
});
