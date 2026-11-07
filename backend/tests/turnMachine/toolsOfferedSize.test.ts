// AUDIT-TOOLS-01 (efficiency audit 2026-11-06, item 4): the media tool schemas stay small, and the budget's size stat counts what the model is handed.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { toolsOfferedStat } from "@/lib/turnMachine/budget";
import { NO_RECORD_BUDGET } from "@/lib/turnMachine/budget";
import type { TurnBudget } from "@/lib/turnMachine/contract";

const size = (id: string): number => {
  const m = JSON.parse(readFileSync(new URL(`../../packages/${id}/manifest.json`, import.meta.url), "utf8")) as { id: string; description: string; args: unknown };
  return JSON.stringify({ id: m.id, description: m.description, args: m.args }).length;
};

// The character budgets are the brief's targets. edit_video and edit_music cannot reach theirs without dropping an argument, an enum value or a bound
// (their schema without a single description is already 4,649 and 1,432 characters), so their ceilings are the sizes reached by AUDIT-TOOLS-01: a later
// edit may not grow them back.
const CEILING: Record<string, number> = { edit_video: 6000, generate_video: 1500, generate_image: 1500, edit_music: 1700, generate_music: 1500, show_images: 1500, make_film: 1500 };

describe("the media tool schemas stay at their size ceilings", () => {
  for (const [id, ceiling] of Object.entries(CEILING)) {
    test(`${id} is at most ${ceiling} characters`, () => {
      expect(size(id)).toBeLessThanOrEqual(ceiling);
    });
  }
});

describe("toolsOfferedStat", () => {
  const spec = (id: string) => ({ id, description: "does a thing", args: { type: "object" } });
  const budget = (over: Partial<TurnBudget>): TurnBudget => ({ ...NO_RECORD_BUDGET, model_transitions: true, rounds: 2, tools_offered: ["a", "b", "gone"], ...over });

  test("counts each offered tool that resolves and adds the size of its {id, description, args} JSON", () => {
    const stat = toolsOfferedStat(budget({}), (id) => (id === "gone" ? null : spec(id)));
    expect(stat.count).toBe(2);
    expect(stat.chars).toBe(2 * JSON.stringify(spec("a")).length);
  });

  test("a budget that runs no tool round offered none", () => {
    expect(toolsOfferedStat(budget({ rounds: 0 }), spec)).toEqual({ count: 0, chars: 0 });
    expect(toolsOfferedStat(budget({ model_transitions: false }), spec)).toEqual({ count: 0, chars: 0 });
  });
});
