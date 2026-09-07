// Fix C (docs/dev.md's "Chat reliability: the 2026-09-07 incident and the
// five fixes", getmaipai/home#62): runs spec/llm/guard-corpus.json
// against the real guardReply() and guardSentence()/gateGuards() paths -
// the deterministic, always-in-check.sh half of "every guard false
// positive seen in the house gets a row before it is fixed." Mirrors
// routingCorpus.test.ts's own shape (one test() per row, run against the
// real bundled logic, never a mock). No embed/LLM backend needed - guards
// are pure regex/tokenize logic, offline and fast either way.
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guardReply, type GuardContext, type GuardReason } from "@/lib/guards";
import { gateGuards } from "@/lib/turnEngine";

interface CorpusRow {
  id: string;
  utterance: string;
  reply: string;
  sources?: string[];
  history?: string[];
  personaExamples?: string[];
  expect: GuardReason | null;
  /** True only for a row that depends on the whole-reply lookahead
   * guardReply() has and gateGuards() (the streaming path) genuinely
   * cannot - see the row's own `note` and GuardContext.replyHasQuestion's
   * doc comment in guards.ts. Excluded from the streaming describe block
   * below, not silently passed. */
  streamingSkip?: boolean;
  note?: string;
}

const corpus: CorpusRow[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "spec", "llm", "guard-corpus.json"), "utf-8"));

function ctxFor(row: CorpusRow): Omit<GuardContext, "personId"> {
  return { utterance: row.utterance, sources: row.sources ?? [], history: row.history ?? [], personaExamples: row.personaExamples };
}

async function* sentenceStream(reply: string): AsyncGenerator<string, undefined, void> {
  for (const s of reply.split(/(?<=[.!?])\s+/).filter(Boolean)) yield `${s} `;
  return undefined;
}

describe("guard corpus (guardReply, the non-streaming path)", () => {
  for (const row of corpus) {
    test(row.id, () => {
      const result = guardReply(row.reply, { ...ctxFor(row), personId: "person-corpus" });
      expect(result.reason).toBe(row.expect);
    });
  }
});

// Fix C's own core rewrite: a CUTTABLE reason drops the sentence and
// keeps streaming, a non-cuttable reason replaces itself and stops - so
// the streaming path's OWN pass/fail shape differs from guardReply()'s
// (a single-sentence corpus row that guardReply() replaces wholesale can
// come back from gateGuards() as either the honest line alone, cuttable
// or not; a passing row streams through with the reply's own words
// intact). What every row still proves here: nothing from `reply` that
// guardReply() would have caught is ever spoken untouched by the
// streaming path either, and nothing guardReply() clears is ever
// replaced by it.
describe("guard corpus (gateGuards, the streaming path)", () => {
  for (const row of corpus) {
    if (row.streamingSkip) continue;
    test(row.id, async () => {
      const gated = gateGuards(sentenceStream(row.reply), ctxFor(row), "person-corpus");
      const delivered: string[] = [];
      for await (const chunk of gated) delivered.push(chunk);
      const streamed = delivered.join("").trim();
      if (row.expect === null) {
        expect(streamed).toBe(row.reply.trim());
      } else {
        expect(streamed).not.toBe(row.reply.trim());
      }
    });
  }
});
