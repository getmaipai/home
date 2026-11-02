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
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { __setChatWindowContextForTests } from "@/lib/roleHealth";
import { PageDeclinedError, __setPageReaderForTests, __resetSearchCacheForTests } from "@/lib/packageHost";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { createChatLease, registerActiveChatLease } from "@/lib/chatLease";
import { __setResearchCapForTests, rewordEmptyQuery, researchCutAt, researchNoNewRound, budgetForStyle, dropUnknownCitations, dropUnsupportedCredits, isRepeatQuery, roundAddedNothing } from "@/lib/turnMachine/research";
import { __setWebSearchToolDeadlineForTests } from "@/lib/webSearchBudget";
import { resolveTurnBudget } from "@/lib/turnMachine/budget";
import { RESEARCH_HOST_PAGES_MAX, RESEARCH_PAGES_MAX, newResearchBudget, noteDeclined, notePageRead, researchPageAllowed } from "@/lib/researchBudget";
import { researchStepsFor } from "@/lib/conversationHistory";
import { __setClaimJudgeForTests } from "@/lib/turnMachine/nodes/answer";
import { __setQueryWriterForTests } from "@/lib/turnMachine/nodes/model";
import { __setNoteWriterForTests } from "@/lib/turnMachine/pageNotes";
import { __setStageWritersForTests } from "@/lib/turnMachine/researchPipeline";
import { __setEntityPinForTests } from "@/lib/turnMachine/entityPin";
import { __setBackboneWriterForTests } from "@/lib/turnMachine/backbone";

