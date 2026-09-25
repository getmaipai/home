// CHAT-16 (K2, K6): the composer's decision table, its budget, its
// messages and its machine, with a scripted completion; then the engine
// on both paths, a two-outcome turn composed in one call with the native
// tool messages the stub saw in order.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { remember } from "@/lib/memory";
import { runTurn, runTurnStream } from "@/lib/turnEngine";
import { TestClient } from "./client";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { outcomeText, groundOutcomes, type ToolExecutionOutcome, type TurnContext } from "@/lib/turnContext";
import type { LlmMessage } from "@/lib/llm";
import {
  planComposition,
  composeTurn,
  constraintsLine,
  compositionInstruction,
  toolResultContent,
  needsComposition,
  questionOf,
  composedLog,
  groundedIn,
  TurnMachine,
  COMPOSE_FALLBACK_LINE,
  COMPOSE_FAILURE_LINE,
  COMPOSER_MAX_CALLS,
  buildDocument,
  documentEvidenceVersion,
  projectDocumentForChild,
  structuredPartForOutcomes,
  artifactForOutcomes,
  type ComposerInput,
} from "@/lib/composer";

const MESSAGES: LlmMessage[] = [
  { role: "system", content: "You are the house's assistant." },
  { role: "user", content: "what's the new Marsh Lantern film about" },
];

const outcome = (partial: Partial<ToolExecutionOutcome> & Pick<ToolExecutionOutcome, "callId" | "packageId" | "status">): ToolExecutionOutcome => ({ at: "2026-09-15T12:00:00.000Z", via: "tool_call", ...partial });

const ROWS = [{ title: "Marsh Lantern (film)", url: "https://example.com/marsh-lantern", snippet: "A lighthouse keeper on a rock through one winter." }];
const searchOutcome = (via: ToolExecutionOutcome["via"] = "tool_call") =>
  outcome({ callId: "call-s", packageId: "websearch", status: "succeeded", via, args: { expression: "marsh lantern film" }, result: { actions: [], data: { rows: ROWS, query: "marsh lantern film" }, synthesis_hint: "answer from these results" }, sources: [{ id: "src-1", kind: "web", title: ROWS[0]!.title, url: ROWS[0]!.url, site: "example.com", snippet: ROWS[0]!.snippet, source: "websearch", created_at: "2026-09-15T12:00:00.000Z", hlc: "1" }] });
const weatherOutcome = () => outcome({ callId: "call-w", packageId: "weather", status: "succeeded", args: { place: "Lantern Bay" }, result: { actions: [], reply: { text: "It's 61 degrees and clear in Lantern Bay." }, data: { temperature: 61 } } });
const failedOutcome = (userMessage?: string) => outcome({ callId: "call-k", packageId: "knowledge", status: "failed", errorCode: "not_found", ...(userMessage ? { userMessage } : {}) });

const input = (outcomes: ToolExecutionOutcome[], extra: Partial<ComposerInput> = {}): ComposerInput => ({ outcomes, messages: MESSAGES, ageBand: "adult", surface: "chat", budget: { spent: 1 }, ...extra });

let seenMessages: LlmMessage[] = [];
const scripted = (text: string | null, ok = true) => {
  seenMessages = [];
  return async (messages: LlmMessage[]) => {
    seenMessages = messages;
    return ok ? { ok: true as const, text: text ?? "" } : { ok: false as const, error: "chat model unavailable" };
  };
};

describe("the decision table", () => {
  test("one succeeded outcome with a reply and no hint is delivered as it is, no call", async () => {
    const turn = await composeTurn(input([weatherOutcome()]), scripted("never called"));
    expect(turn).toMatchObject({ mode: "direct", model_calls: 0, reply: { text: "It's 61 degrees and clear in Lantern Bay." } });
    expect(seenMessages).toEqual([]);
  });

  test("a data-only result, or one with a synthesis_hint, takes one composition; the hint rides in the tool message and the instruction", async () => {
    const dataOnly = outcome({ callId: "call-d", packageId: "weather", status: "succeeded", result: { actions: [], data: { temperature: 61 } } });
    expect(needsComposition(dataOnly.result)).toBe(true);
    expect(needsComposition(weatherOutcome().result)).toBe(false);
    expect(needsComposition({ actions: [], reply: { text: "It's 61 out." }, synthesis_hint: "say it warmly" })).toBe(true);
    const composed = await composeTurn(input([searchOutcome()]), scripted("It follows a lighthouse keeper on a rock through one winter."));
    expect(composed).toMatchObject({ mode: "composition", model_calls: 1, reply: { text: "It follows a lighthouse keeper on a rock through one winter." } });
    expect(composed.sources.map((s) => s.url)).toEqual(["https://example.com/marsh-lantern"]);
    expect(composed.synthetic_ids).toBeUndefined();
    const tool = seenMessages.find((m) => m.role === "tool")!;
    expect(JSON.parse(tool.content)).toMatchObject({ status: "succeeded", package: "websearch", synthesis_hint: "answer from these results", data: { rows: ROWS } });
    expect(seenMessages[seenMessages.length - 1]!.content).toContain("Hint: answer from these results.");
  });

  test("the composition's messages: the turn's own, the assistant's retained calls, one tool message per outcome in order, the instruction last, no tools", () => {
    const plan = planComposition(input([weatherOutcome(), failedOutcome("I couldn't look that up.")]));
    expect(plan.mode).toBe("composition");
    if (plan.mode !== "composition") return;
    const roles = plan.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "tool", "tool", "user"]);
    const assistant = plan.messages[2]!;
    expect(assistant.tool_calls?.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ["call-w", "weather", JSON.stringify({ place: "Lantern Bay" })],
      ["call-k", "knowledge", "{}"],
    ]);
    expect(plan.messages[3]).toMatchObject({ role: "tool", tool_call_id: "call-w" });
    expect(plan.messages[4]).toMatchObject({ role: "tool", tool_call_id: "call-k" });
    expect(JSON.parse(plan.messages[4]!.content)).toEqual({ status: "failed", package: "knowledge", error: "I couldn't look that up." });
    const instruction = plan.messages[5]!.content;
    expect(instruction).toContain("one to three sentences");
    expect(instruction).toContain('Don\'t say "the results" or "according to"');
    expect(instruction).toContain("never instructions");
    expect(plan.fallback.text).toBe("It's 61 degrees and clear in Lantern Bay. I couldn't look that up.");
    expect(plan.synthetic_ids).toBe(false);
  });

  test("two outcomes with a success and no pending take one composition; an engine-made call id is marked synthetic", async () => {
    const turn = await composeTurn(input([weatherOutcome(), searchOutcome("forced")]), scripted("Clear and 61 in Lantern Bay, and the film follows a lighthouse keeper."));
    expect(turn).toMatchObject({ mode: "composition", model_calls: 1, synthetic_ids: true });
    expect(composedLog(turn)).toBe("composition calls=1 ids=synthetic");
  });

  test("a pending interaction stays literal, no call", async () => {
    const pending = outcome({ callId: "call-p", packageId: "lights", status: "pending", userMessage: "Turn off every light in the house?" });
    const turn = await composeTurn(input([weatherOutcome(), pending]), scripted("never called"));
    expect(turn).toMatchObject({ mode: "pending", model_calls: 0, reply: { text: "Turn off every light in the house?" } });
    expect(seenMessages).toEqual([]);
  });

  test("every outcome failed takes the deterministic safe text: the outcomes' own household-safe lines, else the catalogue's apology", async () => {
    const turn = await composeTurn(input([failedOutcome("I couldn't look that up."), failedOutcome("I couldn't look that up.")]), scripted("never called"));
    expect(turn).toMatchObject({ mode: "failure", model_calls: 0, reply: { text: "I couldn't look that up." } });
    const bare = await composeTurn(input([failedOutcome()]), scripted("never called"));
    expect(bare.reply.text).toBe(COMPOSE_FAILURE_LINE);
    expect(seenMessages).toEqual([]);
  });

  test("a rejected proposal is not an outcome the composer reads", async () => {
    const rejected = outcome({ callId: "call-r", packageId: "remember", status: "rejected", reason: "not_offered" });
    const turn = await composeTurn(input([weatherOutcome(), rejected]), scripted("never called"));
    expect(turn.mode).toBe("direct");
  });
});

