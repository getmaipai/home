import { expect, test } from "bun:test";
import type { StackInstallPlan } from "@/lib/stack/client";
import { wordPlan } from "./installPlanWording";

const base: StackInstallPlan = { level: "moderate", tier: "p32", label: "L", memory_gb: 32, memory_source: "unified", models: [], total_bytes: 0, remaining_bytes: 0, free_disk_bytes: null, fits_disk: null };

test("each level gets its name and what it can do", () => {
  expect(wordPlan({ ...base, level: "recommended" }).gets).toContain("Make pictures");
  expect(wordPlan({ ...base, level: "minimal" }).gets).not.toContain("Make pictures");
  expect(wordPlan(base).headline).toStartWith("Moderate");
});

test("unknown memory asks the person; too small says go to two computers", () => {
  const ask = wordPlan({ ...base, level: null, tier: null, memory_source: "unknown", memory_gb: 0 });
  expect(ask.needsMemoryAnswer).toBe(true);
  const small = wordPlan({ ...base, level: null, tier: null, memory_gb: 8 });
  expect(small.level).toBe("below_minimum");
  expect(small.detail).toContain("two computers");
  expect(wordPlan(null).level).toBe("unknown");
});

test("a full disk is said in plain words", () => {
  const w = wordPlan({ ...base, remaining_bytes: 20e9, free_disk_bytes: 5e9, fits_disk: false, models: [{ id: "a", role: "chat", url: "u", sha256: "s", licence: "l", revision: "r", starter: true, installed: false }] });
  expect(w.diskLine).toMatch(/^This computer needs about \d+ GB free for the moderate setup; it has 4\.6 GB\. Free up space, or choose a smaller plan\.$/);
});

test("a Mac that is too small is told its own memory total", () => {
  const small = wordPlan({ ...base, level: null, tier: null, memory_gb: 8, memory_source: "unified" });
  expect(small.detail).toContain("This Mac has 8 GB of memory in total.");
});

test("the memory question tells a Mac owner to pick the total memory", () => {
  const ask = wordPlan({ ...base, level: null, tier: null, memory_source: "unknown", memory_gb: 0 });
  expect(ask.detail).toContain("On a Mac, pick the Mac's total memory");
});

test("the plan line names voice when the plan carries speech in and out", () => {
  const model = (role: string) => ({ id: role, role, url: "u", sha256: "s", licence: "l", revision: "r", starter: false, installed: false });
  const withVoice = wordPlan({ ...base, models: [model("chat"), model("stt"), model("tts")] });
  expect(withVoice.gets).toContain("Voice: talk to Home");
  expect(wordPlan(base).gets).toContain("Voice: talk to Home");
  expect(wordPlan({ ...base, models: [model("chat"), model("stt")] }).gets).not.toContain("Voice: talk to Home");
});

// INSTALL-DISK-01: the wording carries the disk plan, so the page lists every install with its size and checks the room.
import { shippedDiskPlan } from "@/lib/diskPlan";
import { selectionTotals } from "../../../shared/diskPlanMath";

const GIB = 1_073_741_824;
const p64: StackInstallPlan = { ...base, level: "recommended", tier: "p64", memory_gb: 64 };

test("the disk list comes from the Stack's plan, or from the table shipped with Home when the Stack has none", () => {
  const shipped = wordPlan({ ...p64, free_disk_bytes: 500 * GIB });
  expect(shipped.disk?.source).toBe("shipped");
  expect(shipped.disk?.plan.tier).toBe("p64");
  const live = wordPlan({ ...p64, free_disk_bytes: 500 * GIB, disk: shippedDiskPlan("p64") });
  expect(live.disk?.source).toBe("stack");
  expect(live.disk?.plan.rows.map((row) => row.id)).toContain("pictures");
});

test("every row has a size and a need, and the size line is the default selection's total", () => {
  const w = wordPlan({ ...p64, free_disk_bytes: 500 * GIB });
  for (const row of w.disk!.plan.rows) { expect(row.installed_bytes).toBeGreaterThan(0); expect(["required", "recommended", "optional"]).toContain(row.need); }
  const plan = w.disk!.plan;
  const totals = selectionTotals(plan, plan.default_selected);
  expect(w.sizeLine).toContain("On disk:");
  // Home's own records add 2 GB to what the disk must hold.
  expect(w.sizeLine).toContain(`${Math.ceil((totals.required_free_bytes + 2 * GIB) / GIB)} GB free`);
});

test("the verdict is green with room, amber when tight, red when short; only red sets diskLine", () => {
  const plan = shippedDiskPlan("p64");
  const need = plan.default.required_free_bytes + 2 * GIB;
  expect(wordPlan({ ...p64, free_disk_bytes: need + plan.headroom_warn_bytes + 50 * GIB }, [{ freeBytes: need + plan.headroom_warn_bytes + 50 * GIB, needs: ["home", "data", "ai"] }]).disk?.verdict.state).toBe("green");
  const tight = wordPlan({ ...p64 }, [{ freeBytes: need + GIB, needs: ["home", "data", "ai"] }]);
  expect(tight.disk?.verdict.state).toBe("amber");
  expect(tight.diskLine).toBeNull();
  const short = wordPlan({ ...p64 }, [{ freeBytes: 61 * GIB, needs: ["home", "data", "ai"] }]);
  expect(short.disk?.verdict.state).toBe("red");
  expect(short.diskLine).toMatch(/^This computer needs about \d+ GB free for the recommended setup; it has 61 GB\. Free up space, or choose a smaller plan\.$/);
});

test("rows already installed cost nothing more when the Stack's plan marks them", () => {
  const plan = shippedDiskPlan("p16");
  const installed = { ...plan, rows: plan.rows.map((row) => row.kind === "model" && row.model_ids.length ? { ...row, installed: true } : row) };
  const w = wordPlan({ ...base, level: "minimal", tier: "p16", disk: installed }, [{ freeBytes: 6 * GIB, needs: ["home", "data", "ai"] }]);
  expect(w.disk?.verdict.state).not.toBe("red");
});
