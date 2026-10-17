import { describe, expect, test } from "bun:test";
import { spaceRows } from "../src/routes/setupFolders";
import { minimum } from "../src/lib/placement";
import { aiRequiredBytes, shippedPlanForLevel, recordedLevel } from "../src/lib/diskPlan";
import { planDiskCheck } from "../src/setup/checks/planDisk";
import { shippedDiskPlan } from "../src/lib/diskPlan";
import { classDir } from "../src/lib/paths";
import { GIB } from "../../shared/diskPlanMath";

describe("the storage step asks for what the plan needs", () => {
  const level = recordedLevel();
  const plan = shippedPlanForLevel(level);

  test("the models folder's minimum is the plan's AI requirement, not a fixed number", () => {
    expect(minimum("models")).toBe(aiRequiredBytes(plan));
    expect(minimum("models", { modelsRequiredBytes: 123 })).toBe(123);
  });

  test("a models drive too small for the plan is refused with the plan's figure and what to do", () => {
    const rows = spaceRows({ models: "/small-disk/models" }, false, { freeBytes: (path) => (path.startsWith("/small-disk") ? 30 * GIB : 5000 * GIB), device: (path) => (path.startsWith("/small-disk") ? 2 : 1) });
    const models = rows.find((row) => row.class === "models");
    expect(models?.kind).toBe("refusal");
    expect(models?.text).toMatch(/^The \w+ setup needs about \d+ GB free on this drive, and it has 30 GB\. Choose a folder on a drive with more room\.$/);
    expect(rows.find((row) => row.class === "records")).toBeUndefined();
  });

  test("two folders on one drive are asked for the sum, each on its own drive for its own part", () => {
    const need = aiRequiredBytes(plan);
    const sharedShort = spaceRows({ models: "/d/models", records: "/d/records" }, false, { freeBytes: () => need + GIB, device: () => 1 });
    expect(sharedShort.map((row) => row.class).sort()).toEqual(["models", "records"]);
    const apart = spaceRows({ models: "/big/models", records: "/small/records" }, false, { freeBytes: (path) => (path.startsWith("/small") ? 100 * GIB : 5000 * GIB), device: (path) => (path.startsWith("/small") ? 2 : path.startsWith("/big") ? 3 : 1) });
    expect(apart).toEqual([]);
  });

  test("with the AI on another computer, only Home's own folders are held to this drive", () => {
    const rows = spaceRows({ records: "/d/records" }, true, { freeBytes: () => 1 * GIB, device: () => 1 });
    expect(rows.every((row) => row.class === "records")).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("the folder list uses the default folders when none is chosen", () => {
    expect(spaceRows({}, false, { freeBytes: () => 5000 * GIB, device: () => 1 })).toEqual([]);
    expect(classDir("models").length).toBeGreaterThan(0);
  });
});

describe("the checks screen reports disk with the same function", () => {
  const level = recordedLevel();
  const levelPlan = shippedPlanForLevel(level);
  const full = levelPlan.default.required_free_bytes + 2 * GIB;
  const smallest = levelPlan.minimum.required_free_bytes + 2 * GIB;
  const run = (free: number, extra = {}) => planDiskCheck({ io: { freeBytes: () => free, device: () => 1 }, stackPlan: null, ...extra });

  test("green with room for the default setup; amber when it is tight", () => {
    expect(run(full + levelPlan.headroom_warn_bytes).status).toBe("green");
    expect(run(full + GIB).status).toBe("amber");
  });

  test("a default setup that does not fit warns and points at the plan screen, because the plan screen can shrink it", () => {
    if (full - smallest < 2 * GIB) return;
    const result = run(Math.floor((full + smallest) / 2) + levelPlan.headroom_warn_bytes);
    expect(result.status).toBe("amber");
    expect(result.message).toContain("turn off extras");
    expect(result.message).toMatch(/needs about \d+(\.\d)? GB free/);
  });

  test("red only when even the smallest setup does not fit, with the figures and what to do", () => {
    const red = run(smallest - 1);
    expect(red.status).toBe("red");
    expect(red.message).toMatch(/^This computer needs about \d+(\.\d)? GB free for the smallest setup for this computer; it has \d+(\.\d)? GB\. Free up space, or choose a smaller plan\.$/);
  });

  test("the Stack's own reading of its disk lowers what is free", () => {
    const result = planDiskCheck({ io: { freeBytes: () => full * 4, device: () => 1 }, aiFreeBytes: Math.floor(smallest / 2) });
    expect(result.status).toBe("red");
  });

  test("the AI on another computer is judged by that computer's disk, Home's own by this one", () => {
    const result = planDiskCheck({ io: { freeBytes: () => 50 * GIB, device: () => 1 }, aiElsewhere: true, aiFreeBytes: levelPlan.default.required_free_bytes + levelPlan.headroom_warn_bytes + 1 });
    expect(result.status).toBe("green");
  });
});
