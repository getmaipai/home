// The Music modes as data: what each mode of the pill brings, and that the kit gets only the levels this person may use.
import { describe, expect, test } from "bun:test";
import { EMPTY_FORM, EMPTY_SOUND } from "./musicCreateForm";
import { MAKES, RECORD_MAKES, PRESET_LIMIT, fieldOf, isMake, musicMode, musicModes, musicQuality, type MusicComposerInput } from "./musicComposerMode";
import type { VoiceMode } from "./MusicVoiceCreate";

const voiceState = (patch: Partial<VoiceMode> = {}): VoiceMode => ({
  voices: [{ id: "fish", label: "Recorded voice", kind: "preset", engine: "fish-audio-drama-3", tags: ["sighs"] }, { id: "plain", label: "Plain voice", kind: "preset", engine: "chatterbox-turbo", tags: [] }],
  selectedId: "fish", script: "Hello.", setScript: () => undefined, setVoice: () => undefined, operation: "voiceover", setOperation: () => undefined, source: null, clearSource: () => undefined,
  addSource: async () => undefined, uploading: false, making: false, problem: "", results: [], blocker: "", run: () => undefined, clear: () => undefined, ...patch,
}) as VoiceMode;
const base = (patch: Partial<MusicComposerInput> = {}): MusicComposerInput => ({
  make: "song", form: EMPTY_FORM, sound: EMPTY_SOUND, styles: [], bands: [], tiers: ["standard"], reference: null, referenceReason: "", change: "restyle", householdVoices: [], householdVoice: "",
  setChange: () => undefined, setHouseholdVoice: () => undefined, voice: voiceState(),
  setForm: () => undefined, setSound: () => undefined, onPickReference: () => undefined, onPickSource: () => undefined, onClearReference: () => undefined, onTags: () => undefined, onClear: () => undefined, ...patch,
});
const ids = (input: MusicComposerInput) => (musicMode(input).chips ?? []).map((chip) => chip.id);

