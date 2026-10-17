import { describe, expect, test } from "bun:test";
import type { PersonRosterEntry, Roster, StackVoice } from "@/lib/api";
import { playableVoices, voiceDescription, voiceFriendlyName, voiceTargets } from "@/lib/voice/voiceBrowserRows";

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
});
