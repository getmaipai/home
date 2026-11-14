import { describe, expect, test } from "bun:test";
import { speakerLine } from "@/lib/speakerLine";
import { renderScene } from "@/lib/turnMachine/nodes/context";
import { sceneForTests } from "@/lib/scene";
import type { SpeakerEvidence, Surface } from "@/lib/turnShared";

const sage = { id: "person-sage000", displayName: "Sage", role: "adult" } as any;
const marlow = { id: "person-marlow0", displayName: "Marlow", role: "teen" } as any;
const nova = { id: "person-nova000", displayName: "Nova", role: "child" } as any;
const roster = [sage, marlow, nova];
const ev = (person: string | null, basis: SpeakerEvidence["basis"], level: SpeakerEvidence["level"]): SpeakerEvidence => ({ person, basis, level });

const cases: Array<[string, SpeakerEvidence | null, Surface, string, unknown?]> = [
  ["confirmed voice", ev(sage.id, "voice", "confirmed"), "robot", "Speaker: Sage, confirmed by voice."],
  ["face and voice", ev(sage.id, "voice_and_face", "confirmed"), "robot", "Speaker: Sage, confirmed by face and voice."],
  ["tentative face", ev(sage.id, "face", "tentative"), "robot", "Speaker: probably Sage (seen, not yet heard clearly)."],
  ["tentative voice", ev(sage.id, "voice", "tentative"), "robot", "Speaker: probably Sage (voice, not sure)."],
  ["unexpressible tie", ev(null, "unknown", "unknown"), "robot", "Speaker: unknown."],
  ["unexpressible disagreement", ev(null, "unknown", "unknown"), "robot", "Speaker: unknown."],
  ["others count", ev(sage.id, "voice", "confirmed"), "robot", "Speaker: Sage, confirmed by voice. Others present: 1 unknown.", true],
  ["no match", ev(null, "unknown", "unknown"), "robot", "Speaker: unknown."],
  ["child name off", ev(nova.id, "voice", "confirmed"), "robot", "Speaker: a household child, confirmed by voice; name not to be spoken.", false],
  ["signed in", ev(sage.id, "signed_in", "confirmed"), "chat", "Speaker: Sage (signed in)."],
  ["voice agrees with sign-in", ev(sage.id, "voice", "confirmed"), "phone", "Speaker: Sage, confirmed by voice."],
  ["unexpressible sign-in disagreement", ev(sage.id, "signed_in", "confirmed"), "phone", "Speaker: Sage (signed in)."],
  ["shared screen unknown", null, "tv", "Speaker: unknown on a shared screen."],
  ["second present person does not alter speaker", ev(sage.id, "signed_in", "confirmed"), "chat", "Speaker: Sage (signed in)."],
];

describe("speakerLine", () => {
  for (const [label, evidence, surface, expected, greet] of cases) {
    test(`formats ${label}`, () => {
      expect(speakerLine(evidence, surface, sage, roster, greet ?? true, expected.includes("Others present") ? 1 : 0)).toBe(expected);
    });
  }

  test("never names an unrostered or claimed person as verified", () => {
    expect(speakerLine(ev("person-outsider", "voice", "confirmed"), "robot", sage, roster)).toBe("Speaker: unknown.");
    expect(speakerLine(ev(marlow.id, "claimed", "tentative"), "robot", sage, roster)).toBe("Speaker: claims to be Marlow, not verified.");
  });

  test("renderScene emits the speaker line on each surface", () => {
    const surfaces: Surface[] = ["robot", "chat", "phone", "tv", "overlay", "pod"];
    for (const surface of surfaces) {
      const speaker = surface === "chat" || surface === "phone" ? ev(sage.id, "signed_in", "confirmed") : ev(sage.id, "voice", "confirmed");
      const scene = sceneForTests({ conversation_id: `speaker-${surface}`, speaker, people: [] });
      const output = renderScene(scene, 1, sage, roster);
      expect(output).toContain(surface === "chat" || surface === "phone" ? "Speaker: Sage (signed in)." : "Speaker: Sage, confirmed by voice.");
    }
  });

  test("renderer never lists a second candidate name or names a child with greeting disabled", () => {
    const childScene = sceneForTests({ conversation_id: "speaker-child", speaker: ev(nova.id, "voice", "confirmed"), people: [] });
    expect(speakerLine(ev(nova.id, "voice", "confirmed"), "robot", nova, roster, false)).toContain("name not to be spoken");
    const actorScene = sceneForTests({ conversation_id: "speaker-adult", speaker: ev(sage.id, "voice", "confirmed"), people: [] });
    const output = renderScene(actorScene, 1, sage, roster);
    expect(output).not.toContain("Marlow");
    expect(speakerLine(ev(nova.id, "voice", "confirmed"), "robot", nova, roster, false)).not.toContain("Nova");
  });

  test("signed-in voice match lines disclose no score, number, or print id", () => {
    const disagreement = speakerLine(ev(sage.id, "signed_in", "confirmed"), "chat", sage, roster, true, 0, "disagree");
    const agreement = speakerLine(ev(sage.id, "signed_in", "confirmed"), "chat", sage, roster, true, 0, "agree");
    expect(disagreement).toBe("Speaker: signed in as Sage, but the voice does not sound like Sage.");
    expect(agreement).toBe("Speaker: Sage (signed in and confirmed by voice).");
    for (const line of [disagreement, agreement]) expect(line).not.toMatch(/[0-9]|score|print/i);
  });
});
