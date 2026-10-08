import { describe, expect, test } from "bun:test";
import { getAssembler, registerAssembler } from "@/lib/projects/assemblers";

describe("project assemblers", () => {
  test("markdown-concat joins the step texts with a blank line, in order", () => {
    const concat = getAssembler("markdown-concat");
    expect(concat).toBeDefined();
    expect(concat!([{ stepId: "a", text: "One" }, { stepId: "b", text: "Two" }, { stepId: "c", text: "Three" }])).toBe("One\n\nTwo\n\nThree");
  });
  test("markdown-concat handles a single input and no inputs", () => {
    const concat = getAssembler("markdown-concat")!;
    expect(concat([{ stepId: "a", text: "Only" }])).toBe("Only");
    expect(concat([])).toBe("");
  });
  test("an unknown assembler is undefined", () => {
    expect(getAssembler("does-not-exist")).toBeUndefined();
  });
  test("a registered assembler can be fetched and later replaced", () => {
    registerAssembler("test-count", (inputs) => String(inputs.length));
    expect(getAssembler("test-count")!([{ stepId: "a", text: "x" }])).toBe("1");
    registerAssembler("test-count", () => "replaced");
    expect(getAssembler("test-count")!([])).toBe("replaced");
  });
});
