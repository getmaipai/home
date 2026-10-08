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
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argsGrounded, policyNode } from "@/lib/turnMachine/nodes/policy";
import { loadManifestOnly, __resetPackageCachesForTests } from "@/lib/plugins";
import { installedPackageVersionDir } from "@/lib/paths";
import { db } from "@/db";
import { packageInstalls } from "@/db/schema";
import { resetDb } from "../reset-db";
import type { NodeOutcome, TurnState } from "@/lib/turnMachine/contract";

const websearch = loadManifestOnly("websearch");
if (!websearch.ok) throw new Error("websearch manifest failed to load for policy.test.ts");
// The enum-typed field these tests exercise is websearch's former `category`
// (removed from the manifest by ANSWER-IMG-02); the exemption mechanism is
// unchanged, so the fixture keeps that field's exact shape beside the live args.
const liveArgs = websearch.value.args as { properties?: Record<string, { type?: string; enum?: readonly unknown[] }> };
const schema = { ...liveArgs, properties: { ...liveArgs.properties, category: { type: "string", enum: ["images"] as readonly unknown[] } } };

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

// ANSWER-IMG-06: show_images' `kind` is the model's own one-to-three-word
// classification ("person", "building", "animal"), never something the person
// said. A real-turn bench trace showed every call refused as `ungrounded_args`
// on `kind` and answered with the "I won't guess" line: Michael Jackson with
// kind "person", Eiffel Tower with "building", koala with "animal". Only the
// `subject` (the thing the person named) is grounded.
describe("argsGrounded(): show_images grounds the subject, not the model's own kind", () => {
  const showImages = loadManifestOnly("show_images");
  if (!showImages.ok) throw new Error("show_images manifest failed to load");
  const showSchema = showImages.value.args as typeof schema;

  test("the exact calls the live bench traced pass: subject named, kind a classification the person never said", () => {
    expect(argsGrounded({ subject: "Michael Jackson", kind: "person" }, ["show me a picture of Michael Jackson"], showSchema)).toBe(true);
    expect(argsGrounded({ subject: "Eiffel Tower", kind: "building" }, ["what does the Eiffel Tower look like"], showSchema)).toBe(true);
    expect(argsGrounded({ subject: "koala", kind: "animal" }, ["what does a koala look like"], showSchema)).toBe(true);
  });

  test("the subject is still grounded: a subject the person never said is refused whatever the kind", () => {
    expect(argsGrounded({ subject: "Eiffel Tower", kind: "building" }, ["what does a koala look like"], showSchema)).toBe(false);
  });

  test("a bare pronoun subject is still refused", () => {
    expect(argsGrounded({ subject: "he", kind: "person" }, ["what does he look like"], showSchema)).toBe(false);
  });

  test("a follow-up grounds on the window's earlier user turn", () => {
    expect(argsGrounded({ subject: "Michael Jackson", kind: "person" }, ["what does he look like", "who is Michael Jackson"], showSchema)).toBe(true);
  });
});

