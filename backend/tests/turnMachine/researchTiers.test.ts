// RESEARCH-TIER-01: research depth follows the answer style. Instant keeps the record's one tool round, Thinking takes up to
// four, Max up to twelve; later rounds see what the earlier ones searched and read, source numbers run across the searches,
// and a teen or child never gets more than one round. The real machine, a scripted model over HTTP, and a fake SearXNG over
// HTTP that answers each query with pages from different sites.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { useDefaultScriptedStack } from "../stackFixture";
import { addBenchTeen, createBenchPeople, startRecordingProxy, type BenchPeople } from "../../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { __setChatWindowContextForTests } from "@/lib/roleHealth";
import { __setPageReaderForTests, __resetSearchCacheForTests } from "@/lib/packageHost";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { createChatLease, registerActiveChatLease } from "@/lib/chatLease";
import { __setResearchCapForTests, researchCutAt, researchNoNewRound, budgetForStyle, dropUnknownCitations, dropUnsupportedCredits, isRepeatQuery, roundAddedNothing } from "@/lib/turnMachine/research";
import { resolveTurnBudget } from "@/lib/turnMachine/budget";
import { RESEARCH_HOST_PAGES_MAX, RESEARCH_PAGES_MAX, newResearchBudget, noteDeclined, notePageRead, researchPageAllowed } from "@/lib/researchBudget";
import { researchStepsFor } from "@/lib/conversationHistory";
import { __setClaimJudgeForTests } from "@/lib/turnMachine/nodes/answer";
import { __setQueryWriterForTests } from "@/lib/turnMachine/nodes/model";
import { __setNoteWriterForTests } from "@/lib/turnMachine/pageNotes";
import { __setStageWritersForTests } from "@/lib/turnMachine/researchPipeline";

let people: BenchPeople;
let searx: ReturnType<typeof Bun.serve>;
let searxQueries: string[] = [];
let sameResults = false;
let searxDelayMs = 0;

