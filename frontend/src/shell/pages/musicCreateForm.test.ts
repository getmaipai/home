// MP-U1 and MP-05: the composer's form-to-request mapping.
import { describe, expect, test } from "bun:test";
import { EMPTY_FORM, EMPTY_SOUND, KEYS, STARTER_STYLE_CHIPS, STRUCTURE_TAGS, createBlocker, createBody, createLabel, describeSong, editBlocker, editBody, formLikeSong, insertStructureTag, parseSeed, recordBlocker, setStarter, soundBody, soundLabel, starterOf, toggleTag, type CreateForm } from "./musicCreateForm";

const ok = { engineMissing: false, statusPending: false, making: false, adult: true, blocked: "" };
const lines = { adult: "adult line", engine: "engine line" };
const form = (patch: Partial<CreateForm>): CreateForm => ({ ...EMPTY_FORM, ...patch });

describe("createBody", () => {
  test("sends only what was filled in", () => {
    expect(createBody(form({ idea: " a rainy folk song " }))).toEqual({ idea: "a rainy folk song" });
    const full = createBody(form({ idea: "a rainy folk song", lyrics: "[Verse] hi", title: " Rain ", length: "quick", bpm: 92.4, key: "C major", language: "es", takes: 3, seed: "4242", tier: "boost", styleId: "s1", bandId: "b1" }));
    expect(full).toEqual({ idea: "a rainy folk song", lyrics: "[Verse] hi", title: "Rain", language: "es", length: "quick", bpm: 92, key: "C major", takes: 3, seed: 4242, tier: "boost", song_style: "s1", band: "b1" });
  });
  test("one take, Standard and Auto fields send nothing; instrumental drops the lyrics", () => {
    expect(createBody(form({ idea: "calm piano", lyrics: "la la", instrumental: true, takes: 1, bpm: 0, key: "", seed: "", tier: "standard" }))).toEqual({ idea: "calm piano", instrumental: true });
  });
  test("the picked style chips follow the idea", () => {
    expect(createBody(form({ idea: "upbeat pop rock", tags: ["Synthwave", "Soul"], lyrics: "[Chorus]\nla" })).idea).toBe("upbeat pop rock Style: Synthwave, Soul.");
    expect(describeSong(form({ idea: "", tags: ["Soul"] }))).toBe("Style: Soul.");
  });
  test("a seed that is not a whole number from 1 up is not sent", () => {
    for (const bad of ["0", "1.5", "-3", "abc", "99999999999"]) expect(createBody(form({ idea: "a song", seed: bad }))).not.toHaveProperty("seed");
    expect(parseSeed(" 77 ")).toBe(77);
  });
  test("max is sent as the tier the tool already accepts", () => {
    expect(createBody(form({ idea: "a song", tier: "max" }))).toEqual({ idea: "a song", tier: "max" });
  });
});

describe("the sound body", () => {
  test("the composer's words and chips map to the sound request; takes ride only above one", () => {
    expect(soundBody(" door creak ", { seconds: "10", loop: true, stick: "surprise" }, 1)).toEqual({ description: "door creak", seconds: 10, loop: true, stick_to_words: false });
    expect(soundBody("a knock", EMPTY_SOUND, 3)).toEqual({ description: "a knock", seconds: 3, loop: false, stick_to_words: true, takes: 3 });
  });
});

describe("the primary button", () => {
  test("its label says how many it makes", () => {
    expect(createLabel(1)).toBe("Make a song");
    expect(createLabel(2)).toBe("Make 2 songs");
    expect(soundLabel(1)).toBe("Make a sound");
    expect(soundLabel(3)).toBe("Make 3 sounds");
  });
  test("it is off with the first reason a person can fix", () => {
    expect(createBlocker(form({ idea: "a song" }), { ...ok, adult: false }, lines)).toBe("adult line");
    expect(createBlocker(form({ idea: "a song" }), { ...ok, blocked: "household off" }, lines)).toBe("household off");
    expect(createBlocker(form({ idea: "a song" }), { ...ok, engineMissing: true }, lines)).toBe("engine line");
    expect(createBlocker(form({ idea: "a song" }), { ...ok, statusPending: true }, lines)).toContain("Checking");
    expect(createBlocker(form({ idea: "a song" }), { ...ok, making: true }, lines)).toContain("being started");
    expect(createBlocker(form({ idea: "" }), ok, lines)).toContain("Say what the song is about");
    expect(createBlocker(form({ idea: "a song", seed: "0" }), ok, lines)).toContain("seed");
    expect(createBlocker(form({ idea: "a song" }), ok, lines)).toBe("");
    expect(createBlocker(form({ idea: "hi" }), ok, lines, "sound")).toContain("at least 3");
    expect(createBlocker(form({ idea: "a bell" }), ok, lines, "sound")).toBe("");
  });
});

