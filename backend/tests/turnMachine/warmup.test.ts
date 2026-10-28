import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { __resetSettingsCacheForTests } from "@/lib/settings";
import { resetDb } from "../reset-db";
import { contextToMessages } from "@/lib/turnMachine/messages";
import { resolveTurnBudgetBase } from "@/lib/turnMachine/budget";
import { budgetWithTurnToolGates } from "@/lib/turnMachine/toolGates";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { toToolDefinition } from "@/lib/llm";
import { turnWarmupPrompt } from "@/lib/turnMachine/warmup";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { fallbackSignal } from "@/lib/turnSignal";
import { planFor, type PlanInput } from "@/lib/register";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

const signal: TurnSignal = fallbackSignal("hi", "adult", "identified_profile", "inform");
const plan = planFor({
  signal,
  surface: "chat",
  surfaceClass: "written",
  brevity: false,
  evidence: { choices: 0, sources: 0, deliverable: false },
  companion: { directness: "diplomatic", engagement: "balanced", vocabulary: "advanced" },
  band: "adult",
  deferred: false,
  disclosureWithheld: false,
} satisfies PlanInput);

beforeEach(() => {
  resetDb();
  __resetSettingsCacheForTests();
  const now = new Date().toISOString();
  db.insert(people).values({ id: "person-warmup-owner", displayName: "Owner", role: "owner", avatarSeed: "owner", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
});

afterEach(() => {
  resetDb();
  __resetSettingsCacheForTests();
});

describe("turnWarmupPrompt", () => {
  test("matches the real written adult prompt and sorted tool definitions", async () => {
    const warmup = await turnWarmupPrompt();
    const realSystem = contextToMessages([], "hi", DEFAULT_PERSONA, plan, signal, "written")[0]?.content;
    if (typeof realSystem !== "string") throw new Error("The written adult turn did not build a system message.");
    const actor = db.select().from(people).get()!;
    const realBudget = await budgetWithTurnToolGates({
      budget: resolveTurnBudgetBase(undefined, "adult"),
      actor,
      band: "adult",
      surface: "chat",
      surfaceClass: "written",
      spoken: false,
      temporary: false,
      bare: false,
      ephemeral: false,
      text: "hi",
      musicEditAvailable: () => false,
    });
    const realTools = realBudget.budget.tools_offered.slice().sort()
      .map((id) => toolSpecFor(id))
      .filter((tool): tool is NonNullable<typeof tool> => tool !== null)
      .map(toToolDefinition);

    expect(warmup.system).toBe(realSystem);
    expect(JSON.stringify(warmup.tools)).toBe(JSON.stringify(realTools));
  });
});
