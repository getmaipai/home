// OPENER-01 (turn-machine-state-record-2026-09-22.md, "The machine",
// the commands row; dev.md "The knowledge hijack" (a)): direct unit
// tests of commandsNode's own three closed opener kinds, the same
// style policy.test.ts/outputGate.test.ts use for a single node -
// faster and more precise than a full live-engine turn for exercising
// exactly the opener decision, and the real bundled manifests
// (loadAllManifests) plus the real classifyTurnSignal() wiring
// (turnNext.ts's own commandOpeners() call, mirrored here) rather than
// a hand-built stand-in for either.
import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "../reset-db";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { commandsNode } from "@/lib/turnMachine/nodes/commands";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { loadAllManifests, commandOpeners } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

const NODE_SIGNAL = new AbortController().signal;
const OPENERS = commandOpeners(loadAllManifests());

/** commandsNode reads only `actor`, `signal.primary_act`, `temporary`,
 * `turnId`, `conversationId` and `outcomes` - every other TurnState
 * field is unused by this node, so it is not built here (the same
 * "what would be built is unused, not faked" posture outputGate.test.ts's
 * own header comment states for its own node). `signal` defaults to
 * the real classifier's own read of `utterance`, the identical call
 * turnNext.ts now makes (OPENER-01's own wiring fix) - a caller that
 * wants a different act passes `signalOverride` to test the gate
 * itself, independent of how any one phrasing happens to classify. */
function stateFor(actor: PersonRow, utterance: string, opts: { temporary?: boolean; signalOverride?: TurnSignal } = {}): TurnState {
  const signal = opts.signalOverride ?? classifyTurnSignal({ text: utterance, ageBand: "adult", commandOpeners: OPENERS });
  return {
    actor,
    signal,
    temporary: opts.temporary ?? false,
    turnId: "test-turn",
    conversationId: "test-conversation",
    outcomes: [],
  } as unknown as TurnState;
}

// The manifests themselves are unedited (found live building this
// item: knowledge/media-lookup/weather/define/music/recall's own
// question-word patterns are ALSO what the old, frozen path's own
// route()/matchPattern() reads - routingCorpus.test.ts's real fixture
// expects them to still be there - so OPENER-01's fix is the runtime
// gate below, never a manifest edit). A wildcard whose fixed part is a
// question word still never fires here regardless of what the
// manifest lists, because it is neither a fixed phrase nor a wildcard
// with a real resolver, and the turn below is never a directive.
describe("commandsNode: a wildcard opener whose fixed part is a question word never fires blind (OPENER-01)", () => {
  test('"what is photosynthesis" runs no pattern and reaches the model', async () => {
    const state = stateFor(people.owner, "what is photosynthesis");
    const { output } = await commandsNode(state, { utterance: "what is photosynthesis" }, NODE_SIGNAL);
    expect(output.matched).toBe(false);
  });

  test('"who was Marie Curie" (knowledge\'s own question-word opener) runs no pattern either', async () => {
    const state = stateFor(people.owner, "who was Marie Curie");
    const { output } = await commandsNode(state, { utterance: "who was Marie Curie" }, NODE_SIGNAL);
    expect(output.matched).toBe(false);
  });

  // A code review's own finding: "tell me about *" grammatically reads
  // as a directive ("tell me...", not an interrogative), so it
  // classifies as primary_act "directive" - proven here, not assumed -
  // and would otherwise fire as a safe "imperative" opener despite its
  // remainder being the identical open, free-form topic "what is *"'s
  // is. NEVER_FIRES_WILDCARDS refuses it regardless.
  test('"tell me about quantum entanglement" classifies as directive but never fires the knowledge pattern anyway', async () => {
    const state = stateFor(people.owner, "tell me about quantum entanglement");
    expect(state.signal.primary_act).toBe("directive");
    const { output } = await commandsNode(state, { utterance: "tell me about quantum entanglement" }, NODE_SIGNAL);
    expect(output.matched).toBe(false);
  });
});

describe("commandsNode: a fixed phrase fires whatever the signal (OPENER-01, kind 1)", () => {
  test('"what time is it" fires the almanac', async () => {
    const state = stateFor(people.owner, "what time is it");
    const { output } = await commandsNode(state, { utterance: "what time is it" }, NODE_SIGNAL);
    expect(output.matched).toBe(true);
    if (!output.matched) throw new Error("expected a match");
    expect(output.outcome.packageId).toBe("almanac-time");
    expect(output.outcome.status).toBe("succeeded");
  });
});

describe("commandsNode: an imperative wildcard fires only on a directive turn (OPENER-01, kind 2)", () => {
  test('"set a timer for ten minutes" fires the timer', async () => {
    const state = stateFor(people.owner, "set a timer for ten minutes");
    expect(state.signal.primary_act).toBe("directive");
    const { output } = await commandsNode(state, { utterance: "set a timer for ten minutes" }, NODE_SIGNAL);
    expect(output.matched).toBe(true);
    if (!output.matched) throw new Error("expected a match");
    expect(output.outcome.packageId).toBe("timer");
    expect(output.outcome.status).toBe("succeeded");
  });

  // convert (offline: "full") rather than define (a real dictionaryapi.dev
  // fetch) or music (a real MusicBrainz fetch) - the deterministic,
  // offline-by-default testing standard, same reason math is used below.
  test('"convert 5 miles to km" fires convert on a directive turn', async () => {
    const state = stateFor(people.owner, "convert 5 miles to km");
    expect(state.signal.primary_act).toBe("directive");
    const { output } = await commandsNode(state, { utterance: "convert 5 miles to km" }, NODE_SIGNAL);
    expect(output.matched).toBe(true);
    if (!output.matched) throw new Error("expected a match");
    expect(output.outcome.packageId).toBe("convert");
    expect(output.outcome.status).toBe("succeeded");
  });

  test("a question-shaped turn never fires an imperative wildcard, even when the words would otherwise match", async () => {
    const questionSignal: TurnSignal = { ...classifyTurnSignal({ text: "convert 5 miles to km", ageBand: "adult", commandOpeners: OPENERS }), primary_act: "question" };
    const state = stateFor(people.owner, "convert 5 miles to km", { signalOverride: questionSignal });
    const { output } = await commandsNode(state, { utterance: "convert 5 miles to km" }, NODE_SIGNAL);
    expect(output.matched).toBe(false);
  });
});

describe("commandsNode: a computed wildcard fires only when the package's own resolver accepts the remainder (OPENER-01, kind 3)", () => {
  test('"what does 15 * 12 equal" fires math', async () => {
    const state = stateFor(people.owner, "what does 15 * 12 equal");
    const { output } = await commandsNode(state, { utterance: "what does 15 * 12 equal" }, NODE_SIGNAL);
    expect(output.matched).toBe(true);
    if (!output.matched) throw new Error("expected a match");
    expect(output.outcome.packageId).toBe("math");
    expect(output.outcome.status).toBe("succeeded");
  });

  test('"what does love equal" does not - the evaluator rejects the remainder, so the turn yields to the model', async () => {
    const state = stateFor(people.owner, "what does love equal");
    const { output } = await commandsNode(state, { utterance: "what does love equal" }, NODE_SIGNAL);
    expect(output.matched).toBe(false);
  });
});