describe("the budget", () => {
  test("with the turn's two calls spent, a data-only result composes without a call: the fixed fallback line, never Done.", async () => {
    const turn = await composeTurn(input([searchOutcome()], { budget: { spent: COMPOSER_MAX_CALLS } }), scripted("never called"));
    expect(turn).toMatchObject({ mode: "direct", model_calls: 0, budget_spent: true, reply: { text: COMPOSE_FALLBACK_LINE } });
    expect(turn.reply.text).not.toBe("Done.");
    expect(seenMessages).toEqual([]);
    expect(composedLog(turn)).toBe("direct calls=0 budget=spent");
  });

  test("with the budget spent and a reply among the outcomes, the ordered direct replies and failure messages stand", async () => {
    const turn = await composeTurn(input([failedOutcome("I couldn't look that up."), weatherOutcome(), searchOutcome()], { budget: { spent: 2 } }), scripted("never called"));
    expect(turn.reply.text).toBe("I couldn't look that up. It's 61 degrees and clear in Lantern Bay.");
    expect(turn.budget_spent).toBe(true);
  });

  test("one call under the cap composes; at the cap it does not", () => {
    expect(planComposition(input([searchOutcome()], { budget: { spent: 1 } })).mode).toBe("composition");
    expect(planComposition(input([searchOutcome()], { budget: { spent: 0 } })).mode).toBe("composition");
    expect(planComposition(input([searchOutcome()], { budget: { spent: 2 } })).mode).toBe("direct");
  });
});

describe("a composition that fails", () => {
  test("the model erroring falls back to the ordered direct replies", async () => {
    const turn = await composeTurn(input([weatherOutcome(), searchOutcome()]), scripted(null, false));
    expect(turn).toMatchObject({ mode: "composition", model_calls: 1, fell_back: true, reply: { text: "It's 61 degrees and clear in Lantern Bay." } });
    expect(composedLog(turn)).toBe("composition calls=1 fallback");
  });

  test("an empty reply, or a think block alone, falls back; a data-only result then says the fixed line", async () => {
    expect((await composeTurn(input([searchOutcome()]), scripted(""))).reply.text).toBe(COMPOSE_FALLBACK_LINE);
    expect((await composeTurn(input([searchOutcome()]), scripted("   "))).reply.text).toBe(COMPOSE_FALLBACK_LINE);
    const thought = await composeTurn(input([searchOutcome()]), scripted("<think>the rows say a keeper</think>"));
    expect(thought.fell_back).toBe(true);
    expect(thought.reply.text).toBe(COMPOSE_FALLBACK_LINE);
  });

  test("a reply that needs the boundary's repair is repaired in place (OUT-01's rule), not dropped", async () => {
    const turn = await composeTurn(input([searchOutcome()]), scripted("it follows a lighthouse keeper on a rock through one winter"));
    expect(turn.fell_back).toBeUndefined();
    expect(turn.reply.text).toBe("it follows a lighthouse keeper on a rock through one winter.");
  });
});

