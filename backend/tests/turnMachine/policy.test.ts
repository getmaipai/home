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
// CF-SEARCH-01 (live, 2026-10-17): "is cloud flare down right now" made the model write
// "Cloudflare outage status October 17 2026". No exact term in common, so the search was refused
// as ungrounded and the fixed "I won't guess" line replaced the answer. Spacing and one typo letter
// in a name of 6 or more letters no longer count as a different word.
describe("argsGrounded(): a name typed with a space or a typo still grounds the query", () => {
  const typed = ["is cloud flare down right now"];
  test("the exact live query passes", () => {
    expect(argsGrounded({ expression: "Cloudflare outage status October 17 2026", scope: "web" }, typed, schema)).toBe(true);
    expect(argsGrounded({ expression: "Cloudflare status down", scope: "web" }, typed, schema)).toBe(true);
  });
  test("the person typed one word and the model wrote two", () => {
    expect(argsGrounded({ expression: "git hub outage status" }, ["is github down"], schema)).toBe(true);
  });
  test("one typo letter in a long name", () => {
    expect(argsGrounded({ expression: "cloudflare outage" }, ["is cloudfare down"], schema)).toBe(true);
    expect(argsGrounded({ expression: "youtube outage" }, ["is youtub down"], schema)).toBe(true);
  });
  test("short words never match loosely", () => {
    expect(argsGrounded({ expression: "cat video" }, ["is cut down"], schema)).toBe(false);
    expect(argsGrounded({ expression: "iphone price" }, ["what about phone"], schema)).toBe(false);
  });
  test("an unrelated query is still refused", () => {
    expect(argsGrounded({ expression: "Zanzibar Quartz film" }, typed, schema)).toBe(false);
    expect(argsGrounded({ expression: "how to pick a lock" }, ["when is dune 3 releasing"], schema)).toBe(false);
  });
});

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

