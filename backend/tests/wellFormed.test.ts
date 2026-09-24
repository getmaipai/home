// OUT-01: the well-formed reply rule and its repair, pure.
import { describe, expect, test } from "bun:test";
import { repairReply, assessReply, isWellFormed, repairTail, isShortMalformed, SHORT_MALFORMED_CHARS, feedThinkSplit, flushThinkSplit, newThinkSplitState, visibleText, type ThinkSpan } from "@/lib/wellFormed";
import { MALFORMED } from "@/lib/guards";

describe("OUT-01: the repair", () => {
  test("a fragment stays a fragment, a stopped sentence gets its stop, a short answer stands", () => {
    expect(repairReply("I")).toBe("I");
    expect(repairReply("")).toBe("");
    expect(repairReply("Sounds good")).toBe("Sounds good.");
    expect(repairReply("Yes")).toBe("Yes.");
    expect(repairReply("Done")).toBe("Done.");
    expect(repairReply("Paris")).toBe("Paris.");
    expect(repairReply("What do you think?")).toBe("What do you think?");
  });

  test("quotation marks: an unmatched edge mark is stripped, a whole quoted sentence is unquoted, interior quotes stand, apostrophes are never touched", () => {
    expect(repairReply('"Sure thing')).toBe("Sure thing.");
    expect(repairReply('Sure thing."')).toBe("Sure thing.");
    expect(repairReply('"A whole quoted sentence."')).toBe("A whole quoted sentence.");
    expect(repairReply("“A whole quoted sentence.”")).toBe("A whole quoted sentence.");
    expect(repairReply('She said "hi" and left.')).toBe('She said "hi" and left.');
    expect(repairReply("It's 'fine' by me, don't worry.")).toBe("It's 'fine' by me, don't worry.");
  });

  test("a dangling connector is closed, a control marker removed, a stray bracket dropped", () => {
    expect(repairReply("It depends on,")).toBe("It depends on.");
    expect(repairReply("Okay so<|im_end|>")).toBe("Okay so.");
    // A think block travels intact: the frontend strips the whole block.
    expect(repairReply("<think>a plan</think>Hello there.")).toBe("<think>a plan</think>Hello there.");
    expect(repairReply("(")).toBe("");
    expect(repairReply("Paris is the capital (")).toBe("Paris is the capital.");
    expect(repairReply(repairReply('"It depends on,'))).toBe(repairReply('"It depends on,')); // idempotent
  });

  test("the review's cases: an emoticon, an inch mark and a list marker are kept; an interior stray mark is removed; a curly opener closed straight is a pair; an emoji or a fence ends a line", () => {
    expect(repairReply("Sure :)")).toBe("Sure :)");
    expect(repairReply("Sounds good :-)")).toBe("Sounds good :-)");
    expect(repairReply('The board is 5"')).toBe('The board is 5".'); // a stop after an inch mark
    expect(repairReply("Two options: 1) go now 2) wait")).toBe("Two options: 1) go now 2) wait.");
    expect(repairReply('She said "let\'s go and off we went to the store.')).toBe("She said let's go and off we went to the store.");
    // A curly opener closed straight is a pair: kept, and not "unbalanced".
    expect(repairReply('“Hello" there, how are you doing today.')).toBe('“Hello" there, how are you doing today.');
    expect(assessReply('“Hello" there, how are you doing today.')).toBeNull();
    expect(repairReply("Have a great day! 😊")).toBe("Have a great day! 😊");
    expect(repairReply("Here it is:\n```\nls\n```")).toBe("Here it is:\n```\nls\n```");
    expect(assessReply("Have a great day! 😊")).toBeNull();
    expect(assessReply("Sure :)")).toBeNull();
    expect(assessReply("Here it is:\n```\nls\n```")).toBeNull();
  });

  test("the sixth review's cases: an emoji before a quote or a bracket, a quoted number, an emoji alone, a cut expression", () => {
    expect(repairReply("😀 (hello there")).toBe("😀 hello there.");
    expect(repairReply('😀 said "hi"')).toBe('😀 said "hi".');
    expect(assessReply('Great 🎉 "yes".')).toBeNull();
    expect(repairReply('Press "1" to confirm.')).toBe('Press "1" to confirm.');
    expect(assessReply('Press "1" to confirm.')).toBeNull();
    expect(assessReply("👍")).toBeNull();
    expect(assessReply("The answer is 2 + 2 =")).toBe("fragment");
    expect(assessReply("See https://")).toBe("fragment");
    expect(isShortMalformed("<think>" + "reasoning ".repeat(10) + "</think>")).toBe(true);
    // The seventh's: a strip that turns an inch mark into a quote is judged again; a skin tone, a flag and a keycap end a line; a think block alone as the tail gets no stop.
    expect(assessReply(repairReply('"It is 5" tall"'))).toBeNull();
    expect(repairReply('"Hi," he said. Then "oops')).toBe('"Hi," he said. Then oops.');
    for (const line of ["Good job 👍🏽", "Good job 🇺🇸", "Good job 1️⃣", "🇺🇸", "1️⃣"]) expect([line, assessReply(line)]).toEqual([line, null]);
    expect(repairTail("Hello there. ", "<think>reasoning here.</think>")).toBe("<think>reasoning here.</think>");
  });

  test("a think block is never judged and always travels: a stray quote in the reasoning does not touch a good reply, and a fragment after the block is a fragment", () => {
    const thought = '<think>The user said "hi. I should greet.</think>\n\nHello there, nice to see you.';
    expect(repairReply(thought)).toBe(thought);
    expect(assessReply(thought)).toBeNull();
    const fragment = "<think>" + "reasoning ".repeat(10) + "</think>\n\nI";
    expect(assessReply(repairReply(fragment))).toBe("fragment");
    expect(assessReply("<think>Okay, the user is asking about mornings and I should")).toBe("empty");
    expect(repairTail('<think>a "quote</think>He said ', 'fine."')).toBe("fine.");
  });
});