describe("the constraints and the shape", () => {
  test("a list shape renders result rows, capped at five with a remainder line", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ title: `Track ${i + 1}` }));
    const result = await composeTurn(input([outcome({ callId: "call-list", packageId: "websearch", status: "succeeded", result: { actions: [], data: { rows } } })], { constraints: [{ kind: "shape", value: "list" }] }), scripted("ignored"));
    expect(result.reply.text).toBe("Track 1\nTrack 2\nTrack 3\nTrack 4\nTrack 5\nand 2 more");
  });

  test("a number shape renders the number alone", async () => {
    const result = await composeTurn(input([outcome({ callId: "call-number", packageId: "almanac", status: "succeeded", result: { actions: [], data: { number: 7 } } })], { constraints: [{ kind: "shape", value: "number" }] }), scripted("ignored"));
    expect(result.reply.text).toBe("7");
  });

  test("one_line shape removes line breaks", async () => {
    const result = await composeTurn(input([weatherOutcome()], { constraints: [{ kind: "shape", value: "one_line" }] }), scripted("ignored"));
    expect(result.reply.text).not.toContain("\n");
  });

  test("an explicit list shape yields to the sentence budget", async () => {
    const result = await composeTurn(input([outcome({ callId: "call-list", packageId: "websearch", status: "succeeded", result: { actions: [], data: { rows: [{ title: "One" }, { title: "Two" }] } } })], { constraints: [{ kind: "shape", value: "list" }, { kind: "length", value: "1" }] }), scripted("ignored"));
    expect(result.reply.text).toBe("One\nTwo");
  });

  test("CONS-01's constraints are one line of the instruction, and the shape rides on the composed turn for K4", async () => {
    const constraints = [
      { kind: "shape" as const, value: "list" },
      { kind: "length" as const, value: "120" },
      { kind: "banned_phrase" as const, value: "great question" },
      { kind: "banned_phrase" as const, value: "certainly" },
    ];
    expect(constraintsLine(constraints)).toBe('Answer as a list of up to five items. Keep it under 120 characters. Never say: "great question", "certainly".');
    expect(constraintsLine([{ kind: "shape", value: "number" }])).toBe("Answer with the number only.");
    expect(constraintsLine([{ kind: "shape", value: "one_line" }])).toBe("Answer in one line.");
    expect(constraintsLine([])).toBe("");
    const turn = await composeTurn(input([searchOutcome()], { constraints }), scripted("One winter, one keeper, one rock."));
    expect(turn.shape).toBe("list");
    expect(seenMessages[seenMessages.length - 1]!.content).toContain('Never say: "great question", "certainly".');
    const direct = await composeTurn(input([weatherOutcome()], { constraints: [{ kind: "shape", value: "number" }] }), scripted("never called"));
    expect(direct.shape).toBe("number");
  });

  test("a direct route's composition names the question the search answered, since the person's last message was a consent word or a who-answer", () => {
    const consent = outcome({ callId: "t:lookup", packageId: "websearch", status: "succeeded", via: "ask", args: { expression: "rivet 3 used price" }, result: { actions: [], data: { rows: ROWS, query: "rivet 3 used price" }, synthesis_hint: "answer from these results" } });
    expect(questionOf([consent])).toBe("rivet 3 used price");
    expect(questionOf([weatherOutcome()])).toBeNull();
    const asked = planComposition(input([searchOutcome()]));
    if (asked.mode !== "composition") throw new Error("expected a composition");
    expect(asked.messages[asked.messages.length - 1]!.content).toContain("Answer what I just asked");
    const plan = planComposition(input([consent], { question: questionOf([consent]) }));
    if (plan.mode !== "composition") throw new Error("expected a composition");
    expect(plan.messages[plan.messages.length - 1]!.content).toContain('Answer this question of mine from the tool results above, in one to three sentences, in your own voice: "rivet 3 used price".');
  });

  test("the instruction: the child band's line, ACT-03's forbidden repeat, the hints", () => {
    const line = compositionInstruction({ ageBand: "child", moves: { repeat: "forbidden" } }, ["answer from these results"]);
    expect(line).toContain("for a child");
    expect(line).toContain("never repeat what you said before");
    expect(line).toContain("Hint: answer from these results.");
    expect(compositionInstruction({ ageBand: "adult" }, [])).not.toContain("Hint:");
  });
});

describe("typed date relations", () => {
  const clock = new Date("2026-09-15T12:00:00.000Z");
  const dateOutcome = (date: string) => outcome({ callId: "call-date", packageId: "almanac-date", status: "succeeded", result: { actions: [], data: { date } } });

  test("today and tomorrow use relative words", async () => {
    const today = await composeTurn(input([dateOutcome("2026-09-15")], { now: clock, messages: [{ role: "user", content: "when is it" }] }), scripted("The date is September 15."));
    const tomorrow = await composeTurn(input([dateOutcome("2026-09-16")], { now: clock, messages: [{ role: "user", content: "when is it" }] }), scripted("The date is September 16."));
    expect(today.reply.text).toContain("today");
    expect(tomorrow.reply.text).toContain("tomorrow");
  });

  test("a date six weeks out stays a calendar date", async () => {
    const turn = await composeTurn(input([dateOutcome("2026-10-27")], { now: clock, messages: [{ role: "user", content: "when is it" }] }), scripted("The date is October 27."));
    expect(turn.reply.text).toContain("October 27");
  });
});

