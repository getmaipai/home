import { describe, expect, test } from "bun:test";
import { hasBracketWrapper, isStaticFailureLine, judgeTurn, parseVmStat, type TurnObservation, type TurnSpec } from "../scripts/smoke/chatChecks";

const spec = (over: Partial<TurnSpec> = {}): TurnSpec => ({ id: "t", person: "adult", text: "hi", ...over });
const seen = (over: Partial<TurnObservation> = {}): TurnObservation => ({ httpStatus: 200, reply: "A heat pump moves heat from outside to inside.", firstDeltaMs: 900, totalMs: 4000, tool: null, sources: 0, failure: null, ...over });

describe("chat smoke checks", () => {
  test("the known static failure sentences are caught, an ordinary reply is not", () => {
    expect(isStaticFailureLine("Sorry, I couldn't do that.")).toBe(true);
    expect(isStaticFailureLine("  I can't think right now.  ")).toBe(true);
    expect(isStaticFailureLine("I can't think right now. I've told the grown-ups.")).toBe(true);
    expect(isStaticFailureLine("The sky looks blue because of scattering.")).toBe(false);
  });

  test("a reply that opens with a package's 'answered:' wrapper is caught", () => {
    expect(hasBracketWrapper('[Web Search answered: "The film opens in May."]')).toBe(true);
    expect(hasBracketWrapper('  [Weather answered: "62F"]')).toBe(true);
    expect(hasBracketWrapper("The film opens in May [1].")).toBe(false);
    expect(hasBracketWrapper("[1] says the film answered: nothing.")).toBe(false);
  });

  test("an empty reply, a failure kind and a static sentence each FAIL", () => {
    expect(judgeTurn(spec(), seen({ reply: "  " })).verdict).toBe("FAIL");
    expect(judgeTurn(spec(), seen({ failure: "unavailable" })).verdict).toBe("FAIL");
    expect(judgeTurn(spec(), seen({ reply: "Sorry, I couldn't do that." })).verdict).toBe("FAIL");
    expect(judgeTurn(spec(), seen()).verdict).toBe("PASS");
  });

  test("a search turn with no sources FAILs, with sources PASSes", () => {
    expect(judgeTurn(spec(), seen({ tool: "websearch", sources: 0 })).verdict).toBe("FAIL");
    expect(judgeTurn(spec({ expectSearch: true }), seen({ tool: "websearch", sources: 3 })).verdict).toBe("PASS");
  });

  test("a follow-up that did not search is a WARN, never a FAIL (the model decides)", () => {
    const verdict = judgeTurn(spec({ expectSearch: true, followUp: true }), seen());
    expect(verdict.verdict).toBe("WARN");
    expect(verdict.fails).toEqual([]);
  });

  test("a child reply over the word cap FAILs", () => {
    expect(judgeTurn(spec({ person: "child", maxWords: 10 }), seen({ reply: "one two three four five six seven eight nine ten eleven" })).verdict).toBe("FAIL");
    expect(judgeTurn(spec({ person: "child", maxWords: 10 }), seen({ reply: "Sunlight scatters in the air." })).verdict).toBe("PASS");
  });

  test("a long-answer turn that comes back tiny is a WARN", () => {
    expect(judgeTurn(spec({ minWords: 50 }), seen({ reply: "It moves heat." })).verdict).toBe("WARN");
  });

  test("vm_stat output is read into gigabytes", () => {
    const out = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                              65536.\nPages active:                           100.\nPages inactive:                         65536.\nPages speculative:                       0.\nPages wired down:                       131072.\nPages occupied by compressor:            65536.\n";
    expect(parseVmStat(out)).toEqual({ freeGb: 1, inactiveGb: 1, wiredGb: 2, compressedGb: 1 });
    expect(parseVmStat("nothing")).toBeNull();
  });
});
