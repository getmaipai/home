// NEXT-CACHE-01 (dev.md "U6 rerun ruling" (b) 2): contextToMessages()'s
// own cache-stable order, unit-tested directly against a synthetic
// ContextItem[] rather than a full turn - faster and more precise than
// driving the whole machine for exactly what this function decides:
// which items land in the stable message ahead of the window, which
// land in the volatile message after it, and that the stable message's
// own content never changes when only the volatile items do (the exact
// claim the prompt cache depends on).
//
// U4b (dev.md "U6 rerun 2 ruling" (1)) widened the signature: persona,
// plan, signal and surfaceClass are real inputs now, not "context
// alone" - buildStablePrefix(persona) always opens the stable message
// (identity, composePersonaPrompt, the two policies) and the volatile
// one always closes with companionReanchorLine() then planLine(), so
// there is no longer a "no stable message"/"no volatile message" case
// at all. The reanchor line was a review's own finding on the first
// cut: the old path resends it every turn specifically because legacy
// measured real persona-voice drift after about eight turns with
// nothing repeating who's speaking - carrying the identity line once,
// in the cached stable prefix, doesn't fight that on its own.
import { describe, expect, test } from "bun:test";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { contextToMessages } from "@/lib/turnMachine/messages";
import type { ContextItem } from "@/lib/turnMachine/contract";
import { fallbackSignal } from "@/lib/turnSignal";
import { planFor, type PlanInput } from "@/lib/register";
import { buildStablePrefix, companionReanchorLine } from "@/lib/turnEngine";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { MEMORY_SECTION_HEADER, MEMORY_TRUST_REMINDER, NOTHING_STORED_LINE } from "@/lib/memoryFraming";

function item(source: ContextItem["source"], text: string, id = `${source}-1`): ContextItem {
  return { id, text, source, subjects: [], disclosure: "child_ok" };
}

const signal: TurnSignal = fallbackSignal("what's the weather", "adult");
const planInput: PlanInput = { signal, surface: "chat", surfaceClass: "spoken", brevity: false, evidence: { choices: 0, sources: 0, deliverable: false }, companion: { directness: "diplomatic", engagement: "balanced", vocabulary: "advanced" }, band: "adult", deferred: false, disclosureWithheld: false };
const plan = planFor(planInput);
const STABLE_PREFIX = buildStablePrefix(DEFAULT_PERSONA);
const REANCHOR = companionReanchorLine(DEFAULT_PERSONA).trim();

function messages(context: ContextItem[], utterance = "what's the weather") {
  return contextToMessages(context, utterance, DEFAULT_PERSONA, plan, signal, "spoken");
}