describe("COMP-01 typed document builders", () => {
  const source = (id: string, title: string) => ({
    id,
    kind: "package" as const,
    title,
    url: `https://example.com/${id}`,
    site: "example.com",
    snippet: `${title} source`,
    source: "turn-document123",
    created_at: "2026-09-16T12:00:00.000Z",
    hlc: "1789550400000:0:hub001",
  });
  const typedOutcome = (data: Record<string, unknown>, id = "src-document123", args: Record<string, unknown> = { topic: "document example" }) => outcome({
    callId: `call-${id}`,
    packageId: "typed-package",
    status: "succeeded",
    args,
    result: { actions: [], data },
    sources: [source(id, "Document source")],
  });

  test("a lookup outcome becomes a source-backed results section", () => {
    const document = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({ query: "Willow hours", rows: [{ title: "Willow visitor center", snippet: "Opens at 8 a.m. on Saturdays." }] })] });
    expect(document?.section).toMatchObject({ type: "lookup", query: "Willow hours", results: [{ title: "Willow visitor center", line: "Opens at 8 a.m. on Saturdays.", source_id: "src-document123" }] });
  });

  test("a typed source outcome becomes a card section", () => {
    const document = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({ kind: "film", title: "Bramble Moon", year: 2024, director: "Quill Arden", genres: ["adventure"] })] });
    expect(document?.section).toEqual({ type: "card", kind: "film", name: "Bramble Moon", year: 2024, director: "Quill Arden", genres: ["adventure"], source_id: "src-document123" });
  });

  test("a typed outcome's singular source is promoted to the document citation list", () => {
    const document = buildDocument({ turnId: "turn-document123", outcomes: [outcome({
      callId: "call-singular",
      packageId: "typed-package",
      status: "succeeded",
      source: { kind: "web", title: "Person source", url: "https://example.com/person", site: "example.com", snippet: "A source-backed person." },
      result: { actions: [], data: { kind: "person", name: "Quill Arden", occupation: "Director", known_for: ["Bramble Moon"] } },
    })] });
    expect(document?.sources).toHaveLength(1);
    expect(document?.section).toMatchObject({ type: "card", kind: "person", name: "Quill Arden" });
  });

  test("a procedure outcome retains ordered instructions and quantities", () => {
    const document = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({ title: "Herb plan", steps: [{ position: 1, instruction: "Fill the pot.", quantities: [{ amount: 30, unit: "centimeters", item: "pot" }] }] })] });
    expect(document?.section).toEqual({ type: "procedure", title: "Herb plan", steps: [{ position: 1, instruction: "Fill the pot.", quantities: [{ amount: 30, unit: "centimeters", item: "pot" }] }] });
  });

  test("a comparison outcome becomes a typed table", () => {
    const document = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({ title: "Bike comparison", subjects: [{ id: "subject-alpha123", name: "Ember" }, { id: "subject-bravo123", name: "River" }], rows: [{ attribute: "range", values: [{ subject_id: "subject-alpha123", value: "45 km" }, { subject_id: "subject-bravo123", value: "60 km" }] }] })] });
    expect(document?.section).toMatchObject({ type: "comparison", title: "Bike comparison", subjects: [{ id: "subject-alpha123", name: "Ember" }, { id: "subject-bravo123", name: "River" }], rows: [{ attribute: "range" }] });
  });

  test("a document outcome becomes bounded page chunks with local citations", () => {
    const document = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({
      type: "document",
      attachment_id: "att-document123",
      chunks: [
        { attachment_id: "att-document123", page: 1, text: "The first page says hello." },
        { attachment_id: "att-document123", page: 3, text: "Page three explains the safe temperature." },
      ],
    })] });
    expect(document?.section).toMatchObject({
      type: "document",
      attachment_id: "att-document123",
      chunks: [
        { attachment_id: "att-document123", page: 1, text: "The first page says hello." },
        { attachment_id: "att-document123", page: 3, text: "Page three explains the safe temperature." },
      ],
    });
    expect(document?.sources.map((source) => source.url)).toEqual([
      "attachment://att-document123/page/1",
      "attachment://att-document123/page/3",
    ]);
  });

  test("a page request selects only that document page and the bounded context is retained", () => {
    const chunks = Array.from({ length: 40 }, (_, index) => ({ attachment_id: "att-document123", page: index + 1, text: "x".repeat(4001) }));
    const document = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({ type: "document", attachment_id: "att-document123", chunks }, "src-document456", { topic: "document example" })] });
    expect(document?.section.type).toBe("document");
    if (!document || document.section.type !== "document") throw new Error("expected a document section");
    expect(document.section.chunks).toHaveLength(8);
    expect(document.section.chunks.every((chunk: { text: string }) => chunk.text.length === 4000)).toBe(true);
    expect(document.section.chunks.reduce((total: number, chunk: { text: string }) => total + chunk.text.length, 0)).toBeLessThanOrEqual(32000);

    const page = buildDocument({ turnId: "turn-document456", outcomes: [typedOutcome({ type: "document", attachment_id: "att-document123", chunks }, "src-document789", { page: 3 })] });
    expect(page?.section).toMatchObject({ type: "document", chunks: [{ page: 3 }] });
  });

  test("a document page request uses the same evidence revision path", () => {
    const base = { type: "document", attachment_id: "att-document123", chunks: [{ attachment_id: "att-document123", page: 3, text: "The first retained answer." }] };
    const first = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome(base)] });
    if (!first) throw new Error("expected the first document");
    const same = buildDocument({ turnId: "turn-document456", previous: first, outcomes: [typedOutcome({ ...base, chunks: [{ ...base.chunks[0], text: "The first retained answer." }] })] });
    expect(same?.id).toBe(first.id);
    const changed = buildDocument({ turnId: "turn-document789", previous: first, outcomes: [typedOutcome({ ...base, chunks: [{ ...base.chunks[0], text: "A changed retained answer." }] })] });
    expect(changed?.revision).toBe(2);
    expect(changed?.section).toMatchObject({ type: "document", chunks: [{ page: 3, text: "A changed retained answer." }] });
  });

  test("chit-chat and reply-only outcomes produce no document", () => {
    expect(buildDocument({ turnId: "turn-document123", outcomes: [weatherOutcome()] })).toBeNull();
    expect(documentEvidenceVersion([])).toMatch(/^outcome-[a-f0-9]{16}$/);
  });

  test("the child projection keeps typed content but strips every source link", () => {
    const document = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({ query: "Willow hours", rows: [{ title: "Willow visitor center", snippet: "Opens at 8 a.m. on Saturdays." }] })] });
    if (!document) throw new Error("expected a document");
    const child = projectDocumentForChild(document);
    if (!child) throw new Error("expected a child projection");
    expect(child.sources).toEqual([]);
    expect(child.section).toEqual({ type: "lookup", query: "Willow hours", results: [{ title: "Willow visitor center", line: "Opens at 8 a.m. on Saturdays." }] });
  });

  test("the child projection does not deliver an attachment document", () => {
    const document = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({ type: "document", attachment_id: "att-document123", chunks: [{ attachment_id: "att-document123", page: 3, text: "Adult document text." }] })] });
    if (!document) throw new Error("expected a document");
    expect(projectDocumentForChild(document)).toBeNull();
  });

  test("changed retained evidence creates a new revision", () => {
    const first = buildDocument({ turnId: "turn-document123", outcomes: [typedOutcome({ query: "Willow hours", rows: [{ title: "Willow visitor center", snippet: "Opens at 8 a.m." }] })] });
    if (!first) throw new Error("expected the first document");
    const second = buildDocument({ turnId: "turn-document456", previous: first, outcomes: [typedOutcome({ query: "Willow hours", rows: [{ title: "Willow visitor center", snippet: "Opens at 9 a.m." }] })] });
    expect(second?.revision).toBe(2);
    expect(second?.turn_id).toBe("turn-document456");
    expect(second?.evidence_version).not.toBe(first.evidence_version);
    const freshSubject = buildDocument({ turnId: "turn-document789", previous: first, sameSubject: false, outcomes: [typedOutcome({ query: "Different hours", rows: [{ title: "Another visitor center", snippet: "Opens at 10 a.m." }] })] });
    expect(freshSubject?.revision).toBe(1);
  });
});

