// U2 (the owner's ruling, state record "Grounding, stated exactly",
// 2a28e4e8): argsGrounded() is term-level, not substring, after a live
// run caught the substring version refusing every real, naturally-
// reworded search query. Direct unit tests of the exported function -
// faster and more precise than a full live-engine turn for exercising
// exactly the grounding decision, the same way conversationFixture.ts's
// own scripted rows exist beside its live-run mode.
//
// GROUND-01 (state record, "The live grounding refusals...", step 2):
// argsGrounded() still checks every string argument by default (the
// original behavior, preserved) - the live capture
// (data-scratch/ground-01-capture.md) caught `category` (websearch's
// own fixed "images" enum value) being checked for term overlap and
// refusing every real query that carried it, so the fix exempts a
// manifest's own schema-typed fields (enum, boolean - values the
// manifest supplies, never something a person said), not "every field
// except the one a manifest happens to mark." A review of the first
// cut caught the opposite reading (an opt-in `search_text` mark)
// silently removing grounding from every package but websearch, since
// "the executor's own exact-match validation" the design record names
// for identifiers/recipients/quantities/durations does not exist as a
// distinct mechanism anywhere in this codebase. The schema passed to
// every call below comes from the loaded manifest, the same one
// policy.ts itself reads at runtime, never a hand-built stand-in.
import { describe, expect, test } from "bun:test";
import { argsGrounded } from "@/lib/turnMachine/nodes/policy";
import { loadManifestOnly } from "@/lib/plugins";

const websearch = loadManifestOnly("websearch");
if (!websearch.ok) throw new Error("websearch manifest failed to load for policy.test.ts");
const schema = websearch.value.args as { properties?: Record<string, { type?: string; enum?: readonly unknown[] }> };

describe("argsGrounded(): term-level, not substring", () => {
  test('"president of Chile 2026" passes against "who is the president of chile" (the year never counts against it)', () => {
    expect(argsGrounded({ expression: "president of Chile 2026" }, ["who is the president of chile"], schema)).toBe(true);
  });

  test('"how to pick a lock" is refused against a Dune question (zero overlap)', () => {
    expect(argsGrounded({ expression: "how to pick a lock" }, ["when is dune 3 releasing"], schema)).toBe(false);
  });

  test('"he born" is refused (zero overlap with an unrelated utterance)', () => {
    expect(argsGrounded({ expression: "he born" }, ["who is the president of chile"], schema)).toBe(false);
  });

  test("a bare pronoun as the whole argument is refused even with real overlap available", () => {
    expect(argsGrounded({ expression: "he" }, ["he said he would call"], schema)).toBe(false);
  });

  test("a bare pronoun with trailing punctuation is still refused (a review's own finding)", () => {
    // The first cut checked the raw value verbatim, so "it?"/"It." slid
    // past the pronoun check, then tokenize() silently dropped "it" as
    // a stopword into an empty, trivially-passing term list.
    expect(argsGrounded({ expression: "it?" }, ["who is the president of chile"], schema)).toBe(false);
    expect(argsGrounded({ expression: "It." }, ["who is the president of chile"], schema)).toBe(false);
  });

  test("a purely numeric argument never counts against itself", () => {
    expect(argsGrounded({ expression: "2026" }, ["who is the president of chile"], schema)).toBe(true);
  });

  test("a household member's own name (the roster's own text) grounds a follow-up", () => {
    expect(argsGrounded({ expression: "Sage calendar" }, ["what's on the calendar", "Sage"], schema)).toBe(true);
  });
});

describe("argsGrounded(): GROUND-01 step 2, exempts only the manifest's schema-typed fields", () => {
  test('{ expression: "president of chile 2026", category: "images" } passes against "who is the president of chile" - category is an enum value, never checked for term overlap', () => {
    expect(argsGrounded({ expression: "president of chile 2026", category: "images" }, ["who is the president of chile"], schema)).toBe(true);
  });

  test("read_page (a boolean) never counts against grounding either", () => {
    expect(argsGrounded({ expression: "president of chile 2026", category: "images", read_page: true }, ["who is the president of chile"], schema)).toBe(true);
  });

  test("category (the enum value) alone, without expression, still refuses if it were ever the only argument - enum exemption never becomes a blanket pass for the whole call", () => {
    // Not a real websearch call shape (expression is required), but
    // proves the exemption is per-field, not per-call: a second,
    // unexempted field in the same args object still has to ground.
    expect(argsGrounded({ category: "images", note: "totally unrelated made-up text" }, ["who is the president of chile"], schema)).toBe(false);
  });

  test("every other package's string arguments are still checked by default - no manifest mark required", () => {
    // remember's own manifest has no enum/boolean fields and no
    // search_text mark; a fabricated, unrelated fact must still be
    // refused, the same protection every tool had before this fix.
    const remember = loadManifestOnly("remember");
    if (!remember.ok) throw new Error("remember manifest failed to load");
    expect(argsGrounded({ fact: "the sky is purple and made of jello" }, ["remember that pizza night is Friday"], remember.value.args as typeof schema)).toBe(false);
  });

  test("with no schema passed, every string field is still checked (schema only ever narrows what's exempt, never what's checked)", () => {
    expect(argsGrounded({ expression: "how to pick a lock" }, ["when is dune 3 releasing"])).toBe(false);
  });
});