describe("contextToMessages(): NEXT-CACHE-01's cache-stable order", () => {
  test("profile and roster land in the first (stable) system message, ahead of the window", () => {
    const context: ContextItem[] = [
      item("profile", "Sage's profile: likes hiking."),
      item("roster", "Sage", "roster-0"),
      item("window", "hi", "window-user-1"),
      item("window", "Hello!", "window-assistant-2"),
    ];
    const out = messages(context);
    expect(out[0]).toEqual({ role: "system", content: `${STABLE_PREFIX}\n\n[profile] Sage's profile: likes hiking.\n[household] Sage` });
    expect(out[1]).toEqual({ role: "user", content: "hi" });
    expect(out[2]).toEqual({ role: "assistant", content: "Hello!" });
  });

  // CONTEXT-RECALL-01 (dev.md "The owner's three live turns", (2)): the
  // memory item leads the volatile message wrapped in the shared
  // header/trust-line framing (memoryFraming.ts), never a bare
  // "[remembered] ..." line - the clock (and any other volatile
  // source) still renders as a plain labeled line, after it.
  test("memory and clock land in a second system message, after the window and before the utterance", () => {
    const context: ContextItem[] = [item("memory", "Sage likes tea.", "memory-1"), item("clock", "Monday 9:00 AM")];
    const out = messages(context);
    expect(out[0]).toEqual({ role: "system", content: STABLE_PREFIX });
    expect(out[1]?.content.startsWith(`${MEMORY_SECTION_HEADER}\n[remembered] Sage likes tea.\n${MEMORY_TRUST_REMINDER}\n\n[clock] Monday 9:00 AM\n\n${REANCHOR}\n\nHow to answer this one:`)).toBe(true);
    expect(out[2]).toEqual({ role: "user", content: "what's the weather" });
  });

  // CONTEXT-RECALL-01's own test, in the row's exact words.
  test("the volatile message begins with the header line", () => {
    const context: ContextItem[] = [item("clock", "Monday 9:00 AM")];
    const out = messages(context, "hi");
    expect(out[1]?.content.startsWith(MEMORY_SECTION_HEADER)).toBe(true);
  });

  test("no memory items at all: the volatile message still says nothing was found, framed the same way", () => {
    const context: ContextItem[] = [item("clock", "Monday 9:00 AM")];
    const out = messages(context, "hi");
    expect(out[1]?.content.startsWith(`${MEMORY_SECTION_HEADER}\n${NOTHING_STORED_LINE}\n${MEMORY_TRUST_REMINDER}\n\n[clock] Monday 9:00 AM\n\n`)).toBe(true);
  });

  test("both halves together: stable, window, volatile, utterance, in that exact order", () => {
    const context: ContextItem[] = [
      item("profile", "Sage's profile: likes hiking."),
      item("roster", "Sage", "roster-0"),
      item("window", "hi", "window-user-1"),
      item("window", "Hello!", "window-assistant-2"),
      item("memory", "Sage likes tea.", "memory-1"),
      item("clock", "Monday 9:00 AM"),
    ];
    const out = messages(context);
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "system", "user"]);
    expect(out[0]?.content).toBe(`${STABLE_PREFIX}\n\n[profile] Sage's profile: likes hiking.\n[household] Sage`);
    expect(out[3]?.content.startsWith(`${MEMORY_SECTION_HEADER}\n[remembered] Sage likes tea.\n${MEMORY_TRUST_REMINDER}\n\n[clock] Monday 9:00 AM\n\n${REANCHOR}\n\nHow to answer this one:`)).toBe(true);
    expect(out[4]).toEqual({ role: "user", content: "what's the weather" });
  });

  // The prompt cache's own actual claim: the stable message's content
  // is a function of persona and the stable items alone, never plan,
  // signal or the volatile items - two turns in the same conversation
  // with the same persona/profile/roster but a different plan, signal,
  // memory match and clock reading must produce byte-identical stable
  // messages, the real-common-prefix property llama-server's cache
  // needs to hit at all.
  test("the stable message is byte-identical across two turns whose only difference is plan, signal or volatile context", () => {
    const stableItems: ContextItem[] = [item("profile", "Sage's profile: likes hiking."), item("roster", "Sage", "roster-0")];
    const signal2 = fallbackSignal("who won the game", "adult", "identified_profile", "question");
    const plan2 = planFor({ ...planInput, signal: signal2 });
    const turn1 = contextToMessages([...stableItems, item("memory", "Sage likes tea.", "memory-1"), item("clock", "Monday 9:00 AM")], "what's the weather", DEFAULT_PERSONA, plan, signal, "spoken");
    const turn2 = contextToMessages([...stableItems, item("memory", "Sage's birthday is in June.", "memory-2"), item("clock", "Monday 9:05 AM")], "who won the game", DEFAULT_PERSONA, plan2, signal2, "spoken");
    expect(turn1[0]).toEqual(turn2[0]);
  });

  test("no stable context items: the stable message is still buildStablePrefix() alone, never empty or skipped", () => {
    const context: ContextItem[] = [item("memory", "Sage likes tea.", "memory-1")];
    const out = messages(context, "hi");
    expect(out[0]).toEqual({ role: "system", content: STABLE_PREFIX });
    expect(out[1]?.content.startsWith(`${MEMORY_SECTION_HEADER}\n[remembered] Sage likes tea.\n${MEMORY_TRUST_REMINDER}\n\n`)).toBe(true);
  });

  // CONTEXT-RECALL-01: no memory (or clock, or any other) item at all
  // still gets the framed "nothing matched" block - the memory block
  // always leads the volatile message, ahead of the reanchor and plan
  // lines U4b added.
  test("no volatile context items: the volatile message is still the reanchor line and the plan line, never empty or skipped", () => {
    const context: ContextItem[] = [item("profile", "Sage's profile: likes hiking.")];
    const out = messages(context, "hi");
    expect(out[0]).toEqual({ role: "system", content: `${STABLE_PREFIX}\n\n[profile] Sage's profile: likes hiking.` });
    expect(out[1]).toEqual({ role: "system", content: expect.stringContaining("How to answer this one:") });
    expect(out[1]?.content.startsWith(`${MEMORY_SECTION_HEADER}\n${NOTHING_STORED_LINE}\n${MEMORY_TRUST_REMINDER}\n\n${REANCHOR}`)).toBe(true);
    expect(out[2]).toEqual({ role: "user", content: "hi" });
  });

  test("the utterance itself never appears in either context message, only as the final user message", () => {
    const context: ContextItem[] = [item("profile", "Sage's profile."), item("utterance", "what's the weather", "utterance")];
    const out = messages(context);
    expect(out.filter((m) => m.role === "system").every((m) => !m.content.includes("[utterance]"))).toBe(true);
    expect(out.at(-1)).toEqual({ role: "user", content: "what's the weather" });
  });
});

