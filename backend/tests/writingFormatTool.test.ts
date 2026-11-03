// WRITING-FORMATS-03: the chat's writing_format tool: the offer gate, the cap, the description size, the min_role refusal and the result.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";
import { WRITING_FORMAT_TOOL_ID, __setWritingFormatsForTests, installedWritingFormats, runWritingFormatTool, writingFormatToolSpec } from "@/lib/writingFormats";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { resolveTurnBudget, withTurnToolGates } from "@/lib/turnMachine/budget";
import { budgetWithTurnToolGates } from "@/lib/turnMachine/toolGates";
import { CATALOG } from "@/lib/modelCatalog";
import { countTokens } from "@/lib/tokenCount";
import type { TurnState } from "@/lib/turnMachine/contract";

const MODEL = "qwen3-8b-instruct-q4-k-m";
let people: ReturnType<typeof createBenchPeople>;
beforeEach(() => { resetDb(); people = createBenchPeople(); });
afterEach(() => __setWritingFormatsForTests(null));

const gateInput = (actor: typeof people.owner, band: "adult" | "child", over: Partial<{ bare: boolean; surfaceClass: "written" | "spoken" }> = {}) => ({
  budget: withTurnToolGates(resolveTurnBudget(MODEL, band), false),
  actor, band, surface: "chat" as const, surfaceClass: "written" as const, spoken: false, temporary: false, bare: false, ephemeral: false,
  text: "write a birthday card for my aunt", musicEditAvailable: () => false, ...over,
});

describe("bundled formats", () => {
  test("both catalog formats are installed", () => {
    expect(installedWritingFormats().map((s) => s.manifest.id)).toEqual(["format-birthday-card", "format-email"]);
  });
});

describe("offer", () => {
  test("a written adult turn offers writing_format and calling it returns the format body", async () => {
    const gated = await budgetWithTurnToolGates(gateInput(people.owner, "adult"));
    expect(gated.writingFormatOk).toBe(true);
    expect(gated.budget.tools_offered).toContain(WRITING_FORMAT_TOOL_ID);
    const spec = toolSpecFor(WRITING_FORMAT_TOOL_ID);
    expect(spec?.args).toMatchObject({ properties: { format: { enum: ["format-birthday-card", "format-email"] } } });
    const outcome = runWritingFormatTool({ args: { format: "format-birthday-card" }, callId: "c" });
    expect(outcome.status).toBe("succeeded");
    const text = outcome.result!.reply!.text;
    expect(text).toContain("When writing a birthday card message");
    expect(text).not.toContain("name: format-birthday-card");
  });
  test("with no format installed the tool is absent", async () => {
    __setWritingFormatsForTests([]);
    const gated = await budgetWithTurnToolGates(gateInput(people.owner, "adult"));
    expect(gated.budget.tools_offered).not.toContain(WRITING_FORMAT_TOOL_ID);
  });
  test("a spoken or bare turn does not offer it", async () => {
    for (const over of [{ surfaceClass: "spoken" as const }, { bare: true }]) {
      const gated = await budgetWithTurnToolGates(gateInput(people.owner, "adult", over));
      expect(gated.budget.tools_offered).not.toContain(WRITING_FORMAT_TOOL_ID);
    }
  });
  test("a child turn offers it because the birthday card format fits", async () => {
    const gated = await budgetWithTurnToolGates(gateInput(people.child, "child"));
    expect(gated.budget.tools_offered).toContain(WRITING_FORMAT_TOOL_ID);
  });
  test("an unknown format or a broken args object returns a plain error and no throw", () => {
    for (const args of [{ format: "nope" }, {}, { format: 3 }]) {
      const outcome = runWritingFormatTool({ args: args as Record<string, unknown>, callId: "c" });
      expect(outcome.status).toBe("failed");
      expect(typeof outcome.userMessage === "string" || typeof (outcome as { userMessage?: string }).userMessage === "undefined").toBe(true);
    }
  });
});

