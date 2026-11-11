import { describe, expect, test } from "bun:test";
import { filterVoiceLibrary, type LibraryVoice } from "@/lib/voice/voiceLibraryFilter";
const rows: LibraryVoice[] = [
  { id: "a", name: "London woman", detail: "Woman, England, 30s", gender: "woman", language: "en", languageName: "English", country: "GB", countryName: "England", quality: "best", attribution: "", sampleUrl: "" },
  { id: "b", name: "Dublin man", detail: "Man, Ireland, 40s", gender: "man", language: "en", languageName: "English", country: "IE", countryName: "Ireland", quality: "good", attribution: "", sampleUrl: "" },
];
describe("filterVoiceLibrary", () => {
  test("searches plain fields and combines filters", () => {
    expect(filterVoiceLibrary(rows, { q: "london" }).map((v) => v.id)).toEqual(["a"]);
    expect(filterVoiceLibrary(rows, { gender: "woman", country: "GB" }).map((v) => v.id)).toEqual(["a"]);
    expect(filterVoiceLibrary(rows, { gender: "woman", country: "IE" })).toEqual([]);
  });
});
