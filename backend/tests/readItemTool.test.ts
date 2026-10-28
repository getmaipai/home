// NEWS-DISCUSS-TOOL-2026-10-27: the chat's read_item tool: references, the reader's band floors, the policy refusal and the offer gate.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { addBenchTeen, createBenchPeople } from "../scripts/bench/conversationRunner";
import { itemRefsIn, READ_ITEM_TOOL_ID, runReadItemTool } from "@/lib/items/tool";
import { DISCUSS_MAX_CHARS } from "@/lib/news/discuss";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { resolveTurnBudget, withTurnToolGates } from "@/lib/turnMachine/budget";
import type { TurnState } from "@/lib/turnMachine/contract";
import { installNewsApp, removeNewsApp, resetNewsState, seedFeeds, putItem, ADULT_HOST } from "./support/newsFixture";

const body = "The park opened for families today. Volunteers planted trees near the paths. ".repeat(120);
let people: ReturnType<typeof createBenchPeople>;
let storyId: string;
beforeEach(() => {
  resetDb(); resetNewsState(); installNewsApp(); people = createBenchPeople(); addBenchTeen(people);
  const item = putItem(seedFeeds().household, ADULT_HOST);
  for (const band of ["teen", "adult"] as const) sharedShelfStore()!.putContent(item.id, band, { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: body }] }], source: "fetched", reading_s: 60, fetched_at: new Date().toISOString() });
  storyId = item.id;
});
afterEach(() => removeNewsApp());
const refOf = (id: string) => `maipai://news/story/${id}`;

describe("references", () => {
  test("only a kind with a reader counts, once each", () => {
    const text = `Read ${refOf("news-abc123")} and ${refOf("news-abc123")} and maipai://weather/day/today then maipai://news/story/news-zzz999.`;
    expect(itemRefsIn(text).map((r) => r.ref)).toEqual([refOf("news-abc123"), refOf("news-zzz999")]);
    expect(itemRefsIn("no reference here")).toEqual([]);
  });
});

describe("reading", () => {
  test("an adult and a teen get the title, outlet and capped text", async () => {
    for (const person of [people.owner, people.teen!]) {
      const outcome = await runReadItemTool({ actor: person, args: { ref: refOf(storyId) }, callId: "c" });
      expect(outcome.status).toBe("succeeded");
      const text = outcome.result!.reply!.text;
      expect(text).toContain("The park opened for families today.");
      expect(text.length).toBeLessThan(DISCUSS_MAX_CHARS + 400);
    }
  });
  test("a child, a guessed id and a made-up kind read nothing", async () => {
    for (const [actor, ref] of [[people.child, refOf(storyId)], [people.owner, refOf("news-nope0000")], [people.owner, "maipai://secrets/key/x"]] as const) {
      const outcome = await runReadItemTool({ actor, args: { ref }, callId: "c" });
      expect(outcome.status).toBe("failed");
      expect(outcome.errorCode).toBe("item_not_found");
    }
  });
});

describe("policy and offer", () => {
  const stateFor = (actor: TurnState["actor"], utterance: string, allowed: boolean) => ({ actor, surface: "chat", turnId: "t", conversationId: "c", temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance, itemReferenceAllowed: allowed, crisis: false }) as unknown as TurnState;
  const call = (ref: string) => ({ calls: [{ id: "c", tool: READ_ITEM_TOOL_ID, args: { ref } }] });
  test("refused unless offered and the reference is in the person's own message", async () => {
    const ask = `Read this ${refOf(storyId)}`;
    for (const [state, ref] of [[stateFor(people.owner, ask, false), refOf(storyId)], [stateFor(people.owner, ask, true), refOf("news-other000")], [stateFor(people.owner, "no reference", true), refOf(storyId)]] as const) {
      const result = await policyNode(state, call(ref), new AbortController().signal);
      expect(result.output.entries[0]?.decision).toEqual({ allow: false, reason: "item_not_here" });
    }
    const allowed = await policyNode(stateFor(people.owner, ask, true), call(refOf(storyId)), new AbortController().signal);
    expect(allowed.output.entries[0]?.decision.allow).toBe(true);
  });
  test("allowed when the model quotes the reference loosely or passes only the id", async () => {
    const ask = `Read this article and tell me what you think.\n\n${refOf(storyId)}`;
    for (const given of [`"${refOf(storyId)}"`, `${refOf(storyId)}.`, `<${refOf(storyId)}>`, storyId, ` ${refOf(storyId)} `]) {
      const result = await policyNode(stateFor(people.owner, ask, true), call(given), new AbortController().signal);
      expect(result.output.entries[0]?.decision.allow).toBe(true);
      expect(((result.output.entries[0]?.proposal as unknown as { request: { args: { ref: string } } }).request.args.ref)).toBe(refOf(storyId));
    }
  });
  test("offered only when the gate is on", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    expect(withTurnToolGates(base, false).tools_offered).not.toContain(READ_ITEM_TOOL_ID);
    expect(withTurnToolGates(base, false, false, false, false, false, true).tools_offered).toContain(READ_ITEM_TOOL_ID);
  });
});