describe("the grounding", () => {
  test("groundedIn checks titles, years, units, and the person's own words", () => {
    const rows = [{ title: "Marsh Lantern film", url: "https://example.com/marsh-lantern", snippet: "Released in 2026, 12 miles away." }];
    expect(groundedIn("Marsh Lantern film opened in 2026.", rows)).toBeNull();
    expect(groundedIn("Invented Chronicle is the answer.", rows)).toBe("Invented Chronicle");
    expect(groundedIn("Marsh Lantern premiered in 2025.", rows)).toBe("2025");
    expect(groundedIn("Marsh Lantern is my favorite.", rows, "Marsh Lantern")).toBeNull();
    expect(groundedIn("Marsh Lantern is 12 miles away.", rows)).toBeNull();
  });

  test("a picture claim needs an attached image", () => {
    const rows = [{ title: "Marsh Lantern film", url: "https://example.com/marsh-lantern", snippet: "The official page." }];
    expect(groundedIn("Here's a picture of Marsh Lantern.", rows)).toBe("Here's a picture");
    expect(groundedIn("Here they are.", rows, "show me pictures of Marsh Lantern")).toBe("Here they are");
    expect(groundedIn("Here's a picture of Marsh Lantern.", rows, "", { kind: "image", url: "https://images.example.com/marsh.jpg" })).toBeNull();
  });

  test("a lookup composition falls back to rows, and an empty lookup never calls the model", async () => {
    const lookup = searchOutcome();
    const fallback = await composeTurn(input([lookup]), scripted("The horse is named Invented Meadow in the Invented Chronicle (2024)."));
    expect(fallback).toMatchObject({ mode: "grounded_fallback", model_calls: 1, ungrounded: "Invented Meadow" });
    expect(fallback.reply.text).toContain("Marsh Lantern (film)");
    expect(fallback.reply.text).not.toContain("Invented Meadow");
    const empty = outcome({ callId: "call-empty", packageId: "websearch", status: "succeeded", args: { expression: "no results fixture" }, result: { actions: [], data: { rows: [], query: "no results fixture" }, synthesis_hint: "answer from these results" } });
    const noRows = await composeTurn(input([empty]), scripted("never called"));
    expect(noRows).toMatchObject({ mode: "empty_rows", model_calls: 0, reply: { text: "The search found nothing on that: no results fixture." } });
    expect(seenMessages).toEqual([]);
  });

  test("a resolution's outcomes join the turn's evidence as package results, once per call, with the rows' titles and snippets as their text", () => {
    const ctx = { evidence: [], includedEvidenceIds: [] } as unknown as TurnContext;
    expect(outcomeText(searchOutcome())).toBe("Marsh Lantern (film) A lighthouse keeper on a rock through one winter. query: marsh lantern film");
    expect(outcomeText(weatherOutcome())).toBe("It's 61 degrees and clear in Lantern Bay. temperature: 61");
    groundOutcomes(ctx, [searchOutcome(), failedOutcome("I couldn't look that up."), weatherOutcome()]);
    groundOutcomes(ctx, [searchOutcome()]);
    expect(ctx.evidence.map((e) => [e.id, e.kind])).toEqual([["package:call-s", "package_result"], ["package:call-w", "package_result"]]);
    expect(ctx.includedEvidenceIds).toEqual(["package:call-s", "package:call-w"]);
  });

  test("a document outcome grounds its bounded page text", () => {
    const document = outcome({ callId: "call-document", packageId: "documents", status: "succeeded", result: { actions: [], data: { type: "document", attachment_id: "att-document123", chunks: [{ attachment_id: "att-document123", page: 3, text: "Page three says the valve is closed." }] } } });
    expect(outcomeText(document)).toContain("Page three says the valve is closed.");
  });

  test("a composed line that says what the rows say passes the invention guard, and is never an unrelated-recall candidate; ungrounded it is cut (the review's repro)", async () => {
    const { guardReply } = await import("@/lib/guards");
    const { guardContextFrom, intentFor } = await import("@/lib/turnContext");
    const { classifyTurnSignal } = await import("@/lib/turnSignal");
    const utterance = "who's the horse in the old Lantern Bay cartoon";
    const signal = classifyTurnSignal({ text: utterance, ageBand: "adult" });
    const rows = [{ title: "Lantern Bay (cartoon): Marlow", url: "https://example.com/lantern-bay", snippet: "Marlow the plough horse lives on the Quill farm near the bay." }];
    const search = outcome({ callId: "t:ladder", packageId: "websearch", status: "succeeded", via: "forced", args: { expression: "lantern bay cartoon horse" }, result: { actions: [], data: { rows, query: "lantern bay cartoon horse" }, synthesis_hint: "answer from these results" } });
    const ctx: TurnContext = { turnId: "t", conversationId: "c", actorId: "p", surface: "chat", utterance, history: [], evidence: [], includedEvidenceIds: [], offeredToolIds: ["websearch"], outcomes: [search], intent: intentFor(utterance, signal), persona: { id: "d", displayName: "MaiPai", examples: [] }, ageBand: "adult", now: new Date(), locale: "en-US", roster: ["Sage"], signal, subjects: [], subjectPronouns: [] };
    const composed = "He lives on the Quill farm near the bay, a plough horse.";
    expect(guardReply(composed, { ...guardContextFrom(ctx), personId: "p" })).toMatchObject({ reason: "invention", replaced: true });
    groundOutcomes(ctx, [search]);
    const grounded = guardContextFrom(ctx);
    expect(grounded.grounding).toContain(outcomeText(search));
    expect(grounded.sources).toEqual([]);
    expect(guardReply(composed, { ...grounded, personId: "p" })).toMatchObject({ reason: null, reply: composed });
    // A restatement of a row that shares no word with the question is
    // still the search's answer, never a memory line copied to the
    // wrong question.
    expect(guardReply("Marlow the plough horse lives on the Quill farm near the bay.", { ...grounded, personId: "p", utterance: "and the other one?" })).toMatchObject({ reason: null });
    // The standing rule holds for a composition too: a third-party trait
    // is grounded word by word, so a paraphrase whose verb the rows never
    // said ("works as") is cut as on a model turn.
    expect(guardReply("He lives on the Quill farm near the bay and works as a plough horse.", { ...grounded, personId: "p" })).toMatchObject({ reason: "invention" });
  });
});

