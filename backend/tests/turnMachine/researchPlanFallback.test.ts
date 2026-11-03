// A plan that hits its deadline used to fall back to the brief's must-contain items alone (one sub-question in the live run), so the run
// searched for one thing and missed the rest. The fallback now derives its parts and searches from the question and the pinned title,
// with no model call, and adds the generic angles when the question is open-ended.
import { describe, expect, test } from "bun:test";
import { planDataWithin, type Brief } from "@/lib/turnMachine/researchPipeline";
import type { QueryWriter } from "@/lib/turnMachine/research";

const never: QueryWriter = () => new Promise<string | null>(() => {});
const brief: Brief = { subject: "Maple Street Radio", answerType: "a best guess with reasons", mustContain: ["what would have happened if they finished the story"], ambiguous: false, options: [], question: "", assumption: "" };
const utterance = "the radio drama Maple Street Radio (the 1984 one, not the remake) only ran one year. tell me your best educated guess what would have happened if they finished the story";

describe("planDataWithin: the fallback when the plan is cut", () => {
  test("an open question about a pinned work gets the question's parts and the generic angles, with searches", async () => {
    const { plan, cut } = await planDataWithin(() => never, new AbortController().signal, brief, utterance, 6, "", "Maple Street Radio (1984 radio drama) is a drama.", 20, "Maple Street Radio 1984 radio drama");
    expect(cut).toBe(true);
    const all = plan.subQuestions.join(" | ").toLowerCase();
    expect(plan.subQuestions.length).toBeGreaterThanOrEqual(5);
    expect(all).toContain("ended");
    expect(all).toContain("came after");
    expect(all).toContain("planned");
    expect(all).toContain("changed");
    expect(plan.angleParts?.length).toBe(4);
    expect(plan.queries.length).toBeGreaterThanOrEqual(4);
    for (const q of plan.queries) expect(q.toLowerCase()).toContain("maple street radio");
    expect(plan.queries.length).toBeLessThanOrEqual(6);
  });

  test("without a pin, an open question still gets the angles from the brief's subject", async () => {
    const { plan } = await planDataWithin(() => never, new AbortController().signal, brief, utterance, 6, "", "", 20);
    expect(plan.subQuestions.join(" | ").toLowerCase()).toContain("came after");
    expect(plan.subQuestions.join(" | ")).toContain("Maple Street Radio");
  });

  test("a closed how-to question gets no story angles", async () => {
    const b: Brief = { ...brief, subject: "sourdough starter", mustContain: ["the steps", "the timing"] };
    const { plan } = await planDataWithin(() => never, new AbortController().signal, b, "how do I feed a sourdough starter", 6, "", "", 20);
    expect(plan.subQuestions.slice(0, 2)).toEqual(["the steps", "the timing"]);
    expect(plan.subQuestions.join(" ")).not.toMatch(/ended|came after/);
    expect(plan.angleParts ?? []).toEqual([]);
  });

  test("no part carries a name the question and the pin never gave", async () => {
    const { plan } = await planDataWithin(() => never, new AbortController().signal, brief, utterance, 6, "", "", 20, "Maple Street Radio 1984 radio drama");
    for (const p of plan.subQuestions) expect(p).not.toMatch(/Julie|Parrish/);
  });
});
