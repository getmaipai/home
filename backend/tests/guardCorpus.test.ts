// Fix C (docs/dev.md's "Chat reliability: the 2026-09-07 incident and the
// five fixes", getmaipai/home#62): runs spec/llm/guard-corpus.json
// against the real guardReply() path (the streaming gateGuards() pass left with the old engine, THIN-7D) -
// the deterministic, always-in-check.sh half of "every guard false
// positive seen in the house gets a row before it is fixed." Mirrors
// routingCorpus.test.ts's own shape (one test() per row, run against the
// real bundled logic, never a mock). No embed/LLM backend needed - guards
// are pure regex/tokenize logic, offline and fast either way.
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guardReply, type GuardContext, type GuardReason } from "@/lib/guards";
import { SPEC_DIR } from "@/lib/specDir";

interface CorpusRow {
  id: string;
  utterance: string;
  reply: string;
  sources?: string[];
  history?: string[];
  personaExamples?: string[];
  /** FAST-05: household names, for guards.ts's LOCATION_CLAIM_RE. */
  roster?: string[];
  /** CHAT-04: the turn's tool outcomes, package id and status, for the
   * per-family action-claim match. */
  outcomes?: GuardContext["outcomes"];
  /** ACT-01: the turn's primary act. */
  act?: GuardContext["act"];
  previousReply?: string;
  /** ASK-01: the turn's unknown names, for the false-familiarity shape. */
  unknownNames?: string[];
  lookupServed?: boolean;
  target?: GuardContext["target"];
  repair?: GuardContext["repair"];
  subjects?: GuardContext["subjects"];
  bannedPhrases?: string[];
  expect: GuardReason | null;
  note?: string;
}

const corpus: CorpusRow[] = JSON.parse(readFileSync(join(SPEC_DIR, "llm", "guard-corpus.json"), "utf-8"));
// The pinned shared corpus still carries expectations for retired guard
// families. Keep unrelated rows active without restoring assertions for
// behavior the home engine no longer implements.
const RETIRED_EXPECTATIONS: ReadonlySet<string> = new Set([
  "repeat_question", "repeat_sentence", "repeat_reply",
  "placeholder_echo", "assistant_register", "tag_question",
  // ASK-01 part 5, retired by ruling (THIN-7D): the model is given the pronouns instead.
  "pronoun_mismatch",
]);
const isRetiredGuard = (row: CorpusRow) => RETIRED_EXPECTATIONS.has(row.expect ?? "");

function ctxFor(row: CorpusRow): Omit<GuardContext, "personId"> {
  return { utterance: row.utterance, sources: row.sources ?? [], history: row.history ?? [], personaExamples: row.personaExamples, roster: row.roster, outcomes: row.outcomes, act: row.act, previousReply: row.previousReply, unknownNames: row.unknownNames, lookupServed: row.lookupServed, target: row.target, repair: row.repair, subjects: row.subjects, bannedPhrases: row.bannedPhrases };
}

describe("guard corpus (guardReply, the non-streaming path)", () => {
  for (const row of corpus) {
    if (isRetiredGuard(row)) continue;
    test(row.id, () => {
      const result = guardReply(row.reply, { ...ctxFor(row), personId: "person-corpus" });
      expect(result.reason).toBe(row.expect);
    });
  }
});