let people: BenchPeople;
let searx: ReturnType<typeof Bun.serve>;
let searxQueries: string[] = [];
let sameResults = false;
let searxDelayMs = 0;
let extraRows: { title: string; url: string; content: string }[] = [];
let emptyWhen: RegExp | null = null;
let refillPace = false;

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
  extraRows = [];
  emptyWhen = null;
  refillPace = false;
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
      if (refillPace) __resetRateLimiterForTests(); // Home paces searches at a burst of three; this test is about the retries, not the pace
      if (emptyWhen?.test(q)) return Response.json({ results: [] });
      const n = sameResults ? 1 : searxQueries.length;
      return Response.json({ results: [...extraRows, ...[1, 2, 3].map((i) => ({ title: `Page ${n}.${i} about ${q}`, url: `https://site${n}x${i}.example/page`, content: `Snippet ${n}.${i} for ${q}` }))] });
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
  __setEntityPinForTests(undefined);
  __setBackboneWriterForTests(undefined);
  searx.stop(true);
  registerActiveChatLease(null);
  __setPageReaderForTests(null);
  __setChatWindowContextForTests(undefined);
  __setToolOfferOverridesForTests(null);
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** Runs one turn against a model that wants to search `wantedRounds` times (a different query each round), then answers. */
async function turn(who: "owner" | "teen" | "child", wantedRounds: number, opts: { thinking?: boolean; max?: boolean; scope?: "reference" | "web"; queries?: string[]; perRound?: number; utterance?: string; reply?: string; badSecondCall?: boolean } = {}) {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const requests: ChatCompletionRequest[] = [];
  let badCallMade = false;
  let made = 0; // searches the scripted model has asked for so far (a skipped or empty search leaves no tool message to count)
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request: ChatCompletionRequest) => {
      requests.push(request);
      return opts.reply ?? "It ended after one season [1] and the creator said more was planned [3].";
    },
    scriptedToolCalls: (request: ChatCompletionRequest) => {
      if (!request.tools || request.tools.length === 0 || request.tool_choice === "none") return undefined;
      requests.push(request);
      __resetRateLimiterForTests(); // Home's own search pace (a burst of three) would make this scripted run wait seconds per round
      const done = made;
      // A later round whose only call policy refuses (a tool that does not exist), with no text beside it.
      if (opts.badSecondCall && done === 1 && !badCallMade) { badCallMade = true; return [{ id: "call-bad", type: "function" as const, function: { name: "no_such_tool", arguments: "{}" } }]; }
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

  test("RESEARCH-RETRY-01: a later round whose only call is refused still ends in an answer written from the pages already read, never the refusal line", async () => {
    const { result } = await turn("owner", 3, { thinking: true, badSecondCall: true });
    expect(searxQueries.length).toBe(1);
    expect(result.value.reply.text).toContain("It ended after one season");
    expect(result.value.reply.text).not.toContain("so I won't guess");
  });

  test("RESEARCH-PLAN-CARD-01: a grown-up's Thinking turn announces its planned sub-questions on the status channel before the searches, a teen's does not", async () => {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const plan = JSON.stringify({ sub_questions: ["why the series ended", "what its makers planned next"], queries: ["V series cancelled why", "V series planned second season"] });
    for (const who of ["owner", "teen"] as const) {
      __setQueryWriterForTests(async () => plan);
      __setStageWritersForTests({ brief: async () => JSON.stringify({ subject: "the series", answer_type: "an explanation", must_contain: [], ambiguous: false, options: [], question: "", assumption: "" }), analysis: async () => null });
      const stub = startStubLlmServer(0, { scriptedChatReply: () => "It ended after one season [1].", scriptedToolCalls: () => undefined });
      const proxy = startRecordingProxy(stub.url);
      process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
      __resetLlmSupervisorForTests();
      try {
        const started = await runTurnNextStream(people[who]!, "chat", UTTERANCE, { thinking: true });
        if (!started.ok || started.kind !== "stream") throw new Error("expected a stream");
        for await (const _ of started.tokens) { /* run the turn to its end */ }
        const events = started.status.drain();
        const planned = events.find((e) => e.type === "research_plan");
        if (who === "owner") expect(planned && planned.type === "research_plan" ? planned.steps : []).toEqual(["why the series ended", "what its makers planned next"]);
        else expect(planned).toBeUndefined();
      } finally {
        proxy.stop();
        await stub.stop();
      }
    }
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

  test("the plan's searches are the first round's calls, the gap check's are each later round's, and a writer that is down leaves the model to choose", async () => {
    await holdMax();
    const prompts: string[] = [];
    __setQueryWriterForTests(async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) return JSON.stringify({ queries: ["V series ending first planned angle", "V series cancelled why"] });
      if (prompts.length === 2) return JSON.stringify({ queries: ["V series season cancelled found sites"] });
      return JSON.stringify({ queries: [] });
    });
    await turn("owner", 5, { max: true });
    expect(searxQueries).toEqual(["V series ending first planned angle", "V series cancelled why", "V series season cancelled found sites"]);
    expect(prompts[1]).toContain("Searches already run");
    expect(prompts[1]).toContain("V series ending first planned angle");
  });

  test("a writer that is down leaves the searches to the model, as before", async () => {
    await holdMax();
    __setQueryWriterForTests(async () => null);
    await turn("owner", 2, { max: true });
    expect(searxQueries.length).toBe(2);
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

  test("a research run reads at most 40 pages, 4 from one site, and none more from a site that refuses (the other sites are still read)", () => {
    const budget = newResearchBudget(false);
    for (let i = 0; i < RESEARCH_HOST_PAGES_MAX; i++) { expect(researchPageAllowed(budget, "one.example")).toBe(true); notePageRead(budget, "one.example"); }
    expect(researchPageAllowed(budget, "one.example")).toBe(false);
    for (let i = 0; i < RESEARCH_PAGES_MAX - RESEARCH_HOST_PAGES_MAX; i++) notePageRead(budget, `site${i}.example`);
    expect(researchPageAllowed(budget, "fresh.example")).toBe(false);
    const refused = newResearchBudget(false);
    noteDeclined(refused, "refuses.example");
    expect(researchPageAllowed(refused, "refuses.example")).toBe(false);
    expect(researchPageAllowed(refused, "other.example")).toBe(true);
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
    expect(researchNoNewRound({ answerStyle: "thinking", startedAt: started }, started + 24_000)).toBe(false);
    expect(researchNoNewRound({ answerStyle: "thinking", startedAt: started }, started + 24_500)).toBe(true);
    expect(researchNoNewRound({ answerStyle: "max", startedAt: started }, started + 52_000)).toBe(false);
    expect(researchNoNewRound({ answerStyle: "max", startedAt: started }, started + 52_500)).toBe(true);
    expect(researchNoNewRound({ answerStyle: "instant", startedAt: started }, started + 999_000)).toBe(false);
    expect(researchCutAt({ answerStyle: "thinking", startedAt: started })).toBe(started + 35_000);
    expect(researchCutAt({ answerStyle: "max", startedAt: started })).toBe(started + 75_000);
    expect(researchCutAt({ answerStyle: "instant", startedAt: started })).toBeUndefined();
  });

  test("a Thinking turn past 70% of its cap after one slow search answers instead of searching again", async () => {
    __setResearchCapForTests({ thinking: 400, max: 400 });
    searxDelayMs = 500;
    const { result } = await turn("owner", 4, { thinking: true });
    expect(searxQueries.length).toBe(1);
    // the model wrote the answer (a phrasing round), not a dump of the search results
    expect(result.value.reply.text).toContain("It ended after one season");
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
/** A query writer that plans the first round with `plan`, then proposes each entry of `gaps` as a later round, then finds nothing new to search. */
const writerWithGaps = (plan: string[], gaps: string[][]) => {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify({ sub_questions: ["the key part"], queries: plan });
    return JSON.stringify({ queries: gaps[calls - 2] ?? [] });
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
      __setQueryWriterForTests(writerWithGaps(topic.queries, [[topic.queries[0]! + " details"]]));
      const { requests, result } = await turn("owner", 2, { max: true, thinking: true, utterance: topic.utterance });
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
    __setQueryWriterForTests(writerWithGaps(topic.queries, []));
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
    expect(result.value.reply.text).toContain("Before I research this, which one do you mean: the 1984 series or the 2009 series?");
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
    __setQueryWriterForTests(writerWithGaps(["Harbor Lights television series end", "Harbor Lights series ratings"], [["Harbor Lights network schedule decision"]]));
    const { requests } = await turn("owner", 2, { thinking: true, utterance: "why did the television series Harbor Lights end" });
    expect(searxQueries.length).toBe(3);
    const instruction = lastRequest(requests).messages.filter((m) => m.role === "user").at(-1)!.content!.toString();
    expect(instruction).toContain('Begin with one plain sentence saying what you took the question to mean: "I took this to mean the 1984 series."');
  });
});

describe("the gap check ends the searching only when the writer itself finds nothing more to search", () => {
  test("a proposal list that only repeats earlier searches ends the searching too", async () => {
    await holdMax();
    let calls = 0;
    __setQueryWriterForTests(async () => { calls += 1; return calls === 1 ? JSON.stringify({ queries: ["Harbor Lights television series cancelled"] }) : JSON.stringify({ queries: ["Harbor Lights television series cancelled"] }); });
    const { result, requests } = await turn("owner", 4, { max: true, thinking: true, queries: ["Harbor Lights series ratings one season"], utterance: "why was the television series Harbor Lights cancelled after one season" });
    expect(searxQueries).toEqual(["Harbor Lights television series cancelled"]);
    expect(result.value.reply.text).toContain("It ended after one season");
    // RESEARCH-ROUND-01: after the gap check wrote nothing, no round is spent on a tool-offering generation (the live V run lost 31 s there).
    const afterSearch = requests.filter((r) => toolMessages(r).length > 0);
    expect(afterSearch.length).toBeGreaterThan(0);
    expect(afterSearch.every((r) => !r.tools || r.tools.length === 0 || r.tool_choice === "none")).toBe(true);
  });

  test("a writer that proposes nothing at all ends the searching and the answer is written from the notes", async () => {
    await holdMax();
    __setQueryWriterForTests(writerWithGaps(["Harbor Lights television series cancelled"], []));
    const { result } = await turn("owner", 4, { max: true, thinking: true, queries: ["Harbor Lights series ratings one season"], utterance: "why was the television series Harbor Lights cancelled after one season" });
    expect(searxQueries).toEqual(["Harbor Lights television series cancelled"]);
    expect(result.value.reply.text).toContain("It ended after one season");
  });
});

describe("the pinned subject rides every research search (RESEARCH-PIN-01)", () => {
  const BRIEF = JSON.stringify({ subject: "the series", answer_type: "an explanation", must_contain: ["why it ended"], ambiguous: false, options: [], question: "", assumption: "" });
  const candidate = (title: string) => ({ title, snippet: `${title} snippet`, load: async () => ({ title, lead: `${title} is a show.`, sections: [], source: "library" as const }) });

  test("a Max turn pins the article first, and its searches carry the name and year even though the question only said 'the 80s'", async () => {
    await holdMax();
    __setStageWritersForTests({ brief: async () => BRIEF, analysis: async () => null });
    __setEntityPinForTests({ finder: async () => [candidate("Harbor (franchise)"), candidate("Harbor (1984 television series)")], writer: async () => '{"pick": 2}' });
    const prompts: string[] = [];
    __setQueryWriterForTests(async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? JSON.stringify({ sub_questions: ["why it ended"], queries: ["series cancelled why", '"creator" OR "producer" interview plans for a second season of the show'] }) : JSON.stringify({ queries: [] });
    });
    await turn("owner", 2, { max: true, utterance: "the 80s series only had one season, why was it cancelled" });
    expect(prompts[0]).toContain("pinned to the article");
    expect(searxQueries.length).toBe(2);
    for (const q of searxQueries) {
      expect(q).toContain("Harbor");
      expect(q).toContain("1984");
      expect(q).not.toContain('"');
      expect(q).not.toContain(" OR ");
      expect(q.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
  });

  test("a turn whose subject no article clearly names searches as before, only cleaned to plain keywords", async () => {
    await holdMax();
    __setStageWritersForTests({ brief: async () => BRIEF, analysis: async () => null });
    __setEntityPinForTests({ finder: async () => [candidate("One"), candidate("Two")], writer: async () => '{"pick": 0}' });
    __setQueryWriterForTests(async (prompt) => (prompt.includes("Searches already run:\n(none yet)") ? JSON.stringify({ sub_questions: ["x"], queries: ['"series" cancelled one season'] }) : JSON.stringify({ queries: [] })));
    await turn("owner", 1, { max: true });
    expect(searxQueries).toEqual(["series cancelled one season"]);
  });
});

describe("the pinned article is read whole by section and cited as a source (RESEARCH-BACKBONE-01)", () => {
  const BRIEF = JSON.stringify({ subject: "the series", answer_type: "an explanation", must_contain: ["why it ended"], ambiguous: false, options: [], question: "", assumption: "" });
  const FACT = "The show fell to 57th of 77 in the ratings and was cancelled in March 1985.";
  const article = {
    title: "Harbor (1984 television series)",
    lead: "Harbor is a show that aired for one season.",
    source: "library" as const,
    book: "wikipedia_en_all_maxi",
    path: "Harbor_(1984_TV_series)",
    sections: [
      { heading: "Premise", text: "premise filler. ".repeat(300) },
      { heading: "Reception", text: `${"ratings filler. ".repeat(500)}${FACT}` },
    ],
  };

  test("a fact 8,000 characters into the article is in the writing round, the article is a numbered source, and the analysis can cite it", async () => {
    await holdMax();
    __setStageWritersForTests({
      brief: async () => BRIEF,
      analysis: async () => JSON.stringify({ claims: [{ claim: "It was cancelled in March 1985.", status: "established", sources: [4] }], conflicts: [], gaps: [], guesses: [] }),
    });
    __setEntityPinForTests({ finder: async () => [{ title: article.title, snippet: "s", load: async () => article }, { title: "Harbor (franchise)", snippet: "f", load: async () => null }], writer: async () => '{"pick": 1}' });
    __setBackboneWriterForTests(async () => '{"sections": [2]}');
    __setQueryWriterForTests(async (prompt) => (prompt.includes("Searches already run:\n(none yet)") ? JSON.stringify({ sub_questions: ["why it ended"], queries: ["series cancelled why"] }) : JSON.stringify({ queries: [] })));
    const { requests, result } = await turn("owner", 1, { max: true, thinking: true });
    const instruction = lastRequest(requests).messages.filter((m) => m.role === "user").at(-1)!.content!.toString();
    expect(instruction).toContain(FACT);
    expect(instruction).toContain("cite it as [4]");
    expect(instruction).toContain("It was cancelled in March 1985. [4]");
    const titles = (result.value.sources ?? []).map((s) => s.title);
    expect(titles.at(-1)).toBe("Harbor (1984 television series)");
    expect(result.value.sources!.length).toBe(4);
  });

  test("a turn with no pinned article has no backbone and no extra source", async () => {
    await holdMax();
    __setStageWritersForTests({ brief: async () => BRIEF, analysis: async () => null });
    __setEntityPinForTests({ finder: async () => [], writer: async () => '{"pick": 0}' });
    const { requests, result } = await turn("owner", 1, { max: true });
    expect(JSON.stringify(lastRequest(requests).messages)).not.toContain("Backbone article");
    expect(result.value.sources!.length).toBe(3);
  });
});

describe("page reading skips a refusing site and the junk hosts, and goes on (RESEARCH-PAGES-01)", () => {
  const page = (url: string) => ({ type: "document" as const, file_id: "f", url, title: "A page", text: `Text of ${url}.`, chunks: [], links: [], sections: [] });

  test("a social or video host is never asked for a page; the real sites after it are", async () => {
    await holdMax();
    extraRows = [{ title: "A reel", url: "https://www.instagram.com/p/abc", content: "reel" }, { title: "A clip", url: "https://www.youtube.com/watch?v=abc", content: "clip" }];
    const asked: string[] = [];
    __setPageReaderForTests(async (url) => { asked.push(url); return page(url); });
    await turn("owner", 1, { max: true });
    expect(asked.some((u) => u.includes("instagram.com") || u.includes("youtube.com"))).toBe(false);
    expect(asked.length).toBe(3);
  });

  test("a site that refuses a page is skipped for the rest of the run, and the other sites are still read", async () => {
    await holdMax();
    const asked: string[] = [];
    __setPageReaderForTests(async (url) => {
      asked.push(url);
      if (url.includes("site1x1.")) throw new PageDeclinedError("The site declined the page request.");
      return page(url);
    });
    const { result } = await turn("owner", 2, { max: true });
    expect(asked.filter((u) => u.includes("site1x")).length).toBe(3);
    expect(asked.filter((u) => u.includes("site2x")).length).toBe(3);
    expect(result.value.sources!.length).toBeGreaterThanOrEqual(6);
  });

  test("a research search reads up to four pages at once from different sites", async () => {
    await holdMax();
    extraRows = [{ title: "A fourth page", url: "https://four.example/page", content: "four" }];
    const asked: string[] = [];
    __setPageReaderForTests(async (url) => { asked.push(url); return page(url); });
    await turn("owner", 1, { max: true });
    expect(asked.length).toBe(4);
  });
});

// One code path for every kind of subject (owner ruling 2026-11-01): the same pin, backbone and search rules run for each of these, with no branch
// on the topic. researchNoTopicWords.test.ts keeps topic words out of the source; this proves the path itself.
describe("the same research path handles every kind of subject", () => {
  const SUBJECTS = [
    { name: "medicine", utterance: "how long does a typical chest cold last in an adult", plan: "typical chest cold last adult", title: "Chest cold", heading: "Prognosis", fact: "Deep fact: the usual course of a chest cold is about three weeks.", keys: ["Chest", "cold"], years: [] as string[] },
    { name: "law and tax", utterance: "can an employee deduct a home office on their federal taxes", plan: "employee deduct home office federal taxes", title: "Home office deduction (United States)", heading: "Eligibility", fact: "Deep fact: an employee generally cannot deduct a home office under current federal rules.", keys: ["Home", "office"], years: [] },
    { name: "product comparison", utterance: "which is better for a small kitchen, the Alder 200 or the Birch 300 blender", plan: "Alder 200 Birch 300 blender small kitchen", title: "Alder 200 (blender)", heading: "Specifications", fact: "Deep fact: the Alder 200 is 18 centimeters wide and weighs two kilograms.", keys: ["Alder", "200"], years: [] },
    { name: "science", utterance: "why is sea level rising faster in some places than in others", plan: "sea level rising faster places others", title: "Sea level rise", heading: "Regional variation", fact: "Deep fact: land subsidence and ocean currents make the rise uneven between regions.", keys: ["Sea", "level"], years: [] },
    { name: "local history", utterance: "when was the Stonebridge covered bridge built and who paid for it", plan: "Stonebridge covered bridge built paid", title: "Stonebridge, Ohio", heading: "History", fact: "Deep fact: the covered bridge was built in 1868 and paid for by a county levy.", keys: ["Stonebridge"], years: [] },
    { name: "software how-to", utterance: "how do I roll back a database migration in the Quill framework", plan: "roll back database migration Quill framework", title: "Quill (2019 software framework)", heading: "Migrations", fact: "Deep fact: the rollback command reverses the most recent migration batch.", keys: ["Quill"], years: ["2019"] },
    { name: "a TV case", utterance: "why was the television series Harbor Lights cancelled after one season", plan: "Harbor Lights television series cancelled", title: "Harbor Lights (1984 television series)", heading: "Reception", fact: "Deep fact: ratings fell to 57th of 77 shows and the network cancelled it in March 1985.", keys: ["Harbor", "Lights"], years: ["1984"] },
  ];
  const BRIEF = (subject: string) => JSON.stringify({ subject, answer_type: "an explanation", must_contain: ["the key fact"], ambiguous: false, options: [], question: "", assumption: "" });

  for (const topic of SUBJECTS) {
    test(`${topic.name}: the subject is pinned, every search carries its name, and the deep fact of the article reaches the writing round as a numbered source`, async () => {
      await holdMax();
      const article = {
        title: topic.title,
        lead: `${topic.title} opening.`,
        source: "library" as const,
        book: "wikipedia_en_all_maxi",
        path: topic.title.replace(/[^A-Za-z0-9]+/g, "_"),
        sections: [
          { heading: "Overview", text: "overview filler. ".repeat(200) },
          { heading: topic.heading, text: `${"detail filler. ".repeat(300)}${topic.fact}` },
        ],
      };
      __setStageWritersForTests({
        brief: async () => BRIEF(topic.name),
        analysis: async () => JSON.stringify({ claims: [{ claim: "The article states the key fact.", status: "established", sources: [4] }], conflicts: [], gaps: [], guesses: [] }),
      });
      __setEntityPinForTests({ finder: async () => [{ title: topic.title, snippet: "s", load: async () => article }, { title: "Something else", snippet: "x", load: async () => null }], writer: async () => '{"pick": 1}' });
      __setBackboneWriterForTests(async () => '{"sections": [2]}');
      __setQueryWriterForTests(async (prompt) => (prompt.includes("Searches already run:\n(none yet)") ? JSON.stringify({ sub_questions: ["the key fact"], queries: [topic.plan] }) : JSON.stringify({ queries: [] })));
      const { requests, result } = await turn("owner", 1, { max: true, thinking: true, utterance: topic.utterance });
      expect(searxQueries.length).toBe(1);
      for (const key of topic.keys) expect(searxQueries[0]!.toLowerCase()).toContain(key.toLowerCase());
      for (const year of topic.years) expect(searxQueries[0]).toContain(year);
      expect(searxQueries[0]!.split(/\s+/).length).toBeLessThanOrEqual(8 + topic.title.split(/\s+/).length);
      const instruction = lastRequest(requests).messages.filter((m) => m.role === "user").at(-1)!.content!.toString();
      expect(instruction).toContain(topic.fact);
      expect(instruction).toContain("cite it as [4]");
      expect((result.value.sources ?? []).at(-1)?.title).toBe(topic.title);
    });
  }
});

describe("names and facts no source gives are marked (RESEARCH-FABRICATION-01)", () => {
  test("a Max sentence naming someone no source, note or article contains is marked, and a sentence with only sourced names is not", async () => {
    await holdMax();
    __setClaimJudgeForTests(async () => '{"supported": true}');
    const { result } = await turn("owner", 1, { max: true, reply: "A review by Marcus Quillon found the blender noisy [1]. The Alder 200 is sold in two colors [2]." });
    expect(result.value.reply.text).toContain("Marcus Quillon found the blender noisy [1] (not in the sources).");
    expect(result.value.reply.text).toContain("two colors [2].");
    expect(result.value.reply.text).not.toContain("colors [2] (not in the sources)");
  });

  test("an uncited sentence that states a fact goes to the claim judge against the notes and the article; a general one does not", async () => {
    await holdMax();
    const judged: string[] = [];
    __setClaimJudgeForTests(async (prompt) => { judged.push(prompt); return '{"supported": false}'; });
    __setStageWritersForTests({ brief: async () => null, analysis: async () => null });
    const { result } = await turn("owner", 1, { max: true, reply: "It ended soon after, with 57 episodes still unmade. That is a hard thing to say plainly [1]." });
    expect(judged.some((p) => p.includes("57 episodes still unmade"))).toBe(true);
    expect(judged.some((p) => p.includes("hard thing to say"))).toBe(true);
    expect(result.value.reply.text).toContain("unmade (not confirmed by the sources)");
  });
});

describe("every part the answer must cover is backed, read for once more, or said to be missing (RESEARCH-COVERAGE-01)", () => {
  const BRIEF = JSON.stringify({ subject: "the handbook", answer_type: "an explanation", must_contain: ["the key fact"], ambiguous: false, options: [], question: "", assumption: "" });
  const FACT2 = "Deep detail: the hearing was held in March 1999 and ended the matter.";
  const article = (withDetails: boolean) => ({
    title: "Alder (handbook)",
    lead: "Alder is a handbook.",
    source: "library" as const,
    book: "wikipedia_en_all_maxi",
    path: "Alder_(handbook)",
    sections: [
      { heading: "Overview", text: "overview filler. ".repeat(180) },
      ...(withDetails ? [{ heading: "Outcome", text: `${"outcome filler. ".repeat(100)}${FACT2}` }] : []),
    ],
  });
  const setup = (withDetails: boolean) => {
    __setStageWritersForTests({
      brief: async () => BRIEF,
      analysis: async () => JSON.stringify({ claims: [{ claim: "The handbook was reviewed.", status: "established", sources: [4] }], conflicts: [], gaps: [], guesses: [], parts: [{ part: "the key fact", covered: false }] }),
    });
    __setEntityPinForTests({ finder: async () => [{ title: "Alder (handbook)", snippet: "s", load: async () => article(withDetails) }, { title: "Other", snippet: "x", load: async () => null }], writer: async () => '{"pick": 1}' });
    __setBackboneWriterForTests(async () => '{"sections": [1]}');
    __setQueryWriterForTests(async (prompt) => (prompt.includes("Searches already run:\n(none yet)") ? JSON.stringify({ sub_questions: ["the key fact"], queries: ["handbook review published"] }) : JSON.stringify({ queries: [] })));
  };
  const lastInstruction = (requests: ChatCompletionRequest[]) => lastRequest(requests).messages.filter((m) => m.role === "user").at(-1)!.content!.toString();

  test("a part the analysis reports uncovered is read for from the sections not yet read, by heading, with no new search", async () => {
    await holdMax();
    setup(true);
    const { requests } = await turn("owner", 1, { max: true, thinking: true, utterance: "what happened to the handbook" });
    expect(searxQueries.length).toBe(1);
    const instruction = lastInstruction(requests);
    expect(instruction).toContain("More of the article, read for the parts the notes did not cover");
    expect(instruction).toContain(FACT2);
    expect(instruction).not.toContain("Nothing in the notes or the article speaks to");
  });

  test("a part nothing speaks to, with no section left to read, is handed to the writer as not found in the sources", async () => {
    await holdMax();
    setup(false);
    const { requests } = await turn("owner", 1, { max: true, thinking: true, utterance: "what happened to the handbook" });
    const instruction = lastInstruction(requests);
    expect(instruction).toContain('Nothing in the notes or the article speaks to: "the key fact"');
    expect(instruction).toContain("not found in the sources");
    expect(instruction).not.toContain("More of the article, read for");
  });

  test("the writing round states a word target by style: about 450 for Max, about 300 for Thinking", async () => {
    await holdMax();
    setup(true);
    const max = await turn("owner", 1, { max: true, thinking: true, utterance: "what happened to the handbook" });
    expect(lastInstruction(max.requests)).toContain("about 450 words");
    searxQueries = [];
    setup(true);
    const thinking = await turn("owner", 1, { thinking: true, utterance: "what happened to the handbook" });
    expect(lastInstruction(thinking.requests)).toContain("about 300 words");
  });
});

// RESEARCH-NOTES-01: the page-notes writer is told the research cut-off, so no note call starts that could not finish before it.
describe("the research cut-off reaches the note writer", () => {
  afterEach(() => __setResearchCapForTests(undefined));
  const pageWithFact = (url: string) => ({ type: "document" as const, file_id: "f", url, title: "A page", text: longPage(TOPICS[0]!.fact), chunks: [], links: [], sections: [] });
  const withNotes = (cut: number | null) => {
    if (cut !== null) __setResearchCapForTests({ thinking: cut, max: cut });
    __setPageReaderForTests(async (url) => pageWithFact(url));
    __setQueryWriterForTests(writerWithGaps(["Harbor Lights television series cancelled"], []));
    __setStageWritersForTests({ brief: async () => JSON.stringify({ subject: "a show", answer_type: "an explanation", must_contain: ["the key fact"], ambiguous: false, options: [], assumption: "" }), analysis: async () => null });
  };
  test("a Max turn whose cut-off is nearer than one note call writes no notes", async () => {
    await holdMax();
    withNotes(5_000);
    let noteCalls = 0;
    __setNoteWriterForTests(async () => { noteCalls += 1; return null; });
    await turn("owner", 1, { max: true, thinking: true, utterance: TOPICS[0]!.utterance });
    expect(searxQueries.length).toBe(1);
    expect(noteCalls).toBe(0);
  });

  test("with time to spare the same turn writes notes", async () => {
    await holdMax();
    withNotes(null);
    let noteCalls = 0;
    __setNoteWriterForTests(async () => { noteCalls += 1; return null; });
    await turn("owner", 1, { max: true, thinking: true, utterance: TOPICS[0]!.utterance });
    expect(noteCalls).toBeGreaterThan(0);
  });
});

// RESEARCH-EMPTY-01: a planned search that returns no rows (or fails) is run once more, reworded, beside the round's other searches.
describe("an empty planned search is retried once, reworded", () => {
  afterEach(() => __setResearchCapForTests(undefined));
  const ASKED = "why was the television series Harbor Lights cancelled after one season, and what did the Visitor do next";
  const plan = (queries: string[]) => __setQueryWriterForTests(writerWithGaps(queries, []));

  test("the reword keeps the entity title and the lowercase topic words and drops the rare specifics", () => {
    expect(rewordEmptyQuery("Harbor Lights series Visitor sequel novel plot", null)).toBe("Harbor Lights series sequel novel");
    expect(rewordEmptyQuery("Harbor Lights 1984 series Visitor leader motive", "Harbor Lights 1984")).toBe("Harbor Lights 1984 series leader motive");
    expect(rewordEmptyQuery("Harbor Lights 1984 series sequel book plot", "Harbor Lights 1984 series")).toBe("Harbor Lights 1984 series sequel book");
    // nothing left to drop, nothing to reword
    expect(rewordEmptyQuery("Harbor Lights interview", "Harbor Lights")).toBeNull();
    expect(rewordEmptyQuery("Harbor Lights", "Harbor Lights")).toBeNull();
  });

  test("a search with no rows is searched again without its rare words, and the retry's rows are sources", async () => {
    await holdMax();
    emptyWhen = /Visitor/;
    plan(["Harbor Lights series Visitor sequel novel plot"]);
    const { result } = await turn("owner", 1, { max: true, thinking: true, utterance: ASKED });
    expect(searxQueries.length).toBe(2);
    expect(searxQueries[0]).toContain("Visitor");
    expect(searxQueries[1]).not.toContain("Visitor");
    expect(searxQueries[1]).toContain("Harbor Lights");
    expect(result.value.sources!.length).toBe(3);
  });

  test("a search that returned rows is not retried", async () => {
    await holdMax();
    plan(["Harbor Lights series Visitor sequel novel plot"]);
    await turn("owner", 1, { max: true, thinking: true, utterance: ASKED });
    expect(searxQueries.length).toBe(1);
  });

  test("the retries of one round run beside each other, at most two to a round", async () => {
    await holdMax();
    refillPace = true;
    emptyWhen = /Visitor|Regent|Warden/;
    searxDelayMs = 400;
    plan(["Harbor Lights series Visitor sequel novel plot", "Harbor Lights series Regent motive finale", "Harbor Lights series Warden cast reunion"]);
    const started = Date.now();
    await turn("owner", 3, { max: true, thinking: true, utterance: `${ASKED} and the Regent and the Warden`, perRound: 3 });
    const retries = searxQueries.filter((q) => !/Visitor|Regent|Warden/.test(q));
    expect(retries.length).toBe(2);
    // three searches one after another (1.2 s), then the two retries together (0.4 s), not one after another (0.8 s)
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  // The shape every live bench run showed: searches are paced (a burst of three, then one per six seconds), so the later searches of a
  // round meet the round's tool deadline. The cut search is a "failed / timed_out" outcome and the node's own signal is already aborted.
  test("searches cut by the round's tool deadline are retried, reworded, on their own short limit", async () => {
    await holdMax();
    refillPace = true;
    emptyWhen = null;
    searxDelayMs = 400;
    __setWebSearchToolDeadlineForTests(600);
    try {
      plan(["Harbor Lights series Visitor sequel novel plot", "Harbor Lights series Regent motive finale", "Harbor Lights series Warden cast reunion"]);
      const { result } = await turn("owner", 3, { max: true, thinking: true, utterance: `${ASKED} and the Regent and the Warden`, perRound: 3 });
      const retries = searxQueries.filter((q) => !/Visitor|Regent|Warden/.test(q));
      expect(retries.length).toBe(2);
      expect(result.value.sources!.length).toBeGreaterThan(3);
    } finally {
      __setWebSearchToolDeadlineForTests(undefined);
    }
  });

  test("no retry when more than half of the research time is gone", async () => {
    await holdMax();
    __setResearchCapForTests({ thinking: 1_000, max: 1_000 });
    emptyWhen = /Visitor/;
    searxDelayMs = 900;
    plan(["Harbor Lights series Visitor sequel novel plot"]);
    await turn("owner", 1, { max: true, thinking: true, utterance: ASKED });
    expect(searxQueries.length).toBe(1);
  });
});