describe("OUT-01: the rule", () => {
  test("what fails and why", () => {
    expect(assessReply("")).toBe("empty");
    expect(assessReply("I")).toBe("fragment");
    expect(assessReply("I.")).toBe("fragment");
    expect(assessReply("Sounds good")).toBe("fragment");
    expect(assessReply('Sure "thing.')).toBe("unbalanced");
    expect(assessReply("Paris is the capital (of France.")).toBe("unbalanced");
    expect(assessReply("Okay <|im_end|>.")).toBe("control");
  });

  test("what stands", () => {
    for (const reply of ["Yes.", "Done.", "Paris.", "Okay!", "Sounds good.", "What do you think?", 'She said "hi" and left.', "It depends on the day (and the weather).", "Sure thing…", "Two options: 1) go now 2) wait.", "Nice :) see you tomorrow.", 'It is about 5" wide.', "<think>a plan</think>Hello there."]) {
      expect([reply, assessReply(reply)]).toEqual([reply, null]);
    }
  });

  test("every guard replacement line and every malformed line passes the rule it enforces", async () => {
    const guards = await import("@/lib/guards");
    for (const line of MALFORMED) expect(isWellFormed(line)).toBe(true);
    for (const reason of ["invention", "unrelated_recall", "near_echo", "medication_dose", "capability_claim", "like_i_said", "example_parrot", "claimed_experience", "malformed"] as const) {
      for (let i = 0; i < 6; i++) expect([reason, isWellFormed(guards.replacementFor(reason, `person-${i}`))]).toEqual([reason, true]);
    }
  });

  test("a short malformed output earns a regeneration; a long one is repaired in place", () => {
    expect(isShortMalformed("I")).toBe(true);
    expect(isShortMalformed("x".repeat(SHORT_MALFORMED_CHARS + 1))).toBe(false);
  });
});

describe("OUT-01: the streaming tail", () => {
  test("the final span is repaired against what was delivered", () => {
    expect(repairTail("The forecast says rain. ", "Bring a coat,")).toBe("Bring a coat.");
    expect(repairTail("The forecast says rain. ", "bring a coat")).toBe("bring a coat.");
    expect(repairTail('He said "', 'fine."')).toBe('fine."');
    expect(repairTail("He said ", 'fine."')).toBe("fine.");
    expect(repairTail("Done. ", " ")).toBe(" ");
  });
});

