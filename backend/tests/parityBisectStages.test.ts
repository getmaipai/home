// PARITY-BISECT-01's own scripted acceptance: buildStages() is pure
// (no live call, no setup.ts import-time guard), so it is tested
// directly against a fixed persona/plan/signal/tools, mirroring
// register.test.ts's own fixture style.
import { describe, expect, test } from "bun:test";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { ToolSpec } from "@/lib/llm";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { fallbackSignal } from "@/lib/turnSignal";
import { planFor } from "@/lib/register";
import { buildStages, QUESTION, ENGINE_DEFAULT_TEMPERATURE } from "../scripts/bench/parity-bisect-stages";

const signal: TurnSignal = fallbackSignal(QUESTION, "adult");
const plan = planFor({
  signal,
  surface: "chat",
  surfaceClass: "written",
  brevity: false,
  evidence: { choices: 0, sources: 0, deliverable: false },
  companion: { directness: "direct", engagement: DEFAULT_PERSONA.engagement, complexity: DEFAULT_PERSONA.complexity },
  band: "adult",
  deferred: false,
  disclosureWithheld: false,
});
const TOOLS: ToolSpec[] = [{ id: "websearch", description: "search the web", args: { type: "object", properties: {} } }];

describe("parity-bisect-stages: buildStages()", () => {
  test("one row per stage, in order", () => {
    const stages = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    expect(stages.map((s) => s.name)).toEqual([
      "0a-bare-thinking-on",
      "0b-bare-thinking-off",
      "1-stable-prefix",
      "2-plus-tools",
      "3-plus-volatile",
      "4-merged-system",
      "5-chat-sampling",
      "6-thinking-off-confirm",
    ]);
  });

  test("stage 0a/0b are bare: no system message, engine-default temperature, only thinking differs", () => {
    const [stage0a, stage0b] = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    expect(stage0a!.messages).toEqual([{ role: "user", content: QUESTION }]);
    expect(stage0b!.messages).toEqual([{ role: "user", content: QUESTION }]);
    expect(stage0a!.opts.temperature).toBe(ENGINE_DEFAULT_TEMPERATURE);
    expect(stage0a!.opts.thinking).toBe(true);
    expect(stage0b!.opts.thinking).toBe(false);
  });

  test("stage 1 carries the stable prefix alone, no tools", () => {
    const stages = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    const stage1 = stages.find((s) => s.name === "1-stable-prefix")!;
    expect(stage1.messages.length).toBe(2);
    expect(stage1.messages[0]!.role).toBe("system");
    expect(stage1.messages[0]!.content.length).toBeGreaterThan(0);
    expect(stage1.opts.tools).toBeUndefined();
  });

  test("stage 2 adds the tools block on top of stage 1's own messages", () => {
    const stages = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    const stage1 = stages.find((s) => s.name === "1-stable-prefix")!;
    const stage2 = stages.find((s) => s.name === "2-plus-tools")!;
    expect(stage2.messages).toEqual(stage1.messages);
    expect(stage2.opts.tools).toEqual(TOOLS);
    expect(stage2.opts.tool_choice).toBe("auto");
  });

  test("stage 3 carries the volatile context message too (three messages: stable, volatile, user)", () => {
    const stages = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    const stage3 = stages.find((s) => s.name === "3-plus-volatile")!;
    expect(stage3.messages.length).toBe(3);
    expect(stage3.messages[0]!.role).toBe("system");
    expect(stage3.messages[1]!.role).toBe("system");
    expect(stage3.messages[2]!).toEqual({ role: "user", content: QUESTION });
  });

  test("stage 4 merges stage 3's two system messages into one, same total content", () => {
    const stages = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    const stage3 = stages.find((s) => s.name === "3-plus-volatile")!;
    const stage4 = stages.find((s) => s.name === "4-merged-system")!;
    expect(stage4.messages.length).toBe(2);
    expect(stage4.messages[0]!.role).toBe("system");
    expect(stage4.messages[0]!.content).toBe(`${stage3.messages[0]!.content}\n\n${stage3.messages[1]!.content}`);
    expect(stage4.messages[1]).toEqual({ role: "user", content: QUESTION });
  });

  test("stage 5 drops the explicit temperature (lets CHAT_SAMPLING apply), stage 3 keeps it", () => {
    const stages = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    const stage3 = stages.find((s) => s.name === "3-plus-volatile")!;
    const stage5 = stages.find((s) => s.name === "5-chat-sampling")!;
    expect(stage3.opts.temperature).toBe(ENGINE_DEFAULT_TEMPERATURE);
    expect(stage5.opts.temperature).toBeUndefined();
    expect(stage5.messages).toEqual(stage3.messages);
  });

  test("stage 6 matches stage 5 exactly (the completion check, thinking already off since stage 1)", () => {
    const stages = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    const stage5 = stages.find((s) => s.name === "5-chat-sampling")!;
    const stage6 = stages.find((s) => s.name === "6-thinking-off-confirm")!;
    expect(stage6.messages).toEqual(stage5.messages);
    expect(stage6.opts).toEqual(stage5.opts);
  });

  test("thinking is off from stage 1 onward, matching the new path's own setting throughout the bisection", () => {
    const stages = buildStages(DEFAULT_PERSONA, plan, signal, TOOLS);
    for (const stage of stages.slice(2)) {
      expect(stage.opts.thinking).toBe(false);
    }
  });
});
