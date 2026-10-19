import { describe, expect, test } from "bun:test";
import { SAFETY_REFUSAL_COPY, SAFETY_REFUSAL_CSAM_ADULT, safetyRefusalLine } from "@/lib/failureCopy";
import { phrasingInstruction } from "@/lib/composer";

describe("the stopped-reply line (a film plot that trips the child-safety floor)", () => {
  test("an adult stopped by the csam floor is told what tripped it and how to ask; no internal words", () => {
    const line = safetyRefusalLine("adult", ["csam"]);
    expect(line).toBe(SAFETY_REFUSAL_CSAM_ADULT);
    expect(line).toContain("Ask for the story without those details");
    expect(line).not.toMatch(/classifier|csam|signal/i);
    expect(line).not.toContain("—");
  });
  test("every other case keeps the general line, and a teen or child never gets the explanation", () => {
    expect(safetyRefusalLine("adult", ["violence"])).toBe(SAFETY_REFUSAL_COPY.adult);
    expect(safetyRefusalLine("adult")).toBe(SAFETY_REFUSAL_COPY.adult);
    expect(safetyRefusalLine("teen", ["csam"])).toBe(SAFETY_REFUSAL_COPY.teen);
    expect(safetyRefusalLine("child", ["csam"])).toBe(SAFETY_REFUSAL_COPY.child);
  });
  test("the answering round is told to retell such a story in general terms", () => {
    expect(phrasingInstruction("written", "what is the movie taxi driver about", 3)).toContain("leave out the person's age and any sexual wording");
  });
});