const UTTERANCE = "the 1980s TV series V only had one season, tell me why the series was cancelled and what happened after";
const QUERIES = [
  "V 1980s series season",
  "V series cancelled why",
  "V series creator interview plans",
  "V series novel sequel",
  "V series reboot",
  "V series final episode threads",
  "V series cast interview ending",
  "V series ratings network",
  "V series comic continuation",
  "V series season two plans",
  "V series writers room notes",
  "V series convention panel",
  "V series extra thirteenth",
];

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __setChatWindowContextForTests(32768);
  people = createBenchPeople();
  addBenchTeen(people);
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  __setToolOfferOverridesForTests(["websearch"]);
  searxQueries = [];
  sameResults = false;
  searxDelayMs = 0;
  __setClaimJudgeForTests(async () => '{"supported": true}');
  __setQueryWriterForTests(async () => null);
  __setNoteWriterForTests(async () => null);
  __setStageWritersForTests({ brief: async () => null, analysis: async () => null });
  searx = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/config") return Response.json({ engines: [] });
      const q = url.searchParams.get("q") ?? "";
      searxQueries.push(q);
      if (searxDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, searxDelayMs));
      const n = sameResults ? 1 : searxQueries.length;
      return Response.json({ results: [1, 2, 3].map((i) => ({ title: `Page ${n}.${i} about ${q}`, url: `https://site${n}x${i}.example/page`, content: `Snippet ${n}.${i} for ${q}` })) });
    },
  });
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searx.port}`);
  setHouseholdSettingValue("search.web_sources", ["searxng"]);
  __setPageReaderForTests(async (url) => ({ type: "document", file_id: "f", url, title: "A page", text: `Text of ${url} about the series.`, chunks: [], links: [], sections: [] }));
});

afterEach(() => {
  __setClaimJudgeForTests(undefined);
  __setQueryWriterForTests(undefined);
  __setNoteWriterForTests(undefined);
  __setStageWritersForTests(undefined);
  searx.stop(true);
  registerActiveChatLease(null);
  __setPageReaderForTests(null);
  __setChatWindowContextForTests(undefined);
  __setToolOfferOverridesForTests(null);
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** Runs one turn against a model that wants to search `wantedRounds` times (a different query each round), then answers. */
async function turn(who: "owner" | "teen" | "child", wantedRounds: number, opts: { thinking?: boolean; max?: boolean; scope?: "reference" | "web"; queries?: string[]; perRound?: number; utterance?: string } = {}) {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const requests: ChatCompletionRequest[] = [];
  let made = 0; // searches the scripted model has asked for so far (a skipped or empty search leaves no tool message to count)
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request: ChatCompletionRequest) => {
      requests.push(request);
      return "It ended after one season [1] and the creator said more was planned [3].";
    },
    scriptedToolCalls: (request: ChatCompletionRequest) => {
      if (!request.tools || request.tools.length === 0 || request.tool_choice === "none") return undefined;
      requests.push(request);
      __resetRateLimiterForTests(); // Home's own search pace (a burst of three) would make this scripted run wait seconds per round
      const done = made;
      if (done >= wantedRounds) return undefined;
      const count = Math.min(opts.perRound ?? 1, wantedRounds - done);
      const calls = Array.from({ length: count }, (_, i) => ({ id: `call-${done + i + 1}`, type: "function" as const, function: { name: "websearch", arguments: JSON.stringify({ expression: (opts.queries ?? QUERIES)[done + i], scope: opts.scope ?? "web" }) } }));
      made += count;
      return calls;
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    const result = await runTurnNext(people[who]!, "chat", opts.utterance ?? UTTERANCE, opts);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    return { result, requests };
  } finally {
    proxy.stop();
    await stub.stop();
  }
}

async function holdMax(): Promise<void> {
  const lease = createChatLease({ now: Date.now, swapToBig: async () => {}, swapToStandard: async () => {}, ready: async () => true });
  registerActiveChatLease(lease);
  const got = await lease.acquire(people.owner!);
  expect(got.ok).toBe(true);
}

const toolMessages = (request: ChatCompletionRequest) => request.messages.filter((m) => m.role === "tool");
const lastRequest = (requests: ChatCompletionRequest[]) => requests.at(-1)!;

describe("research rounds follow the answer style", () => {
  test("Instant keeps one search round however much the model wants", async () => {
    const { result } = await turn("owner", 6);
    expect(searxQueries.length).toBe(1);
    expect(result.value.reply.text.length).toBeGreaterThan(0);
  });

  test("Thinking takes up to four rounds, and each later round is told what was searched and which sites were read", async () => {
    const { requests } = await turn("owner", 9, { thinking: true });
    expect(searxQueries.length).toBe(4);
    const second = requests.find((r) => toolMessages(r).length === 1 && r.tool_choice !== "none")!;
    const nudge = second.messages.at(-1)!.content!.toString();
    expect(nudge).toContain("Searched so far");
    expect(nudge).toContain("V 1980s series season");
    expect(nudge).toContain("Sites read so far");
    expect(nudge).toContain("3 more searches");
  });

  test("Max with its lease takes more than two rounds, numbers sources across them and cites more than one site", async () => {
    await holdMax();
    const { result, requests } = await turn("owner", 5, { thinking: true, max: true });
    expect(searxQueries.length).toBe(5);
    const answering = lastRequest(requests);
    const numbers = toolMessages(answering).flatMap((m) => [...(m.content as string).matchAll(/"n":(\d+)/g)].map((x) => Number(x[1])));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(Math.max(...numbers)).toBeGreaterThan(3);
    const sites = new Set((result.value.sources ?? []).map((s) => s.site));
    expect(sites.size).toBeGreaterThan(1);
    expect(result.value.reply.text).toContain("[3]");
  });

  test("Max's first round is told to pick the production the person means and to use the names the sources give, with no names of its own", async () => {
    await holdMax();
    const { requests } = await turn("owner", 1, { max: true });
    const first = requests.find((r) => toolMessages(r).length === 0 && r.tool_choice !== "none")!;
    const note = first.messages.filter((m) => m.role === "user").at(-1)!.content!.toString();
    expect(note).toContain("Say exactly which subject, version, edition, person, product or event I mean");
    expect(note).toContain("use only the names and titles those sources gave");
    expect(note).toContain("one angle per search");
    expect(note).toContain("4 to 8 angles that matter for this particular question");
    expect(note).not.toMatch(/[A-Z][a-z]+ [A-Z][a-z]+ (?:created|wrote)/);
  });

  test("a Max sentence its cited sources do not back is marked not confirmed and loses its citation numbers", async () => {
    await holdMax();
    __setClaimJudgeForTests(async (prompt) => (prompt.includes("creator said more was planned") ? '{"supported": false}' : '{"supported": true}'));
    const { result } = await turn("owner", 3, { max: true });
    expect(result.value.reply.text).toContain("(not confirmed by the sources)");
    expect(result.value.reply.text).not.toContain("[3]");
  });

  test("an Instant answer is never claim-checked", async () => {
    let calls = 0;
    __setClaimJudgeForTests(async () => { calls += 1; return '{"supported": false}'; });
    const { result } = await turn("owner", 1);
    expect(calls).toBe(0);
    expect(result.value.reply.text).not.toContain("not confirmed");
  });

  test("the query writer's searches reach the first round and each later round, and a writer that is down changes nothing", async () => {
    await holdMax();
    const prompts: string[] = [];
    __setQueryWriterForTests(async (prompt) => { prompts.push(prompt); return JSON.stringify({ queries: [prompts.length === 1 ? "first planned search about the series ending" : "second planned search using found names", "V series reboot"] }); });
    const { requests } = await turn("owner", 2, { max: true });
    const first = requests.find((r) => toolMessages(r).length === 0 && r.tool_choice !== "none")!;
    expect(first.messages.filter((m) => m.role === "user").at(-1)!.content!.toString()).toContain("first planned search about the series ending");
    const second = requests.find((r) => toolMessages(r).length === 1 && r.tool_choice !== "none")!;
    expect(second.messages.at(-1)!.content!.toString()).toContain("second planned search using found names");
    expect(prompts[1]).toContain("V series reboot".split(" ")[0]!); // the later prompt lists the searches already run
    expect(prompts[1]).toContain("Searches already run");
  });

  test("a research search built on a name or year from memory runs without it, and the next round is told", async () => {
    await holdMax();
    const { requests } = await turn("owner", 2, { max: true, queries: ["V series Ted White season two plans 1983", "V series ending interview"] });
    expect(searxQueries[0]).toBe("V series season two plans");
    expect(searxQueries[1]).toBe("V series ending interview");
    const later = requests.filter((r) => r.tool_choice !== "none" && toolMessages(r).length === 1).at(-1)!;
    expect(JSON.stringify(later.messages)).toContain("ran without a name or year");
  });

  test("a Max research turn searches the web from its first search", async () => {
    await holdMax();
    await turn("owner", 1, { max: true, scope: "reference" });
    expect(searxQueries.length).toBe(1);
  });

  test("Max stops at twelve rounds", async () => {
    await holdMax();
    await turn("owner", 13, { max: true });
    expect(searxQueries.length).toBe(12);
  });

  test("Max asked for without holding the lease runs as Thinking at most", async () => {
    const { requests } = await turn("owner", 9, { thinking: true, max: true });
    expect(searxQueries.length).toBe(4);
    expect(requests.length).toBeGreaterThan(0);
  });

  test("a teen or a child never gets more than one round, whatever the page sends", async () => {
    await turn("teen", 6, { thinking: true, max: true });
    expect(searxQueries.length).toBeLessThanOrEqual(1);
    searxQueries = [];
    await turn("child", 6, { thinking: true, max: true });
    expect(searxQueries.length).toBeLessThanOrEqual(1);
  });

  test("the admin's web switch off keeps Max's web search to its first round", async () => {
    setHouseholdSettingValue("research.max_web", false);
    await holdMax();
    await turn("owner", 4, { max: true });
    expect(searxQueries.length).toBe(1);
  });
});

describe("the stop rule, the citation check, the page budget and the stored steps", () => {
  test("a round that finds nothing new ends the searching and the turn answers", async () => {
    sameResults = true;
    const { result } = await turn("owner", 9, { thinking: true });
    expect(searxQueries.length).toBe(2);
    expect(result.value.reply.text.length).toBeGreaterThan(0);
  });

  test("citation numbers that name no source of the reply are dropped, real ones stay", () => {
    expect(dropUnknownCitations("One [1] two [3] three [9].", 3)).toEqual({ text: "One [1] two [3] three.", dropped: 1 });
    expect(dropUnknownCitations("Nothing cited.", 0)).toEqual({ text: "Nothing cited.", dropped: 0 });
  });

  test("roundAddedNothing reads source addresses, not wording", () => {
    const outcome = (urls: string[]) => ({ packageId: "websearch", sources: urls.map((url) => ({ url })) }) as never;
    expect(roundAddedNothing([outcome(["https://a.example/1"])], [outcome(["https://a.example/1"])])).toBe(true);
    expect(roundAddedNothing([outcome(["https://a.example/1"])], [outcome(["https://b.example/2"])])).toBe(false);
    // an empty first round gets one more try; a second empty round in a row ends it
    expect(roundAddedNothing([], [outcome([])])).toBe(false);
    expect(roundAddedNothing([outcome([])], [outcome([])])).toBe(true);
  });

  test("a research run reads at most 40 pages, 4 from one site, and none after a site refuses", () => {
    const budget = newResearchBudget(false);
    for (let i = 0; i < RESEARCH_HOST_PAGES_MAX; i++) { expect(researchPageAllowed(budget, "one.example")).toBe(true); notePageRead(budget, "one.example"); }
    expect(researchPageAllowed(budget, "one.example")).toBe(false);
    for (let i = 0; i < RESEARCH_PAGES_MAX - RESEARCH_HOST_PAGES_MAX; i++) notePageRead(budget, `site${i}.example`);
    expect(researchPageAllowed(budget, "fresh.example")).toBe(false);
    const refused = newResearchBudget(false);
    noteDeclined(refused);
    expect(researchPageAllowed(refused, "any.example")).toBe(false);
  });

  test("the searches of a research turn come back as steps for an adult's reload, and for no one else", () => {
    const stored = JSON.stringify([
      { callId: "c1", packageId: "websearch", status: "succeeded", args: { expression: "V series cancelled why" }, sources: [{ site: "a.example", url: "https://a.example/x" }] },
      { callId: "c2", packageId: "websearch", status: "failed", args: { expression: "V series novel" } },
    ]);
    expect(researchStepsFor(stored, "adult")).toEqual([
      { call_id: "c1", package_id: "websearch", label: "V series cancelled why", state: "ok", sites: [{ host: "a.example", url: "https://a.example/x" }] },
      { call_id: "c2", package_id: "websearch", label: "V series novel", state: "error" },
    ]);
    expect(researchStepsFor(stored, "teen")).toBeUndefined();
    expect(researchStepsFor(JSON.stringify([JSON.parse(stored)[0]]), "adult")).toBeUndefined();
  });
});

describe("the reasoning room grows with the style so a long research answer is not cut off", () => {
  test("Thinking gets four times and Max twelve times the record's reasoning allowance; Instant keeps it", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    expect(base.thinking_budget_tokens_toggled).toBeGreaterThan(0);
    expect(budgetForStyle(base, "instant").thinking_budget_tokens_toggled).toBe(base.thinking_budget_tokens_toggled);
    expect(budgetForStyle(base, "thinking").thinking_budget_tokens_toggled).toBe(base.thinking_budget_tokens_toggled * 4);
    expect(budgetForStyle(base, "max").thinking_budget_tokens_toggled).toBe(base.thinking_budget_tokens_toggled * 12);
    expect(budgetForStyle(base, "max").reply_ceiling_tokens).toBe(base.reply_ceiling_tokens);
  });
});

describe("repeat queries, the web scope, and credits no source names", () => {
  test("a search that repeats an earlier one is not issued", async () => {
    await turn("owner", 4, { thinking: true, queries: ["V series cancelled why", "why V series cancelled", "V series novel sequel", "V series reboot"] });
    // the second is the first reworded (same words), so only three reach the search backend
    expect(searxQueries.length).toBe(3);
  });

  test("a research turn searches the web after its first round even when the model keeps choosing the offline library", async () => {
    await turn("owner", 3, { thinking: true, scope: "reference" });
    expect(searxQueries.length).toBe(2);
  });

  test("repeat detection reads words only", () => {
    expect(isRepeatQuery(["V series cancelled why"], "why V series cancelled")).toBe(true);
    expect(isRepeatQuery(["V series cancelled why"], "V series novel sequel")).toBe(false);
    expect(isRepeatQuery([], "anything")).toBe(false);
  });

  test("a sentence crediting a person no source or question named is dropped; supported credits stay", () => {
    const evidence = "The weekly show was produced by Pat Quill according to the network.";
    const answer = "It was produced by Pat Quill. It was created by Jane Roe. It ended after one season.";
    const checked = dropUnsupportedCredits(answer, evidence, "tell me about the show");
    expect(checked.dropped).toBe(1);
    expect(checked.text).toContain("Pat Quill");
    expect(checked.text).not.toContain("Jane Roe");
    expect(checked.text).toContain("ended after one season");
  });
});

describe("one question runs at most twelve searches", () => {
  test("a Max round that asks for several searches at once still stops at twelve in all", async () => {
    await holdMax();
    await turn("owner", 13, { max: true, perRound: 3 });
    expect(searxQueries.length).toBe(12);
  });
});

describe("research is bounded by the clock, and the round counts are only ceilings", () => {
  afterEach(() => __setResearchCapForTests(undefined));

  test("no new round starts at 70% of the cap, the cut-off is the cap, and Instant has neither", () => {
    const started = 1_000_000;
    expect(researchNoNewRound({ answerStyle: "thinking", startedAt: started }, started + 52_000)).toBe(false);
    expect(researchNoNewRound({ answerStyle: "thinking", startedAt: started }, started + 52_500)).toBe(true);
    expect(researchNoNewRound({ answerStyle: "max", startedAt: started }, started + 104_000)).toBe(false);
    expect(researchNoNewRound({ answerStyle: "max", startedAt: started }, started + 105_000)).toBe(true);
    expect(researchNoNewRound({ answerStyle: "instant", startedAt: started }, started + 999_000)).toBe(false);
    expect(researchCutAt({ answerStyle: "thinking", startedAt: started })).toBe(started + 75_000);
    expect(researchCutAt({ answerStyle: "max", startedAt: started })).toBe(started + 150_000);
    expect(researchCutAt({ answerStyle: "instant", startedAt: started })).toBeUndefined();
  });

  test("a Thinking turn past 70% of its cap after one slow search answers instead of searching again", async () => {
    __setResearchCapForTests({ thinking: 400, max: 400 });
    searxDelayMs = 500;
    const { result } = await turn("owner", 4, { thinking: true });
    expect(searxQueries.length).toBe(1);
    expect(result.value.reply.text.length).toBeGreaterThan(0);
  });

  test("the same turn with time to spare still uses its rounds", async () => {
    const { result } = await turn("owner", 4, { thinking: true });
    expect(searxQueries.length).toBe(4);
    expect(result.value.reply.text.length).toBeGreaterThan(0);
  });

  test("the first round plans with thinking, the later search rounds do not think, and the answering round does", async () => {
    const { requests } = await turn("owner", 4, { thinking: true });
    const asString = (r: ChatCompletionRequest) => JSON.stringify(r);
    const searching = requests.filter((r) => (r.tools?.length ?? 0) > 0 && r.tool_choice !== "none");
    expect(searching.length).toBeGreaterThan(1);
    expect(asString(searching[0]!)).toContain('"enable_thinking":true');
    for (const r of searching.slice(1)) expect(asString(r)).toContain('"enable_thinking":false');
    expect(asString(requests.at(-1)!)).toContain('"enable_thinking":true');
  });
});

// RESEARCH-NOTES-01 / RESEARCH-PIPELINE-01: a fact deep in a page reaches the answering round through the notes ledger and the analysis,
// on four different kinds of question; a Max question that could mean two things asks once; a Thinking one states its reading.
const TOPICS = [
  { name: "a TV show's end", queries: ["Harbor Lights television series cancelled", "Harbor Lights series ratings one season"], utterance: "why was the television series Harbor Lights cancelled after one season", fact: "Deep fact: the show ranked 57th of 77 shows that season, which ended it." },
  { name: "a medical question", queries: ["typical chest cold last adult", "chest cold duration adult cough"], utterance: "how long does a typical chest cold last in an adult", fact: "Deep fact: the usual course of a chest cold is 10 to 14 days with a cough that can linger." },
  { name: "a tax question", queries: ["employee deduct home office federal taxes", "home office deduction employee federal taxes"], utterance: "can an employee deduct a home office on their federal taxes", fact: "Deep fact: employees cannot claim the home office deduction for tax years 2018 through 2025." },
  { name: "a science question", queries: ["sea level rising faster some places", "sea level rising regional differences places others"], utterance: "why is sea level rising faster in some places than in others", fact: "Deep fact: the western Pacific has risen about three times the global average since 1993." },
];
/** A query writer that plans the first round, then proposes `gaps` more rounds of searches, then finds nothing new to search. */
const writerWithGaps = (gaps: number) => {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify({ sub_questions: ["the key part"], queries: ["first angle on the question", "second angle on the question"] });
    return JSON.stringify({ queries: calls - 1 <= gaps ? [`another angle number ${calls}`] : [] });
  };
};
const longPage = (fact: string): string => `${"Opening material that says nothing useful about the question. ".repeat(170)}\n${fact}\n${"Closing material of no use either. ".repeat(60)}`;

describe("deep facts reach the answer through the notes, on four kinds of question", () => {
  for (const topic of TOPICS) {
    test(`${topic.name}: the fact 10,000 characters into a page is in the writing round, and the raw page text is not what carries it`, async () => {
      await holdMax();
      __setPageReaderForTests(async (url) => ({ type: "document", file_id: "f", url, title: "A page", text: longPage(topic.fact), chunks: [], links: [], sections: [] }));
      __setNoteWriterForTests(async (prompt) => {
        const m = prompt.match(/Deep fact: [^.]*\./);
        return JSON.stringify({ kind: "reputable", notes: m ? [{ topic: "the key part", note: "The page states the key fact.", quote: m[0], weight: 3 }] : [] });
      });
      __setStageWritersForTests({
        brief: async () => JSON.stringify({ subject: topic.name, answer_type: "an explanation", must_contain: ["the key fact"], ambiguous: false, options: [], assumption: "" }),
        analysis: async () => JSON.stringify({ claims: [{ claim: "The page states the key fact.", status: "established", sources: [1] }], conflicts: [], gaps: [], guesses: [{ guess: "Things would have continued the same way.", because: ["the key fact"], confidence: "low", sources: [1] }] }),
      });
      __setQueryWriterForTests(writerWithGaps(1));
      const { requests, result } = await turn("owner", 2, { max: true, thinking: true, utterance: topic.utterance, queries: topic.queries });
      const answering = lastRequest(requests);
      const instruction = answering.messages.filter((m) => m.role === "user").at(-1)!.content!.toString();
      expect(instruction).toContain("Notes from the pages that were read");
      expect(instruction).toContain(topic.fact);
      expect(instruction).toContain("Analysis of the notes");
      expect(instruction).toContain("Guesses to present as guesses");
      expect(toolMessages(answering).map((m) => String(m.content)).join("")).not.toContain(topic.fact);
      expect(result.value.reply.text.length).toBeGreaterThan(0);
    });
  }

  test("an instant answer takes no notes and no analysis", async () => {
    let noteCalls = 0;
    __setNoteWriterForTests(async () => { noteCalls += 1; return null; });
    await turn("owner", 2, { utterance: TOPICS[0]!.utterance });
    expect(noteCalls).toBe(0);
  });

  test("the claim check reads the deep quote as a passage of its source", async () => {
    await holdMax();
    const topic = TOPICS[1]!;
    __setPageReaderForTests(async (url) => ({ type: "document", file_id: "f", url, title: "A page", text: longPage(topic.fact), chunks: [], links: [], sections: [] }));
    __setNoteWriterForTests(async (prompt) => {
      const m = prompt.match(/Deep fact: [^.]*\./);
      return JSON.stringify({ kind: "reputable", notes: m ? [{ topic: "the key part", note: "The page states it.", quote: m[0], weight: 3 }] : [] });
    });
    const judged: string[] = [];
    __setClaimJudgeForTests(async (prompt) => { judged.push(prompt); return '{"supported": true}'; });
    __setQueryWriterForTests(writerWithGaps(0));
    await turn("owner", 1, { max: true, thinking: true, utterance: topic.utterance });
    expect(judged.some((p) => p.includes(topic.fact))).toBe(true);
  });
});

describe("a question that could mean two things", () => {
  const ambiguous = JSON.stringify({ subject: "a show", answer_type: "an explanation", must_contain: [], ambiguous: true, options: ["the 1984 series", "the 2009 series"], assumption: "I took this to mean the 1984 series." });
  const settled = JSON.stringify({ subject: "a show", answer_type: "an explanation", must_contain: [], ambiguous: false, options: [], assumption: "" });

  test("Max asks once, researches nothing, and offers the readings", async () => {
    await holdMax();
    __setStageWritersForTests({ brief: async () => ambiguous });
    const { result } = await turn("owner", 3, { max: true, thinking: true, utterance: "why did the television series Harbor Lights end" });
    expect(searxQueries.length).toBe(0);
    expect(result.value.reply.text).toContain("Which one do you mean: the 1984 series or the 2009 series?");
    expect(result.value.reply.text).toContain("pick for me");
  });

  test("a question whose words already settle it is not asked", async () => {
    await holdMax();
    __setStageWritersForTests({ brief: async () => settled });
    await turn("owner", 2, { max: true, thinking: true, utterance: "why did the 80s show, not the 2000s one, end" });
    expect(searxQueries.length).toBe(2);
  });

  test("Thinking never asks: it researches and states its reading in the first line of the answer", async () => {
    __setStageWritersForTests({ brief: async () => ambiguous });
    __setQueryWriterForTests(writerWithGaps(1));
    const { requests } = await turn("owner", 2, { thinking: true, utterance: "why did the television series Harbor Lights end" });
    expect(searxQueries.length).toBe(2);
    const instruction = lastRequest(requests).messages.filter((m) => m.role === "user").at(-1)!.content!.toString();
    expect(instruction).toContain('Begin with one plain sentence saying what you took the question to mean: "I took this to mean the 1984 series."');
  });
});
