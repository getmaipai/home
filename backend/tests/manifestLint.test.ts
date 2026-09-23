// OPENER-01 (turn-machine-state-record-2026-09-22.md, "The machine",
// the commands row; dev.md "The knowledge hijack" (a)): the manifest
// lint's own gate. Direct unit tests of manifestLint.ts's pure
// functions (the same style policy.test.ts uses for argsGrounded()).
//
// No sweep of the CURRENT bundled manifests here on purpose, found
// live building this item: every bundled package's own routing.patterns
// is also what the OLD path's route()/matchPattern() (turnEngine.ts)
// reads for its own Tier 0 literal-pattern floor, proven by
// routingCorpus.test.ts's own real, frozen fixture (spec's
// routing-corpus.json) expecting "who was Marie Curie" to route to
// knowledge, "who is the singer Prince" to music, and the rest -
// removing a manifest's own question-word patterns to fix the NEW
// path's opener hijack (the actual bug: nodes/commands.ts firing any
// matching pattern blind) breaks 30+ of the old path's own frozen
// tests, and the old path is frozen except for safety defects
// (.github/CLAUDE.md). The new path needs no manifest edit at all to
// be safe: commandsNode's own three-kind gate (below) already refuses
// to fire a question-word wildcard on anything but a directive turn or
// an accepted computed remainder, whatever the manifest still lists -
// proven directly by commands.test.ts against the REAL, UNEDITED
// bundled manifests. This file's own functions stay real and tested
// so a manifest edit, whenever one lands (the flip, or a future
// decision to update the old path's own corpus too), has a real gate
// ready for it; wiring `lintManifestPatterns` into check.sh over the
// CURRENT manifest set is deliberately left undone and flagged for the
// coordinator rather than done here.
import { describe, expect, test } from "bun:test";
import { fixedPartOf, isQuestionWordOpener, lintManifestPatterns, COMPUTED_WILDCARD_RESOLVERS, NEVER_FIRES_WILDCARDS } from "@/lib/manifestLint";

describe("fixedPartOf()", () => {
  test("the text before the one wildcard", () => {
    expect(fixedPartOf("what is *")).toBe("what is ");
    expect(fixedPartOf("what is * about")).toBe("what is ");
  });

  test("the whole pattern when there is no wildcard", () => {
    expect(fixedPartOf("what time is it")).toBe("what time is it");
  });
});

describe("isQuestionWordOpener()", () => {
  test("a wildcard whose fixed part opens with a question word", () => {
    expect(isQuestionWordOpener("what is *")).toBe(true);
    expect(isQuestionWordOpener("who was *")).toBe(true);
    expect(isQuestionWordOpener("is * any good")).toBe(true);
    expect(isQuestionWordOpener("who's in *")).toBe(true);
    expect(isQuestionWordOpener("what does * equal")).toBe(true);
  });

  test("an imperative wildcard never trips it", () => {
    expect(isQuestionWordOpener("define *")).toBe(false);
    expect(isQuestionWordOpener("convert *")).toBe(false);
    expect(isQuestionWordOpener("look up the artist *")).toBe(false);
    expect(isQuestionWordOpener("calculate *")).toBe(false);
  });

  test("a fixed phrase (no wildcard) is never a hijack, whatever it opens with", () => {
    expect(isQuestionWordOpener("what time is it")).toBe(false);
    expect(isQuestionWordOpener("what's the time")).toBe(false);
  });
});

describe("lintManifestPatterns()", () => {
  test("refuses a new wildcard opener that opens with a question word", () => {
    expect(lintManifestPatterns("knowledge", ["who was *", "what is *"])).toEqual(["who was *", "what is *"]);
  });

  test("passes an imperative wildcard", () => {
    expect(lintManifestPatterns("define", ["define *"])).toEqual([]);
  });

  test("passes the one named computed wildcard (math's own resolver gates it at runtime, not this lint)", () => {
    expect(lintManifestPatterns("math", ["calculate *", "compute *", "what does * equal"])).toEqual([]);
  });

  test("the SAME pattern text on a package with no declared resolver still fails - the allowlist is packageId:pattern, never the pattern alone", () => {
    expect(lintManifestPatterns("knowledge", ["what does * equal"])).toEqual(["what does * equal"]);
  });
});

test("COMPUTED_WILDCARD_RESOLVERS: math's own resolver accepts a real expression and rejects a non-expression", () => {
  const resolver = COMPUTED_WILDCARD_RESOLVERS["math:what does * equal"]!;
  expect(resolver("15 * 12")).toBe(true);
  expect(resolver("love")).toBe(false);
});

describe("NEVER_FIRES_WILDCARDS", () => {
  test("names exactly the two bundled 'tell me about' openers, never a broader guess", () => {
    expect(NEVER_FIRES_WILDCARDS.has("knowledge:tell me about *")).toBe(true);
    expect(NEVER_FIRES_WILDCARDS.has("media-lookup:tell me about the movie *")).toBe(true);
    expect(NEVER_FIRES_WILDCARDS.size).toBe(2);
  });

  test("isQuestionWordOpener() does not catch 'tell me about *' - it grammatically reads as a directive, not an interrogative, which is exactly why it needs its own named list", () => {
    expect(isQuestionWordOpener("tell me about *")).toBe(false);
  });
});