// REASONING-01: the wire-boundary split (routes/turn.ts's own caller) -
// pure unit coverage of the state machine itself, independent of the
// stream/HTTP plumbing that uses it.
describe("REASONING-01: feedThinkSplit/flushThinkSplit", () => {
  function drain(chunks: string[]): ThinkSpan[] {
    const state = newThinkSplitState();
    const spans: ThinkSpan[] = [];
    for (const chunk of chunks) spans.push(...feedThinkSplit(state, chunk));
    spans.push(...flushThinkSplit(state));
    return spans;
  }

  test("a closed think block bundled with visible text in one chunk splits into two spans", () => {
    expect(drain(["<think>carry the two</think>17 times 24 is 408."])).toEqual([
      { reasoning: true, text: "carry the two" },
      { reasoning: false, text: "17 times 24 is 408." },
    ]);
  });

  test("a think block streamed live, one raw delta at a time", () => {
    expect(drain(["<think>", "carry ", "the ", "two", "</think>", "17 times 24", " is 408."])).toEqual([
      { reasoning: true, text: "carry " },
      { reasoning: true, text: "the " },
      { reasoning: true, text: "two" },
      { reasoning: false, text: "17 times 24" },
      { reasoning: false, text: " is 408." },
    ]);
  });

  test("no think block at all: plain visible text passes through unchanged", () => {
    expect(drain(["17 times 24 is 408."])).toEqual([{ reasoning: false, text: "17 times 24 is 408." }]);
  });

  test("a truncated, never-closed think block: everything is reasoning, flushed at stream end", () => {
    expect(drain(["<think>carry the two"])).toEqual([{ reasoning: true, text: "carry the two" }]);
  });

  test("an open tag split across two raw deltas is completed, not leaked as literal text", () => {
    expect(drain(["some text <thi", "nk>reasoning here</think>more text"])).toEqual([
      { reasoning: false, text: "some text " },
      { reasoning: true, text: "reasoning here" },
      { reasoning: false, text: "more text" },
    ]);
  });

  test("a close tag split across two raw deltas is completed, not leaked as literal text", () => {
    expect(drain(["<think>reasoning here</thi", "nk>more text"])).toEqual([
      { reasoning: true, text: "reasoning here" },
      { reasoning: false, text: "more text" },
    ]);
  });

  test("visible text just short of a partial tag prefix is held, not lost, when the stream simply ends", () => {
    // "Hello <" alone could be the start of "<think>" - feedThinkSplit()
    // correctly holds back just the "<" (the genuine overlap) rather
    // than risk it turning into a real tag on a later chunk, so this
    // arrives as two adjacent visible spans, not one; flushThinkSplit()
    // returns the held-back "<" as ordinary visible text once the stream
    // actually ends with no tag ever following. Concatenated, the text
    // is unaffected either way - this is REASONING-01's own "byte-
    // identical" claim about the visible TEXT, never about wire-event
    // granularity (docs/dev.md's own section makes the same distinction
    // for the bundled-chunk case).
    expect(drain(["Hello <"])).toEqual([
      { reasoning: false, text: "Hello " },
      { reasoning: false, text: "<" },
    ]);
  });

  // A review caught this splitter not matching THINK_BLOCK_RE's own
  // `\s*` (visibleText()/the stored final text already strip whitespace
  // right after a close tag) - without this, a live-streamed reply could
  // show a stray leading blank line the stored/final text never has.
  test("whitespace right after a close tag is discarded, matching THINK_BLOCK_RE's own \\s* (the stored/final text)", () => {
    expect(drain(["<think>carry the two</think>\n\nAnswer"])).toEqual([
      { reasoning: true, text: "carry the two" },
      { reasoning: false, text: "Answer" },
    ]);
    expect(visibleText("<think>carry the two</think>\n\nAnswer")).toBe("Answer");
  });

  test("whitespace right after a close tag is discarded even when split across chunks", () => {
    expect(drain(["<think>carry the two</think>", " ", "\n", "Answer"])).toEqual([
      { reasoning: true, text: "carry the two" },
      { reasoning: false, text: "Answer" },
    ]);
  });

  test("a close tag followed by ONLY whitespace (no visible text at all) discards it at stream end, no empty span", () => {
    expect(drain(["<think>carry the two</think>", "   "])).toEqual([{ reasoning: true, text: "carry the two" }]);
  });

  test("a close tag immediately followed by visible text (no whitespace at all) is unaffected", () => {
    expect(drain(["<think>carry the two</think>Answer"])).toEqual([
      { reasoning: true, text: "carry the two" },
      { reasoning: false, text: "Answer" },
    ]);
  });
});
