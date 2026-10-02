// THIN-0K (rules 1 and 12): an inventory of every bundled opener on the
// default path. The old exact-match router (routeLiteral in the old
// engine file) is retired with that file, so the claim "every opener that
// works today still fires" is checked here against the real bundled
// manifests, one row per pattern, by the three closed kinds OPENER-01
// allows (a fixed phrase, an imperative wildcard on a directive turn, a
// computed wildcard the package's own resolver accepts), never by a word
// list of our own. runPlugin is spied (commands.test.ts's COMMAND-FAIL-01
// pattern) so the test sees WHICH package the node dispatches to without
// network or side effects.
import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { commandsNode } from "@/lib/turnMachine/nodes/commands";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { loadAllManifests, commandOpeners } from "@/lib/turnShared";
import { COMPUTED_WILDCARD_RESOLVERS, NEVER_FIRES_WILDCARDS } from "@/lib/manifestLint";
import * as plugins from "@/lib/plugins";
import type { TurnState } from "@/lib/turnMachine/contract";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

const NODE_SIGNAL = new AbortController().signal;
const MANIFESTS = loadAllManifests();
const OPENERS = commandOpeners(MANIFESTS);
/** A remainder long enough for a leading wildcard (three words or more). */
const REMAINDER = "the trash goes out on tuesday";
/** The remainder each computed wildcard's own resolver accepts. */
const COMPUTED_REMAINDER: Record<string, string> = {
  "math:what does * equal": "15 * 12",
  "almanac-time:what time is it in *": "Tokyo",
};

function utteranceFor(id: string, pattern: string): string {
  if (!pattern.includes("*")) return pattern;
  return pattern.replace("*", COMPUTED_REMAINDER[`${id}:${pattern}`] ?? REMAINDER);
}

/** Which package the node dispatches to for this utterance, or null. */
async function dispatchedTo(utterance: string, signalOverride?: Partial<TurnSignal>): Promise<string | null> {
  const signal = { ...classifyTurnSignal({ text: utterance, ageBand: "adult", commandOpeners: OPENERS }), ...signalOverride };
  const state = { actor: people.owner, signal, temporary: false, turnId: "test-turn", conversationId: "test-conversation", outcomes: [] } as unknown as TurnState;
  const calls: string[] = [];
  const spy = spyOn(plugins, "runPlugin").mockImplementation(async (id: string) => {
    calls.push(id);
    return { ok: false, status: 404, error: "not found", code: "not_found" } as Awaited<ReturnType<typeof plugins.runPlugin>>;
  });
  try {
    await commandsNode(state, { utterance }, NODE_SIGNAL);
  } finally {
    spy.mockRestore();
  }
  return calls[0] ?? null;
}

const firing = MANIFESTS.filter(({ manifest }) => manifest.kind === "plugin" && !manifest.consequential && !manifest.routing?.always_offer && (manifest.routing?.patterns ?? []).length > 0);

describe("openers on the default path: every bundled pattern, by kind", () => {
  test("the inventory covers the bundled openers (a manifest edit that drops them is a finding)", () => {
    expect(firing.length).toBeGreaterThanOrEqual(20);
  });

  for (const { id, manifest } of firing) {
    for (const pattern of manifest.routing?.patterns ?? []) {
      const key = `${id}:${pattern}`;
      if (!pattern.includes("*")) {
        test(`fixed phrase "${pattern}" dispatches to ${id}, whatever the signal`, async () => {
          expect(await dispatchedTo(pattern)).toBe(id);
        });
      } else if (NEVER_FIRES_WILDCARDS.has(key)) {
        test(`open-topic wildcard "${pattern}" (${id}) never fires, even on a directive turn`, async () => {
          expect(await dispatchedTo(utteranceFor(id, pattern), { primary_act: "directive" })).not.toBe(id);
        });
      } else if (COMPUTED_WILDCARD_RESOLVERS[key]) {
        test(`computed wildcard "${pattern}" dispatches to ${id} when the package's resolver accepts the remainder`, async () => {
          expect(await dispatchedTo(utteranceFor(id, pattern))).toBe(id);
        });
      } else {
        // The real classifier reads the turn: a directive ("convert ...",
        // "remind me ...") dispatches, anything else (a question word in
        // the fixed part, "what's the weather in ...") yields to the model,
        // which offers the same package as a tool. Never a word list here.
        const utterance = utteranceFor(id, pattern);
        const natural = classifyTurnSignal({ text: utterance, ageBand: "adult", commandOpeners: OPENERS }).primary_act;
        if (natural === "directive") {
          test(`imperative wildcard "${pattern}" dispatches to ${id} on its directive turn and yields on a question`, async () => {
            expect(await dispatchedTo(utterance)).toBe(id);
            expect(await dispatchedTo(utterance, { primary_act: "question" })).toBeNull();
          });
        } else {
          test(`wildcard "${pattern}" (${id}) is a ${natural} turn, so it yields to the model instead of firing blind`, async () => {
            expect(await dispatchedTo(utterance)).toBeNull();
          });
        }
      }
    }
  }
});