describe("the Music modes", () => {
  test("the pill offers Song, Sound effect, Voiceover, Band, Album and Style, in that order", () => {
    expect(MAKES().map((one) => one.label)).toEqual(["Song", "Sound effect", "Voiceover", "Band", "Album", "Style"]);
    expect(musicModes(base()).map((one) => one.id)).toEqual(["song", "sound", "voice", "band", "album", "song_style"]);
    expect(RECORD_MAKES).toEqual(["band", "album", "song_style"]);
    expect(isMake("voice")).toBe(true);
    expect(isMake("make")).toBe(false);
  });
  test("every mode has its own words and button; none says to use a form below", () => {
    const modes = musicModes(base());
    expect(new Set(modes.map((one) => one.placeholder)).size).toBe(6);
    expect(modes.map((one) => one.primary?.label)).toEqual(["Make a song", "Make a sound", "Make voiceover", "Make a band", "Make an album", "Make a style"]);
    for (const one of modes) expect(`${one.placeholder} ${one.primary?.label}`).not.toContain("form below");
  });
  test("a song folds Singing, Vocal language and Length into one group, with the starter styles as a Style chip", () => {
    expect(ids(base())).toEqual(["vocals", "language", "length", "starter"]);
    const chips = musicMode(base()).chips ?? [];
    expect(new Set(chips.slice(0, 3).map((chip) => chip.group)).size).toBe(1);
    expect(chips[3]!.options.length).toBeGreaterThan(8);
    expect(musicMode(base()).primary).toEqual({ label: "Make a song", detail: "About a minute" });
    expect(musicMode(base({ form: { ...EMPTY_FORM, takes: 2 } })).primary).toEqual({ label: "Make 2 songs", detail: "About 2 minutes" });
  });
  test("Vocal language is off with a reason while Instrumental is on", () => {
    const chips = musicMode(base({ form: { ...EMPTY_FORM, instrumental: true } })).chips ?? [];
    expect(chips.find((chip) => chip.id === "language")?.disabledReason).toContain("Instrumental");
    expect(chips.find((chip) => chip.id === "vocals")?.value).toBe("instrumental");
  });
  test("an untouched Auto adds nothing to a chip's words, so the trigger stays short on a phone", () => {
    const chips = musicMode(base()).chips ?? [];
    for (const id of ["language", "length", "starter"]) expect(chips.find((chip) => chip.id === id)?.quietValue).toBe("");
  });
  test("choosing a chip writes the form", () => {
    const patches: unknown[] = [];
    const tags: unknown[] = [];
    const chips = musicMode(base({ setForm: (patch) => patches.push(patch), onTags: (next) => tags.push(next) })).chips ?? [];
    chips.find((chip) => chip.id === "length")?.onValueChange("quick");
    chips.find((chip) => chip.id === "language")?.onValueChange("es");
    chips.find((chip) => chip.id === "vocals")?.onValueChange("instrumental");
    chips.find((chip) => chip.id === "starter")?.onValueChange("Soul");
    expect(patches).toEqual([{ length: "quick" }, { language: "es" }, { instrumental: true }]);
    expect(tags).toEqual([["Soul"]]);
  });
  test("a sound shows one group of chips and its own button; the defaults add nothing to the trigger", () => {
    const mode = musicMode(base({ make: "sound" }));
    expect((mode.chips ?? []).map((chip) => chip.id)).toEqual(["seconds", "loop", "stick", "takes"]);
    expect(new Set((mode.chips ?? []).map((chip) => chip.group)).size).toBe(1);
    expect(mode.primary?.label).toBe("Make a sound");
    expect(mode.presets).toBeUndefined();
  });
  test("a band, album or style is made from a name: no chips, its own words, its own button", () => {
    for (const [make, label, words] of [["band", "Make a band", "Name your band"], ["album", "Make an album", "Name your album"], ["song_style", "Make a style", "Name your style"]] as const) {
      const mode = musicMode(base({ make }));
      expect(mode.chips).toEqual([]);
      expect(mode.primary?.label).toBe(label);
      expect(mode.placeholder).toContain(words);
    }
  });
  test("Presets: saved styles and bands, a short list each; the starters are not in it", () => {
    const presets = musicMode(base({ styles: [{ id: "s1", title: "Rainy day" }], bands: [{ id: "b1", name: "The Owls" }] })).presets?.chips ?? [];
    expect(presets.map((chip) => chip.id)).toEqual(["song-style", "band"]);
    expect(presets[0]!.options.map((o) => o.label)).toEqual(["None", "Rainy day"]);
    expect(musicMode(base()).presets).toBeUndefined();
    const many = Array.from({ length: 40 }, (_, index) => ({ id: `s${index}`, title: `Style ${index}` }));
    expect(musicMode(base({ styles: many })).presets?.chips[0]!.options).toHaveLength(PRESET_LIMIT + 1);
  });
  test("a song to change swaps the song chips for the Change chip and keeps the slot", () => {
    const mode = musicMode(base({ reference: { id: "f1", name: "demo.mp3" } }));
    expect(mode.primary?.label).toBe("Change the style");
    expect((mode.chips ?? []).map((chip) => chip.id)).toEqual(["change"]);
    expect(mode.chips![0]!.options.map((o) => o.label)).toEqual(["Change the style", "Remove the vocals", "Split into stems", "Sing it in another voice"]);
    expect(mode.references?.[0]).toMatchObject({ kind: "audio", value: "f1", label: "demo.mp3" });
    expect(mode.presets).toBeUndefined();
  });
  test("Sing it in another voice adds the household voice chip, off with a reason when there are none", () => {
    const none = musicMode(base({ reference: { id: "f1", name: "demo.mp3" }, change: "voice_swap" }));
    expect(none.primary?.label).toBe("Sing it in another voice");
    expect(none.chips!.find((chip) => chip.id === "household-voice")?.disabledReason).toContain("Voices page");
    const some = musicMode(base({ reference: { id: "f1", name: "demo.mp3" }, change: "voice_swap", householdVoices: [{ id: "voice-1", label: "Nova" }] }));
    expect(some.chips!.find((chip) => chip.id === "household-voice")?.disabledReason).toBeUndefined();
  });
  test("choosing in the Change chips tells the page", () => {
    const calls: unknown[] = [];
    const chips = musicMode(base({ reference: { id: "f1", name: "x.mp3" }, change: "voice_swap", householdVoices: [{ id: "v1", label: "Nova" }], setChange: (next) => calls.push(next), setHouseholdVoice: (id) => calls.push(id) })).chips ?? [];
    chips.find((chip) => chip.id === "change")?.onValueChange("stems");
    chips.find((chip) => chip.id === "household-voice")?.onValueChange("v1");
    expect(calls).toEqual(["stems", "v1"]);
  });
  test("Voiceover: Do, Voice and a tag chip for the picked voice; the tag goes after the script", () => {
    const scripts: string[] = [];
    const mode = musicMode(base({ make: "voice", voice: voiceState({ setScript: (next) => scripts.push(next) }) }));
    expect((mode.chips ?? []).map((chip) => chip.id)).toEqual(["operation", "voice", "tag"]);
    mode.chips!.find((chip) => chip.id === "tag")!.onValueChange("sighs");
    expect(scripts).toEqual(["Hello. [sighs]"]);
    expect((musicMode(base({ make: "voice", voice: voiceState({ selectedId: "plain" }) })).chips ?? []).map((chip) => chip.id)).toEqual(["operation", "voice"]);
    expect(mode.references).toEqual([]);
  });
  test("Voiceover, Change a voice: a file slot, its own button and no tag chip", () => {
    const mode = musicMode(base({ make: "voice", voice: voiceState({ operation: "change", source: { id: "f9", name: "clip.mp4" } }) }));
    expect(mode.primary?.label).toBe("Change voice");
    expect(mode.references?.[0]).toMatchObject({ kind: "audio", value: "f9", label: "clip.mp4" });
    expect((mode.chips ?? []).map((chip) => chip.id)).toEqual(["operation", "voice"]);
  });
});

