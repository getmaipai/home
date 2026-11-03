// RESEARCH-CALL-DEADLINE-01: every helper call has a deadline, so a slow light-model call cannot hold a research run past its cut.
import { describe, expect, test } from "bun:test";
import { makeGate, newNoteStats, writePageNotes, type NoteWriter } from "@/lib/turnMachine/pageNotes";
import { planDataWithin, type Brief } from "@/lib/turnMachine/researchPipeline";

const page = { url: "https://a.example/p", title: "A", text: "The show was cancelled after its third season because ratings fell sharply that year." };
const brief = { subject: "the show", mustContain: ["why it ended", "what came next"], ambiguous: false, options: [], question: "", answerType: "", titles: [] } as unknown as Brief;

describe("note call deadline", () => {
  test("a note writer that never resolves is cut: [] within 200 ms, one failed call, the request aborted", async () => {
    let seen: AbortSignal | undefined;
    const writer: NoteWriter = (_prompt, signal) => { seen = signal; return new Promise<string | null>(() => {}); };
    const stats = newNoteStats();
    const started = Date.now();
    const notes = await writePageNotes(writer, makeGate(2), "why did it end", page, stats, Date.now, "why did it end", { callTimeoutMs: 50 });
    expect(notes).toEqual([]);
    expect(Date.now() - started).toBeLessThan(200);
    expect(stats.failedCalls).toBe(1);
    expect(seen?.aborted).toBe(true);
  });

  test("no note call starts when less than the call timeout remains before the cut", async () => {
    let calls = 0;
    const writer: NoteWriter = async () => { calls += 1; return null; };
    const stats = newNoteStats();
    const notes = await writePageNotes(writer, makeGate(2), "why did it end", page, stats, Date.now, "why did it end", { cutAt: Date.now() + 11_000 });
    expect(notes).toEqual([]);
    expect(calls).toBe(0);
    expect(stats.calls).toBe(0);
    await writePageNotes(writer, makeGate(2), "why did it end", page, stats, Date.now, "why did it end", { cutAt: Date.now() + 13_000 });
    expect(calls).toBe(1);
  });
});

describe("plan writer deadline", () => {
  test("a plan writer that never resolves falls back to parts and searches derived from the brief and the question, with no model call", async () => {
    let seen: AbortSignal | undefined;
    const started = Date.now();
    const { plan, cut } = await planDataWithin((signal) => { seen = signal; return () => new Promise<string | null>(() => {}); }, new AbortController().signal, brief, "why did the show end", 4, "", "", 50);
    expect(cut).toBe(true);
    expect(plan.subQuestions.slice(0, 2)).toEqual(["why it ended", "what came next"]);
    expect(plan.subQuestions.length).toBeGreaterThan(2);
    expect(plan.queries.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(200);
    expect(seen?.aborted).toBe(true);
  });

  test("a plan writer that answers in time is used as before", async () => {
    const { plan, cut } = await planDataWithin(() => async () => '{"sub_questions":["why it ended"],"queries":["the show ended why"]}', new AbortController().signal, brief, "why did the show end", 3);
    expect(cut).toBe(false);
    expect(plan.queries).toEqual(["the show ended why"]);
  });
});