describe("cap", () => {
  test("every withTurnToolGates combination stays at or under sixteen and never throws over the cap", () => {
    const base = resolveTurnBudget(MODEL, "adult");
    const bools = [false, true];
    const objects = [null, "track", "band", "album", "style", "none"] as const;
    let walked = 0, withTool = 0;
    for (const a of bools) for (const p of bools) for (const v of bools) for (const m of bools) for (const me of bools) for (const i of bools) for (const mb of bools) for (const ve of bools) for (const wf of bools) for (const o of objects) {
      let offered: string[];
      try { offered = withTurnToolGates(base, a, p, v, m, me, i, mb, ve, o, wf).tools_offered; } catch (error) {
        throw new Error(`combination ${[a, p, v, m, me, i, mb, ve, wf, o].join(",")} threw: ${(error as Error).message}`);
      }
      walked++;
      expect(offered.length).toBeLessThanOrEqual(16);
      if (offered.includes(WRITING_FORMAT_TOOL_ID)) withTool++;
    }
    expect(walked).toBe(2 ** 9 * 6);
    expect(withTool).toBeGreaterThan(0);
  }, 60_000);
  test("writing_format is the first tool to give way when the cap is tight", () => {
    const base = resolveTurnBudget(MODEL, "adult");
    const full = withTurnToolGates(base, true, true, true, true, true, false, false, true, null, true).tools_offered;
    expect(full.length).toBeLessThanOrEqual(16);
    const without = withTurnToolGates(base, true, true, true, true, true, false, false, true, null, false).tools_offered;
    // Everything else offered without the format is still offered with it, unless the format was the one dropped.
    for (const id of without) expect(full).toContain(id);
    // A cap one smaller than the full set drops the format and nothing else.
    const tight = withTurnToolGates({ ...base, max_tools: without.length }, true, true, true, true, true, false, false, true, null, true).tools_offered;
    expect(tight).not.toContain(WRITING_FORMAT_TOOL_ID);
    expect([...tight].sort()).toEqual([...without].sort());
  });
  test("every catalog chat model's base set is unchanged (ten) and the registry carries the gate and bench row", () => {
    const entry = VIRTUAL_TOOL_REGISTRY.find((t) => t.id === WRITING_FORMAT_TOOL_ID)!;
    expect(entry.offer).toMatchObject({ mode: "conditional", gate: "writingFormatAllowed", bench_row: "writing-format" });
    for (const model of CATALOG.filter((m) => m.role === "chat" && m.turn_budget)) {
      expect(resolveTurnBudget(model.id, "adult").tools_offered).not.toContain(WRITING_FORMAT_TOOL_ID);
      expect(resolveTurnBudget(model.id, "adult").tools_offered).toHaveLength(10);
    }
  });
});

describe("description", () => {
  test("lists each format id and stays at or under 600 tokens", async () => {
    const spec = writingFormatToolSpec();
    expect(spec.description).toContain("format-email");
    expect(spec.description).toContain("format-birthday-card");
    const tokens = await countTokens([{ role: "user", content: spec.description }]);
    // countTokens is null when no engine answers; the character estimate (4 per token) then bounds it.
    expect(tokens === null ? spec.description.length / 4 : tokens).toBeLessThanOrEqual(600);
  });
});

describe("policy", () => {
  const stateFor = (actor: TurnState["actor"], allowed: boolean) => ({ actor, surface: "chat", turnId: "t", conversationId: "c", temporary: false, planBasis: { surfaceClass: "written" }, context: [], utterance: "write something", writingFormatAllowed: allowed, crisis: false }) as unknown as TurnState;
  const call = (format: string) => ({ calls: [{ id: "c", tool: WRITING_FORMAT_TOOL_ID, args: { format } }] });
  const decide = async (state: TurnState, format: string) => (await policyNode(state, call(format), new AbortController().signal)).output.entries[0]?.decision;
  test("a child's call for format-email is refused while format-birthday-card works", async () => {
    expect(await decide(stateFor(people.child, true), "format-email")).toEqual({ allow: false, reason: "format_not_here" });
    expect((await decide(stateFor(people.child, true), "format-birthday-card"))?.allow).toBe(true);
    expect((await decide(stateFor(people.owner, true), "format-email"))?.allow).toBe(true);
  });
  test("a call on a turn that was not offered the tool is refused", async () => {
    expect(await decide(stateFor(people.owner, false), "format-email")).toEqual({ allow: false, reason: "format_not_here" });
  });
});