// MANIFEST-REFUSAL-01 (fixes getmaipai/home#166, coordinator's comment
// 2026-09-26): the live incident was every bundled manifest gaining an
// `incognito` key the still-running process's schema didn't know, and
// `policyNode` reported nothing but `unknown_tool` for every tool, with
// no way to tell "the model invented a tool name" (404, stays
// unknown_tool) from "a real package is broken" (400, now
// manifest_invalid, with the validation message carried into the
// trace) - the resolver, the issue's own "suspected root cause," was
// never the actual defect.
describe("policyNode: a manifest that fails validation is refused as manifest_invalid, a missing package stays unknown_tool", () => {
  const TEST_PKG_DIR = installedPackageVersionDir("test-pkg", "1.0.0");

  beforeEach(() => resetDb());

  afterEach(() => {
    rmSync(TEST_PKG_DIR, { recursive: true, force: true });
    __resetPackageCachesForTests();
  });

  function baseState(utterance: string): TurnState {
    return {
      actor: { role: "adult" },
      context: [],
      crisis: false,
      temporary: false,
      utterance,
    } as unknown as TurnState;
  }

  function asFailure(outcome: NodeOutcome): { ok: false; code: string; arg?: string; message?: string } {
    if (!("ok" in outcome) || outcome.ok !== false) throw new Error("expected a refusal outcome");
    return outcome;
  }

  test("a package whose manifest fails validation is refused as manifest_invalid with the validation message in the trace, and a package that does not exist stays unknown_tool with no message", async () => {
    db.insert(packageInstalls)
      .values({
        packageId: "test-pkg",
        version: "1.0.0",
        previousVersion: null,
        channel: "stable",
        sourceCommit: "test",
        permissions: "[]",
        installedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    const websearchManifest = JSON.parse(readFileSync(join(process.cwd(), "packages", "websearch", "manifest.json"), "utf-8"));
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(join(TEST_PKG_DIR, "manifest.json"), JSON.stringify({ ...websearchManifest, incognito_typo: true }));

    const state = baseState("search the web for the tallest mountain");
    const invalidCall = { tool: "test-pkg", args: { expression: "the tallest mountain" }, id: "call-1" };
    const invalid = await policyNode(state, { calls: [invalidCall] }, new AbortController().signal);
    expect(invalid.output.entries).toHaveLength(1);
    expect(invalid.output.entries[0]?.decision).toEqual({ allow: false, reason: "manifest_invalid" });
    const invalidOutcome = asFailure(invalid.outcome);
    expect(invalidOutcome.code).toBe("manifest_invalid");
    expect(invalidOutcome.arg).toBe("test-pkg");
    expect(invalidOutcome.message).toContain("incognito_typo");

    const missingCall = { tool: "no-such-pkg", args: {}, id: "call-2" };
    const missing = await policyNode(state, { calls: [missingCall] }, new AbortController().signal);
    expect(missing.output.entries).toHaveLength(1);
    expect(missing.output.entries[0]?.decision).toEqual({ allow: false, reason: "unknown_tool" });
    const missingOutcome = asFailure(missing.outcome);
    expect(missingOutcome.code).toBe("unknown_tool");
    expect(missingOutcome.arg).toBe("no-such-pkg");
    expect(missingOutcome.message).toBeUndefined();
  });
});

// THIN-0D: a model-proposed recall for an unidentified robot speaker is
// refused (the recall package reads the signed-in person's memories).
describe("policyNode: THIN-0D, a recall proposal is refused for an unidentified robot speaker", () => {
  beforeEach(() => resetDb());

  function robotState(speakerEvidence: TurnState["speakerEvidence"]): TurnState {
    return { actor: { id: "owner-1", role: "owner" }, surface: "robot", speakerEvidence, context: [], crisis: false, temporary: false, utterance: "do you remember my favorite food" } as unknown as TurnState;
  }
  const call = { tool: "recall", args: { topic: "favorite food" }, id: "call-1" };

  test("no evidence refuses with anonymous_speaker; the identified speaker is allowed; another surface is allowed", async () => {
    const anon = await policyNode(robotState(null), { calls: [call] }, new AbortController().signal);
    expect(anon.output.entries[0]?.decision).toEqual({ allow: false, reason: "anonymous_speaker" });
    const known = await policyNode(robotState({ person: "owner-1", basis: "voice", level: "confirmed" }), { calls: [call] }, new AbortController().signal);
    expect(known.output.entries[0]?.decision).toEqual({ allow: true });
    const chat = await policyNode({ ...robotState(null), surface: "chat" } as TurnState, { calls: [call] }, new AbortController().signal);
    expect(chat.output.entries[0]?.decision).toEqual({ allow: true });
  });
});

// THIN-0D follow-up: the remember package writes as the signed-in person,
// so an unknown voice cannot write a memory either.
describe("policyNode: THIN-0D, a remember proposal is refused for an unidentified robot speaker", () => {
  beforeEach(() => resetDb());

  function robotState(speakerEvidence: TurnState["speakerEvidence"]): TurnState {
    return { actor: { id: "owner-1", role: "owner" }, surface: "robot", speakerEvidence, context: [], crisis: false, temporary: false, utterance: "remember that my favorite food is pizza" } as unknown as TurnState;
  }
  const call = { tool: "remember", args: { fact: "my favorite food is pizza" }, id: "call-1" };

  test("no evidence refuses with anonymous_speaker; the identified speaker is allowed; another surface is allowed", async () => {
    const anon = await policyNode(robotState(null), { calls: [call] }, new AbortController().signal);
    expect(anon.output.entries[0]?.decision).toEqual({ allow: false, reason: "anonymous_speaker" });
    const known = await policyNode(robotState({ person: "owner-1", basis: "voice", level: "confirmed" }), { calls: [call] }, new AbortController().signal);
    expect(known.output.entries[0]?.decision).toEqual({ allow: true });
    const chat = await policyNode({ ...robotState(null), surface: "chat" } as TurnState, { calls: [call] }, new AbortController().signal);
    expect(chat.output.entries[0]?.decision).toEqual({ allow: true });
  });
});
