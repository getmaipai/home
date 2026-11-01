// RESEARCH-CLAIM-01: the claim check. A cited sentence its sources do not back is marked, not silently kept.
import { describe, expect, test } from "bun:test";
import { checkClaims, claimPrompt, evidenceBySource } from "@/lib/turnMachine/research";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

const EVIDENCE = ["The show ended after one season because of falling ratings.", "A second season was planned but never made.", ""];
const TEXT = "It ended after one season because of ratings [1]. A second season was planned [2]. The lead actor quit in protest [3]. My guess is it would have gone to war.";

const judgeBy = (unsupportedWhen: string) => async (prompt: string) => (prompt.includes(unsupportedWhen) ? '{"supported": false}' : '{"supported": true}');

describe("the claim check", () => {
  test("a supported sentence is kept as written, an unsupported one is marked and loses its numbers, an uncited guess is untouched", async () => {
    const result = await checkClaims(TEXT, [...EVIDENCE.slice(0, 2), "The lead actor stayed to the end."], judgeBy("lead actor quit"));
    expect(result.text).toContain("It ended after one season because of ratings [1].");
    expect(result.text).toContain("A second season was planned [2].");
    expect(result.text).toContain("The lead actor quit in protest (not confirmed by the sources).");
    expect(result.text).not.toContain("[3]");
    expect(result.text).toContain("My guess is it would have gone to war.");
    expect(result).toMatchObject({ checked: 3, unsupported: 1 });
  });

  test("the judge sees only the passages of the sources the sentence cites", async () => {
    const prompts: string[] = [];
    await checkClaims("Cited twice [1][2].", EVIDENCE, async (prompt) => { prompts.push(prompt); return '{"supported": true}'; });
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain("falling ratings");
    expect(prompts[0]).toContain("never made");
  });

  test("a sentence whose sources gave no text is skipped, not judged", async () => {
    let calls = 0;
    const result = await checkClaims("Nothing to read [3].", EVIDENCE, async () => { calls += 1; return '{"supported": false}'; });
    expect(calls).toBe(0);
    expect(result.text).toBe("Nothing to read [3].");
    expect(result.skipped).toBe(1);
  });

  test("a missing, throwing or unreadable judge leaves the sentence as written", async () => {
    for (const judge of [async () => null, async () => { throw new Error("down"); }, async () => "no idea"]) {
      const result = await checkClaims("It ended [1].", EVIDENCE, judge);
      expect(result.text).toBe("It ended [1].");
      expect(result.unsupported).toBe(0);
    }
  });

  test("the check stops at its time cap", async () => {
    let t = 0;
    let calls = 0;
    const result = await checkClaims("A [1]. B [1]. C [1]. D [1].", EVIDENCE, async () => { calls += 1; t += 10_000; return '{"supported": true}'; }, { concurrency: 1, deadlineMs: 15_000, now: () => t });
    expect(calls).toBe(2);
    expect(result.skipped).toBe(2);
  });

  test("the prompt carries the sentence and the passages", () => {
    const prompt = claimPrompt("It ended.", "a passage");
    expect(prompt).toContain("It ended.");
    expect(prompt).toContain("a passage");
  });

  test("evidence is kept per source number: the fetched page when one was read, else the row", () => {
    const outcome = {
      callId: "c", packageId: "websearch", status: "succeeded",
      sources: [{ url: "https://a.example/1", title: "A" }, { url: "https://b.example/2", title: "B" }],
      result: { data: { rows: [{ url: "https://a.example/1", title: "A", snippet: "snippet a" }, { url: "https://b.example/2", title: "B", snippet: "snippet b" }], pages: [{ url: "https://a.example/1", title: "A", text: "full page a" }] } },
    } as unknown as ToolExecutionOutcome;
    const evidence = evidenceBySource([outcome]);
    expect(evidence[0]).toContain("full page a");
    expect(evidence[1]).toContain("snippet b");
  });
});

describe("the query writer", () => {
  test("its prompt names no subject of its own, carries the question, the searches already run and the results, and bans memory names", async () => {
    const { queryWriterPrompt } = await import("@/lib/turnMachine/research");
    const prompt = queryWriterPrompt("why did the show end", { queries: ["show ended why"], sites: ["a.example"] }, "- a.example: A title. A snippet.", 4);
    expect(prompt).toContain("why did the show end");
    expect(prompt).toContain("- show ended why");
    expect(prompt).toContain("a.example: A title");
    expect(prompt).toContain("Never add a name from your own memory");
    expect(prompt).not.toMatch(/miniseries|franchise|network|comic/i);
  });

  test("proposals that repeat an earlier search or each other are dropped, the rest kept in order", async () => {
    const { writeQueries } = await import("@/lib/turnMachine/research");
    const writer = async () => JSON.stringify({ queries: ["show ended why cancelled", "the show ended, why cancelled", "interview with the producers about the planned ending", "interview with the producers about the planned ending!"] });
    const kept = await writeQueries(writer, "q", { queries: ["show ended why cancelled"], sites: [] }, "", 4);
    expect(kept).toEqual(["interview with the producers about the planned ending"]);
  });

  test("a down, throwing or unreadable writer proposes nothing", async () => {
    const { writeQueries } = await import("@/lib/turnMachine/research");
    for (const writer of [async () => null, async () => { throw new Error("down"); }, async () => "not json"]) expect(await writeQueries(writer, "q", { queries: [], sites: [] }, "", 4)).toEqual([]);
  });
});

describe("details from memory", () => {
  test("a name or year the question and the results have not shown is flagged; one they showed is not", async () => {
    const { memoryDetailsIn } = await import("@/lib/turnMachine/research");
    expect(memoryDetailsIn("show Pat Quill interview 1991", "tell me about the show")).toEqual(["Pat Quill", "1991"]);
    expect(memoryDetailsIn("show Pat Quill interview 1991", "tell me about the show\nPat Quill ran it from 1991")).toEqual([]);
    expect(memoryDetailsIn("show ending why cancelled 1980s", "the 1980s show")).toEqual([]);
  });
  test("the writer's discovery-first prompt carries no names and its proposals with unshown names are dropped", async () => {
    const { queryWriterPrompt, writeQueries } = await import("@/lib/turnMachine/research");
    expect(queryWriterPrompt("q", { queries: [], sites: [] }, "", 4)).toContain("write only searches that identify the subject");
    expect(queryWriterPrompt("q", { queries: [], sites: [] }, "- a.example: A title", 4)).not.toContain("write only searches that identify the subject");
    const writer = async () => JSON.stringify({ queries: ["show creator Pat Quill interview", "who made the show and how it ended"] });
    expect(await writeQueries(writer, "tell me about the show", { queries: [], sites: [] }, "", 4)).toEqual(["who made the show and how it ended"]);
  });
});
