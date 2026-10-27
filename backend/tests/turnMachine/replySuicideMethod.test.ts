// The stream gate for a child or teen: a sentence naming how a person died by suicide is not released,
// the other sentences are, and a short fixed note follows. An adult's identical reply is released whole.
// Written before the check exists (it must fail until then). Plan: data-scratch/reports/reply-suicide-method-check-plan.md.
import { describe, expect, test } from "bun:test";
import { StreamGate, outputGateNode } from "@/lib/turnMachine/nodes/outputGate";
import type { TurnState } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/lib/memoryIngestion";

const ACTOR = { displayName: "Test Person" } as PersonRow;
const REPLY = "Kurt Cobain died by suicide in 1994. The official ruling was a self-inflicted gunshot wound to the head. His music still matters to many fans.";

function run(band: "adult" | "teen" | "child") {
  const released: string[] = [];
  const refusals: unknown[] = [];
  const gate = new StreamGate(band, ACTOR, `turn-${band}`, (s) => released.push(s), (s) => refusals.push(s), () => {});
  for (const word of REPLY.split(/(?<= )/)) gate.push(word);
  gate.finish();
  return { text: gate.result().text, refusals, refused: gate.result().refused };
}

describe("StreamGate: suicide method in a reply to a minor", () => {
  for (const band of ["teen", "child"] as const) {
    test(`${band}: the method sentence is cut, the rest is kept, and the turn is not refused`, () => {
      const { text, refusals, refused } = run(band);
      expect(refused).toBeUndefined();
      expect(refusals).toHaveLength(0);
      expect(text).toContain("died by suicide in 1994");
      expect(text).toContain("His music still matters");
      expect(text).not.toMatch(/gunshot/i);
      expect(text).toContain("988");
    });
  }
  test("adult: the identical reply is released whole", () => {
    const { text } = run("adult");
    expect(text.trim()).toBe(REPLY);
  });
});

describe("StreamGate: an abandoned round does not leave its cut behind", () => {
  test("a round that cut a sentence and was reset releases no note under the next round's clean answer", () => {
    const released: string[] = [];
    const gate = new StreamGate("child", ACTOR, "turn-reset", (s) => released.push(s), () => {}, () => {});
    for (const word of "He died by suicide in 1994. He was found hanging. ".split(/(?<= )/)) gate.push(word);
    gate.reset();
    for (const word of "The garden needs water twice a week. ".split(/(?<= )/)) gate.push(word);
    gate.finish();
    expect(gate.result().text.trim()).toBe("The garden needs water twice a week.");
    expect(gate.result().text).not.toContain("988");
  });
  test("a fully cut round that was reset and then never replaced releases no note either", () => {
    const gate = new StreamGate("child", ACTOR, "turn-reset2", () => {}, () => {}, () => {});
    for (const word of "He died by suicide. He was found hanging. ".split(/(?<= )/)) gate.push(word);
    gate.reset();
    gate.finish();
    expect(gate.result().text).toBe("");
  });
});

describe("outputGateNode: the spoken text of a minor's reply is cut the same way", () => {
  const kid = { id: "owner-1", displayName: "Test Person", role: "owner", birthdate: null } as unknown as import("@/lib/memoryIngestion").PersonRow;
  const state = (extra: object = {}) => ({ actor: kid, surface: "robot", speakerEvidence: null, turnId: "turn-speech", ...extra }) as unknown as TurnState;
  const TEXT = "He died by suicide in 1994. He was found hanging. His music mattered.";
  const SPEECH = "He died by suicide in 1994. He hanged himself. His music mattered.";
  const SIGNAL = new AbortController().signal;

  test("whole-reply path: text and speech both lose the method sentence", async () => {
    const { output } = await outputGateNode(state(), { reply: { text: TEXT, speech: SPEECH, sources: [] }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: null }, SIGNAL);
    if (output.refused) throw new Error("refused");
    expect(output.text).not.toMatch(/hanging/i);
    expect(output.speech).toBeDefined();
    expect(output.speech!).not.toMatch(/hanged/i);
    expect(output.speech!).toContain("His music mattered");
  });

  test("streamed path: authored speech that names the method is replaced by what the gate delivered", async () => {
    const gate = new StreamGate("child", kid, "turn-speech", () => {}, () => {}, () => {});
    for (const word of TEXT.split(/(?<= )/)) gate.push(word);
    gate.finish();
    const { output } = await outputGateNode(state({ streamGate: gate }), { reply: { text: TEXT, speech: SPEECH, sources: [] }, reasoningIn: undefined, reasoningEmit: false, reasoningWithheldFor: null }, SIGNAL);
    if (output.refused) throw new Error("refused");
    expect(output.text).not.toMatch(/hanging/i);
    expect(output.speech ?? "").not.toMatch(/hanged/i);
  });
});

describe("StreamGate: a long sentence split at a comma is cut whole, never left as a fragment", () => {
  const LONG = "Kurt Cobain died by suicide in 1994. The official cause of death, as determined by the King County Medical Examiner and confirmed by police investigations, was a self-inflicted gunshot wound to the head. His music still mattered to many fans.";
  for (const band of ["teen", "child"] as const) {
    test(`${band}: no front half of the cut sentence is released`, () => {
      const gate = new StreamGate(band, ACTOR, `turn-long-${band}`, () => {}, () => {}, () => {});
      for (const word of LONG.split(/(?<= )/)) gate.push(word);
      gate.finish();
      const text = gate.result().text;
      expect(text).not.toContain("official cause");
      expect(text).not.toMatch(/gunshot|Medical Examiner/i);
      expect(text).toContain("His music still mattered");
      expect(text).toContain("988");
    });
  }
  test("adult: the same reply is released whole", () => {
    const gate = new StreamGate("adult", ACTOR, "turn-long-adult", () => {}, () => {}, () => {});
    for (const word of LONG.split(/(?<= )/)) gate.push(word);
    gate.finish();
    expect(gate.result().text.trim()).toBe(LONG);
  });
  test("a minor's long clause-split sentence with no suicide in it is still released whole", () => {
    const plain = "The garden needs water, and the tomatoes that you planted in the sunny corner of the yard last spring along the old wooden fence, will ripen sooner if you feed them. Enjoy the harvest.";
    const gate = new StreamGate("teen", ACTOR, "turn-long-plain", () => {}, () => {}, () => {});
    for (const word of plain.split(/(?<= )/)) gate.push(word);
    gate.finish();
    expect(gate.result().text.trim()).toBe(plain);
  });
});
