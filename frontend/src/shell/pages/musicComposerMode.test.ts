// The Music mode as data: what the Make chip decides, and that the kit gets only the levels this person may use.
import { describe, expect, test } from "bun:test";
import { EMPTY_FORM, EMPTY_SOUND } from "./musicCreateForm";
import { FORM_MAKES, MAKES, musicMode, musicQuality, type MusicComposerInput } from "./musicComposerMode";

const base = (patch: Partial<MusicComposerInput> = {}): MusicComposerInput => ({
  make: "song", form: EMPTY_FORM, sound: EMPTY_SOUND, styles: [], bands: [], tiers: ["standard"], reference: null, referenceReason: "",
  setMake: () => undefined, setForm: () => undefined, setSound: () => undefined, onPickReference: () => undefined, onClearReference: () => undefined, onTags: () => undefined, onClear: () => undefined, ...patch,
});
const ids = (input: MusicComposerInput) => (musicMode(input).chips ?? []).map((chip) => chip.id);

describe("the Music mode", () => {
  test("the Make chip offers Song, Band, Album, Style, Sound and Voice", () => {
    expect(MAKES().map((one) => one.label)).toEqual(["Song", "Band", "Album", "Style", "Sound", "Voice"]);
    expect(FORM_MAKES).toEqual(["band", "album", "song_style", "voice"]);
  });
  test("a song shows Make, Singing, Vocal language and Length; the primary says how many songs", () => {
    expect(ids(base())).toEqual(["make", "vocals", "language", "length"]);
    expect(musicMode(base()).primary).toEqual({ label: "Make a song", detail: "About a minute" });
    expect(musicMode(base({ form: { ...EMPTY_FORM, takes: 2 } })).primary).toEqual({ label: "Make 2 songs", detail: "About 2 minutes" });
  });
  test("Vocal language is off with a reason while Instrumental is on", () => {
    const chips = musicMode(base({ form: { ...EMPTY_FORM, instrumental: true } })).chips ?? [];
    expect(chips.find((chip) => chip.id === "language")?.disabledReason).toContain("Instrumental");
    expect(chips.find((chip) => chip.id === "vocals")?.value).toBe("instrumental");
  });
  test("choosing a chip writes the form", () => {
    const patches: unknown[] = [];
    const chips = musicMode(base({ setForm: (patch) => patches.push(patch) })).chips ?? [];
    chips.find((chip) => chip.id === "length")?.onValueChange("quick");
    chips.find((chip) => chip.id === "language")?.onValueChange("es");
    chips.find((chip) => chip.id === "vocals")?.onValueChange("instrumental");
    expect(patches).toEqual([{ length: "quick" }, { language: "es" }, { instrumental: true }]);
  });
  test("a sound shows its own chips and button", () => {
    const mode = musicMode(base({ make: "sound" }));
    expect((mode.chips ?? []).map((chip) => chip.id)).toEqual(["make", "seconds", "loop", "stick", "takes"]);
    expect(mode.primary?.label).toBe("Make a sound");
    expect(mode.presets).toBeUndefined();
  });
  test("a band, album, style or voice sends the person to the form under the composer", () => {
    for (const make of FORM_MAKES) expect(musicMode(base({ make })).primary?.label).toBe("Use the form below");
  });
  test("Presets: saved styles and bands first, then the built-in starters", () => {
    const presets = musicMode(base({ styles: [{ id: "s1", title: "Rainy day" }], bands: [{ id: "b1", name: "The Owls" }] })).presets?.chips ?? [];
    expect(presets.map((chip) => chip.id)).toEqual(["song-style", "band", "starter"]);
    expect(presets[0]!.options.map((o) => o.label)).toEqual(["None", "Rainy day"]);
    expect(presets[2]!.options.length).toBeGreaterThan(8);
    expect(musicMode(base()).presets?.chips.map((chip) => chip.id)).toEqual(["starter"]);
  });
  test("a song to change swaps the song chips for a restyle button and keeps the slot", () => {
    const mode = musicMode(base({ reference: { id: "f1", name: "demo.mp3" } }));
    expect(mode.primary?.label).toBe("Change the style");
    expect((mode.chips ?? []).map((chip) => chip.id)).toEqual(["make"]);
    expect(mode.references?.[0]).toMatchObject({ kind: "audio", value: "f1", label: "demo.mp3" });
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