describe("lyrics tags and style chips", () => {
  test("a structure tag goes in at the cursor on a line of its own", () => {
    expect(STRUCTURE_TAGS).toEqual(["Intro", "Verse", "Chorus", "Bridge", "Outro"]);
    expect(insertStructureTag("", 0, 0, "Verse")).toEqual({ text: "[Verse]\n", caret: 8 });
    expect(insertStructureTag("la la", 5, 5, "Chorus").text).toBe("la la\n[Chorus]\n");
    expect(insertStructureTag("one\ntwo", 3, 3, "Bridge").text).toBe("one\n[Bridge]\ntwo");
  });
  test("picking a chip toggles it and the list stops at eight", () => {
    expect(toggleTag(["Soul"], "Soul")).toEqual([]);
    const eight = STARTER_STYLE_CHIPS.slice(0, 8) as unknown as string[];
    expect(toggleTag(eight, "Reggae")).toEqual(eight);
  });
  test("the Starter preset holds one built-in style and keeps the person's own chips", () => {
    expect(setStarter(["my own", "Soul"], "Jazz ballad")).toEqual(["my own", "Jazz ballad"]);
    expect(setStarter(["my own", "Soul"], "")).toEqual(["my own"]);
    expect(starterOf(["my own", "Soul"])).toBe("Soul");
    expect(starterOf(["my own"])).toBe("");
  });
  test("the keys are the ones the tool accepts", () => {
    expect(KEYS).toHaveLength(24);
    for (const key of KEYS) expect(/^[A-G][#b]?\s?(major|minor)$/.test(key)).toBe(true);
  });
});

describe("Make another like this", () => {
  test("fills the form from a song with its seed", () => {
    expect(formLikeSong({ title: "Rain", description: "slow folk", lyrics: "[Verse]\nhi", seed: 99 })).toMatchObject({ idea: "slow folk", title: "Rain", lyrics: "[Verse]\nhi", seed: "99" });
    expect(formLikeSong({ title: null, description: null, lyrics: null }).seed).toBe("");
  });
});

describe("a brought song", () => {
  test("the edit request carries only what its change needs", () => {
    expect(editBody("f1", "restyle", "  soft jazz ", "v1")).toEqual({ file_id: "f1", change: "restyle", style: "soft jazz" });
    expect(editBody("f1", "parts", "ignored", "v1")).toEqual({ file_id: "f1", change: "parts", parts: { drop: ["vocals"] } });
    expect(editBody("f1", "stems", "ignored", "v1")).toEqual({ file_id: "f1", change: "stems" });
    expect(editBody("f1", "voice_swap", "ignored", "v1")).toEqual({ file_id: "f1", change: "voice_swap", voice: "v1" });
  });
  test("restyle needs a few words and a voice swap needs a voice; the rest are always ready", () => {
    expect(editBlocker("restyle", "ab", "")).toContain("at least 3");
    expect(editBlocker("restyle", "soft jazz", "")).toBe("");
    expect(editBlocker("voice_swap", "", "")).toContain("Choose a voice");
    expect(editBlocker("voice_swap", "", "v1")).toBe("");
    expect(editBlocker("parts", "", "")).toBe("");
    expect(editBlocker("stems", "", "")).toBe("");
  });
});

describe("a band, album or style", () => {
  test("starts from a name and says which one is missing", () => {
    expect(recordBlocker("band", "  ")).toBe("Name your band to start.");
    expect(recordBlocker("album", "")).toBe("Name your album to start.");
    expect(recordBlocker("song_style", "")).toBe("Name your style to start.");
    expect(recordBlocker("band", "The Owls")).toBe("");
  });
});