describe("policyNode: structured brake confirmation", () => {
  test("an adult removal of more than five items parks confirm_needed", async () => {
    const original = loadManifestOnly("remind");
    if (!original.ok) throw new Error("remind manifest failed to load");
    const state = { actor: { id: "adult-1", role: "adult" }, surface: "chat", speakerEvidence: { kind: "person" }, context: [], crisis: false, temporary: false, utterance: "move several things" } as unknown as TurnState;
    const outcome = await policyNode(state, { calls: [{ id: "call-1", tool: "remind", args: { action: "move", itemCount: 6 } }] }, new AbortController().signal);
    expect(outcome.output.entries[0]?.decision).toMatchObject({ allow: false, reason: "confirm_needed" });
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

// SEARCH-ANSWER-05: "show me the poster" names no film; the last reply did. show_images'
// `subject` alone (manifest `grounded: "conversation"`) also grounds on the last two
// `window-assistant-*` turns. Never a tool item, never another tool's arguments, never three back.
describe("policyNode: show_images' subject grounds on the last assistant turns", () => {
  beforeEach(() => resetDb());

  const item = (id: string, text: string, source = "window") => ({ id, text, source, subjects: [], disclosure: "child_ok" });
  function stateWith(utterance: string, context: unknown[], role = "adult"): TurnState {
    return { actor: { role }, context, crisis: false, temporary: false, utterance } as unknown as TurnState;
  }
  async function decide(state: TurnState, tool: string, args: Record<string, unknown>) {
    const result = await policyNode(state, { calls: [{ tool, args, id: "c1" }] }, new AbortController().signal);
    return result.output.entries[0]?.decision;
  }
  const poster = { subject: "Zanzibar Quartz", kind: "film" };

  test("a name that appears only in the last assistant turn grounds the subject", async () => {
    const state = stateWith("show me the poster", [item("window-user-1", "tell me about that old film"), item("window-assistant-2", "That is Zanzibar Quartz, a 1974 thriller.")]);
    expect(await decide(state, "show_images", poster)).toEqual({ allow: true });
  });

  test("the same name only in a tool item is still refused", async () => {
    const state = stateWith("show me the poster", [item("window-user-1", "tell me about that old film"), item("window-tool-2", "Zanzibar Quartz, a 1974 thriller.")]);
    expect(await decide(state, "show_images", poster)).toEqual({ allow: false, reason: "ungrounded_args" });
  });

  test("an assistant turn that only carried tool calls takes no slot", async () => {
    const state = stateWith("show me the poster", [
      item("window-assistant-1", "That is Zanzibar Quartz, a 1974 thriller."),
      item("window-assistant-2", ""), item("window-tool-3", "results"), item("window-assistant-4", "Here is what I found."),
    ]);
    expect(await decide(state, "show_images", poster)).toEqual({ allow: true });
  });

  test("the system summary never grounds it either", async () => {
    const state = stateWith("show me the poster", [item("window-system-summary", "Zanzibar Quartz was discussed.")]);
    expect(await decide(state, "show_images", poster)).toEqual({ allow: false, reason: "ungrounded_args" });
  });

  test("a websearch call with an assistant-only name is still refused", async () => {
    const state = stateWith("look it up", [item("window-user-1", "tell me about that old film"), item("window-assistant-2", "That is Zanzibar Quartz, a 1974 thriller.")]);
    expect(await decide(state, "websearch", { expression: "Zanzibar Quartz" })).toEqual({ allow: false, reason: "ungrounded_args" });
  });

  test("a name from three assistant turns back is refused", async () => {
    const state = stateWith("show me the poster", [
      item("window-assistant-1", "That is Zanzibar Quartz, a 1974 thriller."),
      item("window-user-2", "ok"), item("window-assistant-3", "Anything else?"),
      item("window-user-4", "no"), item("window-assistant-5", "Fine."),
    ]);
    expect(await decide(state, "show_images", poster)).toEqual({ allow: false, reason: "ungrounded_args" });
  });

  test("a bare pronoun subject is still refused whatever the assistant said", async () => {
    const state = stateWith("show me", [item("window-assistant-1", "He was in it, and it was good.")]);
    expect(await decide(state, "show_images", { subject: "it", kind: "film" })).toEqual({ allow: false, reason: "ungrounded_args" });
  });
});

// WEATHER-FOLLOWUP-01 (live, 2026-10-17): "what's the weather?" answered for the household's
// home city, then "will it rain tomorrow?" had the model call weather with that city, which the
// person never typed (the hub's own reply named it). The call was refused as `ungrounded_args`
// and the fixed honesty line replaced the answer. The weather manifest now marks `place`
// `grounded: "conversation"`, the same seam show_images' subject uses, so a place the last two
// replies named grounds a follow-up; a place nobody said is still refused.
describe("policyNode: weather's place grounds on the last assistant turns", () => {
  beforeEach(() => resetDb());

  const item = (id: string, text: string, source = "window") => ({ id, text, source, subjects: [], disclosure: "child_ok" });
  function stateWith(utterance: string, context: unknown[]): TurnState {
    return { actor: { role: "adult" }, context, crisis: false, temporary: false, utterance } as unknown as TurnState;
  }
  async function decide(state: TurnState, args: Record<string, unknown>) {
    const result = await policyNode(state, { calls: [{ tool: "weather", args, id: "c1" }] }, new AbortController().signal);
    return result.output.entries[0]?.decision;
  }

  test("the home city the last reply named grounds a follow-up's place", async () => {
    const state = stateWith("will it rain tomorrow?", [item("window-user-1", "what's the weather?"), item("window-assistant-2", "It's 39°F and clear right now in Chicago.")]);
    expect(await decide(state, { place: "Chicago" })).toEqual({ allow: true });
  });

  test("a place nobody said is still refused", async () => {
    const state = stateWith("will it rain tomorrow?", [item("window-user-1", "what's the weather?"), item("window-assistant-2", "It's 39°F and clear right now.")]);
    expect(await decide(state, { place: "Chicago" })).toEqual({ allow: false, reason: "ungrounded_args" });
  });

  test("the manifest declares the seam, so the check is data, not a weather special case", () => {
    const manifest = loadManifestOnly("weather");
    if (!manifest.ok) throw new Error("the bundled weather manifest did not load");
    expect((manifest.value.args as { properties: Record<string, { grounded?: string }> }).properties.place?.grounded).toBe("conversation");
  });
});