describe("the tool message", () => {
  test("bounds a wide result: rows capped at eight, long strings cut, the content itself capped", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ title: `Row ${i}`, url: `https://example.com/${i}`, snippet: "x".repeat(2000) }));
    const content = toolResultContent(outcome({ callId: "c", packageId: "websearch", status: "succeeded", result: { actions: [], data: { rows } } }));
    const parsed = JSON.parse(content.replace(/…"}$/, "")) as { data: { rows: { snippet: string }[] } };
    expect(parsed.data.rows.length).toBe(8);
    expect(parsed.data.rows[0]!.snippet.length).toBeLessThanOrEqual(601);
    expect(content.length).toBeLessThanOrEqual(6003);
  });

  test("a failed outcome says its household-safe line, never a diagnostic; a pending one says what it asked", () => {
    expect(JSON.parse(toolResultContent(failedOutcome()))).toEqual({ status: "failed", package: "knowledge", error: "not_found" });
    expect(JSON.parse(toolResultContent(outcome({ callId: "p", packageId: "lights", status: "pending", userMessage: "All of them?" })))).toEqual({ status: "pending", package: "lights", asked: "All of them?" });
  });
});

describe("K6: the machine", () => {
  test("the phases run deciding, executing, composing, finished; a terminal phase stays", () => {
    const machine = new TurnMachine();
    expect(machine.phase).toBe("deciding");
    machine.enter("executing");
    machine.enter("composing");
    machine.enter("finished");
    expect(machine.trail).toEqual(["deciding", "executing", "composing", "finished"]);
    machine.enter("composing");
    expect(machine.phase).toBe("finished");
    expect(machine.done).toBe(true);
  });

  test("the abort cancels from any phase, and a finished turn is not cancelled after the fact", () => {
    const controller = new AbortController();
    const machine = new TurnMachine(controller.signal);
    machine.enter("composing");
    controller.abort();
    expect(machine.phase).toBe("cancelled");
    expect(machine.done).toBe(true);
    const finished = new TurnMachine(new AbortController().signal);
    finished.enter("finished");
    finished.cancel();
    expect(finished.phase).toBe("finished");
    const already = new AbortController();
    already.abort();
    expect(new TurnMachine(already.signal).phase).toBe("cancelled");
  });
});