describe("the words in the field", () => {
  test("a song, a sound and a record name use the typed words", () => {
    expect(fieldOf(base({ form: { ...EMPTY_FORM, idea: "rain" } }))).toEqual({ value: "rain", typed: true });
    expect(fieldOf(base({ make: "band", form: { ...EMPTY_FORM, idea: "The Owls" } }))).toEqual({ value: "The Owls", typed: true });
  });
  test("a voiceover uses its script", () => {
    expect(fieldOf(base({ make: "voice" }))).toEqual({ value: "Hello.", typed: true });
  });
  test("a change that needs no words says what it does, so the kit has words to send", () => {
    expect(fieldOf(base({ reference: { id: "f", name: "a.mp3" }, change: "parts" }))).toEqual({ value: "Remove the vocals", typed: false });
    expect(fieldOf(base({ reference: { id: "f", name: "a.mp3" }, change: "restyle", form: { ...EMPTY_FORM, idea: "jazz" } }))).toEqual({ value: "jazz", typed: true });
    expect(fieldOf(base({ make: "voice", voice: voiceState({ operation: "change", source: { id: "f", name: "clip.mp4" } }) }))).toEqual({ value: "Change the voice of clip.mp4", typed: false });
    expect(fieldOf(base({ make: "voice", voice: voiceState({ operation: "change" }) })).value).toBe("");
  });
});

describe("the Quality chip", () => {
  test("offers Standard alone by default, and Boost and Max only when the hub lists them", () => {
    expect(musicQuality({ form: EMPTY_FORM, tiers: [], setForm: () => undefined }).options.map((o) => o.value)).toEqual(["standard"]);
    const quality = musicQuality({ form: EMPTY_FORM, tiers: ["standard", "boost", "max"], setForm: () => undefined });
    expect(quality.options.map((o) => `${o.label}: ${o.detail}`)).toEqual(["Standard: Fast", "Boost: More detail", "Max: Best quality"]);
    expect(quality.band).toBe("adult");
  });
  test("choosing a level sets the form's tier", () => {
    const patches: unknown[] = [];
    musicQuality({ form: EMPTY_FORM, tiers: ["standard", "boost"], setForm: (patch) => patches.push(patch) }).onValueChange("boost");
    expect(patches).toEqual([{ tier: "boost" }]);
  });
});
