// THIN-0N (rules 0 and 12, found reviewing THIN-0D): the safety node
// moderates at the speaker's EFFECTIVE band, the same derivation the old
// path makes at turnEngine.ts's prepareTurn() (turnContext.ts's
// effectiveBand()). On a robot, a speaker the body cannot name is the
// child band even when the signed-in person is an adult. Direct unit
// tests of the node, in the style of commands.test.ts and policy.test.ts.
import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "../reset-db";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { safetyNode } from "@/lib/turnMachine/nodes/safety";
import type { TurnState } from "@/lib/turnMachine/contract";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

const NODE_SIGNAL = new AbortController().signal;
// A line only the minor-band grooming detector reads (the spec's
// detectGrooming() is scoped to a minor), so it separates the bands.
const LINE = "keep this between us";

function robotState(evidence: TurnState["speakerEvidence"]): TurnState {
  return { actor: people.owner, surface: "robot", speakerEvidence: evidence, turnId: "test-turn" } as unknown as TurnState;
}

describe("safetyNode: THIN-0N, an unidentified robot speaker is checked at the child band", () => {
  test("a robot turn with no evidence refuses what the child band refuses, on an adult owner's robot", async () => {
    const { output } = await safetyNode(robotState(null), { utterance: LINE }, NODE_SIGNAL);
    expect(output.safety.action).toBe("refuse");
    expect(output.safety.categories).toContain("grooming");
    const unknown = await safetyNode(robotState({ person: null, basis: "unknown", level: "unknown" }), { utterance: LINE }, NODE_SIGNAL);
    expect(unknown.output.safety.action).toBe("refuse");
  });

  test("an identified adult speaker is unchanged", async () => {
    const { output } = await safetyNode(robotState({ person: people.owner.id, basis: "voice", level: "confirmed" }), { utterance: LINE }, NODE_SIGNAL);
    expect(output.safety.action).toBe("allow");
  });

  test("a non-robot surface is unchanged, evidence or not", async () => {
    const chat = { ...robotState(null), surface: "chat" } as TurnState;
    const { output } = await safetyNode(chat, { utterance: LINE }, NODE_SIGNAL);
    expect(output.safety.action).toBe("allow");
  });
});