// The engine: a two-outcome turn composed in one call on both paths,
// the native tool messages seen by the stub in order.
describe("the engine composes a two-outcome turn in one call", () => {
  beforeEach(() => {
    resetDb();
    __resetThrottleForTests();
    __resetLlmSupervisorForTests();
  });
  afterEach(() => {
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  });

  async function owner() {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    return { client, actor };
  }

  const COMPOSED = "Saved that, and Friday is pizza night.";

  async function withTwoCalls<T>(fn: (stub: { requests: () => ChatCompletionRequest[] }) => Promise<T>): Promise<T> {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedToolCalls: (request) => {
        if (!request.tools || request.tools.length === 0 || request.messages.some((m) => m.role === "tool")) return undefined;
        return [
          { id: "call-1", type: "function", function: { name: "remember", arguments: JSON.stringify({ fact: "the wifi password is on the fridge" }) } },
          { id: "call-2", type: "function", function: { name: "recall", arguments: JSON.stringify({ topic: "pizza night" }) } },
        ];
      },
      scriptedChatReply: (request) => (request.messages.some((m) => m.role === "tool") ? COMPOSED : "Sure."),
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn(stub);
    } finally {
      await stub.stop();
    }
  }

  const composition = (requests: ChatCompletionRequest[]) => requests.filter((r) => r.messages.some((m) => m.role === "tool"));

  function expectNativeToolMessages(request: ChatCompletionRequest) {
    const messages = request.messages;
    const assistantAt = messages.findIndex((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0);
    expect(assistantAt).toBeGreaterThan(0);
    expect(messages[assistantAt]!.tool_calls?.map((c) => [c.id, c.function.name])).toEqual([["call-1", "remember"], ["call-2", "recall"]]);
    expect(messages.slice(assistantAt + 1, assistantAt + 3).map((m) => [m.role, m.tool_call_id])).toEqual([["tool", "call-1"], ["tool", "call-2"]]);
    expect(messages[messages.length - 1]!.role).toBe("user");
    expect(messages[messages.length - 1]!.content).toContain("one to three sentences");
    expect(request.tools).toBeUndefined();
    const recalled = JSON.parse(messages[assistantAt + 2]!.content) as { reply?: string };
    expect(recalled.reply).toContain("pizza night");
  }

  const turnLine = (lines: string[]) => lines.filter((l) => l.startsWith("[turn] {")).map((l) => JSON.parse(l.slice(7)) as { composed?: string; phase?: string; outcomes?: { package: string }[] }).at(-1)!;

  function captureLog(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
      original(...args);
    };
    return { lines, restore: () => (console.log = original) };
  }

  test("runTurn(): remember and recall run, one composition phrases both, the stub saw the retained ids and the tool messages in order, the turn line says so", async () => {
    const { actor } = await owner();
    expect(remember(actor, { text: "Friday is pizza night", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.8 }).ok).toBe(true);
    const log = captureLog();
    try {
      await withTwoCalls(async (stub) => {
        const result = await runTurn(actor, "chat", "our wifi password is on the fridge, please remember this, and what night is pizza night");
        if (!result.ok) throw new Error(result.error);
        expect(result.value.source).toBe("plugin");
        expect(result.value.plugin_id).toBe("remember+recall");
        expect(result.value.reply.text).toBe(COMPOSED);
        expect(stub.requests().length).toBe(2);
        expect(composition(stub.requests()).length).toBe(1);
        expectNativeToolMessages(composition(stub.requests())[0]!);
        const row = db.select({ outcomes: conversationTurns.outcomes }).from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
        expect((JSON.parse(row!.outcomes!) as { packageId: string; status: string }[]).map((o) => [o.packageId, o.status])).toEqual([["remember", "succeeded"], ["recall", "succeeded"]]);
      });
    } finally {
      log.restore();
    }
    expect(turnLine(log.lines)).toMatchObject({ composed: "composition calls=1", phase: "finished" });
  });

  test("runTurnStream(): the same turn streams the composition's deltas after a composing status, the done value is the package's, one composition call", async () => {
    const { actor } = await owner();
    expect(remember(actor, { text: "Friday is pizza night", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.8 }).ok).toBe(true);
    const log = captureLog();
    try {
      await withTwoCalls(async (stub) => {
        const result = await runTurnStream(actor, "chat", "our wifi password is on the fridge, please remember this, and what night is pizza night");
        if (!result.ok) throw new Error(result.error);
        expect(result.kind).toBe("stream");
        if (result.kind !== "stream") return;
        const statuses: string[] = [];
        const drainStatus = async () => { const s = await result.status.next(); if (s) statuses.push(s.stage); };
        const iterator = result.tokens[Symbol.asyncIterator]();
        const deltas: string[] = [];
        let step = await iterator.next();
        while (!step.done) {
          deltas.push(step.value);
          step = await iterator.next();
        }
        await drainStatus();
        await drainStatus();
        const value = result.finalize(deltas.join("").trim(), step.value);
        expect(statuses).toEqual(["tool", "composing"]);
        expect(deltas.join("").trim()).toBe(COMPOSED);
        expect(value.source).toBe("plugin");
        expect(value.plugin_id).toBe("remember+recall");
        expect(value.reply.text).toBe(COMPOSED);
        expect(composition(stub.requests()).length).toBe(1);
        expectNativeToolMessages(composition(stub.requests())[0]!);
      });
    } finally {
      log.restore();
    }
    expect(turnLine(log.lines)).toMatchObject({ composed: "composition calls=1", phase: "finished" });
  });

  test("a composed search answer is grounded by its rows: a person-trait line the invention guard would cut on a model turn reaches the person, on both paths, on the direct route", async () => {
    const { actor } = await owner();
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    const COMPOSED_TRAIT = "He lives on the Quill farm near the bay, a plough horse.";
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => (request.messages.some((m) => m.role === "tool") ? COMPOSED_TRAIT : "Sure."),
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    const searxng = Bun.serve({ port: 0, fetch: () => Response.json({ results: [{ title: "Lantern Bay (cartoon): Marlow", url: "https://example.com/lantern-bay", content: "Marlow the plough horse lives on the Quill farm near the bay." }] }) });
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
    const log = captureLog();
    try {
      const result = await runTurn(actor, "chat", "search the web for the horse in the old Lantern Bay cartoon");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.source).toBe("plugin");
      expect(result.value.plugin_id).toBe("websearch");
      expect(result.value.reply.text).toBe(COMPOSED_TRAIT);
      expect(result.value.sources?.length).toBe(1);
      expect(stub.requests().length).toBe(1);
      // The direct route's instruction names the question the search
      // answered: the pattern's own capture, never "what I just asked".
      expect(stub.requests()[0]!.messages[stub.requests()[0]!.messages.length - 1]!.content).toContain('Answer this question of mine from the tool results above, in one to three sentences, in your own voice: "the horse in the old Lantern Bay cartoon".');
      expect(turnLine(log.lines)).toMatchObject({ composed: "composition calls=1 ids=synthetic", phase: "finished" });
      const streamed = await runTurnStream(actor, "chat", "search the web for the horse in the old Lantern Bay cartoon");
      if (!streamed.ok || streamed.kind !== "stream") throw new Error("expected a stream");
      const iterator = streamed.tokens[Symbol.asyncIterator]();
      let step = await iterator.next();
      const deltas: string[] = [];
      while (!step.done) { deltas.push(step.value); step = await iterator.next(); }
      const value = streamed.finalize(deltas.join("").trim(), step.value);
      expect(value.reply.text).toBe(COMPOSED_TRAIT);
      expect(value.plugin_id).toBe("websearch");
      expect(value.sources?.length).toBe(1);
      expect(turnLine(log.lines)).toMatchObject({ composed: "composition calls=1 ids=synthetic" });
    } finally {
      log.restore();
      await stub.stop();
      searxng.stop(true);
    }
  });

  test("a streamed lookup holds invented sentences and delivers the rows instead", async () => {
    const { actor } = await owner();
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, { scriptedChatReply: (request) => request.messages.some((message) => message.role === "tool") ? "The horse is named Invented Meadow in the Invented Chronicle (2024)." : "Sure." });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    const searxng = Bun.serve({ port: 0, fetch: () => Response.json({ results: [{ title: "Lantern Bay (cartoon)", url: "https://example.com/lantern-bay", content: "The old Lantern Bay cartoon's horse is called Copper." }] }) });
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
    const log = captureLog();
    try {
      const streamed = await runTurnStream(actor, "chat", "search the web for the horse in the old Lantern Bay cartoon");
      if (!streamed.ok || streamed.kind !== "stream") throw new Error("expected a stream");
      const iterator = streamed.tokens[Symbol.asyncIterator]();
      const deltas: string[] = [];
      let step = await iterator.next();
      while (!step.done) { deltas.push(step.value); step = await iterator.next(); }
      const value = streamed.finalize(deltas.join("").trim(), step.value);
      expect(value.reply.text).toContain("Copper");
      expect(value.reply.text).not.toContain("Invented Meadow");
      expect(log.lines.some((line) => line.includes('"composed":"grounded_fallback calls=1') && line.includes('"ungrounded":"Invented Meadow"'))).toBe(true);
    } finally {
      log.restore();
      await stub.stop();
      searxng.stop(true);
    }
  });

  test("a single succeeded call with its own reply is delivered direct, no composition call, on both paths", async () => {
    const { actor } = await owner();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedToolCalls: (request) => (request.tools && request.tools.length > 0 && !request.messages.some((m) => m.role === "tool") ? [{ id: "call-1", type: "function", function: { name: "remember", arguments: JSON.stringify({ fact: "Friday is pizza night" }) } }] : undefined),
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    const log = captureLog();
    try {
      const result = await runTurn(actor, "chat", "Friday is pizza night, can you remember that for me");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.plugin_id).toBe("remember");
      expect(stub.requests().length).toBe(1);
      expect(turnLine(log.lines)).toMatchObject({ composed: "direct calls=0" });
      const streamed = await runTurnStream(actor, "chat", "Friday is pizza night, can you remember that for me");
      if (!streamed.ok || streamed.kind !== "stream") throw new Error("expected a stream");
      const iterator = streamed.tokens[Symbol.asyncIterator]();
      let step = await iterator.next();
      const deltas: string[] = [];
      while (!step.done) { deltas.push(step.value); step = await iterator.next(); }
      expect(deltas).toEqual([]);
      expect(step.value && "resolved" in step.value).toBe(true);
      streamed.finalize("", step.value);
      expect(stub.requests().length).toBe(2);
      expect(turnLine(log.lines)).toMatchObject({ composed: "direct calls=0" });
    } finally {
      log.restore();
      await stub.stop();
    }
  });
});

