import { describe, expect, test } from "bun:test";
import { appliedProfile, askLine, liveFit, needGb, stagesFor, chatMayReturnBetweenStages, type FitInput } from "../src/lib/jobs/liveFit";
import type { Hardware, ProfileRow } from "../src/lib/jobs/profileTable";

const hw: Hardware = {
  budgetGb: 112, marginGb: 8,
  residentGb: { chat: { reduced: 8, standard: 20, boost: 30, max: 40 }, voice: { reduced: 4, standard: 6, boost: 8, max: 10 },
    picture: { reduced: 4, standard: 10, boost: 18, max: 24 }, video: { standard: 8, boost: 14, max: 20 }, music: { standard: 6, boost: 9, max: 12 }, tools: { standard: 5, boost: 8, max: 11 } },
  peakGb: { video: { standard: 30, boost: 44, max: 80 } },
};
const maxRow: ProfileRow = { lead: "video", tier: "max", cells: { chat: { state: "reduced" }, voice: { state: "standard" }, picture: { state: "boost", phase: "before" }, video: { state: "max" }, music: { state: "queued" }, tools: { state: "queued" } } };
const boostRow: ProfileRow = { ...maxRow, tier: "boost", cells: { ...maxRow.cells, video: { state: "boost" }, picture: { state: "standard", phase: "before" } } };
const standardRow: ProfileRow = { ...boostRow, tier: "standard", cells: { ...boostRow.cells, video: { state: "standard" } } };
const table = [maxRow, boostRow, standardRow];
function input(overrides: Partial<FitInput> = {}): FitInput {
  return { row: maxRow, table, hw, memory: { freeGb: 62, evictableGb: 0 }, pins: {}, priorityWeight: { chat: 100, voice: 90, picture: 60, video: 40, music: 30, tools: 20 }, pickedTier: "max", lowerWithoutAsking: {}, ...overrides };
}

describe("live profile fit", () => {
  test("falls to Boost with pictures Standard at 62 GB and asks, but runs Max at 95 GB", () => {
    const squeezed = liveFit(input());
    expect(squeezed).toMatchObject({ outcome: "ask", leadTier: "boost", belowPick: true, reason: "lead_lowered", applied: { tier: "boost", cells: { picture: { state: "standard", phase: "before" } } } });
    expect(liveFit(input({ memory: { freeGb: 95, evictableGb: 0 } }))).toMatchObject({ outcome: "run", leadTier: "max", belowPick: false, reason: "fits" });
    expect(liveFit(input({ lowerWithoutAsking: { video: true } }))).toMatchObject({ outcome: "run", leadTier: "boost", belowPick: true });
  });
  test("uses evictable memory before stepping down", () => {
    const result = liveFit(input({ memory: { freeGb: 62, evictableGb: 35 } }));
    expect(result.leadTier).toBe("max");
    expect(result.steps).toContain("cleared waste");
  });
  test("honors pins and the chat and voice floors; only other cells can queue or turn off", () => {
    // A pin of "chat never below Standard" makes every row that lowers chat unusable: the job queues with no profile applied.
    const pinned = liveFit(input({ pins: { chat: "standard" }, memory: { freeGb: 20, evictableGb: 0 } }));
    expect(pinned.applied).toBeNull();
    expect(pinned.outcome).toBe("queue");
    const squeezed = liveFit(input({ memory: { freeGb: 50, evictableGb: 0 } }));
    for (const row of [squeezed.applied]) if (row) {
      expect(["queued", "off"]).not.toContain(row.cells.chat?.state);
      expect(row.cells.voice?.state).toBe("standard");
    }
    expect(needGb(maxRow, hw)).toBe(80 + 8 + 6);
  });
  test("queues if it can ever fit and refuses if even the lowest tier cannot", () => {
    expect(liveFit(input({ memory: { freeGb: 1, evictableGb: 0 } }))).toMatchObject({ outcome: "queue", reason: "no_room_now", requestedNeedGb: 94 });
    const huge = { ...hw, budgetGb: 50, marginGb: 8 };
    expect(liveFit(input({ hw: huge, memory: { freeGb: 1, evictableGb: 0 } }))).toMatchObject({ outcome: "refuse", reason: "never_fits", haveGb: 1 });
  });
  test("formats audience-specific ask, counts applied cells, and exposes stages", () => {
    const result = liveFit(input());
    expect(askLine(result, "admin")).toContain("Max needs about 94 GB, 62 GB is free");
    expect(askLine(result, "adult")).not.toContain("GB");
    expect(askLine(result, "child")).toBeNull();
    expect(askLine(result, "adult")).not.toContain("—");
    expect(appliedProfile(result)).toEqual({ lowered: 1, queued: 2, off: 0, closed_apps: 0, closed_bytes: 0 });
    expect(Object.keys(appliedProfile(result)).sort()).toEqual(["closed_apps", "closed_bytes", "lowered", "off", "queued"]);
    expect(stagesFor(maxRow)).toHaveLength(2);
    expect(chatMayReturnBetweenStages({ quietOk: true, cooldownOk: true })).toBe(true);
    expect(chatMayReturnBetweenStages({ quietOk: false, cooldownOk: true })).toBe(false);
  });
  test("chat is never queued or off regardless of memory", () => {
    for (const freeGb of [0, 1, 20, 62, 95, 200]) {
      const result = liveFit(input({ memory: { freeGb, evictableGb: 0 } }));
      expect(["queued", "off"]).not.toContain(result.applied?.cells.chat?.state);
    }
  });

  test("a pin is a floor: a row above the pin is usable, one below it is not", () => {
    const boostChat: ProfileRow = { ...maxRow, cells: { ...maxRow.cells, chat: { state: "boost" } } };
    const above = liveFit(input({ row: boostChat, table: [boostChat], pins: { chat: "standard" }, memory: { freeGb: 200, evictableGb: 0 } }));
    expect(above.outcome).toBe("run");
    expect(liveFit(input({ pins: { chat: "standard" }, memory: { freeGb: 200, evictableGb: 0 } })).outcome).toBe("queue");
  });
  test("a job that fits once other work is queued is queued, never refused as never_fits", () => {
    const tight = { ...hw, budgetGb: 56, marginGb: 8 };
    const heavy: ProfileRow = { ...standardRow, cells: { ...standardRow.cells, music: { state: "standard" }, tools: { state: "standard" } } };
    const result = liveFit(input({ row: heavy, table: [heavy], pickedTier: "standard", hw: tight, memory: { freeGb: 1, evictableGb: 0 } }));
    expect(result.outcome).toBe("queue");
    expect(result.reason).toBe("no_room_now");
  });
});
