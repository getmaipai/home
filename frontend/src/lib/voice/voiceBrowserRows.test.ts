import { describe, expect, test } from "bun:test";
import type { PersonRosterEntry, Roster, StackVoice } from "@/lib/api";
import { playableVoices, previewIdFor, voiceChoices, voiceDescription, voiceFriendlyName, voiceTargets } from "@/lib/voice/voiceBrowserRows";

const person = (id: string, role: Roster["role"]) => ({ id, display_name: id, role } as Roster & PersonRosterEntry);

describe("voice browser helpers", () => {
  test("voiceTargets lists owner and children only for an admin", () => {
    const roster = [person("owner", "owner"), person("admin", "admin"), person("adult", "adult"), person("teen", "teen"), person("child", "child")];
    expect(voiceTargets(roster as PersonRosterEntry[], roster[1]!)).toEqual([roster[1]!, roster[4]!]);
    expect(voiceTargets(roster as PersonRosterEntry[], roster[2]!)).toEqual([]);
  });
  test("playableVoices keeps every preset, installed or not", () => {
    const rows = [{ id: "a", source: "preset", onDisk: true }, { id: "b", source: "preset", onDisk: false }, { id: "c", source: "community", onDisk: true }, { id: "d", source: "cloned", onDisk: true }] as StackVoice[];
    expect(playableVoices(rows).map((voice) => voice.id)).toEqual(["a", "b"]);
  });
  test("friendly names: catalog name, id's last token, never an engine word", () => {
    expect(voiceFriendlyName({ id: "x-voice-alba", name: "Alba" })).toBe("Alba");
    expect(voiceFriendlyName({ id: "pocket-tts-voice-alba", name: "unknown" })).toBe("Alba");
    expect(voiceFriendlyName({ id: "bill_boerst", name: "Bill Boerst" })).toBe("Bill Boerst");
    expect(voiceFriendlyName({ id: "chatterbox-turbo-voice-default", name: "Chatterbox default" })).toBe("Default");
    expect(voiceFriendlyName({ id: "chatterbox-turbo-voice-default", name: "Chatterbox" })).toBe("Default");
  });
  test("a description shows only when it is real and engine-free", () => {
    expect(voiceDescription({ description: "Warm, friendly" })).toBe("Warm, friendly");
    expect(voiceDescription({ description: "unknown" })).toBeNull();
    expect(voiceDescription({ description: "Chatterbox Turbo voice" })).toBeNull();
  });
  const v = (id: string, name: string, engine = "pocket"): StackVoice => ({ id, name, description: "unknown", language: "en", country: "unknown", gender: "unknown", source: "preset", engine, onDisk: true, licence: null, revision: "" });
  test("voiceChoices: the default voice is always first and the engine default folds into it", () => {
    const c = voiceChoices([v("chatterbox-turbo-voice-default", "Chatterbox default", "chatterbox-turbo")], null, ["default", "alba"]);
    expect(c.options.map((o) => o.label)).toEqual(["Default voice"]);
    expect(c.selected.value).toBe("default");
    expect(c.notice).toBeNull();
    expect(previewIdFor(c.selected, [])).toBe("chatterbox-turbo-voice-default");
  });
  test("voiceChoices: a saved name the engine does not offer falls back with one plain line", () => {
    const c = voiceChoices([v("chatterbox-turbo-voice-default", "Chatterbox default", "chatterbox-turbo")], "javert", ["default", "alba", "javert"]);
    expect(c.selected.value).toBe("default");
    expect(c.notice).toBe("Javert is not available with this engine, using the default voice.");
  });
  test("voiceChoices: a saved preset the engine offers is selected, no notice; other engine ids are kept together", () => {
    const voices = [v("p-voice-alba", "Alba"), v("p-voice-javert", "Javert"), v("cb-ref-nova", "Nova", "chatterbox-turbo")];
    const c = voiceChoices(voices, "javert", ["default", "alba", "javert"]);
    expect(c.selected.label).toBe("Javert");
    expect(c.notice).toBeNull();
    expect(c.options.map((o) => o.value)).toEqual(["default", "alba", "javert", "cb-ref-nova"]);
  });
  test("previewIdFor: the default voice plays alba when the engine lists presets", () => {
    const voices = [v("p-voice-javert", "Javert"), v("p-voice-alba", "Alba")];
    expect(previewIdFor(voiceChoices(voices, null, ["default", "alba"]).selected, voices)).toBe("p-voice-alba");
  });
});