describe("structuredPartForOutcomes", () => {
  const fullWeatherOutcome = () =>
    outcome({
      callId: "call-w",
      packageId: "weather",
      status: "succeeded",
      args: { place: "Lantern Bay" },
      result: { actions: [], reply: { text: "It's 61 degrees and clear in Lantern Bay." }, data: { place: "Lantern Bay", temperature: 61, conditions: "clear", high: 68, low: 54, precipitation_chance: 10, unit: "fahrenheit" } },
    });

  test("weather maps onto a spec-sheet part, one row per known fact", () => {
    const part = structuredPartForOutcomes([fullWeatherOutcome()]);
    expect(part).toEqual({
      kind: "spec_sheet",
      tool_id: "weather",
      title: "Lantern Bay",
      rows: [
        { label: "Temperature", value: "61°F" },
        { label: "Conditions", value: "clear" },
        { label: "High", value: "68°F" },
        { label: "Low", value: "54°F" },
        { label: "Chance of rain", value: "10%" },
      ],
    });
  });

  test("almanac-date maps onto a spec-sheet part", () => {
    const almanacOutcome = outcome({ callId: "call-a", packageId: "almanac-date", status: "succeeded", args: {}, result: { actions: [], reply: { text: "Today is Thursday, January 1, 2026." }, data: { date: "Thursday, January 1, 2026", weekday: "Thursday" } } });
    expect(structuredPartForOutcomes([almanacOutcome])).toEqual({
      kind: "spec_sheet",
      tool_id: "almanac-date",
      title: "Today",
      rows: [
        { label: "Date", value: "Thursday, January 1, 2026" },
        { label: "Day of week", value: "Thursday" },
      ],
    });
  });

  test("a producer with no mapping yet yields no structured part, not an error", () => {
    expect(structuredPartForOutcomes([searchOutcome()])).toBeNull();
  });

  test("no succeeded outcomes yields no structured part", () => {
    expect(structuredPartForOutcomes([failedOutcome("I couldn't look that up.")])).toBeNull();
  });

  test("the first known producer wins when several outcomes succeeded", () => {
    const part = structuredPartForOutcomes([searchOutcome(), fullWeatherOutcome()]);
    expect(part?.kind).toBe("spec_sheet");
    expect((part as { title: string }).title).toBe("Lantern Bay");
  });
});

// ARTIFACT-02: TurnValue.artifact's own writer - a sibling reducer to
// structuredPartForOutcomes() above, not a case folded into it (they're
// different wire fields). A review of this item's first pass found
// wire.ts's own "No writer yet" comment on TurnValue.artifact still
// true after the recipe/host layer landed: this function, and
// turnEngine.ts's own one-line hookup beside structured_part, are what
// closes that gap - covered here since logTurnSafely() itself isn't
// practically unit-testable in isolation.
describe("artifactForOutcomes", () => {
  const writeDocumentOutcome = (data: Record<string, unknown>) =>
    outcome({
      callId: "call-d",
      packageId: "write_document",
      status: "succeeded",
      args: { title: "Packing list", kind: "markdown", body: "- tent" },
      result: { actions: [], reply: { text: 'Here\'s "Packing list".' }, data },
    });

  test("a succeeded write_document outcome maps onto {id, version}", () => {
    expect(artifactForOutcomes([writeDocumentOutcome({ artifact_id: "art-abc123", artifact_version: 1 })])).toEqual({
      id: "art-abc123",
      version: 1,
    });
  });

  test("a producer with no mapping yields no artifact, not an error", () => {
    expect(artifactForOutcomes([searchOutcome()])).toBeNull();
  });

  test("no succeeded outcomes yields no artifact", () => {
    expect(artifactForOutcomes([failedOutcome("I couldn't save that.")])).toBeNull();
  });

  test("a malformed data shape (missing or wrong-typed fields) yields no artifact, not a throw", () => {
    expect(artifactForOutcomes([writeDocumentOutcome({ artifact_id: "art-abc123" })])).toBeNull();
    expect(artifactForOutcomes([writeDocumentOutcome({ artifact_id: 42, artifact_version: 1 })])).toBeNull();
  });

  test("the first known producer wins when several outcomes succeeded", () => {
    const result = artifactForOutcomes([searchOutcome(), writeDocumentOutcome({ artifact_id: "art-first01", artifact_version: 1 }), writeDocumentOutcome({ artifact_id: "art-second1", artifact_version: 2 })]);
    expect(result).toEqual({ id: "art-first01", version: 1 });
  });
});
