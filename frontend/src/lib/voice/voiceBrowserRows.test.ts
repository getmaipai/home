import { describe, expect, test } from "bun:test";
import type { PersonRosterEntry, Roster, StackVoice } from "@/lib/api";
import { listForTarget, voiceTargets } from "@/lib/voice/voiceBrowserRows";

const person = (id: string, role: Roster["role"]) => ({ id, display_name: id, role } as Roster & PersonRosterEntry);
const voices = [{ id: "one", source: "preset" }, { id: "two", source: "community" }, { id: "three", source: "cloned" }] as StackVoice[];

describe("voice browser target helpers", () => {
  test("voiceTargets lists owner and children only for an admin", () => {
    const roster = [person("owner", "owner"), person("admin", "admin"), person("adult", "adult"), person("teen", "teen"), person("child", "child")];
    expect(voiceTargets(roster as PersonRosterEntry[], roster[1]!)).toEqual([roster[1]!, roster[4]!]);
    expect(voiceTargets(roster as PersonRosterEntry[], roster[2]!)).toEqual([]);
  });
  test("listForTarget restricts children to preset voices", () => {
    expect(listForTarget(voices, person("child", "child")).map((voice) => voice.id)).toEqual(["one"]);
    expect(listForTarget(voices, person("adult", "adult"))).toEqual(voices);
  });
});