// U4b's own additions, tested directly against the real functions they
// carry over from turnEngine.ts/register.ts, never a re-typed copy.
describe("contextToMessages(): U4b, the persona prefix, the reanchor and the plan line", () => {
  test("the stable message opens with buildStablePrefix(persona) verbatim", () => {
    const out = messages([]);
    expect(out[0]?.content).toBe(STABLE_PREFIX);
    expect(STABLE_PREFIX.length).toBeGreaterThan(0);
  });

  // A review caught the first cut of this item dropping the old path's
  // own companionReanchorLine() entirely - identity sent once, in the
  // cached prefix, is not the same guarantee as the old path's own
  // every-turn repeat, the thing that actually fights persona-voice
  // drift on a long conversation.
  test("the volatile message repeats the persona's identity every turn (companionReanchorLine)", () => {
    const out = messages([], "what's the weather");
    const volatileMessage = out.find((m) => m.role === "system" && m.content.includes("How to answer this one:"));
    // CONTEXT-RECALL-01: the memory block (here, "nothing matched" -
    // an empty context recalls nothing) leads the volatile message,
    // ahead of the reanchor line.
    expect(volatileMessage?.content.startsWith(`${MEMORY_SECTION_HEADER}\n${NOTHING_STORED_LINE}\n${MEMORY_TRUST_REMINDER}\n\n${REANCHOR}`)).toBe(true);
    expect(REANCHOR).toContain(DEFAULT_PERSONA.display_name);
  });

  test("the volatile message ends with planLine()'s own words for this signal", () => {
    const out = messages([], "what's the weather");
    const volatileMessage = out.find((m) => m.role === "system" && m.content.includes("How to answer this one:"));
    expect(volatileMessage).toBeDefined();
    expect(volatileMessage?.content).toContain("a statement about themselves");
  });

  // The written prompt on tier 1, decided (dev.md, the coordinator's
  // own design record): a written-adult turn carries no plan line at
  // all (arm 1 measured 0 of 5 "you" misreads with it gone, arm 2
  // reproduced the misread with the reanchor folded in instead - both
  // are instruction, never content). The spoken class is unaffected.
  test("a written adult turn carries no plan line at all; a spoken turn keeps it", () => {
    const spoken = contextToMessages([], "hi", DEFAULT_PERSONA, plan, signal, "spoken");
    const written = contextToMessages([], "hi", DEFAULT_PERSONA, plan, signal, "written");
    const spokenLine = spoken.find((m) => m.content.includes("How to answer this one:"));
    const writtenLine = written.find((m) => m.content.includes("How to answer this one:"));
    expect(spokenLine).toBeDefined();
    expect(writtenLine).toBeUndefined();
  });

  // The reply floor is a written-class, ADULT-only backstop
  // (isWrittenAdultTurn, surfaceClass.ts). A code review (U4b-2) caught
  // this file's first cut passing a "written" surfaceClass straight
  // through regardless of band: a child's chat turn got the written
  // persona's "use whatever structure" wording and planLine's "as long
  // as it needs" length clause, while nodes/model.ts's max_tokens still
  // fell through to the small, age-clamped word budget - the model was
  // told to answer completely and use structure while capped to a
  // fraction of the tokens that would take.
  test("a minor's written turn still reads spoken: the reply floor is adult-only", () => {
    const childSignal: TurnSignal = fallbackSignal("how do I make a paper airplane", "child");
    const childPlanInput: PlanInput = { signal: childSignal, surface: "chat", surfaceClass: "written", brevity: false, evidence: { choices: 0, sources: 0, deliverable: false }, companion: { directness: "diplomatic", engagement: "balanced", vocabulary: "simple" }, band: "child", deferred: false, disclosureWithheld: false };
    const childPlan = planFor(childPlanInput);
    const out = contextToMessages([], "how do I make a paper airplane", DEFAULT_PERSONA, childPlan, childSignal, "written");
    const stableMessage = out[0]!;
    const volatileMessage = out.find((m) => m.role === "system" && m.content.includes("How to answer this one:"));
    expect(stableMessage.content).toContain("Say things the way a person talking out loud would");
    expect(stableMessage.content).not.toContain("use whatever structure");
    expect(volatileMessage?.content).not.toContain("as complete as you would answer with no persona at all");
  });

  // PREFIX-ROLE-01 (dev.md "PREFIX-ROLE-01: moving the stable message's
  // role alone does not clear the bar either"): tried and reverted -
  // moving the stable message to role "user" for a written-adult turn
  // measured no effect live (0.15x/0.16x, no better than the system-role
  // shape it replaced). The stable message stays role "system" on every
  // surface class, unconditionally.
  test("the stable message is always role \"system\", on every surface class - PREFIX-ROLE-01's role move was reverted", () => {
    const written = contextToMessages([], "hi", DEFAULT_PERSONA, plan, signal, "written");
    const spoken = contextToMessages([], "hi", DEFAULT_PERSONA, plan, signal, "spoken");
    expect(written[0]!.role).toBe("system");
    expect(spoken[0]!.role).toBe("system");
  });

  // The written prompt on tier 1, decided (dev.md, the coordinator's
  // own design record, 2026-09-23): the ceiling's shape, in the item's
  // own words. Every test below is named directly from the ruling's own
  // acceptance list.
  describe("the written prompt on tier 1, decided", () => {
    test("the written prefix contains no dial or policy fragment", () => {
      const written = contextToMessages([], "hi", DEFAULT_PERSONA, plan, signal, "written");
      const stableMessage = written[0]!;
      // Every spoken-class dial fragment's own instructive marker text -
      // none of it belongs in the written stable message while
      // WRITTEN_VOICE_PROSE is off.
      expect(stableMessage.content).not.toContain("relaxed, friendly tone");
      expect(stableMessage.content).not.toContain("plain, everyday language");
      expect(stableMessage.content).not.toContain("answers the exact question completely");
      expect(stableMessage.content).not.toContain("clean and direct");
      expect(stableMessage.content).not.toContain("Detail nobody asked for");
      expect(stableMessage.content).not.toContain("Numbers and dates are said exactly");
      expect(stableMessage.content).toBe(buildStablePrefix(DEFAULT_PERSONA, "written"));
    });

    test("a written adult turn with no memory match emits no volatile system message at all", () => {
      const out = contextToMessages([], "hi", DEFAULT_PERSONA, plan, signal, "written");
      // Exactly two messages: the stable message and the utterance -
      // nothing in between when there is nothing to say.
      expect(out).toHaveLength(2);
      expect(out[0]!.role).toBe("system");
      expect(out[1]!).toEqual({ role: "user", content: "hi" });
    });

    test("a written adult turn with a memory match emits the header, the bullet and the trust line, and no reanchor, no plan line", () => {
      const context: ContextItem[] = [item("memory", "the household calendar rule about pizza night")];
      const out = contextToMessages(context, "hi", DEFAULT_PERSONA, plan, signal, "written");
      const volatileMessage = out.find((m) => m.role === "system" && m !== out[0]);
      expect(volatileMessage).toBeDefined();
      expect(volatileMessage!.content).toContain(MEMORY_SECTION_HEADER);
      expect(volatileMessage!.content).toContain("the household calendar rule about pizza night");
      expect(volatileMessage!.content).toContain(MEMORY_TRUST_REMINDER);
      expect(volatileMessage!.content).not.toContain(NOTHING_STORED_LINE);
      expect(volatileMessage!.content).not.toContain(REANCHOR);
      expect(volatileMessage!.content).not.toContain("How to answer this one:");
      expect(out[out.length - 1]).toEqual({ role: "user", content: "hi" });
    });

    test("a written adult turn's other volatile content (clock, a tool result) still renders, with no memory match and no plan line", () => {
      const context: ContextItem[] = [item("clock", "it's 3:45 PM")];
      const out = contextToMessages(context, "hi", DEFAULT_PERSONA, plan, signal, "written");
      const volatileMessage = out.find((m) => m.role === "system" && m !== out[0]);
      expect(volatileMessage).toBeDefined();
      expect(volatileMessage!.content).toContain("it's 3:45 PM");
      expect(volatileMessage!.content).not.toContain(MEMORY_SECTION_HEADER);
      expect(volatileMessage!.content).not.toContain("How to answer this one:");
    });

    test("the spoken stable message and volatile message are byte-identical to today's - only the written class changed", () => {
      const context: ContextItem[] = [item("profile", "Sage's profile: likes hiking."), item("roster", "Sage", "roster-0")];
      const out = contextToMessages(context, "hi", DEFAULT_PERSONA, plan, signal, "spoken");
      expect(out[0]).toEqual({ role: "system", content: `${STABLE_PREFIX}\n\n[profile] Sage's profile: likes hiking.\n[household] Sage` });
      const volatileMessage = out.find((m) => m.content.includes("How to answer this one:"));
      expect(volatileMessage?.role).toBe("system");
      expect(volatileMessage?.content.startsWith(`${MEMORY_SECTION_HEADER}\n${NOTHING_STORED_LINE}\n${MEMORY_TRUST_REMINDER}\n\n${REANCHOR}`)).toBe(true);
    });
  });
});
